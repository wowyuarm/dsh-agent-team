/**
 * Context-management coordinator: the one deep module that turns a Member's
 * successful `new_context` tool result into its next private context
 * generation.
 *
 * Authority split (see docs/architecture.md):
 * - the Team ledger owns the Member→Session binding and rollover audit;
 * - the Session log projection owns intent, checkpoints, and delivery state;
 * - this coordinator owns only process locks and is always reconstructible.
 *
 * The coordinator reacts exclusively after the successful `tool/result` is
 * durably appended — never inside a tool body — so a render/finalize failure
 * can never outrun result durability. The actual swap waits for the
 * containing turn to end and the Agent to be idle, captures later input so no
 * old-generation model request opens, and then reuses the Member lifecycle:
 * commit rollover operation → dispose old Agent → archive old Session →
 * create/activate the new generation → deliver the handoff first.
 * @module @wowyuarm/dsh-agent-team/context-management
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import { SessionId as SessionIdBrand } from '@deepseek-ai/dsh-session'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { createHandoffMessage, isCheckpointContinuationMessage } from './context-source.ts'
import {
  CONTEXT_CHECKPOINT_TOOL_NAME,
  NEW_CONTEXT_TOOL_NAME,
  continuationDelivered,
  foldContextProjection,
  withScheduledContinuation,
  type AgentTeamContextProjectionState,
} from './context-projection.ts'
import type { AgentTeamAgentMember, AgentTeamMemberId, AgentTeamRolloverSessionRequest } from './types.ts'

/** Plugin identity of the Agent Team Host, for recognizing own notices. */
const AGENT_TEAM_PLUGIN_ID = '@wowyuarm/dsh-agent-team'

/** Stable summary of the one-shot rollover pressure notice (ticket 03 wires delivery). */
export const CONTEXT_PRESSURE_NOTICE_SUMMARY = 'Context pressure: prepare a handoff'

/** One Member's in-process rollover bookkeeping; locks/promises only, never facts. */
interface MemberTransition {
  /** The Agent generation whose successful tool result is pending. */
  readonly agent: Agent
  /** Result seq and handoff envelope from the projection at intent time. */
  readonly intent: {
    readonly toolCallId: string
    readonly resultSeq: number
    readonly turn: number
    readonly handoff: string
    readonly checkpointRef?: string | undefined
    readonly relatedFiles: readonly { readonly path: string; readonly reason: string }[]
  }
  /** Set once the containing turn ended; the swap then waits for idle. */
  turnEnded: boolean
  /** The in-flight swap promise; a second intent while swapping is rejected at the tool. */
  swapping?: Promise<void>
}

export interface ContextManagementCoordinatorOptions {
  /** Resolve the live Agent of one Member; undefined leaves intent parked. */
  readonly agentForMember: (memberId: AgentTeamMemberId) => Agent | undefined
  /** Resolve the durable Member of one live Agent. */
  readonly memberForAgent: (agent: Agent) => AgentTeamAgentMember | undefined
  /** Fold one Member Session's projection state from its durable events. */
  readonly projectionForMember: (memberId: AgentTeamMemberId, sessionId: SessionId) => AgentTeamContextProjectionState | undefined
  /**
   * Execute one prepared Member generation swap at a true idle boundary:
   * commit, dispose, archive, create/activate, deliver the handoff first,
   * then carried input and the rederived Inbox. Returns once the Member runs
   * its new generation.
   */
  readonly executeTransition: (memberId: AgentTeamMemberId, plan: TransitionPlan) => Promise<void>
  /** Log one coordinator diagnostic. */
  readonly log: (message: string) => void
}

