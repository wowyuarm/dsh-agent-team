import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type {
  AgentTeamActivity,
  AgentTeamActivityMarker,
  AgentTeamActivityRef,
  AgentTeamAddMemberRequest,
  AgentTeamAttachmentId,
  AgentTeamAgentMember,
  AgentTeamChannel,
  AgentTeamChangeScope,
  AgentTeamChannelCreatedOperation,
  AgentTeamChannelMemberAddedOperation,
  AgentTeamChannelMemberRemovedOperation,
  AgentTeamChannelRef,
  AgentTeamChannelUpdatedOperation,
  AgentTeamClaim,
  AgentTeamClaimActivity,
  AgentTeamClaimsReleasedActivity,
  AgentTeamClaimChangedOperation,
  AgentTeamClaimList,
  AgentTeamClaimRequest,
  AgentTeamClaimResult,
  AgentTeamClaimRef,
  AgentTeamConfirmationRequired,
  AgentTeamConfirmationToken,
  AgentTeamCreateChannelRequest,
  AgentTeamCreateChannelResult,
  AgentTeamDirectMarker,
  AgentTeamHumanActor,
  AgentTeamInbox,
  AgentTeamInboxRequest,
  AgentTeamInboxDelta,
  AgentTeamInboxItem,
  AgentTeamInitializedOperation,
  AgentTeamJoinChannelRequest,
  AgentTeamJoinChannelResult,
  AgentTeamMemberActor,
  AgentTeamMemberAddedOperation,
  AgentTeamMemberId,
  AgentTeamMemberRemovedOperation,
  AgentTeamMemberResumedOperation,
  AgentTeamMemberSessionRestartedOperation,
  AgentTeamMemberSuspendedOperation,
  AgentTeamMemberUpdatedOperation,
  AgentTeamMessage,
  AgentTeamMessageRef,
  AgentTeamMessageSentOperation,
  AgentTeamOperation,
  AgentTeamOperationId,
  AgentTeamOperationReceipt,
  AgentTeamRemoveChannelMemberRequest,
  AgentTeamRemoveChannelMemberResult,
  AgentTeamRemoveMemberRequest,
  AgentTeamRemoveMemberResult,
  AgentTeamReplyRequest,
  AgentTeamReplyResult,
  AgentTeamRequestId,
  AgentTeamResolvedTaskRef,
  AgentTeamMessageAttachment,
  AgentTeamSendMessageRequest,
  AgentTeamSendMessageResult,
  AgentTeamSetMemberStateRequest,
  AgentTeamStaleRevision,
  AgentTeamStatus,
  AgentTeamStoredMessage,
  AgentTeamTask,
  AgentTeamTaskActivity,
  AgentTeamTaskChangedOperation,
  AgentTeamTaskRequest,
  AgentTeamTaskResult,
  AgentTeamTaskRef,
  AgentTeamThread,
  AgentTeamThreadAttention,
  AgentTeamThreadAttentionChangedOperation,
  AgentTeamThreadAttentionKey,
  AgentTeamThreadAttentionRequest,
  AgentTeamThreadAttentionResult,
  AgentTeamThreadAttentionStatus,
  AgentTeamThreadFact,
  AgentTeamThreadHistory,
  AgentTeamThreadHistoryRequest,
  AgentTeamThreadReadFact,
  AgentTeamThreadReadOperation,
  AgentTeamThreadReadRequest,
  AgentTeamThreadReadResult,
  AgentTeamThreadAttentionObservation,
  AgentTeamThreadObservations,
  AgentTeamThreadObservationsRequest,
  AgentTeamThreadRef,
  AgentTeamThreadRepliedOperation,
  AgentTeamUnreadRequired,
  AgentTeamUpdateChannelRequest,
  AgentTeamUpdateChannelResult,
  AgentTeamUpdateMemberRequest,
  AgentTeamView,
  AgentTeamViewRequest,
} from './types.ts'

/** Stable Human Member identity shared by every replay of one dshHome Team. */
export const AGENT_TEAM_HUMAN_MEMBER_ID = 'member:human' as AgentTeamMemberId

/** Idempotency identity of the one Host bootstrap operation. */
export const AGENT_TEAM_INITIALIZE_REQUEST_ID = 'agent-team:initialize:v1' as AgentTeamRequestId

const HUMAN_ACTOR: AgentTeamHumanActor = Object.freeze({
  kind: 'human',
  memberId: AGENT_TEAM_HUMAN_MEMBER_ID,
  handle: 'human',
})

/** Resolve the one Human authority owned by this Team. */
export function agentTeamHumanActor(): AgentTeamHumanActor {
  return HUMAN_ACTOR
}

/** Caller-owned payload of the idempotent Team initialization request. */
export interface AgentTeamInitializeRequest {
  readonly requestId: AgentTeamRequestId
  readonly actor: AgentTeamHumanActor
  readonly humanMemberId: AgentTeamMemberId
}

export interface AgentTeamAuthorizedCreateChannelRequest extends AgentTeamCreateChannelRequest {
  readonly actor: AgentTeamHumanActor
}

export interface AgentTeamAuthorizedAddMemberRequest extends AgentTeamAddMemberRequest {
  readonly actor: AgentTeamHumanActor
  readonly member: AgentTeamAgentMember
}

export interface AgentTeamAuthorizedSetMemberStateRequest extends AgentTeamSetMemberStateRequest {
  readonly actor: AgentTeamHumanActor
}

export interface AgentTeamAuthorizedJoinChannelRequest extends AgentTeamJoinChannelRequest {
  readonly actor: AgentTeamHumanActor
}

export interface AgentTeamAuthorizedRemoveChannelMemberRequest extends AgentTeamRemoveChannelMemberRequest {
  readonly actor: AgentTeamHumanActor
}

export interface AgentTeamAuthorizedSendMessageRequest extends AgentTeamSendMessageRequest {
  readonly actor: AgentTeamHumanActor | AgentTeamMemberActor
  /** Metadata the Host resolved from the attachment cache before the append. */
  readonly resolvedAttachments?: readonly AgentTeamMessageAttachment[] | undefined
}

export interface AgentTeamAuthorizedReplyRequest extends AgentTeamReplyRequest {
  readonly actor: AgentTeamHumanActor | AgentTeamMemberActor
  /** Metadata the Host resolved from the attachment cache before the append. */
  readonly resolvedAttachments?: readonly AgentTeamMessageAttachment[] | undefined
}

export interface AgentTeamAuthorizedClaimRequest extends AgentTeamClaimRequest {
  readonly actor: AgentTeamHumanActor | AgentTeamMemberActor
}

export interface AgentTeamAuthorizedTaskRequest extends AgentTeamTaskRequest {
  readonly actor: AgentTeamHumanActor
}

export interface AgentTeamAuthorizedThreadAttentionRequest extends AgentTeamThreadAttentionRequest {
  readonly actor: AgentTeamHumanActor | AgentTeamMemberActor
}

export interface AgentTeamAuthorizedThreadReadRequest extends AgentTeamThreadReadRequest {
  readonly actor: AgentTeamHumanActor | AgentTeamMemberActor
}

export interface AgentTeamAuthorizedRemoveMemberRequest extends AgentTeamRemoveMemberRequest {
  readonly actor: AgentTeamHumanActor
}

export interface AgentTeamAuthorizedUpdateChannelRequest extends AgentTeamUpdateChannelRequest {
  readonly actor: AgentTeamHumanActor
}

export interface AgentTeamAuthorizedUpdateMemberRequest extends AgentTeamUpdateMemberRequest {
  readonly actor: AgentTeamHumanActor
}

/** Construction hooks used to make durable operation creation deterministic in tests. */
export interface AgentTeamLedgerOptions {
  readonly operationId?: () => AgentTeamOperationId
  readonly occurredAt?: () => string
  readonly ref?: (kind: 'channel' | 'message' | 'task' | 'thread' | 'claim' | 'activity') => string
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

interface Confirmation {
  readonly actor: AgentTeamMemberId
  readonly workspaceId: WorkspaceId
  readonly channelRef: AgentTeamChannelRef
  readonly taskRef?: AgentTeamTaskRef
  readonly threadRef?: AgentTeamThreadRef
  readonly body: string
  readonly recipients: readonly AgentTeamMemberId[]
  /** Whether each recipient was following when confirmation was issued. */
  readonly attention: readonly boolean[]
  readonly memberStates: readonly AgentTeamAgentMember['state'][]
}

interface PreparedRead {
  readonly task: AgentTeamTask
  readonly thread: AgentTeamThread
  readonly claims: readonly AgentTeamClaim[]
  readonly anchor: AgentTeamMessage
  readonly anchorMentions: readonly AgentTeamMemberId[]
  readonly facts: readonly AgentTeamThreadReadFact[]
  readonly readThroughSequence: number
  readonly remainingUnreadCount: number
  readonly attention?: AgentTeamThreadAttention
  readonly consumedDirectMarkers: readonly AgentTeamDirectMarker[]
  readonly inbox: AgentTeamInboxDelta
}

interface Projection {
  readonly byRequest: Map<AgentTeamRequestId, AgentTeamOperation>
  readonly byOperation: Map<AgentTeamOperationId, AgentTeamOperation>
  readonly ordered: AgentTeamOperation[]
  readonly channels: Map<AgentTeamChannelRef, AgentTeamChannel>
  readonly members: Map<AgentTeamMemberId, AgentTeamAgentMember>
  readonly memberships: Map<AgentTeamChannelRef, Set<AgentTeamMemberId>>
  readonly claims: Map<AgentTeamClaimRef, AgentTeamClaim>
  readonly messages: AgentTeamMessage[]
  readonly tasks: Map<AgentTeamTaskRef, AgentTeamTask>
  readonly threads: Map<AgentTeamThreadRef, AgentTeamThread>
  readonly attention: Map<string, AgentTeamThreadAttention>
  readonly directMarkers: Map<string, AgentTeamDirectMarker>
  readonly activityMarkers: Map<string, AgentTeamActivityMarker>
  /** Derived read indexes; rebuilt by replay, never a second durable authority. */
  readonly orderedFacts: AgentTeamThreadFact[]
  readonly factsByThread: Map<AgentTeamThreadRef, AgentTeamThreadFact[]>
  readonly topLevelMessages: AgentTeamMessage[]
  /** Structured mention refs per Message, derived from the originating send operations. */
  readonly mentionsByMessage: Map<AgentTeamMessageRef, readonly AgentTeamMemberId[]>
  readonly messageCountByThread: Map<AgentTeamThreadRef, number>
  readonly attentionByThread: Map<AgentTeamThreadRef, Set<AgentTeamMemberId>>
}

function emptyProjection(): Projection {
  return { byRequest: new Map(), byOperation: new Map(), ordered: [], channels: new Map(), members: new Map(), memberships: new Map(),
    claims: new Map(), messages: [], tasks: new Map(), threads: new Map(), attention: new Map(), directMarkers: new Map(), activityMarkers: new Map(),
    orderedFacts: [], factsByThread: new Map(), topLevelMessages: [], mentionsByMessage: new Map(), messageCountByThread: new Map(),
    attentionByThread: new Map() }
}

/** Replay and append logic behind the Agent Team service interface. */
export class AgentTeamLedger {
  /** Live projection; record validation replays build independent Projection values instead. */
  private readonly state: Projection = emptyProjection()
  private readonly confirmations = new Map<AgentTeamConfirmationToken, Confirmation>()
  private readonly createOperationId: () => AgentTeamOperationId
  private readonly createOccurredAt: () => string
  private readonly createRef: (kind: 'channel' | 'message' | 'task' | 'thread' | 'claim' | 'activity') => string
  private operationTail: Promise<void> = Promise.resolve()

  constructor(
    private readonly table: KvTable<AgentTeamOperationId, AgentTeamOperation>,
    options: AgentTeamLedgerOptions = {},
  ) {
    this.createOperationId = options.operationId ?? (() => `operation:${randomUUID()}` as AgentTeamOperationId)
    this.createOccurredAt = options.occurredAt ?? (() => new Date().toISOString())
    this.createRef = options.ref ?? (kind => `${kind}:${randomUUID()}`)
    this.replay()
  }

  initialize(request: AgentTeamInitializeRequest = {
    requestId: AGENT_TEAM_INITIALIZE_REQUEST_ID,
    actor: HUMAN_ACTOR,
    humanMemberId: AGENT_TEAM_HUMAN_MEMBER_ID,
  }): Promise<AgentTeamLedgerResult<AgentTeamOperationReceipt>> {
    return this.enqueue(async () => {
      const existing = this.state.byRequest.get(request.requestId)
      if (existing !== undefined) {
        this.assertSameInitialization(existing, request)
        return this.resolved(this.receipt(existing))
      }
      if (this.state.ordered.length !== 0) throw new Error('agent-team ledger has operations but no initialization request')
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
      this.apply(operation)
      return this.committed(this.receipt(operation))
    })
  }

  createChannel(request: AgentTeamAuthorizedCreateChannelRequest): Promise<AgentTeamLedgerResult<AgentTeamCreateChannelResult>> {
    return this.enqueue(async () => {
      const existing = this.state.byRequest.get(request.requestId)
      if (existing !== undefined) {
        this.assertSameChannelCreation(existing, request, this.normalizeUnique(request.memberIds, 'initial Channel members'))
        return this.resolved(this.channelResult(existing))
      }
      this.assertHumanActor(request.actor)
      const name = request.name.trim()
      const description = request.description.trim()
      if (name === '') throw new Error('channel name must not be empty')
      const memberIds = this.normalizeUnique(request.memberIds, 'initial Channel members')
      for (const memberId of memberIds) this.assertJoinableMember(request.workspaceId, memberId)
      const sequence = this.nextSequence()
      const channel: AgentTeamChannel = Object.freeze({
        channelRef: this.ref('channel'), workspaceId: request.workspaceId, name, description, createdAtSequence: sequence,
      })
      const operation: AgentTeamChannelCreatedOperation = Object.freeze({
        ...this.operationBase(request, sequence), kind: 'team/channel-created',
        data: Object.freeze({ workspaceId: request.workspaceId, channel, memberIds }),
      })
      await this.table.put(operation.operationId, operation)
      this.apply(operation)
      return this.committed(this.channelResult(operation))
    })
  }

  /** Human rename of one Channel's display facts; identity refs are immutable. */
  updateChannel(request: AgentTeamAuthorizedUpdateChannelRequest): Promise<AgentTeamLedgerResult<AgentTeamUpdateChannelResult>> {
    return this.enqueue(async () => {
      const existing = this.state.byRequest.get(request.requestId)
      if (existing !== undefined) {
        this.assertSameChannelUpdate(existing, request)
        return this.resolved(this.channelUpdateResult(existing))
      }
      this.assertHumanActor(request.actor)
      const name = request.name.trim()
      const description = request.description.trim()
      if (name === '') throw new Error('channel name must not be empty')
      const channel = Object.freeze({ ...this.requireChannel(request.workspaceId, request.channelRef), name, description })
      const operation: AgentTeamChannelUpdatedOperation = Object.freeze({
        ...this.operationBase(request, this.nextSequence()), kind: 'team/channel-updated',
        data: Object.freeze({ workspaceId: request.workspaceId, channel }),
      })
      await this.table.put(operation.operationId, operation)
      this.apply(operation)
      return this.committed(this.channelUpdateResult(operation))
    })
  }

  addMember(request: AgentTeamAuthorizedAddMemberRequest): Promise<AgentTeamLedgerResult<AgentTeamDurableMemberResult>> {
    return this.enqueue(async () => {
      const existing = this.state.byRequest.get(request.requestId)
      if (existing !== undefined) {
        this.assertSameMemberAdd(existing, request)
        return this.resolved(this.memberResult(existing))
      }
      this.assertHumanActor(request.actor)
      const handle = request.handle.trim()
      const description = request.description.trim()
      const presetId = request.presetId.trim()
      if (handle === '') throw new Error('member handle must not be empty')
      if (presetId === '') throw new Error('member preset must not be empty')
      // Description and initial Channels are optional: a Member with neither is
      // still drivable through its DM view, and joins Channels later.
      const channelRefs = this.normalizeUnique(request.channelRefs, 'initial Member Channels')
      for (const channelRef of channelRefs) this.requireChannel(request.workspaceId, channelRef)
      this.assertHandleAvailable(request.workspaceId, handle)
      this.assertModelSelection(request.member.model)
      const member = Object.freeze({
        ...request.member, handle, description, presetId, state: 'enabled' as const,
        ...(request.member.model === undefined ? {} : { model: Object.freeze({ ...request.member.model }) }),
      })
      const operation: AgentTeamMemberAddedOperation = Object.freeze({
        ...this.operationBase(request, this.nextSequence()), kind: 'team/member-added',
        data: Object.freeze({ member, channelRefs }),
      })
      await this.table.put(operation.operationId, operation)
      this.apply(operation)
      return this.committed(this.memberResult(operation))
    })
  }

  /** Human edit of one Member's mutable facts; identity, preset, and lifecycle state are preserved. */
  updateMember(request: AgentTeamAuthorizedUpdateMemberRequest): Promise<AgentTeamLedgerResult<AgentTeamDurableMemberResult>> {
    return this.enqueue(async () => {
      const existing = this.state.byRequest.get(request.requestId)
      if (existing !== undefined) {
        this.assertSameMemberUpdate(existing, request)
        return this.resolved(this.memberResult(existing))
      }
      this.assertHumanActor(request.actor)
      const prior = this.requireMember(request.memberId)
      if (prior.state === 'inactive') throw new Error(`Agent Member '${prior.memberId}' is inactive and can no longer be edited`)
      const handle = request.handle.trim()
      const description = request.description.trim()
      if (handle === '') throw new Error('member handle must not be empty')
      if (handle !== prior.handle) this.assertHandleAvailable(prior.workspaceId, handle, prior.memberId)
      this.assertModelSelection(request.model)
      // An absent model must CLEAR any override (inherit the Host default);
      // spreading `prior` verbatim would silently keep the pinned selection.
      const { model: _priorModel, ...priorWithoutModel } = prior
      const member = Object.freeze({
        ...priorWithoutModel, handle, description,
        ...(request.model === undefined ? {} : { model: Object.freeze({ ...request.model }) }),
      })
      const operation: AgentTeamMemberUpdatedOperation = Object.freeze({
        ...this.operationBase(request, this.nextSequence()), kind: 'team/member-updated',
        data: Object.freeze({ member }),
      })
      await this.table.put(operation.operationId, operation)
      this.apply(operation)
      return this.committed(this.memberResult(operation))
    })
  }

