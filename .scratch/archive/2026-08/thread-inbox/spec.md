# Spec: Thread Inbox 与 Team Member 工作上下文

日期：2026-08-19
状态：archived；2026-08-20 已完成。以下内容是实现前的阶段合同快照。
范围：以当前 Agent Team M1 与 M2 功能基线为起点，直接替换旧的 Follow/Delivery 注意力模型；当前没有需要保留的持久 Team 数据。

## Problem Statement

当前 Agent Team 能把 Thread 消息直接投递进 Member Agent 的 Session，但它没有一个按成员保存的、可恢复的 Thread Inbox。普通 Thread 更新、明确 mention、Claim 与 Task 状态变化都沿用同一条 Session 投递路径，导致以下问题：

- Agent 无法区分“需要立刻处理的 mention”“以后再看的普通更新”和“只给 Human 观察的信息”。
- Agent 正在工作时收到的普通消息会污染后续模型上下文；Agent 空闲时也没有稳定、可重放的待处理工作入口。
- 新被 Human mention 拉进一个已有 Thread 的 Agent 无法可靠地按需补齐 Task、Claim、近期讨论和更早历史。
- 当前模型工具无法清晰区分“发现 Task”“读取一个 Thread”“管理自己的关注”“在 Thread 发消息”；旧工具名也没有准确表达这些职责。
- Human 没有 Workspace 内的 Inbox，无法看到自己被 Agent 直接请求的事项，也无法用和 Agent 同一份 Host 权威读取状态处理未读。
- Team Member preset 不是完整的 coding Agent preset；Member 私有 `memory.md` 与 `notes/` 目前没有明确的上下文、维护和生命周期合同。
- `npm run preview` 复用了无模型浏览器脚手架。用户在页面中 mention Agent 后，Agent 尝试发起模型请求，最终得到与产品行为无关的 replay fixture 错误。

用户需要一个低噪声、可恢复、可审计的协作模型：共享 Thread 事实仍只由 Team ledger 定义；每个 Human 和 Agent 分别拥有自己的注意力与未读状态；模型只在合适的安全边界被告知“有待处理更新”，再通过工具主动读取事实。

## Solution

将 Thread Inbox 设计为 Team ledger 内由 Host 维护的成员级投影。普通更新仅进入关注该 Thread 的成员 Inbox；明确 mention 具有更高优先级；Agent 在空闲时收到一个合并后的无正文提示，在运行中不被中断。模型通过新的 `team_inbox` 和 `team_thread` 工具主动读取摘要、当前状态和有界历史，而不是把整个 Thread 直接塞进 Session。

最终 Team 工具面为：

- `team_inbox`：跨 Thread 的个人待处理摘要；
- `team_thread`：单个 Thread 的关注、未读读取和历史；
- `team_message`：创建顶层 Task 或向已有 Thread 追加公开消息；
- `team_claim`：管理 Direction Claim；
- `team_view`：发现 Channel、Task 与成员基本状态。

每条顶层 Channel Message 都创建一个 Task 与它的 Thread anchor；只有已有 Task 内的 reply 才是后续讨论。这个规则写入 Team Member 的稳定协作提示，不能让 Agent 把 Channel 当作无结构闲聊流。

Human UI 在每个 Workspace 的 Team Mode 中增加第一个 Inbox 入口；Thread 页面显示未读边界、公开协作事实，以及仅供 Human 判断风险的 follow/unfollow 与 Agent runtime error 观察信息。未关注 Agent 的 Human mention 使用输入框上方的灰色二次发送说明，不使用 modal，也不把正常确认显示成错误。

Team Member preset 明确组成完整 coding Agent 能力、项目指导、Team 协作协议和成员私有记忆上下文。`memory.md` 是有界注入的长期索引，`notes/` 是按需读取的私有资料。预览分为真实 live、无模型 UI 和可重复 replay 三条路径。

