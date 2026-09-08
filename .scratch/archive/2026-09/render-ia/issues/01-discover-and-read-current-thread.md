# 01 — Turn discovery and Thread reading into one safe path

**What to build:** A model can discover a labelled newest-first Thread address, triage unread work, and read the selected Thread with action-specific orientation; only a fully drained current read hands off an opaque token for the next public mutation.
**Blocked by:** None — can start immediately
**Status:** complete

## Context and fixed boundaries

The Human approved the five-tool information architecture. This ticket is the first vertical path: `team_view` → optional `team_inbox` triage → `team_thread read`. Keep current Host authorization, Attention, ordering, watermarks, cursor mechanics, structured compatibility fields, tool inputs, and Human UI. Do not add a discovery scope, Inbox subject, search/filter, renderer registry, or parallel state.

The numeric Host revision is not Thread content. In model-visible text it is an opaque next-write token and may be handed off only by a current read with zero remaining unread. It must not appear as a revision-labelled field in directory, Inbox, Attention, or history output. Numeric fact sequences, read-through watermarks, and history cursors keep their own distinct labels.

- [x] `team_view` requests the existing top-level projection newest-first, renders labelled current Channels, one newest-first Thread page, and current Members on the first page; continuation pages render only the Thread page context.
- [x] Each directory Thread row contains Thread/Channel identity, optional inline Task ref/number/status, and one deterministically collapsed/truncated anchor subject; taskless Threads remain visible.
- [x] The rendered directory contains no separate Task index, message count, revision-labelled field, or write-token hand-off; existing structured compatibility data stays available.
- [x] `limit`, `cursor`, and `hasMore` are described and rendered only as Thread pagination, including explicit empty/exhausted states; repeated paging reaches every authorized taskless and taskful off-page Thread.
- [x] `team_inbox` preserves Host ordering, body-free bounded rows, total/per-row unread and direct counts including zero, and no-read semantics; it adds explicit header/footer/truncation/empty conclusions but no subject, body, revision label, or write token.
- [x] `team_thread status`, `follow`, and `unfollow` render only the requested Attention outcome, Thread/optional Task standing, and resulting follow state; supplied anchor, Claims, facts, revision label, and token sentinels are absent.
- [x] `team_thread read` renders outcome/current context, the correct orientation, active Claims, chronological facts, read watermark/remaining count, and any existing acceptance advice in a stable hierarchy.
- [x] Read orientation is discriminated from structured facts: anchor in facts renders once; otherwise any fact with positive `unread === false` adds the full anchor; otherwise continuation or unfollowed ad-hoc read uses the shared bounded subject. Manual-follow and durable-rollover fixtures use real Attention invariants; post-read watermark is never used to infer pre-read state.
- [x] Done/released Claims do not render as current read context, and unread/direct Activity markers are inline rather than followed by a separate ellipsis-only line.
- [x] A read with zero remaining unread renders exactly one `Next write — baseRevision: N (copy exactly; never derive or cite).` hand-off; a partial read renders none and tells the caller to continue reading.
- [x] `team_thread history` gives full-anchor orientation only on its first page, bounded-subject orientation on continuation, never duplicates an anchor selected as a fact, and renders only historical facts plus cursor/exhaustion—no current Claims, read effect/advice, revision label, or write token.
- [x] Tool/output descriptions for these three tools state their caller intent, side effects, pagination/action distinctions, and legal next action without contradicting the render; the relevant package and maintained bilingual collaboration prose is updated alongside behavior.
- [x] Render tests include both presence and absence assertions by field label/concept rather than rejecting arbitrary matching numbers; consolidate the repeated render-text test helper without creating a new public seam.
- [x] Narrow render tests, the discovery/read lifecycle path, package typecheck, lint, and documentation/link hygiene pass before marking this ticket complete.
