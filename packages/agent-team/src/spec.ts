import { z } from 'zod'
import { MessageId } from '@deepseek-ai/dsh-llm'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type {
  AgentTeamActivityRef,
  AgentTeamChannelRef,
  AgentTeamClaimRef,
  AgentTeamDeliveryId,
  AgentTeamMemberId,
  AgentTeamMessageRef,
  AgentTeamOperation,
  AgentTeamOperationId,
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
const deliveryIdSchema = z.string().regex(/^delivery:[^:]+$/).transform(value => value as AgentTeamDeliveryId)
const claimRefSchema = z.string().regex(/^claim:[^:]+$/).transform(value => value as AgentTeamClaimRef)
const activityRefSchema = z.string().regex(/^activity:[^:]+$/).transform(value => value as AgentTeamActivityRef)
const messageIdSchema = z.string().min(1).transform(MessageId)

const operationBase = {
  sequence: z.number().int().positive(),
  operationId: operationIdSchema,
  requestId: requestIdSchema,
  occurredAt: z.string().datetime(),
  actor: z.union([
    z.object({ kind: z.literal('human'), memberId: memberIdSchema, handle: z.string().min(1) }).strict(),
    z.object({ kind: z.literal('member'), memberId: memberIdSchema, handle: z.string().min(1) }).strict(),
    z.object({ kind: z.literal('host'), handle: z.literal('agent-team') }).strict(),
  ]),
}

const memberSchema = z.object({
  memberId: memberIdSchema,
  sessionId: sessionIdSchema,
  workspaceId: workspaceIdSchema,
  handle: z.string().min(1),
  description: z.string().min(1),
  presetId: z.string().min(1),
  privateMemoryPath: z.string().min(1),
  state: z.union([z.literal('enabled'), z.literal('suspended'), z.literal('inactive')]),
}).strict()

const channelSchema = z.object({
  channelRef: channelRefSchema,
  workspaceId: workspaceIdSchema,
  name: z.string().min(1),
  createdAtSequence: z.number().int().positive(),
}).strict()

const messageSchema = z.object({
  messageRef: messageRefSchema,
  channelRef: channelRefSchema,
  threadRef: threadRefSchema,
  taskRef: taskRefSchema,
  sender: memberIdSchema,
  body: z.string().min(1),
  topLevel: z.boolean(),
  sequence: z.number().int().positive(),
}).strict()

const taskSchema = z.object({
  taskRef: taskRefSchema,
  channelRef: channelRefSchema,
  threadRef: threadRefSchema,
  status: z.union([z.literal('todo'), z.literal('in_progress'), z.literal('in_review'), z.literal('done'), z.literal('closed')]),
  resolution: z.union([z.literal('open'), z.literal('accepted'), z.literal('closed')]),
}).strict()

const threadSchema = z.object({
  threadRef: threadRefSchema,
  taskRef: taskRefSchema,
  revision: z.number().int().positive(),
}).strict()

const followSchema = z.object({
  memberId: memberIdSchema,
  threadRef: threadRefSchema,
  following: z.boolean(),
}).strict()

const deliverySourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('message'), messageRef: messageRefSchema }).strict(),
  z.object({ kind: z.literal('activity'), activityRef: activityRefSchema }).strict(),
])

const deliveryFields = {
  deliveryId: deliveryIdSchema,
  source: deliverySourceSchema,
  messageId: messageIdSchema,
  threadRef: threadRefSchema,
  taskRef: taskRefSchema,
  recipient: memberIdSchema,
}

const claimSchema = z.object({
  claimRef: claimRefSchema,
  taskRef: taskRefSchema,
  threadRef: threadRefSchema,
  owner: memberIdSchema,
  direction: z.string().min(1),
  normalizedDirection: z.string().min(1),
  state: z.union([z.literal('active'), z.literal('done'), z.literal('released')]),
}).strict()

const activityBase = {
  activityRef: activityRefSchema,
  taskRef: taskRefSchema,
  threadRef: threadRefSchema,
  actor: memberIdSchema,
  sequence: z.number().int().positive(),
}

const claimActivitySchema = z.object({
  ...activityBase,
  kind: z.union([z.literal('claim'), z.literal('done'), z.literal('release')]),
  claimRef: claimRefSchema,
}).strict()

