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
import LlmRuntime, { CallId, LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import AgentTeam, { markAgentTeamPreset } from '../src/index.ts'
import { apply as applyAgentTeamTools } from '@deepseek-ai/dsh-tool-agent-team'
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

interface SlowToolGate {
  readonly started: PromiseWithResolvers<void>
  readonly release: PromiseWithResolvers<void>
  aborted: boolean
}

class ScriptAdapter extends LlmAdapter {
  readonly responses: StreamChunk[][] = []

  override resolveModel(provider: string, model: string) {
    return Promise.resolve({ provider, id: model, name: model })
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const chunks = this.responses.shift() ?? textResponse('done')
    for (const chunk of chunks) {
      options.signal?.throwIfAborted()
      yield chunk
    }
  }
}

function textResponse(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

function slowToolResponse(): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'block-end', index: 0, block: {
      type: 'tool-call', id: CallId('call:slow-member-work'), name: 'slow_member_work', arguments: '{}',
    } },
    { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

function teamTools(ctx: Context, slow: SlowToolGate): void {
  applyAgentTeamTools(ctx)
  ctx.tools.register(defineContentToolFixture({
    name: 'slow_member_work',
    description: 'Controlled slow member work.',
    parameters: {},
    async execute(_args, exec) {
      slow.started.resolve()
      const markAborted = (): void => { slow.aborted = true }
      exec.signal.addEventListener('abort', markAborted, { once: true })
      try {
        await slow.release.promise
      } finally {
        exec.signal.removeEventListener('abort', markAborted)
      }
      return [{ type: 'text', text: 'slow work complete' }]
    },
  }))
}

async function executeTool(
  ctx: Context,
  agent: import('@deepseek-ai/dsh-agent').Agent,
  callId: string,
  name: string,
  args: object,
) {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: CallId(callId),
    name,
    arguments: args,
    agent,
  })
}

