import { describe, expect, it } from 'vitest'
import type { AgentTeamActivity, AgentTeamClaim, AgentTeamMemberId } from '@wowyuarm/dsh-agent-team/types'
import { zh } from '../src/client/locales.ts'
import type { TeamConversationProps } from '../src/client/slots.ts'
import { formatActivity, formatClaimState, formatMessageTime, formatTaskStatus, isPlainTextBody, mentionNamesOf, splitMentionNames, taskStatusDot } from '../src/client/team-formatters.ts'

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

  it('splits only structured mention names, case-insensitively with an optional @', () => {
    expect(splitMentionNames('@builder please review human', ['builder', 'Human']).segments).toEqual([
      { text: '@builder', mention: true, name: 'builder' },
      { text: ' please review ', mention: false },
      { text: '@Human', mention: true, name: 'Human' },
    ])
    // Unmentioned names stay plain even when the body spells them out.
    expect(splitMentionNames('builder and @stranger', ['lead']).segments).toEqual([
      { text: 'builder and @stranger', mention: false },
    ])
    // Email addresses never match; word boundaries hold.
    expect(splitMentionNames('mail me at a@builder.com', ['builder']).segments).toEqual([
      { text: 'mail me at a@builder.com', mention: false },
    ])
    // A mentioned name absent from the body comes back unmatched.
    const absent = splitMentionNames('no names here', ['builder'])
    expect(absent.segments).toEqual([{ text: 'no names here', mention: false }])
    expect(absent.unmatched).toEqual(['builder'])
    // Longer names win over their prefixes at the same position.
    const nested = splitMentionNames('ping builder2', ['build', 'builder2'])
    expect(nested.segments).toEqual([
      { text: 'ping ', mention: false },
      { text: '@builder2', mention: true, name: 'builder2' },
    ])
  })

  it('maps mention refs to canonical handles through the member table', () => {
    const handles = new Map([['member:1' as AgentTeamMemberId, 'builder'], ['member:2' as AgentTeamMemberId, 'lead']])
    expect(mentionNamesOf(['member:2' as AgentTeamMemberId, 'member:1' as AgentTeamMemberId, 'member:gone' as AgentTeamMemberId], handles)).toEqual(['lead', 'builder'])
  })

  it('accepts plain-prose bodies for literal mention rendering', () => {
    expect(isPlainTextBody('@lead please review the diff')).toBe(true)
    expect(isPlainTextBody('two lines\nwith a normal break')).toBe(true)
  })

  it('rejects Markdown-bearing bodies from literal mention rendering', () => {
    expect(isPlainTextBody('run this:\n```js\nconst lead = 1\n```')).toBe(false)
    expect(isPlainTextBody('use `npm test` here')).toBe(false)
    expect(isPlainTextBody('## heading body')).toBe(false)
    expect(isPlainTextBody('- list item')).toBe(false)
    expect(isPlainTextBody('> quoted line')).toBe(false)
    expect(isPlainTextBody('1. ordered item')).toBe(false)
    expect(isPlainTextBody('| a | b |')).toBe(false)
    expect(isPlainTextBody('see [docs](https://example.com) now')).toBe(false)
    expect(isPlainTextBody('bold **word** inside')).toBe(false)
    expect(isPlainTextBody('snake_case_word')).toBe(false)
  })

  it('maps every task status to a status dot variant', () => {
    expect(taskStatusDot('todo')).toBe('todo')
    expect(taskStatusDot('in_progress')).toBe('ongoing')
    expect(taskStatusDot('in_review')).toBe('warning')
    expect(taskStatusDot('done')).toBe('done')
    expect(taskStatusDot('closed')).toBe('closed')
  })
})
