import { randomUUID } from 'node:crypto'
import { MessageId } from '@deepseek-ai/dsh-llm'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type {
  AgentTeamActivity,
  AgentTeamActivityRef,
  AgentTeamAddMemberRequest,
  AgentTeamAgentMember,
  AgentTeamChannel,
  AgentTeamChannelCreatedOperation,
  AgentTeamChannelMemberAddedOperation,
  AgentTeamChannelRef,
  AgentTeamClaim,
  AgentTeamClaimList,
  AgentTeamClaimRequest,
  AgentTeamClaimResult,
  AgentTeamClaimRef,
  AgentTeamConfirmationRequired,
  AgentTeamConfirmationToken,
  AgentTeamCreateChannelResult,
  AgentTeamDelivery,
  AgentTeamDeliveryAdmittedOperation,
  AgentTeamDeliveryId,
  AgentTeamFollow,
  AgentTeamFollowActivity,
  AgentTeamFollowChangedOperation,
  AgentTeamFollowRequest,
  AgentTeamFollowResult,
  AgentTeamFollowStatus,
  AgentTeamHostActor,
  AgentTeamHumanActor,
  AgentTeamMemberActor,
  AgentTeamInitializedOperation,
  AgentTeamMemberId,
  AgentTeamMessage,
  AgentTeamMessageRef,
  AgentTeamMemberAddedOperation,
  AgentTeamMemberResumedOperation,
  AgentTeamMemberSuspendedOperation,
  AgentTeamMessageSentOperation,
  AgentTeamThreadRepliedOperation,
  AgentTeamClaimChangedOperation,
  AgentTeamOperation,
  AgentTeamOperationId,
  AgentTeamOperationReceipt,
  AgentTeamJoinChannelRequest,
  AgentTeamJoinChannelResult,
  AgentTeamReplyRequest,
  AgentTeamReplyResult,
  AgentTeamRequestId,
  AgentTeamSendMessageResult,
  AgentTeamSetMemberStateRequest,
  AgentTeamStatus,
  AgentTeamTask,
  AgentTeamTaskRef,
  AgentTeamThread,
  AgentTeamThreadRef,
  AgentTeamView,
  AgentTeamViewRequest,
} from './types.ts'

/** Stable Human Member identity shared by every replay of one dshHome Team. */
export const AGENT_TEAM_HUMAN_MEMBER_ID = 'member:human' as AgentTeamMemberId

/** Idempotency identity of the one Host bootstrap operation. */
export const AGENT_TEAM_INITIALIZE_REQUEST_ID = 'agent-team:initialize:v1' as AgentTeamRequestId

const HOST_ACTOR: AgentTeamHostActor = Object.freeze({ kind: 'host', handle: 'agent-team' })

const HUMAN_ACTOR: AgentTeamHumanActor = Object.freeze({
  kind: 'human',
  memberId: AGENT_TEAM_HUMAN_MEMBER_ID,
  handle: 'human',
})

/** Resolve the one Human authority owned by this Team. */
export function agentTeamHumanActor(): AgentTeamHumanActor {
  return HUMAN_ACTOR
}

/** Resolve Host authority for durable delivery observations. */
export function agentTeamHostActor(): AgentTeamHostActor {
  return HOST_ACTOR
}

/** Caller-owned payload of the idempotent Team initialization request. */
export interface AgentTeamInitializeRequest {
  readonly requestId: AgentTeamRequestId
  readonly actor: AgentTeamHumanActor
  readonly humanMemberId: AgentTeamMemberId
}

/** Internal authorized Channel creation request. */
export interface AgentTeamAuthorizedCreateChannelRequest {
  readonly requestId: AgentTeamRequestId
  readonly actor: AgentTeamHumanActor
  readonly workspaceId: WorkspaceId
  readonly name: string
}

/** Internal authorized Agent Member creation request. */
export interface AgentTeamAuthorizedAddMemberRequest extends AgentTeamAddMemberRequest {
  readonly actor: AgentTeamHumanActor
  readonly member: AgentTeamAgentMember
}

/** Internal authorized Member lifecycle request. */
export interface AgentTeamAuthorizedSetMemberStateRequest extends AgentTeamSetMemberStateRequest {
  readonly actor: AgentTeamHumanActor
}

/** Internal authorized Channel membership request. */
export interface AgentTeamAuthorizedJoinChannelRequest extends AgentTeamJoinChannelRequest {
  readonly actor: AgentTeamHumanActor
}

/** Internal authorized Inbox-admission observation. */
export interface AgentTeamAuthorizedAdmitDeliveryRequest {
  readonly requestId: AgentTeamRequestId
  readonly actor: AgentTeamHostActor
  readonly deliveryId: AgentTeamDeliveryId
  readonly evidence: 'agent/inbox/spliced' | 'user/message'
}

/** Internal authorized Thread reply request. */
export interface AgentTeamAuthorizedReplyRequest extends AgentTeamReplyRequest {
  readonly actor: AgentTeamMemberActor
}

/** Internal authorized Claim mutation request. */
export interface AgentTeamAuthorizedClaimRequest extends AgentTeamClaimRequest {
  readonly actor: AgentTeamMemberActor
}

export interface AgentTeamAuthorizedFollowRequest extends AgentTeamFollowRequest {
  readonly actor: AgentTeamMemberActor
}

/** Internal authorized top-level Message request. */
export interface AgentTeamAuthorizedSendMessageRequest {
  readonly requestId: AgentTeamRequestId
  readonly actor: AgentTeamHumanActor
  readonly workspaceId: WorkspaceId
  readonly channelRef: AgentTeamChannelRef
  readonly body: string
  readonly recipients?: readonly AgentTeamMemberId[]
}

/** Construction hooks used to make durable operation creation deterministic in tests. */
export interface AgentTeamLedgerOptions {
  readonly operationId?: () => AgentTeamOperationId
  readonly occurredAt?: () => string
  readonly ref?: (kind: 'channel' | 'message' | 'task' | 'thread' | 'delivery' | 'claim' | 'activity') => string
}

/** Internal append result indicating whether this call committed a new record. */
export interface AgentTeamLedgerResult<T> {
  readonly value: T
  readonly committed: boolean
}

interface AgentTeamDurableMemberResult {
  readonly receipt: AgentTeamOperationReceipt
  readonly member: AgentTeamAgentMember
}

/** Replay and append logic behind the Agent Team service interface. */
export class AgentTeamLedger {
  private readonly byRequest = new Map<AgentTeamRequestId, AgentTeamOperation>()
  private readonly ordered: AgentTeamOperation[] = []
  private readonly channels = new Map<AgentTeamChannelRef, AgentTeamChannel>()
  private readonly members = new Map<AgentTeamMemberId, AgentTeamAgentMember>()
  private readonly memberships = new Map<AgentTeamChannelRef, Set<AgentTeamMemberId>>()
  private readonly deliveries = new Map<AgentTeamDeliveryId, AgentTeamDelivery>()
  private readonly claims = new Map<AgentTeamClaimRef, AgentTeamClaim>()
  private readonly follows = new Map<AgentTeamThreadRef, Set<AgentTeamMemberId>>()
  private readonly activities: AgentTeamActivity[] = []
  private readonly messages: AgentTeamMessage[] = []
  private readonly tasks = new Map<AgentTeamTaskRef, AgentTeamTask>()
  private readonly threads = new Map<AgentTeamThreadRef, AgentTeamThread>()
  private readonly confirmations = new Map<AgentTeamConfirmationToken, {
    readonly sender: AgentTeamMemberId
    readonly threadRef: AgentTeamThreadRef
    readonly revision: number
    readonly recipients: readonly AgentTeamMemberId[]
    readonly following: readonly boolean[]
    readonly memberStates: readonly AgentTeamAgentMember['state'][]
  }>()
  private readonly createOperationId: () => AgentTeamOperationId
  private readonly createOccurredAt: () => string
  private readonly createRef: (kind: 'channel' | 'message' | 'task' | 'thread' | 'delivery' | 'claim' | 'activity') => string
  private operationTail: Promise<void> = Promise.resolve()

  /**
   * Build the in-memory projection from already validated durable records.
   * @param table - Agent Team operation table owned by the open Domain.
   * @param options - Deterministic id and clock hooks.
   */
  constructor(
    private readonly table: KvTable<AgentTeamOperationId, AgentTeamOperation>,
    options: AgentTeamLedgerOptions = {},
  ) {
    this.createOperationId = options.operationId
      ?? (() => `operation:${randomUUID()}` as AgentTeamOperationId)
    this.createOccurredAt = options.occurredAt ?? (() => new Date().toISOString())
    this.createRef = options.ref ?? (kind => `${kind}:${randomUUID()}`)
    this.replay()
  }

  /**
   * Initialize a new ledger or return the original receipt for an identical retry.
   * @param request - Authorized initialization request.
   * @returns The receipt and whether a new durable record was committed.
   */
  initialize(request: AgentTeamInitializeRequest = {
    requestId: AGENT_TEAM_INITIALIZE_REQUEST_ID,
    actor: HUMAN_ACTOR,
    humanMemberId: AGENT_TEAM_HUMAN_MEMBER_ID,
  }): Promise<AgentTeamLedgerResult<AgentTeamOperationReceipt>> {
    return this.enqueue(async () => {
      const existing = this.byRequest.get(request.requestId)
      if (existing !== undefined) {
        this.assertSameInitialization(existing, request)
        return this.resolved(this.receipt(existing))
      }
      if (this.ordered.length !== 0) {
        throw new Error('agent-team ledger has operations but no initialization request')
      }
      const operation: AgentTeamInitializedOperation = Object.freeze({
        sequence: 1,
        operationId: this.createOperationId(),
        requestId: request.requestId,
        occurredAt: this.createOccurredAt(),
        actor: Object.freeze({ ...request.actor }),
        previousOperationId: null,
        kind: 'team/initialized',
        data: Object.freeze({ humanMemberId: request.humanMemberId }),
      })
      await this.table.put(operation.operationId, operation)
      this.commit(operation)
      return this.committed(this.receipt(operation))
    })
  }

