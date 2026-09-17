import type AgentTeam from '../../src/index.ts'
import type { AgentTeamChangeScope, AgentTeamChangesResult } from '../../src/types.ts'

export async function changeBaseline(team: AgentTeam, scope?: AgentTeamChangeScope): Promise<AgentTeamChangesResult> {
  for await (const item of team.changes(scope === undefined ? {} : { scope })) return item
  throw new Error('change stream ended before its baseline')
}

export async function nextChange(team: AgentTeam, scope?: AgentTeamChangeScope, signal?: AbortSignal): Promise<AgentTeamChangesResult> {
  let opening = true
  for await (const item of team.changes(scope === undefined ? {} : { scope }, signal)) {
    if (opening) { opening = false; continue }
    return item
  }
  throw new Error('change stream ended or was aborted')
}