```text
┌ Team · Workspace ───────────────────────────┐
│ Inbox · 3                                    │
│ ! Task #12 · @你 · 1 条新消息                 │
│ • Task #19 · 2 条新回复                       │
│                                               │
│ Channels                                      │
│   engineering                                 │
└───────────────────────────────────────────────┘

┌ Task #12 ────────────────────────────────────┐
│ ⚠ @reviewer 当前不可用 · provider timeout     │
│   active claim：浏览器回归                     │
│                                               │
│ 旧历史                                        │
│ ── 你有 2 条未读更新 ──                        │
│ Human：@reviewer 请确认测试范围。              │
│                                               │
│ 提及：@reviewer                               │
│ @reviewer 当前未关注此 Task。再次发送会发送此  │
│ 消息，并让 @reviewer 加入关注。                │
│ [ 写一条消息…                              ↑ ]│
└───────────────────────────────────────────────┘
```

## User Stories

1. As a Human Member, I want a Workspace-scoped Inbox as the first Team navigation item, so that I can find Team updates without scanning every Channel.
2. As a Human Member, I want Inbox counts scoped to the selected Workspace, so that unrelated projects do not compete for my attention.
3. As a Human Member, I want direct mentions visually prioritized ahead of ordinary unread updates, so that urgent requests are not buried in discussion traffic.
4. As a Human Member, I want to open an Inbox item and receive the relevant Thread facts from the Host, so that browser state is not the authority for whether I read it.
5. As a Human Member, I want opening a Thread from Inbox to mark the delivered batch read atomically, so that refreshes and multiple browser views do not recreate stale unread counts.
6. As a Human Member, I want a visible unread boundary while reviewing the batch I just opened, so that I can distinguish new discussion from older context.
7. As a Human Member, I want to browse closed Thread history after notifications stop, so that completed work remains auditable.
8. As a Human Member, I want to create a top-level Channel Message that automatically becomes a Task, so that every new work item has a stable Thread anchor.
9. As an Agent Member, I want to create a top-level Channel Message that automatically becomes a Task, so that I can surface independently discovered work without inventing a second task mechanism.
10. As a Team participant, I want every top-level Channel Message to have exactly one Task and Thread anchor, so that a Channel never mixes untracked chat with Task work.
11. As a Team participant, I want replies to target an existing Task Thread explicitly, so that later discussion cannot accidentally create unrelated Tasks.
12. As a Human Member, I want to choose at least one initial Channel when creating an Agent Member, so that a new Agent has a clear authorized collaboration surface.
13. As a Human Member, I want only Human authority to add or remove Agent Channel membership, so that visibility and collaboration boundaries cannot change silently.
14. As an Agent Member, I want to discover only Channels and Tasks I am authorized to see, so that Team tools preserve Workspace and Channel authority.
15. As a Task creator, I want to follow my newly created Thread automatically, so that I do not miss replies, Claims or Task changes on work I initiated.
16. As an Agent Member, I want a successful Claim to start following its Task Thread automatically, so that I remain aware of updates affecting work I own.
17. As a Team participant, I want replying to a Thread not to subscribe me implicitly, so that speaking once and continuously following remain separate choices.
18. As an Agent Member, I want to unfollow a Thread when I have no active Claim, so that irrelevant discussion stops entering my Inbox.
19. As an Agent Member, I want unfollowing to discard my current unread state for that Thread, so that old work does not permanently block future work.
20. As an Agent Member, I want following again to start at the current Thread tail, so that old history stays available without becoming a backlog of mandatory unread work.
21. As a Human Member, I want to invite an unfollowed Agent by structured mention with an explicit second send, so that adding someone to a Thread is deliberate.
22. As a Human Member, I want the first invitation attempt to preserve my draft and selected recipients, so that I can confirm without reconstructing the message.
23. As a Human Member, I want invitation confirmation shown as a gray status explanation above the composer, so that normal confirmation is not mistaken for a failure.
24. As a Human Member, I want editing the draft or recipient set to invalidate the old invitation confirmation, so that confirmation always applies to the exact intended message.
25. As an Agent Member, I want an attempt to mention an unfollowed Agent to return a structured `member_not_following` result, so that I cannot silently enroll another Agent in work.
26. As an Agent Member, I want to mention the Human Member directly, so that I can request a decision or intervention without forcing the Human to follow the whole Thread.
27. As a Human Member, I want an Agent’s direct mention to create a direct Inbox item without auto-following me, so that a one-off escalation does not create ongoing noise.
28. As a newly invited Agent Member, I want the invitation Message and later updates to be unread while earlier history remains optional background, so that I can enter an established discussion without being blocked by its entire past.
29. As a newly interested Team participant, I want the first Thread read to include Task anchor, current status, current Claims and a small recent background window, so that I can decide whether deeper history is necessary.
30. As a Team participant, I want older Thread history loaded in bounded pages, so that long discussions remain usable without flooding the model or UI.
31. As an Agent Member, I want `team_inbox` to return Thread summaries without message bodies, so that I can choose the relevant work before loading detailed context.
32. As an Agent Member, I want direct-mention Threads listed before ordinary unread Threads, so that explicit requests influence triage without breaking chronological reading inside a Thread.
33. As an Agent Member, I want `team_thread.read` to return a contiguous chronological unread batch and advance one durable watermark, so that read state is compact and recoverable.
34. As an Agent Member, I want direct mention priority to choose a Thread rather than skip earlier unread messages in that Thread, so that one read watermark remains truthful.
35. As an Agent Member, I want `team_thread.history` to leave my read watermark unchanged, so that researching background does not incorrectly clear pending updates.
36. As a Team participant, I want ordinary Thread Messages, Claim changes and Task resolution changes to create meaningful unread work for followers, so that material collaboration changes are visible.
37. As a Team participant, I want follow/unfollow, delivery retries, read-watermark changes and presence changes excluded from Agent Inbox work, so that operational noise does not consume model context.
38. As a Human Member, I want to see useful follow/unfollow observations and Agent error state in the Thread surface, so that I can understand participation and risk without sending those observations to Agents.
39. As a Human Member, I want a Member runtime error associated with an active Claim shown as a current Thread risk, so that I can intervene when owned work may be blocked.
40. As a Team participant, I want public Messages, Claims and Task resolution changes to remain the revisioned Thread timeline, so that the shared collaboration record is deterministic.
41. As an Agent Member, I want a compact no-body Inbox hint when ordinary updates arrive while I am idle, so that I can choose to inspect Team work without receiving unrelated text directly.
42. As an Agent Member, I want a direct mention hint delivered at the next safe step when I am already running, so that a model request or tool call is not interrupted.
43. As an Agent Member, I want at most one coalesced Inbox hint pending at a time, so that bursts of updates do not create a model-call storm.
44. As an Agent Member, I want unread work to survive Host restart, Member resume and error recovery, so that notifications are not lost because an Agent was temporarily unavailable.
45. As an Agent Member, I want the Host not to repeatedly wake me when I ignore one Inbox hint, so that Team notification is not an infinite job runner.
46. As a Team participant, I want relevant unread Thread updates to reject public mutations until I read them, so that I do not speak, claim, complete, resolve or close work using stale awareness.
47. As a Team participant, I want public Thread mutations also guarded by the current Thread revision, so that concurrent discussion changes cannot be overwritten after a read.
48. As a Team participant, I want an `unread_required` or `stale_revision` result returned as structured business state, so that Human UI and Agent reasoning can recover without treating normal collaboration conflicts as infrastructure failures.
49. As an Agent Member, I want every Team tool result, including a successful message, returned to my model loop, so that I can decide whether a message was only an intermediate update or the end of my work.
50. As a Human Member, I want only Human authority to accept, close or reopen a Task, so that final outcome remains an explicit Human decision.
51. As a Team participant, I want Claim state to derive todo, in-progress and in-review work state while Task resolution remains separate, so that “my direction is done” is not confused with “the Task is accepted”.
52. As a Team participant, I want accepted Tasks to remain discussable but reject new Claim mutations until reopened, so that review can continue without silently restarting work.
53. As a Team participant, I want closing a Task to release active Claims, clear Attention and stop Inbox delivery while preserving visible history, so that closure ends the workflow without erasing evidence.
54. As a Team participant, I want reopening a closed Task not to restore former followers automatically, so that a new attention period begins only by follow or direct invitation.
55. As a Team Member Agent, I want my prompt to explain that a top-level Channel Message creates a Task, so that I choose `team_message.start` or `team_message.reply` deliberately.
56. As a Team Member Agent, I want my prompt to explain Inbox, Thread, Claim, mention and revision rules, so that I use collaboration tools as a protocol rather than relying on injected message bodies.
57. As a Team Member Agent, I want the normal Workspace instruction chain loaded automatically, so that project-specific `AGENTS.md` and related guidance apply to Team work.
58. As a Team Member Agent, I want a complete coding toolset alongside Team tools, so that I can inspect, modify, test and validate the Workspace rather than only discuss it.
59. As a Team Member Agent, I want my private `memory.md` index injected within a bounded budget, so that durable personal context is available without crowding out active work.
60. As a Team Member Agent, I want detailed private notes loaded only on demand, so that large or irrelevant personal material does not enter every request.
61. As a Team Member Agent, I want prompt guidance to maintain memory and notes only for verified, reusable knowledge, so that private memory does not become a transcript or a second Team ledger.
62. As a Team Member Agent, I want my private memory preserved across suspend and resume but deleted on permanent removal, so that identity lifecycle and private data lifecycle match.
63. As a plugin operator, I want Team-specific prompts, tools and private memory context confined to the isolated Team preset, so that ordinary Sessions never acquire Team behavior accidentally.
64. As a developer, I want `npm run preview` to run a real isolated live Team profile and fail clearly without credentials, so that manual interaction can actually receive Agent replies.
65. As a developer, I want a separate no-model UI preview, so that I can inspect presentation without accidentally issuing a model request.
66. As a developer, I want browser tests to use deterministic replay fixtures, so that UI and Host behavior remain reproducible without credentials.
67. As a maintainer, I want all of these facts derived from the Host ledger and typed Remote projections, so that Session history, browser storage and client components never become alternate Team authorities.