/** Everything the lifecycle needs to perform one rollover. */
export interface TransitionPlan {
  readonly previousSessionId: SessionId
  readonly newSessionId: SessionId
  readonly handoff: string
  readonly handoffEventSeq: number
  readonly trigger: 'model' | 'pressure'
  readonly relatedFiles: readonly { readonly path: string; readonly reason: string }[]
  readonly checkpointRef?: string | undefined
  readonly requestId: AgentTeamRolloverSessionRequest['requestId']
  /** Non-Team input that arrived during the transition, delivered after the handoff. */
  readonly carriedInput: readonly UserMessage[]
}

export class ContextManagementCoordinator {
  private readonly members = new Map<AgentTeamMemberId, MemberTransition>()
  private readonly capturedInput = new Map<AgentTeamMemberId, readonly UserMessage[]>()
  private disposed = false

  constructor(private readonly options: ContextManagementCoordinatorOptions) {}

  /** Whether one Member has a pending or in-flight rollover; tools use this to reject. */
  isTransitioning(memberId: AgentTeamMemberId): boolean {
    return this.members.has(memberId)
  }

  /**
   * Root `session/event` observer for Member Sessions. The store's dispatch
   * carrier is untagged, so the Host maps session ids to Members and calls
   * this for every Member event. All reactions are gated on the projection
   * state, which itself only records successful durable pairs.
   */
  onSessionEvent(memberId: AgentTeamMemberId, agent: Agent, event: SessionEvent): void {
    if (this.disposed) return
    if (event.type === 'tool/result') {
      this.onToolResult(memberId, agent, event)
      return
    }
    if (event.type === 'user/message') {
      this.onUserMessage(memberId, agent, event)
      return
    }
    if (event.type === 'turn/end') {
      this.onTurnEnd(memberId, agent)
    }
  }

  /** Build the first handoff message of one generation; the lifecycle delivers it. */
  handoffMessageFor(plan: TransitionPlan): UserMessage {
    return createHandoffMessage({
      handoff: plan.handoff,
      previousSessionId: plan.previousSessionId,
      newSessionId: plan.newSessionId,
      trigger: plan.trigger,
      handoffEventSeq: plan.handoffEventSeq,
      ...(plan.checkpointRef === undefined ? {} : { checkpointRef: plan.checkpointRef }),
      ...(plan.relatedFiles.length === 0 ? {} : { relatedFiles: plan.relatedFiles }),
    })
  }

  /**
   * Whether one Agent's pending transition requires the admission gate: a
   * pending rollover must stop old-generation turns from admitting queued
   * input. The gate arms only for the old-generation Agent instance — the
   * new generation activates mid-swap and must be free to consume the
   * handoff and carried input immediately.
   */
  needsAdmissionGate(agent: Agent): boolean {
    const memberId = this.options.memberForAgent(agent)?.memberId
    if (memberId === undefined) return false
    return this.members.get(memberId)?.agent === agent
  }

  /**
   * Capture the inbox messages queued for an old generation at its turn-stop
   * boundary: non-Team input is preserved verbatim for delivery after the
   * handoff; stale Team notices are dropped because the new generation
   * rederives the Inbox from ledger facts. Removing them from the inbox lets
   * the turn close cleanly instead of admitting another old-generation step.
   */
  captureQueuedInput(agent: Agent): readonly UserMessage[] {
    const memberId = this.options.memberForAgent(agent)?.memberId
    if (memberId === undefined) return []
    if (this.members.get(memberId)?.agent !== agent) return []
    const removed = [...agent.inbox.nextStep, ...agent.inbox.nextTurn]
    for (const message of removed) agent.inbox.remove(message.id)
    return this.captureInput(agent, removed)
  }

  /**
   * Capture messages a racing pre-step already claimed from the inbox before
   * rejecting that old-generation step. A rejected step's claimed message is
   * otherwise neither discarded nor re-emitted, so the gate preserves it here.
   */
  captureClaimedInput(agent: Agent, messages: readonly UserMessage[]): readonly UserMessage[] {
    return this.captureInput(agent, messages)
  }