  suspendMember(request: AgentTeamAuthorizedSetMemberStateRequest): Promise<AgentTeamLedgerResult<AgentTeamDurableMemberResult>> {
    return this.setMemberState(request, 'suspended')
  }

  resumeMember(request: AgentTeamAuthorizedSetMemberStateRequest): Promise<AgentTeamLedgerResult<AgentTeamDurableMemberResult>> {
    return this.setMemberState(request, 'enabled')
  }

  getMember(memberId: AgentTeamMemberId): AgentTeamAgentMember | undefined {
    return this.state.members.get(memberId)
  }

  listMembers(): readonly AgentTeamAgentMember[] {
    return Object.freeze([...this.state.members.values()])
  }

  joinChannel(request: AgentTeamAuthorizedJoinChannelRequest): Promise<AgentTeamLedgerResult<AgentTeamJoinChannelResult>> {
    return this.enqueue(async () => {
      const existing = this.state.byRequest.get(request.requestId)
      if (existing !== undefined) {
        this.assertSameChannelJoin(existing, request)
        return this.resolved(this.joinResult(existing))
      }
      this.assertHumanActor(request.actor)
      const channel = this.requireChannel(request.workspaceId, request.channelRef)
      const member = this.requireMember(request.memberId)
      if (member.workspaceId !== request.workspaceId) throw new Error('Member and Channel must belong to one Workspace')
      if (member.state !== 'enabled') throw new Error(`Agent Member '${member.memberId}' is ${member.state}; only enabled Members can join a Channel`)
      if (this.isChannelMember(channel.channelRef, member.memberId)) throw new Error(`Agent Member '${member.memberId}' already belongs to Channel '${channel.channelRef}'`)
      const operation: AgentTeamChannelMemberAddedOperation = Object.freeze({
        ...this.operationBase(request, this.nextSequence()), kind: 'team/channel-member-added',
        data: Object.freeze({ workspaceId: request.workspaceId, channelRef: channel.channelRef, memberId: member.memberId }),
      })
      await this.table.put(operation.operationId, operation)
      this.apply(operation)
      return this.committed(this.joinResult(operation))
    })
  }

  removeChannelMember(
    request: AgentTeamAuthorizedRemoveChannelMemberRequest,
  ): Promise<AgentTeamLedgerResult<AgentTeamRemoveChannelMemberResult>> {
    return this.enqueue(async () => {
      const existing = this.state.byRequest.get(request.requestId)
      if (existing !== undefined) {
        this.assertSameChannelMemberRemoval(existing, request)
        return this.resolved(this.channelMemberRemovalResult(existing))
      }
      this.assertHumanActor(request.actor)
      const channel = this.requireChannel(request.workspaceId, request.channelRef)
      const member = this.requireMember(request.memberId)
      if (member.workspaceId !== channel.workspaceId || !this.isChannelMember(channel.channelRef, member.memberId)) {
        throw new Error(`Agent Member '${member.memberId}' is not a member of Channel '${channel.channelRef}'`)
      }
      const threadRefs = this.channelThreadRefs(channel.channelRef)
      const releasedClaims = [...this.state.claims.values()]
        .filter(claim => claim.owner === member.memberId && claim.state === 'active' && threadRefs.has(claim.threadRef))
        .map(claim => Object.freeze({ ...claim, state: 'released' as const }))
      const nextClaims = new Map(this.state.claims)
      for (const claim of releasedClaims) nextClaims.set(claim.claimRef, claim)
      const sequence = this.nextSequence()
      const activities = this.releaseSummaries(releasedClaims, member.memberId, sequence)
      const threads = this.threadsForActivities(activities)
      const tasks = this.tasksForClaims(releasedClaims, nextClaims)
      const inbox = this.removeMemberThreadInbox(member.memberId, threadRefs)
      const operation: AgentTeamChannelMemberRemovedOperation = Object.freeze({
        ...this.operationBase(request, sequence), kind: 'team/channel-member-removed',
        data: Object.freeze({ workspaceId: request.workspaceId, channelRef: channel.channelRef, memberId: member.memberId,
          claims: Object.freeze(releasedClaims), activities, tasks, threads, inbox }),
      })
      await this.table.put(operation.operationId, operation)
      this.apply(operation)
      return this.committed(this.channelMemberRemovalResult(operation))
    })
  }

  sendMessage(request: AgentTeamAuthorizedSendMessageRequest): Promise<AgentTeamLedgerResult<AgentTeamSendMessageResult>> {
    return this.enqueue(async () => {
      const recipients = this.normalizeRecipients(request.actor, request.recipients)
      const existing = this.state.byRequest.get(request.requestId)
      if (existing !== undefined) {
        this.assertSameMessage(existing, request, recipients)
        return this.resolved(this.messageResult(existing))
      }
      const actor = this.assertActorForWorkspace(request.actor, request.workspaceId)
      const channel = this.requireChannel(request.workspaceId, request.channelRef)
      if (actor.kind === 'member') this.requireMemberChannel(this.requireMember(actor.memberId), channel.channelRef)
      const body = request.body.trim()
      if (body === '') throw new Error('message body must not be empty')
      this.assertMentionTargets(channel, recipients)
      // Top-level Task creation is open to every actor: mentioned Members join
      // the new Thread as followers. Only existing-Thread invitations stay
      // Human-gated (reply path).
      const sequence = this.nextSequence()
      const base = this.operationBase(request, sequence)
      const taskRef = this.ref('task')
      const threadRef = this.ref('thread')
      const task: AgentTeamTask = Object.freeze({ taskRef, channelRef: channel.channelRef, threadRef, status: 'todo', resolution: 'open' })
      const thread: AgentTeamThread = Object.freeze({ threadRef, taskRef, revision: sequence })
      const message: AgentTeamMessage = Object.freeze({
        messageRef: this.ref('message'), channelRef: channel.channelRef, threadRef, taskRef,
        sender: request.actor.memberId, body,
        ...(request.resolvedAttachments === undefined ? {} : { attachments: request.resolvedAttachments }),
        topLevel: true, sequence, occurredAt: base.occurredAt,
      })
      const started = [this.startAttention(request.actor.memberId, threadRef, sequence),
        ...recipients.filter(memberId => this.state.members.has(memberId))
          .map(memberId => this.startAttention(memberId, threadRef, sequence))]
      const inbox = this.messageInboxDelta(message, request.actor.memberId, recipients, started)
      const operation: AgentTeamMessageSentOperation = Object.freeze({
        ...base, kind: 'team/message-sent',
        data: Object.freeze({ workspaceId: request.workspaceId, mentions: recipients, message, task, thread, inbox }),
      })
      await this.table.put(operation.operationId, operation)
      this.apply(operation)
      return this.committed(this.messageResult(operation))
    })
  }

  reply(request: AgentTeamAuthorizedReplyRequest): Promise<AgentTeamLedgerResult<AgentTeamReplyResult>> {
    return this.enqueue(async () => {
      const recipients = this.normalizeRecipients(request.actor, request.recipients)
      const existing = this.state.byRequest.get(request.requestId)
      if (existing !== undefined) {
        this.assertSameReply(existing, request, recipients)
        return this.resolved(this.replyResult(existing))
      }
      const actor = this.assertActorForWorkspace(request.actor, request.workspaceId)
      const task = this.requireTask(request.workspaceId, request.taskRef)
      const thread = this.requireThread(task.threadRef)
      if (actor.kind === 'member') this.requireMemberChannel(this.requireMember(actor.memberId), task.channelRef)
      const body = request.body.trim()
      if (body === '') throw new Error('message body must not be empty')
      this.assertMentionTargets(this.requireChannel(request.workspaceId, task.channelRef), recipients)
      const unread = this.unreadFor(actor.memberId, thread.threadRef)
      if (unread.length > 0) return this.resolved(this.unreadRequired(task, thread, unread))
      if (request.baseRevision !== thread.revision) return this.resolved(this.staleRevision(task, thread, request.baseRevision))
      if (task.resolution === 'closed') throw new Error(`Task '${task.taskRef}' is closed; reopen it before replying`)
      const unfollowedAgents = recipients.filter(memberId => this.state.members.has(memberId) && !this.isFollowing(thread.threadRef, memberId))
      if (unfollowedAgents.length > 0 && actor.kind === 'member') {
        return this.resolved(this.memberNotFollowing(request.workspaceId, task.channelRef, unfollowedAgents, task, thread))
      }
      if (unfollowedAgents.length > 0 && request.confirmationToken === undefined) {
        return this.resolved(this.issueConfirmation(request.actor, request.workspaceId, task.channelRef, body, recipients, task, thread))
      }
      if (request.confirmationToken !== undefined) {
        this.consumeConfirmation(request.confirmationToken, request.actor, request.workspaceId, task.channelRef,
          task, thread, body, recipients)
      }
      const sequence = this.nextSequence()
      const base = this.operationBase(request, sequence)
      const message: AgentTeamMessage = Object.freeze({
        messageRef: this.ref('message'), channelRef: task.channelRef, threadRef: task.threadRef,
        taskRef: task.taskRef, sender: request.actor.memberId, body,
        ...(request.resolvedAttachments === undefined ? {} : { attachments: request.resolvedAttachments }),
        topLevel: false, sequence, occurredAt: base.occurredAt,
      })
      const nextThread: AgentTeamThread = Object.freeze({ ...thread, revision: sequence })
      const started = unfollowedAgents.map(memberId => this.startAttention(memberId, thread.threadRef, sequence))
      const inbox = this.messageInboxDelta(message, request.actor.memberId, recipients, started)
      const operation: AgentTeamThreadRepliedOperation = Object.freeze({
        ...base, kind: 'team/thread-replied',
        data: Object.freeze({ workspaceId: request.workspaceId, baseRevision: request.baseRevision,
          mentions: recipients, message, task, thread: nextThread, inbox }),
      })
      await this.table.put(operation.operationId, operation)
      this.apply(operation)
      return this.committed(this.replyResult(operation))
    })
  }

  changeClaim(request: AgentTeamAuthorizedClaimRequest): Promise<AgentTeamLedgerResult<AgentTeamClaimResult>> {
    return this.enqueue(async () => {
      const existing = this.state.byRequest.get(request.requestId)
      if (existing !== undefined) {
        this.assertSameClaim(existing, request)
        return this.resolved(this.claimResult(existing))
      }
      const actor = this.assertActorForWorkspace(request.actor, request.workspaceId)
      const task = this.requireTask(request.workspaceId, request.taskRef)
      const thread = this.requireThread(task.threadRef)
      if (actor.kind === 'member') this.requireMemberChannel(this.requireMember(actor.memberId), task.channelRef)
      const unread = this.unreadFor(actor.memberId, thread.threadRef)
      if (unread.length > 0) return this.resolved(this.unreadRequired(task, thread, unread))
      if (request.baseRevision !== thread.revision) return this.resolved(this.staleRevision(task, thread, request.baseRevision))
      if (task.resolution !== 'open') throw new Error(`Task '${task.taskRef}' is ${task.status}; reopen it before changing Claims`)
      if (actor.kind !== 'member') throw new Error('Human cannot change an Agent Claim')
      let claim: AgentTeamClaim
      let kind: AgentTeamClaimChangedOperation['kind']
      let activityKind: AgentTeamClaimActivity['kind']
      if (request.action === 'claim') {
        if (request.claimRef !== undefined) throw new Error('claim action does not accept claimRef')
        const direction = request.direction?.trim() ?? ''
        const normalizedDirection = this.normalizeDirection(direction)
        if (normalizedDirection === '') throw new Error('claim direction must not be empty')
        if ([...this.state.claims.values()].some(candidate => candidate.taskRef === task.taskRef
          && candidate.state === 'active' && candidate.normalizedDirection === normalizedDirection)) {
          throw new Error(`Direction '${direction}' already has an active Claim`)
        }
        claim = Object.freeze({ claimRef: this.ref('claim'), taskRef: task.taskRef, threadRef: task.threadRef,
          owner: actor.memberId, direction, normalizedDirection, state: 'active' })
        kind = 'team/claim-created'
        activityKind = 'claim'
      } else {
        if (request.direction !== undefined) throw new Error(`${request.action} action does not accept direction`)
        const previous = request.claimRef === undefined ? undefined : this.state.claims.get(request.claimRef)
        if (previous === undefined) {
          throw new Error(`unknown Claim '${request.claimRef ?? ''}'${request.claimRef === undefined ? '' : this.unknownRefHint(request.claimRef, 'claim', 'Claim')}`)
        }
        if (previous.taskRef !== task.taskRef || previous.owner !== actor.memberId) {
          throw new Error('Member can modify only its own Claim on this Task')
        }
        if (previous.state !== 'active') throw new Error(`Claim '${previous.claimRef}' is already ${previous.state}`)
        claim = Object.freeze({ ...previous, state: request.action === 'done' ? 'done' : 'released' })
        kind = request.action === 'done' ? 'team/claim-done' : 'team/claim-released'
        activityKind = request.action
      }
      const sequence = this.nextSequence()
      const projected = new Map(this.state.claims).set(claim.claimRef, claim)
      const nextTask: AgentTeamTask = Object.freeze({ ...task, status: this.deriveTaskStatus(task.taskRef, projected.values()) })
      const nextThread: AgentTeamThread = Object.freeze({ ...thread, revision: sequence })
      const activity: AgentTeamClaimActivity = Object.freeze({
        activityRef: this.ref('activity'), kind: activityKind, taskRef: task.taskRef,
        threadRef: task.threadRef, actor: actor.memberId, claimRef: claim.claimRef, sequence,
      })
      const ownAttention = request.action === 'claim' && actor.kind === 'member' && !this.isFollowing(thread.threadRef, actor.memberId)
        ? [this.startAttention(actor.memberId, thread.threadRef, sequence)] : []
      const inbox = this.inboxDelta(ownAttention)
      const operation: AgentTeamClaimChangedOperation = Object.freeze({
        ...this.operationBase(request, sequence), kind,
        data: Object.freeze({ workspaceId: request.workspaceId, baseRevision: request.baseRevision,
          activity, claim, task: nextTask, thread: nextThread, inbox }),
      }) as AgentTeamClaimChangedOperation
      await this.table.put(operation.operationId, operation)
      this.apply(operation)
      return this.committed(this.claimResult(operation))
    })
  }

  changeTask(request: AgentTeamAuthorizedTaskRequest): Promise<AgentTeamLedgerResult<AgentTeamTaskResult>> {
    return this.enqueue(async () => {
      const existing = this.state.byRequest.get(request.requestId)
      if (existing !== undefined) {
        this.assertSameTask(existing, request)
        return this.resolved(this.taskResult(existing))
      }
      this.assertHumanActor(request.actor)
      const task = this.requireTask(request.workspaceId, request.taskRef)
      const thread = this.requireThread(task.threadRef)
      const unread = this.unreadFor(request.actor.memberId, thread.threadRef)
      if (unread.length > 0) return this.resolved(this.unreadRequired(task, thread, unread))
      if (request.baseRevision !== thread.revision) return this.resolved(this.staleRevision(task, thread, request.baseRevision))
      if (request.action === 'accept' && task.resolution !== 'open') throw new Error(`Task '${task.taskRef}' is already ${task.resolution}`)
      if (request.action === 'close' && task.resolution === 'closed') throw new Error(`Task '${task.taskRef}' is already closed`)
      // Acceptance normally waits for every Claim to finish (in_review);
      // a Human may also accept early while work is in progress, which then
      // completes the still-active Claims inside the same atomic operation.
      if (request.action === 'accept' && task.status !== 'in_review' && task.status !== 'in_progress') {
        throw new Error(`Task '${task.taskRef}' must be in_review or in_progress before acceptance`)
      }
      const priorActiveClaims = [...this.state.claims.values()].filter(claim => claim.taskRef === task.taskRef && claim.state === 'active')
      if (request.action === 'accept' && task.status === 'in_progress' && priorActiveClaims.length === 0) {
        throw new Error(`Task '${task.taskRef}' has no active Claims to complete for early acceptance`)
      }
      if (request.action === 'reopen' && task.resolution === 'open') throw new Error(`Task '${task.taskRef}' is already open`)
      const sequence = this.nextSequence()
      const claims = [...this.state.claims.values()].filter(claim => claim.taskRef === task.taskRef).map(claim =>
        request.action === 'close' && claim.state === 'active' ? Object.freeze({ ...claim, state: 'released' as const })
          : request.action === 'accept' && claim.state === 'active' ? Object.freeze({ ...claim, state: 'done' as const })
            : claim)
      const releasedClaims = claims.filter(claim => claim.state === 'released' && this.state.claims.get(claim.claimRef)?.state === 'active')
      const completedClaims = claims.filter(claim => claim.state === 'done' && this.state.claims.get(claim.claimRef)?.state === 'active')
      const resolution = request.action === 'reopen' ? 'open' as const : request.action === 'accept' ? 'accepted' as const : 'closed' as const
      const status = resolution === 'accepted' ? 'done' as const : resolution === 'closed' ? 'closed' as const
        : this.deriveTaskStatus(task.taskRef, claims)
      const nextTask: AgentTeamTask = Object.freeze({ ...task, resolution, status })
      const nextThread: AgentTeamThread = Object.freeze({ ...thread, revision: sequence })
      const activity: AgentTeamTaskActivity = Object.freeze({ activityRef: this.ref('activity'), kind: request.action,
        taskRef: task.taskRef, threadRef: task.threadRef, actor: request.actor.memberId, sequence,
        ...(releasedClaims.length === 0 ? {} : { releasedClaimRefs: Object.freeze(releasedClaims.map(claim => claim.claimRef)) }),
        ...(completedClaims.length === 0 ? {} : { completedClaimRefs: Object.freeze(completedClaims.map(claim => claim.claimRef)) }) })
      const inbox = request.action === 'close'
        ? this.closeThreadInbox(activity, thread.threadRef)
        : request.action === 'reopen'
          ? this.reopenThreadInbox(activity, thread.threadRef)
          : this.acceptThreadInbox(activity, thread.threadRef, completedClaims.map(claim => claim.owner))
      const operation: AgentTeamTaskChangedOperation = Object.freeze({
        ...this.operationBase(request, sequence), kind: 'team/task-changed',
        data: Object.freeze({ workspaceId: request.workspaceId, baseRevision: request.baseRevision,
          activity, task: nextTask, thread: nextThread, claims: Object.freeze(claims), inbox }),
      })
      await this.table.put(operation.operationId, operation)
      this.apply(operation)
      return this.committed(this.taskResult(operation))
    })
  }

