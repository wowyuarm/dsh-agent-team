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

// The shipped bundle patch stack resolves against the SAME harness checkout
// the rest of the build uses (env override for certification rounds, then the
// .generated-harness marker, then the daily sibling) — never a hardcoded
// name, or a compat round would sweep the daily checkout's rows instead of
// the candidate's.
async function shippedHarnessName(): Promise<string> {
  const marker = resolve(root, '.generated-harness')
  try {
    return process.env.DSH_HARNESS_DIR?.trim() || (await readFile(marker, 'utf8')).trim() || 'deepseek-harness'
  } catch {
    return process.env.DSH_HARNESS_DIR?.trim() || 'deepseek-harness'
  }
}

// The persona is injected into every Member turn and ships to every user, so its
// size is a reviewed budget rather than a measurement: raising this number is a
// deliberate act in the same change that edits the text. Silent accretion is what
// this test exists to stop.
const PERSONA_CHARACTER_BUDGET = 8872

// The YAML block-scalar bodies under `prefix:`/`suffix:`, de-indented the way YAML
// reads them. The block ends at the first line that is not more indented than its
// key, so a renamed config key yields an empty string — which is why the budget
// test also asserts the extraction found the persona at all.
function personaInstructionText(preset: string): string {
  const lines = preset.replaceAll('\r\n', '\n').split('\n')
  const blocks: string[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const key = /^(\s*)(?:prefix|suffix):\s*\|-?\s*$/.exec(lines[index] ?? '')
    if (key === null || key[1] === undefined) continue
    const keyIndent = key[1].length
    const body: string[] = []
    let contentIndent = -1
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const line = lines[cursor]
      if (line === undefined) break
      if (line.trim() === '') {
        body.push('')
        continue
      }
      const indent = line.length - line.trimStart().length
      if (indent <= keyIndent) break
      if (contentIndent === -1) contentIndent = indent
      body.push(line.slice(contentIndent))
    }
    blocks.push(body.join('\n').replace(/\n+$/, ''))
  }
  return blocks.join('')
}

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
      // rc.1 moved the storage rows from web-app into the base bundle; the
      // real layer stack is base → web-app → this bundle. The stack resolves
      // against the harness checkout this run was generated against, so a
      // certification round sweeps the CANDIDATE's rows, not the daily ones.
      ...loadOverlayPatches('shipping contract', resolve(root, `../${await shippedHarnessName()}/packages/bundle/base/cordis.patch.yml`)),
      ...loadOverlayPatches('shipping contract', resolve(root, `../${await shippedHarnessName()}/packages/bundle/web-app/cordis.patch.yml`)),
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
    expect(bundleManifest.peerDependencies['@deepseek-ai/dsh-tool-web']).toBe('>=0.1.5-rc.1 <0.2.0')
    expect(bundleManifest.peerDependencies['@deepseek-ai/dsh-command-compact']).toBe('>=0.1.5-rc.1 <0.2.0')
    // The certified baseline moves as one cut: every DSH peer and the routed
    // storage dependency carry the same range, or an install resolves two DSH
    // generations at once.
    const dshPeerRanges = new Set(Object.entries(bundleManifest.peerDependencies)
      .filter(([name]) => name.startsWith('@deepseek-ai/dsh-'))
      .map(([, range]) => range))
    expect([...dshPeerRanges]).toEqual(['>=0.1.5-rc.1 <0.2.0'])
    expect(preset).toContain('compaction: true')
    expect(preset).toContain('toolResultPruner: true')
    expect(preset).toContain('team_inbox, team_thread, team_message, team_claim, and team_view')
    // The one token story has exactly two legal surfaces: a fully drained
    // read hands off the next-write token, and a committed public mutation's
    // returned token may basis the next deliberate mutation.
    expect(preset).toContain('copy the next-write token that fully drained read renders')
    expect(preset).toContain("a successful public mutation's returned token may basis the next deliberate mutation")
    // The persona distinguishes the two reply channels: direct session talk
    // with the Human answers in plain text; ledger-backed Team Threads are
    // what team_message.reply is for.
    expect(preset).toContain('reply in plain text')
    expect(preset).toContain('not a reply channel for it')
    // The message contract is two-tier, and the tier is chosen by whether the
    // Human must act: a needed Human decision is a mention plus a human layer
    // with a stated default, while peer-only coordination mentions no Human and
    // keeps mechanical detail below the conclusion rather than dropping it.
    expect(preset).toContain('read twice: by the Member you are coordinating with, and by the Human')
    expect(preset).toContain('mention the Human and open with the human layer')
    expect(preset).toContain('mention no Human and carry exactly what those Members need to act on')
    expect(preset).toContain('never drop detail a peer Member needs, move it below')
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
    // Validation errors teach the same two token surfaces as the descriptions,
    // never a single-source story.
    expect(toolSource).toContain('or reuse the one your own last committed mutation rendered')
    expect(toolSource).not.toContain('the revision is not shown anywhere else')
    // The body parameter restates the opening rule where the model composes the
    // message, so the contract is visible at composition time, not only in the
    // per-turn persona.
    expect(toolSource).toContain('mention the Human with a one-to-three-sentence human layer')
    expect(toolSource).toContain('mechanical detail follows below')

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
    expect(manifest.dependencies).toEqual({ '@deepseek-ai/dsh-storage-sqlite': '>=0.1.5-rc.1 <0.2.0', zod: '^4.4.3' })
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

