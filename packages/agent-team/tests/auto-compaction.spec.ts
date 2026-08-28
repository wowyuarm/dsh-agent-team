import { describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ManualCompactionError } from '@deepseek-ai/dsh-compaction'
import { SessionId } from '@deepseek-ai/dsh-session'
import { acceptedTaskCompactionMembers, AUTO_COMPACTION_TOKEN_LIMIT, AutoCompactionCoordinator } from '../src/auto-compaction.ts'
import type { AgentTeamMemberId, AgentTeamTaskRef } from '../src/types.ts'

const memberId = 'member:builder' as AgentTeamMemberId
const taskRef = 'task:accepted' as AgentTeamTaskRef

function fixture(tokens: number, options: {
  readonly compact?: () => Promise<unknown>
  readonly whenIdle?: () => Promise<void>
  readonly meter?: boolean
  readonly engine?: boolean
  readonly available?: boolean
} = {}) {
  let available = options.available ?? true
  const measure = vi.fn(() => ({ totalTokens: tokens }))
  const compactNow = vi.fn(async () => {
    const result = await (options.compact?.() ?? Promise.resolve({}))
    return result as never
  })
  const cancel = vi.fn()
  const agent = {
    id: SessionId('session:builder'),
    session: {} as never,
    ctx: { get: (name: string) => name === 'tokenMeter' && options.meter !== false ? { measure } : name === 'compaction' && options.engine !== false ? { compactNow } : undefined },
    whenIdle: options.whenIdle ?? (async () => {}),
    cancel,
  } as unknown as Agent
  const errors: string[] = []
  const cleared = vi.fn()
  const coordinator = new AutoCompactionCoordinator({
    agentForMember: id => id === memberId && available ? agent : undefined,
    compactionForAgent: target => target.ctx.get('compaction'),
    failed: (_member, _session, diagnostic) => { errors.push(diagnostic) },
    cleared,
    log: () => {},
  })
  return { agent, cancel, cleared, compactNow, coordinator, errors, measure, setAvailable: (next: boolean) => { available = next }, setTokens: (next: number) => { tokens = next } }
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
    const firstIdle = Promise.withResolvers<void>()
    const secondIdle = Promise.withResolvers<void>()
    let idleCalls = 0
    const tested = fixture(AUTO_COMPACTION_TOKEN_LIMIT + 1, {
      whenIdle: () => ++idleCalls === 1 ? firstIdle.promise : secondIdle.promise,
      compact: async () => {
        if (tested.compactNow.mock.calls.length === 1) throw new ManualCompactionError('busy', 'turn won race')
        tested.setTokens(10)
      },
    })
    tested.coordinator.schedule([memberId])
    tested.coordinator.schedule([memberId])
    expect(tested.compactNow).not.toHaveBeenCalled()
    firstIdle.resolve()
    await vi.waitFor(() => expect(tested.compactNow).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(idleCalls).toBe(2))
    expect(tested.compactNow).toHaveBeenCalledOnce()
    secondIdle.resolve()
    await vi.waitFor(() => expect(tested.compactNow).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(tested.cleared).toHaveBeenCalled())
    expect(tested.errors).toEqual([])
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