  removeMember(request: AgentTeamAuthorizedRemoveMemberRequest): Promise<AgentTeamLedgerResult<AgentTeamRemoveMemberResult>> {
    return this.enqueue(async () => {
      const existing = this.state.byRequest.get(request.requestId)
      if (existing !== undefined) {
        this.assertSameRemoval(existing, request)
        return this.resolved(this.removalResult(existing))
      }
      this.assertHumanActor(request.actor)
      const member = this.requireMember(request.memberId)
      if (member.state === 'inactive') throw new Error(`Agent Member '${member.memberId}' is already inactive`)
      const nextMember = Object.freeze({ ...member, state: 'inactive' as const })
      const releasedClaims = [...this.state.claims.values()].filter(claim => claim.owner === member.memberId && claim.state === 'active')
        .map(claim => Object.freeze({ ...claim, state: 'released' as const }))
      const projectedClaims = new Map(this.state.claims)
      for (const claim of releasedClaims) projectedClaims.set(claim.claimRef, claim)
      const sequence = this.nextSequence()
      const activities = this.releaseSummaries(releasedClaims, member.memberId, sequence)
      const threads = this.threadsForActivities(activities)
      const tasks = this.tasksForClaims(releasedClaims, projectedClaims)
      const threadRefs = new Set([...this.state.tasks.values()].map(task => task.threadRef))
      const inbox = this.removeMemberThreadInbox(member.memberId, threadRefs)
      const operation: AgentTeamMemberRemovedOperation = Object.freeze({
        ...this.operationBase(request, sequence), kind: 'team/member-removed',
        data: Object.freeze({ member: nextMember, claims: Object.freeze(releasedClaims), activities, tasks, threads, inbox }),
      })
      await this.table.put(operation.operationId, operation)
      this.apply(operation)
      this.confirmations.clear()
      return this.committed(this.removalResult(operation))
    })
  }

  changeAttention(
    request: AgentTeamAuthorizedThreadAttentionRequest,
  ): Promise<AgentTeamLedgerResult<AgentTeamThreadAttentionResult>> {
    return this.enqueue(async () => {
      const existing = this.state.byRequest.get(request.requestId)
      if (existing !== undefined) {
        this.assertSameAttention(existing, request)
        return this.resolved(this.attentionResult(existing))
      }
      const actor = this.assertActorForWorkspace(request.actor, request.workspaceId)
      const task = this.requireTask(request.workspaceId, request.taskRef)
      const thread = this.requireThread(task.threadRef)
      if (actor.kind === 'member') this.requireMemberChannel(this.requireMember(actor.memberId), task.channelRef)
      const current = this.attentionFor(actor.memberId, thread.threadRef)
      if (request.action === 'follow') {
        if (task.resolution === 'closed') throw new Error(`Task '${task.taskRef}' is closed; reopen it before following`)
        if (current !== undefined) throw new Error(`Member is already following Thread '${thread.threadRef}'`)
        const attention = this.followAttention(actor.memberId, thread.threadRef)
        const operation: AgentTeamThreadAttentionChangedOperation = Object.freeze({
          ...this.operationBase(request, this.nextSequence()), kind: 'team/thread-attention-changed',
          data: Object.freeze({ workspaceId: request.workspaceId, action: 'follow', memberId: actor.memberId,
            task, thread, inbox: this.inboxDelta([attention]) }),
        })
        await this.table.put(operation.operationId, operation)
        this.apply(operation)
        return this.committed(this.attentionResult(operation))
      }
      if (current === undefined) throw new Error(`Member is already unfollowed from Thread '${thread.threadRef}'`)
      if (this.hasActiveClaim(actor.memberId, task.taskRef)) throw new Error('Member cannot unfollow while owning an active Claim')
      const operation: AgentTeamThreadAttentionChangedOperation = Object.freeze({
        ...this.operationBase(request, this.nextSequence()), kind: 'team/thread-attention-changed',
        data: Object.freeze({ workspaceId: request.workspaceId, action: 'unfollow', memberId: actor.memberId,
          task, thread, inbox: this.inboxDelta([], [{ memberId: actor.memberId, threadRef: thread.threadRef }], [], this.directMarkersFor(actor.memberId, thread.threadRef)) }),
      })
      await this.table.put(operation.operationId, operation)
      this.apply(operation)
      return this.committed(this.attentionResult(operation))
    })
  }

  attentionStatus(actor: AgentTeamHumanActor | AgentTeamMemberActor, request: {
    workspaceId: WorkspaceId
    taskRef: AgentTeamTaskRef
  }): AgentTeamThreadAttentionStatus {
    const authorized = this.assertActorForWorkspace(actor, request.workspaceId)
    const task = this.requireTask(request.workspaceId, request.taskRef)
    if (authorized.kind === 'member') this.requireMemberChannel(this.requireMember(authorized.memberId), task.channelRef)
    const thread = this.requireThread(task.threadRef)
    const attention = this.attentionFor(authorized.memberId, thread.threadRef)
    return attention === undefined
      ? Object.freeze({ task, thread })
      : Object.freeze({ task, thread, attention })
  }

  inbox(actor: AgentTeamHumanActor | AgentTeamMemberActor, request: AgentTeamInboxRequest): AgentTeamInbox {
    const authorized = this.assertActorForWorkspace(actor, request.workspaceId)
    const limit = request.limit ?? 50
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('inbox limit must be an integer between 1 and 100')
    const items: AgentTeamInboxItem[] = []
    for (const task of this.state.tasks.values()) {
      if (this.state.channels.get(task.channelRef)?.workspaceId !== request.workspaceId) continue
      if (authorized.kind === 'member' && !this.isChannelMember(task.channelRef, authorized.memberId)) continue
      const thread = this.requireThread(task.threadRef)
      const unread = this.unreadFor(authorized.memberId, thread.threadRef)
      if (unread.length === 0) continue
      const directCount = unread.filter(item => item.direct).length
      const attention = this.attentionFor(authorized.memberId, thread.threadRef)
      items.push(attention === undefined
        ? Object.freeze({ channelRef: task.channelRef, task, thread, unreadCount: unread.length, directCount,
            newestSequence: unread.at(-1)!.fact.sequence })
        : Object.freeze({ channelRef: task.channelRef, task, thread, unreadCount: unread.length, directCount,
            newestSequence: unread.at(-1)!.fact.sequence, attention }))
    }
    items.sort((left, right) => right.directCount - left.directCount || right.newestSequence - left.newestSequence || left.thread.threadRef.localeCompare(right.thread.threadRef))
    const selected = items.slice(0, limit)
    return Object.freeze({ items: Object.freeze(selected),
      totalUnreadCount: items.reduce((sum, item) => sum + item.unreadCount, 0),
      totalDirectCount: items.reduce((sum, item) => sum + item.directCount, 0) })
  }

  /** Model-visible notification material derived from the recipient's current durable unread state. */
  notificationFacts(memberId: AgentTeamMemberId, request: AgentTeamInboxRequest): readonly {
    readonly item: AgentTeamInboxItem
    readonly facts: readonly AgentTeamThreadReadFact[]
  }[] {
    const member = this.requireMember(memberId)
    if (member.workspaceId !== request.workspaceId) throw new Error('Member cannot inspect another Workspace')
    const inbox = this.inbox({ kind: 'member', memberId, handle: member.handle }, request)
    return Object.freeze(inbox.items.map(item => Object.freeze({ item,
      facts: this.unreadFor(memberId, item.thread.threadRef) })))
  }

  readThread(request: AgentTeamAuthorizedThreadReadRequest): Promise<AgentTeamLedgerResult<AgentTeamThreadReadResult>> {
    return this.enqueue(async () => {
      const existing = this.state.byRequest.get(request.requestId)
      if (existing !== undefined) {
        this.assertSameThreadRead(existing, request)
        return this.resolved(this.threadReadResult(existing))
      }
      const actor = this.assertActorForWorkspace(request.actor, request.workspaceId)
      const prepared = this.prepareRead(actor.memberId, request.workspaceId, request.taskRef)
      const operation: AgentTeamThreadReadOperation = Object.freeze({
        ...this.operationBase(request, this.nextSequence()), kind: 'team/thread-read',
        data: Object.freeze({ workspaceId: request.workspaceId, memberId: actor.memberId, task: prepared.task,
          thread: prepared.thread, claims: prepared.claims, anchor: prepared.anchor, anchorMentions: prepared.anchorMentions,
          facts: prepared.facts,
          readThroughSequence: prepared.readThroughSequence, remainingUnreadCount: prepared.remainingUnreadCount,
          ...(prepared.attention === undefined ? {} : { attention: prepared.attention }), inbox: prepared.inbox }),
      })
      await this.table.put(operation.operationId, operation)
      this.apply(operation)
      return this.committed(this.threadReadResult(operation))
    })
  }

  threadObservations(actor: AgentTeamHumanActor, request: AgentTeamThreadObservationsRequest): AgentTeamThreadObservations {
    this.assertHumanActor(actor)
    const task = this.requireTask(request.workspaceId, request.taskRef)
    const limit = request.limit ?? 50
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('observation limit must be an integer between 1 and 100')
    const threadRef = task.threadRef
    const current = new Map<AgentTeamMemberId, AgentTeamThreadAttention>()
    const observations: AgentTeamThreadAttentionObservation[] = []
    for (const operation of this.state.ordered) {
      const delta = this.attentionDelta(operation)
      if (delta === undefined) continue
      for (const removed of delta.attention.removed) {
        if (removed.threadRef !== threadRef) continue
        if (!current.delete(removed.memberId)) continue
        observations.push(Object.freeze({ sequence: operation.sequence, threadRef, taskRef: task.taskRef,
          memberId: removed.memberId, action: 'unfollow' }))
      }
      for (const next of delta.attention.set) {
        if (next.threadRef !== threadRef) continue
        const prior = current.get(next.memberId)
        current.set(next.memberId, next)
        // Task creation establishes initial Attention; reads only advance its watermark.
        if (operation.kind === 'team/message-sent' || (prior !== undefined && prior.startSequence === next.startSequence)) continue
        observations.push(Object.freeze({ sequence: operation.sequence, threadRef, taskRef: task.taskRef,
          memberId: next.memberId, action: 'follow' }))
      }
    }
    return Object.freeze({ items: Object.freeze(observations.slice(-limit)) })
  }

  private attentionDelta(operation: AgentTeamOperation): AgentTeamInboxDelta | undefined {
    switch (operation.kind) {
      case 'team/channel-member-removed':
      case 'team/message-sent':
      case 'team/thread-replied':
      case 'team/claim-created':
      case 'team/claim-done':
      case 'team/claim-released':
      case 'team/task-changed':
      case 'team/thread-attention-changed':
      case 'team/thread-read':
      case 'team/member-removed':
        return operation.data.inbox
      default:
        return undefined
    }
  }

  /** Attachment ids referenced by any stored Message — the GC's keep-set oracle. */
  referencedAttachmentIds(): Set<AgentTeamAttachmentId> {
    const referenced = new Set<AgentTeamAttachmentId>()
    for (const fact of this.state.orderedFacts) {
      if (fact.kind !== 'message') continue
      for (const attachment of fact.message.attachments ?? []) referenced.add(attachment.attachmentId)
    }
    return referenced
  }

  threadHistory(actor: AgentTeamHumanActor | AgentTeamMemberActor, request: AgentTeamThreadHistoryRequest): AgentTeamThreadHistory {
    const authorized = this.assertActorForWorkspace(actor, request.workspaceId)
    const task = this.requireTask(request.workspaceId, request.taskRef)
    if (authorized.kind === 'member') this.requireMemberChannel(this.requireMember(authorized.memberId), task.channelRef)
    const thread = this.requireThread(task.threadRef)
    const limit = request.limit ?? 20
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('history limit must be an integer between 1 and 100')
    const before = request.beforeSequence ?? this.currentTail(thread.threadRef) + 1
    if (!Number.isInteger(before) || before < 1) throw new Error('beforeSequence must be a positive integer')
    const all = this.threadFacts(thread.threadRef).filter(fact => fact.sequence < before)
    const facts = all.slice(-limit)
    const anchor = this.threadAnchor(task)
    return Object.freeze({ task, thread, anchor, anchorMentions: this.state.mentionsByMessage.get(anchor.messageRef) ?? [],
      claims: this.claimsForTask(task.taskRef), facts: Object.freeze(facts),
      cursor: facts.length === 0 ? before : facts[0]!.sequence, hasMore: all.length > facts.length })
  }

  listClaims(actor: AgentTeamHumanActor | AgentTeamMemberActor, request: { workspaceId: WorkspaceId; taskRef: AgentTeamTaskRef }): AgentTeamClaimList {
    const authorized = this.assertActorForWorkspace(actor, request.workspaceId)
    const task = this.requireTask(request.workspaceId, request.taskRef)
    if (authorized.kind === 'member') this.requireMemberChannel(this.requireMember(authorized.memberId), task.channelRef)
    return Object.freeze({ task, thread: this.requireThread(task.threadRef), claims: this.claimsForTask(task.taskRef) })
  }

  getTask(taskRef: AgentTeamTaskRef): AgentTeamTask | undefined {
    return this.state.tasks.get(taskRef)
  }

  getClaim(claimRef: AgentTeamClaimRef): AgentTeamClaim | undefined {
    return this.state.claims.get(claimRef)
  }

  /** Navigation facts for message-body Task refs; unknown refs are omitted. */
  resolveTaskRefs(workspaceId: WorkspaceId, taskRefs: readonly AgentTeamTaskRef[]): AgentTeamResolvedTaskRef[] {
    const numbers = this.taskNumbers(workspaceId)
    const resolved: AgentTeamResolvedTaskRef[] = []
    for (const taskRef of taskRefs) {
      const task = this.state.tasks.get(taskRef)
      if (task === undefined || this.state.channels.get(task.channelRef)?.workspaceId !== workspaceId) continue
      resolved.push(Object.freeze({ taskRef: task.taskRef, channelRef: task.channelRef, threadRef: task.threadRef, taskNumber: numbers.get(task.taskRef) ?? 0 }))
    }
    return resolved
  }

  view(request: AgentTeamViewRequest, memberId?: AgentTeamMemberId): AgentTeamView {
    const limit = request.limit ?? 20
    const direction = request.direction ?? 'after'
    const cursor = request.cursor ?? 0
    if (direction !== 'after' && direction !== 'before') throw new Error('direction must be after or before')
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('limit must be an integer between 1 and 100')
    if (!Number.isInteger(cursor) || cursor < 0) throw new Error('cursor must be a non-negative integer sequence')
    if (memberId !== undefined) {
      const member = this.requireMember(memberId)
      if (member.workspaceId !== request.workspaceId) throw new Error('Member cannot view another Workspace')
    }
    if (request.channelRef !== undefined) {
      this.requireChannel(request.workspaceId, request.channelRef)
      if (memberId !== undefined && !this.isChannelMember(request.channelRef, memberId)) throw new Error(`Agent Member '${memberId}' is not authorized for Channel '${request.channelRef}'`)
    }
    if (request.threadRef !== undefined) {
      const thread = this.requireThread(request.threadRef)
      const task = this.requireTask(request.workspaceId, thread.taskRef)
      if (request.channelRef !== undefined && task.channelRef !== request.channelRef) throw new Error(`Thread '${request.threadRef}' does not belong to Channel '${request.channelRef}'`)
      if (memberId !== undefined && !this.isChannelMember(task.channelRef, memberId)) throw new Error(`Agent Member '${memberId}' is not authorized for Channel '${task.channelRef}'`)
    }
    const channels = [...this.state.channels.values()].filter(channel => channel.workspaceId === request.workspaceId
      && (memberId === undefined || this.isChannelMember(channel.channelRef, memberId)))
    const channelRefs = new Set(channels.map(channel => channel.channelRef))
    const allFacts = this.state.orderedFacts.filter(fact => {
      const task = fact.kind === 'message' ? this.state.tasks.get(fact.message.taskRef) : this.state.tasks.get(fact.activity.taskRef)
      if (task === undefined || !channelRefs.has(task.channelRef)) return false
      if (request.channelRef !== undefined && task.channelRef !== request.channelRef) return false
      if (request.threadRef !== undefined && task.threadRef !== request.threadRef) return false
      if (request.topLevelOnly && (fact.kind !== 'message' || !fact.message.topLevel)) return false
      if (request.includeActivities === false && fact.kind === 'activity') return false
      return direction === 'before' ? fact.sequence < (request.cursor ?? this.state.ordered.length + 1) : fact.sequence > cursor
    })
    const selected = direction === 'before' ? allFacts.slice(-limit) : allFacts.slice(0, limit)
    const visibleTasks = [...this.state.tasks.values()].filter(task => channelRefs.has(task.channelRef)
      && (request.channelRef === undefined || task.channelRef === request.channelRef)
      && (request.threadRef === undefined || task.threadRef === request.threadRef))
    const taskNumbers = this.taskNumbers(request.workspaceId)
    const items = selected.filter((fact): fact is Extract<AgentTeamThreadFact, { kind: 'message' }> => fact.kind === 'message').map(fact => {
      const message = fact.message
      const task = this.requireTask(request.workspaceId, message.taskRef)
      const thread = this.requireThread(message.threadRef)
      return Object.freeze({ message, mentions: fact.mentions, task, thread, taskNumber: taskNumbers.get(task.taskRef) ?? 0,
        messageCount: this.state.messageCountByThread.get(thread.threadRef) ?? 0 })
    })
    const initialization = this.initialization()
    const nextCursor = selected.length === 0 ? cursor : direction === 'before' ? selected[0]!.sequence : selected.at(-1)!.sequence
    return Object.freeze({
      humanMemberId: initialization.data.humanMemberId,
      channels: Object.freeze(channels),
      members: Object.freeze([...this.state.memberships.entries()].filter(([channelRef]) => channelRefs.has(channelRef)).flatMap(([channelRef, ids]) =>
        [...ids].filter(id => this.state.members.get(id)?.state !== 'inactive').sort().map(memberId => Object.freeze({ channelRef, memberId })))),
      tasks: Object.freeze(visibleTasks),
      threads: Object.freeze([...this.state.threads.values()].filter(thread => visibleTasks.some(task => task.taskRef === thread.taskRef))),
      taskNumbers: Object.freeze(visibleTasks.map(task => Object.freeze({ taskRef: task.taskRef, taskNumber: taskNumbers.get(task.taskRef) ?? 0 }))),
      items: Object.freeze(items),
      claims: this.claimsForVisibleTasks(visibleTasks),
      activities: Object.freeze(selected.filter((fact): fact is Extract<AgentTeamThreadFact, { kind: 'activity' }> => fact.kind === 'activity').map(fact => fact.activity)),
      cursor: nextCursor,
      hasMore: allFacts.length > selected.length,
    })
  }

