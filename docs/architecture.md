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
        └── packages/client-agent-team
              typed Remote client + Team mode + browser presentation
```

- `packages/agent-team` owns the Team capability. `src/index.ts` assembles the service and declares Remote methods; `ledger.ts` commits operations; `spec.ts` defines operation records; `types.ts` contains shared types; `invariant.ts` checks runtime relationships.
- `packages/tool-agent-team` resolves the live Team service when tools execute. It does not create a second service or write projections directly.
- `packages/client-agent-team` has a Node half (`src/index.ts`) and a browser half (`src/client/`). The browser half reads Host projections through typed Remote and renders them through public Client slots.

## Host authority

The Team is one collaboration domain per DSH home. Its append-only operation ledger is the durable authority for Member, Workspace, Channel, Message, Task, Thread, Claim, Thread Attention, Inbox, and Activity facts.

- A mutation enters through the Host authority and commits one durable operation.
- Projections, Inbox results, tools, commands, Remote responses, and UI derive from committed operations.
- Client code must not interpret ledger records or create a parallel authority.
- Agent lifecycle, JSON/SQLite replay, authorization, idempotency, and revision checks stay on the Host side. Durable unread changes may produce one bounded, coalesced Agent context notification through the public Agent safe-boundary API: direct mentions carry their Message and source, Task/Claim Activities carry a concise state transition, and ordinary unread carries only a body-free Task route. This notification is not a second authority and does not promise exactly-once model processing.
- Client invalidation is scoped and targeted. `changes()` waiters declare one scope (workspace/channel/thread) plus an abortable signal; a commit wakes only matching scopes, and a Thread read wakes nobody because it changes no shared projection. After each commit the Host recomputes Inbox hints only for the Members the operation can have affected. The Client shares one abortable long-poll per scope (`TeamChangeStream`) instead of per-page polling loops; these are transport optimizations and never a second authority over ledger facts.
- The bundle targets DSH `0.1.1-rc.2`. Its SQLite Session persistence uses the current DSH schema; old SQLite Session databases are discarded and recreated. Do not add Team-owned migration, compatibility reads, or fallback storage paths.
- Thread Attention is private Member x Thread state. Ordinary unread comes from current Attention; structured mentions create direct markers, and terminal Task changes may retain sparse Activity markers after Attention ends. The Host is the only Inbox authority. Session history may retain bounded notification context, including direct Message bodies and Task/Claim transition summaries, but never a parallel unread projection.
- Team-managed Agent sessions use the explicit Team preset and its trusted `danger-full-access` policy. This is an intentional product boundary for trusted workspaces.
- An untitled Member session is named with its handle through the session-title service when the Host activates it, so the ordinary Session list shows the Member identity. An explicit rename or any earlier title always wins, and the naming never fails activation.
- Private-memory directories under `$DSH_HOME/agent-team/members/` are Host-owned effects of Member identity, not a second authority. At startup the Host prunes `member:`-shaped directories the replayed ledger does not reference; every ledger-known Member protects its own directory, prune failures fail startup, and entries outside the `member:` shape are left untouched.

When changing a Host capability, read the package source/tests first, then the matching Harness capability contract. The navigation table in [`harness-navigation.md`](harness-navigation.md) maps Host changes to `deepseek-harness/docs/subsystems/` and source packages.

## Tools and preset

The explicit `team-member` preset is the only Team Member composition. It adds the full coding capability rows (shell, filesystem/search, web search, background jobs, skills, todo, and compaction), Team collaboration guidance/tools, Harness Workspace instruction discovery, and bounded private-memory reference context. Ordinary Sessions remain outside this isolated roster and do not receive Team prompt sections, tools, or Member memory.

The five model-facing tools are defined in `packages/tool-agent-team/src/index.ts`. Their implemented collaboration contract is documented in [`team-collaboration.md`](team-collaboration.md); this architecture note does not duplicate that state machine. They are mounted by the `team-member` preset under `packages/agent-team/preset/team-member/`, inside the isolated scope in `cordis.patch.yml`. Do not add the tool package as a global row merely to make it available in a test; ordinary Sessions must remain Team-free.

The Web Client is the only Human control surface. It delegates every mutation to `ctx.agentTeam` through the typed Remote and does not bypass Host authorization or ledger commits. Do not add a slash-command adapter back as a second interface.

For schema, canonical output, presentation, or preset changes, read the matching Harness docs before editing:

- `../deepseek-harness/docs/subsystems/tools.md`
- `../deepseek-harness/docs/cookbook/adding-a-tool.md`
- `../deepseek-harness/docs/subsystems/permission-presets.md`

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

- Human navigation starts at Channels and follows Workspace → Channel → Task → Thread. The Client does not expose a Human Inbox or poll it. Thread reads use Host projections (`readThread`, `threadHistory`) and Host mutations (replies and Task actions). The current Thread UI does not expose Attention controls or observations; its Host Remote methods remain available for later owned UI. The browser persists Team navigation mode, Workspace selection, and the last selected Channel or Thread so returning to Team restores the previous location. It does not persist unread state or Attention. Agent Inbox remains Host-owned and available through `team_inbox`.
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

Member sessions appear in the ordinary Session list and stay readable there while the Host keeps the Member's Agent live. A cold Member session — a suspended Member, a failed activation, or a Host that has not finished restoring — cannot be resumed through the generic Session UI: that path resolves the session's recorded preset against the ambient shipped roster, which deliberately does not contain the bundle-private `team-member` preset, so the resume fails loud instead of rebuilding the history under the wrong composition. Resume such Members through the Team panel (or restart with a healthy bundle); do not add a Team fallback to the ambient roster.

For Workspace, Session, storage, persistence, or Thread Inbox changes, read the relevant Team source/tests and then:

- `../deepseek-harness/docs/subsystems/workspace.md`
- `../deepseek-harness/docs/subsystems/session.md`
- `../deepseek-harness/docs/subsystems/storage.md`
- `../deepseek-harness/docs/subsystems/persistence.md`
- `../deepseek-harness/docs/defensive-patterns.md`

The Team ledger remains the only Team durable authority. Recovery and teardown changes need failure-window or composition evidence, not a silent fallback.

The shipped bundle composition routes only the `agent_team` domain to the SQLite backend through the public per-domain route table; every other domain keeps the JSON default. The SQLite medium (`$DSH_HOME/storages/agent_team.sqlite`) is created fresh on first routed open, and an older `agent_team.json` medium is never read or migrated — moving or removing it is an operator decision.
