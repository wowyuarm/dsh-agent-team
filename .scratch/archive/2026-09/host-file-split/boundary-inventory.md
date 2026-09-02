# index.ts member-runtime extraction boundary inventory

Date: 2026-09-02. Read-only study; HEAD `d791094`, `packages/agent-team/src/index.ts` = 1552 lines, `AgentTeam` class body starts at line 195.

## A. State to move (class fields, lines 205–247)

| Field | Line | Notes |
| --- | --- | --- |
| `skillSelections` | 210 | live skill selection refs |
| `skillProviderDisposals` | 214 | per-member provider disposers |
| `memberRestrictions` | 237 | tool-policy disposers (interface reservation) |
| `capabilityWarnings` | 243 | runtime-derived warnings, never persisted |

Kept on the service (not member-runtime): `domain`, `ledger`, `handles`, `modelSelections`, `memberFailures` (mixed: activation failures are lifecycle, but the map is read across recovery/compaction — keep, expose read access), `autoCompaction`, `runningAgents`, `notifiedInbox`, `attachmentGcTimer`, `recovery`.

## B. Methods to move

| Method | Line | Cluster |
| --- | --- | --- |
| `deepCopyCapabilities` (module fn) | 142 | capabilities |
| `applyMemberToolPolicy` | 1227 | tool policy |
| `applyToolPolicyEdit` (turn-boundary wait) | 663 area | tool policy |
| `reapplyMemberToolPolicy` | 1252 | tool policy |
| `releaseMemberToolPolicy` | 1264 | tool policy |
| `requireLiveMemberContext` | 1257 | tool policy support |
| `initializePrivateMemory` | 1286 | private memory |
| `cleanupRemovedMember` | 1298 | private memory |
| skill-provider mount block inside activation | ~1130 | skills |

Estimate: ~330–380 lines move out; `index.ts` lands near ~1150.

## C. Methods that stay but gain cross-module calls

- `injectRecovery` (650), `emitAutoCompactionChanged` (1374), `memberLabel` (602), `notificationText`/`activityNotification`/`clearMemberNotificationState` (1426–1520): these are notification/observation responsibilities, not member runtime. They stay; the extracted module calls back via an explicit interface.

## D. Proposed shape

`member-runtime.ts` exports one class (not a service):

```
MemberRuntime {
  constructor(deps: {
    ctx: Context                       // for agent events + logger
    liveMemberContext(memberId): Context
    memberLabel(memberId): string
    runningAgents: Set<SessionId>      // shared reference, not a copy
    onMemberFailure(...)               // narrow callback for activation errors
  })
  applyPolicy(agentCtx, member) / reapplyPolicy(member) / releasePolicy(memberId)
  awaitPolicyEdit(active, stored)      // the turn-boundary wait
  mountSkills(agentCtx, member): () => void
  initializeMemory(path) / cleanupMemory(member)
  warningsFor(memberId)                // capabilityWarnings read access
}
```

Why a class, not a module of functions: the four maps are cohesive per-Member lifecycle state that must dispose together; a class keeps the disposal invariants in one place while `index.ts` keeps only orchestration.

## E. Risks

1. **Activation ordering**: `applyMemberToolPolicy` currently runs inside preset mount before `validateMemberPreset`. The extraction must preserve exact call order in the activation `setup` callback; the tests in `member-tool-policy.spec.ts` (417 lines) and `member-skills.spec.ts` (279 lines) lock this — run both per iteration.
2. **Turn-boundary wait listeners**: `applyToolPolicyEdit` subscribes `agent/status` + `session/disposed` and must resolve on disposal. The listeners use `this.ctx` (Host ctx). The extracted class needs the Host ctx reference; acceptable (constructor dep), but document that member-runtime is Host-side by design.
3. **Interface-reservation comments** (5 sites) must move verbatim with their code — they are cleanup guardrails.
4. `memberFailures` dual use (activation vs runtime/compaction) is the one entangled field. Resolution: keep the map on the service; member-runtime receives a narrow `onMemberFailure` callback instead of the map.

## F. Verification plan (per iteration)

`npm run typecheck && npx vitest run packages/agent-team/tests/member-tool-policy.spec.ts packages/agent-team/tests/member-skills.spec.ts packages/agent-team/tests/member-lifecycle.spec.ts` then full `npm test`; `git diff --check`. Behavior-equivalence check: no `expect` bodies change, only imports.

# types.ts barrel split mapping

`types.ts` = 1220 lines, 112 exported interfaces. Physical split with the existing path as a pure re-export barrel (no public import path changes):

| New file | Contents (approx. line ranges today) |
| --- | --- |
| `types/actors.ts` | actors, human/member identity (~40–115) |
| `types/entities.ts` | Channel/Member/Message/Task/Thread/Claim/Inbox/Activity (~117–310) |
| `types/operations.ts` | all `*Operation` records (~312–550) |
| `types/requests.ts` | all request types (~555–900) |
| `types/results.ts` | results + inbox/view/changes/status (~898–1220) |

Constraint: `types.ts` keeps `export type { ... } from './types/*.ts'` re-exports only; the `@wowyuarm/dsh-agent-team/types` subpath and generated facades keep resolving. Regenerate typert + run `sync-paths.mjs` after the move (facade maps source paths). Circular-import risk: entities ↔ operations is the one likely cycle (operations embed entity snapshots); resolve by keeping shared sub-objects (e.g. stored message) in `entities.ts` and having `operations.ts` import from it — one direction only.
