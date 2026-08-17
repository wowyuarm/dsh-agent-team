import type { Branded } from '@deepseek-ai/dsh-brand'
import type { MessageId } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'

/** Stable identifier of one Agent Team operation. */
export type AgentTeamOperationId = Branded<'AgentTeamOperationId'>

/** Caller-supplied idempotency identifier for one business operation. */
export type AgentTeamRequestId = Branded<'AgentTeamRequestId'>

/** Stable identifier of one Team member. */
export type AgentTeamMemberId = Branded<'AgentTeamMemberId'>

/** Stable identifier of one Workspace-scoped Channel. */
export type AgentTeamChannelRef = Branded<'AgentTeamChannelRef'>

/** Stable identifier of one immutable Message. */
export type AgentTeamMessageRef = Branded<'AgentTeamMessageRef'>

/** Stable identifier of one top-level Task. */
export type AgentTeamTaskRef = Branded<'AgentTeamTaskRef'>

/** Stable identifier of one Task Thread. */
export type AgentTeamThreadRef = Branded<'AgentTeamThreadRef'>

/** Stable identifier of one Delivery intent. */
export type AgentTeamDeliveryId = Branded<'AgentTeamDeliveryId'>

/** Stable identifier of one Claim. */
export type AgentTeamClaimRef = Branded<'AgentTeamClaimRef'>

/** Stable identifier of one host-authored Activity. */
export type AgentTeamActivityRef = Branded<'AgentTeamActivityRef'>

/** Process-local one-use authorization to pierce one unfollowed mention. */
export type AgentTeamConfirmationToken = Branded<'AgentTeamConfirmationToken'>

/** Snapshot of the actor authorized for an operation. */
export interface AgentTeamHumanActor {
  readonly kind: 'human'
  readonly memberId: AgentTeamMemberId
  readonly handle: string
}

/** Host actor used only for durable observations such as Inbox admission. */
export interface AgentTeamHostActor {
  readonly kind: 'host'
  readonly handle: 'agent-team'
}

/** Snapshot of the exact Agent Member authorized by its live Agent binding. */
export interface AgentTeamMemberActor {
  readonly kind: 'member'
  readonly memberId: AgentTeamMemberId
  readonly handle: string
}

export type AgentTeamActor = AgentTeamHumanActor | AgentTeamHostActor | AgentTeamMemberActor

/** Durable identity and lifecycle intent of one team-managed Agent. */
export interface AgentTeamAgentMember {
  readonly memberId: AgentTeamMemberId
  readonly sessionId: SessionId
  readonly workspaceId: WorkspaceId
  readonly handle: string
  readonly description: string
  readonly presetId: string
  readonly privateMemoryPath: string
  readonly state: 'enabled' | 'suspended' | 'inactive'
}

/** Host projection combining durable intent with process-local availability. */
export interface AgentTeamAgentMemberStatus {
  readonly member: AgentTeamAgentMember
  readonly availability: 'active' | 'suspended' | 'inactive' | 'unavailable'
  readonly presence: 'available' | 'working' | 'error' | 'unavailable'
  readonly diagnostic?: string
}

/** Workspace-scoped request used by the Client Remote projection. */
export interface AgentTeamMembersRequest {
  readonly workspaceId: WorkspaceId
}

interface AgentTeamOperationBase {
  readonly sequence: number
  readonly operationId: AgentTeamOperationId
  readonly requestId: AgentTeamRequestId
  readonly occurredAt: string
  readonly actor: AgentTeamActor
  readonly previousOperationId: AgentTeamOperationId | null
}

/** One Workspace-scoped collaboration Channel. */
export interface AgentTeamChannel {
  readonly channelRef: AgentTeamChannelRef
  readonly workspaceId: WorkspaceId
  readonly name: string
  readonly description: string
  readonly createdAtSequence: number
}

/** One durable Channel membership fact derived from the operation ledger. */
export interface AgentTeamChannelMembership {
  readonly channelRef: AgentTeamChannelRef
  readonly memberId: AgentTeamMemberId
}

