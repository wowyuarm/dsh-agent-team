/**
 * Progress-visibility nudges: advisory Session notices that keep Member agents
 * reporting progress into their Threads. Two regimes over one shared
 * per-Member silent-tool-call counter:
 *
 * - Thread progress (A): a Member holding an active Claim, or following a
 *   taskless Thread, that has run many tool calls since its last committed
 *   public communication is reminded to post a brief update. The reminder
 *   ladder advances 20 → 40 → 60… per Member.
 * - Claim suggestion (B): a Member following a still-`todo` Task it has never
 *   claimed is reminded — once per (Member, Thread) within the current Member
 *   Session — that team_claim exists.
 *
 * The Coordinator owns counting, thresholds, notice formatting, dedupe and
 * in-flight revocation. It consumes only facts the Host already holds: live
 * `tool/call`/`user/message` session events, committed ledger operations, and
 * a ledger-owned eligibility projection (`progressNudgeTargets`). It never
 * writes Team facts and never wakes idle agents on its own — a nudge rides
 * the member's next tool call.
 *
 * @module @wowyuarm/dsh-agent-team/progress-nudge
 */

import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { AgentTeamMemberId, AgentTeamProgressNudgeTargets, AgentTeamThreadRef } from './types.ts'

const PROGRESS_NUDGE_PLUGIN_ID = '@wowyuarm/dsh-agent-team'

/** Notice summary for every nudge this Coordinator injects. */
export const PROGRESS_NUDGE_NOTICE_SUMMARY = 'Progress visibility reminder'

export const PROGRESS_NUDGE_TOOL_CALLS_START = 20
export const PROGRESS_NUDGE_TOOL_CALLS_STEP = 20
export const CLAIM_SUGGESTION_TOOL_CALLS = 5
/** Stable line prefix marking Claim-suggestion targets inside a nudge notice; the only text this module ever parses back. */
const CLAIM_TARGET_LINE_PREFIX = '- Claim target: Task '
const CLAIM_TARGET_LINE = new RegExp(`^- Claim target: Task (task:[0-9a-f-]+) — Thread (thread:[0-9a-f-]+)$`)

/** Minimal Agent surface the Coordinator depends on; real Agents satisfy it, tests fake it. */
export interface ProgressNudgeAgent {
  readonly inbox: {
    readonly nextStep: readonly UserMessage[]
    readonly nextTurn: readonly UserMessage[]
    remove(messageId: UserMessage['id']): boolean
  }
  steer(message: UserMessage): void
}

/** Minimal operation fact the Coordinator consumes; the ledger's full record satisfies it structurally. */
export interface ProgressNudgeOperation {
  readonly actor: { readonly kind: string; readonly memberId?: AgentTeamMemberId | undefined }
  readonly kind: string
}

/** One live session event, structurally; the Session's own event map satisfies it. */
export interface ProgressNudgeSessionEvent {
  readonly type: string
  readonly turn?: number | undefined
  readonly message?: UserMessage | undefined
}

export interface ProgressNudgeCoordinatorOptions {
  /** Live Agent lookup for revocation and injection. */
  readonly agentForMember: (memberId: AgentTeamMemberId) => ProgressNudgeAgent | undefined
  /** Current eligibility projection from the ledger. */
  readonly targetsForMember: (memberId: AgentTeamMemberId) => AgentTeamProgressNudgeTargets
  /** Log one line when steer fails; the Host wires its logger. */
  readonly log?: (message: string) => void
  /** Initial ladder start; tests override to keep runs small. */
  readonly progressThresholdStart?: number
  /** Ladder step; tests override to keep runs small. */
  readonly progressThresholdStep?: number
  /** Claim-suggestion threshold; tests override to keep runs small. */
  readonly claimSuggestionThreshold?: number
}

interface MemberNudgeState {
  readonly sessionId: SessionId
  silentToolCalls: number
  nextProgressThreshold: number
  /** Turn of the last injected nudge; at most one nudge per turn. */
  lastNudgeTurn?: number | undefined
  /** Threads whose Claim suggestion the model actually consumed, not merely queued. */
  readonly claimSuggested: Set<AgentTeamThreadRef>
  /** Threads whose suggestion is queued but not yet consumed; revocable without consuming the one chance. */
  readonly pendingClaimTargets: Set<AgentTeamThreadRef>
  /** Ids of injected, not-yet-consumed notices; at most one live at a time per Member. */
  pendingNoticeId?: UserMessage['id'] | undefined
}

/** Ledger operation kinds that count as committed public communication and reset silence. */
export function isPublicCommunicationOperationKind(kind: string): boolean {
  return kind === 'team/message-sent' || kind === 'team/thread-replied'
    || kind === 'team/claim-created' || kind === 'team/claim-done' || kind === 'team/claim-released'
}

/** Whether one message is a nudge notice this module injected. */
export function isProgressNudgeNotice(message: UserMessage): boolean {
  const source = message.source
  return source.kind === 'plugin' && source.plugin === PROGRESS_NUDGE_PLUGIN_ID
    && source.form === 'notice' && source.summary === PROGRESS_NUDGE_NOTICE_SUMMARY
}

