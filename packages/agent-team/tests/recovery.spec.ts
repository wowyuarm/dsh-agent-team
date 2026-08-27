import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { classifyRecoverableError, RecoveryCoordinator, RECOVERY_DELAY_MS, RECOVERY_MAX_CONSECUTIVE_ERRORS } from '../src/recovery.ts'
import type { AgentTeamMemberId } from '../src/types.ts'

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

  const memberId = 'member:builder' as AgentTeamMemberId

  function harness() {
    const wakeups: AgentTeamMemberId[] = []
    const coordinator = new RecoveryCoordinator({
      wake: id => { wakeups.push(id) },
    })
    return { coordinator, wakeups }
  }

  it('wakes once after each of the first two consecutive recoverable errors', () => {
    const { coordinator, wakeups } = harness()
    coordinator.onError(memberId, 'fetch failed')
    vi.advanceTimersByTime(RECOVERY_DELAY_MS)
    coordinator.onError(memberId, 'HTTP 429')
    vi.advanceTimersByTime(RECOVERY_DELAY_MS)

    expect(wakeups).toEqual([memberId, memberId])
  })

  it('counts every agent/error occurrence, including repeated equal errors', () => {
    const standDowns: Array<{ memberId: AgentTeamMemberId; failures: number }> = []
    const coordinator = new RecoveryCoordinator({
      wake: () => {},
      onStandDown: (id, failures) => { standDowns.push({ memberId: id, failures }) },
    })
    coordinator.onError(memberId, 'fetch failed')
    coordinator.onError(memberId, 'fetch failed')
    expect(vi.getTimerCount()).toBe(2)

    coordinator.onError(memberId, 'fetch failed')
    expect(standDowns).toEqual([{ memberId, failures: RECOVERY_MAX_CONSECUTIVE_ERRORS }])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('stands down immediately on the third consecutive recoverable error', () => {
    const { coordinator, wakeups } = harness()
    coordinator.onError(memberId, 'fetch failed')
    vi.advanceTimersByTime(RECOVERY_DELAY_MS)
    coordinator.onError(memberId, 'HTTP 429')
    vi.advanceTimersByTime(RECOVERY_DELAY_MS)

    coordinator.onError(memberId, 'socket hang up')
    vi.advanceTimersByTime(RECOVERY_DELAY_MS * 2)
    expect(wakeups).toEqual([memberId, memberId])
  })

  it('counts changing messages and recoverable kinds as one uninterrupted error run', () => {
    const { coordinator, wakeups } = harness()
    coordinator.onError(memberId, 'ECONNRESET')
    vi.advanceTimersByTime(RECOVERY_DELAY_MS)
    coordinator.onError(memberId, 'HTTP 429')
    vi.advanceTimersByTime(RECOVERY_DELAY_MS)
    coordinator.onError(memberId, 'socket hang up')
    vi.advanceTimersByTime(RECOVERY_DELAY_MS * 2)

    expect(wakeups).toEqual([memberId, memberId])
  })

  it('clears the consecutive error count when a turn ends cleanly', () => {
    const { coordinator, wakeups } = harness()
    coordinator.onError(memberId, 'ETIMEDOUT')
    vi.advanceTimersByTime(RECOVERY_DELAY_MS)
    coordinator.onCleanTurnEnd(memberId)

    coordinator.onError(memberId, 'ETIMEDOUT')
    vi.advanceTimersByTime(RECOVERY_DELAY_MS)
    expect(wakeups).toEqual([memberId, memberId])
  })

  it('cancels automatic recovery tracking when a non-recoverable error arrives', () => {
    const { coordinator, wakeups } = harness()
    coordinator.onError(memberId, 'fetch failed')
    coordinator.onError(memberId, 'context length exceeded')
    vi.advanceTimersByTime(RECOVERY_DELAY_MS * 3)
    expect(wakeups).toEqual([])
  })

  it('stops tracking when the wake target is gone', () => {
    const coordinator = new RecoveryCoordinator({
      wake: () => { throw new Error('member disposed') },
    })
    coordinator.onError(memberId, 'fetch failed')
    vi.advanceTimersByTime(RECOVERY_DELAY_MS)
    coordinator.onError(memberId, 'fetch failed')
    vi.advanceTimersByTime(RECOVERY_DELAY_MS)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('notifies stand-down exactly once per error run', () => {
    const standDowns: Array<{ memberId: AgentTeamMemberId; failures: number }> = []
    const coordinator = new RecoveryCoordinator({
      wake: () => {},
      onStandDown: (id, failures) => { standDowns.push({ memberId: id, failures }) },
      maxConsecutiveErrors: 2,
    })
    coordinator.onError(memberId, 'HTTP 429')
    vi.advanceTimersByTime(RECOVERY_DELAY_MS)
    coordinator.onError(memberId, 'HTTP 429')
    coordinator.onError(memberId, 'HTTP 429')
    expect(standDowns).toEqual([{ memberId, failures: 2 }])
  })

  it('dispose cancels every pending timer', () => {
    const { coordinator } = harness()
    coordinator.onError('member:a' as AgentTeamMemberId, 'fetch failed')
    coordinator.onError('member:b' as AgentTeamMemberId, 'HTTP 429')
    expect(vi.getTimerCount()).toBe(2)
    coordinator.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })
})