/** One immutable top-level Channel Message. */
export interface AgentTeamMessage {
  readonly messageRef: AgentTeamMessageRef
  readonly channelRef: AgentTeamChannelRef
  readonly threadRef: AgentTeamThreadRef
  readonly taskRef: AgentTeamTaskRef
  readonly sender: AgentTeamMemberId
  readonly body: string
  readonly topLevel: boolean
  readonly sequence: number
}

/** Task created by one top-level Channel Message. */
export interface AgentTeamTask {
  readonly taskRef: AgentTeamTaskRef
  readonly channelRef: AgentTeamChannelRef
  readonly threadRef: AgentTeamThreadRef
  readonly status: 'todo' | 'in_progress' | 'in_review' | 'done' | 'closed'
  readonly resolution: 'open' | 'accepted' | 'closed'
}

/** Current projection of one Task Thread. */
export interface AgentTeamThread {
  readonly threadRef: AgentTeamThreadRef
  readonly taskRef: AgentTeamTaskRef
  readonly revision: number
}

/** Explicit subscription state committed with a Message. */
export interface AgentTeamFollow {
  readonly memberId: AgentTeamMemberId
  readonly threadRef: AgentTeamThreadRef
  readonly following: boolean
}

/** One Direction Claim retained as Task progress history. */
export interface AgentTeamClaim {
  readonly claimRef: AgentTeamClaimRef
  readonly taskRef: AgentTeamTaskRef
  readonly threadRef: AgentTeamThreadRef
  readonly owner: AgentTeamMemberId
  readonly direction: string
  readonly normalizedDirection: string
  readonly state: 'active' | 'done' | 'released'
}

interface AgentTeamActivityBase {
  readonly activityRef: AgentTeamActivityRef
  readonly taskRef: AgentTeamTaskRef
  readonly threadRef: AgentTeamThreadRef
  readonly actor: AgentTeamMemberId
  readonly sequence: number
}

export interface AgentTeamClaimActivity extends AgentTeamActivityBase {
  readonly kind: 'claim' | 'done' | 'release'
  readonly claimRef: AgentTeamClaimRef
}

export interface AgentTeamFollowActivity extends AgentTeamActivityBase {
  readonly kind: 'follow' | 'unfollow'
}

export interface AgentTeamTaskActivity extends AgentTeamActivityBase {
  readonly kind: 'accept' | 'close' | 'reopen'
}

/** One ordered host-authored Thread Activity. */
export type AgentTeamActivity = AgentTeamClaimActivity | AgentTeamFollowActivity | AgentTeamTaskActivity

export type AgentTeamDeliverySource =
  | { readonly kind: 'message'; readonly messageRef: AgentTeamMessageRef }
  | { readonly kind: 'activity'; readonly activityRef: AgentTeamActivityRef }

/** Durable delivery state for one Message or Activity recipient. */
export interface AgentTeamDelivery {
  readonly deliveryId: AgentTeamDeliveryId
  readonly source: AgentTeamDeliverySource
  readonly messageId: MessageId
  readonly threadRef: AgentTeamThreadRef
  readonly taskRef: AgentTeamTaskRef
  readonly recipient: AgentTeamMemberId
  readonly state: 'queued' | 'admitted' | 'canceled'
}

/** The first durable operation in every Agent Team ledger. */
export interface AgentTeamInitializedOperation extends AgentTeamOperationBase {
  readonly previousOperationId: null
  readonly kind: 'team/initialized'
  readonly data: {
    readonly humanMemberId: AgentTeamMemberId
  }
}

/** Durable creation of one Channel with its atomic initial memberships. */
export interface AgentTeamChannelCreatedOperation extends AgentTeamOperationBase {
  readonly kind: 'team/channel-created'
  readonly data: {
    readonly workspaceId: WorkspaceId
    readonly channel: AgentTeamChannel
    readonly memberIds: readonly AgentTeamMemberId[]
  }
}

