import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { SqliteStorageBackend } from '@deepseek-ai/dsh-storage-sqlite'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { MemoryMediaPool, MemoryStorageBackend } from './helpers/memory-backend.ts'
import AgentTeam, {
  AGENT_TEAM_HUMAN_MEMBER_ID,
  AGENT_TEAM_INITIALIZE_REQUEST_ID,
} from '../src/index.ts'
import * as agentTeamInvariant from '../src/invariant.ts'
import { AgentTeamLedger } from '../src/ledger.ts'
import type {
  AgentTeamChannelRef,
  AgentTeamMemberId,
  AgentTeamOperation,
  AgentTeamOperationId,
  AgentTeamRequestId,
} from '../src/types.ts'

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

async function harness(
  pool = new MemoryMediaPool(),
  workspaceIds = [WorkspaceId('workspace:alpha')],
): Promise<TeamHarness> {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  ctx.provide('workspaceRegistry', {
    get: (id: WorkspaceId) => workspaceIds.includes(id)
      ? { id, path: process.cwd(), attachSession: async () => {} }
      : undefined,
    list: () => workspaceIds.map(id => ({ id, path: process.cwd() })),
  })
  ctx.provide('agents', { create: async () => { throw new Error('unused') }, resume: async () => { throw new Error('unused') } })
  ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'mock', model: 'mock' }) })
  ctx.provide('agentPresets', { mount: async () => { throw new Error('unused') } })
  ctx.provide('tools', { schemas: () => [] })
  ctx.provide('sessions', { flush: async () => true })
  ctx.provide('sessionPersistence', { list: async () => [] })
  const fiber = await ctx.plugin(AgentTeam)
  cleanups.push(async () => {
    await fiber.dispose()
    await facility.closeAll()
  })
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
  ctx.provide('workspaceRegistry', { get: (id: WorkspaceId) => ({ id, path: process.cwd(), attachSession: async () => {} }), list: () => [] })
  ctx.provide('agents', { create: async () => { throw new Error('unused') }, resume: async () => { throw new Error('unused') } })
  ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'mock', model: 'mock' }) })
  ctx.provide('agentPresets', { mount: async () => { throw new Error('unused') } })
  ctx.provide('tools', { schemas: () => [] })
  ctx.provide('sessions', { flush: async () => true })
  ctx.provide('sessionPersistence', { list: async () => [] })
  const fiber = await ctx.plugin(AgentTeam)
  cleanups.push(async () => { await fiber.dispose(); await facility.closeAll(); await backend.close() })
  return { ctx, fiber, facility }
}

function storedPool(records: Array<[string, unknown]>, version = 5): MemoryMediaPool {
  const pool = new MemoryMediaPool()
  pool.versions.set('agent_team', version)
  pool.media.set('agent_team', {
    tables: new Map([['operations', new Map(records)]]),
    global: null,
  })
  return pool
}