  status(): AgentTeamStatus {
    const initialization = this.initialization()
    return Object.freeze({ initialized: true, sequence: this.state.ordered.length, operationCount: this.state.ordered.length,
      channelCount: this.state.channels.size, agentMemberCount: this.state.members.size, humanMemberId: initialization.data.humanMemberId })
  }

  validate(): void {
    this.validateRecords(this.sortedRecords())
  }

  hasCommitted(requestId: AgentTeamRequestId): boolean {
    return this.state.byRequest.has(requestId)
  }

  /** Return one stored committed operation by id. */
  getOperation(operationId: AgentTeamOperationId): AgentTeamOperation | undefined {
    return this.state.byOperation.get(operationId)
  }

  /** Scopes whose projections one committed operation invalidates; undefined wakes every waiter. */
  changeScopesOf(operation: AgentTeamOperation): readonly AgentTeamChangeScope[] | undefined {
    switch (operation.kind) {
      case 'team/initialized':
        return undefined
      case 'team/channel-created':
        return [{ kind: 'workspace', workspaceId: operation.data.workspaceId }]
      case 'team/channel-updated':
        // The rename is visible in the sidebar list and any open Channel/Thread header.
        return [{ kind: 'workspace', workspaceId: operation.data.workspaceId }, { kind: 'channel', channelRef: operation.data.channel.channelRef }]
      case 'team/member-added':
      case 'team/member-suspended':
      case 'team/member-resumed':
      case 'team/member-session-restarted':
      case 'team/member-updated':
      case 'team/member-removed':
        return [{ kind: 'workspace', workspaceId: operation.data.member.workspaceId }]
      case 'team/channel-member-added':
        return [{ kind: 'workspace', workspaceId: operation.data.workspaceId }, { kind: 'channel', channelRef: operation.data.channelRef }]
      case 'team/channel-member-removed': {
        const channelByTask = new Map(operation.data.tasks.map(task => [task.taskRef, task.channelRef]))
        const scopes: AgentTeamChangeScope[] = [
          { kind: 'workspace', workspaceId: operation.data.workspaceId },
          { kind: 'channel', channelRef: operation.data.channelRef },
        ]
        for (const activity of operation.data.activities) {
          scopes.push({ kind: 'thread', threadRef: activity.threadRef })
          const channelRef = channelByTask.get(activity.taskRef)
          if (channelRef !== undefined && !scopes.some(scope => scope.kind === 'channel' && scope.channelRef === channelRef)) {
            scopes.push({ kind: 'channel', channelRef })
          }
        }
        return scopes
      }
      case 'team/message-sent':
      case 'team/thread-replied':
        return [{ kind: 'channel', channelRef: operation.data.message.channelRef }, { kind: 'thread', threadRef: operation.data.message.threadRef }]
      case 'team/claim-created':
      case 'team/claim-done':
      case 'team/claim-released':
      case 'team/task-changed':
        return [{ kind: 'channel', channelRef: operation.data.task.channelRef }, { kind: 'thread', threadRef: operation.data.thread.threadRef }]
      case 'team/thread-attention-changed':
        return [{ kind: 'thread', threadRef: operation.data.thread.threadRef }]
      case 'team/thread-read':
        // A read advances only the reader's private watermark; no projection
        // visible to other participants changes, so nobody is woken.
        return []
    }
  }

  /** Members whose Inbox projection may have changed; the Host notifies only live ones. */
  affectedMembersOf(operation: AgentTeamOperation): readonly AgentTeamMemberId[] {
    const members = new Set<AgentTeamMemberId>()
    const delta = this.attentionDelta(operation)
    if (delta !== undefined) {
      for (const attention of delta.attention.set) members.add(attention.memberId)
      for (const key of delta.attention.removed) members.add(key.memberId)
      for (const marker of delta.directMarkers.added) members.add(marker.memberId)
      for (const marker of delta.directMarkers.removed) members.add(marker.memberId)
      for (const marker of delta.activityMarkers.added) members.add(marker.memberId)
      for (const marker of delta.activityMarkers.removed) members.add(marker.memberId)
    }
    for (const threadRef of this.touchedThreadRefs(operation)) {
      for (const follower of this.state.attentionByThread.get(threadRef) ?? []) members.add(follower)
    }
    if (operation.actor.kind === 'member') members.add(operation.actor.memberId)
    return [...members]
  }

  private touchedThreadRefs(operation: AgentTeamOperation): readonly AgentTeamThreadRef[] {
    switch (operation.kind) {
      case 'team/message-sent':
      case 'team/thread-replied':
        return [operation.data.message.threadRef]
      case 'team/claim-created':
      case 'team/claim-done':
      case 'team/claim-released':
      case 'team/task-changed':
      case 'team/thread-attention-changed':
        return [operation.data.thread.threadRef]
      case 'team/channel-member-removed':
      case 'team/member-removed':
        return operation.data.activities.map(activity => activity.threadRef)
      default:
        return []
    }
  }

  private replay(): void {
    const records = this.sortedRecords()
    this.validateRecords(records)
    for (const [, operation] of records) this.apply(operation)
  }

  private validateRecords(records: readonly [AgentTeamOperationId, AgentTeamOperation][]): void {
    const projection = emptyProjection()
    const operationIds = new Set<AgentTeamOperationId>()
    const requestIds = new Set<AgentTeamRequestId>()
    const refs = new Set<string>()
    let previous: AgentTeamOperationId | null = null
    for (const [index, [key, operation]] of records.entries()) {
      const sequence = index + 1
      if (key !== operation.operationId) throw new Error(`agent-team operation key '${key}' differs from record id '${operation.operationId}'`)
      if (operation.sequence !== sequence) throw new Error(`agent-team ledger expected sequence ${sequence}, found ${operation.sequence}`)
      if (operation.previousOperationId !== previous) throw new Error(`agent-team operation ${sequence} has a broken previous-operation link`)
      if (operationIds.has(operation.operationId)) throw new Error(`agent-team ledger repeats operation id '${operation.operationId}'`)
      if (requestIds.has(operation.requestId)) throw new Error(`agent-team ledger repeats request id '${operation.requestId}'`)
      if (sequence === 1) this.assertInitializationRecord(operation)
      else this.validateOperation(operation, projection, refs)
      this.applyTo(projection, operation)
      operationIds.add(operation.operationId)
      requestIds.add(operation.requestId)
      previous = operation.operationId
    }
  }

  private validateOperation(operation: AgentTeamOperation, projection: Projection, refs: Set<string>): void {
    const human = projection.ordered[0]
    if (human === undefined || human.kind !== 'team/initialized') throw new Error('agent-team ledger has no Human Member')
    const humanMemberId = human.data.humanMemberId
    const assertHuman = (): void => {
      if (operation.actor.kind !== 'human' || operation.actor.memberId !== humanMemberId || operation.actor.handle !== HUMAN_ACTOR.handle) {
        throw new Error(`agent-team operation ${operation.sequence} has invalid Human authority`)
      }
    }
    const assertMember = (): AgentTeamAgentMember => {
      if (operation.actor.kind !== 'member') throw new Error(`agent-team operation ${operation.sequence} requires Member authority`)
      const member = projection.members.get(operation.actor.memberId)
      if (member === undefined || member.state !== 'enabled' || member.handle !== operation.actor.handle) {
        throw new Error(`agent-team operation ${operation.sequence} has invalid Member authority`)
      }
      return member
    }
    if (operation.kind === 'team/initialized') throw new Error('agent-team initialization must be first')
    if (operation.kind === 'team/channel-created') {
      assertHuman()
      const { channel, memberIds } = operation.data
      if (projection.channels.has(channel.channelRef) || channel.createdAtSequence !== operation.sequence || channel.workspaceId !== operation.data.workspaceId) throw new Error('invalid Channel creation')
      this.addRef(refs, channel.channelRef)
      const unique = new Set(memberIds)
      if (unique.size !== memberIds.length) throw new Error('invalid initial Channel members')
      for (const memberId of memberIds) {
        const member = projection.members.get(memberId)
        if (member === undefined || member.workspaceId !== channel.workspaceId || member.state !== 'enabled') throw new Error('invalid initial Channel Member')
      }
      return
    }
    if (operation.kind === 'team/member-added') {
      assertHuman()
      const { member, channelRefs } = operation.data
      if (projection.members.has(member.memberId) || new Set(channelRefs).size !== channelRefs.length) throw new Error('invalid Member creation')
      this.addRef(refs, member.memberId)
      for (const channelRef of channelRefs) {
        const channel = projection.channels.get(channelRef)
        if (channel === undefined || channel.workspaceId !== member.workspaceId) throw new Error('invalid initial Member Channel')
      }
      return
    }
    if (operation.kind === 'team/member-suspended' || operation.kind === 'team/member-resumed') {
      assertHuman()
      const prior = projection.members.get(operation.data.member.memberId)
      const expected = operation.kind === 'team/member-suspended' ? 'enabled' : 'suspended'
      const next = operation.kind === 'team/member-suspended' ? 'suspended' : 'enabled'
      if (prior === undefined || prior.state !== expected || operation.data.member.state !== next || !this.sameMemberIdentity(prior, operation.data.member)) throw new Error('invalid Member lifecycle transition')
      return
    }
    if (operation.kind === 'team/member-session-restarted') {
      assertHuman()
      const prior = projection.members.get(operation.data.member.memberId)
      // The restart records the unchanged Member: same identity, still enabled.
      if (prior === undefined || prior.state !== 'enabled' || !this.sameMemberIdentity(prior, operation.data.member)) throw new Error('invalid Member restart')
      return
    }
    if (operation.kind === 'team/channel-updated') {
      assertHuman()
      const prior = projection.channels.get(operation.data.channel.channelRef)
      if (prior === undefined || prior.workspaceId !== operation.data.workspaceId
        || operation.data.channel.workspaceId !== prior.workspaceId || operation.data.channel.createdAtSequence !== prior.createdAtSequence) {
        throw new Error('invalid Channel update')
      }
      return
    }
    if (operation.kind === 'team/member-updated') {
      assertHuman()
      const prior = projection.members.get(operation.data.member.memberId)
      if (prior === undefined || prior.state === 'inactive' || operation.data.member.state !== prior.state
        || operation.data.member.sessionId !== prior.sessionId || operation.data.member.workspaceId !== prior.workspaceId
        || operation.data.member.presetId !== prior.presetId
        || operation.data.member.privateMemoryPath !== prior.privateMemoryPath) throw new Error('invalid Member update')
      // The renamed handle must stay unique among the workspace's other live Members.
      const normalized = operation.data.member.handle.normalize('NFKC').trim().toLowerCase()
      for (const other of projection.members.values()) {
        if (other.memberId !== prior.memberId && other.state !== 'inactive' && other.workspaceId === prior.workspaceId
          && other.handle.normalize('NFKC').trim().toLowerCase() === normalized) throw new Error('invalid Member update handle')
      }
      return
    }
    if (operation.kind === 'team/channel-member-added') {
      assertHuman()
      const channel = projection.channels.get(operation.data.channelRef)
      const member = projection.members.get(operation.data.memberId)
      if (channel === undefined || member === undefined || member.workspaceId !== channel.workspaceId || operation.data.workspaceId !== channel.workspaceId || projection.memberships.get(channel.channelRef)?.has(member.memberId)) throw new Error('invalid Channel membership')
      return
    }
    if (operation.kind === 'team/channel-member-removed') {
      assertHuman()
      const channel = projection.channels.get(operation.data.channelRef)
      const member = projection.members.get(operation.data.memberId)
      if (channel === undefined || member === undefined || operation.data.workspaceId !== channel.workspaceId
        || member.workspaceId !== channel.workspaceId || !projection.memberships.get(channel.channelRef)?.has(member.memberId)) throw new Error('invalid Channel membership removal')
      const threadRefs = new Set([...projection.tasks.values()].filter(task => task.channelRef === channel.channelRef).map(task => task.threadRef))
      this.validateReleaseCleanup(operation.data, projection, member.memberId, threadRefs, operation.sequence, refs)
      return
    }
    if (operation.kind === 'team/member-removed') {
      assertHuman()
      const prior = projection.members.get(operation.data.member.memberId)
      if (prior === undefined || prior.state === 'inactive' || operation.data.member.state !== 'inactive' || !this.sameMemberIdentity(prior, operation.data.member)) throw new Error('invalid Member removal')
      const threadRefs = new Set([...projection.tasks.values()].map(task => task.threadRef))
      this.validateReleaseCleanup(operation.data, projection, prior.memberId, threadRefs, operation.sequence, refs)
      return
    }
    if (operation.kind === 'team/thread-attention-changed') {
      const actor = operation.actor.kind === 'member' ? assertMember() : (assertHuman(), undefined)
      if (operation.data.memberId !== operation.actor.memberId) throw new Error('Attention operation has wrong actor')
      const task = projection.tasks.get(operation.data.task.taskRef)
      const thread = projection.threads.get(operation.data.thread.threadRef)
      if (task === undefined || thread === undefined || !this.sameTask(task, operation.data.task)
        || !this.sameThread(thread, operation.data.thread)
        || (actor !== undefined && !projection.memberships.get(task.channelRef)?.has(actor.memberId))) throw new Error('invalid Attention operation')
      const current = this.attentionForFrom(projection, operation.data.memberId, thread.threadRef)
      if ((operation.data.action === 'follow' && (task.resolution === 'closed' || current !== undefined))
        || (operation.data.action === 'unfollow' && (current === undefined || this.hasActiveClaimFrom(projection, operation.data.memberId, task.taskRef)))) {
        throw new Error('invalid Attention transition')
      }
      const expected = operation.data.action === 'follow'
        ? this.inboxDelta([this.followAttentionFrom(projection, operation.data.memberId, thread.threadRef)])
        : this.inboxDelta([], [{ memberId: operation.data.memberId, threadRef: thread.threadRef }], [], this.directMarkersForFrom(projection, operation.data.memberId, thread.threadRef))
      if (!isDeepStrictEqual(operation.data.inbox, expected)) throw new Error('invalid Attention projection')
      this.validateInboxDelta(operation.data.inbox, projection, refs)
      return
    }
    if (operation.kind === 'team/thread-read') {
      if (operation.actor.kind === 'member') assertMember(); else assertHuman()
      if (operation.data.memberId !== operation.actor.memberId) throw new Error('Thread read has wrong actor')
      const expected = this.prepareReadFrom(projection, operation.data.memberId, operation.data.workspaceId, operation.data.task.taskRef)
      const expectedData = Object.freeze({ workspaceId: operation.data.workspaceId, memberId: operation.data.memberId,
        task: expected.task, thread: expected.thread, claims: expected.claims, anchor: expected.anchor,
        anchorMentions: expected.anchorMentions, facts: expected.facts,
        readThroughSequence: expected.readThroughSequence, remainingUnreadCount: expected.remainingUnreadCount,
        ...(expected.attention === undefined ? {} : { attention: expected.attention }), inbox: expected.inbox })
      if (!isDeepStrictEqual(operation.data, expectedData)) throw new Error('invalid Thread read projection')
      this.validateInboxDelta(operation.data.inbox, projection, refs)
      return
    }
    if (operation.kind === 'team/message-sent' || operation.kind === 'team/thread-replied') {
      const actor = operation.actor.kind === 'member' ? assertMember() : (assertHuman(), undefined)
      const { message, task, thread } = operation.data
      const channel = projection.channels.get(message.channelRef)
      if (channel === undefined || channel.workspaceId !== operation.data.workspaceId || message.sender !== operation.actor.memberId
        || message.sequence !== operation.sequence || thread.revision !== operation.sequence || message.taskRef !== task.taskRef
        || message.threadRef !== thread.threadRef || task.threadRef !== thread.threadRef || task.channelRef !== channel.channelRef
        || (actor !== undefined && !projection.memberships.get(channel.channelRef)?.has(actor.memberId))) throw new Error('invalid Message operation')
      if (operation.kind === 'team/message-sent') {
        if (!message.topLevel || projection.tasks.has(task.taskRef) || projection.threads.has(thread.threadRef)) throw new Error('invalid top-level Message operation')
        this.addRef(refs, task.taskRef); this.addRef(refs, thread.threadRef)
      } else {
        const priorTask = projection.tasks.get(task.taskRef)
        const priorThread = projection.threads.get(thread.threadRef)
        if (message.topLevel || priorTask === undefined || priorThread === undefined || !this.sameTask(priorTask, task)
          || priorThread.taskRef !== thread.taskRef || operation.data.baseRevision !== priorThread.revision) throw new Error('invalid Thread reply')
      }
      this.addRef(refs, message.messageRef)
      this.validateMentions(operation.data.mentions, message, projection)
      this.validateInboxDelta(operation.data.inbox, projection, refs, [thread.threadRef], [message])
      this.validateMessageInbox(operation, projection)
      return
    }
    if (operation.kind === 'team/claim-created' || operation.kind === 'team/claim-done' || operation.kind === 'team/claim-released') {
      const actor = operation.actor.kind === 'member' ? assertMember() : (assertHuman(), undefined)
      const { task, thread, claim, activity } = operation.data
      const priorTask = projection.tasks.get(task.taskRef)
      const priorThread = projection.threads.get(thread.threadRef)
      if (priorTask === undefined || priorThread === undefined || priorThread.revision !== operation.data.baseRevision
        || !this.sameTaskIdentity(priorTask, task) || task.threadRef !== thread.threadRef || task.taskRef !== thread.taskRef
        || thread.revision !== operation.sequence || activity.sequence !== operation.sequence || activity.actor !== operation.actor.memberId
        || activity.taskRef !== task.taskRef || activity.threadRef !== thread.threadRef || activity.claimRef !== claim.claimRef
        || (actor !== undefined && !projection.memberships.get(task.channelRef)?.has(actor.memberId))) throw new Error('invalid Claim operation')
      const creates = operation.kind === 'team/claim-created'
      const expectedKind = creates ? 'claim' : operation.kind === 'team/claim-done' ? 'done' : 'release'
      if (activity.kind !== expectedKind || claim.taskRef !== task.taskRef || claim.threadRef !== thread.threadRef) throw new Error('invalid Claim activity')
      if (operation.actor.kind !== 'member') throw new Error('invalid Claim authority')
      if ((creates && projection.claims.has(claim.claimRef))
        || (creates && claim.owner !== operation.actor.memberId) || (creates && claim.state !== 'active')) throw new Error('invalid Claim creation')
      const previousClaim = projection.claims.get(claim.claimRef)
      if (!creates && (previousClaim === undefined || previousClaim.state !== 'active' || !this.sameClaimIdentity(previousClaim, claim)
        || (operation.actor.kind === 'member' && previousClaim.owner !== operation.actor.memberId)
        || claim.state !== (operation.kind === 'team/claim-done' ? 'done' : 'released'))) throw new Error('invalid Claim transition')
      if (task.status !== this.deriveResolvedTaskStatus(task, new Map(projection.claims).set(claim.claimRef, claim).values())) throw new Error('invalid Claim Task status')
      this.addRef(refs, activity.activityRef)
      if (creates) this.addRef(refs, claim.claimRef)
      const expectedInbox = creates && !this.isFollowingFrom(projection, thread.threadRef, operation.actor.memberId)
        ? this.inboxDelta([this.startAttention(operation.actor.memberId, thread.threadRef, operation.sequence)])
        : this.inboxDelta()
      if (!isDeepStrictEqual(operation.data.inbox, expectedInbox)) throw new Error('invalid Claim inbox projection')
      this.validateInboxDelta(operation.data.inbox, projection, refs)
      return
    }
    if (operation.kind === 'team/task-changed') {
      assertHuman()
      const { task, thread, activity } = operation.data
      const priorTask = projection.tasks.get(task.taskRef)
      const priorThread = projection.threads.get(thread.threadRef)
      if (priorTask === undefined || priorThread === undefined || priorThread.revision !== operation.data.baseRevision
        || task.threadRef !== thread.threadRef || !this.sameThread(thread, { ...priorThread, revision: operation.sequence })
        || activity.sequence !== operation.sequence || activity.actor !== operation.actor.memberId
        || activity.taskRef !== task.taskRef || activity.threadRef !== thread.threadRef) throw new Error('invalid Task operation')
      const expectedResolution = activity.kind === 'accept' ? 'accepted' : activity.kind === 'close' ? 'closed' : 'open'
      const expectedStatus = expectedResolution === 'accepted' ? 'done' : expectedResolution === 'closed' ? 'closed'
        : this.deriveTaskStatus(task.taskRef, operation.data.claims)
      const expectedCompletedClaimRefs = operation.data.claims
        .filter(claim => projection.claims.get(claim.claimRef)?.state === 'active' && claim.state === 'done')
        .map(claim => claim.claimRef)
      if (task.resolution !== expectedResolution || task.status !== expectedStatus
        || (activity.kind !== 'close' && activity.releasedClaimRefs !== undefined)
        || (activity.kind !== 'accept' && activity.completedClaimRefs !== undefined)
        || (activity.kind === 'close' && !this.sameList(activity.releasedClaimRefs ?? [], operation.data.claims
          .filter(claim => projection.claims.get(claim.claimRef)?.state === 'active' && claim.state === 'released')
          .map(claim => claim.claimRef)))
        || !this.sameList(activity.completedClaimRefs ?? [], expectedCompletedClaimRefs)) {
        throw new Error('invalid Task state transition')
      }
      const priorClaims = [...projection.claims.values()].filter(claim => claim.taskRef === task.taskRef).sort((left, right) => left.claimRef.localeCompare(right.claimRef))
      const operationClaims = [...operation.data.claims].sort((left, right) => left.claimRef.localeCompare(right.claimRef))
      if (priorClaims.length !== operationClaims.length || priorClaims.some((claim, index) => claim.claimRef !== operationClaims[index]?.claimRef)) throw new Error('invalid Task Claim set')
      for (const claim of operationClaims) {
        const previousClaim = projection.claims.get(claim.claimRef)
        if (previousClaim === undefined || !this.sameClaimIdentity(previousClaim, claim)) throw new Error('invalid Task Claim identity')
        const legal = activity.kind === 'close'
          ? (previousClaim.state === 'active' ? claim.state === 'released' : claim.state === previousClaim.state)
          : activity.kind === 'accept'
            ? (previousClaim.state === 'active' ? claim.state === 'done' : claim.state === previousClaim.state)
            : claim.state === previousClaim.state
        if (!legal) throw new Error('invalid Task Claim transition')
      }
      this.addRef(refs, activity.activityRef)
      const expectedInbox = activity.kind === 'close'
        ? this.closeThreadInboxFrom(projection, activity, thread.threadRef)
        : activity.kind === 'reopen'
          ? this.reopenThreadInboxFrom(projection, activity, thread.threadRef)
          : this.acceptThreadInboxFrom(projection, activity, thread.threadRef, expectedCompletedClaimRefs)
      if (!isDeepStrictEqual(operation.data.inbox, expectedInbox)) throw new Error('invalid Task inbox projection')
      this.validateInboxDelta(operation.data.inbox, projection, refs, [], [], [activity])
      return
    }
  }

