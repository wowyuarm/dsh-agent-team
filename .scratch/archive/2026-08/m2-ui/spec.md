# Spec: Agent Team M2 Web UI — First Collaboration Slice

日期：2026-08-16
状态：archived；2026-08-17 已完成。以下内容是 M2 第一阶段的实现前快照。

## Problem Statement

Agent Team M1 已经提供可恢复的 Channel、Message、Task、Thread、Claim、Follow、Delivery、Member lifecycle 和四个 Agent 工具，但 Human 只能通过临时 `/team` adapter 或测试观察结果。用户无法在 DSH Web 中直观看到 Workspace 下的 Channels 与 Agent Members，也无法以正常产品交互完成 Channel 发言、Thread 协作和 Task 验收。

M2 第一阶段需要交付一个真正可操作的 Team 模式，同时保持 DSH 默认 Workspace/Session UI、主题、组件和交互风格不变。Team UI 必须经 typed RPC 读取和修改 Host 权威投影，不能让 Client 自己维护第二份业务事实。

## Solution

在 DSH Web sidebar 底部增加“团队”入口。进入 Team 模式时，保留 DSH 品牌栏与折叠控制，动态接管 sidebar 的 Workspace 区域、中心 conversation 区域和 Settings seat；退出时释放这些注册，默认 DSH UI 自动恢复。

Team sidebar 以 Workspace 为第一层，每个 Workspace 提供 Channels 与 Agents 两个 tab。Human 可创建 Agent、创建 Channel 并管理 Channel membership。Channel 页面显示显式 Team Messages；每条顶层 Message 固定对应一个 Task。点击 Task 入口进入 Thread，在其中回复、查看 Claims，并执行 Human authority 的 Task/Claim 操作。

第一阶段只交付核心协作闭环。Agent DM、附件、搜索、URL deep links、Model/provider 选择、Thread inbox 与 prompt 调整均延期，避免 UI 与注意力模型同时变化。

## User Stories

