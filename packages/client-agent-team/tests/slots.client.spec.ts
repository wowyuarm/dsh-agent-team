import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
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
  // rc.1: the client declares the model-catalog sub-namespace; the bench
  // supplies it so the takeover fiber is not left pending on inject.
  ctx.provide('remote.session', { modelCatalog: vi.fn(async () => ({ ok: true, value: { groups: [], failures: [] } })) })
  ctx.provide('conversation', { input: { for: () => ({ submit: vi.fn() }) } } as never)
  // The plugin declares these runtime services; the takeover bench only mounts
  // them, it never drives sessions or the model catalog.
  ctx.provide('sessions', {
    list: { getSnapshot: () => ({ current: undefined }), subscribe: () => () => {} },
    open: vi.fn(),
    openSubagent: vi.fn(),
    search: vi.fn(async () => ({ items: [], hasMore: false })),
    searchResultLimit: 20,
  } as never)
  ctx.provide('connection', { api: { llm: { models: vi.fn(async () => ({ result: { ok: true, value: { groups: [], failures: [] } } })) } } } as never)
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
  slots.register({ name: 'conversation', priority: 0, children: {
    'conversation.composer.bar': { kind: 'single', scope: 'session-maybe' },
  } } as never, root)
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

  it('keeps Team chrome mounted for a Member Session view and restores the return session on leave', async () => {
    const { ctx, slots } = await bench()
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const sessions = ctx.get('sessions') as unknown as { open: ReturnType<typeof vi.fn>; list: { getSnapshot: () => { current?: string } } }
    sessions.list.getSnapshot = () => ({ current: 'session:human-origin' })

    ctx.teamNavigation.actions().selectWorkspace('workspace:one' as never)
    ctx.teamNavigation.actions().enterTeam()

    // Drive the real wiring through the workspaces shadow's injected remotes —
    // the same payload the Agent card button consumes.
    const shadow = slots.entriesOfSlot('sidebar.workspaces').find(entry => entry.options.priority === -100)
    expect(shadow).toBeDefined()
    const injected = (shadow!.inject as () => Record<string, unknown>)()
    ;(injected.openMemberSession as (sessionId: string) => void)('session:builder')

    expect(sessions.open).toHaveBeenCalledWith('session:builder')
    expect(ctx.teamNavigation.getSnapshot()).toMatchObject({ mode: 'team', memberSessionId: 'session:builder', returnToSessionId: 'session:human-origin' })
    // The conversation seat yields to the shipped root while both sidebars stay.
    expect(slots.entries('conversation')).toHaveLength(1)
    // The Member view registers no composer surface at all: the shipped
    // InputBar owns the bar, its trigger overlay, and the dock — the Team
    // chrome is sidebar-only around the embedded session.
    expect(slots.entries('conversation.composer.bar')).toHaveLength(0)
    expect(slots.entries('conversation.input.dock')).toHaveLength(0)
    // Direct Member-to-Member navigation keeps the zero-surface invariant.
    sessions.list.getSnapshot = () => ({ current: 'session:reviewer' })
    ctx.teamNavigation.actions().enterMemberSession('session:reviewer' as never)
    expect(slots.entries('conversation.input.dock')).toHaveLength(0)
    expect(slots.entries('sidebar.workspaces')).toHaveLength(2)
    expect(slots.entriesOfSlot('sidebar.workspaces')[0]!.options.priority).toBe(-100)
    expect(slots.entriesOfSlot('sidebar.settings')[0]!.options.priority).toBe(-100)

    // The footer's wrapped leave closes the Member view and restores the
    // Human's original session before deregistering the Team chrome.
    const footer = slots.entriesOfSlot('sidebar.footer.action')[0]!
    const footerActions = (footer.inject as () => Record<string, unknown>)()
    ;(footerActions.leaveTeam as () => void)()

    expect(sessions.open).toHaveBeenLastCalledWith('session:human-origin')
    expect(ctx.teamNavigation.getSnapshot()).toEqual({ mode: 'conversation', workspaceId: 'workspace:one' })
    expect(slots.entries('conversation.input.dock')).toHaveLength(0)
    expect(slots.entriesOfSlot('conversation')).toHaveLength(1)
    expect(slots.entries('sidebar.workspaces')).toHaveLength(1)

    await fiber.dispose()
  })

  it('exits an embedded Member Session view when explicit Team navigation arrives', async () => {
    const { ctx, slots } = await bench()
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    ctx.teamNavigation.actions().enterTeam()
    ctx.teamNavigation.actions().enterMemberSession('session:builder' as never, 'session:return' as never)
    expect(slots.entries('conversation')).toHaveLength(1)

    ctx.teamNavigation.actions().selectChannel('channel:engineering' as never)
    expect(ctx.teamNavigation.getSnapshot().memberSessionId).toBeUndefined()
    expect(slots.entries('conversation')).toHaveLength(2)

    await fiber.dispose()
  })
})
