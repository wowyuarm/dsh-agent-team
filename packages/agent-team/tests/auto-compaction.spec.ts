import { describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { ManualCompactionError } from '@deepseek-ai/dsh-compaction'
import { SessionId } from '@deepseek-ai/dsh-session'
import { acceptedTaskCompactionMembers, AUTO_COMPACTION_TOKEN_LIMIT, AutoCompactionCoordinator, PRE_COMPACTION_NOTICE_SUMMARY, preCompactionNoticeText } from '../src/auto-compaction.ts'
import type { AgentTeamMemberId, AgentTeamTaskRef } from '../src/types.ts'

const memberId = 'member:builder' as AgentTeamMemberId
const taskRef = 'task:accepted' as AgentTeamTaskRef

/** The default steer callback shape the Host wires in index.ts. */
function hint() {
  return createUserMessage({
    content: [{ type: 'text', text: preCompactionNoticeText() }],
    source: { kind: 'plugin', plugin: '@wowyuarm/dsh-agent-team', form: 'notice', summary: PRE_COMPACTION_NOTICE_SUMMARY },
  })
}

function fixture(tokens: number, options: {
  readonly compact?: () => Promise<unknown>
  readonly whenIdle?: () => Promise<void>
  readonly meter?: boolean
  readonly engine?: boolean
  readonly available?: boolean
  readonly reactivate?: () => Promise<boolean>
  readonly steerPreCompaction?: (agent: Agent) => void
} = {}) {
  let available = options.available ?? true
  const measure = vi.fn(() => ({ totalTokens: tokens }))
  const compactNow = vi.fn(async () => {
    const result = await (options.compact?.() ?? Promise.resolve({}))
    return result as never
  })
  const cancel = vi.fn()
  const steer = vi.fn()
  const agent = {
    id: SessionId('session:builder'),
    session: {} as never,
    ctx: { get: (name: string) => name === 'tokenMeter' && options.meter !== false ? { measure } : name === 'compaction' && options.engine !== false ? { compactNow } : undefined },
    whenIdle: options.whenIdle ?? (async () => {}),
    cancel,
    steer,
  } as unknown as Agent
  let current = agent
  const errors: string[] = []
  const logs: string[] = []
  const cleared = vi.fn()
  const coordinator = new AutoCompactionCoordinator({
    agentForMember: id => id === memberId && available ? current : undefined,
    compactionForAgent: target => target.ctx.get('compaction'),
    reactivate: options.reactivate ?? (async () => false),
    failed: (_member, _session, diagnostic) => { errors.push(diagnostic) },
    cleared,
    log: message => { logs.push(message) },
    steerPreCompaction: options.steerPreCompaction ?? (target => { target.steer(hint()) }),
  })
  return {
    agent, cancel, cleared, compactNow, coordinator, errors, logs, measure, steer,
    setAvailable: (next: boolean) => { available = next },
    setTokens: (next: number) => { tokens = next },
    setAgent: (next: Agent) => { current = next },
  }
}

describe('accepted-task auto compaction coordinator', () => {
  it('selects all unique Claim owners for normal and early Human acceptance only', () => {
    const accepted = (completedClaimRefs?: readonly string[]) => ({
      kind: 'team/task-changed', actor: { kind: 'human' }, data: {
        activity: { kind: 'accept', completedClaimRefs }, task: { taskRef },
        claims: [{ owner: memberId }, { owner: 'member:reviewer' as AgentTeamMemberId }, { owner: memberId }],
      },
    }) as never
    expect(acceptedTaskCompactionMembers(accepted())).toEqual([memberId, 'member:reviewer'])
    expect(acceptedTaskCompactionMembers(accepted(['claim:early']))).toEqual([memberId, 'member:reviewer'])
    expect(acceptedTaskCompactionMembers({ kind: 'team/task-changed', actor: { kind: 'member' }, data: { activity: { kind: 'accept' } } } as never)).toBeUndefined()
    expect(acceptedTaskCompactionMembers({ kind: 'team/task-changed', actor: { kind: 'human' }, data: { activity: { kind: 'close' } } } as never)).toBeUndefined()
  })

  it('does nothing at 200K and compacts at 200001', async () => {
    const atLimit = fixture(AUTO_COMPACTION_TOKEN_LIMIT)
    atLimit.coordinator.schedule([memberId])
    await vi.waitFor(() => expect(atLimit.cleared).toHaveBeenCalledOnce())
    expect(atLimit.compactNow).not.toHaveBeenCalled()
    await atLimit.coordinator.dispose()

    const above = fixture(AUTO_COMPACTION_TOKEN_LIMIT + 1, { compact: async () => { above.setTokens(100) } })
    above.coordinator.schedule([memberId])
    await vi.waitFor(() => expect(above.compactNow).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(above.cleared).toHaveBeenCalled())
    expect(above.errors).toEqual([])
    await above.coordinator.dispose()
  })

  it('waits for a fresh idle boundary after busy and deduplicates a Member', async () => {
    const idles = Array.from({ length: 5 }, () => Promise.withResolvers<void>())
    let idleCalls = 0
    const tested = fixture(AUTO_COMPACTION_TOKEN_LIMIT + 1, {
      whenIdle: () => idles[idleCalls++]!.promise,
      compact: async () => {
        if (tested.compactNow.mock.calls.length === 1) throw new ManualCompactionError('busy', 'turn won race')
        tested.setTokens(10)
      },
    })
    tested.coordinator.schedule([memberId])
    tested.coordinator.schedule([memberId])
    expect(tested.compactNow).not.toHaveBeenCalled()
    idles[0]!.resolve()
    // First pass: hint steered, then its own idle boundary before measuring.
    await vi.waitFor(() => expect(tested.steer).toHaveBeenCalledOnce())
    idles[1]!.resolve()
    await vi.waitFor(() => expect(tested.compactNow).toHaveBeenCalledOnce())
    // busy: next iteration waits at a fresh idle (post-compaction re-check).
    await vi.waitFor(() => expect(idleCalls).toBe(3))
    expect(tested.compactNow).toHaveBeenCalledOnce()
    idles[2]!.resolve()
    // Second pass steers another hint (tokens are still above the threshold),
    // then waits for its idle boundary before the second compactNow.
    await vi.waitFor(() => expect(tested.steer).toHaveBeenCalledTimes(2))
    idles[3]!.resolve()
    await vi.waitFor(() => expect(tested.compactNow).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(tested.cleared).toHaveBeenCalled())
    // Final re-check: tokens are now below the threshold, so the worker
    // completes without another hint or compactNow.
    await vi.waitFor(() => expect(idleCalls).toBe(5))
    idles[4]!.resolve()
    await vi.waitFor(() => expect(tested.steer).toHaveBeenCalledTimes(2))
    expect(tested.compactNow).toHaveBeenCalledTimes(2)
    expect(tested.errors).toEqual([])
    await tested.coordinator.dispose()
  })

  it('steers the pre-compaction memory hint before compacting over-threshold sessions', async () => {
    const idleAfterHint = Promise.withResolvers<void>()
    let idleCalls = 0
    const tested = fixture(AUTO_COMPACTION_TOKEN_LIMIT + 1, {
      whenIdle: () => ++idleCalls === 1 ? Promise.resolve() : idleAfterHint.promise,
      compact: async () => { tested.setTokens(100) },
    })
    tested.coordinator.schedule([memberId])
    // The hint is steered before compactNow runs, with the plugin notice source.
    await vi.waitFor(() => expect(tested.steer).toHaveBeenCalledOnce())
    expect(tested.compactNow).not.toHaveBeenCalled()
    const steered = tested.steer.mock.calls[0]![0]
    expect(steered.source).toMatchObject({ kind: 'plugin', form: 'notice', summary: PRE_COMPACTION_NOTICE_SUMMARY })
    expect(steered.content[0]).toMatchObject({ type: 'text' })
    expect((steered.content[0] as { text: string }).text).toBe(preCompactionNoticeText())
    idleAfterHint.resolve()
    await vi.waitFor(() => expect(tested.compactNow).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(tested.cleared).toHaveBeenCalled())
    expect(tested.errors).toEqual([])
    await tested.coordinator.dispose()
  })

  it('waits for the hint turn to reach a fresh idle boundary before compacting', async () => {
    const idleBeforeHint = Promise.withResolvers<void>()
    const idleAfterHint = Promise.withResolvers<void>()
    let idleCalls = 0
    const tested = fixture(AUTO_COMPACTION_TOKEN_LIMIT + 1, {
      whenIdle: () => ++idleCalls === 1 ? idleBeforeHint.promise : idleAfterHint.promise,
      compact: async () => { tested.setTokens(100) },
    })
    tested.coordinator.schedule([memberId])
    idleBeforeHint.resolve()
    await vi.waitFor(() => expect(tested.steer).toHaveBeenCalledOnce())
    // The hint turn is still running (second idle unresolved): no compact yet.
    expect(tested.compactNow).not.toHaveBeenCalled()
    idleAfterHint.resolve()
    await vi.waitFor(() => expect(tested.compactNow).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(tested.cleared).toHaveBeenCalled())
    expect(tested.errors).toEqual([])
    await tested.coordinator.dispose()
  })

  it('keeps compacting when the steered hint turn fails or steer throws', async () => {
    // steer itself rejects: the failure is logged and compaction proceeds.
    const throwing = fixture(AUTO_COMPACTION_TOKEN_LIMIT + 1, {
      steerPreCompaction: () => { throw new Error('steer rejected') },
      compact: async () => { throwing.setTokens(100) },
    })
    throwing.coordinator.schedule([memberId])
    await vi.waitFor(() => expect(throwing.compactNow).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(throwing.cleared).toHaveBeenCalled())
    expect(throwing.errors).toEqual([])
    expect(throwing.logs[0]).toContain('pre-compaction memory hint failed: steer rejected')
    await throwing.coordinator.dispose()

    // The idle wait after the hint rejects: still not a compaction failure.
    // Call 3 is the post-compaction re-check of the same worker; it resolves.
    let idleCalls = 0
    const rejecting = fixture(AUTO_COMPACTION_TOKEN_LIMIT + 1, {
      whenIdle: () => { idleCalls += 1; return idleCalls === 2 ? Promise.reject(new Error('idle wait boom')) : Promise.resolve() },
      compact: async () => { rejecting.setTokens(100) },
    })
    rejecting.coordinator.schedule([memberId])
    await vi.waitFor(() => expect(rejecting.compactNow).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(rejecting.cleared).toHaveBeenCalled())
    expect(rejecting.errors).toEqual([])
    expect(rejecting.logs[0]).toContain('pre-compaction hint idle wait failed: idle wait boom')
    await rejecting.coordinator.dispose()
  })

  it('steers no hint below the threshold', async () => {
    const tested = fixture(AUTO_COMPACTION_TOKEN_LIMIT)
    tested.coordinator.schedule([memberId])
    await vi.waitFor(() => expect(tested.cleared).toHaveBeenCalledOnce())
    expect(tested.steer).not.toHaveBeenCalled()
    expect(tested.compactNow).not.toHaveBeenCalled()
    await tested.coordinator.dispose()
  })

  it('retains separate diagnostics for null, no-progress, missing meter/engine, and throws', async () => {
    const cases: ReadonlyArray<readonly [string, ReturnType<typeof fixture>]> = [
      ['no compactable range', fixture(AUTO_COMPACTION_TOKEN_LIMIT + 1, { compact: async () => null })],
      ['did not reduce context', fixture(AUTO_COMPACTION_TOKEN_LIMIT + 1)],
      ['tokenMeter is unavailable', fixture(AUTO_COMPACTION_TOKEN_LIMIT + 1, { meter: false })],
      ['compaction is unavailable', fixture(AUTO_COMPACTION_TOKEN_LIMIT + 1, { engine: false })],
      ['automatic compaction failed: boom', fixture(AUTO_COMPACTION_TOKEN_LIMIT + 1, { compact: async () => { throw new Error('boom') } })],
    ]
    for (const [diagnostic, tested] of cases) {
      tested.coordinator.schedule([memberId])
      await vi.waitFor(() => expect(tested.errors[0]).toContain(diagnostic))
      await tested.coordinator.dispose()
    }
  })

  it('heals an orphaned engine resolution through one in-place re-activation', async () => {
    const healed = fixture(AUTO_COMPACTION_TOKEN_LIMIT + 1, { compact: async () => { healed.setTokens(100) } })
    const reactivate = vi.fn(async () => {
      tested.setAgent(healed.agent)
      return true
    })
    const tested = fixture(AUTO_COMPACTION_TOKEN_LIMIT + 1, { engine: false, reactivate })
    tested.coordinator.schedule([memberId])
    await vi.waitFor(() => expect(healed.compactNow).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(tested.cleared).toHaveBeenCalled())
    expect(reactivate).toHaveBeenCalledOnce()
    expect(tested.errors).toEqual([])
    await tested.coordinator.dispose()
    await healed.coordinator.dispose()
  })

  it('fails terminally when re-activation cannot restore the engine, without retry loops', async () => {
    const reactivate = vi.fn(async () => true)
    const tested = fixture(AUTO_COMPACTION_TOKEN_LIMIT + 1, { engine: false, reactivate })
    tested.coordinator.schedule([memberId])
    await vi.waitFor(() => expect(tested.errors[0]).toContain('compaction is unavailable'))
    expect(reactivate).toHaveBeenCalledOnce()
    await tested.coordinator.dispose()
  })

  it('fails terminally when the member cannot be rebuilt', async () => {
    const reactivate = vi.fn(async () => false)
    const tested = fixture(AUTO_COMPACTION_TOKEN_LIMIT + 1, { engine: false, reactivate })
    tested.coordinator.schedule([memberId])
    await vi.waitFor(() => expect(tested.errors[0]).toContain('compaction is unavailable'))
    expect(reactivate).toHaveBeenCalledOnce()
    await tested.coordinator.dispose()
  })

  it('keeps an unavailable Member pending until activation', async () => {
    const tested = fixture(AUTO_COMPACTION_TOKEN_LIMIT, { available: false })
    tested.coordinator.schedule([memberId])
    await Promise.resolve()
    expect(tested.measure).not.toHaveBeenCalled()
    tested.setAvailable(true)
    tested.coordinator.activated(memberId)
    await vi.waitFor(() => expect(tested.cleared).toHaveBeenCalledOnce())
    await tested.coordinator.dispose()
  })

  it('aborts a never-idle worker during dispose without cancelling the Agent', async () => {
    const tested = fixture(AUTO_COMPACTION_TOKEN_LIMIT + 1, { whenIdle: () => new Promise<void>(() => {}) })
    tested.coordinator.schedule([memberId])
    await Promise.resolve()
    await expect(tested.coordinator.dispose()).resolves.toBeUndefined()
    expect(tested.cancel).not.toHaveBeenCalled()
    expect(tested.compactNow).not.toHaveBeenCalled()
  })
})
