// Locate the exact row where the harness scanner freezes (committedBytes)
// and dump the rows around it: raw record type plus DECODED event seqs.
// This is the authoritative view — raw JSONL rows lie for packed chunk runs.
// Run: node --experimental-transform-types seam-dump.mjs <session.jsonl.zstd>
// HARNESS checkout override: DSH_HARNESS=/path node ... (default /home/yu/projects/deepseek-harness)
import fs from 'node:fs'

const HARNESS = process.env.DSH_HARNESS ?? '/home/yu/projects/deepseek-harness'
const { scanZstdFrames, createZstdFrameDecoder } = await import(`${HARNESS}/packages/session/session-persistence-jsonl/src/zstd.ts`)
const { SessionLogScanner } = await import(`${HARNESS}/packages/session/session-persistence-jsonl/src/format.ts`)
const { decodeStorageRecord } = await import(`${HARNESS}/packages/session/session-persistence-sqlite/src/codec.ts`)

const file = process.argv[2]
if (!file) { console.error('usage: seam-dump.mjs <session.jsonl.zstd>'); process.exit(1) }
const buf = fs.readFileSync(file)
const { frames } = scanZstdFrames(buf)
const dec = createZstdFrameDecoder()
try {
  const chunks = []
  let scanner = null
  for (const p of dec.decode(buf, frames)) {
    if (scanner === null) {
      const nl = p.indexOf(0x0a)
      scanner = new SessionLogScanner(Buffer.from(p.subarray(0, nl + 1)))
      if (p.length > nl + 1) chunks.push(Buffer.from(p.subarray(nl + 1)))
    } else chunks.push(Buffer.from(p))
  }
  for (const c of chunks) scanner.write(c)
  const complete = scanner.checkpoint()
  const body = Buffer.concat(chunks)
  const bodyStartInInput = complete.inputBytes - body.length // header length

  // row list with byte offsets in scanner-input coordinates
  const rows = []
  for (let i = 0, s = 0; i < body.length; i++) {
    if (body[i] === 0x0a) { rows.push({ start: s, end: i + 1 }); s = i + 1 }
  }
  const frozenAt = complete.committedBytes - bodyStartInInput // body offset of committed cursor
  const seamIdx = rows.findIndex(r => frozenAt < r.end) // first row not fully committed
  const rowInfo = (r) => {
    const rawLine = body.subarray(r.start, r.end - 1).toString('utf8')
    let parsed, decErr
    try { parsed = JSON.parse(rawLine) } catch (e) { decErr = e.message }
    let seqs = [], types = []
    if (parsed !== undefined) {
      try { const evs = decodeStorageRecord(parsed); seqs = evs.map(e => e.seq); types = [...new Set(evs.map(e => e.type))] } catch (e) { decErr = 'decode: ' + e.message }
    }
    return { bodyStart: r.start, bytes: r.end - r.start, rawType: parsed?.type ?? decErr ?? '?', rawSeq: parsed?.seq, decodedSeqs: seqs.length > 6 ? `${seqs[0]}..${seqs.at(-1)}(${seqs.length})` : seqs, types: types.length > 2 ? `${types[0]}+${types.length - 1} more` : types }
  }
  console.log(JSON.stringify({
    file: file.split('/').slice(-2)[0],
    bodyBytes: body.length, rows: rows.length,
    committed: complete.committedBytes, input: complete.inputBytes, events: complete.eventCount,
    frozenAtBodyOffset: frozenAt,
    seamRow: seamIdx,
    ...(seamIdx >= 0
      ? {
          before: rows.slice(Math.max(0, seamIdx - 2), seamIdx).map(rowInfo),
          seam: rowInfo(rows[seamIdx]),
          after: rows.slice(seamIdx + 1, seamIdx + 3).map(rowInfo),
        }
      : { seam: 'ALL COMMITTED' }),
    lastRow: rowInfo(rows[rows.length - 1]),
  }, null, 1))
} finally { dec.close() }
