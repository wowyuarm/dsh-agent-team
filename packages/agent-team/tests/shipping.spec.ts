import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentPresets from '@deepseek-ai/dsh-agent-presets'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { applyEntryPatches } from '@deepseek-ai/cordis-plugin-include'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'

const root = resolve(import.meta.dirname, '../../../')

describe('Agent Team shipping contract', () => {
  it('ships an opt-in Host patch and one explicit team-member preset', async () => {
    const [patch, preset, manifestText] = await Promise.all([
      readFile(resolve(root, 'cordis.patch.yml'), 'utf8'),
      readFile(resolve(root, 'packages/agent-team/preset/team-member/agent.cordis.yml'), 'utf8'),
      readFile(resolve(root, 'package.json'), 'utf8'),
    ])
    expect(patch).toContain('id: wowyuarm-agent-team-scope')
    expect(patch).toContain("name: '@wowyuarm/dsh-agent-team/preset-roster'")
    expect(patch).toContain('agentPresets: true')
    expect(patch).toContain("name: '@wowyuarm/dsh-agent-team/host'")
    expect(patch).toContain("name: '@wowyuarm/dsh-agent-team'")
    expect(patch).toContain("name: '@deepseek-ai/dsh-invariants'")
    expect(patch).toContain("name: '@wowyuarm/dsh-agent-team/invariant'")
    // The Team ledger medium: only agent_team routes to SQLite through the
    // public per-domain route table. Simulate the real layer stack (the
    // shipped Web bundle patch, then this bundle's) because insert blocks
    // append rather than override: a colliding id inside an insert list would
    // duplicate the shipped row and fail the boot sweep.
    expect(patch).toContain("name: '@deepseek-ai/dsh-storage-sqlite'")
    const composed = applyEntryPatches([], [
      ...loadOverlayPatches('shipping contract', resolve(root, '../deepseek-harness/packages/bundle/web-app/cordis.patch.yml')),
      ...loadOverlayPatches('shipping contract', resolve(root, 'cordis.patch.yml')),
    ], () => {})
    const ids = composed.map(entry => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(composed.find(entry => entry.id === 'storage-domain')?.config).toMatchObject({
      backend: 'json',
      routes: { agent_team: 'sqlite' },
    })
    expect(patch).not.toContain('dsh-tool-agent-team')

    expect(preset).toContain("name: '@wowyuarm/dsh-agent-team/tools'")
    expect(preset).toContain("name: '@deepseek-ai/dsh-agent-tool-presentation'")
    expect(preset).toContain('mode: native')
    expect(preset).toContain("name: '@wowyuarm/dsh-agent-team/member-context'")
    expect(preset).toContain("name: '@deepseek-ai/dsh-command-compact'")
    // Every lib directory that can enter the pack must be cleaned, so a
    // deleted source module cannot leave stale output behind.
    const cleanScript = await readFile(resolve(root, 'scripts/clean-build-outputs.mjs'), 'utf8')
    const cleanTargets = [...cleanScript.matchAll(/['"](packages\/[^'"]+\/lib)['"]/g)].map(match => match[1])
    const shippedLibDirs = (JSON.parse(manifestText) as { files: string[] }).files
      .filter(pattern => pattern.startsWith('packages/') && pattern.endsWith('/lib/**/*'))
      .map(pattern => pattern.slice(0, -'/**/*'.length))
    expect(cleanTargets).toEqual(shippedLibDirs)
    const buildCommand = (JSON.parse(manifestText) as { scripts: { build: string } }).scripts.build
    expect(buildCommand.indexOf('npm run clean:build-outputs')).toBeGreaterThanOrEqual(0)
    expect(buildCommand.indexOf('npm run generate:typert')).toBeGreaterThan(buildCommand.indexOf('npm run clean:build-outputs'))
    for (const capability of [
      '@deepseek-ai/dsh-tool-bash', '@deepseek-ai/dsh-tool-pwsh', '@deepseek-ai/dsh-tool-fs',
      '@deepseek-ai/dsh-tool-fs-search', '@deepseek-ai/dsh-tool-jobs', '@deepseek-ai/dsh-tool-skill',
      '@deepseek-ai/dsh-tool-todo', '@deepseek-ai/dsh-tool-web',
    ]) expect(preset).toContain(`name: '${capability}'`)
    // Skills are per-Member (Host-mounted private-directory provider), so the
    // shared filesystem row is deliberately absent from the preset.
    expect(preset).not.toContain('@deepseek-ai/dsh-skill-filesystem')
    const bundleManifest = JSON.parse(manifestText) as {
      peerDependencies: Record<string, string>
      exports: Record<string, { default?: string }>
      dsh: { client: { platform: string; inject: string[] } }
    }
    expect(bundleManifest.peerDependencies['@deepseek-ai/dsh-tool-web']).toBe('>=0.1.2-rc.1 <0.2.0')
    expect(bundleManifest.peerDependencies['@deepseek-ai/dsh-command-compact']).toBe('>=0.1.2-rc.1 <0.2.0')
    // The certified baseline moves as one cut: every DSH peer and the routed
    // storage dependency carry the same range, or an install resolves two DSH
    // generations at once.
    const dshPeerRanges = new Set(Object.entries(bundleManifest.peerDependencies)
      .filter(([name]) => name.startsWith('@deepseek-ai/dsh-'))
      .map(([, range]) => range))
    expect([...dshPeerRanges]).toEqual(['>=0.1.2-rc.1 <0.2.0'])
    expect(preset).toContain('compaction: true')
    expect(preset).toContain('toolResultPruner: true')
    expect(preset).toContain('team_inbox, team_thread, team_message, team_claim, and team_view')
    // The persona keeps only the physical facts of the private space
    // (absolute paths, memory/notes discipline, reusable-assets boundary);
    // skill craft itself lives in the bundled member-skill-manager and its
    // description routes skill work to it.
    expect(preset).toContain('use the injected absolute paths')
    expect(preset).toContain('formal deliverables')
    expect(preset).toContain('your own judgment per task')
    expect(preset).not.toContain('SKILL.md')
    expect(preset).not.toContain('YAML front matter')
    const toolSource = await readFile(resolve(root, 'packages/tool-agent-team/src/index.ts'), 'utf8')
    expect([...toolSource.matchAll(/name: '(team_[a-z]+)'/g)].map(match => match[1])).toEqual([
      'team_inbox', 'team_thread', 'team_message', 'team_claim', 'team_view',
    ])

    const manifest = JSON.parse(manifestText) as {
      name: string
      files: string[]
      dependencies: Record<string, string>
      dsh: { bundle: { patch: string } }
    }
    expect(manifest.dsh.bundle.patch).toBe('./cordis.patch.yml')
    expect(manifest.files).toContain('packages/agent-team/preset/**/*')
    expect(manifest.files).toContain('packages/agent-team/core-skills/**/*')
    expect(manifest.files).toContain('packages/agent-team/lib/**/*')
    expect(manifest.files).toContain('packages/client-agent-team/lib/**/*')
    expect(manifest.name).toBe('@wowyuarm/dsh-agent-team')
    expect(manifest.dependencies).toEqual({ '@deepseek-ai/dsh-storage-sqlite': '>=0.1.2-rc.1 <0.2.0', zod: '^4.4.3' })
    expect(bundleManifest.dsh.client).toEqual({
      platform: 'web',
      inject: expect.not.arrayContaining(['@wowyuarm/dsh-agent-team/host']),
    })
    // An ordering hint for a package DSH no longer publishes is dead weight in
    // the manifest and a hard install failure as a peer.
    expect(bundleManifest.dsh.client.inject).not.toContain('@deepseek-ai/dsh-client-runtime')
    expect(bundleManifest.peerDependencies['@deepseek-ai/dsh-client-runtime']).toBeUndefined()
    expect(bundleManifest.exports['./client']?.default).toBe('./packages/client-agent-team/lib/client.js')

    const ctx = new Context()
    // rc.1: the roster constructor rejects a context without a base URL, and
    // health resolution walks node_modules above it — point at the repo root,
    // where the harness packages are linked, as a real profile install would.
    ctx.baseUrl = pathToFileURL(root).href + '/'
    await ctx.plugin(Loader)
    // rc.1: AgentPresets injects 'sessionProjections'; the roster stays PENDING without it.
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(AgentPresets, { default: 'team-member',
      roots: [{ path: resolve(root, 'packages/agent-team/preset'), trust: 'system' }], includeShippedRoot: false, includeUserRoot: false })
    const roster = await ctx.agentPresets.list()
    expect(roster).toEqual([expect.objectContaining({ id: 'team-member', trust: 'system' })])
    expect(roster[0]?.broken).toBeUndefined()
    await ctx.fiber.dispose()
  })
})
