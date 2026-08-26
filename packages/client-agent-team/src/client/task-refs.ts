import { useSyncExternalStore } from 'react'
import type { AgentTeamChannelRef, AgentTeamTaskRef, AgentTeamThreadRef } from '@wowyuarm/dsh-agent-team/types'

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
