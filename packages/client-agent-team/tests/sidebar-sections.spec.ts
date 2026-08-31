// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, renderHook, act } from '@testing-library/react'
import { setSidebarSectionOpen, useSidebarSectionOpen } from '../src/client/sidebar-sections.ts'

beforeEach(() => { localStorage.clear() })
afterEach(cleanup)

describe('sidebar section collapse persistence', () => {
  it('defaults to expanded and remembers a collapse across remounts', () => {
    expect(renderHook(() => useSidebarSectionOpen(undefined, 'workspaces')).result.current).toBe(true)
    act(() => { setSidebarSectionOpen(undefined, 'workspaces', false) })
    expect(renderHook(() => useSidebarSectionOpen(undefined, 'workspaces')).result.current).toBe(false)
    expect(localStorage.getItem('dsh.agent-team.sidebar-sections')).toBe('{"collapsed":["workspaces"]}')
    // Re-expanding removes the key entry rather than storing `true`.
    act(() => { setSidebarSectionOpen(undefined, 'workspaces', true) })
    expect(renderHook(() => useSidebarSectionOpen(undefined, 'workspaces')).result.current).toBe(true)
    expect(localStorage.getItem('dsh.agent-team.sidebar-sections')).toBe('{"collapsed":[]}')
  })

  it('keys channels and agents per workspace, keeping the workspaces section global', () => {
    act(() => {
      setSidebarSectionOpen(undefined, 'workspaces', false)
      setSidebarSectionOpen('w1' as never, 'channels', false)
      setSidebarSectionOpen('w1' as never, 'agents', false)
    })
    expect(renderHook(() => useSidebarSectionOpen('w2' as never, 'channels')).result.current).toBe(true)
    expect(renderHook(() => useSidebarSectionOpen('w1' as never, 'channels')).result.current).toBe(false)
    expect(renderHook(() => useSidebarSectionOpen('w1' as never, 'agents')).result.current).toBe(false)
    expect(renderHook(() => useSidebarSectionOpen(undefined, 'workspaces')).result.current).toBe(false)
    // The two panels are independent keys even within one workspace.
    act(() => { setSidebarSectionOpen('w1' as never, 'agents', true) })
    expect(renderHook(() => useSidebarSectionOpen('w1' as never, 'channels')).result.current).toBe(false)
    expect(renderHook(() => useSidebarSectionOpen('w1' as never, 'agents')).result.current).toBe(true)
  })

  it('notifies live hooks about changes from any mutation site', () => {
    const hook = renderHook(() => useSidebarSectionOpen(undefined, 'workspaces'))
    act(() => { setSidebarSectionOpen(undefined, 'workspaces', false) })
    expect(hook.result.current).toBe(false)
  })

  it('falls back to expanded when storage is corrupted or unavailable', () => {
    localStorage.setItem('dsh.agent-team.sidebar-sections', '{oops')
    expect(renderHook(() => useSidebarSectionOpen(undefined, 'workspaces')).result.current).toBe(true)
    localStorage.setItem('dsh.agent-team.sidebar-sections', JSON.stringify({ collapsed: [42] }))
    expect(renderHook(() => useSidebarSectionOpen('w1' as never, 'channels')).result.current).toBe(true)
    // A corrupted store does not block a fresh write of a valid preference.
    act(() => { setSidebarSectionOpen(undefined, 'workspaces', false) })
    expect(renderHook(() => useSidebarSectionOpen(undefined, 'workspaces')).result.current).toBe(false)
  })
})
