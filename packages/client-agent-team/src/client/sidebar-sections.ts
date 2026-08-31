/**
 * Human presentation preference for the Team sidebar: whether each disclosure
 * section (workspaces / channels / agents) is expanded. The state lives in
 * this browser only — it is UI taste, never a shared Team fact, so nothing
 * here touches the ledger. Same storage discipline as `sidebar-order.ts`: one
 * localStorage key, defensive parsing, a read-through cache over the raw
 * payload so writes from other tabs are picked up, and an in-memory fallback
 * when storage is unavailable.
 */
import { useCallback, useSyncExternalStore } from 'react'
import type { WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'

/** Which sidebar section a collapse state belongs to. */
export type TeamSidebarSectionKind = 'workspaces' | 'channels' | 'agents'

const STORAGE_KEY = 'dsh.agent-team.sidebar-sections'

function sectionKey(workspaceId: WorkspaceId | undefined, kind: TeamSidebarSectionKind): string | undefined {
  // The workspaces section is workspace-independent; the two panels are
  // per-workspace because the Team shell remounts them on workspace switch.
  return workspaceId === undefined ? (kind === 'workspaces' ? kind : undefined) : `${workspaceId}|${kind}`
}

const MEMORY_ONLY = Symbol('sidebar-sections.memory')

/** Read-through parse cache over the raw persisted payload; see `sidebar-order.ts`. */
let cachedRaw: string | null | typeof MEMORY_ONLY | undefined
let cachedCollapsed: ReadonlySet<string> = new Set()

function storedCollapsed(): ReadonlySet<string> {
  let raw: string | null = null
  try {
    raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY)
  } catch {
    raw = null
  }
  if (cachedRaw !== undefined && raw !== null && raw === (cachedRaw as string)) return cachedCollapsed
  if (raw === null) {
    if (cachedRaw === MEMORY_ONLY) return cachedCollapsed
    cachedRaw = raw
    cachedCollapsed = new Set()
    return cachedCollapsed
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object')
    const keys = (parsed as Record<string, unknown>).collapsed
    if (!Array.isArray(keys) || !keys.every(key => typeof key === 'string')) throw new Error('bad shape')
    cachedRaw = raw
    cachedCollapsed = new Set(keys)
    return cachedCollapsed
  } catch {
    // Corrupted payloads degrade to "no preference"; the next valid write
    // replaces them.
    return new Set()
  }
}

function writeCollapsed(collapsed: ReadonlySet<string>): void {
  cachedCollapsed = collapsed
  try {
    if (typeof localStorage === 'undefined') throw new Error('no localStorage')
    const raw = JSON.stringify({ collapsed: [...collapsed] })
    localStorage.setItem(STORAGE_KEY, raw)
    cachedRaw = raw
    return
  } catch {
    // Private mode and quota failures do not block folding; the session keeps
    // serving the in-memory state above.
    cachedRaw = MEMORY_ONLY
  }
}

const listeners = new Set<() => void>()

/**
 * Effective expanded state for one sidebar section: `false` only when this
 * browser explicitly collapsed it. Booleans are primitives, so the snapshot
 * is naturally identity-stable for `useSyncExternalStore`.
 */
export function useSidebarSectionOpen(workspaceId: WorkspaceId | undefined, kind: TeamSidebarSectionKind): boolean {
  const key = sectionKey(workspaceId, kind)
  const subscribe = useCallback((listener: () => void) => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }, [])
  return useSyncExternalStore(subscribe,
    () => key === undefined ? true : !storedCollapsed().has(key),
    () => key === undefined ? true : !storedCollapsed().has(key))
}

/**
 * The only mutation path: record one section's expanded state for this
 * browser. Unknown keys (missing workspace) no-op so an unloaded workspace
 * never persists a phantom preference.
 */
export function setSidebarSectionOpen(workspaceId: WorkspaceId | undefined, kind: TeamSidebarSectionKind, open: boolean): void {
  const key = sectionKey(workspaceId, kind)
  if (key === undefined) return
  const next = new Set(storedCollapsed())
  if (open) next.delete(key)
  else next.add(key)
  writeCollapsed(next)
  for (const listener of listeners) listener()
}