  private validateInboxDelta(
    delta: AgentTeamInboxDelta,
    projection: Projection,
    _refs: Set<string>,
    additionalThreadRefs: readonly AgentTeamThreadRef[] = [],
    additionalMessages: readonly AgentTeamMessage[] = [],
    additionalActivities: readonly AgentTeamActivity[] = [],
  ): void {
    const attentionKeys = new Set<string>()
    const knownThreadRefs = new Set([...projection.threads.keys(), ...additionalThreadRefs])
    for (const attention of delta.attention.set) {
      if (!knownThreadRefs.has(attention.threadRef) || attention.startSequence < 1
        || attention.readThroughSequence < attention.startSequence - 1) {
        throw new Error('invalid Attention delta')
      }
      const key = this.attentionKey(attention.memberId, attention.threadRef)
      if (attentionKeys.has(key)) throw new Error('repeated Attention delta')
      attentionKeys.add(key)
    }
    for (const key of delta.attention.removed) {
      if (attentionKeys.has(this.attentionKey(key.memberId, key.threadRef))) throw new Error('conflicting Attention delta')
    }
    const markerKeys = new Set<string>()
    const messages = [...projection.messages, ...additionalMessages]
    for (const marker of delta.directMarkers.added) {
      const key = this.directMarkerKey(marker)
      if (markerKeys.has(key) || projection.directMarkers.has(key)) throw new Error('invalid direct marker addition')
      markerKeys.add(key)
      const message = messages.find(candidate => candidate.messageRef === marker.messageRef)
      if (message === undefined || message.threadRef !== marker.threadRef || message.sequence !== marker.sequence
        || !this.validMentionTarget(projection, message.channelRef, marker.memberId)) throw new Error('invalid direct marker addition')
    }
    for (const marker of delta.directMarkers.removed) {
      const key = this.directMarkerKey(marker)
      if (markerKeys.has(key) || !projection.directMarkers.has(key)) throw new Error('invalid direct marker removal')
      markerKeys.add(key)
      const current = projection.directMarkers.get(key)!
      const message = messages.find(candidate => candidate.messageRef === marker.messageRef)
      if (!isDeepStrictEqual(current, marker) || message === undefined || message.threadRef !== marker.threadRef
        || message.sequence !== marker.sequence || !this.validMentionTarget(projection, message.channelRef, marker.memberId)) {
        throw new Error('invalid direct marker removal')
      }
    }
    const activityMarkerKeys = new Set<string>()
    const activities = [...projection.orderedFacts.filter(fact => fact.kind === 'activity').map(fact => fact.activity), ...additionalActivities]
    for (const marker of delta.activityMarkers.added) {
      const key = this.activityMarkerKey(marker)
      const activity = activities.find(candidate => candidate.activityRef === marker.activityRef)
      if (activityMarkerKeys.has(key) || projection.activityMarkers.has(key) || activity === undefined
        || activity.threadRef !== marker.threadRef || activity.sequence !== marker.sequence) throw new Error('invalid activity marker addition')
      activityMarkerKeys.add(key)
    }
    for (const marker of delta.activityMarkers.removed) {
      const key = this.activityMarkerKey(marker)
      if (activityMarkerKeys.has(key) || !isDeepStrictEqual(projection.activityMarkers.get(key), marker)) {
        throw new Error('invalid activity marker removal')
      }
      activityMarkerKeys.add(key)
    }
  }

  private validateReleaseCleanup(
    data: AgentTeamChannelMemberRemovedOperation['data'] | AgentTeamMemberRemovedOperation['data'],
    projection: Projection,
    memberId: AgentTeamMemberId,
    threadRefs: ReadonlySet<AgentTeamThreadRef>,
    sequence: number,
    refs: Set<string>,
  ): void {
    const releasedClaims = [...projection.claims.values()]
      .filter(claim => claim.owner === memberId && claim.state === 'active' && threadRefs.has(claim.threadRef))
      .map(claim => Object.freeze({ ...claim, state: 'released' as const }))
    if (data.claims.length !== releasedClaims.length || data.claims.some((claim, index) => {
      const expected = releasedClaims[index]
      return expected === undefined || !this.sameClaim(expected, claim)
    })) throw new Error('invalid released Claim projection')

    const byThread = new Map<AgentTeamThreadRef, AgentTeamClaim[]>()
    for (const claim of releasedClaims) byThread.set(claim.threadRef, [...(byThread.get(claim.threadRef) ?? []), claim])
    const expectedActivities = [...byThread.entries()].map(([threadRef, claims]) => ({
      kind: 'claims_released' as const, taskRef: claims[0]!.taskRef, threadRef, actor: memberId, sequence,
      claimRefs: claims.map(claim => claim.claimRef).sort(),
    }))
    if (data.activities.length !== expectedActivities.length || data.activities.some((activity, index) => {
      const expected = expectedActivities[index]
      return expected === undefined || activity.kind !== expected.kind || activity.taskRef !== expected.taskRef
        || activity.threadRef !== expected.threadRef || activity.actor !== expected.actor || activity.sequence !== expected.sequence
        || !this.sameList(activity.claimRefs, expected.claimRefs)
    })) throw new Error('invalid released Claim activities')
    for (const claim of data.claims) {
      const prior = projection.claims.get(claim.claimRef)
      if (prior === undefined) throw new Error('invalid released Claim reference')
    }
    for (const activity of data.activities) this.addRef(refs, activity.activityRef)

    const projectedClaims = new Map(projection.claims)
    for (const claim of releasedClaims) projectedClaims.set(claim.claimRef, claim)
    const expectedTasks = [...new Set(releasedClaims.map(claim => claim.taskRef))].map(taskRef => {
      const task = projection.tasks.get(taskRef)!
      return Object.freeze({ ...task, status: this.deriveResolvedTaskStatus(task, projectedClaims.values()) })
    })
    const expectedThreads = expectedActivities.map(activity => {
      const thread = projection.threads.get(activity.threadRef)!
      return Object.freeze({ ...thread, revision: sequence })
    })
    if (!isDeepStrictEqual(data.tasks, expectedTasks) || !isDeepStrictEqual(data.threads, expectedThreads)) {
      throw new Error('invalid released Claim Task or Thread projection')
    }

    const expectedAttention = [...projection.attention.values()]
      .filter(attention => attention.memberId === memberId && threadRefs.has(attention.threadRef))
      .map(attention => ({ memberId: attention.memberId, threadRef: attention.threadRef }))
    const expectedMarkers = [...projection.directMarkers.values()]
      .filter(marker => marker.memberId === memberId && threadRefs.has(marker.threadRef))
    const expectedActivityMarkers = [...projection.activityMarkers.values()]
      .filter(marker => marker.memberId === memberId && threadRefs.has(marker.threadRef))
    const expectedInbox = this.inboxDelta([], expectedAttention, [], expectedMarkers, [], expectedActivityMarkers)
    if (!isDeepStrictEqual(data.inbox, expectedInbox)) throw new Error('invalid Member inbox cleanup')
    this.validateInboxDelta(data.inbox, projection, refs)
  }

  private validateMessageInbox(operation: AgentTeamMessageSentOperation | AgentTeamThreadRepliedOperation, projection: Projection): void {
    const { message, mentions } = operation.data
    const mentionedAgents = mentions.filter(memberId => projection.members.has(memberId))
    // Top-level mentions are open to every actor; only a Member reply may not
    // pull an unfollowed Member into an existing Thread.
    if (operation.actor.kind === 'member' && operation.kind === 'team/thread-replied'
      && mentionedAgents.some(memberId => !this.isFollowingFrom(projection, message.threadRef, memberId))) {
      throw new Error('invalid Agent mention projection')
    }
    const started = operation.kind === 'team/message-sent'
      ? [this.startAttention(message.sender, message.threadRef, message.sequence),
        ...mentionedAgents.map(memberId => this.startAttention(memberId, message.threadRef, message.sequence))]
      : mentionedAgents.filter(memberId => !this.isFollowingFrom(projection, message.threadRef, memberId))
        .map(memberId => this.startAttention(memberId, message.threadRef, message.sequence))
    const markers = mentions.map(memberId => Object.freeze({ memberId, threadRef: message.threadRef,
      messageRef: message.messageRef, sequence: message.sequence }))
    const expected = this.inboxDelta(started, [], markers)
    if (!isDeepStrictEqual(operation.data.inbox, expected)) throw new Error('invalid Message inbox projection')
  }

  private validateMentions(
    mentions: readonly AgentTeamMemberId[],
    message: AgentTeamMessage,
    projection: Projection,
  ): void {
    if (mentions.includes(message.sender) || !this.sameList(mentions, [...new Set(mentions)].sort())) throw new Error('invalid Message mentions')
    for (const memberId of mentions) if (!this.validMentionTarget(projection, message.channelRef, memberId)) throw new Error('invalid Message mention target')
  }

  private validMentionTarget(projection: Projection, channelRef: AgentTeamChannelRef, memberId: AgentTeamMemberId): boolean {
    if (memberId === AGENT_TEAM_HUMAN_MEMBER_ID) return true
    const member = projection.members.get(memberId)
    return member !== undefined && member.state !== 'inactive'
      && projection.channels.get(channelRef)?.workspaceId === member.workspaceId
      && this.isChannelMemberFrom(projection, channelRef, memberId)
  }

  private apply(operation: AgentTeamOperation): void {
    this.applyTo(this.state, operation)
  }

  private applyTo(target: Projection, operation: AgentTeamOperation): void {
    target.ordered.push(operation)
    target.byRequest.set(operation.requestId, operation)
    target.byOperation.set(operation.operationId, operation)
    if (operation.kind === 'team/initialized') return
    if (operation.kind === 'team/channel-created') {
      target.channels.set(operation.data.channel.channelRef, operation.data.channel)
      target.memberships.set(operation.data.channel.channelRef, new Set(operation.data.memberIds))
      return
    }
    if (operation.kind === 'team/member-added') {
      target.members.set(operation.data.member.memberId, operation.data.member)
      for (const channelRef of operation.data.channelRefs) this.addMembership(target, channelRef, operation.data.member.memberId)
      return
    }
    if (operation.kind === 'team/member-suspended' || operation.kind === 'team/member-resumed') {
      target.members.set(operation.data.member.memberId, operation.data.member)
      return
    }
    if (operation.kind === 'team/member-session-restarted') {
      // Audit-only: identity, transcript, and memory are untouched, so the
      // projection deliberately does not change.
      return
    }
    if (operation.kind === 'team/channel-updated') {
      target.channels.set(operation.data.channel.channelRef, operation.data.channel)
      return
    }
    if (operation.kind === 'team/member-updated') {
      target.members.set(operation.data.member.memberId, operation.data.member)
      return
    }
    if (operation.kind === 'team/channel-member-added') {
      this.addMembership(target, operation.data.channelRef, operation.data.memberId)
      return
    }
    if (operation.kind === 'team/channel-member-removed') {
      target.memberships.get(operation.data.channelRef)?.delete(operation.data.memberId)
      for (const claim of operation.data.claims) target.claims.set(claim.claimRef, claim)
      for (const activity of operation.data.activities) this.appendActivityFact(target, activity)
      for (const task of operation.data.tasks) target.tasks.set(task.taskRef, task)
      for (const thread of operation.data.threads) target.threads.set(thread.threadRef, thread)
      this.applyInboxDelta(target, operation.data.inbox)
      return
    }
    if (operation.kind === 'team/member-removed') {
      target.members.set(operation.data.member.memberId, operation.data.member)
      for (const membership of target.memberships.values()) membership.delete(operation.data.member.memberId)
      for (const claim of operation.data.claims) target.claims.set(claim.claimRef, claim)
      for (const activity of operation.data.activities) this.appendActivityFact(target, activity)
      for (const task of operation.data.tasks) target.tasks.set(task.taskRef, task)
      for (const thread of operation.data.threads) target.threads.set(thread.threadRef, thread)
      this.applyInboxDelta(target, operation.data.inbox)
      return
    }
    if (operation.kind === 'team/message-sent' || operation.kind === 'team/thread-replied') {
      const { message, mentions } = operation.data
      target.messages.push(message)
      target.mentionsByMessage.set(message.messageRef, Object.freeze([...mentions]))
      this.appendMessageFact(target, message, mentions)
      target.tasks.set(operation.data.task.taskRef, operation.data.task)
      target.threads.set(operation.data.thread.threadRef, operation.data.thread)
      this.applyInboxDelta(target, operation.data.inbox)
      return
    }
    if (operation.kind === 'team/claim-created' || operation.kind === 'team/claim-done' || operation.kind === 'team/claim-released') {
      target.claims.set(operation.data.claim.claimRef, operation.data.claim)
      this.appendActivityFact(target, operation.data.activity)
      target.tasks.set(operation.data.task.taskRef, operation.data.task)
      target.threads.set(operation.data.thread.threadRef, operation.data.thread)
      this.applyInboxDelta(target, operation.data.inbox)
      return
    }
    if (operation.kind === 'team/task-changed') {
      for (const claim of operation.data.claims) target.claims.set(claim.claimRef, claim)
      this.appendActivityFact(target, operation.data.activity)
      target.tasks.set(operation.data.task.taskRef, operation.data.task)
      target.threads.set(operation.data.thread.threadRef, operation.data.thread)
      this.applyInboxDelta(target, operation.data.inbox)
      return
    }
    if (operation.kind === 'team/thread-attention-changed' || operation.kind === 'team/thread-read') {
      this.applyInboxDelta(target, operation.data.inbox)
    }
  }

