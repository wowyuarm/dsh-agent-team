/** Human `/team` command adapter for the Agent Team Host capability. */

import type { Context } from '@deepseek-ai/cordis'
import type {
  AgentTeamChannelRef,
  AgentTeamConfirmationRequired,
  AgentTeamMemberId,
  AgentTeamRequestId,
  AgentTeamTaskRef,
} from '@deepseek-ai/dsh-agent-team'
import type {} from '@deepseek-ai/dsh-commands'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'

export const name = 'command-agent-team'
export const inject = ['agentTeam', 'commands']

export const USAGE = [
  'usage: /team status',
  '| /team member add <workspaceId> <channelRef,...> <handle> <presetId> <description>',
  '| /team member suspend|resume|remove <memberRef>',
  '| /team channel create <workspaceId> <name> -- <description>',
  '| /team channel join|leave <workspaceId> <channelRef> <memberRef>',
  '| /team task accept|close|reopen <workspaceId> <taskRef> <baseRevision>',
  '| /team send <workspaceId> <channelRef> [--mention <memberRef,...> --] <body>',
  '| /team view <workspaceId> [channelRef] [limit] [cursor]',
].join(' ')

/** Register `/team` and derive business idempotency from commandId. */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.commands.register({
    name: 'team',
    description: 'Inspect and manage the Agent Team',
    input: { hint: 'status | member add|suspend|resume|remove | channel create|join|leave | task accept|close|reopen | send | view' },
    handler: async ({ rawInput, commandId }) => {
      const parts = rawInput.trim().split(/\s+/)
      if (parts.length === 1 && (parts[0] === '' || parts[0] === 'status')) return statusResult(ctx)
      const requestId = commandId as unknown as AgentTeamRequestId
      try {
        if (parts[0] === 'member' && parts[1] === 'add' && parts.length >= 7) {
          const channelRefs = parseRefs<AgentTeamChannelRef>(parts[3], 'initial Channel')
          const result = await ctx.agentTeam.addMember({ requestId, workspaceId: WorkspaceId(parts[2]!), channelRefs,
            handle: parts[4]!, presetId: parts[5]!, description: parts.slice(6).join(' ') })
          const detail = result.status.diagnostic === undefined ? '' : `: ${result.status.diagnostic}`
          return { kind: result.status.availability === 'unavailable' ? 'error' as const : 'success' as const,
            text: `Agent Member ${result.status.member.memberId} is ${result.status.availability}${detail}` }
        }
        if (parts[0] === 'member' && (parts[1] === 'suspend' || parts[1] === 'resume') && parts.length === 3) {
          const request = { requestId, memberId: parts[2] as AgentTeamMemberId }
          const result = parts[1] === 'suspend' ? await ctx.agentTeam.suspendMember(request) : await ctx.agentTeam.resumeMember(request)
          const detail = result.status.diagnostic === undefined ? '' : `: ${result.status.diagnostic}`
          return { kind: result.status.availability === 'unavailable' ? 'error' as const : 'success' as const,
            text: `Agent Member ${result.status.member.memberId} is ${result.status.availability}${detail}` }
        }
        if (parts[0] === 'member' && parts[1] === 'remove' && parts.length === 3) {
          const result = await ctx.agentTeam.removeMember({ requestId, memberId: parts[2] as AgentTeamMemberId })
          return { kind: 'success' as const,
            text: `Agent Member ${result.member.memberId} removed; released ${result.releasedClaims.length} Claims; ended ${result.removedAttention.length} Attention periods` }
        }
        if (parts[0] === 'task' && (parts[1] === 'accept' || parts[1] === 'close' || parts[1] === 'reopen') && parts.length === 5) {
          const baseRevision = parseRevision(parts[4])
          const result = await ctx.agentTeam.changeTask({ requestId, workspaceId: WorkspaceId(parts[2]!), taskRef: parts[3] as AgentTeamTaskRef,
            action: parts[1], baseRevision })
          if (result.kind !== 'committed') return typedOutcome(result)
          return { kind: 'success' as const, text: `Task ${result.task.taskRef} is ${result.task.status} at revision ${result.thread.revision}` }
        }
        if (parts[0] === 'channel' && parts[1] === 'join' && parts.length === 5) {
          const result = await ctx.agentTeam.joinChannel({ requestId, workspaceId: WorkspaceId(parts[2]!),
            channelRef: parts[3] as AgentTeamChannelRef, memberId: parts[4] as AgentTeamMemberId })
          return { kind: 'success' as const, text: `Agent Member ${result.memberId} joined Channel ${result.channelRef}` }
        }
        if (parts[0] === 'channel' && parts[1] === 'leave' && parts.length === 5) {
          const result = await ctx.agentTeam.removeChannelMember({ requestId, workspaceId: WorkspaceId(parts[2]!),
            channelRef: parts[3] as AgentTeamChannelRef, memberId: parts[4] as AgentTeamMemberId })
          return { kind: 'success' as const, text: `Agent Member ${result.memberId} left Channel ${result.channelRef}; released ${result.releasedClaims.length} Claims; ended ${result.removedAttention.length} Attention periods` }
        }
        if (parts[0] === 'channel' && parts[1] === 'create' && parts.length >= 6) {
          const separator = parts.indexOf('--', 3)
          if (separator <= 3 || separator >= parts.length - 1) throw new Error(USAGE)
          const result = await ctx.agentTeam.createChannel({ requestId, workspaceId: WorkspaceId(parts[2]!), name: parts.slice(3, separator).join(' '), description: parts.slice(separator + 1).join(' ') })
          return { kind: 'success' as const, text: `Channel created: ${result.channel.channelRef} (sequence ${result.receipt.sequence})` }
        }
        if (parts[0] === 'send' && parts.length >= 4) {
          const { body, recipients } = parseSend(parts)
          const result = await ctx.agentTeam.sendMessage({ requestId, workspaceId: WorkspaceId(parts[1]!), channelRef: parts[2] as AgentTeamChannelRef,
            body, ...(recipients.length === 0 ? {} : { recipients }) })
          if (result.kind === 'committed') return { kind: 'success' as const,
            text: `Message sent: ${result.message.messageRef}; Task ${result.task.taskRef}; Thread ${result.thread.threadRef} at revision ${result.thread.revision}` }
          if (result.kind === 'confirmation_required') return confirmationResult(result)
          return { kind: 'error' as const, text: `Agent Member(s) must already follow this Thread: ${result.memberIds.join(', ')}` }
        }
        if (parts[0] === 'view' && parts.length >= 2 && parts.length <= 5) {
          const result = ctx.agentTeam.view({ workspaceId: WorkspaceId(parts[1]!), ...(parts[2] === undefined ? {} : { channelRef: parts[2] as AgentTeamChannelRef }),
            ...(parts[3] === undefined ? {} : { limit: Number(parts[3]) }), ...(parts[4] === undefined ? {} : { cursor: Number(parts[4]) }) })
          return { kind: 'success' as const, text: JSON.stringify(result) }
        }
        return { kind: 'error' as const, text: USAGE }
      } catch (error) {
        return { kind: 'error' as const, text: error instanceof Error ? error.message : String(error) }
      }
    },
  }))
}

