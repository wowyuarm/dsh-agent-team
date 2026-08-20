# Architecture

本文记录当前实现必须保持的边界。稳定领域词汇见 [`domain-model.md`](domain-model.md)；历史设计背景按 [`.scratch/README.md`](../.scratch/README.md) 查阅。当前行为以源码和测试为准；Harness API 以相邻 checkout 的文档、源码和测试为准。

## Package ownership

```text
packages/agent-team
  Host service + operation ledger + projections + Agent lifecycle + Remote declarations
        │
        ├── packages/tool-agent-team
        │     model-facing team_inbox / team_thread / team_message / team_claim / team_view
        │
        ├── packages/command-agent-team
        │     Human /team adapter
        │
        └── packages/client-agent-team
              typed Remote client + Team mode + browser presentation
```

- `packages/agent-team` owns the Team capability. `src/index.ts` assembles the service and declares Remote methods; `ledger.ts` commits operations; `spec.ts` defines operation records; `types.ts` contains shared types; `invariant.ts` checks runtime relationships.
- `packages/tool-agent-team` resolves the live Team service when tools execute. It does not create a second service or write projections directly.
- `packages/command-agent-team` registers `/team` through `ctx.commands`. Its registration follows plugin lifetime.
- `packages/client-agent-team` has a Node half (`src/index.ts`) and a browser half (`src/client/`). The browser half reads Host projections through typed Remote and renders them through public Client slots.

## Host authority

The Team is one collaboration domain per DSH home. Its append-only operation ledger is the durable authority for Member, Workspace, Channel, Message, Task, Thread, Claim, Thread Attention, Inbox, and Activity facts.

- A mutation enters through the Host authority and commits one durable operation.
- Projections, Inbox results, tools, commands, Remote responses, and UI derive from committed operations.
- Client code must not interpret ledger records or create a parallel authority.
- Agent lifecycle, JSON/SQLite replay, authorization, idempotency, and revision checks stay on the Host side. Durable unread changes may produce one coalesced, body-free Agent Inbox hint through the public Agent safe-boundary API; this notification is not a second authority and does not promise exactly-once model processing.
- Thread Attention is private Member x Thread state. Ordinary unread comes from current Attention; structured mentions create direct markers. The Host is the only Inbox authority. Session history may retain the generic wake hint, but never Thread bodies or a parallel unread projection.
- Team-managed Agent sessions use the explicit Team preset and its trusted `danger-full-access` policy. This is an intentional product boundary for trusted workspaces.

When changing a Host capability, read the package source/tests first, then the matching Harness capability contract. The navigation table in [`harness-navigation.md`](harness-navigation.md) maps Host changes to `deepseek-harness/docs/subsystems/` and source packages.

## Tools, preset, and command

The explicit `team-member` preset is the only Team Member composition. It adds the full coding capability rows (shell, filesystem/search, web search, background jobs, skills, todo, and compaction), Team collaboration guidance/tools, Harness Workspace instruction discovery, and bounded private-memory reference context. Ordinary Sessions remain outside this isolated roster and do not receive Team prompt sections, tools, or Member memory.

The five model-facing tools are defined in `packages/tool-agent-team/src/index.ts`. Their implemented collaboration contract is documented in [`team-collaboration.md`](team-collaboration.md); this architecture note does not duplicate that state machine. They are mounted by the `team-member` preset under `packages/agent-team/preset/team-member/`, inside the isolated scope in `cordis.patch.yml`. Do not add the tool package as a global row merely to make it available in a test; ordinary Sessions must remain Team-free.

The command package is a Human adapter. It delegates to `ctx.agentTeam` and does not bypass Host authorization or ledger commit. A plugin unload must remove the command registration.

For schema, canonical output, presentation, preset, or command changes, read the matching Harness docs before editing:

- `../deepseek-harness/docs/subsystems/tools.md`
- `../deepseek-harness/docs/cookbook/adding-a-tool.md`
- `../deepseek-harness/docs/subsystems/permission-presets.md`
- `../deepseek-harness/docs/subsystems/commands.md`

## Typed Remote

Remote methods are declared with the Team service's `@Remote` annotations. `scripts/generate-typert.mjs` uses Harness `WorkspaceAnalyzer` and `FaceModelEmitter` to emit the Host and Client artifacts under `packages/agent-team/lib/`.

The stable flow is:

