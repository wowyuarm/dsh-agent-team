import type { Context } from '@deepseek-ai/cordis'
import type AgentTeam from '@deepseek-ai/dsh-agent-team'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { AgentTeamChannelRef } from '@deepseek-ai/dsh-agent-team/types'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'

export const name = 'dsh-tool-agent-team'
export const inject = ['tools']

const teamView = defineTool({
  name: 'team_view',
  description: [
    'Read bounded Agent Team collaboration facts visible to this Member.',
    'Use opaque refs exactly as returned; do not invent Channel, Message, Task, or Thread refs.',
    'Results include a continuation cursor and never grant access to Channels this Member has not joined.',
  ].join(' '),
  parameters: {
    workspaceId: { type: 'string', required: true, description: 'Workspace id.' },
    channelRef: { type: 'string', description: 'Optional opaque Channel ref.' },
    limit: { type: 'number', description: 'Maximum items, from 1 through 100.' },
    cursor: { type: 'number', description: 'Continue after this non-negative sequence.' },
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        channels: {
          type: 'array',
          required: true,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              channelRef: { type: 'string', required: true },
              name: { type: 'string', required: true },
            },
          },
        },
        items: {
          type: 'array',
          required: true,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              messageRef: { type: 'string', required: true },
              channelRef: { type: 'string', required: true },
              taskRef: { type: 'string', required: true },
              threadRef: { type: 'string', required: true },
              sender: { type: 'string', required: true },
              body: { type: 'string', required: true },
              status: { type: 'string', required: true },
              revision: { type: 'number', required: true },
            },
          },
        },
        cursor: { type: 'number', required: true },
        hasMore: { type: 'boolean', required: true },
      },
    },
    render: (_args, value) => [{
      type: 'text',
      text: value.items.length === 0
        ? `No matching Team messages. cursor=${value.cursor}`
        : value.items.map(item => [
            `${item.messageRef} task=${item.taskRef} thread=${item.threadRef}`,
            `channel=${item.channelRef} sender=${item.sender} status=${item.status} revision=${item.revision}`,
            item.body,
          ].join('\n')).join('\n\n') + `\n\ncursor=${value.cursor} hasMore=${value.hasMore}`,
    }],
  },
  async execute(args, exec) {
    const agent = exec.agent
    if (agent === undefined) throw new Error('team_view requires an Agent session')
    const agentTeam = agent.ctx.get('agentTeam') as AgentTeam | undefined
    if (agentTeam === undefined) throw new Error('Agent Team Host is unavailable')
    const view = agentTeam.viewForAgent(agent, {
      workspaceId: WorkspaceId(args.workspaceId),
      ...(args.channelRef === undefined ? {} : { channelRef: args.channelRef as AgentTeamChannelRef }),
      ...(args.limit === undefined ? {} : { limit: args.limit }),
      ...(args.cursor === undefined ? {} : { cursor: args.cursor }),
    })
    return {
      channels: view.channels.map(channel => ({ channelRef: channel.channelRef, name: channel.name })),
      items: view.items.map(({ message, task, thread }) => ({
        messageRef: message.messageRef,
        channelRef: message.channelRef,
        taskRef: task.taskRef,
        threadRef: thread.threadRef,
        sender: message.sender,
        body: message.body,
        status: task.status,
        revision: thread.revision,
      })),
      cursor: view.cursor,
      hasMore: view.hasMore,
    }
  },
})

export function apply(ctx: Context): void {
  ctx.tools.register(teamView)
}
