import { useSyncExternalStore } from 'react'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  AgentTeamChannelRef, AgentTeamResolveTaskRefsRequest, AgentTeamResolveTaskRefsResult, AgentTeamTaskRef, AgentTeamThreadRef,
} from '@wowyuarm/dsh-agent-team/types'

/** Navigation facts for one branded Task ref, resolved once per session. */
export interface ResolvedTaskRef {
  readonly taskRef: AgentTeamTaskRef
  readonly channelRef: AgentTeamChannelRef
  readonly threadRef: AgentTeamThreadRef
  readonly taskNumber: number
}

type Listener = () => void

const resolved = new Map<AgentTeamTaskRef, ResolvedTaskRef>()
const pending = new Set<AgentTeamTaskRef>()
/** Refs the Host did not recognize; never re-queried (no retry loops). */
const unresolvable = new Set<AgentTeamTaskRef>()
const listeners = new Set<Listener>()
let version = 0

const emit = (): void => {
  version += 1
  for (const listener of listeners) listener()
}

const subscribe = (listener: Listener): (() => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Stable snapshot token; the map is read directly after this changes. */
const getSnapshot = (): number => version

/** React binding: re-renders the caller when any ref resolution lands. */
export const useResolvedTaskRefVersion = (): number => useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

export const cachedResolvedTaskRef = (taskRef: AgentTeamTaskRef): ResolvedTaskRef | undefined => resolved.get(taskRef)

/** Store one resolution (click path) and wake every rendered link. */
export const rememberResolvedTaskRef = (entry: ResolvedTaskRef): void => {
  resolved.set(entry.taskRef, entry)
  pending.delete(entry.taskRef)
  emit()
}

/** Compare refs by branded prefix plus hyphen-stripped UUID, so abbreviated spellings line up with their full form. */
function refKeyOf(ref: string): string {
  return ref.toLowerCase().replaceAll('-', '')
}

/**
 * Click-path Host lookup: remember every resolved entry and hand them back
 * for immediate navigation. The Host keeps `resolved` in the same order as
 * the input `taskRefs` (one entry per resolvable input, unknowns omitted);
 * the pairing walk below relies on that contract, so it must be preserved
 * together with this implementation.
 */
export const hostTaskRefLookup = (
  resolveTaskRefs: (request: AgentTeamResolveTaskRefsRequest) => Promise<RemoteResult<AgentTeamResolveTaskRefsResult>>,
  workspaceId: AgentTeamResolveTaskRefsRequest['workspaceId'],
): ((taskRefs: readonly AgentTeamTaskRef[]) => Promise<readonly ResolvedTaskRef[]>) =>
  async taskRefs => {
    const result = await resolveTaskRefs({ workspaceId, taskRefs })
    if (!result.ok) return []
    const entries = result.value.resolved
    // The Host answers with full refs even for abbreviated inputs; the
    // returned entries keep the input order, so walk both sides and remember
    // each authored spelling as an alias of its resolution.
    let entryIndex = 0
    for (const requested of taskRefs) {
      const entry = entries[entryIndex]
      if (entry === undefined || !refKeyOf(entry.taskRef).startsWith(refKeyOf(requested))) continue
      if (entry.taskRef !== requested) rememberResolvedTaskRef({ ...entry, taskRef: requested })
      rememberResolvedTaskRef(entry)
      entryIndex += 1
    }
    return entries
  }

/** Resolve one Task ref through the Host and jump to its home Channel Thread. */
export const jumpToTaskThread = (
  resolveTaskRefs: (request: AgentTeamResolveTaskRefsRequest) => Promise<RemoteResult<AgentTeamResolveTaskRefsResult>>,
  workspaceId: AgentTeamResolveTaskRefsRequest['workspaceId'],
  taskRef: AgentTeamTaskRef,
  selectThread: (threadRef: AgentTeamThreadRef, channelRef?: AgentTeamChannelRef, taskRef?: AgentTeamTaskRef, taskNumber?: number) => void,
): void => {
  void resolveTaskRefs({ workspaceId, taskRefs: [taskRef] }).then(result => {
    if (!result.ok) return
    const hit = result.value.resolved[0]
    if (hit !== undefined) selectThread(hit.threadRef, hit.channelRef, hit.taskRef, hit.taskNumber)
  })
}

/**
 * Batch-resolve unknown refs through the Host lookup. Concurrent callers
 * deduplicate through the pending set; failures just clear the pending mark
 * so a later interaction can retry.
 */
export const resolveUnknownTaskRefs = async (
  refs: readonly AgentTeamTaskRef[],
  lookup: (taskRefs: readonly AgentTeamTaskRef[]) => Promise<readonly ResolvedTaskRef[]>,
): Promise<void> => {
  const missing = refs.filter(taskRef => !resolved.has(taskRef) && !pending.has(taskRef) && !unresolvable.has(taskRef))
  if (missing.length === 0) return
  for (const taskRef of missing) pending.add(taskRef)
  try {
    const entries = await lookup(missing)
    for (const entry of entries) {
      resolved.set(entry.taskRef, entry)
      pending.delete(entry.taskRef)
    }
    // Refs the Host does not know are parked for the session: re-querying
    // them on every render would loop and hammer the Host.
    for (const taskRef of missing) {
      if (!resolved.has(taskRef)) unresolvable.add(taskRef)
    }
    if (entries.length > 0) emit()
  } finally {
    for (const taskRef of missing) pending.delete(taskRef)
  }
}
