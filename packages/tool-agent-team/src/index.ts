import type { Context } from '@deepseek-ai/cordis'
import AgentTeam, { markAgentTeamPreset } from '@deepseek-ai/dsh-agent-team'
import type {
  AgentTeamChannelRef,
  AgentTeamClaimRef,
  AgentTeamMemberId,
  AgentTeamRequestId,
  AgentTeamTaskRef,
} from '@deepseek-ai/dsh-agent-team/types'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'

export const name = 'dsh-tool-agent-team'
export const inject = ['tools']

function host(agent: NonNullable<Parameters<AgentTeam['viewForAgent']>[0]>): AgentTeam {
  const service = agent.ctx.get('agentTeam') as AgentTeam | undefined
  if (service === undefined) throw new Error('Agent Team Host is unavailable')
  return service
}

function requestId(sessionId: string, callId: string): AgentTeamRequestId {
  return `agent-team:tool:${sessionId}:${callId}` as AgentTeamRequestId
}

const teamSend = markAgentTeamPreset(defineTool({
  name: 'team_send',
  description: [
    'Reply to an existing Agent Team Task Thread.',
    'The current baseRevision is required; reread with team_view after a stale-revision error.',
    'Mentions are structured Member refs. Text such as @name does not address a Member.',
  ].join(' '),
  parameters: {
    workspaceId: { type: 'string', required: true },
    taskRef: { type: 'string', required: true },
    body: { type: 'string', required: true },
    baseRevision: { type: 'number', required: true },
    mentions: { type: 'array', items: { type: 'string' } },
  },
  output: {
    schema: {
      type: 'object', additionalProperties: false, properties: {
        operationId: { type: 'string', required: true },
        messageRef: { type: 'string', required: true },
        taskRef: { type: 'string', required: true },
        threadRef: { type: 'string', required: true },
        revision: { type: 'number', required: true },
        deliveries: { type: 'array', required: true, items: {
          type: 'object', additionalProperties: false, properties: {
            deliveryId: { type: 'string', required: true },
            recipient: { type: 'string', required: true },
            state: { type: 'string', required: true },
          },
        } },
      },
    },
    render: (_args, value) => [{ type: 'text', text:
      `Reply ${value.messageRef} committed at revision ${value.revision}. Deliveries: ${value.deliveries.map(d => `${d.recipient}=${d.state}`).join(', ') || 'none'}` }],
  },
  async execute(args, exec) {
    const agent = exec.agent
    if (agent === undefined) throw new Error('team_send requires an Agent session')
    if (!Number.isSafeInteger(args.baseRevision) || args.baseRevision < 1) throw new Error('baseRevision must be a positive integer')
    const result = await host(agent).replyForAgent(agent, {
      requestId: requestId(agent.id, exec.callId), workspaceId: WorkspaceId(args.workspaceId),
      taskRef: args.taskRef as AgentTeamTaskRef, body: args.body, baseRevision: args.baseRevision,
      ...(args.mentions === undefined ? {} : { recipients: args.mentions as AgentTeamMemberId[] }),
    })
    return {
      operationId: result.receipt.operationId, messageRef: result.message.messageRef,
      taskRef: result.task.taskRef, threadRef: result.thread.threadRef, revision: result.thread.revision,
      deliveries: result.deliveries.map(d => ({ deliveryId: d.deliveryId, recipient: d.recipient, state: d.state })),
    }
  },
}))

const claimShape = {
  claimRef: { type: 'string', required: true } as const,
  owner: { type: 'string', required: true } as const,
  direction: { type: 'string', required: true } as const,
  normalizedDirection: { type: 'string', required: true } as const,
  state: { type: 'string', required: true } as const,
}

