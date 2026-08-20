/**
 * Durable Agent Team Host capability.
 *
 * The Host owns the append-only collaboration ledger and all Member lifecycle
 * effects. Session history and browser state are projections, never Team facts.
 * @module @deepseek-ai/dsh-agent-team
 */

import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { MessageId } from '@deepseek-ai/dsh-llm'
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
import { AGENT_TEAM_HUMAN_MEMBER_ID, AgentTeamLedger, agentTeamHumanActor } from './ledger.ts'
import { agentTeamDomainSpec } from './spec.ts'
import type {
  AgentTeamAddMemberRequest,
  AgentTeamAgentMember,
  AgentTeamAgentMemberStatus,
  AgentTeamChangesRequest,
  AgentTeamChangesResult,
  AgentTeamClaimList,
  AgentTeamClaimRequest,
  AgentTeamClaimResult,
  AgentTeamClientMemberStatus,
  AgentTeamCreateChannelRequest,
  AgentTeamCreateChannelResult,
  AgentTeamInbox,
  AgentTeamInboxRequest,
  AgentTeamJoinChannelRequest,
  AgentTeamJoinChannelResult,
  AgentTeamMemberActor,
  AgentTeamMemberId,
  AgentTeamMemberResult,
  AgentTeamMembersRequest,
  AgentTeamOperationReceipt,
  AgentTeamRemoveChannelMemberRequest,
  AgentTeamRemoveChannelMemberResult,
  AgentTeamRemoveMemberRequest,
  AgentTeamRemoveMemberResult,
  AgentTeamReplyRequest,
  AgentTeamReplyResult,
  AgentTeamRequestId,
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
  AgentTeamView,
  AgentTeamViewRequest,
} from './types.ts'

export { agentTeamDomainSpec, agentTeamOperationSchema } from './spec.ts'
export type * from './types.ts'
export { AGENT_TEAM_HUMAN_MEMBER_ID, AGENT_TEAM_INITIALIZE_REQUEST_ID } from './ledger.ts'

