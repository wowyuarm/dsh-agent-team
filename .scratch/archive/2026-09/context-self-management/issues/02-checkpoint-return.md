# 02 — Checkpoint selection and return

**What to build:** A Team Member can create a semantic checkpoint, inspect a short structural timeline including delivered Team boundaries, select an opaque checkpoint, and continue from that completed-turn prefix with a handoff that reconciles later external effects.
**Blocked by:** 01 — fresh context continuation
**Status:** complete

Confirmed design: [`../spec.md`](../spec.md)

## Product demonstration

1. Before a noisy branch, the model calls `context_checkpoint({ name })`.
2. The checkpoint turn closes and a quiet continuation starts the next turn without Human input.
3. After the branch proves unhelpful, `context_timeline` shows the named anchor, expected retained/discarded context, and affected Threads.
4. The model calls `new_context({ checkpointRef, handoff })`.
5. The same Member continues in a child context containing the exact prefix through that checkpoint plus the handoff; current files/Team/external state remain unchanged.

## Required behavior

- [x] Add `context_checkpoint` and `context_timeline` only to Team Member composition, completing the three-tool interface from the specification.
- [x] Use one host-only Session projection as the sole checkpoint/intent read model. It must fold successful tool pairs, structured Team context notices, Team tool results, handoff/compaction sources, turn ends, and checkpoint-continuation delivery.
- [x] Failed, dangling, malformed, mismatched, or inherited historical intent never becomes a pending side effect.
- [x] A successful explicit checkpoint result concludes its turn. Only after that result is appended may the Host enqueue a quiet next-turn follow-up.
- [x] Resolve the checkpoint to the containing completed `turn/end`. If a sibling call shares the step, the checkpoint contains every model-order result from that step.
- [x] On replay, repair a missing quiet follow-up exactly once and never duplicate one already present/delivered.
- [x] Treat Team semantic facts as checkpoint candidates only after they enter model context: successful claim-state Team tool results or structured notification delivery first, then the containing turn end.
- [x] Never interpret a Team ledger sequence as a Session fork sequence. A fact not delivered to this Member is not a conversation checkpoint.
- [x] Make `context_timeline` bounded (default 12 with a small maximum), structural rather than transcript-bearing, and ordered across the current generation plus a bounded ancestor lineage.
- [x] Return opaque stable refs, semantic labels/source, approximate retained/discarded tokens, affected active Threads, restorable state, and a concise rejection reason.
- [x] Cold-read archived ancestors through public Session persistence and fold the same projection definition; do not add a second checkpoint store or global Session-query model tools.
- [x] In checkpoint mode, create a child from the exact contiguous balanced event prefix through the selected completed turn. Set `isSeeded`, exact inherited count, and parent to the actual seed source.
- [x] Keep previous-active continuity separate from seed-source lineage in the rollover operation. The previous active Session is archived even when the seed came from an older ancestor.
- [x] Put the handoff after the inherited prefix as the first own model-facing context.
- [x] Use inherited-event count to keep historical `new_context` results and checkpoint follow-ups inert in a seeded child while preserving inherited checkpoint history.
- [x] Reject unresolved, stale, foreign-lineage, open-turn, oversized, or nonshrinking targets.
- [x] Fail closed when single-Thread coverage cannot be proven. With multiple active Claims, require a fresh handoff covering them rather than guessing that a rewind is safe.
- [x] Return-to-checkpoint never modifies files, Git, jobs, browser state, Team ledger facts, tickets, databases, or remote side effects; guidance and result text must say so plainly.
- [x] Do not implement arbitrary-message checkout, full Session-tree UI, sibling-branch navigation, or return-to-future.

## Handoff requirement for a return

The model-authored handoff must bridge facts discovered after the selected checkpoint, especially current external state. It remains one prose value and should cover objective/active Claims, verified evidence, inferences/conflicts, external side effects and verification, and the next action. The Host adds identifiers and source metadata but does not rewrite the prose.

## Discriminating verification

- [x] Checkpoint tool/result and anchor occupy turn N; quiet follow-up enters turn N+1.
- [x] Compare against equivalent ordinary tool continuation and prove checkpointing does not add an extra model request beyond that continuation.
- [x] Render/finalize/result failure leaves no checkpoint and no quiet follow-up.
- [x] Crash after result but before follow-up repairs once; existing follow-up is not replayed.
- [x] One test includes sibling calls and proves exact turn boundary and result ordering.
- [x] Team mention/claim/accept candidate appears only after structured delivery and completed turn; offline-undelivered ledger fact does not appear.
- [x] Timeline caps output, resolves duplicate human labels through opaque refs, and marks invalid/expensive targets rather than silently choosing.
- [x] Exact seed ends on selected `turn/end`, excludes every later event, and contains no open step/turn or dangling tool call.
- [x] Seeded child does not reschedule any inherited historical rollover intent.
- [x] Archived-ancestor return uses the source ancestor as parent while recording a different previous-active Session.
- [x] Oversized/nonshrinking target and ambiguous multi-Claim coverage reject without lifecycle mutation.
- [x] A fixture with checkpoint-later file changes proves no filesystem mutation occurs and the later-state handoff reaches the new context.
- [x] Targeted projection/tool/lifecycle tests, typecheck, build, lint, and `git diff --check` pass.
