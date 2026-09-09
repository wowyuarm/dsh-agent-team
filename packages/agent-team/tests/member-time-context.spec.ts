import { describe, expect, it } from 'vitest'
import * as memberTimeContext from '../src/member-time-context.ts'
import type { UserMessage } from '@deepseek-ai/dsh-llm'

/**
 * The clock plugin folds its baseline from the Member Session's own events,
 * the same manual-fold pattern the Host context projection uses. These tests
 * lock the fold semantics: what counts as a model-visible event, how turn
 * boundaries clear the turn-local baseline, and what a fresh Session (a
 * rollover) may and may not claim about elapsed time.
 */

const PLUGIN = memberTimeContext.name

function userMessage(source: UserMessage['source'], text = 'x'): UserMessage {
  return { role: 'user', content: [{ type: 'text', text }], source } as UserMessage
}

function clockSnapshot(time: number): { readonly type: string; readonly time: number; readonly data: UserMessage } {
  return { type: 'user/message', time,
    data: userMessage({ kind: 'plugin', plugin: PLUGIN, form: 'snapshot', sections: [] }) }
}

function ordinaryMessage(time: number): { readonly type: string; readonly time: number; readonly data: UserMessage } {
  return { type: 'user/message', time, data: userMessage({ kind: 'user' }) }
}

describe('foldClockBaseline derives elapsed baselines from session events', () => {
  it('starts empty: a fresh session has no prior event and no prior snapshot', () => {
    expect(memberTimeContext.foldClockBaseline([])).toEqual({ lastMessageTime: null, lastInjectionTime: null, lastTurnInjectionTime: null, openTurn: -1 })
  })

  it('tracks the latest model-visible event time across messages and tool results', () => {
    const folded = memberTimeContext.foldClockBaseline([
      ordinaryMessage(1_000),
      { type: 'assistant/message', time: 2_000, data: {} },
      { type: 'tool/result', time: 3_000, data: {} as never },
      ordinaryMessage(4_000),
    ])
    expect(folded.lastMessageTime).toBe(4_000)
    expect(folded.lastInjectionTime).toBeNull()
  })

  it('recognizes its own snapshots and records the injection baselines', () => {
    const folded = memberTimeContext.foldClockBaseline([
      ordinaryMessage(1_000),
      clockSnapshot(2_500),
    ])
    expect(folded.lastMessageTime).toBe(2_500)
    expect(folded.lastInjectionTime).toBe(2_500)
    expect(folded.lastTurnInjectionTime).toBe(2_500)
  })

  it('a new turn clears the turn-local baseline but keeps the message baseline', () => {
    const folded = memberTimeContext.foldClockBaseline([
      { type: 'turn/start', time: 0, data: { turn: 1 } },
      ordinaryMessage(1_000),
      clockSnapshot(2_000),
      { type: 'turn/end', time: 3_000, data: { turn: 1, reason: 'stop' } },
      { type: 'turn/start', time: 4_000, data: { turn: 2 } },
    ])
    expect(folded.openTurn).toBe(2)
    expect(folded.lastTurnInjectionTime).toBeNull()
    expect(folded.lastMessageTime).toBe(2_000)
    expect(folded.lastInjectionTime).toBe(2_000)
  })

  it('unrelated event types leave the state untouched', () => {
    const before = memberTimeContext.foldClockBaseline([ordinaryMessage(1_000)])
    const after = memberTimeContext.foldClockBaseline([ordinaryMessage(1_000),
      { type: 'sandbox/mode', time: 5_000, data: { mode: 'workspace-write' } } as never])
    expect(after).toEqual(before)
  })
})

