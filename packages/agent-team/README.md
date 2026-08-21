# @wowyuarm/dsh-agent-team

English | [中文](README.zh.md)

The Host capability for one Agent Team in a dshHome. `ctx.agentTeam` owns the append-only operation ledger, reconstructs the current collaboration projection, and is the lifecycle owner for member Agents managed by the same capability. Thread Attention and the Member Inbox are durable Host projections. When unread state changes, this package sends one coalesced, body-free hint through the Agent's public safe-boundary API; it never interrupts an active request or acts as a Session delivery worker. The [Agent Team architecture note](../../../.agents/notes/proposed/architecture/2026-08-15-agent-team-operation-ledger.md) owns the persistence and package-topology decisions.

## Service contract

The Service consumes `ctx.storageDomain`, `ctx.workspaceRegistry`, `ctx.agents`, `ctx.agentDefaultModel`, `ctx.agentPresets`, `ctx.tools`, `ctx.sessions`, and `ctx.sessionPersistence`. It opens the versioned `agent_team` Domain before Cordis publishes `ctx.agentTeam`. The first boot appends one `team/initialized` operation for the stable Human Member; later boots replay the same operation and do not append another record.

`status()` returns the current durable sequence, operation count, channel count, Agent Member count, and Human Member ref. It performs no model request and no storage write. `validateLedger()` checks the package-owned projection against the durable operation table.

Every operation record carries a positive global sequence, unique operation and request ids, an actor snapshot, and the previous operation id. Replay rejects invalid record fields, table-key/id mismatches, sequence gaps, broken previous links, repeated ids, and invalid state transitions. An identical request-id retry returns the original receipt; a changed payload with the same request id rejects.

## Durability and lifecycle

`storage-domain` validates every record at the durable read boundary and rejects a backend unit stamped with another version. The Team updates its projection only after `KvTable.put()` resolves. Its Fiber owns the Domain handle; disposal rejects new Service calls through Cordis removal, drains accepted Domain writes, and closes the backend unit before the name can reopen.

Member creation commits one stable Member/session/Workspace/preset/private-memory identity before unpublished Agent setup. Setup mounts the selected preset and validates its marked `team_message` plus all five Team tools before publication. Failure leaves only that Member unavailable. Suspend waits for the owned `AgentHandle` to stop; resume and Host remount restore the exact persisted session.

Every team-managed session records `danger-full-access`. Project cwd remains the Workspace path, while private memory lives under `$DSH_HOME/agent-team/members/<memberId>/`. An untitled Member session is named with its handle through the session-title service, so the ordinary Session list shows the Member identity; an explicit rename or any earlier title always wins. The isolated `team-member` preset also provides coding tools including model-facing web search, Workspace instruction discovery, and Team protocol guidance. The host owns the shared Web service and provider; the preset mounts only the model-facing web tool. Its lowercase `memory.md` is a bounded 8 KiB reference index, injected only for that Member when its content changes; `notes/` stays on-demand through filesystem tools. Over-budget indexes receive a maintenance warning, not silent truncation. Ordinary sessions and forks receive no Team identity or private-memory context.

Adding a Member to a Channel grants future read/send/claim authority but injects no historical Messages into the member session. Thread Attention starts when a Task is created, a Claim is created, a member follows, or a Human confirms an invitation. Ordinary unread is derived from Attention; structured mentions create durable direct markers. `team_inbox` and Thread reads are Host projections, not Session inbox contents. An enabled Member receives only a fixed prompt to inspect `team_inbox`; the prompt carries no Thread body. Pending hints are coalesced, ignored hints do not loop, and resume/error recovery derives a new hint from durable unread state.

Member replies require the exact current Thread revision and atomically update Message and Thread facts. Unread work must be read before a mutation; stale revisions are rejected after that unread gate. A closed Task rejects replies and new Attention; reopening restores the Task without restoring prior Attention. A Human mention of an unfollowed Agent requires a process-local, one-use confirmation token before any operation is committed. Claim/done/release and Task changes are ordered host-authored Activities. Active Claims exclude only the same normalized Direction; different Directions can run concurrently. Task state is derived from Claims unless Human acceptance or closure overrides it. Close releases active Claims and clears Thread Attention atomically. Member removal marks the member inactive, releases owned active Claims, clears its Attention and direct markers, and archives the session after the durable commit. Message and Activity facts share one bounded sequence cursor.

`changes()` is the Client invalidation stream. Each request declares one optional `scope` — workspace, channel, or thread — plus an abortable transport signal; a committed operation wakes only waiters whose scope matches the scopes derived from that operation (member lifecycle and presence wake their Workspace; content operations wake their Channel and Thread). A Thread read commits durably but derives no scope, because it advances only the reader's private watermark. After each commit the Host notifies only the Members whose Inbox projection the operation can have changed — the operation's Attention/marker delta plus current followers of the touched Threads — never every live Agent.

M1 supports one Host writer. The ledger is permanent and has no snapshot or compaction path.

## Composition

The bundle consumes the Host's existing singleton providers; it does not mount replacements for `agents`, default model selection, `tools`, `fs`, `sandboxPolicy`, Session store/persistence, Workspace registry, or storage. Load those Host services once, then mount this Service and its invariant companion. The Team Web Client is the only Human control surface.

A team-enabled preset registers the five tools in its own agent scope and marks the `team_message` definition with `markAgentTeamPreset()`. Preset rows must resolve `ctx.agentTeam` when executing, not statically inject it: the Host mounts member presets while it restores Members during its own activation, so a row that declares `agentTeam` as a dependency cannot activate and fails every startup restore. Duplicate scoped tool names fail during unpublished setup and make only that Member unavailable. Duplicate Host service providers remain a composition error and should be removed rather than layered.

## Model Experience

### Host collaboration state

#### What the model sees

An enabled Member may receive one fixed, body-free Inbox hint after durable unread work appears: `Team Inbox has unread work. Use team_inbox to triage it, then team_thread to read the relevant Thread.` The hint is queued at the Agent's safe step boundary, so active model requests and tools are not interrupted. The model must use Team tools to read facts; no Thread body is injected. Model-facing Agent Team Consumers own the tools and protocol.

#### Token effect

The ledger, projection, and Human status reads add no model tokens.

#### KV Cache effect

The Host ledger and Human status reads do not alter model requests or cache reuse.

## Known Limitations and Deferred Work

- **Single Host writer** — concurrent processes over one dshHome are unsupported; operation serialization is process-local.
- **Permanent ledger** — M1 provides neither snapshots nor compaction, so storage grows with committed collaboration facts.
- **No remote provider seam** — the package combines the capability definition and its only implementation until a real remote Consumer requires another Provider.
- **DSH rc.8 SQLite only** — SQLite Session persistence uses the rc.8 schema. Delete old Session databases and create new Member sessions; this package provides no migration, compatibility read, or fallback.
