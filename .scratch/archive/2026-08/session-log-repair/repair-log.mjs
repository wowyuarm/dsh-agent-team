// Repair a corrupt session log whose committed prefix ends at a clean close
// (turn/end + session/end-seed): keep the committed prefix, drop everything
// after it, recompress as header frame + body frame.
// Run (dry-run): node --experimental-transform-types repair-log.mjs <file> [more...]
// Run (apply):   node --experimental-transform-types repair-log.mjs --apply <file> [more...]
// Safety: refuses a file held open by any process (fuser); backs up to
// .pre-repair-<stamp>.bak; writes via tmp+rename so a concurrent activation
// read sees one inode or the other. Verify afterwards with diag-scan.mjs.
// HARNESS checkout override: DSH_HARNESS=/path node ... (default /home/yu/projects/deepseek-harness)
import { execSync } from 'node:child_process'
import fs from 'node:fs'

const HARNESS = process.env.DSH_HARNESS ?? '/home/yu/projects/deepseek-harness'
const { scanZstdFrames, createZstdFrameDecoder, compressZstdFrame } = await import(`${HARNESS}/packages/session/session-persistence-jsonl/src/zstd.ts`)
const { SessionLogScanner } = await import(`${HARNESS}/packages/session/session-persistence-jsonl/src/format.ts`)

// Safe while a host runs as long as NO process holds the target file open:
// a corrupt log cannot be loaded, so the host has no writer for it.
function fileInUse(target) {
  try { execSync(`fuser ${JSON.stringify(target)} 2>/dev/null`); return true } catch { return false }
}

function readLog(buf) {
  const { frames } = scanZstdFrames(buf)
  const dec = createZstdFrameDecoder()
  try {
    let scanner = null, headerLine = null
    const chunks = []
    for (const p of dec.decode(buf, frames)) {
      if (scanner === null) {
        const nl = p.indexOf(0x0a)
        headerLine = Buffer.from(p.subarray(0, nl + 1))
        scanner = new SessionLogScanner(headerLine)
      } else { scanner.write(p); chunks.push(Buffer.from(p)) }
    }
    return { frames: frames.length, headerLine, plaintext: Buffer.concat(chunks), checkpoint: scanner.checkpoint() }
  } finally { dec.close() }
}

const apply = process.argv[2] === '--apply'
for (const target of process.argv.slice(apply ? 3 : 2)) {
  if (fileInUse(target)) { console.error('REFUSING (file open by a running process): ' + target); process.exit(2) }
  const buf = fs.readFileSync(target)
  const before = readLog(buf)
  const cp = before.checkpoint
  if (cp.committedBytes === cp.inputBytes) { console.log(target.split('/').slice(-2)[0], 'ALREADY_CLEAN'); continue }
  const bodyBytes = cp.committedBytes - before.headerLine.length
  const body = before.plaintext.subarray(0, bodyBytes)
  if (body[body.length - 1] !== 0x0a) throw new Error(target + ': committed body does not end with newline; refusing')
  // Sanity: the kept prefix must end at a clean close marker.
  const lastRows = body.toString('utf8').trimEnd().split('\n').slice(-2).map(l => { try { return JSON.parse(l).type } catch { return 'UNPARSABLE' } })
  if (!lastRows.includes('session/end-seed')) throw new Error(target + ': committed prefix does not end with session/end-seed: ' + JSON.stringify(lastRows))
  console.log(JSON.stringify({ file: target.split('/').slice(-2)[0], committedEvents: cp.eventCount, keepBytes: cp.committedBytes, dropBytes: cp.inputBytes - cp.committedBytes, lastRows }))
  if (!apply) continue
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backup = `${target}.pre-repair-${stamp}.bak`
  fs.copyFileSync(target, backup)
  const rebuilt = Buffer.concat([await compressZstdFrame(before.headerLine), await compressZstdFrame(body)])
  const tmp = `${target}.repair-tmp-${process.pid}`
  fs.writeFileSync(tmp, rebuilt)
  fs.renameSync(tmp, target)
  const after = readLog(fs.readFileSync(target))
  const ok = after.checkpoint.committedBytes === after.checkpoint.inputBytes
  console.log(JSON.stringify({ file: target.split('/').slice(-2)[0], backup, rebuiltBytes: rebuilt.length, verifiedClean: ok, events: after.checkpoint.eventCount }))
  if (!ok) throw new Error(target + ': post-repair verify failed')
}
console.log(apply ? 'APPLY DONE' : 'DRY RUN ONLY')
