/**
 * Team-owned context pressure policy.
 *
 * The Team preset mounts `compaction-basic` with `auto: false`; this
 * coordinator owns both policy entry points instead — the proactive handoff
 * notice near the effective handoff budget and the forced CompactionEngine
 * reduction before any request at or above the effective hard limit — while
 * reusing the public CompactionEngine implementation. The hard-limit
 * translation lives in exactly one method; no caller re-derives it.
 *
 * Fail-closed rule: at the hard limit, a compaction that no-ops, throws, is
 * cancelled, or does not advance the durable surface must block the model
 * request (reject the step) rather than knowingly submit over the Team limit.
 * A blocked Member keeps its log and reports a recoverable error.
 * @module @wowyuarm/dsh-agent-team/pressure-policy
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import { CONTEXT_WINDOW_EXCEEDED_CODE } from '@deepseek-ai/dsh-llm'
import type { CompactionEngine, CompactionResult } from '@deepseek-ai/dsh-compaction'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { AgentTeamMemberId } from './types.ts'
import { CONTEXT_PRESSURE_NOTICE_SUMMARY } from './context-management.ts'
import { AGENT_TEAM_PLUGIN_ID } from './context-source.ts'

/** One pressure-notice text; concise, structured, and inside the reserve. */
export function contextPressureNoticeText(input: {
  readonly usageTokens: number
  readonly handoffAt: number
  readonly hardLimit: number
  readonly activeClaims: readonly string[]
  readonly runningJobs: readonly string[]
}): string {
  const claims = input.activeClaims.length === 0 ? 'none' : input.activeClaims.join(', ')
  const jobs = input.runningJobs.length === 0 ? 'none' : `${input.runningJobs.length} running (collect or stop them before switching)`
  return [
    `Context pressure: ${input.usageTokens} tokens measured; the handoff budget is ${input.handoffAt} and the hard limit is ${input.hardLimit}.`,
    `Active Claims: ${claims}. Owner jobs: ${jobs}.`,
    'Finish the current atomic action, then call context_rollover with a handoff covering your objective, verified facts, and external side effects — a fresh context is the default path. Record anything durable in your private memory/notes first.',
  ].join(' ')
}

export interface PressurePolicyOptions {
  /** Resolve the live Agent of one Member. */
  readonly agentForMember: (memberId: AgentTeamMemberId) => Agent | undefined
  /** Resolve the durable Member of one live Agent. */
  readonly memberForAgent: (agent: Agent) => { readonly memberId: AgentTeamMemberId; readonly sessionId: Agent['id'] } | undefined
  /** Resolve the Member-scoped compaction engine. */
  readonly compactionForAgent: (agent: Agent) => CompactionEngine | undefined
  /** Effective budgets for one Member's current route; undefined means the route window is unknown. */
  readonly limitsForAgent: (agent: Agent) => Promise<{ readonly usageTokens: number; readonly hardLimit: number; readonly handoffAt: number } | undefined> | { readonly usageTokens: number; readonly hardLimit: number; readonly handoffAt: number } | undefined
  /** The model-visible active-Claim labels for one Member's notice. */
  readonly activeClaimLabels: (memberId: AgentTeamMemberId) => readonly string[]
  /** The model-visible running-job labels for one Member's notice. */
  readonly runningJobLabels: (memberId: AgentTeamMemberId) => readonly string[]
  /** Report a Member failure with a recoverable diagnostic. */
  readonly failed: (memberId: AgentTeamMemberId, sessionId: Agent['id'], diagnostic: string) => void
  /** Log one coordinator diagnostic. */
  readonly log: (message: string) => void
}

/** Whether one user message is this policy's one-shot pressure notice. */
function isPressureNotice(message: { readonly source?: unknown }): boolean {
  const source = message.source as { plugin?: string; summary?: string } | undefined
  return source?.plugin === AGENT_TEAM_PLUGIN_ID
    && source?.summary === CONTEXT_PRESSURE_NOTICE_SUMMARY
}

export class PressurePolicyCoordinator {
  /**
   * Retry budget per agent for the current provider-overflow sequence.
   * Process-only by design: a restart re-earns one sequence per chain.
   */
  private readonly overflowRetries = new Map<Agent, number>()
  private disposed = false

  constructor(private readonly options: PressurePolicyOptions) {}

  /**
   * The one-shot pressure notice is durable Session evidence, not process
   * state: a `CONTEXT_PRESSURE_NOTICE_SUMMARY` notice already surfaced as a
   * `user/message`, or still queued in a durable `agent/inbox/spliced`
   * insert (a steered notice surfaces only at the next step boundary, and a
   * Host restart replays the splice before surfacing), marks the current
   * generation as already notified. A resume or restart stays quiet; a
   * rollover starts a fresh Session whose own event span has no notice yet,
   * which is exactly the documented re-arm.
   */
  private noticeDelivered(agent: Agent): boolean {
    for (const event of agent.session.ownEvents()) {
      if (event.type === 'user/message' && isPressureNotice(event.data)) return true
      if (event.type === 'agent/inbox/spliced' && event.data.inserted.some(isPressureNotice)) return true
    }
    return false
  }

  dispose(): void {
    this.disposed = true
    this.overflowRetries.clear()
  }

  /** A successful assistant response ends any open overflow-recovery sequence. */
  onAssistantMessage(agent: Agent): void {
    this.overflowRetries.delete(agent)
  }

