/* Temporary diagnosis repro — mounts the real dsh-agent-team `team-member`
 * preset and checks the exact resolution the 1127012 fix relies on.
 * Delete after use. */
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
import * as FsObservationPolicy from '@deepseek-ai/dsh-fs-observation-policy'
import FsSandbox from '@deepseek-ai/dsh-fs-sandbox'
import JobsLocal from '@deepseek-ai/dsh-jobs-local'
import Skill from '@deepseek-ai/dsh-skill'
import Commands from '@deepseek-ai/dsh-commands'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import Web from '@deepseek-ai/dsh-web'
import * as ShellEnv from '@deepseek-ai/dsh-shell-env'
import SessionPersistenceJsonl from '@deepseek-ai/dsh-session-persistence-jsonl'

const PRESET_ROOT = '/home/yu/projects/dsh-agent-team/packages/agent-team/preset'

async function main(): Promise<void> {
  const ctx = new Context()
  ctx.baseUrl = pathToFileURL(`${PRESET_ROOT}/team-member/`).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.builtins.group = Group
  // Minimal host composition: the base-bundle providers the preset rows inject.
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
  const sessionRoot = await mkdtemp(join(tmpdir(), 'repro-sessions-'))
  await ctx.plugin(SessionPersistenceJsonl, { root: sessionRoot })
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(AgentPresets, {
    default: 'team-member',
    roots: [{ path: PRESET_ROOT, trust: 'system' }],
    includeUserRoot: false,
  })

  const cwd = await mkdtemp(join(tmpdir(), 'repro-member-'))
  const handle = await ctx.agents.create({
    sessionId: SessionId('sess-repro-member-compaction'),
    meta: { cwd, agentPreset: 'team-member' },
    agentOptions: { provider: 'mock', model: 'mock' },
    setup: async agentCtx => {
      await ctx.agentPresets.mount(agentCtx, 'team-member')
      return { commit: () => {} }
    },
  })

  const engine = ctx.agentPresets.serviceFor(handle.agent, 'compaction')
  console.log('[repro] create: serviceFor(agent, "compaction") =>', engine === undefined
    ? 'UNDEFINED  <-- BUG REPRODUCED'
    : `resolved (${engine?.constructor?.name})`)
  console.log('[repro] create: agent.ctx.get("compaction") =>', handle.agent.ctx.get('compaction') === undefined ? 'UNDEFINED' : 'resolved')
  console.log('[repro] create: composedPreset =>', ctx.agentPresets.composedPreset(handle.agent.ctx))
  console.log('[repro] create: tools visible =>', ctx.tools.schemas(handle.agent).length)

  // Production members survive host restarts through agents.resume — the
  // activateMember persisted branch. Exercise the same path.
  const sessionId = handle.agent.id
  handle.agent.session.append('agent-preset/selected', { agentPreset: 'team-member' })
  await ctx.sessions.flush(handle.agent.session)
  await handle.dispose()
  const resumed = await ctx.agents.resume({
    resumeSessionId: sessionId,
    agentOptions: { provider: 'mock', model: 'mock' },
    setup: async agentCtx => {
      await ctx.agentPresets.mount(agentCtx, 'team-member')
      return { commit: () => {} }
    },
  })
  const resumedEngine = ctx.agentPresets.serviceFor(resumed.agent, 'compaction')
  console.log('[repro] resume: serviceFor(agent, "compaction") =>', resumedEngine === undefined
    ? 'UNDEFINED  <-- BUG REPRODUCED'
    : `resolved (${resumedEngine?.constructor?.name})`)
  console.log('[repro] resume: meter =>', resumed.agent.ctx.get('tokenMeter') === undefined ? 'UNDEFINED' : 'resolved')

  await ctx.fiber.dispose()
}

await main().then(() => process.exit(0), error => {
  console.error('[repro] FAILED:', error)
  process.exit(1)
})
