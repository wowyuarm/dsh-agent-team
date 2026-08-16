/**
 * Durable Agent Team host capability: authorized collaboration intents,
 * operation-ledger replay, and team-managed Agent lifecycles.
 * @module @deepseek-ai/dsh-agent-team
 */

import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import { freezeMessage } from '@deepseek-ai/dsh-llm'
import type { MessageId } from '@deepseek-ai/dsh-llm'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
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
import { AGENT_TEAM_HUMAN_MEMBER_ID, AgentTeamLedger, agentTeamHostActor, agentTeamHumanActor } from './ledger.ts'
import { agentTeamDomainSpec } from './spec.ts'
import type {
  AgentTeamActivity,
  AgentTeamAddMemberRequest,
  AgentTeamAgentMember,
  AgentTeamAgentMemberStatus,
  AgentTeamMembersRequest,
  AgentTeamCreateChannelRequest,
  AgentTeamClaimList,
  AgentTeamClaimRequest,
  AgentTeamConfirmationRequired,
  AgentTeamClaimResult,
  AgentTeamCreateChannelResult,
  AgentTeamDelivery,
  AgentTeamJoinChannelRequest,
  AgentTeamJoinChannelResult,
  AgentTeamFollowRequest,
  AgentTeamFollowResult,
  AgentTeamFollowStatus,
  AgentTeamMemberActor,
  AgentTeamMemberId,
  AgentTeamMemberResult,
  AgentTeamRemoveMemberRequest,
  AgentTeamRemoveMemberResult,
  AgentTeamOperationReceipt,
  AgentTeamReplyRequest,
  AgentTeamReplyResult,
  AgentTeamSendMessageRequest,
  AgentTeamSendMessageResult,
  AgentTeamSetMemberStateRequest,
  AgentTeamStatus,
  AgentTeamView,
  AgentTeamViewRequest,
  AgentTeamMessage,
  AgentTeamTask,
  AgentTeamTaskRequest,
  AgentTeamTaskResult,
} from './types.ts'

export { agentTeamDomainSpec, agentTeamOperationSchema } from './spec.ts'
export type * from './types.ts'

export {
  AGENT_TEAM_HUMAN_MEMBER_ID,
  AGENT_TEAM_INITIALIZE_REQUEST_ID,
} from './ledger.ts'

/** Process-stable marker carried by the team_send definition in a team-enabled preset. */
export const AGENT_TEAM_PRESET_MARKER = Symbol.for('@deepseek-ai/dsh-agent-team.preset')

/** Mark the preset's team_send definition as an Agent Team consumer. */
export function markAgentTeamPreset<T extends object>(definition: T): T {
  Object.defineProperty(definition, AGENT_TEAM_PRESET_MARKER, { value: true })
  return definition
}

/** Model-facing capabilities every team-enabled preset must publish. */
export const AGENT_TEAM_TOOL_NAMES = Object.freeze([
  'team_send',
  'team_view',
  'team_claim',
  'team_follow',
] as const)

/** Data emitted after one new Team operation has become durable and projected. */
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'agent-team-relay': {
      readonly kind: 'agent-team-relay'
      readonly form: 'relay'
      readonly sender: AgentTeamMemberId
      readonly channelRef: import('./types.ts').AgentTeamChannelRef
      readonly taskRef: import('./types.ts').AgentTeamTaskRef
      readonly messageRef: import('./types.ts').AgentTeamMessageRef
      readonly revision: number
    }
    'agent-team-activity': {
      readonly kind: 'agent-team-activity'
      readonly form: 'notice'
      readonly summary: string
      readonly actor: { readonly memberId: AgentTeamMemberId; readonly handle: string }
      readonly activityRef: import('./types.ts').AgentTeamActivityRef
      readonly channelRef: import('./types.ts').AgentTeamChannelRef
      readonly taskRef: import('./types.ts').AgentTeamTaskRef
      readonly revision: number
    }
  }
}

