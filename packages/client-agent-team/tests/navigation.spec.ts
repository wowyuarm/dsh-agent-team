import { beforeEach, describe, expect, it, vi } from 'vitest'
import { STORAGE_KEY, TeamNavigation } from '../src/client/navigation.ts'

function storage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: () => { values.clear() },
    getItem: key => values.get(key) ?? null,
    key: index => [...values.keys()][index] ?? null,
    removeItem: key => { values.delete(key) },
    setItem: (key, value) => { values.set(key, value) },
  }
}

describe('TeamNavigation', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', storage())
  })

  it('enters and leaves Team mode while preserving the selected Workspace', () => {
    const navigation = new TeamNavigation()
    const changes: string[] = []
    const off = navigation.subscribe(() => { changes.push(navigation.getSnapshot().mode) })

    navigation.actions().selectWorkspace('workspace:one' as never)
    navigation.actions().enterTeam()
    navigation.actions().leaveTeam()

    expect(navigation.getSnapshot()).toEqual({ mode: 'conversation', workspaceId: 'workspace:one' })
    expect(changes).toEqual(['conversation', 'team', 'conversation'])
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '')).toEqual({
      mode: 'conversation', workspaceId: 'workspace:one',
    })
    off()
  })

  it('rehydrates Team mode while ignoring stale persisted fields', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode: 'team', workspaceId: 'workspace:old', activeTab: 'inbox' }))
    const navigation = new TeamNavigation()
    expect(navigation.getSnapshot()).toEqual({ mode: 'team', workspaceId: 'workspace:old' })

    navigation.actions().selectWorkspace('workspace:existing' as never)
    expect(navigation.getSnapshot()).toEqual({ mode: 'team', workspaceId: 'workspace:existing' })
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '')).toEqual({ mode: 'team', workspaceId: 'workspace:existing' })
  })

  it('ignores malformed persisted state', () => {
    localStorage.setItem(STORAGE_KEY, '{broken')
    expect(new TeamNavigation().getSnapshot()).toEqual({ mode: 'conversation' })
  })
})
