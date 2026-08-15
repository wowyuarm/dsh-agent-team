/**
 * Durable Agent Team host capability: authorized collaboration intents,
 * operation-ledger replay, and current projection.
 * @module @deepseek-ai/dsh-agent-team
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import { AgentTeamLedger, agentTeamHumanActor } from './ledger.ts'
import { agentTeamDomainSpec } from './spec.ts'
import type {
  AgentTeamCreateChannelRequest,
  AgentTeamCreateChannelResult,
  AgentTeamOperationReceipt,
  AgentTeamSendMessageRequest,
  AgentTeamSendMessageResult,
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
  static inject = ['storageDomain', 'workspaceRegistry']

  private domain?: Domain<typeof agentTeamDomainSpec>
  private ledger?: AgentTeamLedger

  /** Create the service; Cordis runs durable initialization before publication. */
  constructor(ctx: Context) {
    super(ctx, 'agentTeam')
  }

  /** Open or replay the ledger, initialize it once, and bind Domain teardown to this Fiber. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(agentTeamDomainSpec)
    this.ctx.effect(() => () => domain.close(), 'agentTeam.domainClose')
    this.domain = domain
    const ledger = new AgentTeamLedger(domain.table('operations'))
    this.ledger = ledger
    const initialization = await ledger.initialize()
    if (initialization.committed) {
      this.ctx.emit('agent-team/committed', { receipt: initialization.value })
    }
  }

  /**
   * Return the current Human-facing Team status without starting a model turn.
   * @returns The durable projection summary.
   */
  status(): AgentTeamStatus {
    return this.requireLedger().status()
  }

  /**
   * Resolve Human authority and create one Channel in a registered Workspace.
   * @param request - Idempotency id, Workspace, and Channel name.
   * @returns The stable Channel ref and durable operation receipt.
   */
  async createChannel(request: AgentTeamCreateChannelRequest): Promise<AgentTeamCreateChannelResult> {
    this.requireWorkspace(request.workspaceId)
    const result = await this.requireLedger().createChannel({
      ...request,
      actor: agentTeamHumanActor(),
    })
    if (result.committed) this.ctx.emit('agent-team/committed', { receipt: result.value.receipt })
    return result.value
  }

  /**
   * Resolve Human authority and send one atomic top-level Message bundle.
   * @param request - Workspace-scoped send intent.
   * @returns The Message and every derived durable fact.
   */
  async sendMessage(request: AgentTeamSendMessageRequest): Promise<AgentTeamSendMessageResult> {
    this.requireWorkspace(request.workspaceId)
    const result = await this.requireLedger().sendMessage({
      ...request,
      actor: agentTeamHumanActor(),
    })
    if (result.committed) this.ctx.emit('agent-team/committed', { receipt: result.value.receipt })
    return result.value
  }

  /**
   * Return a bounded Human-authorized Workspace view.
   * @param request - Workspace scope, optional Channel, limit, and cursor.
   * @returns Stable refs and current Thread revisions.
   */
  view(request: AgentTeamViewRequest): AgentTeamView {
    this.requireWorkspace(request.workspaceId)
    return this.requireLedger().view(request)
  }

  /** Validate the durable ledger against the current in-memory projection. */
  validateLedger(): void {
    this.requireLedger().validate()
  }

  private requireWorkspace(workspaceId: AgentTeamViewRequest['workspaceId']): void {
    if (this.ctx.workspaceRegistry.get(workspaceId) === undefined) {
      throw new Error(`unknown Workspace '${workspaceId}'`)
    }
  }

  private requireLedger(): AgentTeamLedger {
    if (this.ledger === undefined || this.domain === undefined) {
      throw new Error('agent-team service is not initialized')
    }
    return this.ledger
  }
}
