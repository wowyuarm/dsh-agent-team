import type { Context } from '@deepseek-ai/cordis'
import AgentTeam, { markAgentTeamPreset } from '@deepseek-ai/dsh-agent-team'
import type {
  AgentTeamClaimRef,
  AgentTeamConfirmationToken,
  AgentTeamMemberId,
  AgentTeamRequestId,
  AgentTeamTaskRef,
  AgentTeamThreadRef,
} from '@deepseek-ai/dsh-agent-team/types'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'dsh-tool-agent-team'
export const inject = ['tools']

function service(agent: NonNullable<Parameters<AgentTeam['memberForAgent']>[0]>): AgentTeam {
  const host = agent.ctx.get('agentTeam') as AgentTeam | undefined
  if (host === undefined) throw new Error('Agent Team Host is unavailable')
  return host
}

function member(agent: NonNullable<Parameters<AgentTeam['memberForAgent']>[0]>) {
  const current = service(agent).memberForAgent(agent)
  if (current === undefined) throw new Error('team tool requires an active Team Member')
  return current
}

function requestId(agentId: string, callId: string): AgentTeamRequestId {
  return `agent-team:tool:${agentId}:${callId}` as AgentTeamRequestId
}

const teamInbox = defineTool({
  name: 'team_inbox',
  description: 'List your bounded Team Inbox. It returns Thread summaries without message bodies and does not mark anything read.',
  parameters: { limit: { type: 'number' } },
  output: {
    schema: { type: 'object', additionalProperties: false, properties: {
      totalUnreadCount: { type: 'number', required: true }, totalDirectCount: { type: 'number', required: true },
      items: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
        taskRef: { type: 'string', required: true }, threadRef: { type: 'string', required: true }, channelRef: { type: 'string', required: true },
        status: { type: 'string', required: true }, revision: { type: 'number', required: true }, unreadCount: { type: 'number', required: true }, directCount: { type: 'number', required: true },
      } } },
    } },
    render: (_args, value) => [{ type: 'text', text: value.items.length === 0 ? 'No unread Team work.'
      : value.items.map(item => `${item.directCount > 0 ? 'Direct' : 'Unread'} Task ${item.taskRef}: ${item.unreadCount} update(s), revision ${item.revision}`).join('\n') }],
  },
  async execute(args, exec) {
    const agent = exec.agent
    if (agent === undefined) throw new Error('team_inbox requires an Agent session')
    const current = member(agent)
    const inbox = service(agent).inboxForAgent(agent, { workspaceId: current.workspaceId, ...(args.limit === undefined ? {} : { limit: args.limit }) })
    return {
      totalUnreadCount: inbox.totalUnreadCount, totalDirectCount: inbox.totalDirectCount,
      items: inbox.items.map(item => ({ taskRef: item.task.taskRef, threadRef: item.thread.threadRef, channelRef: item.channelRef,
        status: item.task.status, revision: item.thread.revision, unreadCount: item.unreadCount, directCount: item.directCount })),
    }
  },
})