/** Process-stable marker carried by the final Team message tool definition. */
export const AGENT_TEAM_PRESET_MARKER = Symbol.for('@deepseek-ai/dsh-agent-team.preset')

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
  private readonly diagnostics = new Map<AgentTeamMemberId, string>()
  private readonly runtimeErrors = new Map<SessionId, string>()
  private readonly notifiedInbox = new Map<AgentTeamMemberId, string>()
  private readonly pendingInboxHints = new Map<AgentTeamMemberId, MessageId>()
  private lifecycleTail: Promise<void> = Promise.resolve()
  private accepting = true
  private changeVersion = 0
  private readonly changeWaiters = new Set<(version: number) => void>()

  constructor(ctx: Context) {
    super(ctx, 'agentTeam')
  }

  /** Open the durable ledger and restore every enabled Member independently. */
  protected async [Service.init](): Promise<void> {
    this.ctx.on('agent/error', ({ agent, error }) => {
      if (this.memberForAgent(agent) === undefined) return
      this.runtimeErrors.set(agent.id, error instanceof Error ? error.message : String(error))
      this.emitChanged()
    })
    this.ctx.on('agent/status', ({ agent, status }) => {
      const member = this.memberForAgent(agent)
      if (status === 'running' && member !== undefined) {
        const recovered = this.runtimeErrors.delete(agent.id)
        if (recovered) this.notifiedInbox.delete(member.memberId)
        this.emitChanged()
        this.notifyMember(agent)
      }
    })
    const clearPendingHint = (agent: Agent, messageId: MessageId): void => {
      const member = this.memberForAgent(agent)
      if (member !== undefined && this.pendingInboxHints.get(member.memberId) === messageId) this.pendingInboxHints.delete(member.memberId)
    }
    this.ctx.on('agent/inbox/claimed', ({ agent, message }) => clearPendingHint(agent, message.id))
    this.ctx.on('agent/inbox/discarded', ({ agent, message }) => clearPendingHint(agent, message.id))
    const domain = await this.ctx.storageDomain.open(agentTeamDomainSpec)
    this.ctx.effect(() => async () => {
      this.accepting = false
      this.emitChanged()
      await this.lifecycleTail
      await Promise.all([...this.handles.values()].map(handle => handle.dispose()))
      this.handles.clear()
      await domain.close()
    }, 'agentTeam.dispose')
    this.domain = domain
    const ledger = new AgentTeamLedger(domain.table('operations'))
    this.ledger = ledger
    const initialization = await ledger.initialize()
    if (initialization.committed) this.emitCommitted(initialization.value)
    for (const member of ledger.listMembers()) {
      if (member.state === 'enabled') await this.activateMember(member)
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
  async changes(request: AgentTeamChangesRequest): Promise<AgentTeamChangesResult> {
    if (!Number.isInteger(request.afterVersion) || request.afterVersion < 0) throw new Error('afterVersion must be a non-negative integer')
    if (this.changeVersion > request.afterVersion || !this.accepting) return Object.freeze({ version: this.changeVersion })
    return new Promise(resolve => {
      const waiter = (version: number): void => { clearTimeout(timeout); resolve(Object.freeze({ version })) }
      const timeout = setTimeout(() => {
        this.changeWaiters.delete(waiter)
        resolve(Object.freeze({ version: this.changeVersion }))
      }, 25_000)
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

  /** Create a durable Member and atomically grant its declared initial Channels. */
  @Remote('addMember')
  async addMember(request: AgentTeamAddMemberRequest): Promise<AgentTeamMemberResult> {
    return this.enqueueLifecycle(async () => {
      const workspace = this.requireWorkspace(request.workspaceId)
      const memberId = `member:${randomUUID()}` as AgentTeamMemberId
      const member: AgentTeamAgentMember = Object.freeze({
        memberId,
        sessionId: SessionId(`agent-team-${randomUUID()}`),
        workspaceId: request.workspaceId,
        handle: request.handle,
        description: request.description,
        presetId: request.presetId,
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
      const handle = this.handles.get(request.memberId)
      if (handle !== undefined) {
        await handle.dispose()
        this.handles.delete(request.memberId)
      }
      this.diagnostics.delete(request.memberId)
      this.clearMemberNotificationState(request.memberId)
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

  /** Irreversibly remove one Member, archive its Session, and delete its private namespace. */
  async removeMember(request: AgentTeamRemoveMemberRequest): Promise<AgentTeamRemoveMemberResult> {
    return this.enqueueLifecycle(async () => {
      const result = await this.requireLedger().removeMember({ ...request, actor: agentTeamHumanActor() })
      if (result.committed) this.emitCommitted(result.value.receipt)
      const handle = this.handles.get(request.memberId)
      if (handle !== undefined) {
        await handle.dispose()
        this.handles.delete(request.memberId)
      }
      this.diagnostics.delete(request.memberId)
      this.clearMemberNotificationState(request.memberId)
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

  /** Human-only Channel membership grant; it never injects historical Thread bodies. */
  @Remote('joinChannel')
  async joinChannel(request: AgentTeamJoinChannelRequest): Promise<AgentTeamJoinChannelResult> {
    this.requireAccepting()
    this.requireWorkspace(request.workspaceId)
    const ledger = this.requireLedger()
    if (!ledger.hasCommitted(request.requestId)) this.assertChannelMembersAvailable([request.memberId])
    const result = await ledger.joinChannel({ ...request, actor: agentTeamHumanActor() })
    if (result.committed) this.emitCommitted(result.value.receipt)
    return result.value
  }

  /** Human-only Channel membership removal and Channel-scoped cleanup. */
  @Remote('removeChannelMember')
  async removeChannelMember(request: AgentTeamRemoveChannelMemberRequest): Promise<AgentTeamRemoveChannelMemberResult> {
    this.requireAccepting()
    this.requireWorkspace(request.workspaceId)
    const result = await this.requireLedger().removeChannelMember({ ...request, actor: agentTeamHumanActor() })
    if (result.committed) this.emitCommitted(result.value.receipt)
    return result.value
  }

  /** Human top-level Task creation; unfollowed Agent mentions use the two-send result. */
  @Remote('sendMessage')
  async sendMessage(request: AgentTeamSendMessageRequest): Promise<AgentTeamSendMessageResult> {
    this.requireAccepting()
    this.requireWorkspace(request.workspaceId)
    const result = await this.requireLedger().sendMessage({ ...request, actor: agentTeamHumanActor() })
    this.emitCommittedOutcome(result)
    return result.value
  }

  /** Human existing-Thread reply; unread and revision conflicts are business outcomes. */
  @Remote('reply')
  async reply(request: AgentTeamReplyRequest): Promise<AgentTeamReplyResult> {
    this.requireAccepting()
    this.requireWorkspace(request.workspaceId)
    const result = await this.requireLedger().reply({ ...request, actor: agentTeamHumanActor() })
    this.emitCommittedOutcome(result)
    return result.value
  }

  /** Human's personal Attention operation. */
  @Remote('changeAttention')
  async changeAttention(request: AgentTeamThreadAttentionRequest): Promise<AgentTeamThreadAttentionResult> {
    this.requireAccepting()
    this.requireWorkspace(request.workspaceId)
    const result = await this.requireLedger().changeAttention({ ...request, actor: agentTeamHumanActor() })
    if (result.committed) this.emitCommitted(result.value.receipt)
    return result.value
  }

  /** Human's body-free Workspace Inbox. */
  @Remote('inbox')
  inbox(request: AgentTeamInboxRequest): AgentTeamInbox {
    this.requireWorkspace(request.workspaceId)
    return this.requireLedger().inbox(agentTeamHumanActor(), request)
  }

  /** Human's durable, atomically acknowledged Thread read. */
  @Remote('readThread')
  async readThread(request: AgentTeamThreadReadRequest): Promise<AgentTeamThreadReadResult> {
    this.requireAccepting()
    this.requireWorkspace(request.workspaceId)
    const result = await this.requireLedger().readThread({ ...request, actor: agentTeamHumanActor() })
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

  /** Agent-only top-level Task creation. Workspace identity is verified against the live binding. */
  async sendMessageForAgent(agent: Agent, request: AgentTeamSendMessageRequest): Promise<AgentTeamSendMessageResult> {
    this.requireAccepting()
    const actor = this.memberActor(agent)
    this.requireAgentWorkspace(actor, request.workspaceId)
    const result = await this.requireLedger().sendMessage({ ...request, actor })
    this.emitCommittedOutcome(result)
    return result.value
  }

  /** Agent-only existing-Thread reply. */
  async replyForAgent(agent: Agent, request: AgentTeamReplyRequest): Promise<AgentTeamReplyResult> {
    this.requireAccepting()
    const actor = this.memberActor(agent)
    this.requireAgentWorkspace(actor, request.workspaceId)
    const result = await this.requireLedger().reply({ ...request, actor })
    this.emitCommittedOutcome(result)
    return result.value
  }

  /** Agent-only personal Attention change. */
  async changeAttentionForAgent(agent: Agent, request: AgentTeamThreadAttentionRequest): Promise<AgentTeamThreadAttentionResult> {
    this.requireAccepting()
    const actor = this.memberActor(agent)
    this.requireAgentWorkspace(actor, request.workspaceId)
    const result = await this.requireLedger().changeAttention({ ...request, actor })
    if (result.committed) this.emitCommitted(result.value.receipt)
    return result.value
  }

  attentionStatusForAgent(agent: Agent, request: { workspaceId: AgentTeamViewRequest['workspaceId']; taskRef: AgentTeamTask['taskRef'] }): AgentTeamThreadAttentionStatus {
    const actor = this.memberActor(agent)
    this.requireAgentWorkspace(actor, request.workspaceId)
    return this.requireLedger().attentionStatus(actor, request)
  }

  /** Agent-only Claim mutation. */
  async changeClaimForAgent(agent: Agent, request: AgentTeamClaimRequest): Promise<AgentTeamClaimResult> {
    this.requireAccepting()
    const actor = this.memberActor(agent)
    this.requireAgentWorkspace(actor, request.workspaceId)
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
    this.requireAccepting()
    const actor = this.memberActor(agent)
    this.requireAgentWorkspace(actor, request.workspaceId)
    const result = await this.requireLedger().readThread({ ...request, actor })
    if (result.committed) this.emitCommitted(result.value.receipt)
    return result.value
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

  private memberActor(agent: Agent): AgentTeamMemberActor {
    const member = this.memberForAgent(agent)
    if (member === undefined) throw new Error('Agent is not an active Team Member')
    return Object.freeze({ kind: 'member', memberId: member.memberId, handle: member.handle })
  }

  private requireAgentWorkspace(actor: AgentTeamMemberActor, workspaceId: AgentTeamViewRequest['workspaceId']): void {
    if (this.requireLedger().getMember(actor.memberId)?.workspaceId !== workspaceId) throw new Error('Member cannot mutate another Workspace')
  }

  private async activateMember(member: AgentTeamAgentMember, knownWorkspacePath?: string): Promise<void> {
    if (this.handles.has(member.memberId)) return
    let created: AgentHandle | undefined
    try {
      const workspace = this.requireWorkspace(member.workspaceId)
      const workspacePath = knownWorkspacePath ?? workspace.path
      await this.initializePrivateMemory(member.privateMemoryPath)
      const persisted = (await this.ctx.sessionPersistence.list()).some(header => header.id === member.sessionId)
      const setup = async (agentCtx: Context) => {
        await this.ctx.agentPresets.mount(agentCtx, member.presetId)
        this.validateMemberPreset(agentCtx)
        return {
          commit: () => {
            const agent = agentCtx.agent
            if (agent === undefined) throw new Error('agent-team setup has no unpublished Agent')
            if (effectiveSandboxMode(agent.session.events) !== 'danger-full-access') setSandboxMode(agent.session, 'danger-full-access')
          },
        }
      }
      const agentOptions = this.ctx.agentDefaultModel.currentSelection()
      created = persisted
        ? await this.ctx.agents.resume({ resumeSessionId: member.sessionId, agentOptions, setup })
        : await this.ctx.agents.create({
            sessionId: member.sessionId,
            meta: { cwd: workspacePath, agentPreset: member.presetId },
            agentOptions,
            setup,
          })
      await workspace.attachSession(member.sessionId)
      this.handles.set(member.memberId, created)
      this.diagnostics.delete(member.memberId)
      this.notifyMember(created.agent)
    } catch (error) {
      await created?.dispose()
      this.diagnostics.set(member.memberId, error instanceof Error ? error.message : String(error))
    } finally {
      this.emitChanged()
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

  private async initializePrivateMemory(path: string): Promise<void> {
    await mkdir(join(path, 'notes'), { recursive: true })
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
    const diagnostic = this.diagnostics.get(member.memberId)
    if (diagnostic !== undefined) return Object.freeze({ member, availability: 'unavailable', presence: 'unavailable', diagnostic })
    const handle = this.handles.get(member.memberId)
    if (handle === undefined) return Object.freeze({ member, availability: 'unavailable', presence: 'unavailable' })
    const runtimeError = this.runtimeErrors.get(handle.agent.id)
    if (runtimeError !== undefined) return Object.freeze({ member, availability: 'active', presence: 'error', diagnostic: runtimeError })
    return Object.freeze({ member, availability: 'active', presence: handle.agent.status === 'running' ? 'working' : 'available' })
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
    this.emitChanged()
    for (const handle of this.handles.values()) this.notifyMember(handle.agent)
  }

  /** Wake only from durable unread state; the message contains no Team facts. */
  private notifyMember(agent: Agent): void {
    const member = this.memberForAgent(agent)
    if (member === undefined || member.state !== 'enabled') return
    const inbox = this.inboxForAgent(agent, { workspaceId: member.workspaceId })
    if (inbox.totalUnreadCount === 0) {
      this.notifiedInbox.delete(member.memberId)
      return
    }
    const signature = JSON.stringify(inbox.items.map(item => [
      item.thread.threadRef, item.thread.revision, item.unreadCount, item.directCount, item.newestSequence,
    ]))
    if (this.pendingInboxHints.has(member.memberId)) return
    const existingHint = [...agent.inbox.nextStep, ...agent.inbox.nextTurn].find(message =>
      message.source.kind === 'plugin' && message.source.plugin === '@deepseek-ai/dsh-agent-team')
    if (existingHint !== undefined) {
      agent.inbox.remove(existingHint.id)
      this.pendingInboxHints.set(member.memberId, existingHint.id)
      this.notifiedInbox.set(member.memberId, signature)
      agent.steer(existingHint)
      return
    }
    if (this.notifiedInbox.get(member.memberId) === signature) return
    const hint = createUserMessage({
      content: [{ type: 'text', text: 'Team Inbox has unread work. Use team_inbox to triage it, then team_thread to read the relevant Thread.' }],
      source: { kind: 'plugin', plugin: '@deepseek-ai/dsh-agent-team', form: 'notice', summary: 'Team Inbox has unread work.' },
    })
    this.pendingInboxHints.set(member.memberId, hint.id)
    this.notifiedInbox.set(member.memberId, signature)
    try {
      agent.steer(hint)
    } catch (error) {
      this.clearMemberNotificationState(member.memberId)
      throw error
    }
  }

  private clearMemberNotificationState(memberId: AgentTeamMemberId): void {
    this.notifiedInbox.delete(memberId)
    this.pendingInboxHints.delete(memberId)
  }

  private emitChanged(): void {
    this.changeVersion += 1
    for (const waiter of this.changeWaiters) waiter(this.changeVersion)
    this.changeWaiters.clear()
  }

  private enqueueLifecycle<T>(operation: () => Promise<T>): Promise<T> {
    this.requireAccepting()
    const result = this.lifecycleTail.then(operation)
    this.lifecycleTail = result.then(() => {}, () => {})
    return result
  }
}
