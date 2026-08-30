# Session log repair tooling (seq-collision corruption)

- Status: closed and archived 2026-08-30
- Last checked: 2026-08-30
- Scope: diagnosis and repair tooling for agent-team session logs the Harness reader refuses (`corrupt Zstandard session log: complete frame contains a torn JSONL record`).
- Outcome: 2026-08-30 all corrupt logs (Flash `agent-team-736b6412` plus two `~`-workspace logs) were repaired with these scripts and verified against a real web-dev host: members returned to `active`, Flash appended ~86 fresh events and closed cleanly (`turn/end` + `session/end-seed`) on shutdown. An earlier incident of the same class on 2026-08-25 (dual-profile parallel hosts → ledger sequence divergence + 4 session logs) was repaired separately.
- End condition: met — durable lessons live in Nowledge Mem (`dsh 会话日志 seq 撞号损坏`、`dsh 会话日志损坏的诊断与修复 runbook`); upstream fix (append-前校验 / flock / shutdown 终止 in-flight turns) is a Harness-side proposal, not this repo's work.
- Formal-document exit: none in `docs/` — this is Harness behavior, not bundle behavior; the Harness reader semantics cited below were current as of 2026-08-30.

## Root cause (both incidents)

Session logs under one `~/.dsh/sessions/` root have no cross-process writer exclusion. 2026-08-29 19:23: a web-dev restart overlapped — the new host restored sessions and appended the `session/end-seed` creation seed, while the old host (kept alive ~75s by in-flight `llm/retry` backoff) later delivered pending team inbox messages, appending at EOF with its stale in-memory seq base. The resulting seq collision freezes `SessionLogScanner.committedBytes`, and the reader reports the misleading "torn JSONL record" message — which actually covers three distinct failures: torn tail frame, unparsable row, and seq collision.

## Tools

All need `node --experimental-transform-types` (they import Harness TS sources) and default to the checkout at `/home/yu/projects/deepseek-harness`; override with `DSH_HARNESS=/path`. They depend on Harness internals (`scanZstdFrames`, `SessionLogScanner`, `decodeStorageRecord`); adjust after Harness refactors.

### diag-scan.mjs — full health scan

Host-faithful read of every `session.jsonl.zstd` under `~/.dsh/sessions/`; prints only logs the real reader would refuse.

```sh
node --experimental-transform-types diag-scan.mjs                 # scan all
node --experimental-transform-types diag-scan.mjs redtest <file>  # self-test on a clean log
```

### seam-dump.mjs — locate the freeze point

Per-file: scanner `committedBytes`, and the rows around the freeze with DECODED event seqs. Do not trust raw JSONL rows — packed chunk rows (`text-chunks` etc.) have a different shape than decoded events.

```sh
node --experimental-transform-types seam-dump.mjs <session.jsonl.zstd>
```

### incident-times.mjs — date the corruption

Extracts `session/end-seed` / `turn/end` / `turn/start` / `llm/retry` / `agent/inbox/spliced` events with wall-clock timestamps. Several files rewritten within the same second = one host-wide incident (this is how the 2026-08-29 restart overlap was proven).

```sh
node --experimental-transform-types incident-times.mjs <session.jsonl.zstd>
```

### repair-log.mjs — repair

Keeps the committed prefix, drops everything after it, recompresses as header frame + body frame. Guards: refuses a file held open by any process (`fuser`); refuses unless the kept prefix ends with `turn/end` + `session/end-seed` (clean close); backs up to `<file>.pre-repair-<stamp>.bak`; writes via tmp+rename so a concurrent activation read sees one inode or the other.

```sh
node --experimental-transform-types repair-log.mjs <file>              # dry-run
node --experimental-transform-types repair-log.mjs --apply <file> ...  # apply
```

## Runbook

1. Stop or identify the writer: a corrupt log cannot be loaded, so the host normally holds no writer for it; still run `fuser <file>` (repair-log does this itself) and prefer repairing while no host runs.
2. `diag-scan.mjs` → find the red files.
3. `seam-dump.mjs` → confirm the failure class (seq collision vs torn tail vs unparsable).
4. `incident-times.mjs` → date it; if several files share a second, suspect a host-restart overlap and check that only one host is running before repairing.
5. `repair-log.mjs --apply` → verify `verifiedClean: true`; `.bak` stays next to the original until manually cleaned.
6. Start web-dev, confirm the member shows `active` (the row menu's 重启 re-runs activation when the member is still marked unavailable in the running host's memory).

## What this does not cover

Logs whose committed prefix does not end at a clean close (e.g. mid-turn truncation without the close-out) are refused by `repair-log.mjs`; they need a case-by-case decision (rebase or accept history loss). Corrupt `agent_team.sqlite` ledger state is a separate repair path (see 2026-08-25 incident notes in Nowledge Mem).