  /** Facts arrive in ledger sequence order, so global and per-thread lists stay sorted by append only. */
  private appendMessageFact(
    target: Pick<Projection, 'orderedFacts' | 'factsByThread' | 'topLevelMessages' | 'messageCountByThread'>,
    message: AgentTeamMessage,
    mentions: readonly AgentTeamMemberId[],
  ): void {
    const fact: AgentTeamThreadFact = Object.freeze({ kind: 'message', sequence: message.sequence, message, mentions })
    target.orderedFacts.push(fact)
    const facts = target.factsByThread.get(message.threadRef) ?? []
    facts.push(fact)
    target.factsByThread.set(message.threadRef, facts)
    if (message.topLevel) target.topLevelMessages.push(message)
    target.messageCountByThread.set(message.threadRef, (target.messageCountByThread.get(message.threadRef) ?? 0) + 1)
  }

  private appendActivityFact(target: Pick<Projection, 'orderedFacts' | 'factsByThread'>, activity: AgentTeamActivity): void {
    const fact: AgentTeamThreadFact = Object.freeze({ kind: 'activity', sequence: activity.sequence, activity })
    target.orderedFacts.push(fact)
    const facts = target.factsByThread.get(activity.threadRef) ?? []
    facts.push(fact)
    target.factsByThread.set(activity.threadRef, facts)
  }

  private applyInboxDelta(target: Projection, delta: AgentTeamInboxDelta): void {
    for (const key of delta.attention.removed) {
      target.attention.delete(this.attentionKey(key.memberId, key.threadRef))
      const followers = target.attentionByThread.get(key.threadRef)
      if (followers !== undefined) {
        followers.delete(key.memberId)
        if (followers.size === 0) target.attentionByThread.delete(key.threadRef)
      }
    }
    for (const attention of delta.attention.set) {
      target.attention.set(this.attentionKey(attention.memberId, attention.threadRef), attention)
      const followers = target.attentionByThread.get(attention.threadRef) ?? new Set<AgentTeamMemberId>()
      followers.add(attention.memberId)
      target.attentionByThread.set(attention.threadRef, followers)
    }
    for (const marker of delta.directMarkers.removed) target.directMarkers.delete(this.directMarkerKey(marker))
    for (const marker of delta.directMarkers.added) target.directMarkers.set(this.directMarkerKey(marker), marker)
    for (const marker of delta.activityMarkers.removed) target.activityMarkers.delete(this.activityMarkerKey(marker))
    for (const marker of delta.activityMarkers.added) target.activityMarkers.set(this.activityMarkerKey(marker), marker)
  }

  private prepareRead(memberId: AgentTeamMemberId, workspaceId: WorkspaceId, taskRef: AgentTeamTaskRef): PreparedRead {
    return this.prepareReadFrom(this.state, memberId, workspaceId, taskRef)
  }

  /** Derive the only legal durable result of one Thread read from a prior projection. */
  private prepareReadFrom(projection: Projection, memberId: AgentTeamMemberId, workspaceId: WorkspaceId, taskRef: AgentTeamTaskRef): PreparedRead {
    const task = projection.tasks.get(taskRef)
    if (task === undefined) throw new Error(`unknown Task ref '${taskRef}'${this.unknownRefHint(taskRef, 'task', 'Task')}`)
    if (projection.channels.get(task.channelRef)?.workspaceId !== workspaceId) throw new Error(`Task '${taskRef}' does not belong to Workspace '${workspaceId}'`)
    const thread = projection.threads.get(task.threadRef)
    if (thread === undefined) throw new Error(`unknown Thread ref '${task.threadRef}'`)
    if (memberId !== AGENT_TEAM_HUMAN_MEMBER_ID) {
      const member = projection.members.get(memberId)
      if (member === undefined || !projection.memberships.get(task.channelRef)?.has(member.memberId)) {
        throw new Error(`Agent Member '${memberId}' is not authorized for Channel '${task.channelRef}'`)
      }
    }
    const anchor = this.threadAnchorFrom(projection, task)
    const attention = this.attentionForFrom(projection, memberId, thread.threadRef)
    const unread = this.unreadForFrom(projection, memberId, thread.threadRef)
    const unreadFacts = unread.slice(0, 20)
    const unreadFactKeys = new Set(unread.map(item => this.threadFactKey(item.fact)))
    const firstRead = attention !== undefined && attention.readThroughSequence < attention.startSequence
    const background = firstRead
      ? projection.messages.filter(message => message.threadRef === thread.threadRef && message.sequence < attention.startSequence)
        .map(message => Object.freeze({ kind: 'message' as const, sequence: message.sequence, message,
          mentions: projection.mentionsByMessage.get(message.messageRef) ?? [] }))
        .filter(fact => !unreadFactKeys.has(this.threadFactKey(fact))).slice(-12)
      : []
    const combined = [...background.map(fact => this.readFactFrom(projection, memberId, fact, false)), ...unreadFacts]
      .sort((left, right) => left.fact.sequence - right.fact.sequence)
    // Direct markers are sparse acknowledgements, not part of the contiguous
    // follower watermark. Consuming an old marker after a later follow must
    // never move that watermark backwards.
    const ordinaryUnread = unreadFacts.filter(item => item.fact.sequence >= (attention?.startSequence ?? Number.MAX_SAFE_INTEGER)
      && this.visibleToFollower(item.fact, memberId))
    const readThroughSequence = Math.max(attention?.readThroughSequence ?? 0, ordinaryUnread.at(-1)?.fact.sequence ?? 0)
    const nextAttention = attention === undefined || readThroughSequence === attention.readThroughSequence ? []
      : [Object.freeze({ ...attention, readThroughSequence })]
    const consumedDirectMarkers = new Set(unreadFacts.flatMap(item => item.direct && item.fact.kind === 'message'
      ? [this.directMarkerKey({ memberId, threadRef: thread.threadRef, messageRef: item.fact.message.messageRef })] : []))
    const consumed = this.directMarkersForFrom(projection, memberId, thread.threadRef)
      .filter(marker => consumedDirectMarkers.has(this.directMarkerKey(marker)))
    const activityMarkers = this.activityMarkersForFrom(projection, memberId, thread.threadRef)
      .filter(marker => unreadFacts.some(item => item.fact.kind === 'activity' && item.fact.activity.activityRef === marker.activityRef))
    const inbox = this.inboxDelta(nextAttention, [], [], consumed, [], activityMarkers)
    // The hypothetical projection copies every map that its inbox delta can
    // mutate, including the follower sets inside attentionByThread; the fact
    // indexes are read-only here and stay shared.
    const nextProjection: Projection = {
      ...projection,
      attention: new Map(projection.attention),
      directMarkers: new Map(projection.directMarkers),
      activityMarkers: new Map(projection.activityMarkers),
      attentionByThread: new Map([...projection.attentionByThread].map(([threadRef, followers]) => [threadRef, new Set(followers)])),
    }
    this.applyInboxDelta(nextProjection, inbox)
    const remainingUnreadCount = this.unreadForFrom(nextProjection, memberId, thread.threadRef).length
    return Object.freeze({ task, thread, claims: this.claimsForTaskFrom(projection, task.taskRef), anchor,
      anchorMentions: projection.mentionsByMessage.get(anchor.messageRef) ?? [],
      facts: Object.freeze(combined),
      readThroughSequence, remainingUnreadCount, ...(attention === undefined ? {} : { attention: nextAttention[0] ?? attention }),
      consumedDirectMarkers: Object.freeze(consumed), inbox })
  }

  private readFactFrom(projection: Projection, memberId: AgentTeamMemberId, fact: AgentTeamThreadFact, unread: boolean): AgentTeamThreadReadFact {
    return Object.freeze({ fact, unread, direct: fact.kind === 'message'
      && projection.directMarkers.has(this.directMarkerKey({ memberId, threadRef: fact.message.threadRef,
        messageRef: fact.message.messageRef, sequence: fact.sequence })) })
  }

  private unreadFor(memberId: AgentTeamMemberId, threadRef: AgentTeamThreadRef): readonly AgentTeamThreadReadFact[] {
    return this.unreadForFrom(this.state, memberId, threadRef)
  }

  private unreadForFrom(projection: Projection, memberId: AgentTeamMemberId, threadRef: AgentTeamThreadRef): readonly AgentTeamThreadReadFact[] {
    const attention = this.attentionForFrom(projection, memberId, threadRef)
    const facts = this.threadFactsFrom(projection, threadRef)
    const direct = this.directMarkersForFrom(projection, memberId, threadRef)
    const directKeys = new Set(direct.map(marker => this.directMarkerKey(marker)))
    const activityKeys = new Set(this.activityMarkersForFrom(projection, memberId, threadRef).map(marker => this.activityMarkerKey(marker)))
    const result: AgentTeamThreadReadFact[] = []
    for (const fact of facts) {
      const marker = fact.kind === 'message' && directKeys.has(this.directMarkerKey({ memberId, threadRef,
        messageRef: fact.message.messageRef, sequence: fact.sequence }))
      const activityMarker = fact.kind === 'activity' && activityKeys.has(this.activityMarkerKey({ memberId, threadRef,
        activityRef: fact.activity.activityRef, sequence: fact.sequence }))
      const ordinary = attention !== undefined && fact.sequence >= attention.startSequence
        && fact.sequence > attention.readThroughSequence && this.visibleToFollower(fact, memberId)
      if (marker || activityMarker || ordinary) result.push(this.readFactFrom(projection, memberId, fact, true))
    }
    return Object.freeze(result)
  }

  private visibleToFollower(fact: AgentTeamThreadFact, memberId: AgentTeamMemberId): boolean {
    const sender = fact.kind === 'message' ? fact.message.sender : fact.activity.actor
    return sender !== memberId
  }

  private threadFacts(threadRef: AgentTeamThreadRef): readonly AgentTeamThreadFact[] {
    return this.threadFactsFrom(this.state, threadRef)
  }

  private threadFactsFrom(projection: Projection, threadRef: AgentTeamThreadRef): readonly AgentTeamThreadFact[] {
    return projection.factsByThread.get(threadRef) ?? []
  }

  private messageInboxDelta(
    message: AgentTeamMessage,
    sender: AgentTeamMemberId,
    mentions: readonly AgentTeamMemberId[],
    attention: readonly AgentTeamThreadAttention[],
  ): AgentTeamInboxDelta {
    const markers = mentions.map(memberId => Object.freeze({ memberId, threadRef: message.threadRef,
      messageRef: message.messageRef, sequence: message.sequence }))
    return this.inboxDelta(attention, [], markers)
  }

  private closeThreadInbox(activity: AgentTeamTaskActivity, threadRef: AgentTeamThreadRef): AgentTeamInboxDelta {
    return this.closeThreadInboxFrom(this.state, activity, threadRef)
  }

  private closeThreadInboxFrom(projection: Projection, activity: AgentTeamTaskActivity, threadRef: AgentTeamThreadRef): AgentTeamInboxDelta {
    const recipients = [...projection.attention.values()]
      .filter(attention => attention.threadRef === threadRef && attention.memberId !== activity.actor)
      .map(attention => attention.memberId)
    const removed = [...projection.attention.values()].filter(attention => attention.threadRef === threadRef)
      .map(attention => Object.freeze({ memberId: attention.memberId, threadRef: attention.threadRef }))
    const activityMarkers = recipients.map(memberId => Object.freeze({ memberId, threadRef,
      activityRef: activity.activityRef, sequence: activity.sequence }))
    return this.inboxDelta([], removed, [], [...projection.directMarkers.values()].filter(marker => marker.threadRef === threadRef),
      activityMarkers, [...projection.activityMarkers.values()].filter(marker => marker.threadRef === threadRef))
  }

  /**
   * Early acceptance completes open Claims inside the accept operation; their
   * owners learn about it through activity markers regardless of whether they
   * still follow the Thread. Plain accepts (no completed Claims) stay silent.
   */
  private acceptThreadInbox(activity: AgentTeamTaskActivity, threadRef: AgentTeamThreadRef, completedOwners: readonly AgentTeamMemberId[]): AgentTeamInboxDelta {
    if (completedOwners.length === 0) return this.inboxDelta()
    const recipients = [...new Set(completedOwners)].filter(memberId => memberId !== activity.actor)
    const markers = recipients.map(memberId => Object.freeze({ memberId, threadRef,
      activityRef: activity.activityRef, sequence: activity.sequence }))
    return this.inboxDelta([], [], [], [], markers)
  }

  private acceptThreadInboxFrom(projection: Projection, activity: AgentTeamTaskActivity, threadRef: AgentTeamThreadRef, completedClaimRefs: readonly AgentTeamClaimRef[]): AgentTeamInboxDelta {
    if (completedClaimRefs.length === 0) return this.inboxDelta()
    const owners = completedClaimRefs.map(claimRef => projection.claims.get(claimRef)?.owner).filter(owner => owner !== undefined)
    return this.acceptThreadInbox(activity, threadRef, owners)
  }

  private reopenThreadInbox(activity: AgentTeamTaskActivity, threadRef: AgentTeamThreadRef): AgentTeamInboxDelta {
    return this.reopenThreadInboxFrom(this.state, activity, threadRef)
  }

  private reopenThreadInboxFrom(projection: Projection, activity: AgentTeamTaskActivity, threadRef: AgentTeamThreadRef): AgentTeamInboxDelta {
    const recipients = new Set([...projection.activityMarkers.values()]
      .filter(marker => marker.threadRef === threadRef).map(marker => marker.memberId))
    const markers = [...recipients].map(memberId => Object.freeze({ memberId, threadRef,
      activityRef: activity.activityRef, sequence: activity.sequence }))
    return this.inboxDelta([], [], [], [], markers)
  }

  private removeMemberThreadInbox(memberId: AgentTeamMemberId, threadRefs: ReadonlySet<AgentTeamThreadRef>): AgentTeamInboxDelta {
    const removed = [...this.state.attention.values()].filter(attention => attention.memberId === memberId && threadRefs.has(attention.threadRef))
      .map(attention => Object.freeze({ memberId, threadRef: attention.threadRef }))
    const markers = [...this.state.directMarkers.values()].filter(marker => marker.memberId === memberId && threadRefs.has(marker.threadRef))
    const activityMarkers = [...this.state.activityMarkers.values()].filter(marker => marker.memberId === memberId && threadRefs.has(marker.threadRef))
    return this.inboxDelta([], removed, [], markers, [], activityMarkers)
  }

  private inboxDelta(
    set: readonly AgentTeamThreadAttention[] = [],
    removed: readonly AgentTeamThreadAttentionKey[] = [],
    addedMarkers: readonly AgentTeamDirectMarker[] = [],
    removedMarkers: readonly AgentTeamDirectMarker[] = [],
    addedActivityMarkers: readonly AgentTeamActivityMarker[] = [],
    removedActivityMarkers: readonly AgentTeamActivityMarker[] = [],
  ): AgentTeamInboxDelta {
    return Object.freeze({
      attention: Object.freeze({ set: Object.freeze(set), removed: Object.freeze(removed) }),
      directMarkers: Object.freeze({ added: Object.freeze(addedMarkers), removed: Object.freeze(removedMarkers) }),
      activityMarkers: Object.freeze({ added: Object.freeze(addedActivityMarkers), removed: Object.freeze(removedActivityMarkers) }),
    })
  }

  private startAttention(memberId: AgentTeamMemberId, threadRef: AgentTeamThreadRef, startSequence: number): AgentTeamThreadAttention {
    return Object.freeze({ memberId, threadRef, startSequence, readThroughSequence: Math.max(0, startSequence - 1) })
  }

  private followAttention(memberId: AgentTeamMemberId, threadRef: AgentTeamThreadRef): AgentTeamThreadAttention {
    return this.followAttentionFrom(this.state, memberId, threadRef)
  }

  private followAttentionFrom(projection: Projection, memberId: AgentTeamMemberId, threadRef: AgentTeamThreadRef): AgentTeamThreadAttention {
    const tail = this.threadFactsFrom(projection, threadRef).at(-1)?.sequence ?? 1
    return Object.freeze({ memberId, threadRef, startSequence: tail + 1, readThroughSequence: tail })
  }

  private currentTail(threadRef: AgentTeamThreadRef): number {
    return this.threadFacts(threadRef).at(-1)?.sequence ?? 1
  }

  private attentionFor(memberId: AgentTeamMemberId, threadRef: AgentTeamThreadRef): AgentTeamThreadAttention | undefined {
    return this.attentionForFrom(this.state, memberId, threadRef)
  }

  private attentionForFrom(projection: Projection, memberId: AgentTeamMemberId, threadRef: AgentTeamThreadRef): AgentTeamThreadAttention | undefined {
    return projection.attention.get(this.attentionKey(memberId, threadRef))
  }

  private isFollowing(threadRef: AgentTeamThreadRef, memberId: AgentTeamMemberId): boolean {
    return this.attentionFor(memberId, threadRef) !== undefined
  }

  private isFollowingFrom(projection: Projection, threadRef: AgentTeamThreadRef, memberId: AgentTeamMemberId): boolean {
    return this.attentionForFrom(projection, memberId, threadRef) !== undefined
  }

  private directMarkersFor(memberId: AgentTeamMemberId, threadRef: AgentTeamThreadRef): readonly AgentTeamDirectMarker[] {
    return this.directMarkersForFrom(this.state, memberId, threadRef)
  }

  private directMarkersForFrom(projection: Projection, memberId: AgentTeamMemberId, threadRef: AgentTeamThreadRef): readonly AgentTeamDirectMarker[] {
    return Object.freeze([...projection.directMarkers.values()].filter(marker => marker.memberId === memberId && marker.threadRef === threadRef)
      .sort((left, right) => left.sequence - right.sequence))
  }

