# Benchmark And Defer Physical Compaction

Status: planned — light pre-release part only; scale decisions post-release

## Goal

Use measurements to decide whether SQLite plus checkpoints is sufficient before
introducing archive segments or deletion semantics.

## Split (2026-08-23)

- Pre-release (with issue 02): a light 1k/10k-operation benchmark validating
  the SQLite route choice — append latency, bytes written, and a recorded
  note that startup `loadAll()` cost is unchanged in this phase.
- Post-release: 100k-scale measurements, checkpoint/archive thresholds, and
  any retention decision.

## Acceptance

- Measure 1k and 10k operation ledgers with realistic message sizes before
  release; record startup load/parse/replay time, append latency, and bytes
  written.
- Keep all raw operations in the first implementation.
- If archives are later needed, define sealed segment checksums, contiguous
  ranges, crash recovery, historical reads, and idempotency retention before
  deleting anything.
