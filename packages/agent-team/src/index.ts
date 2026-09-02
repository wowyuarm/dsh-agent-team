/**
 * Durable Agent Team Host capability.
 *
 * The Host owns the append-only collaboration ledger and all Member lifecycle
 * effects. Session history and browser state are projections, never Team facts.
 * @module @wowyuarm/dsh-agent-team
 */

import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { Context, Service } from '@deepseek-ai/cordis'
import { installModelSelection, type Agent, type AgentHandle, type ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-agent-presets'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { scopeOf } from '@deepseek-ai/dsh-scope'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import { effectiveSandboxMode, setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-tools'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import { ATTACHMENT_MAX_BYTES, attachmentPayloadPath, attachmentsRoot, copyPathAttachment, newAttachmentId, readAttachment, sanitizeMediaType, sweepAttachmentCache, validatePathAttachment, writeAttachment } from './attachments.ts'
import { acceptedTaskCompactionMembers, AutoCompactionCoordinator, PRE_COMPACTION_NOTICE_SUMMARY, preCompactionNoticeText } from './auto-compaction.ts'
import { AGENT_TEAM_HUMAN_MEMBER_ID, AgentTeamLedger, agentTeamHumanActor } from './ledger.ts'
import * as memberSkills from './member-skills.ts'
import type { MemberSkillSelectionRef } from './member-skills.ts'
import { classifyRecoverableError, RecoveryCoordinator, RECOVERY_MAX_CONSECUTIVE_ERRORS } from './recovery.ts'
import { agentTeamDomainSpec } from './spec.ts'
import type {
  AgentTeamAddMemberRequest,
  AgentTeamAgentMember,
  AgentTeamAgentMemberStatus,
  AgentTeamChangeScope,
  AgentTeamChangesRequest,
  AgentTeamChangesResult,
  AgentTeamActivity,
  AgentTeamClaimList,
  AgentTeamClaimRequest,
  AgentTeamClaimResult,
  AgentTeamClientMemberStatus,
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
  AgentTeamMemberCapabilities,
  AgentTeamCapabilityWarning,
  AgentTeamMessageAttachment,
  AgentTeamMemberId,
  AgentTeamMemberResult,
  AgentTeamMembersRequest,
  AgentTeamResolveTaskRefsRequest,
  AgentTeamResolveTaskRefsResult,
  AgentTeamTaskRef,
  AgentTeamOperationReceipt,
  AgentTeamPromoteThreadRequest,
  AgentTeamPromoteThreadResult,
  AgentTeamPutAttachmentRequest,
  AgentTeamPutAttachmentResult,
  AgentTeamRecoverMemberRequest,
  AgentTeamRecoverMemberResult,
  AgentTeamClearMemberContextRequest,
  AgentTeamClearMemberContextResult,
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

/** Process-stable marker carried by the final Team message tool definition. */
export const AGENT_TEAM_PRESET_MARKER = Symbol.for('@wowyuarm/dsh-agent-team.preset')

const AGENT_TEAM_PLUGIN_ID = '@wowyuarm/dsh-agent-team'
const INBOX_NOTICE_SUMMARY = 'Team Inbox has unread work.'
const RECOVERY_NOTICE_SUMMARY = 'Recovery: continue your interrupted work.'
const ORPHANED_MEMBER_DIAGNOSTIC = 'Member preset composition was lost after a reload; its tools are unavailable. Resume rebuilds the member in place.'

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

/** Copy a Remote-supplied capability overlay into owned frozen storage. */
function deepCopyCapabilities(capabilities: AgentTeamMemberCapabilities): AgentTeamMemberCapabilities {
  const copyAllow = (allow: readonly string[] | undefined): { allow?: readonly string[] } =>
    allow === undefined ? {} : { allow: [...allow] }
  return {
    ...(capabilities.tools === undefined ? {} : { tools: copyAllow(capabilities.tools.allow) }),
    ...(capabilities.skills === undefined ? {} : { skills: copyAllow(capabilities.skills.allow) }),
  }
}

/** Mark the preset's `team_message` definition as an Agent Team consumer. */
export function markAgentTeamPreset<T extends object>(definition: T): T {
  Object.defineProperty(definition, AGENT_TEAM_PRESET_MARKER, { value: true })
  return definition
}

/** Model-facing capabilities every Team-enabled preset must publish. */
export const AGENT_TEAM_TOOL_NAMES = Object.freeze([
  'team_inbox',
  'team_thread',
  'team_message',
  'team_claim',
  'team_view',
] as const)

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
  /** Live selection refs let model edits take effect without disposing the Session. */
  private readonly modelSelections = new Map<AgentTeamMemberId, ModelSelectionRef>()
  /** Live skill selection refs let capability edits re-filter the catalog without disposing the Session. */
  private readonly skillSelections = new Map<AgentTeamMemberId, MemberSkillSelectionRef>()
  /** Per-Member private skill provider disposers; released with the Member's agent scope. */
  private readonly skillProviderDisposals = new Map<AgentTeamMemberId, () => void>()
  /**
   * Why one Member shows error presence, per failure source. Reads prefer
   * activation, then runtime, then compaction; slots clear independently, so
   * a recovered runtime error re-reveals an outstanding compaction failure.
   * Keyed by Member rather than Session so a restarted Session cannot leak
   * stale keys.
   */
  private readonly memberFailures = new Map<AgentTeamMemberId, {
    /** Activation failed; the Member has no live Session to recover into. */
    activation?: string
    /** The Member Session reported agent/error. */
    runtime?: string
    /** Last non-busy automatic-compaction failure; entered transactions retain additional Session history. */
    compaction?: string
  }>()
  /**
   * Live per-Member tool restriction disposers, mirroring modelSelections:
   * activation registers, disposal paths release, edits swap at a turn
   * boundary. Deliberate interface reservation: the restriction seam is the
   * primitive future Runtime Revision manifests orchestrate — do not remove
   * during cleanup.
   */
  private readonly memberRestrictions = new Map<AgentTeamMemberId, () => void>()
  /**
   * Runtime-derived capability warnings, recomputed at every activation (like
   * memberFailures, keyed by Member and never persisted): persisted warnings
   * would lie after a Host restart or a Harness upgrade renames tools.
   */
  private readonly capabilityWarnings = new Map<AgentTeamMemberId, readonly AgentTeamCapabilityWarning[]>()
  private readonly autoCompaction: AutoCompactionCoordinator
  /** Agent ids with a turn in flight; restarts must wait for the boundary. */
  private readonly runningAgents = new Set<SessionId>()
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
  private lifecycleTail: Promise<void> = Promise.resolve()
  private accepting = true
  private changeVersion = 0
  private readonly changeWaiters = new Set<ChangeWaiter>()

  constructor(ctx: Context) {
    super(ctx, 'agentTeam')
    this.autoCompaction = new AutoCompactionCoordinator({
      agentForMember: memberId => this.handles.get(memberId)?.agent,
      compactionForAgent: agent => this.ctx.agentPresets.serviceFor(agent, 'compaction'),
      reactivate: memberId => this.reactivateMember(memberId),
      failed: (memberId, _sessionId, diagnostic) => {
        this.setMemberFailure(memberId, 'compaction', diagnostic)
        this.emitAutoCompactionChanged(memberId)
      },
      cleared: memberId => {
        if (!this.clearMemberFailure(memberId, 'compaction')) return
        this.emitAutoCompactionChanged(memberId)
      },
      log: message => { this.ctx.logger.warn(`agent-team: ${message}`) },
      // Advisory only: the Agent decides whether anything is worth persisting.
      steerPreCompaction: agent => {
        const hint = createUserMessage({
          content: [{ type: 'text', text: preCompactionNoticeText() }],
          source: { kind: 'plugin', plugin: AGENT_TEAM_PLUGIN_ID, form: 'notice', summary: PRE_COMPACTION_NOTICE_SUMMARY },
        })
        agent.steer(hint)
      },
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
        this.notifyMember(agent)
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
    const domain = await this.ctx.storageDomain.open(agentTeamDomainSpec)
    this.ctx.effect(() => async () => {
      this.accepting = false
      this.recovery.dispose()
      await this.autoCompaction.dispose()
      if (this.attachmentGcTimer !== undefined) clearInterval(this.attachmentGcTimer)
      this.attachmentGcTimer = undefined
      this.emitChanged()
      await this.lifecycleTail
      await Promise.all([...this.handles.values()].map(handle => handle.dispose()))
      this.handles.clear()
      this.modelSelections.clear()
      this.skillSelections.clear()
      for (const dispose of this.skillProviderDisposals.values()) dispose()
      this.skillProviderDisposals.clear()
      for (const dispose of this.memberRestrictions.values()) dispose()
      this.memberRestrictions.clear()
      this.capabilityWarnings.clear()
      this.runningAgents.clear()
      await domain.close()
    }, 'agentTeam.dispose')
    this.domain = domain
    const ledger = new AgentTeamLedger(domain.table('operations'))
    this.ledger = ledger
    const initialization = await ledger.initialize()
    if (initialization.committed) this.emitCommitted(initialization.value)
    this.startAttachmentGc(ledger)
    // One metadata listing serves every Member restore; per-member list calls
    // would repeat the same I/O linearly during startup.
    const persistedSessions = new Set((await this.ctx.sessionPersistence.list()).map(header => header.id))
    for (const member of ledger.listMembers()) {
      if (member.state === 'enabled') await this.activateMember(member, undefined, persistedSessions)
      else if (member.state === 'inactive') await this.cleanupRemovedMember(member)
    }
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
        privateMemoryPath: dshHomePath('agent-team', 'members', memberId),
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
      await this.activateMember(result.value.member)
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
      // Drop the old handle's transient state: pending recovery episodes and
      // error markers belong to the disposed agent, not to the Member.
      this.recovery.stopTracking(request.memberId)
      await active.dispose()
      this.handles.delete(request.memberId)
      this.modelSelections.delete(request.memberId)
      this.skillSelections.delete(request.memberId)
      this.releaseMemberToolPolicy(request.memberId)
      this.releaseMemberSkillProvider(request.memberId)
      this.clearMemberFailure(request.memberId, 'activation')
      this.clearMemberNotificationState(request.memberId)
      // The previous log survives on disk; archiving hides it from every
      // grouping surface so one Member keeps exactly one visible Session.
      await this.ctx.workspaceRegistry.archiveSession(previousSessionId)
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
    if (this.runningAgents.has(active.agent.id)) {
      await new Promise<void>(resolve => {
        const disposers: Array<() => void> = []
        const settle = (): void => {
          for (const dispose of disposers.splice(0)) dispose()
          resolve()
        }
        disposers.push(
          this.ctx.on('agent/status', (payload: { agent: Agent; status: string }) => {
            if (payload.agent !== active.agent) return
            // A turn that ends — clean idle or error — is the boundary; the
            // next step recomputes schemas from the new restriction.
            if (payload.status !== 'running') settle()
          }),
          // Disposal (suspend/remove/reactivation) resolves the wait: the old
          // restriction went with the disposed scope, so only the ledger
          // intent remains to apply at the next activation.
          this.ctx.on('session/disposed', (session: { id: SessionId }) => {
            if (session.id === active.agent.session.id) settle()
          }),
        )
      })
      if (this.handles.get(memberId) !== active) return
    }
    this.reapplyMemberToolPolicy(stored)
    const skillSelection = this.skillSelections.get(memberId)
    if (skillSelection !== undefined) skillSelection.swap(stored.capabilities?.skills?.allow)
  }

  /** Irreversibly remove one Member, archive its Session, and delete its private namespace. */
  async removeMember(request: AgentTeamRemoveMemberRequest): Promise<AgentTeamRemoveMemberResult> {
    return this.enqueueLifecycle(async () => {
      const result = await this.requireLedger().removeMember({ ...request, actor: agentTeamHumanActor() })
      if (result.committed) this.emitCommitted(result.value.receipt)
      await this.disposeMemberSession(request.memberId, result.value.member)
      await this.cleanupRemovedMember(result.value.member)
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
    return result.value
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
        content: [{ type: 'text', text: this.dmRelayText(agent, recipient, request.body.trim(), result.value.receipt.operationId) }],
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
  private dmRelayText(senderAgent: Agent, recipient: AgentTeamAgentMember, body: string, excluding: AgentTeamOperationId): string {
    const sender = this.memberForAgent(senderAgent)
    const prior = this.requireLedger().dmHistoryBetween(senderAgent.id, recipient.memberId, excluding)
    const header = `Direct message from @${sender?.handle ?? 'a Team Member'}:`
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

  private async activateMember(member: AgentTeamAgentMember, knownWorkspacePath?: string, knownSessions?: ReadonlySet<SessionId>, forkedFrom?: SessionId): Promise<void> {
    if (this.handles.has(member.memberId)) return
    let created: AgentHandle | undefined
    try {
      const workspace = this.requireWorkspace(member.workspaceId)
      const workspacePath = knownWorkspacePath ?? workspace.path
      await this.initializePrivateMemory(member.privateMemoryPath)
      const persisted = knownSessions !== undefined ? knownSessions.has(member.sessionId)
        : (await this.ctx.sessionPersistence.list()).some(header => header.id === member.sessionId)
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
      const setup = async (agentCtx: Context) => {
        await this.ctx.agentPresets.mount(agentCtx, member.presetId)
        this.applyMemberToolPolicy(agentCtx, member)
        this.validateMemberPreset(agentCtx)
        installModelSelection(agentCtx, selected)
        return {
          commit: () => {
            const agent = agentCtx.agent
            if (agent === undefined) throw new Error('agent-team setup has no unpublished Agent')
            if (effectiveSandboxMode(agent.session.events) !== 'danger-full-access') setSandboxMode(agent.session, 'danger-full-access')
          },
        }
      }
      created = persisted
        ? await this.ctx.agents.resume({ resumeSessionId: member.sessionId, agentOptions, setup })
        : await this.ctx.agents.create({
            sessionId: member.sessionId,
            // A context renewal records its fork lineage so the archived
            // previous Session stays discoverable from the durable header.
            meta: { cwd: workspacePath, agentPreset: member.presetId, ...(forkedFrom === undefined ? {} : { parentSession: forkedFrom }) },
            agentOptions,
            setup,
          })
      // The Member-private skill provider registers on the created agent's
      // exact scope layer (the traceable-service seam, like the tool
      // restriction): each Member scans only its own skills directory.
      this.skillProviderDisposals.set(member.memberId, memberSkills.mountMemberSkillProvider(created.agent.ctx, {
        skillsDirectory: join(member.privateMemoryPath, 'skills'),
        selection: skillSelection,
      }))
      await workspace.attachSession(member.sessionId)
      this.handles.set(member.memberId, created)
      this.modelSelections.set(member.memberId, selected)
      this.skillSelections.set(member.memberId, skillSelection)
      this.clearMemberFailure(member.memberId, 'activation')
      this.nameMemberSession(member, created.agent)
      this.notifyMember(created.agent)
      this.autoCompaction.activated(member.memberId)
    } catch (error) {
      await created?.dispose()
      this.modelSelections.delete(member.memberId)
      this.skillSelections.delete(member.memberId)
      this.releaseMemberToolPolicy(member.memberId)
      this.releaseMemberSkillProvider(member.memberId)
      this.setMemberFailure(member.memberId, 'activation', error instanceof Error ? error.message : String(error))
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
        this.skillSelections.delete(memberId)
        this.releaseMemberToolPolicy(memberId)
        this.releaseMemberSkillProvider(memberId)
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
      throw new Error('selected preset is not team-enabled')
    }
    const available = new Set(this.ctx.tools.schemas(scope).map(tool => tool.name))
    const missing = AGENT_TEAM_TOOL_NAMES.filter(name => !available.has(name))
    if (missing.length > 0) throw new Error(`team-enabled preset is missing tools: ${missing.join(', ')}`)
  }

  /**
   * Apply one Member's persisted tool allow-list as a scoped restriction on
   * the freshly composed preset surface, and derive activation-time warnings
   * for entries the current tool surface no longer knows. Runs inside setup
   * BEFORE validateMemberPreset so the validation observes the restricted
   * view (the Host always unions the five Team tools over the configured
   * list). Deliberate interface reservation: this restriction seam is the
   * primitive future Runtime Revision manifests orchestrate — do not remove
   * during cleanup.
   */
  private applyMemberToolPolicy(agentCtx: Context, member: AgentTeamAgentMember): void {
    const scope = scopeOf(agentCtx)
    const configured = member.capabilities?.tools?.allow
    if (configured === undefined) {
      this.capabilityWarnings.delete(member.memberId)
      return
    }
    // Drop names the current surface does not know rather than failing the
    // activation: a Harness upgrade renaming a tool must not make the Member
    // unavailable. The warning carries the known-name digest so a distant
    // future reader can diagnose the drift.
    const known = this.ctx.tools.schemas(scope).map(tool => tool.name)
    const knownSet = new Set(known)
    const dropped = configured.filter(name => !knownSet.has(name))
    this.setCapabilityWarnings(member.memberId, dropped.map(name => ({ name, knownNames: known })))
    const allow = [...new Set([...configured.filter(name => knownSet.has(name)), ...AGENT_TEAM_TOOL_NAMES])]
    if (allow.length === 0) return
    // tools.restrict() requires a scoped context and rejects names outside
    // the inherited surface; both errors surface as this Member's activation
    // failure without touching any other Member.
    const dispose = agentCtx.tools.restrict({ allow })
    this.memberRestrictions.set(member.memberId, dispose)
  }

  /** Swap a live Member's tool policy at a turn boundary: dispose the old restriction, apply the new. */
  private reapplyMemberToolPolicy(member: AgentTeamAgentMember): void {
    this.releaseMemberToolPolicy(member.memberId)
    this.applyMemberToolPolicy(this.requireLiveMemberContext(member.memberId), member)
  }

  private requireLiveMemberContext(memberId: AgentTeamMemberId): Context {
    const handle = this.handles.get(memberId)
    if (handle === undefined) throw new Error(`Agent Member '${this.memberLabel(memberId)}' has no live session for a tool-policy update`)
    return handle.agent.ctx
  }

  /** Release one Member's restriction disposer and warning state; safe to call twice. */
  private releaseMemberToolPolicy(memberId: AgentTeamMemberId): void {
    const dispose = this.memberRestrictions.get(memberId)
    if (dispose !== undefined) {
      this.memberRestrictions.delete(memberId)
      dispose()
    }
    this.capabilityWarnings.delete(memberId)
  }

  /** Release one Member's private skill provider; safe to call twice. */
  private releaseMemberSkillProvider(memberId: AgentTeamMemberId): void {
    const dispose = this.skillProviderDisposals.get(memberId)
    if (dispose === undefined) return
    this.skillProviderDisposals.delete(memberId)
    dispose()
  }

  private setCapabilityWarnings(memberId: AgentTeamMemberId, warnings: readonly AgentTeamCapabilityWarning[]): void {
    if (warnings.length === 0) this.capabilityWarnings.delete(memberId)
    else this.capabilityWarnings.set(memberId, Object.freeze([...warnings]))
  }

  private async initializePrivateMemory(path: string): Promise<void> {
    await mkdir(join(path, 'notes'), { recursive: true })
    // The Member-private skills directory starts empty; the per-Member
    // provider scans exactly this root (default roots excluded).
    await mkdir(join(path, 'skills'), { recursive: true })
    try {
      await writeFile(join(path, 'memory.md'), '# Member memory\n\n## Stable facts\n- Add only verified, durable facts that help future work.\n\n## Notes index\n- Add focused `notes/*.md` entries here when a reusable detail needs on-demand reading.\n', { flag: 'wx' })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }

  private async cleanupRemovedMember(member: AgentTeamAgentMember): Promise<void> {
    const results = await Promise.allSettled([
      this.ctx.workspaceRegistry.archiveSession(member.sessionId),
      rm(member.privateMemoryPath, { recursive: true, force: true }),
    ])
    const failures = results.flatMap(result => result.status === 'rejected' ? [result.reason] : [])
    if (failures.length > 0) throw new AggregateError(failures, `failed to clean up removed Member '${member.memberId}'`)
  }

  private memberStatus(member: AgentTeamAgentMember): AgentTeamAgentMemberStatus {
    if (member.state === 'inactive') return Object.freeze({ member, availability: 'inactive', presence: 'unavailable' })
    if (member.state === 'suspended') return Object.freeze({ member, availability: 'suspended', presence: 'unavailable' })
    const failures = this.memberFailures.get(member.memberId)
    if (failures?.activation !== undefined) return Object.freeze({ member, availability: 'unavailable', presence: 'unavailable', diagnostic: failures.activation })
    const handle = this.handles.get(member.memberId)
    if (handle === undefined) return Object.freeze({ member, availability: 'unavailable', presence: 'unavailable' })
    if (this.ctx.agentPresets.composedPreset(handle.agent.ctx) === undefined) {
      return Object.freeze({ member, availability: 'active', presence: 'error', diagnostic: ORPHANED_MEMBER_DIAGNOSTIC })
    }
    const runtimeError = failures?.runtime ?? failures?.compaction
    if (runtimeError !== undefined) return Object.freeze({ member, availability: 'active', presence: 'error', diagnostic: runtimeError })
    // Capability warnings are runtime-derived at activation (handles-scoped,
    // like failures): absent while capabilities resolve cleanly.
    const capabilityWarnings = this.capabilityWarnings.get(member.memberId)
    return Object.freeze({
      member, availability: 'active', presence: handle.agent.status === 'running' ? 'working' : 'available',
      ...(capabilityWarnings === undefined ? {} : { capabilityWarnings }),
    })
  }

  private setMemberFailure(memberId: AgentTeamMemberId, slot: 'activation' | 'runtime' | 'compaction', message: string): void {
    const failures = this.memberFailures.get(memberId) ?? {}
    failures[slot] = message
    this.memberFailures.set(memberId, failures)
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
    for (const memberId of ledger.affectedMembersOf(operation)) {
      const handle = this.handles.get(memberId)
      if (handle !== undefined) this.notifyMember(handle.agent)
    }
    const compactionMembers = acceptedTaskCompactionMembers(operation)
    if (compactionMembers !== undefined) this.autoCompaction.schedule(compactionMembers)
  }

  private emitAutoCompactionChanged(memberId: AgentTeamMemberId): void {
    const workspaceId = this.ledger?.getMember(memberId)?.workspaceId
    this.emitChanged(workspaceId === undefined ? undefined : [{ kind: 'workspace', workspaceId }])
  }

  /** Wake from durable unread state with bounded facts for direct and state-changing work. */
  private notifyMember(agent: Agent): void {
    const member = this.memberForAgent(agent)
    if (member === undefined || member.state !== 'enabled') return
    const notifications = this.requireLedger().notificationFacts(member.memberId, { workspaceId: member.workspaceId })
    if (notifications.length === 0) {
      this.notifiedInbox.delete(member.memberId)
      return
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
    const hint = createUserMessage({
      content: [{ type: 'text', text: this.notificationText(notifications, member.memberId) }],
      source: { kind: 'plugin', plugin: AGENT_TEAM_PLUGIN_ID, form: 'notice', summary: INBOX_NOTICE_SUMMARY },
    })
    this.notifiedInbox.set(member.memberId, signature)
    try {
      agent.steer(hint)
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
          const detail = ['Direct Team mention', `From: ${sender}`, `Channel: ${item.channelRef}`,
            ...(item.task === undefined ? [] : [`Task: ${item.task.taskRef}`]),
            `Thread: ${item.thread.threadRef}`, `Message ref: ${fact.message.messageRef}`,
            `Message: ${this.boundedNotificationBody(fact.message.body)}`].join('\n')
          if (append(detail)) detailedFactCount += 1
        } else if (fact.kind === 'activity') {
          const detail = `${this.activityNotification(fact.activity, readerId)}\nThread: ${item.thread.threadRef}`
          if (append(detail)) detailedFactCount += 1
        }
      }
      const ordinaryCount = facts.filter(entry => entry.fact.kind === 'message' && !entry.direct).length
      if (ordinaryCount > 0) {
        const route = item.task === undefined ? `Thread ${item.thread.threadRef}` : `Task ${item.task.taskRef}`
        append(`${route}: ${ordinaryCount} unread update${ordinaryCount === 1 ? '' : 's'}.`)
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
    // Early acceptance completes the reader's own open Claim inside the accept
    // operation: say so plainly, or the owner keeps working on a done Task.
    if (activity.kind === 'accept' && activity.actor === AGENT_TEAM_HUMAN_MEMBER_ID && readerId !== undefined
      && activity.completedClaimRefs?.some(claimRef => this.requireLedger().getClaim(claimRef)?.owner === readerId)) {
      return `Team Task update\n${actor} accepted Task ${activity.taskRef} and your open Claim was completed with it. No further work is needed.`
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
    this.modelSelections.delete(memberId)
    this.skillSelections.delete(memberId)
    this.releaseMemberToolPolicy(memberId)
    this.releaseMemberSkillProvider(memberId)
    this.clearMemberFailure(memberId, 'activation')
  }

  private clearMemberRecoveryState(member: Pick<AgentTeamAgentMember, 'memberId' | 'sessionId'>): void {
    this.recovery.stopTracking(member.memberId)
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
