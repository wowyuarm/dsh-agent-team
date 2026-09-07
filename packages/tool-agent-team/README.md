# @wowyuarm/dsh-agent-team/tools

English | [中文](README.zh.md)

Model-facing tools for Agent Team Members. The package registers tools in the calling Agent preset scope and does not provide or replace Host services.

## Tools

- `team_inbox` lists bounded unread Thread summaries for the calling Member, ordered by direct work and then recency; Task status/number appear only where the Thread has a real Task overlay.
- `team_thread` reads a Thread, pages history, follows, or unfollows. `threadRef` is primary; a `taskRef` is a Host alias only for released task-only Clients. `read` atomically returns the Thread anchor, optional current Task and Claim snapshot, bounded orientation facts, and one contiguous unread batch while advancing the durable watermark; `history` never changes read state. Activity facts render structured — actor, Task ref, and the Claim refs each activity claimed, completed, accepted, or released — and the header states the Task's status/resolution on taskful Threads. A read that acknowledges an unread acceptance of a still-done Task carries one `contextAdvice` block (usage, route budgets, the `min(128_000, handoffAt)` Task-boundary threshold, and one keep/rollover/handoff-now action); it is advisory only and degrades to an explicit `unavailable` line when measurement fails.
- `team_message` starts a top-level Thread or replies to an existing Thread. It defaults to a taskless Thread; pass `asTask: true` for atomic Task creation. Replies require the exact `baseRevision` and reject unread work before checking revision freshness.
- `team_claim` lists or mutates the calling Member's Direction Claims through `list`, `claim`, `done`, and `release`; it applies only to real Tasks. Direction exclusion uses Unicode NFKC normalization, trim, whitespace compression, and deterministic case folding.
- `team_view` discovers bounded, membership-authorized Channel, top-level Thread, Task, and Member summaries. Thread entries carry refs, revision, message count, and Task status where applicable; it does not return Thread messages or activities.
- `context_rollover` schedules one rollover of the calling Member into a fresh context. The tool validates the bounded private `handoff` (plus optional `relatedFiles`, or a `checkpointRef` to return to a recorded checkpoint instead) against the Host, concludes the turn, and returns `status: 'scheduled'`; the Host performs the actual swap only after the successful tool result is durably appended. A `checkpointRef` that cannot succeed now — fabricated, unresolved, unattributable, nonshrinking, unmeasurable, over-budget, or blocked by multiple active Claims — rejects as a model-visible error result instead of a fake `scheduled`; the mutable guards (jobs, route limits) are revalidated at the swap seam, and a seam failure leaves the Member recoverable through a later-turn fresh rollover. `context_rollover` and `context_checkpoint` both conclude the Agent turn.
- `context_checkpoint` records one named checkpoint of the calling Member's current context. The durable checkpoint is the successful `tool/call`+`tool/result` pair the Session projection folds; the returned ref is deterministic from the Member Session identity plus the tool call id. It performs no lifecycle side effect in the tool body and concludes the turn: a checkpoint resolves at its containing turn's end, so the model records it as its final action of a completed unit of work.
- `context_timeline` returns one bounded structural view of the Member's context generations across the current Session and its archived ancestor lineage: recorded checkpoints and handoff/Team/compaction boundaries, with restorability reasons where a return cannot be proven safe. Structural only — no transcript content.

An Agent cannot silently enroll an unfollowed Agent through a mention; the Host returns `member_not_following`. Human confirmation is a separate Host/Client flow. Closed Tasks reject replies, Claims, and new Attention until a Human reopens them; taskless Threads have no Claim or Task-resolution mutation path.

Canonical results expose stable refs, optional Task status, Thread revision, Claim history, Attention, and unread facts. Typed `unread_required` and `stale_revision` results include the fields needed to reread and retry deliberately. Tool execution resolves the exact live `exec.agent`; arguments cannot select or impersonate the actor or Workspace. Write request identity derives from sessionId plus tool callId. `context_rollover` and `context_checkpoint` conclude the Agent turn (a rollover must not be followed by old-generation work, and a checkpoint resolves at its containing turn's end); every other Team tool returns to the model loop.

The complete implemented protocol is documented in [`../../docs/team-collaboration.md`](../../docs/team-collaboration.md).

## Composition

Mount this plugin inside a team-enabled Agent preset after `dsh-tools`. It statically injects only `tools`; execution resolves `agentTeam` from the live Agent context. This avoids a dependency cycle while the Host restores member sessions.