```text
Host face declaration
        │ generate:typert
        ▼
Typert Host artifact + Remote client artifact
        │ ctx.remote.$mount(...)
        ▼
Client remote service
```

`InvocationDescriptor` is local reflection metadata, not a wire message. Wire request and response fields remain explicit typed values. When changing a Remote, update the declaration and tests, regenerate, then run typecheck/build; do not hand-edit the artifact.

## Client plugin and slot composition

The Team browser plugin is an external Client plugin. The shipped Shell remains the owner of the outer layout. Team contributes one additive footer action and dynamically shadows three seats:

```text
sidebar.footer.action       additive Team entry
sidebar.workspaces          Team shadow, priority -100
conversation                Team shadow, priority -100
sidebar.settings            Team shadow, priority -100
```

The browser activation sequence is:

```text
Client plugin apply
  → ctx.remote.$mount(agentTeamRemote)
  → ctx.inject(['remote.agentTeam'], ...)
  → register Team footer and mode shadows
```

`dsh.client.inject` describes the client module graph; it does not guarantee apply order, service readiness, or slot declaration order. When a declaration may appear later, use `ctx.slots.inject()` so registration follows the declaration lifetime and is disposed with the owning fiber.

A slot parent’s `children` declaration is both the render site and render authority. Two live parent entries cannot declare the same child slot. In particular, the Team `sidebar.workspaces` shadow must not redeclare shipped `sidebar.workspaces.directoryFlow`; Harness SlotCore rejects that duplicate even when the Team entry has a higher priority. Do not copy private WorkspaceBrowser, ConversationRoot, Shell, or their private CSS to work around it.

When a Team feature needs an existing Harness capability, use its public service or package export. For directory selection, inspect `ctx.workspaces.pickDirectory()` and the `host.pickDirectory` path before proposing a Team-specific picker. If the public contract cannot express the desired composition, record the limitation and choose a Team-owned plugin or a new design rather than silently depending on private implementation details.

## Client data and presentation boundary

Components under `packages/client-agent-team/src/client/` do not reach into `ctx`, operation ledger, or Host classes. Data and callbacks arrive through the Client slot contract: owner props, runtime props, declared store, or inject face. The presentation layer consumes Host projections and local navigation state; it does not invent durable facts.

For UI work:

- Human Inbox and Thread reads use Host projections (`inbox`, `readThread`, `threadHistory`) and Host mutations (replies and Task actions). The current Thread UI does not expose Attention controls or observations; its Host Remote methods remain available for later owned UI. The browser persists only navigation mode and Workspace selection; it does not persist unread state or Attention.
- Reuse public Harness primitives and `--dsw-*` theme tokens where they exist.
- Keep CSS in CSS Modules; do not import private Harness CSS.
- Keep runtime presence separate from Claim and Task state.
- Task resolution controls Task and Claim mutations. A closed Task is terminal for replies and new Attention; reopening restores an open Task without restoring prior Attention.
- Keep Message, Activity, Claim, and Task presentation distinct and user-readable; do not expose opaque refs or internal enums.
- Keep durable mutations non-optimistic; preserve input on failure and render the next Host projection.
- Preserve Team mode enter/leave, refresh recovery, slot restoration, and narrow layout behavior.

UI redesign 已完成。需要理解当时的取舍时，查 [`.scratch/archive/2026-08/ui-redesign/`](../.scratch/archive/2026-08/ui-redesign/)；它是历史设计背景，不是当前实现权威。UI 改动的当前验收规则见 [`development.md`](development.md)。

## Workspace, Session, and storage reuse

Team reads the existing Harness Workspace projection and does not create a second Workspace store or Session tree. The current Client does not call `ctx.workspaces.pickDirectory()` or `ctx.workspaces.create()`; users return to the ordinary Session UI when they need to create a Workspace.

For Workspace, Session, storage, persistence, or Thread Inbox changes, read the relevant Team source/tests and then:

- `../deepseek-harness/docs/subsystems/workspace.md`
- `../deepseek-harness/docs/subsystems/session.md`
- `../deepseek-harness/docs/subsystems/storage.md`
- `../deepseek-harness/docs/subsystems/persistence.md`
- `../deepseek-harness/docs/defensive-patterns.md`

The Team ledger remains the only Team durable authority. Recovery and teardown changes need failure-window or composition evidence, not a silent fallback.
