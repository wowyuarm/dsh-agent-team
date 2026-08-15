/** Human `/team` command adapter for the Agent Team host capability. */

import type { Context } from '@deepseek-ai/cordis'
import type {
  AgentTeamChannelRef,
  AgentTeamRequestId,
} from '@deepseek-ai/dsh-agent-team'
import type {} from '@deepseek-ai/dsh-commands'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'

export const name = 'command-agent-team'
export const inject = ['agentTeam', 'commands']

export const USAGE = 'usage: /team status | /team channel create <workspaceId> <name> | /team send <workspaceId> <channelRef> <body> | /team view <workspaceId> [channelRef] [limit] [cursor]'

/** Register `/team` and derive business idempotency from commandId. */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.commands.register({
    name: 'team',
    description: 'Inspect and manage the Agent Team',
    input: { hint: 'status | channel create | send | view' },
    handler: async ({ rawInput, commandId }) => {
      const parts = rawInput.trim().split(/\s+/)
      if (parts.length === 1 && (parts[0] === '' || parts[0] === 'status')) {
        return statusResult(ctx)
      }
      try {
        if (parts[0] === 'channel' && parts[1] === 'create' && parts.length >= 4) {
          const result = await ctx.agentTeam.createChannel({
            requestId: commandId as unknown as AgentTeamRequestId,
            workspaceId: WorkspaceId(parts[2]!),
            name: parts.slice(3).join(' '),
          })
          return {
            kind: 'success' as const,
            text: `Channel created: ${result.channel.channelRef} (sequence ${result.receipt.sequence})`,
          }
        }
        if (parts[0] === 'send' && parts.length >= 4) {
          const result = await ctx.agentTeam.sendMessage({
            requestId: commandId as unknown as AgentTeamRequestId,
            workspaceId: WorkspaceId(parts[1]!),
            channelRef: parts[2] as AgentTeamChannelRef,
            body: parts.slice(3).join(' '),
          })
          return {
            kind: 'success' as const,
            text: `Message sent: ${result.message.messageRef}; task ${result.task.taskRef}; thread ${result.thread.threadRef} at revision ${result.thread.revision}`,
          }
        }
        if (parts[0] === 'view' && parts.length >= 2 && parts.length <= 5) {
          const channelRef = parts[2] === undefined
            ? undefined
            : parts[2] as AgentTeamChannelRef
          const limit = parts[3] === undefined ? undefined : Number(parts[3])
          const cursor = parts[4] === undefined ? undefined : Number(parts[4])
          const result = ctx.agentTeam.view({
            workspaceId: WorkspaceId(parts[1]!),
            ...(channelRef === undefined ? {} : { channelRef }),
            ...(limit === undefined ? {} : { limit }),
            ...(cursor === undefined ? {} : { cursor }),
          })
          return { kind: 'success' as const, text: JSON.stringify(result) }
        }
        return { kind: 'error' as const, text: USAGE }
      } catch (error) {
        return {
          kind: 'error' as const,
          text: error instanceof Error ? error.message : String(error),
        }
      }
    },
  }))
}

function statusResult(ctx: Context) {
  const status = ctx.agentTeam.status()
  return {
    kind: 'success' as const,
    text: [
      'Agent Team',
      'Status: ready',
      `Ledger sequence: ${status.sequence}`,
      `Operations: ${status.operationCount}`,
      `Channels: ${status.channelCount}`,
      `Agent members: ${status.agentMemberCount}`,
    ].join('\n'),
  }
}