describe('AgentTeam', () => {
  it('boots an empty Team and replays the same initialization operation', async () => {
    const pool = new MemoryMediaPool()
    const first = await harness(pool)
    expect(first.ctx.agentTeam.status()).toEqual({
      initialized: true,
      sequence: 1,
      operationCount: 1,
      channelCount: 0,
      agentMemberCount: 0,
      humanMemberId: AGENT_TEAM_HUMAN_MEMBER_ID,
    })
    const stored = [...pool.media.get('agent_team')!.tables.get('operations')!.values()]
    expect(stored).toHaveLength(1)

    await first.fiber.dispose()
    expect(first.ctx.get('agentTeam')).toBeUndefined()
    const secondFiber = await first.ctx.plugin(AgentTeam)
    expect(first.ctx.agentTeam.status()).toEqual(expect.objectContaining({ sequence: 1, operationCount: 1 }))
    const replayed = [...pool.media.get('agent_team')!.tables.get('operations')!.values()]
    expect(replayed).toEqual(stored)
    await secondFiber.dispose()
  })

  it('replays the same durable projection from a SQLite file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-team-sqlite-'))
    cleanups.push(() => rm(root, { recursive: true, force: true }))
    const path = join(root, 'team.sqlite')
    const first = await sqliteHarness(path)
    const channel = await first.ctx.agentTeam.createChannel({ requestId: requestId('request:sqlite-channel'), workspaceId: alpha, name: 'sqlite', description: 'SQLite restart proof' })
    const sent = await first.ctx.agentTeam.sendMessage({ requestId: requestId('request:sqlite-message'), workspaceId: alpha,
      channelRef: channel.channel.channelRef, body: 'persist in sqlite' })
    await first.ctx.agentTeam.reply({ requestId: requestId('request:sqlite-human-reply'), workspaceId: alpha,
      taskRef: sent.task.taskRef, body: 'Human reply in sqlite', baseRevision: sent.thread.revision })
    const closed = await first.ctx.agentTeam.changeTask({ requestId: requestId('request:sqlite-close'), workspaceId: alpha,
      taskRef: sent.task.taskRef, action: 'close' })
    await first.ctx.agentTeam.reply({ requestId: requestId('request:sqlite-reply-after-close'), workspaceId: alpha,
      taskRef: sent.task.taskRef, body: 'Reply after close in sqlite', baseRevision: closed.thread.revision })
    const before = first.ctx.agentTeam.view({ workspaceId: alpha })
    await first.fiber.dispose(); await first.facility.closeAll()
    const second = await sqliteHarness(path)
    expect(second.ctx.agentTeam.view({ workspaceId: alpha })).toEqual(before)
    expect(second.ctx.agentTeam.status()).toMatchObject({ operationCount: 6, sequence: 6 })
    expect(second.ctx.agentTeam.view({ workspaceId: alpha }).tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({ taskRef: sent.task.taskRef, status: 'closed', resolution: 'closed' }),
    ]))
    expect(second.ctx.agentTeam.view({ workspaceId: alpha }).items).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: expect.objectContaining({ sender: AGENT_TEAM_HUMAN_MEMBER_ID,
        body: 'Human reply in sqlite', topLevel: false }) }),
      expect.objectContaining({ message: expect.objectContaining({ sender: AGENT_TEAM_HUMAN_MEMBER_ID,
        body: 'Reply after close in sqlite', topLevel: false }) }),
    ]))
  })

  it('leaves no business effect before durability and commits one effect on retry', async () => {
    const pool = new MemoryMediaPool()
    const test = await harness(pool)
    pool.failNextWrites = 1
    const request = { requestId: requestId('request:durability-retry'), workspaceId: alpha, name: 'retry', description: 'Retried durability' }
    await expect(test.ctx.agentTeam.createChannel(request)).rejects.toThrow(/injected write failure/)
    expect(test.ctx.agentTeam.status()).toMatchObject({ operationCount: 1, channelCount: 0 })
    const created = await test.ctx.agentTeam.createChannel(request)
    expect(created.receipt.sequence).toBe(2)
    expect(test.ctx.agentTeam.status()).toMatchObject({ operationCount: 2, channelCount: 1 })
  })

  it('fails loud on a mismatched ledger version', async () => {
    await expect(harness(storedPool([], 99))).rejects.toThrow(/stamped v99, descriptor wants v5/)
  })

  it('fails loud when a durable operation does not match its schema', async () => {
    await expect(harness(storedPool([['operation:bad', { sequence: 'one' }]])))
      .rejects.toThrow(/does not match its schema/)
  })

  it('fails loud on a sequence gap', async () => {
    const operation = {
      sequence: 2,
      operationId: 'operation:gap',
      requestId: AGENT_TEAM_INITIALIZE_REQUEST_ID,
      occurredAt: '2026-08-15T00:00:00.000Z',
      actor: { kind: 'human', memberId: AGENT_TEAM_HUMAN_MEMBER_ID, handle: 'human' },
      previousOperationId: null,
      kind: 'team/initialized',
      data: { humanMemberId: AGENT_TEAM_HUMAN_MEMBER_ID },
    }
    await expect(harness(storedPool([['operation:gap', operation]])))
      .rejects.toThrow(/expected sequence 1, found 2/)
  })

  it('fails loud on a broken previous-operation link', async () => {
    const operation = {
      sequence: 1,
      operationId: 'operation:broken',
      requestId: AGENT_TEAM_INITIALIZE_REQUEST_ID,
      occurredAt: '2026-08-15T00:00:00.000Z',
      actor: { kind: 'human', memberId: AGENT_TEAM_HUMAN_MEMBER_ID, handle: 'human' },
      previousOperationId: 'operation:missing',
      kind: 'team/initialized',
      data: { humanMemberId: AGENT_TEAM_HUMAN_MEMBER_ID },
    }
    await expect(harness(storedPool([['operation:broken', operation]])))
      .rejects.toThrow(/does not match its schema/)
  })

  it('creates and replays one atomic top-level Message bundle with stable refs', async () => {
    const pool = new MemoryMediaPool()
    const first = await harness(pool)
    const channel = await first.ctx.agentTeam.createChannel({
      requestId: requestId('request:create-general'),
      workspaceId: alpha,
      name: 'general',
      description: 'General collaboration',
    })
    const sent = await first.ctx.agentTeam.sendMessage({
      requestId: requestId('request:send-first'),
      workspaceId: alpha,
      channelRef: channel.channel.channelRef,
      body: 'Implement the first task',
    })
    expect(sent).toMatchObject({
      receipt: { sequence: 3 },
      message: {
        channelRef: channel.channel.channelRef,
        sender: AGENT_TEAM_HUMAN_MEMBER_ID,
        topLevel: true,
        sequence: 3,
      },
      task: { status: 'todo' },
      thread: { revision: 3 },
      follows: [{ memberId: AGENT_TEAM_HUMAN_MEMBER_ID, following: true }],
      deliveries: [],
    })
    expect(sent.message.taskRef).toBe(sent.task.taskRef)
    expect(sent.message.threadRef).toBe(sent.thread.threadRef)

    const { receipt: _receipt, ...sentData } = sent
    const operation = [...pool.media.get('agent_team')!.tables.get('operations')!.values()][2]
    expect(operation).toMatchObject({ kind: 'team/message-sent', data: sentData })
    expect(Object.isFrozen(operation)).toBe(true)

    const beforeRestart = first.ctx.agentTeam.view({ workspaceId: alpha })
    await first.fiber.dispose()
    const replayFiber = await first.ctx.plugin(AgentTeam)
    expect(first.ctx.agentTeam.view({ workspaceId: alpha })).toEqual(beforeRestart)
    expect(first.ctx.agentTeam.status()).toMatchObject({ sequence: 3, operationCount: 3 })
    await replayFiber.dispose()
  })

  it('paginates by sequence and rejects unknown, cross-type, and cross-Workspace refs', async () => {
    const test = await harness(new MemoryMediaPool(), [alpha, beta])
    const created = await test.ctx.agentTeam.createChannel({
      requestId: requestId('request:create-paging'),
      workspaceId: alpha,
      name: 'paging',
      description: 'Paged history',
    })
    for (let index = 0; index < 21; index += 1) {
      await test.ctx.agentTeam.sendMessage({
        requestId: requestId(`request:page-${index}`),
        workspaceId: alpha,
        channelRef: created.channel.channelRef,
        body: `message ${index}`,
      })
    }

    const first = test.ctx.agentTeam.view({ workspaceId: alpha })
    expect(first.items).toHaveLength(20)
    expect(first.hasMore).toBe(true)
    expect(first.items[0]!.thread.revision).toBe(first.items[0]!.message.sequence)
    const second = test.ctx.agentTeam.view({
      workspaceId: alpha,
      cursor: first.cursor,
      limit: 1,
    })
    expect(second.items).toHaveLength(1)
    expect(second.items[0]!.message.sequence).toBeGreaterThan(first.cursor)
    expect(second.hasMore).toBe(false)
    expect(new Set([...first.items, ...second.items].map(item => item.message.messageRef)).size).toBe(21)

    expect(() => test.ctx.agentTeam.view({
      workspaceId: beta,
      channelRef: created.channel.channelRef,
    })).toThrow(/does not belong to Workspace/)
    expect(() => test.ctx.agentTeam.view({
      workspaceId: alpha,
      channelRef: second.items[0]!.task.taskRef as unknown as AgentTeamChannelRef,
    })).toThrow(/unknown Channel ref/)
    expect(() => test.ctx.agentTeam.view({ workspaceId: alpha, limit: 0 })).toThrow(/between 1 and 100/)
    expect(() => test.ctx.agentTeam.view({ workspaceId: alpha, limit: 101 })).toThrow(/between 1 and 100/)
    expect(() => test.ctx.agentTeam.view({ workspaceId: alpha, cursor: -1 })).toThrow(/non-negative/)
    expect(() => test.ctx.agentTeam.view({ workspaceId: WorkspaceId('workspace:missing') }))
      .toThrow(/unknown Workspace/)
  })

  it('resolves identical retries and rejects request-id collisions before appending', async () => {
    const test = await harness()
    const request = {
      requestId: requestId('request:idempotent-channel'),
      workspaceId: alpha,
      name: 'idempotent',
      description: 'Idempotent channel',
    }
    const initialChange = await test.ctx.agentTeam.changes({ afterVersion: 0 })
    const changed = test.ctx.agentTeam.changes({ afterVersion: initialChange.version })
    const first = await test.ctx.agentTeam.createChannel(request)
    expect((await changed).version).toBeGreaterThan(initialChange.version)
    await expect(test.ctx.agentTeam.createChannel(request)).resolves.toEqual(first)
    await expect(test.ctx.agentTeam.createChannel({ ...request, name: 'changed' }))
      .rejects.toThrow(/different operation or payload/)
    await expect(test.ctx.agentTeam.createChannel({ ...request, description: 'changed' }))
      .rejects.toThrow(/different operation or payload/)

    const sendRequest = {
      requestId: requestId('request:idempotent-send'),
      workspaceId: alpha,
      channelRef: first.channel.channelRef,
      body: '  same body  ',
    }
    const sent = await test.ctx.agentTeam.sendMessage(sendRequest)
    expect(sent.message.body).toBe('same body')
    await expect(test.ctx.agentTeam.sendMessage(sendRequest)).resolves.toEqual(sent)
    await expect(test.ctx.agentTeam.sendMessage({ ...sendRequest, body: 'same body' }))
      .resolves.toEqual(sent)
    await expect(test.ctx.agentTeam.sendMessage({ ...sendRequest, body: 'changed body' }))
      .rejects.toThrow(/different operation or payload/)
    expect(test.ctx.agentTeam.status().operationCount).toBe(3)
  })

  it('pages the latest top-level Channel Messages backward without Activity gaps', async () => {
    const test = await harness()
    const channel = await test.ctx.agentTeam.createChannel({ requestId: requestId('request:page-channel'),
      workspaceId: alpha, name: 'history', description: 'Bounded history' })
    const sent = []
    for (const [index, body] of ['one', 'two', 'three'].entries()) {
      sent.push(await test.ctx.agentTeam.sendMessage({ requestId: requestId(`request:page-${index}`),
        workspaceId: alpha, channelRef: channel.channel.channelRef, body }))
    }
    await test.ctx.agentTeam.changeTask({ requestId: requestId('request:page-close'), workspaceId: alpha,
      taskRef: sent[2]!.task.taskRef, action: 'close' })

    const latest = test.ctx.agentTeam.view({ workspaceId: alpha, channelRef: channel.channel.channelRef,
      direction: 'before', topLevelOnly: true, limit: 2 })
    expect(latest.items.map(item => item.message.body)).toEqual(['two', 'three'])
    expect(latest.items.map(item => item.taskNumber)).toEqual([2, 3])
    expect(latest.items[1]!.task.status).toBe('closed')
    expect(latest.activities).toEqual([])
    expect(latest.hasMore).toBe(true)

    const older = test.ctx.agentTeam.view({ workspaceId: alpha, channelRef: channel.channel.channelRef,
      direction: 'before', topLevelOnly: true, cursor: latest.cursor, limit: 2 })
    expect(older.items.map(item => item.message.body)).toEqual(['one'])
    expect(older.items[0]!.taskNumber).toBe(1)
    expect(older.hasMore).toBe(false)
  })

  it('registers a package invariant that rejects projection divergence', async () => {
    const test = await harness()
    await test.ctx.plugin(InvariantRegistry)
    await test.ctx.plugin(agentTeamInvariant)
    const domain = test.facility.get('agent_team')
    if (domain === undefined) throw new Error('agent-team domain was not open')
    const table = domain.table('operations')
    const [operationId, operation] = [...table.entries()][0]!
    await table.put(operationId, { ...(operation as AgentTeamOperation), sequence: 2 })

    expect(() => {
      test.ctx.emit('agent-team/committed', {
        receipt: {
          operationId: operationId as AgentTeamOperationId,
          requestId: AGENT_TEAM_INITIALIZE_REQUEST_ID,
          sequence: 2,
        },
      })
    }).toThrow(/invariant violated by "@deepseek-ai\/dsh-agent-team"/)
  })
})

