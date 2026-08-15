# @deepseek-ai/dsh-agent-team

English | [中文](README.zh.md)

The Host capability for one Agent Team in a dshHome. `ctx.agentTeam` owns the append-only operation ledger, reconstructs the current collaboration projection, and is the lifecycle owner for member Agents and Delivery workers added by the same capability. The [Agent Team architecture note](../../../.agents/notes/proposed/architecture/2026-08-15-agent-team-operation-ledger.md) owns the persistence and package-topology decisions.

## Service contract

The Service requires `ctx.storageDomain` and opens the versioned `agent_team` Domain before Cordis publishes `ctx.agentTeam`. The first boot appends one `team/initialized` operation for the stable Human Member; later boots replay the same operation and do not append another record.

`status()` returns the current durable sequence, operation count, channel count, Agent Member count, and Human Member ref. It performs no model request and no storage write. `validateLedger()` checks the package-owned projection against the durable operation table.

Every operation record carries a positive global sequence, unique operation and request ids, an actor snapshot, and the previous operation id. Replay rejects invalid record fields, table-key/id mismatches, sequence gaps, broken previous links, repeated ids, and invalid state transitions. An identical request-id retry returns the original receipt; a changed payload with the same request id rejects.

## Durability and lifecycle

`storage-domain` validates every record at the durable read boundary and rejects a backend unit stamped with another version. The Team updates its projection only after `KvTable.put()` resolves. Its Fiber owns the Domain handle; disposal rejects new Service calls through Cordis removal, drains accepted Domain writes, and closes the backend unit before the name can reopen.

M1 supports one Host writer. The ledger is permanent and has no snapshot or compaction path.

## Composition

Mount the storage backend, `dsh-storage`, `dsh-storage-domain`, this Service, and its invariant companion. Human controls such as `/team` are separate Consumers.

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
