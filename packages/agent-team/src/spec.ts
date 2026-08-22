import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type {
  AgentTeamActivityRef,
  AgentTeamChannelRef,
  AgentTeamClaimRef,
  AgentTeamMemberId,
  AgentTeamMessageRef,
  AgentTeamOperation,
  AgentTeamOperationId,
  AgentTeamRequestId,
  AgentTeamTaskRef,
  AgentTeamThreadReadFact,
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
const claimRefSchema = z.string().regex(/^claim:[^:]+$/).transform(value => value as AgentTeamClaimRef)
const activityRefSchema = z.string().regex(/^activity:[^:]+$/).transform(value => value as AgentTeamActivityRef)

const actorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('human'), memberId: memberIdSchema, handle: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('member'), memberId: memberIdSchema, handle: z.string().min(1) }).strict(),
])

const operationBase = {
  sequence: z.number().int().positive(),
  operationId: operationIdSchema,
  requestId: requestIdSchema,
  occurredAt: z.string().datetime(),
  actor: actorSchema,
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
  description: z.string().min(1),
  createdAtSequence: z.number().int().positive(),
}).strict()

// Ledgers written before message occurredAt existed store bare messages; the union schema below stamps them on load.
const messageSchema = z.object({
  messageRef: messageRefSchema,
  channelRef: channelRefSchema,
  threadRef: threadRefSchema,
  taskRef: taskRefSchema,
  sender: memberIdSchema,
  body: z.string().min(1),
  topLevel: z.boolean(),
  sequence: z.number().int().positive(),
  occurredAt: z.string().datetime().optional(),
}).strict()

type StoredMessage = z.output<typeof messageSchema>

/** Stamp one bare stored message with the wrapping operation's occurrence instant; complete messages pass through unchanged. */
function stampMessage(occurredAt: string, message: StoredMessage): Omit<StoredMessage, 'occurredAt'> & { occurredAt: string } {
  const { occurredAt: stored } = message
  return stored === undefined ? { ...message, occurredAt } : { ...message, occurredAt: stored }
}

/** Stamp every bare stored message inside one operation with the operation's occurrence instant. */
function stampOperationMessages(operation: z.output<typeof storedAgentTeamOperationSchema>): AgentTeamOperation {
  if (operation.kind === 'team/message-sent') {
    return { ...operation, data: { ...operation.data, message: stampMessage(operation.occurredAt, operation.data.message) } }
  }
  if (operation.kind === 'team/thread-replied') {
    return { ...operation, data: { ...operation.data, message: stampMessage(operation.occurredAt, operation.data.message) } }
  }
  if (operation.kind === 'team/thread-read') {
    const facts = operation.data.facts.map((fact): AgentTeamThreadReadFact => {
      if (fact.fact.kind === 'message') {
        return { ...fact, fact: { kind: 'message', sequence: fact.fact.sequence, message: stampMessage(operation.occurredAt, fact.fact.message) } }
      }
      return { ...fact, fact: fact.fact }
    })
    return { ...operation, data: { ...operation.data, anchor: stampMessage(operation.occurredAt, operation.data.anchor), facts } }
  }
  return operation
}

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

const attentionSchema = z.object({
  memberId: memberIdSchema,
  threadRef: threadRefSchema,
  startSequence: z.number().int().positive(),
  readThroughSequence: z.number().int().nonnegative(),
}).strict()

const attentionKeySchema = z.object({
  memberId: memberIdSchema,
  threadRef: threadRefSchema,
}).strict()

const directMarkerSchema = z.object({
  memberId: memberIdSchema,
  threadRef: threadRefSchema,
  messageRef: messageRefSchema,
  sequence: z.number().int().positive(),
}).strict()

const inboxDeltaSchema = z.object({
  attention: z.object({
    set: z.array(attentionSchema),
    removed: z.array(attentionKeySchema),
  }).strict(),
  directMarkers: z.object({
    added: z.array(directMarkerSchema),
    removed: z.array(directMarkerSchema),
  }).strict(),
}).strict()

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

const taskActivitySchema = z.object({
  ...activityBase,
  kind: z.union([z.literal('accept'), z.literal('close'), z.literal('reopen')]),
  releasedClaimRefs: z.array(claimRefSchema).min(1).optional(),
}).strict()

const claimsReleasedActivitySchema = z.object({
  ...activityBase,
  kind: z.literal('claims_released'),
  claimRefs: z.array(claimRefSchema).min(1),
}).strict()

const activitySchema = z.discriminatedUnion('kind', [claimActivitySchema, taskActivitySchema, claimsReleasedActivitySchema])

const threadFactSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('message'), sequence: z.number().int().positive(), message: messageSchema }).strict(),
  z.object({ kind: z.literal('activity'), sequence: z.number().int().positive(), activity: activitySchema }).strict(),
])

const readFactSchema = z.object({
  fact: threadFactSchema,
  unread: z.boolean(),
  direct: z.boolean(),
}).strict()

