import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AgentTeamClientMemberStatus,
  AgentTeamChannelRef,
  AgentTeamConfirmationToken,
  AgentTeamMemberId,
  AgentTeamRequestId,
  AgentTeamTaskRef,
  AgentTeamThreadFact,
  AgentTeamThreadReadFact,
  AgentTeamThreadRef,
  AgentTeamView,
} from '@deepseek-ai/dsh-agent-team/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
import { Button, IconChevronLeftOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TeamConversationProps } from './slots.ts'
import type { TeamWorkspaceTab } from './navigation.ts'
import { TeamComposer } from './TeamComposer.tsx'
import { TeamPresenceDot } from './TeamPresenceDot.tsx'
import { formatActivity, formatClaimState, formatTaskStatus } from './team-formatters.ts'
import css from './conversation.module.css'
import threadCss from './thread.module.css'

interface TeamThreadPageProps {
  readonly workspaceId: WorkspaceId
  readonly channelRef?: AgentTeamChannelRef
  readonly taskRef: AgentTeamTaskRef
  readonly threadRef: AgentTeamThreadRef
  readonly taskNumber?: number
  readonly originTab: TeamWorkspaceTab
  readonly backToWorkspace: TeamConversationProps['backToWorkspace']
  readonly loadChannels: TeamConversationProps['loadChannels']
  readonly readThread: TeamConversationProps['readThread']
  readonly loadThreadHistory: TeamConversationProps['loadThreadHistory']
  readonly loadChanges: TeamConversationProps['loadChanges']
  readonly loadMembers: TeamConversationProps['loadMembers']
  readonly reply: TeamConversationProps['reply']
  readonly changeTask: TeamConversationProps['changeTask']
  readonly t: TeamConversationProps['t']
}

type ReadProjection = Awaited<ReturnType<TeamThreadPageProps['readThread']>> extends infer Result
  ? Result extends { ok: true; value: infer Value } ? Value : never
  : never

type ThreadFactKey = string

function factKey(fact: AgentTeamThreadFact): ThreadFactKey {
  return fact.kind === 'message' ? `message:${fact.message.messageRef}` : `activity:${fact.activity.activityRef}`
}

function messageFact(message: ReadProjection['anchor']): AgentTeamThreadFact {
  return { kind: 'message', sequence: message.sequence, message }
}

function mergeFacts(...groups: readonly (readonly AgentTeamThreadFact[])[]): readonly AgentTeamThreadFact[] {
  const byKey = new Map<ThreadFactKey, AgentTeamThreadFact>()
  for (const group of groups) for (const fact of group) byKey.set(factKey(fact), fact)
  return [...byKey.values()].sort((left, right) => left.sequence - right.sequence)
}

function minSequence(facts: readonly AgentTeamThreadFact[]): number | undefined {
  return facts.reduce<number | undefined>((minimum, fact) => minimum === undefined ? fact.sequence : Math.min(minimum, fact.sequence), undefined)
}

function readMeta(facts: readonly AgentTeamThreadReadFact[]): ReadonlyMap<ThreadFactKey, AgentTeamThreadReadFact> {
  return new Map(facts.map(fact => [factKey(fact.fact), fact]))
}