const teamThread = defineTool({
  name: 'team_thread',
  description: 'Read or manage your Attention on one Task Thread. read acknowledges one chronological batch; history does not change read state.',
  parameters: {
    action: { type: 'string', required: true, enum: ['status', 'follow', 'unfollow', 'read', 'history'] },
    taskRef: { type: 'string', required: true }, beforeSequence: { type: 'number' }, limit: { type: 'number' },
  },
  output: {
    schema: { type: 'object', additionalProperties: false, properties: {
      kind: { type: 'string', required: true }, taskRef: { type: 'string', required: true }, threadRef: { type: 'string', required: true },
      revision: { type: 'number', required: true }, following: { type: 'boolean', required: true }, readThroughSequence: { type: 'number' },
      facts: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
        sequence: { type: 'number', required: true }, kind: { type: 'string', required: true }, body: { type: 'string' }, activity: { type: 'string' }, unread: { type: 'boolean' }, direct: { type: 'boolean' },
      } } },
    } },
    render: (_args, value) => [{ type: 'text', text: value.facts.map(fact => `${fact.sequence} ${fact.kind === 'message' ? fact.body : fact.activity}`).join('\n') || `Thread ${value.threadRef}: following=${value.following}` }],
  },
  async execute(args, exec) {
    const agent = exec.agent
    if (agent === undefined) throw new Error('team_thread requires an Agent session')
    const current = member(agent)
    const host = service(agent)
    const base = { workspaceId: current.workspaceId, taskRef: args.taskRef as AgentTeamTaskRef }
    if (args.action === 'status') {
      const status = host.attentionStatusForAgent(agent, base)
      return { kind: 'status', taskRef: status.task.taskRef, threadRef: status.thread.threadRef, revision: status.thread.revision,
        following: status.attention !== undefined, ...(status.attention === undefined ? {} : { readThroughSequence: status.attention.readThroughSequence }), facts: [] }
    }
    if (args.action === 'follow' || args.action === 'unfollow') {
      if (args.beforeSequence !== undefined || args.limit !== undefined) throw new Error(`${args.action} does not accept history arguments`)
      const result = await host.changeAttentionForAgent(agent, { requestId: requestId(agent.id, exec.callId), ...base, action: args.action })
      return { kind: args.action, taskRef: result.task.taskRef, threadRef: result.thread.threadRef, revision: result.thread.revision,
        following: result.attention !== undefined, ...(result.attention === undefined ? {} : { readThroughSequence: result.attention.readThroughSequence }), facts: [] }
    }
    if (args.action === 'history') {
      const history = host.threadHistoryForAgent(agent, { ...base, ...(args.beforeSequence === undefined ? {} : { beforeSequence: args.beforeSequence }), ...(args.limit === undefined ? {} : { limit: args.limit }) })
      const status = host.attentionStatusForAgent(agent, base)
      return { kind: 'history', taskRef: history.task.taskRef, threadRef: history.thread.threadRef, revision: history.thread.revision,
        following: status.attention !== undefined, ...(status.attention === undefined ? {} : { readThroughSequence: status.attention.readThroughSequence }),
        facts: history.facts.map(fact => fact.kind === 'message'
          ? { sequence: fact.sequence, kind: 'message', body: fact.message.body }
          : { sequence: fact.sequence, kind: 'activity', activity: fact.activity.kind }), }
    }
    if (args.beforeSequence !== undefined || args.limit !== undefined) throw new Error('read does not accept history arguments')
    const read = await host.readThreadForAgent(agent, { requestId: requestId(agent.id, exec.callId), ...base })
    return { kind: 'read', taskRef: read.task.taskRef, threadRef: read.thread.threadRef, revision: read.thread.revision,
      following: read.attention !== undefined, ...(read.attention === undefined ? {} : { readThroughSequence: read.readThroughSequence }),
      facts: read.facts.map(entry => entry.fact.kind === 'message'
        ? { sequence: entry.fact.sequence, kind: 'message', body: entry.fact.message.body, unread: entry.unread, direct: entry.direct }
        : { sequence: entry.fact.sequence, kind: 'activity', activity: entry.fact.activity.kind, unread: entry.unread, direct: entry.direct }), }
  },
})

