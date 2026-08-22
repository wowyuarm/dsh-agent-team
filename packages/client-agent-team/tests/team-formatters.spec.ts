import { describe, expect, it } from 'vitest'
import type { AgentTeamActivity, AgentTeamClaim } from '@wowyuarm/dsh-agent-team/types'
import { zh } from '../src/client/locales.ts'
import type { TeamConversationProps } from '../src/client/slots.ts'
import { formatActivity, formatClaimState, formatMessageTime, formatTaskStatus, splitMentions, taskStatusDot } from '../src/client/team-formatters.ts'

const t = ((key: keyof typeof zh, params?: Record<string, string | number>) => {
  let value: string = zh[key]
  for (const [name, replacement] of Object.entries(params ?? {})) value = value.replace(`{${name}}`, String(replacement))
  return value
}) as TeamConversationProps['t']

const base = { activityRef: 'activity:1', taskRef: 'task:1', threadRef: 'thread:1', actor: 'member:builder', sequence: 3 }
const claim = { claimRef: 'claim:1', taskRef: 'task:1', threadRef: 'thread:1', owner: 'member:builder', direction: '实现 API', normalizedDirection: '实现 api', state: 'active' } as AgentTeamClaim

function activity(value: Record<string, unknown>): AgentTeamActivity {
  return { ...base, ...value } as AgentTeamActivity
}

describe('Team presentation formatters', () => {
  it('localizes Task and Claim states', () => {
    expect(formatTaskStatus('in_review', t)).toBe('待验收')
    expect(formatTaskStatus('closed', t)).toBe('已关闭')
    expect(formatClaimState('active', t)).toBe('进行中')
    expect(formatClaimState('released', t)).toBe('已释放')
  })

  it('formats every Activity kind without exposing refs or enums', () => {
    const expected = [
      ['claim', 'builder 认领了「实现 API」'],
      ['done', 'builder 完成了「实现 API」'],
      ['release', 'builder 释放了「实现 API」'],
      ['claims_released', 'builder 因成员权限变化释放了 1 个 Claim'],
      ['accept', 'builder 验收了此 Task'],
      ['close', 'builder 关闭了此 Task'],
      ['reopen', 'builder 重新打开了此 Task'],
    ] as const
    for (const [kind, text] of expected) {
      const claimFields = kind === 'claim' || kind === 'done' || kind === 'release' ? { claimRef: claim.claimRef }
        : kind === 'claims_released' ? { claimRefs: [claim.claimRef] } : {}
      const rendered = formatActivity(activity({ kind, ...claimFields }), { t, actorName: () => 'builder', claims: [claim] })
      expect(rendered).toBe(text)
      expect(rendered).not.toContain('member:')
      expect(rendered).not.toContain('claim:')
    }
  })

  it('renders message time as clock time today, date+time within the year, full date otherwise', () => {
    const now = new Date('2026-08-21T12:00:00')
    const at = new Date('2026-08-21T03:05:00.000Z')
    const clock = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
    expect(formatMessageTime('2026-08-21T03:05:00.000Z', now)).toBe(clock)
    expect(formatMessageTime('2026-02-01T08:30:00', now)).toBe('02-01 08:30')
    expect(formatMessageTime('2025-12-31T23:59:00', now)).toBe('2025-12-31 23:59')
    expect(formatMessageTime('not-a-date', now)).toBe('')
  })

  it('splits mentions only for known handles and never inside words', () => {
    const handles = new Set(['builder', 'lead'])
    expect(splitMentions('@builder please review @Lead', handles)).toEqual([
      { text: '@builder', mention: true },
      { text: ' please review ', mention: false },
      { text: '@Lead', mention: true },
    ])
    // Email addresses and unknown handles stay plain; an empty handle set short-circuits.
    expect(splitMentions('mail me at a@builder.com or @stranger', handles)).toEqual([
      { text: 'mail me at a@builder.com or @stranger', mention: false },
    ])
    expect(splitMentions('plain text', handles)).toEqual([{ text: 'plain text', mention: false }])
    expect(splitMentions('@builder at line start', new Set<string>())).toEqual([{ text: '@builder at line start', mention: false }])
  })

  it('gives only running, review-pending, and done tasks a state dot', () => {
    expect(taskStatusDot('todo')).toBeUndefined()
    expect(taskStatusDot('in_progress')).toBe('ongoing')
    expect(taskStatusDot('in_review')).toBe('warning')
    expect(taskStatusDot('done')).toBe('done')
    expect(taskStatusDot('closed')).toBeUndefined()
  })
})
