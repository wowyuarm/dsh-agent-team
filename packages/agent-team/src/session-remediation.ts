/**
 * Startup remediation of legacy Member Session artifacts.
 *
 * Released dsh-agent-team 0.1.9 wrote its rollover handoff and checkpoint
 * continuation into Member Session logs under bespoke message source kinds.
 * dsh 0.1.5's session-format migration chain admits a closed source-kind
 * vocabulary and refuses those artifacts fail-closed — the bytes are intact,
 * but no reader (activation, session search, lineage timeline) can open them,
 * which surfaces as Members going `unavailable`.
 *
 * This module restores readability without touching a byte of the refused
 * artifact: it decodes the stored v0 log physically (frame-walking the
 * concatenated zstd container), rewrites only this plugin's legacy source
 * kinds into the admitted `plugin` shape the current writer already uses,
 * re-validates the whole stream through the format catalog's own migration
 * chain in memory, and publishes the migrated log as a sibling current-format
 * artifact (`session.v3.jsonl.zstd`) — the storage layer's designated slot for
 * a published current generation, atomically created and never overwritten.
 * The v0 original remains the rollback path: delete the sibling.
 *
 * Scope is deliberately narrow: artifacts refused for any other reason
 * (structural turn defects, foreign legacy fields) are left untouched with a
 * diagnostic log — rewriting history a plugin did not author is out of
 * bounds. Member availability for those rests on the activation recovery
 * path's bounded fail-open, not on this migration.
 *
 * The walk runs once per plugin start, before any Member activation (no
 * write lease exists yet) and records completion per Member in a separate
 * durable domain — never in the `agent_team` ledger domain, whose version is
 * the operation schema's compatibility contract, not a cache stamp.
 * @module @wowyuarm/dsh-agent-team/session-remediation
 */