  private activityMarkersForFrom(projection: Projection, memberId: AgentTeamMemberId, threadRef: AgentTeamThreadRef): readonly AgentTeamActivityMarker[] {
    return Object.freeze([...projection.activityMarkers.values()].filter(marker => marker.memberId === memberId && marker.threadRef === threadRef)
      .sort((left, right) => left.sequence - right.sequence))
  }

  private issueConfirmation(
    actor: AgentTeamHumanActor | AgentTeamMemberActor,
    workspaceId: WorkspaceId,
    channelRef: AgentTeamChannelRef,
    body: string,
    recipients: readonly AgentTeamMemberId[],
    task?: AgentTeamTask,
    thread?: AgentTeamThread,
  ): AgentTeamConfirmationRequired {
    if (actor.kind !== 'human') throw new Error('only Human may invite an unfollowed Agent')
    for (const [token, confirmation] of this.confirmations) if (confirmation.actor === actor.memberId) this.confirmations.delete(token)
    const confirmationToken = `confirmation:${randomUUID()}` as AgentTeamConfirmationToken
    this.confirmations.set(confirmationToken, Object.freeze({ actor: actor.memberId, workspaceId, channelRef,
      ...(task === undefined ? {} : { taskRef: task.taskRef }), ...(thread === undefined ? {} : { threadRef: thread.threadRef }),
      body, recipients, attention: recipients.map(memberId => thread !== undefined && this.isFollowing(thread.threadRef, memberId)),
      memberStates: recipients.map(memberId => this.state.members.get(memberId)?.state ?? 'enabled') }))
    return Object.freeze({ kind: 'confirmation_required', confirmationToken, workspaceId, channelRef,
      recipients: Object.freeze(recipients.filter(memberId => this.state.members.has(memberId) && (thread === undefined || !this.isFollowing(thread.threadRef, memberId)))),
      ...(task === undefined ? {} : { taskRef: task.taskRef }), ...(thread === undefined ? {} : { threadRef: thread.threadRef, revision: thread.revision }) })
  }

  private consumeConfirmation(
    token: AgentTeamConfirmationToken,
    actor: AgentTeamHumanActor | AgentTeamMemberActor,
    workspaceId: WorkspaceId,
    channelRef: AgentTeamChannelRef,
    task: AgentTeamTask | undefined,
    thread: AgentTeamThread | undefined,
    body: string,
    recipients: readonly AgentTeamMemberId[],
  ): void {
    const confirmation = this.confirmations.get(token)
    this.confirmations.delete(token)
    const attention = recipients.map(memberId => thread !== undefined && this.isFollowing(thread.threadRef, memberId))
    const states = recipients.map(memberId => this.state.members.get(memberId)?.state ?? 'enabled')
    if (confirmation === undefined || confirmation.actor !== actor.memberId || confirmation.workspaceId !== workspaceId
      || confirmation.channelRef !== channelRef || confirmation.taskRef !== task?.taskRef || confirmation.threadRef !== thread?.threadRef
      || confirmation.body !== body || !this.sameList(confirmation.recipients, recipients)
      || !this.sameList(confirmation.attention, attention) || !this.sameList(confirmation.memberStates, states)) {
      throw new Error('confirmation token is invalid or expired')
    }
  }

  private assertMentionTargets(channel: AgentTeamChannel, recipients: readonly AgentTeamMemberId[]): void {
    for (const memberId of recipients) {
      if (memberId === AGENT_TEAM_HUMAN_MEMBER_ID) continue
      const member = this.requireMember(memberId)
      if (member.state === 'inactive' || member.workspaceId !== channel.workspaceId || !this.isChannelMember(channel.channelRef, memberId)) {
        throw new Error(`Agent Member '${memberId}' is not authorized for Channel '${channel.channelRef}'`)
      }
    }
  }

  private memberNotFollowing(
    workspaceId: WorkspaceId,
    channelRef: AgentTeamChannelRef,
    memberIds: readonly AgentTeamMemberId[],
    task?: AgentTeamTask,
    thread?: AgentTeamThread,
  ) {
    return Object.freeze({ kind: 'member_not_following' as const, workspaceId, channelRef, memberIds: Object.freeze(memberIds),
      ...(task === undefined ? {} : { taskRef: task.taskRef }), ...(thread === undefined ? {} : { threadRef: thread.threadRef, revision: thread.revision }) })
  }

  private unreadRequired(task: AgentTeamTask, thread: AgentTeamThread, unread: readonly AgentTeamThreadReadFact[]): AgentTeamUnreadRequired {
    return Object.freeze({ kind: 'unread_required', taskRef: task.taskRef, threadRef: thread.threadRef,
      revision: thread.revision, unreadCount: unread.length, directCount: unread.filter(item => item.direct).length })
  }

  private staleRevision(task: AgentTeamTask, thread: AgentTeamThread, expectedRevision: number): AgentTeamStaleRevision {
    return Object.freeze({ kind: 'stale_revision', taskRef: task.taskRef, threadRef: thread.threadRef,
      expectedRevision, revision: thread.revision })
  }

  private releaseSummaries(
    claims: readonly AgentTeamClaim[],
    actor: AgentTeamMemberId,
    sequence: number,
  ): readonly AgentTeamClaimsReleasedActivity[] {
    const byThread = new Map<AgentTeamThreadRef, AgentTeamClaim[]>()
    for (const claim of claims) {
      const grouped = byThread.get(claim.threadRef) ?? []
      grouped.push(claim)
      byThread.set(claim.threadRef, grouped)
    }
    return Object.freeze([...byThread.entries()].map(([threadRef, grouped]) => Object.freeze({ activityRef: this.ref('activity'),
      kind: 'claims_released' as const, taskRef: grouped[0]!.taskRef, threadRef, actor, sequence,
      claimRefs: Object.freeze(grouped.map(claim => claim.claimRef).sort()) })))
  }

  private threadsForActivities(activities: readonly AgentTeamClaimsReleasedActivity[]): readonly AgentTeamThread[] {
    return Object.freeze(activities.map(activity => Object.freeze({ ...this.requireThread(activity.threadRef), revision: activity.sequence })))
  }

  private claimsForTask(taskRef: AgentTeamTaskRef): readonly AgentTeamClaim[] {
    return this.claimsForTaskFrom(this.state, taskRef)
  }

  private claimsForTaskFrom(projection: Projection, taskRef: AgentTeamTaskRef): readonly AgentTeamClaim[] {
    return Object.freeze([...projection.claims.values()].filter(claim => claim.taskRef === taskRef))
  }

  private claimsForVisibleTasks(tasks: readonly AgentTeamTask[]): readonly AgentTeamClaim[] {
    const refs = new Set(tasks.map(task => task.taskRef))
    return Object.freeze([...this.state.claims.values()].filter(claim => refs.has(claim.taskRef)))
  }

  private tasksForClaims(claims: readonly AgentTeamClaim[], projected: ReadonlyMap<AgentTeamClaimRef, AgentTeamClaim>): readonly AgentTeamTask[] {
    return Object.freeze([...new Set(claims.map(claim => claim.taskRef))].map(taskRef => {
      const task = this.state.tasks.get(taskRef)!
      return Object.freeze({ ...task, status: this.deriveResolvedTaskStatus(task, projected.values()) })
    }))
  }

  private threadAnchor(task: AgentTeamTask): AgentTeamMessage {
    return this.threadAnchorFrom(this.state, task)
  }

  private threadAnchorFrom(projection: Projection, task: AgentTeamTask): AgentTeamMessage {
    const anchor = projection.messages.find(message => message.taskRef === task.taskRef && message.topLevel)
    if (anchor === undefined) throw new Error(`Task '${task.taskRef}' has no anchor Message`)
    return anchor
  }

  private threadFactKey(fact: AgentTeamThreadFact): string {
    return fact.kind === 'message' ? `message:${fact.message.messageRef}` : `activity:${fact.activity.activityRef}`
  }

  /**
   * Display numbers for Tasks: one counter per home Channel, in creation
   * order. This is the single numbering authority — Channel cards, Thread
   * headings, cross-channel ref resolution, and inbox renders all show the
   * ordinal the Task holds inside its own Channel.
   */
  private taskNumbers(workspaceId: WorkspaceId): Map<AgentTeamTaskRef, number> {
    const numbers = new Map<AgentTeamTaskRef, number>()
    const next = new Map<AgentTeamChannelRef, number>()
    for (const message of this.state.topLevelMessages) {
      if (this.state.channels.get(message.channelRef)?.workspaceId !== workspaceId) continue
      const ordinal = (next.get(message.channelRef) ?? 0) + 1
      next.set(message.channelRef, ordinal)
      numbers.set(message.taskRef, ordinal)
    }
    return numbers
  }

  private hasActiveClaim(memberId: AgentTeamMemberId, taskRef: AgentTeamTaskRef): boolean {
    return this.hasActiveClaimFrom(this.state, memberId, taskRef)
  }

  private hasActiveClaimFrom(projection: Projection, memberId: AgentTeamMemberId, taskRef: AgentTeamTaskRef): boolean {
    return [...projection.claims.values()].some(claim => claim.owner === memberId && claim.taskRef === taskRef && claim.state === 'active')
  }

  private deriveResolvedTaskStatus(task: AgentTeamTask, claims: Iterable<AgentTeamClaim>): AgentTeamTask['status'] {
    return task.resolution === 'accepted' ? 'done' : task.resolution === 'closed' ? 'closed' : this.deriveTaskStatus(task.taskRef, claims)
  }

  private deriveTaskStatus(taskRef: AgentTeamTaskRef, claims: Iterable<AgentTeamClaim>): AgentTeamTask['status'] {
    const relevant = [...claims].filter(claim => claim.taskRef === taskRef)
    if (relevant.some(claim => claim.state === 'active')) return 'in_progress'
    if (relevant.some(claim => claim.state === 'done')) return 'in_review'
    return 'todo'
  }

  private setMemberState(request: AgentTeamAuthorizedSetMemberStateRequest, state: 'enabled' | 'suspended'): Promise<AgentTeamLedgerResult<AgentTeamDurableMemberResult>> {
    return this.enqueue(async () => {
      const existing = this.state.byRequest.get(request.requestId)
      if (existing !== undefined) {
        this.assertSameMemberState(existing, request, state)
        return this.resolved(this.memberResult(existing))
      }
      this.assertHumanActor(request.actor)
      const member = this.requireMember(request.memberId)
      const prior = state === 'suspended' ? 'enabled' : 'suspended'
      if (member.state !== prior) throw new Error(`Agent Member '${member.memberId}' is already ${member.state}`)
      const next = Object.freeze({ ...member, state })
      const operation: AgentTeamMemberSuspendedOperation | AgentTeamMemberResumedOperation = state === 'suspended'
        ? Object.freeze({ ...this.operationBase(request, this.nextSequence()), kind: 'team/member-suspended', data: Object.freeze({ member: next }) })
        : Object.freeze({ ...this.operationBase(request, this.nextSequence()), kind: 'team/member-resumed', data: Object.freeze({ member: next }) })
      await this.table.put(operation.operationId, operation)
      this.apply(operation)
      this.confirmations.clear()
      return this.committed(this.memberResult(operation))
    })
  }

  private assertActorForWorkspace(actor: AgentTeamHumanActor | AgentTeamMemberActor, workspaceId: WorkspaceId): AgentTeamHumanActor | AgentTeamMemberActor {
    if (actor.kind === 'human') {
      this.assertHumanActor(actor)
      return actor
    }
    const member = this.assertMemberActor(actor)
    if (member.workspaceId !== workspaceId) throw new Error('Member cannot mutate another Workspace')
    return actor
  }

  private assertHumanActor(actor: AgentTeamHumanActor): void {
    const initialization = this.initialization()
    if (actor.kind !== 'human' || actor.memberId !== initialization.data.humanMemberId || actor.handle !== HUMAN_ACTOR.handle) {
      throw new Error('agent-team operation lacks Human authority')
    }
  }

  private assertMemberActor(actor: AgentTeamMemberActor): AgentTeamAgentMember {
    const member = this.requireMember(actor.memberId)
    if (member.state !== 'enabled' || member.handle !== actor.handle) throw new Error('agent-team operation lacks enabled Member authority')
    return member
  }

  /** Agents sometimes strip the branded prefix when echoing refs; point at the fix instead of a bare lookup failure. */
  private unknownRefHint(ref: string, prefix: string, label: string): string {
    return ref.startsWith(`${prefix}:`) ? ''
      : ` A ${label} ref must start with '${prefix}:'; reuse the full ref exactly as returned by Team tools ('${prefix}:${ref}').`
  }

  private requireTask(workspaceId: WorkspaceId, taskRef: AgentTeamTaskRef): AgentTeamTask {
    const task = this.state.tasks.get(taskRef)
    if (task === undefined) throw new Error(`unknown Task ref '${taskRef}'${this.unknownRefHint(taskRef, 'task', 'Task')}`)
    if (this.state.channels.get(task.channelRef)?.workspaceId !== workspaceId) throw new Error(`Task '${taskRef}' does not belong to Workspace '${workspaceId}'`)
    return task
  }

  private requireThread(threadRef: AgentTeamThreadRef): AgentTeamThread {
    const thread = this.state.threads.get(threadRef)
    if (thread === undefined) throw new Error(`unknown Thread ref '${threadRef}'${this.unknownRefHint(threadRef, 'thread', 'Thread')}`)
    return thread
  }

  private requireChannel(workspaceId: WorkspaceId, channelRef: AgentTeamChannelRef): AgentTeamChannel {
    const channel = this.state.channels.get(channelRef)
    if (channel === undefined) throw new Error(`unknown Channel ref '${channelRef}'${this.unknownRefHint(channelRef, 'channel', 'Channel')}`)
    if (channel.workspaceId !== workspaceId) throw new Error(`Channel '${channelRef}' does not belong to Workspace '${workspaceId}'`)
    return channel
  }

  private requireMember(memberId: AgentTeamMemberId): AgentTeamAgentMember {
    const member = this.state.members.get(memberId)
    if (member === undefined) throw new Error(`unknown Agent Member '${memberId}'`)
    return member
  }

  private requireMemberChannel(member: AgentTeamAgentMember, channelRef: AgentTeamChannelRef): void {
    if (!this.isChannelMember(channelRef, member.memberId)) throw new Error(`Agent Member '${member.memberId}' is not authorized for Channel '${channelRef}'`)
  }

  private isChannelMember(channelRef: AgentTeamChannelRef, memberId: AgentTeamMemberId): boolean {
    return this.state.memberships.get(channelRef)?.has(memberId) === true
  }

  private isChannelMemberFrom(projection: Projection, channelRef: AgentTeamChannelRef, memberId: AgentTeamMemberId): boolean {
    return projection.memberships.get(channelRef)?.has(memberId) === true
  }

  private channelThreadRefs(channelRef: AgentTeamChannelRef): Set<AgentTeamThreadRef> {
    return new Set([...this.state.tasks.values()].filter(task => task.channelRef === channelRef).map(task => task.threadRef))
  }

  private assertJoinableMember(workspaceId: WorkspaceId, memberId: AgentTeamMemberId): void {
    const member = this.requireMember(memberId)
    if (member.workspaceId !== workspaceId) throw new Error(`Agent Member '${memberId}' does not belong to Workspace '${workspaceId}'`)
    if (member.state !== 'enabled') throw new Error(`Agent Member '${memberId}' is ${member.state}; only enabled Members can join a Channel`)
  }

  private normalizeRecipients(actor: AgentTeamHumanActor | AgentTeamMemberActor, recipients: readonly AgentTeamMemberId[] | undefined): readonly AgentTeamMemberId[] {
    const normalized = this.normalizeUnique(recipients, 'recipient set')
    if (normalized.includes(actor.memberId)) throw new Error('sender cannot be a recipient intent')
    return normalized
  }

  private normalizeUnique<T extends string>(values: readonly T[] | undefined, label: string): readonly T[] {
    const unique = new Set(values ?? [])
    if (unique.size !== (values?.length ?? 0)) throw new Error(`${label} contains duplicate Member refs`)
    return Object.freeze([...unique].sort())
  }

  private normalizeDirection(direction: string): string {
    return direction.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase()
  }

  private assertHandleAvailable(workspaceId: WorkspaceId, handle: string, exceptMemberId?: AgentTeamMemberId): void {
    const normalized = handle.normalize('NFKC').trim().toLowerCase()
    if ([...this.state.members.values()].some(member => member.memberId !== exceptMemberId && member.state !== 'inactive'
      && member.workspaceId === workspaceId
      && member.handle.normalize('NFKC').trim().toLowerCase() === normalized)) {
      throw new Error(`Agent Member handle '${handle}' is already active in Workspace '${workspaceId}'`)
    }
  }

  /** Provider route and model id are exact identifiers; only whitespace-only values are rejected. */
  private assertModelSelection(model: AgentTeamUpdateMemberRequest['model']): void {
    if (model === undefined) return
    if (model.provider.trim() === '' || model.model.trim() === '') throw new Error('member model selection must name a provider route and a model id')
  }

  private initialization(): AgentTeamInitializedOperation {
    const operation = this.state.ordered[0]
    if (operation === undefined) throw new Error('agent-team ledger is not initialized')
    this.assertInitializationRecord(operation)
    return operation
  }

  private assertInitializationRecord(operation: AgentTeamOperation): asserts operation is AgentTeamInitializedOperation {
    if (operation.kind !== 'team/initialized' || operation.sequence !== 1 || operation.previousOperationId !== null
      || operation.actor.kind !== 'human' || operation.actor.memberId !== operation.data.humanMemberId) {
      throw new Error('agent-team initialization operation has an invalid payload')
    }
  }

  private assertSameInitialization(operation: AgentTeamOperation, request: AgentTeamInitializeRequest): asserts operation is AgentTeamInitializedOperation {
    if (operation.kind !== 'team/initialized' || !this.sameActor(operation.actor, request.actor) || operation.data.humanMemberId !== request.humanMemberId) this.throwRequestCollision(request.requestId)
  }

  private assertSameChannelCreation(operation: AgentTeamOperation, request: AgentTeamAuthorizedCreateChannelRequest, memberIds: readonly AgentTeamMemberId[]): asserts operation is AgentTeamChannelCreatedOperation {
    if (operation.kind !== 'team/channel-created' || !this.sameActor(operation.actor, request.actor)
      || operation.data.workspaceId !== request.workspaceId || operation.data.channel.name !== request.name.trim()
      || operation.data.channel.description !== request.description.trim() || !this.sameList(operation.data.memberIds, memberIds)) this.throwRequestCollision(request.requestId)
  }