## Implementation Decisions

- **Direct cutover:** There is no existing Team data to preserve. Replace the old Follow/Delivery attention behavior, old Team tool names and affected operation schema in one cutover. Do not add migration code, compatibility aliases, dual readers, dual writers or fallback behavior.

- **Single authority:** The Team Host and append-only operation ledger remain the only authority for Tasks, Threads, Messages, Claims, Attention, Inbox state and durable invitation facts. Client state, Agent Session history, prompt hints and tool results are projections or effects only.

- **Thread Attention:** Each Member × Thread attention interval is durable and records whether the member follows, its attention start point and a contiguous read watermark. Sparse direct-mention markers supplement the watermark where a recipient is not following or where direct priority must be retained. Ordinary unread work is represented by the interval and watermark, not a dense per-message-per-member read table.

- **Attention lifecycle:** Creating a Task, successful Claim and explicit follow create an attention interval. Unfollow is disallowed while an active Claim exists, discards the current unread state and ends the interval. A later follow starts at the then-current Thread tail. Human-confirmed invitation creates the Message and target Agent attention atomically. A direct mention of Human can exist without making Human a follower.

- **Unread classification:** Follower-visible Thread Messages, Claim create/done/release and Human Task accept/close/reopen form ordinary unread facts. A structured mention is marked direct. Senders do not receive unread for their own mutation. Follow/unfollow, read updates, admission/retry mechanics and presence/runtime updates are not Agent Inbox facts.

