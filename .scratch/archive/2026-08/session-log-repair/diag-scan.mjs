// Scan every session log under ~/.dsh/sessions with host-faithful read
// semantics; print only logs the real harness reader would refuse.
// Run: node --experimental-transform-types diag-scan.mjs  (redtest: self-test)
// HARNESS checkout override: DSH_HARNESS=/path node ... (default /home/yu/projects/deepseek-harness)
import fs from 'node:fs'
import path from 'node:path'

const HARNESS = process.env.DSH_HARNESS ?? '/home/yu/projects/deepseek-harness'
const { scanZstdFrames, createZstdFrameDecoder, compressZstdFrame } = await import(`${HARNESS}/packages/session/session-persistence-jsonl/src/zstd.ts`)
const { SessionLogScanner } = await import(`${HARNESS}/packages/session/session-persistence-jsonl/src/format.ts`)

// Host-faithful read: consume yielded buffers immediately (decoder reuses memory).
function hostRead(buf) {
  const { frames, tornStart } = scanZstdFrames(buf)
  if (frames.length === 0) return { error: 'empty or header-less log' }
  const dec = createZstdFrameDecoder()
  try {
    let header = null
    let scanner = null
    let lastByte = -1
    const fragments = []
    for (const p of dec.decode(buf, frames)) {
      if (scanner === null) {
        const nl = p.indexOf(0x0a)
        header = Buffer.from(p.subarray(0, nl + 1))
        if (nl !== p.length - 1) return { error: 'first frame is not exactly one header line' }
        scanner = new SessionLogScanner(header)
      } else {
        scanner.write(p)
        fragments.push(Buffer.from(p))
      }
      lastByte = p.length > 0 ? p[p.length - 1] : lastByte
    }
    const complete = scanner.checkpoint()
    const tail = complete.inputBytes - complete.committedBytes
    if (tail !== 0) {
      const all = Buffer.concat(fragments)
      const lines = []
      let start = 0
      for (let i = 0; i < all.length; i++) {
        if (all[i] === 0x0a) { lines.push(all.subarray(start, i)); start = i + 1 }
      }
      const trailing = start < all.length ? all.subarray(start) : undefined
      // Walk DECODED-equivalent raw rows only as a first hint; the authoritative
      // freeze point lives in the scanner (see seam.mjs for the decoded view).
      let expectedSeq = 0
      let firstBad = null
      for (let li = 0; li < lines.length; li++) {
        let parsed
        try { parsed = JSON.parse(lines[li].toString('utf8')) } catch (e) {
          firstBad = { line: li + 2, reason: 'unparsable', message: e.message, preview: lines[li].toString('utf8').slice(0, 120) }
          break
        }
        const events = Array.isArray(parsed) ? parsed : [parsed]
        for (const ev of events) {
          if (ev && typeof ev === 'object' && 'seq' in ev) {
            if (ev.seq !== expectedSeq) {
              firstBad = { line: li + 2, reason: 'raw seq hint (verify with seam.mjs)', expected: expectedSeq, got: ev.seq, type: ev.type }
              break
            }
            expectedSeq = ev.seq + 1
          }
        }
        if (firstBad) break
      }
      return { red: true, tornStart: tornStart ?? null, tailBytes: tail, trailingFragmentBytes: trailing?.length ?? 0, firstBad }
    }
    return { ok: true, frames: frames.length, tornStart: tornStart ?? null, events: complete.eventCount }
  } finally { dec.close() }
}

const mode = process.argv[2]
if (mode === 'redtest') {
  const src = process.argv[3]
  if (!src) { console.error('redtest needs a clean session.jsonl.zstd path'); process.exit(1) }
  const buf = fs.readFileSync(src)
  const attempt = (r) => { try { return r() } catch (e) { return { threw: e.message } } }
  const show = (label, r) => console.log(label, JSON.stringify(r))
  show('baseline', attempt(() => hostRead(buf)))
  // A turn/end arriving after the scanner raised an issue makes the real host
  // throw; the same holds here, so each case reports a thrown error verbatim.
  const tornBuf = Buffer.concat([buf, await compressZstdFrame('{"type":"turn/start"')])
  show('torn-tail', attempt(() => hostRead(tornBuf)))
  const gapBuf = Buffer.concat([buf, await compressZstdFrame(JSON.stringify({ type: 'turn/end', seq: 999999, time: 1, data: { turn: 9, reason: { kind: 'completed' } } }) + '\n')])
  show('seq-gap', attempt(() => hostRead(gapBuf)))
} else {
  const base = path.join(process.env.HOME, '.dsh', 'sessions')
  for (const root of fs.readdirSync(base)) {
    const dir = path.join(base, root)
    for (const entry of fs.readdirSync(dir)) {
      const f = path.join(dir, entry, 'session.jsonl.zstd')
      if (!fs.existsSync(f)) continue
      const buf = fs.readFileSync(f)
      let r
      try { r = hostRead(buf) } catch (e) { r = { error: e.message } }
      if (!r.ok) console.log(JSON.stringify({ root, entry, ...r }))
    }
  }
  console.log('host-faithful scan done')
}
