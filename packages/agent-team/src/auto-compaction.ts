import type { Agent } from '@deepseek-ai/dsh-agent'
import { ManualCompactionError, type CompactionEngine } from '@deepseek-ai/dsh-compaction'
import type {} from '@deepseek-ai/dsh-token-meter'
import type {} from '@deepseek-ai/dsh-compaction'
import type { AgentTeamMemberId, AgentTeamOperation } from './types.ts'

/** Strict threshold: 200K exactly does not compact. */
export const AUTO_COMPACTION_TOKEN_LIMIT = 200_000

/** Claim owners of a durable Human acceptance, including early-completed ones. */
export function acceptedTaskCompactionMembers(operation: AgentTeamOperation): readonly AgentTeamMemberId[] | undefined {
  if (operation.kind !== 'team/task-changed' || operation.actor.kind !== 'human' || operation.data.activity.kind !== 'accept') return undefined
  return [...new Set(operation.data.claims.map(claim => claim.owner))]
}

/**
 * Small Host-side accepted-Task follow-up. This is deliberately not a generic
 * workflow/state-machine: a pending set deduplicates Members, an error map is
 * owned by the Host, and each worker is only whenIdle → measure → compactNow.
 */
export class AutoCompactionCoordinator {
  private readonly pending = new Set<AgentTeamMemberId>()
  private readonly workers = new Map<AgentTeamMemberId, Promise<void>>()
  private readonly controller = new AbortController()

  constructor(private readonly options: {
    readonly agentForMember: (memberId: AgentTeamMemberId) => Agent | undefined
    readonly compactionForAgent: (agent: Agent) => CompactionEngine | undefined
    readonly failed: (memberId: AgentTeamMemberId, sessionId: Agent['id'], diagnostic: string) => void
    readonly cleared: (memberId: AgentTeamMemberId, sessionId: Agent['id']) => void
    readonly log: (message: string) => void
  }) {}

  /** Queue all unique claim owners; unavailable Members stay pending. */
  schedule(memberIds: readonly AgentTeamMemberId[]): void {
    for (const memberId of new Set(memberIds)) {
      this.pending.add(memberId)
      this.start(memberId)
    }
  }

  /** Activation/recovery calls this after a live handle becomes available. */
  activated(memberId: AgentTeamMemberId): void {
    this.start(memberId)
  }

  async dispose(): Promise<void> {
    this.controller.abort()
    await Promise.all([...this.workers.values()].map(worker => worker.catch(() => {})))
    this.workers.clear()
    this.pending.clear()
  }

  private start(memberId: AgentTeamMemberId): void {
    if (this.controller.signal.aborted || this.workers.has(memberId) || !this.pending.has(memberId)) return
    // No live handle is not a failure: member activation/recovery calls activated().
    if (this.options.agentForMember(memberId) === undefined) return
    const worker = this.work(memberId).finally(() => { this.workers.delete(memberId) })
    this.workers.set(memberId, worker)
  }

  private async work(memberId: AgentTeamMemberId): Promise<void> {
    while (!this.controller.signal.aborted && this.pending.has(memberId)) {
      const agent = this.options.agentForMember(memberId)
      if (agent === undefined) return
      try {
        if (!(await waitForIdleOrAbort(agent, this.controller.signal))) return
      } catch (error) {
        this.fail(memberId, agent, `automatic compaction idle wait failed: ${describe(error)}`)
        return
      }
      // A restart can replace the handle while it waited; restart the turn on
      // the current agent so measurement and compactNow share one scope.
      if (this.options.agentForMember(memberId) !== agent) continue
      const meter = agent.ctx.get('tokenMeter')
      if (meter === undefined) {
        this.fail(memberId, agent, 'automatic compaction failed: tokenMeter is unavailable in the Member scope')
        return
      }
      const before = meter.measure(agent.session).totalTokens
      if (before <= AUTO_COMPACTION_TOKEN_LIMIT) {
        this.complete(memberId, agent)
        return
      }
      const engine = this.options.compactionForAgent(agent)
      if (engine === undefined) {
        this.fail(memberId, agent, 'automatic compaction failed: compaction is unavailable in the Member scope')
        return
      }
      try {
        const result = await engine.compactNow(agent, this.controller.signal)
        if (this.controller.signal.aborted) return
        if (result === null) {
          this.fail(memberId, agent, `automatic compaction returned no compactable range above ${AUTO_COMPACTION_TOKEN_LIMIT} tokens`)
          return
        }
      } catch (error) {
        if (this.controller.signal.aborted) return
        if (error instanceof ManualCompactionError && error.code === 'busy') continue
        this.fail(memberId, agent, `automatic compaction failed: ${describe(error)}`)
        return
      }
      const after = meter.measure(agent.session).totalTokens
      if (after >= before) {
        this.fail(memberId, agent, `automatic compaction did not reduce context (${before} → ${after} tokens)`)
        return
      }
      this.options.cleared(memberId, agent.id)
      // Still over the strict threshold: next iteration waits at a fresh idle
      // boundary before attempting another compactNow.
    }
  }

  private complete(memberId: AgentTeamMemberId, agent: Agent): void {
    this.pending.delete(memberId)
    this.options.cleared(memberId, agent.id)
  }

  private fail(memberId: AgentTeamMemberId, agent: Agent, diagnostic: string): void {
    this.pending.delete(memberId)
    this.options.log(`${diagnostic} (member ${memberId}, session ${agent.id})`)
    this.options.failed(memberId, agent.id, diagnostic)
  }
}

/** Abortable idle wait; the Agent owns its idle promise and is never cancelled. */
function waitForIdleOrAbort(agent: Agent, signal: AbortSignal): Promise<boolean> {
  const idle = agent.whenIdle()
  if (signal.aborted) {
    // The agent may settle or reject after teardown; keep that late outcome
    // observed without making it a coordinator failure.
    void idle.catch(() => {})
    return Promise.resolve(false)
  }
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (outcome: 'idle' | 'aborted' | 'error', error?: unknown): void => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      if (outcome === 'error') reject(error)
      else resolve(outcome === 'idle')
    }
    const onAbort = (): void => { finish('aborted') }
    signal.addEventListener('abort', onAbort, { once: true })
    idle.then(() => { finish('idle') }, error => { finish('error', error) })
  })
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
