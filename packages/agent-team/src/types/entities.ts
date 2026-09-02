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

/** Stable identifier of one Task. */
export type AgentTeamTaskRef = Branded<'AgentTeamTaskRef'>

/** Stable identifier of one Thread. */
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

/**
 * Durable capability intent of one Member, carried verbatim on the Member
 * entity through every lifecycle operation. Pure intent: names are not
 * validated against any known-tool list at commit time, so a Harness upgrade
 * that renames or removes tools can never make an old ledger unreplayable.
 * Divergence surfaces at activation as runtime-derived warnings, never as
 * persisted facts (stale persisted warnings would lie after Host restart or
 * Harness upgrades).
 */
export interface AgentTeamMemberCapabilities {
  /**
   * Deliberate interface reservation, no UI writes it today: Runtime Revision
   * manifests depend on this seam — do not remove during cleanup.
   * Absent = the Member sees all standard tools; present = the activation
   * allow-list (unknown names drop with a warning; the Host always unions
   * the five Team tools over it).
   */
  readonly tools?: { readonly allow?: readonly string[] } | undefined
  /**
   * Absent = auto-load every skill in the Member's private skills directory;
   * present = only the listed skill names.
   */
  readonly skills?: { readonly allow?: readonly string[] } | undefined
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
  /** Durable capability intent; see AgentTeamMemberCapabilities. */
  readonly capabilities?: AgentTeamMemberCapabilities | undefined
  /** Host-internal namespace; never exposed through Client projections. */
  readonly privateMemoryPath: string
  /**
   * Durable lifecycle state. `enabled`/`suspended` are the reversible working
   * pair; `archived` hides the Member from every surface while keeping its
   * Session log and private memory recoverable (no restore entry point yet,
   * mirroring archived dsh sessions); `inactive` is irreversible removal with
   * data cleanup.
   */
  readonly state: 'enabled' | 'suspended' | 'inactive' | 'archived'
}

/**
 * Runtime-derived capability divergence between a Member's persisted intent
 * and the names known at activation time (for example after a Harness
 * upgrade renamed or removed a tool). Derived state only — never persisted;
 * recomputed at every activation so warnings never go stale.
 */
export interface AgentTeamCapabilityWarning {
  /** The persisted allow-list entry that resolved to no known capability. */
  readonly name: string
  /** Digest of the names that were known when the entry was dropped. */
  readonly knownNames: readonly string[]
}

/** Host projection combining durable intent with process-local availability. */
export interface AgentTeamAgentMemberStatus {
  readonly member: AgentTeamAgentMember
  readonly availability: 'active' | 'suspended' | 'inactive' | 'archived' | 'unavailable'
  readonly presence: 'available' | 'working' | 'error' | 'unavailable'
  readonly diagnostic?: string
  /**
   * Runtime-derived, activation-scoped capability warnings (see
   * AgentTeamCapabilityWarning); empty while capabilities resolve cleanly.
   */
  readonly capabilityWarnings?: readonly AgentTeamCapabilityWarning[] | undefined
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

export interface AgentTeamOperationBase {
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
  /** Absent on Messages committed while the Thread had no Task; promotion does not rewrite prior Messages. */
  readonly taskRef?: AgentTeamTaskRef
  readonly sender: AgentTeamMemberId
  readonly body: string
  readonly attachments?: readonly AgentTeamMessageAttachment[] | undefined
  readonly topLevel: boolean
  readonly sequence: number
  /** Wall-clock instant of the wrapping ledger operation; pre-occurredAt ledgers normalize on replay. */
  readonly occurredAt: string
}

/** Task overlay created by an atomic start or Human promotion. */
export interface AgentTeamTask {
  readonly taskRef: AgentTeamTaskRef
  readonly channelRef: AgentTeamChannelRef
  readonly threadRef: AgentTeamThreadRef
  readonly status: 'todo' | 'in_progress' | 'in_review' | 'done' | 'closed'
  readonly resolution: 'open' | 'accepted' | 'closed'
}

/** Current projection of one collaboration Thread. */
export interface AgentTeamThread {
  readonly threadRef: AgentTeamThreadRef
  /** Present after atomic Task creation or Human promotion; absent on taskless Threads. */
  readonly taskRef?: AgentTeamTaskRef
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
  readonly kind: 'promote' | 'accept' | 'close' | 'reopen'
  /** Claims atomically released by close; absent for other Task transitions. */
  readonly releasedClaimRefs?: readonly AgentTeamClaimRef[] | undefined
  /** Active claims the Human acceptance completed alongside the Task; absent for plain accepts. */
  readonly completedClaimRefs?: readonly AgentTeamClaimRef[] | undefined
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