describe('renderClockSnapshot states elapsed explicitly', () => {
  it('renders the fixed UTC+8 instant, the elapsed span, and the ordering note', () => {
    const text = memberTimeContext.renderClockSnapshot({ now: Date.parse('2026-09-08T09:00:00.000Z'), turn: 9, step: 1, previous: Date.parse('2026-09-06T05:47:52.000Z') })
    expect(text).toContain('turn 9, step 1: 2026-09-08T17:00:00+08:00')
    expect(text).toContain('Elapsed since the preceding model-visible event: 2d 3h 12m 8s.')
    expect(text).toContain('Team collaboration timestamps use UTC+8. Sequence and revision, not wall-clock time, determine ordering and concurrency.')
  })

  it('step 1 names the model-visible event baseline; later steps name the step context', () => {
    const stepOne = memberTimeContext.renderClockSnapshot({ now: 1_000, turn: 1, step: 1, previous: 500 })
    const stepTwo = memberTimeContext.renderClockSnapshot({ now: 1_000, turn: 1, step: 2, previous: 500 })
    expect(stepOne).toContain('preceding model-visible event')
    expect(stepTwo).toContain('preceding step context')
  })

  it('a fresh session (rollover) renders unavailable elapsed, never a fabricated baseline', () => {
    const text = memberTimeContext.renderClockSnapshot({ now: 1_000, turn: 1, step: 1, previous: undefined })
    expect(text).toContain('Elapsed since the preceding model-visible event: unavailable.')
  })

  it('a wall-clock rollback clamps elapsed to 0s instead of printing a negative span', () => {
    const text = memberTimeContext.renderClockSnapshot({ now: 1_000, turn: 1, step: 2, previous: 5_000 })
    expect(text).toContain('Elapsed since the preceding step context: 0s.')
  })
})

describe('shouldSampleClock gates snapshots to turn starts and refresh intervals', () => {
  const baselineAfter = (events: Parameters<typeof memberTimeContext.foldClockBaseline>[0]) => memberTimeContext.foldClockBaseline(events)

  it('the first step of a turn always samples, regardless of prior state', () => {
    const fresh = baselineAfter([])
    expect(memberTimeContext.shouldSampleClock(1, 1_000, fresh, 60_000)).toBe(true)
    const seeded = baselineAfter([clockSnapshot(500)])
    expect(memberTimeContext.shouldSampleClock(1, 600, seeded, 60_000)).toBe(true)
  })

  it('a later step inside the refresh interval stays quiet', () => {
    const baseline = baselineAfter([clockSnapshot(10_000)])
    // 7s after the landed snapshot: below the 60s interval, no injection.
    expect(memberTimeContext.shouldSampleClock(2, 17_000, baseline, 60_000)).toBe(false)
    expect(memberTimeContext.shouldSampleClock(5, 59_999, baseline, 60_000)).toBe(false)
  })

  it('a later step samples once the turn outlives the refresh interval since the last snapshot', () => {
    const baseline = baselineAfter([clockSnapshot(10_000)])
    expect(memberTimeContext.shouldSampleClock(2, 70_000, baseline, 60_000)).toBe(true)
    // The refresh baseline is the last landed snapshot, so a long-running
    // turn samples once per elapsed interval.
    const refreshed = baselineAfter([clockSnapshot(70_000)])
    expect(memberTimeContext.shouldSampleClock(3, 100_000, refreshed, 60_000)).toBe(false)
    expect(memberTimeContext.shouldSampleClock(3, 130_001, refreshed, 60_000)).toBe(true)
  })

  it('a later step with no landed snapshot in the turn samples (cannot happen after step 1, defensive)', () => {
    const baseline = baselineAfter([ordinaryMessage(1_000)])
    expect(memberTimeContext.shouldSampleClock(2, 1_500, baseline, 60_000)).toBe(true)
  })

  it('the shipped default interval is 30 minutes: an ordinary turn stays at one line, a half-hour turn refreshes once', () => {
    const interval = memberTimeContext.CLOCK_REFRESH_INTERVAL_MS
    expect(interval).toBe(1_800_000)
    const baseline = baselineAfter([clockSnapshot(10_000)])
    expect(memberTimeContext.shouldSampleClock(5, 10_000 + 29 * 60_000, baseline, interval)).toBe(false)
    expect(memberTimeContext.shouldSampleClock(5, 10_000 + 30 * 60_000, baseline, interval)).toBe(true)
  })
})
