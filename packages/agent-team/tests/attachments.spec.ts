import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { MemoryMediaPool, MemoryStorageBackend } from './helpers/memory-backend.ts'
import { ATTACHMENT_MAX_BYTES, attachmentsRoot, mediaTypeForPath, newAttachmentId, readAttachment, sanitizeFileName, sanitizeMediaType, sweepAttachmentCache, validatePathAttachment, writeAttachment } from '../src/attachments.ts'
import AgentTeam from '../src/index.ts'
import { AgentTeamLedger } from '../src/ledger.ts'
import * as agentTeamInvariant from '../src/invariant.ts'
import type { AgentTeamOperation, AgentTeamOperationId, AgentTeamRequestId } from '../src/types.ts'

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
    archiveSession: async () => {},
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

describe('attachment file hygiene', () => {
  it('strips path separators, control characters, and dot prefixes from names', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('etcpasswd')
    expect(sanitizeFileName('report\u0000\u001f.pdf')).toBe('report.pdf')
    expect(sanitizeFileName('a/b\\c.png')).toBe('abc.png')
    expect(sanitizeFileName('...hidden')).toBe('hidden')
    expect(sanitizeFileName('   ')).toBe('attachment')
    expect(sanitizeFileName(`${'x'.repeat(400)}.pdf`)).toHaveLength(180)
    expect(sanitizeFileName('meta.json')).toBe('_meta.json')
    expect(sanitizeFileName('META.JSON')).toBe('_META.JSON')
  })

  it('accepts well-formed media types and falls back for anything else', () => {
    expect(sanitizeMediaType('image/png')).toBe('image/png')
    expect(sanitizeMediaType('Application/PDF')).toBe('application/pdf')
    expect(sanitizeMediaType('vnd.x+y')).toBe('application/octet-stream')
    expect(sanitizeMediaType('../etc')).toBe('application/octet-stream')
    expect(sanitizeMediaType(undefined)).toBe('application/octet-stream')
  })
})

describe('attachment cache', () => {
  it('writes immutable payload plus metadata and reads it back', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-attachments-'))
    cleanups.push(async () => { await rm(root, { recursive: true, force: true }) })
    const id = newAttachmentId()
    const stored = await writeAttachment(root, id, '../report final.pdf', 'application/pdf', Buffer.from('payload'))
    expect(stored.name).toBe('report final.pdf')
    expect(stored.byteSize).toBe(7)
    expect(stored.path).toBe(join(root, id, 'report final.pdf'))
    const readBack = await readAttachment(root, id)
    expect(readBack?.name).toBe('report final.pdf')
    expect(readBack?.mediaType).toBe('application/pdf')
    expect(readBack?.bytes.toString('utf8')).toBe('payload')
    expect(await readFile(join(root, id, 'meta.json'), 'utf8')).toContain('uploadedAt')
  })

  it('keeps a payload named meta.json readable by reserving the sidecar name', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-attachments-'))
    cleanups.push(async () => { await rm(root, { recursive: true, force: true }) })
    const id = newAttachmentId()
    const stored = await writeAttachment(root, id, 'meta.json', 'application/json', Buffer.from('payload'))
    expect(stored.name).toBe('_meta.json')
    const readBack = await readAttachment(root, id)
    expect(readBack?.name).toBe('_meta.json')
    expect(readBack?.bytes.toString('utf8')).toBe('payload')
    expect(JSON.parse(await readFile(join(root, id, 'meta.json'), 'utf8'))).toMatchObject({ name: '_meta.json' })
  })

  it('sweeps orphans after 24h and referenced uploads only after 72h', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-attachments-'))
    cleanups.push(async () => { await rm(root, { recursive: true, force: true }) })
    const orphan = newAttachmentId()
    const fresh = newAttachmentId()
    const old = newAttachmentId()
    await writeAttachment(root, orphan, 'orphan.txt', 'text/plain', Buffer.from('a'))
    await writeAttachment(root, fresh, 'fresh.txt', 'text/plain', Buffer.from('b'))
    await writeAttachment(root, old, 'old.txt', 'text/plain', Buffer.from('c'))
    // Backdate meta so the sweep sees ages without sleeping.
    const now = Date.now()
    await writeFile(join(root, orphan, 'meta.json'), JSON.stringify({ name: 'orphan.txt', mediaType: 'text/plain', uploadedAt: new Date(now - 25 * 60 * 60 * 1000).toISOString() }))
    await writeFile(join(root, fresh, 'meta.json'), JSON.stringify({ name: 'fresh.txt', mediaType: 'text/plain', uploadedAt: new Date(now - 73 * 60 * 60 * 1000).toISOString() }))
    await writeFile(join(root, old, 'meta.json'), JSON.stringify({ name: 'old.txt', mediaType: 'text/plain', uploadedAt: new Date(now - 30 * 60 * 60 * 1000).toISOString() }))

    // Sweep with `old` (30h) and `fresh` (73h) referenced: the orphan is past
    // 24h and `fresh` is past its 72h consumption window; `old` survives.
    const removed = await sweepAttachmentCache(root, new Set([old, fresh]), now)
    expect([...removed].sort()).toEqual([orphan, fresh].sort())
    await expect(readAttachment(root, old)).resolves.toBeDefined()
    await expect(readAttachment(root, fresh)).resolves.toBeUndefined()
    // A later sweep with `old` still referenced leaves it alone.
    const later = await sweepAttachmentCache(root, new Set([old]), now + 60 * 60 * 1000)
    expect(later).toEqual([])
    expect(await readdir(root)).toEqual([old])
  })
})

