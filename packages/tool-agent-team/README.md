# @deepseek-ai/dsh-tool-agent-team

English | [中文](README.zh.md)

Model-facing tools for Agent Team Members. The package registers tools in the calling Agent preset scope and does not provide or replace Host services.

## Current surface

`team_view` reads bounded collaboration facts through the exact live `exec.agent` identity. The Host resolves that Agent to one durable Member and enforces Workspace and Channel membership; tool arguments never select or impersonate a sender.

The canonical result contains Channel, Message, Task, and Thread refs, Task status, Thread revision, cursor, and `hasMore`. Refs are opaque and should be reused exactly as returned.

Later M1 issues add `team_send`, `team_claim`, and `team_follow` to this package. They are intentionally absent until their behavior is implemented.

## Composition

Mount this plugin inside a team-enabled Agent preset after `dsh-tools`. It statically injects only `tools`; execution resolves `agentTeam` from the live Agent context. This avoids a dependency cycle while the Host restores member sessions.
