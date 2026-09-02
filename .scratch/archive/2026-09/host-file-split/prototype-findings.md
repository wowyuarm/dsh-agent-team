# Prototype validation results

Date: 2026-09-02. Read-only prototype against HEAD `d791094`; no production files changed.

## types.ts barrel split — validated mechanically

Exact split boundaries (1-based, verified by script):

| Section | Lines | First / last symbol |
| --- | --- | --- |
| entities (brands, actors, entities, activities, stored facts) | 1–357 | `AgentTeamOperationId` … `AgentTeamStoredThreadReadFact` |
| operations | 358–655 | `AgentTeamInitializedOperation` … `AgentTeamOperation` union |
| requests + results | 656–1221 | `AgentTeamOperationReceipt` … end |

Findings:

1. **The natural seam is 3 files, not 5.** Actors/entities/stored-facts are mutually interleaved (attention keys feed operations; stored facts mirror live facts), and requests/results share the receipt + inbox/view/changes section. Splitting into actors/entities/operations/requests/results as originally sketched would create re-export churn without reducing navigation; `entities.ts` / `operations.ts` / `requests-results.ts` keeps each file 350–570 lines and every dependency one-directional:
   - `operations.ts` imports entities (operation data embeds entity snapshots) — one direction only.
   - `requests-results.ts` imports both — one direction only.
2. **External imports** (`dsh-llm` ReasoningEffortId, `dsh-brand` Branded, `dsh-session` SessionId, `dsh-workspace` WorkspaceId) all live in the entities section; operations/requests-results inherit them transitively, so only `entities.ts` carries the import block. No new external imports needed.
3. **Barrel stays trivial**: `types.ts` becomes ~30 lines of `export type { … } from './types/entities.ts'` etc. The `@wowyuarm/dsh-agent-team/types` subpath, `sync-paths.mjs` own-paths entries, and Typert generation all key off `types.ts`, which still exists — facade regeneration is a formality (`npm run generate:typert && node scripts/sync-paths.mjs`), not a redesign.
4. **Circular-import risk: confirmed absent** at the file level. `AgentTeamStoredMessage` (343) and `AgentTeamStoredThreadFact` (347) sit in entities and are consumed only by operations (347→ operations section) and requests (`anchor: AgentTeamStoredMessage`, line 586+). The dependency graph is strictly entities ← operations ← requests-results.

Estimated effort: half a day including typert regen + full `npm test`; blast radius limited to `packages/agent-team/src/` import paths (grep shows all internal imports go through `./types.ts`, none reach into section internals).

## index.ts member-runtime extraction — sequencing decision

The inventory (see `boundary-inventory.md`) stands. Added from this pass:

1. **Do types.ts first.** The member-runtime extraction adds new imports to `index.ts`; doing the barrel split first means the extraction imports named symbols from the split files directly (entities for `AgentTeamMemberCapabilities`, requests for policy types), instead of pulling the whole 1220-line barrel into the new `member-runtime.ts`.
2. **The `MemberRuntime` class needs only 5 service dependencies** (validated by tracing every moved method): `ctx`, `liveMemberContext()`, `memberLabel()`, `runningAgents` (shared Set reference), and one `onMemberFailure` callback. No ledger access, no Remote surface — the seam is clean.
3. **Test-first order for the extraction**: run `member-tool-policy.spec.ts` + `member-skills.spec.ts` + `member-lifecycle.spec.ts` after each moved cluster (policy → skills → memory), not only at the end; the turn-boundary wait is the one piece with real listener lifecycle risk.

## Recommended execution order for the future refactor Task

1. `types.ts` → `types/entities.ts` + `types/operations.ts` + `types/requests-results.ts` + barrel; regenerate typert/facades; full suite.
2. `index.ts` → extract `MemberRuntime` (state + methods per inventory); behavior-equivalence standard: only imports change, no `expect` edits.
3. Re-measure: expect `index.ts` ~1150, `types.ts` ≤ 40, no file above `ledger.ts`'s 2940 (which stays deferred per the 8 月 verdict).

