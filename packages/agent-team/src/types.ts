import type { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'

/** Stable identifier of one Agent Team operation. */
export type AgentTeamOperationId = Branded<'AgentTeamOperationId'>

/** Caller-supplied idempotency identifier for one business operation. */
export type AgentTeamRequestId = Branded<'AgentTeamRequestId'>

/** Stable identifier of one uploaded composer attachment (cache, not archive). */
export type AgentTeamAttachmentId = Branded<'AgentTeamAttachmentId'>

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

/** Stable identifier of one Claim. */
export type AgentTeamClaimRef = Branded<'AgentTeamClaimRef'>

/** Stable identifier of one public Thread Activity. */
export type AgentTeamActivityRef = Branded<'AgentTeamActivityRef'>

/** Process-local one-use authorization for one Human invitation. */
export type AgentTeamConfirmationToken = Branded<'AgentTeamConfirmationToken'>

/** Snapshot of the Human authority authorized for an operation. */
export interface AgentTeamHumanActor {
  readonly kind: 'human'
  readonly memberId: AgentTeamMemberId
  readonly handle: string
}

/** Snapshot of the exact Agent Member authorized by its live Agent binding. */
export interface AgentTeamMemberActor {
  readonly kind: 'member'
  readonly memberId: AgentTeamMemberId
  readonly handle: string
}

export type AgentTeamActor = AgentTeamHumanActor | AgentTeamMemberActor

/** Provider route plus provider-owned model id one Member can be pinned to. */
export interface AgentTeamModelSelection {
  readonly provider: string
  readonly model: string
  /** Adapter-owned reasoning effort, or the model's provider/default behavior when absent. */
  readonly reasoningEffort?: ReasoningEffortId
}

/** Durable identity and lifecycle intent of one team-managed Agent. */
export interface AgentTeamAgentMember {
  readonly memberId: AgentTeamMemberId
  readonly sessionId: SessionId
  readonly workspaceId: WorkspaceId
  readonly handle: string
  readonly description: string
  readonly presetId: string
  /** Absent inherits the Host default model selection at every activation. */
  readonly model?: AgentTeamModelSelection | undefined
  /** Host-internal namespace; never exposed through Client projections. */
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

/** Browser-safe Member identity with Host-only paths removed. */
export type AgentTeamClientMember = Omit<AgentTeamAgentMember, 'privateMemoryPath'>

/** Browser-safe lifecycle projection. */
export interface AgentTeamClientMemberStatus extends Omit<AgentTeamAgentMemberStatus, 'member'> {
  readonly member: AgentTeamClientMember
}

/** Workspace-scoped request used by the Client Remote projection. */
export interface AgentTeamMembersRequest {
  readonly workspaceId: WorkspaceId
}

/** Look up navigation facts for branded Task refs found in message bodies. */
export interface AgentTeamResolveTaskRefsRequest {
  readonly workspaceId: WorkspaceId
  readonly taskRefs: readonly AgentTeamTaskRef[]
}

/** One resolved Task; refs that do not exist in the workspace are omitted. */
export interface AgentTeamResolvedTaskRef {
  readonly taskRef: AgentTeamTaskRef
  readonly channelRef: AgentTeamChannelRef
  readonly threadRef: AgentTeamThreadRef
  readonly taskNumber: number
}

export interface AgentTeamResolveTaskRefsResult {
  readonly resolved: readonly AgentTeamResolvedTaskRef[]
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

/** One immutable top-level or reply Message. */
export interface AgentTeamMessageAttachment {
  readonly attachmentId: AgentTeamAttachmentId
  readonly name: string
  readonly byteSize: number
  readonly mediaType: string
}

export interface AgentTeamMessage {
  readonly messageRef: AgentTeamMessageRef
  readonly channelRef: AgentTeamChannelRef
  readonly threadRef: AgentTeamThreadRef
  readonly taskRef: AgentTeamTaskRef
  readonly sender: AgentTeamMemberId
  readonly body: string
  readonly attachments?: readonly AgentTeamMessageAttachment[] | undefined
  readonly topLevel: boolean
  readonly sequence: number
  /** Wall-clock instant of the wrapping ledger operation; pre-occurredAt ledgers normalize on replay. */
  readonly occurredAt: string
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
  /** Last public Message, Claim, or Task-resolution sequence. */
  readonly revision: number
}

/**
 * A Member's current attention period for one Thread.
 *
 * Its absence means the Member is not following. Read state is compact: all
 * follower-visible facts from `startSequence` through `readThroughSequence`
 * are acknowledged, except for sparse direct markers retained separately.
 */
export interface AgentTeamThreadAttention {
  readonly memberId: AgentTeamMemberId
  readonly threadRef: AgentTeamThreadRef
  readonly startSequence: number
  readonly readThroughSequence: number
}

/** Identity of one Member × Thread attention period. */
export interface AgentTeamThreadAttentionKey {
  readonly memberId: AgentTeamMemberId
  readonly threadRef: AgentTeamThreadRef
}

/** Sparse direct-priority marker for one structured Message mention. */
export interface AgentTeamDirectMarker {
  readonly memberId: AgentTeamMemberId
  readonly threadRef: AgentTeamThreadRef
  readonly messageRef: AgentTeamMessageRef
  readonly sequence: number
}

/** Sparse marker retaining a relevant Task or Claim Activity after Attention ends. */
export interface AgentTeamActivityMarker {
  readonly memberId: AgentTeamMemberId
  readonly threadRef: AgentTeamThreadRef
  readonly activityRef: AgentTeamActivityRef
  readonly sequence: number
}

/** Durable changes to private Member inbox state carried by one operation. */
export interface AgentTeamInboxDelta {
  readonly attention: {
    /** New or replacement current Attention records. */
    readonly set: readonly AgentTeamThreadAttention[]
    /** Attention periods ended by this operation. */
    readonly removed: readonly AgentTeamThreadAttentionKey[]
  }
  readonly directMarkers: {
    readonly added: readonly AgentTeamDirectMarker[]
    readonly removed: readonly AgentTeamDirectMarker[]
  }
  readonly activityMarkers: {
    readonly added: readonly AgentTeamActivityMarker[]
    readonly removed: readonly AgentTeamActivityMarker[]
  }
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

export interface AgentTeamTaskActivity extends AgentTeamActivityBase {
  readonly kind: 'accept' | 'close' | 'reopen'
  /** Claims atomically released by close; absent for other Task transitions. */
  readonly releasedClaimRefs?: readonly AgentTeamClaimRef[] | undefined
}

/** One automatic, public release summary caused by a membership lifecycle action. */
export interface AgentTeamClaimsReleasedActivity extends AgentTeamActivityBase {
  readonly kind: 'claims_released'
  readonly claimRefs: readonly AgentTeamClaimRef[]
}

/** One ordered public Thread Activity. */
export type AgentTeamActivity = AgentTeamClaimActivity | AgentTeamTaskActivity | AgentTeamClaimsReleasedActivity

/** One public, revisioned fact in a Thread timeline. */
export type AgentTeamThreadFact =
  | {
    readonly kind: 'message'
    readonly sequence: number
    readonly message: AgentTeamMessage
    /** Structured Member refs from the originating send operation; empty when the Message mentions nobody. */
    readonly mentions: readonly AgentTeamMemberId[]
  }
  | { readonly kind: 'activity'; readonly sequence: number; readonly activity: AgentTeamActivity }

/** One fact returned by a durable Thread read. */
export interface AgentTeamThreadReadFact {
  readonly fact: AgentTeamThreadFact
  /** This fact was part of the unread batch advanced by this read. */
  readonly unread: boolean
  /** This fact carries one of the recipient's structured direct mentions. */
  readonly direct: boolean
}

/** Stored form of a Message inside durable operations; pre-occurredAt ledgers omit it and normalize on load. */
export type AgentTeamStoredMessage = Omit<AgentTeamMessage, 'occurredAt'> & { readonly occurredAt?: string | undefined }

/** Stored form of one Thread timeline fact; mirrors AgentTeamThreadFact with stored messages. */
export type AgentTeamStoredThreadFact =
  | { readonly kind: 'message'; readonly sequence: number; readonly message: AgentTeamStoredMessage;
    readonly mentions: readonly AgentTeamMemberId[] }
  | { readonly kind: 'activity'; readonly sequence: number; readonly activity: AgentTeamActivity }

/** Stored form of one durable Thread read fact. */
export interface AgentTeamStoredThreadReadFact {
  readonly fact: AgentTeamStoredThreadFact
  readonly unread: boolean
  readonly direct: boolean
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

/** Durable Agent Member creation with optional initial Channel memberships. */
export interface AgentTeamMemberAddedOperation extends AgentTeamOperationBase {
  readonly kind: 'team/member-added'
  readonly data: {
    readonly member: AgentTeamAgentMember
    readonly channelRefs: readonly AgentTeamChannelRef[]
  }
}

/** Durable suspension of one existing Agent Member. */
export interface AgentTeamMemberSuspendedOperation extends AgentTeamOperationBase {
  readonly kind: 'team/member-suspended'
  readonly data: { readonly member: AgentTeamAgentMember }
}

/** Durable re-enablement of one suspended Agent Member. */
export interface AgentTeamMemberResumedOperation extends AgentTeamOperationBase {
  readonly kind: 'team/member-resumed'
  readonly data: { readonly member: AgentTeamAgentMember }
}

/**
 * Audit record of one in-place Member session restart. The restart changes no
 * projection state — the Member keeps identity, transcript, and memory — so
 * apply() treats this operation as a marker only.
 */
export interface AgentTeamMemberSessionRestartedOperation extends AgentTeamOperationBase {
  readonly kind: 'team/member-session-restarted'
  readonly data: { readonly member: AgentTeamAgentMember }
}

/** Durable Human rename of one Channel's display facts; identity refs never change. */
export interface AgentTeamChannelUpdatedOperation extends AgentTeamOperationBase {
  readonly kind: 'team/channel-updated'
  readonly data: {
    readonly workspaceId: WorkspaceId
    readonly channel: AgentTeamChannel
  }
}

/** Durable Human edit of one Member's mutable facts (handle, description, model). */
export interface AgentTeamMemberUpdatedOperation extends AgentTeamOperationBase {
  readonly kind: 'team/member-updated'
  readonly data: { readonly member: AgentTeamAgentMember }
}

/** Durable addition of one Agent Member to one Channel. */
export interface AgentTeamChannelMemberAddedOperation extends AgentTeamOperationBase {
  readonly kind: 'team/channel-member-added'
  readonly data: {
    readonly workspaceId: WorkspaceId
    readonly channelRef: AgentTeamChannelRef
    readonly memberId: AgentTeamMemberId
  }
}

/** Durable removal of one Agent Member from one Channel and Channel-scoped cleanup. */
export interface AgentTeamChannelMemberRemovedOperation extends AgentTeamOperationBase {
  readonly kind: 'team/channel-member-removed'
  readonly data: {
    readonly workspaceId: WorkspaceId
    readonly channelRef: AgentTeamChannelRef
    readonly memberId: AgentTeamMemberId
    /** Claims released because this Member lost Channel authority. */
    readonly claims: readonly AgentTeamClaim[]
    /** Public release summaries for the affected Threads. */
    readonly activities: readonly AgentTeamClaimsReleasedActivity[]
    readonly tasks: readonly AgentTeamTask[]
    readonly threads: readonly AgentTeamThread[]
    readonly inbox: AgentTeamInboxDelta
  }
}

/** Durable top-level Message, Task, Thread, and initial inbox facts. */
export interface AgentTeamMessageSentOperation extends AgentTeamOperationBase {
  readonly kind: 'team/message-sent'
  readonly data: {
    readonly workspaceId: WorkspaceId
    readonly mentions: readonly AgentTeamMemberId[]
    readonly message: AgentTeamMessage
    readonly task: AgentTeamTask
    readonly thread: AgentTeamThread
    readonly inbox: AgentTeamInboxDelta
  }
}

/** Durable existing-Thread reply and any invitation/direct-mention facts. */
export interface AgentTeamThreadRepliedOperation extends AgentTeamOperationBase {
  readonly kind: 'team/thread-replied'
  readonly data: {
    readonly workspaceId: WorkspaceId
    readonly baseRevision: number
    readonly mentions: readonly AgentTeamMemberId[]
    readonly message: AgentTeamMessage
    readonly task: AgentTeamTask
    readonly thread: AgentTeamThread
    readonly inbox: AgentTeamInboxDelta
  }
}

export interface AgentTeamClaimOperationData {
  readonly workspaceId: WorkspaceId
  readonly baseRevision: number
  readonly activity: AgentTeamClaimActivity
  readonly claim: AgentTeamClaim
  readonly task: AgentTeamTask
  readonly thread: AgentTeamThread
  readonly inbox: AgentTeamInboxDelta
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

/** Durable Human Task-resolution change. */
export interface AgentTeamTaskChangedOperation extends AgentTeamOperationBase {
  readonly kind: 'team/task-changed'
  readonly data: {
    readonly workspaceId: WorkspaceId
    readonly baseRevision: number
    readonly activity: AgentTeamTaskActivity
    readonly task: AgentTeamTask
    readonly thread: AgentTeamThread
    readonly claims: readonly AgentTeamClaim[]
    readonly inbox: AgentTeamInboxDelta
  }
}

/** Durable personal Attention follow or unfollow; it does not revise the Thread. */
export interface AgentTeamThreadAttentionChangedOperation extends AgentTeamOperationBase {
  readonly kind: 'team/thread-attention-changed'
  readonly data: {
    readonly workspaceId: WorkspaceId
    readonly action: 'follow' | 'unfollow'
    readonly memberId: AgentTeamMemberId
    readonly task: AgentTeamTask
    readonly thread: AgentTeamThread
    readonly inbox: AgentTeamInboxDelta
  }
}

/** Durable one-batch read and direct-marker consumption. It does not revise the Thread. */
export interface AgentTeamThreadReadOperation extends AgentTeamOperationBase {
  readonly kind: 'team/thread-read'
  readonly data: {
    readonly workspaceId: WorkspaceId
    readonly memberId: AgentTeamMemberId
    /** Current public state captured for a stable idempotent read response. */
    readonly task: AgentTeamTask
    readonly thread: AgentTeamThread
    readonly claims: readonly AgentTeamClaim[]
    readonly anchor: AgentTeamStoredMessage
    /** Structured Member refs of the anchor Message, from its originating send operation. */
    readonly anchorMentions: readonly AgentTeamMemberId[]
    readonly facts: readonly AgentTeamStoredThreadReadFact[]
    readonly readThroughSequence: number
    /** Number of unread facts left after this bounded read. */
    readonly remainingUnreadCount: number
    /** The reader's post-read Attention snapshot, when the reader follows. */
    readonly attention?: AgentTeamThreadAttention | undefined
    readonly inbox: AgentTeamInboxDelta
  }
}

/** Durable irreversible Member removal and global inbox cleanup. */
export interface AgentTeamMemberRemovedOperation extends AgentTeamOperationBase {
  readonly kind: 'team/member-removed'
  readonly data: {
    readonly member: AgentTeamAgentMember
    /** Claims released because this Member became inactive. */
    readonly claims: readonly AgentTeamClaim[]
    /** Public release summaries for the affected Threads. */
    readonly activities: readonly AgentTeamClaimsReleasedActivity[]
    readonly tasks: readonly AgentTeamTask[]
    readonly threads: readonly AgentTeamThread[]
    readonly inbox: AgentTeamInboxDelta
  }
}

/** Closed union of durable Agent Team operations. */
export type AgentTeamOperation =
  | AgentTeamInitializedOperation
  | AgentTeamChannelCreatedOperation
  | AgentTeamMemberAddedOperation
  | AgentTeamMemberSuspendedOperation
  | AgentTeamMemberResumedOperation
  | AgentTeamMemberSessionRestartedOperation
  | AgentTeamChannelUpdatedOperation
  | AgentTeamMemberUpdatedOperation
  | AgentTeamChannelMemberAddedOperation
  | AgentTeamChannelMemberRemovedOperation
  | AgentTeamMessageSentOperation
  | AgentTeamThreadRepliedOperation
  | AgentTeamClaimCreatedOperation
  | AgentTeamClaimDoneOperation
  | AgentTeamClaimReleasedOperation
  | AgentTeamTaskChangedOperation
  | AgentTeamThreadAttentionChangedOperation
  | AgentTeamThreadReadOperation
  | AgentTeamMemberRemovedOperation

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
  /** Display purpose text; may be empty and filled in later through an edit. */
  readonly description: string
  readonly memberIds?: readonly AgentTeamMemberId[]
}

/** Result of creating or idempotently resolving a Channel and its initial Members. */
export interface AgentTeamCreateChannelResult {
  readonly receipt: AgentTeamOperationReceipt
  readonly channel: AgentTeamChannel
  readonly memberIds: readonly AgentTeamMemberId[]
}

/** Human intent to provision one team-managed Agent Member with initial Channels. */
export interface AgentTeamAddMemberRequest {
  readonly requestId: AgentTeamRequestId
  readonly workspaceId: WorkspaceId
  readonly handle: string
  /** Display purpose text; may be empty and filled in later through an edit. */
  readonly description: string
  readonly presetId: string
  /** Absent inherits the Host default model selection. */
  readonly model?: AgentTeamModelSelection
  /** Existing Channels in this Workspace; may be empty — the Member joins Channels later and stays reachable through its DM view. */
  readonly channelRefs: readonly AgentTeamChannelRef[]
}

/** Human intent to rename one Channel's display facts. */
export interface AgentTeamUpdateChannelRequest {
  readonly requestId: AgentTeamRequestId
  readonly workspaceId: WorkspaceId
  readonly channelRef: AgentTeamChannelRef
  readonly name: string
  /** Display purpose text; may be empty, matching creation. */
  readonly description: string
}

/** Result of updating or idempotently resolving one Channel's display facts. */
export interface AgentTeamUpdateChannelResult {
  readonly receipt: AgentTeamOperationReceipt
  readonly channel: AgentTeamChannel
}

/** Human intent to edit one Member's mutable facts; an absent model clears any override. */
export interface AgentTeamUpdateMemberRequest {
  readonly requestId: AgentTeamRequestId
  readonly memberId: AgentTeamMemberId
  readonly handle: string
  /** Display purpose text; may be empty, matching creation. */
  readonly description: string
  readonly model?: AgentTeamModelSelection
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

/** Operator intent to nudge one error-stopped Member into continuing its work. */
export interface AgentTeamRecoverMemberRequest {
  readonly requestId: AgentTeamRequestId
  readonly workspaceId: WorkspaceId
  readonly memberId: AgentTeamMemberId
}

/** Result of a recovery nudge; runtime-only steering, so there is no ledger receipt. */
export interface AgentTeamRecoverMemberResult {
  readonly status: AgentTeamAgentMemberStatus
}

/** Human intent to remove one Agent Member from one Channel. */
export interface AgentTeamRemoveChannelMemberRequest {
  readonly requestId: AgentTeamRequestId
  readonly workspaceId: WorkspaceId
  readonly channelRef: AgentTeamChannelRef
  readonly memberId: AgentTeamMemberId
}

/** Result of Channel-scoped member cleanup. */
export interface AgentTeamRemoveChannelMemberResult {
  readonly receipt: AgentTeamOperationReceipt
  readonly channelRef: AgentTeamChannelRef
  readonly memberId: AgentTeamMemberId
  readonly releasedClaims: readonly AgentTeamClaim[]
  readonly removedAttention: readonly AgentTeamThreadAttentionKey[]
}

/** Human intent to add one Agent Member to one Channel. */
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

/** Intent to create one top-level Message, Task, and Thread. */
export interface AgentTeamSendMessageRequest {
  readonly requestId: AgentTeamRequestId
  readonly workspaceId: WorkspaceId
  readonly channelRef: AgentTeamChannelRef
  readonly body: string
  readonly recipients?: readonly AgentTeamMemberId[]
  /** Uploaded attachments to reference; the Host resolves and verifies each id. */
  readonly attachments?: readonly AgentTeamAttachmentId[] | undefined
  /**
   * Agent-supplied absolute file paths; the Host validates each one, copies the
   * bytes into the attachment cache, and turns them into the same metadata.
   */
  readonly attachmentPaths?: readonly string[] | undefined
  readonly confirmationToken?: AgentTeamConfirmationToken
}

/** Upload one composer attachment into the Team attachment cache. */
export interface AgentTeamPutAttachmentRequest {
  readonly requestId: AgentTeamRequestId
  readonly workspaceId: WorkspaceId
  readonly name: string
  readonly mediaType?: string | undefined
  readonly bytesBase64: string
}

export interface AgentTeamPutAttachmentResult {
  readonly attachmentId: AgentTeamAttachmentId
  /** Absolute path members read the bytes from; stable for the cache lifetime. */
  readonly path: string
  readonly name: string
  readonly byteSize: number
  readonly mediaType: string
}

/** Read one uploaded attachment back for client-side display. */
export interface AgentTeamGetAttachmentRequest {
  readonly attachmentId: AgentTeamAttachmentId
}

export interface AgentTeamGetAttachmentResult {
  readonly name: string
  readonly mediaType: string
  readonly byteSize: number
  readonly bytesBase64: string
}

/** Intent to append one public Message to an existing Thread. */
export interface AgentTeamReplyRequest {
  readonly requestId: AgentTeamRequestId
  readonly workspaceId: WorkspaceId
  readonly taskRef: AgentTeamTaskRef
  readonly body: string
  readonly baseRevision: number
  readonly recipients?: readonly AgentTeamMemberId[]
  /** Agent-supplied absolute file paths, resolved like sendMessage's. */
  readonly attachmentPaths?: readonly string[] | undefined
  /** Attachment cache IDs from the Human picker, resolved like sendMessage's. */
  readonly attachments?: readonly AgentTeamAttachmentId[] | undefined
  readonly confirmationToken?: AgentTeamConfirmationToken
}

/** A Human must send the same invitation one more time with this token. */
export interface AgentTeamConfirmationRequired {
  readonly kind: 'confirmation_required'
  readonly confirmationToken: AgentTeamConfirmationToken
  readonly workspaceId: WorkspaceId
  readonly channelRef: AgentTeamChannelRef
  readonly recipients: readonly AgentTeamMemberId[]
  readonly taskRef?: AgentTeamTaskRef
  readonly threadRef?: AgentTeamThreadRef
  readonly revision?: number
}

/** Existing unread work must be read before this Thread mutation can proceed. */
export interface AgentTeamUnreadRequired {
  readonly kind: 'unread_required'
  readonly taskRef: AgentTeamTaskRef
  readonly threadRef: AgentTeamThreadRef
  readonly revision: number
  readonly unreadCount: number
  readonly directCount: number
}

/** A public Thread mutation used an obsolete optimistic-concurrency revision. */
export interface AgentTeamStaleRevision {
  readonly kind: 'stale_revision'
  readonly taskRef: AgentTeamTaskRef
  readonly threadRef: AgentTeamThreadRef
  readonly expectedRevision: number
  readonly revision: number
}

/** An Agent tried to address an Agent who is not already following. */
export interface AgentTeamMemberNotFollowing {
  readonly kind: 'member_not_following'
  readonly memberIds: readonly AgentTeamMemberId[]
  readonly workspaceId: WorkspaceId
  readonly channelRef: AgentTeamChannelRef
  readonly taskRef?: AgentTeamTaskRef
  readonly threadRef?: AgentTeamThreadRef
  readonly revision?: number
}

export interface AgentTeamSendMessageCommittedResult {
  readonly kind: 'committed'
  readonly receipt: AgentTeamOperationReceipt
  readonly message: AgentTeamMessage
  readonly task: AgentTeamTask
  readonly thread: AgentTeamThread
  readonly attention: readonly AgentTeamThreadAttention[]
  readonly directMarkers: readonly AgentTeamDirectMarker[]
}

export type AgentTeamSendMessageResult =
  | AgentTeamSendMessageCommittedResult
  | AgentTeamConfirmationRequired
  | AgentTeamMemberNotFollowing

export interface AgentTeamReplyCommittedResult {
  readonly kind: 'committed'
  readonly receipt: AgentTeamOperationReceipt
  readonly message: AgentTeamMessage
  readonly task: AgentTeamTask
  readonly thread: AgentTeamThread
  readonly attention: readonly AgentTeamThreadAttention[]
  readonly directMarkers: readonly AgentTeamDirectMarker[]
}

export type AgentTeamReplyResult =
  | AgentTeamReplyCommittedResult
  | AgentTeamConfirmationRequired
  | AgentTeamUnreadRequired
  | AgentTeamStaleRevision
  | AgentTeamMemberNotFollowing

/** Human Task resolution intent. */
export interface AgentTeamTaskRequest {
  readonly requestId: AgentTeamRequestId
  readonly workspaceId: WorkspaceId
  readonly taskRef: AgentTeamTaskRef
  readonly action: 'accept' | 'close' | 'reopen'
  readonly baseRevision: number
}

export interface AgentTeamTaskCommittedResult {
  readonly kind: 'committed'
  readonly receipt: AgentTeamOperationReceipt
  readonly activity: AgentTeamTaskActivity
  readonly task: AgentTeamTask
  readonly thread: AgentTeamThread
  readonly claims: readonly AgentTeamClaim[]
}

export type AgentTeamTaskResult =
  | AgentTeamTaskCommittedResult
  | AgentTeamUnreadRequired
  | AgentTeamStaleRevision

/** Human intent to permanently remove one Agent Member. */
export interface AgentTeamRemoveMemberRequest {
  readonly requestId: AgentTeamRequestId
  readonly memberId: AgentTeamMemberId
}

export interface AgentTeamRemoveMemberResult {
  readonly receipt: AgentTeamOperationReceipt
  readonly member: AgentTeamAgentMember
  readonly releasedClaims: readonly AgentTeamClaim[]
  readonly removedAttention: readonly AgentTeamThreadAttentionKey[]
}

/** Personal Thread Attention mutation; it is exempt from public mutation fences. */
export interface AgentTeamThreadAttentionRequest {
  readonly requestId: AgentTeamRequestId
  readonly workspaceId: WorkspaceId
  readonly taskRef: AgentTeamTaskRef
  readonly action: 'follow' | 'unfollow'
}

export interface AgentTeamThreadAttentionResult {
  readonly receipt: AgentTeamOperationReceipt
  readonly task: AgentTeamTask
  readonly thread: AgentTeamThread
  /** Present after follow, absent after unfollow. */
  readonly attention?: AgentTeamThreadAttention
}

export interface AgentTeamThreadAttentionStatus {
  readonly task: AgentTeamTask
  readonly thread: AgentTeamThread
  readonly attention?: AgentTeamThreadAttention
}

/** Direction Claim mutation. `baseRevision` fences every non-list public mutation. */
export interface AgentTeamClaimRequest {
  readonly requestId: AgentTeamRequestId
  readonly workspaceId: WorkspaceId
  readonly taskRef: AgentTeamTaskRef
  readonly action: 'claim' | 'done' | 'release'
  readonly baseRevision: number
  readonly direction?: string
  readonly claimRef?: AgentTeamClaimRef
}

export interface AgentTeamClaimCommittedResult {
  readonly kind: 'committed'
  readonly receipt: AgentTeamOperationReceipt
  readonly activity: AgentTeamClaimActivity
  readonly claim: AgentTeamClaim
  readonly task: AgentTeamTask
  readonly thread: AgentTeamThread
  readonly attention?: AgentTeamThreadAttention
}

export type AgentTeamClaimResult =
  | AgentTeamClaimCommittedResult
  | AgentTeamUnreadRequired
  | AgentTeamStaleRevision

export interface AgentTeamClaimList {
  readonly task: AgentTeamTask
  readonly thread: AgentTeamThread
  readonly claims: readonly AgentTeamClaim[]
}

/** Read-only, personal Workspace Inbox projection. */
export interface AgentTeamInboxRequest {
  readonly workspaceId: WorkspaceId
  readonly limit?: number
}

/** One Thread summary containing no Message bodies. */
export interface AgentTeamInboxItem {
  readonly channelRef: AgentTeamChannelRef
  readonly task: AgentTeamTask
  readonly thread: AgentTeamThread
  readonly unreadCount: number
  readonly directCount: number
  readonly newestSequence: number
  readonly attention?: AgentTeamThreadAttention
}

export interface AgentTeamInbox {
  readonly items: readonly AgentTeamInboxItem[]
  readonly totalUnreadCount: number
  readonly totalDirectCount: number
}

/** Request to atomically receive and acknowledge one contiguous Thread batch. */
export interface AgentTeamThreadReadRequest {
  readonly requestId: AgentTeamRequestId
  readonly workspaceId: WorkspaceId
  readonly taskRef: AgentTeamTaskRef
}

export interface AgentTeamThreadReadResult {
  readonly receipt: AgentTeamOperationReceipt
  readonly task: AgentTeamTask
  readonly thread: AgentTeamThread
  readonly claims: readonly AgentTeamClaim[]
  readonly anchor: AgentTeamMessage
  /** Structured Member refs of the anchor Message, from its originating send operation. */
  readonly anchorMentions: readonly AgentTeamMemberId[]
  readonly facts: readonly AgentTeamThreadReadFact[]
  readonly readThroughSequence: number
  /** Number of unread facts left after this bounded read. */
  readonly remainingUnreadCount: number
  readonly attention?: AgentTeamThreadAttention
  readonly consumedDirectMarkers: readonly AgentTeamDirectMarker[]
}

/** Non-mutating Thread history request. */
export interface AgentTeamThreadHistoryRequest {
  readonly workspaceId: WorkspaceId
  readonly taskRef: AgentTeamTaskRef
  readonly beforeSequence?: number
  readonly limit?: number
}

export interface AgentTeamThreadHistory {
  readonly task: AgentTeamTask
  readonly thread: AgentTeamThread
  readonly anchor: AgentTeamMessage
  /** Structured Member refs of the anchor Message, from its originating send operation. */
  readonly anchorMentions: readonly AgentTeamMemberId[]
  readonly claims: readonly AgentTeamClaim[]
  readonly facts: readonly AgentTeamThreadFact[]
  readonly cursor: number
  readonly hasMore: boolean
}

/** Human-only observation of a durable personal Attention change. */
export interface AgentTeamThreadAttentionObservation {
  readonly sequence: number
  readonly threadRef: AgentTeamThreadRef
  readonly taskRef: AgentTeamTaskRef
  readonly memberId: AgentTeamMemberId
  readonly action: 'follow' | 'unfollow'
}

export interface AgentTeamThreadObservationsRequest {
  readonly workspaceId: WorkspaceId
  readonly taskRef: AgentTeamTaskRef
  readonly limit?: number
}

export interface AgentTeamThreadObservations {
  readonly items: readonly AgentTeamThreadAttentionObservation[]
}

/** One bounded Workspace view item. */
export interface AgentTeamViewItem {
  readonly message: AgentTeamMessage
  /** Structured Member refs of this Message, from its originating send operation. */
  readonly mentions: readonly AgentTeamMemberId[]
  readonly task: AgentTeamTask
  readonly thread: AgentTeamThread
  readonly taskNumber: number
  readonly messageCount: number
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
  /** Include public Claim and Task activities in the bounded stream (default true). */
  readonly includeActivities?: boolean
}

/** Bounded public collaboration facts plus a continuation sequence. */
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

/** One projection slice a Client can wait on; events wake only matching waiters. */
export type AgentTeamChangeScope =
  | { readonly kind: 'workspace'; readonly workspaceId: WorkspaceId }
  | { readonly kind: 'channel'; readonly channelRef: AgentTeamChannelRef }
  | { readonly kind: 'thread'; readonly threadRef: AgentTeamThreadRef }

/** Cursor for the lightweight Client invalidation stream. */
export interface AgentTeamChangesRequest {
  readonly afterVersion: number
  /** Restrict wake-ups to one projection scope; omit to observe every Team change. */
  readonly scope?: AgentTeamChangeScope
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
