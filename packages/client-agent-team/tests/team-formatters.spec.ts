import { describe, expect, it } from 'vitest'
import type { AgentTeamActivity, AgentTeamClaim, AgentTeamMemberId } from '@wowyuarm/dsh-agent-team/types'
import { zh } from '../src/client/locales.ts'
import type { TeamConversationProps } from '../src/client/slots.ts'
import { formatActivity, formatClaimState, formatMessageTime, formatTaskStatus, isPlainTextBody, isSingleBrandedRef, mentionNamesOf, planMessageBody, shouldClampMessage, splitBrandedRefs, splitMentionNames, taskStatusDot } from '../src/client/team-formatters.ts'

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

  it('splits branded refs, tolerating doubled colons and canonicalizing them', () => {
    const refText = 'task:0f0ad7ce-11d3-4c05-8a9e-6f2b1c9d7e01'
    expect(splitBrandedRefs(`源头 ${refText} 结束`)).toEqual([
      { text: '源头 ' },
      { text: refText, ref: refText },
      { text: ' 结束' },
    ])
    // A doubled colon or uppercase UUID from model output still resolves,
    // canonicalized to the lowercase single-colon ref the Host mints.
    expect(splitBrandedRefs('见 TASK::0F0AD7CE-11D3-4C05-8A9E-6F2B1C9D7E01 即可')).toEqual([
      { text: '见 ' },
      { text: 'TASK::0F0AD7CE-11D3-4C05-8A9E-6F2B1C9D7E01', ref: refText },
      { text: ' 即可' },
    ])
    // A tripled colon is not a ref, and prose colons never linkify.
    expect(splitBrandedRefs('task:::0f0ad7ce-11d3-4c05-8a9e-6f2b1c9d7e01')).toEqual([
      { text: 'task:::0f0ad7ce-11d3-4c05-8a9e-6f2b1c9d7e01' },
    ])
    // Abbreviated UUIDs — plain hex runs or truncations with hyphens — are
    // ref candidates; resolution later decides whether they exist.
    expect(splitBrandedRefs('尾缀 task:0f0ad7 与截断 task:0f0ad7ce-11d3')).toEqual([
      { text: '尾缀 ' },
      { text: 'task:0f0ad7', ref: 'task:0f0ad7' },
      { text: ' 与截断 ' },
      { text: 'task:0f0ad7ce-11d3', ref: 'task:0f0ad7ce-11d3' },
    ])
    // Below 6 hex chars a branded-looking run stays prose.
    expect(splitBrandedRefs('task:cafe 是咖啡')).toEqual([
      { text: 'task:cafe 是咖啡' },
    ])
  })

  it('detects strings whose whole content is one branded ref', () => {
    expect(isSingleBrandedRef(' task::0f0ad7ce-11d3-4c05-8a9e-6f2b1c9d7e01 ')).toBe(true)
    expect(isSingleBrandedRef('thread:0f0ad7ce-11d3-4c05-8a9e-6f2b1c9d7e01')).toBe(true)
    expect(isSingleBrandedRef('编号 task:0f0ad7ce-11d3-4c05-8a9e-6f2b1c9d7e01')).toBe(false)
    expect(isSingleBrandedRef('task:0f0ad7ce-11d3-4c05-8a9e-6f2b1c9d7e01 task:0f0ad7ce-11d3-4c05-8a9e-6f2b1c9d7e02')).toBe(false)
    expect(isSingleBrandedRef('')).toBe(false)
    // Abbreviated UUID prefixes count as ref candidates once they carry the
    // branded prefix plus at least 6 hex chars; length decides below that.
    expect(isSingleBrandedRef('task:0f0ad7ce')).toBe(true)
    expect(isSingleBrandedRef('task:cafe')).toBe(false)
  })

  it('maps mention refs to canonical handles through the member table', () => {
    const handles = new Map([['member:1' as AgentTeamMemberId, 'builder'], ['member:2' as AgentTeamMemberId, 'lead']])
    expect(mentionNamesOf(['member:2' as AgentTeamMemberId, 'member:1' as AgentTeamMemberId, 'member:gone' as AgentTeamMemberId], handles)).toEqual(['lead', 'builder'])
  })

  it('keeps the Human mention renderable when the Agent roster omits it', () => {
    const handles = new Map([['member:builder' as AgentTeamMemberId, 'builder']])
    expect(mentionNamesOf(['member:human' as AgentTeamMemberId, 'member:builder' as AgentTeamMemberId], handles)).toEqual(['human', 'builder'])
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

  it('plans Human bodies as inline mentions with the unmatched fallback row', () => {
    const plan = planMessageBody('你好 @builder 请看', { human: true, mentionNames: ['builder', 'tester'], canOpenRefs: true })
    expect(plan.render).toBe('inline')
    expect(plan.inline?.segments).toEqual([
      { text: '你好 ', mention: false },
      { text: '@builder', mention: true, name: 'builder' },
      { text: ' 请看', mention: false },
    ])
    expect(plan.fallbackNames).toEqual(['tester'])
    expect(plan.fallbackRefs).toEqual([])
    expect(plan.taskRefs).toEqual([])
  })

  it('keeps a plain Agent body literal only when it carries navigable refs', () => {
    const plain = planMessageBody('纯文本回复', { human: false, canOpenRefs: true })
    expect(plain.render).toBe('markdown')
    const task = planMessageBody('请看 task:0123abcd-0000-0000-0000-000000000000', { human: false, canOpenRefs: true })
    expect(task.render).toBe('literal')
    expect(task.taskRefs).toEqual(['task:0123abcd-0000-0000-0000-000000000000'])
    const abbreviated = planMessageBody('请看 task:0123abcd', { human: false, canOpenRefs: true })
    expect(abbreviated.render).toBe('literal')
    expect(abbreviated.taskRefs).toEqual(['task:0123abcd'])
  })

  it('keeps rich Agent bodies on Markdown and paints their refs inline when navigation is available', () => {
    const body = '# 标题\n\n见 channel:0123abcd-0000-0000-0000-000000000000'
    const plan = planMessageBody(body, { human: false, mentionNames: ['tester'], canOpenRefs: true })
    expect(plan.render).toBe('markdown')
    expect(plan.richAgentBody).toBe(true)
    // Rich Markdown refs render at their authored position through the
    // post-render pass, so the trailing chip row keeps only unmatched names.
    expect(plan.fallbackRefs).toEqual([])
    expect(plan.fallbackNames).toEqual(['tester'])
    expect(plan.taskRefs).toEqual([])
  })

  it('keeps the full mention row and no ref links on surfaces without navigation', () => {
    const plan = planMessageBody('你好 @builder', { human: true, mentionNames: ['builder'], canOpenRefs: false })
    expect(plan.render).toBe('inline')
    expect(plan.fallbackNames).toEqual([])
    const rich = planMessageBody('**粗体** @builder', { human: false, mentionNames: ['builder'], canOpenRefs: false })
    expect(rich.render).toBe('markdown')
    expect(rich.fallbackNames).toEqual(['builder'])
    expect(rich.fallbackRefs).toEqual([])
    expect(rich.taskRefs).toEqual([])
    // Without navigation the post-render pass cannot paint refs inline, so
    // rich Markdown bodies keep their branded refs in the trailing row.
    const refBody = planMessageBody('**粗体** 见 channel:0123abcd-0000-0000-0000-000000000000', { human: false, mentionNames: ['builder'], canOpenRefs: false })
    expect(refBody.render).toBe('markdown')
    expect(refBody.fallbackRefs).toEqual(['channel:0123abcd-0000-0000-0000-000000000000'])
  })

  it('strips attachment prompt lines and keeps the raw body when stripping empties it', () => {
    const plan = planMessageBody('[attachment] /tmp/a.png\n看图', { human: true, canOpenRefs: false })
    expect(plan.displayBody).toBe('看图')
    const raw = planMessageBody('[attachment] /tmp/a.png', { human: true, canOpenRefs: false })
    expect(raw.displayBody).toBe('[attachment] /tmp/a.png')
  })

  it('maps every task status to a status dot variant', () => {
    expect(taskStatusDot('todo')).toBe('todo')
    expect(taskStatusDot('in_progress')).toBe('ongoing')
    expect(taskStatusDot('in_review')).toBe('warning')
    expect(taskStatusDot('done')).toBe('done')
    expect(taskStatusDot('closed')).toBe('quiet')
  })

  it('clamps bodies purely by their displayed character count', () => {
    expect(shouldClampMessage('短消息')).toBe(false)
    expect(shouldClampMessage('字'.repeat(600))).toBe(false)
    expect(shouldClampMessage('字'.repeat(601))).toBe(true)
  })
})