// The persona above the tool rows is the one instruction surface every Member
// pays for on every turn, in every Workspace, on every install. These two tests
// are the mechanical half of "workflow discipline": they cannot judge wording,
// but they stop the text from growing silently and from losing a rule whole.
describe('Agent Team Member persona', () => {
  it('stays inside the reviewed prompt budget', async () => {
    const preset = await readFile(resolve(root, 'packages/agent-team/preset/team-member/agent.cordis.yml'), 'utf8')
    const persona = personaInstructionText(preset)
    // Extraction guard: a renamed config key would empty the text and make the
    // budget assertion meaningless, so prove the persona was actually found.
    expect(persona).toContain('You are an Agent Team Member')
    expect(
      persona.length,
      `The Member persona is ${persona.length} characters; the reviewed budget is ${PERSONA_CHARACTER_BUDGET}. `
      + 'Trim it back to the budget, or raise PERSONA_CHARACTER_BUDGET in this file deliberately — every Member '
      + 'pays this text on every turn.',
    ).toBeLessThanOrEqual(PERSONA_CHARACTER_BUDGET)
  })

  // Token-level anchors, not sentences: rewording is Cole's issue 07 territory and
  // must stay free, while losing a whole rule has to fail. These are the rules the
  // persona is the only carrier of, chosen to not overlap the sentence assertions
  // in the shipping contract above (reply channels, the token story, the two
  // message tiers, the private space).
  it('keeps the rules only the persona carries', async () => {
    const preset = await readFile(resolve(root, 'packages/agent-team/preset/team-member/agent.cordis.yml'), 'utf8')
    const persona = personaInstructionText(preset)
    for (const rule of [
      // The Team tool family, named in prose so a Member knows the surface exists.
      'team_view', 'team_inbox', 'team_thread', 'team_message', 'team_claim',
      // The context lifecycle: park, anchor, and restore a generation.
      'context_rollover', 'context_checkpoint', 'context_timeline',
      // Branded refs are written with exactly one colon.
      'never a double colon',
      // Work on a Task is announced with a Claimed direction before it starts.
      'Claim a Direction',
      // A decision owed to the Human states a default.
      'Decision needed:',
    ]) {
      expect(persona, `the Member persona no longer carries the "${rule}" rule`).toContain(rule)
    }
  })
})