/**
 * Event-driven per-Member nudge state machine. All state is in-process and
 * scoped to one Member Session; nothing is persisted. The Host feeds it live
 * session events, committed operations, and lifecycle stop points.
 */
export class ProgressNudgeCoordinator {
  private readonly members = new Map<AgentTeamMemberId, MemberNudgeState>()
  private readonly agentForMember: ProgressNudgeCoordinatorOptions['agentForMember']
  private readonly targetsForMember: ProgressNudgeCoordinatorOptions['targetsForMember']
  private readonly log: ((message: string) => void) | undefined
  private readonly progressThresholdStart: number
  private readonly progressThresholdStep: number
  private readonly claimSuggestionThreshold: number

  constructor(options: ProgressNudgeCoordinatorOptions) {
    this.agentForMember = options.agentForMember
    this.targetsForMember = options.targetsForMember
    this.log = options.log
    this.progressThresholdStart = options.progressThresholdStart ?? PROGRESS_NUDGE_TOOL_CALLS_START
    this.progressThresholdStep = options.progressThresholdStep ?? PROGRESS_NUDGE_TOOL_CALLS_STEP
    this.claimSuggestionThreshold = options.claimSuggestionThreshold ?? CLAIM_SUGGESTION_TOOL_CALLS
  }

  /**
   * One live session event for a Member. Only `tool/call` counts toward
   * silence; a `user/message` whose source is exactly this module's own notice
   * records that the model consumed the nudge (a Claim suggestion becomes
   * final only then). The live `agent` is passed in by the caller because it
   * exists at event time even before the Host finishes publishing the handle.
   */
  onSessionEvent(memberId: AgentTeamMemberId, sessionId: SessionId, agent: ProgressNudgeAgent, event: ProgressNudgeSessionEvent): void {
    if (event.type === 'user/message') {
      const message = event.message
      if (message === undefined || !isProgressNudgeNotice(message)) return
      const state = this.members.get(memberId)
      if (state === undefined) return
      if (state.pendingNoticeId === message.id) state.pendingNoticeId = undefined
      state.pendingClaimTargets.clear()
      for (const threadRef of claimTargetThreadRefs(message)) state.claimSuggested.add(threadRef)
      return
    }
    if (event.type !== 'tool/call') return
    let state = this.members.get(memberId)
    if (state === undefined || state.sessionId !== sessionId) {
      // First event of this Member Session (or a generation the Host did not
      // stop explicitly): fresh tracking replaces whatever was there.
      this.dropState(memberId, state)
      state = { sessionId, silentToolCalls: 0, nextProgressThreshold: this.progressThresholdStart,
        claimSuggested: new Set(), pendingClaimTargets: new Set() }
      this.members.set(memberId, state)
    }
    state.silentToolCalls += 1
    const turn = event.turn ?? 0
    if (state.lastNudgeTurn === turn) return
    this.maybeNudge(memberId, state, agent, turn)
  }

  /**
   * One ledger operation committed. A Member actor's public communication
   * resets its silence; every commit also reconciles pending notices whose
   * targets may have just disappeared (Task accepted, Channel archived, the
   * Claim taken by someone else).
   */
  onCommitted(operation: ProgressNudgeOperation): void {
    if (operation.actor.kind === 'member' && operation.actor.memberId !== undefined
      && isPublicCommunicationOperationKind(operation.kind)) {
      const state = this.members.get(operation.actor.memberId)
      if (state !== undefined) {
        state.silentToolCalls = 0
        state.nextProgressThreshold = this.progressThresholdStart
        this.revokePending(operation.actor.memberId, state)
      }
    }
    this.reconcileAll()
  }

  /** Attention/promotion changes make pending notices worth re-checking against current eligibility. */
  onEligibilityChanged(): void {
    this.reconcileAll()
  }

  /** Revoke one Member's queued-but-unconsumed nudge, e.g. when a higher-priority Team notice is injected. */
  revokePendingNotice(memberId: AgentTeamMemberId): void {
    const state = this.members.get(memberId)
    if (state !== undefined) this.revokePending(memberId, state)
  }

  /** Drop all tracking for one Member (suspend/archive/remove/renew/context-clear/steer failure). */
  stopTracking(memberId: AgentTeamMemberId): void {
    this.dropState(memberId, this.members.get(memberId))
    this.members.delete(memberId)
  }

  /** Stop tracking every Member. */
  dispose(): void {
    for (const memberId of this.members.keys()) this.stopTracking(memberId)
  }

  private dropState(memberId: AgentTeamMemberId, state: MemberNudgeState | undefined): void {
    if (state === undefined) return
    this.revokePending(memberId, state)
    this.members.delete(memberId)
  }

  private revokePending(memberId: AgentTeamMemberId, state: MemberNudgeState): void {
    if (state.pendingNoticeId !== undefined) {
      const agent = this.agentForMember(memberId)
      const pending = agent === undefined ? undefined
        : [...agent.inbox.nextStep, ...agent.inbox.nextTurn].find(message => message.id === state.pendingNoticeId)
      // A just-consumed notice is simply gone; remove() returning false is expected.
      if (pending !== undefined) agent!.inbox.remove(pending.id)
    }
    state.pendingNoticeId = undefined
    state.pendingClaimTargets.clear()
  }

