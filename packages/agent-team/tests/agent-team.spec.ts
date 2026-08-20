import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { SqliteStorageBackend } from '@deepseek-ai/dsh-storage-sqlite'
import { SessionId } from '@deepseek-ai/dsh-session'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { MemoryMediaPool, MemoryStorageBackend } from './helpers/memory-backend.ts'
import AgentTeam, { AGENT_TEAM_HUMAN_MEMBER_ID, AGENT_TEAM_INITIALIZE_REQUEST_ID } from '../src/index.ts'
import { AgentTeamLedger, agentTeamHumanActor } from '../src/ledger.ts'
import * as agentTeamInvariant from '../src/invariant.ts'
import type { AgentTeamAgentMember, AgentTeamMemberActor, AgentTeamOperation, AgentTeamOperationId, AgentTeamRequestId } from '../src/types.ts'

interface TeamHarness {
  readonly ctx: Context
  readonly fiber: Awaited<ReturnType<Context['plugin']>>
  readonly facility: DomainFacility
}

const cleanups: Array<() => Promise<void>> = []
const alpha = WorkspaceId('workspace:alpha')
const beta = WorkspaceId('workspace:beta')
const requestId = (value: string): AgentTeamRequestId => value as AgentTeamRequestId

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(cleanup => cleanup()))
})

async function harness(pool = new MemoryMediaPool(), workspaceIds = [alpha]): Promise<TeamHarness> {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  ctx.provide('workspaceRegistry', {
    get: (id: WorkspaceId) => workspaceIds.includes(id) ? { id, path: process.cwd(), attachSession: async () => {}, archiveSession: async () => {} } : undefined,
    list: () => workspaceIds.map(id => ({ id, path: process.cwd() })),
  })
  ctx.provide('agents', { create: async () => { throw new Error('unused') }, resume: async () => { throw new Error('unused') } })
  ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'mock', model: 'mock' }) })
  ctx.provide('agentPresets', { mount: async () => { throw new Error('unused') } })
  ctx.provide('tools', { schemas: () => [] })
  ctx.provide('sessionPersistence', { list: async () => [] })
  const fiber = await ctx.plugin(AgentTeam)
  cleanups.push(async () => { await fiber.dispose(); await facility.closeAll() })
  return { ctx, fiber, facility }
}

async function sqliteHarness(path: string): Promise<TeamHarness> {
  const ctx = new Context()
  await ctx.plugin(Storage)
  const backend = new SqliteStorageBackend({ path, journalMode: 'delete' })
  ctx.storage.backend.register('sqlite', backend)
  const facility = new DomainFacility(ctx, { backend: 'sqlite', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  ctx.provide('workspaceRegistry', { get: (id: WorkspaceId) => ({ id, path: process.cwd(), attachSession: async () => {}, archiveSession: async () => {} }), list: () => [] })
  ctx.provide('agents', { create: async () => { throw new Error('unused') }, resume: async () => { throw new Error('unused') } })
  ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'mock', model: 'mock' }) })
  ctx.provide('agentPresets', { mount: async () => { throw new Error('unused') } })
  ctx.provide('tools', { schemas: () => [] })
  ctx.provide('sessionPersistence', { list: async () => [] })
  const fiber = await ctx.plugin(AgentTeam)
  cleanups.push(async () => { await fiber.dispose(); await facility.closeAll(); await backend.close() })
  return { ctx, fiber, facility }
}

function storedPool(records: Array<[string, unknown]>, version = 7): MemoryMediaPool {
  const pool = new MemoryMediaPool()
  pool.versions.set('agent_team', version)
  pool.media.set('agent_team', { tables: new Map([['operations', new Map(records)]]), global: null })
  return pool
}

function committed<T extends { readonly kind: string }>(result: T): Extract<T, { readonly kind: 'committed' }> {
  if (result.kind !== 'committed') throw new Error(`expected committed result, received ${result.kind}`)
  return result as Extract<T, { readonly kind: 'committed' }>
}

