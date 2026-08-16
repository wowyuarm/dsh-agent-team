// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import type { WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
import type { AgentTeamAddMemberRequest } from '@deepseek-ai/dsh-agent-team/types'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotTestRuntime, usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { apply as applySidebar, inject as injectSidebar } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { apply, inject } from '../src/client/index.ts'

usePinnedBrowserLanguages('zh-CN')
afterEach(cleanup)
beforeEach(() => { localStorage.clear() })

type FrameProps = PropsRenderSlots<'sidebar' | 'conversation'>
function Frame({ renderSlot }: FrameProps) {
  const [collapsed, setCollapsed] = useState(false)
  return <>
    <button type="button" data-test-control onClick={() => { setCollapsed(value => !value) }}>Toggle fixture sidebar</button>
    {renderSlot('sidebar', { collapsed, width: collapsed ? 56 : 280 })}
    {renderSlot('conversation', {})}
  </>
}

function BaselineWorkspace() { return <div data-baseline-workspaces>普通工作区</div> }
function BaselineSettings() { return <div data-baseline-settings>设置</div> }
function BaselineConversation() { return <div data-baseline-conversation>普通对话</div> }
function DirectoryFlow({ open, onPicked }: { open: boolean; onPicked: (path: string) => void }) {
  return open ? <button type="button" onClick={() => { onPicked('/work/new') }}>选择 /work/new</button> : null
}

async function runtimeWithTeam(persisted?: { mode: 'team'; workspaceId?: string }) {
  if (persisted !== undefined) localStorage.setItem('dsh.agent-team.navigation', JSON.stringify(persisted))
  const runtime = await SlotTestRuntime.create()
  const locale = new LocaleRuntime(runtime.ctx)
  runtime.provide('locale', locale)
  runtime.slots.installLocale(locale)
  runtime.provide('layout', { toggleSidebar: vi.fn() })
  const status = (memberId: string, workspaceId: string, handle: string, presence: 'available' | 'working' | 'error' | 'unavailable', diagnostic?: string) => ({
    member: {
      memberId, workspaceId, handle, description: `${handle} description`,
      presetId: 'team-member', privateMemoryPath: `/memory/${memberId}`, state: 'enabled', sessionId: `session:${memberId}`,
    },
    availability: presence === 'unavailable' ? 'unavailable' : 'active',
    presence,
    ...(diagnostic === undefined ? {} : { diagnostic }),
  })
  const members = vi.fn(async ({ workspaceId }: { workspaceId: string }) => ({ ok: true, value: workspaceId === 'w1' ? [
    status('member:builder', 'w1', 'builder', 'available'),
    status('member:worker', 'w1', 'worker', 'working'),
    status('member:failed', 'w1', 'failed', 'error', 'model failed'),
    status('member:offline', 'w1', 'offline', 'unavailable', 'preset missing'),
  ] : [status('member:builder-beta', 'w2', 'builder', 'available')] }))
  const addMember = vi.fn(async (request: AgentTeamAddMemberRequest) => ({ ok: true, value: {
    receipt: {},
    status: {
      member: {
        memberId: 'member:new', workspaceId: request.workspaceId, handle: request.handle, description: request.description,
        presetId: request.presetId, privateMemoryPath: '/memory/new', state: 'enabled', sessionId: 'session:new',
      },
      availability: 'active', presence: 'available',
    },
  } }))
  runtime.provide('remote', { agentTeam: { members, addMember }, $mount: async () => async () => {} } as never)
  await runtime.sessions.add({ id: 'ordinary-session', summary: { title: 'Ordinary', cwd: '/work/alpha' } })
  await runtime.workspaces.update((draft) => {
    draft.items = [
      { workspaceId: 'w1' as WorkspaceId, title: 'Alpha', path: '/work/alpha', sessionIds: [], createdAt: '', updatedAt: '' },
      { workspaceId: 'w2' as WorkspaceId, title: 'Beta', path: '/work/beta', sessionIds: [], createdAt: '', updatedAt: '' },
    ] as never
  })
  await runtime.root.declare({
    sidebar: { kind: 'single', scope: 'root' },
    conversation: { kind: 'single', scope: 'session-maybe' },
  } as never, Frame as never)
  await runtime.mount({ inject: [...injectSidebar], apply: applySidebar })
  const disposeWorkspace = runtime.slots.register({ name: 'sidebar.workspaces', priority: 0 }, BaselineWorkspace as never)
  const disposeSettings = runtime.slots.register({ name: 'sidebar.settings', priority: 0 }, BaselineSettings as never)
  const disposeConversation = runtime.slots.register({ name: 'conversation', priority: 0 }, BaselineConversation as never)
  runtime.slots.inject('sidebar.workspaces.directoryFlow', () => runtime.slots.register(
    { name: 'sidebar.workspaces.directoryFlow' }, DirectoryFlow as never,
  ))
  const team = await runtime.mount({ inject: [...inject], apply })
  const view = runtime.renderRoot()
  return { runtime, team, view, disposeWorkspace, disposeSettings, disposeConversation, members, addMember, status }
}

