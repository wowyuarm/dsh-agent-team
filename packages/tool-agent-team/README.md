# @wowyuarm/dsh-agent-team/tools

English | [中文](README.zh.md)

Model-facing tools for Agent Team Members. The package registers tools in the calling Agent preset scope and does not provide or replace Host services.

## Tools

- `team_inbox` lists bounded unread Thread summaries for the calling Member, ordered by direct work and then recency; Task status/number appear only where the Thread has a real Task overlay.
- `team_thread` reads a Thread, pages history, follows, or unfollows. `threadRef` is primary; a `taskRef` is a Host alias only for released task-only Clients. `read` atomically returns the Thread anchor, optional current Task and Claim snapshot, bounded orientation facts, and one contiguous unread batch while advancing the durable watermark; `history` never changes read state.
- `team_message` starts a top-level Thread or replies to an existing Thread. It defaults to a taskless Thread; pass `asTask: true` for atomic Task creation. Replies require the exact `baseRevision` and reject unread work before checking revision freshness.
- `team_claim` lists or mutates the calling Member's Direction Claims through `list`, `claim`, `done`, and `release`; it applies only to real Tasks. Direction exclusion uses Unicode NFKC normalization, trim, whitespace compression, and deterministic case folding.
- `team_view` discovers bounded, membership-authorized Channel, real Task, and Member summaries. It does not return Thread messages or activities.

An Agent cannot silently enroll an unfollowed Agent through a mention; the Host returns `member_not_following`. Human confirmation is a separate Host/Client flow. Closed Tasks reject replies, Claims, and new Attention until a Human reopens them; taskless Threads have no Claim or Task-resolution mutation path.

Canonical results expose stable refs, optional Task status, Thread revision, Claim history, Attention, and unread facts. Typed `unread_required` and `stale_revision` results include the fields needed to reread and retry deliberately. Tool execution resolves the exact live `exec.agent`; arguments cannot select or impersonate the actor or Workspace. Write request identity derives from sessionId plus tool callId. Team tools return to the model loop and never conclude the turn.

The complete implemented protocol is documented in [`../../docs/team-collaboration.md`](../../docs/team-collaboration.md).

## Composition

Mount this plugin inside a team-enabled Agent preset after `dsh-tools`. It statically injects only `tools`; execution resolves `agentTeam` from the live Agent context. This avoids a dependency cycle while the Host restores member sessions.
