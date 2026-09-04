import { Fragment, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type {
  AgentTeamAttachmentId,
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
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { Button, DisclosureRow, IconChevronLeftOutline14, IconChecklistOutline14, Modal, Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TeamConversationProps } from './slots.ts'
import type { TeamDraftKey, TeamDraftStore } from './drafts.ts'
import { TeamComposer } from './TeamComposer.tsx'
import { TeamPresenceDot } from './TeamPresenceDot.tsx'
import { TeamMessage } from './TeamMessage.tsx'
import { TeamRunDivider } from './TeamRunDivider.tsx'
import { formatActivity, formatClaimState, formatTaskStatus, formatTaskTitle, mentionNamesOf, taskStatusDot } from './team-formatters.ts'
import { TeamStateDot } from './TeamStateDot.tsx'
import { mintRequestId } from './requests.ts'
import { daySeparatorLabel, isRunGap, timelineDayKey } from './team-separators.ts'
import { useTimelineScroll } from './timeline-scroll.ts'
import { hostTaskRefLookup, jumpToTaskThread } from './task-refs.ts'
import { bytesToBase64 } from './attachment-preview.ts'
import css from './conversation.module.css'
import threadCss from './thread.module.css'

interface TeamThreadPageProps {
  readonly workspaceId: WorkspaceId
  readonly channelRef?: AgentTeamChannelRef
  readonly taskRef?: AgentTeamTaskRef
  readonly threadRef: AgentTeamThreadRef
  readonly taskNumber?: number
  readonly backToWorkspace: TeamConversationProps['backToWorkspace']
  readonly loadChannels: TeamConversationProps['loadChannels']
  readonly readThread: TeamConversationProps['readThread']
  readonly loadThreadHistory: TeamConversationProps['loadThreadHistory']
  readonly threadObservations: TeamConversationProps['threadObservations']
  readonly subscribeChanges: TeamConversationProps['subscribeChanges']
  readonly loadMembers: TeamConversationProps['loadMembers']
  readonly drafts: TeamDraftStore
  readonly getAttachment: TeamConversationProps['getAttachment']
  readonly reply: TeamConversationProps['reply']
  readonly changeTask: TeamConversationProps['changeTask']
  readonly promoteThread: TeamConversationProps['promoteThread']
  readonly putAttachment: TeamConversationProps['putAttachment']
  readonly selectChannel: TeamConversationProps['selectChannel']
  readonly selectThread: TeamConversationProps['selectThread']
  readonly resolveTaskRefs: TeamConversationProps['resolveTaskRefs']
  readonly t: TeamConversationProps['t']
}

type ReadProjection = Awaited<ReturnType<TeamThreadPageProps['readThread']>> extends infer Result
  ? Result extends { ok: true; value: infer Value } ? Value : never
  : never

type ThreadFactKey = string

function factKey(fact: AgentTeamThreadFact): ThreadFactKey {
  return fact.kind === 'message' ? `message:${fact.message.messageRef}` : `activity:${fact.activity.activityRef}`
}

function messageFact(message: ReadProjection['anchor'], mentions: readonly AgentTeamMemberId[] = []): AgentTeamThreadFact {
  return { kind: 'message', sequence: message.sequence, message, mentions }
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
    workspaceId, channelRef, taskRef, threadRef, taskNumber, backToWorkspace, selectChannel, selectThread, resolveTaskRefs, putAttachment,
    loadChannels, readThread, loadThreadHistory, threadObservations,
    subscribeChanges, loadMembers, drafts, getAttachment, reply, changeTask, promoteThread, t,
  } = props
  const threadRequest = { threadRef, ...(taskRef === undefined ? {} : { taskRef }) }
  const [projection, setProjection] = useState<ReadProjection>()
  const [channelView, setChannelView] = useState<AgentTeamView>()
  const [members, setMembers] = useState<readonly AgentTeamClientMemberStatus[]>([])
  // Current Thread followers; the composer ranks them first because a mention
  // to a follower delivers directly instead of entering the invite detour.
  const [followerIds, setFollowerIds] = useState<ReadonlySet<AgentTeamMemberId>>(() => new Set())
  const [currentFacts, setCurrentFacts] = useState<readonly AgentTeamThreadFact[]>([])
  const [olderFacts, setOlderFacts] = useState<readonly AgentTeamThreadFact[]>([])
  const [readFacts, setReadFacts] = useState<readonly AgentTeamThreadReadFact[]>([])
  const [historyCursor, setHistoryCursor] = useState<number>()
  const [historyHasMore, setHistoryHasMore] = useState(false)
  // A bounded read acknowledges at most 20 unread facts; larger backlogs need
  // continuation reads. Reads also never self-wake a change scope, so a
  // backlog beyond a handful of batches would otherwise linger forever. The
  // cap stops a pathological feed (facts arriving faster than they are read)
  // from looping without bound; the error surface keeps the remainder visible.
  const MAX_AUTO_READ_ROUNDS = 50
  const [autoReadExhausted, setAutoReadExhausted] = useState(false)
  const [newFactsCount, setNewFactsCount] = useState(0)
  // The reply draft lives in the keyed draft cache: view switches unmount
  // this page, and a refresh must not cost the half-written message either.
  const draftKey: TeamDraftKey = `thread:${threadRef}`
  const { draft, recipients } = useSyncExternalStore(drafts.subscribe, () => drafts.getSnapshot(draftKey))
  const [claimsOpen, setClaimsOpen] = useState(false)
  // Early acceptance: the Human may accept while Claims are still open; the
  // confirm dialog lists exactly what will be completed with the Task.
  const [confirmingAccept, setConfirmingAccept] = useState(false)
  useEffect(() => {
    if (confirmingAccept && projection?.task?.resolution === 'accepted') setConfirmingAccept(false)
  }, [confirmingAccept, projection?.task?.resolution])
  const [replyRequestId, setReplyRequestId] = useState<AgentTeamRequestId>()
  const [confirmation, setConfirmation] = useState<AgentTeamConfirmationToken>()
  const [statusMessage, setStatusMessage] = useState<string>()
  const [pending, setPending] = useState(false)
  // Label source for the promote/accept buttons only: a reply send also raises
  // the shared `pending` gate, and must not retitle those buttons.
  const [mutating, setMutating] = useState<'promote' | 'accept' | undefined>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const mountedRef = useRef(false)
  const currentFactsRef = useRef<readonly AgentTeamThreadFact[]>([])
  const sequenceRef = useRef(0)
  const readRequestIdRef = useRef<AgentTeamRequestId>(mintRequestId())
  const projectionRef = useRef<ReadProjection>()
  const mutationRequests = useRef(new Map<string, AgentTeamRequestId>())
  const threadLastFact = currentFacts[currentFacts.length - 1]
  const timeline = useTimelineScroll(`${currentFacts.length}:${olderFacts.length}:${threadLastFact === undefined ? '' : factKey(threadLastFact)}`)

  const updateProjection = (next: ReadProjection): void => {
    projectionRef.current = next
    setProjection(next)
    setReadFacts(next.facts)
    const anchor = messageFact(next.anchor, next.anchorMentions)
    const batch = [anchor, ...next.facts.map(fact => fact.fact)]
    setCurrentFacts(current => {
      const merged = mergeFacts(current, batch)
      currentFactsRef.current = merged
      return merged
    })
  }

  // Continue a bounded read while unread facts remain. Each round must mint a
  // fresh requestId: the Host replays a repeated id from its idempotency
  // cache, which would return the same batch forever. The loop terminates on
  // a zero remainder, a failed read (the existing error surface offers
  // retry), a superseding sequence, or the round cap.
  const drainUnread = async (): Promise<void> => {
    for (let round = 1; round <= MAX_AUTO_READ_ROUNDS; round += 1) {
      const snapshot = projectionRef.current
      if (snapshot === undefined || snapshot.remainingUnreadCount <= 0) return
      const beforeSequence = sequenceRef.current
      if (!await readCurrent(true)) return
      // A newer read or remount owns the tail now; it drains the remainder.
      if (!mountedRef.current || sequenceRef.current !== beforeSequence + 1) return
      // A stalled remainder (Host fault) must not spin the loop.
      if (projectionRef.current?.remainingUnreadCount === snapshot.remainingUnreadCount) return
    }
    setAutoReadExhausted(true)
  }

  const readCurrent = async (newRequest = false): Promise<boolean> => {
    if (!mountedRef.current) return false
    if (newRequest) readRequestIdRef.current = mintRequestId()
    const sequence = sequenceRef.current + 1
    sequenceRef.current = sequence
    setLoading(true)
    try {
      const result = await readThread({ requestId: readRequestIdRef.current, workspaceId, ...threadRequest })
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
      const result = await loadThreadHistory({ workspaceId, ...threadRequest, limit: 100 })
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
      setProjection(current => {
        const next = current === undefined ? current : { ...current, ...(result.value.task === undefined ? {} : { task: result.value.task }), thread: result.value.thread, claims: result.value.claims }
        if (next !== undefined) projectionRef.current = next
        return next
      })
      if (additions.length === 0) return
      // Every arrival while the Thread is open is acknowledged durably: the
      // timeline renders it either way, and the Human has no manual read
      // action anymore. The count only feeds the pure jump hint for a reader
      // away from the tail; a bottom-pinned reader already sees the arrivals.
      if (!timeline.isPinned()) setNewFactsCount(current => current + additions.length)
      // The acknowledgment outcome does not change what is on screen: a
      // failed read surfaces through the error surface, not through the count.
      await readCurrent(true)
    } catch {
      // A passive refresh is an invalidation convenience; the next explicit action rereads Host state.
    }
  }

  // Follower ranking is an enhancement, not a page fact: a failed observation
  // read leaves the roster order in place instead of surfacing an error.
  const refreshFollowers = async (): Promise<void> => {
    try {
      const result = await threadObservations({ workspaceId, ...threadRequest })
      if (!mountedRef.current || !result.ok) return
      setFollowerIds(new Set(result.value.followers))
    } catch {
      // The next thread-scope wake retries; ranking falls back to roster order.
    }
  }

  useEffect(() => {
    mountedRef.current = true
    projectionRef.current = undefined
    setProjection(undefined)
    setChannelView(undefined)
    setMembers([])
    setFollowerIds(new Set())
    setCurrentFacts([])
    currentFactsRef.current = []
    setOlderFacts([])
    setReadFacts([])
    setHistoryCursor(undefined)
    setHistoryHasMore(false)
    setAutoReadExhausted(false)
    setNewFactsCount(0)
    setError(undefined)
    setStatusMessage(undefined)
    const sequence = sequenceRef.current + 1
    sequenceRef.current = sequence
    setLoading(true)
    void (async () => {
      // One parallel round covers the whole first paint. The durable read no
      // longer wakes any change scope, so no second wave follows it.
      const [read, history, observations] = await Promise.all([
        readThread({ requestId: readRequestIdRef.current, workspaceId, ...threadRequest }),
        loadThreadHistory({ workspaceId, ...threadRequest, limit: 20 }).catch(() => undefined),
        threadObservations({ workspaceId, ...threadRequest }).catch(() => undefined),
      ])
      if (!mountedRef.current || sequence !== sequenceRef.current) return
      if (!read.ok) {
        setError(read.error.message)
        setLoading(false)
        return
      }
      updateProjection(read.value)
      // The Thread opens at the latest fact; the unread boundary stays
      // rendered as information, but reading is automatic from here on.
      timeline.scrollToBottom()
      if (history !== undefined && history.ok) {
        setCurrentFacts(current => {
          const merged = mergeFacts(current, history.value.facts)
          currentFactsRef.current = merged
          return merged
        })
        setHistoryCursor(history.value.cursor)
        setHistoryHasMore(history.value.hasMore)
      }
      if (observations !== undefined && observations.ok) setFollowerIds(new Set(observations.value.followers))
      setError(undefined)
      setLoading(false)
      await drainUnread()
    })()
    void refreshSupplemental()
    const disposers = [
      subscribeChanges({ kind: 'thread', threadRef }, update => {
        if (!mountedRef.current) return
        if (update.type === 'failed') { setError(update.message); return }
        void refreshPassiveFacts()
        // Attention changes wake this scope too; keep the mention ranking current.
        void refreshFollowers()
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

  // Returning to the bottom is the reader's answer to the jump hint: the
  // arrivals are on screen, their durable read already happened (or will be
  // retried by the next change wake), and the hint has nothing left to say.
  useEffect(() => {
    if (newFactsCount > 0 && timeline.isPinned()) setNewFactsCount(0)
  }, [newFactsCount, currentFacts, olderFacts, timeline])

  // The hint answers "where is the tail?"; the moment the reader is back
  // within the follow margin — by the jump click or their own scroll — it
  // must go away even when no render follows that position change.
  const handleTimelineScroll = (): void => {
    timeline.onScroll()
    if (timeline.isPinned()) setNewFactsCount(0)
  }

  const loadOlder = async (): Promise<void> => {
    if (historyHasMore === false && historyCursor === undefined) return
    const beforeSequence = historyCursor ?? minSequence(currentFactsRef.current)
    if (beforeSequence === undefined) return
    setLoading(true)
    try {
      const result = await loadThreadHistory({ workspaceId, ...threadRequest, beforeSequence, limit: 20 })
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
  const resolvedTaskNumber = taskNumber ?? channelView?.taskNumbers.find(entry => entry.taskRef === task?.taskRef)?.taskNumber
  const taskTitle = activeProjection === undefined ? undefined : formatTaskTitle(activeProjection.anchor.body)
  const taskClaims = activeProjection?.claims ?? []
  const effectiveChannelRef = task?.channelRef ?? channelRef
  const channelMemberIds = useMemo(() => new Set(channelView?.members.filter(item => item.channelRef === effectiveChannelRef).map(item => item.memberId) ?? []), [channelView, effectiveChannelRef])
  const channelMembers = members.filter(status => channelMemberIds.size === 0 || channelMemberIds.has(status.member.memberId))
  const mentionHandlesMap = useMemo(() => new Map(members.map(status => [status.member.memberId, status.member.handle.replace(/^@/, '')])), [members])
  const metadata = useMemo(() => readMeta(readFacts), [readFacts])
  const unreadIndex = useMemo(() => {
    const all = mergeFacts(
      ...(activeProjection === undefined ? [] : [[messageFact(activeProjection.anchor, activeProjection.anchorMentions)]]),
      readFacts.map(fact => fact.fact),
      currentFacts,
    )
    return all.findIndex(fact => metadata.get(factKey(fact))?.unread === true)
  }, [activeProjection?.anchor, readFacts, currentFacts, metadata])

  const memberName = (memberId: AgentTeamMemberId): string => {
    if (memberId === channelView?.humanMemberId) return t('human')
    const status = members.find(candidate => candidate.member.memberId === memberId)
    return status === undefined ? t('memberUnknown') : `@${status.member.handle}`
  }

  const messageSender = (fact: AgentTeamThreadFact): AgentTeamMemberId | undefined =>
    fact.kind === 'message' ? fact.message.sender : undefined

  const [pendingFiles, setPendingFiles] = useState<readonly File[]>([])

  // Branded-ref navigation for message bodies: channel refs hop to the
  // Channel; the open Task's own refs are already on screen, and other Tasks
  // are not resolvable from this surface, so they degrade to a no-op.
  const openRef = (ref: string): void => {
    if (ref.startsWith('channel:') && ref !== channelRef) {
      selectChannel(ref as AgentTeamChannelRef)
      return
    }
    if (ref.startsWith('thread:') && ref !== threadRef) {
      // Thread refs do not have a dedicated resolver Remote. The Host view
      // query still returns the target's home Channel and Task projection.
      void loadChannels({ workspaceId, threadRef: ref as AgentTeamThreadRef, includeActivities: false, limit: 1 }).then(result => {
        if (!result.ok) return
        const target = result.value.items[0]
        if (target === undefined) return
        const targetChannel = result.value.channels.find(channel => channel.channelRef === target.message.channelRef)
        if (targetChannel !== undefined) selectThread(target.thread.threadRef, targetChannel.channelRef, target.task?.taskRef, target.taskNumber)
      })
      return
    }
    if (ref.startsWith('task:') && ref !== taskRef) {
      // Another Task cited here: resolve its home Channel and jump.
      jumpToTaskThread(resolveTaskRefs, workspaceId, ref as AgentTeamTaskRef, selectThread)
    }
  }

  const lookupTaskRefs = hostTaskRefLookup(resolveTaskRefs, workspaceId)

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
        attachments={fact.message.attachments}
        loadAttachment={getAttachment}
        t={t}
        occurredAt={fact.message.occurredAt}
        mentionNames={mentionNamesOf(fact.mentions, mentionHandlesMap)}
        onOpenRef={openRef}
        onResolveTaskRefs={lookupTaskRefs}
        grouped={grouped}
        {...(senderStatus === undefined ? {} : { senderTitle: senderStatus.member.description })}
      />
    }
    return <p className={threadCss.activityRow} key={factKey(fact)}><span className={threadCss.activityMark} aria-hidden="true" /><span className={threadCss.activityText}>{formatActivity(fact.activity, { t, actorName: memberName, claims: taskClaims })}</span></p>
  }

  /** One run = one same-sender reply turn; activities, the unread boundary, and day changes break runs. */
  const renderFactBlocks = (facts: readonly AgentTeamThreadFact[], boundaryIndex: number | undefined): ReactNode[] => {
    const nodes: ReactNode[] = []
    let run: AgentTeamThreadFact[] = []
    let lastDay: string | undefined
    const flushRun = () => {
      if (run.length > 0) {
        nodes.push(
          <div className={css.messageRun} key={`run-${factKey(run[0]!)}`}>
            {run.map((entry, entryIndex) => {
              const previous = entryIndex > 0 ? run[entryIndex - 1] : undefined
              const turnGap = entry.kind === 'message' && isRunGap(previous?.kind === 'message' ? previous.message.occurredAt : undefined, entry.message.occurredAt)
              return <Fragment key={factKey(entry)}>
                {turnGap && <TeamRunDivider occurredAt={entry.message.occurredAt} />}
                {renderFact(entry, entryIndex > 0)}
              </Fragment>
            })}
          </div>,
        )
      }
      run = []
    }
    facts.forEach((fact, index) => {
      const occurredAt = fact.kind === 'message' ? fact.message.occurredAt : undefined
      if (occurredAt !== undefined) {
        const day = timelineDayKey(occurredAt)
        if (lastDay !== undefined && day !== lastDay) {
          flushRun()
          nodes.push(<p className={threadCss.daySeparator} key={`day-${index}`}><span>{daySeparatorLabel(occurredAt)}</span></p>)
        }
        lastDay = day
      }
      const sender = messageSender(fact)
      if (sender !== undefined && run.length > 0 && sender === messageSender(run[run.length - 1]!)) {
        run.push(fact)
        return
      }
      flushRun()
      if (boundaryIndex === index) nodes.push(<p key={`boundary-${index}`} className={threadCss.unreadBoundary} role="separator"><span>{t('unreadBoundary')}</span></p>)
      if (sender !== undefined) run.push(fact)
      else nodes.push(<Fragment key={factKey(fact)}>{renderFact(fact)}</Fragment>)
    })
    flushRun()
    return nodes
  }

  const refreshAfterFence = async (): Promise<void> => {
    timeline.scrollToBottom()
    await readCurrent(true)
    await refreshSupplemental()
    await drainUnread()
  }

  const convertToTask = async (): Promise<void> => {
    if (pending || thread === undefined || task !== undefined) return
    setPending(true)
    setMutating('promote')
    setError(undefined)
    const key = 'promote'
    const requestId = mutationRequests.current.get(key) ?? mintRequestId()
    mutationRequests.current.set(key, requestId)
    try {
      const result = await promoteThread({ requestId, workspaceId, threadRef, baseRevision: thread.revision })
      if (!result.ok) { setError(result.error.message); return }
      if (result.value.kind === 'committed') {
        mutationRequests.current.delete(key)
        const committed = result.value as Extract<typeof result.value, { kind: 'committed' }>
        setProjection(current => current === undefined ? current
          : { ...current, task: committed.task, thread: committed.thread })
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
    } finally {
      setPending(false)
      setMutating(undefined)
    }
  }

  const mutateTask = async (action: 'accept' | 'close' | 'reopen'): Promise<void> => {
    if (pending || task === undefined || thread === undefined) return
    setPending(true)
    if (action === 'accept') setMutating('accept')
    setError(undefined)
    const key = `task:${action}`
    const requestId = mutationRequests.current.get(key) ?? mintRequestId()
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
    } finally {
      setPending(false)
      setMutating(undefined)
    }
  }

  const sendReply = async (): Promise<void> => {
    if (pending || thread === undefined || draft.trim() === '') return
    const id = replyRequestId ?? mintRequestId()
    setReplyRequestId(id)
    setPending(true)
    setError(undefined)
    try {
      // Upload chosen files first; any failure aborts the reply with the
      // existing error surface and keeps the chips for a retry.
      const attachmentIds: AgentTeamAttachmentId[] = []
      for (const file of pendingFiles) {
        const uploaded = await putAttachment({
          requestId: mintRequestId(),
          workspaceId,
          name: file.name,
          mediaType: file.type === '' ? undefined : file.type,
          bytesBase64: bytesToBase64(new Uint8Array(await file.arrayBuffer())),
        })
        if (!uploaded.ok) {
          setError(uploaded.error.message)
          return
        }
        attachmentIds.push(uploaded.value.attachmentId)
      }
      const result = await reply({ requestId: id, workspaceId, threadRef, ...(task === undefined ? {} : { taskRef: task.taskRef }), body: draft.trim(), baseRevision: thread.revision, recipients: [...recipients].sort(), ...(attachmentIds.length === 0 ? {} : { attachments: attachmentIds }), ...(confirmation === undefined ? {} : { confirmationToken: confirmation }) })
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      if (result.value.kind === 'committed') {
        const committed = result.value as Extract<typeof result.value, { kind: 'committed' }>
        setCurrentFacts(current => {
          const merged = mergeFacts(current, [{ kind: 'message', sequence: committed.message.sequence, message: committed.message, mentions: [...recipients].sort() }])
          currentFactsRef.current = merged
          return merged
        })
        setProjection(current => current === undefined ? current : { ...current, ...(committed.task === undefined ? {} : { task: committed.task }), thread: committed.thread })
        drafts.clear(draftKey)
        setPendingFiles([])
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

  const currentFactsWithAnchor = mergeFacts(activeProjection === undefined ? [] : [messageFact(activeProjection.anchor, activeProjection.anchorMentions)], currentFacts)
  const unreadBoundary = unreadIndex >= 0 ? unreadIndex : undefined
  const risks = taskClaims.filter(claim => claim.state === 'active').flatMap(claim => {
    const status = members.find(candidate => candidate.member.memberId === claim.owner)
    return status?.presence === 'error' ? [{ claim, status }] : []
  })
  // Threads are always entered through a Channel page, so a Channel origin
  // returns to its timeline; a Thread restored without one returns further.
  const backLabel = channelRef === undefined ? t('backToWorkspace') : t('backToChannel')

  return <main className={css.surface} data-team-thread={threadRef}>
    <div className={css.surfaceHeader}>
      <div className={css.backRow}><Button size="sm" icon={<IconChevronLeftOutline14 />} onClick={backToWorkspace}>{backLabel}</Button></div>
      <header className={css.headerRow}>
        <div className={css.headerCopy}>
          <div className={threadCss.titleLine}>
            <h1>{task === undefined ? t('threadLabel') : t('taskLabel', { number: resolvedTaskNumber ?? '…' })}</h1>
            {task !== undefined && <Pill><TeamStateDot size={8} state={taskStatusDot(task.status)} />{formatTaskStatus(task.status, t)}</Pill>}
          </div>
          {taskTitle !== undefined && taskTitle !== '' && <p className={threadCss.taskTitle} title={taskTitle}>{taskTitle}</p>}
        </div>
        {task === undefined && thread !== undefined && <div className={css.headerActions}>
          <Button size="sm" variant="primary" disabled={pending} onClick={() => { void convertToTask() }}>{mutating === 'promote' ? t('promotingTask') : t('promoteToTask')}</Button>
        </div>}
        {/* Open tasks act here; an accepted Thread keeps its header reopen. Reopen for a
            closed Thread lives only in the composer-slot closed notice. */}
        {task !== undefined && thread !== undefined && task.resolution !== 'closed' && <div className={css.headerActions}>
          {(() => {
            const activeClaims = projection?.claims.filter(claim => claim.taskRef === task.taskRef && claim.state === 'active') ?? []
            const earlyAccept = task.resolution === 'open' && task.status === 'in_progress' && activeClaims.length > 0
            // todo Tasks accept directly: the work finished outside the
            // ledger, so there is nothing to confirm and no Claims to list.
            if (!(task.status === 'in_review' || task.status === 'todo' || earlyAccept) || task.resolution !== 'open') return null
            return <Button size="sm" variant="primary" disabled={pending}
              onClick={() => { if (earlyAccept) { setConfirmingAccept(true) } else { void mutateTask('accept') } }}>{t('acceptTask')}</Button>
          })()}
          {task.resolution === 'open'
            ? <Button size="sm" variant="outline" disabled={pending} onClick={() => { void mutateTask('close') }}>{t('closeTask')}</Button>
            : <Button size="sm" variant="primary" disabled={pending} onClick={() => { void mutateTask('reopen') }}>{t('reopenTask')}</Button>}
        </div>}
      </header>
      {risks.length > 0 && <section className={threadCss.riskSection} aria-label={t('runtimeRisk')}>
        <h2>{t('runtimeRisk')}</h2>
        {risks.map(({ claim, status }) => <p className={threadCss.riskRow} key={claim.claimRef}><TeamPresenceDot status={status} t={t} /><span>{t('runtimeRiskDetail', { member: status.member.handle, diagnostic: status.diagnostic ?? t('statusError') })} · {claim.direction}</span></p>)}
      </section>}
      {task !== undefined && thread !== undefined && (() => {
        // Recomputed here so the confirm list never shows stale rows.
        const activeClaims = projection?.claims.filter(claim => claim.taskRef === task.taskRef && claim.state === 'active') ?? []
        return <Modal
          open={confirmingAccept}
          onClose={() => { if (!pending) setConfirmingAccept(false) }}
          title={t('acceptEarlyTitle')}
          closeLabel={t('cancel')}
          footer={<>
            <Button variant="outline" disabled={pending} onClick={() => { setConfirmingAccept(false) }}>{t('cancel')}</Button>
            <Button variant="primary" disabled={pending} onClick={() => { void mutateTask('accept') }}>{mutating === 'accept' ? t('acceptingTask') : t('acceptTask')}</Button>
          </>}
        >
          <p className={css.confirmBody}>{t('acceptEarlyBody', { count: activeClaims.length })}</p>
          <ul className={css.confirmList}>
            {activeClaims.map(claim => (
              <li key={claim.claimRef}>{memberName(claim.owner)} · {claim.direction}</li>
            ))}
          </ul>
        </Modal>
      })()}
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

    <section ref={timeline.ref} onScroll={handleTimelineScroll} className={css.timeline} aria-label={t('timelineLabel')}>
      <div className={css.timelineContent}>
        {loading && projection === undefined && error === undefined && <div className={css.emptySurface}><p className={css.loadingState}><span className={css.loadingMark} aria-hidden="true" />{t('loadingThread')}</p></div>}
        {projection === undefined && error !== undefined && <div className={css.errorState} role="alert"><span>{error}</span><Button size="sm" variant="outline" onClick={() => { void readCurrent() }}>{t('retry')}</Button></div>}
        {olderFacts.length > 0 && <section className={threadCss.historySection} aria-label={t('olderHistory')}><h2>{t('olderHistory')}</h2>{renderFactBlocks(olderFacts, undefined)}</section>}
        {historyHasMore && <div className={css.timelineAction}><Button size="sm" onClick={() => { void loadOlder() }}>{t('loadOlder')}</Button></div>}
        {currentFactsWithAnchor.length > 0 && <section className={threadCss.publicSection}>
          {renderFactBlocks(currentFactsWithAnchor, unreadBoundary)}
        </section>}
        {autoReadExhausted && <div className={css.timelineAction} role="alert">
          <span>{t('autoReadIncomplete')}</span>
          <Button size="sm" onClick={() => { setAutoReadExhausted(false); void drainUnread() }} disabled={loading}>{t('retry')}</Button>
        </div>}
        {newFactsCount > 0 && <div className={threadCss.newUpdates} role="status">
          <button type="button" className={threadCss.newUpdatesJump} onClick={() => { setNewFactsCount(0); timeline.scrollToBottom() }}>{t('newUpdatesJump', { count: newFactsCount })}</button>
        </div>}
      </div>
    </section>

    {projection !== undefined && thread !== undefined ? (
      task?.resolution === 'closed'
        ? <div className={threadCss.closedBar} data-team-closed>
            {error !== undefined && <p className={css.error} role="alert">{error}</p>}
            <div className={threadCss.closedNotice}>
              <span>{t('taskClosedNotice')}</span>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => { void mutateTask('reopen') }}>{t('reopenTask')}</Button>
            </div>
          </div>
        : <TeamComposer
      key={draftKey}
      members={channelMembers}
      followerMemberIds={followerIds}
      recipients={recipients}
      draft={draft}
      pending={pending}
      {...(statusMessage === undefined ? {} : { confirmation: statusMessage })}
      {...(error === undefined ? {} : { error })}
      onDraftChange={next => { drafts.writeDraft(draftKey, next); setConfirmation(undefined); setReplyRequestId(undefined); setStatusMessage(undefined) }}
      onRecipientsChange={next => { drafts.writeRecipients(draftKey, next); setConfirmation(undefined); setReplyRequestId(undefined); setStatusMessage(undefined) }}
      onSubmit={() => { void sendReply() }}
      placeholder={t('replyPlaceholder')}
      pendingFiles={pendingFiles}
      onFilesChange={setPendingFiles}
      t={t}
    />
    ) : <div />}
  </main>
}
