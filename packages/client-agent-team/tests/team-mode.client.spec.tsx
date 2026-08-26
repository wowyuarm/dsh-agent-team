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
import { TEAM_DRAFTS_STORAGE_KEY } from '../src/client/drafts.ts'


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
interface SeededMessage {
  readonly body: string
  readonly occurredAt: string
  readonly sender?: 'human' | 'agent'
}

async function runtimeWithTeam(options?: { mode?: 'team'; workspaceId?: string; initialChannels?: boolean; remainingUnreadCount?: number; seededMessages?: readonly SeededMessage[]; seedTaskRef?: string; seedThreadRef?: string }) {
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
  let memberRows = [
    status('member:builder', 'w1', 'builder', 'available'),
    status('member:worker', 'w1', 'worker', 'working'),
    status('member:failed', 'w1', 'failed', 'error', 'model failed'),
    status('member:offline', 'w1', 'offline', 'unavailable', 'preset missing'),
    status('member:builder-beta', 'w2', 'builder', 'available'),
  ]
  const members = vi.fn(async ({ workspaceId }: { workspaceId: string }) => ({ ok: true, value: memberRows.filter(entry => entry.member.workspaceId === workspaceId) }))
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
  const seedTaskRef = options?.seedTaskRef ?? 'task:1'
  const seedThreadRef = options?.seedThreadRef ?? 'thread:1'
  let viewItems: Array<Record<string, unknown>> = (options?.seededMessages ?? []).map((seed, index) => ({
    message: { messageRef: `message:seed-${index}`, channelRef: 'channel:engineering', threadRef: seedThreadRef, taskRef: seedTaskRef, sender: seed.sender === 'agent' ? 'member:builder' : 'member:human', body: seed.body, topLevel: true, sequence: index + 1, occurredAt: seed.occurredAt },
    mentions: [],
    task: { taskRef: seedTaskRef, channelRef: 'channel:engineering', threadRef: seedThreadRef, status: 'todo', resolution: 'open' },
    thread: { threadRef: seedThreadRef, taskRef: seedTaskRef, revision: 2 },
    taskNumber: 1,
    messageCount: 1,
  }))
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
  const joinChannel = vi.fn(async (request: { requestId: string; channelRef: string; memberId: string }) => {
    memberships = [...memberships, { channelRef: request.channelRef, memberId: request.memberId }]
    return { ok: true, value: {} }
  })
  const removeChannelMember = vi.fn(async (request: { requestId: string; channelRef: string; memberId: string }) => {
    memberships = memberships.filter(item => item.channelRef !== request.channelRef || item.memberId !== request.memberId)
    return { ok: true, value: {} }
  })
  const updateChannel = vi.fn(async (request: { requestId: string; workspaceId: string; channelRef: string; name: string; description: string }) => {
    channels = channels.map(channel => channel.channelRef === request.channelRef
      ? { ...channel, name: request.name, description: request.description } : channel)
    return { ok: true as const, value: { receipt: {}, channel: channels.find(channel => channel.channelRef === request.channelRef) } }
  })
  const updateMember = vi.fn(async (request: { requestId: string; memberId: string; handle: string; description: string; model?: { provider: string; model: string } }) => {
    memberRows = memberRows.map(entry => entry.member.memberId === request.memberId
      ? { ...entry, member: { ...entry.member, handle: request.handle, description: request.description, ...(request.model === undefined ? {} : { model: request.model }) } }
      : entry)
    const status = memberRows.find(entry => entry.member.memberId === request.memberId)
    return { ok: true as const, value: { receipt: {}, ...(status === undefined ? {} : { status }) } }
  })
  const recoverMember = vi.fn(async (request: { requestId: string; memberId: string }) => ({
    ok: true as const,
    value: { status: memberRows.find(entry => entry.member.memberId === request.memberId) },
  }))
  const restartMember = vi.fn(async (request: { requestId: string; memberId: string }) => ({
    ok: true as const,
    value: { receipt: {}, status: memberRows.find(entry => entry.member.memberId === request.memberId) },
  }))
  const loadModels = vi.fn(async () => ({ result: { ok: true as const, value: {
    groups: [{ id: 'deepseek-official', name: 'DeepSeek', models: [
      { id: 'deepseek-chat', name: 'DeepSeek Chat', reasoning: { efforts: [{ id: 'low', name: 'low' }, { id: 'high', name: 'high' }] } },
      { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner' },
    ] }],
    failures: [],
  } } }))
  const putAttachment = vi.fn(async (request: { requestId: string; name: string; mediaType?: string; bytesBase64: string }) => ({
    ok: true as const,
    value: { attachmentId: `attachment:${putAttachmentCounter += 1}`, path: `/cache/${request.name}`, name: request.name, byteSize: request.bytesBase64.length, mediaType: request.mediaType ?? 'application/octet-stream' },
  }))
  let putAttachmentCounter = 0
  const getAttachment = vi.fn(async (request: { attachmentId: string }) => {
    if (request.attachmentId === 'attachment:2') return { ok: false as const, error: new Error('no longer cached') }
    return { ok: true as const, value: { name: 'x', mediaType: 'image/png', byteSize: 8, bytesBase64: 'aGVsbG8=' } }
  })
  let sentMessageCount = 0
  const sendMessage = vi.fn(async (request: AgentTeamSendMessageRequest) => {
    sentMessageCount += 1
    const sequence = 1 + sentMessageCount
    const task = { taskRef: 'task:1', channelRef: request.channelRef, threadRef: 'thread:1', status: 'todo', resolution: 'open' }
    const thread = { threadRef: 'thread:1', taskRef: 'task:1', revision: sequence }
    const attachments = request.attachments === undefined ? [] : request.attachments.map(id => ({ attachmentId: id, name: `file-${id}.png`, byteSize: 8, mediaType: 'image/png' }))
    const message = { messageRef: `message:${sequence}`, channelRef: request.channelRef, threadRef: 'thread:1', taskRef: 'task:1', sender: 'member:human', body: request.body, ...(attachments.length === 0 ? {} : { attachments }), topLevel: true, sequence, occurredAt: '2026-08-21T10:00:00.000Z' }
    viewItems = [{ message, mentions: [], task, thread, taskNumber: 1, messageCount: 1 }]
    return { ok: true as const, value: { kind: 'committed' as const, receipt: {}, message, task, thread, attention: [], directMarkers: [] } }
  })
  let changeVersion = 0
  const changeWaiters: Array<(value: { ok: true; value: { version: number } }) => void> = []
  const reply = vi.fn(async (request: AgentTeamReplyRequest) => {
    const top = viewItems[0]!
    const message = { ...(top.message as object), messageRef: 'message:human-reply', sender: 'member:human', body: request.body, topLevel: false, sequence: request.baseRevision + 1 }
    const thread = { ...(top.thread as object), revision: request.baseRevision + 1 }
    viewItems = [{ ...top, thread, mentions: [], messageCount: 2 }, { ...top, message, thread, mentions: [], messageCount: 2 }]
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
      anchor: top.message, anchorMentions: [], facts: [...viewItems.map(item => ({ fact: { kind: 'message' as const, sequence: (item.message as { sequence: number }).sequence, message: item.message, mentions: (item as { mentions?: string[] }).mentions ?? [] }, unread: false, direct: false })), ...viewActivities.map(activity => ({ fact: { kind: 'activity' as const, sequence: activity.sequence as number, activity }, unread: false, direct: false }))],
      readThroughSequence: (top.thread as { revision: number }).revision, remainingUnreadCount, consumedDirectMarkers: [],
    } }
  })
  const loadThreadHistory = vi.fn(async ({ taskRef }: { taskRef: string }) => {
    const top = viewItems.find(item => (item.task as { taskRef: string }).taskRef === taskRef) ?? viewItems[0]
    if (top === undefined) return { ok: false as const, error: { message: 'thread missing' } }
    return { ok: true as const, value: { task: top.task, thread: top.thread, anchor: top.message, anchorMentions: [], claims: viewClaims, facts: [], cursor: 0, hasMore: false } }
  })
  const resolveTaskRefs = vi.fn(async (request: { workspaceId: string; taskRefs: readonly string[] }) => {
    const numbers = new Map(viewItems.map((item, index) => [(item.task as { taskRef: string }).taskRef, index + 1]))
    // One Host-known Task lives outside the loaded channel timeline, so the
    // click fallback path has something real to resolve.
    const known = new Map(viewItems.map(item => [(item.task as { taskRef: string }).taskRef, item]))
    known.set('task:9c1b02aa-5d3e-4f0a-8b7c-1e2d3f4a5b6c', {
      task: { taskRef: 'task:9c1b02aa-5d3e-4f0a-8b7c-1e2d3f4a5b6c', channelRef: 'channel:engineering', threadRef: 'thread:9c1b02aa-5d3e-4f0a-8b7c-1e2d3f4a5b6d', status: 'todo', resolution: 'open' },
    })
    const resolved = request.taskRefs.flatMap(taskRef => {
      const item = known.get(taskRef)
      if (item === undefined) return []
      const task = item.task as { taskRef: string; channelRef: string; threadRef: string }
      return [{ taskRef: task.taskRef, channelRef: task.channelRef, threadRef: task.threadRef, taskNumber: numbers.get(task.taskRef) ?? 2 }]
    })
    return { ok: true as const, value: { resolved } }
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
  /** Simulates an externally driven channel/membership commit reaching every workspace waiter. */
  const seedChannel = (channel: Record<string, unknown>) => { channels = [...channels, channel] }
  const publishChannelUpdate = () => {
    changeVersion += 1
    for (const resolve of changeWaiters.splice(0)) resolve({ ok: true, value: { version: changeVersion } })
  }
  runtime.provide('remote', { agentTeam: { members, addMember, view: viewChannels, readThread, threadHistory: loadThreadHistory, putAttachment, getAttachment, createChannel, updateChannel, updateMember, recoverMember, restartMember, joinChannel, removeChannelMember, sendMessage, reply, changeTask, resolveTaskRefs, changes }, $mount: async () => async () => {} } as never)
  runtime.provide('remote.agentTeam', {})
  runtime.provide('connection', { api: { llm: { models: loadModels } } })
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
  return { runtime, team, view, disposeWorkspace, disposeSettings, disposeConversation, members, addMember, status, viewChannels, createChannel, updateChannel, putAttachment, getAttachment, updateMember, recoverMember, restartMember, loadModels, joinChannel, removeChannelMember, sendMessage, reply, changeTask, resolveTaskRefs, publishAgentReply, seedChannel, publishChannelUpdate, readThread, loadThreadHistory, changes }
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
    expect(await b.view.findByText('从左侧选择一个频道开始协作')).toBeTruthy()

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
    fireEvent.change(b.view.getByLabelText(/说明/), { target: { value: 'Reviews changes' } })
    // Channels ride the shared multi-select Menu now: open, check, leave open.
    fireEvent.click(b.view.getByRole('button', { name: /初始频道/ }))
    fireEvent.click(await within(document.body).findByRole('menuitem', { name: 'engineering' }))
    // The trigger keeps its aria-label; the count renders as content.
    expect(b.view.getByText('已选 1 个频道')).toBeTruthy()
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

  it('creates an Agent with empty description, no Channels, and an optional model', async () => {
    const b = await runtimeWithTeam({ initialChannels: true })
    fireEvent.click(b.view.getByRole('button', { name: '团队' }))
    await b.view.findByText('builder')
    fireEvent.click(b.view.getByRole('button', { name: '添加 Agent' }))
    fireEvent.change(b.view.getByLabelText('名称'), { target: { value: 'bare' } })
    // Description stays empty; the placeholder marks it optional.
    expect(b.view.getByPlaceholderText('留空则暂无描述')).toBeTruthy()
    // Pick a model through the capped menu; pinning reveals the effort row.
    fireEvent.click(await b.view.findByRole('button', { name: '模型' }))
    fireEvent.click(await within(document.body).findByRole('menuitem', { name: 'DeepSeek Chat' }))
    fireEvent.click(b.view.getByRole('button', { name: /推理强度/ }))
    fireEvent.click(await within(document.body).findByRole('menuitem', { name: 'high' }))
    // Channels stay untouched: the picker shows the empty prompt.
    expect(b.view.getByText('选择初始频道')).toBeTruthy()
    fireEvent.click(b.view.getByRole('button', { name: '创建 Agent' }))
    expect(await b.view.findByText('bare')).toBeTruthy()
    expect(b.addMember).toHaveBeenLastCalledWith(expect.objectContaining({
      workspaceId: 'w1', handle: 'bare', description: '', presetId: 'team-member', channelRefs: [],
      model: { provider: 'deepseek-official', model: 'deepseek-chat', reasoningEffort: 'high' },
    }))
    await b.runtime.dispose()
  })

  it('creates a Channel atomically with selected available Members and manages committed membership', async () => {
    const b = await runtimeWithTeam()
    fireEvent.click(b.view.getByRole('button', { name: '团队' }))
    expect(await b.view.findByText('还没有频道')).toBeTruthy()
    fireEvent.click(b.view.getByRole('button', { name: '新建频道' }))
    fireEvent.change(b.view.getByLabelText('名称'), { target: { value: 'backend' } })
    fireEvent.change(b.view.getByLabelText(/说明/), { target: { value: 'API implementation' } })
    fireEvent.click(b.view.getByRole('button', { name: /初始成员/ }))
    const unavailable = await within(document.body).findByRole('menuitem', { name: /offline/ }) as HTMLButtonElement
    expect(unavailable.disabled).toBe(true)
    fireEvent.click(await within(document.body).findByRole('menuitem', { name: /builder/ }))
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

  it('edits Channel membership from the sidebar row menu with idempotent retries', async () => {
    const b = await runtimeWithTeam({ initialChannels: true })
    fireEvent.click(b.view.getByRole('button', { name: '团队' }))
    expect(await b.view.findByText('# engineering')).toBeTruthy()

    fireEvent.click(b.view.getByRole('button', { name: 'engineering 的操作' }))
    fireEvent.click(await b.view.findByRole('menuitem', { name: '编辑频道' }))
    const editor = b.view.getByRole('dialog', { name: '编辑频道' })
    expect(within(editor).getByText('@builder')).toBeTruthy()
    // The fixture starts with an empty membership: builder's row offers Add.
    const builderRow = within(editor).getByText('@builder').closest('div') as HTMLElement
    expect(within(builderRow).getByRole('button', { name: '添加' })).toBeTruthy()
    // Offline members cannot join from here; their row stays disabled.
    const offlineRow = within(editor).getByText('@offline').closest('div') as HTMLElement
    expect((within(offlineRow).getByRole('button', { name: '添加' }) as HTMLButtonElement).disabled).toBe(true)

    b.joinChannel.mockResolvedValueOnce({ ok: false, error: { message: 'membership failed' } } as never)
    fireEvent.click(within(builderRow).getByRole('button', { name: '添加' }))
    expect(within(builderRow).getByRole('button', { name: '更新中…' })).toBeTruthy()
    expect((await within(builderRow).findByRole('alert')).textContent).toContain('membership failed')
    fireEvent.click(within(builderRow).getByRole('button', { name: '添加' }))
    await waitFor(() => { expect(b.joinChannel).toHaveBeenCalledTimes(2) })
    // The retry reuses the committed direction's request id until success.
    expect(b.joinChannel.mock.calls[0]![0].requestId).toBe(b.joinChannel.mock.calls[1]![0].requestId)
    await waitFor(() => { expect(within(builderRow).getByRole('button', { name: '移除' })).toBeTruthy() })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(b.view.queryByRole('dialog', { name: '编辑频道' })).toBeNull()
    await b.runtime.dispose()
  })

  it('renames Channel display facts from the editor and refreshes the row', async () => {
    const b = await runtimeWithTeam({ initialChannels: true })
    fireEvent.click(b.view.getByRole('button', { name: '团队' }))
    expect(await b.view.findByText('# engineering')).toBeTruthy()

    fireEvent.click(b.view.getByRole('button', { name: 'engineering 的操作' }))
    fireEvent.click(await b.view.findByRole('menuitem', { name: '编辑频道' }))
    const editor = b.view.getByRole('dialog', { name: '编辑频道' })
    // Save stays disabled until something actually changes.
    expect(((within(editor).getByRole('button', { name: '保存' }) as HTMLButtonElement)).disabled).toBe(true)
    fireEvent.change(within(editor).getByLabelText('名称'), { target: { value: 'platform' } })
    fireEvent.change(within(editor).getByLabelText(/说明/), { target: { value: 'Infrastructure work' } })
    fireEvent.click(within(editor).getByRole('button', { name: '保存' }))
    await waitFor(() => { expect(b.updateChannel).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'w1', channelRef: 'channel:engineering', name: 'platform', description: 'Infrastructure work',
    })) })
    // The committed rename rides the projection refresh, not an optimistic row edit.
    expect(await b.view.findByText('# platform')).toBeTruthy()
    expect(b.view.queryByText('# engineering')).toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    await b.runtime.dispose()
  })

  it('uploads composer attachments as chips, sends their ids, and renders the strip', async () => {
    const b = await runtimeWithTeam({ initialChannels: true })
    fireEvent.click(b.view.getByRole('button', { name: '团队' }))
    // Let the browser's one-time workspace selection settle first; a late
    // selectWorkspace would strip the channel ref mid-test.
    await waitFor(() => { expect(b.view.container.querySelector('[aria-current="page"]')?.textContent).toContain('Alpha') })
    fireEvent.click(await b.view.findByRole('button', { name: '# engineering' }))
    expect(await b.view.findByRole('heading', { name: '# engineering' })).toBeTruthy()
    const composer = b.view.container
    const chipCount = (): number => composer.querySelectorAll('ul[aria-label="添加附件"] > li').length

    // The "+" picker adds chips; the remove button drops one.
    const input = composer.querySelector('input[type="file"]') as HTMLInputElement
    const png = new File(['png'], 'shot.png', { type: 'image/png' })
    const pdf = new File(['pdf'], 'spec.pdf', { type: 'application/pdf' })
    await waitFor(() => { fireEvent.change(input, { target: { files: [png, pdf] } }) })
    await waitFor(() => { expect(chipCount()).toBe(2) })
    // Image drafts render an inline preview card; documents stay text cards.
    const chips = [...composer.querySelectorAll('ul[aria-label="添加附件"] > li')]
    expect(chips.find(chip => chip.textContent?.includes('shot.png'))?.querySelector('img')).toBeTruthy()
    expect(chips.find(chip => chip.textContent?.includes('spec.pdf'))?.querySelector('img')).toBeNull()
    fireEvent.click(composer.querySelector('[class*="fileChipRemove"]') as HTMLButtonElement)
    await waitFor(() => { expect(chipCount()).toBe(1) })
    expect(composer.querySelector('[class*="fileChipName"]')?.textContent).toBe('spec.pdf3 B')
    expect(composer.querySelector('[class*="fileChipSize"]')?.textContent).toBe('3 B')

    // Sending uploads the remaining file and passes its id to sendMessage.
    fireEvent.change(b.view.getByRole('textbox', { name: '消息内容' }), { target: { value: '带附件' } })
    fireEvent.click(b.view.getByRole('button', { name: '发送' }))
    await waitFor(() => { expect(b.putAttachment).toHaveBeenCalledWith(expect.objectContaining({ name: 'spec.pdf', mediaType: 'application/pdf' })) })
    await waitFor(() => { expect(b.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ body: '带附件', attachments: ['attachment:1'] })) })
    // Committed send clears the chips along with the draft...
    await waitFor(() => { expect(chipCount()).toBe(0) })
    // ...and the echoed message renders its image as a thumbnail.
    await waitFor(() => { expect(composer.querySelector('img[src^="data:image/png"]')).toBeTruthy() })

    // A second message whose bytes the Host no longer caches (GC'd) degrades
    // to an expiry chip: history stays honest about what was shared.
    await waitFor(() => { fireEvent.change(input, { target: { files: [new File(['gone'], 'expired.png', { type: 'image/png' })] } }) })
    await waitFor(() => { expect(chipCount()).toBe(1) })
    fireEvent.change(b.view.getByRole('textbox', { name: '消息内容' }), { target: { value: '图已过期' } })
    fireEvent.click(b.view.getByRole('button', { name: '发送' }))
    await waitFor(() => {
      const chips = [...b.view.container.querySelectorAll('[class*="attachmentChip"]')]
      return expect(chips.some(chip => chip.textContent?.includes('文件已过期清理'))).toBe(true)
    }, { timeout: 4000 })
    await b.runtime.dispose()
  })

  it('offers 恢复 in the row menu only for error Members and nudges through the Host remote', async () => {
    const b = await runtimeWithTeam({ initialChannels: true })
    fireEvent.click(b.view.getByRole('button', { name: '团队' }))
    await b.view.findByText('builder')

    // A healthy Member's menu carries only the editor entry.
    fireEvent.click(b.view.getByRole('button', { name: 'builder 的操作' }))
    const healthyMenu = await within(document.body).findByRole('menu')
    expect(within(healthyMenu).getByRole('menuitem', { name: '编辑 Agent' })).toBeTruthy()
    expect(within(healthyMenu).queryAllByRole('menuitem', { name: '恢复' })).toEqual([])
    // The restart entry is permanent: it is the mid-run refresh for schema updates.
    fireEvent.click(within(healthyMenu).getByRole('menuitem', { name: '重启会话' }))
    await waitFor(() => {
      expect(b.restartMember).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'w1', memberId: expect.any(String) }))
    })
    fireEvent.keyDown(document.body, { key: 'Escape' })

    // The error Member additionally gets the recovery entry.
    fireEvent.click(b.view.getByRole('button', { name: 'failed 的操作' }))
    fireEvent.click(await within(document.body).findByRole('menuitem', { name: '恢复' }))
    await waitFor(() => {
      expect(b.recoverMember).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'w1', memberId: 'member:failed' }))
    })
    await b.runtime.dispose()
  })

  it('edits Agent identity and pins a Member model through the editor', async () => {
    const b = await runtimeWithTeam({ initialChannels: true })
    fireEvent.click(b.view.getByRole('button', { name: '团队' }))
    await b.view.findByText('builder')

    fireEvent.click(b.view.getByRole('button', { name: 'builder 的操作' }))
    fireEvent.click(await b.view.findByRole('menuitem', { name: '编辑 Agent' }))
    const editor = b.view.getByRole('dialog', { name: '编辑 Agent' })
    // The Host catalog arrives session-independently; the picker rides the
    // shared Menu primitive with the default entry leading each open.
    const modelTrigger = await within(editor).findByRole('button', { name: '模型' })
    await waitFor(() => { expect(modelTrigger.textContent).toContain('跟随全局默认') })
    fireEvent.click(modelTrigger)
    const modelMenu = within(document.body).getByRole('menu')
    expect(within(modelMenu).getByText('DeepSeek')).toBeTruthy()
    fireEvent.click(within(modelMenu).getByRole('menuitem', { name: 'DeepSeek Reasoner' }))
    await waitFor(() => { expect(modelTrigger.textContent).toContain('DeepSeek Reasoner') })
    fireEvent.change(within(editor).getByLabelText('名称'), { target: { value: 'architect' } })
    fireEvent.change(within(editor).getByLabelText(/说明/), { target: { value: 'System design owner' } })
    fireEvent.click(within(editor).getByRole('button', { name: '保存' }))
    await waitFor(() => { expect(b.updateMember).toHaveBeenCalledWith(expect.objectContaining({
      memberId: 'member:builder', handle: 'architect', description: 'System design owner',
      model: { provider: 'deepseek-official', model: 'deepseek-reasoner' },
    })) })
    // The renamed handle reaches the roster through the refreshed projection.
    expect(await b.view.findByText('architect')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    await b.runtime.dispose()
  })

  it('opens the Member Session inside Team mode from the Agent card', async () => {
    const b = await runtimeWithTeam({ mode: 'team', workspaceId: 'w1', initialChannels: true })
    await b.runtime.sessions.add({ id: 'session:member:builder' as never, summary: { title: 'builder', cwd: '/work/alpha' } } as never)
    await b.view.findByText('builder')
    fireEvent.click(await b.view.findByRole('button', { name: '# engineering' }))
    expect(await b.view.findByRole('heading', { name: '# engineering' })).toBeTruthy()
    expect(document.documentElement.dataset.agentTeamMode).toBe('team')
    // Team views own the conversation seat before the card click.
    expect(b.view.container.querySelector('[data-baseline-conversation]')).toBeNull()

    fireEvent.click(b.view.getByRole('button', { name: '打开 builder 的会话' }))
    await waitFor(() => {
      expect(b.runtime.sessions.calls.some(call => call.method === 'open' && call.args[0] === 'session:member:builder')).toBe(true)
    })
    // The card stays inside Team mode: the chrome remains mounted and the
    // conversation seat yields to the shipped root rendering the Member Session.
    expect(document.documentElement.dataset.agentTeamMode).toBe('team')
    await waitFor(() => { expect(b.view.container.querySelector('[data-baseline-conversation]')).toBeTruthy() })
    expect(b.view.container.querySelector('[data-team-conversation]')).toBeNull()
    // The single positioning highlight moves to the selected Agent card; the
    // workspace overview row goes quiet.
    const card = b.view.getByRole('button', { name: '打开 builder 的会话' })
    await waitFor(() => { expect(card.getAttribute('aria-current')).toBe('page') })
    for (const row of b.view.container.querySelectorAll('[aria-current="page"]')) {
      expect(row).toBe(card)
    }

    // Explicit Team navigation closes the embedded Member view again.
    fireEvent.click(await b.view.findByRole('button', { name: '# engineering' }))
    await waitFor(() => { expect(b.view.container.querySelector('[data-team-channel]')).toBeTruthy() })
    expect(b.view.container.querySelector('[data-baseline-conversation]')).toBeNull()
    expect(card.getAttribute('aria-current')).toBeNull()
    await b.runtime.dispose()
  })

  it('edits an Agent Channel membership from the sidebar row menu', async () => {    const b = await runtimeWithTeam({ initialChannels: true })
    fireEvent.click(b.view.getByRole('button', { name: '团队' }))
    await b.view.findByText('builder')

    fireEvent.click(b.view.getByRole('button', { name: 'builder 的操作' }))
    fireEvent.click(await b.view.findByRole('menuitem', { name: '编辑 Agent' }))
    const editor = b.view.getByRole('dialog', { name: '编辑 Agent' })
    // No membership yet: every Channel row offers Add and the offline Agent stays blocked.
    expect(within(editor).getByRole('button', { name: '添加' })).toBeTruthy()
    fireEvent.click(within(editor).getByRole('button', { name: '添加' }))
    await waitFor(() => { expect(b.joinChannel).toHaveBeenCalledWith(expect.objectContaining({
      channelRef: 'channel:engineering', memberId: 'member:builder', workspaceId: 'w1',
    })) })
    await waitFor(() => { expect(within(editor).getByRole('button', { name: '移除' })).toBeTruthy() })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(b.view.queryByRole('dialog', { name: '编辑 Agent' })).toBeNull()
    await b.runtime.dispose()
  })

  it('opens a selected Channel in the Team center and sends only after Host commit', async () => {
    const b = await runtimeWithTeam({ remainingUnreadCount: 1 })
    fireEvent.click(b.view.getByRole('button', { name: '团队' }))
    fireEvent.click(await b.view.findByRole('button', { name: '新建频道' }))
    fireEvent.change(b.view.getByLabelText('名称'), { target: { value: 'backend' } })
    fireEvent.change(b.view.getByLabelText(/说明/), { target: { value: 'API' } })
    fireEvent.click(b.view.getByRole('button', { name: /初始成员/ }))
    fireEvent.click(await within(document.body).findByRole('menuitem', { name: /builder/ }))
    fireEvent.click(b.view.getByRole('button', { name: '创建频道' }))
    const backendChannel = await b.view.findByRole('button', { name: '# backend' })
    fireEvent.click(backendChannel)
    expect(backendChannel.closest('article')?.getAttribute('aria-current')).toBe('page')
    // Location moves to the leaf: the Channel row is the composition's only
    // aria-current='page', and the browsed Workspace row yields it.
    const currentPage = b.view.container.querySelector('[aria-current="page"]')
    expect(currentPage).toBe(backendChannel.closest('article'))
    expect(b.view.container.querySelectorAll('[aria-current="page"]')).toHaveLength(1)
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

  it('linkifies branded refs in agent plain-prose bodies that skip the mention path', async () => {
    const taskRef = 'task:0f0ad7ce-11d3-4c05-8a9e-6f2b1c9d7e31'
    const b = await runtimeWithTeam({
      mode: 'team', workspaceId: 'w1', initialChannels: true,
      seedTaskRef: taskRef, seedThreadRef: 'thread:0f0ad7ce-11d3-4c05-8a9e-6f2b1c9d7e32',
      seededMessages: [
        { body: `ref 样本：本 Task 是 ${taskRef}，对照散文 channel:engineering 应保持纯文本。`, occurredAt: '2026-08-21T09:00:00.000Z', sender: 'agent' },
      ],
    })
    fireEvent.click(await b.view.findByRole('button', { name: '# engineering' }))
    // The Agent body has no mentions, so it previously fell through to the
    // Markdown renderer and dropped the ref link entirely.
    const link = await b.view.findByRole('button', { name: taskRef })
    fireEvent.click(link)
    await waitFor(() => expect(b.readThread).toHaveBeenCalledWith(expect.objectContaining({ taskRef })))
    await b.runtime.dispose()
  })

  it('resolves unknown task refs to task numbers and navigates on click', async () => {
    const citedRef = 'task:9c1b02aa-5d3e-4f0a-8b7c-1e2d3f4a5b6c'
    const b = await runtimeWithTeam({
      mode: 'team', workspaceId: 'w1', initialChannels: true,
      seedTaskRef: 'task:0f0ad7ce-11d3-4c05-8a9e-6f2b1c9d7e51', seedThreadRef: 'thread:0f0ad7ce-11d3-4c05-8a9e-6f2b1c9d7e52',
      seededMessages: [{ body: `看 ${citedRef}`, occurredAt: '2026-08-21T09:00:00.000Z' }],
    })
    fireEvent.click(await b.view.findByRole('button', { name: '# engineering' }))
    // The cited ref is not in the loaded timeline: it renders raw, resolves
    // through the Host lookup, and relabels to the human-facing number.
    const link = await b.view.findByRole('button', { name: citedRef })
    await waitFor(() => { expect(b.resolveTaskRefs).toHaveBeenCalled() })
    // The Host knows the cited Task: the label becomes the human-facing
    // number with the full ref on hover.
    await waitFor(() => { expect(link.textContent).toBe('task#2') })
    expect(link.getAttribute('title')).toBe(citedRef)
    fireEvent.click(link)
    await waitFor(() => expect(b.readThread).toHaveBeenCalledWith(expect.objectContaining({ taskRef: citedRef })))
    await b.runtime.dispose()
  })

  it('falls back to a ref chip row when a rich Agent body cannot inline links', async () => {
    const taskRef = 'task:0f0ad7ce-11d3-4c05-8a9e-6f2b1c9d7e41'
    const b = await runtimeWithTeam({
      mode: 'team', workspaceId: 'w1', initialChannels: true,
      seedTaskRef: taskRef, seedThreadRef: 'thread:0f0ad7ce-11d3-4c05-8a9e-6f2b1c9d7e42',
      seededMessages: [
        { body: `看 **这个**：${taskRef}\n\n- 第一条`, occurredAt: '2026-08-21T09:00:00.000Z', sender: 'agent' },
      ],
    })
    fireEvent.click(await b.view.findByRole('button', { name: '# engineering' }))
    // The Markdown body keeps its rich rendering; the ref drops to the chip row.
    await b.view.findByText('第一条')
    expect(b.view.container.querySelector('strong')).toBeTruthy()
    const chipLink = await b.view.findByRole('button', { name: taskRef })
    fireEvent.click(chipLink)
    await waitFor(() => expect(b.readThread).toHaveBeenCalledWith(expect.objectContaining({ taskRef })))
    await b.runtime.dispose()
  })

  it('uploads thread reply attachments and passes their ids to reply', async () => {
    const b = await runtimeWithTeam({ initialChannels: true, remainingUnreadCount: 1, seededMessages: [{ body: '开个任务', occurredAt: '2026-08-21T09:00:00.000Z' }] })
    fireEvent.click(b.view.getByRole('button', { name: '团队' }))
    fireEvent.click(await b.view.findByRole('button', { name: '# engineering' }))
    fireEvent.click(await b.view.findByRole('button', { name: '打开 Task #1' }))
    expect(await b.view.findByRole('heading', { name: 'Task #1' })).toBeTruthy()
    const composer = b.view.container
    const chipCount = (): number => composer.querySelectorAll('ul[aria-label="添加附件"] > li').length

    // The reply composer offers the same "+" picker as the Channel composer.
    const input = composer.querySelector('input[type="file"]') as HTMLInputElement
    await waitFor(() => { fireEvent.change(input, { target: { files: [new File(['png'], 'evidence.png', { type: 'image/png' })] } }) })
    await waitFor(() => { expect(chipCount()).toBe(1) })

    fireEvent.change(b.view.getByRole('textbox', { name: '消息内容' }), { target: { value: '带截图的回复' } })
    fireEvent.click(b.view.getByRole('button', { name: '发送' }))
    await waitFor(() => { expect(b.putAttachment).toHaveBeenCalledWith(expect.objectContaining({ name: 'evidence.png', mediaType: 'image/png' })) })
    await waitFor(() => { expect(b.reply).toHaveBeenCalledWith(expect.objectContaining({ body: '带截图的回复', attachments: ['attachment:1'] })) })
    // Committed reply clears the chips along with the draft.
    await waitFor(() => { expect(chipCount()).toBe(0) })
    expect(await b.view.findByText('带截图的回复')).toBeTruthy()
    await b.runtime.dispose()
  })

  it('caches composer drafts across view switches and clears them on committed sends', async () => {
    const b = await runtimeWithTeam({ initialChannels: true })
    fireEvent.click(b.view.getByRole('button', { name: '团队' }))
    // A second Channel gives the draft somewhere to switch away to.
    fireEvent.click(await b.view.findByRole('button', { name: '新建频道' }))
    fireEvent.change(b.view.getByLabelText('名称'), { target: { value: 'backend' } })
    fireEvent.change(b.view.getByLabelText(/说明/), { target: { value: 'API' } })
    fireEvent.click(b.view.getByRole('button', { name: /初始成员/ }))
    fireEvent.click(await within(document.body).findByRole('menuitem', { name: /builder/ }))
    fireEvent.click(b.view.getByRole('button', { name: '创建频道' }))
    fireEvent.click(await b.view.findByRole('button', { name: '# engineering' }))
    expect(await b.view.findByRole('heading', { name: '# engineering' })).toBeTruthy()

    const input = b.view.getByRole('textbox', { name: '消息内容' }) as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: 'engineering draft' } })
    // Writes go straight through to the persisted cache.
    expect(JSON.parse(localStorage.getItem(TEAM_DRAFTS_STORAGE_KEY) ?? '{}')).toMatchObject({
      'channel:channel:engineering': { draft: 'engineering draft', recipientIds: [] },
    })

    // Switching views unmounts the page; returning restores from the cache.
    fireEvent.click(b.view.getByRole('button', { name: '# backend' }))
    expect(await b.view.findByRole('heading', { name: '# backend' })).toBeTruthy()
    expect((b.view.getByRole('textbox', { name: '消息内容' }) as HTMLTextAreaElement).value).toBe('')
    fireEvent.click(b.view.getByRole('button', { name: '# engineering' }))
    await waitFor(() => {
      const restored = b.view.getByRole('textbox', { name: '消息内容' }) as HTMLTextAreaElement
      return expect(restored.value).toBe('engineering draft')
    })

    // Failed sends keep the cached draft...
    b.sendMessage.mockResolvedValueOnce({ ok: false, error: { message: 'send failed' } } as never)
    fireEvent.click(b.view.getByRole('button', { name: '发送' }))
    expect((await b.view.findByRole('alert')).textContent).toContain('send failed')
    expect((b.view.getByRole('textbox', { name: '消息内容' }) as HTMLTextAreaElement).value).toBe('engineering draft')
    // ...and a committed send drops the key entirely.
    fireEvent.click(b.view.getByRole('button', { name: '发送' }))
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(TEAM_DRAFTS_STORAGE_KEY) ?? '{}') as Record<string, unknown>
      expect(stored['channel:channel:engineering']).toBeUndefined()
    })
    expect((b.view.getByRole('textbox', { name: '消息内容' }) as HTMLTextAreaElement).value).toBe('')
    await b.runtime.dispose()
  })

  it('rehydrates drafts from localStorage and prunes stale recipients on restore', async () => {
    const b = await runtimeWithTeam({ initialChannels: true })
    fireEvent.click(b.view.getByRole('button', { name: '团队' }))
    // Open the seeded Channel first so the browser's one-time workspace
    // selection settles before the new Channel row is clicked.
    fireEvent.click(await b.view.findByRole('button', { name: '# engineering' }))
    expect(await b.view.findByRole('heading', { name: '# engineering' })).toBeTruthy()
    fireEvent.click(b.view.getByRole('button', { name: '新建频道' }))
    fireEvent.change(b.view.getByLabelText('名称'), { target: { value: 'backend' } })
    fireEvent.change(b.view.getByLabelText(/说明/), { target: { value: 'API' } })
    fireEvent.click(b.view.getByRole('button', { name: /初始成员/ }))
    fireEvent.click(await within(document.body).findByRole('menuitem', { name: /builder/ }))
    fireEvent.click(b.view.getByRole('button', { name: '创建频道' }))
    fireEvent.click(await b.view.findByRole('button', { name: '# backend' }))
    expect(await b.view.findByRole('heading', { name: '# backend' })).toBeTruthy()

    // Seed the cache under the Channel's REAL ref, then reload — the same
    // content a fresh page load would rehydrate for this view.
    const channelRef = b.runtime.ctx.teamNavigation.getSnapshot().channelRef!
    localStorage.setItem(TEAM_DRAFTS_STORAGE_KEY, JSON.stringify({
      [`channel:${channelRef}`]: {
        draft: 'hello team @builder',
        recipientIds: ['member:builder', 'member:ghost'],
        savedAt: Date.now(),
      },
    }))
    b.runtime.ctx.teamDrafts.reload()

    // The restored text lands in the composer untouched...
    await waitFor(() => {
      const input = b.view.getByRole('textbox', { name: '消息内容' }) as HTMLTextAreaElement
      return expect(input.value).toBe('hello team @builder')
    })
    // ...while the Composer's convergence pass rewrites the cached entry with
    // only the recipients that are known Members still named in the draft.
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(TEAM_DRAFTS_STORAGE_KEY) ?? '{}') as Record<string, { recipientIds: string[] }>
      return expect(stored[`channel:${channelRef}`]?.recipientIds).toEqual(['member:builder'])
    })
    await b.runtime.dispose()
  })

  it('opens a Thread with one parallel request round and no self-triggered second wave', async () => {
    const b = await runtimeWithTeam()
    fireEvent.click(b.view.getByRole('button', { name: '团队' }))
    fireEvent.click(await b.view.findByRole('button', { name: '新建频道' }))
    fireEvent.change(b.view.getByLabelText('名称'), { target: { value: 'backend' } })
    fireEvent.change(b.view.getByLabelText(/说明/), { target: { value: 'API' } })
    fireEvent.click(b.view.getByRole('button', { name: /初始成员/ }))
    fireEvent.click(await within(document.body).findByRole('menuitem', { name: /builder/ }))
    fireEvent.click(b.view.getByRole('button', { name: '创建频道' }))
    fireEvent.click(await b.view.findByRole('button', { name: '# backend' }))
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

    // The page waits on its own thread scope. The workspace presence scope
    // rides the shared poll the always-mounted sidebar Agents section holds:
    // opening a Thread must not open a second workspace long-poll.
    const scopedCalls = b.changes.mock.calls.filter(([request]) => request.scope !== undefined)
    const scopes = scopedCalls.map(([request]) => request.scope as { kind: string; threadRef?: string })
    expect(scopes.some(scope => scope.kind === 'thread' && scope.threadRef === 'thread:1')).toBe(true)
    expect(scopes.some(scope => scope.kind === 'workspace')).toBe(false)
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
    fireEvent.click(await b.view.findByRole('button', { name: '新建频道' }))
    fireEvent.change(b.view.getByLabelText('名称'), { target: { value: 'backend' } })
    fireEvent.change(b.view.getByLabelText(/说明/), { target: { value: 'API' } })
    fireEvent.click(b.view.getByRole('button', { name: /初始成员/ }))
    fireEvent.click(await within(document.body).findByRole('menuitem', { name: /builder/ }))
    fireEvent.click(b.view.getByRole('button', { name: '创建频道' }))
    fireEvent.click(await b.view.findByRole('button', { name: '# backend' }))
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
      taskRef: 'task:1', sender: 'member:human', body: 'old backfill', topLevel: false, sequence: 1, occurredAt: '' }, mentions: [] }

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

    // A reader scrolled away from the tail keeps the explicit new-updates action.
    const timelineSection = document.querySelector('section[aria-label="消息时间线"]') as HTMLElement
    Object.defineProperty(timelineSection, 'scrollHeight', { configurable: true, value: 1000 })
    Object.defineProperty(timelineSection, 'clientHeight', { configurable: true, value: 120 })
    fireEvent.scroll(timelineSection)

    // A fact newer than everything shown is genuinely new and countable.
    historyWith([{ ...backfillFact, sequence: 9, message: { ...backfillFact.message, messageRef: 'message:new-9', body: 'genuinely new', sequence: 9 } }])
    b.publishAgentReply()
    expect(await b.view.findByText('读取 1 条新更新')).toBeTruthy()
    fireEvent.click(b.view.getByRole('button', { name: '标记为已读' }))
    await waitFor(() => expect(b.readThread).toHaveBeenCalledTimes(2))
    expect(b.view.queryByText(/读取 \d+ 条新更新/)).toBeNull()
    await b.runtime.dispose()
  })

  it('acknowledges arrivals a bottom-pinned reader is watching instead of prompting a manual read', async () => {
    const b = await runtimeWithTeam()
    fireEvent.click(b.view.getByRole('button', { name: '团队' }))
    fireEvent.click(await b.view.findByRole('button', { name: '新建频道' }))
    fireEvent.change(b.view.getByLabelText('名称'), { target: { value: 'backend' } })
    fireEvent.change(b.view.getByLabelText(/说明/), { target: { value: 'API' } })
    fireEvent.click(b.view.getByRole('button', { name: /初始成员/ }))
    fireEvent.click(await within(document.body).findByRole('menuitem', { name: /builder/ }))
    fireEvent.click(b.view.getByRole('button', { name: '创建频道' }))
    fireEvent.click(await b.view.findByRole('button', { name: '# backend' }))
    expect(await b.view.findByRole('heading', { name: '# backend' })).toBeTruthy()
    const messageInput = b.view.getByRole('textbox', { name: '消息内容' }) as HTMLTextAreaElement
    fireEvent.change(messageInput, { target: { value: 'first task' } })
    fireEvent.click(b.view.getByRole('button', { name: '发送' }))
    expect(await b.view.findByText('first task')).toBeTruthy()
    fireEvent.click(b.view.getByRole('button', { name: '打开 Task #1' }))
    expect(await b.view.findByRole('heading', { name: 'Task #1' })).toBeTruthy()
    await vi.waitFor(() => expect(b.loadThreadHistory).toHaveBeenCalledWith(expect.objectContaining({ taskRef: 'task:1', limit: 20 })))
    expect(b.readThread).toHaveBeenCalledTimes(1)

    const anchor = { messageRef: 'message:anchor', channelRef: 'channel:1', threadRef: 'thread:1', taskRef: 'task:1',
      sender: 'member:human', body: 'first task', topLevel: true, sequence: 2, occurredAt: '' }
    const watchedFact = { kind: 'message', sequence: 9, message: { messageRef: 'message:new-9', channelRef: 'channel:1', threadRef: 'thread:1',
      taskRef: 'task:1', sender: 'member:builder', body: 'watched live', topLevel: false, sequence: 9, occurredAt: '' }, mentions: [] }
    b.loadThreadHistory.mockImplementation(async () => ({ ok: true as const, value: {
      task: { taskRef: 'task:1', channelRef: 'channel:1', status: 'todo', resolution: 'open' },
      thread: { threadRef: 'thread:1', revision: 3 }, anchor, claims: [], facts: [watchedFact], cursor: 0, hasMore: false,
    } } as never))

    // The change stream swallows one wake inside its initial silent probe;
    // flush that probe so later wakes reach the listener.
    b.publishChannelUpdate()
    await vi.waitFor(() => expect(b.changes.mock.calls.some(([request]) => (request as { afterVersion?: number }).afterVersion === 1)).toBe(true))

    // jsdom never scrolls the reader away from the bottom, so the arriving
    // fact renders in front of them and must be acknowledged durably rather
    // than counted into the explicit new-updates prompt.
    b.publishChannelUpdate()
    await waitFor(() => expect(b.view.queryByText(/读取 \d+ 条新更新/)).toBeNull())
    expect(await b.view.findByText('watched live')).toBeTruthy()
    await waitFor(() => expect(b.readThread).toHaveBeenCalledTimes(2))
    expect(b.view.queryByRole('button', { name: '标记为已读' })).toBeNull()
    await b.runtime.dispose()
  })
  it('refreshes the sidebar Channel list from one workspace change', async () => {
    const b = await runtimeWithTeam({ mode: 'team', workspaceId: 'w1' })
    await b.view.findByText('还没有频道')
    expect(b.view.queryByRole('button', { name: '# gamma' })).toBeNull()
    b.seedChannel({ channelRef: 'channel:gamma', workspaceId: 'w1', name: 'gamma', description: 'Gamma work', createdAtSequence: 2 })
    // The stream's initial probe samples silently, so the first external bump
    // only arms the parked poll; the second one is what wakes the listener.
    b.publishChannelUpdate()
    await vi.waitFor(() => expect(b.changes.mock.calls.length).toBeGreaterThanOrEqual(2))
    b.publishChannelUpdate()
    await b.view.findByRole('button', { name: '# gamma' })
    expect(b.view.queryByText('还没有频道')).toBeNull()
    await b.runtime.dispose()
  })

  it('anchors timeline days when messages span dates', async () => {
    const b = await runtimeWithTeam({ mode: 'team', workspaceId: 'w1', initialChannels: true, seededMessages: [
      { body: 'day one status', occurredAt: '2026-08-19T09:00:00.000Z' },
      { body: 'day two follow-up', occurredAt: '2026-08-21T04:00:00.000Z' },
    ] })
    fireEvent.click(await b.view.findByRole('button', { name: '# engineering' }))
    expect(await b.view.findByText('day two follow-up')).toBeTruthy()
    // Exactly one quiet anchor for the crossed boundary; the first message of
    // the timeline opens its day without a leading marker.
    const dayAnchors = Array.from(b.view.container.querySelectorAll('p span')).filter(node => /^\d{2}-\d{2}$/.test(node.textContent ?? ''))
    expect(dayAnchors.map(node => node.textContent)).toEqual(['08-21'])
    await b.runtime.dispose()
  })

  it('separates wide same-sender gaps with a turn divider on both timelines', async () => {
    const b = await runtimeWithTeam({ mode: 'team', workspaceId: 'w1', initialChannels: true, seededMessages: [
      { body: 'burst one', occurredAt: '2026-08-21T09:00:00.000Z' },
      { body: 'burst two', occurredAt: '2026-08-21T09:01:00.000Z' },
      { body: 'later publication', occurredAt: '2026-08-21T11:30:00.000Z' },
    ] })
    fireEvent.click(await b.view.findByRole('button', { name: '# engineering' }))
    expect(await b.view.findByText('later publication')).toBeTruthy()
    // Only the two-hour gap earns a divider; the one-minute burst stays a
    // seamless run, and the label carries the later message's instant.
    const channelDividers = b.view.getAllByRole('separator')
    expect(channelDividers).toHaveLength(1)
    expect(channelDividers[0]!.querySelector('time')?.getAttribute('datetime')).toBe('2026-08-21T11:30:00.000Z')

    fireEvent.click(b.view.getAllByRole('button', { name: '打开 Task #1' })[0]!)
    expect(await b.view.findByRole('heading', { name: 'Task #1' })).toBeTruthy()
    const threadDividers = b.view.getAllByRole('separator')
    expect(threadDividers).toHaveLength(1)
    expect(threadDividers[0]!.querySelector('time')?.getAttribute('datetime')).toBe('2026-08-21T11:30:00.000Z')
    await b.runtime.dispose()
  })

  it('linkifies branded refs in plain bodies and navigates on click', async () => {
    const taskRef = 'task:0f0ad7ce-11d3-4c05-8a9e-6f2b1c9d7e21'
    const b = await runtimeWithTeam({
      mode: 'team', workspaceId: 'w1', initialChannels: true,
      seedTaskRef: taskRef, seedThreadRef: 'thread:0f0ad7ce-11d3-4c05-8a9e-6f2b1c9d7e22',
      seededMessages: [{ body: `see ${taskRef} and channel:engineering for prose`, occurredAt: '2026-08-21T09:00:00.000Z' }],
    })
    fireEvent.click(await b.view.findByRole('button', { name: '# engineering' }))
    // Only the fixed-prefix + UUID shape linkifies; `channel:engineering`
    // stays literal prose.
    expect(b.view.queryByText(taskRef)).toBeNull()
    const link = await b.view.findByRole('button', { name: taskRef })
    fireEvent.click(link)
    await waitFor(() => expect(b.readThread).toHaveBeenCalledWith(expect.objectContaining({ taskRef })))
    expect(await b.view.findByRole('heading', { name: 'Task #1' })).toBeTruthy()
    await b.runtime.dispose()
  })

})
