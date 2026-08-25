import type { Context } from '@deepseek-ai/cordis'
import AgentTeam, { markAgentTeamPreset } from '@wowyuarm/dsh-agent-team/host'
import type {
  AgentTeamClaimRef,
  AgentTeamMemberId,
  AgentTeamRequestId,
  AgentTeamTaskRef,
} from '@wowyuarm/dsh-agent-team/types'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'wowyuarm-agent-team-tools'
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
        taskNumber: { type: 'number' },
      } } },
    } },
    render: (_args, value) => [{ type: 'text', text: value.items.length === 0 ? 'No unread Team work.'
      : value.items.map(item => `${item.taskRef}${item.taskNumber === undefined ? '' : ` (#${item.taskNumber})`} · ${item.directCount > 0 ? 'direct' : 'unread'}, ${item.unreadCount} update(s), revision ${item.revision}`).join('\n') }],
  },
  async execute(args, exec) {
    const agent = exec.agent
    if (agent === undefined) throw new Error('team_inbox requires an Agent session')
    const current = member(agent)
    const host = service(agent)
    const inbox = host.inboxForAgent(agent, { workspaceId: current.workspaceId, ...(args.limit === undefined ? {} : { limit: args.limit }) })
    const taskNumbers = new Map(host.viewForAgent(agent, { workspaceId: current.workspaceId, topLevelOnly: true, includeActivities: false })
      .taskNumbers.map(entry => [entry.taskRef, entry.taskNumber] as const))
    return {
      totalUnreadCount: inbox.totalUnreadCount, totalDirectCount: inbox.totalDirectCount,
      items: inbox.items.map(item => {
        const taskNumber = taskNumbers.get(item.task.taskRef)
        return { taskRef: item.task.taskRef, threadRef: item.thread.threadRef, channelRef: item.channelRef,
          status: item.task.status, revision: item.thread.revision, unreadCount: item.unreadCount, directCount: item.directCount,
          ...(taskNumber === undefined ? {} : { taskNumber }) }
      }),
    }
  },
})

const teamThread = defineTool({
  name: 'team_thread',
  description: 'Read or manage your Attention on one Task Thread. read acknowledges one chronological batch; history does not change read state.',
  parameters: {
    action: { type: 'string', required: true, enum: ['status', 'follow', 'unfollow', 'read', 'history'] },
    taskRef: { type: 'string', required: true, description: "Full branded Task ref exactly as returned by Team tools, including the 'task:' prefix." },
    beforeSequence: { type: 'number' }, limit: { type: 'number' },
  },
  output: {
    schema: { type: 'object', additionalProperties: false, properties: {
      kind: { type: 'string', required: true }, taskRef: { type: 'string', required: true }, threadRef: { type: 'string', required: true },
      revision: { type: 'number', required: true }, status: { type: 'string', required: true }, resolution: { type: 'string', required: true },
      following: { type: 'boolean', required: true }, readThroughSequence: { type: 'number' }, remainingUnreadCount: { type: 'number' }, cursor: { type: 'number' }, hasMore: { type: 'boolean' },
      anchor: { type: 'object', required: true, additionalProperties: false, properties: {
        messageRef: { type: 'string', required: true }, sender: { type: 'string', required: true }, body: { type: 'string', required: true }, sequence: { type: 'number', required: true },
      } },
      claims: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
        claimRef: { type: 'string', required: true }, direction: { type: 'string', required: true }, state: { type: 'string', required: true }, owner: { type: 'string', required: true },
      } } },
      facts: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
        sequence: { type: 'number', required: true }, kind: { type: 'string', required: true }, body: { type: 'string' }, sender: { type: 'string' }, mentions: { type: 'array', items: { type: 'string' } }, activity: { type: 'string' }, unread: { type: 'boolean' }, direct: { type: 'boolean' },
      } } },
    } },
    render: (_args, value) => [{ type: 'text', text: value.facts.length === 0
      ? `${value.threadRef} · revision ${value.revision}, following=${value.following}`
      : [`revision ${value.revision}`, ...value.facts.map(fact => fact.kind === 'message'
          ? `${fact.sequence} [${fact.sender ?? 'unknown sender'}] ${fact.body}`
          : `${fact.sequence} ${fact.activity}`)].join('\n') }],
  },
  async execute(args, exec) {
    const agent = exec.agent
    if (agent === undefined) throw new Error('team_thread requires an Agent session')
    const current = member(agent)
    const host = service(agent)
    const base = { workspaceId: current.workspaceId, taskRef: args.taskRef as AgentTeamTaskRef }
    if (args.action === 'status') {
      if (args.beforeSequence !== undefined || args.limit !== undefined) throw new Error('status does not accept history arguments')
      const status = host.attentionStatusForAgent(agent, base)
      const snapshot = host.threadHistoryForAgent(agent, { ...base, beforeSequence: 1, limit: 1 })
      return threadResult('status', snapshot, status.attention, [])
    }
    if (args.action === 'follow' || args.action === 'unfollow') {
      if (args.beforeSequence !== undefined || args.limit !== undefined) throw new Error(`${args.action} does not accept history arguments`)
      const result = await host.changeAttentionForAgent(agent, { requestId: requestId(agent.id, exec.callId), ...base, action: args.action })
      const snapshot = host.threadHistoryForAgent(agent, { ...base, beforeSequence: 1, limit: 1 })
      return threadResult(args.action, snapshot, result.attention, [])
    }
    if (args.action === 'history') {
      const history = host.threadHistoryForAgent(agent, { ...base, ...(args.beforeSequence === undefined ? {} : { beforeSequence: args.beforeSequence }), ...(args.limit === undefined ? {} : { limit: args.limit }) })
      const status = host.attentionStatusForAgent(agent, base)
      return threadResult('history', history, status.attention, history.facts.map(fact => fact.kind === 'message'
          ? { sequence: fact.sequence, kind: 'message', body: fact.message.body, sender: fact.message.sender, mentions: [...fact.mentions] }
          : { sequence: fact.sequence, kind: 'activity', activity: fact.activity.kind }), { cursor: history.cursor, hasMore: history.hasMore })
    }
    if (args.beforeSequence !== undefined || args.limit !== undefined) throw new Error('read does not accept history arguments')
    const read = await host.readThreadForAgent(agent, { requestId: requestId(agent.id, exec.callId), ...base })
    return threadResult('read', read, read.attention, read.facts.map(entry => entry.fact.kind === 'message'
        ? { sequence: entry.fact.sequence, kind: 'message', body: entry.fact.message.body, sender: entry.fact.message.sender, mentions: [...entry.fact.mentions], unread: entry.unread, direct: entry.direct }
        : { sequence: entry.fact.sequence, kind: 'activity', activity: entry.fact.activity.kind, unread: entry.unread, direct: entry.direct }), { readThroughSequence: read.readThroughSequence, remainingUnreadCount: read.remainingUnreadCount })
  },
})