describe('Agent Team attachment remotes', () => {
  it('uploads, reads back, and rejects oversized or empty payloads', async () => {
    const { ctx } = await harness()
    const channel = await ctx.agentTeam.createChannel({ requestId: requestId('channel'), workspaceId: alpha, name: 'engineering', description: 'Engineering' })
    const uploaded = await ctx.agentTeam.putAttachment({
      requestId: requestId('put'), workspaceId: alpha,
      name: 'design.png', mediaType: 'image/png', bytesBase64: Buffer.from('png-bytes').toString('base64'),
    })
    expect(uploaded.mediaType).toBe('image/png')
    expect(uploaded.path).toContain(uploaded.attachmentId)
    const readBack = await ctx.agentTeam.getAttachment({ attachmentId: uploaded.attachmentId })
    expect(readBack.bytesBase64).toBe(Buffer.from('png-bytes').toString('base64'))
    expect(readBack.name).toBe('design.png')

    await expect(ctx.agentTeam.putAttachment({
      requestId: requestId('big'), workspaceId: alpha,
      name: 'big.bin', bytesBase64: Buffer.alloc(ATTACHMENT_MAX_BYTES + 1).toString('base64'),
    })).rejects.toThrow(/byte limit/)
    await expect(ctx.agentTeam.putAttachment({
      requestId: requestId('empty'), workspaceId: alpha,
      name: 'empty.bin', bytesBase64: '',
    })).rejects.toThrow(/must not be empty/)
    await expect(ctx.agentTeam.getAttachment({ attachmentId: newAttachmentId() })).rejects.toThrow(/no longer cached/)
    void channel
  })

  it('stores message attachment metadata, appends prompt lines, and replays old ledgers unchanged', async () => {
    const { ctx, facility } = await harness()
    const channel = await ctx.agentTeam.createChannel({ requestId: requestId('channel'), workspaceId: alpha, name: 'engineering', description: 'Engineering' })
    const uploaded = await ctx.agentTeam.putAttachment({
      requestId: requestId('put'), workspaceId: alpha,
      name: 'design.png', mediaType: 'image/png', bytesBase64: Buffer.from('png').toString('base64'),
    })
    const sent = await ctx.agentTeam.sendMessage({ asTask: true,
      requestId: requestId('send'), workspaceId: alpha, channelRef: channel.channel.channelRef,
      body: '请看这张图', attachments: [uploaded.attachmentId],
    })
    expect(sent.kind).toBe('committed')
    if (sent.kind !== 'committed') return
    expect(sent.message.attachments).toHaveLength(1)
    expect(sent.message.attachments?.[0]?.name).toBe('design.png')
    expect(sent.message.body).toContain('请看这张图')
    expect(sent.message.body).toMatch(/\[attachment\] .*attachments\/v1\//)

    // Idempotent resend with the same request resolves to the same message.
    const resent = await ctx.agentTeam.sendMessage({ asTask: true,
      requestId: requestId('send'), workspaceId: alpha, channelRef: channel.channel.channelRef,
      body: '请看这张图', attachments: [uploaded.attachmentId],
    })
    expect(resent.kind).toBe('committed')

    // An unknown attachment id is rejected before the ledger append.
    await expect(ctx.agentTeam.sendMessage({ asTask: true,
      requestId: requestId('send-unknown'), workspaceId: alpha, channelRef: channel.channel.channelRef,
      body: 'missing', attachments: [newAttachmentId()],
    })).rejects.toThrow(/not in the upload cache/)

    // A cold replay over the same table accepts the new-format record and the
    // projection carries the metadata; the live service serves the history.
    const cold = replayLedger(facility)
    expect(() => cold.validate()).not.toThrow()
    expect(cold.referencedAttachmentIds().has(uploaded.attachmentId)).toBe(true)
    const history = ctx.agentTeam.threadHistory({ workspaceId: alpha, taskRef: sent.task!.taskRef })
    expect(history.facts.some(fact => fact.kind === 'message' && fact.message.attachments?.[0]?.name === 'design.png')).toBe(true)
  })

  it('resolves Human reply attachments from the upload cache and replays them', async () => {
    const { ctx, facility } = await harness()
    const channel = await ctx.agentTeam.createChannel({ requestId: requestId('channel'), workspaceId: alpha, name: 'engineering', description: 'Engineering' })
    const started = await ctx.agentTeam.sendMessage({ asTask: true,
      requestId: requestId('start'), workspaceId: alpha, channelRef: channel.channel.channelRef, body: '开个任务',
    })
    if (started.kind !== 'committed') throw new Error('expected committed')
    const uploaded = await ctx.agentTeam.putAttachment({
      requestId: requestId('put'), workspaceId: alpha,
      name: 'reply.png', mediaType: 'image/png', bytesBase64: Buffer.from('png').toString('base64'),
    })
    const replied = await ctx.agentTeam.reply({
      requestId: requestId('reply'), workspaceId: alpha, taskRef: started.task!.taskRef,
      body: '补充截图', baseRevision: started.thread.revision, attachments: [uploaded.attachmentId],
    })
    expect(replied.kind).toBe('committed')
    if (replied.kind !== 'committed') return
    expect(replied.message.attachments).toHaveLength(1)
    expect(replied.message.attachments?.[0]?.name).toBe('reply.png')
    expect(replied.message.body).toMatch(/\[attachment\] .*attachments\/v1\//)

    // An unknown attachment id is rejected before the ledger append.
    await expect(ctx.agentTeam.reply({
      requestId: requestId('reply-unknown'), workspaceId: alpha, taskRef: started.task!.taskRef,
      body: 'missing', baseRevision: replied.thread.revision, attachments: [newAttachmentId()],
    })).rejects.toThrow(/not in the upload cache/)

    const cold = replayLedger(facility)
    expect(() => cold.validate()).not.toThrow()
    expect(cold.referencedAttachmentIds().has(uploaded.attachmentId)).toBe(true)
    const history = ctx.agentTeam.threadHistory({ workspaceId: alpha, taskRef: started.task!.taskRef })
    expect(history.facts.some(fact => fact.kind === 'message' && fact.message.attachments?.[0]?.name === 'reply.png')).toBe(true)
  })
})

describe('agent-supplied attachment paths', () => {
  it('derives media types from file extensions', async () => {
    expect(mediaTypeForPath('/tmp/shot.png')).toBe('image/png')
    expect(mediaTypeForPath('/tmp/shot.JPG')).toBe('image/jpeg')
    expect(mediaTypeForPath('/tmp/clip.webp')).toBe('image/webp')
    expect(mediaTypeForPath('/tmp/notes.txt')).toBe('text/plain')
    expect(mediaTypeForPath('/tmp/blob.bin')).toBe('application/octet-stream')
  })

  it('rejects relative, missing, directory, empty, and oversized sources', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-attach-paths-'))
    cleanups.push(async () => { await rm(dir, { recursive: true, force: true }) })
    await expect(validatePathAttachment('relative/shot.png')).rejects.toThrow(/must be absolute/)
    await expect(validatePathAttachment(join(dir, 'missing.png'))).rejects.toThrow(/does not exist/)
    await expect(validatePathAttachment(dir)).rejects.toThrow(/not a regular file/)
    const empty = join(dir, 'empty.png')
    await writeFile(empty, '')
    await expect(validatePathAttachment(empty)).rejects.toThrow(/must not be empty/)
    const big = join(dir, 'big.png')
    await writeFile(big, Buffer.alloc(ATTACHMENT_MAX_BYTES + 1))
    await expect(validatePathAttachment(big)).rejects.toThrow(/byte limit/)
  })

  it('copies validated paths into the cache for sends and replies, and rejects atomically', async () => {
    const { ctx, facility } = await harness()
    const channel = await ctx.agentTeam.createChannel({ requestId: requestId('channel'), workspaceId: alpha, name: 'engineering', description: 'Engineering' })
    const sourceDir = await mkdtemp(join(tmpdir(), 'dsh-attach-src-'))
    cleanups.push(async () => { await rm(sourceDir, { recursive: true, force: true }) })
    const screenshot = join(sourceDir, '验收截图.png')
    await writeFile(screenshot, Buffer.from('png-bytes'))

    const cacheBefore = await readdir(attachmentsRoot()).catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [] as string[]
      throw error
    })
    const sent = await ctx.agentTeam.sendMessage({ asTask: true,
      requestId: requestId('send'), workspaceId: alpha, channelRef: channel.channel.channelRef,
      body: '截图在下面', attachmentPaths: [screenshot],
    })
    expect(sent.kind).toBe('committed')
    if (sent.kind !== 'committed') return
    // Same metadata shape as a manual upload, with an inferred image type.
    expect(sent.message.attachments).toHaveLength(1)
    const attachment = sent.message.attachments?.[0]
    expect(attachment?.name).toBe('验收截图.png')
    expect(attachment?.mediaType).toBe('image/png')
    expect(attachment?.byteSize).toBe(Buffer.byteLength('png-bytes'))
    // The prompt line points at the cached copy, which holds the original bytes.
    const cachedPath = sent.message.body.split('\n').find(line => line.startsWith('[attachment] '))?.slice('[attachment] '.length)
    expect(cachedPath).toBeDefined()
    expect(cachedPath).toContain(attachment?.attachmentId)
    expect((await readFile(cachedPath!)).toString('utf8')).toBe('png-bytes')
    expect(await readdir(attachmentsRoot())).toHaveLength(cacheBefore.length + 1)

    // A reply carries path attachments through the same pipeline.
    const replied = await ctx.agentTeam.reply({
      requestId: requestId('reply'), workspaceId: alpha, taskRef: sent.task!.taskRef,
      body: '补充一张', baseRevision: sent.thread.revision, attachmentPaths: [screenshot],
    })
    expect(replied.kind).toBe('committed')
    if (replied.kind !== 'committed') return
    expect(replied.message.attachments?.[0]?.mediaType).toBe('image/png')
    const history = ctx.agentTeam.threadHistory({ workspaceId: alpha, taskRef: sent.task!.taskRef })
    expect(history.facts.filter(fact => fact.kind === 'message' && fact.message.attachments !== undefined)).toHaveLength(2)

    // One bad path rejects the whole send: no message, no cache writes.
    const entriesBefore = await readdir(attachmentsRoot())
    await expect(ctx.agentTeam.sendMessage({ asTask: true,
      requestId: requestId('send-bad'), workspaceId: alpha, channelRef: channel.channel.channelRef,
      body: '不应提交', attachmentPaths: [join(sourceDir, 'missing.png')],
    })).rejects.toThrow(/does not exist/)
    const coldAfterFailure = replayLedger(facility)
    expect(() => coldAfterFailure.validate()).not.toThrow()
    expect(await readdir(attachmentsRoot())).toEqual(entriesBefore)
  })
})
