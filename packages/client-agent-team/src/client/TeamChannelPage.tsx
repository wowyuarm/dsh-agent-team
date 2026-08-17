import { useEffect, useState } from 'react'
import type { AgentTeamAgentMemberStatus, AgentTeamChannelRef, AgentTeamMemberId, AgentTeamSendMessageRequest, AgentTeamView } from '@deepseek-ai/dsh-agent-team/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
import type { TeamConversationProps } from './slots.ts'
import css from './team.module.css'

interface TeamChannelPageProps {
  readonly workspaceId: WorkspaceId
  readonly channelRef: AgentTeamChannelRef
  readonly loadChannels: TeamConversationProps['loadChannels']
  readonly loadChanges: TeamConversationProps['loadChanges']
  readonly loadMembers: TeamConversationProps['loadMembers']
  readonly sendMessage: TeamConversationProps['sendMessage']
  readonly selectThread: TeamConversationProps['selectThread']
  readonly t: TeamConversationProps['t']
}

export function TeamChannelPage({ workspaceId, channelRef, loadChannels, loadChanges, loadMembers, sendMessage, selectThread, t }: TeamChannelPageProps) {
  const [view, setView] = useState<AgentTeamView>()
  const [members, setMembers] = useState<readonly AgentTeamAgentMemberStatus[]>([])
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState(false)
  const [recipients, setRecipients] = useState<ReadonlySet<AgentTeamMemberId>>(new Set())
  const [pendingSend, setPendingSend] = useState<AgentTeamSendMessageRequest>()
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

  return <main className={css.teamConversation} data-team-channel={channelRef}>
    {channel === undefined && !loading && <p className={css.emptyWorkspace}>{t('emptyChannels')}</p>}
    {channel !== undefined && <>
      <header className={css.channelPageHeader}><h1># {channel.name}</h1><p>{channel.description}</p></header>
      <section className={css.channelTimeline} aria-label={t('channels')}>
        {view?.hasMore && <button type="button" className={css.textButton} onClick={() => { void loadOlder() }}>{t('loadOlder')}</button>}
        {view?.items.length === 0 && <p className={css.emptyWorkspace}>{t('emptyMessages')}</p>}
        {view?.items.map(item => {
          const senderStatus = members.find(member => member.member.memberId === item.message.sender)
          const human = item.message.sender === view.humanMemberId
          const sender = human ? t('human') : senderStatus?.member.handle ?? item.message.sender
          return <article className={css.messageRow} key={item.message.messageRef}>
            <div className={css.messageIdentity} aria-hidden="true">{sender.slice(0, 1).toUpperCase()}</div>
            <div><strong title={senderStatus?.member.description}>{sender}</strong><small>{human ? t('memberHuman') : t('memberAgent')}</small><p>{item.message.body}</p>{item.message.topLevel && <button type="button" className={css.textButton} onClick={() => { selectThread(item.thread.threadRef) }}>{`Task #${item.taskNumber} · ${item.task.status} · ${item.messageCount} messages`}</button>}</div>
          </article>
        })}
      </section>
      <form className={css.channelComposer} onSubmit={event => { event.preventDefault(); void send() }}>
        <fieldset className={css.mentionPicker} disabled={pending}>
          <legend>{t('mentions')}</legend>
          {members.filter(status => view?.members.some(item => item.channelRef === channelRef
            && item.memberId === status.member.memberId) && status.member.state !== 'inactive').map(status => (
            <label key={status.member.memberId}><input type="checkbox" checked={recipients.has(status.member.memberId)} onChange={event => {
              setRecipients(current => { const next = new Set(current); if (event.target.checked) next.add(status.member.memberId); else next.delete(status.member.memberId); return next })
            }} />@{status.member.handle}</label>
          ))}
        </fieldset>
        <textarea aria-label={t('messageDraft')} value={draft} disabled={pending} onChange={event => { setDraft(event.target.value) }} rows={3} />
        <button type="submit" className={css.primaryButton} disabled={pending || draft.trim() === ''}>{pending ? t('sendingMessage') : t('sendMessage')}</button>
      </form>
    </>}
    {error !== undefined && <p className={css.error} role="alert">{error}</p>}
  </main>
}

