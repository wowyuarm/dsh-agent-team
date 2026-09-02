/**
 * Per-Member runtime state extracted from the Agent Team Host service: the
 * cohesive per-Member maps and methods that must dispose together across
 * activation, edit, suspend, and removal — the tool-policy restriction seam,
 * the private skill selection/provider mounts, capability warnings, and
 * private-memory provisioning.
 *
 * This class is Host-side by design: its turn-boundary wait subscribes to
 * Host-level agent events, and every traceable-service registration goes
 * through contexts the Host already owns. The service keeps orchestration
 * (ledger, handles, notifications, recovery); this module owns per-Member
 * runtime invariants.
 *
 * @module @wowyuarm/dsh-agent-team/member-runtime
 */

import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import { scopeOf } from '@deepseek-ai/dsh-scope'
import type {
  AgentTeamAgentMember,
  AgentTeamCapabilityWarning,
  AgentTeamMemberCapabilities,
  AgentTeamMemberId,
} from './types.ts'
import * as memberSkills from './member-skills.ts'
import type { MemberSkillSelectionRef } from './member-skills.ts'

/**
 * Read-only core skills shipped beside the preset (the meta skill first:
 * its description routes any skill-management work to itself). Resolved
 * from this module's emitted location so it follows the installed plugin,
 * like the preset roster's own root.
 */
const BUNDLED_SKILLS_DIRECTORY = resolve(dirname(fileURLToPath(import.meta.url)), '../core-skills')

/** Model-facing capabilities every Team-enabled preset must publish. */
export const AGENT_TEAM_TOOL_NAMES = Object.freeze([
  'team_inbox',
  'team_thread',
  'team_message',
  'team_claim',
  'team_view',
] as const)

/** Copy a Remote-supplied capability overlay into owned frozen storage. */
export function deepCopyCapabilities(capabilities: AgentTeamMemberCapabilities): AgentTeamMemberCapabilities {
  const copyAllow = (allow: readonly string[] | undefined): { allow?: readonly string[] } =>
    allow === undefined ? {} : { allow: [...allow] }
  return {
    ...(capabilities.tools === undefined ? {} : { tools: copyAllow(capabilities.tools.allow) }),
    ...(capabilities.skills === undefined ? {} : { skills: copyAllow(capabilities.skills.allow) }),
  }
}

/** Everything the runtime needs from its owning Host service. */
export interface MemberRuntimeDeps {
  /** Host context for agent events, tool schemas, and the workspace registry. */
  readonly ctx: Context
  /** Resolve one Member's live agent context, or throw when it has none. */
  readonly liveMemberContext: (memberId: AgentTeamMemberId) => Context
  /** Agent ids with a turn in flight; shared by reference with the service. */
  readonly runningAgents: ReadonlySet<SessionId>
}

/** Per-Member runtime state; the four maps dispose together with each Member. */
export class MemberRuntime {
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
  /** Live skill selection refs let capability edits re-filter the catalog without disposing the Session. */
  private readonly skillSelections = new Map<AgentTeamMemberId, MemberSkillSelectionRef>()
  /** Per-Member private skill provider disposers; released with the Member's agent scope. */
  private readonly skillProviderDisposals = new Map<AgentTeamMemberId, () => void>()

  constructor(private readonly deps: MemberRuntimeDeps) {}