function threadResult(
  kind: 'status' | 'follow' | 'unfollow' | 'read' | 'history',
  snapshot: Awaited<ReturnType<AgentTeam['readThreadForAgent']>> | ReturnType<AgentTeam['threadHistoryForAgent']>,
  attention: Awaited<ReturnType<AgentTeam['readThreadForAgent']>>['attention'],
  facts: Array<{ sequence: number; kind: string; body?: string; sender?: string; mentions?: string[]; activity?: string; unread?: boolean; direct?: boolean }>,
  extra: { cursor?: number; hasMore?: boolean; readThroughSequence?: number; remainingUnreadCount?: number } = {},
) {
  return {
    kind, taskRef: snapshot.task.taskRef, threadRef: snapshot.thread.threadRef, revision: snapshot.thread.revision,
    status: snapshot.task.status, resolution: snapshot.task.resolution, following: attention !== undefined,
    ...extra,
    ...(attention === undefined || extra.readThroughSequence !== undefined ? {} : { readThroughSequence: attention.readThroughSequence }),
    anchor: { messageRef: snapshot.anchor.messageRef, sender: snapshot.anchor.sender, body: snapshot.anchor.body, sequence: snapshot.anchor.sequence },
    claims: snapshot.claims.map(claim => ({ claimRef: claim.claimRef, direction: claim.direction, state: claim.state, owner: claim.owner })),
    facts,
  }
}

