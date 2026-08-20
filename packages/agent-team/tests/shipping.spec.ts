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
      readFile(resolve(root, 'packages/agent-team/preset/team-member/agent.cordis.yml'), 'utf8'),
      readFile(resolve(root, 'package.json'), 'utf8'),
    ])
    expect(patch).toContain("name: '@deepseek-ai/dsh-agent-team/preset-roster'")
    expect(patch).toContain('agentPresets: true')
    expect(patch).toContain("name: '@deepseek-ai/dsh-agent-team'")
    expect(patch).toContain("name: '@deepseek-ai/dsh-command-agent-team'")
    expect(patch).toContain("name: '@deepseek-ai/dsh-client-agent-team'")
    expect(patch).toContain("name: '@deepseek-ai/dsh-agent-team/invariant'")
    expect(patch).toContain("name: '@deepseek-ai/dsh-command-agent-team/invariant'")
    expect(patch).not.toContain('dsh-tool-agent-team')

    expect(preset).toContain("name: '@deepseek-ai/dsh-tool-agent-team'")
    expect(preset).toContain("name: '@deepseek-ai/dsh-agent-team/member-context'")
    for (const capability of [
      '@deepseek-ai/dsh-tool-bash', '@deepseek-ai/dsh-tool-pwsh', '@deepseek-ai/dsh-tool-fs',
      '@deepseek-ai/dsh-tool-fs-search', '@deepseek-ai/dsh-tool-jobs', '@deepseek-ai/dsh-skill-filesystem',
      '@deepseek-ai/dsh-tool-skill', '@deepseek-ai/dsh-tool-todo', '@deepseek-ai/dsh-tool-web',
    ]) expect(preset).toContain(`name: '${capability}'`)
    const hostManifest = JSON.parse(await readFile(resolve(root, 'packages/agent-team/package.json'), 'utf8')) as {
      peerDependencies: Record<string, string>
    }
    expect(hostManifest.peerDependencies['@deepseek-ai/dsh-tool-web']).toBe('>=0.1.0-rc.5 <0.2.0')
    expect(preset).toContain('compaction: true')
    expect(preset).toContain('toolResultPruner: true')
    expect(preset).toContain('team_inbox, team_thread, team_message, team_claim, and team_view')
    const toolSource = await readFile(resolve(root, 'packages/tool-agent-team/src/index.ts'), 'utf8')
    expect([...toolSource.matchAll(/name: '(team_[a-z]+)'/g)].map(match => match[1])).toEqual([
      'team_inbox', 'team_thread', 'team_message', 'team_claim', 'team_view',
    ])

    const manifest = JSON.parse(manifestText) as {
      files: string[]
      dependencies: Record<string, string>
      dsh: { bundle: { patch: string } }
    }
    expect(manifest.dsh.bundle.patch).toBe('./cordis.patch.yml')
    expect(manifest.files).toContain('packages/*/preset/**/*')
    expect(manifest.files).toContain('packages/*/lib/**/*')
    expect(Object.values(manifest.dependencies)).toEqual([
      'workspace:^', 'workspace:^', 'workspace:^', 'workspace:^',
    ])

    const clientManifest = JSON.parse(await readFile(resolve(root, 'packages/client-agent-team/package.json'), 'utf8')) as {
      exports: Record<string, { default?: string }>
      dsh: { client: { platform: string; immediately?: boolean } }
      peerDependencies: Record<string, string>
    }
    expect(clientManifest.dsh.client).toEqual({
      platform: 'web',
      inject: expect.not.arrayContaining(['@deepseek-ai/dsh-agent-team']),
    })
    expect(clientManifest.exports['./client']?.default).toBe('./lib/client.js')
    expect(Object.values(clientManifest.peerDependencies)).not.toContain('^0.1.0')
    expect(clientManifest.peerDependencies['@deepseek-ai/dsh-agent-team']).toBe('>=0.1.0-rc.5 <0.2.0')

    const ctx = new Context()
    await ctx.plugin(Loader)
    await ctx.plugin(AgentPresets, { default: 'team-member',
      roots: [{ path: resolve(root, 'packages/agent-team/preset'), trust: 'system' }], includeUserRoot: false })
    const roster = await ctx.agentPresets.list()
    expect(roster).toEqual([expect.objectContaining({ id: 'team-member', trust: 'system' })])
    expect(roster[0]?.broken).toBeUndefined()
    await ctx.fiber.dispose()
  })
})