1. As a Human Member, I want a Team button in the DSH sidebar, so that I can enter Team work without replacing the application shell.
2. As a Human Member, I want the DSH brand and sidebar collapse controls to remain unchanged in Team mode, so that Team feels native to DSH Web.
3. As a Human Member, I want Team mode to replace the sidebar body instead of mixing Channels into the Session tree, so that Team and Session navigation remain understandable.
4. As a Human Member, I want a “← 对话” action, so that I can restore the default Workspace/Session sidebar and current Session.
5. As a Human Member, I want Settings hidden while Team mode is active, so that the Team sidebar has only Team-level exits and controls.
6. As a Human Member, I want Team mode and the selected Workspace remembered locally, so that a browser refresh returns me to the same broad work context.
7. As a Human Member, I want an invalid remembered Workspace to fall back safely, so that removed or foreign Workspace ids do not break the UI.
8. As a Human Member, I want Workspaces displayed in Host registry order, so that Team does not introduce another ordering model.
9. As a Human Member, I want to create a Workspace through the existing DSH directory-flow capability, so that Team reuses the same Host selection and creation semantics.
10. As a Human Member, I want every Workspace to expose Channels and Agents tabs, so that project collaboration and project members are separate but nearby.
11. As a Human Member, I want Channels to be the default tab, so that the main Team work surface is immediately visible.
12. As a Human Member, I want an empty Workspace to show a small create-Channel affordance, so that I can start without a marketing-style empty page.
13. As a Human Member, I want to create an Agent Member with a name and description, so that its project responsibility is visible.
14. As a Human Member, I want the first UI version to use the shipped team-member preset and Host default model, so that Agent creation does not expose unfinished configuration.
15. As a Human Member, I want each Agent Member bound to exactly one Workspace, so that cwd and Team authority remain unambiguous.
16. As a Human Member, I want different Workspaces to permit Agents with the same name and description, so that display identity does not become a global persona system.
17. As a Human Member, I want names unique within one Workspace, so that mentions and rows remain distinguishable locally.
18. As a Human Member, I want Member refs, not names, to remain the stable identity, so that rename and duplicate cross-Workspace names are safe.
19. As a Human Member, I want Agent creation to show a creating state and retain unavailable failures, so that partial runtime setup is visible and retryable.
20. As a Human Member, I want Agent availability represented by a compact DSH-style state dot, so that lists stay scannable.
21. As a Human Member, I want available shown as green, working as animated blue, error as red, and unavailable as gray, so that runtime state matches DSH visual semantics.
22. As a keyboard or screen-reader user, I want every state dot to have accessible text and a Tooltip, so that color is not the only status signal.
23. As a Human Member, I want an Agent error retained until the next loop starts, so that failures do not disappear before I can inspect them.
24. As a Human Member, I want a global “成员” panel outside Workspace tabs, so that I can inspect all Agent Members grouped by Workspace.
25. As a Human Member, I want the first global Members panel to be read-only, so that DM and management semantics are not invented prematurely.
26. As a Human Member, I want to create a Channel with a name, description, and initial Agent Members, so that a collaboration place is usable immediately.
27. As a Human Member, I want Channel creation and initial membership committed atomically, so that invalid members never leave a half-created Channel.
28. As a Human Member, I want to add or remove Channel members later, so that participation can change without deleting Agents.
29. As a Human Member, I want removing an Agent from a Channel to release that Channel’s active Claims, remove Follows, and cancel queued Deliveries while preserving history, so that authority and attention stay consistent.
30. As a Human Member, I want unavailable or creating Agents disabled in membership pickers, so that a Channel does not promise an unusable participant.
31. As a Human Member, I want to open a Channel in the center column, so that Team Messages are not disguised as Session events.
32. As a Team participant, I want Human and Agent Messages rendered with the same message structure, so that the Channel reflects shared explicit speech.
33. As a Team participant, I want internal reasoning, tool and session events omitted from Channel and Thread views, so that the shared surface contains only collaboration facts.
34. As a Team participant, I want a compact initial-letter identity mark, sender name and member kind, so that messages are identifiable without an avatar system.
35. As a Team participant, I want descriptions available through hover detail instead of repeated on every message, so that the timeline remains quiet.
36. As a Human Member, I want every top-level Channel Message to show its Task number, status and Thread reply count, so that work can be scanned from the Channel.
37. As a Human Member, I want the Task footer to open its Thread, so that discussion and state controls stay out of the Channel timeline.
38. As a Human Member, I want a Team composer containing only text, structured @mention and Send, so that Session-only commands and model controls do not leak into Team Messages.
39. As a Human Member, I want mention candidates limited to current Channel members, so that structured recipients always satisfy authority.
40. As a Human Member, I want a failed send to preserve my draft, so that a Host or revision failure does not erase work.
41. As a Human Member, I want Channel and Thread pages to load the latest bounded page and load older facts on demand, so that long histories remain usable.
42. As a Human Member, I want live Host change notifications to trigger a pull of new projection facts, so that the Client never reconstructs ledger state from events.
43. As a Human Member, I want to enter a Task Thread and return to its Channel, so that Team navigation remains explicit without browser URL routing.
44. As a Human Member, I want Thread participants shown with runtime state dots separate from Claim state, so that “Agent is running” is not confused with “Claim is active”.
45. As a Human Member, I want to see each Claim’s owner, Direction and state, so that parallel work is understandable.
46. As a Human Member, I want to reply in a Thread using the current revision, so that my contribution participates in the same concurrency rules as Agent replies.
47. As a Human Member, I want stale Thread replies to refresh the Thread without automatically replaying my input, so that the UI does not duplicate intent.
48. As a Human Member, I want to mark a specific Claim done or released, so that I can resolve work without impersonating the Agent’s decision to claim.
49. As a Human Member, I want to accept, close or reopen a Task from the Thread header, so that work reaches an explicit Human-owned outcome.
50. As a Human Member, I want failed mutations to remain pending or show a retryable error until Host acceptance, so that the UI never displays facts absent from the Operation ledger.
51. As a Human Member, I want Team mode to preserve the selected ordinary Session underneath it, so that returning to Conversations restores my previous work.
52. As a plugin operator, I want Team slot conflicts to fail loudly, so that two plugins never silently shadow each other’s primary navigation.
53. As a plugin operator, I want unloading Team UI to restore all shipped slots, so that the bundle remains opt-in and reversible.
54. As a product reviewer, I want one browser journey covering Team entry through Thread completion and return to DSH, so that I can judge the collaboration experience directly.

