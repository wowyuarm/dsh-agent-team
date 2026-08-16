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

function context() {
  return {
    workspaces: {
      pickDirectory: vi.fn(async () => '/work/team'),
      create: vi.fn(async ({ path }: { path: string }) => ({
        workspaceId: `workspace:${path}` as never,
        path,
        title: 'team',
        sessionIds: [],
        createdAt: '',
        updatedAt: '',
      })),
    },
  } as { workspaces: { pickDirectory: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> } }
}

describe('TeamNavigation', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', storage())
  })

  it('enters and leaves Team mode while preserving the selected Workspace', () => {
    const navigation = new TeamNavigation(context() as never)
    const changes: string[] = []
    const off = navigation.subscribe(() => { changes.push(navigation.getSnapshot().mode) })

    navigation.actions().selectWorkspace('workspace:one' as never)
    navigation.actions().enterTeam()
    navigation.actions().leaveTeam()

    expect(navigation.getSnapshot()).toEqual({ mode: 'conversation', workspaceId: 'workspace:one', activeTab: 'channels' })
    expect(changes).toEqual(['conversation', 'team', 'conversation'])
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '')).toEqual({
      mode: 'conversation', workspaceId: 'workspace:one',
    })
    off()
  })

  it('rehydrates Team mode and creates a selected Workspace through the shared service', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode: 'team', workspaceId: 'workspace:old' }))
    const ctx = context()
    const navigation = new TeamNavigation(ctx as never)

    await navigation.actions().createWorkspaceFromPath('/work/team')
    expect(ctx.workspaces.create).toHaveBeenCalledWith({ path: '/work/team' })
    navigation.actions().selectWorkspace('workspace:/work/team' as never)

    navigation.actions().selectWorkspaceTab('agents')
    expect(navigation.getSnapshot()).toEqual({ mode: 'team', workspaceId: 'workspace:/work/team', activeTab: 'agents' })
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '')).toEqual({ mode: 'team', workspaceId: 'workspace:/work/team' })
  })

  it('ignores malformed persisted state', () => {
    localStorage.setItem(STORAGE_KEY, '{broken')
    expect(new TeamNavigation(context() as never).getSnapshot()).toEqual({ mode: 'conversation', activeTab: 'channels' })
  })
})
