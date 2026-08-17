import { useEffect, useRef, useState } from 'react'
import type { AgentTeamAgentMemberStatus, AgentTeamChannelRef, AgentTeamClaimRef, AgentTeamConfirmationToken, AgentTeamMemberId, AgentTeamRequestId, AgentTeamTaskRef, AgentTeamThreadRef, AgentTeamView } from '@deepseek-ai/dsh-agent-team/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
import { Button, IconChevronLeftOutline14, IconSendOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TeamConversationProps } from './slots.ts'
import { TeamPresenceDot } from './TeamPresenceDot.tsx'
import css from './conversation.module.css'

interface TeamThreadPageProps {
  readonly workspaceId: WorkspaceId
  readonly channelRef: AgentTeamChannelRef
  readonly threadRef: AgentTeamThreadRef
  readonly backToChannel: TeamConversationProps['backToChannel']
  readonly loadChannels: TeamConversationProps['loadChannels']
  readonly loadChanges: TeamConversationProps['loadChanges']
  readonly loadMembers: TeamConversationProps['loadMembers']
  readonly reply: TeamConversationProps['reply']
  readonly changeClaim: TeamConversationProps['changeClaim']
  readonly changeTask: TeamConversationProps['changeTask']
  readonly t: TeamConversationProps['t']
}

