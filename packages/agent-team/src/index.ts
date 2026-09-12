/**
 * Durable Agent Team Host capability.
 *
 * The Host owns the append-only collaboration ledger and all Member lifecycle
 * effects. Session history and browser state are projections, never Team facts.
 * @module @wowyuarm/dsh-agent-team
 */

import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { Context, Service } from '@deepseek-ai/cordis'
import { installModelSelection, type Agent, type AgentHandle, type ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-agent-presets'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { scopeOf } from '@deepseek-ai/dsh-scope'
import { Session, SessionId, SessionLogOffset, type SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-tools'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import { ATTACHMENT_MAX_BYTES, attachmentPayloadPath, attachmentsRoot, copyPathAttachment, newAttachmentId, readAttachment, sanitizeMediaType, sweepAttachmentCache, validatePathAttachment, writeAttachment } from './attachments.ts'
import { PressurePolicyCoordinator } from './pressure-policy.ts'
import { ContextManagementCoordinator, type TransitionPlan } from './context-management.ts'
import { AGENT_TEAM_PLUGIN_ID, createHandoffMessage } from './context-source.ts'
import { carriedInputOf, checkpointByRef, checkpointRefFor, foldContextProjection, isReminderNoticeSummary, timelineCandidates, type AgentTeamContextProjectionState, type TimelineCandidate } from './context-projection.ts'
import { AGENT_TEAM_HUMAN_MEMBER_ID, AgentTeamLedger, agentTeamHumanActor, type AgentTeamDurableMemberResult } from './ledger.ts'
import { AGENT_TEAM_TOOL_NAMES, deepCopyCapabilities, memberMemoryDirectoryName, MemberRuntime } from './member-runtime.ts'
import { ProgressNudgeCoordinator } from './progress-nudge.ts'
import type { MemberSkillSelectionRef } from './member-skills.ts'
import { classifyRecoverableError, RecoveryCoordinator, RECOVERY_MAX_CONSECUTIVE_ERRORS } from './recovery.ts'
import { SessionRemediation, handoffAlreadyInLog } from './session-remediation.ts'
import { StoredSessionReadError, StoredSessionReader, sessionFailureOf } from './stored-session-reader.ts'
import { agentTeamDomainSpec } from './spec.ts'
import { formatTeamTimestamp } from './time-format.ts'
import type {
  AgentTeamAddMemberRequest,
  AgentTeamAgentMember,
  AgentTeamAgentMemberStatus,
  AgentTeamArchiveChannelRequest,
  AgentTeamArchiveChannelResult,
  AgentTeamArchiveMemberRequest,
  AgentTeamArchiveMemberResult,
  AgentTeamChangeScope,
  AgentTeamChangesRequest,
  AgentTeamChangesResult,
  AgentTeamActivity,
  AgentTeamClaimList,
  AgentTeamClaimRequest,
  AgentTeamClaimResult,
  AgentTeamClientMemberStatus,
  AgentTeamContextCheckpointRef,
  AgentTeamAttachmentId,
  AgentTeamModelSelection,
  AgentTeamCreateChannelRequest,
  AgentTeamCreateChannelResult,
  AgentTeamGetAttachmentRequest,
  AgentTeamGetAttachmentResult,
  AgentTeamInbox,
  AgentTeamInboxRequest,
  AgentTeamJoinChannelRequest,
  AgentTeamJoinChannelResult,
  AgentTeamHumanActor,
  AgentTeamMemberActor,
  AgentTeamMessageAttachment,
  AgentTeamMemberId,
  AgentTeamMemberResult,
  AgentTeamMembersRequest,
  AgentTeamResolveTaskRefsRequest,
  AgentTeamResolveTaskRefsResult,
  AgentTeamTaskRef,
  AgentTeamThreadRef,
  AgentTeamOperationReceipt,
  AgentTeamPromoteThreadRequest,
  AgentTeamPromoteThreadResult,
  AgentTeamPutAttachmentRequest,
  AgentTeamPutAttachmentResult,
  AgentTeamRecoverMemberRequest,
  AgentTeamRecoverMemberResult,
  AgentTeamClearMemberContextRequest,
  AgentTeamClearMemberContextResult,
  AgentTeamRolloverSessionRequest,
  AgentTeamDmRequest,
  AgentTeamDmResult,
  AgentTeamOperationId,
  AgentTeamRemoveChannelMemberRequest,
  AgentTeamRemoveChannelMemberResult,
  AgentTeamRemoveMemberRequest,
  AgentTeamRemoveMemberResult,
  AgentTeamReplyRequest,
  AgentTeamReplyResult,
  AgentTeamSendMessageRequest,
  AgentTeamSendMessageResult,
  AgentTeamSetMemberStateRequest,
  AgentTeamStatus,
  AgentTeamTask,
  AgentTeamTaskRequest,
  AgentTeamTaskResult,
  AgentTeamThreadAttentionRequest,
  AgentTeamThreadAttentionResult,
  AgentTeamThreadAttentionStatus,
  AgentTeamThreadHistory,
  AgentTeamThreadHistoryRequest,
  AgentTeamThreadReadRequest,
  AgentTeamThreadReadResult,
  AgentTeamContextAdvice,
  AgentTeamMemberDiagnostic,
  AgentTeamThreadObservations,
  AgentTeamThreadObservationsRequest,
  AgentTeamUpdateChannelRequest,
  AgentTeamUpdateChannelResult,
  AgentTeamUpdateMemberRequest,
  AgentTeamView,
  AgentTeamViewRequest,
} from './types.ts'

export { agentTeamDomainSpec, agentTeamOperationSchema } from './spec.ts'
export type * from './types.ts'
export { AGENT_TEAM_HUMAN_MEMBER_ID, AGENT_TEAM_INITIALIZE_REQUEST_ID } from './ledger.ts'
export { AGENT_TEAM_TOOL_NAMES } from './member-runtime.ts'

/** Process-stable marker carried by the final Team message tool definition. */
export const AGENT_TEAM_PRESET_MARKER = Symbol.for('@wowyuarm/dsh-agent-team.preset')


const INBOX_NOTICE_SUMMARY = 'Team Inbox has unread work.'
const RECOVERY_NOTICE_SUMMARY = 'Recovery: continue your interrupted work.'
const ORPHANED_MEMBER_DIAGNOSTIC = 'Member preset composition was lost after a reload; its tools are unavailable. Resume rebuilds the member in place.'

/**
 * A preset mount/validation failure during activation, carrying its own class
 * so the activation diagnostic can route preset-composition failures (the
 * install/runtime split failure mode) without matching message text.
 */
class PresetCompositionError extends Error {
  constructor(message: string, options: ErrorOptions) {
    super(message, options)
    this.name = 'PresetCompositionError'
  }
}

/** Longest accepted model-supplied checkpoint display name. */
const MAX_CHECKPOINT_NAME_CHARS = 120
/** Default and maximum number of timeline items one query returns. */
const DEFAULT_TIMELINE_LIMIT = 12
const MAX_TIMELINE_LIMIT = 24
/** Deepest ancestor lineage the timeline and seed resolution walk. */
const MAX_TIMELINE_ANCESTORS = 8
/** Product pressure budget constants (see docs/team-collaboration.md). */
const CONTEXT_HARD_LIMIT_CAP = 256_000
const CONTEXT_HANDOFF_AT_CAP = 200_000
const CONTEXT_HANDOFF_RESERVE = 8_000
const CONTEXT_SAFE_OUTPUT_RESERVE = 16_000
/**
 * Usage at or above which an acknowledged acceptance advises a fresh
 * rollover instead of keeping the context; capped by the route's effective
 * handoff budget so narrow routes get a proportionally earlier boundary.
 */
const ACCEPT_TASK_BOUNDARY_THRESHOLD = 128_000

/** One parked long-poll, restricted to one change scope when it declares one. */
interface ChangeWaiter {
  readonly scope: AgentTeamChangeScope | undefined
  wake(version: number): void
}

function sameChangeScope(left: AgentTeamChangeScope, right: AgentTeamChangeScope): boolean {
  if (left.kind === 'workspace' && right.kind === 'workspace') return left.workspaceId === right.workspaceId
  if (left.kind === 'channel' && right.kind === 'channel') return left.channelRef === right.channelRef
  if (left.kind === 'thread' && right.kind === 'thread') return left.threadRef === right.threadRef
  return false
}

/** Mark the preset's `team_message` definition as an Agent Team consumer. */
export function markAgentTeamPreset<T extends object>(definition: T): T {
  Object.defineProperty(definition, AGENT_TEAM_PRESET_MARKER, { value: true })
  return definition
}

/**
 * Whether the running dsh loads workspace packages from source via tsx.
 *
 * The Harness `tsconfig.base.json` maps `@deepseek-ai/*` package names onto
 * `src/` directories; tsx honors those paths, so a CLI launched with
 * `node --import tsx/esm apps/cli/src/bin.ts` imports `@deepseek-ai/dsh-scope`
 * from `src/index.ts` while a profile-installed bundle resolves the compiled
 * `lib/index.js` — two module instances with independent scope keys.
 */
export function isTsxDevMode(): boolean {
  const flags = [...process.execArgv]
  const nodeOptions = process.env.NODE_OPTIONS
  if (nodeOptions !== undefined) flags.push(...nodeOptions.split(/\s+/))
  return flags.some(flag => flag.includes('tsx'))
}

/**
 * The activation diagnostic for a dsh-scope module-instance mismatch.
 *
 * `agentPresets.mount` already rejected an unscoped context, so a scope key
 * the harness sees but this bundle does not can only mean the two sides
 * loaded different physical copies of `@deepseek-ai/dsh-scope`.
 */
export function teamPresetScopeMismatchMessage(tsxDevMode: boolean): string {
  if (tsxDevMode) {
    return 'selected preset is not team-enabled: the dsh CLI is running from source via tsx (tsconfig paths resolve @deepseek-ai/dsh-scope to src/), so the harness and this bundle load different module instances; start dsh with the compiled CLI instead (pnpm dsh, node apps/cli/lib/bin.js, or npx @deepseek-ai/dsh)'
  }
  return 'selected preset is not team-enabled: this bundle and the harness resolved different physical copies of @deepseek-ai/dsh-scope; run pnpm install in the profile directory so node_modules matches the lockfile, then restart'
}

export interface AgentTeamCommitted {
  readonly receipt: AgentTeamOperationReceipt
}

/**
 * A DM was durably recorded but its session injection could not run (no live
 * handle, or the wake itself failed). The recorded DM stays durable; the
 * sender should not blindly retry — the recipient recovers it through its DM
 * history once its session is live again.
 */
export class AgentTeamDmDeliveryError extends Error {
  constructor(readonly recipientMemberId: AgentTeamMemberId, readonly recipientHandle: string, message: string) {
    super(message)
    this.name = 'AgentTeamDmDeliveryError'
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    agentTeam: AgentTeam
  }

  interface Events {
    /** One new Team operation is durable and visible through Host projections. */
    'agent-team/committed'(event: AgentTeamCommitted): void
  }
}

/** Tool-side request for one context rollover; the Host validates without side effects. */
export interface AgentTeamNewContextToolRequest {
  readonly memberId: AgentTeamMemberId
  /** Selected checkpoint ref from `context_timeline`; absent means fresh. */
  readonly checkpointRef?: AgentTeamContextCheckpointRef
  readonly relatedFiles?: readonly { readonly path: string; readonly reason: string }[]
}

/** Tool-side validation outcome: which rollover mode a successful call will take. */
export interface AgentTeamNewContextToolOutcome {
  readonly mode: 'fresh' | 'from-checkpoint'
}

/** Tool-side request for one explicit checkpoint; the Host validates without side effects. */
export interface AgentTeamCheckpointToolRequest {
  readonly memberId: AgentTeamMemberId
  /** Provider-issued call id of this tool call; the stable ref derives from it. */
  readonly callId: string
  readonly name: string
}

/** Tool-side checkpoint validation outcome: the deterministic ref the result will carry. */
export interface AgentTeamCheckpointToolOutcome {
  readonly checkpointRef: AgentTeamContextCheckpointRef
  readonly name: string
}

/** Tool-side request for the bounded structural context timeline. */
export interface AgentTeamTimelineToolRequest {
  readonly memberId: AgentTeamMemberId
  readonly limit?: number
}

/** One structural timeline item: a checkpoint or boundary candidate with pricing. */
export interface AgentTeamTimelineItem {
  /** Opaque stable ref; the selection surface for `context_rollover.checkpointRef`. */
  readonly checkpointRef: string
  /** Semantic label: the model-supplied checkpoint name or boundary label. */
  readonly name: string
  /** Which structural source produced this item. */
  readonly source: 'agent' | 'team-boundary' | 'handoff' | 'compaction' | 'head'
  /** Approximate tokens a return would retain (the prefix through this anchor). */
  readonly retainedTokens: number
  /** Approximate tokens a return would discard (the suffix after this anchor). */
  readonly discardedTokens: number
  /**
   * Threads whose facts entered this Session's model context by this anchor
   * (delivered Team notices only — never unread ledger activity). Empty when
   * nothing attributable was delivered.
   */
  readonly affectedThreads: readonly string[]
  /** Whether `context_rollover` accepts this ref as a seed target. */
  readonly restorable: boolean
  /** When not restorable, the concise reason. */
  readonly reason?: string
  /** Session the candidate anchors in; present for non-current-generation sources. */
  readonly sourceSessionId?: SessionId
}

/** Tool-side timeline outcome: usage plus the bounded structural candidate list. */
export interface AgentTeamTimelineToolResult {
  readonly usageTokens: number
  readonly hardLimit: number
  readonly handoffAt: number
  readonly items: readonly AgentTeamTimelineItem[]
  /**
   * The unreadable ancestor that ended the lineage walk early, when one did:
   * history is complete through the last listed source and provably absent
   * beyond it. Never a Member-availability fact.
   */
  readonly incompleteFrom?: { readonly sessionId: SessionId; readonly reason: string }
}

/** One resolved checkpoint seed: the exact balanced prefix plus its source. */
interface CheckpointSeed {
  readonly checkpointRef: AgentTeamContextCheckpointRef
  /** Session the checkpoint was recorded in; the child's lineage parent. */
  readonly sourceSessionId: SessionId
  /** Exclusive end of the seed prefix: its exact length in the source log. */
  readonly sourceThroughSeq: SessionLogOffset
  /** Contiguous events from seq 0 through the checkpoint's completed turn. */
  readonly prefix: readonly SessionEvent[]
}

/** Host owner of the single Agent Team in one dshHome. */
export default class AgentTeam extends TypertRemoteService {
  static inject = [
    'storageDomain',
    'workspaceRegistry',
    'agents',
    'agentDefaultModel',
    'agentPresets',
    'tools',
    'sessionPersistence',
  ]

  private domain?: Domain<typeof agentTeamDomainSpec>
  private ledger?: AgentTeamLedger
  private readonly handles = new Map<AgentTeamMemberId, AgentHandle>()
  /** Live Member per session id; drives the root session/event listener. */
  private readonly memberBySessionId = new Map<SessionId, AgentTeamMemberId>()
  /** Live selection refs let model edits take effect without disposing the Session. */
  private readonly modelSelections = new Map<AgentTeamMemberId, ModelSelectionRef>()
  /** Agent ids with a turn in flight; restarts must wait for the boundary. */
  private readonly runningAgents = new Set<SessionId>()
  /** Per-Member runtime state: tool restrictions, skill mounts, warnings, private memory. */
  private readonly memberRuntime = new MemberRuntime({
    // Deferred field access: the constructor runs before `handles` is
    // populated, so the resolver must dereference at call time.
    ctx: this.ctx,
    liveMemberContext: memberId => {
      const handle = this.handles.get(memberId)
      if (handle === undefined) throw new Error(`Agent Member '${this.memberLabel(memberId)}' has no live session for a tool-policy update`)
      return handle.agent.ctx
    },
    runningAgents: this.runningAgents,
  })
  /**
   * The single seam for every per-Session stored read: handle lifecycle and
   * failure normalization live here, so a DSH persistence-interface change is
   * adapted once, and consumers choose policy by failure category instead of
   * matching error text.
   */
  private readonly sessionReader = new StoredSessionReader(this.ctx)
  /**
   * Why one Member shows error presence, per failure source. Reads prefer
   * activation, then runtime, then compaction; slots clear independently, so
   * a recovered runtime error re-reveals an outstanding compaction failure.
   * Keyed by Member rather than Session so a restarted Session cannot leak
   * stale keys.
   */
  private readonly memberFailures = new Map<AgentTeamMemberId, {
    /** Activation failed; the Member has no live Session to recover into. */
    activation?: AgentTeamMemberDiagnostic
    /** The Member Session reported agent/error. */
    runtime?: string
    /** Last non-busy automatic-compaction failure; entered transactions retain additional Session history. */
    compaction?: string
  }>()
  private readonly pressurePolicy: PressurePolicyCoordinator
  private readonly notifiedInbox = new Map<AgentTeamMemberId, string>()
  private attachmentGcTimer?: ReturnType<typeof setInterval> | undefined

  private readonly recovery = new RecoveryCoordinator({
    wake: memberId => {
      this.ctx.logger.info(`agent-team: automatic recovery wakeup for member '${this.memberLabel(memberId)}' after consecutive recoverable failures`)
      this.injectRecovery(memberId)
    },
    onStandDown: (memberId, consecutiveFailures) => {
      this.ctx.logger.warn(`agent-team: member '${this.memberLabel(memberId)}' reached ${consecutiveFailures}/${RECOVERY_MAX_CONSECUTIVE_ERRORS} consecutive recoverable failures; leaving it in error for the operator`)
    },
  })
  /**
   * Advisory progress-visibility nudges. Purely in-process: the ledger owns
   * eligibility, this coordinator owns counting and notices, and neither ever
   * writes Team facts. See docs/team-collaboration.md for the regimes.
   */
  private readonly progressNudge = new ProgressNudgeCoordinator({
    agentForMember: memberId => this.handles.get(memberId)?.agent,
    targetsForMember: memberId => this.requireLedger().progressNudgeTargets(memberId),
    sessionLogForMember: (memberId, sessionId) => {
      const handle = this.handles.get(memberId)
      if (handle === undefined || handle.agent.session.id !== sessionId) return undefined
      return { events: handle.agent.session.ownEvents() }
    },
    log: message => { this.ctx.logger.warn(message) },
  })
  /**
   * Context self-management: the one deep module that turns a Member's
   * successful `context_rollover` tool result into its next private context
   * generation. The ledger owns the binding audit, the Session projection
   * owns intent, and this coordinator owns only reconstructible process
   * state. See docs/architecture.md and docs/team-collaboration.md.
   */
  private readonly contextManagement = new ContextManagementCoordinator({
    agentForMember: memberId => this.handles.get(memberId)?.agent,
    memberForAgent: agent => this.memberForAgent(agent),
    projectionForMember: (memberId, sessionId) => {
      const handle = this.handles.get(memberId)
      if (handle === undefined || handle.agent.session.id !== sessionId) return undefined
      return foldContextProjection(handle.agent.session.ownEvents(), handle.agent.session.inheritedEventCount, handle.agent.session.id)
    },
    executeTransition: (memberId, plan) => this.executeMemberTransition(memberId, plan),
    log: message => { this.ctx.logger.warn(`agent-team: ${message}`) },
  })
  private lifecycleTail: Promise<void> = Promise.resolve()
  private accepting = true
  private changeVersion = 0
  private readonly changeWaiters = new Set<ChangeWaiter>()
  /**
   * The startup-opened remediation instance, held for the restart heal: the
   * completion-cache domain may only be opened once per plugin lifecycle, so
   * the restart path reuses this instance instead of opening its own.
   */
  private remediation: SessionRemediation | undefined

  constructor(ctx: Context) {
    super(ctx, 'agentTeam')
    this.pressurePolicy = new PressurePolicyCoordinator({
      agentForMember: memberId => this.handles.get(memberId)?.agent,
      memberForAgent: agent => {
        const member = this.memberForAgent(agent)
        return member === undefined ? undefined : { memberId: member.memberId, sessionId: agent.id }
      },
      compactionForAgent: agent => this.ctx.agentPresets.serviceFor(agent, 'compaction'),
      limitsForAgent: agent => this.routeLimitsForAgent(agent),
      activeClaimLabels: memberId => this.activeClaimLabels(memberId),
      runningJobLabels: memberId => this.runningJobLabels(memberId),
      failed: (memberId, _sessionId, diagnostic) => {
        this.setMemberFailure(memberId, 'compaction', diagnostic)
        this.emitAutoCompactionChanged(memberId)
      },
      log: message => { this.ctx.logger.warn(`agent-team: ${message}`) },
    })
  }

  /** Open the durable ledger and restore every enabled Member independently. */
  protected async [Service.init](): Promise<void> {
    this.ctx.on('agent/error', ({ agent, error }) => {
      const member = this.memberForAgent(agent)
      if (member === undefined) return
      const message = error instanceof Error ? error.message : String(error)
      this.setMemberFailure(member.memberId, 'runtime', message)
      const kind = classifyRecoverableError(message)
      if (kind !== undefined) this.ctx.logger.warn(`agent-team: member '${member.handle}' hit a recoverable ${kind} error; recording a consecutive error occurrence`)
      this.recovery.onError(member.memberId, message)
      this.emitChanged([{ kind: 'workspace', workspaceId: member.workspaceId }])
    })
    this.ctx.on('agent/status', ({ agent, status }) => {
      const member = this.memberForAgent(agent)
      if (status === 'running') this.runningAgents.add(agent.id)
      else this.runningAgents.delete(agent.id)
      if (status === 'running' && member !== undefined) {
        const recovered = this.clearMemberFailure(member.memberId, 'runtime')
        if (recovered) this.notifiedInbox.delete(member.memberId)
        this.emitChanged([{ kind: 'workspace', workspaceId: member.workspaceId }])
        // A rollover/recovery in flight delivers its own sequenced
        // rederived Inbox after the handoff and carried input; a status-driven
        // steer here would claim the handoff turn's next step and leapfrog
        // the carried messages.
        if (!this.contextManagement.isTransitioning(member.memberId)) this.notifyMember(agent)
      }
      // A turn that ends without an error closes any automatic recovery episode.
      // The idle transition is itself presence-affecting (working → available),
      // so it must wake workspace watchers exactly like the running transition
      // above; without this wake, cached Client member rows keep showing the
      // Member as working after every turn until an unrelated change arrives.
      if (status === 'idle' && member !== undefined) {
        if (this.memberFailures.get(member.memberId)?.runtime === undefined) {
          this.recovery.onCleanTurnEnd(member.memberId)
        }
        this.emitChanged([{ kind: 'workspace', workspaceId: member.workspaceId }])
      }
    })
    // Progress nudges count every `tool/call` of each Member Session. The
    // store's dispatch carrier is untagged, so a scope-tagged listener inside
    // the Agent setup would receive nothing; one root listener that maps the
    // session id back to its Member is the seam that works (same shape as the
    // `agent/status` listener above). The first turn of a freshly published
    // Member cannot race this: `handles.set()` precedes the same activation
    // continuation that publishes the Agent, so by the time any tool call
    // streams, the map lookup succeeds.
    this.ctx.on('session/event', (session, event) => {
      const memberId = this.memberBySessionId.get(session.id)
      if (memberId === undefined) return
      const handle = this.handles.get(memberId)
      if (handle === undefined || handle.agent.session.id !== session.id) return
      this.progressNudge.onSessionEvent(memberId, session.id, handle.agent, event)
      // A successful assistant response ends any open provider-overflow
      // recovery sequence for this Member.
      if (event.type === 'assistant/message') this.pressurePolicy.onAssistantMessage(handle.agent)
      // Context management reacts only after a successful durable tool/result;
      // the projection (not this listener) decides what that means.
      this.contextManagement.onSessionEvent(memberId, handle.agent, event)
    })
    const domain = await this.ctx.storageDomain.open(agentTeamDomainSpec)
    this.ctx.effect(() => async () => {
      this.accepting = false
      this.remediation = undefined
      this.recovery.dispose()
      this.progressNudge.dispose()
      this.contextManagement.dispose()
      this.pressurePolicy.dispose()
      if (this.attachmentGcTimer !== undefined) clearInterval(this.attachmentGcTimer)
      this.attachmentGcTimer = undefined
      this.emitChanged()
      await this.lifecycleTail
      await Promise.all([...this.handles.values()].map(handle => handle.dispose()))
      this.handles.clear()
      this.modelSelections.clear()
      this.memberRuntime.disposeAll()
      this.runningAgents.clear()
      await domain.close()
    }, 'agentTeam.dispose')
    this.domain = domain
    const ledger = new AgentTeamLedger(domain.table('operations'))
    this.ledger = ledger
    const initialization = await ledger.initialize()
    if (initialization.committed) this.emitCommitted(initialization.value)
    this.startAttachmentGc(ledger)
    // Legacy-artifact remediation runs before any Member activation: no write
    // lease exists yet, so publishing sibling generations for refused Session
    // logs cannot race a live writer. Remediation failure never blocks
    // startup — the next start retries exactly what the cache does not cover.
    try {
      const remediation = new SessionRemediation(this.ctx, this.ctx.sessionPersistence, await SessionRemediation.open(this.ctx))
      this.remediation = remediation
      await remediation.remediateEnabledMembers(ledger.listMembers())
    } catch (error) {
      this.ctx.logger.warn(`agent-team: legacy Session remediation did not run to completion (it will retry on the next start): ${error instanceof Error ? error.message : String(error)}`)
    }
    // One metadata listing serves every Member restore; per-member list calls
    // would repeat the same I/O linearly during startup.
    const persistedSessions = new Set((await this.persistedSessionHeaders()).map(snapshot => snapshot.header.id))
    for (const member of ledger.listMembers()) {
      if (member.state === 'enabled') await this.activateMember(member, undefined, persistedSessions)
      else if (member.state === 'inactive') await this.memberRuntime.cleanupRemovedMember(member)
    }
  }

  /**
   * Whether one Member Session has durable persisted content, decided through
   * {@link SessionPersistence.stat} rather than a bare metadata listing: the
   * backend reports a still-draining session through its pending header, so a
   * resume racing a suspend's fire-and-forget final flush cannot mistake a
   * still-draining persisted Session for an unpersisted one and fork a fresh
   * generation over it.
   */
  private async sessionPersisted(sessionId: SessionId): Promise<boolean> {
    return this.sessionReader.exists(sessionId)
  }

  /** Resolve one exact live Agent to its durable Team Member; forks do not inherit identity. */
  memberForAgent(agent: Agent): AgentTeamAgentMember | undefined {
    for (const [memberId, handle] of this.handles) {
      if (handle.agent === agent) return this.requireLedger().getMember(memberId)
    }
    return undefined
  }

  /** Return every durable Member with current process availability. */
  members(): readonly AgentTeamAgentMemberStatus[] {
    return this.requireLedger().listMembers().map(member => this.memberStatus(member))
  }

  /** Read-only navigation lookup for branded Task refs found in message bodies. */
  @Remote('resolveTaskRefs')
  resolveTaskRefs(request: AgentTeamResolveTaskRefsRequest): AgentTeamResolveTaskRefsResult {
    this.requireWorkspace(request.workspaceId)
    const seen = new Set<AgentTeamTaskRef>()
    const taskRefs = request.taskRefs.filter(taskRef => {
      if (seen.has(taskRef)) return false
      seen.add(taskRef)
      return true
    })
    return Object.freeze({ resolved: Object.freeze(this.requireLedger().resolveTaskRefs(request.workspaceId, taskRefs)) })
  }

  /** Return only this Workspace's current Member projection to the Client. */
  @Remote('members')
  membersForClient(request: AgentTeamMembersRequest): readonly AgentTeamClientMemberStatus[] {
    this.requireWorkspace(request.workspaceId)
    return this.members()
      .filter(status => status.member.workspaceId === request.workspaceId)
      .map(({ member: { privateMemoryPath: _privateMemoryPath, ...member }, ...status }) => Object.freeze({ ...status, member: Object.freeze(member) }))
  }

  /** Wait for a lightweight projection invalidation without exposing ledger records. */
  @Remote('changes')
  async changes(request: AgentTeamChangesRequest, signal?: AbortSignal): Promise<AgentTeamChangesResult> {
    if (!Number.isInteger(request.afterVersion) || request.afterVersion < 0) throw new Error('afterVersion must be a non-negative integer')
    const scope = this.validateChangeScope(request.scope)
    if (this.changeVersion > request.afterVersion || !this.accepting) return Object.freeze({ version: this.changeVersion })
    return new Promise<AgentTeamChangesResult>((resolve, reject) => {
      let settled = false
      const waiter: ChangeWaiter = {
        scope,
        wake: version => {
          if (settled) return
          settled = true
          clearTimeout(timeout)
          signal?.removeEventListener('abort', onAbort)
          resolve(Object.freeze({ version }))
        },
      }
      const timeout = setTimeout(() => {
        if (settled) return
        settled = true
        this.changeWaiters.delete(waiter)
        resolve(Object.freeze({ version: this.changeVersion }))
      }, 25_000)
      const onAbort = (): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        this.changeWaiters.delete(waiter)
        reject(new Error('changes wait was aborted'))
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      if (signal?.aborted === true) { onAbort(); return }
      this.changeWaiters.add(waiter)
    })
  }

  /** Return durable Team status without issuing a model request or a storage write. */
  status(): AgentTeamStatus {
    return this.requireLedger().status()
  }

  @Remote('createChannel')
  async createChannel(request: AgentTeamCreateChannelRequest): Promise<AgentTeamCreateChannelResult> {
    this.requireAccepting()
    this.requireWorkspace(request.workspaceId)
    const ledger = this.requireLedger()
    if (!ledger.hasCommitted(request.requestId)) this.assertChannelMembersAvailable(request.memberIds)
    const result = await ledger.createChannel({ ...request, actor: agentTeamHumanActor() })
    if (result.committed) this.emitCommitted(result.value.receipt)
    return result.value
  }

  /** Human rename of one Channel's display facts; identity refs are immutable. */
  @Remote('updateChannel')
  async updateChannel(request: AgentTeamUpdateChannelRequest): Promise<AgentTeamUpdateChannelResult> {
    this.requireAccepting()
    this.requireWorkspace(request.workspaceId)
    const result = await this.requireLedger().updateChannel({ ...request, actor: agentTeamHumanActor() })
    if (result.committed) this.emitCommitted(result.value.receipt)
    return result.value
  }

  /**
   * Archive one Channel: hidden from every surface with all facts kept. Pure
   * ledger projection change — Member sessions stay live (they may work in
   * other Channels), every active Claim on the Channel's Threads releases,
   * and affected Members' Attention clears.
   */
  @Remote('archiveChannel')
  async archiveChannel(request: AgentTeamArchiveChannelRequest): Promise<AgentTeamArchiveChannelResult> {
    this.requireAccepting()
    this.requireWorkspace(request.workspaceId)
    const result = await this.requireLedger().archiveChannel({ ...request, actor: agentTeamHumanActor() })
    if (result.committed) this.emitCommitted(result.value.receipt)
    return result.value
  }

  /** Create a durable Member and atomically grant its declared initial Channels. */
  @Remote('addMember')
  async addMember(request: AgentTeamAddMemberRequest): Promise<AgentTeamMemberResult> {
    return this.enqueueLifecycle(async () => {
      const workspace = this.requireWorkspace(request.workspaceId)
      await this.assertModelRoute(request.model)
      const memberId = `member:${randomUUID()}` as AgentTeamMemberId
      const member: AgentTeamAgentMember = Object.freeze({
        memberId,
        sessionId: SessionId(`agent-team-${randomUUID()}`),
        workspaceId: request.workspaceId,
        handle: request.handle,
        description: request.description,
        presetId: request.presetId,
        ...(request.model === undefined ? {} : { model: Object.freeze({ ...request.model }) }),
        ...(request.capabilities === undefined ? {} : { capabilities: Object.freeze(deepCopyCapabilities(request.capabilities)) }),
        privateMemoryPath: dshHomePath('agent-team', 'members', memberMemoryDirectoryName(memberId)),
        state: 'enabled',
      })
      const result = await this.requireLedger().addMember({ ...request, actor: agentTeamHumanActor(), member })
      if (result.committed) this.emitCommitted(result.value.receipt)
      const stored = result.value.member
      if (!this.handles.has(stored.memberId)) await this.activateMember(stored, workspace.path)
      return Object.freeze({ receipt: result.value.receipt, status: this.memberStatus(stored) })
    })
  }

  /** Commit suspended intent, then wait for the owned AgentHandle to become quiescent. */
  async suspendMember(request: AgentTeamSetMemberStateRequest): Promise<AgentTeamMemberResult> {
    return this.enqueueLifecycle(async () => {
      const result = await this.requireLedger().suspendMember({ ...request, actor: agentTeamHumanActor() })
      if (result.committed) this.emitCommitted(result.value.receipt)
      await this.disposeMemberSession(request.memberId, result.value.member)
      return Object.freeze({ receipt: result.value.receipt, status: this.memberStatus(result.value.member) })
    })
  }

  /** Commit enabled intent and restore the exact persisted Session. */
  async resumeMember(request: AgentTeamSetMemberStateRequest): Promise<AgentTeamMemberResult> {
    return this.enqueueLifecycle(async () => {
      const result = await this.requireLedger().resumeMember({ ...request, actor: agentTeamHumanActor() })
      if (result.committed) this.emitCommitted(result.value.receipt)
      this.clearMemberNotificationState(result.value.member.memberId)
      // The suspended Session's log is durable once its retirement completes,
      // and agents.resume() waits for exactly that retirement before loading.
      // Consulting the persistence tree here instead would race the
      // fire-and-forget retirement on Windows, where the JSONL backend
      // publishes directories through transient staging entries that surface
      // as ENOENT mid-walk — so pass the known session rather than re-listing.
      await this.activateMember(result.value.member, undefined, new Set([result.value.member.sessionId]))
      return Object.freeze({ receipt: result.value.receipt, status: this.memberStatus(result.value.member) })
    })
  }

  /**
   * Operator nudge for a Member that stopped making progress: steer a
   * continuation prompt into its live session, rebuild it after an orphaned
   * preset composition, or re-run activation when no live session exists.
   * Runtime-only — no ledger operation, no suspend. Taking over manually also
   * cancels any pending automatic recovery episode.
   */
  @Remote('recoverMember')
  async recoverMember(request: AgentTeamRecoverMemberRequest): Promise<AgentTeamRecoverMemberResult> {
    this.requireAccepting()
    const member = this.requireLedger().getMember(request.memberId)
    if (member === undefined || member.workspaceId !== request.workspaceId) throw new Error(`unknown Member '${request.memberId}' in workspace '${request.workspaceId}'`)
    this.recovery.stopTracking(request.memberId)
    // An orphaned composition cannot be steered: its tools are gone, so a
    // continuation prompt reaches an inert Member. Rebuild the Agent in place.
    const handle = this.handles.get(request.memberId)
    if (handle !== undefined && this.ctx.agentPresets.composedPreset(handle.agent.ctx) === undefined) {
      this.ctx.logger.info(`agent-team: rebuilding member '${member.handle}' after its preset composition was orphaned by a reload`)
      await this.reactivateMember(request.memberId)
      return Object.freeze({ status: this.memberStatus(member) })
    }
    // A failed activation also leaves nothing to steer; re-running it is the
    // only way back. A renewed failure stays non-throwing: the refreshed
    // status carries the activation diagnostic for the sidebar.
    if (handle === undefined) {
      if (member.state !== 'enabled') throw new Error(`Agent Member '${member.handle}' is ${member.state}; only enabled Members can be restarted`)
      this.ctx.logger.info(`agent-team: restarting member '${member.handle}' after a failed activation`)
      // A deterministic session refusal may be repairable in place: run the
      // same bounded startup remediation for this one Member before retrying
      // activation, so the restart heals instead of replaying the failure.
      const activation = this.memberFailures.get(request.memberId)?.activation
      if (activation !== undefined && activation.class === 'session-refused' && this.remediation !== undefined) {
        const outcome = await this.remediation.remediateMember(member)
        if (outcome.repaired > 0) {
          this.ctx.logger.info(`agent-team: repaired ${outcome.repaired} refused Session artifact(s) for member '${member.handle}'; retrying activation`)
        } else if (outcome.completed) {
          // The walk finished and nothing was provably this plugin's to fix:
          // a retry would fail identically. Mark the refusal non-remediable
          // so the surface stops offering restart and says why.
          this.markRefusalNonRemediable(request.memberId)
          return Object.freeze({ status: this.memberStatus(member) })
        }
      }
      await this.reactivateMember(request.memberId)
      return Object.freeze({ status: this.memberStatus(member) })
    }
    this.ctx.logger.info(`agent-team: operator asked member '${member.handle}' to resume`)
    this.steerResume(member, this.manualResumeText())
    return Object.freeze({ status: this.memberStatus(member) })
  }

  /**
   * Start one enabled Member from a new context: dispose the live handle,
   * archive the previous Session (its log stays on disk for history), and
   * activate a fresh Session under a new sessionId, so preset, tools, private
   * memory, and model selection all reload while the next turn carries no
   * history. The durable operation moves the Member's sessionId; identity,
   * memory path, and binding survive. A new id is what keeps the Web Client
   * seat live: a disposed generation's resident instance keeps its `removed`
   * bit forever, so renewing under the same id would leave a permanently
   * grayed session view.
   */
  @Remote('clearMemberContext')
  async clearMemberContext(request: AgentTeamClearMemberContextRequest): Promise<AgentTeamClearMemberContextResult> {
    return this.enqueueLifecycle(async () => {
      this.requireAccepting()
      this.requireWorkspace(request.workspaceId)
      const stored = this.requireLedger().getMember(request.memberId)
      if (stored === undefined || stored.workspaceId !== request.workspaceId) throw new Error(`unknown Member '${request.memberId}' in workspace '${request.workspaceId}'`)
      if (stored.state !== 'enabled') throw new Error(`Agent Member '${stored.handle}' is ${stored.state}; only enabled Members can start from a new context`)
      const active = this.handles.get(request.memberId)
      if (active === undefined) throw new Error(`Agent Member '${stored.handle}' has no active session to clear`)
      if (this.runningAgents.has(active.agent.id)) throw new Error(`Agent Member '${stored.handle}' is still running; wait for the current turn to end before starting from a new context`)
      const previousSessionId = stored.sessionId
      // The fresh id derives from the requestId, so a retried identical
      // request mints the same id and the ledger dedupes it instead of
      // colliding; the format matches addMember's `agent-team-<uuid>`.
      const sessionId = SessionId(`agent-team-${request.requestId}`)
      const result = await this.requireLedger().renewMemberSession({ ...request, sessionId, actor: agentTeamHumanActor() })
      if (result.committed) this.emitCommitted(result.value.receipt)
      else {
        // A retried identical request already renewed this Member; report the
        // recorded outcome without another dispose/reactivate cycle.
        return Object.freeze({ receipt: result.value.receipt, status: this.memberStatus(result.value.member) })
      }
      const renewed = result.value.member
      await this.retireMemberGeneration(request.memberId, active, previousSessionId)
      await this.activateMember(renewed, undefined, undefined, previousSessionId)
      const reactivated = this.handles.get(request.memberId)
      if (reactivated === undefined) {
        // Reactivation failed; the activation diagnostic carries the reason and
        // the durable renewal stays honest about the attempt.
        throw new Error(`Agent Member '${stored.handle}' failed to start a new context: ${this.memberFailures.get(request.memberId)?.activation ?? 'unknown error'}`)
      }
      return Object.freeze({ receipt: result.value.receipt, status: this.memberStatus(renewed) })
    })
  }

  /**
   * Retire one Member's previous generation after its durable binding moved
   * onto a new Session id: drop the old handle's transient state, dispose the
   * Agent, and archive the old Session log (which stays on disk for history).
   * Shared by the Human clear path and the model-initiated rollover.
   */
  private async retireMemberGeneration(memberId: AgentTeamMemberId, active: AgentHandle, previousSessionId: SessionId): Promise<void> {
    // Drop the old handle's transient state: pending recovery episodes and
    // error markers belong to the disposed agent, not to the Member.
    this.recovery.stopTracking(memberId)
    // The fresh Session may re-earn one Claim suggestion per Thread; the
    // old Session's one-shot records must not leak into it.
    this.progressNudge.stopTracking(memberId)
    // The context admission gate stays armed through disposal: input racing
    // the retire window must still be captured for the new generation, and
    // the coordinator drops its own bookkeeping only after the swap settles.
    this.memberBySessionId.delete(previousSessionId)
    await active.dispose()
    this.handles.delete(memberId)
    this.modelSelections.delete(memberId)
    this.memberRuntime.forgetMember(memberId)
    this.clearMemberFailure(memberId, 'activation')
    this.clearMemberNotificationState(memberId)
    // The previous log survives on disk; archiving hides it from every
    // grouping surface so one Member keeps exactly one visible Session.
    await this.ctx.workspaceRegistry.archiveSession(previousSessionId)
  }

  /**
   * Execute one prepared context rollover at a true idle boundary: commit the
   * idempotent Member-actor operation, retire the previous generation, and
   * activate the fresh Session whose first model-facing context is the
   * Member's own handoff. Later non-Team input captured during the transition
   * is delivered after the handoff; the Team Inbox is rederived from the
   * ledger, never copied.
   */
  private async executeMemberTransition(memberId: AgentTeamMemberId, plan: TransitionPlan): Promise<void> {
    await this.enqueueLifecycle(async () => {
      this.requireAccepting()
      const stored = this.requireLedger().getMember(memberId)
      if (stored === undefined || stored.state !== 'enabled') throw new Error(`Agent Member '${memberId}' cannot roll over: not enabled`)
      if (stored.sessionId !== plan.previousSessionId) throw new Error(`Agent Member '${stored.handle}' is no longer bound to the rolled-over Session`)
      const active = this.handles.get(memberId)
      if (active === undefined) throw new Error(`Agent Member '${stored.handle}' has no active session to roll over`)
      // A racing turn the admission gate rejects still leaves the Agent
      // momentarily running; wait for its convergence instead of failing the
      // swap — the gate guarantees it spends no model request.
      if (this.runningAgents.has(active.agent.id)) await active.agent.whenIdle()
      if (this.runningAgents.has(active.agent.id)) throw new Error(`Agent Member '${stored.handle}' is still running; the rollover must wait for idle`)
      // Checkpoint return: resolve the seed before committing anything. A
      // violation found here fails the whole swap with the old generation
      // intact — never a guessed seed over a wrong prefix.
      const seed = plan.checkpointRef === undefined ? undefined : await this.resolveCheckpointSeed(memberId, active.agent, plan.checkpointRef as AgentTeamContextCheckpointRef)
      // Recheck the job guard at the lifecycle commit seam: a job may have
      // started or settled after the tool-time validation.
      const blockingJobs = this.ownedJobsBlockingRollover(active.agent)
      if (blockingJobs.length > 0) {
        throw new Error(`the context rollover is refused: this Member now owns jobs that would not survive the switch (${blockingJobs.join(', ')}); collect or stop them, then retry`)
      }
      const rolled = await this.rolloverSessionForAgent(active.agent, {
        requestId: plan.requestId,
        workspaceId: stored.workspaceId,
        memberId,
        previousSessionId: plan.previousSessionId,
        newSessionId: plan.newSessionId,
        handoffEventSeq: plan.handoffEventSeq as AgentTeamRolloverSessionRequest['handoffEventSeq'],
        trigger: plan.trigger,
        ...(seed === undefined ? {} : { checkpointRef: seed.checkpointRef, sourceSessionId: seed.sourceSessionId, sourceThroughSeq: seed.sourceThroughSeq }),
      })
      // The durable old-log projection is the carried-input truth: after the
      // old Agent retires, fold its final state and take every post-intent
      // non-Team candidate the old generation never answered. The process
      // capture only accelerates; it is unioned by message id, never allowed
      // to override the fold.
      const preRetireCapture = this.contextManagement.drainCapturedInput(memberId)
      await this.retireMemberGeneration(memberId, active, plan.previousSessionId)
      const finalState = foldContextProjection(active.agent.session.ownEvents(), active.agent.session.inheritedEventCount, active.agent.session.id)
      const foldedCarried = carriedInputOf(finalState)
      const carriedById = new Map(plan.carriedInput.map(message => [message.id, message]))
      for (const message of foldedCarried) carriedById.set(message.id, message)
      for (const message of preRetireCapture) if (!carriedById.has(message.id)) carriedById.set(message.id, message)
      for (const message of this.contextManagement.drainCapturedInput(memberId)) if (!carriedById.has(message.id)) carriedById.set(message.id, message)
      const carriedInput = [...carriedById.values()]
      // A fresh rollover seeds nothing and points the lineage parent at the
      // previous active Session; a checkpoint return seeds the resolved
      // prefix and parents at the seed source Session instead. Activation
      // defers the ordinary Inbox wake so the handoff is guaranteed to be the
      // new generation's first model-facing context.
      const seedEvents = seed === undefined ? undefined : seed.prefix
      await this.activateMember(rolled.member, undefined, undefined, seed === undefined ? plan.previousSessionId : seed.sourceSessionId, {
        deferNotify: true,
        // The prefix is contiguous from seq 0, so its length is exactly the
        // inherited cut the child folds past.
        ...(seedEvents === undefined ? {} : { seed: seedEvents, inheritedEventCount: SessionLogOffset(seedEvents.length) }),
      })
      const reactivated = this.handles.get(memberId)
      if (reactivated === undefined) {
        throw new Error(`Agent Member '${stored.handle}' failed to activate its next context: ${this.memberFailures.get(memberId)?.activation ?? 'unknown error'}`)
      }
      // The handoff is the first model-facing context of the new generation.
      // It rides the step-priority inbox lane (steer) so a later rederived
      // Inbox notice queues behind it instead of preempting it; carried input
      // follows as its own turn, and the Inbox is rederived from ledger facts.
      reactivated.agent.steer(this.contextManagement.handoffMessageFor(plan))
      for (const message of carriedInput) reactivated.agent.followup(message)
      const notifications = this.requireLedger().notificationFacts(memberId, { workspaceId: rolled.member.workspaceId })
      if (notifications.length > 0) this.notifyMember(reactivated.agent, carriedInput.length > 0)
    })
  }

  /** Ledger handle for log lines; falls back to the raw id when unknown. */
  private memberLabel(memberId: AgentTeamMemberId): string {
    return this.ledger?.getMember(memberId)?.handle ?? memberId
  }

  /**
   * Cache GC: uploads referenced by a Message survive 72h from upload so
   * Member agents keep a consumption window; orphans (never sent) go after
   * 24h. Runs once at startup and then daily — in-process only, because the
   * cache is transient by design and rebuilds nothing across restarts.
   */
  private startAttachmentGc(ledger: AgentTeamLedger): void {
    const sweep = async (): Promise<void> => {
      await sweepAttachmentCache(attachmentsRoot(), ledger.referencedAttachmentIds(), Date.now())
    }
    void sweep()
    this.attachmentGcTimer = setInterval(() => { void sweep() }, 24 * 60 * 60 * 1000)
    this.attachmentGcTimer.unref?.()
  }

  private automaticResumeText(): string {
    return 'Your previous turn ended early due to a temporary service error. Please continue the work you were doing before the error.'
  }

  private manualResumeText(): string {
    return 'The operator asked you to resume after the previous turn ended early. Please continue the work you were doing before the error.'
  }

  /**
   * Steer one continuation message into a Member's live session. Throws when
   * no handle exists so the coordinator stops tracking; appends the inbox
   * snapshot whenever there is anything new to read.
   */
  private steerResume(member: AgentTeamAgentMember, text: string): void {
    const handle = this.handles.get(member.memberId)
    if (handle === undefined) throw new Error(`member '${member.handle}' has no active session`)
    const notifications = this.requireLedger().notificationFacts(member.memberId, { workspaceId: member.workspaceId })
    const body = notifications.length === 0 ? text : `${text}\n\n${this.notificationText(notifications, member.memberId)}`
    const hint = createUserMessage({
      content: [{ type: 'text', text: body }],
      source: { kind: 'plugin', plugin: AGENT_TEAM_PLUGIN_ID, form: 'notice', summary: RECOVERY_NOTICE_SUMMARY },
    })
    for (const pending of [...handle.agent.inbox.nextStep, ...handle.agent.inbox.nextTurn]) {
      if (this.isInboxNotice(pending)) handle.agent.inbox.remove(pending.id)
    }
    // Recovery carries the concrete interrupted work; a queued progress nudge
    // is stale next to it and must not survive as a second reminder.
    this.progressNudge.revokePendingNotice(member.memberId)
    handle.agent.steer(hint)
  }

  /** Automatic-recovery wakeup; throwing tells the coordinator the target is gone. */
  private injectRecovery(memberId: AgentTeamMemberId): void {
    const handle = this.handles.get(memberId)
    const agent = handle?.agent
    const member = agent !== undefined ? this.memberForAgent(agent) : undefined
    if (agent === undefined || member === undefined || member.state !== 'enabled') throw new Error(`member '${memberId}' cannot be recovered automatically`)
    this.steerResume(member, this.automaticResumeText())
  }

  /**
   * Human edit of one Member's mutable facts. A live model selection is
   * updated in place: disposing an Agent emits session/disposed, which makes
   * the Web Client permanently mark the same Session id unavailable even when
   * Team immediately recreates it.
   */
  @Remote('updateMember')
  async updateMember(request: AgentTeamUpdateMemberRequest): Promise<AgentTeamMemberResult> {
    return this.enqueueLifecycle(async () => {
      await this.assertModelRoute(request.model)
      const previous = this.requireLedger().getMember(request.memberId)
      const result = await this.requireLedger().updateMember({ ...request, actor: agentTeamHumanActor() })
      if (result.committed) this.emitCommitted(result.value.receipt)
      const stored = result.value.member
      const active = this.handles.get(request.memberId)
      if (active !== undefined && !isDeepStrictEqual(previous?.model ?? undefined, stored.model ?? undefined)) {
        const selection = this.modelSelections.get(request.memberId)
        if (selection === undefined) throw new Error(`Agent Member '${stored.handle}' has no live model selection`)
        selection.current = stored.model ?? this.ctx.agentDefaultModel.currentSelection()
      }
      if (active !== undefined && !isDeepStrictEqual(previous?.capabilities ?? undefined, stored.capabilities ?? undefined)) {
        await this.applyCapabilityEdit(active, stored)
      }
      return Object.freeze({ receipt: result.value.receipt, status: this.memberStatus(stored) })
    })
  }

  /**
   * Live-apply a capability edit at a turn boundary: while the Agent runs, the
   * current turn keeps its schemas and catalog; the swap happens once idle,
   * so the next step recomputes schemas from the new restriction and the
   * durable replacement skill catalog from the new selection, with the same
   * Session and history surviving. Suspend/remove during the wait cancels
   * the swap — the disposed handle released the old restriction already and
   * no disposer leaks.
   */
  private async applyCapabilityEdit(active: AgentHandle, stored: AgentTeamAgentMember): Promise<void> {
    const memberId = stored.memberId
    const waited = await this.memberRuntime.awaitTurnBoundary(active)
    if (waited && this.handles.get(memberId) !== active) {
      // The wait resolved because the old generation was disposed, not
      // because the turn ended; the ledger intent applies at the next
      // activation instead.
      return
    }
    this.memberRuntime.reapplyMemberToolPolicy(stored)
    this.memberRuntime.swapSkillSelection(memberId, stored.capabilities?.skills?.allow)
  }

  /** Irreversibly remove one Member, archive its Session, and delete its private namespace. */
  async removeMember(request: AgentTeamRemoveMemberRequest): Promise<AgentTeamRemoveMemberResult> {
    return this.enqueueLifecycle(async () => {
      const result = await this.requireLedger().removeMember({ ...request, actor: agentTeamHumanActor() })
      if (result.committed) this.emitCommitted(result.value.receipt)
      await this.disposeMemberSession(request.memberId, result.value.member)
      await this.memberRuntime.cleanupRemovedMember(result.value.member)
      return result.value
    })
  }

  /**
   * Archive one Member: commit the archival, stop its live session (disposal
   * only — private memory and the Session log stay on disk for a future
   * restore), and archive the Session from every grouping surface. Like
   * removal, all active Claims release and the Member's Attention clears.
   */
  @Remote('archiveMember')
  async archiveMember(request: AgentTeamArchiveMemberRequest): Promise<AgentTeamArchiveMemberResult> {
    return this.enqueueLifecycle(async () => {
      const result = await this.requireLedger().archiveMember({ ...request, actor: agentTeamHumanActor() })
      if (result.committed) this.emitCommitted(result.value.receipt)
      await this.disposeMemberSession(request.memberId, result.value.member)
      await this.ctx.workspaceRegistry.archiveSession(result.value.member.sessionId)
      return result.value
    })
  }

  /** Human-only Task resolution. Business fences are returned as typed outcomes. */
  @Remote('changeTask')
  async changeTask(request: AgentTeamTaskRequest): Promise<AgentTeamTaskResult> {
    this.requireAccepting()
    this.requireWorkspace(request.workspaceId)
    const result = await this.requireLedger().changeTask({ ...request, actor: agentTeamHumanActor() })
    this.emitCommittedOutcome(result)
    return result.value
  }

  /** Human-only promotion of a taskless Thread into a real Task plus public Message. */
  @Remote('promoteThread')
  async promoteThread(request: AgentTeamPromoteThreadRequest): Promise<AgentTeamPromoteThreadResult> {
    this.requireAccepting()
    this.requireWorkspace(request.workspaceId)
    const result = await this.requireLedger().promoteThread({ ...request, actor: agentTeamHumanActor() })
    this.emitCommittedOutcome(result)
    return result.value
  }

  /** Human-only Channel membership grant; it never injects historical Thread bodies. */
  @Remote('joinChannel')
  async joinChannel(request: AgentTeamJoinChannelRequest): Promise<AgentTeamJoinChannelResult> {
    const actor = this.humanCall(request.workspaceId)
    const ledger = this.requireLedger()
    if (!ledger.hasCommitted(request.requestId)) this.assertChannelMembersAvailable([request.memberId])
    const result = await ledger.joinChannel({ ...request, actor })
    if (result.committed) this.emitCommitted(result.value.receipt)
    return result.value
  }

  /** Human-only Channel membership removal and Channel-scoped cleanup. */
  @Remote('removeChannelMember')
  async removeChannelMember(request: AgentTeamRemoveChannelMemberRequest): Promise<AgentTeamRemoveChannelMemberResult> {
    const actor = this.humanCall(request.workspaceId)
    const result = await this.requireLedger().removeChannelMember({ ...request, actor })
    if (result.committed) this.emitCommitted(result.value.receipt)
    return result.value
  }

  /** Human top-level Thread start; asTask attaches an optional Task overlay. */
  @Remote('sendMessage')
  async sendMessage(request: AgentTeamSendMessageRequest): Promise<AgentTeamSendMessageResult> {
    return this.sendMessageAs(this.humanCall(request.workspaceId), request)
  }

  /**
   * Resolve uploaded ids and agent-supplied absolute paths into one attachment
   * metadata list. Paths are all validated before anything is copied, so one
   * rejection leaves the cache untouched and the message uncommitted.
   */
  private async resolveMessageAttachments(request: { readonly attachments?: readonly AgentTeamAttachmentId[] | undefined; readonly attachmentPaths?: readonly string[] | undefined }): Promise<readonly AgentTeamMessageAttachment[]> {
    const fromPaths: AgentTeamMessageAttachment[] = []
    if (request.attachmentPaths !== undefined && request.attachmentPaths.length > 0) {
      for (const absolutePath of request.attachmentPaths) await validatePathAttachment(absolutePath)
      for (const absolutePath of request.attachmentPaths) fromPaths.push(Object.freeze(await copyPathAttachment(attachmentsRoot(), absolutePath)))
    }
    return [...fromPaths, ...await this.prepareAttachments(request.attachments)]
  }

  /** Verify requested attachment ids against the cache. */
  private async prepareAttachments(requested?: readonly AgentTeamAttachmentId[]): Promise<readonly AgentTeamMessageAttachment[]> {
    if (requested === undefined || requested.length === 0) return []
    const metadata: AgentTeamMessageAttachment[] = []
    for (const attachmentId of requested) {
      const stored = await readAttachment(attachmentsRoot(), attachmentId)
      if (stored === undefined) throw new Error(`attachment '${attachmentId}' is not in the upload cache`)
      metadata.push(Object.freeze({ attachmentId, name: stored.name, byteSize: stored.byteSize, mediaType: stored.mediaType }))
    }
    return metadata
  }

  /**
   * Derive the stored body: one machine-facing `[attachment] <absolute path>`
   * line per attachment appended to the member-facing text.
   */
  private appendAttachmentLines(body: string, metadata: readonly AgentTeamMessageAttachment[]): string {
    const trimmed = body.trim()
    if (metadata.length === 0) return trimmed
    const lines = metadata.map(attachment => `[attachment] ${attachmentPayloadPath(attachment.attachmentId, attachment.name)}`)
    return `${trimmed}\n${lines.join('\n')}`
  }

  /** Upload one composer attachment into the cache; bytes are immutable once written. */
  @Remote('putAttachment')
  async putAttachment(request: AgentTeamPutAttachmentRequest): Promise<AgentTeamPutAttachmentResult> {
    this.requireAccepting()
    this.requireWorkspace(request.workspaceId)
    const bytes = Buffer.from(request.bytesBase64, 'base64')
    if (bytes.byteLength === 0) throw new Error('attachment must not be empty')
    if (bytes.byteLength > ATTACHMENT_MAX_BYTES) throw new Error(`attachment exceeds the ${ATTACHMENT_MAX_BYTES} byte limit`)
    const mediaType = sanitizeMediaType(request.mediaType)
    const attachmentId = newAttachmentId()
    return Object.freeze(await writeAttachment(attachmentsRoot(), attachmentId, request.name, mediaType, bytes))
  }

  /** Read one cached attachment back for client display; gone entries throw and the UI degrades to a chip. */
  @Remote('getAttachment')
  async getAttachment(request: AgentTeamGetAttachmentRequest): Promise<AgentTeamGetAttachmentResult> {
    const stored = await readAttachment(attachmentsRoot(), request.attachmentId)
    if (stored === undefined) throw new Error(`attachment '${request.attachmentId}' is no longer cached`)
    return Object.freeze({ name: stored.name, mediaType: stored.mediaType, byteSize: stored.byteSize, bytesBase64: stored.bytes.toString('base64') })
  }

  /** Human existing-Thread reply; unread and revision conflicts are business outcomes. */
  @Remote('reply')
  async reply(request: AgentTeamReplyRequest): Promise<AgentTeamReplyResult> {
    return this.replyAs(this.humanCall(request.workspaceId), request)
  }

  /** Human's personal Attention operation. */
  @Remote('changeAttention')
  async changeAttention(request: AgentTeamThreadAttentionRequest): Promise<AgentTeamThreadAttentionResult> {
    const actor = this.humanCall(request.workspaceId)
    const result = await this.requireLedger().changeAttention({ ...request, actor })
    if (result.committed) this.emitCommitted(result.value.receipt)
    return result.value
  }

  /** Host-only Human Inbox projection; the Web Client does not consume it. */
  @Remote('inbox')
  inbox(request: AgentTeamInboxRequest): AgentTeamInbox {
    this.requireWorkspace(request.workspaceId)
    return this.requireLedger().inbox(agentTeamHumanActor(), request)
  }

  /** Human's durable, atomically acknowledged Thread read. */
  @Remote('readThread')
  async readThread(request: AgentTeamThreadReadRequest): Promise<AgentTeamThreadReadResult> {
    const actor = this.humanCall(request.workspaceId)
    const result = await this.requireLedger().readThread({ ...request, actor })
    if (result.committed) this.emitCommitted(result.value.receipt)
    return result.value
  }

  /** Human-only durable Attention observations for one Thread. */
  @Remote('threadObservations')
  threadObservations(request: AgentTeamThreadObservationsRequest): AgentTeamThreadObservations {
    this.requireWorkspace(request.workspaceId)
    return this.requireLedger().threadObservations(agentTeamHumanActor(), request)
  }

  /** Human's non-mutating bounded Thread history. */
  @Remote('threadHistory')
  threadHistory(request: AgentTeamThreadHistoryRequest): AgentTeamThreadHistory {
    this.requireWorkspace(request.workspaceId)
    return this.requireLedger().threadHistory(agentTeamHumanActor(), request)
  }

  /** Return the existing bounded public Workspace discovery projection. */
  @Remote('view')
  view(request: AgentTeamViewRequest): AgentTeamView {
    this.requireWorkspace(request.workspaceId)
    return this.requireLedger().view(request)
  }

  /** Agent-only top-level Thread start. Workspace identity is verified against the live binding. */
  async sendMessageForAgent(agent: Agent, request: AgentTeamSendMessageRequest): Promise<AgentTeamSendMessageResult> {
    return this.sendMessageAs(this.memberCall(agent, request.workspaceId), request)
  }

  /** Agent-only existing-Thread reply. */
  async replyForAgent(agent: Agent, request: AgentTeamReplyRequest): Promise<AgentTeamReplyResult> {
    return this.replyAs(this.memberCall(agent, request.workspaceId), request)
  }

  /** Agent-only personal Attention change. */
  async changeAttentionForAgent(agent: Agent, request: AgentTeamThreadAttentionRequest): Promise<AgentTeamThreadAttentionResult> {
    const actor = this.memberCall(agent, request.workspaceId)
    const result = await this.requireLedger().changeAttention({ ...request, actor })
    if (result.committed) this.emitCommitted(result.value.receipt)
    return result.value
  }

  attentionStatusForAgent(agent: Agent, request: { workspaceId: AgentTeamViewRequest['workspaceId']; threadRef?: AgentTeamThreadAttentionRequest['threadRef'] | undefined; taskRef?: AgentTeamTask['taskRef'] | undefined }): AgentTeamThreadAttentionStatus {
    const actor = this.memberActor(agent)
    this.requireAgentWorkspace(actor, request.workspaceId)
    return this.requireLedger().attentionStatus(actor, request)
  }

  /** Agent-only Claim mutation. */
  async changeClaimForAgent(agent: Agent, request: AgentTeamClaimRequest): Promise<AgentTeamClaimResult> {
    const actor = this.memberCall(agent, request.workspaceId)
    const result = await this.requireLedger().changeClaim({ ...request, actor })
    this.emitCommittedOutcome(result)
    return result.value
  }

  listClaimsForAgent(agent: Agent, request: { workspaceId: AgentTeamViewRequest['workspaceId']; taskRef: AgentTeamTask['taskRef'] }): AgentTeamClaimList {
    const actor = this.memberActor(agent)
    this.requireAgentWorkspace(actor, request.workspaceId)
    return this.requireLedger().listClaims(actor, request)
  }

  inboxForAgent(agent: Agent, request: AgentTeamInboxRequest): AgentTeamInbox {
    const actor = this.memberActor(agent)
    this.requireAgentWorkspace(actor, request.workspaceId)
    return this.requireLedger().inbox(actor, request)
  }

  async readThreadForAgent(agent: Agent, request: AgentTeamThreadReadRequest): Promise<AgentTeamThreadReadResult> {
    const actor = this.memberCall(agent, request.workspaceId)
    const result = await this.requireLedger().readThread({ ...request, actor })
    if (result.committed) this.emitCommitted(result.value.receipt)
    const value = result.value
    // Private read-time enrich: an acceptance the reader just acknowledged is
    // a natural Task boundary, so the Host prices the reader's context once,
    // after the durable read has committed. Never a ledger fact, never
    // persisted, and a measurement failure degrades to an explicit
    // `unavailable` — the committed read is never reversed.
    const advice = await this.acceptanceContextAdvice(agent, value)
    return advice === undefined ? value : Object.freeze({ ...value, contextAdvice: advice })
  }

  /**
   * Context advice for one acceptance acknowledged by this read: only when
   * the read carried an unread accept activity AND the Task is still done.
   * Repeat reads (nothing unread), history-style reads, and reopened Tasks
   * carry no advice — the acceptance no longer stands.
   */
  private async acceptanceContextAdvice(agent: Agent, read: AgentTeamThreadReadResult): Promise<AgentTeamContextAdvice | undefined> {
    if (read.task === undefined || read.task.resolution !== 'accepted' || read.task.status !== 'done') return undefined
    const acknowledgedAccept = read.facts.some(entry => entry.unread && entry.fact.kind === 'activity'
      && entry.fact.activity.kind === 'accept')
    if (!acknowledgedAccept) return undefined
    return this.contextAdviceFor(agent)
  }

  /** Price the reading Member's context against its current route's budgets. */
  private async contextAdviceFor(agent: Agent): Promise<AgentTeamContextAdvice> {
    try {
      const limits = await this.routeLimitsForAgent(agent)
      if (limits === undefined) return this.unavailableAdvice()
      const taskBoundaryThreshold = Math.min(ACCEPT_TASK_BOUNDARY_THRESHOLD, limits.handoffAt)
      if (limits.usageTokens >= limits.handoffAt) {
        return Object.freeze({ usageTokens: limits.usageTokens, taskBoundaryThreshold, handoffAt: limits.handoffAt, hardLimit: limits.hardLimit,
          action: 'handoff-now',
          guidance: 'You are at or above the handoff budget. Finish the current atomic action and unsettled evidence, then call context_rollover with a fresh handoff now.' })
      }
      if (limits.usageTokens >= taskBoundaryThreshold) {
        return Object.freeze({ usageTokens: limits.usageTokens, taskBoundaryThreshold, handoffAt: limits.handoffAt, hardLimit: limits.hardLimit,
          action: 'rollover',
          guidance: 'Finish the acceptance closeout, persist only durable reusable conclusions, collect or stop jobs, then call context_rollover with a fresh handoff covering every other active Claim. Do not return to an old checkpoint solely because this Task was accepted.' })
      }
      return Object.freeze({ usageTokens: limits.usageTokens, taskBoundaryThreshold, handoffAt: limits.handoffAt, hardLimit: limits.hardLimit,
        action: 'keep',
        guidance: 'Keep the current context for possible acceptance follow-up. This acceptance is already a timeline boundary; do not create a redundant checkpoint. Record a checkpoint only before the next noisy or risky phase.' })
    } catch {
      // Any measurement failure degrades explicitly; the read stays durable.
      return this.unavailableAdvice()
    }
  }

  private unavailableAdvice(): AgentTeamContextAdvice {
    return Object.freeze({ usageTokens: undefined, taskBoundaryThreshold: undefined, handoffAt: undefined, hardLimit: undefined,
      action: 'unavailable',
      guidance: 'Context usage could not be measured for this acceptance; manage context by your existing pressure policy.' })
  }

  /**
   * Agent-only direct message: append the audit-only dm-sent operation, then
   * inject the body into the recipient's live session. The ledger commit is
   * the durable fact; the injection is a transient runtime effect, so a
   * missing handle or a failed wake returns a structured delivery error while
   * the recorded DM stays durable for the recipient's recovery path.
   */
  async dmForAgent(agent: Agent, request: AgentTeamDmRequest): Promise<AgentTeamDmResult> {
    const actor = this.memberCall(agent, request.workspaceId)
    const result = await this.requireLedger().sendDm({ ...request, actor })
    if (!result.committed) return result.value
    this.emitCommitted(result.value.receipt)
    const recipient = result.value.recipient
    const handle = this.handles.get(recipient.memberId)
    if (handle === undefined) {
      throw new AgentTeamDmDeliveryError(recipient.memberId, recipient.handle, `DM recorded but not delivered: Agent Member '${recipient.handle}' has no live session; it will find the message in its DM history after recovery`)
    }
    try {
      const message = createUserMessage({
        content: [{ type: 'text', text: this.dmRelayText(agent, recipient, request.body.trim(), result.value.receipt.occurredAt, result.value.receipt.operationId) }],
        source: { kind: 'plugin', plugin: AGENT_TEAM_PLUGIN_ID, form: 'relay' },
      })
      // An idle recipient gets one ordinary turn; a busy one is steered into
      // its current turn — the same wake split subagent continuations use.
      if (handle.agent.status === 'idle') handle.agent.followup(message)
      else handle.agent.steer(message)
    } catch (error) {
      throw new AgentTeamDmDeliveryError(recipient.memberId, recipient.handle, `DM recorded but not delivered: ${error instanceof Error ? error.message : String(error)}`)
    }
    return result.value
  }

  /** Relay body: the DM itself plus one bounded line of adjacent context. */
  private dmRelayText(senderAgent: Agent, recipient: AgentTeamAgentMember, body: string, occurredAt: string, excluding: AgentTeamOperationId): string {
    const sender = this.memberForAgent(senderAgent)
    const prior = this.requireLedger().dmHistoryBetween(senderAgent.id, recipient.memberId, excluding)
    const header = `Direct message from @${sender?.handle ?? 'a Team Member'} at ${formatTeamTimestamp(occurredAt)}:`
    const context = prior === undefined ? '' : `\n\n[most recent prior DM between you: ${prior}]`
    return `${header}\n\n${body}${context}`
  }

  threadHistoryForAgent(agent: Agent, request: AgentTeamThreadHistoryRequest): AgentTeamThreadHistory {
    const actor = this.memberActor(agent)
    this.requireAgentWorkspace(actor, request.workspaceId)
    return this.requireLedger().threadHistory(actor, request)
  }

  /** Agent-only bounded discovery projection. */
  viewForAgent(agent: Agent, request: AgentTeamViewRequest): AgentTeamView {
    const member = this.memberForAgent(agent)
    if (member === undefined) throw new Error('Agent is not an active Team Member')
    if (member.workspaceId !== request.workspaceId) throw new Error('Member cannot view another Workspace')
    return this.requireLedger().view(request, member.memberId)
  }

  /** Validate the durable ledger against an independently replayed projection. */
  validateLedger(): void {
    this.requireLedger().validate()
  }

  /**
   * Effective context-pressure budget for one Member's current route:
   * `hardLimit = min(256K, routeWindow - outputReserve)` and
   * `handoffAt = min(200K, hardLimit - handoffReserve)`.
   */
  private contextLimits(routeWindow: number): { readonly hardLimit: number; readonly handoffAt: number } {
    const hardLimit = Math.min(CONTEXT_HARD_LIMIT_CAP, Math.max(0, routeWindow - CONTEXT_SAFE_OUTPUT_RESERVE))
    const handoffAt = Math.min(CONTEXT_HANDOFF_AT_CAP, Math.max(0, hardLimit - CONTEXT_HANDOFF_RESERVE))
    return { hardLimit, handoffAt }
  }

  /**
   * Budget + measurement for one Member's CURRENT routed selection — the
   * member-pinned model or the default selection, resolved through the LLM
   * service so a route change is honored at the next pre-step. The last
   * persisted `request/context` event wins when it matches the current
   * selection (no directory round-trip for an unchanged route). A selection
   * whose capacity cannot be resolved returns `undefined` and the pressure
   * policy fails closed instead of assuming an unbounded route.
   */
  private async routeLimitsForAgent(agent: Agent): Promise<{ readonly usageTokens: number; readonly hardLimit: number; readonly handoffAt: number } | undefined> {
    const member = this.memberForAgent(agent)
    if (member === undefined) return undefined
    // The pressure budget must match the route the CURRENT step actually
    // uses: the live selection ref's `assembled` capture when the step has
    // entered prompt assembly, its `current` selection otherwise. Re-deriving
    // from the ledger or the Host default would race a concurrent default
    // change or live model edit and split the budget from the real route.
    const ref = this.modelSelections.get(member.memberId)
    const selection = ref?.assembled ?? ref?.current ?? member.model ?? this.ctx.agentDefaultModel.currentSelection()
    const meter = agent.ctx.get('tokenMeter')
    const usageTokens = meter?.measure(agent.session)?.totalTokens
    if (usageTokens === undefined) return undefined
    const persisted = agent.session.requestContext()
    let contextWindow: number | undefined
    if (persisted?.provider === selection.provider && persisted.model === selection.model) {
      contextWindow = persisted.contextWindow
    }
    if (contextWindow === undefined) {
      contextWindow = await this.resolvedContextWindow(selection)
    }
    if (contextWindow === undefined) return undefined
    const { hardLimit, handoffAt } = this.contextLimits(contextWindow)
    return { usageTokens, hardLimit, handoffAt }
  }

  /** Cache of resolved context windows per provider/model; unknown stays unknown. */
  private readonly routeWindows = new Map<string, number | undefined>()

  /**
   * Resolve one selection's provider-owned context capacity, cached per
   * route. The LLM service is resolved lazily (not a hard inject): the Host
   * mounts it in every production shape, while ledger-level fixtures provide
   * only the services the Team service itself owns. A missing or throwing
   * resolution is an unknown route — the pressure policy fails closed on it.
   */
  private async resolvedContextWindow(selection: { readonly provider: string; readonly model: string }): Promise<number | undefined> {
    const key = `${selection.provider}::${selection.model}`
    if (this.routeWindows.has(key)) return this.routeWindows.get(key)
    let contextWindow: number | undefined
    try {
      const llm = this.ctx.get('llm')
      const info = llm === undefined ? undefined : await llm.resolveModelInfo(selection.provider, selection.model)
      contextWindow = info?.context?.contextWindow
    } catch {
      contextWindow = undefined
    }
    this.routeWindows.set(key, contextWindow)
    return contextWindow
  }

  /**
   * Resolve one checkpoint ref to its exact seed prefix before any rollover
   * commit. The walk covers the current generation (own events) and archived
   * ancestors through `sessionPersistence`; the same projection definition
   * folds every source. Guards fail closed: unresolved, foreign-lineage,
   * open-turn, or nonshrinking targets reject without any lifecycle effect.
   */
  private async resolveCheckpointSeed(memberId: AgentTeamMemberId, agent: Agent, checkpointRef: AgentTeamContextCheckpointRef): Promise<CheckpointSeed> {
    let sessionId: SessionId | undefined = agent.session.id
    let live = true
    let guard = 0
    while (sessionId !== undefined && guard++ < MAX_TIMELINE_ANCESTORS) {
      let events: readonly SessionEvent[]
      let inheritedEventCount: SessionLogOffset
      let parentSession: SessionId | undefined
      // Capture this iteration's source identity BEFORE the branch advances
      // the lineage flag: the measurement call below keys on it.
      const sourceIsCurrent = live
      if (live) {
        events = agent.session.snapshotEvents()
        inheritedEventCount = agent.session.inheritedEventCount
        parentSession = agent.session.header.parentSession
        live = false
      } else {
        const read = await this.sessionReader.read(sessionId)
        if (!read.ok) {
          throw new StoredSessionReadError(`checkpoint '${checkpointRef}' could not be resolved: its source Session is unreadable (${read.failure.kind}: ${read.failure.detail})`, read.failure)
        }
        events = read.inspection.events
        inheritedEventCount = read.inspection.inheritedEventCount
        parentSession = read.inspection.header.parentSession
      }
      // Fold the source with its inherited cut respected: inherited events
      // are resolved history in that source, never fresh intent; checkpoints
      // recorded in this source's own span are the selectable targets.
      const state = foldContextProjection(events, inheritedEventCount, sessionId)
      // A Team-boundary default checkpoint: the boundary's completed-turn
      // anchor is the seed cut, and it is selectable exactly when one
      // Thread's facts entered the context through it — the same proof the
      // timeline requires, revalidated here because the model may cite a
      // boundary the timeline never surfaced.
      const boundary = checkpointRef.startsWith('team-boundary-')
        ? state.boundaries.find(entry => entry.key === checkpointRef)
        : undefined
      const entry = checkpointByRef(state, checkpointRef)
      const anchorTurnEndSeq = boundary !== undefined ? boundary.turnEndSeq : entry?.turnEndSeq
      if (anchorTurnEndSeq !== undefined && anchorTurnEndSeq !== -1) {
        if (boundary !== undefined && boundary.source !== 'team-boundary') {
          throw new Error(`checkpoint '${checkpointRef}' is not a restorable boundary`)
        }
        // The seed is the exact contiguous prefix through the anchor's
        // completed turn end. Balanced by construction — the turn ended.
        const throughSeq = anchorTurnEndSeq + 1
        const prefix = events.slice(0, throughSeq)
        if (boundary !== undefined) {
          const threads = this.threadsEnteringContext(events, anchorTurnEndSeq)
          if (threads.length !== 1) {
            throw new Error(threads.length === 0
              ? `boundary '${checkpointRef}' has no single attributable Thread; write a fresh handoff instead`
              : `boundary '${checkpointRef}' spans multiple Threads; write a fresh handoff instead`)
          }
        }
        // Nonshrinking guard, priced by the SAME source-replayed measurement
        // the timeline shows: the seed's retained cost is the SOURCE's own
        // token count scaled by the anchor share — a small current generation
        // never disguises a large ancestor seed. An unmeasurable source fails
        // closed: pricing the unknown as zero would wave an oversized seed
        // through.
        const limits = await this.routeLimitsForAgent(agent)
        const handoffAt = limits?.handoffAt ?? CONTEXT_HANDOFF_AT_CAP
        const sourceUsage = await this.sourceUsageTokens(sessionId, sourceIsCurrent, agent)
        if (sourceUsage === undefined) {
          throw new Error(`checkpoint '${checkpointRef}' could not be priced: its source Session's context cost cannot be measured; write a fresh handoff instead`)
        }
        const retained = this.retainedEstimate(sourceUsage, events.length, anchorTurnEndSeq)
        if (prefix.length >= events.length) {
          throw new Error('checkpoint return does not shrink the working set; use a fresh handoff instead')
        }
        if (retained >= handoffAt) {
          throw new Error('checkpoint return would retain a context at or above the handoff budget; use a fresh handoff instead')
        }
        // Single-Thread coverage guard: with more than one active Claim the
        // Host cannot prove a rewind stays inside one Thread's context.
        if (this.requireLedger().activeClaimCountForMember(memberId) > 1) {
          throw new Error('multiple active Claims: write a fresh handoff covering all of them instead of returning to a checkpoint')
        }
        return { checkpointRef, sourceSessionId: sessionId, sourceThroughSeq: SessionLogOffset(throughSeq), prefix }
      }
      sessionId = parentSession
    }
    throw new Error(`checkpoint '${checkpointRef}' does not resolve in this Member's lineage`)
  }

  /**
   * Rebuild the handoff for a Member whose rollover committed but whose new
   * Session activated without the handoff delivery (a crash between the
   * ledger commit and the swap's delivery step). The previous Session —
   * recorded in the operation, mirrored by the lineage parent, and available
   * from the ledger even when the new Session's own header never carried it —
   * holds the durable intent; fold it cold and deliver the same handoff
   * envelope first. Idempotent: once any handoff exists in the new Session's
   * own log this never runs.
   */
  private async reconstructMissingHandoff(member: AgentTeamAgentMember, agent: Agent): Promise<void> {
    const previousSessionId = agent.session.header.parentSession
      ?? this.requireLedger().previousSessionForMember(member.memberId)
    if (previousSessionId === undefined) return
    const previousRead = await this.sessionReader.read(previousSessionId)
    if (!previousRead.ok) {
      // Best-effort recovery: the handoff intent stays lost with the
      // unreadable previous Session, but the Member still activates.
      const failure = previousRead.failure
      this.ctx.logger.warn(`agent-team: rollover handoff reconstruction could not read the previous Session '${previousSessionId}' (${failure.kind}): ${failure.detail}`)
      return
    }
    const inspection = previousRead.inspection
    const state = foldContextProjection(inspection.events, inspection.inheritedEventCount, previousSessionId)
    if (state.pending === null) return
    const pending = state.pending
    const message = createHandoffMessage({
      handoff: pending.handoff,
      previousSessionId,
      newSessionId: agent.session.id,
      trigger: 'model',
      handoffEventSeq: pending.resultSeq as never,
      ...(pending.checkpointRef === undefined ? {} : { checkpointRef: pending.checkpointRef }),
      ...(pending.relatedFiles.length === 0 ? {} : { relatedFiles: pending.relatedFiles }),
    })
    agent.steer(message)
    this.ctx.logger.info(`agent-team: reconstructed the rollover handoff for member '${this.memberLabel(member.memberId)}' from the previous Session '${previousSessionId}'`)
  }

  /**
   * Resolve the exact recorded seed prefix of one committed checkpoint
   * return for crash recovery: cold-read the recorded source Session, take
   * the contiguous prefix of the recorded exclusive length, and verify the
   * source's own fold still resolves the recorded anchor there — an explicit
   * checkpoint through `checkpointByRef`, or a default Team boundary whose
   * recorded ref appears among the source's own boundary keys.
   * Fail-closed by contract: an unreadable source or an unprovable anchor
   * REJECTS the activation — a committed checkpoint return may never
   * downgrade to a blank child.
   */
  private async recordedCheckpointPrefix(seed: { readonly sourceSessionId: SessionId; readonly sourceThroughSeq: SessionLogOffset; readonly checkpointRef: AgentTeamContextCheckpointRef }): Promise<{ readonly prefix: readonly SessionEvent[] }> {
    const seedRead = await this.sessionReader.read(seed.sourceSessionId)
    if (!seedRead.ok) {
      const failure = seedRead.failure
      throw new StoredSessionReadError(`the recorded checkpoint-return seed source Session '${seed.sourceSessionId}' is unreadable (${failure.kind}): ${failure.detail}`, failure)
    }
    const inspection = seedRead.inspection
    const through = Number(seed.sourceThroughSeq)
    if (!Number.isSafeInteger(through) || through < 0 || through > inspection.events.length) {
      throw new Error(`the recorded checkpoint-return seed cut ${through} is not a valid prefix of Session '${seed.sourceSessionId}'`)
    }
    const state = foldContextProjection(inspection.events, inspection.inheritedEventCount, seed.sourceSessionId)
    const anchorProven = checkpointByRef(state, seed.checkpointRef) !== undefined
      || state.boundaries.some(boundary => boundary.key === seed.checkpointRef)
    if (!anchorProven) {
      throw new Error(`the recorded checkpoint-return anchor '${seed.checkpointRef}' no longer resolves in Session '${seed.sourceSessionId}'`)
    }
    return { prefix: inspection.events.slice(0, through) }
  }

  /**
   * Redeliver the old generation's unconsumed post-intent input to a
   * generation whose durable rollover committed but whose delivery did not
   * finish. Bound to the ledger's recorded transition target — the CURRENT
   * Session being that target — never to whether the handoff itself landed,
   * so a crash after the handoff but before the carried enqueue still
   * replays. The fold is the same durable truth the live transition uses
   * (unconsumed, non-Team, order preserved). Idempotency keys on what is
   * CURRENTLY present: delivered `user/message` ids plus the live inbox's
   * pending next-step/next-turn ids — a historical insert that was already
   * claimed (and removed) but never surfaced is NOT known and must replay.
   * Fail-closed for genuinely unreadable previous Sessions (missing/IO) so
   * the Member's input is never dropped silently, with three bounded
   * exceptions: a generation that already started its own turns needs no
   * replay (its carried input was delivered or superseded while it ran), a
   * log-corruption class error skips with a warning (the Host repairs torn
   * tails; a retired generation's corrupt log must not permanently block the
   * Member's activation), and a deterministic released-format refusal skips
   * with a warning (the candidate's own migration audit refuses that
   * artifact, so no retry can ever read it).
   */
  private async replayCarriedInput(member: AgentTeamAgentMember, agent: Agent, generationStarted: boolean): Promise<number> {
    const transition = this.requireLedger().lastTransitionForMember(member.memberId)
    if (transition === undefined || transition.targetSessionId !== agent.session.id) return 0
    // A generation that already started its own turns needs no previous-Session
    // replay: its carried input was delivered with the handoff (or superseded)
    // before any own turn could run. Skipping the inspect also keeps a later
    // corruption or loss of the retired Session from re-blocking this Member
    // on every restart of the current generation.
    if (generationStarted) {
      this.ctx.logger.info(`agent-team: skipping carried-input replay for member '${this.memberLabel(member.memberId)}': the current Session '${agent.session.id}' already started a generation`)
      return 0
    }
    let inspectionEvents: readonly SessionEvent[]
    let inspectionInherited: SessionLogOffset
    const previousRead = await this.sessionReader.read(transition.previousSessionId)
    if (!previousRead.ok) {
      const failure = previousRead.failure
      // Log-corruption class: bounded fail-open. The current Session's own
      // fold is intact and the Host repairs the retired log's torn tail; a
      // corrupted retired generation must not permanently block activation.
      if (failure.kind === 'corrupt') {
        this.ctx.logger.warn(`agent-team: previous Session '${transition.previousSessionId}' holding carried input for member '${this.memberLabel(member.memberId)}' is corrupt: ${failure.detail}; skipping the replay`)
        return 0
      }
      // Deterministic released-format refusal: the retired artifact is refused
      // by the candidate's own migration audit, which no retry can change.
      // Failing activation here would turn a data problem in a Session the
      // Member no longer runs in into permanent unavailability — the exact
      // failure class this hardening removes. Genuine IO and unknown failures
      // stay fail-closed so carried input is never dropped silently.
      if (failure.kind === 'refused') {
        this.ctx.logger.warn(`agent-team: previous Session '${transition.previousSessionId}' holding carried input for member '${this.memberLabel(member.memberId)}' is refused by the session-format migration: ${failure.detail}; skipping the replay`)
        return 0
      }
      throw new StoredSessionReadError(`the previous Session '${transition.previousSessionId}' holding the Member's carried input is unreadable (${failure.kind}): ${failure.detail}`, failure)
    }
    inspectionEvents = previousRead.inspection.events
    inspectionInherited = previousRead.inspection.inheritedEventCount
    const state = foldContextProjection(inspectionEvents, inspectionInherited, transition.previousSessionId)
    const carried = carriedInputOf(state)
    if (carried.length === 0) return 0
    const known = new Set<string>()
    for (const event of agent.session.ownEvents()) {
      if (event.type !== 'user/message') continue
      const id = (event.data as { id?: string }).id
      if (id !== undefined) known.add(id)
    }
    for (const pending of [...agent.inbox.nextStep, ...agent.inbox.nextTurn]) {
      known.add(pending.id)
    }
    let redelivered = 0
    for (const message of carried) {
      if (known.has(message.id)) continue
      agent.followup(message)
      redelivered += 1
    }
    if (redelivered > 0) this.ctx.logger.info(`agent-team: redelivered ${redelivered} carried input message(s) for member '${this.memberLabel(member.memberId)}' after the rollover crash recovery`)
    return redelivered
  }

  /**
   * Agent-only checkpoint request validation: the tool calls this inside its
   * own running turn. Like `context_rollover`, the tool performs no side effect —
   * the durable checkpoint is the successful `tool/call`+`tool/result` pair
   * the Session projection folds; the ref returned here is deterministic
   * from this Member Session's identity plus the tool call id, so the model
   * can cite it before the result exists and a repeated provider call id in
   * another generation never collides with this one.
   */
  recordCheckpointForAgent(agent: Agent, request: AgentTeamCheckpointToolRequest): AgentTeamCheckpointToolOutcome {
    const member = this.memberForAgent(agent)
    if (member === undefined || member.state !== 'enabled') throw new Error('context_checkpoint requires an active Team Member')
    if (this.runningAgents.has(agent.id) !== true) throw new Error('context_checkpoint must run inside this Member\'s own running turn')
    const name = request.name.trim()
    if (name === '') throw new Error('context_checkpoint requires a non-empty name')
    if (name.length > MAX_CHECKPOINT_NAME_CHARS) throw new Error(`context_checkpoint name exceeds ${MAX_CHECKPOINT_NAME_CHARS} characters`)
    return { checkpointRef: checkpointRefFor(agent.session.id, request.callId), name }
  }

  /**
   * Agent-only bounded structural timeline: resolved checkpoints plus Team
   * delivery, handoff, and compaction boundaries across the current
   * generation and its archived ancestor lineage. Structural only — no
   * transcript content. The meter prices retained/discarded tokens; entries
   * the Host cannot prove restorable carry a rejection reason instead of
   * silently disappearing.
   */
  async contextTimelineForAgent(agent: Agent, request: AgentTeamTimelineToolRequest): Promise<AgentTeamTimelineToolResult> {
    const member = this.memberForAgent(agent)
    if (member === undefined || member.state !== 'enabled') throw new Error('context_timeline requires an active Team Member')
    const limit = request.limit === undefined ? DEFAULT_TIMELINE_LIMIT : Math.trunc(request.limit)
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_TIMELINE_LIMIT) throw new Error(`context_timeline limit must be between 1 and ${MAX_TIMELINE_LIMIT}`)
    const meter = agent.ctx.get('tokenMeter')
    const measurement = meter?.measure(agent.session)
    const usageTokens = measurement?.totalTokens ?? 0
    const limits = await this.routeLimitsForAgent(agent)
    const hardLimit = limits?.hardLimit ?? CONTEXT_HARD_LIMIT_CAP
    const handoffAt = limits?.handoffAt ?? CONTEXT_HANDOFF_AT_CAP
    // Fold the current generation, then walk archived ancestors through their
    // persisted logs; the same projection definition folds every source.
    const items: AgentTeamTimelineItem[] = []
    const seen = new Set<string>()
    let incompleteFrom: { readonly sessionId: SessionId; readonly reason: string } | undefined
    let sessionId: SessionId | undefined = member.sessionId
    let live = true
    let guard = 0
    while (sessionId !== undefined && guard++ < MAX_TIMELINE_ANCESTORS) {
      let state: AgentTeamContextProjectionState | undefined
      let sourceSessionId = sessionId
      let sourceEvents: readonly SessionEvent[] = []
      // Capture this iteration's source identity BEFORE the branch advances
      // the lineage flag: measurement and discard pricing both key on it.
      const sourceIsCurrent = live
      if (live) {
        state = foldContextProjection(agent.session.ownEvents(), agent.session.inheritedEventCount, agent.session.id)
        sourceEvents = agent.session.snapshotEvents()
        sessionId = agent.session.header.parentSession
        live = false
      } else {
        const read = await this.sessionReader.read(sessionId)
        if (!read.ok) {
          // An unreadable ancestor ends the lineage walk here — recorded in
          // the result, never silent, and never a Member-availability fact.
          incompleteFrom = { sessionId, reason: `${read.failure.kind}: ${read.failure.detail}` }
          sessionId = undefined
        } else {
          state = foldContextProjection(read.inspection.events, read.inspection.inheritedEventCount, sessionId)
          sourceEvents = read.inspection.events
          sourceSessionId = sessionId
          sessionId = read.inspection.header.parentSession
        }
      }
      if (state === undefined) break
      // Price every candidate of this source against the SOURCE's own
      // replayed measurement — a small current generation never shrinks a
      // large ancestor's real seed cost. An unmeasurable source (no meter,
      // unreadable ancestor) prices as UNKNOWN, never as zero: the timeline
      // marks its candidates unprovable and the return guard rejects them.
      const sourceUsage = await this.sourceUsageTokens(sourceSessionId, sourceIsCurrent, agent)
      for (const candidate of timelineCandidates(state, limit)) {
        if (seen.has(candidate.ref)) continue
        seen.add(candidate.ref)
        items.push(this.timelineItemFor(candidate, sourceUsage, usageTokens, hardLimit, handoffAt, sourceSessionId, sourceIsCurrent, sourceEvents))
        if (items.length >= limit) break
      }
      if (items.length >= limit) break
    }
    return { usageTokens, hardLimit, handoffAt, items, ...(incompleteFrom === undefined ? {} : { incompleteFrom }) }
  }

  /**
   * Replayed measurement of one lineage source: the live current Session
   * measures directly; an archived ancestor measures through a borrowed
   * prepared Session, so a seed's retained cost is priced in the SOURCE's
   * own tokens — never the current generation's. Returns undefined when no
   * meter is available or the source cannot be borrowed; callers fail
   * closed on the unknown.
   */
  private async sourceUsageTokens(sessionId: SessionId, live: boolean, agent: Agent): Promise<number | undefined> {
    const meter = agent.ctx.get('tokenMeter')
    if (meter === undefined) return undefined
    if (live) return meter.measure(agent.session)?.totalTokens
    // 0.1.5 removed borrowSession: rebuild a detached Session from the
    // stored log so the seed's retained cost is priced by the SOURCE's own
    // replay, never the current generation's. An unreadable source or a
    // failing meter is unmeasurable and prices as UNKNOWN.
    const read = await this.sessionReader.read(sessionId)
    if (!read.ok) return undefined
    try {
      const session = Session.create(sessionId, read.inspection.events, read.inspection.header, read.inspection.inheritedEventCount)
      return meter.measure(session)?.totalTokens
    } catch {
      return undefined
    }
  }

  /**
   * Monotonic anchor-share estimate of a seed's retained cost, priced in the
   * SOURCE Session's own measurement: the fraction of the source log the
   * seed prefix covers, scaled to the source's replayed token count. The
   * anchor position is exact and the share grows monotonically toward the
   * source's head (100%). A large ancestor's anchor therefore prices at the
   * ancestor's real size even inside a small current generation — the
   * timeline display and the return guard share this one estimate.
   */
  private retainedEstimate(sourceUsageTokens: number, sourceLength: number, anchorTurnEndSeq: number): number {
    if (sourceLength <= 0) return sourceUsageTokens
    const share = Math.min(1, Math.max(0, (anchorTurnEndSeq + 1) / sourceLength))
    return Math.round(sourceUsageTokens * share)
  }

  /**
   * Threads whose facts entered this Session's model context by the given
   * seq: delivered Team notices (their bodies quote `Thread: <ref>`
   * structurally) and successful Team-claim mutations (their task overlays
   * resolve to Threads through the ledger). Never from unread ledger
   * activity — a Thread the Member never saw did not enter its context.
   * Order-stable, deduplicated.
   */
  private threadsEnteringContext(events: readonly SessionEvent[], throughSeq: number): readonly AgentTeamThreadRef[] {
    const refs: AgentTeamThreadRef[] = []
    const openAttributions = new Map<string, { readonly name: string; readonly arguments: string }>()
    const push = (ref: AgentTeamThreadRef | undefined): void => {
      if (ref !== undefined && !refs.includes(ref)) refs.push(ref)
    }
    for (const event of events) {
      if (event.seq > throughSeq) break
      if (event.type === 'tool/call' && (event.data.name === 'team_claim' || event.data.name === 'team_message')) {
        openAttributions.set(event.data.callId, { name: event.data.name, arguments: event.data.arguments })
      } else if (event.type === 'tool/result') {
        const block = (event.data.message as { content?: Array<{ type?: string; toolCallId?: string; isError?: boolean }> }).content?.[0]
        if (block !== undefined && block.toolCallId !== undefined) {
          const recorded = openAttributions.get(block.toolCallId)
          if (recorded !== undefined && block.isError !== true) {
            openAttributions.delete(block.toolCallId)
            try {
              const args = JSON.parse(recorded.arguments) as { taskRef?: unknown; threadRef?: unknown }
              // A claim mutation resolves its Task overlay through the ledger;
              // a team_message committed reply names its Thread in its call
              // arguments; a committed start's Thread is born in the result
              // and is read from the durable presentation meta.
              if (recorded.name === 'team_claim' && typeof args.taskRef === 'string' && args.taskRef !== '') {
                push(this.requireLedger().threadForTask(args.taskRef as AgentTeamTaskRef))
              } else if (recorded.name === 'team_message') {
                const meta = (event.data as { meta?: unknown }).meta
                if (meta !== undefined && typeof meta === 'object' && (meta as { kind?: unknown }).kind === 'committed') {
                  const metaThreadRef = (meta as { threadRef?: unknown }).threadRef
                  if (typeof metaThreadRef === 'string' && metaThreadRef !== '') push(metaThreadRef as AgentTeamThreadRef)
                } else if (typeof args.threadRef === 'string' && args.threadRef !== '') {
                  push(args.threadRef as AgentTeamThreadRef)
                }
              }
            } catch {
              // Malformed call arguments contribute no attribution.
            }
          }
        }
      } else if (event.type === 'user/message') {
        const source = event.data.source as { kind?: string; plugin?: string; form?: string; summary?: string } | undefined
        if (source?.kind !== 'plugin') continue
        // Reminder notices never enter attribution — a progress nudge or a
        // recovery instruction is not a Team fact.
        if (source.form === 'notice' && source.summary !== undefined && isReminderNoticeSummary(source.summary)) continue
        const text = event.data.content.filter(block => block.type === 'text').map(block => block.text ?? '').join('\n')
        for (const match of text.matchAll(/Thread: (thread:[0-9a-f-]{6,})/g)) {
          push(match[1] as AgentTeamThreadRef)
        }
      }
    }
    return refs
  }

  /**
   * Price and annotate one timeline candidate without mutating anything.
   * Retained prices in the SOURCE Session's own replayed measurement (the
   * monotonic anchor-share of the source log); discarded is what a return
   * replaces — for a current-generation anchor, the measured usage beyond
   * the anchor; for an ancestor anchor, the current generation's whole
   * usage (an approximation: the ancestor's own suffix is not part of this
   * generation). A small current child therefore discards little but may
   * still retain a large ancestor seed, and both numbers say so honestly.
   */
  private timelineItemFor(candidate: TimelineCandidate, sourceUsage: number | undefined, currentUsage: number, _hardLimit: number, handoffAt: number, sourceSessionId: SessionId, sourceIsCurrent: boolean, sourceEvents: readonly SessionEvent[]): AgentTeamTimelineItem {
    const retainedTokens = candidate.source === 'head'
      ? currentUsage
      : this.retainedEstimate(sourceUsage ?? 0, sourceEvents.length, candidate.turnEndSeq)
    const discardedTokens = candidate.source === 'head'
      ? 0
      : sourceIsCurrent
        ? Math.max(0, currentUsage - retainedTokens)
        : currentUsage
    const affectedThreads = candidate.turnEndSeq === -1 ? [] : this.threadsEnteringContext(sourceEvents, candidate.turnEndSeq)
    let restorable = candidate.turnEndSeq !== -1
    let reason: string | undefined
    if (candidate.source === 'head') {
      // The head is the current working set: returning to it discards
      // nothing and is never a meaningful return target.
      restorable = false
      reason = 'the head is the current working set; returning to it discards nothing'
    } else if (sourceUsage === undefined) {
      // The source's cost cannot be measured (no meter, or the archived
      // ancestor cannot be borrowed): the budget cannot be proven, so the
      // candidate is not selectable. Never price an unknown as zero.
      restorable = false
      reason = 'the source Session\'s context cost cannot be measured, so the return budget cannot be proven'
    } else if (candidate.source === 'handoff' || candidate.source === 'compaction') {
      // A handoff starts a generation and a compaction rewrites the visible
      // surface: rewinding into them is not a proven-safe V1 target.
      restorable = false
      reason = `source '${candidate.source}' is not a restorable checkpoint`
    } else if (candidate.source === 'team-boundary') {
      // A Team delivery is a selectable default checkpoint exactly when the
      // Host can prove it stays inside one Thread's context: the boundary
      // resolved at a completed turn AND exactly one Thread's facts entered
      // the Session context through it. Multi-Thread or unattributable
      // boundaries document why they are not selectable.
      if (affectedThreads.length !== 1) {
        restorable = false
        reason = affectedThreads.length === 0
          ? 'no single Thread is attributable to this boundary'
          : 'multiple Threads entered the context through this boundary; write a fresh handoff instead'
      } else if (retainedTokens >= handoffAt) {
        restorable = false
        reason = 'retained context would not materially shrink the working set'
      }
    } else if (candidate.source === 'agent' && retainedTokens >= handoffAt) {
      restorable = false
      reason = 'retained context would be at or above the handoff budget'
    }
    return {
      checkpointRef: candidate.ref,
      name: candidate.label,
      source: candidate.source,
      retainedTokens,
      discardedTokens,
      affectedThreads,
      restorable,
      ...(reason === undefined ? {} : { reason }),
      ...(candidate.source === 'agent' ? {} : { sourceSessionId }),
    }
  }

  /**
   * Agent-only rollover request validation: the tool calls this to check its
   * Member binding, exclusivity, and checkpoint ownership. It performs no
   * lifecycle effect — the actual transition reacts to the successful tool
   * result through the context-management coordinator.
   */
  async requestNewContext(agent: Agent, request: AgentTeamNewContextToolRequest): Promise<AgentTeamNewContextToolOutcome> {
    const member = this.memberForAgent(agent)
    if (member === undefined || member.state !== 'enabled') throw new Error('context_rollover requires an active Team Member')
    if (this.contextManagement.isTransitioning(member.memberId)) throw new Error('a context rollover is already scheduled for this Member; wait for it to finish before requesting another')
    if (this.runningAgents.has(agent.id) !== true) {
      // The tool runs inside the Member's own turn, so a non-running agent at
      // this point is a harness anomaly; refuse rather than schedule a swap
      // outside the turn fence.
      throw new Error('context_rollover must run inside this Member\'s own running turn')
    }
    // Job ownership guard: disposing the old Agent cancels its running jobs
    // and orphaned terminal-but-unreported output would vanish with it. The
    // rejection names the jobs so the model can collect or stop them first;
    // the transition rechecks at the lifecycle commit seam because a job may
    // settle between this validation and the swap.
    const blocking = this.ownedJobsBlockingRollover(agent)
    if (blocking.length > 0) {
      throw new Error(`context_rollover is refused while this Member owns jobs that would not survive the switch (${blocking.join(', ')}); collect or stop them first, then retry`)
    }
    if (request.checkpointRef === undefined) return { mode: 'fresh' }
    if (!/^(context-checkpoint-[0-9a-f]{64}|team-boundary-[0-9a-f]{64})$/.test(request.checkpointRef)) throw new Error('checkpointRef must be an opaque ref exactly as returned by context_timeline')
    // Full current-state prevalidation through the ONE resolver the swap
    // itself uses: a ref that is fabricated, unattributable, nonshrinking,
    // unmeasurable, over-budget, or blocked by multiple active Claims
    // rejects HERE — a model-visible error result instead of a fake
    // `scheduled` whose async swap always fails. The seed is resolved and
    // discarded: the transition seam resolves it again, so only the mutable
    // guard set (jobs, route limits, lineage growth) is revalidated there.
    await this.resolveCheckpointSeed(member.memberId, agent, request.checkpointRef)
    return { mode: 'from-checkpoint' }
  }

  /**
   * Jobs this Agent owns that cannot survive a generation swap: any
   * running/stopping job, and any settled job whose terminal output was
   * never reported (disposal would silently discard it). In-place hard
   * compaction is exempt — it never cancels the owner.
   */
  private ownedJobsBlockingRollover(agent: Agent): readonly string[] {
    const jobs = agent.ctx.get('jobs')
    if (jobs === undefined) return []
    return jobs.list(agent)
      .filter((job: { status: string; reported: boolean }) => job.status === 'running' || job.status === 'stopping' || ((job.status === 'completed' || job.status === 'killed' || job.status === 'failed') && !job.reported))
      .map((job: { id: string; label: string }) => `${job.label} (${job.id})`)
  }

  /**
   * Agent-only session rollover commit: the Member actor must be the target
   * Member on its currently bound live Session. The Host performs the actual
   * generation swap around this write; the ledger records only the durable
   * binding transition and rollover audit envelope.
   */
  async rolloverSessionForAgent(agent: Agent, request: AgentTeamRolloverSessionRequest): Promise<AgentTeamDurableMemberResult> {
    const actor = this.memberCall(agent, request.workspaceId)
    const result = await this.requireLedger().rolloverMemberSession({ ...request, actor })
    if (result.committed) this.emitCommitted(result.value.receipt)
    return result.value
  }

  private emitCommittedOutcome<T extends { readonly kind: string; readonly receipt?: AgentTeamOperationReceipt }>(
    result: { readonly committed: boolean; readonly value: T },
  ): void {
    if (result.committed && result.value.kind === 'committed' && result.value.receipt !== undefined) this.emitCommitted(result.value.receipt)
  }

  private assertChannelMembersAvailable(memberIds: readonly AgentTeamMemberId[] | undefined): void {
    for (const memberId of memberIds ?? []) {
      const member = this.requireLedger().getMember(memberId)
      if (member === undefined) throw new Error(`unknown Agent Member '${memberId}'`)
      if (this.memberStatus(member).availability !== 'active') throw new Error(`Agent Member '${memberId}' is not available for Channel membership`)
    }
  }

  /** Shared Task-creation commit: resolve uploads into metadata lines and append through the ledger. */
  private async sendMessageAs(actor: AgentTeamHumanActor | AgentTeamMemberActor, request: AgentTeamSendMessageRequest): Promise<AgentTeamSendMessageResult> {
    const metadata = await this.resolveMessageAttachments(request)
    const result = await this.requireLedger().sendMessage({
      ...request, body: this.appendAttachmentLines(request.body, metadata),
      ...(metadata.length === 0 ? {} : { resolvedAttachments: metadata }),
      actor,
    })
    this.emitCommittedOutcome(result)
    return result.value
  }

  /** Shared existing-Thread reply commit: same upload resolution and outcome emission. */
  private async replyAs(actor: AgentTeamHumanActor | AgentTeamMemberActor, request: AgentTeamReplyRequest): Promise<AgentTeamReplyResult> {
    const metadata = await this.resolveMessageAttachments(request)
    const result = await this.requireLedger().reply({
      ...request, body: this.appendAttachmentLines(request.body, metadata),
      ...(metadata.length === 0 ? {} : { resolvedAttachments: metadata }),
      actor,
    })
    this.emitCommittedOutcome(result)
    return result.value
  }

  /** Fence one Human Remote call: accepting Host, known Workspace, Human actor. */
  private humanCall(workspaceId: AgentTeamViewRequest['workspaceId']): AgentTeamHumanActor {
    this.requireAccepting()
    this.requireWorkspace(workspaceId)
    return agentTeamHumanActor()
  }

  /** Fence one Member call: accepting Host, live Member binding, matching Workspace. */
  private memberCall(agent: Agent, workspaceId: AgentTeamViewRequest['workspaceId']): AgentTeamMemberActor {
    this.requireAccepting()
    const actor = this.memberActor(agent)
    this.requireAgentWorkspace(actor, workspaceId)
    return actor
  }

  private memberActor(agent: Agent): AgentTeamMemberActor {
    const member = this.memberForAgent(agent)
    if (member === undefined) throw new Error('Agent is not an active Team Member')
    return Object.freeze({ kind: 'member', memberId: member.memberId, handle: member.handle })
  }

  private requireAgentWorkspace(actor: AgentTeamMemberActor, workspaceId: AgentTeamViewRequest['workspaceId']): void {
    if (this.requireLedger().getMember(actor.memberId)?.workspaceId !== workspaceId) throw new Error('Member cannot mutate another Workspace')
  }

  /**
   * Validate a pinned model route's reasoning effort against the adapter's own
   * metadata when the LLM service is reachable; unknown routes defer to the
   * LLM layer's runtime check at call time.
   */
  private async assertModelRoute(model: AgentTeamModelSelection | undefined): Promise<void> {
    if (model === undefined || model.reasoningEffort === undefined) return
    try {
      const resolved = await this.ctx.llm.resolveModelInfo(model.provider, model.model)
      const efforts = resolved.reasoning?.efforts ?? []
      if (efforts.length > 0 && !efforts.some(effort => effort.id === model.reasoningEffort)) {
        throw new Error(`reasoning effort '${model.reasoningEffort}' is not supported by ${model.provider}/${model.model}`)
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('is not supported by')) throw error
    }
  }

  /**
   * Session headers currently durable in the persistence backend.
   *
   * The Host retires a disposed Session's log without awaiting it, so a
   * concurrent activation can observe the JSONL backend's transient win32
   * staging directories (.dsh-mkdir-*) as ENOENT while they rename into
   * place. The read is idempotent; back off briefly instead of failing the
   * activation on a race the publisher resolves within milliseconds.
   */
  private async persistedSessionHeaders() {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.ctx.sessionPersistence.list()
      } catch (error) {
        if (attempt >= 3 || (error as NodeJS.ErrnoException | null)?.code !== 'ENOENT') throw error
        await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 25))
      }
    }
  }

  private async activateMember(member: AgentTeamAgentMember, knownWorkspacePath?: string, knownSessions?: ReadonlySet<SessionId>, forkedFrom?: SessionId, options?: { readonly deferNotify?: boolean; readonly seed?: readonly SessionEvent[]; readonly inheritedEventCount?: SessionLogOffset }): Promise<void> {
    if (this.handles.has(member.memberId)) return
    let created: AgentHandle | undefined
    try {
      const workspace = this.requireWorkspace(member.workspaceId)
      const workspacePath = knownWorkspacePath ?? workspace.path
      // Existing Members carry the pre-sanitization ledger path; activation
      // migrates it onto the sanitized directory before provisioning.
      const sanitizedMemoryPath = dshHomePath('agent-team', 'members', memberMemoryDirectoryName(member.memberId))
      await this.memberRuntime.initializePrivateMemory(sanitizedMemoryPath, member.privateMemoryPath)
      const persisted = knownSessions !== undefined ? knownSessions.has(member.sessionId)
        : await this.sessionPersisted(member.sessionId)
      // AgentOptions declares only provider/model. Install the full selection
      // through the public Agent model-selection seam so reasoning effort is
      // applied to the next request and not lost during activation.
      const selection = member.model ?? this.ctx.agentDefaultModel.currentSelection()
      const agentOptions = { provider: selection.provider, model: selection.model }
      const selected: ModelSelectionRef = { current: selection, assembled: undefined }
      // Absent skills.allow loads every discovered private skill; a present
      // allow-list filters the catalog by name through the live ref below.
      // `swap` is bound by the provider at activation (no-op until then).
      const skillSelection: MemberSkillSelectionRef = { current: member.capabilities?.skills?.allow, swap: () => {} }
      const setup = async (agentCtx: Context, agent: Agent) => {
        try {
          await this.ctx.agentPresets.mount(agentCtx, member.presetId)
          this.memberRuntime.applyMemberToolPolicy(agentCtx, member)
          this.validateMemberPreset(agentCtx)
        } catch (error) {
          // Tag composition failures with their own class: the activation
          // diagnostic routes preset-composition (install/runtime split)
          // failures by type, not by matching message text.
          throw new PresetCompositionError(error instanceof Error ? error.message : String(error), { cause: error })
        }
        installModelSelection(agentCtx, selected)
        // Admission gate for pending context rollovers: once a successful
        // context_rollover result is durable, queued input must not open another
        // old-generation model request. The turn-stop boundary captures the
        // inbox (non-Team input is carried to the new generation), and a
        // racing pre-step rejects instead of admitting claimed messages.
        agentCtx.on('agent/turn-stopping', ({ agent }) => {
          if (!this.contextManagement.needsAdmissionGate(agent)) return
          this.contextManagement.captureQueuedInput(agent)
        })
        agentCtx.on('agent/pre-step', async ({ agent, messages, signal }, next) => {
          // Check before AND after the waterfall: a rollover pending at either
          // edge must reject this old-generation step, preserving its claimed
          // input for the new generation instead of letting it run or drop.
          if (this.contextManagement.needsAdmissionGate(agent)) {
            this.contextManagement.captureClaimedInput(agent, messages)
            return { kind: 'reject' as const }
          }
          // Team pressure policy rides the same pre-step seam after the
          // admission gate: the handoff-budget notice steers into the running
          // turn, and the hard limit forces compaction before the request is
          // forwarded — failing closed blocks the step instead of submitting
          // over the Team limit. Missing route capacity is an explicit reject.
          const pressure = await this.pressurePolicy.onPreStep(agent, signal)
          if (pressure.kind === 'reject') return { kind: 'reject' as const }
          const decision = await next()
          if (decision.kind === 'reject' || !this.contextManagement.needsAdmissionGate(agent)) return decision
          this.contextManagement.captureClaimedInput(agent, messages)
          return { kind: 'reject' as const }
        })
        // Provider context-overflow recovery: one bounded compact-and-retry
        // sequence per failure chain through the Team-owned policy.
        agentCtx.on('agent/request-error', async ({ agent, failure, signal }, next) => {
          const retry = await this.pressurePolicy.onRequestError(agent, failure, signal)
          if (retry) return { kind: 'retry' as const }
          return next()
        })
        return {
          commit: () => {
            // The member scope composes no sandbox-policy service (the preset
            // owns no sandbox row), so read the last logged mode straight from
            // the session log; `sandbox/mode` is log-only and never joins the
            // model-visible surface. Re-appending only when the effective mode
            // differs keeps resumed members from growing redundant events.
            const logged = agent.session.ownEvents().toReversed().find(event => event.type === 'sandbox/mode')
            if (logged?.data.mode !== 'danger-full-access') setSandboxMode(agent.session, 'danger-full-access')
          },
        }
      }
      // A renewal's create path parents at the ledger-recorded previous
      // Session even when the caller does not pass one: a crash between the
      // durable rollover commit and this activation recreates the Session
      // from the ledger binding alone, and the lineage parent is what makes
      // the missing handoff reconstructible on the NEXT failure. A recorded
      // checkpoint seed re-seeds the child here — the crash lost the process
      // memory, but the ledger envelope names the exact source prefix.
      let recordedSeed: readonly SessionEvent[] | undefined
      let recordedSeedCut: SessionLogOffset | undefined
      const rolloverSeed = !persisted && options?.seed === undefined
        ? this.requireLedger().rolloverSeedForMember(member.memberId, member.sessionId)
        : undefined
      if (rolloverSeed !== undefined) {
        // Fail-closed: an unreadable or unprovable recorded seed rejects
        // this activation (the catch below records the diagnostic) instead
        // of silently downgrading a committed checkpoint return to a blank
        // child.
        const resolved = await this.recordedCheckpointPrefix(rolloverSeed)
        recordedSeed = resolved.prefix
        recordedSeedCut = SessionLogOffset(resolved.prefix.length)
      }
      const lineageParent = forkedFrom ?? (!persisted ? this.requireLedger().previousSessionForMember(member.memberId) : undefined)
      let recoveryCarried = 0
      const seededFromLedger = recordedSeed !== undefined
      const effectiveParent = recordedSeed !== undefined ? rolloverSeed!.sourceSessionId : lineageParent
      const seedOptions = options?.seed !== undefined && options.inheritedEventCount !== undefined
        ? { seed: options.seed, inheritedEventCount: options.inheritedEventCount }
        : recordedSeed !== undefined && recordedSeedCut !== undefined
          ? { seed: recordedSeed, inheritedEventCount: recordedSeedCut }
          : {}
      created = persisted
        ? await this.ctx.agents.resume({ resumeSessionId: member.sessionId, agentOptions, setup })
        : await this.ctx.agents.create({
            sessionId: member.sessionId,
            // A context renewal records its fork lineage so the archived
            // previous Session stays discoverable from the durable header; a
            // checkpoint return parents at the seed source and marks the
            // fork seeded with its exact inherited prefix length.
            meta: {
              cwd: workspacePath,
              agentPreset: member.presetId,
              ...(effectiveParent === undefined ? {} : { parentSession: effectiveParent }),
              ...(options?.seed === undefined && !seededFromLedger ? {} : { isSeeded: true }),
            },
            ...seedOptions,
            agentOptions,
            setup,
          })
      this.memberRuntime.mountMemberSkillProvider(member, created.agent.ctx, skillSelection)
      await workspace.attachSession(member.sessionId)
      this.handles.set(member.memberId, created)
      this.memberBySessionId.set(member.sessionId, member.memberId)
      this.modelSelections.set(member.memberId, selected)
      this.clearMemberFailure(member.memberId, 'activation')
      this.nameMemberSession(member, created.agent)
      // The one-shot pressure notice needs no explicit re-arm here: it latches
      // on durable Session evidence, and a fresh generation's own event span
      // starts empty — a new Session is itself the re-arm.
      // Snapshot whether this generation had already started its own turns
      // BEFORE any recovery delivery below: the handoff steer and the Inbox
      // wake legitimately append `turn/start` to this Session, and those must
      // never be mistaken for the generation having run on its own.
      const generationStarted = created.agent.session.ownEvents().some(event => event.type === 'turn/start')
      // A restart between a durable rollover intent and its swap replays the
      // old Session; the projection still carries the intent, so finish the
      // transition (or keep waiting for the containing turn) from here.
      if (persisted) {
        const state = foldContextProjection(created.agent.session.ownEvents(), created.agent.session.inheritedEventCount, created.agent.session.id)
        if (state.pending !== null) this.contextManagement.recoverPendingTransition(member.memberId, created.agent, member.sessionId)
        // A restart between one checkpoint's durable result and its quiet
        // follow-up delivery repairs exactly once; delivered continuations
        // stay delivered through the projection's own delivery record.
        this.contextManagement.repairContinuations(created.agent, state)
        // A restart after the rollover committed but before the handoff was
        // delivered activates the new Session with no handoff in its own
        // log — never treat that as an ordinary blank Member Session. The
        // operation's recorded previous Session (the lineage parent) still
        // holds the intent; rebuild the handoff from it. "No handoff in its
        // own log" is judged over both shapes: a generation rescued from the
        // retired custom kinds carries its handoff as a source the projection
        // does not classify, and rebuilding on top of it would inject the same
        // handoff twice.
        if (!handoffAlreadyInLog(state.boundaries, created.agent.session.ownEvents())) {
          await this.reconstructMissingHandoff(member, created.agent)
        }
        // Carried input redelivery binds to the committed transition target —
        // this Session — never to the handoff's presence: a crash after the
        // handoff landed but before the carried enqueue still replays here.
        recoveryCarried = await this.replayCarriedInput(member, created.agent, generationStarted)
      } else if (forkedFrom === undefined && lineageParent !== undefined) {
        // A restart recreated a Session that never materialized before the
        // crash (the rollover committed, its activation failed, and this
        // create path just rebuilt it from the ledger binding alone): the
        // same handoff reconstruction applies from the ledger's recorded
        // previous Session, and the old generation's unconsumed post-intent
        // input — the durable fold, the same truth the live transition uses —
        // rides behind the handoff exactly as it would have. The rollover's
        // own activation passes its fork parent explicitly and delivers the
        // handoff right after — that delivery is the plan, never this
        // recovery.
        await this.reconstructMissingHandoff(member, created.agent)
        recoveryCarried = await this.replayCarriedInput(member, created.agent, generationStarted)
      }
      // The ordinary Inbox wake runs LAST, after any recovery delivery above:
      // the handoff must stay the first model-facing context of a recovered
      // generation, with carried input behind it and rederived Team facts
      // behind that. When recovery redelivered carried input, the wake is
      // sequenced behind it (its own follow-up turn) so the steer lane can
      // never leapfrog the carried messages. A rollover activation defers the
      // wake entirely — its caller delivers the handoff (and carried input)
      // first and rederives the Inbox afterwards.
      if (options?.deferNotify !== true) this.notifyMember(created.agent, recoveryCarried > 0)
    } catch (error) {
      await created?.dispose()
      this.modelSelections.delete(member.memberId)
      this.memberRuntime.forgetMember(member.memberId)
      const message = error instanceof Error ? error.message : String(error)
      this.ctx.logger.warn(`agent-team: activation failed for member '${this.memberLabel(member.memberId)}': ${message}`)
      this.setActivationDiagnostic(member.memberId, this.activationDiagnosticOf(error, member.sessionId))
    } finally {
      // Activation only changes this Workspace's presence projection.
      this.emitChanged([{ kind: 'workspace', workspaceId: member.workspaceId }])
    }
  }


  /**
   * Rebuild one enabled Member in place from its persisted Session.
   *
   * A bundle-row reload tears down the preset roster subtree, which prunes the
   * standing mount while live agents keep their dead scope bindings: the
   * Member keeps its session but loses its composed tools and services.
   * Re-running the preset composition requires a fresh Agent, and disposal is
   * the cost — the Web Client marks the recreated Session unavailable until it
   * is reopened, the same trade the shipped suspend/resume cycle makes.
   */
  private reactivateMember(memberId: AgentTeamMemberId): Promise<boolean> {
    return this.enqueueLifecycle(async () => {
      const member = this.requireLedger().getMember(memberId)
      if (member === undefined || member.state !== 'enabled') return false
      const stale = this.handles.get(memberId)
      if (stale !== undefined) {
        this.handles.delete(memberId)
        this.modelSelections.delete(memberId)
        this.memberRuntime.forgetMember(memberId)
        // The composition-loss diagnostic this heal answers is stale once the
        // rebuild starts; a later activation must not resurface it.
        this.clearMemberFailure(memberId, 'compaction')
        this.emitAutoCompactionChanged(memberId)
        await stale.dispose()
      }
      await this.activateMember(member)
      return this.handles.has(memberId)
    })
  }

  /**
   * Default an untitled Member Session to its handle so the ordinary Session
   * list names it. An explicit rename or any earlier title always wins; the
   * cosmetic default never fails Member activation.
   */
  private nameMemberSession(member: AgentTeamAgentMember, agent: Agent): void {
    const sessionTitle = this.ctx.get('sessionTitle')
    if (sessionTitle === undefined) return
    try {
      if (sessionTitle.get(agent.session) !== undefined) return
      sessionTitle.rename(agent.session, member.handle)
    } catch {
      // The composition may carry no session-title service, or the rename may
      // race its disposal; the Member works identically without the title.
    }
  }

  private validateMemberPreset(agentCtx: Context): void {
    const scope = scopeOf(agentCtx)
    const teamMessage = this.ctx.tools.get('team_message', scope)
    if ((teamMessage as Record<PropertyKey, unknown> | undefined)?.[AGENT_TEAM_PRESET_MARKER] !== true) {
      // `agentPresets.mount` already rejected an unscoped context, so a scope
      // key the harness sees but this bundle does not means the two sides
      // loaded different module instances of @deepseek-ai/dsh-scope (the
      // common trigger is running the CLI from source via tsx).
      if (scope === undefined) throw new Error(teamPresetScopeMismatchMessage(isTsxDevMode()))
      throw new Error('selected preset is not team-enabled')
    }
    const available = new Set(this.ctx.tools.schemas(scope).map(tool => tool.name))
    const missing = AGENT_TEAM_TOOL_NAMES.filter(name => !available.has(name))
    if (missing.length > 0) throw new Error(`team-enabled preset is missing tools: ${missing.join(', ')}`)
  }

  private memberStatus(member: AgentTeamAgentMember): AgentTeamAgentMemberStatus {
    if (member.state === 'inactive') return Object.freeze({ member, availability: 'inactive', presence: 'unavailable' })
    if (member.state === 'archived') return Object.freeze({ member, availability: 'archived', presence: 'unavailable' })
    if (member.state === 'suspended') return Object.freeze({ member, availability: 'suspended', presence: 'unavailable' })
    const failures = this.memberFailures.get(member.memberId)
    if (failures?.activation !== undefined) return Object.freeze({ member, availability: 'unavailable', presence: 'unavailable', diagnostic: failures.activation })
    const handle = this.handles.get(member.memberId)
    if (handle === undefined) return Object.freeze({ member, availability: 'unavailable', presence: 'unavailable' })
    // A rollover commits its ledger binding before the old generation retires
    // and the new one activates; during that window the live handle still runs
    // the previous Session. The Member stays visible but must not report the
    // new binding as active — a Client following the row would otherwise open
    // a Session that does not exist yet.
    if (handle.agent.id !== member.sessionId) return Object.freeze({ member, availability: 'unavailable', presence: 'unavailable', diagnostic: { class: 'rollover' as const, detail: 'context rollover in progress' } })
    if (this.ctx.agentPresets.composedPreset(handle.agent.ctx) === undefined) {
      return Object.freeze({ member, availability: 'active', presence: 'error', diagnostic: { class: 'preset-composition' as const, detail: ORPHANED_MEMBER_DIAGNOSTIC } })
    }
    const runtimeError = failures?.runtime ?? failures?.compaction
    if (runtimeError !== undefined) return Object.freeze({ member, availability: 'active', presence: 'error', diagnostic: { class: 'runtime' as const, detail: runtimeError } })
    // Capability warnings are runtime-derived at activation (handles-scoped,
    // like failures): absent while capabilities resolve cleanly.
    const capabilityWarnings = this.memberRuntime.capabilityWarningsFor(member.memberId)
    return Object.freeze({
      member, availability: 'active', presence: handle.agent.status === 'running' ? 'working' : 'available',
      ...(capabilityWarnings === undefined ? {} : { capabilityWarnings }),
    })
  }

  private setMemberFailure(memberId: AgentTeamMemberId, slot: 'runtime' | 'compaction', message: string): void {
    const failures = this.memberFailures.get(memberId) ?? {}
    failures[slot] = message
    this.memberFailures.set(memberId, failures)
  }

  /** Store one structured activation diagnostic; runtime/compaction slots stay plain messages. */
  private setActivationDiagnostic(memberId: AgentTeamMemberId, diagnostic: AgentTeamMemberDiagnostic): void {
    const failures = this.memberFailures.get(memberId) ?? {}
    failures.activation = Object.freeze(diagnostic)
    this.memberFailures.set(memberId, failures)
  }

  /**
   * Route one activation failure to its diagnostic class: preset composition
   * failures by their own error class, session failures by the seam's typed
   * classification (our call sites carry it directly; a Harness resume
   * failure carries it through the cause chain), everything else as an
   * unclassified activation failure.
   */
  private activationDiagnosticOf(error: unknown, sessionId: SessionId): AgentTeamMemberDiagnostic {
    if (error instanceof PresetCompositionError) return { class: 'preset-composition' as const, detail: error.message }
    const failure = error instanceof StoredSessionReadError ? error.failure : sessionFailureOf(error, sessionId)
    if (failure !== undefined) {
      const shared = { detail: failure.detail, ...(failure.location === undefined ? {} : { location: failure.location }), sessionId: failure.sessionId }
      return failure.kind === 'refused' ? { class: 'session-refused' as const, ...shared } : { class: 'session-unreadable' as const, ...shared }
    }
    return { class: 'activation' as const, detail: error instanceof Error ? error.message : String(error) }
  }

  /** Mark a session-refused activation diagnostic as proven non-remediable. */
  private markRefusalNonRemediable(memberId: AgentTeamMemberId): void {
    const failures = this.memberFailures.get(memberId)
    const activation = failures?.activation
    if (activation === undefined || activation.class !== 'session-refused') return
    failures!.activation = Object.freeze({ ...activation, remediable: false })
  }

  private clearMemberFailure(memberId: AgentTeamMemberId, slot: 'activation' | 'runtime' | 'compaction'): boolean {
    const failures = this.memberFailures.get(memberId)
    if (failures === undefined || failures[slot] === undefined) return false
    if (Object.keys(failures).length === 1) this.memberFailures.delete(memberId)
    else delete failures[slot]
    return true
  }

  private requireWorkspace(workspaceId: AgentTeamViewRequest['workspaceId']) {
    const workspace = this.ctx.workspaceRegistry.get(workspaceId)
    if (workspace === undefined) throw new Error(`unknown Workspace '${workspaceId}'`)
    return workspace
  }

  private requireLedger(): AgentTeamLedger {
    if (this.ledger === undefined || this.domain === undefined) throw new Error('agent-team service is not initialized')
    return this.ledger
  }

  private requireAccepting(): void {
    if (!this.accepting) throw new Error('agent-team service is shutting down')
  }

  private emitCommitted(receipt: AgentTeamOperationReceipt): void {
    this.ctx.emit('agent-team/committed', { receipt })
    const operation = this.ledger?.getOperation(receipt.operationId)
    if (operation === undefined) {
      this.emitChanged()
      return
    }
    const ledger = this.requireLedger()
    this.emitChanged(ledger.changeScopesOf(operation))
    // Nudge reconciliation precedes notifyMember: a committed reply both
    // resets the author's silence and cancels any of its queued nudge before
    // the Inbox notice (higher priority) is considered.
    this.progressNudge.onCommitted(operation)
    for (const memberId of ledger.affectedMembersOf(operation)) {
      const handle = this.handles.get(memberId)
      if (handle !== undefined) this.notifyMember(handle.agent)
    }
    // Task acceptance no longer schedules standalone auto compaction: it is
    // a semantic checkpoint/context cue (delivered as ordinary Team
    // notification), and the Team pressure policy owns compaction entry.
  }

  /** Model-visible active-Claim labels for the pressure notice. */
  private activeClaimLabels(memberId: AgentTeamMemberId): readonly string[] {
    const ledger = this.ledger
    if (ledger === undefined) return []
    const labels: string[] = []
    for (const claim of ledger.activeClaimsForMember(memberId)) {
      if (claim.state !== 'active') continue
      labels.push(`${claim.claimRef} (${claim.direction})`)
    }
    return labels
  }

  /** Model-visible running/stopping job labels for the pressure notice. */
  private runningJobLabels(memberId: AgentTeamMemberId): readonly string[] {
    const handle = this.handles.get(memberId)
    if (handle === undefined) return []
    const jobs = handle.agent.ctx.get('jobs')
    if (jobs === undefined) return []
    return jobs.list(handle.agent)
      .filter((job: { status: string }) => job.status === 'running' || job.status === 'stopping')
      .map((job: { id: string; name?: string }) => `${job.name ?? job.id}`)
  }

  private emitAutoCompactionChanged(memberId: AgentTeamMemberId): void {
    const workspaceId = this.ledger?.getMember(memberId)?.workspaceId
    this.emitChanged(workspaceId === undefined ? undefined : [{ kind: 'workspace', workspaceId }])
  }

  /** Wake from durable unread state with bounded facts for direct and state-changing work. */
  private notifyMember(agent: Agent, sequenced = false): void {
    const member = this.memberForAgent(agent)
    if (member === undefined || member.state !== 'enabled') return
    const notifications = this.requireLedger().notificationFacts(member.memberId, { workspaceId: member.workspaceId })
    if (notifications.length === 0) {
      this.notifiedInbox.delete(member.memberId)
      return
    }
    // Any ordinary next-turn input already queued (a rollover's or recovery's
    // carried messages) forces sequencing regardless of the caller: a steer
    // would claim the nearest step boundary and leapfrog the carried turn.
    if (!sequenced) {
      sequenced = agent.inbox.nextTurn.some(message => message.source.kind === 'user')
    }
    const signature = JSON.stringify(notifications.map(({ item }) => [
      item.thread.threadRef, item.thread.revision, item.unreadCount, item.directCount, item.newestSequence,
    ]))
    if (this.notifiedInbox.get(member.memberId) === signature) return
    const pending = [...agent.inbox.nextStep, ...agent.inbox.nextTurn]
    // steerResume already combines the recovery instruction and these durable
    // facts. Its synchronous running transition must not replace that notice.
    if (pending.some(message => this.isRecoveryNotice(message))) {
      this.notifiedInbox.set(member.memberId, signature)
      return
    }
    const existingInboxHint = pending.find(message => this.isInboxNotice(message))
    if (existingInboxHint !== undefined) agent.inbox.remove(existingInboxHint.id)
    // A durable Inbox notice outranks a queued progress nudge; revoke it so
    // the model reads concrete unread work instead of a generic reminder.
    this.progressNudge.revokePendingNotice(member.memberId)
    const hint = createUserMessage({
      content: [{ type: 'text', text: this.notificationText(notifications, member.memberId) }],
      source: { kind: 'plugin', plugin: AGENT_TEAM_PLUGIN_ID, form: 'notice', summary: INBOX_NOTICE_SUMMARY },
    })
    this.notifiedInbox.set(member.memberId, signature)
    try {
      // Steer normally claims the nearest step boundary — which would
      // preempt carried input that a rollover or crash recovery queued as
      // ordinary next-turn messages. The sequenced mode enqueues the
      // rederived Inbox as its own follow-up turn instead, so the delivery
      // order stays handoff → carried input → rederived Inbox.
      if (sequenced) agent.followup(hint)
      else agent.steer(hint)
    } catch (error) {
      this.clearMemberNotificationState(member.memberId)
      throw error
    }
  }

  private isInboxNotice(message: UserMessage): boolean {
    const source = message.source
    return source.kind === 'plugin' && source.plugin === AGENT_TEAM_PLUGIN_ID
      && source.form === 'notice' && source.summary === INBOX_NOTICE_SUMMARY
  }

  private isRecoveryNotice(message: UserMessage): boolean {
    const source = message.source
    return source.kind === 'plugin' && source.plugin === AGENT_TEAM_PLUGIN_ID
      && source.form === 'notice' && source.summary === RECOVERY_NOTICE_SUMMARY
  }

  private notificationText(notifications: ReturnType<AgentTeamLedger['notificationFacts']>, readerId?: AgentTeamMemberId): string {
    const maxCharacters = 32 * 1024
    const sections: string[] = ['Team Inbox has unread work.']
    let characterCount = sections[0]!.length
    let detailedFactCount = 0
    let omitted = notifications.length > 8
    const append = (section: string): boolean => {
      if (characterCount + section.length + 2 > maxCharacters) {
        omitted = true
        return false
      }
      sections.push(section)
      characterCount += section.length + 2
      return true
    }
    for (const { item, facts } of notifications.slice(0, 8)) {
      for (const { fact, direct } of facts) {
        if (detailedFactCount >= 20) {
          omitted = true
          break
        }
        if (direct && fact.kind === 'message') {
          const sender = fact.message.sender === AGENT_TEAM_HUMAN_MEMBER_ID
            ? 'human' : this.requireLedger().getMember(fact.message.sender)?.handle ?? fact.message.sender
          const detail = ['Direct Team mention', `Occurred at: ${formatTeamTimestamp(fact.occurredAt)}`, `From: ${sender}`, `Channel: ${item.channelRef}`,
            ...(item.task === undefined ? [] : [`Task: ${item.task.taskRef}`]),
            `Thread: ${item.thread.threadRef}`, `Message ref: ${fact.message.messageRef}`,
            `Message: ${this.boundedNotificationBody(fact.message.body)}`].join('\n')
          if (append(detail)) detailedFactCount += 1
        } else if (fact.kind === 'activity') {
          const detail = `${this.activityNotification(fact.activity, readerId)}\nOccurred at: ${formatTeamTimestamp(fact.occurredAt)}\nThread: ${item.thread.threadRef}`
          if (append(detail)) detailedFactCount += 1
        }
      }
      const ordinary = facts.filter(entry => entry.fact.kind === 'message' && !entry.direct)
      if (ordinary.length > 0) {
        const route = item.task === undefined ? `Thread ${item.thread.threadRef}` : `Task ${item.task.taskRef}`
        append(`${route}: ${ordinary.length} unread update${ordinary.length === 1 ? '' : 's'} · newest at ${formatTeamTimestamp(ordinary.at(-1)!.fact.occurredAt)}.`)
      }
    }
    if (omitted) sections.push('More unread work remains in team_inbox; the automatic context is bounded.')
    sections.push('Use team_thread read with the relevant threadRef before acting or replying. Use team_inbox only when you need to triage the remaining Threads.')
    return sections.join('\n\n')
  }

  private boundedNotificationBody(body: string): string {
    const limit = 8 * 1024
    return body.length <= limit ? body : `${body.slice(0, limit)}\n[Message body truncated; use team_thread read for the full Message.]`
  }

  private activityNotification(activity: AgentTeamActivity, readerId?: AgentTeamMemberId): string {
    const actor = activity.actor === AGENT_TEAM_HUMAN_MEMBER_ID
      ? 'human' : this.requireLedger().getMember(activity.actor)?.handle ?? activity.actor
    // An acceptance concludes the reader's own Claims in two ways: a Claim
    // already finished before the accept was accepted (its work stands), and
    // a still-open Claim the accept completed atomically (no further work is
    // needed). Both must be said plainly, or the owner keeps working on a
    // done Task or never learns its contribution was accepted.
    if (activity.kind === 'accept' && activity.actor === AGENT_TEAM_HUMAN_MEMBER_ID && readerId !== undefined) {
      const acceptedOwn = (activity.acceptedClaimRefs ?? []).filter(claimRef => this.requireLedger().getClaim(claimRef)?.owner === readerId)
      const completedOwn = (activity.completedClaimRefs ?? []).filter(claimRef => this.requireLedger().getClaim(claimRef)?.owner === readerId)
      // The early-accept-only reader holds no finished Claim: every own Claim
      // was completed atomically, so the "finished Claim" clause's ref list
      // would be empty. Render the completed semantics alone instead of a
      // sentence with a dangling empty list.
      const finishedOwn = acceptedOwn.filter(claimRef => !completedOwn.includes(claimRef))
      if (completedOwn.length > 0 && finishedOwn.length > 0) {
        return `Team Task update\n${actor} accepted Task ${activity.taskRef}. Your Claim ${completedOwn.join(', ')} was completed with the acceptance, and your finished Claim ${finishedOwn.join(', ')} was accepted. No further work is needed.`
      }
      if (completedOwn.length > 0) {
        return `Team Task update\n${actor} accepted Task ${activity.taskRef} and your open Claim ${completedOwn.join(', ')} was completed with it. No further work is needed.`
      }
      if (acceptedOwn.length > 0) {
        return `Team Task update\n${actor} accepted Task ${activity.taskRef}; your finished Claim ${acceptedOwn.join(', ')} was accepted. No further work is needed.`
      }
    }
    if (activity.kind === 'claim' || activity.kind === 'done' || activity.kind === 'release') {
      return `Team Task update\n${actor} ${activity.kind} Claim ${activity.claimRef} on Task ${activity.taskRef}.`
    }
    if (activity.kind === 'claims_released') {
      return `Team Task update\n${actor}'s Claims ${activity.claimRefs.join(', ')} were released on Task ${activity.taskRef}.`
    }
    if (activity.kind === 'promote') {
      return `Team Task update\n${actor} created Task ${activity.taskRef} from Thread ${activity.threadRef}; it is open for claims.`
    }
    const released = 'releasedClaimRefs' in activity && activity.releasedClaimRefs !== undefined && activity.releasedClaimRefs.length > 0
      ? ` Released Claims: ${activity.releasedClaimRefs.join(', ')}.` : ''
    return `Team Task update\n${actor} ${activity.kind} Task ${activity.taskRef}.${released}`
  }

  /** Dispose one live Member Session and drop its per-Member runtime state. */
  private async disposeMemberSession(memberId: AgentTeamMemberId, member: Pick<AgentTeamAgentMember, 'memberId' | 'sessionId'>): Promise<void> {
    this.clearMemberRecoveryState(member)
    const handle = this.handles.get(memberId)
    if (handle !== undefined) {
      await handle.dispose()
      this.handles.delete(memberId)
    }
    this.memberBySessionId.delete(member.sessionId)
    this.modelSelections.delete(memberId)
    this.memberRuntime.forgetMember(memberId)
    this.clearMemberFailure(memberId, 'activation')
  }

  private clearMemberRecoveryState(member: Pick<AgentTeamAgentMember, 'memberId' | 'sessionId'>): void {
    this.recovery.stopTracking(member.memberId)
    this.progressNudge.stopTracking(member.memberId)
    this.clearMemberFailure(member.memberId, 'runtime')
    this.clearMemberNotificationState(member.memberId)
  }

  private clearMemberNotificationState(memberId: AgentTeamMemberId): void {
    this.notifiedInbox.delete(memberId)
  }

  /**
   * Wake waiters for one committed or lifecycle change. Undefined broadcasts
   * to everyone; an empty scope list invalidates nobody because no shared
   * projection changed; otherwise global and matching scoped waiters wake.
   */
  private emitChanged(scopes?: readonly AgentTeamChangeScope[]): void {
    this.changeVersion += 1
    for (const waiter of this.changeWaiters) {
      const waiterScope = waiter.scope
      if (scopes !== undefined && (waiterScope === undefined ? scopes.length === 0 : !scopes.some(scope => sameChangeScope(scope, waiterScope)))) continue
      this.changeWaiters.delete(waiter)
      waiter.wake(this.changeVersion)
    }
  }

  private validateChangeScope(scope: AgentTeamChangeScope | undefined): AgentTeamChangeScope | undefined {
    if (scope === undefined) return undefined
    const ref = scope.kind === 'workspace' ? scope.workspaceId : scope.kind === 'channel' ? scope.channelRef : scope.threadRef
    if (typeof ref !== 'string' || ref.length === 0) throw new Error(`change scope of kind '${scope.kind}' requires a non-empty ref`)
    return scope
  }

  private enqueueLifecycle<T>(operation: () => Promise<T>): Promise<T> {
    this.requireAccepting()
    const result = this.lifecycleTail.then(operation)
    this.lifecycleTail = result.then(() => {}, () => {})
    return result
  }
}
