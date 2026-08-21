import { describe, expect, it } from 'vitest'
import type { AgentTeamActivity, AgentTeamClaim } from '@wowyuarm/dsh-agent-team/types'
import { zh } from '../src/client/locales.ts'
import type { TeamConversationProps } from '../src/client/slots.ts'
import { formatActivity, formatClaimState, formatTaskStatus } from '../src/client/team-formatters.ts'

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
})
