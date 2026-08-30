# Thermo round 2 cleanup

- Status: executed 2026-08-28 in a worktree, squashed onto master 2026-08-29 as six commits.
- Scope: second quality round informed by the sibling Harness engineering standards (AGENTS.md, development.md, testing.md, defensive-patterns.md) and the thermo-nuclear review skill. Successor to the closed 2026-08-28 audit (`.scratch/archive/2026-08/agent-team-quality-audit/`).
- Method: hygiene sweep + Host/Client package reviews + full `ledger.ts` read; every finding was re-verified against source before implementation. Two review claims failed verification and were dropped (see "Retrained findings").

## Implemented

- `fix: run typert generation from the invoking checkout` — `generate:typert` no longer hardcodes the sibling checkout name `../dsh-agent-team`; it resolves its own repo, so worktrees work.
- `fix: reserve the attachment sidecar name in payload sanitization` — an upload named `meta.json` used to be clobbered by the metadata sidecar and become permanently unreadable; `attachments.ts` also owns the payload layout now (`attachmentPayloadPath`).
- `refactor: simplify host member runtime and ledger dispatch` — the three runtime-error maps merged into one per-Member slot record with the same read precedence (keyed by Member, so restarted Sessions cannot leak stale keys); `sendMessageAs`/`replyAs` plus `humanCall`/`memberCall` fences replace the Human/ForAgent wrapper pairs; `assertUnhandledKind` guards `changeScopesOf`, `touchedThreadRefs`, `validateOperation`, and `applyTo` while `attentionDelta` is shape-based (`'inbox' in data`), so a new operation kind fails compilation instead of silently skipping validation or inbox deltas; `threadForActor` + `deferredThreadWrite` replace three copies of the unread/stale-revision preamble; `committedMessageResult` merges the two result builders; `disposeMemberSession` replaces the suspend/remove cleanup pair.
- `refactor: share client transport and rendering helpers` — `requests.ts` (`mintRequestId`, `uploadComposerFiles`), `hostTaskRefLookup` and `jumpToTaskThread` in `task-refs.ts` kill the byte-identical `lookupTaskRefs` copies and the duplicated upload loops; `planMessageBody` in `team-formatters.ts` resolves the display body, the inline/literal/markdown branch, fallback rows, and literal Task refs while `TeamMessage` keeps only DOM post-processing; two leftover `console.log('DBG …')` calls removed.
- `chore: add a jscpd duplication gate` — `npm run duplication`, harness-style config with `threshold: 1` (ratchet; currently 0.81%).

Checks after the squash: `npm run typecheck`, `npm test` (208 passed after the compaction-heal merge), `npm run lint` (0/0), `npm run duplication`, and `npm run test:browser` (full assembled journey + screenshot inspection at desktop and 390×844) all pass.

## Reviewed and retained (with reasons)

- **`useStableRequest` hook (review finding F2).** The six idempotent-request sites are not gratuitously inconsistent: the agents-panel pending request participates in rendering (the retry button), the editor dialogs invalidate on input edits, and the channelRefs comparison is set-shaped. A shared hook with per-site predicates would move complexity, not delete it.
- **Thread timeline chunking unification (F1).** `chunkRunsWithDays` cannot absorb the Thread page's unread-boundary injection without extending its closed block union and shifting day-separator key semantics that tests pin.
- **"Dead types" retraction.** `AgentTeamStoredThreadReadFact`/`AgentTeamStoredThreadFact` are the durable form of the thread-read operation `facts` field (normalized on load); `AgentTeamClientMember` builds `AgentTeamClientMemberStatus`. Not dead.
- **Member row / presence variants, roster store, member-session locale strings.** Visible-behavior or state-ownership decisions that belong to the operator; listed under Deferred.

## Deferred

- **Ledger decomposition** (audit-deferred, unchanged): `validateOperation` per-kind private validators and extraction of pure projection helpers (~400 lines) to a sibling module — separately scoped, behavior-locked round.
- **knip hygiene gate**: needs the entrypoint allowlist proof the prior audit demanded (`packages/*/src/index.ts`, `lib` entries, scripts).
- **Coverage report** (non-gating), JSDoc fill toward a lint-enforced floor, FIXME/TODO/XXX urgency tags (no markers exist today).
- **jscpd ratchet**: lower `threshold` as clones disappear. Known clones (2026-08-28): ledger inbox-from builders (distinct semantics), Channel/Thread send-call and day-render pairs (test-pinned JSX), editor save flows (F2 rationale), avatar/presence dot pair, `scripts/team-ui.*` preview scaffolding.
