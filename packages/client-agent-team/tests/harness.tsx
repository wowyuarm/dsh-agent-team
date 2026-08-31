import { vi } from 'vitest'
import { useState } from 'react'
import type { WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
import type { AgentTeamAddMemberRequest, AgentTeamCreateChannelRequest, AgentTeamReplyRequest, AgentTeamSendMessageRequest } from '@wowyuarm/dsh-agent-team/types'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { apply as applySidebar, inject as injectSidebar } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { apply, inject } from '../src/client/index.ts'
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
  readonly mentions?: readonly string[]
}

export async function runtimeWithTeam(options?: { mode?: 'team'; workspaceId?: string; initialChannels?: boolean; remainingUnreadCount?: number; seededMessages?: readonly SeededMessage[]; seedTaskRef?: string; seedThreadRef?: string; seedTaskStatus?: 'in_progress' }) {
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
    mentions: seed.mentions ?? [],
    task: { taskRef: seedTaskRef, channelRef: 'channel:engineering', threadRef: seedThreadRef,
      status: options?.seedTaskStatus ?? 'todo', resolution: 'open' },
    thread: { threadRef: seedThreadRef, taskRef: seedTaskRef, revision: 2 },
    taskNumber: 1,
    messageCount: 1,
  }))
  let viewClaims: Array<Record<string, unknown>> = []
  let viewActivities: Array<Record<string, unknown>> = []
  const viewChannels = vi.fn(async (request: { threadRef?: string; topLevelOnly?: boolean }) => ({ ok: true, value: {
    humanMemberId: 'member:human', channels, members: memberships,
    tasks: viewItems.flatMap(item => item.task === undefined ? [] : [item.task]), threads: viewItems.length === 0 ? [] : [viewItems[0]!.thread],
    taskNumbers: viewItems.flatMap(item => item.task === undefined || item.taskNumber === undefined ? [] : [{ taskRef: (item.task as { taskRef: string }).taskRef, taskNumber: item.taskNumber }]),
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
  // The Host moves a renewed Member onto a freshly minted Session id, so the
  // mock transitions the row the way the real renewal does.
  let renewCounter = 0
  const clearMemberContext = vi.fn(async (request: { requestId: string; memberId: string }) => {
    renewCounter += 1
    memberRows = memberRows.map(entry => entry.member.memberId === request.memberId
      ? { ...entry, member: { ...entry.member, sessionId: `${entry.member.sessionId}-renewed-${renewCounter}` } }
      : entry)
    return {
      ok: true as const,
      value: { receipt: {}, status: memberRows.find(entry => entry.member.memberId === request.memberId) },
    }
  })
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
    const asTask = request.asTask === true
    const task = asTask ? { taskRef: 'task:1', channelRef: request.channelRef, threadRef: 'thread:1', status: 'todo', resolution: 'open' } : undefined
    const thread = { threadRef: 'thread:1', ...(asTask ? { taskRef: 'task:1' } : {}), revision: sequence }
    const attachments = request.attachments === undefined ? [] : request.attachments.map(id => ({ attachmentId: id, name: `file-${id}.png`, byteSize: 8, mediaType: 'image/png' }))
    const message = { messageRef: `message:${sequence}`, channelRef: request.channelRef, threadRef: 'thread:1', ...(asTask ? { taskRef: 'task:1' } : {}), sender: 'member:human', body: request.body, ...(attachments.length === 0 ? {} : { attachments }), topLevel: true, sequence, occurredAt: '2026-08-21T10:00:00.000Z' }
    viewItems = [{ message, mentions: [], ...(task === undefined ? {} : { task, taskNumber: 1 }), thread, messageCount: 1 }]
    return { ok: true as const, value: { kind: 'committed' as const, receipt: {}, message, ...(task === undefined ? {} : { task }), thread, attention: [], directMarkers: [] } }
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
  const promoteThread = vi.fn(async (request: { requestId: string; workspaceId: string; threadRef: string; baseRevision: number }) => {
    const top = viewItems.find(item => (item.thread as { threadRef: string }).threadRef === request.threadRef) ?? viewItems[0]
    if (top === undefined) return { ok: false as const, error: { message: 'thread missing' } }
    const task = { taskRef: 'task:1', channelRef: 'channel:engineering', threadRef: request.threadRef, status: 'todo', resolution: 'open' }
    const thread = { ...(top.thread as object), taskRef: task.taskRef, revision: request.baseRevision + 1 }
    const activity = { activityRef: 'activity:promoted', kind: 'promote' as const, taskRef: task.taskRef, threadRef: request.threadRef, actor: 'member:human', sequence: request.baseRevision + 1 }
    viewItems = viewItems.map(item => ({ ...item, task, thread, taskNumber: 1 }))
    return { ok: true as const, value: { kind: 'committed' as const, receipt: {}, activity, task, thread } }
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
  const readThread = vi.fn(async ({ taskRef, threadRef }: { taskRef?: string; threadRef?: string }) => {
    const top = viewItems.find(item => (threadRef !== undefined && (item.thread as { threadRef: string }).threadRef === threadRef)
      || (taskRef !== undefined && (item.task as { taskRef?: string } | undefined)?.taskRef === taskRef)) ?? viewItems[0]
    if (top === undefined) return { ok: false as const, error: { message: 'thread missing' } }
    const remainingUnreadCount = nextRemainingUnreadCount
    nextRemainingUnreadCount = 0
    return { ok: true as const, value: {
      receipt: {}, task: top.task, thread: top.thread, claims: viewClaims,
      anchor: top.message, anchorMentions: [], facts: [...viewItems.map(item => ({ fact: { kind: 'message' as const, sequence: (item.message as { sequence: number }).sequence, message: item.message, mentions: (item as { mentions?: string[] }).mentions ?? [] }, unread: false, direct: false })), ...viewActivities.map(activity => ({ fact: { kind: 'activity' as const, sequence: activity.sequence as number, activity }, unread: false, direct: false }))],
      readThroughSequence: (top.thread as { revision: number }).revision, remainingUnreadCount, consumedDirectMarkers: [],
    } }
  })
  const loadThreadHistory = vi.fn(async ({ taskRef, threadRef }: { taskRef?: string; threadRef?: string }) => {
    const top = viewItems.find(item => (threadRef !== undefined && (item.thread as { threadRef: string }).threadRef === threadRef)
      || (taskRef !== undefined && (item.task as { taskRef?: string } | undefined)?.taskRef === taskRef)) ?? viewItems[0]
    if (top === undefined) return { ok: false as const, error: { message: 'thread missing' } }
    return { ok: true as const, value: { task: top.task, thread: top.thread, anchor: top.message, anchorMentions: [], claims: viewClaims, facts: [], cursor: 0, hasMore: false } }
  })
  const resolveTaskRefs = vi.fn(async (request: { workspaceId: string; taskRefs: readonly string[] }) => {
    const numbers = new Map(viewItems.flatMap((item, index) => {
      const taskRef = (item.task as { taskRef?: string } | undefined)?.taskRef
      return taskRef === undefined ? [] : [[taskRef, index + 1] as const]
    }))
    // One Host-known Task lives outside the loaded channel timeline, so the
    // click fallback path has something real to resolve.
    const known = new Map(viewItems.flatMap(item => {
      const taskRef = (item.task as { taskRef?: string } | undefined)?.taskRef
      return taskRef === undefined ? [] : [[taskRef, item] as const]
    }))
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
  runtime.provide('remote', { agentTeam: { members, addMember, view: viewChannels, readThread, threadHistory: loadThreadHistory, putAttachment, getAttachment, createChannel, updateChannel, updateMember, recoverMember, clearMemberContext, joinChannel, removeChannelMember, sendMessage, reply, changeTask, promoteThread, resolveTaskRefs, changes }, $mount: async () => async () => {} } as never)
  runtime.provide('remote.agentTeam', {})
  runtime.provide('conversation', { input: { for: () => ({ submit: vi.fn() }) } } as never)
  runtime.provide('inputTriggers', {
    registerSource: () => () => {},
    sessionOf: () => ({ menu: { getSnapshot: () => ({ open: false }) }, dismiss() {}, toggleSource() {}, arbitrate: () => 'pass' }),
  } as never)
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
  return { runtime, team, view, disposeWorkspace, disposeSettings, disposeConversation, members, addMember, status, viewChannels, createChannel, updateChannel, putAttachment, getAttachment, updateMember, recoverMember, clearMemberContext, loadModels, joinChannel, removeChannelMember, sendMessage, reply, changeTask, promoteThread, resolveTaskRefs, publishAgentReply, seedChannel, publishChannelUpdate, readThread, loadThreadHistory, changes }
}
