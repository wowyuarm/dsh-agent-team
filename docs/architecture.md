# Architecture

English | [中文](architecture.zh.md)

This document records boundaries that the current implementation must preserve. Stable vocabulary is in [`domain-model.md`](domain-model.md); historical design context is indexed by [`.scratch/README.md`](../.scratch/README.md). Source and tests define current behavior; Harness APIs are defined by the adjacent checkout's docs, source, and tests.

## Package ownership

```text
packages/agent-team
  Host service + operation ledger + projections + Agent lifecycle + Remote declarations
        │
        ├── packages/tool-agent-team
        │     model-facing team_inbox / team_thread / team_message / team_claim / team_view
        │
        └── packages/client-agent-team
              typed Remote client + Team mode + browser presentation
```

- `packages/agent-team` owns Team capability: `src/index.ts` assembles the service and declares Remote methods; `ledger.ts` commits operations; `spec.ts` defines records; `types.ts` contains shared types; `invariant.ts` checks relationships.
- `packages/tool-agent-team` resolves the live Team service at execution time. It does not create another service or write projections directly.
- `packages/client-agent-team` has a Node half (`src/index.ts`) and browser half (`src/client/`). The browser half reads Host projections through typed Remote and renders them through public Client slots.

## Host authority

Team is one collaboration domain per DSH home. Its append-only operation ledger is durable authority for Member, Workspace, Channel, Message, independent Thread aggregates, optional Task overlays, Claim, Thread Attention, Inbox, and Activity facts.

- Mutations enter Host authority and commit one durable operation. Projections, Inbox, tools, commands, Remote responses, and UI derive from committed operations; Client code never interprets ledger records or creates parallel authority.
- Agent lifecycle, JSON/SQLite replay, authorization, idempotency, and revision checks stay on Host. Durable unread changes may produce one bounded coalesced Agent context notification through the public safe boundary: direct mentions carry their Message and source, Task/Claim Activities carry a concise transition, and ordinary unread carries only a body-free Thread-first route. Promotion is a Task activity and reaches followers through Activity markers. Notifications are not a second authority and do not promise exactly-once model processing.
- `changes()` waiters declare one scope (workspace/channel/thread) and an abortable signal; a commit wakes only matching scopes. A Thread read wakes nobody because it changes no shared projection. A `team/dm-sent` direct message is the same shape of non-event: the durable record changes no shared projection, so it wakes no waiters either. Host recomputes Inbox hints only for Members affected by an operation. Client pages share one abortable long-poll per scope through `TeamChangeStream`.
- The bundle targets DSH `0.1.1-rc.2` and uses the current DSH SQLite Session schema. Old SQLite Session databases are discarded and recreated. Team nevertheless retains a narrow replay normalization for old pre-Message `occurredAt` records; do not add Team Session migration, broad compatibility reads, or fallback storage paths.
- Thread Attention is private Member × Thread state. The Host is the only Inbox authority. Session history may retain bounded notification context but never a parallel unread projection.
- Team-managed Agent sessions use the explicit Team preset and trusted `danger-full-access` policy. An untitled Member session receives its handle as a title; explicit or previous titles win.
- After Human acceptance, a Host-local coordinator deduplicates Claim owners, waits for live Members to become idle, and compacts only above its scoped 200K token meter. Before each compact attempt the coordinator steers one advisory plugin-source hint inviting the Member to persist durable conclusions to its private memory/notes; writing is the Agent's own decision, and a failed or ignored hint never blocks compaction. Pending/error bookkeeping is process-local; only compactions in a transaction add Session history.
- Private-memory directories under `$DSH_HOME/agent-team/members/` are Host-owned effects of Member identity. Activation ensures the directory, `notes/`, and missing `memory.md`; startup does not prune unknown directories. Explicit removal archives the Session and removes that Member's private directory; unrelated entries remain untouched.

### Composer attachments (cache, not archive)

Attachments live in the bounded cache `$DSH_HOME/agent-team/attachments/v1/<attachmentId>/`, with a sanitized original name and `meta.json`; they are never ledger bytes or an archive. `putAttachment` enforces a 10 MB file cap and sanitizes names; `getAttachment` serves Client display. Messages record metadata while the stored body contains machine-facing `[attachment] <absolute path>` lines. The Client strips those lines and renders thumbnails/chips. The Channel and Thread composers accept files both through the "+" picker and by pasting into the draft; a paste that carries files is intercepted and joins the same pending-file chips, while plain-text pastes keep their native insertion.

Garbage collection runs at startup and every 24 hours: referenced uploads older than 72 hours and orphaned uploads older than 24 hours are removed, while metadata remains. Agent-sent absolute paths are validated as absolute non-empty regular files under 10 MB, copied into a fresh immutable cache entry, and rejected atomically if any path fails. A manually pasted absolute path is simply read by the Agent; Host touches nothing it does not own.

