import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { apply, inject } from '../src/client/index.ts'

function workspaceFeed() {
  return {
    getSnapshot: () => ({ items: [{ workspaceId: 'workspace:one' as never, title: 'One', path: '/one', sessionIds: [], createdAt: '', updatedAt: '' }], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null, baselinesReady: true, recentWorkspaceId: undefined }),
    subscribe: () => () => {},
  }
}

async function bench(persisted: string | null = null) {
  vi.stubGlobal('localStorage', {
    getItem: () => persisted,
    setItem: vi.fn(),
    removeItem: vi.fn(),
  })
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx))
  ctx.provide('remote', { $mount: async () => async () => {} } as never)
  ctx.provide('remote.agentTeam', {})
  ctx.provide('workspaces', {
    list: workspaceFeed(),
    pickDirectory: vi.fn(async () => null),
    create: vi.fn(),
  } as never)
  const slots = ctx.get('slots') as SlotRegistry
  const root = () => null
  slots.register({ name: 'root', children: {
    sidebar: { kind: 'single', scope: 'root' },
    conversation: { kind: 'single', scope: 'session-maybe' },
  } } as never, root)
  slots.register({ name: 'sidebar', children: {
    'sidebar.workspaces': { kind: 'single', scope: 'root' },
    'sidebar.settings': { kind: 'single', scope: 'root' },
    'sidebar.footer.action': { kind: 'list', scope: 'root' },
  } } as never, root)
  slots.register({ name: 'sidebar.workspaces', priority: 0 }, root)
  slots.register({ name: 'sidebar.settings', priority: 0 }, root)
  slots.register({ name: 'conversation', priority: 0 }, root)
  return { ctx, slots }
}

describe('Team Client slot takeover', () => {
  it('enters and leaves Team mode by shadowing and restoring the three primary seats', async () => {
    const { ctx, slots } = await bench()
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    expect(slots.entriesOfSlot('sidebar.workspaces')).toHaveLength(1)
    expect(slots.entriesOfSlot('conversation')).toHaveLength(1)
    expect(slots.entriesOfSlot('sidebar.settings')).toHaveLength(1)
    expect(slots.entries('sidebar.footer.action')).toHaveLength(1)

    ctx.teamNavigation.actions().enterTeam()
    expect(slots.entries('sidebar.workspaces')).toHaveLength(2)
    expect(slots.entries('conversation')).toHaveLength(2)
    expect(slots.entries('sidebar.settings')).toHaveLength(2)
    expect(slots.entriesOfSlot('sidebar.workspaces')[0]!.options.priority).toBe(-100)
    expect(slots.spec('sidebar.workspaces.directoryFlow')).toBeUndefined()

    ctx.teamNavigation.actions().leaveTeam()
    expect(slots.entries('sidebar.workspaces')).toHaveLength(1)
    expect(slots.entries('conversation')).toHaveLength(1)
    expect(slots.entries('sidebar.settings')).toHaveLength(1)

    await fiber.dispose()
    expect(slots.entries('sidebar.footer.action')).toHaveLength(0)
    expect(slots.spec('sidebar.workspaces.directoryFlow')).toBeUndefined()
  })

  it('fails loudly when another takeover claims a Team primary seat at the same priority', async () => {
    const { ctx, slots } = await bench()
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    ctx.teamNavigation.actions().enterTeam()
    expect(() => slots.register({ name: 'conversation', priority: -100 }, () => null))
      .toThrow(/already has a registration at priority -100/i)
  })

  it('repeats enter and leave without leaking shadows, then restores every shipped seat on unload', async () => {
    const { ctx, slots } = await bench()
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    for (let index = 0; index < 3; index += 1) {
      ctx.teamNavigation.actions().enterTeam()
      expect(slots.entriesOfSlot('conversation')[0]!.options.priority).toBe(-100)
      ctx.teamNavigation.actions().leaveTeam()
      expect(slots.entries('sidebar.workspaces')).toHaveLength(1)
      expect(slots.entries('conversation')).toHaveLength(1)
      expect(slots.entries('sidebar.settings')).toHaveLength(1)
    }
    ctx.teamNavigation.actions().enterTeam()
    await fiber.dispose()
    expect(slots.entries('sidebar.workspaces')).toHaveLength(1)
    expect(slots.entries('conversation')).toHaveLength(1)
    expect(slots.entries('sidebar.settings')).toHaveLength(1)
    expect(slots.entries('sidebar.footer.action')).toHaveLength(0)
  })

  it('mounts Team shadows immediately when persisted mode is Team', async () => {
    const { ctx, slots } = await bench(JSON.stringify({ mode: 'team', workspaceId: 'workspace:one' }))
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(ctx.teamNavigation.getSnapshot().mode).toBe('team')
    expect(slots.entries('conversation')).toHaveLength(2)
    await fiber.dispose()
    expect(slots.entries('conversation')).toHaveLength(1)
  })
})
