# @deepseek-ai/dsh-agent-team

English | [中文](README.zh.md)

The Host capability for one Agent Team in a dshHome. `ctx.agentTeam` owns the append-only operation ledger, reconstructs the current collaboration projection, and is the lifecycle owner for member Agents and Delivery workers added by the same capability. The [Agent Team architecture note](../../../.agents/notes/proposed/architecture/2026-08-15-agent-team-operation-ledger.md) owns the persistence and package-topology decisions.

## Service contract

The Service consumes `ctx.storageDomain`, `ctx.workspaceRegistry`, `ctx.agents`, `ctx.agentDefaultModel`, `ctx.agentPresets`, `ctx.tools`, `ctx.sessions`, and `ctx.sessionPersistence`. It opens the versioned `agent_team` Domain before Cordis publishes `ctx.agentTeam`. The first boot appends one `team/initialized` operation for the stable Human Member; later boots replay the same operation and do not append another record.

`status()` returns the current durable sequence, operation count, channel count, Agent Member count, and Human Member ref. It performs no model request and no storage write. `validateLedger()` checks the package-owned projection against the durable operation table.

Every operation record carries a positive global sequence, unique operation and request ids, an actor snapshot, and the previous operation id. Replay rejects invalid record fields, table-key/id mismatches, sequence gaps, broken previous links, repeated ids, and invalid state transitions. An identical request-id retry returns the original receipt; a changed payload with the same request id rejects.

## Durability and lifecycle

`storage-domain` validates every record at the durable read boundary and rejects a backend unit stamped with another version. The Team updates its projection only after `KvTable.put()` resolves. Its Fiber owns the Domain handle; disposal rejects new Service calls through Cordis removal, drains accepted Domain writes, and closes the backend unit before the name can reopen.

Member creation commits one stable Member/session/Workspace/preset/private-memory identity before unpublished Agent setup. Setup mounts the selected preset and validates its marked `team_send` plus all four Team tools before publication. Failure leaves only that Member unavailable. Suspend waits for the owned `AgentHandle` to stop; resume and Host remount restore the exact persisted session.

Every team-managed session records `danger-full-access`. Project cwd remains the Workspace path, while private memory lives under `$DSH_HOME/agent-team/members/<memberId>/`. Ordinary sessions and forks receive no Team identity.

Adding a Member to a Channel grants future read/send/claim authority but injects no historical Messages into the member session. A structured mention is stored as one queued Delivery inside the Message operation with stable DeliveryId and MessageId. The Host sends a member-authored `agent-team-relay` to `next-step` with wakeup enabled, then commits `delivery-admitted` only after the target session contains matching `agent/inbox/spliced` or `user/message` evidence. Restart recovery reuses existing evidence or retries the same MessageId. Admitted means Inbox admission, not model processing.

Member replies require the exact current Thread revision and atomically update Message, Follow, Delivery, and Thread facts. Claim/done/release are ordered host-authored Activities. Active Claims exclude only the same normalized Direction; different Directions can run concurrently. Task state is `in_progress` while any Claim is active, `in_review` when no Claim is active and at least one is done, and otherwise `todo`. Message and Activity facts share one bounded sequence cursor.

M1 supports one Host writer. The ledger is permanent and has no snapshot or compaction path.

## Composition

The bundle consumes the Host's existing singleton providers; it does not mount replacements for `agents`, default model selection, `tools`, `fs`, `sandboxPolicy`, Session store/persistence, Workspace registry, or storage. Load those Host services once, then mount this Service and its invariant companion. Human controls such as `/team` are separate Consumers.

A team-enabled preset registers the four tools in its own agent scope and marks the `team_send` definition with `markAgentTeamPreset()`. Tool rows must resolve `ctx.agentTeam` when executing, not statically inject it: this avoids a restore cycle during Host remount. Duplicate scoped tool names fail during unpublished setup and make only that Member unavailable. Duplicate Host service providers remain a composition error and should be removed rather than layered.

## Model Experience

### Host collaboration state

#### What the model sees

Nothing from this package. `ctx.agentTeam` registers no prompt, tool, schema, or model-visible message; model-facing Agent Team Consumers own those effects.

#### Token effect

The ledger, projection, and Human status reads add no model tokens.

#### KV Cache effect

The Host ledger and Human status reads do not alter model requests or cache reuse.

## Known Limitations and Deferred Work

- **Single Host writer** — concurrent processes over one dshHome are unsupported; operation serialization is process-local.
- **Permanent ledger** — M1 provides neither snapshots nor compaction, so storage grows with committed collaboration facts.
- **No remote provider seam** — the package combines the capability definition and its only implementation until a real remote Consumer requires another Provider.