  private captureInput(agent: Agent, messages: readonly UserMessage[]): readonly UserMessage[] {
    const memberId = this.options.memberForAgent(agent)?.memberId
    if (memberId === undefined) return []
    if (this.members.get(memberId)?.agent !== agent) return []
    const preserved: UserMessage[] = []
    for (const message of messages) {
      if (this.isTeamNotice(message)) continue
      preserved.push(message)
    }
    if (preserved.length > 0) this.capturedInput.set(memberId, [...(this.capturedInput.get(memberId) ?? []), ...preserved])
    return preserved
  }

  /** Drain the captured input of one Member for delivery after the handoff. */
  drainCapturedInput(memberId: AgentTeamMemberId): readonly UserMessage[] {
    const captured = this.capturedInput.get(memberId) ?? []
    this.capturedInput.delete(memberId)
    return captured
  }

  /** Whether one queued message is a Team-owned notice the rederived Inbox replaces. */
  private isTeamNotice(message: UserMessage): boolean {
    const source = message.source
    return source.kind === 'plugin' && source.plugin === AGENT_TEAM_PLUGIN_ID
  }

  /** Drop one Member's bookkeeping; the Host calls this on dispose/removal. */
  stopTracking(memberId: AgentTeamMemberId): void {
    this.members.delete(memberId)
    this.capturedInput.delete(memberId)
  }

  dispose(): void {
    this.disposed = true
    this.members.clear()
    this.capturedInput.clear()
  }

  private onToolResult(memberId: AgentTeamMemberId, agent: Agent, event: SessionEvent & { type: 'tool/result' }): void {
    if (event.data.error !== undefined) return
    const member = this.options.memberForAgent(agent)
    if (member === undefined) return
    const state = this.options.projectionForMember(memberId, member.sessionId)
    if (state?.pending === null || state === undefined) return
    const pending = state.pending
    // React only to the intent's own result landing durably, and only once.
    if (pending.resultSeq !== event.seq) return
    if (this.members.has(memberId)) return
    this.members.set(memberId, {
      agent,
      intent: {
        toolCallId: pending.toolCallId,
        resultSeq: pending.resultSeq,
        turn: pending.turn,
        handoff: pending.handoff,
        ...(pending.checkpointRef === undefined ? {} : { checkpointRef: pending.checkpointRef }),
        relatedFiles: pending.relatedFiles,
      },
      turnEnded: false,
    })
  }

  private onUserMessage(memberId: AgentTeamMemberId, _agent: Agent, event: SessionEvent & { type: 'user/message' }): void {
    // Quiet-continuation delivery bookkeeping is projection-owned; the
    // coordinator only repairs a crash gap after restart, which the Host
    // performs through repairContinuations during activation.
    void memberId
    void event
  }

  private onTurnEnd(memberId: AgentTeamMemberId, agent: Agent): void {
    const transition = this.members.get(memberId)
    if (transition === undefined || transition.turnEnded) return
    const member = this.options.memberForAgent(agent)
    if (member === undefined || transition.agent !== agent) return
    transition.turnEnded = true
    // Wait for true idle (the turn-end event fires before the driver fully
    // converges), then perform the swap off the session-event dispatch path.
    void agent.whenIdle().then(() => {
      if (this.disposed) return
      const current = this.members.get(memberId)
      if (current === undefined || current !== transition) return
      if (this.options.agentForMember(memberId) !== agent) return
      void this.performTransition(memberId, member, transition)
    }, error => {
      this.options.log(`context rollover idle wait failed: ${error instanceof Error ? error.message : String(error)} (member ${memberId})`)
      this.members.delete(memberId)
    })
  }