const followActivitySchema = z.object({
  ...activityBase,
  kind: z.union([z.literal('follow'), z.literal('unfollow')]),
}).strict()

const taskActivitySchema = z.object({
  ...activityBase,
  kind: z.union([z.literal('accept'), z.literal('close'), z.literal('reopen')]),
}).strict()

const messageOperationData = {
  workspaceId: workspaceIdSchema,
  message: messageSchema,
  task: taskSchema,
  thread: threadSchema,
  follows: z.array(followSchema),
  deliveries: z.array(z.object({ ...deliveryFields, state: z.literal('queued') }).strict()),
}

const claimOperation = (kind: 'team/claim-created' | 'team/claim-done' | 'team/claim-released') => z.object({
  ...operationBase,
  previousOperationId: operationIdSchema.nullable(),
  kind: z.literal(kind),
  data: z.object({
    workspaceId: workspaceIdSchema,
    activity: claimActivitySchema,
    claim: claimSchema,
    task: taskSchema,
    thread: threadSchema,
    deliveries: z.array(z.object({ ...deliveryFields, state: z.literal('queued') }).strict()),
  }).strict(),
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
    data: z.object({ workspaceId: workspaceIdSchema, channel: channelSchema }).strict(),
  }).strict(),
  z.object({
    ...operationBase,
    previousOperationId: operationIdSchema.nullable(),
    kind: z.literal('team/channel-member-added'),
    data: z.object({ channelRef: channelRefSchema, memberId: memberIdSchema }).strict(),
  }).strict(),
  z.object({
    ...operationBase,
    previousOperationId: operationIdSchema.nullable(),
    kind: z.literal('team/delivery-admitted'),
    data: z.object({
      delivery: z.object({ ...deliveryFields, state: z.literal('admitted') }).strict(),
      evidence: z.union([z.literal('agent/inbox/spliced'), z.literal('user/message')]),
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
    data: z.object(messageOperationData).strict(),
  }).strict(),
  z.object({
    ...operationBase,
    previousOperationId: operationIdSchema.nullable(),
    kind: z.literal('team/thread-replied'),
    data: z.object({
      ...messageOperationData,
      baseRevision: z.number().int().positive(),
      mentions: z.array(memberIdSchema),
    }).strict(),
  }).strict(),
  z.object({
    ...operationBase,
    previousOperationId: operationIdSchema.nullable(),
    kind: z.literal('team/follow-changed'),
    data: z.object({
      workspaceId: workspaceIdSchema,
      activity: followActivitySchema,
      follow: followSchema,
      task: taskSchema,
      thread: threadSchema,
      deliveries: z.array(z.object({ ...deliveryFields, state: z.literal('queued') }).strict()),
    }).strict(),
  }).strict(),
  z.object({
    ...operationBase,
    previousOperationId: operationIdSchema.nullable(),
    kind: z.literal('team/task-changed'),
    data: z.object({
      workspaceId: workspaceIdSchema,
      activity: taskActivitySchema,
      task: taskSchema,
      thread: threadSchema,
      claims: z.array(claimSchema),
      deliveries: z.array(z.object({ ...deliveryFields, state: z.literal('queued') }).strict()),
    }).strict(),
  }).strict(),
  z.object({
    ...operationBase,
    previousOperationId: operationIdSchema.nullable(),
    kind: z.literal('team/member-removed'),
    data: z.object({
      member: memberSchema,
      claims: z.array(claimSchema),
      tasks: z.array(taskSchema),
      follows: z.array(followSchema),
      deliveries: z.array(z.object({ ...deliveryFields, state: z.literal('canceled') }).strict()),
    }).strict(),
  }).strict(),
  claimOperation('team/claim-created'),
  claimOperation('team/claim-done'),
  claimOperation('team/claim-released'),
])

/** Versioned durable Agent Team ledger declaration. */
export const agentTeamDomainSpec = defineDomain({
  name: 'agent_team',
  version: 4,
  tables: {
    operations: domainTable<AgentTeamOperationId, AgentTeamOperation>(agentTeamOperationSchema),
  },
})
