import { useEffect, useRef, useState } from 'react'
import type { AgentTeamAgentMemberStatus, AgentTeamChannelRef, AgentTeamMemberId, AgentTeamSendMessageRequest, AgentTeamView } from '@deepseek-ai/dsh-agent-team/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
import { Button, IconSendOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TeamConversationProps } from './slots.ts'
import css from './conversation.module.css'

interface TeamChannelPageProps {
  readonly workspaceId: WorkspaceId
  readonly channelRef: AgentTeamChannelRef
  readonly loadChannels: TeamConversationProps['loadChannels']
  readonly loadChanges: TeamConversationProps['loadChanges']
  readonly loadMembers: TeamConversationProps['loadMembers']
  readonly sendMessage: TeamConversationProps['sendMessage']
  readonly joinChannel: TeamConversationProps['joinChannel']
  readonly removeChannelMember: TeamConversationProps['removeChannelMember']
  readonly selectThread: TeamConversationProps['selectThread']
  readonly t: TeamConversationProps['t']
}

export function TeamChannelPage({ workspaceId, channelRef, loadChannels, loadChanges, loadMembers, sendMessage, joinChannel, removeChannelMember, selectThread, t }: TeamChannelPageProps) {
  const [view, setView] = useState<AgentTeamView>()
  const [members, setMembers] = useState<readonly AgentTeamAgentMemberStatus[]>([])
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState(false)
  const [recipients, setRecipients] = useState<ReadonlySet<AgentTeamMemberId>>(new Set())
  const [pendingSend, setPendingSend] = useState<AgentTeamSendMessageRequest>()
  const [managingMembers, setManagingMembers] = useState(false)
  const [membershipPending, setMembershipPending] = useState(false)
  const membershipRequests = useRef(new Map<string, AgentTeamSendMessageRequest['requestId']>())
  const channel = view?.channels.find(item => item.channelRef === channelRef)

  const refresh = async () => {
    setLoading(true)
    const [loaded, loadedMembers] = await Promise.all([
      loadChannels({ workspaceId, channelRef, direction: 'before', includeActivities: false, limit: 20 }),
      loadMembers({ workspaceId }),
    ])
    if (loaded.ok) setView(loaded.value); else setError(loaded.error.message)
    if (loadedMembers.ok) setMembers(loadedMembers.value); else setError(loadedMembers.error.message)
    setLoading(false)
    return loaded.ok && loadedMembers.ok
  }
  useEffect(() => {
    let active = true
    setView(undefined)
    setError(undefined)
    setLoading(true)
    void refresh()
    void (async () => {
      let version = 0
      while (active) {
        const changed = await loadChanges({ afterVersion: version })
        if (!active) return
        if (!changed.ok) { setError(changed.error.message); return }
        if (changed.value.version > version) {
          version = changed.value.version
          await refresh()
        }
      }
    })()
    return () => { active = false }
  }, [workspaceId, channelRef])

  const loadOlder = async () => {
    if (view === undefined || !view.hasMore) return
    const result = await loadChannels({ workspaceId, channelRef, direction: 'before', includeActivities: false, cursor: view.cursor, limit: 20 })
    if (!result.ok) { setError(result.error.message); return }
    const known = new Set(view.items.map(item => item.message.messageRef))
    setView(current => current === undefined ? result.value : {
      ...current,
      items: [...result.value.items.filter(item => !known.has(item.message.messageRef)), ...current.items],
      activities: [...result.value.activities, ...current.activities],
      cursor: result.value.cursor,
      hasMore: result.value.hasMore,
    })
  }

  const changeMembership = async (memberId: AgentTeamMemberId, joined: boolean) => {
    if (membershipPending) return
    setMembershipPending(true); setError(undefined)
    const key = `${joined ? 'remove' : 'join'}:${memberId}`
    const requestId = membershipRequests.current.get(key) ?? crypto.randomUUID() as AgentTeamSendMessageRequest['requestId']
    membershipRequests.current.set(key, requestId)
    const request = { requestId, workspaceId, channelRef, memberId }
    try {
      const result = joined ? await removeChannelMember(request) : await joinChannel(request)
      if (result.ok) { membershipRequests.current.delete(key); await refresh() } else setError(result.error.message)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setMembershipPending(false) }
  }

  const send = async () => {
    if (pending || draft.trim() === '') return
    const recipientIds = [...recipients].sort()
    const samePending = pendingSend !== undefined && pendingSend.workspaceId === workspaceId
      && pendingSend.channelRef === channelRef && pendingSend.body === draft.trim()
      && JSON.stringify(pendingSend.recipients) === JSON.stringify(recipientIds)
    const request: AgentTeamSendMessageRequest = samePending ? pendingSend : {
      requestId: crypto.randomUUID() as AgentTeamSendMessageRequest['requestId'], workspaceId,
      channelRef, body: draft.trim(), recipients: recipientIds,
    }
    setPendingSend(request); setPending(true); setError(undefined)
    try {
      const result = await sendMessage(request)
      if (result.ok) {
        const refreshed = await refresh()
        if (refreshed) {
          setDraft('')
          setRecipients(new Set())
          setPendingSend(undefined)
        }
      } else setError(result.error.message)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setPending(false) }
  }

  return <main className={css.surface} data-team-channel={channelRef}>
    <div className={css.surfaceHeader}>
      <header className={css.headerRow}>
        <div className={css.headerCopy}>
          <h1>{channel === undefined ? '# …' : `# ${channel.name}`}</h1>
          <p>{channel?.description ?? t('loadingChannels')}</p>
        </div>
        {channel !== undefined && <Button size="sm" variant="outline" aria-expanded={managingMembers} onClick={() => { setManagingMembers(value => !value) }}>{t('manageMembers')}</Button>}
      </header>
      {channel !== undefined && managingMembers && <section className={css.members} aria-label={t('manageMembers')}>
        {members.filter(status => status.member.state !== 'inactive').map(status => {
          const joined = view?.members.some(item => item.channelRef === channelRef && item.memberId === status.member.memberId) ?? false
          const disabled = membershipPending || (!joined && status.presence === 'unavailable')
          return <div key={status.member.memberId}><span>@{status.member.handle}</span><Button size="sm" disabled={disabled} onClick={() => { void changeMembership(status.member.memberId, joined) }}>{joined ? t('removeFromChannel') : t('addToChannel')}</Button></div>
        })}
      </section>}
    </div>

    <section className={css.timeline} aria-label={t('channels')}>
      <div className={css.timelineContent}>
        {loading && channel === undefined && <p className={css.loadingState}><span className={css.loadingMark} aria-hidden="true" />{t('loadingChannels')}</p>}
        {!loading && channel === undefined && <p className={css.emptyState}>{t('emptyChannels')}</p>}
        {view?.hasMore && <div className={css.timelineAction}><Button size="sm" onClick={() => { void loadOlder() }}>{t('loadOlder')}</Button></div>}
        {channel !== undefined && view?.items.length === 0 && <p className={css.emptyState}>{t('emptyMessages')}</p>}
        {view?.items.map(item => {
          const senderStatus = members.find(member => member.member.memberId === item.message.sender)
          const human = item.message.sender === view.humanMemberId
          const sender = human ? t('human') : senderStatus?.member.handle ?? item.message.sender
          return <article className={css.messageRow} key={item.message.messageRef}>
            <div className={css.messageIdentity} aria-hidden="true">{sender.slice(0, 1).toUpperCase()}</div>
            <div className={css.messageBody}>
              <strong title={senderStatus?.member.description}>{sender}</strong>
              <small>{human ? t('memberHuman') : t('memberAgent')}</small>
              <p>{item.message.body}</p>
              {item.message.topLevel && <Button className={css.taskLink} size="sm" onClick={() => { selectThread(item.thread.threadRef) }}>{`Task #${item.taskNumber} · ${item.task.status} · ${item.messageCount} messages`}</Button>}
            </div>
          </article>
        })}
      </div>
    </section>

    {channel !== undefined ? <form className={css.composer} onSubmit={event => { event.preventDefault(); void send() }}>
      <div className={css.composerInner}>
        <fieldset className={css.mentions} disabled={pending}>
          <legend>{t('mentions')}</legend>
          {members.filter(status => view?.members.some(item => item.channelRef === channelRef
            && item.memberId === status.member.memberId) && status.member.state !== 'inactive').map(status => (
            <label key={status.member.memberId}><input type="checkbox" checked={recipients.has(status.member.memberId)} onChange={event => {
              setRecipients(current => { const next = new Set(current); if (event.target.checked) next.add(status.member.memberId); else next.delete(status.member.memberId); return next })
            }} />@{status.member.handle}</label>
          ))}
        </fieldset>
        <div className={css.composerMain}>
          <textarea aria-label={t('messageDraft')} value={draft} disabled={pending} onChange={event => { setDraft(event.target.value) }} rows={2} />
          <Button type="submit" variant="primary" icon={<IconSendOutline16 />} disabled={pending || draft.trim() === ''}>{pending ? t('sendingMessage') : t('sendMessage')}</Button>
        </div>
        {error !== undefined && <p className={css.error} role="alert">{error}</p>}
      </div>
    </form> : <div />}
    {channel === undefined && error !== undefined && <p className={css.error} role="alert">{error}</p>}
  </main>
}
