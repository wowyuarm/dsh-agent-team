/**
 * Startup remediation of legacy Member Session artifacts.
 *
 * The remediation pass exists because released 0.1.9 wrote bespoke message
 * source kinds into Member Session logs, which dsh 0.1.5's migration chain
 * refuses fail-closed. These specs exercise the pass against a REAL
 * `JsonlSessionPersistence` over a temporary root, with artifacts built the
 * way the released writer actually built them (v0 physical rows, one
 * checksummed zstd frame per line), so the fence the specs prove is the same
 * one the fence spec (`context-source-migration.spec.ts`) proves from the
 * writer side: nothing this package writes — or repairs — may refuse.
 *
 * Negative controls matter as much as the repair itself: an artifact refused
 * for reasons outside this plugin's writes must come through the pass with
 * its bytes untouched, and a torn or foreign artifact must never produce a
 * half-migrated state.
 */
import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { constants as zstdConstants, zstdCompressSync } from 'node:zlib'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import type { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { MemoryMediaPool, MemoryStorageBackend } from './helpers/memory-backend.ts'
import { SessionRemediation, admitLegacyRow, carriesLegacyHandoffSource, containsLegacySource, handoffAlreadyInLog } from '../src/session-remediation.ts'

const CHECKSUM = { params: { [zstdConstants.ZSTD_c_checksumFlag]: 1 } }
const V0_FILENAME = 'session.jsonl.zstd'
const V3_FILENAME = 'session.v3.jsonl.zstd'

/** The released 0.1.9 handoff source: bespoke kind, envelope at the top level. */
function legacyHandoffSource(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'agent-team-context-handoff',
    form: 'snapshot',
    version: 1,
    previousSessionId: 'agent-team-previous',
    newSessionId: 'agent-team-current',
    trigger: 'model',
    handoffEventSeq: 42,
    checkpointRef: 'context-checkpoint-abc',
    relatedFiles: ['src/parser.ts', 'src/lexer.ts'],
    sections: [{ name: 'HANDOFF', text: 'objective: finish the parser\nnext step: run tests' }],
    ...overrides,
  }
}

/** The released 0.1.9 continuation source: bespoke kind, notice form, ref at the top level. */
function legacyContinuationSource(): Record<string, unknown> {
  return {
    kind: 'agent-team-context-continuation',
    form: 'notice',
    summary: 'Context checkpoint recorded; work continues in the next turn',
    checkpointRef: 'context-checkpoint-abc',
    version: 1,
  }
}

/** One released-v0 physical event row carrying a user message with the given source. */
function v0UserMessageRow(seq: number, id: string, source: unknown): Record<string, unknown> {
  return {
    type: 'user/message',
    seq,
    time: seq + 1,
    surfaceOp: 'append',
    data: { id, role: 'user', content: [{ type: 'text', text: 'carry on' }], source },
  }
}

/** A minimal released-v0 artifact's physical rows: header, one turn, the given events. */
function v0Rows(sessionId: string, messageRows: readonly Record<string, unknown>[]): readonly Record<string, unknown>[] {
  const body = [
    { type: 'turn/start', data: { turn: 1 } },
    { type: 'step/start', data: { turn: 1, step: 1 } },
    ...messageRows,
    { type: 'step/end', data: { turn: 1, step: 1 } },
    { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  ]
  return [
    { type: 'session', version: 0, id: sessionId, createdAt: 1, cwd: '/tmp', delegationDepth: 0 },
    ...body.map((row, index) => ({ ...row, seq: index, time: index + 1 })),
  ]
}

/** Encode rows the way the released writer stored them: one checksummed zstd frame per JSONL line. */
function encodeArtifact(rows: readonly Record<string, unknown>[]): Buffer {
  return Buffer.concat(rows.map(row => zstdCompressSync(Buffer.from(JSON.stringify(row) + '\n'), CHECKSUM)))
}

/** The JSONL backend's deterministic project-directory name for a cwd: each
 * path separator run becomes one `-`, with no edge trimming — so `/tmp` is
 * `--tmp--`. Restated here because the backend does not export its encoder. */
function projectBucket(): string {
  return "--tmp--"
}

interface Fixture {
  readonly root: string
  readonly ctx: Context
  readonly persistence: JsonlSessionPersistence
  remediation(): Promise<SessionRemediation>
  dispose(): Promise<void>
}

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(cleanup => cleanup()))
})