---

# IMPLEMENTED — 2026-09-02 (HEAD `5f749c0`)

Both phases executed under the Human-authorized implementation mandate. Commits: `bc9e848` (types split), `5f749c0` (MemberRuntime extraction, includes ablation pass).

## Corrections to the prototype (found during implementation)

1. **External imports do NOT flow transitively through the barrel.** `operations.ts` needs its own `SessionId`/`WorkspaceId` imports; `requests-results.ts` needs `WorkspaceId`. Each split file imports what it references.
2. **`AgentTeamOperationBase` was module-private** in the original types.ts; exported from `entities.ts` so `operations.ts` can extend it.
3. **requests-results has zero imports from operations** — the prototype's "imports both" claim was wrong; only the entities import is needed.
4. **`export type *` barrel** (not a 30-line explicit list) keeps the barrel at 12 lines with zero name-duplication risk across 137 exports.

## Ablation pass (消融实验) — elements removed after challenging the draft

1. **`onMemberFailure` callback dependency: deleted.** `memberFailures` writes happen only in the service's catch blocks, which never left; the draft interface carried a callback with no internal consumer.
2. **`memberLabel` dependency: deleted.** The error message using it lives in the `liveMemberContext` resolver, which the service supplies — the label lookup is service-side `memberLabel`, already available there.
3. **5 deps → 3 deps**: `ctx`, `liveMemberContext`, `runningAgents`. Final seam.
4. **`releaseMemberSkillProvider` public method: inlined into `forgetMember`** (its only remaining caller).
5. **`setSkillSelection` merged into `mountMemberSkillProvider`** — same activation event, same selection object; two calls were one lifecycle fact.
6. **`BUNDLED_SKILLS_DIRECTORY` moved from index.ts to member-runtime.ts** with `mountMemberSkillProvider`'s `bundledSkillsDirectory` parameter deleted — the constant is a member-runtime implementation detail (`resolve(dirname(fileURLToPath(import.meta.url)), '../core-skills')` resolves correctly from the emitted `lib/member-runtime.js` to the packed `core-skills/`; verified via `npm pack --dry-run` and the bundled-skills spec).
7. **Bug the ablation caught**: the first draft of `applyCapabilityEdit` re-checked `runningAgents.has()` after the wait — in the waited-then-disposed path it skipped the handle guard and would call `tools.restrict` on a destroyed context. Fixed by returning `waited: boolean` from `awaitTurnBoundary` and guarding on that; matches the pre-refactor control flow exactly.
8. **`AGENT_TEAM_TOOL_NAMES` moved to member-runtime** (breaking a would-be index ↔ member-runtime import cycle); `index.ts` re-exports it, so the public `@wowyuarm/dsh-agent-team/host` surface is unchanged — tests import it through index and pass unmodified.

## Final state

| File | Before | After |
| --- | --- | --- |
| `index.ts` | 1552 | 1386 |
| `types.ts` | 1220 | 12 (pure `export type *` barrel) |
| `types/entities.ts` | — | 357 |
| `types/operations.ts` | — | 319 |
| `types/requests-results.ts` | — | 596 |
| `member-runtime.ts` | — | 254 |
| `ledger.ts` | 2940 | 2940 (deferred per 2026-08 verdict) |

All 5 "Deliberate interface reservation" comment sites verified intact post-move (2 in member-runtime, 1 each in member-skills/spec/types.entities). Zero test-file changes (`git diff` empty on all three packages' tests). Verification: typecheck, 259/259 full suite, clean build, lint 0/0, `git diff --check`, `npm pack --dry-run` content check (lib/types/*.js + member-runtime.js present, core-skills resolve beside emitted lib).

Remaining follow-ups (not blockers): none identified. The `dsh-0.1.2-alpha-tracking` scratch directory (not mine) is still untracked.
