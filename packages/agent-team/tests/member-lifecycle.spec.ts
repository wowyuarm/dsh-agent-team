import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import AgentPresets from '@deepseek-ai/dsh-agent-presets'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import AgentTeam, { AGENT_TEAM_TOOL_NAMES, markAgentTeamPreset } from '../src/index.ts'
import type { AgentTeamRequestId } from '../src/types.ts'
import { MemoryMediaPool, MemoryStorageBackend } from './helpers/memory-backend.ts'

const cleanups: Array<() => Promise<void>> = []
const originalDshHome = process.env.DSH_HOME

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(cleanup => cleanup()))
  if (originalDshHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = originalDshHome
})

function requestId(value: string): AgentTeamRequestId {
  return value as AgentTeamRequestId
}

function teamTools(ctx: Context): void {
  for (const name of AGENT_TEAM_TOOL_NAMES) {
    const definition = defineContentToolFixture({
      name,
      description: `${name} fixture`,
      parameters: {},
      execute: async () => [{ type: 'text', text: 'ok' }],
    })
    ctx.tools.register(name === 'team_send' ? markAgentTeamPreset(definition) : definition)
  }
}

async function realHarness(): Promise<{
  ctx: Context
  workspaceId: ReturnType<typeof WorkspaceId>
  presetFile: string
  root: string
  teamFiber: Awaited<ReturnType<Context['plugin']>>
}> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-agent-team-member-'))
  const project = join(root, 'project')
  const persistence = join(root, 'sessions')
  const presetRoot = join(root, 'presets')
  const presetDir = join(presetRoot, 'team-member')
  await Promise.all([mkdir(project), mkdir(persistence), mkdir(presetDir, { recursive: true })])
  process.env.DSH_HOME = join(root, 'dsh-home')
  const presetFile = join(presetDir, 'agent.cordis.yml')
  await writeFile(presetFile, "- id: team-tools\n  name: 'test-team-tools'\n")

  const ctx = new Context()
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['test-team-tools', { name: 'test-team-tools', inject: ['tools'], apply: teamTools }],
    ['test-bad-team-tools', {
      name: 'test-bad-team-tools',
      inject: ['tools'],
      apply(scope: Context) {
        scope.tools.register(markAgentTeamPreset(defineContentToolFixture({
          name: 'team_send',
          description: 'incomplete team tool fixture',
          parameters: {},
          execute: async () => [{ type: 'text', text: 'ok' }],
        })))
      },
    }],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      const module = modules.get(specifier)
      if (module === undefined) throw new Error(`unexpected Loader import: ${specifier}`)
      return module
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>

  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(JsonlSessionPersistence, { root: persistence })
  await ctx.plugin(AgentPresets, {
    default: 'team-member',
    roots: [{ path: presetRoot, trust: 'system' }],
    includeUserRoot: false,
  })
  await ctx.plugin(Storage)
  const pool = new MemoryMediaPool()
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  const workspaceId = WorkspaceId('workspace:member-test')
  ctx.provide('workspaceRegistry', {
    get: (id: typeof workspaceId) => id === workspaceId
      ? { id, path: project, attachSession: async () => {} }
      : undefined,
    list: () => [],
  })
  const teamFiber = await ctx.plugin(AgentTeam)

  cleanups.push(async () => {
    await ctx.fiber.dispose()
    await facility.closeAll()
    await rm(root, { recursive: true, force: true })
  })
  return { ctx, workspaceId, presetFile, root, teamFiber }
}