  /**
   * Create one Channel after the service resolves Human and Workspace authority.
   * @param request - Authorized creation intent.
   * @returns The stable Channel and operation receipt.
   */
  createChannel(
    request: AgentTeamAuthorizedCreateChannelRequest,
  ): Promise<AgentTeamLedgerResult<AgentTeamCreateChannelResult>> {
    return this.enqueue(async () => {
      const existing = this.byRequest.get(request.requestId)
      if (existing !== undefined) {
        this.assertSameChannelCreation(existing, request)
        return this.resolved(this.channelResult(existing))
      }
      this.assertHumanActor(request.actor)
      const name = request.name.trim()
      if (name === '') throw new Error('channel name must not be empty')
      const sequence = this.nextSequence()
      const channel: AgentTeamChannel = Object.freeze({
        channelRef: this.ref('channel'),
        workspaceId: request.workspaceId,
        name,
        createdAtSequence: sequence,
      })
      const operation: AgentTeamChannelCreatedOperation = Object.freeze({
        ...this.operationBase(request, sequence),
        kind: 'team/channel-created',
        data: Object.freeze({ workspaceId: request.workspaceId, channel }),
      })
      await this.table.put(operation.operationId, operation)
      this.commit(operation)
      this.channels.set(channel.channelRef, channel)
      return this.committed(this.channelResult(operation))
    })
  }

  /** Commit one new Agent Member before its unpublished live setup begins. */
  addMember(request: AgentTeamAuthorizedAddMemberRequest): Promise<AgentTeamLedgerResult<AgentTeamDurableMemberResult>> {
    return this.enqueue(async () => {
      const existing = this.byRequest.get(request.requestId)
      if (existing !== undefined) {
        this.assertSameMemberAdd(existing, request)
        return this.resolved(this.memberResult(existing))
      }
      this.assertHumanActor(request.actor)
      const handle = request.handle.trim()
      const description = request.description.trim()
      const presetId = request.presetId.trim()
      if (handle === '') throw new Error('member handle must not be empty')
      if (description === '') throw new Error('member description must not be empty')
      if (presetId === '') throw new Error('member preset must not be empty')
      this.assertHandleAvailable(request.workspaceId, handle)
      const member = Object.freeze({ ...request.member, handle, description, presetId, state: 'enabled' as const })
      const operation: AgentTeamMemberAddedOperation = Object.freeze({
        ...this.operationBase(request, this.nextSequence()),
        kind: 'team/member-added',
        data: Object.freeze({ member }),
      })
      await this.table.put(operation.operationId, operation)
      this.commit(operation)
      this.members.set(member.memberId, member)
      return this.committed(this.memberResult(operation))
    })
  }

  /** Suspend one enabled Member while preserving its exact session identity. */
  suspendMember(request: AgentTeamAuthorizedSetMemberStateRequest): Promise<AgentTeamLedgerResult<AgentTeamDurableMemberResult>> {
    return this.setMemberState(request, 'suspended')
  }

  /** Re-enable one suspended Member for exact-session resume. */
  resumeMember(request: AgentTeamAuthorizedSetMemberStateRequest): Promise<AgentTeamLedgerResult<AgentTeamDurableMemberResult>> {
    return this.setMemberState(request, 'enabled')
  }

  /** Return one durable Member projection. */
  getMember(memberId: AgentTeamMemberId): AgentTeamAgentMember | undefined {
    return this.members.get(memberId)
  }

  /** Return all durable Agent Members in creation order. */
  listMembers(): readonly AgentTeamAgentMember[] {
    return Object.freeze([...this.members.values()])
  }

  /** Grant one Agent Member future visibility in a Channel without replaying history. */
  joinChannel(
    request: AgentTeamAuthorizedJoinChannelRequest,
  ): Promise<AgentTeamLedgerResult<AgentTeamJoinChannelResult>> {
    return this.enqueue(async () => {
      const existing = this.byRequest.get(request.requestId)
      if (existing !== undefined) {
        this.assertSameChannelJoin(existing, request)
        return this.resolved(this.joinResult(existing))
      }
      this.assertHumanActor(request.actor)
      const channel = this.requireChannel(request.workspaceId, request.channelRef)
      const member = this.requireMember(request.memberId)
      if (member.workspaceId !== request.workspaceId) throw new Error('Member and Channel must belong to one Workspace')
      if (this.isChannelMember(channel.channelRef, member.memberId)) {
        throw new Error(`Agent Member '${member.memberId}' already belongs to Channel '${channel.channelRef}'`)
      }
      const operation: AgentTeamChannelMemberAddedOperation = Object.freeze({
        ...this.operationBase(request, this.nextSequence()),
        kind: 'team/channel-member-added',
        data: Object.freeze({ channelRef: channel.channelRef, memberId: member.memberId }),
      })
      await this.table.put(operation.operationId, operation)
      this.commit(operation)
      this.projectJoin(operation)
      return this.committed(this.joinResult(operation))
    })
  }

  /** Return every current Delivery projection in creation order. */
  listDeliveries(): readonly AgentTeamDelivery[] {
    return Object.freeze([...this.deliveries.values()])
  }

  /** Return one current Delivery projection. */
  getDelivery(deliveryId: AgentTeamDeliveryId): AgentTeamDelivery | undefined {
    return this.deliveries.get(deliveryId)
  }

  /** Return queued Deliveries in ledger order for Host recovery. */
  queuedDeliveries(): readonly AgentTeamDelivery[] {
    return Object.freeze([...this.deliveries.values()].filter(delivery => delivery.state === 'queued'))
  }

  /** Return the immutable Message that owns one Delivery. */
  messageForDelivery(deliveryId: AgentTeamDeliveryId): AgentTeamMessage | undefined {
    const delivery = this.deliveries.get(deliveryId)
    if (delivery?.source.kind !== 'message') return undefined
    const messageRef = delivery.source.messageRef
    return this.messages.find(message => message.messageRef === messageRef)
  }

  /** Return the immutable Activity that owns one Delivery. */
  activityForDelivery(deliveryId: AgentTeamDeliveryId): AgentTeamActivity | undefined {
    const delivery = this.deliveries.get(deliveryId)
    if (delivery?.source.kind !== 'activity') return undefined
    const activityRef = delivery.source.activityRef
    return this.activities.find(activity => activity.activityRef === activityRef)
  }

  /** Return one current Task projection. */
  getTask(taskRef: AgentTeamTaskRef): AgentTeamTask | undefined {
    return this.tasks.get(taskRef)
  }

  /** Commit durable Inbox evidence for one queued Delivery. */
  admitDelivery(
    request: AgentTeamAuthorizedAdmitDeliveryRequest,
  ): Promise<AgentTeamLedgerResult<AgentTeamOperationReceipt>> {
    return this.enqueue(async () => {
      const existing = this.byRequest.get(request.requestId)
      if (existing !== undefined) {
        this.assertSameDeliveryAdmission(existing, request)
        return this.resolved(this.receipt(existing))
      }
      if (request.actor.kind !== 'host') throw new Error('Delivery admission requires Host authority')
      const delivery = this.deliveries.get(request.deliveryId)
      if (delivery === undefined) throw new Error(`unknown Delivery '${request.deliveryId}'`)
      if (delivery.state !== 'queued') throw new Error(`Delivery '${request.deliveryId}' is already admitted`)
      const admitted: AgentTeamDelivery = Object.freeze({ ...delivery, state: 'admitted' })
      const operation: AgentTeamDeliveryAdmittedOperation = Object.freeze({
        ...this.operationBase(request, this.nextSequence()),
        kind: 'team/delivery-admitted',
        data: Object.freeze({ delivery: admitted, evidence: request.evidence }),
      })
      await this.table.put(operation.operationId, operation)
      this.commit(operation)
      this.deliveries.set(admitted.deliveryId, admitted)
      return this.committed(this.receipt(operation))
    })
  }

  /**
   * Atomically append one top-level Message and every fact derived from it.
   * @param request - Authorized send intent.
   * @returns The immutable Message, Task, Thread, Follow, intents, and receipt.
   */
  sendMessage(
    request: AgentTeamAuthorizedSendMessageRequest,
  ): Promise<AgentTeamLedgerResult<AgentTeamSendMessageResult>> {
    return this.enqueue(async () => {
      const recipients = this.normalizeRecipients(request.actor, request.recipients)
      const existing = this.byRequest.get(request.requestId)
      if (existing !== undefined) {
        this.assertSameMessage(existing, request, recipients)
        return this.resolved(this.messageResult(existing))
      }
      this.assertHumanActor(request.actor)
      const channel = this.requireChannel(request.workspaceId, request.channelRef)
      if (request.body.trim() === '') throw new Error('message body must not be empty')
      const sequence = this.nextSequence()
      const taskRef = this.ref('task')
      const threadRef = this.ref('thread')
      const task: AgentTeamTask = Object.freeze({
        taskRef,
        channelRef: channel.channelRef,
        threadRef,
        status: 'todo',
      })
      const thread: AgentTeamThread = Object.freeze({ threadRef, taskRef, revision: sequence })
      const message: AgentTeamMessage = Object.freeze({
        messageRef: this.ref('message'),
        channelRef: channel.channelRef,
        threadRef,
        taskRef,
        sender: request.actor.memberId,
        body: request.body,
        topLevel: true,
        sequence,
      })
      const follows: readonly AgentTeamFollow[] = Object.freeze(
        [request.actor.memberId, ...recipients].map(memberId => Object.freeze({
          memberId,
          threadRef,
          following: true as const,
        })),
      )
      for (const recipient of recipients) {
        const member = this.requireMember(recipient)
        if (member.workspaceId !== request.workspaceId || !this.isChannelMember(channel.channelRef, recipient)) {
          throw new Error(`Agent Member '${recipient}' is not authorized for Channel '${channel.channelRef}'`)
        }
      }
      const deliveries: readonly AgentTeamDelivery[] = Object.freeze(
        recipients.map(recipient => Object.freeze({
          deliveryId: this.ref('delivery'),
          source: Object.freeze({ kind: 'message' as const, messageRef: message.messageRef }),
          messageId: MessageId(`agent-team:${randomUUID()}`),
          threadRef,
          taskRef,
          recipient,
          state: 'queued' as const,
        })),
      )
      const operation: AgentTeamMessageSentOperation = Object.freeze({
        ...this.operationBase(request, sequence),
        kind: 'team/message-sent',
        data: Object.freeze({
          workspaceId: request.workspaceId,
          message,
          task,
          thread,
          follows,
          deliveries,
        }),
      })
      await this.table.put(operation.operationId, operation)
      this.commit(operation)
      this.projectMessage(operation)
      return this.committed(this.messageResult(operation))
    })
  }

