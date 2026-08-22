import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
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
} from '@wowyuarm/dsh-agent-team/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
import { Button, DisclosureRow, IconChevronLeftOutline14, IconChecklistOutline14, Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TeamConversationProps } from './slots.ts'
import type { TeamWorkspaceTab } from './navigation.ts'
import { TeamComposer } from './TeamComposer.tsx'
import { TeamPresenceDot } from './TeamPresenceDot.tsx'
import { TeamMessage } from './TeamMessage.tsx'
import { formatActivity, formatClaimState, formatTaskStatus, formatTaskTitle } from './team-formatters.ts'
import { useTimelineScroll } from './timeline-scroll.ts'
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
  readonly subscribeChanges: TeamConversationProps['subscribeChanges']
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
    subscribeChanges, loadMembers, reply, changeTask, t,
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
  const [claimsOpen, setClaimsOpen] = useState(false)
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
  const threadLastFact = currentFacts[currentFacts.length - 1]
  const timeline = useTimelineScroll(`${currentFacts.length}:${olderFacts.length}:${threadLastFact === undefined ? '' : factKey(threadLastFact)}`)

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
      const shown = currentFactsRef.current
      if (shown.length === 0) return
      const known = new Set(shown.map(fact => factKey(fact)))
      // Facts older than everything already rendered are backfill of the
      // wider history window this fetch uses, not new updates; counting
      // them would re-flag already-read messages after every change wake.
      const newestShown = shown.reduce((maximum, fact) => Math.max(maximum, fact.sequence), 0)
      const additions = incoming.filter(fact => !known.has(factKey(fact)) && fact.sequence > newestShown)
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
    const sequence = sequenceRef.current + 1
    sequenceRef.current = sequence
    setLoading(true)
    void (async () => {
      // One parallel round covers the whole first paint. The durable read no
      // longer wakes any change scope, so no second wave follows it.
      const [read, history] = await Promise.all([
        readThread({ requestId: readRequestIdRef.current, workspaceId, taskRef }),
        loadThreadHistory({ workspaceId, taskRef, limit: 20 }).catch(() => undefined),
      ])
      if (!mountedRef.current || sequence !== sequenceRef.current) return
      if (!read.ok) {
        setError(read.error.message)
        setLoading(false)
        return
      }
      updateProjection(read.value)
      // Opened onto unread updates: land on the boundary instead of the floor.
      if (read.value.facts.some(fact => fact.unread)) timeline.jumpToBoundary()
      if (history !== undefined && history.ok) {
        setCurrentFacts(current => {
          const merged = mergeFacts(current, history.value.facts)
          currentFactsRef.current = merged
          return merged
        })
        setHistoryCursor(history.value.cursor)
        setHistoryHasMore(history.value.hasMore)
      }
      setError(undefined)
      setLoading(false)
    })()
    void refreshSupplemental()
    const disposers = [
      subscribeChanges({ kind: 'thread', threadRef }, update => {
        if (!mountedRef.current) return
        if (update.type === 'failed') { setError(update.message); return }
        void refreshPassiveFacts()
      }),
      subscribeChanges({ kind: 'workspace', workspaceId }, update => {
        if (!mountedRef.current) return
        if (update.type === 'failed') { setError(update.message); return }
        void refreshSupplemental()
      }),
    ]
    return () => {
      mountedRef.current = false
      sequenceRef.current += 1
      for (const dispose of disposers) dispose()
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
  const taskTitle = activeProjection === undefined ? undefined : formatTaskTitle(activeProjection.anchor.body)
  const taskClaims = activeProjection?.claims ?? []
  const effectiveChannelRef = task?.channelRef ?? channelRef
  const channelMemberIds = useMemo(() => new Set(channelView?.members.filter(item => item.channelRef === effectiveChannelRef).map(item => item.memberId) ?? []), [channelView, effectiveChannelRef])
  const channelMembers = members.filter(status => channelMemberIds.size === 0 || channelMemberIds.has(status.member.memberId))
  const mentionHandles = useMemo(() => new Set(members.map(status => status.member.handle.replace(/^@/, '').toLowerCase())), [members])
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

  const messageSender = (fact: AgentTeamThreadFact): AgentTeamMemberId | undefined =>
    fact.kind === 'message' ? fact.message.sender : undefined

  const renderFact = (fact: AgentTeamThreadFact, grouped = false) => {
    if (fact.kind === 'message') {
      const sender = memberName(fact.message.sender)
      const senderStatus = members.find(candidate => candidate.member.memberId === fact.message.sender)
      return <TeamMessage
        key={factKey(fact)}
        senderName={sender}
        memberId={fact.message.sender}
        human={fact.message.sender === channelView?.humanMemberId}
        body={fact.message.body}
        occurredAt={fact.message.occurredAt}
        {...(fact.message.sender === channelView?.humanMemberId ? { mentionHandles } : {})}
        grouped={grouped}
        {...(senderStatus === undefined ? {} : { senderTitle: senderStatus.member.description })}
      />
    }
    return <p className={threadCss.activityRow} key={factKey(fact)}><span className={threadCss.activityMark} aria-hidden="true" /><span className={threadCss.activityText}>{formatActivity(fact.activity, { t, actorName: memberName, claims: taskClaims })}</span></p>
  }

  /** One run = one same-sender reply turn; activities and the unread boundary break runs. */
  const renderFactBlocks = (facts: readonly AgentTeamThreadFact[], boundaryIndex: number | undefined): ReactNode[] => {
    const nodes: ReactNode[] = []
    let run: AgentTeamThreadFact[] = []
    const flushRun = () => {
      if (run.length > 0) nodes.push(<div className={css.messageRun} key={`run-${factKey(run[0]!)}`}>{run.map((entry, entryIndex) => renderFact(entry, entryIndex > 0))}</div>)
      run = []
    }
    facts.forEach((fact, index) => {
      const sender = messageSender(fact)
      if (sender !== undefined && run.length > 0 && sender === messageSender(run[run.length - 1]!)) {
        run.push(fact)
        return
      }
      flushRun()
      if (boundaryIndex === index) nodes.push(<p key={`boundary-${index}`} className={threadCss.unreadBoundary} role="separator" data-thread-boundary><span>{t('unreadBoundary')}</span></p>)
      if (sender !== undefined) run.push(fact)
      else nodes.push(<Fragment key={factKey(fact)}>{renderFact(fact)}</Fragment>)
    })
    flushRun()
    return nodes
  }

  const refreshAfterFence = async (): Promise<void> => {
    timeline.jumpToLatest()
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
        setError(t('memberNotFollowing', { ids: result.value.memberIds.map(memberId => `@${members.find(candidate => candidate.member.memberId === memberId)?.member.handle ?? memberId}`).join(', ') }))
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
          <div className={threadCss.titleLine}>
            <h1>{task === undefined ? 'Task …' : `Task #${taskNumber ?? '…'}`}</h1>
            {task !== undefined && <Pill>{formatTaskStatus(task.status, t)}</Pill>}
          </div>
          {taskTitle !== undefined && taskTitle !== '' && <p className={threadCss.taskTitle}>{taskTitle}</p>}
        </div>
        {/* Open tasks act here; an accepted Thread keeps its header reopen. Reopen for a
            closed Thread lives only in the composer-slot closed notice. */}
        {task !== undefined && thread !== undefined && task.resolution !== 'closed' && <div className={css.headerActions}>
          {task.status === 'in_review' && task.resolution === 'open' && <Button size="sm" variant="primary" disabled={pending} onClick={() => { void mutateTask('accept') }}>{t('acceptTask')}</Button>}
          {task.resolution === 'open'
            ? <Button size="sm" variant="outline" disabled={pending} onClick={() => { void mutateTask('close') }}>{t('closeTask')}</Button>
            : <Button size="sm" variant="primary" disabled={pending} onClick={() => { void mutateTask('reopen') }}>{t('reopenTask')}</Button>}
        </div>}
      </header>
      {risks.length > 0 && <section className={threadCss.riskSection} aria-label={t('runtimeRisk')}>
        <h2>{t('runtimeRisk')}</h2>
        {risks.map(({ claim, status }) => <p className={threadCss.riskRow} key={claim.claimRef}><TeamPresenceDot status={status} t={t} /><span>{t('runtimeRiskDetail', { member: status.member.handle, diagnostic: status.diagnostic ?? t('statusError') })} · {claim.direction}</span></p>)}
      </section>}
      {task !== undefined && thread !== undefined && <section className={threadCss.workSection} aria-label={t('claims')}>
        <DisclosureRow
          expandOnRowClick
          expandable
          open={claimsOpen}
          onToggle={() => { setClaimsOpen(current => !current) }}
          icon={<IconChecklistOutline14 size={14} />}
          title={`${t('claims')} · ${taskClaims.length}`}
        >
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
        </DisclosureRow>
      </section>}
    </div>

    <section ref={timeline.ref} onScroll={timeline.onScroll} className={css.timeline} aria-label={t('timelineLabel')}>
      <div className={css.timelineContent}>
        {loading && projection === undefined && error === undefined && <div className={css.emptySurface}><p className={css.loadingState}><span className={css.loadingMark} aria-hidden="true" />{t('loadingThread')}</p></div>}
        {projection === undefined && error !== undefined && <div className={css.errorState} role="alert"><span>{error}</span><Button size="sm" variant="outline" onClick={() => { void readCurrent() }}>{t('retry')}</Button></div>}
        {olderFacts.length > 0 && <section className={threadCss.historySection} aria-label={t('olderHistory')}><h2>{t('olderHistory')}</h2>{renderFactBlocks(olderFacts, undefined)}</section>}
        {historyHasMore && <div className={css.timelineAction}><Button size="sm" onClick={() => { void loadOlder() }}>{t('loadOlder')}</Button></div>}
        {currentFactsWithAnchor.length > 0 && <section className={threadCss.publicSection}>
          {renderFactBlocks(currentFactsWithAnchor, unreadBoundary)}
        </section>}
        {newFactsCount > 0 && <div className={threadCss.newUpdates} role="status">
          <span>{t('readNewUpdates', { count: newFactsCount })}</span>
          <Button size="sm" variant="outline" disabled={loading} onClick={() => { timeline.jumpToLatest(); void readCurrent(true) }}>{t('markRead')}</Button>
        </div>}
        {remainingUnreadCount > 0 && <div className={css.timelineAction} role="status"><span>{t('remainingUnread', { count: remainingUnreadCount })}</span><Button size="sm" onClick={() => { timeline.jumpToBoundary(); void readCurrent(true) }} disabled={loading}>{t('continueReading')}</Button></div>}
      </div>
    </section>

    {projection !== undefined && task !== undefined && thread !== undefined ? (
      task.resolution === 'closed'
        ? <div className={threadCss.closedBar} data-team-closed>
            {error !== undefined && <p className={css.error} role="alert">{error}</p>}
            <div className={threadCss.closedNotice}>
              <span>{t('taskClosedNotice')}</span>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => { void mutateTask('reopen') }}>{t('reopenTask')}</Button>
            </div>
          </div>
        : <TeamComposer
      members={channelMembers}
      recipients={recipients}
      draft={draft}
      disabled={false}
      pending={pending}
      {...(statusMessage === undefined ? {} : { confirmation: statusMessage })}
      {...(error === undefined ? {} : { error })}
      onDraftChange={next => { setDraft(next); setConfirmation(undefined); setReplyRequestId(undefined); setStatusMessage(undefined) }}
      onRecipientsChange={next => { setRecipients(next); setConfirmation(undefined); setReplyRequestId(undefined); setStatusMessage(undefined) }}
      onSubmit={() => { void sendReply() }}
      t={t}
    />
    ) : <div />}
  </main>
}