- **Thread reading:** `team_inbox` returns bounded Thread summaries, no body text and no watermark change. It sorts direct-mention Threads before ordinary Threads, then by newest relevant sequence. `team_thread.read` returns a contiguous chronological batch and advances the durable watermark atomically. A first read for a new attention interval includes the Task anchor, current Task and Claim snapshot, up to twelve preceding background Messages and up to twenty unread facts. `team_thread.history` returns bounded earlier public facts without changing read state.

- **Public timeline and Human observations:** Revisioned public Thread timeline facts are Messages, Claim changes and Task resolution changes, ordered by global sequence. Attention changes remain durable audit facts but do not change Thread revision or Agent Inbox state. Human UI may render follow/unfollow and current Agent runtime errors as supplemental observations; they are not model-visible Thread facts and do not generate Agent notifications. A current runtime error becomes a Thread-level risk only when the Agent owns an active Claim there.

- **Task model:** A top-level Channel Message always creates one Task and one Thread anchor. `team_message.start` creates that fact; `team_message.reply` targets an existing Task. Task work status derives from Claims. Human resolution remains separate: accept makes the Task done but keeps discussion readable and writable; close releases active Claims, ends Attention and stops delivery; reopen restores an open Task but not prior attention intervals.

- **Channel authority:** Human creates and changes Channel membership. Creating an Agent requires at least one initial Channel. Agents can only discover or mutate facts in their authorized Channels. An Agent-created Task appears in Channel discovery but does not notify Human or other Agents unless the Agent explicitly mentions Human; Agents cannot use a new Task to enroll another Agent automatically.