export function TeamThreadPage(props: TeamThreadPageProps) {
  const { workspaceId, channelRef, threadRef, backToChannel, loadChannels, loadChanges, loadMembers, reply, changeClaim, changeTask, t } = props
  const [view, setView] = useState<AgentTeamView>()
  const [draft, setDraft] = useState('')
  const [recipients, setRecipients] = useState<ReadonlySet<AgentTeamMemberId>>(new Set())
  const [requestId, setRequestId] = useState<AgentTeamRequestId>()
  const [confirmation, setConfirmation] = useState<AgentTeamConfirmationToken>()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const mutationRequests = useRef(new Map<string, AgentTeamRequestId>())
  const [members, setMembers] = useState<readonly AgentTeamAgentMemberStatus[]>([])

  const refresh = async () => {
    const [loaded, statuses] = await Promise.all([
      loadChannels({ workspaceId, channelRef, threadRef, direction: 'before', limit: 20 }),
      loadMembers({ workspaceId }),
    ])
    if (!loaded.ok) { setError(loaded.error.message); return false }
    if (!statuses.ok) { setError(statuses.error.message); return false }
    setView(loaded.value); setMembers(statuses.value); return true
  }
  useEffect(() => {
    let active = true
    setView(undefined)
    setError(undefined)
    void refresh()
    void (async () => {
      let version = 0
      while (active) {
        const changed = await loadChanges({ afterVersion: version })
        if (!active) return
        if (!changed.ok) { setError(changed.error.message); return }
        if (changed.value.version > version) { version = changed.value.version; await refresh() }
      }
    })()
    return () => { active = false }
  }, [workspaceId, channelRef, threadRef])

  const loadOlder = async () => {
    if (view === undefined || !view.hasMore) return
    const result = await loadChannels({ workspaceId, channelRef, threadRef, direction: 'before',
      cursor: view.cursor, limit: 20 })
    if (!result.ok) { setError(result.error.message); return }
    const known = new Set(view.items.map(item => item.message.messageRef))
    setView(currentView => currentView === undefined ? result.value : {
      ...currentView,
      items: [...result.value.items.filter(item => !known.has(item.message.messageRef)), ...currentView.items],
      activities: [...result.value.activities.filter(activity => !currentView.activities.some(current => current.activityRef === activity.activityRef)), ...currentView.activities],
      cursor: result.value.cursor,
      hasMore: result.value.hasMore,
    })
  }

  const activeView = view
  const task = activeView?.tasks.find(candidate => candidate.threadRef === threadRef)
  const thread = activeView?.threads.find(candidate => candidate.threadRef === threadRef)
  const taskNumber = task === undefined ? 0 : activeView?.taskNumbers.find(candidate => candidate.taskRef === task.taskRef)?.taskNumber ?? 0
  const mutateTask = async (action: 'accept' | 'close' | 'reopen') => {
    if (pending || task === undefined) return
    setPending(true); setError(undefined)
    const key = `task:${action}`
    const id = mutationRequests.current.get(key) ?? crypto.randomUUID() as AgentTeamRequestId
    mutationRequests.current.set(key, id)
    const result = await changeTask({ requestId: id, workspaceId, taskRef: task.taskRef, action })
    if (result.ok) { mutationRequests.current.delete(key); await refresh() } else { setError(result.error.message); await refresh() }
    setPending(false)
  }
  const mutateClaim = async (taskRef: AgentTeamTaskRef, claimRef: AgentTeamClaimRef, action: 'done' | 'release') => {
    if (pending) return
    setPending(true); setError(undefined)
    const key = `claim:${action}:${claimRef}`
    const id = mutationRequests.current.get(key) ?? crypto.randomUUID() as AgentTeamRequestId
    mutationRequests.current.set(key, id)
    const result = await changeClaim({ requestId: id, workspaceId, taskRef, action, claimRef })
    if (result.ok) { mutationRequests.current.delete(key); await refresh() } else { setError(result.error.message); await refresh() }
    setPending(false)
  }
  const sendReply = async () => {
    if (pending || task === undefined || thread === undefined || draft.trim() === '') return
    const id = requestId ?? crypto.randomUUID() as AgentTeamRequestId
    setRequestId(id); setPending(true); setError(undefined)
    const result = await reply({ requestId: id, workspaceId, taskRef: task.taskRef, body: draft.trim(),
      baseRevision: thread.revision, recipients: [...recipients].sort(), ...(confirmation === undefined ? {} : { confirmationToken: confirmation }) })
    if (!result.ok) {
      setError(result.error.message)
      setConfirmation(undefined)
      setRequestId(undefined)
      await refresh()
    } else if (result.value.kind === 'committed') {
      if (await refresh()) { setDraft(''); setRecipients(new Set()); setRequestId(undefined); setConfirmation(undefined) }
    } else {
      setConfirmation(result.value.confirmationToken); setError(t('mentionConfirmation'))
    }
    setPending(false)
  }

  return <main className={css.surface} data-team-thread={threadRef}>
    <div className={css.surfaceHeader}>
      <div className={css.backRow}><Button size="sm" icon={<IconChevronLeftOutline14 />} onClick={backToChannel}>{t('backToChannel')}</Button></div>
      <header className={css.headerRow}>
        <div className={css.headerCopy}>
          <h1>{task === undefined ? 'Task …' : `Task #${taskNumber}`}</h1>
          <p>{task?.status ?? t('loadingChannels')}</p>
        </div>
        {activeView !== undefined && task !== undefined && thread !== undefined && <div className={css.headerActions}>
          {task.resolution === 'open' && task.status === 'in_review' && <Button size="sm" variant="primary" disabled={pending} onClick={() => { void mutateTask('accept') }}>{t('acceptTask')}</Button>}
          {task.resolution === 'open' && <Button size="sm" variant="outline" disabled={pending} onClick={() => { void mutateTask('close') }}>{t('closeTask')}</Button>}
          {task.resolution !== 'open' && <Button size="sm" variant="primary" disabled={pending} onClick={() => { void mutateTask('reopen') }}>{t('reopenTask')}</Button>}
        </div>}
      </header>
      {activeView !== undefined && task !== undefined && thread !== undefined && <>
        <section className={css.participants} aria-label={t('participants')}>
          {members.filter(status => activeView.members.some(item => item.channelRef === channelRef && item.memberId === status.member.memberId)).map(status => <div key={status.member.memberId}><TeamPresenceDot status={status} t={t} /><span title={status.member.description}>@{status.member.handle}</span></div>)}
        </section>
        <section className={css.claims} aria-label={t('claims')}>
          {activeView.claims.filter(claim => claim.taskRef === task.taskRef).map(claim => {
            const owner = members.find(status => status.member.memberId === claim.owner)?.member.handle ?? claim.owner
            return <article key={claim.claimRef}><strong>@{owner}</strong><span>{claim.direction}</span><small>{claim.state}</small>{claim.state === 'active' && task.resolution === 'open' && <div><Button size="sm" disabled={pending} onClick={() => { void mutateClaim(task.taskRef, claim.claimRef, 'done') }}>{t('markClaimDone')}</Button><Button size="sm" disabled={pending} onClick={() => { void mutateClaim(task.taskRef, claim.claimRef, 'release') }}>{t('releaseClaim')}</Button></div>}</article>
          })}
        </section>
      </>}
    </div>

    <section className={css.timeline} aria-label={t('participants')}><div className={css.timelineContent}>
      {activeView === undefined && <p className={css.loadingState}><span className={css.loadingMark} aria-hidden="true" />{t('loadingChannels')}</p>}
      {activeView?.hasMore && <div className={css.timelineAction}><Button size="sm" onClick={() => { void loadOlder() }}>{t('loadOlder')}</Button></div>}
      {activeView !== undefined && [...activeView.items.map(item => ({ kind: 'message' as const, sequence: item.message.sequence, item })), ...activeView.activities.map(activity => ({ kind: 'activity' as const, sequence: activity.sequence, activity }))].sort((left, right) => left.sequence - right.sequence).map(entry => entry.kind === 'message' ? <article className={css.messageRow} key={entry.item.message.messageRef}><div className={css.messageBody}><strong>{entry.item.message.sender === activeView.humanMemberId ? t('human') : members.find(status => status.member.memberId === entry.item.message.sender)?.member.handle ?? entry.item.message.sender}</strong><p>{entry.item.message.body}</p></div></article> : <p className={css.activity} key={entry.activity.activityRef}>{`${entry.activity.kind} · ${entry.activity.actor}`}</p>)}
    </div></section>

    {activeView !== undefined && task !== undefined && thread !== undefined ? <form className={css.composer} onSubmit={event => { event.preventDefault(); void sendReply() }}><div className={css.composerInner}>
      <fieldset className={css.mentions} disabled={pending || task.resolution !== 'open'}><legend>{t('mentions')}</legend>{members.filter(status => activeView.members.some(item => item.channelRef === channelRef && item.memberId === status.member.memberId)).map(status => <label key={status.member.memberId}><input type="checkbox" checked={recipients.has(status.member.memberId)} onChange={event => { setRecipients(currentSet => { const next = new Set(currentSet); if (event.target.checked) next.add(status.member.memberId); else next.delete(status.member.memberId); return next }) }} />@{status.member.handle}</label>)}</fieldset>
      <div className={css.composerMain}>
        <textarea aria-label={t('messageDraft')} value={draft} disabled={pending || task.resolution !== 'open'} onChange={event => { setDraft(event.target.value) }} rows={2} />
        <Button type="submit" variant="primary" icon={<IconSendOutline16 />} disabled={pending || task.resolution !== 'open' || draft.trim() === ''}>{t('sendMessage')}</Button>
      </div>
      {error !== undefined && <p className={css.error} role="alert">{error}</p>}
    </div></form> : <div />}
    {activeView === undefined && error !== undefined && <p className={css.error} role="alert">{error}</p>}
  </main>
}
