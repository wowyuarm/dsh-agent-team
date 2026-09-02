import type { WorkspaceId } from "@deepseek-ai/dsh-workspace"
import type {
  AgentTeamActivity,
  AgentTeamAgentMember,
  AgentTeamAgentMemberStatus,
  AgentTeamAttachmentId,
  AgentTeamChannel,
  AgentTeamChannelMembership,
  AgentTeamChannelRef,
  AgentTeamClaim,
  AgentTeamClaimActivity,
  AgentTeamClaimRef,
  AgentTeamConfirmationToken,
  AgentTeamDirectMarker,
  AgentTeamMemberCapabilities,
  AgentTeamMemberId,
  AgentTeamMessage,
  AgentTeamModelSelection,
  AgentTeamOperationId,
  AgentTeamRequestId,
  AgentTeamTask,
  AgentTeamTaskActivity,
  AgentTeamTaskRef,
  AgentTeamThread,
  AgentTeamThreadAttention,
  AgentTeamThreadAttentionKey,
  AgentTeamThreadFact,
  AgentTeamThreadReadFact,
  AgentTeamThreadRef,
} from "./entities.ts"

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
  /** Durable capability intent; see AgentTeamMemberCapabilities. */
  readonly capabilities?: AgentTeamMemberCapabilities
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

/**
 * Human intent to edit one Member's mutable facts; absent optional facts
 * clear any override. Callers that do not manage capabilities must echo the
 * stored value back, or their edit would silently clear it.
 */
export interface AgentTeamUpdateMemberRequest {
  readonly requestId: AgentTeamRequestId
  readonly memberId: AgentTeamMemberId
  readonly handle: string
  /** Display purpose text; may be empty, matching creation. */
  readonly description: string
  readonly model?: AgentTeamModelSelection
  /** Absent clears any capability override, matching `model`. */
  readonly capabilities?: AgentTeamMemberCapabilities
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

/** Human intent to start one enabled Member's next turn from an empty context. */
export interface AgentTeamClearMemberContextRequest {
  readonly requestId: AgentTeamRequestId
  readonly workspaceId: WorkspaceId
  readonly memberId: AgentTeamMemberId
}

/** The Member keeps identity, memory, and binding; its sessionId moves to a fresh Session and the previous log stays archived on disk. */
export interface AgentTeamClearMemberContextResult {
  readonly receipt: AgentTeamOperationReceipt
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

/** Intent to create one top-level Message and Thread, with an optional Task. */
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
  /**
   * When false, create a taskless Thread. Omitted/true keeps the released-client
   * atomic Message+Thread+Task path. New composer/tool seams pass false explicitly.
   */
  readonly asTask?: boolean
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
  readonly threadRef?: AgentTeamThreadRef
  readonly taskRef?: AgentTeamTaskRef
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
  readonly taskRef?: AgentTeamTaskRef
  readonly threadRef: AgentTeamThreadRef
  readonly revision: number
  readonly unreadCount: number
  readonly directCount: number
}

/** A public Thread mutation used an obsolete optimistic-concurrency revision. */
export interface AgentTeamStaleRevision {
  readonly kind: 'stale_revision'
  readonly taskRef?: AgentTeamTaskRef
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
  readonly task?: AgentTeamTask
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
  readonly task?: AgentTeamTask
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

/** Human intent to attach a real Task overlay to a taskless Thread. */
export interface AgentTeamPromoteThreadRequest {
  readonly requestId: AgentTeamRequestId
  readonly workspaceId: WorkspaceId
  readonly threadRef: AgentTeamThreadRef
  readonly baseRevision: number
}

export interface AgentTeamPromoteThreadCommittedResult {
  readonly kind: 'committed'
  readonly receipt: AgentTeamOperationReceipt
  readonly activity: AgentTeamTaskActivity
  readonly task: AgentTeamTask
  readonly thread: AgentTeamThread
}

export type AgentTeamPromoteThreadResult =
  | AgentTeamPromoteThreadCommittedResult
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
  readonly threadRef?: AgentTeamThreadRef
  readonly taskRef?: AgentTeamTaskRef
  readonly action: 'follow' | 'unfollow'
}

/**
 * Agent-only direct message to one enabled Agent Member in the same
 * Workspace. Delivery is pure injection: the ledger records the send, and the
 * recipient's live session receives the body as a relay-form user message.
 */
export interface AgentTeamDmRequest {
  readonly requestId: AgentTeamRequestId
  readonly workspaceId: WorkspaceId
  readonly recipientMemberId: AgentTeamMemberId
  readonly body: string
}

export interface AgentTeamDmResult {
  readonly receipt: AgentTeamOperationReceipt
  readonly recipient: AgentTeamAgentMember
}

export interface AgentTeamThreadAttentionResult {
  readonly receipt: AgentTeamOperationReceipt
  readonly task?: AgentTeamTask
  readonly thread: AgentTeamThread
  /** Present after follow, absent after unfollow. */
  readonly attention?: AgentTeamThreadAttention
}

export interface AgentTeamThreadAttentionStatus {
  readonly task?: AgentTeamTask
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
  readonly task?: AgentTeamTask
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
  readonly threadRef?: AgentTeamThreadRef
  readonly taskRef?: AgentTeamTaskRef
}

export interface AgentTeamThreadReadResult {
  readonly receipt: AgentTeamOperationReceipt
  readonly task?: AgentTeamTask
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
  readonly threadRef?: AgentTeamThreadRef
  readonly taskRef?: AgentTeamTaskRef
  readonly beforeSequence?: number
  readonly limit?: number
}

export interface AgentTeamThreadHistory {
  readonly task?: AgentTeamTask
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
  readonly taskRef?: AgentTeamTaskRef
  readonly memberId: AgentTeamMemberId
  readonly action: 'follow' | 'unfollow'
}

export interface AgentTeamThreadObservationsRequest {
  readonly workspaceId: WorkspaceId
  readonly threadRef?: AgentTeamThreadRef
  readonly taskRef?: AgentTeamTaskRef
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
  readonly task?: AgentTeamTask
  readonly thread: AgentTeamThread
  readonly taskNumber?: number
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