  /**
   * Pre-step policy for one Member agent: below the handoff budget nothing
   * happens; at the handoff budget one structured notice per generation is
   * steered into the running turn; at the hard limit the request is forced
   * through compaction first and fails closed when that cannot be proven.
   * Returns the decision for the step: `continue` forwards, `reject` blocks.
   */
  async onPreStep(agent: Agent, signal: AbortSignal): Promise<{ readonly kind: 'continue' | 'reject' | 'notice' }> {
    if (this.disposed || signal.aborted) return { kind: 'continue' }
    const member = this.options.memberForAgent(agent)
    if (member === undefined) return { kind: 'continue' }
    const limits = await this.options.limitsForAgent(agent)
    if (limits === undefined) {
      // A missing route capacity must be explicit, never an accidental
      // unlimited policy: reject the step with a recoverable diagnostic.
      const diagnostic = 'context pressure policy: the routed model capacity is unknown; refusing to forward a request without a bounded context budget'
      this.options.failed(member.memberId, member.sessionId, diagnostic)
      return { kind: 'reject' }
    }
    const { usageTokens, hardLimit, handoffAt } = limits
    if (usageTokens >= hardLimit) {
      const outcome = await this.enforceHardLimit(agent, member.memberId, member.sessionId, signal)
      return outcome ? { kind: 'continue' } : { kind: 'reject' }
    }
    if (usageTokens >= handoffAt && !this.noticeDelivered(agent)) {
      const notice = createUserMessage({
        content: [{ type: 'text', text: contextPressureNoticeText({
          usageTokens, handoffAt, hardLimit,
          activeClaims: this.options.activeClaimLabels(member.memberId),
          runningJobs: this.options.runningJobLabels(member.memberId),
        }) }],
        source: { kind: 'plugin', plugin: AGENT_TEAM_PLUGIN_ID, form: 'notice', summary: CONTEXT_PRESSURE_NOTICE_SUMMARY },
      })
      try {
        agent.steer(notice)
      } catch (error) {
        this.options.log(`context pressure notice failed: ${error instanceof Error ? error.message : String(error)} (member ${member.memberId})`)
      }
      return { kind: 'notice' }
    }
    return { kind: 'continue' }
  }

  /**
   * Provider-overflow recovery: one bounded compact-and-retry sequence per
   * open failure chain. Returns whether the request may retry once.
   */
  async onRequestError(agent: Agent, failure: { readonly code?: string }, signal: AbortSignal): Promise<boolean> {
    if (this.disposed || signal.aborted) return false
    if (failure.code !== CONTEXT_WINDOW_EXCEEDED_CODE) return false
    const member = this.options.memberForAgent(agent)
    if (member === undefined) return false
    const retries = this.overflowRetries.get(agent) ?? 0
    if (retries >= 1) return false
    const engine = this.options.compactionForAgent(agent)
    if (engine === undefined) return false
    const generation = agent.session.surface.replaceGeneration
    try {
      await engine.compactIfNeeded(agent, 'context-overflow', signal)
    } catch (error) {
      // Durable prune progress before a later summary failure justifies the
      // single retry; cancellation never does.
      if (!signal.aborted && agent.session.surface.replaceGeneration > generation) {
        this.overflowRetries.set(agent, retries + 1)
        return true
      }
      this.options.log(`context-overflow recovery failed: ${error instanceof Error ? error.message : String(error)} (member ${member.memberId})`)
      return false
    }
    if (signal.aborted || agent.session.surface.replaceGeneration <= generation) return false
    this.overflowRetries.set(agent, retries + 1)
    return true
  }

  /**
   * The one Team hard-limit translation: force a CompactionEngine reduction
   * in the current Agent/Session and prove it advanced the durable surface
   * (or measurably reduced pressure) before continuing. Background jobs are
   * untouched — compaction never cancels or discards them.
   * @returns whether the request may proceed.
   */
  private async enforceHardLimit(agent: Agent, memberId: AgentTeamMemberId, sessionId: Agent['id'], signal: AbortSignal): Promise<boolean> {
    const engine = this.options.compactionForAgent(agent)
    if (engine === undefined) {
      const diagnostic = 'context hard limit reached and compaction is unavailable in the Member scope; the request was blocked'
      this.options.failed(memberId, sessionId, diagnostic)
      return false
    }
    const meter = agent.ctx.get('tokenMeter')
    const before = meter?.measure(agent.session)?.totalTokens ?? Number.POSITIVE_INFINITY
    const generation = agent.session.surface.replaceGeneration
    let result: CompactionResult | null
    try {
      result = await engine.compactIfNeeded(agent, 'context-overflow', signal)
    } catch (error) {
      const diagnostic = `context hard limit compaction failed: ${error instanceof Error ? error.message : String(error)}; the request was blocked`
      this.options.failed(memberId, sessionId, diagnostic)
      return false
    }
    if (signal.aborted) return false
    const after = meter?.measure(agent.session)?.totalTokens ?? Number.POSITIVE_INFINITY
    const surfaceAdvanced = agent.session.surface.replaceGeneration > generation
    const pressureReduced = meter === undefined ? false : after < before
    if (!surfaceAdvanced && !pressureReduced) {
      // No-op or unchanged replacement generation: fail closed rather than
      // knowingly submit over the Team limit.
      const diagnostic = result === null
        ? 'context hard limit reached and no compactable range exists; the request was blocked'
        : 'context hard limit compaction produced no measurable reduction; the request was blocked'
      this.options.failed(memberId, sessionId, diagnostic)
      return false
    }
    return true
  }
}
