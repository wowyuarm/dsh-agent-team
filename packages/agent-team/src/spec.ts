import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type {
  AgentTeamChannelRef,
  AgentTeamMemberId,
  AgentTeamMessageRef,
  AgentTeamOperation,
  AgentTeamOperationId,
  AgentTeamRecipientIntentRef,
  AgentTeamRequestId,
  AgentTeamTaskRef,
  AgentTeamThreadRef,
} from './types.ts'

const operationIdSchema = z.string().regex(/^operation:[^:]+$/).transform(value => value as AgentTeamOperationId)
const requestIdSchema = z.string().min(1).transform(value => value as AgentTeamRequestId)
const memberIdSchema = z.string().regex(/^member:[^:]+$/).transform(value => value as AgentTeamMemberId)
const workspaceIdSchema = z.string().min(1).transform(value => value as WorkspaceId)
const sessionIdSchema = z.string().min(1).transform(value => value as SessionId)
const channelRefSchema = z.string().regex(/^channel:[^:]+$/).transform(value => value as AgentTeamChannelRef)
const messageRefSchema = z.string().regex(/^message:[^:]+$/).transform(value => value as AgentTeamMessageRef)
const taskRefSchema = z.string().regex(/^task:[^:]+$/).transform(value => value as AgentTeamTaskRef)
const threadRefSchema = z.string().regex(/^thread:[^:]+$/).transform(value => value as AgentTeamThreadRef)
const intentRefSchema = z.string().regex(/^intent:[^:]+$/).transform(value => value as AgentTeamRecipientIntentRef)

const operationBase = {
  sequence: z.number().int().positive(),
  operationId: operationIdSchema,
  requestId: requestIdSchema,
  occurredAt: z.string().datetime(),
  actor: z.object({
    kind: z.literal('human'),
    memberId: memberIdSchema,
    handle: z.string().min(1),
  }).strict(),
}

const memberSchema = z.object({
  memberId: memberIdSchema,
  sessionId: sessionIdSchema,
  workspaceId: workspaceIdSchema,
  handle: z.string().min(1),
  description: z.string().min(1),
  presetId: z.string().min(1),
  privateMemoryPath: z.string().min(1),
  state: z.union([z.literal('enabled'), z.literal('suspended')]),
}).strict()

const channelSchema = z.object({
  channelRef: channelRefSchema,
  workspaceId: workspaceIdSchema,
  name: z.string().min(1),
  createdAtSequence: z.number().int().positive(),
}).strict()

/** Durable validator for the closed Agent Team operation union. */
export const agentTeamOperationSchema: z.ZodType<AgentTeamOperation> = z.discriminatedUnion('kind', [
  z.object({
    ...operationBase,
    previousOperationId: z.null(),
    kind: z.literal('team/initialized'),
    data: z.object({ humanMemberId: memberIdSchema }).strict(),
  }).strict(),
  z.object({
    ...operationBase,
    previousOperationId: operationIdSchema.nullable(),
    kind: z.literal('team/channel-created'),
    data: z.object({
      workspaceId: workspaceIdSchema,
      channel: channelSchema,
    }).strict(),
  }).strict(),
  z.object({
    ...operationBase,
    previousOperationId: operationIdSchema.nullable(),
    kind: z.literal('team/member-added'),
    data: z.object({ member: memberSchema }).strict(),
  }).strict(),
  z.object({
    ...operationBase,
    previousOperationId: operationIdSchema.nullable(),
    kind: z.literal('team/member-suspended'),
    data: z.object({ member: memberSchema }).strict(),
  }).strict(),
  z.object({
    ...operationBase,
    previousOperationId: operationIdSchema.nullable(),
    kind: z.literal('team/member-resumed'),
    data: z.object({ member: memberSchema }).strict(),
  }).strict(),
  z.object({
    ...operationBase,
    previousOperationId: operationIdSchema.nullable(),
    kind: z.literal('team/message-sent'),
    data: z.object({
      workspaceId: workspaceIdSchema,
      message: z.object({
        messageRef: messageRefSchema,
        channelRef: channelRefSchema,
        threadRef: threadRefSchema,
        taskRef: taskRefSchema,
        sender: memberIdSchema,
        body: z.string().min(1),
        topLevel: z.literal(true),
        sequence: z.number().int().positive(),
      }).strict(),
      task: z.object({
        taskRef: taskRefSchema,
        channelRef: channelRefSchema,
        threadRef: threadRefSchema,
        status: z.literal('todo'),
      }).strict(),
      thread: z.object({
        threadRef: threadRefSchema,
        taskRef: taskRefSchema,
        revision: z.number().int().positive(),
      }).strict(),
      follows: z.array(z.object({
        memberId: memberIdSchema,
        threadRef: threadRefSchema,
        following: z.literal(true),
      }).strict()),
      recipientIntents: z.array(z.object({
        intentRef: intentRefSchema,
        threadRef: threadRefSchema,
        recipient: memberIdSchema,
        state: z.literal('queued'),
      }).strict()),
    }).strict(),
  }).strict(),
])

/** Versioned durable Agent Team ledger declaration. */
export const agentTeamDomainSpec = defineDomain({
  name: 'agent_team',
  version: 0,
  tables: {
    operations: domainTable<AgentTeamOperationId, AgentTeamOperation>(agentTeamOperationSchema),
  },
})
