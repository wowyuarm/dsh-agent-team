import { useEffect, useRef, useState } from 'react'
import type { AgentTeamAgentMemberStatus, AgentTeamChannelRef, AgentTeamMemberId, AgentTeamSendMessageRequest, AgentTeamView } from '@deepseek-ai/dsh-agent-team/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TeamConversationProps } from './slots.ts'
import { TeamComposer } from './TeamComposer.tsx'
import { TeamPresenceDot } from './TeamPresenceDot.tsx'
import { formatTaskStatus } from './team-formatters.ts'
import channelCss from './channel.module.css'
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
  const [membershipPending, setMembershipPending] = useState<ReadonlySet<AgentTeamMemberId>>(new Set())
  const [membershipErrors, setMembershipErrors] = useState<ReadonlyMap<AgentTeamMemberId, string>>(new Map())
  const membershipRequests = useRef(new Map<string, AgentTeamSendMessageRequest['requestId']>())
  const manageTriggerRef = useRef<HTMLSpanElement>(null)
  const memberListRef = useRef<HTMLDivElement>(null)
  const mountedRef = useRef(false)
  const refreshSequenceRef = useRef(0)
  const channel = view?.channels.find(item => item.channelRef === channelRef)
  const channelMemberIds = new Set(view?.members.filter(item => item.channelRef === channelRef).map(item => item.memberId) ?? [])
  const channelMembers = members.filter(status => channelMemberIds.has(status.member.memberId) && status.member.state !== 'inactive')

  const refresh = async (clearError = false) => {
    if (!mountedRef.current) return false
    const sequence = refreshSequenceRef.current + 1
    refreshSequenceRef.current = sequence
    setLoading(true)
    if (clearError) setError(undefined)
    try {
      const [loaded, loadedMembers] = await Promise.all([
        loadChannels({ workspaceId, channelRef, direction: 'before', topLevelOnly: true, includeActivities: false, limit: 20 }),
        loadMembers({ workspaceId }),
      ])
      if (!mountedRef.current || sequence !== refreshSequenceRef.current) return false
      if (loaded.ok) setView(loaded.value); else setError(loaded.error.message)
      if (loadedMembers.ok) setMembers(loadedMembers.value); else setError(loadedMembers.error.message)
      return loaded.ok && loadedMembers.ok
    } catch (cause) {
      if (mountedRef.current && sequence === refreshSequenceRef.current) setError(cause instanceof Error ? cause.message : String(cause))
      return false
    } finally {
      if (mountedRef.current && sequence === refreshSequenceRef.current) setLoading(false)
    }
  }
  useEffect(() => {
    let active = true
    mountedRef.current = true
    setView(undefined)
    setError(undefined)
    setLoading(true)
    setRecipients(new Set())
    setManagingMembers(false)
    void refresh()
    void (async () => {
      let version = 0
      while (active) {
        try {
          const changed = await loadChanges({ afterVersion: version })
          if (!active) return
          if (!changed.ok) { setError(changed.error.message); return }
          if (changed.value.version > version) {
            version = changed.value.version
            await refresh()
          }
        } catch (cause) {
          if (active) setError(cause instanceof Error ? cause.message : String(cause))
          return
        }
      }
    })()
    return () => {
      active = false
      mountedRef.current = false
      refreshSequenceRef.current += 1
    }
  }, [workspaceId, channelRef])

  useEffect(() => {
    if (!managingMembers) return
    queueMicrotask(() => { memberListRef.current?.querySelector('button')?.focus() })
  }, [managingMembers])

  const loadOlder = async () => {
    if (view === undefined || !view.hasMore) return
    try {
      const result = await loadChannels({ workspaceId, channelRef, direction: 'before', topLevelOnly: true, includeActivities: false, cursor: view.cursor, limit: 20 })
      if (!mountedRef.current) return
      if (!result.ok) { setError(result.error.message); return }
      const known = new Set(view.items.map(item => item.message.messageRef))
      setView(current => current === undefined ? result.value : {
        ...current,
        items: [...result.value.items.filter(item => !known.has(item.message.messageRef)), ...current.items],
        activities: [...result.value.activities, ...current.activities],
        cursor: result.value.cursor,
        hasMore: result.value.hasMore,
      })
    } catch (cause) {
      if (mountedRef.current) setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const closeMembers = () => {
    setManagingMembers(false)
    queueMicrotask(() => { manageTriggerRef.current?.querySelector('button')?.focus() })
  }

  const changeMembership = async (memberId: AgentTeamMemberId, joined: boolean) => {
    if (membershipPending.has(memberId)) return
    setMembershipPending(current => new Set(current).add(memberId))
    setMembershipErrors(current => { const next = new Map(current); next.delete(memberId); return next })
    const key = `${joined ? 'remove' : 'join'}:${memberId}`
    const requestId = membershipRequests.current.get(key) ?? crypto.randomUUID() as AgentTeamSendMessageRequest['requestId']
    membershipRequests.current.set(key, requestId)
    const request = { requestId, workspaceId, channelRef, memberId }
    try {
      const result = joined ? await removeChannelMember(request) : await joinChannel(request)
      if (result.ok) {
        membershipRequests.current.delete(key)
        await refresh()
      } else {
        setMembershipErrors(current => new Map(current).set(memberId, result.error.message))
      }
    } catch (cause) {
      setMembershipErrors(current => new Map(current).set(memberId, cause instanceof Error ? cause.message : String(cause)))
    } finally {
      setMembershipPending(current => { const next = new Set(current); next.delete(memberId); return next })
    }
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
      if (!result.ok) setError(result.error.message)
      else if (result.value.kind === 'committed') {
        await refresh()
        setDraft('')
        setRecipients(new Set())
        setPendingSend(undefined)
      } else if (result.value.kind === 'confirmation_required') {
        setPendingSend({ ...request, confirmationToken: result.value.confirmationToken })
        setError(t('mentionConfirmation'))
      } else {
        setError(`Agent Member(s) must already follow this Thread: ${result.value.memberIds.join(', ')}`)
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setPending(false) }
  }

  return <main className={css.surface} data-team-channel={channelRef}>
    <div className={css.surfaceHeader}>
      <header className={css.headerRow}>
        <div className={css.headerCopy}>
          <h1>{channel === undefined ? '# …' : `# ${channel.name}`}</h1>
          {channel !== undefined && <p>{channel.description}</p>}
          {channel !== undefined && <div className={channelCss.headerMeta}>
            <span>{t('memberCount', { count: channelMembers.length })}</span>
          </div>}
        </div>
        {channel !== undefined && <span ref={manageTriggerRef}><Button size="sm" variant="outline" aria-haspopup="dialog" onClick={() => { setManagingMembers(true) }}>{t('manageMembers')}</Button></span>}
      </header>
    </div>

    <Modal open={managingMembers} onClose={closeMembers} title={t('channelMembers')} {...(channel === undefined ? {} : { description: `# ${channel.name} · ${t('memberCount', { count: channelMembers.length })}` })} closeLabel={t('close')} contentClassName={channelCss.modalBody!}>
      <div ref={memberListRef} className={channelCss.memberList}>
        {members.filter(status => status.member.state !== 'inactive').map(status => {
          const joined = channelMemberIds.has(status.member.memberId)
          const rowPending = membershipPending.has(status.member.memberId)
          const disabled = rowPending || (!joined && status.presence === 'unavailable')
          const rowError = membershipErrors.get(status.member.memberId)
          return <div className={channelCss.memberRow} key={status.member.memberId}>
            <TeamPresenceDot status={status} t={t} />
            <span className={channelCss.memberCopy}><strong>@{status.member.handle}</strong><small>{status.member.description}</small></span>
            <Button className={channelCss.memberAction} size="sm" disabled={disabled} onClick={() => { void changeMembership(status.member.memberId, joined) }}>{rowPending ? t('membershipUpdating') : joined ? t('removeFromChannel') : t('addToChannel')}</Button>
            {rowError !== undefined && <p className={channelCss.memberError} role="alert">{rowError}</p>}
          </div>
        })}
      </div>
    </Modal>

    <section className={css.timeline} aria-label={t('channels')}>
      <div className={css.timelineContent}>
        {loading && channel === undefined && error === undefined && <p className={css.loadingState}><span className={css.loadingMark} aria-hidden="true" />{t('loadingChannels')}</p>}
        {!loading && channel === undefined && error === undefined && <p className={css.emptyState}>{t('emptyChannels')}</p>}
        {!loading && channel === undefined && error !== undefined && <div className={css.errorState} role="alert"><span>{error}</span><Button size="sm" variant="outline" onClick={() => { void refresh(true) }}>{t('retry')}</Button></div>}
        {view?.hasMore && <div className={css.timelineAction}><Button size="sm" onClick={() => { void loadOlder() }}>{t('loadOlder')}</Button></div>}
        {channel !== undefined && view?.items.length === 0 && <div className={css.emptyState}>
          <strong>{t('emptyMessages')}</strong>
          <span>{t('emptyMessagesHint')}</span>
        </div>}
        {view?.items.map(item => {
          const senderStatus = members.find(member => member.member.memberId === item.message.sender)
          const human = item.message.sender === view.humanMemberId
          const sender = human ? t('human') : senderStatus?.member.handle ?? item.message.sender
          return <article className={css.messageRow} key={item.message.messageRef}>
            <div className={css.messageIdentity} aria-hidden="true">{sender.slice(0, 1).toUpperCase()}</div>
            <div className={css.messageBody}>
              <strong title={senderStatus?.member.description}>{sender}</strong>
              <p>{item.message.body}</p>
              {item.message.topLevel && <button type="button" className={channelCss.taskFooter} aria-label={t('openTask', { number: item.taskNumber })} onClick={() => { selectThread(item.task.taskRef, item.thread.threadRef, channelRef, item.taskNumber) }}>
                <span className={channelCss.taskNumber}>{`Task #${item.taskNumber}`}</span>
                <span className={channelCss.taskStatus}>{formatTaskStatus(item.task.status, t)}</span>
                <span className={channelCss.taskCount}>{t('taskMessageCount', { count: item.messageCount })}</span>
                <span className={channelCss.taskArrow} aria-hidden="true">→</span>
              </button>}
            </div>
          </article>
        })}
      </div>
    </section>

    {channel !== undefined ? <TeamComposer
      members={channelMembers}
      recipients={recipients}
      draft={draft}
      disabled={false}
      pending={pending}
      {...(error === undefined ? {} : { error })}
      onDraftChange={next => { setDraft(next); setPendingSend(undefined) }}
      onRecipientsChange={next => { setRecipients(next); setPendingSend(undefined) }}
      onSubmit={() => { void send() }}
      t={t}
    /> : <div />}
  </main>
}
