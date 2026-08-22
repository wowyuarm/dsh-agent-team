// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import type { WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
import type { AgentTeamAddMemberRequest, AgentTeamCreateChannelRequest, AgentTeamReplyRequest, AgentTeamSendMessageRequest } from '@wowyuarm/dsh-agent-team/types'
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
async function runtimeWithTeam(options?: { mode?: 'team'; workspaceId?: string; initialChannels?: boolean; remainingUnreadCount?: number }) {
  if (options?.mode !== undefined) {
    localStorage.setItem('dsh.agent-team.navigation', JSON.stringify({ mode: options.mode, ...(options.workspaceId === undefined ? {} : { workspaceId: options.workspaceId }) }))
  }
  const runtime = await SlotTestRuntime.create()
  const locale = new LocaleRuntime(runtime.ctx)
  runtime.provide('locale', locale)
  runtime.slots.installLocale(locale)
  runtime.provide('layout', { toggleSidebar: vi.fn() })
  const status = (memberId: string, workspaceId: string, handle: string, presence: 'available' | 'working' | 'error' | 'unavailable', diagnostic?: string) => ({
    member: {
      memberId, workspaceId, handle, description: `${handle} description`,
      presetId: 'team-member', state: 'enabled', sessionId: `session:${memberId}`,
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
        presetId: request.presetId, state: 'enabled', sessionId: 'session:new',
      },
      availability: 'active', presence: 'available',
    },
  } }))
  let channels: Array<Record<string, unknown>> = options?.initialChannels === true
    ? [{ channelRef: 'channel:engineering', workspaceId: 'w1', name: 'engineering', description: 'Engineering work', createdAtSequence: 1 }]
    : []
  let memberships: Array<Record<string, unknown>> = []
  let viewItems: Array<Record<string, unknown>> = []
  let viewClaims: Array<Record<string, unknown>> = []
  let viewActivities: Array<Record<string, unknown>> = []
  const viewChannels = vi.fn(async (request: { threadRef?: string; topLevelOnly?: boolean }) => ({ ok: true, value: {
    humanMemberId: 'member:human', channels, members: memberships,
    tasks: viewItems.length === 0 ? [] : [viewItems[0]!.task], threads: viewItems.length === 0 ? [] : [viewItems[0]!.thread],
    taskNumbers: viewItems.length === 0 ? [] : [{ taskRef: 'task:1', taskNumber: 1 }],
    items: request.threadRef !== undefined || !request.topLevelOnly ? viewItems : viewItems.filter(item => (item.message as { topLevel?: boolean }).topLevel), claims: viewClaims, activities: request.topLevelOnly ? [] : viewActivities, cursor: 0, hasMore: false,
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
    const message = { messageRef: 'message:1', channelRef: request.channelRef, threadRef: 'thread:1', taskRef: 'task:1', sender: 'member:human', body: request.body, topLevel: true, sequence: 2, occurredAt: '2026-08-21T10:00:00.000Z' }
    viewItems = [{ message, task, thread, taskNumber: 1, messageCount: 1 }]
    return { ok: true as const, value: { kind: 'committed' as const, receipt: {}, message, task, thread, attention: [], directMarkers: [] } }
  })
  let changeVersion = 0
  const changeWaiters: Array<(value: { ok: true; value: { version: number } }) => void> = []
  const reply = vi.fn(async (request: AgentTeamReplyRequest) => {
    const top = viewItems[0]!
    const message = { ...(top.message as object), messageRef: 'message:human-reply', sender: 'member:human', body: request.body, topLevel: false, sequence: request.baseRevision + 1 }
    const thread = { ...(top.thread as object), revision: request.baseRevision + 1 }
    viewItems = [{ ...top, thread, messageCount: 2 }, { ...top, message, thread, messageCount: 2 }]
    return { ok: true as const, value: { kind: 'committed', receipt: {}, message, task: top.task, thread, attention: [], directMarkers: [] } }
  })
  const changeTask = vi.fn(async (request: { action: 'accept' | 'close' | 'reopen' }) => {
    const top = viewItems[0]!
    const task = { ...(top.task as object),
      status: request.action === 'reopen' ? 'todo' : request.action === 'accept' ? 'done' : 'closed',
      resolution: request.action === 'reopen' ? 'open' : request.action === 'accept' ? 'accepted' : 'closed' }
    const thread = { ...(top.thread as object), revision: (top.thread as { revision: number }).revision + 1 }
    viewItems = viewItems.map(item => ({ ...item, task, thread }))
    return { ok: true as const, value: { kind: 'committed', receipt: {}, activity: { activityRef: `activity:${request.action}`, taskRef: 'task:1', threadRef: 'thread:1', actor: 'member:human', kind: request.action, sequence: (thread.revision as number) + 10 }, task, thread, claims: viewClaims } }
  })
  let nextRemainingUnreadCount = options?.remainingUnreadCount ?? 0
  const readThread = vi.fn(async ({ taskRef }: { taskRef: string }) => {
    const top = viewItems.find(item => (item.task as { taskRef: string }).taskRef === taskRef) ?? viewItems[0]
    if (top === undefined) return { ok: false as const, error: { message: 'thread missing' } }
    const remainingUnreadCount = nextRemainingUnreadCount
    nextRemainingUnreadCount = 0
    return { ok: true as const, value: {
      receipt: {}, task: top.task, thread: top.thread, claims: viewClaims,
      anchor: top.message, facts: [...viewItems.map(item => ({ fact: { kind: 'message' as const, sequence: (item.message as { sequence: number }).sequence, message: item.message }, unread: false, direct: false })), ...viewActivities.map(activity => ({ fact: { kind: 'activity' as const, sequence: activity.sequence as number, activity }, unread: false, direct: false }))],
      readThroughSequence: (top.thread as { revision: number }).revision, remainingUnreadCount, consumedDirectMarkers: [],
    } }
  })
  const loadThreadHistory = vi.fn(async ({ taskRef }: { taskRef: string }) => {
    const top = viewItems.find(item => (item.task as { taskRef: string }).taskRef === taskRef) ?? viewItems[0]
    if (top === undefined) return { ok: false as const, error: { message: 'thread missing' } }
    return { ok: true as const, value: { task: top.task, thread: top.thread, anchor: top.message, claims: viewClaims, facts: [], cursor: 0, hasMore: false } }
  })
  const changes = vi.fn((request: { afterVersion: number; scope?: unknown }, _signal?: AbortSignal) => changeVersion > request.afterVersion
    ? Promise.resolve({ ok: true as const, value: { version: changeVersion } })
    : new Promise<{ ok: true; value: { version: number } }>(resolve => { changeWaiters.push(resolve) }))
  const publishAgentReply = () => {
    const top = viewItems[0]!
    viewItems = [{ ...top, messageCount: 2 }, { ...top, message: { ...(top.message as object), messageRef: 'message:reply', sender: 'member:builder', body: 'agent reply', topLevel: false, sequence: 3 }, messageCount: 2 }]
    viewClaims = [{ claimRef: 'claim:1', taskRef: 'task:1', threadRef: 'thread:1', owner: 'member:builder', direction: 'Implement API', normalizedDirection: 'implement api', state: 'active' }]
    viewActivities = [{ activityRef: 'activity:claim', taskRef: 'task:1', threadRef: 'thread:1', actor: 'member:builder', kind: 'claim', claimRef: 'claim:1', sequence: 4 }]
    changeVersion += 1
    for (const resolve of changeWaiters.splice(0)) resolve({ ok: true, value: { version: changeVersion } })
  }
  runtime.provide('remote', { agentTeam: { members, addMember, view: viewChannels, readThread, threadHistory: loadThreadHistory, createChannel, joinChannel, removeChannelMember, sendMessage, reply, changeTask, changes }, $mount: async () => async () => {} } as never)
  runtime.provide('remote.agentTeam', {})
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
  const team = await runtime.mount({ inject: [...inject], apply })
  const view = runtime.renderRoot()
  return { runtime, team, view, disposeWorkspace, disposeSettings, disposeConversation, members, addMember, status, viewChannels, createChannel, joinChannel, removeChannelMember, sendMessage, reply, changeTask, publishAgentReply, readThread, loadThreadHistory, changes }
}

describe('rendered Team mode composition', () => {
  it('enters Team with existing Workspaces and restores the shipped seats', async () => {
    const b = await runtimeWithTeam()
    expect(b.view.getByText('普通工作区')).toBeTruthy()
    expect(b.view.getByText('普通对话')).toBeTruthy()
    fireEvent.click(b.view.getByRole('button', { name: '团队' }))
    await waitFor(() => expect(document.documentElement.dataset.agentTeamMode).toBe('team'))
    expect(b.runtime.sessions.list.getSnapshot().current).toBe('ordinary-session')
    expect(await b.view.findByRole('heading', { name: '频道' })).toBeTruthy()
    expect(b.view.getAllByText('Alpha')).toHaveLength(2)
    expect(b.view.queryByText('设置')).toBeNull()
    const membersTrigger = b.view.getByRole('button', { name: '成员' })
    const delayedMembers = Promise.withResolvers<Awaited<ReturnType<typeof b.members>>>()
    b.members.mockReturnValueOnce(delayedMembers.promise)
    fireEvent.click(membersTrigger)
    const membersDialog = await b.view.findByRole('dialog', { name: '成员' })
    expect(within(membersDialog).getByRole('status').textContent).toContain('正在加载 Agent')
    delayedMembers.resolve({ ok: true, value: [b.status('member:builder', 'w1', 'builder', 'available')] } as never)
    await waitFor(() => expect(within(membersDialog).getAllByText('@builder')).toHaveLength(2))
    expect(within(membersDialog).getByText('Alpha')).toBeTruthy()
    expect(within(membersDialog).getByText('Beta')).toBeTruthy()
    const membersContent = membersDialog.querySelector('[tabindex="-1"]')
    await waitFor(() => expect(document.activeElement).toBe(membersContent))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(b.view.queryByRole('dialog', { name: '成员' })).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(membersTrigger))
    b.members.mockRejectedValueOnce(new Error('members transport failed'))
    fireEvent.click(membersTrigger)
    expect((await b.view.findByRole('alert')).textContent).toContain('members transport failed')
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(document.activeElement).toBe(membersTrigger))

    fireEvent.click(b.view.getByRole('button', { name: '对话' }))
    await waitFor(() => expect(document.documentElement.dataset.agentTeamMode).toBeUndefined())
    expect(await b.view.findByText('普通工作区')).toBeTruthy()
    expect(await b.view.findByText('普通对话')).toBeTruthy()
    expect(await b.view.findByText('设置')).toBeTruthy()
    expect(b.runtime.sessions.list.getSnapshot().current).toBe('ordinary-session')
    await b.runtime.dispose()
  })

  it('loads Workspace Agents and creates a durable Member without optimistic rows', async () => {
    const b = await runtimeWithTeam({ initialChannels: true })
    fireEvent.click(b.view.getByRole('button', { name: '团队' }))
    const agentsTab = await b.view.findByRole('tab', { name: 'Agents' })
    fireEvent.click(agentsTab)
    expect(await b.view.findByRole('heading', { name: 'Agents' })).toBeTruthy()
    expect(b.view.getByText('从左侧选择一个 Agent 查看状态')).toBeTruthy()
    expect(agentsTab.getAttribute('aria-controls')).toBe('team-sidebar-agents')
    expect(b.view.getByRole('tabpanel', { name: 'Agents' }).id).toBe('team-sidebar-agents')

    expect(await b.view.findByText('builder')).toBeTruthy()
    expect(b.view.getByRole('img', { name: '可用' })).toBeTruthy()
    expect(b.view.getByRole('img', { name: '工作中' })).toBeTruthy()
    expect(b.view.getByRole('img', { name: '错误: model failed' })).toBeTruthy()
    expect(b.view.getByRole('img', { name: '不可用: preset missing' })).toBeTruthy()
    expect(b.members).toHaveBeenCalledWith({ workspaceId: 'w1' })

    const addAgentTrigger = b.view.getByRole('button', { name: '添加 Agent' })
    fireEvent.click(addAgentTrigger)
    expect(b.view.getByRole('dialog', { name: '添加 Agent' })).toBeTruthy()
    const agentName = b.view.getByLabelText('名称')
    await waitFor(() => expect(document.activeElement).toBe(agentName))
    fireEvent.change(agentName, { target: { value: 'reviewer' } })
    fireEvent.change(b.view.getByLabelText('说明'), { target: { value: 'Reviews changes' } })
    fireEvent.click(await b.view.findByRole('checkbox', { name: 'engineering' }))
    b.addMember.mockResolvedValueOnce({ ok: false, error: { message: 'connection lost' } } as never)
    fireEvent.click(b.view.getByRole('button', { name: '创建 Agent' }))
    expect((await b.view.findByRole('alert')).textContent).toContain('connection lost')
    expect((b.view.getByLabelText('名称') as HTMLInputElement).value).toBe('reviewer')
    expect(b.view.queryByText('reviewer')).toBeNull()
    fireEvent.click(b.view.getByRole('button', { name: '创建 Agent' }))

    expect(await b.view.findByText('reviewer')).toBeTruthy()
    expect(b.addMember).toHaveBeenLastCalledWith(expect.objectContaining({
      workspaceId: 'w1', channelRefs: ['channel:engineering'], handle: 'reviewer', description: 'Reviews changes', presetId: 'team-member',
    }))
    expect(b.addMember.mock.calls[0]![0].requestId).toBe(b.addMember.mock.calls[1]![0].requestId)
    await waitFor(() => expect(document.activeElement).toBe(addAgentTrigger))
    fireEvent.click(addAgentTrigger)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(b.view.queryByRole('dialog', { name: '添加 Agent' })).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(addAgentTrigger))
    await b.runtime.dispose()
  })

  it('creates a Channel atomically with selected available Members and manages committed membership', async () => {
    const b = await runtimeWithTeam()
    fireEvent.click(b.view.getByRole('button', { name: '团队' }))
    fireEvent.click(await b.view.findByRole('tab', { name: '频道' }))
    expect(await b.view.findByText('还没有频道')).toBeTruthy()
    fireEvent.click(b.view.getByRole('button', { name: '新建频道' }))
    fireEvent.change(b.view.getByLabelText('名称'), { target: { value: 'backend' } })
    fireEvent.change(b.view.getByLabelText('说明'), { target: { value: 'API implementation' } })
    const builder = b.view.getByRole('checkbox', { name: /builder/ })
    const unavailable = b.view.getByRole('checkbox', { name: /offline/ }) as HTMLInputElement
    expect(unavailable.disabled).toBe(true)
    fireEvent.click(builder)
    b.createChannel.mockResolvedValueOnce({ ok: false, error: { message: 'connection lost' } } as never)
    fireEvent.click(b.view.getByRole('button', { name: '创建频道' }))
    expect((await b.view.findByRole('alert')).textContent).toContain('connection lost')
    fireEvent.click(b.view.getByRole('button', { name: '创建频道' }))

    expect(await b.view.findByText('# backend')).toBeTruthy()
    expect(b.createChannel).toHaveBeenLastCalledWith(expect.objectContaining({
      workspaceId: 'w1', name: 'backend', description: 'API implementation', memberIds: ['member:builder'],
    }))
    expect(b.createChannel.mock.calls[0]![0].requestId).toBe(b.createChannel.mock.calls[1]![0].requestId)
    fireEvent.click(b.view.getByRole('button', { name: '# backend' }))
    fireEvent.click(await b.view.findByRole('button', { name: '管理成员' }))
    const manager = b.view.getByRole('dialog', { name: '频道成员' })
    expect(within(manager).getByText('@builder')).toBeTruthy()
    fireEvent.click(within(manager).getByRole('button', { name: '移除' }))
    await waitFor(() => { expect(b.removeChannelMember).toHaveBeenCalledWith(expect.objectContaining({ memberId: 'member:builder' })) })
    await b.runtime.dispose()
  })

  it('opens a selected Channel in the Team center and sends only after Host commit', async () => {
    const b = await runtimeWithTeam({ remainingUnreadCount: 1 })
    fireEvent.click(b.view.getByRole('button', { name: '团队' }))
    fireEvent.click(await b.view.findByRole('tab', { name: '频道' }))
    fireEvent.click(await b.view.findByRole('button', { name: '新建频道' }))
    fireEvent.change(b.view.getByLabelText('名称'), { target: { value: 'backend' } })
    fireEvent.change(b.view.getByLabelText('说明'), { target: { value: 'API' } })
    fireEvent.click(b.view.getByRole('checkbox', { name: /builder/ }))
    fireEvent.click(b.view.getByRole('button', { name: '创建频道' }))
    const backendChannel = await b.view.findByRole('button', { name: /backend/ })
    fireEvent.click(backendChannel)
    expect(backendChannel.closest('article')?.getAttribute('aria-current')).toBe('page')
    expect(await b.view.findByRole('heading', { name: '# backend' })).toBeTruthy()
    const channelPage = b.view.container.querySelector('[data-team-channel]') as HTMLElement
    const manageMembers = within(channelPage).getByRole('button', { name: '管理成员' })
    fireEvent.click(manageMembers)
    const pageManager = b.view.getByRole('dialog', { name: '频道成员' })
    expect(within(pageManager).getByText('@builder')).toBeTruthy()
    await waitFor(() => expect(document.activeElement).toBe(within(pageManager).getByRole('button', { name: '移除' })))
    const removal = Promise.withResolvers<Awaited<ReturnType<typeof b.removeChannelMember>>>()
    b.removeChannelMember.mockReturnValueOnce(removal.promise)
    fireEvent.click(within(pageManager).getByRole('button', { name: '移除' }))
    expect((within(pageManager).getByRole('button', { name: '更新中…' }) as HTMLButtonElement).disabled).toBe(true)
    expect((within(pageManager).getAllByRole('button', { name: '添加' })[0] as HTMLButtonElement).disabled).toBe(false)
    removal.resolve({ ok: false, error: { message: 'membership failed' } } as never)
    expect((await within(pageManager).findByRole('alert')).textContent).toContain('membership failed')
    expect(within(pageManager).getByRole('button', { name: '移除' })).toBeTruthy()
    fireEvent.click(within(pageManager).getByRole('button', { name: '关闭' }))
    await waitFor(() => expect(document.activeElement).toBe(manageMembers))
    const messageInput = b.view.getByRole('textbox', { name: '消息内容' }) as HTMLTextAreaElement
    fireEvent.change(messageInput, { target: { value: 'hello team @b' } })
    fireEvent.click(b.view.getByRole('option', { name: /@builder/ }))
    expect(messageInput.value).toBe('hello team @builder ')
    b.sendMessage.mockResolvedValueOnce({ ok: false, error: { message: 'send failed' } } as never)
    fireEvent.click(b.view.getByRole('button', { name: '发送' }))
    expect((await within(channelPage).findByRole('alert')).textContent).toContain('send failed')
    expect((b.view.getByRole('textbox', { name: '消息内容' }) as HTMLTextAreaElement).value).toBe('hello team @builder ')
    fireEvent.click(b.view.getByRole('button', { name: '发送' }))
    await waitFor(() => expect(b.sendMessage).toHaveBeenLastCalledWith(expect.objectContaining({ body: 'hello team @builder', recipients: ['member:builder'] })))
    expect(b.sendMessage.mock.calls[0]![0].requestId).not.toBe(b.sendMessage.mock.calls[1]![0].requestId)
    // Mention segmentation splits the body into spans (and css-module classes
    // are hashed here), so match the body container by class substring.
    await waitFor(() => {
      const rows = Array.from(b.view.container.querySelectorAll('[data-human] div[class*="messageText"]'))
      expect(rows.some(row => row.textContent === 'hello team @builder')).toBe(true)
    })
    expect(b.view.queryByText('任务消息')).toBeNull()
    expect(b.view.getByText('待处理')).toBeTruthy()
    expect(b.view.getByText('1 条消息')).toBeTruthy()
    b.publishAgentReply()
    await waitFor(() => expect(b.view.queryByText('agent reply')).toBeNull())
    fireEvent.click(b.view.getByRole('button', { name: '打开 Task #1' }))
    expect(await b.view.findByRole('heading', { name: 'Task #1' })).toBeTruthy()
    fireEvent.click(b.view.getByRole('button', { name: /Claims/ }))
    expect(b.view.getByText('Implement API')).toBeTruthy()
    expect(b.view.queryByRole('button', { name: '关注 Thread' })).toBeNull()
    expect(b.view.queryByRole('button', { name: '取消关注' })).toBeNull()
    expect(b.view.queryByText('Human 观察')).toBeNull()
    fireEvent.click(await b.view.findByRole('button', { name: '继续阅读' }))
    await waitFor(() => expect(b.readThread).toHaveBeenCalledTimes(2))
    expect(b.view.queryByRole('button', { name: '继续阅读' })).toBeNull()
    expect(b.view.getByText('@builder 认领了「Implement API」')).toBeTruthy()
    expect(b.view.queryByText(/member:builder/)).toBeNull()
    expect(b.view.queryByText(/claim ·/)).toBeNull()
    expect(b.view.queryByRole('button', { name: '标记完成' })).toBeNull()
    fireEvent.change(b.view.getByRole('textbox', { name: '消息内容' }), { target: { value: 'human thread reply' } })
    b.reply.mockResolvedValueOnce({ ok: false, error: { message: 'stale Thread revision 2' } } as never)
    fireEvent.click(b.view.getByRole('button', { name: '发送' }))
    expect((await b.view.findByRole('alert')).textContent).toContain('stale Thread revision')
    expect((b.view.getByRole('textbox', { name: '消息内容' }) as HTMLTextAreaElement).value).toBe('human thread reply')
    expect(b.reply).toHaveBeenCalledTimes(1)
    fireEvent.click(b.view.getByRole('button', { name: '发送' }))
    expect(await b.view.findByText('human thread reply')).toBeTruthy()
    expect(b.reply.mock.calls[0]![0].requestId).toBe(b.reply.mock.calls[1]![0].requestId)
    fireEvent.click(b.view.getByRole('button', { name: '关闭任务' }))
    // The closed Thread swaps the composer for an explanatory notice with the reopen action.
    expect(await b.view.findByRole('button', { name: '重新打开' })).toBeTruthy()
    expect(b.view.getByText('任务已关闭，重新打开后可继续讨论')).toBeTruthy()
    expect(b.view.queryByRole('textbox', { name: '消息内容' })).toBeNull()
    expect(b.reply).toHaveBeenCalledTimes(2)
    fireEvent.click(b.view.getByRole('button', { name: '重新打开' }))
    await waitFor(() => expect((b.view.getByRole('textbox', { name: '消息内容' }) as HTMLTextAreaElement).disabled).toBe(false))
    fireEvent.click(b.view.getByRole('button', { name: '返回频道' }))
    expect(await b.view.findByRole('heading', { name: '# backend' })).toBeTruthy()
    await waitFor(() => expect(b.view.queryByText('agent reply')).toBeNull())
    await b.runtime.dispose()
  })

  it('opens a Thread with one parallel request round and no self-triggered second wave', async () => {
    const b = await runtimeWithTeam()
    fireEvent.click(b.view.getByRole('button', { name: '团队' }))
    fireEvent.click(await b.view.findByRole('tab', { name: '频道' }))
    fireEvent.click(b.view.getByRole('button', { name: '新建频道' }))
    fireEvent.change(b.view.getByLabelText('名称'), { target: { value: 'backend' } })
    fireEvent.change(b.view.getByLabelText('说明'), { target: { value: 'API' } })
    fireEvent.click(b.view.getByRole('checkbox', { name: /builder/ }))
    fireEvent.click(b.view.getByRole('button', { name: '创建频道' }))
    fireEvent.click(await b.view.findByRole('button', { name: /backend/ }))
    expect(await b.view.findByRole('heading', { name: '# backend' })).toBeTruthy()
    const messageInput = b.view.getByRole('textbox', { name: '消息内容' }) as HTMLTextAreaElement
    fireEvent.change(messageInput, { target: { value: 'first task' } })
    fireEvent.click(b.view.getByRole('button', { name: '发送' }))
    expect(await b.view.findByText('first task')).toBeTruthy()

    b.readThread.mockClear()
    b.loadThreadHistory.mockClear()
    b.members.mockClear()
    b.viewChannels.mockClear()
    b.changes.mockClear()
    fireEvent.click(b.view.getByRole('button', { name: '打开 Task #1' }))
    expect(await b.view.findByRole('heading', { name: 'Task #1' })).toBeTruthy()
    await vi.waitFor(() => expect(b.loadThreadHistory).toHaveBeenCalledWith(expect.objectContaining({ taskRef: 'task:1', limit: 20 })))
    expect(b.readThread).toHaveBeenCalledTimes(1)

    // The durable read no longer wakes any scope, so the first round is the
    // whole load: no second members/view/history wave may follow it.
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(b.readThread).toHaveBeenCalledTimes(1)
    expect(b.loadThreadHistory).toHaveBeenCalledTimes(1)
    expect(b.members).toHaveBeenCalledTimes(1)
    expect(b.viewChannels).toHaveBeenCalledTimes(1)

    // The page waits on its own thread plus the workspace presence scope.
    const scopedCalls = b.changes.mock.calls.filter(([request]) => request.scope !== undefined)
    const scopes = scopedCalls.map(([request]) => request.scope as { kind: string; threadRef?: string })
    expect(scopes.some(scope => scope.kind === 'thread' && scope.threadRef === 'thread:1')).toBe(true)
    expect(scopes.some(scope => scope.kind === 'workspace')).toBe(true)
    for (const [, signal] of scopedCalls) expect(signal).toBeInstanceOf(AbortSignal)
    await b.runtime.dispose()
  })

  it('restores persisted Team mode, reconciles a stale Workspace, renders the rail, and unloads cleanly', async () => {
    const b = await runtimeWithTeam({ mode: 'team', workspaceId: 'stale' })
    expect(await b.view.findByRole('heading', { name: '频道' })).toBeTruthy()
    await vi.waitFor(() => expect(b.runtime.ctx.teamNavigation.getSnapshot().workspaceId).toBe('w1'))

    fireEvent.click(b.view.getByRole('button', { name: 'Toggle fixture sidebar' }))
    await waitFor(() => { expect(b.view.getByRole('button', { name: '频道' })).toBeTruthy() })
    expect(b.view.getByRole('button', { name: '对话' })).toBeTruthy()
    expect(b.view.getByRole('button', { name: '频道' })).toBeTruthy()
    expect(b.view.queryByRole('button', { name: '新建工作区' })).toBeNull()
    expect(b.view.container).toMatchSnapshot()

    await b.team.dispose()
    expect(await b.view.findByText('普通工作区')).toBeTruthy()
    expect(await b.view.findByText('普通对话')).toBeTruthy()
    expect(await b.view.findByText('设置')).toBeTruthy()
    await b.runtime.dispose()
  })

  it('counts only facts newer than the shown timeline as new updates on change wakes', async () => {
    const b = await runtimeWithTeam()
    fireEvent.click(b.view.getByRole('button', { name: '团队' }))
    fireEvent.click(await b.view.findByRole('tab', { name: '频道' }))
    fireEvent.click(b.view.getByRole('button', { name: '新建频道' }))
    fireEvent.change(b.view.getByLabelText('名称'), { target: { value: 'backend' } })
    fireEvent.change(b.view.getByLabelText('说明'), { target: { value: 'API' } })
    fireEvent.click(b.view.getByRole('checkbox', { name: /builder/ }))
    fireEvent.click(b.view.getByRole('button', { name: '创建频道' }))
    fireEvent.click(await b.view.findByRole('button', { name: /backend/ }))
    expect(await b.view.findByRole('heading', { name: '# backend' })).toBeTruthy()
    const messageInput = b.view.getByRole('textbox', { name: '消息内容' }) as HTMLTextAreaElement
    fireEvent.change(messageInput, { target: { value: 'first task' } })
    fireEvent.click(b.view.getByRole('button', { name: '发送' }))
    expect(await b.view.findByText('first task')).toBeTruthy()
    fireEvent.click(b.view.getByRole('button', { name: '打开 Task #1' }))
    expect(await b.view.findByRole('heading', { name: 'Task #1' })).toBeTruthy()
    await vi.waitFor(() => expect(b.loadThreadHistory).toHaveBeenCalledWith(expect.objectContaining({ taskRef: 'task:1', limit: 20 })))

    const anchor = { messageRef: 'message:anchor', channelRef: 'channel:1', threadRef: 'thread:1', taskRef: 'task:1',
      sender: 'member:human', body: 'first task', topLevel: true, sequence: 2, occurredAt: '' }
    const historyWith = (facts: unknown[]) => b.loadThreadHistory.mockImplementation(async () => ({ ok: true as const, value: {
      task: { taskRef: 'task:1', channelRef: 'channel:1', status: 'todo', resolution: 'open' },
      thread: { threadRef: 'thread:1', revision: 2 }, anchor, claims: [], facts, cursor: 0, hasMore: false,
    } } as never))
    const backfillFact = { kind: 'message', sequence: 1, message: { messageRef: 'message:old-1', channelRef: 'channel:1', threadRef: 'thread:1',
      taskRef: 'task:1', sender: 'member:human', body: 'old backfill', topLevel: false, sequence: 1, occurredAt: '' } }

    // The change stream swallows one wake inside its initial silent probe;
    // flush that probe so later wakes reach the listener.
    b.publishAgentReply()
    await vi.waitFor(() => expect(b.changes.mock.calls.some(([request]) => (request as { afterVersion?: number }).afterVersion === 1)).toBe(true))

    // Backfill from the wider passive window is already-read material, not news.
    historyWith([backfillFact])
    b.publishAgentReply()
    await waitFor(() => expect(b.loadThreadHistory).toHaveBeenLastCalledWith(expect.objectContaining({ taskRef: 'task:1', limit: 100 })))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(b.view.queryByText(/读取 \d+ 条新更新/)).toBeNull()

    // A fact newer than everything shown is genuinely new and countable.
    historyWith([{ ...backfillFact, sequence: 9, message: { ...backfillFact.message, messageRef: 'message:new-9', body: 'genuinely new', sequence: 9 } }])
    b.publishAgentReply()
    expect(await b.view.findByText('读取 1 条新更新')).toBeTruthy()
    fireEvent.click(b.view.getByRole('button', { name: '标记为已读' }))
    await waitFor(() => expect(b.readThread).toHaveBeenCalledTimes(2))
    expect(b.view.queryByText(/读取 \d+ 条新更新/)).toBeNull()
    await b.runtime.dispose()
  })
})