async function readHuman(test: TeamHarness, taskRef: string) {
  return test.ctx.agentTeam.readThread({ requestId: requestId(`read:${taskRef}:${crypto.randomUUID()}`), workspaceId: alpha, taskRef: taskRef as never })
}

function replayLedger(test: TeamHarness): AgentTeamLedger {
  return new AgentTeamLedger(test.facility.get('agent_team')!.table('operations') as unknown as KvTable<AgentTeamOperationId, AgentTeamOperation>)
}

async function addLedgerMember(
  ledger: AgentTeamLedger,
  channelRef: string,
  memberId = `member:agent-${crypto.randomUUID()}`,
): Promise<{ readonly member: AgentTeamAgentMember; readonly actor: AgentTeamMemberActor }> {
  const member: AgentTeamAgentMember = {
    memberId: memberId as never,
    sessionId: SessionId(`session:${memberId}`),
    workspaceId: alpha,
    handle: memberId.slice('member:'.length),
    description: 'Test Agent',
    presetId: 'team-member',
    privateMemoryPath: `/tmp/${memberId}`,
    state: 'enabled',
  }
  await ledger.addMember({ requestId: requestId(`add:${memberId}`), actor: agentTeamHumanActor(), member, handle: member.handle,
    description: member.description, presetId: member.presetId, workspaceId: alpha, channelRefs: [channelRef as never] })
  return { member, actor: { kind: 'member', memberId: member.memberId, handle: member.handle } }
}