## Implementation Decisions

- **Client package:** M2 adds one Team Client package with a browser entry. The opt-in bundle declares it through the existing DSH client-module mechanism.
- **Single Client seam:** all Team UI reads and mutations use one typed Client adapter backed by Host RPC. The adapter exposes immutable projections, mutation results and a lightweight changed notification; no component reads the ledger directly.
- **No DSH core modification:** Team consumes existing Client runtime, Slot, Workspace, locale-independent UI primitives and semantic theme contracts. It does not modify DSH core or add another component library.
- **Team mode takeover:** the footer action owns root-local Team mode. While active, Team dynamically shadows `sidebar.workspaces`, `conversation` and `sidebar.settings`; leaving Team mode disposes all three registrations so shipped occupants restore automatically. No generic mode registry is introduced.
- **Shell ownership:** the DSH sidebar brand, collapse control and layout remain mounted. Team implements only the sidebar body, center Team page and a null Settings occupant while active.
- **Conflict policy:** Team registrations use explicit shadow priority. Any equal-priority competing primary occupant fails loudly through existing Slot validation.
- **Local navigation:** Team uses one root-local store containing mode, selected Workspace, active Workspace tab, Channel ref and Thread ref. Only mode and Workspace are persisted; Channel, Thread and tab are transient. No URL or browser history contract is added.
- **Workspace reuse:** Team reads Workspace projections and Host actions from existing Client runtime and re-declares the existing sidebar directory-flow child contract while active. It preserves Host Workspace order and does not implement search or Team-specific sorting.
- **Sidebar layout:** each expanded Workspace shows Channels and Agents tabs with an add icon for the active category. A global “成员” row and “← 对话” action sit below Workspace content. Settings is hidden in Team mode.
- **Agent creation:** the first slice accepts name and description, binds the Agent to the chosen Workspace, and uses the shipped team-member preset plus Host default model. Model/provider selection, preset selection and personality are not surfaced.
- **Agent identity:** Member ref remains the immutable identity. Name is display metadata unique within a Workspace only; different Workspaces may contain identical names and descriptions.
- **Runtime status:** durable Member lifecycle remains the ledger fact. UI runtime status is a process projection with the precedence unavailable > error > working > available. Idle live Agents are available; running Agents are working; loop/tool failure remains error until the next loop starts; missing or unusable AgentHandle and suspended/inactive lifecycle states project unavailable.
- **Status presentation:** lists use state dots only. Available uses DSH success green, working uses the existing animated ongoing blue, error uses DSH error red, and unavailable uses a semantic neutral/disabled gray. Tooltip and accessible text carry the status name and diagnostic.
- **Channel schema:** Channel adds description. A Human atomic create operation fixes Channel identity and initial memberships together. Later add/remove membership operations preserve historical Message/Task/Thread facts.
- **Membership removal:** removing a Member from one Channel releases that Member’s active Claims in the Channel, removes its Follows, cancels its queued Deliveries and preserves history. It does not suspend or remove the Agent Member.
- **Message surface:** Channel and Thread views render explicit Messages and relevant Activity projections only. Human and Agent Messages share one layout. Descriptions appear in hover detail rather than every row.
- **Team composer:** the first composer supports text, structured member mentions and Send. It follows DSH keyboard/focus/disabled conventions and theme styling but does not mount Session command menus, model controls, permission controls, queue controls or attachments.
- **Task entry:** each top-level Channel Message displays its Task number, derived status and Thread Message count. Task mutations live in the Thread header, not the Channel row.
- **Human Thread authority:** Host gains Human-authored Thread reply plus Claim done/release entry points. Human reply uses base revision, structured mentions, Follow and Delivery rules. Human does not create Claims or manipulate Agent Follow state.
- **Live synchronization:** Host emits a lightweight Team-changed signal after committed relevant facts or runtime status changes. Client responds by pulling the bounded current projection; Client does not fold operation events into business state.
- **Pagination:** Channel/Thread initially show the latest bounded page; older facts load on demand using sequence cursors. Cursor remains a ledger sequence, not an array offset.
- **Mutation posture:** no durable business fact is rendered optimistically. Drafts and form inputs remain local while pending; committed Host projection makes them visible. Runtime-only `creating` is allowed while Agent setup is pending.
- **UI ownership:** feature CSS uses CSS Modules, `clsx` and DSH semantic tokens. Controls use DSH primitives and Lucide/DSH icons already provided by the UI packages; no literal feature color theme is introduced.
- **Language:** first implementation uses the agreed Chinese product labels and does not expand multilingual product copy. Accessibility labels remain complete.

