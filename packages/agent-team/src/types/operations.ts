import type { SessionId } from "@deepseek-ai/dsh-session"
import type { WorkspaceId } from "@deepseek-ai/dsh-workspace"
import type {
  AgentTeamAgentMember,
  AgentTeamChannel,
  AgentTeamChannelRef,
  AgentTeamOperationBase,
  AgentTeamClaim,
  AgentTeamClaimActivity,
  AgentTeamClaimsReleasedActivity,
  AgentTeamInboxDelta,
  AgentTeamMemberId,
  AgentTeamMessage,
  AgentTeamStoredMessage,
  AgentTeamStoredThreadReadFact,
  AgentTeamTask,
  AgentTeamTaskActivity,
  AgentTeamThread,
  AgentTeamThreadAttention,
} from "./entities.ts"

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
 * Durable archival of one Agent Member: the Member leaves every surface while
 * its Session log and private memory stay recoverable. Like removal, the
 * operation records the full cleanup snapshot — released Claims, public
 * release Activities, and the Member's Inbox delta — so replay recomputes the
 * same projection without runtime state.
 */
export interface AgentTeamMemberArchivedOperation extends AgentTeamOperationBase {
  readonly kind: 'team/member-archived'
  readonly data: {
    readonly member: AgentTeamAgentMember
    /** Claims released because this Member became hidden. */
    readonly claims: readonly AgentTeamClaim[]
    /** Public release summaries for the affected Threads. */
    readonly activities: readonly AgentTeamClaimsReleasedActivity[]
    readonly tasks: readonly AgentTeamTask[]
    readonly threads: readonly AgentTeamThread[]
    readonly inbox: AgentTeamInboxDelta
  }
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

/**
 * Legacy audit record of one in-place Member context clear (superseded by
 * `team/member-session-renewed`). The Host discarded the Member's persisted
 * Session log and recreated the live Session under the same sessionId.
 * Projection state is unchanged, so apply() treats this operation as a marker
 * only. Never written again; the schema and replay validation stay so
 * ledgers recorded before the renewal redesign keep replaying.
 */
export interface AgentTeamMemberContextClearedOperation extends AgentTeamOperationBase {
  readonly kind: 'team/member-context-cleared'
  readonly data: { readonly member: AgentTeamAgentMember }
}

/**
 * Durable transition of one Member onto a fresh Session: the Member keeps its
 * identity, memory, and binding while its sessionId moves to a newly created
 * Session whose first turn starts from an empty context. The previous Session
 * log stays on disk (archived from every grouping surface), and the new
 * Session header records the previous id as fork lineage.
 */
export interface AgentTeamMemberSessionRenewedOperation extends AgentTeamOperationBase {
  readonly kind: 'team/member-session-renewed'
  readonly data: {
    readonly member: AgentTeamAgentMember
    /** The Session the Member ran on before this renewal. */
    readonly previousSessionId: SessionId
  }
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

/**
 * Durable archival of one Channel: the Channel and its Threads leave every
 * surface while all facts stay recoverable. Every active Claim on the
 * Channel's Threads releases (any owner), and every affected Member's
 * Attention and markers for those Threads clear — a hidden Channel must not
 * leave Tasks stuck in progress or phantom unread counts.
 */
export interface AgentTeamChannelArchivedOperation extends AgentTeamOperationBase {
  readonly kind: 'team/channel-archived'
  readonly data: {
    readonly workspaceId: WorkspaceId
    /** The Channel with its state moved to `archived`. */
    readonly channel: AgentTeamChannel
    /** Claims released across every Member with an active Claim here. */
    readonly claims: readonly AgentTeamClaim[]
    /** Public release summaries for the affected Threads. */
    readonly activities: readonly AgentTeamClaimsReleasedActivity[]
    readonly tasks: readonly AgentTeamTask[]
    readonly threads: readonly AgentTeamThread[]
    /** Attention and marker cleanup for every affected Member. */
    readonly inbox: AgentTeamInboxDelta
  }
}

/** Durable top-level Message, Thread, optional Task, and initial inbox facts. */
export interface AgentTeamMessageSentOperation extends AgentTeamOperationBase {
  readonly kind: 'team/message-sent'
  readonly data: {
    readonly workspaceId: WorkspaceId
    readonly mentions: readonly AgentTeamMemberId[]
    readonly message: AgentTeamMessage
    readonly task?: AgentTeamTask
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
    readonly task?: AgentTeamTask
    readonly thread: AgentTeamThread
    readonly inbox: AgentTeamInboxDelta
  }
}

/** Durable Human promotion of a taskless Thread into a real Task, announced by a structured Task activity. */
export interface AgentTeamThreadPromotedOperation extends AgentTeamOperationBase {
  readonly kind: 'team/thread-promoted'
  readonly data: {
    readonly workspaceId: WorkspaceId
    readonly baseRevision: number
    readonly activity: AgentTeamTaskActivity
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
    readonly task?: AgentTeamTask
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
    readonly task?: AgentTeamTask
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

/**
 * Durable audit record of one Member-to-Member direct message. A DM is pure
 * delivery: it creates no Channel/Thread/revision, no Inbox attention, and no
 * markers. The ledger records it for audit, idempotent retries, and post-
 * compaction traceability; the wake itself is a transient runtime effect.
 */
export interface AgentTeamDmSentOperation extends AgentTeamOperationBase {
  readonly kind: 'team/dm-sent'
  readonly data: {
    readonly workspaceId: WorkspaceId
    readonly senderMemberId: AgentTeamMemberId
    readonly recipientMemberId: AgentTeamMemberId
    readonly body: string
  }
}

/** Closed union of durable Agent Team operations. */
export type AgentTeamOperation =
  | AgentTeamInitializedOperation
  | AgentTeamChannelCreatedOperation
  | AgentTeamMemberAddedOperation
  | AgentTeamMemberSuspendedOperation
  | AgentTeamMemberResumedOperation
  | AgentTeamMemberArchivedOperation
  | AgentTeamMemberSessionRestartedOperation
  | AgentTeamMemberContextClearedOperation
  | AgentTeamMemberSessionRenewedOperation
  | AgentTeamChannelUpdatedOperation
  | AgentTeamMemberUpdatedOperation
  | AgentTeamChannelMemberAddedOperation
  | AgentTeamChannelMemberRemovedOperation
  | AgentTeamChannelArchivedOperation
  | AgentTeamMessageSentOperation
  | AgentTeamThreadRepliedOperation
  | AgentTeamThreadPromotedOperation
  | AgentTeamClaimCreatedOperation
  | AgentTeamClaimDoneOperation
  | AgentTeamClaimReleasedOperation
  | AgentTeamTaskChangedOperation
  | AgentTeamThreadAttentionChangedOperation
  | AgentTeamThreadReadOperation
  | AgentTeamMemberRemovedOperation
  | AgentTeamDmSentOperation

