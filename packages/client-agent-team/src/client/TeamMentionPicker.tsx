import { useState } from 'react'
import type { AgentTeamAgentMemberStatus, AgentTeamMemberId } from '@deepseek-ai/dsh-agent-team/types'
import { IconCloseOutline16, IconPlusOutline16, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TeamConversationProps } from './slots.ts'
import css from './mention.module.css'

export function TeamMentionPicker({ members, recipients, disabled, onChange, t }: {
  readonly members: readonly AgentTeamAgentMemberStatus[]
  readonly recipients: ReadonlySet<AgentTeamMemberId>
  readonly disabled: boolean
  readonly onChange: (recipients: ReadonlySet<AgentTeamMemberId>) => void
  readonly t: TeamConversationProps['t']
}) {
  const [open, setOpen] = useState(false)
  const toggle = (memberId: AgentTeamMemberId) => {
    const next = new Set(recipients)
    if (next.has(memberId)) next.delete(memberId); else next.add(memberId)
    onChange(next)
  }
  const items = members.map(status => ({ id: status.member.memberId, label: `@${status.member.handle}` }))

  return <div className={css.toolbar}>
    <Menu
      open={open}
      portal
      side="top"
      compact
      className={css.menu!}
      items={items.length === 0 ? [{ id: 'none', label: t('noMentionMembers'), disabled: true }] : items}
      selectedIds={[...recipients]}
      onSelect={id => { if (id !== 'none') toggle(id as AgentTeamAgentMemberStatus['member']['memberId']) }}
      onClose={() => { setOpen(false) }}
      anchor={<button type="button" className={css.trigger} aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={() => { setOpen(value => !value) }}><IconPlusOutline16 size={14} />{t('addMention')}</button>}
    />
    {members.filter(status => recipients.has(status.member.memberId)).map(status => <button type="button" className={css.token} key={status.member.memberId} aria-label={t('removeMention', { handle: status.member.handle })} disabled={disabled} onClick={() => { toggle(status.member.memberId) }}><span>@{status.member.handle}</span><IconCloseOutline16 size={12} /></button>)}
  </div>
}