/** Durable removal of one Agent Member from one Channel with Channel-scoped cleanup. */
export interface AgentTeamChannelMemberRemovedOperation extends AgentTeamOperationBase {
  readonly kind: 'team/channel-member-removed'
  readonly data: {
    readonly workspaceId: WorkspaceId
    readonly channelRef: AgentTeamChannelRef
    readonly memberId: AgentTeamMemberId
    readonly claims: readonly AgentTeamClaim[]
    readonly tasks: readonly AgentTeamTask[]
    readonly follows: readonly AgentTeamFollow[]
    readonly deliveries: readonly AgentTeamDelivery[]
  }
}

/** Durable atomic facts created by one top-level Message. */
export interface AgentTeamChannelMemberAddedOperation extends AgentTeamOperationBase {
  readonly kind: 'team/channel-member-added'
  readonly data: {
    readonly workspaceId: WorkspaceId
    readonly channelRef: AgentTeamChannelRef
    readonly memberId: AgentTeamMemberId
  }
}

/** Durable admission proof for one queued Delivery. */
export interface AgentTeamDeliveryAdmittedOperation extends AgentTeamOperationBase {
  readonly kind: 'team/delivery-admitted'
  readonly data: {
    readonly delivery: AgentTeamDelivery
    readonly evidence: 'agent/inbox/spliced' | 'user/message'
  }
}

export interface AgentTeamMessageSentOperation extends AgentTeamOperationBase {
  readonly kind: 'team/message-sent'
  readonly data: {
    readonly workspaceId: WorkspaceId
    readonly message: AgentTeamMessage
    readonly task: AgentTeamTask
    readonly thread: AgentTeamThread
    readonly follows: readonly AgentTeamFollow[]
    readonly deliveries: readonly AgentTeamDelivery[]
  }
}

/** Durable creation intent for one team-managed Agent Member. */
export interface AgentTeamThreadRepliedOperation extends AgentTeamOperationBase {
  readonly kind: 'team/thread-replied'
  readonly data: {
    readonly workspaceId: WorkspaceId
    readonly baseRevision: number
    readonly mentions: readonly AgentTeamMemberId[]
    readonly message: AgentTeamMessage
    readonly task: AgentTeamTask
    readonly thread: AgentTeamThread
    readonly follows: readonly AgentTeamFollow[]
    readonly deliveries: readonly AgentTeamDelivery[]
  }
}

export interface AgentTeamFollowChangedOperation extends AgentTeamOperationBase {
  readonly kind: 'team/follow-changed'
  readonly data: {
    readonly workspaceId: WorkspaceId
    readonly activity: AgentTeamFollowActivity
    readonly follow: AgentTeamFollow
    readonly task: AgentTeamTask
    readonly thread: AgentTeamThread
    readonly deliveries: readonly AgentTeamDelivery[]
  }
}

export interface AgentTeamTaskChangedOperation extends AgentTeamOperationBase {
  readonly kind: 'team/task-changed'
  readonly data: {
    readonly workspaceId: WorkspaceId
    readonly activity: AgentTeamTaskActivity
    readonly task: AgentTeamTask
    readonly thread: AgentTeamThread
    readonly claims: readonly AgentTeamClaim[]
    readonly deliveries: readonly AgentTeamDelivery[]
  }
}

export interface AgentTeamMemberRemovedOperation extends AgentTeamOperationBase {
  readonly kind: 'team/member-removed'
  readonly data: {
    readonly member: AgentTeamAgentMember
    readonly claims: readonly AgentTeamClaim[]
    readonly tasks: readonly AgentTeamTask[]
    readonly follows: readonly AgentTeamFollow[]
    readonly deliveries: readonly AgentTeamDelivery[]
  }
}

export interface AgentTeamClaimOperationData {
  readonly workspaceId: WorkspaceId
  readonly activity: AgentTeamActivity
  readonly claim: AgentTeamClaim
  readonly task: AgentTeamTask
  readonly thread: AgentTeamThread
  readonly deliveries: readonly AgentTeamDelivery[]
}

