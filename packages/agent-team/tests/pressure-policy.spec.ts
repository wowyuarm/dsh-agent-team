import { describe, expect, it } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { CONTEXT_WINDOW_EXCEEDED_CODE } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CompactionEngine, CompactionResult } from '@deepseek-ai/dsh-compaction'
import { contextPressureNoticeText, PressurePolicyCoordinator } from '../src/pressure-policy.ts'
import { CONTEXT_PRESSURE_NOTICE_SUMMARY } from '../src/context-management.ts'

/** One controllable fake agent exposing exactly what the policy reads. */
function fakeAgent(options?: { readonly replaceGeneration?: number }): {
  readonly agent: Agent
  readonly steer: { readonly messages: unknown[] }
  readonly surface: { replaceGeneration: number }
  /** Own-event log of this fake generation; steer appends the durable notice. */
  readonly ownEvents: { type: string; data: { source?: { plugin?: string; summary?: string } } }[]
  /** Replace the generation: a fresh Session starts with an empty own span. */
  readonly newGeneration: () => void
} {
  const steer = { messages: [] as unknown[] }
  const surface = { replaceGeneration: options?.replaceGeneration ?? 0 }
  let ownEvents: { type: string; data: { source?: { plugin?: string; summary?: string } } }[] = []
  const agent = {
    id: 'session:test',
    ctx: { get: (name: string) => (name === 'tokenMeter' ? { measure: () => ({ totalTokens: 0 }) } : undefined) },
    session: { surface, snapshotEvents: () => [], ownEvents: () => ownEvents },
    steer: (message: unknown) => {
      steer.messages.push(message)
      const source = (message as { source?: { plugin?: string; summary?: string } }).source
      if (source?.summary !== undefined) ownEvents.push({ type: 'user/message', data: { source } })
    },
  } as unknown as Agent
  return { agent, steer, surface, ownEvents: ownEvents as never, newGeneration: () => { ownEvents = [] } }
}

/** A configurable fake engine recording calls and advancing the surface. */
function fakeEngine(behavior: 'advance' | 'noop' | 'throw' | 'reduce'): { readonly engine: CompactionEngine; readonly calls: string[] } {
  const calls: string[] = []
  const engine = {
    compactIfNeeded: async (agent: Agent, trigger: string): Promise<CompactionResult | null> => {
      calls.push(trigger)
      if (behavior === 'throw') throw new Error('engine failure')
      if (behavior === 'advance') {
        ;(agent.session.surface as { replaceGeneration: number }).replaceGeneration += 1
        return null
      }
      return null
    },
    compactNow: async () => null,
    compactRegion: async () => { throw new Error('unused') },
  } as unknown as CompactionEngine
  return { engine, calls }
}

function coordinator(options?: {
  readonly engineBehavior?: 'advance' | 'noop' | 'throw' | 'reduce'
  readonly limits?: { usageTokens: number; hardLimit: number; handoffAt: number } | undefined
  readonly failures?: string[]
  readonly steered?: unknown[]
}): { policy: PressurePolicyCoordinator; engine: ReturnType<typeof fakeEngine>; steered: unknown[] } {
  const engine = fakeEngine(options?.engineBehavior ?? 'advance')
  const steered = options?.steered ?? []
  const policy = new PressurePolicyCoordinator({
    agentForMember: () => undefined,
    memberForAgent: agent => ({ memberId: 'member:test' as never, sessionId: agent.id }),
    compactionForAgent: () => engine.engine,
    limitsForAgent: () => options?.limits,
    activeClaimLabels: () => ['claim:a (do it)'],
    runningJobLabels: () => [],
    failed: (_memberId, _sessionId, diagnostic) => { options?.failures?.push(diagnostic) },
    log: () => {},
  })
  return { policy, engine, steered: steered as unknown[] }
}