/** A real persistence stack over a temp root, with the remediation cache domain attached. */
async function fixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'remediation-'))
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(JsonlSessionPersistence, { root, compression: 'zstd' })
  const persistence = ctx.get('sessionPersistence') as JsonlSessionPersistence
  // The cache domain is opened once and shared: the plugin holds one open
  // domain for its lifetime (a second open() of the same domain name rejects
  // with 'already-open'), so every walk in this fixture reuses it.
  const domain = await SessionRemediation.open(ctx)
  const remediation = async () => new SessionRemediation(ctx, persistence, domain)
  const dispose = async () => {
    await facility.closeAll()
    await rm(root, { recursive: true, force: true })
  }
  cleanups.push(dispose)
  return { root, ctx, persistence, remediation, dispose }
}

/** Write a v0 artifact for one session id and return its directory path. */
async function writeArtifact(root: string, sessionId: string, rows: readonly Record<string, unknown>[], parentSession?: string): Promise<string> {
  const directory = join(root, projectBucket(), sessionId)
  await writeFile(join(directory, V0_FILENAME), encodeArtifact(parentSession === undefined ? rows : [{ ...rows[0], parentSession }, ...rows.slice(1)]), { flag: 'wx' }).catch(async () => {
    const { mkdir } = await import('node:fs/promises')
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, V0_FILENAME), encodeArtifact(parentSession === undefined ? rows : [{ ...rows[0], parentSession }, ...rows.slice(1)]), { flag: 'wx' })
  })
  return directory
}

/** Whether the real persistence service can read a session end to end. */
async function readable(persistence: JsonlSessionPersistence, sessionId: string): Promise<boolean> {
  try {
    const handle = await persistence.open(sessionId as SessionId, 'read')
    try {
      await handle.read()
      return true
    } finally {
      await handle.close()
    }
  } catch {
    return false
  }
}

/** One enabled Member row for the walk. */
function memberOf(sessionId: string): Parameters<SessionRemediation['remediateEnabledMembers']>[0][number] {
  return {
    memberId: `member:${sessionId}` as never,
    sessionId: sessionId as SessionId,
    workspaceId: 'workspace:test' as never,
    handle: 'Tester',
    description: 'fixture member',
    presetId: 'preset',
    state: 'enabled',
  } as never
}

describe('legacy source rewriting', () => {
  it('rewrites a handoff source onto the admitted plugin snapshot shape', () => {
    const admitted = admitLegacyRow(v0UserMessageRow(2, 'handoff', legacyHandoffSource())) as { data: { source: Record<string, unknown> } }
    const source = admitted.data.source
    expect(source.kind).toBe('plugin')
    expect(source.plugin).toBe('@wowyuarm/dsh-agent-team')
    expect(source.form).toBe('snapshot')
    const sections = source.sections as { name: string; text: string }[]
    const names = sections.map(section => section.name)
    expect(names).toEqual(['HANDOFF', 'Previous session', 'New session', 'Trigger', 'Handoff event seq', 'Continued from checkpoint', 'Related files'])
    expect(sections.find(section => section.name === 'Previous session')?.text).toBe('agent-team-previous')
    expect(sections.find(section => section.name === 'Handoff event seq')?.text).toBe('42')
    expect(sections.find(section => section.name === 'Related files')?.text).toBe('src/parser.ts, src/lexer.ts')
    expect(sections.find(section => section.name === 'HANDOFF')?.text).toContain('finish the parser')
  })

  it('rewrites a continuation source into a single checkpoint section', () => {
    const admitted = admitLegacyRow(v0UserMessageRow(2, 'continuation', legacyContinuationSource())) as { data: { source: { sections: { name: string; text: string }[] } } }
    expect(admitted.data.source.sections).toEqual([{ name: 'Checkpoint', text: 'context-checkpoint-abc' }])
  })

  it('detects legacy kinds structurally, anywhere in a row tree', () => {
    expect(containsLegacySource(legacyHandoffSource())).toBe(true)
    expect(containsLegacySource({ payload: { inserted: [legacyContinuationSource()] } })).toBe(true)
    expect(containsLegacySource({ kind: 'user' })).toBe(false)
    expect(containsLegacySource(admitLegacyRow(legacyHandoffSource()))).toBe(false)
  })

  it('separates handoff evidence from continuation evidence in a log', () => {
    expect(carriesLegacyHandoffSource(legacyHandoffSource())).toBe(true)
    expect(carriesLegacyHandoffSource({ payload: { inserted: [legacyHandoffSource()] } })).toBe(true)
    // A continuation never carried a handoff, so it must not suppress the
    // reconstruction a genuinely missing handoff still needs.
    expect(carriesLegacyHandoffSource(legacyContinuationSource())).toBe(false)
    expect(carriesLegacyHandoffSource({ kind: 'user' })).toBe(false)
  })

  it('treats a rescued legacy handoff as already present in the generation log', () => {
    const noBoundaries: readonly { readonly source: string }[] = []
    // The admitted shape is recognized through the projection boundary...
    expect(handoffAlreadyInLog([{ source: 'handoff' }], [])).toBe(true)
    // ...and the retired shape through the log evidence itself, which is what
    // the projection cannot classify: rebuilding on top of it would inject the
    // same handoff a second time.
    expect(handoffAlreadyInLog(noBoundaries, [v0UserMessageRow(2, 'handoff', legacyHandoffSource())])).toBe(true)
    expect(handoffAlreadyInLog(noBoundaries, [{ type: 'turn/start', data: { turn: 1 } }, v0UserMessageRow(2, 'continuation', legacyContinuationSource())])).toBe(false)
  })
})

