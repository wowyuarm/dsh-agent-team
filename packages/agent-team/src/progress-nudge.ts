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
 * The Coordinator owns counting, thresholds, notice formatting, dedupe,
 * in-flight revocation, and the deferred steer. It consumes only facts the
 * Host already holds: live `tool/call`/`user/message` session events in their
 * real `{type, seq, time, data}` envelope, the Session log for one-time
 * recovery, committed ledger operations, and a ledger-owned eligibility
 * projection (`progressNudgeTargets`). It never writes Team facts and never
 * wakes idle agents on its own — a nudge rides the member's next tool call.
 *
 * @module @wowyuarm/dsh-agent-team/progress-nudge
 */

import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { AgentTeamMemberId, AgentTeamProgressNudgeTargets, AgentTeamThreadRef } from './types.ts'

const PROGRESS_NUDGE_PLUGIN_ID = '@wowyuarm/dsh-agent-team'

/** Notice summary for every nudge this Coordinator injects. */
export const PROGRESS_NUDGE_NOTICE_SUMMARY = 'Progress visibility reminder'

export const PROGRESS_NUDGE_TOOL_CALLS_START = 20
export const PROGRESS_NUDGE_TOOL_CALLS_STEP = 20
export const CLAIM_SUGGESTION_TOOL_CALLS = 5
/** Stable line prefix marking Claim-suggestion targets inside a nudge notice; the only text this module ever parses back. */
const CLAIM_TARGET_LINE_PREFIX = '- Claim target: Task '
const CLAIM_TARGET_LINE = /^- Claim target: Task (task:[0-9a-f-]+) — Thread (thread:[0-9a-f-]+)$/

/** Minimal Agent surface the Coordinator depends on; real Agents satisfy it, tests fake it. */
export interface ProgressNudgeAgent {
  readonly inbox: {
    readonly nextStep: readonly UserMessage[]
    readonly nextTurn: readonly UserMessage[]
    remove(messageId: UserMessage['id']): boolean
  }
  steer(message: UserMessage): void
}

/**
 * Read-only view of one Session log used to recover consumed one-time Claim
 * suggestions when a Member Session's tracking is (re)established.
 */
export interface ProgressNudgeSessionLog {
  /** Durable events in sequence order; the real `Session.ownEvents()`. */
  readonly events: readonly SessionEvent[]
}

/** Minimal operation fact the Coordinator consumes; the ledger's full record satisfies it structurally. */
export interface ProgressNudgeOperation {
  readonly actor: { readonly kind: string; readonly memberId?: AgentTeamMemberId | undefined }
  readonly kind: string
}

export interface ProgressNudgeCoordinatorOptions {
  /** Live Agent lookup for revocation and injection. */
  readonly agentForMember: (memberId: AgentTeamMemberId) => ProgressNudgeAgent | undefined
  /** Current eligibility projection from the ledger. */
  readonly targetsForMember: (memberId: AgentTeamMemberId) => AgentTeamProgressNudgeTargets
  /** Durable Session log lookup for one-time recovery on (re)activation. */
  readonly sessionLogForMember: (memberId: AgentTeamMemberId, sessionId: SessionId) => ProgressNudgeSessionLog | undefined
  /** Log one line when steer fails; the Host wires its logger. */
  readonly log?: (message: string) => void
  /**
   * Schedule the actual steer past an in-flight session append publication.
   * The default defers one microtask; tests may substitute a synchronous or
   * manually triggered scheduler. The callback runs the real steer.
   */
  readonly scheduleSteer?: (run: () => void) => void
  /** Initial ladder start; tests override to keep runs small. */
  readonly progressThresholdStart?: number
  /** Ladder step; tests override to keep runs small. */
  readonly progressThresholdStep?: number
  /** Claim-suggestion threshold; tests override to keep runs small. */
  readonly claimSuggestionThreshold?: number
}

/** What one injected notice is about — the exact target set for revocation. */
interface PendingNotice {
  readonly messageId: UserMessage['id']
  /** Progress (A) threads listed in the notice body. */
  readonly progressThreadRefs: readonly AgentTeamThreadRef[]
  /** Claim (B) threads listed in the notice body. queued = consumed = false. */
  readonly claimThreadRefs: readonly AgentTeamThreadRef[]
  /** Set once the scheduled steer actually ran without throwing. */
  steered: boolean
  /** Set when revoked before the steer ran; the scheduled steer must no-op. */
  canceled: boolean
}

