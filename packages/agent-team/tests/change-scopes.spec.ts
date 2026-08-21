import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { SessionId } from '@deepseek-ai/dsh-session'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { MemoryMediaPool, MemoryStorageBackend } from './helpers/memory-backend.ts'
import AgentTeam, { AGENT_TEAM_HUMAN_MEMBER_ID, agentTeamDomainSpec } from '../src/index.ts'
import { AgentTeamLedger, agentTeamHumanActor } from '../src/ledger.ts'
import * as agentTeamInvariant from '../src/invariant.ts'
import type { AgentTeamChangeScope, AgentTeamChannelRef, AgentTeamMemberActor, AgentTeamOperation, AgentTeamOperationId, AgentTeamRequestId, AgentTeamTaskRef, AgentTeamThreadRef } from '../src/types.ts'

const cleanups: Array<() => Promise<void>> = []
const alpha = WorkspaceId('workspace:alpha')
const requestId = (value: string): AgentTeamRequestId => value as AgentTeamRequestId

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(cleanup => cleanup()))
})

async function harness(): Promise<{ readonly ctx: Context; readonly facility: DomainFacility }> {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  ctx.provide('workspaceRegistry', {
    get: (id: WorkspaceId) => id === alpha ? { id, path: process.cwd(), attachSession: async () => {}, archiveSession: async () => {} } : undefined,
    list: () => [{ id: alpha, path: process.cwd() }],
  })
  ctx.provide('agents', { create: async () => { throw new Error('unused') }, resume: async () => { throw new Error('unused') } })
  ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'mock', model: 'mock' }) })
  ctx.provide('agentPresets', { mount: async () => { throw new Error('unused') } })
  ctx.provide('tools', { schemas: () => [] })
  ctx.provide('sessionPersistence', { list: async () => [] })
  await ctx.plugin(InvariantRegistry)
  await ctx.plugin(agentTeamInvariant)
  const fiber = await ctx.plugin(AgentTeam)
  cleanups.push(async () => { await fiber.dispose(); await facility.closeAll() })
  return { ctx, facility }
}

function replayLedger(facility: DomainFacility): AgentTeamLedger {
  return new AgentTeamLedger(facility.get('agent_team')!.table('operations') as unknown as KvTable<AgentTeamOperationId, AgentTeamOperation>)
}

/** Resolve only after a macrotask so a premature wake-up cannot hide behind microtasks. */
async function staysPending(promise: Promise<unknown>, ms = 15): Promise<boolean> {
  let settled = false
  void promise.then(() => { settled = true }, () => { settled = true })
  await new Promise(resolve => setTimeout(resolve, ms))
  return !settled
}

async function startThread(ctx: Context, label: string): Promise<{ readonly threadRef: AgentTeamThreadRef; readonly taskRef: AgentTeamTaskRef; readonly channelRef: AgentTeamChannelRef; readonly revision: number }> {
  const channel = await ctx.agentTeam.createChannel({ requestId: requestId(`channel-${label}`), workspaceId: alpha, name: label, description: `${label} work` })
  const started = await ctx.agentTeam.sendMessage({ requestId: requestId(`start-${label}`), workspaceId: alpha, channelRef: channel.channel.channelRef, body: `Task ${label}` })
  if (started.kind !== 'committed') throw new Error(`expected committed start, received ${started.kind}`)
  return { threadRef: started.thread.threadRef, taskRef: started.task.taskRef, channelRef: channel.channel.channelRef, revision: started.thread.revision }
}

