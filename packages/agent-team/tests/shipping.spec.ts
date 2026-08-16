import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentPresets from '@deepseek-ai/dsh-agent-presets'

const root = resolve(import.meta.dirname, '../../../')

describe('Agent Team shipping contract', () => {
  it('ships an opt-in Host patch and one explicit team-member preset', async () => {
    const [patch, preset, manifestText] = await Promise.all([
      readFile(resolve(root, 'cordis.patch.yml'), 'utf8'),
      readFile(resolve(root, 'agent-presets/team-member/agent.cordis.yml'), 'utf8'),
      readFile(resolve(root, 'package.json'), 'utf8'),
    ])
    expect(patch).toContain("name: '@deepseek-ai/dsh-agent-team'")
    expect(patch).toContain("name: '@deepseek-ai/dsh-command-agent-team'")
    expect(patch).toContain("name: '@deepseek-ai/dsh-agent-team/invariant'")
    expect(patch).toContain("name: '@deepseek-ai/dsh-command-agent-team/invariant'")
    expect(patch).not.toContain('dsh-tool-agent-team')

    expect(preset).toContain("name: '@deepseek-ai/dsh-tool-agent-team'")
    expect(preset).toContain('compaction: true')
    expect(preset).toContain('toolResultPruner: true')
    expect(preset).toContain('team_send, team_view, team_claim, and team_follow')
    const toolSource = await readFile(resolve(root, 'packages/tool-agent-team/src/index.ts'), 'utf8')
    expect([...toolSource.matchAll(/name: '(team_[a-z]+)'/g)].map(match => match[1])).toEqual([
      'team_send', 'team_claim', 'team_follow', 'team_view',
    ])

    const manifest = JSON.parse(manifestText) as { files: string[]; dsh: { bundle: { patch: string } } }
    expect(manifest.dsh.bundle.patch).toBe('./cordis.patch.yml')
    expect(manifest.files).toContain('agent-presets/team-member/agent.cordis.yml')

    const ctx = new Context()
    await ctx.plugin(Loader)
    await ctx.plugin(AgentPresets, { default: 'team-member',
      roots: [{ path: resolve(root, 'agent-presets'), trust: 'system' }], includeUserRoot: false })
    const roster = await ctx.agentPresets.list()
    expect(roster).toEqual([expect.objectContaining({ id: 'team-member', trust: 'system' })])
    expect(roster[0]?.broken).toBeUndefined()
    await ctx.fiber.dispose()
  })
})