  private async performTransition(memberId: AgentTeamMemberId, member: AgentTeamAgentMember, transition: MemberTransition): Promise<void> {
    // Stable rollover identity derives from the previous Session and the
    // successful tool call id: a result seq is session-local and would
    // collide across generations. The derived id is url-safe and bounded.
    const stableKey = `${member.sessionId}:${transition.intent.toolCallId}`.replaceAll(':', '-')
    const newSessionId = SessionIdBrand(`agent-team-rollover-${stableKey}`)
    const plan: TransitionPlan = {
      previousSessionId: member.sessionId,
      newSessionId,
      handoff: transition.intent.handoff,
      handoffEventSeq: transition.intent.resultSeq,
      trigger: 'model',
      relatedFiles: transition.intent.relatedFiles,
      ...(transition.intent.checkpointRef === undefined ? {} : { checkpointRef: transition.intent.checkpointRef }),
      requestId: `agent-team:rollover:${stableKey}` as AgentTeamRolloverSessionRequest['requestId'],
      carriedInput: this.drainCapturedInput(memberId),
    }
    const swap = this.options.executeTransition(memberId, plan)
    transition.swapping = swap
    try {
      await swap
      this.members.delete(memberId)
    } catch (error) {
      this.options.log(`context rollover failed, leaving the previous generation recoverable: ${error instanceof Error ? error.message : String(error)} (member ${memberId})`)
      this.members.delete(memberId)
    }
  }

  /**
   * Crash-recovery hook the Host runs during Member activation: re-derive
   * pending intent from the projection and finish a transition that a restart
   * interrupted after the successful result was durable.
   */
  recoverPendingTransition(memberId: AgentTeamMemberId, agent: Agent, sessionId: SessionId): void {
    if (this.disposed || this.members.has(memberId)) return
    const state = this.options.projectionForMember(memberId, sessionId)
    if (state?.pending === null || state === undefined) return
    const pending = state.pending
    if (pending.turnEndSeq === -1) {
      // The containing turn never ended durably; treat the intent as still
      // waiting and observe the live events from here.
      this.members.set(memberId, {
        agent,
        intent: {
          toolCallId: pending.toolCallId,
          resultSeq: pending.resultSeq,
          turn: pending.turn,
          handoff: pending.handoff,
          ...(pending.checkpointRef === undefined ? {} : { checkpointRef: pending.checkpointRef }),
          relatedFiles: pending.relatedFiles,
        },
        turnEnded: false,
      })
      return
    }
    // The turn already ended before the crash; the Agent is idle at
    // activation, so the swap can proceed directly.
    const member = this.options.memberForAgent(agent)
    if (member === undefined) return
    const transition: MemberTransition = {
      agent,
      intent: {
        toolCallId: pending.toolCallId,
        resultSeq: pending.resultSeq,
        turn: pending.turn,
        handoff: pending.handoff,
        ...(pending.checkpointRef === undefined ? {} : { checkpointRef: pending.checkpointRef }),
        relatedFiles: pending.relatedFiles,
      },
      turnEnded: true,
    }
    this.members.set(memberId, transition)
    void this.performTransition(memberId, member, transition)
  }

  /**
   * Crash-recovery for quiet continuations: schedule the follow-up for one
   * resolved checkpoint exactly once when the result was durable but the
   * delivery never landed.
   */
  repairContinuations(agent: Agent, state: AgentTeamContextProjectionState): void {
    if (this.disposed) return
    for (const checkpoint of state.checkpoints) {
      if (checkpoint.turnEndSeq === -1) continue
      if (continuationDelivered(state, checkpoint.checkpointRef)) continue
      let next = withScheduledContinuation(state, checkpoint.checkpointRef)
      void next
      const message = { source: { kind: 'agent-team-context-continuation' } } as UserMessage
      if (!isCheckpointContinuationMessage(message, checkpoint.checkpointRef)) continue
      try {
        agent.followup(message)
      } catch (error) {
        this.options.log(`context continuation repair failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
}

/** Tool names this module owns; the preset validation requires all of them. */
export const CONTEXT_TOOL_NAMES = Object.freeze([CONTEXT_CHECKPOINT_TOOL_NAME, NEW_CONTEXT_TOOL_NAME] as const)

/** Re-exported for Host wiring: cold-fold helper for archived ancestors. */
export { foldContextProjection }