const teamMessage = markAgentTeamPreset(defineTool({
  name: 'team_message',
  description: 'Create a top-level Task or reply to one existing Task Thread. Read the Thread first; replies require its current revision. A top-level start may mention related Agents directly; in replies, only a Human can invite an unfollowed Agent. Pass Member refs in mentions and spell their handles inside the body; only mentioned Members render as mention chips.',
  parameters: {
    action: { type: 'string', required: true, enum: ['start', 'reply'] },
    channelRef: { type: 'string', description: "Full branded Channel ref exactly as returned by Team tools, including the 'channel:' prefix." },
    taskRef: { type: 'string', description: "Full branded Task ref exactly as returned by Team tools, including the 'task:' prefix." },
    body: { type: 'string', required: true }, baseRevision: { type: 'number', description: "Positive integer; use the current Thread revision as shown by the latest team_inbox or team_thread result for this Task." },
    mentions: { type: 'array', items: { type: 'string' }, description: 'Member refs to mention. Mentioned Agents receive the Message directly; write their handles in the body (any casing, optional @) so the mention renders inline.' },
    attachments: { type: 'array', items: { type: 'string' }, description: 'Absolute file paths to share, e.g. screenshots or generated artifacts; images render as thumbnails for recipients. The Host validates each path and copies the file into the attachment cache, and members also receive one cached path per attachment; if any path fails validation the whole send is rejected.' },
  },
  output: {
    schema: { type: 'object', additionalProperties: false, properties: {
      kind: { type: 'string', required: true }, taskRef: { type: 'string' }, threadRef: { type: 'string' }, revision: { type: 'number' },
      expectedRevision: { type: 'number' }, messageRef: { type: 'string' }, memberIds: { type: 'array', items: { type: 'string' } }, unreadCount: { type: 'number' }, directCount: { type: 'number' },
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
    const rawPaths = args.attachments
    const attachmentPaths = Array.isArray(rawPaths) ? rawPaths.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '') : undefined
    const paths = attachmentPaths !== undefined && attachmentPaths.length > 0 ? { attachmentPaths } : {}
    if (args.action === 'start') {
      if (args.channelRef === undefined || args.taskRef !== undefined || args.baseRevision !== undefined) throw new Error('start requires channelRef and does not accept taskRef or baseRevision')
      const result = await host.sendMessageForAgent(agent, { requestId: requestId(agent.id, exec.callId), workspaceId: current.workspaceId,
        channelRef: args.channelRef as never, body: args.body, ...(mentions === undefined ? {} : { recipients: mentions }), ...paths })
      return messageOutcome(result)
    }
    const baseRevision = args.baseRevision
    if (args.taskRef === undefined || args.channelRef !== undefined || typeof baseRevision !== 'number' || !Number.isSafeInteger(baseRevision) || baseRevision < 1) {
      throw new Error("reply requires taskRef and a positive baseRevision, and does not accept channelRef; use the current Thread 'revision' returned by team_inbox or team_thread for this Task")
    }
    const result = await host.replyForAgent(agent, { requestId: requestId(agent.id, exec.callId), workspaceId: current.workspaceId,
      taskRef: args.taskRef as AgentTeamTaskRef, body: args.body, baseRevision,
      ...(mentions === undefined ? {} : { recipients: mentions }), ...paths })
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
  if (result.kind === 'stale_revision') return { kind: result.kind, taskRef: result.taskRef, threadRef: result.threadRef,
    expectedRevision: result.expectedRevision, revision: result.revision }
  throw new Error('Agents cannot receive invitation confirmations')
}

const teamClaim = defineTool({
  name: 'team_claim',
  description: 'List or mutate your Direction Claims. Read the Thread first; every mutation uses the current Thread revision.',
  parameters: {
    action: { type: 'string', required: true, enum: ['list', 'claim', 'done', 'release'] },
    taskRef: { type: 'string', required: true, description: "Full branded Task ref exactly as returned by Team tools, including the 'task:' prefix." },
    baseRevision: { type: 'number', description: "Positive integer; use the current Thread revision as shown by the latest team_inbox or team_thread result for this Task." }, direction: { type: 'string' },
    claimRef: { type: 'string', description: "Full branded Claim ref exactly as returned by team_claim, including the 'claim:' prefix." },
  },
  output: {
    schema: { type: 'object', additionalProperties: false, properties: {
      kind: { type: 'string', required: true }, taskRef: { type: 'string', required: true }, threadRef: { type: 'string', required: true },
      revision: { type: 'number', required: true }, expectedRevision: { type: 'number' }, status: { type: 'string', required: true },
      unreadCount: { type: 'number' }, directCount: { type: 'number' },
      claims: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { claimRef: { type: 'string', required: true }, direction: { type: 'string', required: true }, state: { type: 'string', required: true }, owner: { type: 'string', required: true } } } },
    } },
    render: (_args, value) => [{ type: 'text', text: [`${value.kind}: ${value.taskRef} · ${value.status}, revision ${value.revision}`,
      ...value.claims.map(claim => `${claim.claimRef} · ${claim.state} — ${claim.owner}: ${claim.direction}`)].join('\n') }],
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
      return { kind: 'listed', taskRef: listed.task.taskRef, threadRef: listed.thread.threadRef, revision: listed.thread.revision, status: listed.task.status,
        claims: listed.claims.map(claim => ({ claimRef: claim.claimRef, owner: claim.owner, direction: claim.direction, state: claim.state })) }
    }
    const baseRevision = args.baseRevision
    if (typeof baseRevision !== 'number' || !Number.isSafeInteger(baseRevision) || baseRevision < 1) throw new Error("claim mutation requires a positive baseRevision; use the current Thread 'revision' returned by team_inbox or team_thread for this Task")
    if (args.action === 'claim' && (args.direction === undefined || args.claimRef !== undefined)) throw new Error('claim requires direction and does not accept claimRef')
    if ((args.action === 'done' || args.action === 'release') && (args.claimRef === undefined || args.direction !== undefined)) throw new Error(`${args.action} requires claimRef and does not accept direction`)
    const result = await host.changeClaimForAgent(agent, { requestId: requestId(agent.id, exec.callId), ...base, action: args.action,
      baseRevision, ...(args.direction === undefined ? {} : { direction: args.direction }), ...(args.claimRef === undefined ? {} : { claimRef: args.claimRef as AgentTeamClaimRef }) })
    const listed = host.listClaimsForAgent(agent, base)
    const claims = listed.claims.map(claim => ({ claimRef: claim.claimRef, owner: claim.owner, direction: claim.direction, state: claim.state }))
    if (result.kind === 'committed') return { kind: result.kind, taskRef: result.task.taskRef, threadRef: result.thread.threadRef,
      revision: result.thread.revision, status: result.task.status, claims }
    if (result.kind === 'unread_required') return { kind: result.kind, taskRef: result.taskRef, threadRef: result.threadRef,
      revision: result.revision, status: listed.task.status, unreadCount: result.unreadCount, directCount: result.directCount, claims }
    return { kind: result.kind, taskRef: result.taskRef, threadRef: result.threadRef, expectedRevision: result.expectedRevision,
      revision: result.revision, status: listed.task.status, claims }
  },
})

const teamView = defineTool({
  name: 'team_view',
  description: 'Discover authorized Team Channels, Tasks, and Members. It is not a substitute for team_thread reading.',
  parameters: {
    channelRef: { type: 'string', description: "Full branded Channel ref exactly as returned by Team tools, including the 'channel:' prefix." },
    limit: { type: 'number' }, cursor: { type: 'number' },
  },
  output: {
    schema: { type: 'object', additionalProperties: false, properties: {
      channels: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { channelRef: { type: 'string', required: true }, name: { type: 'string', required: true } } } },
      members: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
        memberId: { type: 'string', required: true }, kind: { type: 'string', required: true }, handle: { type: 'string', required: true }, description: { type: 'string', required: true }, presence: { type: 'string', required: true },
      } } },
      tasks: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { taskRef: { type: 'string', required: true }, threadRef: { type: 'string', required: true }, channelRef: { type: 'string', required: true }, status: { type: 'string', required: true }, revision: { type: 'number', required: true } } } },
      cursor: { type: 'number', required: true }, hasMore: { type: 'boolean', required: true },
    } },
    render: (_args, value) => [{ type: 'text', text: [
      ...value.channels.map(channel => `${channel.channelRef} · ${channel.name}`),
      ...value.members.map(m => `${m.memberId} · ${m.handle} (${m.kind}, ${m.presence})${m.description === '' ? '' : ` — ${m.description}`}`),
      ...(value.tasks.length > 0
        ? value.tasks.map(task => `${task.taskRef} · ${task.status}`)
        : ['No Team Tasks.']),
    ].join('\n') }],
  },
  async execute(args, exec) {
    const agent = exec.agent
    if (agent === undefined) throw new Error('team_view requires an Agent session')
    const current = member(agent)
    const host = service(agent)
    const view = host.viewForAgent(agent, { workspaceId: current.workspaceId, ...(args.channelRef === undefined ? {} : { channelRef: args.channelRef as never }), ...(args.limit === undefined ? {} : { limit: args.limit }), ...(args.cursor === undefined ? {} : { cursor: args.cursor }), topLevelOnly: true, includeActivities: false })
    const visibleMemberIds = new Set(view.members.map(membership => membership.memberId))
    return {
      channels: view.channels.map(channel => ({ channelRef: channel.channelRef, name: channel.name })),
      members: [
        { memberId: view.humanMemberId, kind: 'human', handle: 'human', description: 'Human Team Member', presence: 'available' },
        ...host.members().filter(status => visibleMemberIds.has(status.member.memberId)).map(status => ({ memberId: status.member.memberId,
          kind: 'agent', handle: status.member.handle, description: status.member.description, presence: status.presence })),
      ],
      tasks: view.tasks.map(task => ({ taskRef: task.taskRef, threadRef: task.threadRef, channelRef: task.channelRef,
        status: task.status, revision: view.threads.find(thread => thread.threadRef === task.threadRef)?.revision ?? 0 })),
      cursor: view.cursor, hasMore: view.hasMore,
    }
  },
})

export function apply(ctx: Context): void {
  ctx.tools.register(teamInbox)
  ctx.tools.register(teamThread)
  ctx.tools.register(teamMessage)
  ctx.tools.register(teamClaim)
  ctx.tools.register(teamView)
}
