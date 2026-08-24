# Route Agent Team To SQLite

Status: implemented 2026-08-23; committed in `7bc27f7` and shipped in release 0.1.0

## Outcome

- `cordis.patch.yml`: inserted `storage-sqlite` row (medium
  `$DSH_HOME/storages/agent_team.sqlite`) and a TOP-LEVEL `storage-domain`
  override with `{ backend: json, routes: { agent_team: sqlite } }`.
- Lesson recorded the hard way: an insert-list entry with a colliding id does
  not override — insert appends, so the duplicate id failed the boot sweep
  (`duplicate loader entry id: storage-domain`). Cross-layer overrides must be
  top-level rows; shipping.spec now simulates the two-layer stack with the
  production parser to guard this.
- `package.json`: regular dependency on `@deepseek-ai/dsh-storage-sqlite`
  (not in the dsh app manifest heal closure, so a peer could go unresolved in
  real installs). Verified range `>=0.1.1-rc.2 <0.2.0`.
- `scripts/team-ui.e2e.ts`: install step links storage-sqlite beside the
  copied bundle, mirroring where a real profile install would place it.
- Verification: full unit suite green; real Web journey (`npm run
  test:browser`) passes end to end with the routed medium.
- Benchmark results recorded in `docs/development.md` and spec §0.

## Goal

Remove JSON whole-file rewrites from the hot Team operation path while leaving
other storage domains on their existing routes. No Harness source changes.

## Verified Mechanics (2026-08-23)

- `DomainFacility` resolves each domain's backend as
  `routes[spec.name] ?? backend` — public config, no routing code changes.
- This bundle's profile-level patch inserts a `@deepseek-ai/dsh-storage-sqlite`
  row and overrides the shipped `storage-domain` row by id with
  `{ backend: json, routes: { agent_team: sqlite } }`. A patch replaces the
  row's whole config, so `backend: json` must be restated; document this
  coupling to upstream keys.
- The sqlite backend is complete (WAL default, per-row upsert, logical version
  stamps in `units`, physical marker in `PRAGMA user_version`, owner-only file
  modes) but is mounted by no composition today.
- Cutover creates a new empty medium; the old `agent_team.json` stays behind
  untouched and must be moved deliberately (operator task), or it looks like
  data loss.

## Files / Areas

- Root bundle patch (`cordis.patch.yml`) and the package dependency manifest.
- Adjacent Harness Web storage composition only if a public gap is found.
- `packages/agent-team/tests/agent-team.spec.ts`.
- `docs/development.md`.

## Acceptance

- A real Host restart replays Team operations from SQLite.
- JSON-backed domains remain unaffected.
- The route is configured through public storage APIs, not a direct SQLite
  import in Team.
- Dependency declaration verified in the copied-package release layout
  (`scripts/team-ui.e2e.ts`): if the profile peer fallback does not provide
  `@deepseek-ai/dsh-storage-sqlite`, this bundle carries it as a regular
  dependency with a pinned compatible range.
- Light benchmark output records append latency and bytes written at 1k and
  10k operations (full-scale thresholds stay post-release, see issue 05).
- The limitation that current `loadAll()` still scans all operations is
  documented.