interface MemberNudgeState {
  readonly sessionId: SessionId
  silentToolCalls: number
  nextProgressThreshold: number
  /** Turn of the last injected nudge; at most one nudge per turn. */
  lastNudgeTurn?: number | undefined
  /** Threads whose Claim suggestion the model actually consumed, not merely queued. */
  readonly claimSuggested: Set<AgentTeamThreadRef>
  /** The single live queued-or-injected notice, if any. */
  pending?: PendingNotice | undefined
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
 * session events in their real envelope, committed operations, and lifecycle
 * stop points.
 */
export class ProgressNudgeCoordinator {
  private readonly members = new Map<AgentTeamMemberId, MemberNudgeState>()
  private readonly agentForMember: ProgressNudgeCoordinatorOptions['agentForMember']
  private readonly targetsForMember: ProgressNudgeCoordinatorOptions['targetsForMember']
  private readonly sessionLogForMember: ProgressNudgeCoordinatorOptions['sessionLogForMember']
  private readonly log: ((message: string) => void) | undefined
  private readonly scheduleSteer: (run: () => void) => void
  private readonly progressThresholdStart: number
  private readonly progressThresholdStep: number
  private readonly claimSuggestionThreshold: number

  constructor(options: ProgressNudgeCoordinatorOptions) {
    this.agentForMember = options.agentForMember
    this.targetsForMember = options.targetsForMember
    this.sessionLogForMember = options.sessionLogForMember
    this.log = options.log
    this.scheduleSteer = options.scheduleSteer ?? (run => { queueMicrotask(run) })
    this.progressThresholdStart = options.progressThresholdStart ?? PROGRESS_NUDGE_TOOL_CALLS_START
    this.progressThresholdStep = options.progressThresholdStep ?? PROGRESS_NUDGE_TOOL_CALLS_STEP
    this.claimSuggestionThreshold = options.claimSuggestionThreshold ?? CLAIM_SUGGESTION_TOOL_CALLS
  }

