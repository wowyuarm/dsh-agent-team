/**
 * One-shot operator tool: migrates a pre-release v9 `agent_team` JSON medium
 * to the public v1 format on the routed SQLite backend. This is NOT part of
 * the shipped bundle or any runtime path: the Host itself never migrates,
 * reads, or falls back to old media (docs/development.md). Run it once while
 * DSH is stopped:
 *
 *   npm run migrate [-- --home /path/to/home] [--force]
 *
 * The old JSON medium is left untouched on disk; removing or archiving it is
 * a separate operator decision.
 */
import { readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { descriptorOf, DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { SqliteStorageBackend } from '@deepseek-ai/dsh-storage-sqlite'
import { AgentTeamLedger } from '../packages/agent-team/src/ledger.ts'
import { agentTeamDomainSpec, agentTeamOperationSchema } from '../packages/agent-team/src/spec.ts'

const OLD_FORMAT_VERSION = 9

export interface MigrateOptions {
  /** Harness home containing `storages/agent_team.json`. */
  readonly home: string
  /** Recreate the target medium even when it already holds records. */
  readonly force?: boolean
}

export interface MigrateResult {
  readonly migrated: number
  readonly sequence: number
}

interface ParsedMedium {
  readonly unit: { readonly name: string; readonly version: number }
  readonly global: unknown
  readonly tables: Record<string, Record<string, unknown>>
}

function fail(message: string): never {
  throw new Error(`migrate-team-ledger: ${message}`)
}

async function readOldMedium(path: string): Promise<Map<string, unknown>> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    fail(`no pre-release medium at ${path}; nothing to migrate`)
  }
  const parsed = JSON.parse(raw) as Partial<ParsedMedium>
  if (parsed.unit?.name !== 'agent_team') fail(`unexpected unit name ${JSON.stringify(parsed.unit?.name)} in ${path}`)
  if (parsed.unit.version !== OLD_FORMAT_VERSION) {
    fail(`medium ${path} is stamped v${String(parsed.unit.version)}, expected v${String(OLD_FORMAT_VERSION)}; refusing to guess`)
  }
  const records = parsed.tables?.operations
  if (records === undefined || typeof records !== 'object') fail(`medium ${path} carries no operations table`)
  return new Map(Object.entries(records))
}

/** Density plus previous-id linkage; the ledger replays and re-validates everything after the write. */
function checkChain(records: Map<string, unknown>): void {
  const invalid: string[] = []
  const parsed = [...records.entries()].flatMap(([id, value]) => {
    const result = agentTeamOperationSchema.safeParse(value)
    if (!result.success) {
      invalid.push(`${id}: ${result.error.issues[0]?.message ?? 'unparseable'}`)
      return []
    }
    return [[id, result.data] as const]
  })
  if (invalid.length > 0) fail(`${invalid.length} record(s) failed schema validation:\n${invalid.join('\n')}`)
  parsed.sort(([, a], [, b]) => a.sequence - b.sequence)
  parsed.forEach(([id, operation], index) => {
    if (operation.sequence !== index + 1) fail(`sequence gap at operation ${id} (sequence ${operation.sequence}, position ${index + 1})`)
    const previous = index > 0 ? parsed[index - 1]![0] : null
    if (operation.previousOperationId !== previous) fail(`broken link at ${id}: previousOperationId ${String(operation.previousOperationId)} != ${String(previous)}`)
  })
}

async function targetExists(path: string): Promise<boolean> {
  return stat(path).then(() => true, () => false)
}

export async function migrateLedgerMedia(options: MigrateOptions): Promise<MigrateResult> {
  const storages = join(options.home, 'storages')
  const sourcePath = join(storages, 'agent_team.json')
  const targetPath = join(storages, 'agent_team.sqlite')

  const records = await readOldMedium(sourcePath)
  checkChain(records)
  console.log(`source: ${records.size} operation(s) from ${sourcePath}`)

  if (await targetExists(targetPath)) {
    if (!options.force) fail(`target ${targetPath} already exists; pass --force to recreate it from the source medium`)
    for (const suffix of ['', '-wal', '-shm']) await rm(`${targetPath}${suffix}`, { force: true })
  }

  const descriptor = descriptorOf(agentTeamDomainSpec)
  // journalMode is stated explicitly: the backend class does not apply the
  // plugin config schema defaults, and 'wal' is the shipped default.
  const writeBackend = new SqliteStorageBackend({ path: targetPath, journalMode: 'wal' })
  try {
    const unit = await writeBackend.kv!.open(descriptor)
    for (const [id, value] of records) await unit.putRecord('operations', id, value)
  } finally {
    await writeBackend.close()
  }

  // Reopen through the real stack and replay-validate the migrated ledger.
  const verifyBackend = new SqliteStorageBackend({ path: targetPath, journalMode: 'wal' })
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('sqlite', verifyBackend)
  const facility = new DomainFacility(ctx, { backend: 'sqlite', routes: {} })
  try {
    const domain = await facility.open(agentTeamDomainSpec)
    const ledger = new AgentTeamLedger(domain.table('operations'))
    ledger.validate()
    const status = ledger.status()
    if (status.operationCount !== records.size) {
      fail(`verification mismatch: migrated ledger holds ${status.operationCount} operation(s), source had ${records.size}`)
    }
    console.log(`verified: sequence ${status.sequence}, ${status.operationCount} operation(s), ${status.channelCount} channel(s), ${status.agentMemberCount} agent member(s)`)
    return { migrated: records.size, sequence: status.sequence }
  } finally {
    await facility.closeAll()
    await ctx.fiber.dispose()
    await verifyBackend.close()
  }
}

async function main(): Promise<number> {
  const args = process.argv.slice(2)
  let home = process.env.DSH_HOME !== undefined && process.env.DSH_HOME.trim().length > 0 ? process.env.DSH_HOME : join(process.env.HOME ?? '', '.dsh')
  let force = false
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index]
    if (value === '--force') force = true
    else if (value === '--home') {
      index += 1
      if (args[index] === undefined) throw new Error('migrate-team-ledger: --home requires a value')
      home = args[index]!
    } else if (value === '--help' || value === '-h') {
      console.log('usage: node --import tsx scripts/migrate-team-ledger.ts [--home <dsh home>] [--force]')
      return 0
    } else throw new Error(`migrate-team-ledger: unknown argument ${value}`)
  }
  const result = await migrateLedgerMedia({ home, force })
  console.log(`done: ${result.migrated} operation(s) now live at ${join(home, 'storages', 'agent_team.sqlite')} (v${agentTeamDomainSpec.version})`)
  console.log(`the old medium ${join(home, 'storages', 'agent_team.json')} was left untouched; archive or delete it yourself.`)
  return 0
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    code => { process.exitCode = code },
    error => {
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    },
  )
}