export interface AgentTeamClaimCreatedOperation extends AgentTeamOperationBase {
  readonly kind: 'team/claim-created'
  readonly data: AgentTeamClaimOperationData
}

export interface AgentTeamClaimDoneOperation extends AgentTeamOperationBase {
  readonly kind: 'team/claim-done'
  readonly data: AgentTeamClaimOperationData
}

export interface AgentTeamClaimReleasedOperation extends AgentTeamOperationBase {
  readonly kind: 'team/claim-released'
  readonly data: AgentTeamClaimOperationData
}

export type AgentTeamClaimChangedOperation =
  | AgentTeamClaimCreatedOperation
  | AgentTeamClaimDoneOperation
  | AgentTeamClaimReleasedOperation

export interface AgentTeamMemberAddedOperation extends AgentTeamOperationBase {
  readonly kind: 'team/member-added'
  readonly data: {
    readonly member: AgentTeamAgentMember
  }
}

/** Durable suspension of one existing Agent Member. */
export interface AgentTeamMemberSuspendedOperation extends AgentTeamOperationBase {
  readonly kind: 'team/member-suspended'
  readonly data: {
    readonly member: AgentTeamAgentMember
  }
}

/** Durable re-enablement of one suspended Agent Member. */
export interface AgentTeamMemberResumedOperation extends AgentTeamOperationBase {
  readonly kind: 'team/member-resumed'
  readonly data: {
    readonly member: AgentTeamAgentMember
  }
}

/** Closed union of durable Agent Team operations. */
export type AgentTeamOperation =
  | AgentTeamInitializedOperation
  | AgentTeamChannelCreatedOperation
  | AgentTeamChannelMemberRemovedOperation
  | AgentTeamMessageSentOperation
  | AgentTeamThreadRepliedOperation
  | AgentTeamClaimCreatedOperation
  | AgentTeamClaimDoneOperation
  | AgentTeamClaimReleasedOperation
  | AgentTeamFollowChangedOperation
  | AgentTeamTaskChangedOperation
  | AgentTeamMemberRemovedOperation
  | AgentTeamChannelMemberAddedOperation
  | AgentTeamDeliveryAdmittedOperation
  | AgentTeamMemberAddedOperation
  | AgentTeamMemberSuspendedOperation
  | AgentTeamMemberResumedOperation

/** Receipt returned after an operation is durable or an identical retry resolves it. */
export interface AgentTeamOperationReceipt {
  readonly operationId: AgentTeamOperationId
  readonly requestId: AgentTeamRequestId
  readonly sequence: number
}

/** Human intent to create a Workspace Channel with its initial Members. */
export interface AgentTeamCreateChannelRequest {
  readonly requestId: AgentTeamRequestId
  readonly workspaceId: WorkspaceId
  readonly name: string
  readonly description: string
  readonly memberIds?: readonly AgentTeamMemberId[]
}

/** Result of creating or idempotently resolving a Channel and its initial Members. */
export interface AgentTeamCreateChannelResult {
  readonly receipt: AgentTeamOperationReceipt
  readonly channel: AgentTeamChannel
  readonly memberIds: readonly AgentTeamMemberId[]
}

/** Human intent to remove one Agent Member from one Channel. */
export interface AgentTeamRemoveChannelMemberRequest {
  readonly requestId: AgentTeamRequestId
  readonly workspaceId: WorkspaceId
  readonly channelRef: AgentTeamChannelRef
  readonly memberId: AgentTeamMemberId
}

/** Result of removing one Agent Member from one Channel with Channel-scoped cleanup. */
export interface AgentTeamRemoveChannelMemberResult {
  readonly receipt: AgentTeamOperationReceipt
  readonly channelRef: AgentTeamChannelRef
  readonly memberId: AgentTeamMemberId
  readonly releasedClaims: readonly AgentTeamClaim[]
  readonly removedFollows: readonly AgentTeamFollow[]
  readonly canceledDeliveries: readonly AgentTeamDelivery[]
}

