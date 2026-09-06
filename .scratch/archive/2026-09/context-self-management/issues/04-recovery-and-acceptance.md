# 04 — Recovery hardening and product acceptance

**What to build:** Context management survives every meaningful crash/input/job race, current documentation describes the shipped behavior, and the real Team Web experience proves seamless Member continuity without Session-management UI.
**Blocked by:** 01, 02, 03
**Status:** complete

Confirmed design: [`../spec.md`](../spec.md)

## Product demonstration

A long-running Member can checkpoint, return, roll fresh, and hit hard fallback while receiving Team work, owning jobs, restarting the Host, and being viewed in the browser. After every supported interruption there is one durable current Member binding, no lost direct input, no duplicated Team work, preserved old logs, and a clear recoverable state on terminal failure.

## Recovery behavior

- [x] Replay a successful checkpoint result whose quiet follow-up was not delivered; deliver it exactly once.
- [x] Replay a successful `new_context` result before ledger commit; derive the same request/new Session identity and complete once.
- [x] Recover after rollover ledger commit but before old-Agent disposal/archive.
- [x] Recover after old-Agent disposal/archive but before new-Agent creation.
- [x] Recover when the new Session exists but its handoff/activation did not finish.
- [x] Reconstruct private handoff and seed instructions from the old Session pointer recorded in the operation; never treat a missing new artifact as an ordinary blank Member Session.
- [x] Make dispose, archive, create/resume detection, tracker cleanup, and notification reset idempotent at their actual seams.
- [x] Preserve one recoverable durable binding and both logs on every failure. Never synthesize success.

## Inbox and concurrency behavior

- [x] Fold post-intent durable inbox splices so messages removed by the admission gate remain reconstructible after a crash; do not depend on a process-only carry array.
- [x] Capture both queued next-turn work at turn-stopping and already-claimed messages seen by a racing pre-step.
- [x] Never append inbox mutations reentrantly from a Session event observer.
- [x] Dedupe carried input by stable message ID.
- [x] Preserve non-Team direct/plugin input exactly and in order behind the handoff.
- [x] Remove stale Team Inbox/recovery/progress notices from carried input and rederive current unread Team facts from the ledger after activation.
- [x] A Team commit racing after the old gate closes is delivered from current ledger state to the new Agent, not lost or delivered twice.
- [x] Lifecycle serialization prevents two rollover intents or rollover/recovery/archive work from producing two live Agents.

## Job behavior

- [x] Normal fresh or checkpoint rollover rejects while the old Agent owns any non-terminal job.
- [x] Normal rollover also rejects terminal-but-unreported output that would disappear with owner disposal.
- [x] The rejection names the jobs and directs the model to collect/stop them before retrying.
- [x] Hard compaction remains in place and preserves both running and unreported terminal jobs.
- [x] A job settling concurrently with validation is rechecked at the lifecycle commit seam.

## Seed and lineage behavior

- [x] A seeded child preserves inherited checkpoints as history but never re-executes inherited lifecycle intent or follow-up repair.
- [x] Cold ancestor inspection is immutable and the selected completed-turn prefix is revalidated before create.
- [x] Current Member config/private memory is used for the child even when its seed source is an older generation.
- [x] Previous-active continuity and seed parent lineage stay distinguishable through replay and Client refresh.

## Maintained documentation

After behavior and tests exist:

- [x] Update the maintained domain model with Context Generation, Context Checkpoint, Context Handoff, and conversation-only return semantics.
- [x] Update architecture documentation with the Host coordinator, authority split, lifecycle ordering, Team-only tool seam, pressure ownership, and Client live-follow behavior.
- [x] Update affected package READMEs/tool lists and remove claims that accepted-Task auto compaction or visible clear-context is current behavior.
- [x] Keep `.scratch` historical; do not cite it as shipped authority.
- [x] Confirm the adjacent DeepSeek Harness checkout has no modifications.

## Full acceptance matrix

- [x] Run all targeted projection, tools, ledger, lifecycle, pressure, notification, integration, and Client tests from tickets 01–03.
- [x] Run `npm run typecheck`.
- [x] Run `npm test`.
- [x] Run `npm run build`.
- [x] Run `npm run lint`.
- [x] Run `npm pack --dry-run` when exports/published contents changed.
- [x] Run `git diff --check`.
- [x] Run the real `npm run test:browser` journey because Client bundle/navigation/visible controls changed.
- [x] Inspect desktop 1440×960 and mobile 390×844 screenshots for Member continuity, removed action, loading/error/empty states, keyboard/focus behavior, and ordinary DSH restoration.
- [x] Keep routine browser artifacts ignored; copy only Human-approved milestone evidence into validation.

## Independent review gates

Reeve will not recommend acceptance unless all are demonstrated:

- [x] No DeepSeek Harness edit or private Harness subpath dependency.
- [x] One authority per fact: ledger binding, Session context history, inbox projection, and process locks are not duplicated.
- [x] No lifecycle/follow-up side effect outruns successful tool-result durability.
- [x] Every checkpoint seed is a balanced completed-turn prefix.
- [x] Fresh rollover copies no old context.
- [x] No later direct input is lost in turn-stopping/pre-step races.
- [x] No inherited intent fires in a seeded child.
- [x] Known-over-limit requests fail closed after fallback failure.
- [x] Checkpoint return is rejected when it cannot materially shrink safely.
- [x] Context return never claims to revert external state.
- [x] The product stays Member-first: one row, automatic live follow, archived logs, no obsolete clear-context action.

## Delivery report

- [x] Tars posts commit SHA(s), owned file list, exact commands/results, inspected screenshot paths, any spec deviation, remaining limitations, and confirmation of no Harness changes.
- [x] Reeve performs independent commit review and reports separate Standards and Spec verdicts with evidence.
- [x] Human accepts the implementation before the Task is closed and this work item is archived.