describe('rendered Team mode composition', () => {
  it('enters Team, creates a Workspace through directory-flow, and restores the shipped seats', async () => {
    const b = await runtimeWithTeam()
    expect(b.view.getByText('普通工作区')).toBeTruthy()
    expect(b.view.getByText('普通对话')).toBeTruthy()
    fireEvent.click(b.view.getByRole('button', { name: '团队' }))

    expect(b.runtime.sessions.list.getSnapshot().current).toBe('ordinary-session')
    expect(await b.view.findByRole('heading', { name: '团队' })).toBeTruthy()
    expect(b.view.getByText('Alpha')).toBeTruthy()
    expect(b.view.queryByText('设置')).toBeNull()
    fireEvent.click(b.view.getByRole('button', { name: '成员' }))
    const membersDialog = await b.view.findByRole('dialog', { name: '成员' })
    expect(within(membersDialog).getAllByText('builder')).toHaveLength(2)
    expect(within(membersDialog).getByText('Alpha')).toBeTruthy()
    expect(within(membersDialog).getByText('Beta')).toBeTruthy()
    fireEvent.click(b.view.getByRole('button', { name: '关闭' }))

    fireEvent.click(b.view.getByRole('button', { name: '新建工作区' }))
    fireEvent.click(await b.view.findByRole('button', { name: '选择 /work/new' }))
    await vi.waitFor(() => expect(b.runtime.workspaces.calls).toContainEqual({ method: 'create', args: [{ path: '/work/new' }] }))

    fireEvent.click(b.view.getByRole('button', { name: '← 对话' }))
    expect(await b.view.findByText('普通工作区')).toBeTruthy()
    expect(await b.view.findByText('普通对话')).toBeTruthy()
    expect(await b.view.findByText('设置')).toBeTruthy()
    expect(b.runtime.sessions.list.getSnapshot().current).toBe('ordinary-session')
    await b.runtime.dispose()
  })

  it('loads Workspace Agents and creates a durable Member without optimistic rows', async () => {
    const b = await runtimeWithTeam()
    fireEvent.click(b.view.getByRole('button', { name: '团队' }))
    fireEvent.click(await b.view.findByRole('tab', { name: 'Agents' }))

    expect(await b.view.findByText('builder')).toBeTruthy()
    expect(b.view.getByRole('img', { name: '可用' })).toBeTruthy()
    expect(b.view.getByRole('img', { name: '工作中' })).toBeTruthy()
    expect(b.view.getByRole('img', { name: '错误: model failed' })).toBeTruthy()
    expect(b.view.getByRole('img', { name: '不可用: preset missing' })).toBeTruthy()
    expect(b.members).toHaveBeenCalledWith({ workspaceId: 'w1' })

    fireEvent.click(b.view.getByRole('button', { name: '添加 Agent' }))
    fireEvent.change(b.view.getByLabelText('名称'), { target: { value: 'reviewer' } })
    fireEvent.change(b.view.getByLabelText('说明'), { target: { value: 'Reviews changes' } })
    const pending = Promise.withResolvers<Awaited<ReturnType<typeof b.addMember>>>()
    b.addMember.mockReturnValueOnce(pending.promise)
    fireEvent.click(b.view.getByRole('button', { name: '创建 Agent' }))
    expect(b.view.queryByText('reviewer')).toBeNull()
    expect((b.view.getByRole('button', { name: '正在创建…' }) as HTMLButtonElement).disabled).toBe(true)
    pending.resolve({ ok: true, value: { receipt: {} as never, status: b.status('member:new', 'w1', 'reviewer', 'available') as never } })

    expect(await b.view.findByText('reviewer')).toBeTruthy()
    expect(b.addMember).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'w1', handle: 'reviewer', description: 'Reviews changes', presetId: 'team-member',
    }))
    await b.runtime.dispose()
  })

  it('restores persisted Team mode, reconciles a stale Workspace, renders the rail, and unloads cleanly', async () => {
    const b = await runtimeWithTeam({ mode: 'team', workspaceId: 'stale' })
    expect(await b.view.findByRole('heading', { name: '团队' })).toBeTruthy()
    await vi.waitFor(() => expect(b.runtime.ctx.teamNavigation.getSnapshot().workspaceId).toBe('w1'))

    fireEvent.click(b.view.getByRole('button', { name: 'Toggle fixture sidebar' }))
    await waitFor(() => { expect(b.view.queryByText('Alpha')).toBeNull() })
    expect(b.view.getByRole('button', { name: '← 对话' })).toBeTruthy()
    expect(b.view.container).toMatchSnapshot()

    await b.team.dispose()
    expect(await b.view.findByText('普通工作区')).toBeTruthy()
    expect(await b.view.findByText('普通对话')).toBeTruthy()
    expect(await b.view.findByText('设置')).toBeTruthy()
    await b.runtime.dispose()
  })
})