describe('Agent Team Member real composition', () => {
  it('creates, suspends, and resumes the exact session with full access and private memory', async () => {
    const { ctx, workspaceId, root, teamFiber } = await realHarness()
    const added = await ctx.agentTeam.addMember({
      requestId: requestId('request:add-member'),
      workspaceId,
      handle: 'builder',
      presetId: 'team-member',
      description: 'Builds the implementation',
    })

    expect(added.status.availability).toBe('active')
    expect(added.status.member.privateMemoryPath).toBe(join(root, 'dsh-home', 'agent-team', 'members', added.status.member.memberId))
    const live = ctx.agents.get(added.status.member.sessionId)
    expect(live).toBeDefined()
    expect(live?.session.header.cwd).toBe(join(root, 'project'))
    expect(live?.session.events).toContainEqual(expect.objectContaining({
      type: 'sandbox/mode',
      data: { mode: 'danger-full-access' },
    }))
    expect(ctx.agentTeam.memberForAgent(live!)).toEqual(added.status.member)

    await expect(ctx.agentTeam.addMember({
      requestId: requestId('request:add-duplicate-handle'),
      workspaceId,
      handle: 'BUILDER',
      presetId: 'team-member',
      description: 'Duplicate handle',
    })).rejects.toThrow(/already active/)

    const second = await ctx.agentTeam.addMember({
      requestId: requestId('request:add-second-member'),
      workspaceId,
      handle: 'reviewer',
      presetId: 'team-member',
      description: 'Reviews the implementation',
    })
    const secondLive = ctx.agents.get(second.status.member.sessionId)
    expect(secondLive?.session.header.cwd).toBe(live?.session.header.cwd)
    expect(second.status.member.privateMemoryPath).not.toBe(added.status.member.privateMemoryPath)

    const ordinary = await ctx.agents.create({
      sessionId: SessionId('ordinary-session'),
      meta: { cwd: join(root, 'project'), agentPreset: 'team-member' },
      setup: async agentCtx => { void await ctx.agentPresets.mount(agentCtx, 'team-member') },
    })
    expect(ctx.agentTeam.memberForAgent(ordinary.agent)).toBeUndefined()
    await ordinary.dispose()

    const suspended = await ctx.agentTeam.suspendMember({
      requestId: requestId('request:suspend-member'),
      memberId: added.status.member.memberId,
    })
    expect(suspended.status.availability).toBe('suspended')
    expect(ctx.agents.get(added.status.member.sessionId)).toBeUndefined()

    const resumed = await ctx.agentTeam.resumeMember({
      requestId: requestId('request:resume-member'),
      memberId: added.status.member.memberId,
    })
    expect(resumed.status.availability).toBe('active')
    expect(resumed.status.member.sessionId).toBe(added.status.member.sessionId)
    expect(ctx.agents.get(added.status.member.sessionId)).toBeDefined()
    expect(ctx.agentTeam.status().agentMemberCount).toBe(2)

    await teamFiber.dispose()
    expect(ctx.agents.get(added.status.member.sessionId)).toBeUndefined()
    const remounted = await ctx.plugin(AgentTeam)
    expect(ctx.agentTeam.members()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        availability: 'active',
        member: expect.objectContaining({ sessionId: added.status.member.sessionId }),
      }),
      expect.objectContaining({
        availability: 'active',
        member: expect.objectContaining({ sessionId: second.status.member.sessionId }),
      }),
    ]))
    expect(ctx.agents.get(added.status.member.sessionId)).toBeDefined()
    await remounted.dispose()
  })

  it('isolates a damaged session while keeping the Team usable', async () => {
    const { ctx, workspaceId, teamFiber } = await realHarness()
    const added = await ctx.agentTeam.addMember({
      requestId: requestId('request:add-damaged'),
      workspaceId,
      handle: 'damaged',
      presetId: 'team-member',
      description: 'Session will be damaged',
    })
    const live = ctx.agents.get(added.status.member.sessionId)!
    const artifact = ctx.sessionPersistence.locate(live.session.header)
    expect(artifact).toBeDefined()
    await teamFiber.dispose()
    await mkdir(dirname(artifact!.path), { recursive: true })
    await writeFile(artifact!.path, '{not valid json}\n')

    const remounted = await ctx.plugin(AgentTeam)
    expect(ctx.agentTeam.members()[0]).toMatchObject({
      availability: 'unavailable',
      diagnostic: expect.any(String),
    })
    await expect(ctx.agentTeam.createChannel({
      requestId: requestId('request:channel-after-damage'),
      workspaceId,
      name: 'still-usable',
    })).resolves.toMatchObject({ channel: { name: 'still-usable' } })
    await remounted.dispose()
  })

  it('isolates an invalid preset and recovers the same durable Member after the preset is fixed', async () => {
    const { ctx, workspaceId, presetFile } = await realHarness()
    await writeFile(presetFile, "- id: bad-team-tools\n  name: 'test-bad-team-tools'\n")
    const request = {
      requestId: requestId('request:add-recoverable'),
      workspaceId,
      handle: 'reviewer',
      presetId: 'team-member',
      description: 'Reviews implementation changes',
    }
    const unavailable = await ctx.agentTeam.addMember(request)
    expect(unavailable.status).toMatchObject({
      availability: 'unavailable',
      diagnostic: expect.stringMatching(/missing tools/),
    })
    expect(ctx.agents.get(unavailable.status.member.sessionId)).toBeUndefined()
    expect(ctx.agentTeam.status()).toMatchObject({ agentMemberCount: 1, channelCount: 0 })

    await writeFile(presetFile, "- id: team-tools-fixed\n  name: 'test-team-tools'\n")
    const recovered = await ctx.agentTeam.addMember(request)
    expect(recovered.receipt).toEqual(unavailable.receipt)
    expect(recovered.status.availability).toBe('active')
    expect(recovered.status.member.memberId).toBe(unavailable.status.member.memberId)
    expect(recovered.status.member.sessionId).toBe(unavailable.status.member.sessionId)
    expect(ctx.agentTeam.status().operationCount).toBe(2)
  })
})