  private assertSameMemberAdd(operation: AgentTeamOperation, request: AgentTeamAuthorizedAddMemberRequest): asserts operation is AgentTeamMemberAddedOperation {
    if (operation.kind !== 'team/member-added' || !this.sameActor(operation.actor, request.actor)
      || operation.data.member.workspaceId !== request.workspaceId || operation.data.member.handle !== request.handle.trim()
      || operation.data.member.description !== request.description.trim() || operation.data.member.presetId !== request.presetId.trim()
      || !isDeepStrictEqual(operation.data.member.model ?? undefined, request.member.model ?? undefined)
      || !this.sameList(operation.data.channelRefs, this.normalizeUnique(request.channelRefs, 'initial Member Channels'))) this.throwRequestCollision(request.requestId)
  }

  private assertSameMemberState(operation: AgentTeamOperation, request: AgentTeamAuthorizedSetMemberStateRequest, state: 'enabled' | 'suspended'): asserts operation is AgentTeamMemberSuspendedOperation | AgentTeamMemberResumedOperation {
    const kind = state === 'suspended' ? 'team/member-suspended' : 'team/member-resumed'
    if (operation.kind !== kind || !this.sameActor(operation.actor, request.actor) || operation.data.member.memberId !== request.memberId) this.throwRequestCollision(request.requestId)
  }

  private assertSameChannelUpdate(operation: AgentTeamOperation, request: AgentTeamAuthorizedUpdateChannelRequest): asserts operation is AgentTeamChannelUpdatedOperation {
    if (operation.kind !== 'team/channel-updated' || !this.sameActor(operation.actor, request.actor)
      || operation.data.workspaceId !== request.workspaceId || operation.data.channel.channelRef !== request.channelRef
      || operation.data.channel.name !== request.name.trim() || operation.data.channel.description !== request.description.trim()) this.throwRequestCollision(request.requestId)
  }

  private assertSameMemberUpdate(operation: AgentTeamOperation, request: AgentTeamAuthorizedUpdateMemberRequest): asserts operation is AgentTeamMemberUpdatedOperation {
    if (operation.kind !== 'team/member-updated' || !this.sameActor(operation.actor, request.actor)
      || operation.data.member.memberId !== request.memberId || operation.data.member.handle !== request.handle.trim()
      || operation.data.member.description !== request.description.trim()
      || !isDeepStrictEqual(operation.data.member.model ?? undefined, request.model ?? undefined)) this.throwRequestCollision(request.requestId)
  }

  private assertSameChannelJoin(operation: AgentTeamOperation, request: AgentTeamAuthorizedJoinChannelRequest): asserts operation is AgentTeamChannelMemberAddedOperation {
    if (operation.kind !== 'team/channel-member-added' || !this.sameActor(operation.actor, request.actor)
      || operation.data.workspaceId !== request.workspaceId || operation.data.channelRef !== request.channelRef || operation.data.memberId !== request.memberId) this.throwRequestCollision(request.requestId)
  }

  private assertSameChannelMemberRemoval(operation: AgentTeamOperation, request: AgentTeamAuthorizedRemoveChannelMemberRequest): asserts operation is AgentTeamChannelMemberRemovedOperation {
    if (operation.kind !== 'team/channel-member-removed' || !this.sameActor(operation.actor, request.actor)
      || operation.data.workspaceId !== request.workspaceId || operation.data.channelRef !== request.channelRef || operation.data.memberId !== request.memberId) this.throwRequestCollision(request.requestId)
  }

  private assertSameMessage(operation: AgentTeamOperation, request: AgentTeamAuthorizedSendMessageRequest, recipients: readonly AgentTeamMemberId[]): asserts operation is AgentTeamMessageSentOperation {
    if (operation.kind !== 'team/message-sent' || !this.sameActor(operation.actor, request.actor)
      || operation.data.workspaceId !== request.workspaceId || operation.data.message.channelRef !== request.channelRef
      || operation.data.message.body !== request.body.trim() || !this.sameList(operation.data.mentions, recipients)
      || !this.sameList(operation.data.message.attachments?.map(attachment => attachment.attachmentId) ?? [], request.attachments ?? [])) this.throwRequestCollision(request.requestId)
  }

  private assertSameReply(operation: AgentTeamOperation, request: AgentTeamAuthorizedReplyRequest, recipients: readonly AgentTeamMemberId[]): asserts operation is AgentTeamThreadRepliedOperation {
    if (operation.kind !== 'team/thread-replied' || !this.sameActor(operation.actor, request.actor)
      || operation.data.workspaceId !== request.workspaceId || operation.data.message.taskRef !== request.taskRef
      || operation.data.message.body !== request.body.trim() || operation.data.baseRevision !== request.baseRevision
      || !this.sameList(operation.data.mentions, recipients)) this.throwRequestCollision(request.requestId)
  }

  private assertSameClaim(operation: AgentTeamOperation, request: AgentTeamAuthorizedClaimRequest): asserts operation is AgentTeamClaimChangedOperation {
    const kind = request.action === 'claim' ? 'team/claim-created' : request.action === 'done' ? 'team/claim-done' : 'team/claim-released'
    if (operation.kind !== kind || !this.sameActor(operation.actor, request.actor) || operation.data.workspaceId !== request.workspaceId
      || operation.data.task.taskRef !== request.taskRef || operation.data.baseRevision !== request.baseRevision
      || (request.action === 'claim' ? operation.data.claim.direction !== request.direction?.trim() : operation.data.claim.claimRef !== request.claimRef)) this.throwRequestCollision(request.requestId)
  }

  private assertSameTask(operation: AgentTeamOperation, request: AgentTeamAuthorizedTaskRequest): asserts operation is AgentTeamTaskChangedOperation {
    if (operation.kind !== 'team/task-changed' || !this.sameActor(operation.actor, request.actor)
      || operation.data.workspaceId !== request.workspaceId || operation.data.task.taskRef !== request.taskRef
      || operation.data.baseRevision !== request.baseRevision || operation.data.activity.kind !== request.action) this.throwRequestCollision(request.requestId)
  }

  private assertSameRemoval(operation: AgentTeamOperation, request: AgentTeamAuthorizedRemoveMemberRequest): asserts operation is AgentTeamMemberRemovedOperation {
    if (operation.kind !== 'team/member-removed' || !this.sameActor(operation.actor, request.actor)
      || operation.data.member.memberId !== request.memberId) this.throwRequestCollision(request.requestId)
  }

  private assertSameAttention(operation: AgentTeamOperation, request: AgentTeamAuthorizedThreadAttentionRequest): asserts operation is AgentTeamThreadAttentionChangedOperation {
    if (operation.kind !== 'team/thread-attention-changed' || !this.sameActor(operation.actor, request.actor)
      || operation.data.workspaceId !== request.workspaceId || operation.data.task.taskRef !== request.taskRef || operation.data.action !== request.action) this.throwRequestCollision(request.requestId)
  }

  private assertSameThreadRead(operation: AgentTeamOperation, request: AgentTeamAuthorizedThreadReadRequest): asserts operation is AgentTeamThreadReadOperation {
    if (operation.kind !== 'team/thread-read' || !this.sameActor(operation.actor, request.actor)
      || operation.data.workspaceId !== request.workspaceId || operation.data.task.taskRef !== request.taskRef) this.throwRequestCollision(request.requestId)
  }

  private sameTask(left: AgentTeamTask, right: AgentTeamTask): boolean {
    return this.sameTaskIdentity(left, right) && left.status === right.status && left.resolution === right.resolution
  }

  private sameTaskIdentity(left: AgentTeamTask, right: AgentTeamTask): boolean {
    return left.taskRef === right.taskRef && left.channelRef === right.channelRef && left.threadRef === right.threadRef
  }

  private sameClaim(left: AgentTeamClaim, right: AgentTeamClaim): boolean {
    return this.sameClaimIdentity(left, right) && left.state === right.state
  }

  private sameClaimIdentity(left: AgentTeamClaim, right: AgentTeamClaim): boolean {
    return left.claimRef === right.claimRef && left.taskRef === right.taskRef && left.threadRef === right.threadRef
      && left.owner === right.owner && left.direction === right.direction && left.normalizedDirection === right.normalizedDirection
  }

  private sameThread(left: AgentTeamThread, right: AgentTeamThread): boolean {
    return left.threadRef === right.threadRef && left.taskRef === right.taskRef && left.revision === right.revision
  }

  private sameMemberIdentity(left: AgentTeamAgentMember, right: AgentTeamAgentMember): boolean {
    return left.memberId === right.memberId && left.sessionId === right.sessionId && left.workspaceId === right.workspaceId
      && left.handle === right.handle && left.description === right.description && left.presetId === right.presetId
      && isDeepStrictEqual(left.model ?? undefined, right.model ?? undefined)
      && left.privateMemoryPath === right.privateMemoryPath
  }

  private sameActor(left: AgentTeamHumanActor | AgentTeamMemberActor, right: AgentTeamHumanActor | AgentTeamMemberActor): boolean {
    return left.kind === right.kind && left.memberId === right.memberId && left.handle === right.handle
  }

  private sameList<T>(left: readonly T[], right: readonly T[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index])
  }

  private attentionKey(memberId: AgentTeamMemberId, threadRef: AgentTeamThreadRef): string {
    return `${memberId}\u0000${threadRef}`
  }

  private directMarkerKey(marker: Pick<AgentTeamDirectMarker, 'memberId' | 'threadRef' | 'messageRef'> & Partial<Pick<AgentTeamDirectMarker, 'sequence'>>): string {
    return `${marker.memberId}\u0000${marker.threadRef}\u0000${marker.messageRef}`
  }

  private activityMarkerKey(marker: Pick<AgentTeamActivityMarker, 'memberId' | 'threadRef' | 'activityRef'> & Partial<Pick<AgentTeamActivityMarker, 'sequence'>>): string {
    return `${marker.memberId}\u0000${marker.threadRef}\u0000${marker.activityRef}`
  }

  private addMembership(target: Pick<Projection, 'memberships'>, channelRef: AgentTeamChannelRef, memberId: AgentTeamMemberId): void {
    const members = target.memberships.get(channelRef) ?? new Set<AgentTeamMemberId>()
    members.add(memberId)
    target.memberships.set(channelRef, members)
  }

  private addRef(refs: Set<string>, ref: string): void {
    if (refs.has(ref)) throw new Error(`agent-team ledger repeats entity ref '${ref}'`)
    refs.add(ref)
  }

  private throwRequestCollision(requestId: AgentTeamRequestId): never {
    throw new Error(`agent-team request id '${requestId}' was reused with a different operation or payload`)
  }

  private channelResult(operation: AgentTeamChannelCreatedOperation): AgentTeamCreateChannelResult {
    return Object.freeze({ receipt: this.receipt(operation), channel: operation.data.channel, memberIds: operation.data.memberIds })
  }

  private channelUpdateResult(operation: AgentTeamChannelUpdatedOperation): AgentTeamUpdateChannelResult {
    return Object.freeze({ receipt: this.receipt(operation), channel: operation.data.channel })
  }

  private memberResult(operation: AgentTeamMemberAddedOperation | AgentTeamMemberSuspendedOperation | AgentTeamMemberResumedOperation | AgentTeamMemberSessionRestartedOperation | AgentTeamMemberUpdatedOperation): AgentTeamDurableMemberResult {
    return Object.freeze({ receipt: this.receipt(operation), member: operation.data.member })
  }

  private joinResult(operation: AgentTeamChannelMemberAddedOperation): AgentTeamJoinChannelResult {
    return Object.freeze({ receipt: this.receipt(operation), channelRef: operation.data.channelRef, memberId: operation.data.memberId })
  }

  private channelMemberRemovalResult(operation: AgentTeamChannelMemberRemovedOperation): AgentTeamRemoveChannelMemberResult {
    return Object.freeze({ receipt: this.receipt(operation), channelRef: operation.data.channelRef, memberId: operation.data.memberId,
      releasedClaims: operation.data.claims, removedAttention: operation.data.inbox.attention.removed })
  }

  private messageResult(operation: AgentTeamMessageSentOperation): Extract<AgentTeamSendMessageResult, { kind: 'committed' }> {
    return Object.freeze({ kind: 'committed', receipt: this.receipt(operation), message: operation.data.message,
      task: operation.data.task, thread: operation.data.thread, attention: operation.data.inbox.attention.set,
      directMarkers: operation.data.inbox.directMarkers.added })
  }

  private replyResult(operation: AgentTeamThreadRepliedOperation): Extract<AgentTeamReplyResult, { kind: 'committed' }> {
    return Object.freeze({ kind: 'committed', receipt: this.receipt(operation), message: operation.data.message,
      task: operation.data.task, thread: operation.data.thread, attention: operation.data.inbox.attention.set,
      directMarkers: operation.data.inbox.directMarkers.added })
  }

  private claimResult(operation: AgentTeamClaimChangedOperation): Extract<AgentTeamClaimResult, { kind: 'committed' }> {
    const attention = operation.data.inbox.attention.set.find(candidate => candidate.memberId === operation.data.claim.owner)
    const base = { kind: 'committed' as const, receipt: this.receipt(operation), activity: operation.data.activity,
      claim: operation.data.claim, task: operation.data.task, thread: operation.data.thread }
    return attention === undefined ? Object.freeze(base) : Object.freeze({ ...base, attention })
  }

  private taskResult(operation: AgentTeamTaskChangedOperation): Extract<AgentTeamTaskResult, { kind: 'committed' }> {
    return Object.freeze({ kind: 'committed', receipt: this.receipt(operation), activity: operation.data.activity,
      task: operation.data.task, thread: operation.data.thread, claims: operation.data.claims })
  }

  private attentionResult(operation: AgentTeamThreadAttentionChangedOperation): AgentTeamThreadAttentionResult {
    return Object.freeze({ receipt: this.receipt(operation), task: operation.data.task, thread: operation.data.thread,
      ...(operation.data.inbox.attention.set[0] === undefined ? {} : { attention: operation.data.inbox.attention.set[0] }) })
  }

  private threadReadResult(operation: AgentTeamThreadReadOperation): AgentTeamThreadReadResult {
    // Loaded records are normalized by sortedRecords(); fresh writes always carry instants.
    const { anchor, facts } = operation.data as unknown as { anchor: AgentTeamMessage; facts: readonly AgentTeamThreadReadFact[] }
    return Object.freeze({ receipt: this.receipt(operation), task: operation.data.task, thread: operation.data.thread,
      claims: operation.data.claims, anchor, anchorMentions: operation.data.anchorMentions, facts,
      readThroughSequence: operation.data.readThroughSequence, remainingUnreadCount: operation.data.remainingUnreadCount,
      ...(operation.data.attention === undefined ? {} : { attention: operation.data.attention }),
      consumedDirectMarkers: operation.data.inbox.directMarkers.removed })
  }

  private receipt(operation: AgentTeamOperation): AgentTeamOperationReceipt {
    return Object.freeze({ operationId: operation.operationId, requestId: operation.requestId, sequence: operation.sequence })
  }

  private removalResult(operation: AgentTeamMemberRemovedOperation): AgentTeamRemoveMemberResult {
    return Object.freeze({ receipt: this.receipt(operation), member: operation.data.member,
      releasedClaims: operation.data.claims, removedAttention: operation.data.inbox.attention.removed })
  }

  private operationBase(request: { readonly requestId: AgentTeamRequestId; readonly actor: AgentTeamHumanActor | AgentTeamMemberActor }, sequence: number) {
    return { sequence, operationId: this.createOperationId(), requestId: request.requestId, occurredAt: this.createOccurredAt(),
      actor: Object.freeze({ ...request.actor }), previousOperationId: this.state.ordered.at(-1)?.operationId ?? null }
  }

  private nextSequence(): number {
    if (this.state.ordered.length === 0) throw new Error('agent-team ledger is not initialized')
    return this.state.ordered.length + 1
  }

  private ref(kind: 'channel'): AgentTeamChannelRef
  private ref(kind: 'message'): AgentTeamMessageRef
  private ref(kind: 'task'): AgentTeamTaskRef
  private ref(kind: 'thread'): AgentTeamThreadRef
  private ref(kind: 'claim'): AgentTeamClaimRef
  private ref(kind: 'activity'): AgentTeamActivityRef
  private ref(kind: 'channel' | 'message' | 'task' | 'thread' | 'claim' | 'activity') {
    return this.createRef(kind)
  }

  private committed<T>(value: T): AgentTeamLedgerResult<T> { return Object.freeze({ value, committed: true }) }
  private resolved<T>(value: T): AgentTeamLedgerResult<T> { return Object.freeze({ value, committed: false }) }

  private sortedRecords(): Array<[AgentTeamOperationId, AgentTeamOperation]> {
    const records = [...this.table.entries()].sort((left, right) => left[1].sequence - right[1].sequence)
    const occurrences = new Map<AgentTeamMessageRef, string>()
    for (const [, operation] of records) {
      if (operation.kind === 'team/message-sent' || operation.kind === 'team/thread-replied') {
        occurrences.set(operation.data.message.messageRef, operation.data.message.occurredAt ?? operation.occurredAt)
      }
    }
    return records.map(([id, operation]) => [id, this.normalizeOperation(operation, occurrences)])
  }

  /** Ledgers written before message occurredAt existed store bare messages; Thread reads resolve instants from the originating operations. */
  private normalizeOperation(operation: AgentTeamOperation, occurrences: Map<AgentTeamMessageRef, string>): AgentTeamOperation {
    if (operation.kind !== 'team/thread-read') return operation
    const stamp = (message: AgentTeamStoredMessage): AgentTeamMessage => (
      message.occurredAt === undefined
        ? { ...message, occurredAt: occurrences.get(message.messageRef) ?? operation.occurredAt }
        : { ...message, occurredAt: message.occurredAt }
    )
    const facts = operation.data.facts.map((fact): AgentTeamThreadReadFact => (
      fact.fact.kind === 'message'
        ? { ...fact, fact: { kind: 'message', sequence: fact.fact.sequence, message: stamp(fact.fact.message),
          mentions: fact.fact.mentions } }
        : { ...fact, fact: fact.fact }
    ))
    return { ...operation, data: { ...operation.data, anchor: stamp(operation.data.anchor), facts } }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationTail.then(operation)
    this.operationTail = result.then(() => {}, () => {})
    return result
  }
}
