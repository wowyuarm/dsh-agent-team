import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import AgentPresets from '@deepseek-ai/dsh-agent-presets'

export const inject = ['loader']

/** Bundle-private Agent preset roster. The composition must isolate `agentPresets` around this provider and AgentTeam. */
export function apply(ctx: Context): void {
  const here = dirname(fileURLToPath(import.meta.url))
  const root = resolve(here, '../preset')
  ctx.plugin(AgentPresets, {
    default: 'team-member',
    roots: [{ path: root, trust: 'system' }],
    includeShippedRoot: false,
    includeUserRoot: false,
  })
}
