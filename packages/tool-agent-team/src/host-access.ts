/**
 * Shared Host accessors for every Team tool module. `agent.ctx.get` is the
 * one resolution path a tool row has — the preset mounts these tools beside
 * the Host, so a missing service or an inactive Member is a model-visible
 * rejection rather than a silent no-op. Both messages are user-facing text.
 */

import AgentTeam from '@wowyuarm/dsh-agent-team/host'

/** The Agent shape every Team tool receives. */
export type TeamToolAgent = NonNullable<Parameters<AgentTeam['memberForAgent']>[0]>

/** Resolve the Team Host service, or reject the tool call. */
export function service(agent: TeamToolAgent): AgentTeam {
  const host = agent.ctx.get('agentTeam') as AgentTeam | undefined
  if (host === undefined) throw new Error('Agent Team Host is unavailable')
  return host
}

/** Resolve the calling Team Member, or reject the tool call. */
export function member(agent: TeamToolAgent) {
  const current = service(agent).memberForAgent(agent)
  if (current === undefined) throw new Error('team tool requires an active Team Member')
  return current
}
