import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import Group from '@deepseek-ai/cordis-plugin-group'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import AgentPresets, { type AgentPreset } from '@deepseek-ai/dsh-agent-presets'
import LlmRuntime, { CallId, createUserMessage, LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SqliteSessionPersistence from '@deepseek-ai/dsh-session-persistence-sqlite'
import SessionTitle from '@deepseek-ai/dsh-session-title'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import AgentTeam, { AGENT_TEAM_HUMAN_MEMBER_ID, AGENT_TEAM_TOOL_NAMES, markAgentTeamPreset } from '../src/index.ts'
import { RECOVERY_DELAY_MS } from '../src/recovery.ts'
import * as memberContext from '../src/member-context.ts'
import { apply as applyAgentTeamTools } from '@wowyuarm/dsh-agent-team/tools'
import type { AgentTeamChannelRef, AgentTeamMemberId, AgentTeamRequestId } from '../src/types.ts'
import { MemoryStorageBackend } from './helpers/memory-backend.ts'

const cleanups: Array<() => Promise<void>> = []
const originalDshHome = process.env.DSH_HOME
const requestId = (value: string): AgentTeamRequestId => value as AgentTeamRequestId

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(cleanup => cleanup()))
  if (originalDshHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = originalDshHome
})

class EmptyAdapter extends LlmAdapter {
  override resolveModel(provider: string, model: string) { return Promise.resolve({ provider, id: model, name: model }) }
  async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> { yield* [] }
}

class ScriptedAdapter extends EmptyAdapter {
  readonly requests: GenerateOptions[] = []
  private readonly responses: StreamChunk[][] = []

  enqueue(response: StreamChunk[]): void {
    this.responses.push(response)
  }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const response = this.responses.shift()
    if (response === undefined) throw new Error('ScriptedAdapter response queue is empty')
    for (const chunk of response) yield chunk
  }
}

class GatedAdapter extends ScriptedAdapter {
  readonly started = Promise.withResolvers<void>()
  readonly release = Promise.withResolvers<void>()
  private first = true

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (!this.first) {
      yield* super.stream(options)
      return
    }
    this.first = false
    this.requests.push(options)
    this.started.resolve()
    await this.release.promise
    for (const chunk of textResponse('Initial work finished.')) yield chunk
  }
}

function toolCallResponse(rawCallId: string, name: string, args: object): StreamChunk[] {
  const id = CallId(rawCallId)
  const argumentsJson = JSON.stringify(args)
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: argumentsJson },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: argumentsJson } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

function textResponse(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: text.length } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

function waitForIdle(ctx: Context, agent: NonNullable<ReturnType<Context['agents']['get']>>): Promise<void> {
  return new Promise(resolve => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject !== agent || status !== 'idle') return
      dispose()
      resolve()
    })
  })
}

type PersistenceBackend = 'jsonl' | 'sqlite'

/**
 * The real roster with one test seam: agents armed here resolve no preset
 * composition, exactly as members composed before a bundle-row reload do.
 * Agents composed after arming resolve normally, so a re-activation heals.
 * While `failingMount` is set, preset mounts throw, as a Host restart against
 * a broken preset would, leaving an enabled Member without a live session.
 */
class TestablePresets extends AgentPresets {
  readonly orphaned = new WeakSet<Context>()
  failingMount = false

  override composedPreset(agentCtx: Context): string | undefined {
    if (this.orphaned.has(agentCtx)) return undefined
    return super.composedPreset(agentCtx)
  }

  override async mount(agentCtx: Context, id?: string): Promise<AgentPreset> {
    if (this.failingMount) throw new Error(`preset '${id ?? 'default'}' failed to load (test seam)`)
    return super.mount(agentCtx, id)
  }
}

async function realHarness(
  adapter: LlmAdapter = new EmptyAdapter(),
  persistenceBackend: PersistenceBackend = 'jsonl',
): Promise<{
  readonly ctx: Context
  readonly workspaceId: WorkspaceId
  readonly root: string
  readonly project: string
  readonly teamFiber: Awaited<ReturnType<Context['plugin']>>
  /** Sessions the fake workspace registry archived, in archive order. */
  readonly archived: readonly SessionId[]
  readonly presets: TestablePresets
}> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-agent-team-member-'))
  const project = join(root, 'project')
  const persistence = join(root, 'sessions')
  const sqlite = join(root, 'sessions.sqlite')
  const presetRoot = join(root, 'presets')
  const presetDir = join(presetRoot, 'team-member')
  await Promise.all([mkdir(project), mkdir(persistence), mkdir(presetDir, { recursive: true })])
  process.env.DSH_HOME = join(root, 'dsh-home')
  await writeFile(join(presetDir, 'agent.cordis.yml'), [
    "- id: member-context",
    "  name: 'test-member-context'",
    "- id: team-tools",
    "  name: 'test-team-tools'",
    "- id: compaction",
    "  name: cordis:group",
    "  group: true",
    "  isolate:",
    "    compaction: true",
    "  config:",
    "    - id: compaction-stub",
    "      name: 'test-compaction'",
    '',
  ].join('\n'))

  const ctx = new Context()
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.builtins.group = Group
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (specifier === 'test-member-context') return memberContext
      if (specifier === 'test-compaction') {
        return {
          name: 'test-compaction',
          apply(scope: Context) { scope.provide('compaction', { compactNow: async () => null }) },
        }
      }
      if (specifier === 'test-team-tools') return {
        name: 'test-team-tools', inject: ['tools'], apply(scope: Context) {
          applyAgentTeamTools(scope)
          scope.tools.register(defineContentToolFixture({ name: 'ordinary_tool', description: 'ordinary', parameters: {}, execute: async () => [{ type: 'text', text: 'ok' }] }))
        },
      }
      throw new Error(`unexpected Loader import: ${specifier}`)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.plugin(LlmRuntime)
  ctx.llm.registerAdapter(['mock'], adapter)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'mock', model: 'mock' }) })
  if (persistenceBackend === 'jsonl') await ctx.plugin(JsonlSessionPersistence, { root: persistence })
  else await ctx.plugin(SqliteSessionPersistence, { path: sqlite, journalMode: 'delete' })
  await ctx.plugin(SessionTitle, { fallbackMaxWords: 5, fallbackMaxBytes: 40, maxTitleBytes: 80 })
  const presetsConfig = (): { default: string; roots: { path: string; trust: 'system' }[]; includeUserRoot: boolean } => ({
    default: 'team-member', roots: [{ path: presetRoot, trust: 'system' }], includeUserRoot: false,
  })
  await ctx.plugin(TestablePresets, presetsConfig())
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend())
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  const workspaceId = WorkspaceId('workspace:member-test')
  const archived: SessionId[] = []
  ctx.provide('workspaceRegistry', {
    get: (id: WorkspaceId) => id === workspaceId ? { id, path: project, attachSession: async () => {} } : undefined,
    list: () => [],
    archiveSession: async (sessionId: SessionId) => { archived.push(sessionId) },
  })
  const teamFiber = await ctx.plugin(AgentTeam)
  cleanups.push(async () => { await ctx.fiber.dispose(); await facility.closeAll(); await rm(root, { recursive: true, force: true }) })
  return { ctx, workspaceId, root, project, teamFiber, archived, presets: ctx.agentPresets as TestablePresets }
}

