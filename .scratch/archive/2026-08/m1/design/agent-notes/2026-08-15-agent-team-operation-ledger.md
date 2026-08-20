# Agent Note: Agent Team operation ledger

Status: proposed

English | [中文](2026-08-15-agent-team-operation-ledger.zh.md)

## Problem

Independent Agent sessions need a shared collaboration domain without sharing model context, transcripts, or private memory. The domain must survive Host restart, enforce authority at one write point, admit messages to exact member sessions, and unload without retaining live Cordis or Agent references.

`storage-domain` guarantees atomic durability for one record but has no transaction spanning records or Session logs. A design based on mutable task, member, follow, and delivery tables would expose partially committed collaboration facts after a failed multi-record mutation. A Tool result or command lifecycle event also cannot commit atomically with Team storage.

## Proposal

One dshHome has one Agent Team. `@deepseek-ai/dsh-agent-team` publishes `ctx.agentTeam` and combines the Service Definition with the single local implementation. It owns a versioned append-only operation ledger, rebuilds all current projections by replay, serializes Host writes, and owns Agent Member handles and Delivery workers. The M1 package remains opt-in.

Every business mutation writes one immutable operation record containing a global sequence, operation id, idempotent request id, timestamp, actor snapshot, discriminated payload, and previous operation id. A durable write completes before the in-memory projection changes or a commit event emits. Startup validates record fields, table-key identity, contiguous sequence, previous links, operation/request uniqueness, authority-derived state transitions, and the rebuilt projection.

The first operation establishes the stable Human Member. An identical request-id retry returns its original receipt; the same request id with a different actor, operation kind, or payload rejects. Tool Consumers derive request ids from the exact session and tool call. Human commands derive them from command execution identity.

The Host capability, model Tool Consumer, and Human command Consumer live in `dsh-agent-team`, `dsh-tool-agent-team`, and `dsh-command-agent-team`. A team-enabled Agent preset mounts the Tool Consumer and member-private compaction. Client UI remains outside M1 and later consumes typed JSON projections from the same Host intents.

A top-level Channel Message creates one Task and Thread. Work state derives from multiple Direction Claims, with Human accepted and closed facts as explicit overrides. Channel membership grants visibility but does not subscribe ordinary delivery. Mentions and Follow records create durable Delivery intents whose states are `queued`, `admitted`, or `canceled`; admission means exact Inbox evidence exists and does not claim model processing or task completion.

The Host Fiber owns the Domain, operation admission, Delivery workers, and every AgentHandle. Teardown closes admission, invalidates confirmation tokens, stops notifications, awaits workers and AgentHandles, drains accepted storage writes, and closes the Domain. Durable sessions and ledger records survive unload; remount restores enabled members.

## Alternatives considered

**Mutable domain tables** were rejected because `storage-domain` cannot atomically update task, claim, follow, member, and delivery records. Recovery markers for every mutation would duplicate an event log while leaving more states to validate.

**Session logs as the Team authority** were rejected because collaboration spans independent sessions and a Team operation cannot atomically append to several logs. Session events remain evidence of Inbox admission and model-visible provenance.

**A provider registry in M1** was rejected because there is one local implementation and no current remote Consumer. The capability can split its Provider when a second implementation exists.

**Raft-compatible task ownership and delivery** were rejected as the governing model. Raft remains product reference material; dsh keeps automatic Tasks, concurrent non-equivalent Direction Claims, default-silent Channel membership, explicit Thread revisions, and local Delivery recovery.

## Acceptance criteria

M1 boots through a real opt-in Loader composition, replays on JSON and SQLite storage, exposes `/team` Human controls and four scoped model tools, provisions exact member sessions, proves Inbox admission, supports Claim/Follow/task lifecycle operations, and recovers every ledger, Inbox, member, and teardown failure window. Package tests, package-owned invariants, HMR disposal, keyless snapshots, and a real composition smoke cover those paths.

## Risks

The permanent ledger grows without compaction in M1. Full replay cost and query indexing are deferred until measured need justifies snapshots that preserve audit and ref identity. Single-process serialization does not permit multiple Host writers. At-least-once Inbox admission can prove durable evidence but cannot prove that a model processed or acted on a specific Delivery.