  /** Append a revision-fenced Member reply to one existing Task Thread. */
  reply(request: AgentTeamAuthorizedReplyRequest): Promise<AgentTeamLedgerResult<AgentTeamReplyResult | AgentTeamConfirmationRequired>> {
    return this.enqueue(async () => {
      const explicit = this.normalizeRecipients(request.actor, request.recipients)
      const existing = this.byRequest.get(request.requestId)
      if (existing !== undefined) {
        this.assertSameReply(existing, request, explicit)
        return this.resolved(this.replyResult(existing))
      }
      const member = this.assertMemberActor(request.actor)
      const task = this.requireTask(request.workspaceId, request.taskRef)
      const thread = this.requireThread(task.threadRef)
      this.requireMemberChannel(member, task.channelRef)
      const body = request.body.trim()
      if (body === '') throw new Error('message body must not be empty')
      for (const recipient of explicit) {
        const target = this.requireMember(recipient)
        if (target.workspaceId !== request.workspaceId || !this.isChannelMember(task.channelRef, recipient)) {
          throw new Error(`Agent Member '${recipient}' is not authorized for Channel '${task.channelRef}'`)
        }
      }
      if (request.baseRevision !== thread.revision) {
        if (request.confirmationToken !== undefined) this.confirmations.delete(request.confirmationToken)
        const newer = [
          ...this.messages.filter(message => message.threadRef === thread.threadRef
            && message.sequence > request.baseRevision).map(message => ({ sequence: message.sequence, ref: message.messageRef })),
          ...this.activities.filter(activity => activity.threadRef === thread.threadRef
            && activity.sequence > request.baseRevision).map(activity => ({ sequence: activity.sequence, ref: activity.activityRef })),
        ].sort((left, right) => left.sequence - right.sequence).slice(-3).map(item => item.ref)
        throw new Error(`stale Thread revision ${request.baseRevision}; current revision is ${thread.revision}; newer facts: ${newer.join(', ') || 'none'}`)
      }
      if (request.confirmationToken !== undefined) {
        this.consumeConfirmation(request.confirmationToken, member, thread, explicit)
      } else {
        const unfollowed = explicit.filter(recipient => !this.isFollowing(thread.threadRef, recipient))
        if (unfollowed.length > 0) {
          for (const [token, confirmation] of this.confirmations) {
            if (confirmation.sender === member.memberId) this.confirmations.delete(token)
          }
          const confirmationToken = `confirmation:${randomUUID()}` as AgentTeamConfirmationToken
          this.confirmations.set(confirmationToken, Object.freeze({
            sender: member.memberId, threadRef: thread.threadRef, revision: thread.revision,
            recipients: explicit, following: explicit.map(recipient => this.isFollowing(thread.threadRef, recipient)),
            memberStates: explicit.map(recipient => this.requireMember(recipient).state),
          }))
          return this.resolved(Object.freeze({
            kind: 'confirmation_required', confirmationToken, taskRef: task.taskRef,
            threadRef: thread.threadRef, revision: thread.revision, recipients: Object.freeze(unfollowed),
          }))
        }
      }
      const sequence = this.nextSequence()
      const message: AgentTeamMessage = Object.freeze({
        messageRef: this.ref('message'), channelRef: task.channelRef, threadRef: task.threadRef,
        taskRef: task.taskRef, sender: member.memberId, body, topLevel: false, sequence,
      })
      const nextThread: AgentTeamThread = Object.freeze({ ...thread, revision: sequence })
      const currentFollowers = this.follows.get(thread.threadRef) ?? new Set<AgentTeamMemberId>()
      const followerIds = [...new Set([...currentFollowers, member.memberId, ...explicit])]
      const follows: readonly AgentTeamFollow[] = Object.freeze(followerIds.map(memberId => Object.freeze({
        memberId, threadRef: thread.threadRef, following: true as const,
      })))
      const recipients = followerIds.filter(memberId => memberId !== member.memberId && this.members.has(memberId))
      const deliveries = this.messageDeliveries(message, recipients)
      const operation: AgentTeamThreadRepliedOperation = Object.freeze({
        ...this.operationBase(request, sequence), kind: 'team/thread-replied',
        data: Object.freeze({ workspaceId: request.workspaceId, baseRevision: request.baseRevision,
          mentions: explicit, message, task, thread: nextThread, follows, deliveries }),
      })
      await this.table.put(operation.operationId, operation)
      this.commit(operation)
      this.projectMessage(operation)
      return this.committed(this.replyResult(operation))
    })
  }

  /** Change the exact Member's durable subscription on one visible Thread. */
  changeFollow(request: AgentTeamAuthorizedFollowRequest): Promise<AgentTeamLedgerResult<AgentTeamFollowResult>> {
    return this.enqueue(async () => {
      const existing = this.byRequest.get(request.requestId)
      if (existing !== undefined) {
        this.assertSameFollow(existing, request)
        return this.resolved(this.followResult(existing))
      }
      const member = this.assertMemberActor(request.actor)
      const task = this.requireTask(request.workspaceId, request.taskRef)
      const thread = this.requireThread(task.threadRef)
      this.requireMemberChannel(member, task.channelRef)
      const following = request.action === 'follow'
      if (this.isFollowing(thread.threadRef, member.memberId) === following) {
        throw new Error(`Member is already ${following ? 'following' : 'unfollowed from'} Thread '${thread.threadRef}'`)
      }
      const sequence = this.nextSequence()
      const activity: AgentTeamFollowActivity = Object.freeze({
        activityRef: this.ref('activity'), kind: request.action, taskRef: task.taskRef,
        threadRef: thread.threadRef, actor: member.memberId, sequence,
      })
      const follow: AgentTeamFollow = Object.freeze({
        memberId: member.memberId, threadRef: thread.threadRef, following,
      })
      const nextThread: AgentTeamThread = Object.freeze({ ...thread, revision: sequence })
      const recipients = [...(this.follows.get(thread.threadRef) ?? [])]
        .filter(id => id !== member.memberId && this.members.has(id))
      const deliveries = this.activityDeliveries(activity, recipients)
      const operation: AgentTeamFollowChangedOperation = Object.freeze({
        ...this.operationBase(request, sequence), kind: 'team/follow-changed',
        data: Object.freeze({ workspaceId: request.workspaceId, activity, follow, task,
          thread: nextThread, deliveries }),
      })
      await this.table.put(operation.operationId, operation)
      this.commit(operation)
      this.projectFollow(operation)
      return this.committed(this.followResult(operation))
    })
  }

  followStatus(actor: AgentTeamMemberActor, request: {
    workspaceId: WorkspaceId
    taskRef: AgentTeamTaskRef
  }): AgentTeamFollowStatus {
    const member = this.assertMemberActor(actor)
    const task = this.requireTask(request.workspaceId, request.taskRef)
    this.requireMemberChannel(member, task.channelRef)
    const thread = this.requireThread(task.threadRef)
    return Object.freeze({ task, thread, following: this.isFollowing(thread.threadRef, member.memberId) })
  }

  /** Mutate one Member-owned Direction Claim and derive Task state. */
  changeClaim(request: AgentTeamAuthorizedClaimRequest): Promise<AgentTeamLedgerResult<AgentTeamClaimResult>> {
    return this.enqueue(async () => {
      const existing = this.byRequest.get(request.requestId)
      if (existing !== undefined) {
        this.assertSameClaim(existing, request)
        return this.resolved(this.claimResult(existing))
      }
      const member = this.assertMemberActor(request.actor)
      const task = this.requireTask(request.workspaceId, request.taskRef)
      const thread = this.requireThread(task.threadRef)
      this.requireMemberChannel(member, task.channelRef)
      let claim: AgentTeamClaim
      let kind: AgentTeamClaimChangedOperation['kind']
      let activityKind: AgentTeamActivity['kind']
      if (request.action === 'claim') {
        if (request.claimRef !== undefined) throw new Error('claim action does not accept claimRef')
        const direction = request.direction?.trim() ?? ''
        const normalizedDirection = this.normalizeDirection(direction)
        if (normalizedDirection === '') throw new Error('claim direction must not be empty')
        if ([...this.claims.values()].some(candidate => candidate.taskRef === task.taskRef
          && candidate.state === 'active' && candidate.normalizedDirection === normalizedDirection)) {
          throw new Error(`Direction '${direction}' already has an active Claim`)
        }
        claim = Object.freeze({ claimRef: this.ref('claim'), taskRef: task.taskRef, threadRef: task.threadRef,
          owner: member.memberId, direction, normalizedDirection, state: 'active' })
        kind = 'team/claim-created'
        activityKind = 'claim'
      } else {
        if (request.direction !== undefined) throw new Error(`${request.action} action does not accept direction`)
        const previous = request.claimRef === undefined ? undefined : this.claims.get(request.claimRef)
        if (previous === undefined) throw new Error(`unknown Claim '${request.claimRef ?? ''}'`)
        if (previous.taskRef !== task.taskRef || previous.owner !== member.memberId) {
          throw new Error('Member can modify only its own Claim on this Task')
        }
        if (previous.state !== 'active') throw new Error(`Claim '${previous.claimRef}' is already ${previous.state}`)
        claim = Object.freeze({ ...previous, state: request.action === 'done' ? 'done' : 'released' })
        kind = request.action === 'done' ? 'team/claim-done' : 'team/claim-released'
        activityKind = request.action
      }
      const sequence = this.nextSequence()
      const projected = new Map(this.claims).set(claim.claimRef, claim)
      const nextTask: AgentTeamTask = Object.freeze({ ...task, status: this.deriveTaskStatus(task.taskRef, projected.values()) })
      const nextThread: AgentTeamThread = Object.freeze({ ...thread, revision: sequence })
      const activity: AgentTeamActivity = Object.freeze({
        activityRef: this.ref('activity'), kind: activityKind, taskRef: task.taskRef,
        threadRef: thread.threadRef, actor: member.memberId, claimRef: claim.claimRef, sequence,
      })
      const recipients = [...(this.follows.get(thread.threadRef) ?? [])]
        .filter(id => id !== member.memberId && this.members.has(id))
      const deliveries = this.activityDeliveries(activity, recipients)
      const operation: AgentTeamClaimChangedOperation = Object.freeze({
        ...this.operationBase(request, sequence), kind,
        data: Object.freeze({ workspaceId: request.workspaceId, activity, claim, task: nextTask,
          thread: nextThread, deliveries }),
      }) as AgentTeamClaimChangedOperation
      await this.table.put(operation.operationId, operation)
      this.commit(operation)
      this.projectClaim(operation)
      return this.committed(this.claimResult(operation))
    })
  }