describe('AgentTeam durable Thread Attention ledger', () => {
  it('boots a v7 empty Team and rejects old ledger media', async () => {
    const pool = new MemoryMediaPool()
    const first = await harness(pool)
    expect(first.ctx.agentTeam.status()).toEqual({ initialized: true, sequence: 1, operationCount: 1, channelCount: 0, agentMemberCount: 0, humanMemberId: AGENT_TEAM_HUMAN_MEMBER_ID })
    const records = [...pool.media.get('agent_team')!.tables.get('operations')!.values()]
    await first.fiber.dispose()
    const replay = await first.ctx.plugin(AgentTeam)
    expect(first.ctx.agentTeam.status()).toMatchObject({ sequence: 1 })
    expect([...pool.media.get('agent_team')!.tables.get('operations')!.values()]).toEqual(records)
    await replay.dispose()
    await expect(harness(storedPool([], 6))).rejects.toThrow(/stamped v6, descriptor wants v7/)
  })

  it('creates a top-level Task, starts creator Attention, and returns no own unread work', async () => {
    const test = await harness()
    const channel = await test.ctx.agentTeam.createChannel({ requestId: requestId('channel'), workspaceId: alpha, name: 'engineering', description: 'Engineering work' })
    const sent = committed(await test.ctx.agentTeam.sendMessage({ requestId: requestId('start'), workspaceId: alpha, channelRef: channel.channel.channelRef, body: 'Investigate the regression' }))
    expect(sent).toMatchObject({ message: { topLevel: true, sender: AGENT_TEAM_HUMAN_MEMBER_ID }, task: { status: 'todo' }, attention: [expect.objectContaining({ memberId: AGENT_TEAM_HUMAN_MEMBER_ID, startSequence: sent.message.sequence, readThroughSequence: sent.message.sequence - 1 })] })
    expect(test.ctx.agentTeam.inbox({ workspaceId: alpha })).toEqual({ items: [], totalUnreadCount: 0, totalDirectCount: 0 })
    const attention = await test.ctx.agentTeam.changeAttention({ requestId: requestId('unfollow'), workspaceId: alpha, taskRef: sent.task.taskRef, action: 'unfollow' })
    expect(attention.attention).toBeUndefined()
    await expect(test.ctx.agentTeam.changeAttention({ requestId: requestId('again'), workspaceId: alpha, taskRef: sent.task.taskRef, action: 'unfollow' })).rejects.toThrow(/already unfollowed/)
  })

  it('adds an Agent with initial Channel membership and persists no Inbox delivery facts', async () => {
    const test = await harness()
    const channel = await test.ctx.agentTeam.createChannel({ requestId: requestId('channel'), workspaceId: alpha, name: 'engineering', description: 'Engineering work' })
    const member = await test.ctx.agentTeam.addMember({ requestId: requestId('member'), workspaceId: alpha, handle: 'reviewer', description: 'Reviews changes', presetId: 'team-member', channelRefs: [channel.channel.channelRef] })
    expect(member.status.member).toMatchObject({ workspaceId: alpha, handle: 'reviewer' })
    expect(test.ctx.agentTeam.view({ workspaceId: alpha }).members).toEqual([{ channelRef: channel.channel.channelRef, memberId: member.status.member.memberId }])
    const records = [...(test.facility.get('agent_team')?.table('operations').entries() ?? [])].map(([, operation]) => JSON.stringify(operation))
    expect(records.join('\n')).not.toContain('delivery')
    expect(records.join('\n')).not.toContain('follow-changed')
  })

  it('keeps the later follow watermark when an older direct marker is consumed', async () => {
    const test = await harness()
    const channel = await test.ctx.agentTeam.createChannel({ requestId: requestId('channel'), workspaceId: alpha, name: 'engineering', description: 'Engineering work' })
    const started = committed(await test.ctx.agentTeam.sendMessage({ requestId: requestId('start'), workspaceId: alpha, channelRef: channel.channel.channelRef, body: 'Task' }))
    const ledger = replayLedger(test)
    const { actor } = await addLedgerMember(ledger, channel.channel.channelRef)
    const unfollowed = (await ledger.changeAttention({ requestId: requestId('unfollow'), workspaceId: alpha, taskRef: started.task.taskRef,
      action: 'unfollow', actor: agentTeamHumanActor() })).value
    const mentioned = committed((await ledger.reply({ requestId: requestId('mention'), workspaceId: alpha, taskRef: started.task.taskRef,
      body: 'Please check this', baseRevision: unfollowed.thread.revision, recipients: [AGENT_TEAM_HUMAN_MEMBER_ID], actor })).value)
    const ordinary = committed((await ledger.reply({ requestId: requestId('ordinary'), workspaceId: alpha, taskRef: started.task.taskRef,
      body: 'Later reply', baseRevision: mentioned.thread.revision, actor })).value)
    const followed = (await ledger.changeAttention({ requestId: requestId('follow'), workspaceId: alpha, taskRef: started.task.taskRef,
      action: 'follow', actor: agentTeamHumanActor() })).value
    const read = (await ledger.readThread({ requestId: requestId('read'), workspaceId: alpha, taskRef: started.task.taskRef,
      actor: agentTeamHumanActor() })).value
    expect(followed.attention).toMatchObject({ readThroughSequence: ordinary.message.sequence })
    expect(read.readThroughSequence).toBe(ordinary.message.sequence)
    expect(read.consumedDirectMarkers).toEqual([expect.objectContaining({ messageRef: mentioned.message.messageRef })])
    expect(ledger.inbox(agentTeamHumanActor(), { workspaceId: alpha })).toEqual({ items: [], totalUnreadCount: 0, totalDirectCount: 0 })
    const replay = replayLedger(test)
    expect(replay.inbox(agentTeamHumanActor(), { workspaceId: alpha })).toEqual({ items: [], totalUnreadCount: 0, totalDirectCount: 0 })
  })

  it('does not duplicate a direct marker when follow starts after the marker', async () => {
    const test = await harness()
    const channel = await test.ctx.agentTeam.createChannel({ requestId: requestId('channel'), workspaceId: alpha, name: 'engineering', description: 'Engineering work' })
    const started = committed(await test.ctx.agentTeam.sendMessage({ requestId: requestId('start'), workspaceId: alpha, channelRef: channel.channel.channelRef, body: 'Task' }))
    const ledger = replayLedger(test)
    const { actor } = await addLedgerMember(ledger, channel.channel.channelRef)
    const unfollowed = (await ledger.changeAttention({ requestId: requestId('unfollow'), workspaceId: alpha, taskRef: started.task.taskRef,
      action: 'unfollow', actor: agentTeamHumanActor() })).value
    const mentioned = committed((await ledger.reply({ requestId: requestId('mention'), workspaceId: alpha, taskRef: started.task.taskRef,
      body: 'Please check this', baseRevision: unfollowed.thread.revision, recipients: [AGENT_TEAM_HUMAN_MEMBER_ID], actor })).value)
    const followed = (await ledger.changeAttention({ requestId: requestId('follow'), workspaceId: alpha, taskRef: started.task.taskRef,
      action: 'follow', actor: agentTeamHumanActor() })).value
    const read = (await ledger.readThread({ requestId: requestId('read'), workspaceId: alpha, taskRef: started.task.taskRef,
      actor: agentTeamHumanActor() })).value
    expect(mentioned.directMarkers).toEqual([expect.objectContaining({ memberId: AGENT_TEAM_HUMAN_MEMBER_ID })])
    expect(followed.attention).toBeDefined()
    expect(read.facts.filter(fact => fact.fact.kind === 'message' && fact.fact.message.messageRef === mentioned.message.messageRef)).toHaveLength(1)
  })

  it('returns Human-only follow observations without changing public Thread facts or Inbox state', async () => {
    const test = await harness()
    const channel = await test.ctx.agentTeam.createChannel({ requestId: requestId('channel'), workspaceId: alpha, name: 'engineering', description: 'Engineering work' })
    const started = committed(await test.ctx.agentTeam.sendMessage({ requestId: requestId('start'), workspaceId: alpha, channelRef: channel.channel.channelRef, body: 'Task' }))
    await test.ctx.agentTeam.changeAttention({ requestId: requestId('unfollow'), workspaceId: alpha, taskRef: started.task.taskRef, action: 'unfollow' })
    await test.ctx.agentTeam.changeAttention({ requestId: requestId('follow'), workspaceId: alpha, taskRef: started.task.taskRef, action: 'follow' })

    expect(test.ctx.agentTeam.threadObservations({ workspaceId: alpha, taskRef: started.task.taskRef })).toEqual({
      items: [
        expect.objectContaining({ memberId: AGENT_TEAM_HUMAN_MEMBER_ID, action: 'unfollow', taskRef: started.task.taskRef }),
        expect.objectContaining({ memberId: AGENT_TEAM_HUMAN_MEMBER_ID, action: 'follow', taskRef: started.task.taskRef }),
      ],
    })
    expect(test.ctx.agentTeam.view({ workspaceId: alpha, threadRef: started.thread.threadRef }).activities).toEqual([])
    expect(test.ctx.agentTeam.inbox({ workspaceId: alpha })).toEqual({ items: [], totalUnreadCount: 0, totalDirectCount: 0 })
  })

  it('invites an unfollowed Agent only after Human confirmation and leaves old history background-only', async () => {
    const test = await harness()
    const channel = await test.ctx.agentTeam.createChannel({ requestId: requestId('channel'), workspaceId: alpha, name: 'engineering', description: 'Engineering work' })
    const member = await test.ctx.agentTeam.addMember({ requestId: requestId('member'), workspaceId: alpha, handle: 'reviewer', description: 'Reviews changes', presetId: 'team-member', channelRefs: [channel.channel.channelRef] })
    const started = committed(await test.ctx.agentTeam.sendMessage({ requestId: requestId('start'), workspaceId: alpha, channelRef: channel.channel.channelRef, body: 'Old task' }))
    const history = committed(await test.ctx.agentTeam.reply({ requestId: requestId('history'), workspaceId: alpha, taskRef: started.task.taskRef, body: 'Old discussion', baseRevision: started.thread.revision }))
    const held = await test.ctx.agentTeam.reply({ requestId: requestId('invite'), workspaceId: alpha, taskRef: started.task.taskRef, body: 'Please review this', baseRevision: history.thread.revision, recipients: [member.status.member.memberId] })
    expect(held).toMatchObject({ kind: 'confirmation_required', recipients: [member.status.member.memberId] })
    expect(test.ctx.agentTeam.status().sequence).toBe(history.receipt.sequence)
    if (held.kind !== 'confirmation_required') throw new Error('expected invitation confirmation')
    const invite = committed(await test.ctx.agentTeam.reply({ requestId: requestId('invite-confirmed'), workspaceId: alpha, taskRef: started.task.taskRef, body: 'Please review this', baseRevision: history.thread.revision, recipients: [member.status.member.memberId], confirmationToken: held.confirmationToken }))
    expect(invite.attention).toEqual([expect.objectContaining({ memberId: member.status.member.memberId, startSequence: invite.message.sequence })])
    expect(invite.directMarkers).toEqual([expect.objectContaining({ memberId: member.status.member.memberId, messageRef: invite.message.messageRef })])
    expect(test.ctx.agentTeam.view({ workspaceId: alpha, threadRef: started.thread.threadRef }).items.map(item => item.message.body))
      .toEqual(['Old task', 'Old discussion', 'Please review this'])
  })

  it('gates existing Thread mutations on unread work before revision and makes reads idempotent', async () => {
    const test = await harness()
    const channel = await test.ctx.agentTeam.createChannel({ requestId: requestId('channel'), workspaceId: alpha, name: 'engineering', description: 'Engineering work' })
    const started = committed(await test.ctx.agentTeam.sendMessage({ requestId: requestId('start'), workspaceId: alpha, channelRef: channel.channel.channelRef, body: 'Task' }))
    const ledger = replayLedger(test)
    const { actor } = await addLedgerMember(ledger, channel.channel.channelRef)
    const follow = await ledger.changeAttention({ requestId: requestId('agent-follow'), workspaceId: alpha, taskRef: started.task.taskRef, action: 'follow', actor })
    expect(follow.value.attention).toMatchObject({ readThroughSequence: started.thread.revision })
    const update = committed((await ledger.reply({ requestId: requestId('human-update'), workspaceId: alpha, taskRef: started.task.taskRef,
      body: 'New evidence', baseRevision: started.thread.revision, actor: agentTeamHumanActor() })).value)
    const blocked = (await ledger.reply({ requestId: requestId('blocked'), workspaceId: alpha, taskRef: started.task.taskRef,
      body: 'Reply without read', baseRevision: started.thread.revision, actor })).value
    expect(blocked).toMatchObject({ kind: 'unread_required', revision: update.thread.revision })
    const readRequest = { requestId: requestId('agent-read'), workspaceId: alpha, taskRef: started.task.taskRef, actor }
    const first = (await ledger.readThread(readRequest)).value
    const retry = (await ledger.readThread(readRequest)).value
    expect(retry).toEqual(first)
    expect(first.facts).toContainEqual(expect.objectContaining({ unread: true, fact: expect.objectContaining({ sequence: update.message.sequence }) }))
    const stale = (await ledger.reply({ requestId: requestId('stale'), workspaceId: alpha, taskRef: started.task.taskRef,
      body: 'Reply with obsolete revision', baseRevision: started.thread.revision, actor })).value
    expect(stale).toMatchObject({ kind: 'stale_revision', revision: update.thread.revision })
    expect(committed((await ledger.reply({ requestId: requestId('current'), workspaceId: alpha, taskRef: started.task.taskRef,
      body: 'Reply after read', baseRevision: update.thread.revision, actor })).value).message.body).toBe('Reply after read')
    ledger.validate()
  })

  it('makes a 21-update read continue explicit with a remaining unread count', async () => {
    const test = await harness()
    const channel = await test.ctx.agentTeam.createChannel({ requestId: requestId('channel'), workspaceId: alpha, name: 'engineering', description: 'Engineering work' })
    const started = committed(await test.ctx.agentTeam.sendMessage({ requestId: requestId('start'), workspaceId: alpha, channelRef: channel.channel.channelRef, body: 'Task' }))
    const ledger = replayLedger(test)
    const { actor } = await addLedgerMember(ledger, channel.channel.channelRef)
    const followed = await ledger.changeAttention({ requestId: requestId('follow-21'), workspaceId: alpha, taskRef: started.task.taskRef, action: 'follow', actor })
    let revision = followed.value.attention?.readThroughSequence ?? started.thread.revision
    for (let index = 0; index < 21; index++) {
      const sent = committed((await ledger.reply({ requestId: requestId(`update-21-${index}`), workspaceId: alpha, taskRef: started.task.taskRef,
        body: `Update ${index + 1}`, baseRevision: revision, actor: agentTeamHumanActor() })).value)
      revision = sent.thread.revision
    }
    const firstRequest = { requestId: requestId('read-21-first'), workspaceId: alpha, taskRef: started.task.taskRef, actor }
    const first = (await ledger.readThread(firstRequest)).value
    expect(first.facts.filter(fact => fact.unread)).toHaveLength(20)
    expect(first.remainingUnreadCount).toBe(1)
    const retry = (await ledger.readThread(firstRequest)).value
    expect(retry).toEqual(first)
    const second = (await ledger.readThread({ requestId: requestId('read-21-second'), workspaceId: alpha, taskRef: started.task.taskRef, actor })).value
    expect(second.facts.filter(fact => fact.unread)).toHaveLength(1)
    expect(second.remainingUnreadCount).toBe(0)
  })

  it('releases Claims and clears Attention on close without restoring it on reopen', async () => {
    const test = await harness()
    const channel = await test.ctx.agentTeam.createChannel({ requestId: requestId('channel'), workspaceId: alpha, name: 'engineering', description: 'Engineering work' })
    const started = committed(await test.ctx.agentTeam.sendMessage({ requestId: requestId('start'), workspaceId: alpha, channelRef: channel.channel.channelRef, body: 'Task' }))
    const ledger = replayLedger(test)
    const { actor } = await addLedgerMember(ledger, channel.channel.channelRef)
    const claim = committed((await ledger.changeClaim({ requestId: requestId('claim'), workspaceId: alpha, taskRef: started.task.taskRef,
      action: 'claim', direction: 'review', baseRevision: started.thread.revision, actor })).value)
    expect(claim.attention).toMatchObject({ memberId: actor.memberId })
    const humanRead = (await ledger.readThread({ requestId: requestId('human-read'), workspaceId: alpha, taskRef: started.task.taskRef,
      actor: agentTeamHumanActor() })).value
    const closed = committed((await ledger.changeTask({ requestId: requestId('close'), workspaceId: alpha, taskRef: started.task.taskRef,
      action: 'close', baseRevision: humanRead.thread.revision, actor: agentTeamHumanActor() })).value)
    expect(closed).toMatchObject({ task: { resolution: 'closed', status: 'closed' }, claims: [expect.objectContaining({ claimRef: claim.claim.claimRef, state: 'released' })] })
    expect(ledger.attentionStatus(actor, { workspaceId: alpha, taskRef: started.task.taskRef }).attention).toBeUndefined()
    const reopened = committed((await ledger.changeTask({ requestId: requestId('reopen'), workspaceId: alpha, taskRef: started.task.taskRef,
      action: 'reopen', baseRevision: closed.thread.revision, actor: agentTeamHumanActor() })).value)
    expect(reopened.task).toMatchObject({ resolution: 'open', status: 'todo' })
    expect(ledger.attentionStatus(actor, { workspaceId: alpha, taskRef: started.task.taskRef }).attention).toBeUndefined()
    ledger.validate()
  })

  it('rejects a structurally valid Thread read with a forged watermark during replay', async () => {
    const test = await harness()
    const channel = await test.ctx.agentTeam.createChannel({ requestId: requestId('channel'), workspaceId: alpha, name: 'engineering', description: 'Engineering work' })
    const started = committed(await test.ctx.agentTeam.sendMessage({ requestId: requestId('start'), workspaceId: alpha,
      channelRef: channel.channel.channelRef, body: 'Task' }))
    const updated = committed(await test.ctx.agentTeam.reply({ requestId: requestId('update'), workspaceId: alpha,
      taskRef: started.task.taskRef, body: 'Unread update', baseRevision: started.thread.revision }))
    await test.ctx.agentTeam.readThread({ requestId: requestId('read'), workspaceId: alpha, taskRef: started.task.taskRef })
    const records = [...test.facility.get('agent_team')!.table('operations').entries()].map(([id, operation]) => {
      const typed = operation as AgentTeamOperation
      if (typed.kind !== 'team/thread-read') return [id, typed] as [string, unknown]
      const forgedWatermark = updated.thread.revision + 100
      const attention = { ...typed.data.attention!, readThroughSequence: forgedWatermark }
      return [id, { ...typed, data: { ...typed.data, readThroughSequence: forgedWatermark, attention,
        inbox: { ...typed.data.inbox, attention: { ...typed.data.inbox.attention, set: [attention] } } } }] as [string, unknown]
    })
    await expect(harness(storedPool(records))).rejects.toThrow(/invalid Thread read projection/)
  })

  it('rejects forged member cleanup snapshots during replay', async () => {
    const test = await harness()
    const channel = await test.ctx.agentTeam.createChannel({ requestId: requestId('channel'), workspaceId: alpha, name: 'engineering', description: 'Engineering work' })
    const member = await test.ctx.agentTeam.addMember({ requestId: requestId('member'), workspaceId: alpha, handle: 'reviewer', description: 'Reviews changes', presetId: 'team-member', channelRefs: [channel.channel.channelRef] })
    const started = committed(await test.ctx.agentTeam.sendMessage({ requestId: requestId('start'), workspaceId: alpha, channelRef: channel.channel.channelRef, body: 'Task' }))
    await test.ctx.agentTeam.removeChannelMember({ requestId: requestId('remove'), workspaceId: alpha, channelRef: channel.channel.channelRef, memberId: member.status.member.memberId })
    const records = [...test.facility.get('agent_team')!.table('operations').entries()].map(([id, operation]) => {
      const typed = operation as AgentTeamOperation
      if (typed.kind !== 'team/channel-member-removed') return [id, typed] as [string, unknown]
      return [id, { ...typed, data: { ...typed.data, tasks: [started.task] } }] as [string, unknown]
    })
    await expect(harness(storedPool(records))).rejects.toThrow(/invalid released Claim Task or Thread projection/)
  })

  it('rejects a forged direct marker that does not match its Message during replay', async () => {
    const test = await harness()
    const channel = await test.ctx.agentTeam.createChannel({ requestId: requestId('channel'), workspaceId: alpha, name: 'engineering', description: 'Engineering work' })
    const started = committed(await test.ctx.agentTeam.sendMessage({ requestId: requestId('start'), workspaceId: alpha, channelRef: channel.channel.channelRef, body: 'Task' }))
    const ledger = replayLedger(test)
    const { actor } = await addLedgerMember(ledger, channel.channel.channelRef)
    const followed = await ledger.changeAttention({ requestId: requestId('follow'), workspaceId: alpha, taskRef: started.task.taskRef, action: 'follow', actor })
    committed((await ledger.reply({ requestId: requestId('mention'), workspaceId: alpha, taskRef: started.task.taskRef, body: 'Check this', baseRevision: followed.value.thread.revision, recipients: [actor.memberId], actor: agentTeamHumanActor() })).value)
    const records = [...test.facility.get('agent_team')!.table('operations').entries()].map(([id, operation]) => {
      const typed = operation as AgentTeamOperation
      if (typed.kind !== 'team/thread-replied') return [id, typed] as [string, unknown]
      const marker = typed.data.inbox.directMarkers.added[0]!
      return [id, { ...typed, data: { ...typed.data, inbox: { ...typed.data.inbox, directMarkers: {
        ...typed.data.inbox.directMarkers, added: [{ ...marker, sequence: marker.sequence + 1 }],
      } } } }] as [string, unknown]
    })
    await expect(harness(storedPool(records))).rejects.toThrow(/invalid direct marker addition/)
  })

  it('replays an Agent Attention read watermark from SQLite across a Host restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-team-sqlite-'))
    cleanups.push(() => rm(root, { recursive: true, force: true }))
    const path = join(root, 'team.sqlite')
    const first = await sqliteHarness(path)
    const channel = await first.ctx.agentTeam.createChannel({ requestId: requestId('channel'), workspaceId: alpha, name: 'engineering', description: 'Engineering work' })
    const started = committed(await first.ctx.agentTeam.sendMessage({ requestId: requestId('start'), workspaceId: alpha, channelRef: channel.channel.channelRef, body: 'Persistent task' }))
    const ledger = replayLedger(first)
    const { actor } = await addLedgerMember(ledger, channel.channel.channelRef)
    await ledger.changeAttention({ requestId: requestId('follow'), workspaceId: alpha, taskRef: started.task.taskRef, action: 'follow', actor })
    const update = committed((await ledger.reply({ requestId: requestId('update'), workspaceId: alpha, taskRef: started.task.taskRef,
      body: 'Persistent update', baseRevision: started.thread.revision, actor: agentTeamHumanActor() })).value)
    const read = (await ledger.readThread({ requestId: requestId('read'), workspaceId: alpha, taskRef: started.task.taskRef, actor })).value
    expect(read.readThroughSequence).toBe(update.thread.revision)
    await first.fiber.dispose(); await first.facility.closeAll()
    const second = await sqliteHarness(path)
    const replay = replayLedger(second)
    expect(replay.inbox(actor, { workspaceId: alpha })).toEqual({ items: [], totalUnreadCount: 0, totalDirectCount: 0 })
    expect(second.ctx.agentTeam.view({ workspaceId: alpha, threadRef: started.thread.threadRef }).items.map(item => item.message.body)).toEqual(['Persistent task', 'Persistent update'])
    expect(replay.attentionStatus(actor, { workspaceId: alpha, taskRef: started.task.taskRef }).attention).toMatchObject({ readThroughSequence: update.thread.revision })
    replay.validate()
    second.ctx.agentTeam.validateLedger()
  })

  it('fails loud on malformed durable records and an invariant catches projection divergence', async () => {
    await expect(harness(storedPool([['operation:bad', { sequence: 'one' }]]))).rejects.toThrow(/does not match its schema/)
    const test = await harness()
    await test.ctx.plugin(InvariantRegistry)
    await test.ctx.plugin(agentTeamInvariant)
    const domain = test.facility.get('agent_team')!
    const table = domain.table('operations')
    const [id, operation] = [...table.entries()][0]!
    await table.put(id, { ...(operation as AgentTeamOperation), sequence: 2 })
    expect(() => test.ctx.emit('agent-team/committed', { receipt: { operationId: id as AgentTeamOperationId, requestId: AGENT_TEAM_INITIALIZE_REQUEST_ID, sequence: 2 } })).toThrow(/invariant violated/)
  })

  it('rejects cross-Workspace refs and preserves durability before projection mutation', async () => {
    const pool = new MemoryMediaPool()
    const test = await harness(pool, [alpha, beta])
    pool.failNextWrites = 1
    await expect(test.ctx.agentTeam.createChannel({ requestId: requestId('failed'), workspaceId: alpha, name: 'engineering', description: 'Engineering work' })).rejects.toThrow(/injected write failure/)
    expect(test.ctx.agentTeam.status()).toMatchObject({ channelCount: 0, sequence: 1 })
    const channel = await test.ctx.agentTeam.createChannel({ requestId: requestId('channel'), workspaceId: alpha, name: 'engineering', description: 'Engineering work' })
    expect(() => test.ctx.agentTeam.view({ workspaceId: beta, channelRef: channel.channel.channelRef })).toThrow(/does not belong to Workspace/)
  })
})