export interface AgentTeamCommitted {
  readonly receipt: AgentTeamOperationReceipt
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    agentTeam: AgentTeam
  }

  interface Events {
    /**
     * One new Agent Team operation is durable and visible through the projection.
     * @param event - Committed operation receipt.
     * @mode emit
     */
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
    'sessions',
    'sessionPersistence',
  ]

  private domain?: Domain<typeof agentTeamDomainSpec>
  private ledger?: AgentTeamLedger
  private readonly handles = new Map<AgentTeamMemberId, AgentHandle>()
  private readonly diagnostics = new Map<AgentTeamMemberId, string>()
  private lifecycleTail: Promise<void> = Promise.resolve()
  private deliveryTail: Promise<void> = Promise.resolve()
  private accepting = true

  /** Create the service; Cordis runs durable initialization before publication. */
  constructor(ctx: Context) {
    super(ctx, 'agentTeam')
  }

  /** Open the ledger, bind teardown, and restore every enabled Member independently. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(agentTeamDomainSpec)
    this.ctx.effect(() => async () => {
      this.accepting = false
      await this.lifecycleTail
      await this.deliveryTail
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
    }
    await this.recoverDeliveries()
  }

  /** Resolve one exact live Agent to its Team Member; forks and bare sessions do not inherit identity. */
  memberForAgent(agent: Agent): AgentTeamAgentMember | undefined {
    for (const [memberId, handle] of this.handles) {
      if (handle.agent !== agent) continue
      return this.requireLedger().getMember(memberId)
    }
    return undefined
  }

  /** Return every durable Member with current process availability. */
  members(): readonly AgentTeamAgentMemberStatus[] {
    return this.requireLedger().listMembers().map(member => this.memberStatus(member))
  }

  /** Return only the current Workspace's members to the Client projection. */
  @Remote('members')
  membersForClient(request: AgentTeamMembersRequest): readonly AgentTeamAgentMemberStatus[] {
    return this.members().filter(status => status.member.workspaceId === request.workspaceId)
  }

  /** Return the current Human-facing Team status without starting a model turn. */
  status(): AgentTeamStatus {
    return this.requireLedger().status()
  }

  /** Resolve Human authority and create one Channel in a registered Workspace. */
  async createChannel(request: AgentTeamCreateChannelRequest): Promise<AgentTeamCreateChannelResult> {
    this.requireAccepting()
    this.requireWorkspace(request.workspaceId)
    const result = await this.requireLedger().createChannel({ ...request, actor: agentTeamHumanActor() })
    if (result.committed) this.emitCommitted(result.value.receipt)
    return result.value
  }

  /** Provision one durable Member, then publish its Agent only after preset validation succeeds. */
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
      const result = await this.requireLedger().addMember({
        ...request,
        actor: agentTeamHumanActor(),
        member,
      })
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
      return Object.freeze({ receipt: result.value.receipt, status: this.memberStatus(result.value.member) })
    })
  }

  /** Commit enabled intent and restore the exact persisted session. */
  async resumeMember(request: AgentTeamSetMemberStateRequest): Promise<AgentTeamMemberResult> {
    return this.enqueueLifecycle(async () => {
      const result = await this.requireLedger().resumeMember({ ...request, actor: agentTeamHumanActor() })
      if (result.committed) this.emitCommitted(result.value.receipt)
      await this.activateMember(result.value.member)
      await this.recoverDeliveries()
      return Object.freeze({ receipt: result.value.receipt, status: this.memberStatus(result.value.member) })
    })
  }

  /** Irreversibly remove one Member, quiesce its Agent, and archive its session. */
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
      await this.ctx.workspaceRegistry.archiveSession(result.value.member.sessionId)
      return result.value
    })
  }

  /** Accept, close, or reopen one Task as the Human authority. */
  async changeTask(request: AgentTeamTaskRequest): Promise<AgentTeamTaskResult> {
    this.requireAccepting()
    this.requireWorkspace(request.workspaceId)
    const result = await this.requireLedger().changeTask({ ...request, actor: agentTeamHumanActor() })
    if (result.committed) this.emitCommitted(result.value.receipt)
    await Promise.all(result.value.deliveries.map(delivery => this.admitDelivery(delivery)))
    return Object.freeze({ ...result.value, deliveries: Object.freeze(result.value.deliveries.map(delivery =>
      this.requireLedger().getDelivery(delivery.deliveryId) ?? delivery)) })
  }

  /** Add one Agent Member to a Channel without replaying historical Messages. */
  async joinChannel(request: AgentTeamJoinChannelRequest): Promise<AgentTeamJoinChannelResult> {
    this.requireAccepting()
    this.requireWorkspace(request.workspaceId)
    const result = await this.requireLedger().joinChannel({ ...request, actor: agentTeamHumanActor() })
    if (result.committed) this.emitCommitted(result.value.receipt)
    return result.value
  }

  /** Resolve Human authority and send one atomic top-level Message bundle. */
  async sendMessage(request: AgentTeamSendMessageRequest): Promise<AgentTeamSendMessageResult> {
    this.requireAccepting()
    this.requireWorkspace(request.workspaceId)
    const result = await this.requireLedger().sendMessage({ ...request, actor: agentTeamHumanActor() })
    if (result.committed) this.emitCommitted(result.value.receipt)
    await Promise.all(result.value.deliveries.map(delivery => this.admitDelivery(delivery)))
    return Object.freeze({
      ...result.value,
      deliveries: Object.freeze(result.value.deliveries.map(delivery =>
        this.requireLedger().getDelivery(delivery.deliveryId) ?? delivery)),
    })
  }

  /** Append one revision-fenced Thread reply from the exact live Agent Member. */
  async replyForAgent(agent: Agent, request: AgentTeamReplyRequest): Promise<AgentTeamReplyResult | AgentTeamConfirmationRequired> {
    this.requireAccepting()
    const actor = this.memberActor(agent)
    const result = await this.requireLedger().reply({ ...request, actor })
    if (result.value.kind === 'confirmation_required') return result.value
    if (result.committed) this.emitCommitted(result.value.receipt)
    await Promise.all(result.value.deliveries.map(delivery => this.admitDelivery(delivery)))
    return Object.freeze({ ...result.value, deliveries: Object.freeze(result.value.deliveries.map(delivery =>
      this.requireLedger().getDelivery(delivery.deliveryId) ?? delivery)) })
  }

  /** Change one Thread Follow as the exact live Agent Member. */
  async changeFollowForAgent(agent: Agent, request: AgentTeamFollowRequest): Promise<AgentTeamFollowResult> {
    this.requireAccepting()
    const result = await this.requireLedger().changeFollow({ ...request, actor: this.memberActor(agent) })
    if (result.committed) this.emitCommitted(result.value.receipt)
    await Promise.all(result.value.deliveries.map(delivery => this.admitDelivery(delivery)))
    return Object.freeze({ ...result.value, deliveries: Object.freeze(result.value.deliveries.map(delivery =>
      this.requireLedger().getDelivery(delivery.deliveryId) ?? delivery)) })
  }

  followStatusForAgent(agent: Agent, request: {
    workspaceId: AgentTeamViewRequest['workspaceId']
    taskRef: AgentTeamTask['taskRef']
  }): AgentTeamFollowStatus {
    return this.requireLedger().followStatus(this.memberActor(agent), request)
  }

  /** Mutate one Direction Claim as the exact live Agent Member. */
  async changeClaimForAgent(agent: Agent, request: AgentTeamClaimRequest): Promise<AgentTeamClaimResult> {
    this.requireAccepting()
    const actor = this.memberActor(agent)
    const result = await this.requireLedger().changeClaim({ ...request, actor })
    if (result.committed) this.emitCommitted(result.value.receipt)
    await Promise.all(result.value.deliveries.map(delivery => this.admitDelivery(delivery)))
    return Object.freeze({ ...result.value, deliveries: Object.freeze(result.value.deliveries.map(delivery =>
      this.requireLedger().getDelivery(delivery.deliveryId) ?? delivery)) })
  }

  /** List complete Claim history for one Task authorized by the exact live Member. */
  listClaimsForAgent(agent: Agent, request: { workspaceId: AgentTeamViewRequest['workspaceId']; taskRef: AgentTeamTask['taskRef'] }): AgentTeamClaimList {
    return this.requireLedger().listClaims(this.memberActor(agent), request)
  }

  /** Return a bounded view authorized by the exact live Agent identity. */
  viewForAgent(agent: Agent, request: AgentTeamViewRequest): AgentTeamView {
    const member = this.memberForAgent(agent)
    if (member === undefined) throw new Error('Agent is not an active Team Member')
    return this.requireLedger().view(request, member.memberId)
  }

  /** Return a bounded Human-authorized Workspace view. */
  view(request: AgentTeamViewRequest): AgentTeamView {
    this.requireWorkspace(request.workspaceId)
    return this.requireLedger().view(request)
  }

  /** Validate the durable ledger against the current in-memory projection. */
  validateLedger(): void {
    this.requireLedger().validate()
  }

  /** Prove every admitted Delivery still has matching target-session evidence. */
  async validateDeliveryEvidence(): Promise<void> {
    for (const delivery of this.requireLedger().listDeliveries()) {
      if (delivery.state !== 'admitted') continue
      const member = this.requireLedger().getMember(delivery.recipient)
      if (member === undefined) throw new Error(`Delivery '${delivery.deliveryId}' has no target Member`)
      const live = this.ctx.agents.get(member.sessionId)
      const events = live?.session.events ?? (await this.ctx.sessionPersistence.inspect(member.sessionId)).events
      if (!this.eventsContainMessage(events, delivery.messageId)) {
        throw new Error(`admitted Delivery '${delivery.deliveryId}' has no target-session evidence`)
      }
    }
  }

  private memberActor(agent: Agent): AgentTeamMemberActor {
    const member = this.memberForAgent(agent)
    if (member === undefined) throw new Error('Agent is not an active Team Member')
    return Object.freeze({ kind: 'member', memberId: member.memberId, handle: member.handle })
  }

  private async recoverDeliveries(): Promise<void> {
    for (const delivery of this.requireLedger().queuedDeliveries()) await this.admitDelivery(delivery)
  }

  private admitDelivery(delivery: AgentTeamDelivery): Promise<void> {
    const result = this.deliveryTail.then(() => this.admitDeliveryCore(delivery))
    this.deliveryTail = result.then(() => {}, () => {})
    return result
  }

  private async admitDeliveryCore(delivery: AgentTeamDelivery): Promise<void> {
    const member = this.requireLedger().getMember(delivery.recipient)
    const handle = this.handles.get(delivery.recipient)
    const message = this.requireLedger().messageForDelivery(delivery.deliveryId)
    const activity = this.requireLedger().activityForDelivery(delivery.deliveryId)
    if (member?.state !== 'enabled' || handle === undefined || (message === undefined && activity === undefined)) return
    let evidence = this.deliveryEvidence(handle.agent, delivery.messageId)
    if (evidence === undefined) {
      const relay = message === undefined
        ? this.activityMessage(activity!, delivery.messageId)
        : this.relayMessage(message, delivery.messageId)
      handle.agent.send(relay, 'next-step', true)
      evidence = this.deliveryEvidence(handle.agent, delivery.messageId)
    }
    if (evidence === undefined) throw new Error(`Delivery '${delivery.deliveryId}' has no Inbox evidence`)
    const durable = await this.ctx.sessions.flush(handle.agent.session)
    if (!durable) throw new Error(`Delivery '${delivery.deliveryId}' has no session persistence durability barrier`)
    const result = await this.requireLedger().admitDelivery({
      requestId: `agent-team:admit:${delivery.deliveryId}` as import('./types.ts').AgentTeamRequestId,
      actor: agentTeamHostActor(),
      deliveryId: delivery.deliveryId,
      evidence,
    })
    if (result.committed) this.emitCommitted(result.value)
  }

  private eventsContainMessage(events: readonly { readonly type: string; readonly data: unknown }[], messageId: MessageId): boolean {
    return events.some((event) => {
      if (event.type === 'user/message') return (event.data as { id?: unknown }).id === messageId
      if (event.type !== 'agent/inbox/spliced') return false
      const inserted = (event.data as { inserted?: readonly { id?: unknown }[] }).inserted
      return inserted?.some(message => message.id === messageId) === true
    })
  }

  private deliveryEvidence(agent: Agent, messageId: MessageId): 'agent/inbox/spliced' | 'user/message' | undefined {
    for (const event of agent.session.events) {
      if (event.type === 'agent/inbox/spliced' && event.data.inserted.some(message => message.id === messageId)) {
        return 'agent/inbox/spliced'
      }
      if (event.type === 'user/message' && event.data.id === messageId) return 'user/message'
    }
    return undefined
  }

  private activityMessage(activity: AgentTeamActivity, messageId: MessageId) {
    const ledger = this.requireLedger()
    const task = ledger.getTask(activity.taskRef)
    const member = ledger.getMember(activity.actor)
    const actor = member === undefined && activity.actor === AGENT_TEAM_HUMAN_MEMBER_ID
      ? { memberId: AGENT_TEAM_HUMAN_MEMBER_ID, handle: 'human' } : member
    if (task === undefined || actor === undefined) throw new Error(`Activity '${activity.activityRef}' has an incomplete projection`)
    const summary = activity.kind === 'claim' || activity.kind === 'done' || activity.kind === 'release'
      ? `${actor.handle} ${activity.kind} Claim ${activity.claimRef}`
      : `${actor.handle} ${activity.kind} Thread ${activity.threadRef}`
    return freezeMessage({
      id: messageId,
      role: 'user' as const,
      content: [{ type: 'text' as const, text: `${summary} on Task ${activity.taskRef}.` }],
      source: {
        kind: 'agent-team-activity' as const,
        form: 'notice' as const,
        summary,
        actor: { memberId: actor.memberId, handle: actor.handle },
        activityRef: activity.activityRef,
        channelRef: task.channelRef,
        taskRef: task.taskRef,
        revision: activity.sequence,
      },
    })
  }

  private relayMessage(message: AgentTeamMessage, messageId: MessageId) {
    return freezeMessage({
      id: messageId,
      role: 'user' as const,
      content: [{ type: 'text' as const, text: message.body }],
      source: {
        kind: 'agent-team-relay' as const,
        form: 'relay' as const,
        sender: message.sender,
        channelRef: message.channelRef,
        taskRef: message.taskRef,
        messageRef: message.messageRef,
        revision: message.sequence,
      },
    })
  }

  private async activateMember(member: AgentTeamAgentMember, knownWorkspacePath?: string): Promise<void> {
    if (this.handles.has(member.memberId)) return
    let created: AgentHandle | undefined
    try {
      const workspace = this.requireWorkspace(member.workspaceId)
      const workspacePath = knownWorkspacePath ?? workspace.path
      await this.initializePrivateMemory(member.privateMemoryPath)
      const persisted = (await this.ctx.sessionPersistence.list())
        .some(header => header.id === member.sessionId)
      const setup = async (agentCtx: Context) => {
        await this.ctx.agentPresets.mount(agentCtx, member.presetId)
        this.validateMemberPreset(agentCtx)
        return {
          commit: () => {
            const agent = agentCtx.agent
            if (agent === undefined) throw new Error('agent-team setup has no unpublished Agent')
            if (effectiveSandboxMode(agent.session.events) !== 'danger-full-access') {
              setSandboxMode(agent.session, 'danger-full-access')
            }
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
    } catch (error) {
      await created?.dispose()
      this.diagnostics.set(member.memberId, error instanceof Error ? error.message : String(error))
    }
  }

  private validateMemberPreset(agentCtx: Context): void {
    const scope = scopeOf(agentCtx)
    const teamSend = this.ctx.tools.get('team_send', scope)
    if ((teamSend as Record<PropertyKey, unknown> | undefined)?.[AGENT_TEAM_PRESET_MARKER] !== true) {
      throw new Error('selected preset is not team-enabled')
    }
    const available = new Set(this.ctx.tools.schemas(scope).map(tool => tool.name))
    const missing = AGENT_TEAM_TOOL_NAMES.filter(name => !available.has(name))
    if (missing.length > 0) throw new Error(`team-enabled preset is missing tools: ${missing.join(', ')}`)
  }

  private async initializePrivateMemory(path: string): Promise<void> {
    await mkdir(join(path, 'notes'), { recursive: true })
    try {
      await writeFile(join(path, 'memory.md'), '', { flag: 'wx' })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }

  private memberStatus(member: AgentTeamAgentMember): AgentTeamAgentMemberStatus {
    if (member.state === 'inactive') return Object.freeze({ member, availability: 'inactive' })
    if (member.state === 'suspended') return Object.freeze({ member, availability: 'suspended' })
    const diagnostic = this.diagnostics.get(member.memberId)
    if (diagnostic !== undefined) return Object.freeze({ member, availability: 'unavailable', diagnostic })
    return Object.freeze({ member, availability: this.handles.has(member.memberId) ? 'active' : 'unavailable' })
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
  }

  private enqueueLifecycle<T>(operation: () => Promise<T>): Promise<T> {
    this.requireAccepting()
    const result = this.lifecycleTail.then(operation)
    this.lifecycleTail = result.then(() => {}, () => {})
    return result
  }
}