const teamMessage = markAgentTeamPreset(defineTool({
  name: 'team_message',
  description: 'Create a top-level Task or reply to one existing Task Thread. Read the Thread first; replies require its current revision. Structured mentions use Member refs, not @name text.',
  parameters: {
    action: { type: 'string', required: true, enum: ['start', 'reply'] }, channelRef: { type: 'string' }, taskRef: { type: 'string' },
    body: { type: 'string', required: true }, baseRevision: { type: 'number' }, mentions: { type: 'array', items: { type: 'string' } },
  },
  output: {
    schema: { type: 'object', additionalProperties: false, properties: {
      kind: { type: 'string', required: true }, taskRef: { type: 'string' }, threadRef: { type: 'string' }, revision: { type: 'number' },
      messageRef: { type: 'string' }, memberIds: { type: 'array', items: { type: 'string' } }, unreadCount: { type: 'number' }, directCount: { type: 'number' },
    } },
    render: (_args, value) => [{ type: 'text', text: value.kind === 'committed' ? `Message ${value.messageRef} committed at revision ${value.revision}.`
      : `${value.kind}: ${value.memberIds?.join(', ') ?? `Task ${value.taskRef ?? ''} revision ${value.revision ?? ''}`}` }],
  },
  async execute(args, exec) {
    const agent = exec.agent
    if (agent === undefined) throw new Error('team_message requires an Agent session')
    const current = member(agent)
    const host = service(agent)
    const mentions = args.mentions as AgentTeamMemberId[] | undefined
    if (args.action === 'start') {
      if (args.channelRef === undefined || args.taskRef !== undefined || args.baseRevision !== undefined) throw new Error('start requires channelRef and does not accept taskRef or baseRevision')
      const result = await host.sendMessageForAgent(agent, { requestId: requestId(agent.id, exec.callId), workspaceId: current.workspaceId,
        channelRef: args.channelRef as never, body: args.body, ...(mentions === undefined ? {} : { recipients: mentions }) })
      return messageOutcome(result)
    }
    const baseRevision = args.baseRevision
    if (args.taskRef === undefined || args.channelRef !== undefined || typeof baseRevision !== 'number' || !Number.isSafeInteger(baseRevision) || baseRevision < 1) {
      throw new Error('reply requires taskRef and a positive baseRevision, and does not accept channelRef')
    }
    const result = await host.replyForAgent(agent, { requestId: requestId(agent.id, exec.callId), workspaceId: current.workspaceId,
      taskRef: args.taskRef as AgentTeamTaskRef, body: args.body, baseRevision,
      ...(mentions === undefined ? {} : { recipients: mentions }) })
    return messageOutcome(result)
  },
}))

function messageOutcome(result: Awaited<ReturnType<AgentTeam['sendMessageForAgent']>> | Awaited<ReturnType<AgentTeam['replyForAgent']>>) {
  if (result.kind === 'committed') return { kind: result.kind, taskRef: result.task.taskRef, threadRef: result.thread.threadRef,
    revision: result.thread.revision, messageRef: result.message.messageRef }
  if (result.kind === 'member_not_following') return { kind: result.kind, memberIds: [...result.memberIds],
    ...(result.taskRef === undefined ? {} : { taskRef: result.taskRef }), ...(result.threadRef === undefined ? {} : { threadRef: result.threadRef, revision: result.revision }) }
  if (result.kind === 'unread_required') return { kind: result.kind, taskRef: result.taskRef, threadRef: result.threadRef,
    revision: result.revision, unreadCount: result.unreadCount, directCount: result.directCount }
  if (result.kind === 'stale_revision') return { kind: result.kind, taskRef: result.taskRef, threadRef: result.threadRef, revision: result.revision }
  throw new Error('Agents cannot receive invitation confirmations')
}