  /** One Member's live capability warnings, if any; runtime-derived, never persisted. */
  capabilityWarningsFor(memberId: AgentTeamMemberId): readonly AgentTeamCapabilityWarning[] | undefined {
    return this.capabilityWarnings.get(memberId)
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
  applyMemberToolPolicy(agentCtx: Context, member: AgentTeamAgentMember): void {
    const configured = member.capabilities?.tools?.allow
    if (configured === undefined) {
      this.capabilityWarnings.delete(member.memberId)
      return
    }
    // Drop names the current surface does not know rather than failing the
    // activation: a Harness upgrade renaming a tool must not make the Member
    // unavailable. The warning carries the known-name digest so a distant
    // future reader can diagnose the drift.
    const known = this.deps.ctx.tools.schemas(scopeOf(agentCtx)).map(tool => tool.name)
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
  reapplyMemberToolPolicy(member: AgentTeamAgentMember): void {
    this.releaseMemberToolPolicy(member.memberId)
    this.applyMemberToolPolicy(this.deps.liveMemberContext(member.memberId), member)
  }

  /** Release one Member's restriction disposer and warning state; safe to call twice. */
  releaseMemberToolPolicy(memberId: AgentTeamMemberId): void {
    const dispose = this.memberRestrictions.get(memberId)
    if (dispose !== undefined) {
      this.memberRestrictions.delete(memberId)
      dispose()
    }
    this.capabilityWarnings.delete(memberId)
  }

  private setCapabilityWarnings(memberId: AgentTeamMemberId, warnings: readonly AgentTeamCapabilityWarning[]): void {
    if (warnings.length === 0) this.capabilityWarnings.delete(memberId)
    else this.capabilityWarnings.set(memberId, Object.freeze([...warnings]))
  }

  /**
   * Wait until one live Member's current turn ends or its Session is
   * disposed. While the Agent runs, the current turn keeps its schemas and
   * catalog; the swap happens once idle, so the next step recomputes schemas
   * from the new restriction and the durable replacement skill catalog from
   * the new selection, with the same Session and history surviving.
   * Suspend/remove during the wait resolves it — the disposed handle released
   * the old restriction already and no disposer leaks. Returns whether any
   * wait happened, so the caller can re-check the handle afterwards.
   */
  async awaitTurnBoundary(active: AgentHandle): Promise<boolean> {
    if (!this.deps.runningAgents.has(active.agent.id)) return false
    await new Promise<void>(resolve => {
      const disposers: Array<() => void> = []
      const settle = (): void => {
        for (const dispose of disposers.splice(0)) dispose()
        resolve()
      }
      disposers.push(
        this.deps.ctx.on('agent/status', (payload: { agent: Agent; status: string }) => {
          if (payload.agent !== active.agent) return
          // A turn that ends — clean idle or error — is the boundary; the
          // next step recomputes schemas from the new restriction.
          if (payload.status !== 'running') settle()
        }),
        // Disposal (suspend/remove/reactivation) resolves the wait: the old
        // restriction went with the disposed scope, so only the ledger
        // intent remains to apply at the next activation.
        this.deps.ctx.on('session/disposed', (session: { id: SessionId }) => {
          if (session.id === active.agent.session.id) settle()
        }),
      )
    })
    return true
  }

  /**
   * Register the Member-private skill provider on the created agent's exact
   * scope layer (the traceable-service seam, like the tool restriction):
   * bundled read-only core skills plus this Member's own private directory,
   * with the live selection ref that later capability edits swap in place.
   */
  mountMemberSkillProvider(member: AgentTeamAgentMember, agentCtx: Context, selection: MemberSkillSelectionRef): void {
    this.skillProviderDisposals.set(member.memberId, memberSkills.mountMemberSkillProvider(agentCtx, {
      skillsDirectory: join(member.privateMemoryPath, 'skills'),
      bundledSkillsDirectory: BUNDLED_SKILLS_DIRECTORY,
      selection,
    }))
    this.skillSelections.set(member.memberId, selection)
  }

  /** Live-apply a capability edit to a registered selection; a no-op when none exists. */
  swapSkillSelection(memberId: AgentTeamMemberId, allow: readonly string[] | undefined): void {
    this.skillSelections.get(memberId)?.swap(allow)
  }

  /**
   * Provision one Member's private memory namespace: notes/, skills/, and a
   * first-run memory.md scaffold. The Member-private skills directory starts
   * empty; the per-Member provider scans exactly this root (default roots
   * excluded).
   */
  async initializePrivateMemory(path: string): Promise<void> {
    await mkdir(join(path, 'notes'), { recursive: true })
    await mkdir(join(path, 'skills'), { recursive: true })
    try {
      await writeFile(join(path, 'memory.md'), '# Member memory\n\n## Stable facts\n- Add only verified, durable facts that help future work.\n\n## Notes index\n- Add focused `notes/*.md` entries here when a reusable detail needs on-demand reading.\n', { flag: 'wx' })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }

  /** Irreversibly remove one Member: archive its Session and delete its private namespace. */
  async cleanupRemovedMember(member: AgentTeamAgentMember): Promise<void> {
    const results = await Promise.allSettled([
      this.deps.ctx.workspaceRegistry.archiveSession(member.sessionId),
      rm(member.privateMemoryPath, { recursive: true, force: true }),
    ])
    const failures = results.flatMap(result => result.status === 'rejected' ? [result.reason] : [])
    if (failures.length > 0) throw new AggregateError(failures, `failed to clean up removed Member '${member.memberId}'`)
  }

  /** Drop one Member's transient selection/disposer state after its handle is gone; safe to call twice. */
  forgetMember(memberId: AgentTeamMemberId): void {
    this.skillSelections.delete(memberId)
    const providerDispose = this.skillProviderDisposals.get(memberId)
    if (providerDispose !== undefined) {
      this.skillProviderDisposals.delete(memberId)
      providerDispose()
    }
    this.releaseMemberToolPolicy(memberId)
  }

  /** Dispose every registered per-Member seam; service shutdown only. */
  disposeAll(): void {
    this.skillSelections.clear()
    for (const dispose of this.skillProviderDisposals.values()) dispose()
    this.skillProviderDisposals.clear()
    for (const dispose of this.memberRestrictions.values()) dispose()
    this.memberRestrictions.clear()
    this.capabilityWarnings.clear()
  }
}