  /** List complete Claim history and current derived state for an authorized Member. */
  listClaims(actor: AgentTeamMemberActor, request: { workspaceId: WorkspaceId; taskRef: AgentTeamTaskRef }): AgentTeamClaimList {
    const member = this.assertMemberActor(actor)
    const task = this.requireTask(request.workspaceId, request.taskRef)
    this.requireMemberChannel(member, task.channelRef)
    return Object.freeze({ task, thread: this.requireThread(task.threadRef),
      claims: Object.freeze([...this.claims.values()].filter(claim => claim.taskRef === task.taskRef)) })
  }

  /**
   * Read bounded facts visible to the Human across one Workspace.
   * @param request - Workspace scope, optional Channel filter, and continuation.
   * @returns Channels and Message-derived facts after the supplied sequence.
   */
  view(request: AgentTeamViewRequest, memberId?: AgentTeamMemberId): AgentTeamView {
    const limit = request.limit ?? 20
    const cursor = request.cursor ?? 0
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('limit must be an integer between 1 and 100')
    }
    if (!Number.isInteger(cursor) || cursor < 0) {
      throw new Error('cursor must be a non-negative integer sequence')
    }
    const channels = [...this.channels.values()]
      .filter(channel => channel.workspaceId === request.workspaceId
        && (memberId === undefined || this.isChannelMember(channel.channelRef, memberId)))
    if (memberId !== undefined) {
      const member = this.requireMember(memberId)
      if (member.workspaceId !== request.workspaceId) throw new Error('Member cannot view another Workspace')
    }
    if (request.channelRef !== undefined) {
      this.requireChannel(request.workspaceId, request.channelRef)
      if (memberId !== undefined && !this.isChannelMember(request.channelRef, memberId)) {
        throw new Error(`Agent Member '${memberId}' is not authorized for Channel '${request.channelRef}'`)
      }
    }
    const visibleMessage = (message: AgentTeamMessage): boolean => {
      const channel = this.channels.get(message.channelRef)
      return message.sequence > cursor && channel?.workspaceId === request.workspaceId
        && (memberId === undefined || this.isChannelMember(message.channelRef, memberId))
        && (request.channelRef === undefined || message.channelRef === request.channelRef)
    }
    const visibleActivity = (activity: AgentTeamActivity): boolean => {
      const task = this.tasks.get(activity.taskRef)
      return activity.sequence > cursor && task !== undefined
        && this.channels.get(task.channelRef)?.workspaceId === request.workspaceId
        && (request.channelRef === undefined || task.channelRef === request.channelRef)
        && (memberId === undefined || this.isChannelMember(task.channelRef, memberId))
    }
    const candidates = [
      ...this.messages.filter(visibleMessage).map(value => ({ kind: 'message' as const, sequence: value.sequence, value })),
      ...this.activities.filter(visibleActivity).map(value => ({ kind: 'activity' as const, sequence: value.sequence, value })),
    ].sort((left, right) => left.sequence - right.sequence)
    const selected = candidates.slice(0, limit)
    const items = selected.filter(entry => entry.kind === 'message').map(({ value: message }) => {
      const task = this.tasks.get(message.taskRef)
      const thread = this.threads.get(message.threadRef)
      if (task === undefined || thread === undefined) {
        throw new Error(`agent-team projection is incomplete for message '${message.messageRef}'`)
      }
      return Object.freeze({ message, task, thread })
    })
    return Object.freeze({
      channels: Object.freeze(channels),
      items: Object.freeze(items),
      activities: Object.freeze(selected.filter(entry => entry.kind === 'activity').map(entry => entry.value)),
      cursor: selected.at(-1)?.sequence ?? cursor,
      hasMore: candidates.length > selected.length,
    })
  }

  /**
   * Return the current projection after initialization has committed.
   * @returns The immutable Human-facing Team status.
   */
  status(): AgentTeamStatus {
    const initialization = this.ordered[0]
    if (initialization === undefined) {
      throw new Error('agent-team ledger is not initialized')
    }
    this.assertInitializationRecord(initialization)
    return Object.freeze({
      initialized: true,
      sequence: this.ordered.length,
      operationCount: this.ordered.length,
      channelCount: this.channels.size,
      agentMemberCount: this.members.size,
      humanMemberId: initialization.data.humanMemberId,
    })
  }

  /** Validate all ledger relationships against the current durable table. */
  validate(): void {
    const records = this.sortedRecords()
    if (records.length !== this.ordered.length) {
      throw new Error('agent-team ledger projection length differs from the durable table')
    }
    this.validateRecords(records)
  }

  private replay(): void {
    const records = this.sortedRecords()
    this.validateRecords(records)
    for (const [, operation] of records) {
      this.commit(operation)
      if (operation.kind === 'team/channel-created') {
        this.channels.set(operation.data.channel.channelRef, operation.data.channel)
      } else if (operation.kind === 'team/channel-member-added') {
        this.projectJoin(operation)
      } else if (operation.kind === 'team/message-sent' || operation.kind === 'team/thread-replied') {
        this.projectMessage(operation)
      } else if (operation.kind === 'team/follow-changed') {
        this.projectFollow(operation)
      } else if (operation.kind === 'team/claim-created'
        || operation.kind === 'team/claim-done'
        || operation.kind === 'team/claim-released') {
        this.projectClaim(operation)
      } else if (operation.kind === 'team/delivery-admitted') {
        this.deliveries.set(operation.data.delivery.deliveryId, operation.data.delivery)
      } else if (operation.kind === 'team/member-added') {
        this.members.set(operation.data.member.memberId, operation.data.member)
      } else if (operation.kind === 'team/member-suspended' || operation.kind === 'team/member-resumed') {
        this.members.set(operation.data.member.memberId, operation.data.member)
      }
    }
  }

  private validateRecords(records: readonly [AgentTeamOperationId, AgentTeamOperation][]): void {
    const operationIds = new Set<AgentTeamOperationId>()
    const requestIds = new Set<AgentTeamRequestId>()
    const refs = new Set<string>()
    const channels = new Map<AgentTeamChannelRef, AgentTeamChannel>()
    const members = new Map<AgentTeamMemberId, AgentTeamAgentMember>()
    const memberships = new Map<AgentTeamChannelRef, Set<AgentTeamMemberId>>()
    const deliveries = new Map<AgentTeamDeliveryId, AgentTeamDelivery>()
    const tasks = new Map<AgentTeamTaskRef, AgentTeamTask>()
    const threads = new Map<AgentTeamThreadRef, AgentTeamThread>()
    const claims = new Map<AgentTeamClaimRef, AgentTeamClaim>()
    const follows = new Map<AgentTeamThreadRef, Set<AgentTeamMemberId>>()
    const messageIds = new Set<string>()
    let previousOperationId: AgentTeamOperationId | null = null
    let humanMemberId: AgentTeamMemberId | undefined
    for (const [index, [key, operation]] of records.entries()) {
      const expectedSequence = index + 1
      if (key !== operation.operationId) {
        throw new Error(`agent-team operation key '${key}' differs from record id '${operation.operationId}'`)
      }
      if (operation.sequence !== expectedSequence) {
        throw new Error(`agent-team ledger expected sequence ${expectedSequence}, found ${operation.sequence}`)
      }
      if (operation.previousOperationId !== previousOperationId) {
        throw new Error(`agent-team operation ${operation.sequence} has a broken previous-operation link`)
      }
      if (operationIds.has(operation.operationId)) {
        throw new Error(`agent-team ledger repeats operation id '${operation.operationId}'`)
      }
      if (requestIds.has(operation.requestId)) {
        throw new Error(`agent-team ledger repeats request id '${operation.requestId}'`)
      }
      if (expectedSequence === 1) {
        this.assertInitializationRecord(operation)
        humanMemberId = operation.data.humanMemberId
      } else {
        if (humanMemberId === undefined) throw new Error('agent-team ledger has no Human Member')
        this.assertOperation(
          operation, humanMemberId, channels, members, memberships,
          deliveries, tasks, threads, claims, follows, messageIds, refs,
        )
      }
      operationIds.add(operation.operationId)
      requestIds.add(operation.requestId)
      previousOperationId = operation.operationId
    }
  }

  private assertOperation(
    operation: AgentTeamOperation,
    humanMemberId: AgentTeamMemberId,
    channels: Map<AgentTeamChannelRef, AgentTeamChannel>,
    members: Map<AgentTeamMemberId, AgentTeamAgentMember>,
    memberships: Map<AgentTeamChannelRef, Set<AgentTeamMemberId>>,
    deliveries: Map<AgentTeamDeliveryId, AgentTeamDelivery>,
    tasks: Map<AgentTeamTaskRef, AgentTeamTask>,
    threads: Map<AgentTeamThreadRef, AgentTeamThread>,
    claims: Map<AgentTeamClaimRef, AgentTeamClaim>,
    follows: Map<AgentTeamThreadRef, Set<AgentTeamMemberId>>,
    messageIds: Set<string>,
    refs: Set<string>,
  ): void {
    if (operation.kind === 'team/initialized') {
      throw new Error('agent-team initialization must be the first and only initialization operation')
    }
    if (operation.kind === 'team/delivery-admitted') {
      if (operation.actor.kind !== 'host') throw new Error(`agent-team operation ${operation.sequence} has invalid Host authority`)
      const previous = deliveries.get(operation.data.delivery.deliveryId)
      const admitted = operation.data.delivery
      if (previous === undefined || previous.state !== 'queued' || admitted.state !== 'admitted'
        || !this.sameDelivery(previous, admitted)) {
        throw new Error(`agent-team Delivery admission ${operation.sequence} has an invalid transition`)
      }
      deliveries.set(admitted.deliveryId, admitted)
      return
    }
    const memberAuthored = operation.kind === 'team/thread-replied'
      || operation.kind === 'team/follow-changed'
      || operation.kind === 'team/claim-created'
      || operation.kind === 'team/claim-done'
      || operation.kind === 'team/claim-released'
    if (memberAuthored) {
      const member = operation.actor.kind === 'member' ? members.get(operation.actor.memberId) : undefined
      if (member === undefined || member.handle !== operation.actor.handle || member.state !== 'enabled') {
        throw new Error(`agent-team operation ${operation.sequence} has invalid Member authority`)
      }
    } else if (operation.actor.kind !== 'human' || operation.actor.memberId !== humanMemberId) {
      throw new Error(`agent-team operation ${operation.sequence} has invalid Human authority`)
    }
    if (operation.kind === 'team/channel-created') {
      const { channel } = operation.data
      if (operation.data.workspaceId !== channel.workspaceId
        || channel.createdAtSequence !== operation.sequence) {
        throw new Error(`agent-team Channel operation ${operation.sequence} has inconsistent data`)
      }
      this.addRef(refs, channel.channelRef)
      channels.set(channel.channelRef, channel)
      return
    }
    if (operation.kind === 'team/channel-member-added') {
      const channel = channels.get(operation.data.channelRef)
      const member = members.get(operation.data.memberId)
      const joined = memberships.get(operation.data.channelRef) ?? new Set<AgentTeamMemberId>()
      if (channel === undefined || member === undefined || channel.workspaceId !== member.workspaceId
        || joined.has(member.memberId)) {
        throw new Error(`agent-team Channel membership operation ${operation.sequence} is invalid`)
      }
      joined.add(member.memberId)
      memberships.set(channel.channelRef, joined)
      return
    }
    if (operation.kind === 'team/member-added') {
      const { member } = operation.data
      if (members.has(member.memberId)) throw new Error(`agent-team repeats Member '${member.memberId}'`)
      const normalized = this.normalizeHandle(member.handle)
      if ([...members.values()].some(candidate => candidate.sessionId === member.sessionId)) {
        throw new Error(`agent-team repeats Agent session '${member.sessionId}'`)
      }
      if ([...members.values()].some(candidate => candidate.workspaceId === member.workspaceId
        && this.normalizeHandle(candidate.handle) === normalized)) {
        throw new Error(`agent-team repeats active handle '${member.handle}' in Workspace '${member.workspaceId}'`)
      }
      this.addRef(refs, member.memberId)
      members.set(member.memberId, member)
      return
    }
    if (operation.kind === 'team/member-suspended' || operation.kind === 'team/member-resumed') {
      const next = operation.data.member
      const member = members.get(next.memberId)
      const expected = operation.kind === 'team/member-suspended' ? 'enabled' : 'suspended'
      const nextState = operation.kind === 'team/member-suspended' ? 'suspended' : 'enabled'
      if (member === undefined || member.state !== expected || next.state !== nextState
        || !this.sameMemberIdentity(member, next)) {
        throw new Error(`agent-team Member lifecycle operation ${operation.sequence} has an invalid transition`)
      }
      members.set(next.memberId, next)
      return
    }
    if (operation.kind === 'team/follow-changed') {
      this.validateFollowOperation(operation, channels, members, memberships, tasks, threads,
        follows, deliveries, messageIds, refs)
      return
    }
    if (operation.kind === 'team/claim-created'
      || operation.kind === 'team/claim-done'
      || operation.kind === 'team/claim-released') {
      this.validateClaimOperation(operation, channels, members, memberships, tasks, threads, claims, follows, deliveries, messageIds, refs)
      return
    }
    const { message, task, thread, follows: nextFollows, deliveries: queued } = operation.data
    if (operation.actor.kind === 'host') {
      throw new Error(`agent-team Message operation ${operation.sequence} has invalid authority`)
    }
    const actor = operation.actor
    const channel = channels.get(message.channelRef)
    if (channel === undefined || channel.workspaceId !== operation.data.workspaceId) {
      throw new Error(`agent-team Message operation ${operation.sequence} references an invalid Channel`)
    }
    const priorTask = tasks.get(task.taskRef)
    const priorThread = threads.get(thread.threadRef)
    const topLevel = operation.kind === 'team/message-sent'
    if (message.sequence !== operation.sequence
      || message.sender !== actor.memberId
      || message.topLevel !== topLevel
      || (topLevel ? priorTask !== undefined || priorThread !== undefined || task.status !== 'todo'
        : priorTask === undefined || priorThread === undefined
          || priorTask.channelRef !== task.channelRef || priorTask.threadRef !== task.threadRef
          || priorThread.taskRef !== thread.taskRef
          || operation.data.baseRevision !== priorThread.revision || priorTask.status !== task.status)
      || task.channelRef !== message.channelRef
      || task.taskRef !== message.taskRef
      || task.threadRef !== message.threadRef
      || thread.taskRef !== task.taskRef
      || thread.threadRef !== task.threadRef
      || thread.revision !== operation.sequence) {
      throw new Error(`agent-team Message operation ${operation.sequence} has inconsistent derived facts`)
    }
    this.addRef(refs, message.messageRef)
    if (topLevel) {
      this.addRef(refs, task.taskRef)
      this.addRef(refs, thread.threadRef)
    }
    const recipients = new Set<AgentTeamMemberId>()
    for (const delivery of queued) {
      this.addRef(refs, delivery.deliveryId)
      if (messageIds.has(delivery.messageId)) {
        throw new Error(`agent-team repeats Inbox MessageId '${delivery.messageId}'`)
      }
      messageIds.add(delivery.messageId)
      const recipient = members.get(delivery.recipient)
      if (delivery.source.kind !== 'message' || delivery.source.messageRef !== message.messageRef
        || delivery.threadRef !== thread.threadRef
        || delivery.taskRef !== task.taskRef
        || delivery.state !== 'queued'
        || recipient === undefined
        || recipient.workspaceId !== operation.data.workspaceId
        || !memberships.get(channel.channelRef)?.has(recipient.memberId)
        || delivery.recipient === actor.memberId
        || recipients.has(delivery.recipient)) {
        throw new Error(`agent-team Message operation ${operation.sequence} has invalid Deliveries`)
      }
      recipients.add(delivery.recipient)
      deliveries.set(delivery.deliveryId, delivery)
    }
    const currentFollows = follows.get(thread.threadRef) ?? new Set<AgentTeamMemberId>()
    const mentions = operation.kind === 'team/thread-replied' ? operation.data.mentions : [...recipients]
    const expectedFollows = [...new Set([...currentFollows, actor.memberId, ...mentions])]
    const expectedRecipients = expectedFollows.filter(memberId => memberId !== actor.memberId && members.has(memberId)).sort()
    if (!this.sameList([...recipients].sort(), expectedRecipients)
      || nextFollows.length !== expectedFollows.length || nextFollows.some((follow, index) =>
      follow.memberId !== expectedFollows[index]
      || follow.threadRef !== thread.threadRef
      || follow.following !== true)) {
      throw new Error(`agent-team Message operation ${operation.sequence} has invalid Follow state`)
    }
    follows.set(thread.threadRef, new Set(expectedFollows))
    tasks.set(task.taskRef, task)
    threads.set(thread.threadRef, thread)
  }

  private validateFollowOperation(
    operation: AgentTeamFollowChangedOperation,
    channels: Map<AgentTeamChannelRef, AgentTeamChannel>,
    members: Map<AgentTeamMemberId, AgentTeamAgentMember>,
    memberships: Map<AgentTeamChannelRef, Set<AgentTeamMemberId>>,
    tasks: Map<AgentTeamTaskRef, AgentTeamTask>,
    threads: Map<AgentTeamThreadRef, AgentTeamThread>,
    follows: Map<AgentTeamThreadRef, Set<AgentTeamMemberId>>,
    deliveries: Map<AgentTeamDeliveryId, AgentTeamDelivery>,
    messageIds: Set<string>,
    refs: Set<string>,
  ): void {
    if (operation.actor.kind !== 'member') throw new Error('Follow operation requires Member authority')
    const actor = operation.actor
    const { activity, follow, task, thread, deliveries: queued } = operation.data
    const previousTask = tasks.get(task.taskRef)
    const previousThread = threads.get(thread.threadRef)
    const channel = channels.get(task.channelRef)
    const currentFollowers = follows.get(thread.threadRef) ?? new Set<AgentTeamMemberId>()
    const expectedFollowing = operation.data.activity.kind === 'follow'
    if (previousTask === undefined || previousThread === undefined || channel === undefined
      || channel.workspaceId !== operation.data.workspaceId
      || !memberships.get(channel.channelRef)?.has(actor.memberId)
      || previousTask.channelRef !== task.channelRef || previousTask.threadRef !== task.threadRef
      || previousThread.taskRef !== thread.taskRef || thread.revision !== operation.sequence
      || activity.sequence !== operation.sequence || activity.actor !== actor.memberId
      || activity.taskRef !== task.taskRef || activity.threadRef !== thread.threadRef
      || follow.memberId !== actor.memberId || follow.threadRef !== thread.threadRef
      || follow.following !== expectedFollowing
      || currentFollowers.has(actor.memberId) === expectedFollowing) {
      throw new Error(`agent-team Follow operation ${operation.sequence} has inconsistent facts`)
    }
    this.addRef(refs, activity.activityRef)
    const expectedRecipients = [...currentFollowers].filter(id => id !== actor.memberId && members.has(id)).sort()
    const recipients: AgentTeamMemberId[] = []
    for (const delivery of queued) {
      this.addRef(refs, delivery.deliveryId)
      if (messageIds.has(delivery.messageId)) throw new Error(`agent-team repeats Inbox MessageId '${delivery.messageId}'`)
      messageIds.add(delivery.messageId)
      if (delivery.source.kind !== 'activity' || delivery.source.activityRef !== activity.activityRef
        || delivery.threadRef !== thread.threadRef || delivery.taskRef !== task.taskRef
        || delivery.state !== 'queued' || !currentFollowers.has(delivery.recipient)
        || !members.has(delivery.recipient) || delivery.recipient === actor.memberId
        || recipients.includes(delivery.recipient)) {
        throw new Error(`agent-team Follow operation ${operation.sequence} has invalid Deliveries`)
      }
      recipients.push(delivery.recipient)
      deliveries.set(delivery.deliveryId, delivery)
    }
    if (!this.sameList(recipients.sort(), expectedRecipients)) {
      throw new Error(`agent-team Follow operation ${operation.sequence} has an incomplete Delivery set`)
    }
    const nextFollowers = new Set(currentFollowers)
    if (follow.following) nextFollowers.add(follow.memberId)
    else nextFollowers.delete(follow.memberId)
    follows.set(thread.threadRef, nextFollowers)
    tasks.set(task.taskRef, task)
    threads.set(thread.threadRef, thread)
  }

  private validateClaimOperation(
    operation: AgentTeamClaimChangedOperation,
    channels: Map<AgentTeamChannelRef, AgentTeamChannel>,
    members: Map<AgentTeamMemberId, AgentTeamAgentMember>,
    memberships: Map<AgentTeamChannelRef, Set<AgentTeamMemberId>>,
    tasks: Map<AgentTeamTaskRef, AgentTeamTask>,
    threads: Map<AgentTeamThreadRef, AgentTeamThread>,
    claims: Map<AgentTeamClaimRef, AgentTeamClaim>,
    follows: Map<AgentTeamThreadRef, Set<AgentTeamMemberId>>,
    deliveries: Map<AgentTeamDeliveryId, AgentTeamDelivery>,
    messageIds: Set<string>,
    refs: Set<string>,
  ): void {
    if (operation.actor.kind !== 'member') throw new Error('Claim operation requires Member authority')
    const actor = operation.actor
    const { activity, claim, task, thread, deliveries: queued } = operation.data
    const previousTask = tasks.get(task.taskRef)
    const previousThread = threads.get(thread.threadRef)
    const previousClaim = claims.get(claim.claimRef)
    const expectedActivity = operation.kind === 'team/claim-created'
      ? 'claim' : operation.kind === 'team/claim-done' ? 'done' : 'release'
    const expectedState = operation.kind === 'team/claim-created'
      ? 'active' : operation.kind === 'team/claim-done' ? 'done' : 'released'
    const channel = channels.get(task.channelRef)
    if (previousTask === undefined || previousThread === undefined || channel === undefined
      || previousTask.channelRef !== task.channelRef || previousTask.threadRef !== task.threadRef
      || previousThread.taskRef !== thread.taskRef
      || channel.workspaceId !== operation.data.workspaceId
      || !memberships.get(channel.channelRef)?.has(operation.actor.memberId)
      || thread.taskRef !== task.taskRef || thread.threadRef !== task.threadRef
      || thread.revision !== operation.sequence
      || activity.activityRef === undefined || activity.kind !== expectedActivity
      || activity.sequence !== operation.sequence || activity.actor !== operation.actor.memberId
      || activity.taskRef !== task.taskRef || activity.threadRef !== thread.threadRef
      || activity.claimRef !== claim.claimRef || claim.taskRef !== task.taskRef
      || claim.threadRef !== thread.threadRef || claim.owner !== operation.actor.memberId
      || claim.state !== expectedState) {
      throw new Error(`agent-team Claim operation ${operation.sequence} has inconsistent facts`)
    }
    if (operation.kind === 'team/claim-created') {
      if (previousClaim !== undefined || claim.normalizedDirection !== this.normalizeDirection(claim.direction)
        || [...claims.values()].some(candidate => candidate.taskRef === task.taskRef
          && candidate.state === 'active'
          && candidate.normalizedDirection === claim.normalizedDirection)) {
        throw new Error(`agent-team Claim operation ${operation.sequence} has an invalid creation`)
      }
      this.addRef(refs, claim.claimRef)
    } else if (previousClaim === undefined || previousClaim.state !== 'active'
      || !this.sameClaimIdentity(previousClaim, claim)) {
      throw new Error(`agent-team Claim operation ${operation.sequence} has an invalid transition`)
    }
    const projectedClaims = new Map(claims)
    projectedClaims.set(claim.claimRef, claim)
    if (task.status !== this.deriveTaskStatus(task.taskRef, projectedClaims.values())) {
      throw new Error(`agent-team Claim operation ${operation.sequence} has an invalid Task state`)
    }
    this.addRef(refs, activity.activityRef)
    const followers = follows.get(thread.threadRef) ?? new Set<AgentTeamMemberId>()
    const expectedRecipients = [...followers].filter(memberId => memberId !== actor.memberId && members.has(memberId))
    const recipients = new Set<AgentTeamMemberId>()
    for (const delivery of queued) {
      this.addRef(refs, delivery.deliveryId)
      if (messageIds.has(delivery.messageId)) throw new Error(`agent-team repeats Inbox MessageId '${delivery.messageId}'`)
      messageIds.add(delivery.messageId)
      if (delivery.source.kind !== 'activity' || delivery.source.activityRef !== activity.activityRef
        || delivery.threadRef !== thread.threadRef || delivery.taskRef !== task.taskRef
        || delivery.state !== 'queued' || !followers.has(delivery.recipient)
        || !members.has(delivery.recipient) || delivery.recipient === operation.actor.memberId
        || recipients.has(delivery.recipient)) {
        throw new Error(`agent-team Claim operation ${operation.sequence} has invalid Deliveries`)
      }
      recipients.add(delivery.recipient)
      deliveries.set(delivery.deliveryId, delivery)
    }
    if (!this.sameList([...recipients].sort(), expectedRecipients.sort())) {
      throw new Error(`agent-team Claim operation ${operation.sequence} has an incomplete Delivery set`)
    }
    claims.set(claim.claimRef, claim)
    tasks.set(task.taskRef, task)
    threads.set(thread.threadRef, thread)
  }

  private assertInitializationRecord(
    operation: AgentTeamOperation,
  ): asserts operation is AgentTeamInitializedOperation {
    if (operation.kind !== 'team/initialized'
      || operation.sequence !== 1
      || operation.previousOperationId !== null
      || operation.actor.kind !== 'human'
      || operation.actor.memberId !== operation.data.humanMemberId) {
      throw new Error('agent-team initialization operation has an invalid payload')
    }
  }

  private assertSameInitialization(
    operation: AgentTeamOperation,
    request: AgentTeamInitializeRequest,
  ): asserts operation is AgentTeamInitializedOperation {
    if (operation.kind !== 'team/initialized'
      || !this.sameActor(operation.actor, request.actor)
      || operation.data.humanMemberId !== request.humanMemberId) {
      this.throwRequestCollision(request.requestId)
    }
  }

  private assertSameChannelCreation(
    operation: AgentTeamOperation,
    request: AgentTeamAuthorizedCreateChannelRequest,
  ): asserts operation is AgentTeamChannelCreatedOperation {
    if (operation.kind !== 'team/channel-created'
      || !this.sameActor(operation.actor, request.actor)
      || operation.data.workspaceId !== request.workspaceId
      || operation.data.channel.name !== request.name.trim()) {
      this.throwRequestCollision(request.requestId)
    }
  }

  private assertSameChannelJoin(
    operation: AgentTeamOperation,
    request: AgentTeamAuthorizedJoinChannelRequest,
  ): asserts operation is AgentTeamChannelMemberAddedOperation {
    if (operation.kind !== 'team/channel-member-added'
      || !this.sameActor(operation.actor, request.actor)
      || operation.data.channelRef !== request.channelRef
      || operation.data.memberId !== request.memberId) {
      this.throwRequestCollision(request.requestId)
    }
  }

  private assertSameDeliveryAdmission(
    operation: AgentTeamOperation,
    request: AgentTeamAuthorizedAdmitDeliveryRequest,
  ): asserts operation is AgentTeamDeliveryAdmittedOperation {
    if (operation.kind !== 'team/delivery-admitted'
      || operation.actor.kind !== 'host'
      || operation.data.delivery.deliveryId !== request.deliveryId
      || operation.data.evidence !== request.evidence) {
      this.throwRequestCollision(request.requestId)
    }
  }

  private assertSameReply(
    operation: AgentTeamOperation,
    request: AgentTeamAuthorizedReplyRequest,
    recipients: readonly AgentTeamMemberId[],
  ): asserts operation is AgentTeamThreadRepliedOperation {
    if (operation.kind !== 'team/thread-replied' || !this.sameActor(operation.actor, request.actor)
      || operation.data.workspaceId !== request.workspaceId || operation.data.message.taskRef !== request.taskRef
      || operation.data.message.body !== request.body.trim()
      || operation.data.baseRevision !== request.baseRevision
      || !this.sameList(operation.data.mentions, recipients)) {
      this.throwRequestCollision(request.requestId)
    }
  }

  private assertSameFollow(
    operation: AgentTeamOperation,
    request: AgentTeamAuthorizedFollowRequest,
  ): asserts operation is AgentTeamFollowChangedOperation {
    if (operation.kind !== 'team/follow-changed' || !this.sameActor(operation.actor, request.actor)
      || operation.data.workspaceId !== request.workspaceId || operation.data.task.taskRef !== request.taskRef
      || operation.data.follow.following !== (request.action === 'follow')) {
      this.throwRequestCollision(request.requestId)
    }
  }

  private assertSameClaim(
    operation: AgentTeamOperation,
    request: AgentTeamAuthorizedClaimRequest,
  ): asserts operation is AgentTeamClaimChangedOperation {
    const kind = request.action === 'claim' ? 'team/claim-created'
      : request.action === 'done' ? 'team/claim-done' : 'team/claim-released'
    if (operation.kind !== kind || !this.sameActor(operation.actor, request.actor)
      || operation.data.workspaceId !== request.workspaceId || operation.data.task.taskRef !== request.taskRef
      || (request.action === 'claim'
        ? operation.data.claim.direction !== request.direction?.trim()
        : operation.data.claim.claimRef !== request.claimRef)) {
      this.throwRequestCollision(request.requestId)
    }
  }

  private assertSameMemberAdd(
    operation: AgentTeamOperation,
    request: AgentTeamAuthorizedAddMemberRequest,
  ): asserts operation is AgentTeamMemberAddedOperation {
    if (operation.kind !== 'team/member-added'
      || !this.sameActor(operation.actor, request.actor)
      || operation.data.member.workspaceId !== request.workspaceId
      || operation.data.member.handle !== request.handle.trim()
      || operation.data.member.description !== request.description.trim()
      || operation.data.member.presetId !== request.presetId.trim()) {
      this.throwRequestCollision(request.requestId)
    }
  }

  private assertSameMemberState(
    operation: AgentTeamOperation,
    request: AgentTeamAuthorizedSetMemberStateRequest,
    state: 'enabled' | 'suspended',
  ): asserts operation is AgentTeamMemberSuspendedOperation | AgentTeamMemberResumedOperation {
    const kind = state === 'suspended' ? 'team/member-suspended' : 'team/member-resumed'
    if (operation.kind !== kind
      || !this.sameActor(operation.actor, request.actor)
      || operation.data.member.memberId !== request.memberId) {
      this.throwRequestCollision(request.requestId)
    }
  }

  private assertSameMessage(
    operation: AgentTeamOperation,
    request: AgentTeamAuthorizedSendMessageRequest,
    recipients: readonly AgentTeamMemberId[],
  ): asserts operation is AgentTeamMessageSentOperation {
    const storedRecipients = operation.kind === 'team/message-sent'
      ? operation.data.deliveries.map(delivery => delivery.recipient)
      : []
    if (operation.kind !== 'team/message-sent'
      || !this.sameActor(operation.actor, request.actor)
      || operation.data.workspaceId !== request.workspaceId
      || operation.data.message.channelRef !== request.channelRef
      || operation.data.message.body !== request.body
      || !this.sameList(storedRecipients, recipients)) {
      this.throwRequestCollision(request.requestId)
    }
  }

  private assertHumanActor(actor: AgentTeamHumanActor): void {
    const initialization = this.ordered[0]
    if (initialization === undefined) throw new Error('agent-team ledger is not initialized')
    this.assertInitializationRecord(initialization)
    if (actor.kind !== 'human' || actor.memberId !== initialization.data.humanMemberId) {
      throw new Error('agent-team operation lacks Human authority')
    }
  }

  private normalizeRecipients(
    actor: AgentTeamHumanActor | AgentTeamMemberActor,
    recipients: readonly AgentTeamMemberId[] | undefined,
  ): readonly AgentTeamMemberId[] {
    const unique = new Set(recipients ?? [])
    if (unique.size !== (recipients?.length ?? 0)) {
      throw new Error('recipient set contains duplicate Member refs')
    }
    if (unique.has(actor.memberId)) {
      throw new Error('sender cannot be a recipient intent')
    }
    return Object.freeze([...unique].sort())
  }

  private consumeConfirmation(
    token: AgentTeamConfirmationToken,
    sender: AgentTeamAgentMember,
    thread: AgentTeamThread,
    recipients: readonly AgentTeamMemberId[],
  ): void {
    const confirmation = this.confirmations.get(token)
    this.confirmations.delete(token)
    const currentFollowing = recipients.map(recipient => this.isFollowing(thread.threadRef, recipient))
    const currentStates = recipients.map(recipient => this.members.get(recipient)?.state)
    if (confirmation === undefined || confirmation.sender !== sender.memberId
      || confirmation.threadRef !== thread.threadRef || confirmation.revision !== thread.revision
      || !this.sameList(confirmation.recipients, recipients)
      || !this.sameList(confirmation.following, currentFollowing)
      || !this.sameList(confirmation.memberStates, currentStates)) {
      throw new Error('confirmation token is invalid or expired')
    }
  }

  private assertMemberActor(actor: AgentTeamMemberActor): AgentTeamAgentMember {
    const member = this.requireMember(actor.memberId)
    if (member.state !== 'enabled' || member.handle !== actor.handle) {
      throw new Error('agent-team operation lacks enabled Member authority')
    }
    return member
  }

  private requireTask(workspaceId: WorkspaceId, taskRef: AgentTeamTaskRef): AgentTeamTask {
    const task = this.tasks.get(taskRef)
    if (task === undefined) throw new Error(`unknown Task ref '${taskRef}'`)
    if (this.channels.get(task.channelRef)?.workspaceId !== workspaceId) {
      throw new Error(`Task '${taskRef}' does not belong to Workspace '${workspaceId}'`)
    }
    return task
  }

  private requireThread(threadRef: AgentTeamThreadRef): AgentTeamThread {
    const thread = this.threads.get(threadRef)
    if (thread === undefined) throw new Error(`unknown Thread ref '${threadRef}'`)
    return thread
  }

  private requireMemberChannel(member: AgentTeamAgentMember, channelRef: AgentTeamChannelRef): void {
    if (!this.isChannelMember(channelRef, member.memberId)) {
      throw new Error(`Agent Member '${member.memberId}' is not authorized for Channel '${channelRef}'`)
    }
  }

  private requireMember(memberId: AgentTeamMemberId): AgentTeamAgentMember {
    const member = this.members.get(memberId)
    if (member === undefined) throw new Error(`unknown Agent Member '${memberId}'`)
    return member
  }

  private isFollowing(threadRef: AgentTeamThreadRef, memberId: AgentTeamMemberId): boolean {
    return this.follows.get(threadRef)?.has(memberId) ?? false
  }

  private isChannelMember(channelRef: AgentTeamChannelRef, memberId: AgentTeamMemberId): boolean {
    return this.memberships.get(channelRef)?.has(memberId) === true
  }

  private requireChannel(workspaceId: WorkspaceId, channelRef: AgentTeamChannelRef): AgentTeamChannel {
    const channel = this.channels.get(channelRef)
    if (channel === undefined) throw new Error(`unknown Channel ref '${channelRef}'`)
    if (channel.workspaceId !== workspaceId) {
      throw new Error(`Channel '${channelRef}' does not belong to Workspace '${workspaceId}'`)
    }
    return channel
  }

  private async setMemberState(
    request: AgentTeamAuthorizedSetMemberStateRequest,
    state: 'enabled' | 'suspended',
  ): Promise<AgentTeamLedgerResult<AgentTeamDurableMemberResult>> {
    return this.enqueue(async () => {
      const existing = this.byRequest.get(request.requestId)
      if (existing !== undefined) {
        this.assertSameMemberState(existing, request, state)
        return this.resolved(this.memberResult(existing))
      }
      this.assertHumanActor(request.actor)
      const member = this.members.get(request.memberId)
      if (member === undefined) throw new Error(`unknown Agent Member '${request.memberId}'`)
      const prior = state === 'suspended' ? 'enabled' : 'suspended'
      if (member.state !== prior) throw new Error(`Agent Member '${request.memberId}' is already ${member.state}`)
      const sequence = this.nextSequence()
      const next = Object.freeze({ ...member, state })
      const operation: AgentTeamMemberSuspendedOperation | AgentTeamMemberResumedOperation = state === 'suspended'
        ? Object.freeze({
            ...this.operationBase(request, sequence),
            kind: 'team/member-suspended',
            data: Object.freeze({ member: next }),
          })
        : Object.freeze({
            ...this.operationBase(request, sequence),
            kind: 'team/member-resumed',
            data: Object.freeze({ member: next }),
          })
      await this.table.put(operation.operationId, operation)
      this.commit(operation)
      this.members.set(next.memberId, next)
      this.confirmations.clear()
      return this.committed(this.memberResult(operation))
    })
  }

  private sameDelivery(left: AgentTeamDelivery, right: AgentTeamDelivery): boolean {
    return left.deliveryId === right.deliveryId
      && this.sameDeliverySource(left, right)
      && left.messageId === right.messageId
      && left.threadRef === right.threadRef
      && left.taskRef === right.taskRef
      && left.recipient === right.recipient
  }

  private sameDeliverySource(left: AgentTeamDelivery, right: AgentTeamDelivery): boolean {
    if (left.source.kind !== right.source.kind) return false
    return left.source.kind === 'message'
      ? right.source.kind === 'message' && left.source.messageRef === right.source.messageRef
      : right.source.kind === 'activity' && left.source.activityRef === right.source.activityRef
  }

  private sameMemberIdentity(left: AgentTeamAgentMember, right: AgentTeamAgentMember): boolean {
    return left.memberId === right.memberId
      && left.sessionId === right.sessionId
      && left.workspaceId === right.workspaceId
      && left.handle === right.handle
      && left.description === right.description
      && left.presetId === right.presetId
      && left.privateMemoryPath === right.privateMemoryPath
  }

  private assertHandleAvailable(workspaceId: WorkspaceId, handle: string): void {
    const normalized = this.normalizeHandle(handle)
    if ([...this.members.values()].some(member => member.workspaceId === workspaceId
      && this.normalizeHandle(member.handle) === normalized)) {
      throw new Error(`Agent Member handle '${handle}' is already active in Workspace '${workspaceId}'`)
    }
  }

  private normalizeHandle(handle: string): string {
    return handle.normalize('NFKC').trim().toLowerCase()
  }

  private normalizeDirection(direction: string): string {
    return direction.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase()
  }

  private sameClaimIdentity(left: AgentTeamClaim, right: AgentTeamClaim): boolean {
    return left.claimRef === right.claimRef && left.taskRef === right.taskRef
      && left.threadRef === right.threadRef && left.owner === right.owner
      && left.direction === right.direction && left.normalizedDirection === right.normalizedDirection
  }

  private deriveTaskStatus(taskRef: AgentTeamTaskRef, claims: Iterable<AgentTeamClaim>): AgentTeamTask['status'] {
    const relevant = [...claims].filter(claim => claim.taskRef === taskRef)
    if (relevant.some(claim => claim.state === 'active')) return 'in_progress'
    if (relevant.some(claim => claim.state === 'done')) return 'in_review'
    return 'todo'
  }

  private messageDeliveries(message: AgentTeamMessage, recipients: readonly AgentTeamMemberId[]): readonly AgentTeamDelivery[] {
    return Object.freeze(recipients.map(recipient => Object.freeze({
      deliveryId: this.ref('delivery'), source: Object.freeze({ kind: 'message' as const, messageRef: message.messageRef }),
      messageId: MessageId(`agent-team:${randomUUID()}`), threadRef: message.threadRef,
      taskRef: message.taskRef, recipient, state: 'queued' as const,
    })))
  }

  private activityDeliveries(activity: AgentTeamActivity, recipients: readonly AgentTeamMemberId[]): readonly AgentTeamDelivery[] {
    return Object.freeze(recipients.map(recipient => Object.freeze({
      deliveryId: this.ref('delivery'), source: Object.freeze({ kind: 'activity' as const, activityRef: activity.activityRef }),
      messageId: MessageId(`agent-team:${randomUUID()}`), threadRef: activity.threadRef,
      taskRef: activity.taskRef, recipient, state: 'queued' as const,
    })))
  }

  private invalidateThreadConfirmations(threadRef: AgentTeamThreadRef): void {
    for (const [token, confirmation] of this.confirmations) {
      if (confirmation.threadRef === threadRef) this.confirmations.delete(token)
    }
  }

  private projectMessage(operation: AgentTeamMessageSentOperation | AgentTeamThreadRepliedOperation): void {
    this.invalidateThreadConfirmations(operation.data.thread.threadRef)
    this.messages.push(operation.data.message)
    this.tasks.set(operation.data.task.taskRef, operation.data.task)
    this.threads.set(operation.data.thread.threadRef, operation.data.thread)
    this.follows.set(operation.data.thread.threadRef, new Set(operation.data.follows.map(follow => follow.memberId)))
    for (const delivery of operation.data.deliveries) this.deliveries.set(delivery.deliveryId, delivery)
  }

  private projectFollow(operation: AgentTeamFollowChangedOperation): void {
    this.invalidateThreadConfirmations(operation.data.thread.threadRef)
    const followers = new Set(this.follows.get(operation.data.thread.threadRef) ?? [])
    if (operation.data.follow.following) followers.add(operation.data.follow.memberId)
    else followers.delete(operation.data.follow.memberId)
    this.follows.set(operation.data.thread.threadRef, followers)
    this.activities.push(operation.data.activity)
    this.tasks.set(operation.data.task.taskRef, operation.data.task)
    this.threads.set(operation.data.thread.threadRef, operation.data.thread)
    for (const delivery of operation.data.deliveries) this.deliveries.set(delivery.deliveryId, delivery)
  }

  private projectClaim(operation: AgentTeamClaimChangedOperation): void {
    this.invalidateThreadConfirmations(operation.data.thread.threadRef)
    this.claims.set(operation.data.claim.claimRef, operation.data.claim)
    this.activities.push(operation.data.activity)
    this.tasks.set(operation.data.task.taskRef, operation.data.task)
    this.threads.set(operation.data.thread.threadRef, operation.data.thread)
    for (const delivery of operation.data.deliveries) this.deliveries.set(delivery.deliveryId, delivery)
  }

  private projectJoin(operation: AgentTeamChannelMemberAddedOperation): void {
    const members = this.memberships.get(operation.data.channelRef) ?? new Set<AgentTeamMemberId>()
    members.add(operation.data.memberId)
    this.memberships.set(operation.data.channelRef, members)
  }

  private joinResult(operation: AgentTeamChannelMemberAddedOperation): AgentTeamJoinChannelResult {
    return Object.freeze({
      receipt: this.receipt(operation),
      channelRef: operation.data.channelRef,
      memberId: operation.data.memberId,
    })
  }

  private channelResult(operation: AgentTeamChannelCreatedOperation): AgentTeamCreateChannelResult {
    return Object.freeze({ receipt: this.receipt(operation), channel: operation.data.channel })
  }

  private memberResult(
    operation: AgentTeamMemberAddedOperation | AgentTeamMemberSuspendedOperation | AgentTeamMemberResumedOperation,
  ): AgentTeamDurableMemberResult {
    const member = operation.data.member
    return Object.freeze({ receipt: this.receipt(operation), member })
  }

  private replyResult(operation: AgentTeamThreadRepliedOperation): AgentTeamReplyResult {
    return Object.freeze({ kind: 'committed', receipt: this.receipt(operation), message: operation.data.message,
      task: operation.data.task, thread: operation.data.thread, deliveries: operation.data.deliveries })
  }

  private followResult(operation: AgentTeamFollowChangedOperation): AgentTeamFollowResult {
    return Object.freeze({ receipt: this.receipt(operation), activity: operation.data.activity,
      follow: operation.data.follow, task: operation.data.task, thread: operation.data.thread,
      deliveries: operation.data.deliveries })
  }

  private claimResult(operation: AgentTeamClaimChangedOperation): AgentTeamClaimResult {
    return Object.freeze({ receipt: this.receipt(operation), activity: operation.data.activity,
      claim: operation.data.claim, task: operation.data.task, thread: operation.data.thread,
      deliveries: operation.data.deliveries })
  }

  private messageResult(operation: AgentTeamMessageSentOperation): AgentTeamSendMessageResult {
    return Object.freeze({
      receipt: this.receipt(operation),
      message: operation.data.message,
      task: operation.data.task,
      thread: operation.data.thread,
      follows: operation.data.follows,
      deliveries: operation.data.deliveries,
    })
  }

  private operationBase(
    request: { readonly requestId: AgentTeamRequestId; readonly actor: AgentTeamHumanActor | AgentTeamHostActor | AgentTeamMemberActor },
    sequence: number,
  ) {
    return {
      sequence,
      operationId: this.createOperationId(),
      requestId: request.requestId,
      occurredAt: this.createOccurredAt(),
      actor: Object.freeze({ ...request.actor }),
      previousOperationId: this.ordered.at(-1)?.operationId ?? null,
    }
  }

  private commit(operation: AgentTeamOperation): void {
    this.ordered.push(operation)
    this.byRequest.set(operation.requestId, operation)
  }

  private nextSequence(): number {
    if (this.ordered.length === 0) throw new Error('agent-team ledger is not initialized')
    return this.ordered.length + 1
  }

  private ref(kind: 'channel'): AgentTeamChannelRef
  private ref(kind: 'message'): AgentTeamMessageRef
  private ref(kind: 'task'): AgentTeamTaskRef
  private ref(kind: 'thread'): AgentTeamThreadRef
  private ref(kind: 'delivery'): AgentTeamDeliveryId
  private ref(kind: 'claim'): AgentTeamClaimRef
  private ref(kind: 'activity'): AgentTeamActivityRef
  private ref(kind: 'channel' | 'message' | 'task' | 'thread' | 'delivery' | 'claim' | 'activity') {
    return this.createRef(kind)
  }

  private addRef(refs: Set<string>, ref: string): void {
    if (refs.has(ref)) throw new Error(`agent-team ledger repeats entity ref '${ref}'`)
    refs.add(ref)
  }

  private sameActor(
    left: AgentTeamHumanActor | AgentTeamHostActor | AgentTeamMemberActor,
    right: AgentTeamHumanActor | AgentTeamHostActor | AgentTeamMemberActor,
  ): boolean {
    if (left.kind !== right.kind || left.handle !== right.handle) return false
    return left.kind === 'host' || (right.kind !== 'host' && left.memberId === right.memberId)
  }

  private sameList<T>(left: readonly T[], right: readonly T[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index])
  }

  private throwRequestCollision(requestId: AgentTeamRequestId): never {
    throw new Error(`agent-team request id '${requestId}' was reused with a different operation or payload`)
  }

  private receipt(operation: AgentTeamOperation): AgentTeamOperationReceipt {
    return Object.freeze({
      operationId: operation.operationId,
      requestId: operation.requestId,
      sequence: operation.sequence,
    })
  }

  private committed<T>(value: T): AgentTeamLedgerResult<T> {
    return Object.freeze({ value, committed: true })
  }

  private resolved<T>(value: T): AgentTeamLedgerResult<T> {
    return Object.freeze({ value, committed: false })
  }

  private sortedRecords(): Array<[AgentTeamOperationId, AgentTeamOperation]> {
    return [...this.table.entries()].sort((left, right) => left[1].sequence - right[1].sequence)
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationTail.then(operation)
    this.operationTail = result.then(() => {}, () => {})
    return result
  }
}