async function realHarness(): Promise<{
  ctx: Context
  workspaceId: ReturnType<typeof WorkspaceId>
  presetFile: string
  root: string
  teamFiber: Awaited<ReturnType<Context['plugin']>>
  pool: MemoryMediaPool
  adapter: ScriptAdapter
  slow: SlowToolGate
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
  const adapter = new ScriptAdapter()
  const slow: SlowToolGate = {
    started: Promise.withResolvers<void>(),
    release: Promise.withResolvers<void>(),
    aborted: false,
  }
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['test-team-tools', {
      name: 'test-team-tools', inject: ['tools'], apply: (scope: Context) => teamTools(scope, slow),
    }],
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
  ctx.llm.registerAdapter(['mock'], adapter)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'mock', model: 'mock' }) })
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
  return { ctx, workspaceId, presetFile, root, teamFiber, pool, adapter, slow }
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

  it('joins without history replay, admits one mentioned Message, and enforces Agent view membership', async () => {
    const { ctx, workspaceId } = await realHarness()
    const channel = await ctx.agentTeam.createChannel({
      requestId: requestId('request:delivery-channel'),
      workspaceId,
      name: 'delivery',
    })
    await ctx.agentTeam.sendMessage({
      requestId: requestId('request:historical-message'),
      workspaceId,
      channelRef: channel.channel.channelRef,
      body: 'historical message',
    })
    const joined = await ctx.agentTeam.addMember({
      requestId: requestId('request:joined-member'),
      workspaceId,
      handle: 'joined',
      presetId: 'team-member',
      description: 'Receives mentioned work',
    })
    const outsider = await ctx.agentTeam.addMember({
      requestId: requestId('request:outsider-member'),
      workspaceId,
      handle: 'outsider',
      presetId: 'team-member',
      description: 'Has not joined the Channel',
    })
    const joinedAgent = ctx.agents.get(joined.status.member.sessionId)!
    const outsiderAgent = ctx.agents.get(outsider.status.member.sessionId)!
    await ctx.agentTeam.joinChannel({
      requestId: requestId('request:join-channel'),
      workspaceId,
      channelRef: channel.channel.channelRef,
      memberId: joined.status.member.memberId,
    })
    expect(joinedAgent.session.events.some(event => JSON.stringify(event).includes('historical message'))).toBe(false)
    expect(() => ctx.agentTeam.viewForAgent(outsiderAgent, {
      workspaceId,
      channelRef: channel.channel.channelRef,
    })).toThrow(/not authorized/)

    const sent = await ctx.agentTeam.sendMessage({
      requestId: requestId('request:mentioned-message'),
      workspaceId,
      channelRef: channel.channel.channelRef,
      body: 'please inspect this task',
      recipients: [joined.status.member.memberId],
    })
    expect(sent.deliveries).toEqual([
      expect.objectContaining({
        recipient: joined.status.member.memberId,
        state: 'admitted',
      }),
    ])
    const retried = await ctx.agentTeam.sendMessage({
      requestId: requestId('request:mentioned-message'),
      workspaceId,
      channelRef: channel.channel.channelRef,
      body: 'please inspect this task',
      recipients: [joined.status.member.memberId],
    })
    expect(retried.message.messageRef).toBe(sent.message.messageRef)
    expect(retried.deliveries).toEqual(sent.deliveries)
    const delivery = sent.deliveries[0]!
    const evidence = joinedAgent.session.events.find(event =>
      (event.type === 'agent/inbox/spliced' && event.data.inserted.some(message => message.id === delivery.messageId))
      || (event.type === 'user/message' && event.data.id === delivery.messageId))
    expect(evidence).toBeDefined()
    const relay = evidence?.type === 'agent/inbox/spliced'
      ? evidence.data.inserted.find(message => message.id === delivery.messageId)
      : evidence?.type === 'user/message' ? evidence.data : undefined
    expect(relay?.source).toEqual({
      kind: 'agent-team-relay',
      form: 'relay',
      sender: sent.message.sender,
      channelRef: sent.message.channelRef,
      taskRef: sent.task.taskRef,
      messageRef: sent.message.messageRef,
      revision: sent.thread.revision,
    })
    expect(ctx.agentTeam.viewForAgent(joinedAgent, {
      workspaceId,
      channelRef: channel.channel.channelRef,
    }).items.map(item => item.message.body)).toEqual([
      'historical message',
      'please inspect this task',
    ])
    const toolResult = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('call:team-view'),
      name: 'team_view',
      arguments: { workspaceId, channelRef: channel.channel.channelRef },
      agent: joinedAgent,
    })
    expect(toolResult).toMatchObject({
      isError: false,
      value: {
        items: [
          expect.objectContaining({ body: 'historical message' }),
          expect.objectContaining({ body: 'please inspect this task' }),
        ],
      },
    })
    expect(ctx.agentTeam.status().operationCount).toBe(8)
    ctx.agentTeam.validateLedger()
    await ctx.agentTeam.validateDeliveryEvidence()
  })

  it('coordinates two Members through Direction Claims and revision-fenced replies', async () => {
    const { ctx, workspaceId, teamFiber } = await realHarness()
    const channel = await ctx.agentTeam.createChannel({
      requestId: requestId('request:claims-channel'), workspaceId, name: 'claims',
    })
    const first = await ctx.agentTeam.addMember({ requestId: requestId('request:claims-first'), workspaceId,
      handle: 'first', presetId: 'team-member', description: 'First claimant' })
    const second = await ctx.agentTeam.addMember({ requestId: requestId('request:claims-second'), workspaceId,
      handle: 'second', presetId: 'team-member', description: 'Second claimant' })
    for (const member of [first, second]) {
      await ctx.agentTeam.joinChannel({ requestId: requestId(`request:join:${member.status.member.handle}`), workspaceId,
        channelRef: channel.channel.channelRef, memberId: member.status.member.memberId })
    }
    const sent = await ctx.agentTeam.sendMessage({ requestId: requestId('request:claims-task'), workspaceId,
      channelRef: channel.channel.channelRef, body: 'coordinate this work',
      recipients: [first.status.member.memberId, second.status.member.memberId] })
    const firstAgent = ctx.agents.get(first.status.member.sessionId)!
    const secondAgent = ctx.agents.get(second.status.member.sessionId)!
    const base = { workspaceId, taskRef: sent.task.taskRef }

    const [docs, tests] = await Promise.all([
      executeTool(ctx, firstAgent, 'call:claim-docs', 'team_claim', { ...base, action: 'claim', direction: '  Docs   Review ' }),
      executeTool(ctx, secondAgent, 'call:claim-tests', 'team_claim', { ...base, action: 'claim', direction: 'Test Coverage' }),
    ])
    expect(docs.isError).toBe(false)
    expect(tests.isError).toBe(false)
    expect(docs.value).toMatchObject({ status: 'in_progress' })
    const docsRetry = await executeTool(ctx, firstAgent, 'call:claim-docs', 'team_claim', {
      ...base, action: 'claim', direction: '  Docs   Review ',
    })
    expect(docsRetry.value).toMatchObject({ operationId: (docs.value as { operationId: string }).operationId })

    const race = await Promise.all([
      executeTool(ctx, firstAgent, 'call:claim-race-first', 'team_claim', { ...base, action: 'claim', direction: 'API Audit' }),
      executeTool(ctx, secondAgent, 'call:claim-race-second', 'team_claim', { ...base, action: 'claim', direction: ' api   audit ' }),
    ])
    expect(race.filter(result => result.isError)).toHaveLength(1)
    expect(race.filter(result => !result.isError)).toHaveLength(1)

    const listed = await executeTool(ctx, firstAgent, 'call:claim-list', 'team_claim', { ...base, action: 'list' })
    expect(listed.value).toMatchObject({
      status: 'in_progress',
      claims: expect.arrayContaining([
        expect.objectContaining({ direction: 'Docs   Review', normalizedDirection: 'docs review', state: 'active' }),
        expect.objectContaining({ direction: 'Test Coverage', normalizedDirection: 'test coverage', state: 'active' }),
      ]),
    })
    const claims = (listed.value as { claims: Array<{ claimRef: string; owner: string; normalizedDirection: string }> }).claims
    const firstClaim = claims.find(claim => claim.normalizedDirection === 'docs review')!
    const secondClaim = claims.find(claim => claim.normalizedDirection === 'test coverage')!
    const raceClaim = claims.find(claim => claim.normalizedDirection === 'api audit')!
    await executeTool(ctx, firstAgent, 'call:claim-done', 'team_claim', { ...base, action: 'done', claimRef: firstClaim.claimRef })
    await executeTool(ctx, secondAgent, 'call:claim-release', 'team_claim', { ...base, action: 'release', claimRef: secondClaim.claimRef })
    await executeTool(ctx,
      raceClaim.owner === first.status.member.memberId ? firstAgent : secondAgent,
      'call:claim-release-race', 'team_claim', { ...base, action: 'release', claimRef: raceClaim.claimRef })

    const current = await executeTool(ctx, firstAgent, 'call:claim-list-current', 'team_claim', { ...base, action: 'list' })
    const revision = (current.value as { revision: number }).revision
    const stale = await executeTool(ctx, secondAgent, 'call:reply-stale', 'team_send', {
      ...base, body: 'stale reply', baseRevision: sent.thread.revision,
    })
    expect(stale).toMatchObject({ isError: true, content: [expect.objectContaining({ text: expect.stringMatching(/stale Thread revision/) })] })
    const reply = await executeTool(ctx, secondAgent, 'call:reply-current', 'team_send', {
      ...base, body: 'reorganized current reply', baseRevision: revision,
    })
    expect(reply.isError).toBe(false)
    expect((reply.value as { revision: number }).revision).toBeGreaterThan(revision)

    const finalClaims = await executeTool(ctx, firstAgent, 'call:claim-list-final', 'team_claim', { ...base, action: 'list' })
    expect(finalClaims.value).toMatchObject({ status: 'in_review' })
    const teamView = await executeTool(ctx, firstAgent, 'call:view-activities', 'team_view', {
      workspaceId, channelRef: channel.channel.channelRef,
    })
    expect(teamView.value).toMatchObject({ activities: expect.arrayContaining([
      expect.objectContaining({ kind: 'claim' }),
      expect.objectContaining({ kind: 'done' }),
      expect.objectContaining({ kind: 'release' }),
    ]) })
    const serviceView = ctx.agentTeam.viewForAgent(firstAgent, { workspaceId, channelRef: channel.channel.channelRef })
    expect(serviceView.items.some(item => item.message.body === 'stale reply')).toBe(false)
    expect(serviceView).toMatchObject({ activities: expect.arrayContaining([
        expect.objectContaining({ kind: 'claim' }),
        expect.objectContaining({ kind: 'done' }),
        expect.objectContaining({ kind: 'release' }),
      ]) })
    const activityRelay = firstAgent.session.events.flatMap(event => event.type === 'agent/inbox/spliced'
      ? event.data.inserted : []).find(message => message.source.kind === 'agent-team-activity')
    expect(activityRelay?.source).toMatchObject({
      kind: 'agent-team-activity', form: 'notice', taskRef: sent.task.taskRef,
      actor: expect.objectContaining({ memberId: second.status.member.memberId }),
      activityRef: expect.stringMatching(/^activity:/), revision: expect.any(Number),
    })
    ctx.agentTeam.validateLedger()
    await ctx.agentTeam.validateDeliveryEvidence()

    await teamFiber.dispose()
    const remounted = await ctx.plugin(AgentTeam)
    const restoredFirst = ctx.agents.get(first.status.member.sessionId)!
    const reconstructed = ctx.agentTeam.listClaimsForAgent(restoredFirst, base)
    expect(reconstructed).toMatchObject({
      task: { status: 'in_review' },
      claims: expect.arrayContaining([
        expect.objectContaining({ normalizedDirection: 'docs review', state: 'done' }),
        expect.objectContaining({ normalizedDirection: 'test coverage', state: 'released' }),
      ]),
    })
    expect(ctx.agentTeam.viewForAgent(restoredFirst, { workspaceId, channelRef: channel.channel.channelRef })
      .items.some(item => item.message.body === 'reorganized current reply')).toBe(true)
    await remounted.dispose()
  })

  it('controls Thread attention with Follow and one-use mention confirmation', async () => {
    const { ctx, workspaceId, teamFiber } = await realHarness()
    const channel = await ctx.agentTeam.createChannel({
      requestId: requestId('request:attention-channel'), workspaceId, name: 'attention',
    })
    const first = await ctx.agentTeam.addMember({ requestId: requestId('request:attention-first'), workspaceId,
      handle: 'attention-first', presetId: 'team-member', description: 'Attention sender' })
    const second = await ctx.agentTeam.addMember({ requestId: requestId('request:attention-second'), workspaceId,
      handle: 'attention-second', presetId: 'team-member', description: 'Attention recipient' })
    for (const member of [first, second]) {
      await ctx.agentTeam.joinChannel({ requestId: requestId(`request:attention-join:${member.status.member.handle}`),
        workspaceId, channelRef: channel.channel.channelRef, memberId: member.status.member.memberId })
    }
    const sent = await ctx.agentTeam.sendMessage({ requestId: requestId('request:attention-task'), workspaceId,
      channelRef: channel.channel.channelRef, body: 'attention task',
      recipients: [first.status.member.memberId, second.status.member.memberId] })
    const firstAgent = ctx.agents.get(first.status.member.sessionId)!
    const secondAgent = ctx.agents.get(second.status.member.sessionId)!
    const base = { workspaceId, taskRef: sent.task.taskRef }

    const unfollowed = await executeTool(ctx, firstAgent, 'call:attention-unfollow', 'team_follow', {
      ...base, action: 'unfollow',
    })
    expect(unfollowed.value).toMatchObject({ following: false })
    const unfollowRevision = (unfollowed.value as { revision: number }).revision
    const beforeOrdinary = firstAgent.session.events.filter(event => event.type === 'agent/inbox/spliced').length
    const ordinary = await executeTool(ctx, secondAgent, 'call:attention-ordinary', 'team_send', {
      ...base, body: 'ordinary follower update', baseRevision: unfollowRevision,
    })
    expect(ordinary.value).toMatchObject({ kind: 'committed', deliveries: [] })
    expect(firstAgent.session.events.filter(event => event.type === 'agent/inbox/spliced')).toHaveLength(beforeOrdinary)

    const currentRevision = (ordinary.value as { revision: number }).revision
    const beforeConfirmation = ctx.agentTeam.status().operationCount
    const held = await executeTool(ctx, secondAgent, 'call:attention-held', 'team_send', {
      ...base, body: 'explicit attention', baseRevision: currentRevision,
      mentions: [first.status.member.memberId],
    })
    expect(held.value).toMatchObject({
      kind: 'confirmation_required', revision: currentRevision,
      recipients: [first.status.member.memberId], confirmationToken: expect.stringMatching(/^confirmation:/),
    })
    expect(ctx.agentTeam.status().operationCount).toBe(beforeConfirmation)
    const heldToken = (held.value as { confirmationToken: string }).confirmationToken

    const crossSender = await executeTool(ctx, firstAgent, 'call:attention-cross-sender', 'team_send', {
      ...base, body: 'cross sender', baseRevision: currentRevision,
      mentions: [second.status.member.memberId], confirmationToken: heldToken,
    })
    expect(crossSender).toMatchObject({ isError: true,
      content: [expect.objectContaining({ text: expect.stringMatching(/confirmation token is invalid/) })] })
    const consumed = await executeTool(ctx, secondAgent, 'call:attention-consumed', 'team_send', {
      ...base, body: 'explicit attention', baseRevision: currentRevision,
      mentions: [first.status.member.memberId], confirmationToken: heldToken,
    })
    expect(consumed.isError).toBe(true)

    const heldAgain = await executeTool(ctx, secondAgent, 'call:attention-held-again', 'team_send', {
      ...base, body: 'explicit attention', baseRevision: currentRevision,
      mentions: [first.status.member.memberId],
    })
    const validToken = (heldAgain.value as { confirmationToken: string }).confirmationToken
    const confirmed = await executeTool(ctx, secondAgent, 'call:attention-confirmed', 'team_send', {
      ...base, body: 'explicit attention', baseRevision: currentRevision,
      mentions: [first.status.member.memberId], confirmationToken: validToken,
    })
    expect(confirmed.value).toMatchObject({ kind: 'committed', deliveries: [
      expect.objectContaining({ recipient: first.status.member.memberId, state: 'admitted' }),
    ] })
    expect((await executeTool(ctx, firstAgent, 'call:attention-status', 'team_follow', {
      ...base, action: 'status',
    })).value).toMatchObject({ following: true })
    const replayed = await executeTool(ctx, secondAgent, 'call:attention-replay', 'team_send', {
      ...base, body: 'explicit attention', baseRevision: currentRevision,
      mentions: [first.status.member.memberId], confirmationToken: validToken,
    })
    expect(replayed.isError).toBe(true)

    const confirmedRevision = (confirmed.value as { revision: number }).revision
    await executeTool(ctx, firstAgent, 'call:attention-unfollow-again', 'team_follow', { ...base, action: 'unfollow' })
    const latest = ctx.agentTeam.followStatusForAgent(secondAgent, base).thread.revision
    const stateHeld = await executeTool(ctx, secondAgent, 'call:attention-state-held', 'team_send', {
      ...base, body: 'state token', baseRevision: latest, mentions: [first.status.member.memberId],
    })
    const stateToken = (stateHeld.value as { confirmationToken: string }).confirmationToken
    await executeTool(ctx, firstAgent, 'call:attention-follow-change', 'team_follow', { ...base, action: 'follow' })
    const invalidAfterFollow = await executeTool(ctx, secondAgent, 'call:attention-state-retry', 'team_send', {
      ...base, body: 'state token', baseRevision: latest,
      mentions: [first.status.member.memberId], confirmationToken: stateToken,
    })
    expect(invalidAfterFollow.isError).toBe(true)
    await executeTool(ctx, firstAgent, 'call:attention-unfollow-provider', 'team_follow', { ...base, action: 'unfollow' })

    const beforeConcurrentFollow = ctx.agentTeam.followStatusForAgent(secondAgent, base).thread.revision
    const [concurrentFollow, sendBesideFollow] = await Promise.all([
      executeTool(ctx, firstAgent, 'call:attention-concurrent-follow', 'team_follow', { ...base, action: 'follow' }),
      executeTool(ctx, secondAgent, 'call:attention-send-beside-follow', 'team_send', {
        ...base, body: 'beside follow', baseRevision: beforeConcurrentFollow,
      }),
    ])
    expect(concurrentFollow.isError).toBe(false)
    expect(sendBesideFollow.isError
      || (sendBesideFollow.value as { deliveries: unknown[] }).deliveries.length === 0).toBe(true)
    expect(ctx.agentTeam.followStatusForAgent(firstAgent, base).following).toBe(true)

    const beforeConcurrentUnfollow = ctx.agentTeam.followStatusForAgent(secondAgent, base).thread.revision
    const [concurrentUnfollow, sendBesideUnfollow] = await Promise.all([
      executeTool(ctx, firstAgent, 'call:attention-concurrent-unfollow', 'team_follow', { ...base, action: 'unfollow' }),
      executeTool(ctx, secondAgent, 'call:attention-send-beside-unfollow', 'team_send', {
        ...base, body: 'beside unfollow', baseRevision: beforeConcurrentUnfollow,
      }),
    ])
    expect(concurrentUnfollow.isError).toBe(false)
    expect(sendBesideUnfollow.isError
      || (sendBesideUnfollow.value as { deliveries: Array<{ recipient: string }> }).deliveries
        .some(delivery => delivery.recipient === first.status.member.memberId)).toBe(true)
    expect(ctx.agentTeam.followStatusForAgent(firstAgent, base).following).toBe(false)

    const providerRevision = ctx.agentTeam.followStatusForAgent(secondAgent, base).thread.revision
    const providerHeld = await executeTool(ctx, secondAgent, 'call:attention-provider-held', 'team_send', {
      ...base, body: 'provider token', baseRevision: providerRevision, mentions: [first.status.member.memberId],
    })
    const lifecycleToken = (providerHeld.value as { confirmationToken: string }).confirmationToken
    expect(providerRevision).toBeGreaterThan(confirmedRevision)
    await ctx.agentTeam.suspendMember({ requestId: requestId('request:attention-suspend'),
      memberId: first.status.member.memberId })
    await ctx.agentTeam.resumeMember({ requestId: requestId('request:attention-resume'),
      memberId: first.status.member.memberId })
    const invalidAfterLifecycle = await executeTool(ctx, secondAgent, 'call:attention-lifecycle-retry', 'team_send', {
      ...base, body: 'provider token', baseRevision: providerRevision,
      mentions: [first.status.member.memberId], confirmationToken: lifecycleToken,
    })
    expect(invalidAfterLifecycle.isError).toBe(true)
    const providerHeldAgain = await executeTool(ctx, secondAgent, 'call:attention-provider-held-again', 'team_send', {
      ...base, body: 'provider token', baseRevision: providerRevision, mentions: [first.status.member.memberId],
    })
    const providerToken = (providerHeldAgain.value as { confirmationToken: string }).confirmationToken
    await teamFiber.dispose()
    const remounted = await ctx.plugin(AgentTeam)
    const restoredSecond = ctx.agents.get(second.status.member.sessionId)!
    const invalidAfterReload = await executeTool(ctx, restoredSecond, 'call:attention-provider-retry', 'team_send', {
      ...base, body: 'provider token', baseRevision: providerRevision,
      mentions: [first.status.member.memberId], confirmationToken: providerToken,
    })
    expect(invalidAfterReload.isError).toBe(true)
    ctx.agentTeam.validateLedger()
    await ctx.agentTeam.validateDeliveryEvidence()
    await remounted.dispose()
  })

  it('queues subscribed Thread delivery at next-step without aborting a running tool call', async () => {
    const { ctx, workspaceId, adapter, slow } = await realHarness()
    adapter.responses.push(slowToolResponse(), textResponse('finished after steering'))
    const channel = await ctx.agentTeam.createChannel({
      requestId: requestId('request:running-channel'), workspaceId, name: 'running',
    })
    const member = await ctx.agentTeam.addMember({
      requestId: requestId('request:running-member'), workspaceId,
      handle: 'runner', presetId: 'team-member', description: 'Runs controlled work',
    })
    const sender = await ctx.agentTeam.addMember({
      requestId: requestId('request:running-sender'), workspaceId,
      handle: 'runner-sender', presetId: 'team-member', description: 'Sends subscribed updates',
    })
    for (const joined of [member, sender]) await ctx.agentTeam.joinChannel({
      requestId: requestId(`request:running-join:${joined.status.member.handle}`), workspaceId,
      channelRef: channel.channel.channelRef, memberId: joined.status.member.memberId,
    })
    const started = await ctx.agentTeam.sendMessage({
      requestId: requestId('request:start-running'), workspaceId,
      channelRef: channel.channel.channelRef,
      body: 'start slow work', recipients: [member.status.member.memberId],
    })
    await slow.started.promise
    const agent = ctx.agents.get(member.status.member.sessionId)!
    expect(agent.status).toBe('running')

    const senderAgent = ctx.agents.get(sender.status.member.sessionId)!
    const steering = await executeTool(ctx, senderAgent, 'call:steer-running', 'team_send', {
      workspaceId, taskRef: started.task.taskRef,
      body: 'new subscribed information while working', baseRevision: started.thread.revision,
    })
    expect(steering.value).toMatchObject({ deliveries: [
      expect.objectContaining({ recipient: member.status.member.memberId, state: 'admitted' }),
    ] })
    expect(slow.aborted).toBe(false)
    expect(agent.status).toBe('running')
    slow.release.resolve()
    await agent.whenIdle()
    expect(slow.aborted).toBe(false)
  })

  it('recovers existing Inbox evidence after the admitted ledger write fails', async () => {
    const { ctx, workspaceId, teamFiber, pool } = await realHarness()
    const channel = await ctx.agentTeam.createChannel({
      requestId: requestId('request:recovery-channel'), workspaceId, name: 'recovery',
    })
    const member = await ctx.agentTeam.addMember({
      requestId: requestId('request:recovery-member'), workspaceId,
      handle: 'recovery', presetId: 'team-member', description: 'Tests admission recovery',
    })
    await ctx.agentTeam.joinChannel({
      requestId: requestId('request:recovery-join'), workspaceId,
      channelRef: channel.channel.channelRef, memberId: member.status.member.memberId,
    })
    const agent = ctx.agents.get(member.status.member.sessionId)!
    let deliveredMessageId: string | undefined
    const stop = ctx.on('session/event', (session, event) => {
      if (session !== agent.session || event.type !== 'agent/inbox/spliced' || event.data.inserted.length === 0) return
      deliveredMessageId = event.data.inserted[0]!.id
      pool.failNextWrites = 1
    })
    await expect(ctx.agentTeam.sendMessage({
      requestId: requestId('request:recovery-message'), workspaceId,
      channelRef: channel.channel.channelRef,
      body: 'recover this exact relay', recipients: [member.status.member.memberId],
    })).rejects.toThrow(/injected write failure/)
    stop()
    expect(deliveredMessageId).toBeDefined()
    expect(agent.session.events.filter(event => event.type === 'agent/inbox/spliced'
      && event.data.inserted.some(message => message.id === deliveredMessageId))).toHaveLength(1)

    await teamFiber.dispose()
    const remounted = await ctx.plugin(AgentTeam)
    const restored = ctx.agents.get(member.status.member.sessionId)!
    expect(restored.session.events.filter(event => event.type === 'agent/inbox/spliced'
      && event.data.inserted.some(message => message.id === deliveredMessageId))).toHaveLength(1)
    expect(ctx.agentTeam.status().operationCount).toBe(6)
    ctx.agentTeam.validateLedger()
    await ctx.agentTeam.validateDeliveryEvidence()
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
