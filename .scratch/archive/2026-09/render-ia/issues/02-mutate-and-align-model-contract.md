# 02 — Make mutations explicit and align the whole model contract

**What to build:** After reading current Thread facts, a model can make a Message or Claim mutation, immediately distinguish commit from rejection, continue safely from a committed result, and receive one consistent workflow across tool descriptions, parameter guidance, preset narration, and maintained documentation.
**Blocked by:** 01 — Turn discovery and Thread reading into one safe path
**Status:** complete

## Context and fixed boundaries

This ticket completes the approved five-tool interface after the discovery/read path is implemented. Keep Host mutation ordering, compare-and-swap behavior, unread gate, authorization, idempotency, mentions/invitations, Claim ownership, Task transitions, structured diagnostic fields, tool inputs, and Human UI. Do not add automatic retry, force-send, hidden session-local revision state, a new token type, or a new renderer module hierarchy.

A committed public mutation returns resulting Thread state and is a valid basis for an explicitly deliberate chained mutation, so its model render hands off one opaque `baseRevision`. A typed rejection does not return the changed facts and is not a valid write basis; it must route through `team_thread read` and must not render a numeric revision or token.

- [x] `team_message start` renders `Committed — Thread created`; `reply` renders `Committed — reply added`; each names Message/Thread/optional Task refs and exactly one separately labelled next-write `baseRevision` hand-off.
- [x] `team_message dm` distinguishes delivered from durable-recorded-but-not-delivered, includes recipient identity and delivery note, and warns that recorded-only delivery has no automatic redelivery and must not be blindly duplicated.
- [x] Every Message typed rejection begins `Not committed`, names only action-local recovery facts, and states the actual non-effect; `unread_required` carries Thread/optional Task refs plus exact unread/direct counts and read recovery, `stale_revision` says the Thread changed and requires read/reconsider, and `member_not_following` gives Human-invitation or retry-without-mention routes.
- [x] No rejection render contains supplied/current numeric revision, a `baseRevision` hand-off, or an unrelated Thread/roster snapshot; canonical structured diagnostic fields remain compatible.
- [x] `team_claim list` renders Task/Thread identity, current status, active Claims only, or explicit `No active Claims`; it contains no revision-labelled field or write token because a current Thread read remains the mutation basis.
- [x] Claim mutation success names the requested action—created, completed, or released—renders the authoritative affected Claim first, then resulting Task/Thread standing and exactly one next-write hand-off.
- [x] Preserve the affected Claim returned by the Host rather than inferring it from a post-mutation list; mutation output contains no full Claim archive or unrelated historical Claim sentinel.
- [x] Claim typed rejections follow the shared outcome-first recovery form and append no Claim snapshot, numeric revision, or write token.
- [x] Use one local typed-rejection formatter parameterized by mutation noun plus the already-earned identity/Claim formatters; delete the unreachable generic Message-render fallback without introducing a registry, class hierarchy, new package seam, or compatibility adapter.
- [x] The `baseRevision` parameter description tells the model to copy the explicitly rendered next-write value verbatim and never increment, derive, compare, or cite it. Mutation tool descriptions say to read first and accurately distinguish actions, side effects, commit, and rejection.
- [x] Normalize the Team Member preset to one cross-tool workflow: discover → read until clear → copy the returned token into one deliberate public mutation; rejection → read and reconsider. Keep trust/routing/collaboration policy in the preset, per-action mechanics in tool descriptions/parameters, and current outcomes in renders.
- [x] Reconcile the package README, maintained bilingual collaboration contract, and CHANGELOG with all five final tool renders, including narrow token visibility; remove stale claims that revision is ambient directory/history content or that shared pagination covers non-Thread rows.
- [x] Discriminating tests cover action-named start/reply and claim/create/done/release success, authoritative affected Claim identity, exactly-one token after commit, no token/revision label on list or rejection, recovery fields, snapshot absence, DM delivery branches, and description/preset/render vocabulary consistency.
- [x] Existing integration tests continue to prove unread-before-stale ordering, Host revision fencing, atomic rejection, authorization, watermark, taskless discovery, and late-joiner visibility; generated Host/Remote artifacts show no diff.
- [x] Run the complete affected render/lifecycle suite, package typecheck, lint, documentation/link checks, and diff hygiene. Mark both implementation tickets complete and deliver the cumulative change before requesting Reeve or Cole review; do not ask for per-ticket review.