/** Human intent to send one top-level Channel Message. */
export interface AgentTeamSendMessageRequest {
  readonly requestId: AgentTeamRequestId
  readonly workspaceId: WorkspaceId
  readonly channelRef: AgentTeamChannelRef
  readonly body: string
  readonly recipients?: readonly AgentTeamMemberId[]
}

/** Result of atomically creating a Message and its derived collaboration facts. */
export interface AgentTeamJoinChannelRequest {
  readonly requestId: AgentTeamRequestId
  readonly workspaceId: WorkspaceId
  readonly channelRef: AgentTeamChannelRef
  readonly memberId: AgentTeamMemberId
}

export interface AgentTeamJoinChannelResult {
  readonly receipt: AgentTeamOperationReceipt
  readonly channelRef: AgentTeamChannelRef
  readonly memberId: AgentTeamMemberId
}

export interface AgentTeamSendMessageResult {
  readonly receipt: AgentTeamOperationReceipt
  readonly message: AgentTeamMessage
  readonly task: AgentTeamTask
  readonly thread: AgentTeamThread
  readonly follows: readonly AgentTeamFollow[]
  readonly deliveries: readonly AgentTeamDelivery[]
}

export interface AgentTeamReplyRequest {
  readonly requestId: AgentTeamRequestId
  readonly workspaceId: WorkspaceId
  readonly taskRef: AgentTeamTaskRef
  readonly body: string
  readonly baseRevision: number
  readonly recipients?: readonly AgentTeamMemberId[]
  readonly confirmationToken?: AgentTeamConfirmationToken
}

export interface AgentTeamConfirmationRequired {
  readonly kind: 'confirmation_required'
  readonly confirmationToken: AgentTeamConfirmationToken
  readonly taskRef: AgentTeamTaskRef
  readonly threadRef: AgentTeamThreadRef
  readonly revision: number
  readonly recipients: readonly AgentTeamMemberId[]
}

export interface AgentTeamReplyResult {
  readonly kind: 'committed'
  readonly receipt: AgentTeamOperationReceipt
  readonly message: AgentTeamMessage
  readonly task: AgentTeamTask
  readonly thread: AgentTeamThread
  readonly deliveries: readonly AgentTeamDelivery[]
}

export interface AgentTeamTaskRequest {
  readonly requestId: AgentTeamRequestId
  readonly workspaceId: WorkspaceId
  readonly taskRef: AgentTeamTaskRef
  readonly action: 'accept' | 'close' | 'reopen'
}

export interface AgentTeamTaskResult {
  readonly receipt: AgentTeamOperationReceipt
  readonly activity: AgentTeamTaskActivity
  readonly task: AgentTeamTask
  readonly thread: AgentTeamThread
  readonly claims: readonly AgentTeamClaim[]
  readonly deliveries: readonly AgentTeamDelivery[]
}

export interface AgentTeamRemoveMemberRequest {
  readonly requestId: AgentTeamRequestId
  readonly memberId: AgentTeamMemberId
}

export interface AgentTeamRemoveMemberResult {
  readonly receipt: AgentTeamOperationReceipt
  readonly member: AgentTeamAgentMember
  readonly releasedClaims: readonly AgentTeamClaim[]
  readonly canceledDeliveries: readonly AgentTeamDelivery[]
}

export interface AgentTeamFollowRequest {
  readonly requestId: AgentTeamRequestId
  readonly workspaceId: WorkspaceId
  readonly taskRef: AgentTeamTaskRef
  readonly action: 'follow' | 'unfollow'
}

export interface AgentTeamFollowResult {
  readonly receipt: AgentTeamOperationReceipt
  readonly activity: AgentTeamFollowActivity
  readonly follow: AgentTeamFollow
  readonly task: AgentTeamTask
  readonly thread: AgentTeamThread
  readonly deliveries: readonly AgentTeamDelivery[]
}

