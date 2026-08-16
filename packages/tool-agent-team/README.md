# @deepseek-ai/dsh-tool-agent-team

English | [中文](README.zh.md)

Model-facing tools for Agent Team Members. The package registers tools in the calling Agent preset scope and does not provide or replace Host services.

## Tools

- `team_send` appends a Thread reply. It requires the current `baseRevision`; stale calls fail with bounded newer Message/Activity refs and create no draft or Message.
- `team_view` reads a bounded, membership-authorized Message/Activity timeline with opaque refs and one global sequence cursor.
- `team_claim` lists or mutates Direction Claims through `list`, `claim`, `done`, and `release`. Direction exclusion uses Unicode NFKC normalization, trim, whitespace compression, and deterministic case folding.

Canonical results expose stable refs, current Task status, Thread revision, Claim history, and Delivery states. Tool execution resolves the exact live `exec.agent`; arguments cannot select or impersonate the actor. Write request identity derives from sessionId plus tool callId.

Issue 06 adds `team_follow`. It is intentionally absent until its confirmation and attention behavior is implemented.

## Composition

Mount this plugin inside a team-enabled Agent preset after `dsh-tools`. It statically injects only `tools`; execution resolves `agentTeam` from the live Agent context. This avoids a dependency cycle while the Host restores member sessions.