## Testing Decisions

- Tests assert user-observable behavior and Host contracts, not component internals or ledger implementation details.
- The primary test seam is a real Client plugin composition connected to a real Agent Team Host projection through typed RPC. Lower tests exist only for pure status/navigation derivation and Host operation invariants.
- Slot tests prove Team mode shadows exactly the intended three seats, hides Settings, preserves the shell and restores every shipped occupant after exit/unload.
- Host tests cover Workspace-scoped Agent names, runtime-status transitions, atomic Channel creation, membership removal cleanup, Human Thread reply, Human Claim mutation and failure/idempotency paths.
- Client tests cover mode persistence with stale Workspace fallback, Channel/Agent tab behavior, state-dot accessibility, non-optimistic forms, pagination and changed-signal pull behavior.
- Browser tests use the existing DSH Web test runtime and Playwright patterns. Desktop and narrow/mobile screenshots verify no overlap, correct typography, state dots, sidebar collapse and Channel/Thread layouts.
- A final real GUI journey creates Agents and a Channel, sends/mentions, observes runtime status, enters a Thread, replies, updates Claim/Task state, returns to Channel, exits Team mode and verifies the ordinary Session UI is unchanged.
- Existing M1 REAL composition, SQLite restart, typecheck, build and pack checks remain green. The bundle tarball must contain the Client entry and its declaration.

## Out of Scope

- Thread inbox, unread cursors, `team_inbox`, `team_send` unread gating and related prompt design.
- Changing the current M1 Follow, mention and Delivery semantics before UI evaluation.
- Agent DM, its separate Human-visible transcript and delivery into the internal Agent session.
- Agent name/description management after creation, private memory/notes management and Agent removal UI.
- Model/provider or preset selection, Agent personality, roles or cross-Workspace Agent identity.
- Search, Team-specific sorting, URL deep links and browser Back/Forward integration.
- Attachments, images, slash commands, model controls, permissions, Session queue controls and Trajectory in Team views.
- Optimistic durable business facts, offline mutation queues and cross-device Team-mode preferences.
- Nested Threads, message editing/deletion, distributed Team Hosts, multiple Human Members and complex role permissions.
- Prompt/persona tuning beyond preserving the shipped M1 guidance.

## Further Notes

- The previously documented shortcut “Agent direct chat opens the Member internal session” is superseded. A later M2 design will treat Agent DM as a separately persisted Human-visible transcript delivered into the Member’s internal append-only session; it is not part of this first slice.
- After the UI is usable, Thread inbox receives a separate grill. Current direction: ordinary Thread Messages may create Member-specific unread items and only notify that unread work exists; explicit mention remains a next-step steer with durable evidence; an Agent may read bounded Thread history instead of receiving it all in context. Whether `team_send` rejects on relevant unread facts remains undecided.
- Existing M1 Follow/Delivery behavior is the implementation baseline until that later decision is complete.
- The ponytail review explicitly rejected a generic sidebar mode registry, copied WorkspaceBrowser/ConversationRoot implementations, and speculative DM/inbox abstractions for this batch.