When changing a Host capability, read package source/tests first and then the matching Harness contract. [`harness-navigation.md`](harness-navigation.md) maps the route to `deepseek-harness/docs/subsystems/` and source packages.

## Tools and preset

The explicit `team-member` preset is the only Team Member composition. It adds coding capability rows (shell, filesystem/search, web search, background jobs, skills, todo, compaction), collaboration guidance/tools, Harness Workspace instruction discovery, and bounded private-memory context. Ordinary Sessions remain outside this roster and receive no Team prompt sections, tools, or Member memory.

The five tools are defined in `packages/tool-agent-team/src/index.ts`; their contract is in [`team-collaboration.md`](team-collaboration.md). They mount under the isolated `team-member` preset. The Web Client is the only Human control surface and delegates every mutation through `ctx.agentTeam` typed Remote; do not restore a slash-command adapter.

## Typed Remote

`@Remote` annotations on the Team service are inputs to `scripts/generate-typert.mjs`, which uses Harness `WorkspaceAnalyzer` and `FaceModelEmitter` to emit Host and Client artifacts under `packages/agent-team/lib/`.

```text
Host face declaration → generate:typert → Typert Host + Remote client → ctx.remote.$mount(...) → Client remote service
```

`InvocationDescriptor` is local reflection metadata, not a wire message. Wire fields remain explicit typed values. Update declarations/tests, regenerate, and run typecheck/build; never hand-edit artifacts.

## Client plugin and slot composition

The external Client plugin leaves the shipped Shell as outer-layout owner. Team adds one footer action and shadows three seats:

```text
sidebar.footer.action       additive Team entry
sidebar.workspaces          Team shadow, priority -100
conversation                Team shadow, priority -100
sidebar.settings            Team shadow, priority -100
```

Activation mounts `agentTeamRemote`, waits for `remote.agentTeam`, then registers Team footer and mode shadows. `dsh.client.inject` describes the module graph but does not guarantee apply order or service readiness; use `ctx.slots.inject()` when a declaration may appear later.

A slot parent's `children` declaration is both render site and authority. Team's `sidebar.workspaces` shadow must not redeclare shipped `sidebar.workspaces.directoryFlow`; Harness SlotCore rejects duplicate live declarations. Do not copy private WorkspaceBrowser, ConversationRoot, Shell, or private CSS. Use public Harness services and exports, such as `ctx.workspaces.pickDirectory()`, and record limitations rather than depending silently on private implementation.

## Client data and presentation boundary

Client components do not reach into `ctx`, the operation ledger, or Host classes. Data and callbacks arrive through slot owner props, runtime props, declared stores, or injected faces. Presentation consumes Host projections and local navigation state and does not invent durable facts.

Human navigation is Workspace → Channel → Thread; a Task is a card/header overlay. New Channel composition defaults to taskless and exposes default-off 「作为任务」 for atomic Task creation. Taskless Threads retain reply/read/follow/Inbox behavior but gate status, Claims, and resolution controls until promotion. Promotion is non-optimistic and followed by rereading Thread and supplemental projections. The Client has no Human Inbox and does not poll it. Team navigation mode, Workspace selection, and last Channel/Thread are browser-persisted; unread and Attention are Host-owned.

The Team sidebar keeps Channels/Agents ordering as a browser-only `localStorage` preference, merged over Remote defaults. Member Session takeover uses only the public `conversation.composer.bar` seat and public input/actions. `/compact` uses public command admission; `@` inserts a structured Member ref without sending a notification. Ordinary Sessions retain shipped composer and vocabulary. Reuse public primitives and `--dsw-*` tokens, keep CSS in CSS Modules, and preserve Team mode restoration and narrow layouts.

## Workspace, Session, and storage reuse

Team reads the existing Harness Workspace projection and does not create a second Workspace store or Session tree. The Client does not create Workspaces; users return to ordinary Session UI for that. Member sessions appear in the ordinary list, but cold Members cannot resume there because the ambient shipped roster lacks the private `team-member` preset; resume through the Team panel or restart with a healthy bundle.

For Workspace, Session, storage, persistence, or Thread Inbox changes, read the relevant Team source/tests and Harness `workspace.md`, `session.md`, `storage.md`, `persistence.md`, and `defensive-patterns.md`. The ledger remains the only Team authority, and recovery changes require failure-window or composition evidence.

The published bundle routes only `agent_team` to SQLite at `$DSH_HOME/storages/agent_team.sqlite`; every other domain keeps JSON. The medium is created fresh and an older `agent_team.json` is never read or migrated.
