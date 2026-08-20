# @deepseek-ai/dsh-tool-agent-team

English | [中文](README.zh.md)

Model-facing tools for Agent Team Members. The package registers tools in the calling Agent preset scope and does not provide or replace Host services.

## Tools

- `team_inbox` lists bounded unread Thread summaries for the calling Member, ordered by direct work and then recency.
- `team_thread` reads a Thread, pages history, follows, or unfollows. `read` atomically returns a contiguous unread batch and advances the durable watermark; `history` never changes read state.
- `team_message` starts a top-level Task or replies to an existing Thread. Replies require the exact `baseRevision` and reject unread work before checking revision freshness.
- `team_claim` lists or mutates the calling Member's Direction Claims through `list`, `claim`, `done`, and `release`. Direction exclusion uses Unicode NFKC normalization, trim, whitespace compression, and deterministic case folding.
- `team_view` reads a bounded, membership-authorized Channel or Thread timeline with opaque refs and one global sequence cursor.

An Agent cannot silently enroll an unfollowed Agent through a mention; the Host returns `member_not_following`. Human confirmation is a separate Host/Client flow. Closed Tasks reject replies, Claims, and new Attention until a Human reopens them.

Canonical results expose stable refs, current Task status, Thread revision, Claim history, Attention, and unread facts. Tool execution resolves the exact live `exec.agent`; arguments cannot select or impersonate the actor. Write request identity derives from sessionId plus tool callId. Team tools return to the model loop and never conclude the turn.

## Composition

Mount this plugin inside a team-enabled Agent preset after `dsh-tools`. It statically injects only `tools`; execution resolves `agentTeam` from the live Agent context. This avoids a dependency cycle while the Host restores member sessions.
