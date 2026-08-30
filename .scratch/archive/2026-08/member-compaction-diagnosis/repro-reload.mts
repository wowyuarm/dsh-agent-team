/* Round 2: does disposing + re-applying the roster subtree orphan existing
 * members' compaction resolution? Mirrors an HMR/config refresh reload. */
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import Group from '@deepseek-ai/cordis-plugin-group'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import AgentPresets from '@deepseek-ai/dsh-agent-presets'
import SubprocessLocal from '@deepseek-ai/dsh-subprocess-local'
import SandboxLocal from '@deepseek-ai/dsh-sandbox-local'
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy'
import BashSandbox from '@deepseek-ai/dsh-bash-sandbox'
import * as ShellEnv from '@deepseek-ai/dsh-shell-env'
import * as FsObservationPolicy from '@deepseek-ai/dsh-fs-observation-policy'
import FsSandbox from '@deepseek-ai/dsh-fs-sandbox'
import JobsLocal from '@deepseek-ai/dsh-jobs-local'
import Skill from '@deepseek-ai/dsh-skill'
import Commands from '@deepseek-ai/dsh-commands'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import Web from '@deepseek-ai/dsh-web'
import SessionPersistenceJsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import * as presetRoster from '/home/yu/projects/dsh-agent-team/packages/agent-team/src/preset-roster.ts'

const PRESET_ROOT = '/home/yu/projects/dsh-agent-team/packages/agent-team/preset'

async function main(): Promise<void> {
  const ctx = new Context()
  ctx.baseUrl = pathToFileURL(`${PRESET_ROOT}/team-member/`).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.builtins.group = Group
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubprocessLocal)
  await ctx.plugin(SandboxLocal)
  await ctx.plugin(SandboxPolicy, { mode: 'danger-full-access', workspaceRoot: '/tmp' })
  await ctx.plugin(BashSandbox, { timeoutMs: 60000 })
  await ctx.plugin(ShellEnv)
  await ctx.plugin(FsObservationPolicy)
  await ctx.plugin(FsSandbox)
  await ctx.plugin(JobsLocal)
  await ctx.plugin(Skill)
  await ctx.plugin(Commands)
  await ctx.plugin(TokenMeter)
  await ctx.plugin(Web)
  const sessionRoot = await mkdtemp(join(tmpdir(), 'repro2-sessions-'))
  await ctx.plugin(SessionPersistenceJsonl, { root: sessionRoot })

  // Roster mounted the way the bundle does it: inside a group we can dispose,
  // mirroring an HMR/config refresh of the bundle subtree.
  const loader = Object.create(Loader.prototype) as Loader
  const roster = loader.unwrapExports(presetRoster) as Parameters<Context['plugin']>[0]
  let rosterFiber: { dispose(): Promise<void> | void; await(): Promise<void> }
  const applyRoster = async (): Promise<void> => {
    rosterFiber = ctx.plugin(roster) as never
    await rosterFiber.await()
  }
  await applyRoster()

  const cwd = await mkdtemp(join(tmpdir(), 'repro2-member-'))
  const create = async (id: string) => ctx.agents.create({
    sessionId: SessionId(id),
    meta: { cwd, agentPreset: 'team-member' },
    agentOptions: { provider: 'mock', model: 'mock' },
    setup: async agentCtx => {
      await ctx.agentPresets.mount(agentCtx, 'team-member')
      return { commit: () => {} }
    },
  })

  const first = await create('sess-repro2-a')
  console.log('[repro2] before dispose: serviceFor(first) =>', ctx.agentPresets.serviceFor(first.agent, 'compaction') === undefined ? 'UNDEFINED' : 'resolved')

  // Simulate the roster subtree being torn down and re-applied (HMR/config refresh).
  console.log('[repro2] -- disposing + re-applying roster subtree --')
  await rosterFiber.dispose()
  await applyRoster()

  console.log('[repro2] after reload: serviceFor(first, OLD agent) =>', ctx.agentPresets.serviceFor(first.agent, 'compaction') === undefined ? 'UNDEFINED  <-- BUG REPRODUCED' : 'resolved')
  console.log('[repro2] after reload: OLD agent tools =>', ctx.tools.schemas(first.agent).length, ' composedPreset =>', ctx.agentPresets.composedPreset(first.agent.ctx) ?? 'undefined')
  const second = await create('sess-repro2-b')
  console.log('[repro2] after reload: serviceFor(second, NEW agent) =>', ctx.agentPresets.serviceFor(second.agent, 'compaction') === undefined ? 'UNDEFINED' : 'resolved')

  await ctx.fiber.dispose()
}

await main().then(() => process.exit(0), error => {
  console.error('[repro2] FAILED:', error)
  process.exit(1)
})