const teamClaim = defineTool({
  name: 'team_claim',
  description: [
    'List or mutate Direction Claims on an authorized Task.',
    'Different normalized Directions may proceed in parallel; the same normalized Direction has one active owner.',
    'done and release can modify only your own active Claim.',
  ].join(' '),
  parameters: {
    action: { type: 'string', required: true, enum: ['list', 'claim', 'done', 'release'] },
    workspaceId: { type: 'string', required: true },
    taskRef: { type: 'string', required: true },
    direction: { type: 'string' },
    claimRef: { type: 'string' },
  },
  output: {
    schema: {
      type: 'object', additionalProperties: false, properties: {
        taskRef: { type: 'string', required: true },
        status: { type: 'string', required: true },
        revision: { type: 'number', required: true },
        claims: { type: 'array', required: true, items: {
          type: 'object', additionalProperties: false, properties: claimShape,
        } },
        operationId: { type: 'string' },
        activityRef: { type: 'string' },
      },
    },
    render: (_args, value) => [{ type: 'text', text: [
      `Task ${value.taskRef}: ${value.status}, revision ${value.revision}`,
      ...value.claims.map(c => `${c.claimRef} ${c.state} owner=${c.owner} direction=${c.direction} normalized=${c.normalizedDirection}`),
    ].join('\n') }],
  },
  async execute(args, exec) {
    const agent = exec.agent
    if (agent === undefined) throw new Error('team_claim requires an Agent session')
    const service = host(agent)
    const base = { workspaceId: WorkspaceId(args.workspaceId), taskRef: args.taskRef as AgentTeamTaskRef }
    if (args.action === 'list') {
      if (args.direction !== undefined || args.claimRef !== undefined) throw new Error('list does not accept direction or claimRef')
      const result = service.listClaimsForAgent(agent, base)
      return { taskRef: result.task.taskRef, status: result.task.status, revision: result.thread.revision,
        claims: result.claims.map(c => ({ claimRef: c.claimRef, owner: c.owner, direction: c.direction,
          normalizedDirection: c.normalizedDirection, state: c.state })) }
    }
    if (args.action === 'claim' && args.direction === undefined) throw new Error('claim requires direction')
    if ((args.action === 'done' || args.action === 'release') && args.claimRef === undefined) {
      throw new Error(`${args.action} requires claimRef`)
    }
    const result = await service.changeClaimForAgent(agent, {
      requestId: requestId(agent.id, exec.callId), ...base, action: args.action,
      ...(args.direction === undefined ? {} : { direction: args.direction }),
      ...(args.claimRef === undefined ? {} : { claimRef: args.claimRef as AgentTeamClaimRef }),
    })
    const listed = service.listClaimsForAgent(agent, base)
    return { taskRef: result.task.taskRef, status: result.task.status, revision: result.thread.revision,
      claims: listed.claims.map(c => ({ claimRef: c.claimRef, owner: c.owner, direction: c.direction,
        normalizedDirection: c.normalizedDirection, state: c.state })),
      operationId: result.receipt.operationId, activityRef: result.activity.activityRef }
  },
})

const teamView = defineTool({
  name: 'team_view',
  description: 'Read bounded Agent Team facts visible to this Member. Reuse opaque refs exactly as returned.',
  parameters: {
    workspaceId: { type: 'string', required: true }, channelRef: { type: 'string' },
    limit: { type: 'number' }, cursor: { type: 'number' },
  },
  output: {
    schema: { type: 'object', additionalProperties: false, properties: {
      channels: { type: 'array', required: true, items: { type: 'object', additionalProperties: false,
        properties: { channelRef: { type: 'string', required: true }, name: { type: 'string', required: true } } } },
      items: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
        messageRef: { type: 'string', required: true }, channelRef: { type: 'string', required: true },
        taskRef: { type: 'string', required: true }, threadRef: { type: 'string', required: true },
        sender: { type: 'string', required: true }, body: { type: 'string', required: true },
        status: { type: 'string', required: true }, revision: { type: 'number', required: true },
      } } },
      activities: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
        activityRef: { type: 'string', required: true }, kind: { type: 'string', required: true },
        taskRef: { type: 'string', required: true }, actor: { type: 'string', required: true },
        claimRef: { type: 'string', required: true }, sequence: { type: 'number', required: true },
      } } },
      cursor: { type: 'number', required: true }, hasMore: { type: 'boolean', required: true },
    } },
    render: (_args, value) => [{ type: 'text', text: value.items.length === 0
      ? `No matching Team messages. cursor=${value.cursor}`
      : value.items.map(i => `${i.messageRef} task=${i.taskRef} revision=${i.revision}\n${i.body}`).join('\n\n') }],
  },
  async execute(args, exec) {
    const agent = exec.agent
    if (agent === undefined) throw new Error('team_view requires an Agent session')
    const view = host(agent).viewForAgent(agent, { workspaceId: WorkspaceId(args.workspaceId),
      ...(args.channelRef === undefined ? {} : { channelRef: args.channelRef as AgentTeamChannelRef }),
      ...(args.limit === undefined ? {} : { limit: args.limit }), ...(args.cursor === undefined ? {} : { cursor: args.cursor }) })
    return { channels: view.channels.map(c => ({ channelRef: c.channelRef, name: c.name })),
      items: view.items.map(({ message, task, thread }) => ({ messageRef: message.messageRef,
        channelRef: message.channelRef, taskRef: task.taskRef, threadRef: thread.threadRef,
        sender: message.sender, body: message.body, status: task.status, revision: thread.revision })),
      activities: view.activities.map(a => ({ activityRef: a.activityRef, kind: a.kind, taskRef: a.taskRef,
        actor: a.actor, claimRef: a.claimRef, sequence: a.sequence })), cursor: view.cursor, hasMore: view.hasMore }
  },
})

export function apply(ctx: Context): void {
  ctx.tools.register(teamSend)
  ctx.tools.register(teamView)
  ctx.tools.register(teamClaim)
}