- **Structured mention policy:** Structured refs, not `@name` text, define recipients. Human may mention one or more unfollowed Agent Members only through a two-send confirmation. Confirmation binds the Human actor, exact Task/Thread, message body, recipient set and recipient attention/member state; it is invalidated by changing the draft or recipients, not by unrelated Thread changes. Agent attempts to mention any unfollowed Agent Member return `member_not_following` and commit nothing. Agents may directly mention Human without auto-following Human.

- **Mutation fences:** All public mutations of an existing Thread—reply, Claim create/done/release and Human accept/close/reopen—first reject relevant unread work and then validate the current Thread revision. Starting a new Task and changing personal attention are exempt. There is no force-send or bypass action in this release. Normal collaboration rejections are typed results such as committed, unread-required, stale-revision and member-not-following; malformed calls, inaccessible refs and Host failures remain ordinary tool failures.

- **Model tools:** Model tools derive Workspace identity from the live Agent Member and do not take a model-supplied Workspace id. `team_inbox` is cross-Thread triage; `team_thread` owns follow, unfollow, read and history; `team_message` owns start and reply; `team_claim` owns list, claim, done and release; `team_view` is limited to discovering Channel, Task and Member summaries. No model tool uses a compatibility name or overlaps another tool’s primary responsibility.

- **Agent loop behavior:** Every Team tool result, whether committed or rejected, is persisted and returned to the model loop. Team tools do not conclude a turn. The model decides whether to continue, read more facts, run project tools, send a mid-work update or finish naturally.

- **Inbox hints:** The Host derives Agent notifications from durable unread state. At most one generic no-body Inbox hint is pending for an enabled Agent. Ordinary updates wake an idle Agent through that hint; while the Agent is running, updates accumulate until a safe next-step boundary and do not interrupt the current request or tool. Direct mention is prioritized through the same safe-boundary principle. Restart, resume and error recovery reissue a needed hint from unread state. A consumed or ignored hint does not cause repeated automatic waking until a new relevant trigger occurs.

- **Human UI:** Inbox is the first Workspace-level Team navigation item. The Thread surface uses Host reads to advance Human state, renders a local unread divider for the delivered batch, preserves drafts on failed mutation, and never optimistically renders durable Team facts. The composer displays the unfollowed-Agent confirmation as a gray `role=status` explanation above the input; real errors remain separate. Task, Claim, runtime presence and supplemental observation information remain clearly distinct.

- **Team Member preset:** The isolated Team preset explicitly supplies a full coding Agent capability set, including command execution, filesystem access/search/editing, background work control, skills, todo, compaction and necessary web access, alongside Team tools. It does not include nested Team-bypassing delegation, generic workflow orchestration, Ralph or direct user-question tools by default.

- **Prompt and dynamic context:** The stable Team Member prompt establishes member identity and description, top-level Task semantics, Team authority boundaries, structured mention restrictions, Inbox/Thread workflow, Claim discipline, mutation recovery and private memory maintenance. Workspace instructions remain the Harness-owned instruction chain. Dynamic Team hint content contains only a concise Inbox state signal, never Thread body text. Private memory uses a Team-owned typed context source and does not claim system authority.

- **Private memory:** Each Member has one private lowercase `memory.md` index and a `notes/` directory. New Members receive a concise template. `memory.md` is injected only when it is at most 8 KiB; if it exceeds that budget, inject only an explicit maintenance warning and let the Agent read and compact the file deliberately. Notes are never automatically injected. Agents use normal project-capable filesystem tools to read and maintain relevant notes. Private memory is preserved through suspend/resume, deleted on permanent Member removal and never exposed through the Human Client. The private directory is namespace isolation, not a malicious-Agent security boundary under full filesystem access.

- **Preview and testing modes:** `npm run preview` is the real interactive mode and requires credentials; it uses an isolated temporary profile and storage and cleans it after exit. `npm run preview:ui` is explicitly model-free and prevents or clearly disables operations that would call a model. `npm run test:browser` remains deterministic through replay fixtures. There is no automatic mode selection based on credential presence.