import { randomUUID } from 'node:crypto'
import { link, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { constants as zstdConstants, zstdCompressSync, zstdDecompressSync } from 'node:zlib'
import { z } from 'zod'
import type { Context } from '@deepseek-ai/cordis'
import { defineDomain, domainTable, type Domain, type KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { sessionFormatCatalog } from '@deepseek-ai/dsh-session-format-catalog'
import type { SessionFormatArtifact } from '@deepseek-ai/dsh-session-format'
import { SessionFormatUnsupportedError, type SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import {
  AGENT_TEAM_PLUGIN_ID,
  CHECKPOINT_SECTION_NAME,
  HANDOFF_CHECKPOINT,
  HANDOFF_EVENT_SEQ,
  HANDOFF_NEW_SESSION,
  HANDOFF_PREVIOUS_SESSION,
  HANDOFF_RELATED_FILES,
  HANDOFF_TRIGGER,
} from './context-source.ts'
import type { AgentTeamAgentMember } from './types.ts'

/** The rollover-handoff kind released 0.1.9 wrote; it is also handoff evidence in a log. */
export const LEGACY_HANDOFF_SOURCE_KIND = 'agent-team-context-handoff'

/** The two bespoke source kinds released 0.1.9 wrote; the migration's whole scope. */
const LEGACY_SOURCE_KINDS = new Set([LEGACY_HANDOFF_SOURCE_KIND, 'agent-team-context-continuation'])

/** The handoff kind alone, for handoff-presence questions. */
const LEGACY_HANDOFF_SOURCE_KINDS = new Set([LEGACY_HANDOFF_SOURCE_KIND])

/** Sibling filename the storage layer reads in preference when present. */
const CURRENT_GENERATION_FILENAME = 'session.v3.jsonl.zstd'

/** Lineage walks stop at this depth; a chain this long is a defect, not history. */
const MAX_LINEAGE_DEPTH = 64

/**
 * Durable completion cache. A separate domain on purpose: the `agent_team`
 * domain's version gates the ledger schema, and stamping migration bookkeeping
 * there would turn a cache refresh into a ledger-format break. Records are
 * disposable derived state — losing them only re-runs the (idempotent) walk.
 */
const sessionRemediationDomainSpec = defineDomain({
  name: 'agent_team_remediation',
  version: 1,
  tables: {
    lineages: domainTable<string, AgentTeamSessionRemediationRecord>(z.object({
      memberId: z.string().min(1),
      formatVersion: z.number().int().nonnegative(),
      currentSessionId: z.string().min(1),
      verifiedAt: z.number().int().nonnegative(),
    }).strict()),
  },
})

/** One Member's completed remediation walk; the cache key is the Member id. */
export interface AgentTeamSessionRemediationRecord {
  readonly memberId: string
  readonly formatVersion: number
  readonly currentSessionId: string
  readonly verifiedAt: number
}

/** Per-Session outcome of one remediation attempt, with the lineage edge to walk next. */
type SessionOutcome =
  | { readonly status: 'repaired'; readonly parentSession: string | undefined }
  | { readonly status: 'already-readable'; readonly parentSession: string | undefined }
  | { readonly status: 'left-untouched'; readonly parentSession: string | undefined; readonly reason: string }

/** JSON object discipline for physical row handling; rows are never typed by the domain. */
interface PhysicalRow {
  readonly [key: string]: unknown
}

/**
 * Rewrite one legacy source onto the admitted shape the current writer uses.
 * The original `sections` array is preserved verbatim (it carries the
 * model-authored handoff prose); envelope fields ride additional named
 * sections exactly as `handoffSections` composes them, added only when the
 * field is present and no section of that name exists.
 */
function admitLegacySource(source: PhysicalRow): PhysicalRow {
  if (source.kind === 'agent-team-context-handoff') {
    const sections: { name: unknown; text: unknown }[] = Array.isArray(source.sections)
      ? source.sections.filter((section): section is { name: unknown; text: unknown } => section !== null && typeof section === 'object')
      : []
    const envelope: readonly (readonly [name: string, value: unknown])[] = [
      [HANDOFF_PREVIOUS_SESSION, source.previousSessionId],
      [HANDOFF_NEW_SESSION, source.newSessionId],
      [HANDOFF_TRIGGER, source.trigger],
      [HANDOFF_EVENT_SEQ, source.handoffEventSeq],
      [HANDOFF_CHECKPOINT, source.checkpointRef],
      [HANDOFF_RELATED_FILES, Array.isArray(source.relatedFiles)
        ? source.relatedFiles.filter((file): file is string => typeof file === 'string').join(', ')
        : undefined],
    ]
    for (const [name, value] of envelope) {
      if (value === undefined || value === null || value === '') continue
      if (sections.some(section => section.name === name)) continue
      sections.push({ name, text: String(value) })
    }
    return { kind: 'plugin', plugin: AGENT_TEAM_PLUGIN_ID, form: 'snapshot', sections }
  }
  // A continuation carried its checkpoint ref at the top level; the admitted
  // shape reads it back from a single-name section, same as the writer.
  return {
    kind: 'plugin',
    plugin: AGENT_TEAM_PLUGIN_ID,
    form: 'snapshot',
    sections: [{ name: CHECKPOINT_SECTION_NAME, text: String(source.checkpointRef ?? '') }],
  }
}

/**
 * Deep-rewrite every legacy Team source in one physical row tree. The kinds
 * are globally unique to this plugin, so a structural match anywhere in the
 * row (message sources ride several payload positions) is exactly the set to
 * rewrite; everything else passes through untouched.
 */
export function admitLegacyRow(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(admitLegacyRow)
  const out: { [key: string]: unknown } = {}
  for (const [key, item] of Object.entries(value)) out[key] = admitLegacyRow(item)
  if (typeof out.kind === 'string' && LEGACY_SOURCE_KINDS.has(out.kind)) return admitLegacySource(out)
  return out
}

/** Whether one value tree still contains a legacy Team source kind. */
export function containsLegacySource(value: unknown): boolean {
  return containsLegacySourceKind(value, LEGACY_SOURCE_KINDS)
}

/**
 * Whether one value tree carries the retired rollover-handoff kind. A
 * continuation is deliberately excluded: it never carried a handoff, so it is
 * not evidence that one already arrived.
 */
export function carriesLegacyHandoffSource(value: unknown): boolean {
  return containsLegacySourceKind(value, LEGACY_HANDOFF_SOURCE_KINDS)
}

/**
 * Whether a generation's log already holds a rollover handoff, in either
 * shape. The admitted shape surfaces as a projection boundary; a generation
 * rescued from the retired kinds carries the very same handoff as a source the
 * projection does not classify, so recovery that keys on the boundary alone
 * would deliver that handoff a second time.
 */
export function handoffAlreadyInLog(
  boundaries: readonly { readonly source: string }[],
  ownEvents: readonly unknown[],
): boolean {
  if (boundaries.some(boundary => boundary.source === 'handoff')) return true
  return ownEvents.some(carriesLegacyHandoffSource)
}

function containsLegacySourceKind(value: unknown, kinds: ReadonlySet<string>): boolean {
  if (value === null || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.some(item => containsLegacySourceKind(item, kinds))
  const kind = (value as PhysicalRow).kind
  if (typeof kind === 'string' && kinds.has(kind)) return true
  return Object.values(value).some(item => containsLegacySourceKind(item, kinds))
}

const ZSTD_MAGIC = 0xfd2fb528
const SKIPPABLE_FROM = 0x184d2a50
const SKIPPABLE_TO = 0x184d2a5f

/**
 * Byte ranges of every complete zstd frame in a concatenated container, plus
 * the offset of a torn final frame. Node's zstd bindings decode only the
 * first frame of their input, so multi-frame containers must be walked
 * structurally; scanning for the magic alone is unsound because the magic
 * sequence can occur inside compressed payloads.
 */
export function scanZstdFrames(buffer: Buffer): { readonly frames: readonly { readonly start: number; readonly end: number; readonly skippable: boolean }[]; readonly tornStart: number | undefined } {
  const frames: { start: number; end: number; skippable: boolean }[] = []
  let at = 0
  let tornStart: number | undefined
  while (at < buffer.length) {
    if (at + 4 > buffer.length) { tornStart = at; break }
    const magic = buffer.readUInt32LE(at)
    if (magic >= SKIPPABLE_FROM && magic <= SKIPPABLE_TO) {
      if (at + 8 > buffer.length) { tornStart = at; break }
      const size = buffer.readUInt32LE(at + 4)
      if (at + 8 + size > buffer.length) { tornStart = at; break }
      frames.push({ start: at, end: at + 8 + size, skippable: true })
      at += 8 + size
      continue
    }
    if (magic !== ZSTD_MAGIC) throw new Error(`not a zstd frame at byte ${at}`)
    if (at + 5 > buffer.length) { tornStart = at; break }
    const descriptor = buffer.readUInt8(at + 4)
    const contentSizeFlag = descriptor >> 6
    const singleSegment = (descriptor >> 5) & 1
    const hasChecksum = (descriptor >> 2) & 1
    const dictionaryFlag = descriptor & 3
    let cursor = at + 5
    if (singleSegment === 0) cursor += 1
    const dictionaryLengths = [0, 1, 2, 4]
    const contentSizeLengths = [0, 2, 4, 8]
    cursor += dictionaryLengths[dictionaryFlag] ?? 0
    cursor += contentSizeFlag === 0 ? (singleSegment === 1 ? 1 : 0) : (contentSizeLengths[contentSizeFlag] ?? 0)
    for (;;) {
      if (cursor + 3 > buffer.length) throw new Error(`torn zstd block header at byte ${cursor}`)
      const header = buffer.readUInt8(cursor) | (buffer.readUInt8(cursor + 1) << 8) | (buffer.readUInt8(cursor + 2) << 16)
      const last = header & 1
      const blockType = (header >> 1) & 3
      const size = header >> 3
      if (blockType === 3) throw new Error(`reserved zstd block type at byte ${cursor}`)
      cursor += 3 + (blockType === 1 ? 1 : size)
      if (last === 1) break
    }
    if (hasChecksum === 1) cursor += 4
    if (cursor > buffer.length) throw new Error(`torn zstd frame at byte ${at}`)
    frames.push({ start: at, end: cursor, skippable: false })
    at = cursor
  }
  return { frames, tornStart }
}

/** Decode one stored zstd container to its physical JSONL rows. */
export function readPhysicalRows(buffer: Buffer): readonly PhysicalRow[] {
  const { frames } = scanZstdFrames(buffer)
  const chunks = frames.map(frame => frame.skippable ? Buffer.alloc(0) : zstdDecompressSync(buffer.subarray(frame.start, frame.end)))
  const lines = Buffer.concat(chunks).toString('utf8').split('\n').filter(line => line.length > 0)
  return lines.map(line => JSON.parse(line) as PhysicalRow)
}

/** Encode the migrated artifact as one checksummed zstd frame per JSONL row. */
function encodeCurrentArtifact(artifact: SessionFormatArtifact): Buffer {
  const checksum = { params: { [zstdConstants.ZSTD_c_checksumFlag]: 1 } }
  const lines = [
    JSON.stringify(sessionFormatCatalog.encodeCurrentHeader(artifact.header, artifact.inheritedEventCount)),
    ...artifact.events.map(event => JSON.stringify(sessionFormatCatalog.encodeCurrentEvent(event))),
  ]
  return Buffer.concat(lines.map(line => zstdCompressSync(Buffer.from(line + '\n'), checksum)))
}

/** Run the format catalog's own migration chain over transformed rows; throws on any residual refusal. */
function migrateForProof(rows: readonly PhysicalRow[]): SessionFormatArtifact {
  const [header, ...events] = rows
  const handle = sessionFormatCatalog.createRestore(header, { recovery: 'recoverable', validation: 'current' })
  for (const row of events) handle.decodeRow(row)
  return handle.finish()
}

/** The JSONL artifact path a format refusal reports, when it reports one. */
function artifactPath(error: SessionFormatUnsupportedError): string | undefined {
  return error.location?.kind === 'jsonl' ? error.location.path : undefined
}

/** The recorded parent Session of one physical header row. */
function physicalParentSession(rows: readonly PhysicalRow[]): string | undefined {
  const parent = rows[0]?.parentSession
  return typeof parent === 'string' ? parent : undefined
}

/**
 * The startup remediation pass. Never throws to its caller: a failed or
 * partial walk logs and leaves the completion cache unrecorded, so the next
 * start retries exactly the Members that need it.
 */
export interface SessionRemediationOutcome {
  /** How many lineage artifacts were repaired. */
  readonly repaired: number
  /** How many lineage artifacts were examined and deliberately left untouched. */
  readonly untouched: number
  /** False only when the walk itself failed; the cache stays unrecorded so a later pass retries. */
  readonly completed: boolean
  /** True when nothing was walked: the Member is not enabled, or its completion cache still covers it. */
  readonly cacheHit: boolean
}

export class SessionRemediation {
  private readonly table: KvTable<string, AgentTeamSessionRemediationRecord> | undefined

  constructor(
    private readonly ctx: Context,
    private readonly persistence: SessionPersistence,
    domain: Domain<typeof sessionRemediationDomainSpec> | undefined,
  ) {
    this.table = domain?.table('lineages')
  }

  /** Open the completion-cache domain; a failure only costs re-walking. */
  static async open(ctx: Context): Promise<Domain<typeof sessionRemediationDomainSpec> | undefined> {
    try {
      return await ctx.storageDomain.open(sessionRemediationDomainSpec)
    } catch (error) {
      ctx.logger.warn(`agent-team: session remediation cache unavailable (walks will re-run): ${error instanceof Error ? error.message : String(error)}`)
      return undefined
    }
  }

  /**
   * Remediate every enabled Member's lineage once, before activation. A
   * Member is skipped when its cache record still matches the current format
   * version and Session binding — a rollover or a dsh format change is what
   * re-opens the walk.
   */
  async remediateEnabledMembers(members: readonly AgentTeamAgentMember[]): Promise<void> {
    let repaired = 0
    let untouched = 0
    let walked = 0
    for (const member of members) {
      if (member.state !== 'enabled') continue
      const outcome = await this.remediateMember(member)
      if (outcome.cacheHit) continue
      walked += 1
      repaired += outcome.repaired
      untouched += outcome.untouched
    }
    if (walked > 0) {
      this.ctx.logger.info(`agent-team: legacy Session remediation walked ${walked} member lineage(s): ${repaired} artifact(s) repaired, ${untouched} left untouched`)
    }
  }

  /**
   * Remediate one Member's lineage; the bounded in-place heal a restart
   * performs after an activation refused on a session. `completed` with zero
   * repairs is the deterministic nothing-to-do answer (a finished walk found
   * nothing provably this plugin's, or the cache already covered the Member);
   * `completed: false` means the walk itself failed and a later attempt
   * should retry. Never throws.
   */
  async remediateMember(member: AgentTeamAgentMember): Promise<SessionRemediationOutcome> {
    if (member.state !== 'enabled' || this.cacheStillValid(member)) return { repaired: 0, untouched: 0, completed: true, cacheHit: true }
    try {
      const summary = await this.remediateLineage(member)
      await this.recordCompletion(member)
      return { repaired: summary.repaired, untouched: summary.untouched, completed: true, cacheHit: false }
    } catch (error) {
      this.ctx.logger.warn(`agent-team: legacy Session remediation for member '${member.handle}' did not complete: ${error instanceof Error ? error.message : String(error)}`)
      return { repaired: 0, untouched: 0, completed: false, cacheHit: false }
    }
  }

  /** Whether the cached walk still covers this Member under the current format. */
  private cacheStillValid(member: AgentTeamAgentMember): boolean {
    const record = this.table?.get(member.memberId)
    return record !== undefined
      && record.formatVersion === sessionFormatCatalog.currentVersion
      && record.currentSessionId === member.sessionId
  }

  private async recordCompletion(member: AgentTeamAgentMember): Promise<void> {
    if (this.table === undefined) return
    try {
      await this.table.put(member.memberId, {
        memberId: member.memberId,
        formatVersion: sessionFormatCatalog.currentVersion,
        currentSessionId: member.sessionId,
        verifiedAt: Date.now(),
      })
    } catch (error) {
      this.ctx.logger.warn(`agent-team: could not record session remediation completion for member '${member.handle}' (the walk will re-run): ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Walk one Member's lineage from its bound Session up through recorded
   * parent Sessions, remediating refused artifacts in place. Readable
   * artifacts still carrying legacy kinds inside a current-format generation
   * (an artifact of the one-off 2026-09-10 manual rescue) are counted and
   * logged but not rewritten: they are readable, and rewriting a generation
   * the storage layer may still append to is a write-path risk this pass
   * does not take.
   */
  private async remediateLineage(member: AgentTeamAgentMember): Promise<{ readonly repaired: number; readonly untouched: number }> {
    let repaired = 0
    let untouched = 0
    const seen = new Set<string>()
    let sessionId: SessionId | undefined = member.sessionId
    for (let depth = 0; sessionId !== undefined && !seen.has(sessionId) && depth < MAX_LINEAGE_DEPTH; depth += 1) {
      seen.add(sessionId)
      const outcome = await this.remediateOne(sessionId, member)
      if (outcome.status === 'repaired') repaired += 1
      else if (outcome.status === 'left-untouched') untouched += 1
      sessionId = outcome.parentSession === undefined ? undefined : (outcome.parentSession as SessionId)
    }
    return { repaired, untouched }
  }

  /** Remediate one lineage Session: verify readability, and repair when the refusal is this plugin's legacy source shape. */
  private async remediateOne(sessionId: SessionId, member: AgentTeamAgentMember): Promise<SessionOutcome> {
    try {
      const handle = await this.persistence.open(sessionId, 'read')
      try {
        const { events } = await handle.read()
        if (events.some(event => containsLegacySource(event))) {
          this.ctx.logger.info(`agent-team: Session '${sessionId}' of member '${member.handle}' reads fine but still carries legacy envelope kinds; its history metadata stays degraded until the next rollover`)
        }
        return { status: 'already-readable', parentSession: handle.header.parentSession }
      } finally {
        await handle.close()
      }
    } catch (error) {
      if (!(error instanceof SessionFormatUnsupportedError)) {
        this.ctx.logger.warn(`agent-team: Session '${sessionId}' of member '${member.handle}' is unreadable for a non-format reason: ${error instanceof Error ? error.message : String(error)}`)
        return { status: 'left-untouched', parentSession: undefined, reason: 'unreadable for a non-format reason' }
      }
      const path = artifactPath(error)
      if (path === undefined) {
        this.ctx.logger.warn(`agent-team: refused Session '${sessionId}' of member '${member.handle}' did not report a JSONL artifact path: ${error.message}`)
        return { status: 'left-untouched', parentSession: undefined, reason: 'no artifact path reported' }
      }
      return await this.repairArtifact(sessionId, path, member, error)
    }
  }

  /** Transform, prove, and publish the sibling current-format artifact for one refused Session. */
  private async repairArtifact(sessionId: SessionId, path: string, member: AgentTeamAgentMember, refusal: SessionFormatUnsupportedError): Promise<SessionOutcome> {
    let rows: readonly PhysicalRow[]
    try {
      rows = readPhysicalRows(await readFile(path))
    } catch (readError) {
      this.ctx.logger.warn(`agent-team: could not decode the stored artifact of Session '${sessionId}' (${basename(path)}): ${readError instanceof Error ? readError.message : String(readError)}`)
      return { status: 'left-untouched', parentSession: undefined, reason: 'artifact undecodable' }
    }
    const parentSession = physicalParentSession(rows)
    if (!rows.some(row => containsLegacySource(row))) {
      this.ctx.logger.warn(`agent-team: Session '${sessionId}' of member '${member.handle}' is refused for a reason outside this plugin's writes: ${refusal.message.split('\n')[0]}; leaving it untouched`)
      return { status: 'left-untouched', parentSession, reason: 'refusal outside this plugin writes' }
    }
    const admitted = rows.map(admitLegacyRow)
    let artifact: SessionFormatArtifact
    try {
      artifact = migrateForProof(admitted.map(row => structuredClone(row) as PhysicalRow))
    } catch (proofError) {
      this.ctx.logger.warn(`agent-team: Session '${sessionId}' of member '${member.handle}' still refuses after the legacy source rewrite (${proofError instanceof Error ? proofError.message : String(proofError)}); leaving it untouched`)
      return { status: 'left-untouched', parentSession, reason: 'residual refusal after rewrite' }
    }
    try {
      const published = await this.publishSibling(path, encodeCurrentArtifact(artifact))
      if (published === 'already-present') {
        this.ctx.logger.warn(`agent-team: Session '${sessionId}' already has a current-format sibling; leaving both untouched`)
        return { status: 'left-untouched', parentSession, reason: 'sibling already present' }
      }
    } catch (publishError) {
      this.ctx.logger.warn(`agent-team: could not publish the remediated sibling for Session '${sessionId}' (${basename(path)}): ${publishError instanceof Error ? publishError.message : String(publishError)}`)
      return { status: 'left-untouched', parentSession, reason: 'publish failed' }
    }
    // Success is proven by the storage layer itself, not by our own writer.
    try {
      const handle = await this.persistence.open(sessionId, 'read')
      try {
        await handle.read()
      } finally {
        await handle.close()
      }
    } catch (verifyError) {
      this.ctx.logger.warn(`agent-team: the remediated sibling for Session '${sessionId}' was published but still refuses: ${verifyError instanceof Error ? verifyError.message : String(verifyError)}`)
      return { status: 'left-untouched', parentSession, reason: 'sibling refused after publish' }
    }
    this.ctx.logger.info(`agent-team: repaired legacy source kinds in Session '${sessionId}' of member '${member.handle}' by publishing a current-format sibling; the original artifact is untouched`)
    return { status: 'repaired', parentSession }
  }

  /**
   * Atomically place the sibling file: stage in the same directory, hardlink
   * into place (an existing target refuses, never overwrites), remove the
   * stage. The link dance matches the storage layer's own exclusive publish.
   */
  private async publishSibling(sourcePath: string, bytes: Buffer): Promise<'published' | 'already-present'> {
    const directory = dirname(sourcePath)
    const target = join(directory, CURRENT_GENERATION_FILENAME)
    if (await stat(target).then(() => true, () => false)) return 'already-present'
    const staged = join(directory, `.remediation-${randomUUID()}.tmp`)
    await writeFile(staged, bytes, { flag: 'wx' })
    try {
      await link(staged, target)
    } catch (error) {
      if (await stat(target).then(() => true, () => false)) return 'already-present'
      throw error
    } finally {
      await rm(staged, { force: true })
    }
    return 'published'
  }
}