describe('scoped Team change notifications', () => {
  it('does not wake any waiter when a Human Thread read commits', async () => {
    const { ctx } = await harness()
    const thread = await startThread(ctx, 'read-scope')
    const baseline = await ctx.agentTeam.changes({ afterVersion: 0 })
    const threadWaiter = ctx.agentTeam.changes({ afterVersion: baseline.version, scope: { kind: 'thread', threadRef: thread.threadRef } })
    const globalWaiter = ctx.agentTeam.changes({ afterVersion: baseline.version })
    expect(await staysPending(threadWaiter)).toBe(true)
    expect(await staysPending(globalWaiter)).toBe(true)

    await ctx.agentTeam.readThread({ requestId: requestId('read'), workspaceId: alpha, taskRef: thread.taskRef })

    // The read is durable and advances the version, yet invalidates nobody:
    // a read only advances the reader's private watermark.
    const after = await ctx.agentTeam.changes({ afterVersion: 0 })
    expect(after.version).toBe(baseline.version + 1)
    expect(await staysPending(threadWaiter)).toBe(true)
    expect(await staysPending(globalWaiter)).toBe(true)

    // A real content change on the same Thread still wakes both.
    const reply = await ctx.agentTeam.reply({ requestId: requestId('reply'), workspaceId: alpha, taskRef: thread.taskRef, body: 'Update', baseRevision: thread.revision })
    if (reply.kind !== 'committed') throw new Error(`expected committed reply, received ${reply.kind}`)
    expect(await threadWaiter).toMatchObject({ version: after.version + 1 })
    expect(await globalWaiter).toMatchObject({ version: after.version + 1 })
  })

  it('wakes a Thread waiter only for changes of that Thread', async () => {
    const { ctx } = await harness()
    const first = await startThread(ctx, 'alpha-thread')
    const second = await startThread(ctx, 'beta-thread')
    const baseline = await ctx.agentTeam.changes({ afterVersion: 0 })
    const firstWaiter = ctx.agentTeam.changes({ afterVersion: baseline.version, scope: { kind: 'thread', threadRef: first.threadRef } })
    expect(await staysPending(firstWaiter)).toBe(true)

    await ctx.agentTeam.reply({ requestId: requestId('other-reply'), workspaceId: alpha, taskRef: second.taskRef, body: 'Unrelated', baseRevision: second.revision })
    expect(await staysPending(firstWaiter)).toBe(true)

    await ctx.agentTeam.reply({ requestId: requestId('own-reply'), workspaceId: alpha, taskRef: first.taskRef, body: 'Related', baseRevision: first.revision })
    expect(await firstWaiter).toMatchObject({ version: baseline.version + 2 })
  })

  it('wakes Channel and Workspace waiters through their own scopes', async () => {
    const { ctx } = await harness()
    const thread = await startThread(ctx, 'mixed')
    const baseline = await ctx.agentTeam.changes({ afterVersion: 0 })
    const channelWaiter = ctx.agentTeam.changes({ afterVersion: baseline.version, scope: { kind: 'channel', channelRef: thread.channelRef } })
    const workspaceWaiter = ctx.agentTeam.changes({ afterVersion: baseline.version, scope: { kind: 'workspace', workspaceId: alpha } })
    expect(await staysPending(channelWaiter)).toBe(true)
    expect(await staysPending(workspaceWaiter)).toBe(true)

    await ctx.agentTeam.addMember({ requestId: requestId('member'), workspaceId: alpha, handle: 'scout', description: 'Scouts work', presetId: 'team-member', channelRefs: [thread.channelRef] })
    // Member lifecycle is workspace-scoped: the workspace waiter wakes, the
    // Channel content waiter stays parked until Channel data changes.
    expect(await workspaceWaiter).toMatchObject({ version: expect.any(Number) })
    expect(await staysPending(channelWaiter)).toBe(true)

    await ctx.agentTeam.reply({ requestId: requestId('channel-reply'), workspaceId: alpha, taskRef: thread.taskRef, body: 'Content', baseRevision: thread.revision })
    const woken = await channelWaiter
    expect(woken.version).toBeGreaterThan(baseline.version)
  })

  it('rejects an aborted waiter and keeps later commits working', async () => {
    const { ctx } = await harness()
    const thread = await startThread(ctx, 'abort')
    const baseline = await ctx.agentTeam.changes({ afterVersion: 0 })
    const controller = new AbortController()
    const aborted = ctx.agentTeam.changes({ afterVersion: baseline.version, scope: { kind: 'thread', threadRef: thread.threadRef } }, controller.signal)
    const survivor = ctx.agentTeam.changes({ afterVersion: baseline.version })
    controller.abort()
    await expect(aborted).rejects.toThrow(/aborted/)

    await ctx.agentTeam.reply({ requestId: requestId('after-abort'), workspaceId: alpha, taskRef: thread.taskRef, body: 'Still works', baseRevision: thread.revision })
    expect(await survivor).toMatchObject({ version: baseline.version + 1 })
  })

  it('validates change scopes before parking', async () => {
    const { ctx } = await harness()
    await expect(ctx.agentTeam.changes({ afterVersion: 0, scope: { kind: 'channel', channelRef: '' } as unknown as AgentTeamChangeScope })).rejects.toThrow(/non-empty ref/)
    await expect(ctx.agentTeam.changes({ afterVersion: -1 })).rejects.toThrow(/non-negative integer/)
  })
})

