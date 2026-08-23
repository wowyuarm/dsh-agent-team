# Reset Agent Team Domain Version

Status: implemented 2026-08-23 (uncommitted)

## Outcome

- `agentTeamDomainSpec.version` reset to `1`; doc comment names v1 the first
  public ledger format.
- `agent-team.spec.ts`: test renamed to "boots a v1 empty Team and rejects
  old ledger media"; old-media rejection now stamps v9 against wanted v1
  (`/stamped v9, descriptor wants v1/`).

## Goal

Make the next Team ledger format the first public format, version `1`, with no
runtime compatibility path for local v8/v9 media.

## Files

- `packages/agent-team/src/spec.ts`
- `packages/agent-team/src/types.ts`
- `packages/agent-team/tests/agent-team.spec.ts`
- `packages/agent-team/tests/update-operations.spec.ts`
- `packages/agent-team/README.md`
- affected maintained docs

## Acceptance

- Fresh v1 media opens and replays.
- Old stamped media reject with `version-mismatch`.
- Test helpers and names no longer claim v8/v9 as current.
- Startup does not delete, migrate, or silently fall back to old media.
- The reset is made only after the final operation/checkpoint schema is fixed.

## Decisions (2026-08-23)

- Reset lands once, alongside the SQLite cutover of issue 02, not before.
- No shipped export/import tool. Local data conversion is an operator-run
  one-off task outside the product (the operator arranges it separately).

## Operator Tool

`scripts/migrate-team-ledger.ts` (added 2026-08-23, `npm run migrate`) is the
operator's own one-shot converter: v9 JSON medium in, v1 SQLite medium out,
replay-verified through the real facility and ledger. It is dev-repo tooling,
not shipped runtime, and the old JSON medium is never touched by it.
