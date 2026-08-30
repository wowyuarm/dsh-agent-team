// Extract close-out / turn / retry / inbox events with wall-clock timestamps
// to date when a corruption formed (e.g. prove a restart-overlap incident by
// several files being rewritten within the same second).
// Run: node --experimental-transform-types incident-times.mjs <session.jsonl.zstd>
// HARNESS checkout override: DSH_HARNESS=/path node ... (default /home/yu/projects/deepseek-harness)
import fs from 'node:fs'

const HARNESS = process.env.DSH_HARNESS ?? '/home/yu/projects/deepseek-harness'
const { scanZstdFrames, createZstdFrameDecoder } = await import(`${HARNESS}/packages/session/session-persistence-jsonl/src/zstd.ts`)

const file = process.argv[2]
if (!file) { console.error('usage: incident-times.mjs <session.jsonl.zstd>'); process.exit(1) }
const buf = fs.readFileSync(file)
const { frames } = scanZstdFrames(buf)
const dec = createZstdFrameDecoder()
try {
  const chunks = []
  for (const p of dec.decode(buf, frames)) chunks.push(Buffer.from(p))
  const all = Buffer.concat(chunks)
  const lines = []
  for (let i = 0, s = 0; i < all.length; i++) if (all[i] === 0x0a) { lines.push(all.subarray(s, i + 1)); s = i + 1 }
  const pick = []
  for (const line of lines) {
    let p; try { p = JSON.parse(line.toString('utf8')) } catch { continue }
    const t = p.type
    if (t === 'session/end-seed' || t === 'turn/end' || t === 'turn/start' || t === 'llm/retry' || t === 'agent/inbox/spliced') {
      pick.push({ type: t, seq: p.seq, time: p.time ? new Date(p.time).toISOString() : null })
    }
  }
  const header = JSON.parse(lines[0].toString('utf8'))
  console.log(JSON.stringify({ file: file.split('/').slice(-2)[0], headerId: header.id ?? header.sessionId, createdAt: header.createdAt, interesting: pick.slice(-14) }, null, 1))
} finally { dec.close() }
