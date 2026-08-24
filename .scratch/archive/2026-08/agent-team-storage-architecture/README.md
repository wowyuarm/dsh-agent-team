# Agent Team Ledger Storage

Status: closed 2026-08-24 — release scope (issues 01+02) shipped in 0.1.0; issues 03/04 and the post-release half of issue 05 stay deferred here

Last checked: 2026-08-24

## Scope

Design the durable storage shape for the Agent Team operation ledger after the
local v7 to v8 incident. The work covers the `raft.build` research, the SQLite
and checkpoint direction, the boundary between the ledger and derived
projections, and the pre-release domain-version reset.

## Confirmed Release Decisions (2026-08-23)

- This release ships issues 01 + 02 only: reset the logical domain to v1 and
  route `agent_team` to SQLite through public composition. No Harness source
  changes.
- Issues 03 (log facet) and 04 (checkpoint) are deferred post-release: the
  public seam does not exist, adding it would modify `../deepseek-harness`,
  and a KV-only snapshot cannot deliver tail-only startup anyway.
- The v1 reset happens once, together with the SQLite cutover, in this
  release train; logical versions increase monotonically afterwards.
- Old local media are rejected, never migrated by shipped code. Local data
  conversion is an operator-run, one-off task outside the product.
- Light 1k/10k benchmarks validate the SQLite route before release;
  100k-scale measurements and archive-segment decisions stay post-release.

## Expected Outcome Boundary

Confirmed with the human on 2026-08-23: issues 01+02 are sufficient for
release because they remove the only per-operation cost that grows with the
medium (whole-file JSON rewrite) and give the public format a clean start.
What stays knowingly unsolved: startup still pays full `loadAll()` plus full
replay (linear in history; about 10 ms at today's roughly 384 operations),
and memory holds the whole transcript. Existing tests already cover the
ledger over a real SQLite medium (`sqliteHarness` in
`packages/agent-team/tests/agent-team.spec.ts`), so issue 02 is deployment
work, not ledger rework.

## Decision Frontier

- Keep the append-only operation ledger as the only Team authority.
- Route `agent_team` to SQLite as the first storage improvement.
- Do not treat an extra KV snapshot table as the final checkpoint solution:
  the current `storage-domain` open path still loads and validates every
  operation record before the Team ledger starts.
- Add a log-oriented storage contract (preferably a public Harness `log`
  facet) before relying on tail-only restore.
- Use a validated checkpoint as a rebuildable boot cache. Do not physically
  delete old operations in the first implementation.
- Reset the logical `agent_team` domain version to `1` before public release;
  reject and recreate local v8/v9 media rather than adding runtime migration.

## Entry Points

- [`spec.md`](spec.md): research, decisions, target architecture, migration,
  and implementation plan.
- [`issues/01-reset-domain-version.md`](issues/01-reset-domain-version.md)
- [`issues/02-route-agent-team-to-sqlite.md`](issues/02-route-agent-team-to-sqlite.md)
- [`issues/03-add-log-oriented-storage-contract.md`](issues/03-add-log-oriented-storage-contract.md)
- [`issues/04-add-validated-projection-checkpoint.md`](issues/04-add-validated-projection-checkpoint.md)
- [`issues/05-benchmark-and-defer-physical-compaction.md`](issues/05-benchmark-and-defer-physical-compaction.md)

## Exit Conditions

Close this work item only after the durable conclusions have moved to the
maintained architecture/development documents and each unfinished ticket is
either implemented or explicitly deferred.

Deferred tickets (03, 04, and the post-release half of 05) stay recorded here
or as a Harness extension requirement until a separate decision reopens them.