  /**
   * One live session event for a Member, in its real `{type, seq, time, data}`
   * envelope. Only `tool/call` counts toward silence; a `user/message` whose
   * source is exactly this module's own notice records that the model consumed
   * the nudge (a Claim suggestion becomes final only then). The live `agent`
   * is passed in by the caller because it exists at event time even before
   * the Host finishes publishing the handle.
   */
  onSessionEvent(memberId: AgentTeamMemberId, sessionId: SessionId, agent: ProgressNudgeAgent, event: SessionEvent): void {
    if (event.type === 'user/message') {
      if (!isProgressNudgeNotice(event.data)) return
      const state = this.members.get(memberId)
      if (state === undefined) return
      const notice = state.pending
      if (notice !== undefined && notice.messageId === event.data.id) state.pending = undefined
      for (const threadRef of claimTargetThreadRefs(event.data)) state.claimSuggested.add(threadRef)
      return
    }
    if (event.type !== 'tool/call') return
    let state = this.members.get(memberId)
    if (state === undefined || state.sessionId !== sessionId) {
      // First event of this Member Session (or a generation the Host did not
      // stop explicitly): fresh tracking replaces whatever was there, and
      // consumed one-time suggestions are recovered from the durable log so a
      // Host restart or suspend/resume within the same Session cannot repeat
      // them. A Human-initiated new Session has a different id and starts
      // empty, exactly as specified.
      this.dropState(memberId, state)
      state = { sessionId, silentToolCalls: 0, nextProgressThreshold: this.progressThresholdStart,
        claimSuggested: this.recoverClaimSuggestions(memberId, sessionId), }
      this.members.set(memberId, state)
    }
    state.silentToolCalls += 1
    if (state.lastNudgeTurn === event.data.turn) return
    this.maybeNudge(memberId, state, agent, event.data.turn)
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

  /** Rebuild the consumed one-time suggestion set from this Session's durable log. */
  private recoverClaimSuggestions(memberId: AgentTeamMemberId, sessionId: SessionId): Set<AgentTeamThreadRef> {
    const suggested = new Set<AgentTeamThreadRef>()
    const log = this.sessionLogForMember(memberId, sessionId)
    if (log === undefined) return suggested
    for (const event of log.events) {
      if (event.type !== 'user/message') continue
      if (!isProgressNudgeNotice(event.data)) continue
      for (const threadRef of claimTargetThreadRefs(event.data)) suggested.add(threadRef)
    }
    return suggested
  }

  private dropState(memberId: AgentTeamMemberId, state: MemberNudgeState | undefined): void {
    if (state === undefined) return
    this.revokePending(memberId, state)
    this.members.delete(memberId)
  }

  private revokePending(memberId: AgentTeamMemberId, state: MemberNudgeState): void {
    const notice = state.pending
    if (notice !== undefined) {
      notice.canceled = true
      if (notice.steered) {
        const agent = this.agentForMember(memberId)
        const pending = agent === undefined ? undefined
          : [...agent.inbox.nextStep, ...agent.inbox.nextTurn].find(message => message.id === notice.messageId)
        // A just-consumed notice is simply gone; remove() returning false is expected.
        if (pending !== undefined) agent!.inbox.remove(pending.id)
      }
    }
    state.pending = undefined
  }

  /** Re-check every live Member's pending notice against the targets it actually listed. */
  private reconcileAll(): void {
    for (const [memberId, state] of this.members) {
      const notice = state.pending
      if (notice === undefined) continue
      const agent = this.agentForMember(memberId)
      if (agent === undefined) {
        this.dropState(memberId, state)
        continue
      }
      const targets = this.targetsForMember(memberId)
      // The notice is stale when ANY target it listed is no longer eligible:
      // the body names threads whose work may be finished, so a partial
      // survival must not keep the whole stale notice alive.
      const progressAlive = notice.progressThreadRefs.length === 0
        || notice.progressThreadRefs.every(threadRef => targets.progress.some(target => target.threadRef === threadRef))
      const claimAlive = notice.claimThreadRefs.length === 0
        || notice.claimThreadRefs.every(threadRef => targets.claim.some(target => target.threadRef === threadRef))
      if (!progressAlive || !claimAlive) this.revokePending(memberId, state)
    }
  }

  private maybeNudge(memberId: AgentTeamMemberId, state: MemberNudgeState, agent: ProgressNudgeAgent, turn: number): void {
    const targets = this.targetsForMember(memberId)
    const progressDue = state.silentToolCalls >= state.nextProgressThreshold && targets.progress.length > 0
    const freshClaimTargets = targets.claim
      .filter(target => !state.claimSuggested.has(target.threadRef) && state.pending?.claimThreadRefs.includes(target.threadRef) !== true)
    const claimDue = state.silentToolCalls >= this.claimSuggestionThreshold && freshClaimTargets.length > 0
    if (!progressDue && !claimDue) return
    if (this.hasBlockingNotice(agent)) return
    const progressTargets = progressDue ? targets.progress : []
    const claimTargets = claimDue ? freshClaimTargets : []
    const notice = createUserMessage({
      content: [{ type: 'text', text: nudgeNoticeText(state.silentToolCalls, progressTargets, claimTargets) }],
      source: { kind: 'plugin', plugin: PROGRESS_NUDGE_PLUGIN_ID, form: 'notice', summary: PROGRESS_NUDGE_NOTICE_SUMMARY },
    })
    const pending: PendingNotice = {
      messageId: notice.id,
      progressThreadRefs: progressTargets.map(target => target.threadRef),
      claimThreadRefs: claimTargets.map(target => target.threadRef),
      steered: false,
      canceled: false,
    }
    // Record intent first: the scheduled steer, its cancellation check, and
    // its failure handling all live on this single PendingNotice object, so a
    // revoke between queueing and the microtask leaves no orphan injection.
    // lastNudgeTurn stays as the same-turn intent guard, but the A threshold
    // only commits after the real steer succeeds — a canceled or failed
    // schedule leaves the rung due so the next tool call retries it.
    state.pending = pending
    state.lastNudgeTurn = turn
    this.scheduleSteer(() => {
      if (pending.canceled) return
      try {
        agent.steer(notice)
      } catch (error) {
        this.log?.(`progress nudge steer failed for member '${memberId}': ${error instanceof Error ? error.message : String(error)}`)
        pending.canceled = true
        if (state.pending === pending) state.pending = undefined
        this.stopTracking(memberId)
        return
      }
      pending.steered = true
      if (pending.progressThreadRefs.length > 0) {
        // Advance the ladder past the count at real success in one move: a
        // long silence held back by higher-priority notices must not replay
        // every skipped rung on successive tool calls after the blocker
        // clears.
        while (state.nextProgressThreshold <= state.silentToolCalls) state.nextProgressThreshold += this.progressThresholdStep
      }
    })
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