const teamClaim = defineTool({
  name: 'team_claim',
  description: 'List or mutate your Direction Claims. Read the Thread first; every mutation uses the current Thread revision.',
  parameters: {
    action: { type: 'string', required: true, enum: ['list', 'claim', 'done', 'release'] }, taskRef: { type: 'string', required: true },
    baseRevision: { type: 'number' }, direction: { type: 'string' }, claimRef: { type: 'string' },
  },
  output: {
    schema: { type: 'object', additionalProperties: false, properties: {
      kind: { type: 'string', required: true }, taskRef: { type: 'string', required: true }, revision: { type: 'number', required: true }, status: { type: 'string', required: true },
      claims: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { claimRef: { type: 'string', required: true }, direction: { type: 'string', required: true }, state: { type: 'string', required: true }, owner: { type: 'string', required: true } } } },
    } },
    render: (_args, value) => [{ type: 'text', text: `${value.kind}: Task ${value.taskRef} (${value.status}), revision ${value.revision}` }],
  },
  async execute(args, exec) {
    const agent = exec.agent
    if (agent === undefined) throw new Error('team_claim requires an Agent session')
    const current = member(agent)
    const host = service(agent)
    const base = { workspaceId: current.workspaceId, taskRef: args.taskRef as AgentTeamTaskRef }
    if (args.action === 'list') {
      if (args.baseRevision !== undefined || args.direction !== undefined || args.claimRef !== undefined) throw new Error('list accepts only taskRef')
      const listed = host.listClaimsForAgent(agent, base)
      return { kind: 'listed', taskRef: listed.task.taskRef, revision: listed.thread.revision, status: listed.task.status, claims: listed.claims.map(claim => ({ claimRef: claim.claimRef, owner: claim.owner, direction: claim.direction, state: claim.state })) }
    }
    const baseRevision = args.baseRevision
    if (typeof baseRevision !== 'number' || !Number.isSafeInteger(baseRevision) || baseRevision < 1) throw new Error('claim mutation requires a positive baseRevision')
    if (args.action === 'claim' && (args.direction === undefined || args.claimRef !== undefined)) throw new Error('claim requires direction and does not accept claimRef')
    if ((args.action === 'done' || args.action === 'release') && (args.claimRef === undefined || args.direction !== undefined)) throw new Error(`${args.action} requires claimRef and does not accept direction`)
    const result = await host.changeClaimForAgent(agent, { requestId: requestId(agent.id, exec.callId), ...base, action: args.action,
      baseRevision, ...(args.direction === undefined ? {} : { direction: args.direction }), ...(args.claimRef === undefined ? {} : { claimRef: args.claimRef as AgentTeamClaimRef }) })
    const listed = host.listClaimsForAgent(agent, base)
    if (result.kind === 'committed') return { kind: result.kind, taskRef: result.task.taskRef, revision: result.thread.revision, status: result.task.status, claims: listed.claims.map(claim => ({ claimRef: claim.claimRef, owner: claim.owner, direction: claim.direction, state: claim.state })) }
    return { kind: result.kind, taskRef: result.taskRef, revision: result.revision, status: listed.task.status, claims: listed.claims.map(claim => ({ claimRef: claim.claimRef, owner: claim.owner, direction: claim.direction, state: claim.state })) }
  },
})

const teamView = defineTool({
  name: 'team_view',
  description: 'Discover authorized Team Channels, Tasks, and Members. It is not a substitute for team_thread reading.',
  parameters: { channelRef: { type: 'string' }, limit: { type: 'number' }, cursor: { type: 'number' } },
  output: {
    schema: { type: 'object', additionalProperties: false, properties: {
      channels: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { channelRef: { type: 'string', required: true }, name: { type: 'string', required: true } } } },
      tasks: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { taskRef: { type: 'string', required: true }, threadRef: { type: 'string', required: true }, channelRef: { type: 'string', required: true }, status: { type: 'string', required: true }, revision: { type: 'number', required: true } } } },
      cursor: { type: 'number', required: true }, hasMore: { type: 'boolean', required: true },
    } },
    render: (_args, value) => [{ type: 'text', text: value.tasks.map(task => `${task.taskRef}: ${task.status}`).join('\n') || 'No Team Tasks.' }],
  },
  async execute(args, exec) {
    const agent = exec.agent
    if (agent === undefined) throw new Error('team_view requires an Agent session')
    const current = member(agent)
    const view = service(agent).viewForAgent(agent, { workspaceId: current.workspaceId, ...(args.channelRef === undefined ? {} : { channelRef: args.channelRef as never }), ...(args.limit === undefined ? {} : { limit: args.limit }), ...(args.cursor === undefined ? {} : { cursor: args.cursor }), topLevelOnly: true, includeActivities: false })
    return { channels: view.channels.map(channel => ({ channelRef: channel.channelRef, name: channel.name })), tasks: view.tasks.map(task => ({ taskRef: task.taskRef, threadRef: task.threadRef, channelRef: task.channelRef, status: task.status, revision: view.threads.find(thread => thread.threadRef === task.threadRef)?.revision ?? 0 })), cursor: view.cursor, hasMore: view.hasMore }
  },
})

export function apply(ctx: Context): void {
  ctx.tools.register(teamInbox)
  ctx.tools.register(teamThread)
  ctx.tools.register(teamMessage)
  ctx.tools.register(teamClaim)
  ctx.tools.register(teamView)
}