  /** Re-check every live Member's pending notice against current eligibility. */
  private reconcileAll(): void {
    for (const [memberId, state] of this.members) {
      if (state.pendingNoticeId === undefined) continue
      const agent = this.agentForMember(memberId)
      if (agent === undefined) {
        this.dropState(memberId, state)
        continue
      }
      const targets = this.targetsForMember(memberId)
      const stillValid = targets.progress.length > 0
        || targets.claim.some(target => state.pendingClaimTargets.has(target.threadRef))
      if (!stillValid) this.revokePending(memberId, state)
    }
  }

  private maybeNudge(memberId: AgentTeamMemberId, state: MemberNudgeState, agent: ProgressNudgeAgent, turn: number): void {
    const targets = this.targetsForMember(memberId)
    const progressDue = state.silentToolCalls >= state.nextProgressThreshold && targets.progress.length > 0
    const freshClaimTargets = targets.claim
      .filter(target => !state.claimSuggested.has(target.threadRef) && !state.pendingClaimTargets.has(target.threadRef))
    const claimDue = state.silentToolCalls >= this.claimSuggestionThreshold && freshClaimTargets.length > 0
    if (!progressDue && !claimDue) return
    if (this.hasBlockingNotice(agent)) return
    const notice = createUserMessage({
      content: [{ type: 'text', text: nudgeNoticeText(state.silentToolCalls, progressDue ? targets.progress : [], claimDue ? freshClaimTargets : []) }],
      source: { kind: 'plugin', plugin: PROGRESS_NUDGE_PLUGIN_ID, form: 'notice', summary: PROGRESS_NUDGE_NOTICE_SUMMARY },
    })
    try {
      agent.steer(notice)
    } catch (error) {
      this.log?.(`agent-team: progress nudge steer failed for member '${memberId}': ${error instanceof Error ? error.message : String(error)}`)
      this.stopTracking(memberId)
      return
    }
    state.lastNudgeTurn = turn
    if (progressDue) state.nextProgressThreshold += this.progressThresholdStep
    state.pendingNoticeId = notice.id
    if (claimDue) for (const target of freshClaimTargets) state.pendingClaimTargets.add(target.threadRef)
  }

  /**
   * Recovery, Inbox, and pre-compaction notices outrank a progress nudge. If
   * one is already pending, this nudge stays due and retries on the next tool
   * call; a DM relay is not a notice and never blocks.
   */
  private hasBlockingNotice(agent: ProgressNudgeAgent): boolean {
    for (const message of [...agent.inbox.nextStep, ...agent.inbox.nextTurn]) {
      const source = message.source
      if (source.kind !== 'plugin' || source.plugin !== PROGRESS_NUDGE_PLUGIN_ID || source.form !== 'notice') continue
      if (source.summary !== PROGRESS_NUDGE_NOTICE_SUMMARY) return true
    }
    return false
  }
}

/** Extract the threadRefs this module itself wrote as Claim targets in one notice. */
function claimTargetThreadRefs(message: UserMessage): readonly AgentTeamThreadRef[] {
  const refs: AgentTeamThreadRef[] = []
  for (const block of message.content) {
    if (block.type !== 'text') continue
    for (const line of block.text.split('\n')) {
      const match = CLAIM_TARGET_LINE.exec(line)
      if (match !== null) refs.push(match[2] as AgentTeamThreadRef)
    }
  }
  return refs
}

function nudgeNoticeText(silentToolCalls: number, progress: AgentTeamProgressNudgeTargets['progress'], claim: AgentTeamProgressNudgeTargets['claim']): string {
  const sections: string[] = []
  if (progress.length > 0) {
    sections.push([
      'Progress visibility reminder',
      '',
      `You have made ${silentToolCalls} tool calls since your last visible Team update. Please briefly update the relevant Thread(s): what you confirmed, what remains, and any blocker. Read the Thread first if needed, then continue working.`,
      '',
      ...progress.map(target => target.reason === 'active-claim'
        ? `- Task ${target.taskRef} — Thread ${target.threadRef}`
        : `- Taskless Thread ${target.threadRef} (reply only if your current work relates to it)`),
    ].join('\n'))
  }
  if (claim.length > 0) {
    sections.push([
      'Claim visibility reminder',
      '',
      'You have been working while following the Task(s) below, but you have never claimed a direction there.',
      '',
      ...claim.map(target => `${CLAIM_TARGET_LINE_PREFIX}${target.taskRef} — Thread ${target.threadRef}`),
      '',
      'If your current work belongs to one of these Tasks, briefly state your direction in its Thread and consider team_claim. If it does not, no action is required. This is advisory, not a claim requirement.',
    ].join('\n'))
  }
  if (progress.length > 0) sections.push('This is advisory; do not stop useful work merely to produce a long status report.')
  return sections.join('\n\n')
}
