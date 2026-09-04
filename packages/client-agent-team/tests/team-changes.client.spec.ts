// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { TeamChangeStream } from '../src/client/team-changes.ts'

interface FakeCall {
  readonly request: { afterVersion: number; scope?: unknown }
  readonly signal: AbortSignal
}

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  const box = Promise.withResolvers<T>()
  return box
}

describe('TeamChangeStream', () => {
  it('shares one long-poll per scope and dispatches wakes to every listener', async () => {
    const parked = deferred<{ ok: true; value: { version: number } }>()
    let parkCalls = 0
    const calls: FakeCall[] = []
    const changes = vi.fn((request: { afterVersion: number; scope?: unknown }, signal: AbortSignal) => {
      calls.push({ request, signal })
      if (request.afterVersion === 0) return Promise.resolve({ ok: true as const, value: { version: 7 } })
      parkCalls += 1
      // Only the first poll parks on the resolvable deferred; later polls must
      // park freshly or an already-resolved promise would spin the stream.
      return parkCalls === 1 ? parked.promise as never : new Promise<never>(() => {})
    })
    const stream = new TeamChangeStream(changes as never)
    const scope = { kind: 'thread' as const, threadRef: 'thread:1' as never }
    const first = vi.fn()
    const second = vi.fn()
    const disposeFirst = stream.subscribe(scope, first)
    const disposeSecond = stream.subscribe(scope, second)
    await Promise.resolve()
    await Promise.resolve()

    // The probe sampled version 7 silently; exactly one parked poll exists and
    // both subscribers share it.
    expect(changes).toHaveBeenCalledTimes(2)
    expect(calls[0]!.request).toEqual({ afterVersion: 0, scope })
    expect(calls[1]!.request).toEqual({ afterVersion: 7, scope })
    expect(first).not.toHaveBeenCalled()
    expect(second).not.toHaveBeenCalled()

    parked.resolve({ ok: true, value: { version: 8 } })
    await vi.waitFor(() => expect(first).toHaveBeenCalledWith({ type: 'changed', version: 8 }))
    expect(second).toHaveBeenCalledWith({ type: 'changed', version: 8 })
    disposeFirst()

    // The surviving subscriber keeps the poll alive; a second wake reaches it.
    await vi.waitFor(() => expect(changes).toHaveBeenCalledTimes(3))
    expect(calls[2]!.request).toEqual({ afterVersion: 8, scope })
    disposeSecond()
  })

  it('opens independent polls per scope and aborts when the last subscriber leaves', async () => {
    const waiters: Array<(value: { ok: true; value: { version: number } }) => void> = []
    const calls: FakeCall[] = []
    const changes = vi.fn((request: { afterVersion: number; scope?: unknown }, signal: AbortSignal) => {
      calls.push({ request, signal })
      if (request.afterVersion === 0) return Promise.resolve({ ok: true as const, value: { version: 3 } })
      return new Promise(resolve => { waiters.push(resolve) }) as never
    })
    const stream = new TeamChangeStream(changes as never)
    const threadScope = { kind: 'thread' as const, threadRef: 'thread:1' as never }
    const channelScope = { kind: 'channel' as const, channelRef: 'channel:1' as never }
    const disposeThread = stream.subscribe(threadScope, () => {})
    stream.subscribe(channelScope, () => {})
    await vi.waitFor(() => expect(calls.length).toBe(4))
    // The two polls start concurrently, so only their per-scope order is stable.
    const threadCalls = calls.filter(call => call.request.scope === threadScope)
    const channelCalls = calls.filter(call => call.request.scope === channelScope)
    expect(threadCalls.map(call => call.request.afterVersion)).toEqual([0, 3])
    expect(channelCalls.map(call => call.request.afterVersion)).toEqual([0, 3])

    disposeThread()
    await vi.waitFor(() => expect(threadCalls[1]!.signal.aborted).toBe(true))
    // The channel poll keeps running with a live signal.
    expect(channelCalls[1]!.signal.aborted).toBe(false)
    waiters.splice(0).forEach(resolve => resolve({ ok: true, value: { version: 4 } }))
  })

  it('delivers failures to listeners and restarts cleanly for the next subscriber', async () => {
    let attempts = 0
    const changes = vi.fn((request: { afterVersion: number }) => {
      attempts += 1
      if (attempts === 1) return Promise.resolve({ ok: false as const, error: { code: 'transport', message: 'transport down', details: {} } })
      if (request.afterVersion === 0) return Promise.resolve({ ok: true as const, value: { version: 1 } })
      return new Promise<{ ok: true; value: { version: number } }>(() => {})
    })
    const stream = new TeamChangeStream(changes as never)
    const scope = { kind: 'workspace' as const, workspaceId: 'w1' as WorkspaceId }
    const listener = vi.fn()
    const dispose = stream.subscribe(scope, listener)
    await vi.waitFor(() => expect(listener).toHaveBeenCalledWith({ type: 'failed', message: 'transport down' }))
    dispose()

    const next = vi.fn()
    stream.subscribe(scope, next)
    await vi.waitFor(() => expect(changes.mock.calls.length).toBeGreaterThanOrEqual(3))
    expect(next).not.toHaveBeenCalled()
  })
})