describe('ledger change scope and affected member derivation', () => {
  it('derives empty scopes for reads and precise scopes plus members for replies', async () => {
    const { ctx, facility } = await harness()
    const thread = await startThread(ctx, 'derive')
    const read = await ctx.agentTeam.readThread({ requestId: requestId('derive-read'), workspaceId: alpha, taskRef: thread.taskRef })
    const reply = await ctx.agentTeam.reply({ requestId: requestId('derive-reply'), workspaceId: alpha, taskRef: thread.taskRef, body: 'Derived', baseRevision: thread.revision })
    if (reply.kind !== 'committed') throw new Error(`expected committed reply, received ${reply.kind}`)

    // Replay after every commit so the derived indexes include all operations.
    const ledger = replayLedger(facility)
    const readOperation = ledger.getOperation(read.receipt.operationId)
    expect(readOperation).toBeDefined()
    expect(ledger.changeScopesOf(readOperation!)).toEqual([])

    const replyOperation = ledger.getOperation(reply.receipt.operationId)
    expect(replyOperation).toBeDefined()
    expect(ledger.changeScopesOf(replyOperation!)).toEqual([
      { kind: 'channel', channelRef: thread.channelRef },
      { kind: 'thread', threadRef: thread.threadRef },
    ])
    // The Human sender has no live handle, and nobody follows the Thread yet.
    expect(ledger.affectedMembersOf(replyOperation!)).toEqual([AGENT_TEAM_HUMAN_MEMBER_ID])
  })

  it('derives follower membership from Attention state on an isolated ledger', async () => {
    const ctx = new Context()
    await ctx.plugin(Storage)
    ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
    const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
    ctx.storage.mount('domain', facility)
    ctx.provide('storageDomain', facility)
    cleanups.push(async () => { await facility.closeAll() })
    const domain = await ctx.storageDomain.open(agentTeamDomainSpec)
    const ledger = new AgentTeamLedger(domain.table('operations'))
    await ledger.initialize()

    const created = (await ledger.createChannel({
      requestId: requestId('iso-channel'), workspaceId: alpha, name: 'isolated', description: 'Isolated work',
      memberIds: [], actor: agentTeamHumanActor(),
    })).value
    const started = (await ledger.sendMessage({
      requestId: requestId('iso-start'), workspaceId: alpha, channelRef: created.channel.channelRef, body: 'Task', actor: agentTeamHumanActor(),
    }))
    if (started.value.kind !== 'committed') throw new Error('expected committed start')
    const memberId = `member:agent-${crypto.randomUUID()}` as AgentTeamMemberActor['memberId']
    await ledger.addMember({
      requestId: requestId('iso-member'), workspaceId: alpha, handle: 'follower', description: 'Follows work', presetId: 'team-member',
      channelRefs: [created.channel.channelRef], actor: agentTeamHumanActor(),
      member: {
        memberId, sessionId: SessionId(`session:${memberId}`), workspaceId: alpha, handle: 'follower',
        description: 'Follows work', presetId: 'team-member', privateMemoryPath: '/tmp/follower', state: 'enabled' as const,
      },
    })
    await ledger.changeAttention({ requestId: requestId('iso-follow'), workspaceId: alpha, taskRef: started.value.task.taskRef, action: 'follow', actor: { kind: 'member', memberId, handle: 'follower' } })

    const committed = started.value
    const reply = (await ledger.reply({
      requestId: requestId('iso-reply'), workspaceId: alpha, taskRef: committed.task.taskRef, body: 'Wake the follower',
      baseRevision: committed.thread.revision, actor: agentTeamHumanActor(),
    })).value
    if (reply.kind !== 'committed') throw new Error(`expected committed reply, received ${reply.kind}`)
    const operation = ledger.getOperation(reply.receipt.operationId)
    expect(operation).toBeDefined()
    // The follower via Attention, plus the Human who follows their own Task.
    const affected = ledger.affectedMembersOf(operation!)
    expect(affected).toHaveLength(2)
    expect(affected).toContain(memberId)
    expect(affected).toContain(AGENT_TEAM_HUMAN_MEMBER_ID)
  })
})