describe('AgentTeamLedger idempotency', () => {
  it('returns the original receipt for the same request and rejects a changed payload', async () => {
    const records = new Map<AgentTeamOperationId, AgentTeamOperation>()
    const table: KvTable<AgentTeamOperationId, AgentTeamOperation> = {
      get: key => records.get(key),
      entries: () => new Map(records).entries(),
      keys: () => new Map(records).keys(),
      get size() { return records.size },
      put: async (key, value) => { records.set(key, value) },
      delete: async key => records.delete(key),
      update: async (key, update) => {
        const current = records.get(key)
        if (current === undefined) throw new Error('missing')
        const next = update(current)
        records.set(key, next)
        return next
      },
    }
    const ledger = new AgentTeamLedger(table, {
      operationId: () => 'operation:fixed' as AgentTeamOperationId,
      occurredAt: () => '2026-08-15T00:00:00.000Z',
    })
    const first = await ledger.initialize()
    await expect(ledger.initialize()).resolves.toEqual({ value: first.value, committed: false })
    await expect(ledger.initialize({
      requestId: AGENT_TEAM_INITIALIZE_REQUEST_ID,
      actor: {
        kind: 'human',
        memberId: 'member:other' as AgentTeamMemberId,
        handle: 'other',
      },
      humanMemberId: 'member:other' as AgentTeamMemberId,
    })).rejects.toThrow(/reused with a different operation or payload/)
    expect(records).toHaveLength(1)
  })
})