describe('Agent Team Member lifecycle', () => {
  it('creates, suspends, resumes, and removes an exact Team-owned Agent session', async () => {
    const { ctx, workspaceId, root, project } = await realHarness()
    const channel = await ctx.agentTeam.createChannel({ requestId: requestId('channel'), workspaceId, name: 'engineering', description: 'Engineering work' })
    const added = await ctx.agentTeam.addMember({ requestId: requestId('add'), workspaceId, handle: 'builder', description: 'Builds the implementation', presetId: 'team-member', channelRefs: [channel.channel.channelRef] })
    expect(added.status.availability).toBe('active')
    expect(added.status.member.privateMemoryPath).toBe(join(root, 'dsh-home', 'agent-team', 'members', added.status.member.memberId))
    expect(await readFile(join(added.status.member.privateMemoryPath, 'memory.md'), 'utf8')).toContain('# Member memory')
    await expect(access(join(added.status.member.privateMemoryPath, 'notes'))).resolves.toBeUndefined()
    const live = ctx.agents.get(added.status.member.sessionId)
    expect(live?.session.header.cwd).toBe(project)
    expect(live?.session.events).toContainEqual(expect.objectContaining({ type: 'sandbox/mode', data: { mode: 'danger-full-access' } }))
    expect(ctx.agentTeam.memberForAgent(live!)).toEqual(added.status.member)
    expect(ctx.agentTeam.membersForClient({ workspaceId })[0]?.member).not.toHaveProperty('privateMemoryPath')
    const sessionTitle = ctx.get('sessionTitle')
    expect(sessionTitle?.get(live!.session)).toMatchObject({ title: 'builder', source: { kind: 'user' } })

    const suspended = await ctx.agentTeam.suspendMember({ requestId: requestId('suspend'), memberId: added.status.member.memberId })
    expect(suspended.status.availability).toBe('suspended')
    expect(ctx.agents.get(added.status.member.sessionId)).toBeUndefined()
    const resumed = await ctx.agentTeam.resumeMember({ requestId: requestId('resume'), memberId: added.status.member.memberId })
    expect(resumed.status.availability).toBe('active')
    expect(resumed.status.member.sessionId).toBe(added.status.member.sessionId)
    const resumedLive = ctx.agents.get(added.status.member.sessionId)
    expect(sessionTitle?.get(resumedLive!.session)).toMatchObject({ title: 'builder', source: { kind: 'user' } })

    const removed = await ctx.agentTeam.removeMember({ requestId: requestId('remove'), memberId: added.status.member.memberId })
    expect(removed.member.state).toBe('inactive')
    expect(ctx.agents.get(added.status.member.sessionId)).toBeUndefined()
    await expect(access(added.status.member.privateMemoryPath)).rejects.toThrow()
  })

  it('renews an enabled Member onto a fresh session: new sessionId, archived previous log, memory and binding survive', async () => {
    const adapter = new ScriptedAdapter()
    const { ctx, workspaceId, archived } = await realHarness(adapter)
    const channel = await ctx.agentTeam.createChannel({ requestId: requestId('clear-channel'), workspaceId, name: 'engineering', description: 'Engineering work' })
    const added = await ctx.agentTeam.addMember({ requestId: requestId('clear-add'), workspaceId, handle: 'builder', description: 'Builds the implementation', presetId: 'team-member', channelRefs: [channel.channel.channelRef] })
    const liveBefore = ctx.agents.get(added.status.member.sessionId)!
    // Give the Member a real turn so the clear has a transcript to erase.
    adapter.enqueue(textResponse('Initial work finished.'))
    const idle = waitForIdle(ctx, liveBefore)
    const started = await ctx.agentTeam.sendMessage({ asTask: true, requestId: requestId('clear-task'), workspaceId, channelRef: channel.channel.channelRef, body: 'Build the initial feature', recipients: [added.status.member.memberId] })
    if (started.kind !== 'committed') throw new Error(`expected committed start, received ${started.kind}`)
    await idle
    expect(adapter.requests).toHaveLength(1)
    expect(liveBefore.session.events.some(event => event.type === 'user/message' || event.type === 'turn/start')).toBe(true)
    // Consume the durable unread so the Member settles to available; the clear
    // guard requires an idle Member.
    await ctx.agentTeam.readThreadForAgent(liveBefore, { requestId: requestId('clear-read'), workspaceId, taskRef: started.task!.taskRef })
    const deadline = Date.now() + 3000
    while (Date.now() < deadline
      && ctx.agentTeam.members().find(member => member.member.memberId === added.status.member.memberId)!.presence !== 'available') {
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    expect(ctx.agentTeam.members().find(member => member.member.memberId === added.status.member.memberId)!.presence).toBe('available')
    await writeFile(join(added.status.member.privateMemoryPath, 'notes', 'kept.md'), 'persistent note')

    const cleared = await ctx.agentTeam.clearMemberContext({ requestId: requestId('clear'), workspaceId, memberId: added.status.member.memberId })
    expect(cleared.status.availability).toBe('active')
    expect(cleared.status.presence).toBe('available')
    expect(cleared.status.member.sessionId).not.toBe(added.status.member.sessionId)

    // The old live Session is disposed; the Member now runs a fresh handle
    // under a new id with an empty conversation (the constructor seed marker
    // is the only event left) and fork lineage back to the previous Session.
    expect(ctx.agents.get(added.status.member.sessionId)).toBeUndefined()
    const liveAfter = ctx.agents.get(cleared.status.member.sessionId)!
    expect(liveAfter).not.toBe(liveBefore)
    expect(liveAfter.session.header.cwd).toBe(liveBefore.session.header.cwd)
    expect(liveAfter.session.header.parentSession).toBe(added.status.member.sessionId)
    expect(liveAfter.session.events.filter(event => event.type === 'user/message' || event.type === 'turn/start')).toHaveLength(0)
    expect(liveAfter.session.events.length).toBeLessThan(liveBefore.session.events.length)
    const sessionTitle = ctx.get('sessionTitle')
    expect(sessionTitle?.get(liveAfter.session)).toMatchObject({ title: 'builder', source: { kind: 'user' } })

    // The previous Session log survives on disk (only archived from grouping
    // surfaces), so the Member's history stays queryable. Disposal drains the
    // log asynchronously, so wait for the artifact to materialize.
    const flushDeadline = Date.now() + 3000
    while (Date.now() < flushDeadline
      && !(await ctx.sessionPersistence.list()).some(header => header.id === added.status.member.sessionId)) {
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    expect((await ctx.sessionPersistence.list()).some(header => header.id === added.status.member.sessionId)).toBe(true)
    expect(archived).toContain(added.status.member.sessionId)
    expect(archived).not.toContain(cleared.status.member.sessionId)

    // Private memory and the workspace binding survive.
    await expect(access(join(added.status.member.privateMemoryPath, 'notes', 'kept.md'))).resolves.toBeUndefined()
    expect(ctx.agentTeam.memberForAgent(liveAfter)).toEqual(cleared.status.member)

    // The renewal replays cleanly and dedupes by request.
    expect(() => ctx.agentTeam.validateLedger()).not.toThrow()
    const again = await ctx.agentTeam.clearMemberContext({ requestId: requestId('clear'), workspaceId, memberId: added.status.member.memberId })
    expect(again.receipt.operationId).toBe(cleared.receipt.operationId)
    expect(again.status.member.sessionId).toBe(cleared.status.member.sessionId)

    // Guards: unknown and suspended Members cannot clear.
    await expect(ctx.agentTeam.clearMemberContext({ requestId: requestId('clear-unknown'), workspaceId, memberId: 'member:missing' as AgentTeamMemberId })).rejects.toThrow(/unknown Member/)
    await ctx.agentTeam.suspendMember({ requestId: requestId('clear-suspend'), memberId: added.status.member.memberId })
    await expect(ctx.agentTeam.clearMemberContext({ requestId: requestId('clear-suspended'), workspaceId, memberId: added.status.member.memberId }))
      .rejects.toThrow(/only enabled Members can start from a new context/)
  })

  it('surfaces an orphaned preset composition and rebuilds the Member on resume', async () => {
    const { ctx, workspaceId, presets } = await realHarness()
    const added = await ctx.agentTeam.addMember({ requestId: requestId('add'), workspaceId, handle: 'builder', description: 'Builds the implementation', presetId: 'team-member', channelRefs: [] })
    expect(added.status.presence).toBe('available')
    const live = ctx.agents.get(added.status.member.sessionId)!
    expect(ctx.agentPresets.serviceFor(live, 'compaction')).toBeDefined()

    // Arm the orphan seam: this agent now resolves no preset composition,
    // as members composed before a bundle-row reload do after it.
    presets.orphaned.add(live.ctx)
    const orphaned = ctx.agentTeam.members().find(member => member.member.memberId === added.status.member.memberId)!
    expect(orphaned.presence).toBe('error')
    expect(orphaned.diagnostic).toContain('preset composition was lost')

    const recovered = await ctx.agentTeam.recoverMember({ requestId: requestId('recover'), workspaceId, memberId: added.status.member.memberId })
    expect(recovered.status.presence).toBe('available')
    const rebuilt = ctx.agents.get(added.status.member.sessionId)!
    expect(rebuilt).not.toBe(live)
    expect(ctx.agentPresets.serviceFor(rebuilt, 'compaction')).toBeDefined()
    expect(ctx.tools.schemas(rebuilt).length).toBeGreaterThan(0)
  })

  it('renews an error Member from a new context, healing the broken composition', async () => {
    const { ctx, workspaceId, presets, archived } = await realHarness()
    const added = await ctx.agentTeam.addMember({ requestId: requestId('add'), workspaceId, handle: 'builder', description: 'Builds the implementation', presetId: 'team-member', channelRefs: [] })
    const live = ctx.agents.get(added.status.member.sessionId)!

    // An error Member keeps its live idle handle, so starting from a new
    // context must work for it too — and doubles as a recovery path.
    presets.orphaned.add(live.ctx)
    const orphaned = ctx.agentTeam.members().find(member => member.member.memberId === added.status.member.memberId)!
    expect(orphaned.presence).toBe('error')

    const cleared = await ctx.agentTeam.clearMemberContext({ requestId: requestId('clear'), workspaceId, memberId: added.status.member.memberId })
    expect(cleared.status.presence).toBe('available')
    expect(cleared.status.member.sessionId).not.toBe(added.status.member.sessionId)
    expect(archived).toContain(added.status.member.sessionId)
    const renewed = ctx.agents.get(cleared.status.member.sessionId)!
    expect(renewed).not.toBe(live)
    expect(ctx.agentPresets.serviceFor(renewed, 'compaction')).toBeDefined()
    expect(ctx.tools.schemas(renewed).length).toBeGreaterThan(0)
  })

  it('restarts a Member whose activation failed and rejects restart for suspended Members', async () => {
    const { ctx, workspaceId, presets } = await realHarness()
    presets.failingMount = true
    const added = await ctx.agentTeam.addMember({ requestId: requestId('add'), workspaceId, handle: 'builder', description: 'Builds the implementation', presetId: 'team-member', channelRefs: [] })
    expect(added.status.availability).toBe('unavailable')
    expect(added.status.presence).toBe('unavailable')
    expect(added.status.diagnostic).toContain('failed to load')
    expect(ctx.agents.get(added.status.member.sessionId)).toBeUndefined()

    presets.failingMount = false
    const restarted = await ctx.agentTeam.recoverMember({ requestId: requestId('restart'), workspaceId, memberId: added.status.member.memberId })
    expect(restarted.status.availability).toBe('active')
    expect(restarted.status.member.sessionId).toBe(added.status.member.sessionId)
    const live = ctx.agents.get(restarted.status.member.sessionId)!
    expect(ctx.tools.schemas(live).length).toBeGreaterThan(0)
    // Restart is runtime-only: the durable ledger stays replay-consistent.
    expect(() => ctx.agentTeam.validateLedger()).not.toThrow()

    await ctx.agentTeam.suspendMember({ requestId: requestId('suspend'), memberId: added.status.member.memberId })
    await expect(ctx.agentTeam.recoverMember({ requestId: requestId('restart-suspended'), workspaceId, memberId: added.status.member.memberId }))
      .rejects.toThrow('only enabled Members can be restarted')
  })

  it('creates a Member with no description and no Channels and lights delivery on join', async () => {
    const { ctx, workspaceId, teamFiber } = await realHarness()
    const bare = await ctx.agentTeam.addMember({ requestId: requestId('bare'), workspaceId, handle: 'bare', description: '', presetId: 'team-member', channelRefs: [] })
    expect(bare.status.availability).toBe('active')
    expect(bare.status.member.description).toBe('')
    // The invariant companion replays the same durable record shape; an empty
    // initial Channel list is valid and must not be rejected as divergent.
    expect(() => ctx.agentTeam.validateLedger()).not.toThrow()
    await teamFiber.dispose()
    await ctx.plugin(AgentTeam)
    expect(ctx.agentTeam.status().agentMemberCount).toBe(1)
    const agent = ctx.agents.get(bare.status.member.sessionId)!
    expect(agent).toBeDefined()

    // A message to an empty Channel commits with an empty notification set.
    const channel = await ctx.agentTeam.createChannel({ requestId: requestId('bare-channel'), workspaceId, name: 'ops', description: 'Ops work' })
    const before = await ctx.agentTeam.sendMessage({ asTask: true, requestId: requestId('pre-join'), workspaceId, channelRef: channel.channel.channelRef, body: 'Posted before anyone joined' })
    expect(before.kind).toBe('committed')
    expect(ctx.agentTeam.inboxForAgent(agent, { workspaceId })).toEqual({ items: [], totalUnreadCount: 0, totalDirectCount: 0 })

    // Joining a Channel lights the whole delivery chain for later mentions.
    await ctx.agentTeam.joinChannel({ requestId: requestId('join'), workspaceId, channelRef: channel.channel.channelRef, memberId: bare.status.member.memberId })
    const after = await ctx.agentTeam.sendMessage({ asTask: true, requestId: requestId('post-join'), workspaceId, channelRef: channel.channel.channelRef, body: 'Pinged after joining', recipients: [bare.status.member.memberId] })
    expect(after.kind).toBe('committed')
    if (after.kind !== 'committed') throw new Error(`expected committed post-join mention, received ${after.kind}`)
    expect(ctx.agentTeam.inboxForAgent(agent, { workspaceId })).toMatchObject({ totalUnreadCount: 1, totalDirectCount: 1,
      items: [expect.objectContaining({ task: expect.objectContaining({ taskRef: after.task!.taskRef }), directCount: 1 })] })
  })

  it('creates, suspends, resumes, and removes a Member with a current DSH SQLite Session database', async () => {
    const { ctx, workspaceId } = await realHarness(new EmptyAdapter(), 'sqlite')
    const channel = await ctx.agentTeam.createChannel({ requestId: requestId('sqlite-channel'), workspaceId, name: 'engineering', description: 'Engineering work' })
    const added = await ctx.agentTeam.addMember({ requestId: requestId('sqlite-add'), workspaceId, handle: 'sqlite-builder', description: 'Builds the implementation', presetId: 'team-member', channelRefs: [channel.channel.channelRef] })
    expect(added.status.availability).toBe('active')

    await ctx.agentTeam.suspendMember({ requestId: requestId('sqlite-suspend'), memberId: added.status.member.memberId })
    const resumed = await ctx.agentTeam.resumeMember({ requestId: requestId('sqlite-resume'), memberId: added.status.member.memberId })
    expect(resumed.status.availability).toBe('active')
    expect(resumed.status.member.sessionId).toBe(added.status.member.sessionId)

    const removed = await ctx.agentTeam.removeMember({ requestId: requestId('sqlite-remove'), memberId: added.status.member.memberId })
    expect(removed.member.state).toBe('inactive')
  })

  it('requires referenced Channel authority and rejects an incomplete Team preset before publication', async () => {
    const { ctx, workspaceId } = await realHarness()
    const channel = await ctx.agentTeam.createChannel({ requestId: requestId('channel'), workspaceId, name: 'engineering', description: 'Engineering work' })
    await expect(ctx.agentTeam.addMember({ requestId: requestId('wrong-workspace'), workspaceId, handle: 'wrong', description: 'Wrong channel', presetId: 'team-member', channelRefs: ['channel:missing' as AgentTeamChannelRef] })).rejects.toThrow(/unknown Channel/)
    const first = await ctx.agentTeam.addMember({ requestId: requestId('first'), workspaceId, handle: 'first', description: 'First', presetId: 'team-member', channelRefs: [channel.channel.channelRef] })
    await expect(ctx.agentTeam.addMember({ requestId: requestId('duplicate'), workspaceId, handle: 'FIRST', description: 'Duplicate', presetId: 'team-member', channelRefs: [channel.channel.channelRef] })).rejects.toThrow(/already active/)
    expect(first.status.member.state).toBe('enabled')
  })

  it('runs the five-tool pull protocol through one live Team Member', async () => {
    const { ctx, workspaceId } = await realHarness()
    const channel = await ctx.agentTeam.createChannel({ requestId: requestId('protocol-channel'), workspaceId, name: 'engineering', description: 'Engineering work' })
    const builder = await ctx.agentTeam.addMember({ requestId: requestId('protocol-builder'), workspaceId, handle: 'builder', description: 'Builds changes', presetId: 'team-member', channelRefs: [channel.channel.channelRef] })
    const reviewer = await ctx.agentTeam.addMember({ requestId: requestId('protocol-reviewer'), workspaceId, handle: 'reviewer', description: 'Reviews changes', presetId: 'team-member', channelRefs: [channel.channel.channelRef] })
    const agent = ctx.agents.get(builder.status.member.sessionId)!
    let callNumber = 0
    const call = async (name: string, args: unknown) => {
      const result = await ctx.tools.execute({ signal: new AbortController().signal, callId: CallId(`team-protocol-${++callNumber}`), name, arguments: args, agent })
      expect(result.isError).toBe(false)
      expect(result.concludesTurn).toBeUndefined()
      if (result.isError) throw new Error(result.error.message)
      return result.value as Record<string, any>
    }

    const discovered = await call('team_view', {})
    expect(discovered.channels).toEqual([{ channelRef: channel.channel.channelRef, name: 'engineering' }])
    expect(discovered.members).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'human' }),
      expect.objectContaining({ memberId: builder.status.member.memberId, handle: 'builder' }),
      expect.objectContaining({ memberId: reviewer.status.member.memberId, handle: 'reviewer' }),
    ]))
    expect(discovered).not.toHaveProperty('items')
    expect(ctx.tools.schemas(agent).every(schema => !Object.hasOwn(schema.parameters.properties ?? {}, 'workspaceId'))).toBe(true)

    // team_message attachments: the tool passes absolute paths, the Host
    // validates and copies them into the cache, and the committed message
    // carries the same metadata and prompt lines as a manual upload.
    const shotPath = join(process.env.DSH_HOME!, 'protocol-shot.png')
    await writeFile(shotPath, Buffer.from('png-bytes'))
    const shotMessage = await call('team_message', { action: 'start', channelRef: channel.channel.channelRef,
      body: 'Agent-created task with a screenshot', attachments: [shotPath] })
    expect(shotMessage).toMatchObject({ kind: 'committed' })
    const shotThreadRef = (shotMessage as { threadRef: string }).threadRef
    const shotHistory = ctx.agentTeam.threadHistory({ workspaceId, threadRef: shotThreadRef as never })
    const shotFact = shotHistory.facts.find(fact => fact.kind === 'message' && fact.message.attachments !== undefined)
    expect(shotFact).toBeDefined()
    expect(shotHistory.facts.some(fact => fact.kind === 'message' && /\[attachment\] .*attachments\/v1\//.test(fact.message?.body ?? ''))).toBe(true)
    const rejected = await ctx.tools.execute({ signal: new AbortController().signal, callId: CallId(`team-protocol-bad-${++callNumber}`), name: 'team_message', arguments: { action: 'start', channelRef: channel.channel.channelRef, body: 'Never committed', attachments: ['relative/shot.png'] }, agent })
    expect(rejected.isError).toBe(true)
    expect(rejected.error?.message ?? rejected.value).toMatch(/must be absolute/)
    expect(ctx.agentTeam.threadHistory({ workspaceId, threadRef: shotThreadRef as never }).facts.some(fact => fact.kind === 'message' && fact.message?.body === 'Never committed')).toBe(false)

    const agentStarted = await call('team_message', { action: 'start', channelRef: channel.channel.channelRef,
      body: 'Agent-created task for Human', mentions: [AGENT_TEAM_HUMAN_MEMBER_ID] })
    expect(agentStarted).toMatchObject({ kind: 'committed' })
    expect(ctx.agentTeam.inbox({ workspaceId })).toMatchObject({ totalDirectCount: 1,
      items: [expect.objectContaining({ directCount: 1 })] })
    expect(await call('team_thread', { action: 'unfollow', threadRef: agentStarted.threadRef })).toMatchObject({ kind: 'unfollow', following: false })
    expect(await call('team_thread', { action: 'follow', threadRef: agentStarted.threadRef })).toMatchObject({ kind: 'follow', following: true })

    const enrolled = await call('team_message', { action: 'start', channelRef: channel.channel.channelRef,
      body: 'Agent-led task for the reviewer', mentions: [reviewer.status.member.memberId] })
    expect(enrolled).toMatchObject({ kind: 'committed', threadRef: expect.any(String) })
    const enrolledThreadRef = (enrolled as { threadRef: string }).threadRef
    const reviewerAgent = ctx.agents.get(reviewer.status.member.sessionId)!
    const reviewerInbox = ctx.agentTeam.inboxForAgent(reviewerAgent, { workspaceId })
    expect(reviewerInbox).toMatchObject({ totalDirectCount: 1,
      items: [expect.objectContaining({ thread: expect.objectContaining({ threadRef: enrolledThreadRef }), directCount: 1 })] })
    expect(reviewerInbox.items[0]!.task).toBeUndefined()
    expect(ctx.agentTeam.attentionStatusForAgent(reviewerAgent, { workspaceId, threadRef: enrolledThreadRef as never }).attention).toBeDefined()

    const started = await ctx.agentTeam.sendMessage({ asTask: true, requestId: requestId('protocol-task'), workspaceId, channelRef: channel.channel.channelRef, body: 'Investigate the pull protocol' })
    if (started.kind !== 'committed') throw new Error(`expected committed start, received ${started.kind}`)
    const background = await ctx.agentTeam.reply({ requestId: requestId('protocol-background'), workspaceId, taskRef: started.task!.taskRef, body: 'Older context', baseRevision: started.thread.revision })
    if (background.kind !== 'committed') throw new Error(`expected committed background, received ${background.kind}`)
    const held = await ctx.agentTeam.reply({ requestId: requestId('protocol-invite'), workspaceId, taskRef: started.task!.taskRef, body: 'Builder, please investigate', baseRevision: background.thread.revision, recipients: [builder.status.member.memberId] })
    if (held.kind !== 'confirmation_required') throw new Error(`expected confirmation, received ${held.kind}`)
    const invitation = await ctx.agentTeam.reply({ requestId: requestId('protocol-invite-confirmed'), workspaceId, taskRef: started.task!.taskRef, body: 'Builder, please investigate', baseRevision: background.thread.revision, recipients: [builder.status.member.memberId], confirmationToken: held.confirmationToken })
    if (invitation.kind !== 'committed') throw new Error(`expected committed invitation, received ${invitation.kind}`)

    const inbox = await call('team_inbox', {})
    expect(inbox).toMatchObject({ totalDirectCount: 1, items: [expect.objectContaining({ taskRef: started.task!.taskRef, directCount: 1 })] })
    expect(JSON.stringify(inbox)).not.toContain('Builder, please investigate')

    const firstRead = await call('team_thread', { action: 'read', taskRef: started.task!.taskRef })
    expect(firstRead).toMatchObject({
      kind: 'read', taskRef: started.task!.taskRef, status: 'todo', resolution: 'open', following: true,
      anchor: { body: 'Investigate the pull protocol' }, claims: [],
    })
    expect(firstRead.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ body: 'Older context', unread: false }),
      expect.objectContaining({ body: 'Builder, please investigate', unread: true, direct: true }),
    ]))

    const update = await ctx.agentTeam.reply({ requestId: requestId('protocol-update'), workspaceId, taskRef: started.task!.taskRef, body: 'New evidence', baseRevision: invitation.thread.revision })
    if (update.kind !== 'committed') throw new Error(`expected committed update, received ${update.kind}`)
    expect(await call('team_message', { action: 'reply', taskRef: started.task!.taskRef, body: 'Premature reply', baseRevision: invitation.thread.revision }))
      .toMatchObject({ kind: 'unread_required', revision: update.thread.revision, unreadCount: 1 })
    await call('team_thread', { action: 'read', taskRef: started.task!.taskRef })
    expect(await call('team_message', { action: 'reply', taskRef: started.task!.taskRef, body: 'Stale reply', baseRevision: invitation.thread.revision }))
      .toMatchObject({ kind: 'stale_revision', expectedRevision: invitation.thread.revision, revision: update.thread.revision })
    const reply = await call('team_message', { action: 'reply', taskRef: started.task!.taskRef, body: 'Current reply', baseRevision: update.thread.revision })
    expect(reply).toMatchObject({ kind: 'committed', taskRef: started.task!.taskRef })

    expect(await call('team_thread', { action: 'unfollow', taskRef: started.task!.taskRef })).toMatchObject({ following: false })
    const claim = await call('team_claim', { action: 'claim', taskRef: started.task!.taskRef, direction: 'implementation', baseRevision: reply.revision })
    expect(claim).toMatchObject({ kind: 'committed', threadRef: started.thread.threadRef, status: 'in_progress', claims: [expect.objectContaining({ owner: builder.status.member.memberId, direction: 'implementation', state: 'active' })] })
    expect(await call('team_thread', { action: 'status', taskRef: started.task!.taskRef })).toMatchObject({ following: true })
    expect(await call('team_claim', { action: 'list', taskRef: started.task!.taskRef })).toMatchObject({ kind: 'listed', claims: [expect.objectContaining({ direction: 'implementation' })] })
    const done = await call('team_claim', { action: 'done', taskRef: started.task!.taskRef, claimRef: claim.claims[0].claimRef, baseRevision: claim.revision })
    expect(done).toMatchObject({ kind: 'committed', status: 'in_review', claims: [expect.objectContaining({ state: 'done' })] })
    const secondClaim = await call('team_claim', { action: 'claim', taskRef: started.task!.taskRef, direction: 'follow-up', baseRevision: done.revision })
    const released = await call('team_claim', { action: 'release', taskRef: started.task!.taskRef, claimRef: secondClaim.claims[1].claimRef, baseRevision: secondClaim.revision })
    expect(released).toMatchObject({ kind: 'committed', claims: expect.arrayContaining([expect.objectContaining({ direction: 'follow-up', state: 'released' })]) })

    const humanReadAfterClaims = await ctx.agentTeam.readThread({ requestId: requestId('protocol-human-read-after-claims'), workspaceId,
      taskRef: started.task!.taskRef })
    const unreadAfterClaims = await ctx.agentTeam.reply({ requestId: requestId('protocol-history-unread'), workspaceId,
      taskRef: started.task!.taskRef, body: 'Unread during history', baseRevision: humanReadAfterClaims.thread.revision })
    if (unreadAfterClaims.kind !== 'committed') throw new Error(`expected committed history update, received ${unreadAfterClaims.kind}`)
    const history = await call('team_thread', { action: 'history', taskRef: started.task!.taskRef, limit: 2 })
    expect(history).toMatchObject({ kind: 'history', anchor: { body: 'Investigate the pull protocol' }, claims: expect.arrayContaining([expect.objectContaining({ direction: 'implementation' })]) })
    expect(typeof history.cursor).toBe('number')
    expect(await call('team_inbox', {})).toMatchObject({ totalUnreadCount: 1, items: [expect.objectContaining({ taskRef: started.task!.taskRef })] })
    expect(await call('team_message', { action: 'reply', taskRef: started.task!.taskRef, body: 'History did not read', baseRevision: unreadAfterClaims.thread.revision }))
      .toMatchObject({ kind: 'unread_required', unreadCount: 1 })
    await call('team_thread', { action: 'read', taskRef: started.task!.taskRef })
    expect(await call('team_inbox', {})).toMatchObject({ totalUnreadCount: 0, items: [] })
  })

  it('delivers a direct message through the tool and injects it into the live recipient session', async () => {
    const adapter = new ScriptedAdapter()
    const { ctx, workspaceId } = await realHarness(adapter)
    const channel = await ctx.agentTeam.createChannel({ requestId: requestId('dm-channel'), workspaceId, name: 'engineering', description: 'Engineering work' })
    const builder = await ctx.agentTeam.addMember({ requestId: requestId('dm-builder'), workspaceId, handle: 'builder', description: 'Builds changes', presetId: 'team-member', channelRefs: [channel.channel.channelRef] })
    const reviewer = await ctx.agentTeam.addMember({ requestId: requestId('dm-reviewer'), workspaceId, handle: 'reviewer', description: 'Reviews changes', presetId: 'team-member', channelRefs: [channel.channel.channelRef] })
    const sender = ctx.agents.get(builder.status.member.sessionId)!
    const recipient = ctx.agents.get(reviewer.status.member.sessionId)!
    let callNumber = 0
    const call = async (name: string, args: unknown) => {
      const result = await ctx.tools.execute({ signal: new AbortController().signal, callId: CallId(`team-dm-${++callNumber}`), name, arguments: args, agent: sender })
      expect(result.isError).toBe(false)
      if (result.isError) throw new Error(result.error.message)
      return result.value as Record<string, any>
    }

    // The recipient's model answers briefly; the DM relay is one user turn.
    const sent = await call('team_message', { action: 'dm', memberRef: reviewer.status.member.memberId, body: 'quick check: is the build green?' })
    expect(sent).toMatchObject({ kind: 'dm-sent', recipientMemberId: reviewer.status.member.memberId, recipientHandle: 'reviewer', delivered: true })

    // The injected relay carries the DM body, the sender attribution, and the
    // plugin relay source; it is durable in the recipient's session log.
    adapter.enqueue(textResponse('Build is green.'))
    await waitForIdle(ctx, recipient)
    const relay = recipient.session.events.findLast(event => event.type === 'user/message'
      && (event.data as { source?: { form?: string } }).source?.form === 'relay')
    expect(relay).toBeDefined()
    const relayData = relay!.data as { content: Array<{ type: string; text: string }>; source: { kind: string; plugin: string; form: string } }
    expect(relayData.source).toMatchObject({ kind: 'plugin', form: 'relay' })
    expect(relayData.content[0]!.text).toContain('Direct message from @builder')
    expect(relayData.content[0]!.text).toContain('quick check: is the build green?')

    // Audit-only: no Thread or Message appears in the Channel, and neither
    // Member's Inbox gains unread work from the DM.
    const view = ctx.agentTeam.view({ workspaceId })
    expect(view.threads).toHaveLength(0)
    expect(view.items).toHaveLength(0)
    expect(ctx.agentTeam.inboxForAgent(recipient, { workspaceId })).toEqual({ items: [], totalUnreadCount: 0, totalDirectCount: 0 })
    expect(() => ctx.agentTeam.validateLedger()).not.toThrow()

    // A second DM carries the bounded adjacent context of the first exchange.
    const second = await call('team_message', { action: 'dm', memberRef: reviewer.status.member.memberId, body: 'still green?' })
    expect(second).toMatchObject({ kind: 'dm-sent', delivered: true })
    adapter.enqueue(textResponse('Still green.'))
    await waitForIdle(ctx, recipient)
    const relays = recipient.session.events.filter(event => event.type === 'user/message'
      && (event.data as { source?: { form?: string } }).source?.form === 'relay')
    expect(relays).toHaveLength(2)
    expect((relays[1]!.data as { content: Array<{ type: string; text: string }> }).content[0]!.text).toContain('most recent prior DM')

    // Parameter matrix: human recipients, unknown Members, and stray fields.
    const bad = await ctx.tools.execute({ signal: new AbortController().signal, callId: CallId(`team-dm-bad-${++callNumber}`), name: 'team_message', arguments: { action: 'dm', memberRef: AGENT_TEAM_HUMAN_MEMBER_ID, body: 'hi' }, agent: sender })
    expect(bad.isError).toBe(true)
    expect(bad.error?.message ?? '').toMatch(/Agent Member/)
    const unknown = await ctx.tools.execute({ signal: new AbortController().signal, callId: CallId(`team-dm-unknown-${++callNumber}`), name: 'team_message', arguments: { action: 'dm', memberRef: 'member:nobody', body: 'hi' }, agent: sender })
    expect(unknown.isError).toBe(true)
    const stray = await ctx.tools.execute({ signal: new AbortController().signal, callId: CallId(`team-dm-stray-${++callNumber}`), name: 'team_message', arguments: { action: 'dm', memberRef: reviewer.status.member.memberId, body: 'hi', channelRef: channel.channel.channelRef }, agent: sender })
    expect(stray.isError).toBe(true)
    expect(stray.error?.message ?? '').toMatch(/does not accept/)

    // A suspended peer is not a sendable target: the ledger rejects the send
    // outright (nothing is recorded), which is the pre-delivery guard.
    await ctx.agentTeam.suspendMember({ requestId: requestId('dm-suspend'), memberId: reviewer.status.member.memberId })
    const suspended = await ctx.tools.execute({ signal: new AbortController().signal, callId: CallId(`team-dm-suspended-${++callNumber}`), name: 'team_message', arguments: { action: 'dm', memberRef: reviewer.status.member.memberId, body: 'are you back?' }, agent: sender })
    expect(suspended.isError).toBe(true)
    expect(suspended.error?.message ?? '').toMatch(/suspended/)
    expect(() => ctx.agentTeam.validateLedger()).not.toThrow()

    // Missing live session: an enabled Member whose handle is gone records
    // the DM durably but surfaces the structured delivery error to the sender.
    await ctx.agentTeam.resumeMember({ requestId: requestId('dm-resume'), memberId: reviewer.status.member.memberId })
    ctx.agentTeam['handles'].delete(reviewer.status.member.memberId)
    await expect(ctx.agentTeam.dmForAgent(sender, { requestId: requestId('dm-undelivered'), workspaceId,
      recipientMemberId: reviewer.status.member.memberId, body: 'are you back?' })).rejects.toMatchObject({ name: 'AgentTeamDmDeliveryError' })
    expect(() => ctx.agentTeam.validateLedger()).not.toThrow()
  })

  it('returns a rejected Team result to the next model step without ending the turn', async () => {
    const adapter = new ScriptedAdapter()
    const { ctx, workspaceId } = await realHarness(adapter)
    const channel = await ctx.agentTeam.createChannel({ requestId: requestId('loop-channel'), workspaceId, name: 'engineering', description: 'Engineering work' })
    const builder = await ctx.agentTeam.addMember({ requestId: requestId('loop-builder'), workspaceId, handle: 'builder', description: 'Builds changes', presetId: 'team-member', channelRefs: [channel.channel.channelRef] })
    const agent = ctx.agents.get(builder.status.member.sessionId)!
    const started = await ctx.agentTeam.sendMessage({ asTask: true, requestId: requestId('loop-start'), workspaceId, channelRef: channel.channel.channelRef, body: 'Investigate the rejection flow' })
    if (started.kind !== 'committed') throw new Error(`expected committed start, received ${started.kind}`)
    await ctx.agentTeam.changeAttentionForAgent(agent, { requestId: requestId('loop-follow'), workspaceId,
      taskRef: started.task!.taskRef, action: 'follow' })
    const firstRead = await ctx.agentTeam.readThreadForAgent(agent, { requestId: requestId('loop-read'), workspaceId,
      taskRef: started.task!.taskRef })
    const update = await ctx.agentTeam.reply({ requestId: requestId('loop-update'), workspaceId,
      taskRef: started.task!.taskRef, body: 'Newer context arrived', baseRevision: firstRead.thread.revision })
    if (update.kind !== 'committed') throw new Error(`expected committed update, received ${update.kind}`)

    adapter.enqueue(toolCallResponse('model-team-view', 'team_view', {}))
    adapter.enqueue(toolCallResponse('model-team-rejected', 'team_message', { action: 'reply',
      taskRef: started.task!.taskRef, body: 'Premature reply', baseRevision: update.thread.revision }))
    adapter.enqueue(textResponse('I will read the Thread before replying.'))

    // The committed Human update leaves durable unread work, so its pending
    // hint wakes the idle Member; that wake carries the model steps under test.
    const idle = waitForIdle(ctx, agent)
    await idle

    expect(adapter.requests).toHaveLength(3)
    const afterRejection = JSON.stringify(adapter.requests[2]!.messages)
    expect(afterRejection).toContain(started.task!.taskRef)
    expect(afterRejection).toContain('unread_required')
    const results = agent.session.events.filter(event => event.type === 'tool/result')
    expect(results).toHaveLength(2)
    expect(results.map(result => result.data.message.content[0])).toEqual([
      expect.objectContaining({ type: 'tool-result', isError: false }),
      expect.objectContaining({ type: 'tool-result', isError: false }),
    ])
  })

  it('coalesces updates and delivers a running Member hint only at the next step boundary', async () => {
    const adapter = new GatedAdapter()
    const { ctx, workspaceId } = await realHarness(adapter)
    const channel = await ctx.agentTeam.createChannel({ requestId: requestId('safe-channel'), workspaceId, name: 'engineering', description: 'Engineering work' })
    const builder = await ctx.agentTeam.addMember({ requestId: requestId('safe-builder'), workspaceId, handle: 'builder', description: 'Builds changes', presetId: 'team-member', channelRefs: [channel.channel.channelRef] })
    const agent = ctx.agents.get(builder.status.member.sessionId)!
    const started = await ctx.agentTeam.sendMessage({ asTask: true, requestId: requestId('safe-task'), workspaceId, channelRef: channel.channel.channelRef, body: 'Investigate safe delivery' })
    if (started.kind !== 'committed') throw new Error(`expected committed start, received ${started.kind}`)
    await ctx.agentTeam.changeAttentionForAgent(agent, { requestId: requestId('safe-follow'), workspaceId, taskRef: started.task!.taskRef, action: 'follow' })
    let revision = (await ctx.agentTeam.readThread({ requestId: requestId('safe-human-read'), workspaceId, taskRef: started.task!.taskRef })).thread.revision
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Start ordinary project work.' }], source: { kind: 'user' } }))
    await adapter.started.promise

    const first = await ctx.agentTeam.reply({ requestId: requestId('safe-update-1'), workspaceId, taskRef: started.task!.taskRef, body: 'First hidden update', baseRevision: revision })
    if (first.kind !== 'committed') throw new Error(`expected committed reply, received ${first.kind}`)
    revision = first.thread.revision
    const second = await ctx.agentTeam.reply({ requestId: requestId('safe-update-2'), workspaceId, taskRef: started.task!.taskRef, body: 'Second hidden update', baseRevision: revision })
    if (second.kind !== 'committed') throw new Error(`expected committed reply, received ${second.kind}`)
    expect(adapter.requests).toHaveLength(1)
    adapter.enqueue(textResponse('I will triage Team Inbox next.'))
    adapter.release.resolve()
    await agent.whenIdle()

    expect(adapter.requests).toHaveLength(2)
    const safeBoundaryRequest = JSON.stringify(adapter.requests[1]!.messages)
    expect(safeBoundaryRequest).toContain('Team Inbox has unread work')
    expect(safeBoundaryRequest).toContain(started.task!.taskRef)
    expect(safeBoundaryRequest).toContain('2 unread updates')
    expect(safeBoundaryRequest).not.toContain('First hidden update')
    expect(safeBoundaryRequest).not.toContain('Second hidden update')
    const hints = agent.session.events.filter(event => event.type === 'user/message'
      && JSON.stringify(event.data).includes('Team Inbox has unread work'))
    expect(hints).toHaveLength(1)
  })

  it('wakes an idle Member with a direct mention body and source', async () => {
    const adapter = new ScriptedAdapter()
    const { ctx, workspaceId } = await realHarness(adapter)
    const channel = await ctx.agentTeam.createChannel({ requestId: requestId('top-level-wake-channel'), workspaceId, name: 'engineering', description: 'Engineering work' })
    const builder = await ctx.agentTeam.addMember({ requestId: requestId('top-level-wake-builder'), workspaceId, handle: 'builder', description: 'Builds changes', presetId: 'team-member', channelRefs: [channel.channel.channelRef] })
    const agent = ctx.agents.get(builder.status.member.sessionId)!
    const committed = await ctx.agentTeam.sendMessage({ asTask: true, requestId: requestId('top-level-wake'), workspaceId, channelRef: channel.channel.channelRef,
      body: 'Please investigate the top-level wake path', recipients: [builder.status.member.memberId] })
    expect(committed.kind).toBe('committed')
    expect(adapter.requests).toHaveLength(0)

    adapter.enqueue(textResponse('I will inspect the mentioned Task.'))
    if (committed.kind !== 'committed') throw new Error(`expected committed top-level mention, received ${committed.kind}`)
    expect(ctx.agentTeam.inboxForAgent(agent, { workspaceId })).toMatchObject({ totalUnreadCount: 1, totalDirectCount: 1,
      items: [expect.objectContaining({ task: expect.objectContaining({ taskRef: committed.task!.taskRef }), directCount: 1 })] })
    await agent.whenIdle()
    expect(adapter.requests).toHaveLength(1)
    const request = JSON.stringify(adapter.requests[0]!.messages)
    expect(request).toContain('Direct Team mention')
    expect(request).toContain('Please investigate the top-level wake path')
    expect(request).toContain('human')
    expect(request).toContain(committed.task!.taskRef)
  })

  it('delivers an agent-created top-level mention to the mentioned Member', async () => {
    const adapter = new ScriptedAdapter()
    const { ctx, workspaceId } = await realHarness(adapter)
    const channel = await ctx.agentTeam.createChannel({ requestId: requestId('peer-channel'), workspaceId, name: 'engineering', description: 'Engineering work' })
    const starter = await ctx.agentTeam.addMember({ requestId: requestId('peer-starter'), workspaceId, handle: 'starter', description: 'Starts work', presetId: 'team-member', channelRefs: [channel.channel.channelRef] })
    const peer = await ctx.agentTeam.addMember({ requestId: requestId('peer-peer'), workspaceId, handle: 'peer', description: 'Peers in', presetId: 'team-member', channelRefs: [channel.channel.channelRef] })
    const starterAgent = ctx.agents.get(starter.status.member.sessionId)!
    const peerAgent = ctx.agents.get(peer.status.member.sessionId)!
    let callNumber = 0
    const call = async (name: string, args: unknown) => {
      const result = await ctx.tools.execute({ signal: new AbortController().signal,
        callId: CallId(`peer-mention-${++callNumber}`), name, arguments: args, agent: starterAgent })
      if (result.isError) throw new Error(result.error.message)
      return result.value as Record<string, any>
    }

    const started = await call('team_message', { action: 'start', channelRef: channel.channel.channelRef,
      body: 'Peer, please verify the export path', mentions: [peer.status.member.memberId] })
    expect(started).toMatchObject({ kind: 'committed' })

    expect(ctx.agentTeam.inboxForAgent(peerAgent, { workspaceId })).toMatchObject({ totalUnreadCount: 1, totalDirectCount: 1,
      items: [expect.objectContaining({ thread: expect.objectContaining({ threadRef: started.threadRef }), directCount: 1 })] })
    expect(ctx.agentTeam.inboxForAgent(peerAgent, { workspaceId }).items[0]!.task).toBeUndefined()

    adapter.enqueue(textResponse('I will verify the export path.'))
    await peerAgent.whenIdle()
    expect(adapter.requests).toHaveLength(1)
    const request = JSON.stringify(adapter.requests[0]!.messages)
    expect(request).toContain('Direct Team mention')
    expect(request).toContain('Peer, please verify the export path')
    expect(request).toContain('starter')
    expect(request).toContain(started.threadRef)
    expect(request).not.toContain('Task undefined')
    expect(request).toContain('relevant threadRef')
  })

  it('bounds automatic direct context while retaining omitted Messages in durable Inbox', async () => {
    const adapter = new GatedAdapter()
    const { ctx, workspaceId } = await realHarness(adapter)
    const channel = await ctx.agentTeam.createChannel({ requestId: requestId('bounded-channel'), workspaceId,
      name: 'engineering', description: 'Engineering work' })
    const builder = await ctx.agentTeam.addMember({ requestId: requestId('bounded-builder'), workspaceId, handle: 'builder',
      description: 'Builds changes', presetId: 'team-member', channelRefs: [channel.channel.channelRef] })
    const agent = ctx.agents.get(builder.status.member.sessionId)!
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Continue current project work.' }], source: { kind: 'user' } }))
    await adapter.started.promise

    const started = []
    for (let index = 1; index <= 5; index++) {
      const body = `${`x${index}`.repeat(4_500)}\nDIRECT-END-${index}`
      const result = await ctx.agentTeam.sendMessage({ asTask: true, requestId: requestId(`bounded-direct-${index}`), workspaceId,
        channelRef: channel.channel.channelRef, body, recipients: [builder.status.member.memberId] })
      if (result.kind !== 'committed') throw new Error(`expected committed direct Message, received ${result.kind}`)
      started.push(result)
    }
    expect(ctx.agentTeam.inboxForAgent(agent, { workspaceId })).toMatchObject({ totalUnreadCount: 5, totalDirectCount: 5 })

    adapter.enqueue(textResponse('I will inspect the routed Team work.'))
    adapter.release.resolve()
    await agent.whenIdle()
    const request = JSON.stringify(adapter.requests[1]!.messages)
    expect(request).toContain('More unread work remains in team_inbox')
    expect(request).not.toContain('DIRECT-END-5')

    const omitted = await ctx.agentTeam.readThreadForAgent(agent, { requestId: requestId('bounded-read-omitted'), workspaceId,
      taskRef: started[4]!.task!.taskRef })
    expect(omitted.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ direct: true, fact: expect.objectContaining({ kind: 'message', message: expect.objectContaining({ body: expect.stringContaining('DIRECT-END-5') }) }) }),
    ]))
  })

  it('wakes an affected Member with a Task close and released Claim summary', async () => {
    const adapter = new ScriptedAdapter()
    const { ctx, workspaceId } = await realHarness(adapter)
    const channel = await ctx.agentTeam.createChannel({ requestId: requestId('task-update-channel'), workspaceId, name: 'engineering', description: 'Engineering work' })
    const builder = await ctx.agentTeam.addMember({ requestId: requestId('task-update-builder'), workspaceId, handle: 'builder', description: 'Builds changes', presetId: 'team-member', channelRefs: [channel.channel.channelRef] })
    const agent = ctx.agents.get(builder.status.member.sessionId)!
    const started = await ctx.agentTeam.sendMessage({ asTask: true, requestId: requestId('task-update-start'), workspaceId,
      channelRef: channel.channel.channelRef, body: 'Prepare a close notification test' })
    if (started.kind !== 'committed') throw new Error(`expected committed start, received ${started.kind}`)
    await ctx.agentTeam.changeAttentionForAgent(agent, { requestId: requestId('task-update-follow'), workspaceId,
      taskRef: started.task!.taskRef, action: 'follow' })
    const initialRead = await ctx.agentTeam.readThreadForAgent(agent, { requestId: requestId('task-update-agent-read'), workspaceId,
      taskRef: started.task!.taskRef })
    const claim = await ctx.agentTeam.changeClaimForAgent(agent, { requestId: requestId('task-update-claim'), workspaceId,
      taskRef: started.task!.taskRef, action: 'claim', direction: 'browser verification', baseRevision: initialRead.thread.revision })
    expect(claim).toMatchObject({ kind: 'committed', claim: { state: 'active' } })
    if (claim.kind !== 'committed') throw new Error(`expected committed Claim, received ${claim.kind}`)
    const humanRead = await ctx.agentTeam.readThread({ requestId: requestId('task-update-human-read'), workspaceId,
      taskRef: started.task!.taskRef })

    adapter.enqueue(textResponse('I will stop work on the closed Task.'))
    const closed = await ctx.agentTeam.changeTask({ requestId: requestId('task-update-close'), workspaceId,
      taskRef: started.task!.taskRef, action: 'close', baseRevision: humanRead.thread.revision })
    expect(closed).toMatchObject({ kind: 'committed', task: { resolution: 'closed' }, claims: [
      expect.objectContaining({ claimRef: claim.claim.claimRef, state: 'released' }),
    ] })
    await agent.whenIdle()

    expect(adapter.requests).toHaveLength(1)
    const request = JSON.stringify(adapter.requests[0]!.messages)
    expect(request).toContain('Team Task update')
    expect(request).toContain(`human close Task ${started.task!.taskRef}`)
    expect(request).toContain(claim.claim.claimRef)
    expect(request).toContain('Released Claims')
  })

  it('wakes an idle Member from durable Inbox state without injecting Thread bodies', async () => {
    const adapter = new ScriptedAdapter()
    const { ctx, workspaceId } = await realHarness(adapter)
    const channel = await ctx.agentTeam.createChannel({ requestId: requestId('wake-channel'), workspaceId, name: 'engineering', description: 'Engineering work' })
    const builder = await ctx.agentTeam.addMember({ requestId: requestId('wake-builder'), workspaceId, handle: 'builder', description: 'Builds changes', presetId: 'team-member', channelRefs: [channel.channel.channelRef] })
    const agent = ctx.agents.get(builder.status.member.sessionId)!
    const started = await ctx.agentTeam.sendMessage({ asTask: true, requestId: requestId('wake-task'), workspaceId, channelRef: channel.channel.channelRef, body: 'Investigate the wake path' })
    if (started.kind !== 'committed') throw new Error(`expected committed start, received ${started.kind}`)
    await ctx.agentTeam.changeAttentionForAgent(agent, { requestId: requestId('wake-follow'), workspaceId, taskRef: started.task!.taskRef, action: 'follow' })
    const humanRead = await ctx.agentTeam.readThread({ requestId: requestId('wake-human-read'), workspaceId, taskRef: started.task!.taskRef })
    adapter.enqueue(textResponse('I will inspect Team Inbox.'))
    const first = await ctx.agentTeam.reply({ requestId: requestId('wake-reply-1'), workspaceId, taskRef: started.task!.taskRef, body: 'Please inspect the durable wake.', baseRevision: humanRead.thread.revision })
    if (first.kind !== 'committed') throw new Error(`expected committed reply, received ${first.kind}`)
    await agent.whenIdle()
    expect(adapter.requests).toHaveLength(1)
    expect(JSON.stringify(adapter.requests[0]!.messages)).toContain('Team Inbox has unread work')
    expect(JSON.stringify(adapter.requests[0]!.messages)).not.toContain('Please inspect the durable wake.')

    adapter.enqueue(textResponse('I will triage both updates.'))
    const second = await ctx.agentTeam.reply({ requestId: requestId('wake-reply-2'), workspaceId, taskRef: started.task!.taskRef, body: 'A second update should coalesce.', baseRevision: first.thread.revision })
    if (second.kind !== 'committed') throw new Error(`expected committed reply, received ${second.kind}`)
    await agent.whenIdle()
    expect(adapter.requests).toHaveLength(2)
    expect(JSON.stringify(adapter.requests[1]!.messages)).not.toContain('A second update should coalesce.')
  })

  it('recovers a needed hint from durable unread state on Member resume', async () => {
    const adapter = new ScriptedAdapter()
    const { ctx, workspaceId } = await realHarness(adapter)
    const channel = await ctx.agentTeam.createChannel({ requestId: requestId('resume-channel'), workspaceId, name: 'engineering', description: 'Engineering work' })
    const builder = await ctx.agentTeam.addMember({ requestId: requestId('resume-builder'), workspaceId, handle: 'builder', description: 'Builds changes', presetId: 'team-member', channelRefs: [channel.channel.channelRef] })
    const agent = ctx.agents.get(builder.status.member.sessionId)!
    const started = await ctx.agentTeam.sendMessage({ asTask: true, requestId: requestId('resume-task'), workspaceId, channelRef: channel.channel.channelRef, body: 'Investigate resume recovery' })
    if (started.kind !== 'committed') throw new Error(`expected committed start, received ${started.kind}`)
    await ctx.agentTeam.changeAttentionForAgent(agent, { requestId: requestId('resume-follow'), workspaceId, taskRef: started.task!.taskRef, action: 'follow' })
    const humanRead = await ctx.agentTeam.readThread({ requestId: requestId('resume-human-read'), workspaceId, taskRef: started.task!.taskRef })
    await ctx.agentTeam.suspendMember({ requestId: requestId('resume-suspend'), memberId: builder.status.member.memberId })
    const update = await ctx.agentTeam.reply({ requestId: requestId('resume-update'), workspaceId, taskRef: started.task!.taskRef, body: 'Unread while suspended', baseRevision: humanRead.thread.revision })
    if (update.kind !== 'committed') throw new Error(`expected committed reply, received ${update.kind}`)

    adapter.enqueue(textResponse('I will inspect recovered Inbox work.'))
    await ctx.agentTeam.resumeMember({ requestId: requestId('resume-enable'), memberId: builder.status.member.memberId })
    const resumed = ctx.agents.get(builder.status.member.sessionId)!
    await resumed.whenIdle()
    expect(adapter.requests).toHaveLength(1)
    const request = JSON.stringify(adapter.requests[0]!.messages)
    expect(request).toContain('Team Inbox has unread work')
    expect(request).not.toContain('Unread while suspended')
  })

  it('keeps the automatic recovery instruction with durable Inbox routing', async () => {
    vi.useFakeTimers()
    try {
      const adapter = new ScriptedAdapter()
      const { ctx, workspaceId } = await realHarness(adapter)
      const channel = await ctx.agentTeam.createChannel({ requestId: requestId('automatic-recovery-channel'), workspaceId, name: 'engineering', description: 'Engineering work' })
      const builder = await ctx.agentTeam.addMember({ requestId: requestId('automatic-recovery-builder'), workspaceId, handle: 'builder', description: 'Builds changes', presetId: 'team-member', channelRefs: [channel.channel.channelRef] })
      const agent = ctx.agents.get(builder.status.member.sessionId)!
      const started = await ctx.agentTeam.sendMessage({ asTask: true, requestId: requestId('automatic-recovery-task'), workspaceId, channelRef: channel.channel.channelRef, body: 'Investigate automatic recovery' })
      if (started.kind !== 'committed') throw new Error(`expected committed start, received ${started.kind}`)
      await ctx.agentTeam.changeAttentionForAgent(agent, { requestId: requestId('automatic-recovery-follow'), workspaceId, taskRef: started.task!.taskRef, action: 'follow' })
      const humanRead = await ctx.agentTeam.readThread({ requestId: requestId('automatic-recovery-read'), workspaceId, taskRef: started.task!.taskRef })
      const update = await ctx.agentTeam.reply({ requestId: requestId('automatic-recovery-update'), workspaceId, taskRef: started.task!.taskRef, body: 'Unread through automatic recovery', baseRevision: humanRead.thread.revision })
      if (update.kind !== 'committed') throw new Error(`expected committed update, received ${update.kind}`)
      await agent.whenIdle()
      ctx.emit('agent/error', { agent, turn: 2, step: 1, error: new Error('fetch failed') })

      adapter.enqueue(textResponse('I will continue the interrupted work.'))
      await vi.advanceTimersByTimeAsync(RECOVERY_DELAY_MS)
      await agent.whenIdle()

      const request = JSON.stringify(adapter.requests.at(-1)!.messages)
      expect(request).toContain('temporary service error')
      expect(request).toContain('Please continue the work you were doing before the error.')
      expect(request).toContain('Team Inbox has unread work')
      expect(request).toContain(started.task!.taskRef)
      expect(request).not.toContain('Unread through automatic recovery')
      expect(request).not.toMatch(/operator asked|automatic recovery|attempt|stop|handoff/i)
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancels an automatic wakeup when a Member is suspended before the delay', async () => {
    vi.useFakeTimers()
    try {
      const adapter = new ScriptedAdapter()
      const { ctx, workspaceId } = await realHarness(adapter)
      const builder = await ctx.agentTeam.addMember({ requestId: requestId('suspend-recovery-builder'), workspaceId, handle: 'builder', description: 'Builds changes', presetId: 'team-member', channelRefs: [] })
      const agent = ctx.agents.get(builder.status.member.sessionId)!

      ctx.emit('agent/error', { agent, turn: 1, step: 1, error: new Error('fetch failed') })
      await ctx.agentTeam.suspendMember({ requestId: requestId('suspend-recovery'), memberId: builder.status.member.memberId })
      await vi.advanceTimersByTimeAsync(RECOVERY_DELAY_MS)

      expect(adapter.requests).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the manual recovery instruction with durable Inbox routing and cancels the pending wakeup', async () => {
    vi.useFakeTimers()
    try {
      const adapter = new ScriptedAdapter()
      const { ctx, workspaceId } = await realHarness(adapter)
      const channel = await ctx.agentTeam.createChannel({ requestId: requestId('manual-recovery-channel'), workspaceId, name: 'engineering', description: 'Engineering work' })
      const builder = await ctx.agentTeam.addMember({ requestId: requestId('manual-recovery-builder'), workspaceId, handle: 'builder', description: 'Builds changes', presetId: 'team-member', channelRefs: [channel.channel.channelRef] })
      const agent = ctx.agents.get(builder.status.member.sessionId)!
      const started = await ctx.agentTeam.sendMessage({ asTask: true, requestId: requestId('manual-recovery-task'), workspaceId, channelRef: channel.channel.channelRef, body: 'Investigate manual recovery' })
      if (started.kind !== 'committed') throw new Error(`expected committed start, received ${started.kind}`)
      await ctx.agentTeam.changeAttentionForAgent(agent, { requestId: requestId('manual-recovery-follow'), workspaceId, taskRef: started.task!.taskRef, action: 'follow' })
      const humanRead = await ctx.agentTeam.readThread({ requestId: requestId('manual-recovery-read'), workspaceId, taskRef: started.task!.taskRef })
      const update = await ctx.agentTeam.reply({ requestId: requestId('manual-recovery-update'), workspaceId, taskRef: started.task!.taskRef, body: 'Unread through manual recovery', baseRevision: humanRead.thread.revision })
      if (update.kind !== 'committed') throw new Error(`expected committed update, received ${update.kind}`)
      await agent.whenIdle()

      adapter.enqueue(textResponse('I will continue the interrupted work.'))
      await ctx.agentTeam.recoverMember({ requestId: requestId('manual-recovery'), workspaceId, memberId: builder.status.member.memberId })
      await agent.whenIdle()
      await vi.advanceTimersByTimeAsync(RECOVERY_DELAY_MS)

      expect(adapter.requests).toHaveLength(2)
      const request = JSON.stringify(adapter.requests.at(-1)!.messages)
      expect(request).toContain('The operator asked you to resume after the previous turn ended early.')
      expect(request).not.toContain('temporary service error')
      expect(request).toContain('Please continue the work you were doing before the error.')
      expect(request).toContain('Team Inbox has unread work')
      expect(request).toContain(started.task!.taskRef)
      expect(request).not.toContain('Unread through manual recovery')
      expect(request).not.toMatch(/automatic recovery|attempt|stop|handoff/i)
    } finally {
      vi.useRealTimers()
    }
  })

  it('reissues a durable hint when a failed Member starts recovery work', async () => {
    const adapter = new ScriptedAdapter()
    const { ctx, workspaceId } = await realHarness(adapter)
    const channel = await ctx.agentTeam.createChannel({ requestId: requestId('error-channel'), workspaceId, name: 'engineering', description: 'Engineering work' })
    const builder = await ctx.agentTeam.addMember({ requestId: requestId('error-builder'), workspaceId, handle: 'builder', description: 'Builds changes', presetId: 'team-member', channelRefs: [channel.channel.channelRef] })
    const agent = ctx.agents.get(builder.status.member.sessionId)!
    const started = await ctx.agentTeam.sendMessage({ asTask: true, requestId: requestId('error-task'), workspaceId, channelRef: channel.channel.channelRef, body: 'Investigate error recovery' })
    if (started.kind !== 'committed') throw new Error(`expected committed start, received ${started.kind}`)
    await ctx.agentTeam.changeAttentionForAgent(agent, { requestId: requestId('error-follow'), workspaceId, taskRef: started.task!.taskRef, action: 'follow' })
    const humanRead = await ctx.agentTeam.readThread({ requestId: requestId('error-human-read'), workspaceId, taskRef: started.task!.taskRef })
    const update = await ctx.agentTeam.reply({ requestId: requestId('error-update'), workspaceId, taskRef: started.task!.taskRef, body: 'Unread through runtime error', baseRevision: humanRead.thread.revision })
    if (update.kind !== 'committed') throw new Error(`expected committed reply, received ${update.kind}`)
    await agent.whenIdle()
    expect(ctx.agentTeam.members().find(status => status.member.memberId === builder.status.member.memberId)?.presence).toBe('error')

    adapter.enqueue(textResponse('I will recover by inspecting Team Inbox.'))
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Recover now.' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    const request = JSON.stringify(adapter.requests.at(-1)!.messages)
    expect(request).toContain('Team Inbox has unread work')
    expect(request).not.toContain('Unread through runtime error')
  })

  it('reissues a needed hint from durable unread state after Host remount', async () => {
    const adapter = new ScriptedAdapter()
    const { ctx, workspaceId, teamFiber } = await realHarness(adapter)
    const channel = await ctx.agentTeam.createChannel({ requestId: requestId('remount-channel'), workspaceId, name: 'engineering', description: 'Engineering work' })
    const builder = await ctx.agentTeam.addMember({ requestId: requestId('remount-builder'), workspaceId, handle: 'builder', description: 'Builds changes', presetId: 'team-member', channelRefs: [channel.channel.channelRef] })
    const agent = ctx.agents.get(builder.status.member.sessionId)!
    const started = await ctx.agentTeam.sendMessage({ asTask: true, requestId: requestId('remount-task'), workspaceId, channelRef: channel.channel.channelRef, body: 'Investigate remount recovery' })
    if (started.kind !== 'committed') throw new Error(`expected committed start, received ${started.kind}`)
    await ctx.agentTeam.changeAttentionForAgent(agent, { requestId: requestId('remount-follow'), workspaceId, taskRef: started.task!.taskRef, action: 'follow' })
    const humanRead = await ctx.agentTeam.readThread({ requestId: requestId('remount-human-read'), workspaceId, taskRef: started.task!.taskRef })
    const update = await ctx.agentTeam.reply({ requestId: requestId('remount-update'), workspaceId, taskRef: started.task!.taskRef, body: 'Unread across Host remount', baseRevision: humanRead.thread.revision })
    if (update.kind !== 'committed') throw new Error(`expected committed reply, received ${update.kind}`)
    await agent.whenIdle()
    expect(ctx.agentTeam.inboxForAgent(agent, { workspaceId }).totalUnreadCount).toBe(1)

    adapter.enqueue(textResponse('I will inspect remounted Inbox work.'))
    await teamFiber.dispose()
    await ctx.plugin(AgentTeam)
    const restored = ctx.agents.get(builder.status.member.sessionId)!
    await restored.whenIdle()
    const lastRequest = JSON.stringify(adapter.requests.at(-1)!.messages)
    expect(lastRequest).toContain('Team Inbox has unread work')
    expect(lastRequest).not.toContain('Unread across Host remount')
  })

  it('validates the final five-tool Team marker during unpublished setup', async () => {
    expect(AGENT_TEAM_TOOL_NAMES).toEqual(['team_inbox', 'team_thread', 'team_message', 'team_claim', 'team_view'])
    const definition = markAgentTeamPreset({ name: 'team_message' })
    expect(Reflect.get(definition, Symbol.for('@wowyuarm/dsh-agent-team.preset'))).toBe(true)
  })

  it('keeps a persisted Member session active after switching its model and restarting', async () => {
    const adapter = new ScriptedAdapter()
    const { ctx, workspaceId } = await realHarness(adapter)
    const added = await ctx.agentTeam.addMember({
      requestId: requestId('persisted-model-add'), workspaceId, handle: 'builder',
      description: 'Builds the implementation', presetId: 'team-member', channelRefs: [],
      model: { provider: 'mock', model: 'initial-model' },
    })
    const agent = ctx.agents.get(added.status.member.sessionId)!
    adapter.enqueue(textResponse('initial response'))
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Create a persisted transcript.' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    const edited = await ctx.agentTeam.updateMember({
      requestId: requestId('persisted-model-edit'), memberId: added.status.member.memberId,
      handle: 'builder', description: 'Builds the implementation',
      model: { provider: 'mock', model: 'switched-model' },
    })
    expect(edited.status.availability).toBe('active')

    expect(ctx.agents.get(added.status.member.sessionId)).toBeDefined()
  })

  it('applies Member model edits to a live Agent immediately and keeps pinned selections across restarts', async () => {
    const adapter = new ScriptedAdapter()
    const { ctx, workspaceId } = await realHarness(adapter)
    const createSpy = vi.spyOn(ctx.agents, 'create')
    const resumeSpy = vi.spyOn(ctx.agents, 'resume')
    // Activation goes through create or resume depending on whether the
    // Session transcript has been persisted yet; both carry agentOptions.
    const lastActivationOptions = () => {
      const call = resumeSpy.mock.calls.at(-1) ?? createSpy.mock.calls.at(-1)
      expect(call).toBeDefined()
      return call![0]!.agentOptions
    }
    const clearActivationSpies = () => { createSpy.mockClear(); resumeSpy.mockClear() }
    const channel = await ctx.agentTeam.createChannel({ requestId: requestId('model-channel'), workspaceId, name: 'engineering', description: 'Engineering work' })
    const added = await ctx.agentTeam.addMember({
      requestId: requestId('model-add'), workspaceId, handle: 'builder',
      description: 'Builds the implementation', presetId: 'team-member',
      channelRefs: [channel.channel.channelRef], model: { provider: 'mock', model: 'pinned-model' },
    })
    const liveAgent = () => ctx.agents.get(added.status.member.sessionId)!
    // Creation activates with the pinned selection instead of the Host default.
    expect(added.status.member.model).toEqual({ provider: 'mock', model: 'pinned-model' })
    expect(lastActivationOptions()).toMatchObject({ provider: 'mock', model: 'pinned-model' })
    const liveBeforeEdit = liveAgent()

    // Editing the model on the ACTIVE Member updates the live selection in
    // place — the same Session id remains usable by the Web Composer.
    clearActivationSpies()
    const edited = await ctx.agentTeam.updateMember({
      requestId: requestId('re-model'), memberId: added.status.member.memberId,
      handle: 'builder', description: 'Builds the implementation',
      model: { provider: 'mock', model: 'switched-model' },
    })
    expect(edited.status.availability).toBe('active')
    expect(edited.status.member.sessionId).toBe(added.status.member.sessionId)
    expect(liveAgent()).toBe(liveBeforeEdit)
    expect(createSpy).not.toHaveBeenCalled()
    expect(resumeSpy).not.toHaveBeenCalled()
    adapter.enqueue(textResponse('switched response'))
    liveAgent().followup(createUserMessage({ content: [{ type: 'text', text: 'Use the switched model.' }], source: { kind: 'user' } }))
    await liveAgent().whenIdle()
    expect(adapter.requests.at(-1)).toMatchObject({ provider: 'mock', model: 'switched-model' })

    // A display-only edit that re-states the current pin leaves the live
    // Agent untouched; an edit that OMITS model clears the override (below).
    clearActivationSpies()
    await ctx.agentTeam.updateMember({ requestId: requestId('desc-only'), memberId: added.status.member.memberId, handle: 'builder', description: 'Builds things', model: { provider: 'mock', model: 'switched-model' } })
    expect(createSpy).not.toHaveBeenCalled()
    expect(resumeSpy).not.toHaveBeenCalled()
    expect(resumeSpy).not.toHaveBeenCalled()

    // Clearing the override updates the same live Agent back to the Host default.
    clearActivationSpies()
    const cleared = await ctx.agentTeam.updateMember({ requestId: requestId('clear-model'), memberId: added.status.member.memberId, handle: 'builder', description: 'Builds things' })
    expect(cleared.status.member.model).toBeUndefined()
    expect(cleared.status.availability).toBe('active')
    expect(createSpy).not.toHaveBeenCalled()
    expect(resumeSpy).not.toHaveBeenCalled()

    // A pinned selection survives suspend/resume without any further edit.
    await ctx.agentTeam.updateMember({ requestId: requestId('repin'), memberId: added.status.member.memberId, handle: 'builder', description: 'Builds things', model: { provider: 'mock', model: 'pinned-again' } })
    await ctx.agentTeam.suspendMember({ requestId: requestId('suspend'), memberId: added.status.member.memberId })
    clearActivationSpies()
    const resumed = await ctx.agentTeam.resumeMember({ requestId: requestId('resume'), memberId: added.status.member.memberId })
    expect(resumed.status.member.model).toEqual({ provider: 'mock', model: 'pinned-again' })
    expect(lastActivationOptions()).toMatchObject({ provider: 'mock', model: 'pinned-again' })
  })
})
