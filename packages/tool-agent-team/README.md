# @deepseek-ai/dsh-tool-agent-team

English | [中文](README.zh.md)

Model-facing tools for Agent Team Members. The package registers tools in the calling Agent preset scope and does not provide or replace Host services.

## Tools

- `team_send` appends a Thread reply. It requires the current `baseRevision`; stale calls fail with bounded newer Message/Activity refs and create no draft or Message.
- `team_view` reads a bounded, membership-authorized Message/Activity timeline with opaque refs and one global sequence cursor.
- `team_claim` lists or mutates Direction Claims through `list`, `claim`, `done`, and `release`. Direction exclusion uses Unicode NFKC normalization, trim, whitespace compression, and deterministic case folding.
- `team_follow` reads or changes the calling Member's own Follow state without changing Channel read/reply authority.

A structured mention of an unfollowed Member first returns `confirmation_required` without committing. Retry the same send with its process-local one-use `confirmationToken`; valid confirmation commits once and re-establishes Follow.

Canonical results expose stable refs, current Task status, Thread revision, Claim history, and Delivery states. Tool execution resolves the exact live `exec.agent`; arguments cannot select or impersonate the actor. Write request identity derives from sessionId plus tool callId.

## Composition

Mount this plugin inside a team-enabled Agent preset after `dsh-tools`. It statically injects only `tools`; execution resolves `agentTeam` from the live Agent context. This avoids a dependency cycle while the Host restores member sessions.