- **Ownership boundaries:** The external Team bundle uses existing public Harness extension points and does not modify Harness core, its Agent loop or shipped defaults. Host, model tools, Client, command adapter, preset and generated Remote artifacts retain their established ownership boundaries. Maintained package documentation and development guidance are updated only with the implementation that makes these behaviors current.

## Testing Decisions

- The primary and highest test seam is a real Team Host with durable storage, exposed through the typed Remote and exercised by the assembled Team Client. This is the agreed seam for validating user-visible Inbox state; browser components do not interpret ledger records and test-only local unread stores are not introduced.

- Host tests cover append-only operation replay, idempotency, concurrent reads and writes, attention interval creation/end, direct markers, chronological watermark advancement, invitation confirmation, unread/revision gates, close/reopen cleanup, suspension, removal and restart recovery. Tests assert legal externally visible projections and effects rather than private map layout.

- Model tool tests run actual Team tools against a live Team Member identity. They cover Task discovery, Inbox triage, first read/background, history pagination, self-follow, automatic Claim follow, agent mention rejection, Human direct mention, typed rejection recovery and the requirement that tool results remain available to a following model step.

- Agent-loop integration tests use a deterministic model adapter and real safe-boundary inbox behavior. They prove ordinary updates do not interrupt a running tool, idle updates create one coalesced wake, direct mention is prioritized, ignored hints do not loop forever, and restart/resume/error recovery derives new hints from durable unread state.

- Client tests exercise typed Remote reads and mutations through Team Mode. They cover Workspace Inbox ordering, counts, Human read, Thread divider, old-history browsing, invitation retry status, draft preservation, stale/unread refresh, Channel membership selection, observation-only follow/error rendering and accessible status text.

- Browser tests use a deterministic replay fixture and a real assembled Web bundle. They cover Team entry, initial Channel selection for Agent creation, Inbox navigation, Human invitation, Thread read, Task and Claim state, UI-only observations, narrow layout and exit back to ordinary DSH surfaces.

- A manual live verification runs the same representative trace in the isolated credentialed preview: an existing Thread receives a Human invitation of an unfollowed Agent; the Agent wakes, reads, claims or replies; Human sees the Inbox and updated Thread; no provider-scaffold error occurs.

- A no-model preview verification proves that the UI can render and navigate fixture state without issuing a provider request. Replay browser tests remain credential-free and reproducible.

- Changed Host face, Remote declarations, preset composition, Client bundle and scripts run the repository’s required generation, typecheck, unit/integration tests, build, browser test, lint, pack dry run and whitespace checks at the appropriate implementation tickets.

## Out of Scope

- Preserving legacy Team ledger data, old tool names, old delivery semantics, compatibility aliases, migration code or dual read/write paths.
- Multiple Human Members, role matrices beyond the existing Human/Agent split, distributed Hosts, cross-machine synchronization or external Team transports.
- Agent-to-Agent direct messages, a separate Human-visible DM transcript, nested Threads, message editing/deletion, reactions, attachments, search and URL deep links.
- Automatic semantic summaries of Thread history, automatic memory writing, automatic memory compression, force-send/ignore-unread controls and timed Inbox polling.
- Browser push notifications, desktop notifications, global cross-Workspace Inbox aggregation, notification preferences and task scheduling policies.
- Strong hostile-Agent private-memory isolation; that requires execution sandboxing outside this feature.
- Changing Harness Agent-loop behavior, shipped Harness defaults or private Harness UI implementations.
- Multiple Team Member role presets, runtime role editing, configurable model/provider selection or nested Agent orchestration.

## Further Notes

- Raft is a product reference only. This design borrows pull-style Inbox, version-aware collaboration and concise wake hints where verified by first-party material. It does not copy Raft’s single-owner Task model, full-channel delivery or any undocumented service behavior.

- Earlier M1/M2 design material remains historical context. Current production behavior remains defined by source and tests until this work is implemented; maintained engineering documentation must be updated only alongside verified code.

- The Thread Inbox / Member Context design draft and the Raft primary-source research are retained as supporting design evidence for implementation work. They are not behavior authorities.
