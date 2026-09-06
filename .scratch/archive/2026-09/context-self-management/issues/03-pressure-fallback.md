# 03 — Context pressure and hard fallback

**What to build:** A Team Member receives one proactive handoff notice near 200K, normally rolls to a fresh context itself, and is automatically compacted in place before an unsafe request at the 256K product ceiling or a lower route-safe limit.
**Blocked by:** 01 — fresh context continuation
**Status:** complete

Confirmed design: [`../spec.md`](../spec.md)

## Product demonstration

- Below the handoff threshold, no context-management noise appears.
- At the effective handoff threshold, one short notice tells the model its measured budget, active work, job state, and fresh-by-default next action.
- If the model uses `new_context`, the fresh continuation from ticket 01 runs.
- If the model ignores the notice, the Host compacts the current Session before forwarding a request at the effective hard limit.
- If the provider reports context overflow earlier, the same recovery implementation compacts and retries once.

## Required behavior

- [x] Define a 256,000-token product maximum and 200,000-token preferred handoff point, both clamped by routed model capacity and explicit safety reserves.
- [x] Treat `>=` as crossing a threshold. A smaller route lowers both thresholds; a missing route capacity produces an explicit diagnostic/fallback rather than an accidental unlimited policy.
- [x] Resolve current pressure from the public token-meter/model-info seams. Do not use declared output `maxTokens` as the only safety reserve proxy.
- [x] Send at most one pressure notice per context generation until a successful fallback/rearm event. The notice itself must fit inside the reserved space.
- [x] Keep the notice concise and structured, with current/effective limits, active Claims, owner job state, fresh-by-default guidance, and optional timeline guidance only when an earlier checkpoint is genuinely useful.
- [x] Disable `compaction-basic.auto`. Agent Team owns both pre-step hard policy and request-error recovery while reusing the public CompactionEngine implementation.
- [x] Remove accepted-Task automatic compaction. Task acceptance is a semantic checkpoint/context-management cue, not an unconditional summarization job.
- [x] Encapsulate the Team hard-limit translation to forced CompactionEngine reduction in one coordinator method. Using the public `context-overflow` trigger is acceptable because Team policy declares the context overflowed; do not spread that semantic translation across callers.
- [x] At the hard pre-step seam, compact before forwarding the request. A no-op, thrown error, cancellation, or unchanged replacement generation must fail closed rather than knowingly submit over the Team limit.
- [x] Preserve the existing useful recovery rule: if pruning/replacement made durable surface progress before later summary failure, that progress may justify the single retry.
- [x] Bound provider-overflow recovery to one retry sequence and reset it only after a successful assistant response/idle convergence as appropriate.
- [x] Hard fallback stays in the same Agent/Session and must not cancel or discard background jobs.
- [x] Coordinate notice priority as `recovery > pending rollover/handoff > Inbox > progress nudge`; do not let competing automatic handlers depend on listener order.
- [x] After successful compaction, verify surface replacement advanced or measured pressure decreased before continuation; publish a clear context boundary source already understood by the timeline.

## Prompt behavior

Static Team Member guidance must distinguish semantic judgment from Host budget policy:

- model: decide checkpoint/fresh timing from the next working set;
- Host: issue the one-shot pressure warning and enforce the hard ceiling;
- model: normally use fresh `new_context` at pressure;
- Host: compact only as fallback;
- do not switch solely because work was delivered and is waiting for Human review.

## Discriminating verification

- [x] `< handoffAt` produces no notice or compaction.
- [x] `== handoffAt` produces one notice; later steps in the same generation do not spam it.
- [x] Successful fresh rollover starts a new notice generation.
- [x] `== hardLimit` compacts before the model request, including when routed capacity is far larger than 256K.
- [x] A route whose safe capacity is below 256K clamps hard and handoff thresholds.
- [x] Missing/changed routed model information is handled explicitly at the next pre-step.
- [x] Provider `CONTEXT_WINDOW_EXCEEDED` below estimated hard pressure compacts and retries once.
- [x] A second provider overflow in the same recovery sequence falls through without an unbounded loop.
- [x] Durable prune progress followed by summary failure receives exactly the allowed retry treatment.
- [x] Hard fallback no-op/failure blocks the known-unsafe request and leaves a recoverable Member error/log.
- [x] Running and terminal-unreported jobs remain intact through in-place hard compaction.
- [x] No `compaction-basic` automatic listener competes with the Team coordinator.
- [x] Task accept no longer schedules old standalone auto compaction and still appears as a checkpoint/context cue when delivered.
- [x] Notification arbitration tests cover recovery, rollover, Inbox, and progress nudge priority.
- [x] Targeted pressure/overflow/integration tests, typecheck, full tests, build, lint, and `git diff --check` pass.
