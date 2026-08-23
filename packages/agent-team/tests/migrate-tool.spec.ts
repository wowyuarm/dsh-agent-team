import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { SqliteStorageBackend } from '@deepseek-ai/dsh-storage-sqlite'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { MemoryMediaPool, MemoryStorageBackend } from './helpers/memory-backend.ts'
import { AgentTeamLedger, agentTeamHumanActor } from '../src/ledger.ts'
import type { AgentTeamLedgerResult } from '../src/ledger.ts'
import type { AgentTeamRequestId } from '../src/types.ts'
import { agentTeamDomainSpec } from '../src/spec.ts'
import { migrateLedgerMedia } from '../../../scripts/migrate-team-ledger.ts'

const cleanups: Array<() => Promise<void>> = []
const workspaceId = WorkspaceId('workspace:migrate')
const requestId = (value: string): AgentTeamRequestId => value as AgentTeamRequestId

function committed<T>(result: AgentTeamLedgerResult<T>): T {
  if (!result.committed) throw new Error('expected a newly committed record')
  return result.value
}

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(cleanup => cleanup()))
})

interface SourceWorld {
  readonly root: string
  readonly records: Map<string, unknown>
  readonly sequence: number
}

/** Generates real operations on the current schema and stamps them into a pre-release v9 JSON medium. */
async function makeV9Medium(): Promise<SourceWorld> {
  const root = await mkdtemp(join(tmpdir(), 'agent-team-migrate-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  await ctx.plugin(Storage)
  const pool = new MemoryMediaPool()
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  const domain = await facility.open(agentTeamDomainSpec)
  const ledger = new AgentTeamLedger(domain.table('operations'))
  await ledger.initialize()
  const channel = committed(await ledger.createChannel({ requestId: requestId(`channel:${crypto.randomUUID()}`), workspaceId, name: 'engineering', description: 'Migration source', actor: agentTeamHumanActor() }))
  await ledger.sendMessage({ requestId: requestId(`message:${crypto.randomUUID()}`), workspaceId, channelRef: channel.channel.channelRef, body: 'Carry this across the cutover', actor: agentTeamHumanActor() })
  const status = ledger.status()
  const records = new Map(pool.media.get('agent_team')!.tables.get('operations')!.entries())
  await facility.closeAll()
  await ctx.fiber.dispose()
  const medium = {
    unit: { name: 'agent_team', version: 9 },
    global: null,
    tables: { operations: Object.fromEntries(records) },
  }
  const mediumPath = join(root, 'storages/agent_team.json')
  await mkdir(dirname(mediumPath), { recursive: true })
  await writeFile(mediumPath, JSON.stringify(medium, null, 2))
  return { root, records, sequence: status.sequence }
}

async function openMigratedLedger(home: string): Promise<number> {
  const backend = new SqliteStorageBackend({ path: join(home, 'storages/agent_team.sqlite'), journalMode: 'wal' })
  cleanups.push(() => backend.close())
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('sqlite', backend)
  const facility = new DomainFacility(ctx, { backend: 'sqlite', routes: {} })
  const domain = await facility.open(agentTeamDomainSpec)
  const ledger = new AgentTeamLedger(domain.table('operations'))
  ledger.validate()
  const count = ledger.status().operationCount
  await facility.closeAll()
  return count
}

it('migrates a v9 JSON medium to the v1 SQLite medium and verifies the replay', async () => {
  const world = await makeV9Medium()
  const result = await migrateLedgerMedia({ home: world.root })
  expect(result).toEqual({ migrated: world.records.size, sequence: world.sequence })
  expect(await openMigratedLedger(world.root)).toBe(world.records.size)
  // The old medium stays untouched for the operator to archive or delete.
  expect(await readFile(join(world.root, 'storages/agent_team.json'), 'utf8')).toContain('"version": 9')
})

it('refuses an existing target and requires --force to rebuild it', async () => {
  const world = await makeV9Medium()
  await migrateLedgerMedia({ home: world.root })
  await expect(migrateLedgerMedia({ home: world.root })).rejects.toThrow(/already exists/)
  await migrateLedgerMedia({ home: world.root, force: true })
  expect(await openMigratedLedger(world.root)).toBe(world.records.size)
})

it('fails loud on a foreign version instead of guessing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-team-migrate-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const mediumPath = join(root, 'storages/agent_team.json')
  await mkdir(dirname(mediumPath), { recursive: true })
  await writeFile(mediumPath, JSON.stringify({
    unit: { name: 'agent_team', version: 7 },
    global: null,
    tables: { operations: {} },
  }))
  await expect(migrateLedgerMedia({ home: root })).rejects.toThrow(/stamped v7/)
})