export function TeamThreadPage(props: TeamThreadPageProps) {
  const {
    workspaceId, channelRef, taskRef, threadRef, taskNumber, originTab, backToWorkspace,
    loadChannels, readThread, loadThreadHistory,
    loadChanges, loadMembers, reply, changeTask, t,
  } = props
  const [projection, setProjection] = useState<ReadProjection>()
  const [channelView, setChannelView] = useState<AgentTeamView>()
  const [members, setMembers] = useState<readonly AgentTeamClientMemberStatus[]>([])
  const [currentFacts, setCurrentFacts] = useState<readonly AgentTeamThreadFact[]>([])
  const [olderFacts, setOlderFacts] = useState<readonly AgentTeamThreadFact[]>([])
  const [readFacts, setReadFacts] = useState<readonly AgentTeamThreadReadFact[]>([])
  const [historyCursor, setHistoryCursor] = useState<number>()
  const [historyHasMore, setHistoryHasMore] = useState(false)
  const [remainingUnreadCount, setRemainingUnreadCount] = useState(0)
  const [newFactsCount, setNewFactsCount] = useState(0)
  const [draft, setDraft] = useState('')
  const [recipients, setRecipients] = useState<ReadonlySet<AgentTeamMemberId>>(new Set())
  const [replyRequestId, setReplyRequestId] = useState<AgentTeamRequestId>()
  const [confirmation, setConfirmation] = useState<AgentTeamConfirmationToken>()
  const [statusMessage, setStatusMessage] = useState<string>()
  const [pending, setPending] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const mountedRef = useRef(false)
  const currentFactsRef = useRef<readonly AgentTeamThreadFact[]>([])
  const sequenceRef = useRef(0)
  const readRequestIdRef = useRef<AgentTeamRequestId>(crypto.randomUUID() as AgentTeamRequestId)
  const mutationRequests = useRef(new Map<string, AgentTeamRequestId>())

  const updateProjection = (next: ReadProjection): void => {
    setProjection(next)
    setReadFacts(next.facts)
    setRemainingUnreadCount(next.remainingUnreadCount)
    const anchor = messageFact(next.anchor)
    const batch = [anchor, ...next.facts.map(fact => fact.fact)]
    setCurrentFacts(current => {
      const merged = mergeFacts(current, batch)
      currentFactsRef.current = merged
      return merged
    })
    setNewFactsCount(0)
  }

  const readCurrent = async (newRequest = false): Promise<boolean> => {
    if (!mountedRef.current) return false
    if (newRequest) readRequestIdRef.current = crypto.randomUUID() as AgentTeamRequestId
    const sequence = sequenceRef.current + 1
    sequenceRef.current = sequence
    setLoading(true)
    try {
      const result = await readThread({ requestId: readRequestIdRef.current, workspaceId, taskRef })
      if (!mountedRef.current || sequence !== sequenceRef.current) return false
      if (!result.ok) { setError(result.error.message); return false }
      updateProjection(result.value)
      setError(undefined)
      return true
    } catch (cause) {
      if (mountedRef.current && sequence === sequenceRef.current) setError(cause instanceof Error ? cause.message : String(cause))
      return false
    } finally {
      if (mountedRef.current && sequence === sequenceRef.current) setLoading(false)
    }
  }

  const refreshSupplemental = async (): Promise<void> => {
    try {
      const [loadedMembers, loadedView] = await Promise.all([
        loadMembers({ workspaceId }),
        loadChannels({ workspaceId, ...(channelRef === undefined ? {} : { channelRef }), threadRef, includeActivities: false, limit: 1 }),
      ])
      if (!mountedRef.current) return
      if (loadedMembers.ok) setMembers(loadedMembers.value)
      if (loadedView.ok) setChannelView(loadedView.value)
      const failure = [loadedMembers, loadedView].find(result => !result.ok)
      if (failure !== undefined && !failure.ok) setError(failure.error.message)
    } catch (cause) {
      if (mountedRef.current) setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const refreshPassiveFacts = async (): Promise<void> => {
    try {
      const result = await loadThreadHistory({ workspaceId, taskRef, limit: 100 })
      if (!mountedRef.current || !result.ok) return
      const incoming = result.value.facts
      const known = new Set(currentFactsRef.current.map(fact => factKey(fact)))
      const additions = incoming.filter(fact => !known.has(factKey(fact)))
      setCurrentFacts(current => {
        const merged = mergeFacts(current, incoming)
        currentFactsRef.current = merged
        return merged
      })
      setNewFactsCount(current => current + additions.length)
      setProjection(current => current === undefined ? current : { ...current, task: result.value.task, thread: result.value.thread, claims: result.value.claims })
    } catch {
      // A passive refresh is an invalidation convenience; the next explicit action rereads Host state.
    }
  }

  useEffect(() => {
    let active = true
    mountedRef.current = true
    setProjection(undefined)
    setChannelView(undefined)
    setMembers([])
    setCurrentFacts([])
    currentFactsRef.current = []
    setOlderFacts([])
    setReadFacts([])
    setHistoryCursor(undefined)
    setHistoryHasMore(false)
    setRemainingUnreadCount(0)
    setNewFactsCount(0)
    setError(undefined)
    setStatusMessage(undefined)
    void (async () => {
      const read = await readCurrent()
      if (!read || !active) return
      try {
        const history = await loadThreadHistory({ workspaceId, taskRef, limit: 20 })
        if (!active || !history.ok) return
        setCurrentFacts(current => {
          const merged = mergeFacts(current, history.value.facts)
          currentFactsRef.current = merged
          return merged
        })
        setHistoryCursor(history.value.cursor)
        setHistoryHasMore(history.value.hasMore)
      } catch {
        // The initial read remains usable when optional older history is unavailable.
      }
    })()
    void refreshSupplemental()
    void (async () => {
      let version = 0
      while (active) {
        try {
          const changed = await loadChanges({ afterVersion: version })
          if (!active) return
          if (!changed.ok) { setError(changed.error.message); return }
          if (changed.value.version > version) {
            version = changed.value.version
            await Promise.all([refreshSupplemental(), refreshPassiveFacts()])
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
      sequenceRef.current += 1
    }
  }, [workspaceId, taskRef, threadRef])

  const loadOlder = async (): Promise<void> => {
    if (historyHasMore === false && historyCursor === undefined) return
    const beforeSequence = historyCursor ?? minSequence(currentFactsRef.current)
    if (beforeSequence === undefined) return
    setLoading(true)
    try {
      const result = await loadThreadHistory({ workspaceId, taskRef, beforeSequence, limit: 20 })
      if (!mountedRef.current) return
      if (!result.ok) { setError(result.error.message); return }
      setOlderFacts(current => mergeFacts(current, result.value.facts))
      setHistoryCursor(result.value.cursor)
      setHistoryHasMore(result.value.hasMore)
      setError(undefined)
    } catch (cause) {
      if (mountedRef.current) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }

  const activeProjection = projection
  const task = activeProjection?.task
  const thread = activeProjection?.thread
  const taskClaims = activeProjection?.claims ?? []
  const effectiveChannelRef = task?.channelRef ?? channelRef
  const channelMemberIds = useMemo(() => new Set(channelView?.members.filter(item => item.channelRef === effectiveChannelRef).map(item => item.memberId) ?? []), [channelView, effectiveChannelRef])
  const channelMembers = members.filter(status => channelMemberIds.size === 0 || channelMemberIds.has(status.member.memberId))
  const metadata = useMemo(() => readMeta(readFacts), [readFacts])
  const unreadIndex = useMemo(() => {
    const all = mergeFacts([messageFact(activeProjection?.anchor ?? ({ messageRef: 'missing', sequence: 0 } as never)), ...readFacts.map(fact => fact.fact), ...currentFacts])
    return all.findIndex(fact => metadata.get(factKey(fact))?.unread === true)
  }, [activeProjection?.anchor, readFacts, currentFacts, metadata])

  const memberName = (memberId: AgentTeamMemberId): string => {
    if (memberId === channelView?.humanMemberId) return t('human')
    const status = members.find(candidate => candidate.member.memberId === memberId)
    return status === undefined ? t('memberUnknown') : `@${status.member.handle}`
  }

  const renderFact = (fact: AgentTeamThreadFact) => {
    if (fact.kind === 'message') {
      const sender = memberName(fact.message.sender)
      return <article className={css.messageRow} key={factKey(fact)}>
        <div className={css.messageIdentity} aria-hidden="true">{sender.replace('@', '').slice(0, 1).toUpperCase()}</div>
        <div className={css.messageBody}><strong>{sender}</strong><p>{fact.message.body}</p></div>
      </article>
    }
    return <p className={threadCss.activityRow} key={factKey(fact)}><span className={threadCss.activityMark} aria-hidden="true" /><span className={threadCss.activityText}>{formatActivity(fact.activity, { t, actorName: memberName, claims: taskClaims })}</span></p>
  }

  const refreshAfterFence = async (): Promise<void> => {
    await readCurrent(true)
    await refreshSupplemental()
  }

  const mutateTask = async (action: 'accept' | 'close' | 'reopen'): Promise<void> => {
    if (pending || task === undefined || thread === undefined) return
    setPending(true)
    setError(undefined)
    const key = `task:${action}`
    const requestId = mutationRequests.current.get(key) ?? crypto.randomUUID() as AgentTeamRequestId
    mutationRequests.current.set(key, requestId)
    try {
      const result = await changeTask({ requestId, workspaceId, taskRef: task.taskRef, action, baseRevision: thread.revision })
      if (!result.ok) { setError(result.error.message); return }
      if (result.value.kind === 'committed') {
        mutationRequests.current.delete(key)
        const committed = result.value as Extract<typeof result.value, { kind: 'committed' }>
        setProjection(current => current === undefined ? current : { ...current, task: committed.task, thread: committed.thread, claims: committed.claims })
        setCurrentFacts(current => {
          const merged = mergeFacts(current, [{ kind: 'activity', sequence: committed.activity.sequence, activity: committed.activity }])
          currentFactsRef.current = merged
          return merged
        })
        await readCurrent(true)
        await refreshSupplemental()
      } else if (result.value.kind === 'unread_required') {
        setError(t('unreadRequired', { count: result.value.unreadCount }))
        mutationRequests.current.delete(key)
        await refreshAfterFence()
      } else {
        setError(t('staleRevision'))
        mutationRequests.current.delete(key)
        await refreshPassiveFacts()
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally { setPending(false) }
  }

  const sendReply = async (): Promise<void> => {
    if (pending || task === undefined || thread === undefined || draft.trim() === '') return
    const id = replyRequestId ?? crypto.randomUUID() as AgentTeamRequestId
    setReplyRequestId(id)
    setPending(true)
    setError(undefined)
    try {
      const result = await reply({ requestId: id, workspaceId, taskRef: task.taskRef, body: draft.trim(), baseRevision: thread.revision, recipients: [...recipients].sort(), ...(confirmation === undefined ? {} : { confirmationToken: confirmation }) })
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      if (result.value.kind === 'committed') {
        const committed = result.value as Extract<typeof result.value, { kind: 'committed' }>
        setCurrentFacts(current => {
          const merged = mergeFacts(current, [{ kind: 'message', sequence: committed.message.sequence, message: committed.message }])
          currentFactsRef.current = merged
          return merged
        })
        setProjection(current => current === undefined ? current : { ...current, task: committed.task, thread: committed.thread })
        setDraft('')
        setRecipients(new Set())
        setReplyRequestId(undefined)
        setConfirmation(undefined)
        setStatusMessage(undefined)
        await refreshSupplemental()
      } else if (result.value.kind === 'confirmation_required') {
        setConfirmation(result.value.confirmationToken)
        setStatusMessage(t('mentionConfirmation'))
      } else if (result.value.kind === 'unread_required') {
        setError(t('unreadRequired', { count: result.value.unreadCount }))
        setConfirmation(undefined)
        setStatusMessage(undefined)
        setReplyRequestId(undefined)
        await refreshAfterFence()
      } else if (result.value.kind === 'stale_revision') {
        setError(t('staleRevision'))
        setConfirmation(undefined)
        setStatusMessage(undefined)
        setReplyRequestId(undefined)
        await refreshPassiveFacts()
      } else {
        setError(`Agent Member(s) must already follow this Thread: ${result.value.memberIds.join(', ')}`)
        setConfirmation(undefined)
        setStatusMessage(undefined)
        setReplyRequestId(undefined)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally { setPending(false) }
  }

  const currentFactsWithAnchor = mergeFacts(activeProjection === undefined ? [] : [messageFact(activeProjection.anchor)], currentFacts)
  const unreadBoundary = unreadIndex >= 0 ? unreadIndex : undefined
  const risks = taskClaims.filter(claim => claim.state === 'active').flatMap(claim => {
    const status = members.find(candidate => candidate.member.memberId === claim.owner)
    return status?.presence === 'error' ? [{ claim, status }] : []
  })
  const backLabel = originTab === 'channels' ? t('backToChannel') : t('backToWorkspace')

  return <main className={css.surface} data-team-thread={threadRef}>
    <div className={css.surfaceHeader}>
      <div className={css.backRow}><Button size="sm" icon={<IconChevronLeftOutline14 />} onClick={backToWorkspace}>{backLabel}</Button></div>
      <header className={css.headerRow}>
        <div className={css.headerCopy}>
          <h1>{task === undefined ? 'Task …' : `Task #${taskNumber ?? '…'}`}</h1>
          <div className={threadCss.statusLine}>{task === undefined ? <p>{t('loadingThread')}</p> : <span className={threadCss.status}>{formatTaskStatus(task.status, t)}</span>}</div>
        </div>
        {task !== undefined && thread !== undefined && <div className={css.headerActions}>
          {task.resolution === 'open' && task.status === 'in_review' && <Button size="sm" variant="primary" disabled={pending} onClick={() => { void mutateTask('accept') }}>{t('acceptTask')}</Button>}
          {task.resolution === 'open' && <Button size="sm" variant="outline" disabled={pending} onClick={() => { void mutateTask('close') }}>{t('closeTask')}</Button>}
          {task.resolution !== 'open' && <Button size="sm" variant="primary" disabled={pending} onClick={() => { void mutateTask('reopen') }}>{t('reopenTask')}</Button>}
        </div>}
      </header>
      {risks.length > 0 && <section className={threadCss.riskSection} aria-label={t('runtimeRisk')}>
        <h2>{t('runtimeRisk')}</h2>
        {risks.map(({ claim, status }) => <p className={threadCss.riskRow} key={claim.claimRef}><TeamPresenceDot status={status} t={t} /><span>{t('runtimeRiskDetail', { member: status.member.handle, diagnostic: status.diagnostic ?? t('statusError') })} · {claim.direction}</span></p>)}
      </section>}
      {task !== undefined && thread !== undefined && <section className={threadCss.workSection} aria-label={t('claims')}>
        <div className={threadCss.workHeading}><h2>{t('claims')}</h2><span className={threadCss.claimState}>{taskClaims.length}</span></div>
        <div className={threadCss.claimList}>
          {taskClaims.length === 0 && <p className={threadCss.emptyClaims}>{t('noClaims')}</p>}
          {taskClaims.map(claim => {
            const ownerStatus = members.find(status => status.member.memberId === claim.owner)
            return <article className={threadCss.claimRow} key={claim.claimRef}>
              {ownerStatus === undefined ? <span /> : <TeamPresenceDot status={ownerStatus} t={t} />}
              <strong className={threadCss.claimOwner}>{memberName(claim.owner)}</strong>
              <span className={threadCss.claimDirection}>{claim.direction}</span>
              <small className={threadCss.claimState}>{formatClaimState(claim.state, t)}</small>
            </article>
          })}
        </div>
      </section>}
    </div>

    <section className={css.timeline} aria-label={t('participants')}>
      <div className={css.timelineContent}>
        {loading && projection === undefined && error === undefined && <p className={css.loadingState}><span className={css.loadingMark} aria-hidden="true" />{t('loadingThread')}</p>}
        {projection === undefined && error !== undefined && <div className={css.errorState} role="alert"><span>{error}</span><Button size="sm" variant="outline" onClick={() => { void readCurrent() }}>{t('retry')}</Button></div>}
        {olderFacts.length > 0 && <section className={threadCss.historySection} aria-label={t('olderHistory')}><h2>{t('olderHistory')}</h2>{olderFacts.map(renderFact)}</section>}
        {historyHasMore && <div className={css.timelineAction}><Button size="sm" onClick={() => { void loadOlder() }}>{t('loadOlder')}</Button></div>}
        {currentFactsWithAnchor.length > 0 && <section className={threadCss.publicSection} aria-label={t('participants')}>
          {currentFactsWithAnchor.map((fact, index) => <Fragment key={`${factKey(fact)}-wrap`}>{unreadBoundary === index && <p className={threadCss.unreadBoundary} role="separator"><span>{t('unreadBoundary')}</span></p>}{renderFact(fact)}</Fragment>)}
        </section>}
        {newFactsCount > 0 && <div className={threadCss.newUpdates} role="status"><span>{t('readNewUpdates', { count: newFactsCount })}</span><Button size="sm" variant="outline" disabled={loading} onClick={() => { void readCurrent(true) }}>{t('readNewUpdates', { count: newFactsCount })}</Button></div>}
        {remainingUnreadCount > 0 && <div className={css.timelineAction} role="status"><span>{t('remainingUnread', { count: remainingUnreadCount })}</span><Button size="sm" onClick={() => { void readCurrent(true) }} disabled={loading}>{t('continueReading')}</Button></div>}
      </div>
    </section>

    {projection !== undefined && task !== undefined && thread !== undefined ? <TeamComposer
      members={channelMembers}
      recipients={recipients}
      draft={draft}
      disabled={task.resolution === 'closed'}
      pending={pending}
      {...(statusMessage === undefined ? {} : { confirmation: statusMessage })}
      {...(error === undefined ? {} : { error })}
      onDraftChange={next => { setDraft(next); setConfirmation(undefined); setReplyRequestId(undefined); setStatusMessage(undefined) }}
      onRecipientsChange={next => { setRecipients(next); setConfirmation(undefined); setReplyRequestId(undefined); setStatusMessage(undefined) }}
      onSubmit={() => { void sendReply() }}
      t={t}
    /> : <div />}
  </main>
}