describe('session remediation over a real persistence service', () => {
  it('repairs a refused v0 artifact with a legacy handoff and leaves the original bytes untouched', async () => {
    const { root, persistence, remediation } = await fixture()
    const sessionId = 'agent-team-legacy-handoff'
    const rows = v0Rows(sessionId, [v0UserMessageRow(2, 'handoff', legacyHandoffSource())])
    const directory = await writeArtifact(root, sessionId, rows)
    const before = await readFile(join(directory, V0_FILENAME))

    expect(await readable(persistence, sessionId)).toBe(false)
    await (await remediation()).remediateEnabledMembers([memberOf(sessionId)])

    expect(await readable(persistence, sessionId)).toBe(true)
    expect(await readFile(join(directory, V0_FILENAME))).toEqual(before)
    expect(await stat(join(directory, V3_FILENAME))).toBeDefined()
  })

  it('walks the parentSession lineage and repairs every refused ancestor', async () => {
    const { root, persistence, remediation } = await fixture()
    const ancestor = 'agent-team-ancestor'
    const parent = 'agent-team-parent'
    const current = 'agent-team-current'
    const legacy = [v0UserMessageRow(2, 'handoff', legacyHandoffSource())]
    await writeArtifact(root, ancestor, v0Rows(ancestor, legacy))
    await writeArtifact(root, parent, v0Rows(parent, legacy), ancestor)
    await writeArtifact(root, current, v0Rows(current, legacy), parent)

    await (await remediation()).remediateEnabledMembers([memberOf(current)])
    for (const id of [ancestor, parent, current]) {
      expect(await readable(persistence, id)).toBe(true)
    }
  })

  it('is idempotent: a second walk publishes nothing new', async () => {
    const { root, persistence, remediation } = await fixture()
    const sessionId = 'agent-team-idempotent'
    const directory = await writeArtifact(root, sessionId, v0Rows(sessionId, [v0UserMessageRow(2, 'handoff', legacyHandoffSource())]))
    const first = await (await remediation()).remediateEnabledMembers([memberOf(sessionId)])
    expect(first).toBeUndefined()
    const sibling = await readFile(join(directory, V3_FILENAME))

    await (await remediation()).remediateEnabledMembers([memberOf(sessionId)])
    expect(await readFile(join(directory, V3_FILENAME))).toEqual(sibling)
    const files = await readdir(directory)
    expect(files.filter(name => name.includes('.tmp'))).toEqual([])
    expect(await readable(persistence, sessionId)).toBe(true)
  })

  it('leaves artifacts refused for reasons outside this plugin untouched', async () => {
    const { root, persistence, remediation } = await fixture()
    const sessionId = 'agent-team-foreign-refusal'
    // Two consecutive turn/start rows with no turn/end between them are
    // refused by the structural migration audit, not by source-kind
    // admission — remediation must not rewrite history it does not own, and
    // no sibling may appear. The rows ride inside v0Rows so seq stays
    // contiguous (a seq gap would truncate as a torn tail instead of
    // refusing, which is a different defect class).
    const rows = v0Rows(sessionId, [{ type: 'turn/start', data: { turn: 2 } }, { type: 'turn/start', data: { turn: 3 } }])
    const directory = await writeArtifact(root, sessionId, rows)
    const before = await readFile(join(directory, V0_FILENAME))

    await (await remediation()).remediateEnabledMembers([memberOf(sessionId)])
    expect(await readable(persistence, sessionId)).toBe(false)
    expect(await readFile(join(directory, V0_FILENAME))).toEqual(before)
    expect(await stat(join(directory, V3_FILENAME)).then(() => true, () => false)).toBe(false)
  })

  it('keeps walking past a refused artifact so its ancestors still get repaired', async () => {
    const { root, persistence, remediation } = await fixture()
    const parentId = 'agent-team-isolated-parent'
    const childId = 'agent-team-isolated-child'
    await writeArtifact(root, parentId, v0Rows(parentId, [v0UserMessageRow(2, 'handoff', legacyHandoffSource())]))
    // The bound Session refuses for a reason this plugin does not own; its
    // parent is only reachable through the v0 header's parentSession, so the
    // walk must read that header itself and continue.
    await writeArtifact(
      root,
      childId,
      v0Rows(childId, [{ type: 'turn/start', data: { turn: 2 } }, { type: 'turn/start', data: { turn: 3 } }]),
      parentId,
    )

    await (await remediation()).remediateEnabledMembers([memberOf(childId)])

    expect(await readable(persistence, childId)).toBe(false)
    expect(await readable(persistence, parentId)).toBe(true)
  })

  it('skips members whose cache record still covers the current format and binding', async () => {
    const { root, persistence, remediation } = await fixture()
    const sessionId = 'agent-team-cached'
    await writeArtifact(root, sessionId, v0Rows(sessionId, [v0UserMessageRow(2, 'handoff', legacyHandoffSource())]))

    // First walk repairs and records completion.
    const first = await remediation()
    await first.remediateEnabledMembers([memberOf(sessionId)])
    expect(await readable(persistence, sessionId)).toBe(true)

    // A refused but cache-covered member is not even attempted: replace the
    // sibling with garbage; the cached walk must not touch it.
    const directory = join(root, projectBucket(), sessionId)
    await rm(join(directory, V3_FILENAME))
    const second = await remediation()
    await second.remediateEnabledMembers([memberOf(sessionId)])
    expect(await stat(join(directory, V3_FILENAME)).then(() => true, () => false)).toBe(false)
  })

  // Windows ignores a directory's mode bits, so the unwritable-directory
  // injection below cannot be built there; the companion probe underneath
  // asserts the same contract on every platform.
  it.skipIf(process.platform === 'win32')('does not record a real failed repair, so a restart can still heal', async () => {
    const { root, persistence, remediation } = await fixture()
    const sessionId = 'agent-team-transient'
    const directory = await writeArtifact(root, sessionId, v0Rows(sessionId, [v0UserMessageRow(2, 'handoff', legacyHandoffSource())]))

    // A transient write failure — here an unwritable Session directory — fails
    // the publish leg of a repair this plugin identified as its own. The
    // artifact stays refused, so the walk has NOT established that there is
    // nothing here for this plugin to fix.
    await chmod(directory, 0o500)
    try {
      await (await remediation()).remediateEnabledMembers([memberOf(sessionId)])
      expect(await readable(persistence, sessionId)).toBe(false)
    } finally {
      await chmod(directory, 0o700)
    }

    // A failed repair must not be cached as a completed walk. The restart path
    // reads a cache hit as "the walk finished and nothing was provably this
    // plugin's to fix: a retry would fail identically", and on that reading it
    // marks the refusal permanently non-remediable without retrying. Caching a
    // failed repair therefore costs the operator the only affordance that can
    // still heal the Member.
    const restart = await remediation()
    const outcome = await restart.remediateMember(memberOf(sessionId) as never)
    expect(outcome.cacheHit).toBe(false)
    expect(outcome.repaired).toBe(1)
    expect(await readable(persistence, sessionId)).toBe(true)
  })

  it('does not record a walk whose repair attempt failed, on every platform', async () => {
    const { root, persistence, remediation } = await fixture()
    const sessionId = 'agent-team-publish-failure'
    await writeArtifact(root, sessionId, v0Rows(sessionId, [v0UserMessageRow(2, 'handoff', legacyHandoffSource())]))

    // The same failure injected at the publish boundary rather than through the
    // filesystem, so this probe also runs where mode bits do not deny a write.
    // Everything else in the walk — open, the refusal, the artifact read, the
    // migration proof — stays real.
    const publish = vi.spyOn(SessionRemediation.prototype as unknown as {
      publishSibling: (source: string, bytes: Buffer) => Promise<unknown>
    }, 'publishSibling').mockRejectedValue(new Error('disk full (test seam)'))
    const failed = await (await remediation()).remediateMember(memberOf(sessionId) as never)
    publish.mockRestore()
    expect(failed).toMatchObject({ repaired: 0, untouched: 0, completed: false, cacheHit: false })
    expect(await readable(persistence, sessionId)).toBe(false)

    // The failed attempt left no completion record, so the next walk retries the
    // idempotent repair for real and heals the Member.
    expect(await (await remediation()).remediateMember(memberOf(sessionId) as never))
      .toMatchObject({ repaired: 1, completed: true, cacheHit: false })
    expect(await readable(persistence, sessionId)).toBe(true)
  })
})
