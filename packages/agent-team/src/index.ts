/**
 * Durable Agent Team host capability: authorized collaboration intents,
 * operation-ledger replay, and team-managed Agent lifecycles.
 * @module @deepseek-ai/dsh-agent-team
 */

import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-presets'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { scopeOf } from '@deepseek-ai/dsh-scope'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import { effectiveSandboxMode, setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-tools'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import { AgentTeamLedger, agentTeamHumanActor } from './ledger.ts'
import { agentTeamDomainSpec } from './spec.ts'
import type {
  AgentTeamAddMemberRequest,
  AgentTeamAgentMember,
  AgentTeamAgentMemberStatus,
  AgentTeamCreateChannelRequest,
  AgentTeamCreateChannelResult,
  AgentTeamMemberId,
  AgentTeamMemberResult,
  AgentTeamOperationReceipt,
  AgentTeamSendMessageRequest,
  AgentTeamSendMessageResult,
  AgentTeamSetMemberStateRequest,
  AgentTeamStatus,
  AgentTeamView,
  AgentTeamViewRequest,
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
export default class AgentTeam extends Service {
  static inject = [
    'storageDomain',
    'workspaceRegistry',
    'agents',
    'agentPresets',
    'tools',
    'sessionPersistence',
  ]

  private domain?: Domain<typeof agentTeamDomainSpec>
  private ledger?: AgentTeamLedger
  private readonly handles = new Map<AgentTeamMemberId, AgentHandle>()
  private readonly diagnostics = new Map<AgentTeamMemberId, string>()
  private lifecycleTail: Promise<void> = Promise.resolve()
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
      return Object.freeze({ receipt: result.value.receipt, status: this.memberStatus(result.value.member) })
    })
  }

  /** Resolve Human authority and send one atomic top-level Message bundle. */
  async sendMessage(request: AgentTeamSendMessageRequest): Promise<AgentTeamSendMessageResult> {
    this.requireAccepting()
    this.requireWorkspace(request.workspaceId)
    const result = await this.requireLedger().sendMessage({ ...request, actor: agentTeamHumanActor() })
    if (result.committed) this.emitCommitted(result.value.receipt)
    return result.value
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
      created = persisted
        ? await this.ctx.agents.resume({ resumeSessionId: member.sessionId, setup })
        : await this.ctx.agents.create({
            sessionId: member.sessionId,
            meta: { cwd: workspacePath, agentPreset: member.presetId },
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