describe('Agent Team pressure policy (ticket 03)', () => {
  it('below the handoff budget produces no notice and no compaction', async () => {
    const { policy } = coordinator({ limits: { usageTokens: 150_000, hardLimit: 256_000, handoffAt: 200_000 } })
    const { agent } = fakeAgent()
    const decision = await policy.onPreStep(agent, new AbortController().signal)
    expect(decision.kind).toBe('continue')
  })

  it('at the handoff budget one structured notice is steered once per generation', async () => {
    const steered: unknown[] = []
    const { policy } = coordinator({ limits: { usageTokens: 200_000, hardLimit: 256_000, handoffAt: 200_000 }, steered })
    const { agent, steer, newGeneration } = fakeAgent()
    const first = await policy.onPreStep(agent, new AbortController().signal)
    expect(first.kind).toBe('notice')
    expect(steer.messages).toHaveLength(1)
    const notice = steer.messages[0] as ReturnType<typeof createUserMessage>
    expect(notice.source).toMatchObject({ kind: 'plugin', form: 'notice', summary: CONTEXT_PRESSURE_NOTICE_SUMMARY })
    expect((notice.content[0] as { text: string }).text).toContain('200000')
    expect((notice.content[0] as { text: string }).text).toContain('claim:a')
    // Later steps in the same generation do not repeat the notice: the
    // delivered notice in this Session's own events is the durable latch.
    const second = await policy.onPreStep(agent, new AbortController().signal)
    expect(second.kind).toBe('continue')
    expect(steer.messages).toHaveLength(1)
    // A fresh generation (a new Session with an empty own event span) is
    // itself the re-arm: the notice fires once for the new generation.
    newGeneration()
    const third = await policy.onPreStep(agent, new AbortController().signal)
    expect(third.kind).toBe('notice')
    expect(steer.messages).toHaveLength(2)
  })

  it('a delivered notice in the Session log latches across coordinator restarts', async () => {
    const steered: unknown[] = []
    const first = coordinator({ limits: { usageTokens: 200_000, hardLimit: 256_000, handoffAt: 200_000 }, steered })
    const { agent, steer, newGeneration } = fakeAgent()
    await first.policy.onPreStep(agent, new AbortController().signal)
    expect(steer.messages).toHaveLength(1)
    // Host restart: a fresh coordinator over the same replayed Session log.
    const second = coordinator({ limits: { usageTokens: 200_000, hardLimit: 256_000, handoffAt: 200_000 }, steered })
    const resumed = await second.policy.onPreStep(agent, new AbortController().signal)
    expect(resumed.kind).toBe('continue')
    expect(steer.messages).toHaveLength(1)
    // And a genuinely fresh generation still re-arms.
    newGeneration()
    const fresh = await second.policy.onPreStep(agent, new AbortController().signal)
    expect(fresh.kind).toBe('notice')
    expect(steer.messages).toHaveLength(2)
  })

  it('at the hard limit the request is forced through compaction before continuing', async () => {
    const failures: string[] = []
    const { policy, engine } = coordinator({ engineBehavior: 'advance', limits: { usageTokens: 256_000, hardLimit: 256_000, handoffAt: 200_000 }, failures })
    const { agent, surface } = fakeAgent()
    const decision = await policy.onPreStep(agent, new AbortController().signal)
    expect(decision.kind).toBe('continue')
    expect(engine.calls).toEqual(['context-overflow'])
    expect(surface.replaceGeneration).toBe(1)
    expect(failures).toEqual([])
  })

  it('a hard-limit compaction that no-ops fails closed and blocks the request', async () => {
    const failures: string[] = []
    const { policy, engine } = coordinator({ engineBehavior: 'noop', limits: { usageTokens: 256_000, hardLimit: 256_000, handoffAt: 200_000 }, failures })
    const { agent } = fakeAgent()
    const decision = await policy.onPreStep(agent, new AbortController().signal)
    expect(decision.kind).toBe('reject')
    expect(engine.calls).toEqual(['context-overflow'])
    expect(failures).toHaveLength(1)
    expect(failures[0]).toContain('blocked')
  })

  it('a hard-limit compaction that throws fails closed with a recoverable diagnostic', async () => {
    const failures: string[] = []
    const { policy } = coordinator({ engineBehavior: 'throw', limits: { usageTokens: 256_000, hardLimit: 256_000, handoffAt: 200_000 }, failures })
    const { agent } = fakeAgent()
    const decision = await policy.onPreStep(agent, new AbortController().signal)
    expect(decision.kind).toBe('reject')
    expect(failures[0]).toContain('engine failure')
  })

  it('missing route capacity rejects explicitly rather than running an unlimited policy', async () => {
    const failures: string[] = []
    const { policy } = coordinator({ limits: undefined, failures })
    const { agent } = fakeAgent()
    const decision = await policy.onPreStep(agent, new AbortController().signal)
    expect(decision.kind).toBe('reject')
    expect(failures[0]).toContain('unknown')
  })

  it('provider overflow compacts and retries once; a second overflow in the sequence falls through', async () => {
    const { policy, engine } = coordinator({ engineBehavior: 'advance' })
    const { agent } = fakeAgent()
    const first = await policy.onRequestError(agent, { code: CONTEXT_WINDOW_EXCEEDED_CODE }, new AbortController().signal)
    expect(first).toBe(true)
    expect(engine.calls).toEqual(['context-overflow'])
    // Same open sequence: no second retry.
    const second = await policy.onRequestError(agent, { code: CONTEXT_WINDOW_EXCEEDED_CODE }, new AbortController().signal)
    expect(second).toBe(false)
    expect(engine.calls).toHaveLength(1)
    // A successful assistant response re-arms the sequence.
    policy.onAssistantMessage(agent)
    const third = await policy.onRequestError(agent, { code: CONTEXT_WINDOW_EXCEEDED_CODE }, new AbortController().signal)
    expect(third).toBe(true)
  })

  it('overflow recovery that fails after durable prune progress still earns the single retry', async () => {
    const failures: string[] = []
    const policy = new PressurePolicyCoordinator({
      agentForMember: () => undefined,
      memberForAgent: agent => ({ memberId: 'member:test' as never, sessionId: agent.id }),
      compactionForAgent: () => {
        // The engine throws, but only after durable surface progress.
        const wrapper = {
          compactIfNeeded: async (agent: Agent): Promise<null> => {
            ;(agent.session.surface as { replaceGeneration: number }).replaceGeneration += 1
            throw new Error('summary failed after prune')
          },
        } as unknown as CompactionEngine
        return wrapper
      },
      limitsForAgent: () => ({ usageTokens: 1, hardLimit: 2, handoffAt: 1 }),
      activeClaimLabels: () => [],
      runningJobLabels: () => [],
      failed: (_m, _s, diagnostic) => { failures.push(diagnostic) },
      log: () => {},
    })
    const { agent } = fakeAgent()
    const retry = await policy.onRequestError(agent, { code: CONTEXT_WINDOW_EXCEEDED_CODE }, new AbortController().signal)
    expect(retry).toBe(true)
  })

  it('the pressure notice text stays concise and covers limits, claims, jobs, and the default action', () => {
    const text = contextPressureNoticeText({ usageTokens: 210_000, handoffAt: 200_000, hardLimit: 256_000, activeClaims: ['claim:a (unify forms)'], runningJobs: ['build'] })
    expect(text).toContain('210000')
    expect(text).toContain('200000')
    expect(text).toContain('256000')
    expect(text).toContain('claim:a (unify forms)')
    expect(text).toContain('1 running')
    expect(text).toContain('context_rollover')
    expect(text.length).toBeLessThan(1200)
  })
})
