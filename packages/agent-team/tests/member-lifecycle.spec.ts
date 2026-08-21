import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import AgentPresets from '@deepseek-ai/dsh-agent-presets'
import LlmRuntime, { CallId, createUserMessage, LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SqliteSessionPersistence from '@deepseek-ai/dsh-session-persistence-sqlite'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import AgentTeam, { AGENT_TEAM_HUMAN_MEMBER_ID, AGENT_TEAM_TOOL_NAMES, markAgentTeamPreset } from '../src/index.ts'
import * as memberContext from '../src/member-context.ts'
import { apply as applyAgentTeamTools } from '@wowyuarm/dsh-agent-team/tools'
import type { AgentTeamChannelRef, AgentTeamRequestId } from '../src/types.ts'
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

async function realHarness(
  adapter: LlmAdapter = new EmptyAdapter(),
  persistenceBackend: PersistenceBackend = 'jsonl',
): Promise<{
  readonly ctx: Context
  readonly workspaceId: WorkspaceId
  readonly root: string
  readonly project: string
  readonly teamFiber: Awaited<ReturnType<Context['plugin']>>
}> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-agent-team-member-'))
  const project = join(root, 'project')
  const persistence = join(root, 'sessions')
  const sqlite = join(root, 'sessions.sqlite')
  const presetRoot = join(root, 'presets')
  const presetDir = join(presetRoot, 'team-member')
  await Promise.all([mkdir(project), mkdir(persistence), mkdir(presetDir, { recursive: true })])
  process.env.DSH_HOME = join(root, 'dsh-home')
  await writeFile(join(presetDir, 'agent.cordis.yml'), "- id: member-context\n  name: 'test-member-context'\n- id: team-tools\n  name: 'test-team-tools'\n")

  const ctx = new Context()
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (specifier === 'test-member-context') return memberContext
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
  await ctx.plugin(AgentPresets, { default: 'team-member', roots: [{ path: presetRoot, trust: 'system' }], includeUserRoot: false })
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
  return { ctx, workspaceId, root, project, teamFiber }
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

    const suspended = await ctx.agentTeam.suspendMember({ requestId: requestId('suspend'), memberId: added.status.member.memberId })
    expect(suspended.status.availability).toBe('suspended')
    expect(ctx.agents.get(added.status.member.sessionId)).toBeUndefined()
    const resumed = await ctx.agentTeam.resumeMember({ requestId: requestId('resume'), memberId: added.status.member.memberId })
    expect(resumed.status.availability).toBe('active')
    expect(resumed.status.member.sessionId).toBe(added.status.member.sessionId)

    const removed = await ctx.agentTeam.removeMember({ requestId: requestId('remove'), memberId: added.status.member.memberId })
    expect(removed.member.state).toBe('inactive')
    expect(ctx.agents.get(added.status.member.sessionId)).toBeUndefined()
    await expect(access(added.status.member.privateMemoryPath)).rejects.toThrow()
  })

  it('creates, suspends, resumes, and removes a Member with a new rc.8 SQLite Session database', async () => {
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

  it('requires initial Channel authority and rejects an incomplete Team preset before publication', async () => {
    const { ctx, workspaceId } = await realHarness()
    const channel = await ctx.agentTeam.createChannel({ requestId: requestId('channel'), workspaceId, name: 'engineering', description: 'Engineering work' })
    await expect(ctx.agentTeam.addMember({ requestId: requestId('empty'), workspaceId, handle: 'none', description: 'No channel', presetId: 'team-member', channelRefs: [] })).rejects.toThrow(/at least one initial Channel/)
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

    const agentStarted = await call('team_message', { action: 'start', channelRef: channel.channel.channelRef,
      body: 'Agent-created task for Human', mentions: [AGENT_TEAM_HUMAN_MEMBER_ID] })
    expect(agentStarted).toMatchObject({ kind: 'committed' })
    expect(ctx.agentTeam.inbox({ workspaceId })).toMatchObject({ totalDirectCount: 1,
      items: [expect.objectContaining({ directCount: 1 })] })
    expect(await call('team_thread', { action: 'unfollow', taskRef: agentStarted.taskRef })).toMatchObject({ kind: 'unfollow', following: false })
    expect(await call('team_thread', { action: 'follow', taskRef: agentStarted.taskRef })).toMatchObject({ kind: 'follow', following: true })

    const beforeRejectedStart = ctx.agentTeam.status().sequence
    expect(await call('team_message', { action: 'start', channelRef: channel.channel.channelRef, body: 'Do not enroll', mentions: [reviewer.status.member.memberId] }))
      .toMatchObject({ kind: 'member_not_following', memberIds: [reviewer.status.member.memberId] })
    expect(ctx.agentTeam.status().sequence).toBe(beforeRejectedStart)

    const started = await ctx.agentTeam.sendMessage({ requestId: requestId('protocol-task'), workspaceId, channelRef: channel.channel.channelRef, body: 'Investigate the pull protocol' })
    if (started.kind !== 'committed') throw new Error(`expected committed start, received ${started.kind}`)
    const background = await ctx.agentTeam.reply({ requestId: requestId('protocol-background'), workspaceId, taskRef: started.task.taskRef, body: 'Older context', baseRevision: started.thread.revision })
    if (background.kind !== 'committed') throw new Error(`expected committed background, received ${background.kind}`)
    const held = await ctx.agentTeam.reply({ requestId: requestId('protocol-invite'), workspaceId, taskRef: started.task.taskRef, body: 'Builder, please investigate', baseRevision: background.thread.revision, recipients: [builder.status.member.memberId] })
    if (held.kind !== 'confirmation_required') throw new Error(`expected confirmation, received ${held.kind}`)
    const invitation = await ctx.agentTeam.reply({ requestId: requestId('protocol-invite-confirmed'), workspaceId, taskRef: started.task.taskRef, body: 'Builder, please investigate', baseRevision: background.thread.revision, recipients: [builder.status.member.memberId], confirmationToken: held.confirmationToken })
    if (invitation.kind !== 'committed') throw new Error(`expected committed invitation, received ${invitation.kind}`)

    const inbox = await call('team_inbox', {})
    expect(inbox).toMatchObject({ totalDirectCount: 1, items: [expect.objectContaining({ taskRef: started.task.taskRef, directCount: 1 })] })
    expect(JSON.stringify(inbox)).not.toContain('Builder, please investigate')

    const firstRead = await call('team_thread', { action: 'read', taskRef: started.task.taskRef })
    expect(firstRead).toMatchObject({
      kind: 'read', taskRef: started.task.taskRef, status: 'todo', resolution: 'open', following: true,
      anchor: { body: 'Investigate the pull protocol' }, claims: [],
    })
    expect(firstRead.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ body: 'Older context', unread: false }),
      expect.objectContaining({ body: 'Builder, please investigate', unread: true, direct: true }),
    ]))

    const update = await ctx.agentTeam.reply({ requestId: requestId('protocol-update'), workspaceId, taskRef: started.task.taskRef, body: 'New evidence', baseRevision: invitation.thread.revision })
    if (update.kind !== 'committed') throw new Error(`expected committed update, received ${update.kind}`)
    expect(await call('team_message', { action: 'reply', taskRef: started.task.taskRef, body: 'Premature reply', baseRevision: invitation.thread.revision }))
      .toMatchObject({ kind: 'unread_required', revision: update.thread.revision, unreadCount: 1 })
    await call('team_thread', { action: 'read', taskRef: started.task.taskRef })
    expect(await call('team_message', { action: 'reply', taskRef: started.task.taskRef, body: 'Stale reply', baseRevision: invitation.thread.revision }))
      .toMatchObject({ kind: 'stale_revision', expectedRevision: invitation.thread.revision, revision: update.thread.revision })
    const reply = await call('team_message', { action: 'reply', taskRef: started.task.taskRef, body: 'Current reply', baseRevision: update.thread.revision })
    expect(reply).toMatchObject({ kind: 'committed', taskRef: started.task.taskRef })

    expect(await call('team_thread', { action: 'unfollow', taskRef: started.task.taskRef })).toMatchObject({ following: false })
    const claim = await call('team_claim', { action: 'claim', taskRef: started.task.taskRef, direction: 'implementation', baseRevision: reply.revision })
    expect(claim).toMatchObject({ kind: 'committed', threadRef: started.thread.threadRef, status: 'in_progress', claims: [expect.objectContaining({ owner: builder.status.member.memberId, direction: 'implementation', state: 'active' })] })
    expect(await call('team_thread', { action: 'status', taskRef: started.task.taskRef })).toMatchObject({ following: true })
    expect(await call('team_claim', { action: 'list', taskRef: started.task.taskRef })).toMatchObject({ kind: 'listed', claims: [expect.objectContaining({ direction: 'implementation' })] })
    const done = await call('team_claim', { action: 'done', taskRef: started.task.taskRef, claimRef: claim.claims[0].claimRef, baseRevision: claim.revision })
    expect(done).toMatchObject({ kind: 'committed', status: 'in_review', claims: [expect.objectContaining({ state: 'done' })] })
    const secondClaim = await call('team_claim', { action: 'claim', taskRef: started.task.taskRef, direction: 'follow-up', baseRevision: done.revision })
    const released = await call('team_claim', { action: 'release', taskRef: started.task.taskRef, claimRef: secondClaim.claims[1].claimRef, baseRevision: secondClaim.revision })
    expect(released).toMatchObject({ kind: 'committed', claims: expect.arrayContaining([expect.objectContaining({ direction: 'follow-up', state: 'released' })]) })

    const humanReadAfterClaims = await ctx.agentTeam.readThread({ requestId: requestId('protocol-human-read-after-claims'), workspaceId,
      taskRef: started.task.taskRef })
    const unreadAfterClaims = await ctx.agentTeam.reply({ requestId: requestId('protocol-history-unread'), workspaceId,
      taskRef: started.task.taskRef, body: 'Unread during history', baseRevision: humanReadAfterClaims.thread.revision })
    if (unreadAfterClaims.kind !== 'committed') throw new Error(`expected committed history update, received ${unreadAfterClaims.kind}`)
    const history = await call('team_thread', { action: 'history', taskRef: started.task.taskRef, limit: 2 })
    expect(history).toMatchObject({ kind: 'history', anchor: { body: 'Investigate the pull protocol' }, claims: expect.arrayContaining([expect.objectContaining({ direction: 'implementation' })]) })
    expect(typeof history.cursor).toBe('number')
    expect(await call('team_inbox', {})).toMatchObject({ totalUnreadCount: 1, items: [expect.objectContaining({ taskRef: started.task.taskRef })] })
    expect(await call('team_message', { action: 'reply', taskRef: started.task.taskRef, body: 'History did not read', baseRevision: unreadAfterClaims.thread.revision }))
      .toMatchObject({ kind: 'unread_required', unreadCount: 1 })
    await call('team_thread', { action: 'read', taskRef: started.task.taskRef })
    expect(await call('team_inbox', {})).toMatchObject({ totalUnreadCount: 0, items: [] })
  })

  it('returns a rejected Team result to the next model step without ending the turn', async () => {
    const adapter = new ScriptedAdapter()
    const { ctx, workspaceId } = await realHarness(adapter)
    const channel = await ctx.agentTeam.createChannel({ requestId: requestId('loop-channel'), workspaceId, name: 'engineering', description: 'Engineering work' })
    const builder = await ctx.agentTeam.addMember({ requestId: requestId('loop-builder'), workspaceId, handle: 'builder', description: 'Builds changes', presetId: 'team-member', channelRefs: [channel.channel.channelRef] })
    const reviewer = await ctx.agentTeam.addMember({ requestId: requestId('loop-reviewer'), workspaceId, handle: 'reviewer', description: 'Reviews changes', presetId: 'team-member', channelRefs: [channel.channel.channelRef] })
    const agent = ctx.agents.get(builder.status.member.sessionId)!
    adapter.enqueue(toolCallResponse('model-team-view', 'team_view', {}))
    adapter.enqueue(toolCallResponse('model-team-rejected', 'team_message', { action: 'start', channelRef: channel.channel.channelRef,
      body: 'Attempted invitation', mentions: [reviewer.status.member.memberId] }))
    adapter.enqueue(textResponse('I will continue without enrolling the reviewer.'))

    const idle = waitForIdle(ctx, agent)
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Start the task.' }], source: { kind: 'user' } }))
    await idle

    expect(adapter.requests).toHaveLength(3)
    const afterRejection = JSON.stringify(adapter.requests[2]!.messages)
    expect(afterRejection).toContain(channel.channel.channelRef)
    expect(afterRejection).toContain('member_not_following')
    expect(afterRejection).toContain(reviewer.status.member.memberId)
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
    const started = await ctx.agentTeam.sendMessage({ requestId: requestId('safe-task'), workspaceId, channelRef: channel.channel.channelRef, body: 'Investigate safe delivery' })
    if (started.kind !== 'committed') throw new Error(`expected committed start, received ${started.kind}`)
    await ctx.agentTeam.changeAttentionForAgent(agent, { requestId: requestId('safe-follow'), workspaceId, taskRef: started.task.taskRef, action: 'follow' })
    let revision = (await ctx.agentTeam.readThread({ requestId: requestId('safe-human-read'), workspaceId, taskRef: started.task.taskRef })).thread.revision
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Start ordinary project work.' }], source: { kind: 'user' } }))
    await adapter.started.promise

    const first = await ctx.agentTeam.reply({ requestId: requestId('safe-update-1'), workspaceId, taskRef: started.task.taskRef, body: 'First hidden update', baseRevision: revision })
    if (first.kind !== 'committed') throw new Error(`expected committed reply, received ${first.kind}`)
    revision = first.thread.revision
    const second = await ctx.agentTeam.reply({ requestId: requestId('safe-update-2'), workspaceId, taskRef: started.task.taskRef, body: 'Second hidden update', baseRevision: revision })
    if (second.kind !== 'committed') throw new Error(`expected committed reply, received ${second.kind}`)
    expect(adapter.requests).toHaveLength(1)
    adapter.enqueue(textResponse('I will triage Team Inbox next.'))
    adapter.release.resolve()
    await agent.whenIdle()

    expect(adapter.requests).toHaveLength(2)
    const safeBoundaryRequest = JSON.stringify(adapter.requests[1]!.messages)
    expect(safeBoundaryRequest).toContain('Team Inbox has unread work')
    expect(safeBoundaryRequest).not.toContain('First hidden update')
    expect(safeBoundaryRequest).not.toContain('Second hidden update')
    const hints = agent.session.events.filter(event => event.type === 'user/message'
      && JSON.stringify(event.data).includes('Team Inbox has unread work'))
    expect(hints).toHaveLength(1)
  })

  it('wakes an idle Member after a top-level mention without injecting its body', async () => {
    const adapter = new ScriptedAdapter()
    const { ctx, workspaceId } = await realHarness(adapter)
    const channel = await ctx.agentTeam.createChannel({ requestId: requestId('top-level-wake-channel'), workspaceId, name: 'engineering', description: 'Engineering work' })
    const builder = await ctx.agentTeam.addMember({ requestId: requestId('top-level-wake-builder'), workspaceId, handle: 'builder', description: 'Builds changes', presetId: 'team-member', channelRefs: [channel.channel.channelRef] })
    const agent = ctx.agents.get(builder.status.member.sessionId)!
    const committed = await ctx.agentTeam.sendMessage({ requestId: requestId('top-level-wake'), workspaceId, channelRef: channel.channel.channelRef,
      body: 'Please investigate the top-level wake path', recipients: [builder.status.member.memberId] })
    expect(committed.kind).toBe('committed')
    expect(adapter.requests).toHaveLength(0)

    adapter.enqueue(textResponse('I will inspect Team Inbox.'))
    if (committed.kind !== 'committed') throw new Error(`expected committed top-level mention, received ${committed.kind}`)
    expect(ctx.agentTeam.inboxForAgent(agent, { workspaceId })).toMatchObject({ totalUnreadCount: 1, totalDirectCount: 1,
      items: [expect.objectContaining({ task: expect.objectContaining({ taskRef: committed.task.taskRef }), directCount: 1 })] })
    await agent.whenIdle()
    expect(adapter.requests).toHaveLength(1)
    const request = JSON.stringify(adapter.requests[0]!.messages)
    expect(request).toContain('Team Inbox has unread work')
    expect(request).not.toContain('Please investigate the top-level wake path')
  })

  it('wakes an idle Member from durable Inbox state without injecting Thread bodies', async () => {
    const adapter = new ScriptedAdapter()
    const { ctx, workspaceId } = await realHarness(adapter)
    const channel = await ctx.agentTeam.createChannel({ requestId: requestId('wake-channel'), workspaceId, name: 'engineering', description: 'Engineering work' })
    const builder = await ctx.agentTeam.addMember({ requestId: requestId('wake-builder'), workspaceId, handle: 'builder', description: 'Builds changes', presetId: 'team-member', channelRefs: [channel.channel.channelRef] })
    const agent = ctx.agents.get(builder.status.member.sessionId)!
    const started = await ctx.agentTeam.sendMessage({ requestId: requestId('wake-task'), workspaceId, channelRef: channel.channel.channelRef, body: 'Investigate the wake path' })
    if (started.kind !== 'committed') throw new Error(`expected committed start, received ${started.kind}`)
    await ctx.agentTeam.changeAttentionForAgent(agent, { requestId: requestId('wake-follow'), workspaceId, taskRef: started.task.taskRef, action: 'follow' })
    const humanRead = await ctx.agentTeam.readThread({ requestId: requestId('wake-human-read'), workspaceId, taskRef: started.task.taskRef })
    adapter.enqueue(textResponse('I will inspect Team Inbox.'))
    const first = await ctx.agentTeam.reply({ requestId: requestId('wake-reply-1'), workspaceId, taskRef: started.task.taskRef, body: 'Please inspect the durable wake.', baseRevision: humanRead.thread.revision })
    if (first.kind !== 'committed') throw new Error(`expected committed reply, received ${first.kind}`)
    await agent.whenIdle()
    expect(adapter.requests).toHaveLength(1)
    expect(JSON.stringify(adapter.requests[0]!.messages)).toContain('Team Inbox has unread work')
    expect(JSON.stringify(adapter.requests[0]!.messages)).not.toContain('Please inspect the durable wake.')

    adapter.enqueue(textResponse('I will triage both updates.'))
    const second = await ctx.agentTeam.reply({ requestId: requestId('wake-reply-2'), workspaceId, taskRef: started.task.taskRef, body: 'A second update should coalesce.', baseRevision: first.thread.revision })
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
    const started = await ctx.agentTeam.sendMessage({ requestId: requestId('resume-task'), workspaceId, channelRef: channel.channel.channelRef, body: 'Investigate resume recovery' })
    if (started.kind !== 'committed') throw new Error(`expected committed start, received ${started.kind}`)
    await ctx.agentTeam.changeAttentionForAgent(agent, { requestId: requestId('resume-follow'), workspaceId, taskRef: started.task.taskRef, action: 'follow' })
    const humanRead = await ctx.agentTeam.readThread({ requestId: requestId('resume-human-read'), workspaceId, taskRef: started.task.taskRef })
    await ctx.agentTeam.suspendMember({ requestId: requestId('resume-suspend'), memberId: builder.status.member.memberId })
    const update = await ctx.agentTeam.reply({ requestId: requestId('resume-update'), workspaceId, taskRef: started.task.taskRef, body: 'Unread while suspended', baseRevision: humanRead.thread.revision })
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

  it('reissues a durable hint when a failed Member starts recovery work', async () => {
    const adapter = new ScriptedAdapter()
    const { ctx, workspaceId } = await realHarness(adapter)
    const channel = await ctx.agentTeam.createChannel({ requestId: requestId('error-channel'), workspaceId, name: 'engineering', description: 'Engineering work' })
    const builder = await ctx.agentTeam.addMember({ requestId: requestId('error-builder'), workspaceId, handle: 'builder', description: 'Builds changes', presetId: 'team-member', channelRefs: [channel.channel.channelRef] })
    const agent = ctx.agents.get(builder.status.member.sessionId)!
    const started = await ctx.agentTeam.sendMessage({ requestId: requestId('error-task'), workspaceId, channelRef: channel.channel.channelRef, body: 'Investigate error recovery' })
    if (started.kind !== 'committed') throw new Error(`expected committed start, received ${started.kind}`)
    await ctx.agentTeam.changeAttentionForAgent(agent, { requestId: requestId('error-follow'), workspaceId, taskRef: started.task.taskRef, action: 'follow' })
    const humanRead = await ctx.agentTeam.readThread({ requestId: requestId('error-human-read'), workspaceId, taskRef: started.task.taskRef })
    const update = await ctx.agentTeam.reply({ requestId: requestId('error-update'), workspaceId, taskRef: started.task.taskRef, body: 'Unread through runtime error', baseRevision: humanRead.thread.revision })
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
    const started = await ctx.agentTeam.sendMessage({ requestId: requestId('remount-task'), workspaceId, channelRef: channel.channel.channelRef, body: 'Investigate remount recovery' })
    if (started.kind !== 'committed') throw new Error(`expected committed start, received ${started.kind}`)
    await ctx.agentTeam.changeAttentionForAgent(agent, { requestId: requestId('remount-follow'), workspaceId, taskRef: started.task.taskRef, action: 'follow' })
    const humanRead = await ctx.agentTeam.readThread({ requestId: requestId('remount-human-read'), workspaceId, taskRef: started.task.taskRef })
    const update = await ctx.agentTeam.reply({ requestId: requestId('remount-update'), workspaceId, taskRef: started.task.taskRef, body: 'Unread across Host remount', baseRevision: humanRead.thread.revision })
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
})
