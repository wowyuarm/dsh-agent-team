import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { classifyRecoverableError, RecoveryCoordinator, RECOVERY_DELAY_MS, RECOVERY_MAX_ATTEMPTS } from '../src/recovery.ts'

describe('recoverable error classification', () => {
  it.each([
    ['fetch failed', 'transient network'],
    ['request to https://example.com failed: ECONNRESET', 'transient network'],
    ['ETIMEDOUT after 30000ms', 'transient network'],
    ['upstream socket hang up', 'transient network'],
    ['HTTP 429 too many requests', 'rate limiting'],
    ['provider rate limit exceeded', 'rate limiting'],
    ['gateway returned 503 service unavailable', 'rate limiting'],
    ['model is overloaded, try again', 'rate limiting'],
  ])('classifies %j as %j', (message, kind) => {
    expect(classifyRecoverableError(message)).toBe(kind)
  })

  it.each([
    ['prompt is too long: context length exceeded'],
    ['401 unauthorized: bad api key'],
    ['403 forbidden for this model'],
    ['TypeError: cannot read properties of undefined'],
  ])('leaves %j manual (no auto recovery)', message => {
    expect(classifyRecoverableError(message)).toBeUndefined()
  })
})

describe('RecoveryCoordinator', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const memberId = 'member:builder' as never

  function harness() {
    const injections: Array<{ memberId: typeof memberId; attempt: number; kind: string }> = []
    const coordinator = new RecoveryCoordinator({
      inject: (id, attempt, kind) => { injections.push({ memberId: id, attempt, kind }) },
    })
    return { coordinator, injections }
  }

  it('injects once per error after the delay, then again on recurrence', () => {
    const { coordinator, injections } = harness()
    coordinator.onError(memberId, 'fetch failed')
    expect(injections).toEqual([])
    vi.advanceTimersByTime(RECOVERY_DELAY_MS)
    expect(injections).toEqual([{ memberId, attempt: 1, kind: 'transient network' }])
    // Same error recurs → second attempt on the next delay.
    coordinator.onError(memberId, 'fetch failed')
    vi.advanceTimersByTime(RECOVERY_DELAY_MS)
    expect(injections).toHaveLength(2)
    expect(injections[1]!.attempt).toBe(2)
  })

  it('stands down after the maximum attempts of one identical error', () => {
    const { coordinator, injections } = harness()
    for (let round = 0; round <= RECOVERY_MAX_ATTEMPTS; round += 1) {
      coordinator.onError(memberId, 'HTTP 429')
      vi.advanceTimersByTime(RECOVERY_DELAY_MS)
    }
    expect(injections).toHaveLength(RECOVERY_MAX_ATTEMPTS)
    // A further identical error schedules nothing: presence stays error for the operator.
    coordinator.onError(memberId, 'HTTP 429')
    vi.advanceTimersByTime(RECOVERY_DELAY_MS * 5)
    expect(injections).toHaveLength(RECOVERY_MAX_ATTEMPTS)
  })

  it('clears the episode when a turn ends cleanly', () => {
    const { coordinator, injections } = harness()
    coordinator.onError(memberId, 'ETIMEDOUT')
    coordinator.onCleanTurnEnd(memberId)
    vi.advanceTimersByTime(RECOVERY_DELAY_MS * 3)
    expect(injections).toEqual([])
    // And a fresh error starts a brand-new episode with attempt 1.
    coordinator.onError(memberId, 'ETIMEDOUT')
    vi.advanceTimersByTime(RECOVERY_DELAY_MS)
    expect(injections).toEqual([{ memberId, attempt: 1, kind: 'transient network' }])
  })

  it('starts a new episode when the error string changes', () => {
    const { coordinator, injections } = harness()
    coordinator.onError(memberId, 'ECONNRESET')
    vi.advanceTimersByTime(RECOVERY_DELAY_MS)
    coordinator.onError(memberId, 'socket hang up') // changed string → fresh episode
    coordinator.onError(memberId, 'socket hang up')
    vi.advanceTimersByTime(RECOVERY_DELAY_MS)
    expect(injections).toEqual([
      { memberId, attempt: 1, kind: 'transient network' },
      { memberId, attempt: 1, kind: 'transient network' },
    ])
  })

  it('cancels pending retries when a non-retryable error arrives', () => {
    const { coordinator, injections } = harness()
    coordinator.onError(memberId, 'fetch failed')
    coordinator.onError(memberId, 'context length exceeded')
    vi.advanceTimersByTime(RECOVERY_DELAY_MS * 3)
    expect(injections).toEqual([])
  })

  it('stops tracking when the injection target is gone', () => {
    const injections: unknown[] = []
    const coordinator = new RecoveryCoordinator({
      inject: () => { throw new Error('member disposed') },
    })
    coordinator.onError(memberId, 'fetch failed')
    vi.advanceTimersByTime(RECOVERY_DELAY_MS)
    expect(injections).toEqual([])
    coordinator.onError(memberId, 'fetch failed')
    vi.advanceTimersByTime(RECOVERY_DELAY_MS)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not double-schedule while an injection is already pending', () => {
    const { coordinator, injections } = harness()
    coordinator.onError(memberId, 'fetch failed')
    coordinator.onError(memberId, 'fetch failed')
    coordinator.onError(memberId, 'fetch failed')
    vi.advanceTimersByTime(RECOVERY_DELAY_MS)
    expect(injections).toEqual([{ memberId, attempt: 1, kind: 'transient network' }])
  })

  it('dispose cancels every pending timer', () => {
    const { coordinator } = harness()
    coordinator.onError('member:a' as never, 'fetch failed')
    coordinator.onError('member:b' as never, 'HTTP 429')
    expect(vi.getTimerCount()).toBe(2)
    coordinator.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })
})