function parseRefs<T extends string>(value: string | undefined, label: string): T[] {
  const refs = value?.split(',').filter(Boolean) as T[] | undefined
  if (refs === undefined || refs.length === 0 || new Set(refs).size !== refs.length) throw new Error(`${label} refs must be a non-empty comma-separated unique list`)
  return refs
}

function parseRevision(value: string | undefined): number {
  const revision = Number(value)
  if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('baseRevision must be a positive integer')
  return revision
}

function parseSend(parts: readonly string[]): { readonly body: string; readonly recipients: AgentTeamMemberId[] } {
  if (parts[3] !== '--mention') {
    const body = parts.slice(3).join(' ')
    if (body === '') throw new Error('message body must not be empty')
    return { body, recipients: [] }
  }
  if (parts[5] !== '--') throw new Error('structured mention must end with -- before the message body')
  const recipients = parseRefs<AgentTeamMemberId>(parts[4], 'structured mention')
  const body = parts.slice(6).join(' ')
  if (body === '') throw new Error('message body must not be empty')
  return { body, recipients }
}

function confirmationResult(result: AgentTeamConfirmationRequired) {
  return { kind: 'error' as const,
    text: `Confirmation required for ${result.recipients.join(', ')}. Repeat this exact action through the Team UI to confirm the invitation.` }
}

function typedOutcome(result: { readonly kind: 'unread_required' | 'stale_revision'; readonly taskRef: AgentTeamTaskRef; readonly revision: number }) {
  return result.kind === 'unread_required'
    ? { kind: 'error' as const, text: `Task ${result.taskRef} has unread Thread work at revision ${result.revision}; read it before mutating.` }
    : { kind: 'error' as const, text: `Task ${result.taskRef} changed; use current revision ${result.revision}.` }
}

function statusResult(ctx: Context) {
  const status = ctx.agentTeam.status()
  return { kind: 'success' as const, text: ['Agent Team', 'Status: ready', `Ledger sequence: ${status.sequence}`,
    `Operations: ${status.operationCount}`, `Channels: ${status.channelCount}`, `Agent members: ${status.agentMemberCount}`].join('\n') }
}