export interface AgentTeamFollowStatus {
  readonly task: AgentTeamTask
  readonly thread: AgentTeamThread
  readonly following: boolean
}

export interface AgentTeamClaimRequest {
  readonly requestId: AgentTeamRequestId
  readonly workspaceId: WorkspaceId
  readonly taskRef: AgentTeamTaskRef
  readonly action: 'claim' | 'done' | 'release'
  readonly direction?: string
  readonly claimRef?: AgentTeamClaimRef
}

export interface AgentTeamClaimResult {
  readonly receipt: AgentTeamOperationReceipt
  readonly activity: AgentTeamActivity
  readonly claim: AgentTeamClaim
  readonly task: AgentTeamTask
  readonly thread: AgentTeamThread
  readonly deliveries: readonly AgentTeamDelivery[]
}

export interface AgentTeamClaimListRequest {
  readonly workspaceId: WorkspaceId
  readonly taskRef: AgentTeamTaskRef
}

export interface AgentTeamClaimList {
  readonly task: AgentTeamTask
  readonly thread: AgentTeamThread
  readonly claims: readonly AgentTeamClaim[]
}

/** Human intent to provision one team-managed Agent Member. */
export interface AgentTeamAddMemberRequest {
  readonly requestId: AgentTeamRequestId
  readonly workspaceId: WorkspaceId
  readonly handle: string
  readonly description: string
  readonly presetId: string
}

/** Human intent to suspend or resume one Agent Member. */
export interface AgentTeamSetMemberStateRequest {
  readonly requestId: AgentTeamRequestId
  readonly memberId: AgentTeamMemberId
}

/** Result of a Member lifecycle operation. */
export interface AgentTeamMemberResult {
  readonly receipt: AgentTeamOperationReceipt
  readonly status: AgentTeamAgentMemberStatus
}

/** One bounded Workspace view item. */
export interface AgentTeamViewItem {
  readonly message: AgentTeamMessage
  readonly task: AgentTeamTask
  readonly thread: AgentTeamThread
  readonly taskNumber: number
  readonly messageCount: number
}

/** Workspace-authorized bounded view request. */
export interface AgentTeamAgentViewRequest extends AgentTeamViewRequest {
  readonly memberId: AgentTeamMemberId
}

export interface AgentTeamViewRequest {
  readonly workspaceId: WorkspaceId
  readonly channelRef?: AgentTeamChannelRef
  readonly threadRef?: AgentTeamThreadRef
  readonly limit?: number
  readonly cursor?: number
  /** Read facts after the cursor (Agent default) or the latest facts before it (Client history). */
  readonly direction?: 'after' | 'before'
  /** Exclude Thread replies from a top-level-only projection. */
  readonly topLevelOnly?: boolean
  /** Include relevant Activity facts in the shared bounded stream (default true). */
  readonly includeActivities?: boolean
}

/** Bounded collaboration facts plus a continuation sequence. */
export interface AgentTeamView {
  readonly humanMemberId: AgentTeamMemberId
  readonly channels: readonly AgentTeamChannel[]
  readonly members: readonly AgentTeamChannelMembership[]
  readonly tasks: readonly AgentTeamTask[]
  readonly threads: readonly AgentTeamThread[]
  readonly taskNumbers: readonly { readonly taskRef: AgentTeamTaskRef; readonly taskNumber: number }[]
  readonly items: readonly AgentTeamViewItem[]
  readonly claims: readonly AgentTeamClaim[]
  readonly activities: readonly AgentTeamActivity[]
  readonly cursor: number
  readonly hasMore: boolean
}

/** Cursor for the lightweight Client invalidation stream. */
export interface AgentTeamChangesRequest {
  readonly afterVersion: number
}

export interface AgentTeamChangesResult {
  readonly version: number
}

/** Human-facing summary of the current Team projection. */
export interface AgentTeamStatus {
  readonly initialized: true
  readonly sequence: number
  readonly operationCount: number
  readonly channelCount: number
  readonly agentMemberCount: number
  readonly humanMemberId: AgentTeamMemberId
}
