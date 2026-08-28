# Quality audit report

Date: 2026-08-27
Scope: final simplification and maintainability review closure. Current behavior remains owned by `packages/`, tests, package README files, and `docs/`.

## Final outcomes

### Implemented

- **Unused attachment helper removed.** `attachmentExists` had no consumer and was deleted from `packages/agent-team/src/attachments.ts`.
- **Fake Thread anchor removed.** `TeamThreadPage` now has an explicit unloaded-projection branch instead of fabricating a `message:missing` anchor.
- **Member editor state has one owner.** The Agent editor and model picker moved from `TeamAgentsPanel` into `TeamMemberEditor`, retaining the existing durable update and membership flows.
- **Client integration tests are split by surface.** Shared assembled setup is now `packages/client-agent-team/tests/harness.tsx`; Agent/editor and conversation surfaces have separate specs.
- **Build/prepack stale-output cleanup is locked.** A fixed-allowlist cleaner runs before Typert so deleted source cannot leave stale `lib/` artifacts in pack; the shipping contract locks the three targets and order. The prior pack contained deleted `member-dm-policy` JavaScript/declaration/map outputs; the verified pack has 161 files and zero entries for that module.
- **Final lint cleanup is confirmed.** Seven unused imports were removed and the intentional filename control-character regex uses the narrowest suppression. Full release lint confirmed 0 warnings / 0 errors across 89 files.

### Retained by evidence

- **`use-sync-external-store` dependency and Vitest alias remain.** Harness `ui-renderer/bind` resolves its selector shim through the assembled Client test path; removing either causes React hook-dispatcher failures. Static unused-dependency output is not authority for this dynamic singleton requirement.
- **Client Thread-page locality remains intact.** `TeamThreadPage` keeps read admission, history paging, change refresh, unread state, and mutations on shared refs/actions; trial extraction would expand its return interface and split one coherent lifecycle, so the page remains the state owner. The separate Ledger projection conclusion is recorded below.
- **Current optional fields remain current semantics.** `member.model` is optional to inherit the Host default and Message attachments are optional for messages without uploads. Neither is a compatibility field to remove.

### Deferred or rejected

- **Ledger projection extraction is deferred.** The current `AgentTeamLedger` has a tightly coupled 39-method closure and more than eight projection-dependent callbacks. Moving the entire projection/replay block would not reduce authority ownership or materially improve locality; partial extraction would add a second seam. Revisit only as a separately scoped, behavior-locked refactor.
- **API/types/package splitting is not justified.** The review found no evidence for a new public provider seam, a broader package split, or opportunistic type/API exports narrowing. The external bundle keeps one Host ledger authority and its existing explicit Client/Tool boundaries.
- **No static-analysis CI gate is added.** Dynamic Cordis registrations, preview templates, and assembled Client aliases make the attempted static findings unreliable until entrypoint allowlists are proven.

## Compatibility policy retained

The DSH Session-schema disposal policy is distinct from the Team ledger's narrow operation normalization. The local ledger sample contains 170 legacy `team/thread-read` anchors and 67 Message facts without Message-level `occurredAt`.

- `agentTeamOperationSchema` stamps ordinary stored Message operations with the wrapping operation instant during load (`packages/agent-team/src/spec.ts`).
- `AgentTeamLedger.normalizeOperation()` resolves old `team/thread-read` anchors and Message facts from the originating Message operation, falling back to the read operation only when no origin is available (`packages/agent-team/src/ledger.ts`).
- `packages/agent-team/tests/agent-team.spec.ts` proves replay preserves the restored Message instant.

This normalization is intentionally retained to preserve existing Team history. It does not create a broad migration path and does not classify model inheritance or attachments as legacy.

## Documentation closure

`docs/architecture.md` now removes the deleted Human Member DM instruction, distinguishes Session-schema disposal from Team-operation normalization, and records current private-memory cleanup behavior. `docs/development.md` now states one cleanup policy: startup only ensures/rebuilds missing private-memory structure; explicit Member removal deletes that Member directory.

## Source evidence

- `packages/agent-team/src/index.ts`: `initializePrivateMemory()` creates missing private-memory structure; `cleanupRemovedMember()` removes it only after explicit Member removal.
- `packages/agent-team/src/spec.ts`, `ledger.ts`, and `tests/agent-team.spec.ts`: narrow `occurredAt` normalization and replay proof.
- `packages/client-agent-team/src/client/TeamThreadPage.tsx`: explicit unloaded branch; no fabricated anchor.
- `packages/client-agent-team/src/client/TeamMemberEditor.tsx` and `tests/harness.tsx`: extracted state owner and shared test harness.
