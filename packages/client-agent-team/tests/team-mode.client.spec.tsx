// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import type { WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
import type { AgentTeamAddMemberRequest, AgentTeamCreateChannelRequest, AgentTeamReplyRequest, AgentTeamSendMessageRequest } from '@deepseek-ai/dsh-agent-team/types'
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
  let channels: Array<Record<string, unknown>> = []
  let memberships: Array<Record<string, unknown>> = []
  let viewItems: Array<Record<string, unknown>> = []
  let viewClaims: Array<Record<string, unknown>> = []
  const viewChannels = vi.fn(async () => ({ ok: true, value: {
    humanMemberId: 'member:human', channels, members: memberships,
    tasks: viewItems.length === 0 ? [] : [viewItems[0]!.task], threads: viewItems.length === 0 ? [] : [viewItems[0]!.thread],
    taskNumbers: viewItems.length === 0 ? [] : [{ taskRef: 'task:1', taskNumber: 1 }],
    items: viewItems, claims: viewClaims, activities: [], cursor: 0, hasMore: false,
  } }))
  const createChannel = vi.fn(async (request: AgentTeamCreateChannelRequest) => {
    const channel = { channelRef: 'channel:new', workspaceId: request.workspaceId, name: request.name,
      description: request.description, createdAtSequence: 1 }
    channels = [...channels, channel]
    memberships = (request.memberIds ?? []).map(memberId => ({ channelRef: channel.channelRef, memberId }))
    return { ok: true, value: { receipt: {}, channel, memberIds: request.memberIds ?? [] } }
  })
  const joinChannel = vi.fn(async (request: { channelRef: string; memberId: string }) => {
    memberships = [...memberships, { channelRef: request.channelRef, memberId: request.memberId }]
    return { ok: true, value: {} }
  })
  const removeChannelMember = vi.fn(async (request: { channelRef: string; memberId: string }) => {
    memberships = memberships.filter(item => item.channelRef !== request.channelRef || item.memberId !== request.memberId)
    return { ok: true, value: {} }
  })
  const sendMessage = vi.fn(async (request: AgentTeamSendMessageRequest) => {
    const task = { taskRef: 'task:1', channelRef: request.channelRef, threadRef: 'thread:1', status: 'todo', resolution: 'open' }
    const thread = { threadRef: 'thread:1', taskRef: 'task:1', revision: 2 }
    const message = { messageRef: 'message:1', channelRef: request.channelRef, threadRef: 'thread:1', taskRef: 'task:1', sender: 'member:human', body: request.body, topLevel: true, sequence: 2 }
    viewItems = [{ message, task, thread, taskNumber: 1, messageCount: 1 }]
    return { ok: true, value: { receipt: {}, message, task, thread, follows: [], deliveries: [] } }
  })
  let changeVersion = 0
  const changeWaiters: Array<(value: { ok: true; value: { version: number } }) => void> = []
  const reply = vi.fn(async (request: AgentTeamReplyRequest) => {
    const top = viewItems[0]!
    const message = { ...(top.message as object), messageRef: 'message:human-reply', sender: 'member:human', body: request.body, topLevel: false, sequence: request.baseRevision + 1 }
    const thread = { ...(top.thread as object), revision: request.baseRevision + 1 }
    viewItems = [{ ...top, thread, messageCount: 2 }, { ...top, message, thread, messageCount: 2 }]
    return { ok: true as const, value: { kind: 'committed', receipt: {}, message, task: top.task, thread, deliveries: [] } }
  })
  const changeClaim = vi.fn(async (request: { claimRef?: string; action: string }) => {
    viewClaims = viewClaims.map(claim => claim.claimRef === request.claimRef ? { ...claim, state: request.action === 'done' ? 'done' : 'released' } : claim)
    return { ok: true as const, value: {} }
  })
  const changeTask = vi.fn(async (request: { action: 'accept' | 'close' | 'reopen' }) => {
    viewItems = viewItems.map(item => ({ ...item, task: { ...(item.task as object),
      status: request.action === 'reopen' ? 'todo' : request.action === 'accept' ? 'done' : 'closed',
      resolution: request.action === 'reopen' ? 'open' : request.action === 'accept' ? 'accepted' : 'closed' } }))
    return { ok: true as const, value: {} }
  })
  const changes = vi.fn(({ afterVersion }: { afterVersion: number }) => changeVersion > afterVersion
    ? Promise.resolve({ ok: true as const, value: { version: changeVersion } })
    : new Promise<{ ok: true; value: { version: number } }>(resolve => { changeWaiters.push(resolve) }))
  const publishAgentReply = () => {
    const top = viewItems[0]!
    viewItems = [{ ...top, messageCount: 2 }, { ...top, message: { ...(top.message as object), messageRef: 'message:reply', sender: 'member:builder', body: 'agent reply', topLevel: false, sequence: 3 }, messageCount: 2 }]
    viewClaims = [{ claimRef: 'claim:1', taskRef: 'task:1', threadRef: 'thread:1', owner: 'member:builder', direction: 'Implement API', normalizedDirection: 'implement api', state: 'active' }]
    changeVersion += 1
    for (const resolve of changeWaiters.splice(0)) resolve({ ok: true, value: { version: changeVersion } })
  }
  runtime.provide('remote', { agentTeam: { members, addMember, view: viewChannels, createChannel, joinChannel, removeChannelMember, sendMessage, reply, changeClaim, changeTask, changes }, $mount: async () => async () => {} } as never)
  runtime.provide('remote.agentTeam', {})
  await runtime.sessions.add({ id: 'ordinary-session', summary: { title: 'Ordinary', cwd: '/work/alpha' } })
  runtime.workspaces.stub('pickDirectory', async () => '/work/new')
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
  const team = await runtime.mount({ inject: [...inject], apply })
  const view = runtime.renderRoot()
  return { runtime, team, view, disposeWorkspace, disposeSettings, disposeConversation, members, addMember, status, viewChannels, createChannel, joinChannel, removeChannelMember, sendMessage, reply, changeClaim, changeTask, publishAgentReply }
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
    await vi.waitFor(() => {
      expect(b.runtime.workspaces.calls).toContainEqual({ method: 'pickDirectory', args: [] })
      expect(b.runtime.workspaces.calls).toContainEqual({ method: 'create', args: [{ path: '/work/new' }] })
    })

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

  it('creates a Channel atomically with selected available Members and manages committed membership', async () => {
    const b = await runtimeWithTeam()
    fireEvent.click(b.view.getByRole('button', { name: '团队' }))
    expect(await b.view.findByText('还没有 Channel')).toBeTruthy()
    fireEvent.click(b.view.getByRole('button', { name: '新建 Channel' }))
    fireEvent.change(b.view.getByLabelText('名称'), { target: { value: 'backend' } })
    fireEvent.change(b.view.getByLabelText('说明'), { target: { value: 'API implementation' } })
    const builder = b.view.getByRole('checkbox', { name: /builder/ })
    const unavailable = b.view.getByRole('checkbox', { name: /offline/ }) as HTMLInputElement
    expect(unavailable.disabled).toBe(true)
    fireEvent.click(builder)
    b.createChannel.mockResolvedValueOnce({ ok: false, error: { message: 'connection lost' } } as never)
    fireEvent.click(b.view.getByRole('button', { name: '创建 Channel' }))
    expect((await b.view.findByRole('alert')).textContent).toContain('connection lost')
    fireEvent.click(b.view.getByRole('button', { name: '创建 Channel' }))

    expect(await b.view.findByText('# backend')).toBeTruthy()
    expect(b.createChannel).toHaveBeenLastCalledWith(expect.objectContaining({
      workspaceId: 'w1', name: 'backend', description: 'API implementation', memberIds: ['member:builder'],
    }))
    expect(b.createChannel.mock.calls[0]![0].requestId).toBe(b.createChannel.mock.calls[1]![0].requestId)
    fireEvent.click(b.view.getByRole('button', { name: '管理成员' }))
    const manager = b.view.getByLabelText('管理成员')
    expect(within(manager).getByText('builder')).toBeTruthy()
    fireEvent.click(within(manager).getByRole('button', { name: '移除' }))
    await waitFor(() => { expect(b.removeChannelMember).toHaveBeenCalledWith(expect.objectContaining({ memberId: 'member:builder' })) })
    await b.runtime.dispose()
  })

  it('opens a selected Channel in the Team center and sends only after Host commit', async () => {
    const b = await runtimeWithTeam()
    fireEvent.click(b.view.getByRole('button', { name: '团队' }))
    fireEvent.click(await b.view.findByRole('button', { name: '新建 Channel' }))
    fireEvent.change(b.view.getByLabelText('名称'), { target: { value: 'backend' } })
    fireEvent.change(b.view.getByLabelText('说明'), { target: { value: 'API' } })
    fireEvent.click(b.view.getByRole('checkbox', { name: /builder/ }))
    fireEvent.click(b.view.getByRole('button', { name: '创建 Channel' }))
    fireEvent.click(await b.view.findByRole('button', { name: /backend/ }))
    expect(await b.view.findByRole('heading', { name: '# backend' })).toBeTruthy()
    const channelPage = b.view.container.querySelector('[data-team-channel]') as HTMLElement
    fireEvent.click(within(channelPage).getByRole('button', { name: '管理成员' }))
    const pageManager = within(channelPage).getByLabelText('管理成员')
    expect(within(pageManager).getByText('@builder')).toBeTruthy()
    fireEvent.change(b.view.getByRole('textbox', { name: '消息内容' }), { target: { value: 'hello team' } })
    fireEvent.click(b.view.getByRole('checkbox', { name: '@builder' }))
    b.sendMessage.mockResolvedValueOnce({ ok: false, error: { message: 'send failed' } } as never)
    fireEvent.click(b.view.getByRole('button', { name: '发送' }))
    expect((await b.view.findByRole('alert')).textContent).toContain('send failed')
    expect((b.view.getByRole('textbox', { name: '消息内容' }) as HTMLTextAreaElement).value).toBe('hello team')
    fireEvent.click(b.view.getByRole('button', { name: '发送' }))
    await waitFor(() => expect(b.sendMessage).toHaveBeenLastCalledWith(expect.objectContaining({ body: 'hello team', recipients: ['member:builder'] })))
    expect(b.sendMessage.mock.calls[0]![0].requestId).toBe(b.sendMessage.mock.calls[1]![0].requestId)
    expect(await b.view.findByText('hello team')).toBeTruthy()
    expect(b.view.getByText('Human 成员')).toBeTruthy()
    b.publishAgentReply()
    expect(await b.view.findByText('agent reply')).toBeTruthy()
    expect(b.view.getByText('Agent 成员')).toBeTruthy()
    fireEvent.click(b.view.getByRole('button', { name: /Task #1/ }))
    expect(await b.view.findByRole('heading', { name: 'Task #1' })).toBeTruthy()
    expect(b.view.getByText('Implement API')).toBeTruthy()
    fireEvent.click(b.view.getByRole('button', { name: '标记完成' }))
    await waitFor(() => expect(b.changeClaim).toHaveBeenCalledWith(expect.objectContaining({ claimRef: 'claim:1', action: 'done' })))
    fireEvent.change(b.view.getByRole('textbox', { name: '消息内容' }), { target: { value: 'human thread reply' } })
    b.reply.mockResolvedValueOnce({ ok: false, error: { message: 'stale Thread revision 2' } } as never)
    fireEvent.click(b.view.getByRole('button', { name: '发送' }))
    expect((await b.view.findByRole('alert')).textContent).toContain('stale Thread revision')
    expect((b.view.getByRole('textbox', { name: '消息内容' }) as HTMLTextAreaElement).value).toBe('human thread reply')
    expect(b.reply).toHaveBeenCalledTimes(1)
    fireEvent.click(b.view.getByRole('button', { name: '发送' }))
    expect(await b.view.findByText('human thread reply')).toBeTruthy()
    expect(b.reply.mock.calls[0]![0].requestId).not.toBe(b.reply.mock.calls[1]![0].requestId)
    fireEvent.click(b.view.getByRole('button', { name: '关闭任务' }))
    expect(await b.view.findByRole('button', { name: '重新打开' })).toBeTruthy()
    fireEvent.click(b.view.getByRole('button', { name: '← 返回 Channel' }))
    expect(await b.view.findByRole('heading', { name: '# backend' })).toBeTruthy()
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