const claimOperation = (kind: 'team/claim-created' | 'team/claim-done' | 'team/claim-released') => z.object({
  ...operationBase,
  previousOperationId: operationIdSchema.nullable(),
  kind: z.literal(kind),
  data: z.object({
    workspaceId: workspaceIdSchema,
    baseRevision: z.number().int().positive(),
    activity: claimActivitySchema,
    claim: claimSchema,
    task: taskSchema,
    thread: threadSchema,
    inbox: inboxDeltaSchema,
  }).strict(),
}).strict()

/** Closed Agent Team operation union before occurrence stamping. */
const storedAgentTeamOperationSchema = z.discriminatedUnion('kind', [
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
      memberIds: z.array(memberIdSchema),
    }).strict(),
  }).strict(),
  z.object({
    ...operationBase,
    previousOperationId: operationIdSchema.nullable(),
    kind: z.literal('team/member-added'),
    data: z.object({ member: memberSchema, channelRefs: z.array(channelRefSchema).min(1) }).strict(),
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
    kind: z.literal('team/channel-member-added'),
    data: z.object({ workspaceId: workspaceIdSchema, channelRef: channelRefSchema, memberId: memberIdSchema }).strict(),
  }).strict(),
  z.object({
    ...operationBase,
    previousOperationId: operationIdSchema.nullable(),
    kind: z.literal('team/channel-member-removed'),
    data: z.object({
      workspaceId: workspaceIdSchema,
      channelRef: channelRefSchema,
      memberId: memberIdSchema,
      claims: z.array(claimSchema),
      activities: z.array(claimsReleasedActivitySchema),
      tasks: z.array(taskSchema),
      threads: z.array(threadSchema),
      inbox: inboxDeltaSchema,
    }).strict(),
  }).strict(),
  z.object({
    ...operationBase,
    previousOperationId: operationIdSchema.nullable(),
    kind: z.literal('team/message-sent'),
    data: z.object({
      workspaceId: workspaceIdSchema,
      mentions: z.array(memberIdSchema),
      message: messageSchema,
      task: taskSchema,
      thread: threadSchema,
      inbox: inboxDeltaSchema,
    }).strict(),
  }).strict(),
  z.object({
    ...operationBase,
    previousOperationId: operationIdSchema.nullable(),
    kind: z.literal('team/thread-replied'),
    data: z.object({
      workspaceId: workspaceIdSchema,
      baseRevision: z.number().int().positive(),
      mentions: z.array(memberIdSchema),
      message: messageSchema,
      task: taskSchema,
      thread: threadSchema,
      inbox: inboxDeltaSchema,
    }).strict(),
  }).strict(),
  claimOperation('team/claim-created'),
  claimOperation('team/claim-done'),
  claimOperation('team/claim-released'),
  z.object({
    ...operationBase,
    previousOperationId: operationIdSchema.nullable(),
    kind: z.literal('team/task-changed'),
    data: z.object({
      workspaceId: workspaceIdSchema,
      baseRevision: z.number().int().positive(),
      activity: taskActivitySchema,
      task: taskSchema,
      thread: threadSchema,
      claims: z.array(claimSchema),
      inbox: inboxDeltaSchema,
    }).strict(),
  }).strict(),
  z.object({
    ...operationBase,
    previousOperationId: operationIdSchema.nullable(),
    kind: z.literal('team/thread-attention-changed'),
    data: z.object({
      workspaceId: workspaceIdSchema,
      action: z.union([z.literal('follow'), z.literal('unfollow')]),
      memberId: memberIdSchema,
      task: taskSchema,
      thread: threadSchema,
      inbox: inboxDeltaSchema,
    }).strict(),
  }).strict(),
  z.object({
    ...operationBase,
    previousOperationId: operationIdSchema.nullable(),
    kind: z.literal('team/thread-read'),
    data: z.object({
      workspaceId: workspaceIdSchema,
      memberId: memberIdSchema,
      task: taskSchema,
      thread: threadSchema,
      claims: z.array(claimSchema),
      anchor: messageSchema,
      facts: z.array(readFactSchema),
      readThroughSequence: z.number().int().nonnegative(),
      remainingUnreadCount: z.number().int().nonnegative(),
      attention: attentionSchema.optional(),
      inbox: inboxDeltaSchema,
    }).strict(),
  }).strict(),
  z.object({
    ...operationBase,
    previousOperationId: operationIdSchema.nullable(),
    kind: z.literal('team/member-removed'),
    data: z.object({
      member: memberSchema,
      claims: z.array(claimSchema),
      activities: z.array(claimsReleasedActivitySchema),
      tasks: z.array(taskSchema),
      threads: z.array(threadSchema),
      inbox: inboxDeltaSchema,
    }).strict(),
  }).strict(),
])

/** Durable validator for the closed Agent Team operation union; ledgers written before message occurredAt existed normalize on load. */
export const agentTeamOperationSchema: z.ZodType<AgentTeamOperation> = storedAgentTeamOperationSchema.transform(stampOperationMessages)

/** Versioned durable Agent Team ledger declaration. v7 has no compatibility path beyond occurrence stamping for older record shapes. */
export const agentTeamDomainSpec = defineDomain({
  name: 'agent_team',
  version: 7,
  tables: {
    operations: domainTable<AgentTeamOperationId, AgentTeamOperation>(agentTeamOperationSchema),
  },
})
