# 架构

[English](architecture.md) | 中文

本文记录当前实现必须保持的边界。稳定领域词汇见 [`domain-model.zh.md`](domain-model.zh.md)；历史设计背景按 [`.scratch/README.md`](../.scratch/README.md) 查阅。当前行为以源码和测试为准；Harness API 以相邻 checkout 的文档、源码和测试为准。

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

- `packages/agent-team` 拥有 Team capability。`src/index.ts` 组装 service 并声明 Remote methods；`ledger.ts` 提交 operations；`spec.ts` 定义 operation records；`types.ts` 包含共享 types；`invariant.ts` 检查运行时关系。
- `packages/tool-agent-team` 在 tools 执行时解析 live Team service。它不创建第二个 service，也不直接写入 projections。
- `packages/client-agent-team` 分为 Node 部分（`src/index.ts`）和 browser 部分（`src/client/`）。browser 部分通过 typed Remote 读取 Host projections，并通过 public Client slots 渲染。

## Host authority

Team 是每个 DSH home 内唯一的协作域。append-only operation ledger 是 Member、Workspace、Channel、Message、独立 Thread aggregate、可选 Task overlay、Claim、Thread Attention、Inbox 和 Activity facts 的 durable authority。

- mutation 进入 Host authority，并提交一条 durable operation。
- Projections、Inbox results、tools、commands、Remote responses 和 UI 都从已提交的 operations 派生。
- Client code 不得解释 ledger records，也不得创建 parallel authority。
- Agent lifecycle、JSON/SQLite replay、authorization、idempotency 和 revision checks 都留在 Host 侧。durable unread 变化可以通过 public Agent safe-boundary API 产生一条有界、合并后的 Agent context notification：direct mentions 携带其 Message 和 source，Task/Claim Activities 携带简要状态变化，ordinary unread 只携带不含正文的 Thread-first route（若存在则带 Task overlay）。Promotion 与其他 Task transition 一样是 Task activity，通过 Activity markers 到达 followers。这类 notification 不是第二权威，也不保证模型恰好处理一次。
- Client invalidation 采用有范围且定向的方式。`changes()` waiters 声明一个 scope（workspace/channel/thread）和可 abort 的 signal；commit 只唤醒匹配的 scopes。Thread read 不会唤醒任何 waiter，因为它不改变共享 projection。每次 commit 后，Host 只为可能受该 operation 影响的 Members 重算 Inbox hints。Client 通过 `TeamChangeStream` 为每个 scope 共享一条可 abort 的 long-poll，而不是每页各自轮询；这些只是 transport 优化，绝不是 ledger facts 的第二权威。
- Bundle 目标为 DSH `0.1.1-rc.2`。其 SQLite Session persistence 使用当前 DSH schema；旧 SQLite Session databases 会被丢弃并重新创建。这个 DSH Session-schema disposal policy 不会抹掉 Team operation history：Team 有意保留针对旧版、Message-level `occurredAt` 之前 records 的窄 replay normalization。普通存储的 Message operations 在加载时使用包裹 operation 的 instant；旧 `team/thread-read` snapshot anchors 与 Message facts 从来源 Message operation 解析 instant，只有必要时才回退到 read operation。不要增加 Team 自有的 Session migration、宽泛 compatibility reads 或 fallback storage paths；可选的 `member.model` inheritance 与可选 Message attachments 都是当前语义，不是 legacy fields。
- Thread Attention 是 private Member x Thread state。ordinary unread 来自当前 Attention；structured mentions 创建 direct markers；terminal Task changes 在 Attention 结束后仍可能保留稀疏 Activity markers。Host 是唯一 Inbox authority。Session history 可以保留有界 notification context（包括 direct Message bodies 和 Task/Claim transition summaries），但不能形成 parallel unread projection。
- Team 管理的 Agent sessions 使用显式 Team preset 和可信的 `danger-full-access` policy，这是面向可信 Workspace 的有意产品边界。
- Host 激活 Member 时，会通过 session-title service 用其 handle 命名没有标题的 Member session，使普通 Session list 显示 Member identity。显式 rename 或任何已有 title 始终优先，命名失败不会导致 activation 失败。
- Human 接受 Task 后，Host-local coordinator 会去重所有 Claim owners，等待每个 live Member 进入 idle，并且只有 scoped token meter 严格超过 200K 时才 compact。Pending/error bookkeeping 只在进程内维护；只有进入 transaction 的 compactions 才会写入 durable Session history，绝不写入 Team ledger。
- `$DSH_HOME/agent-team/members/` 下的 private-memory directories 是 Member identity 的 Host-owned effects，不是第二权威。Member activation 确保 private-memory directory、`notes/` 和缺失的 `memory.md` 存在；startup 不会清理 ledger 不知道的 `member:` directories。显式 Member removal 会归档其 Session 并移除该 Member 的 private-memory directory；Team removal path 之外的 entries 保持不动。

### Composer attachments（cache，不是 archive）

Composer attachments 是 `$DSH_HOME/agent-team/attachments/v1/<attachmentId>/` 下的有界 cache（包含经过清理的原始名称和 `meta.json` sidecar），不是 archive，也不是 ledger bytes。

- `putAttachment` 写入 immutable payload（每个文件上限 10 MB，并从名称中剥离 path separators 和 control characters）；`getAttachment` 为 Client display 读取它们。两者和其他 Host capabilities 一样都是 typed Remote actions。
- Channel 与 Thread composer 的附件入口有两个：「+」按钮选择文件，或直接向输入框粘贴——携带文件的粘贴会被拦截并进入同一 pending-file chips 流，纯文本粘贴保持浏览器原生插入。
- Message 在 ledger 中记录 attachment metadata（`attachmentId`、`name`、`byteSize`、`mediaType`）；存储 body 为每个 attachment 携带一行面向机器的 `[attachment] <absolute path>`，让 Member agents 通过普通 file tools 按 path 读取 bytes。Client 会从 display 中移除这些行，改为根据 metadata 渲染 thumbnails/chips。
- Ledger 是唯一 durable attachment authority。Bytes 是 transient 的：Host startup 以及每 24h 执行一次 GC sweep；被 Message 引用且超过 72h 的 uploads（Member consumption window），或从未发送的 orphaned uploads 超过 24h 的，都会被移除。Metadata 保留，Client 随后优雅降级为 name chip。
- Members 通过 `team_message` 的可选 `attachments`（absolute paths）共享文件：Host 先验证每个 path（absolute、regular file、non-empty、10 MB），再以 extension-derived media type 复制到 cache 的新 immutable entry，因此 agent-sent images 与 composer uploads 的渲染一致。任一 rejection 都会拒绝整个 send，不提交也不复制。
- 不需要为手动 path references 增加机制：粘贴到 Message body 的 absolute path 会被 Member agent 像其他文件一样读取，Host 不会触碰不属于自己的内容。

修改 Host capability 时，先阅读 package source/tests，再阅读匹配的 Harness capability contract。导航表见 [`harness-navigation.zh.md`](harness-navigation.zh.md)，其中将 Host 改动映射到 `deepseek-harness/docs/subsystems/` 和 source packages。

## Tools and preset

显式的 `team-member` preset 是唯一的 Team Member composition。它加入完整 coding capability rows（shell、filesystem/search、web search、background jobs、skills、todo、compaction）、Team collaboration guidance/tools、Harness Workspace instruction discovery 和有界的 private-memory reference context。普通 Sessions 留在这个 isolated roster 之外，不会获得 Team prompt sections、tools 或 Member memory。

五个 model-facing tools 定义在 `packages/tool-agent-team/src/index.ts`；实现的 collaboration contract 记录在 [`team-collaboration.zh.md`](team-collaboration.zh.md)。它们由 `packages/agent-team/preset/team-member/` 下的 `team-member` preset 挂载，并位于 `cordis.patch.yml` 的 isolated scope 中。不要为了让测试可用就把 tool package 作为 global row 添加；普通 Sessions 必须保持 Team-free。

Web Client 是唯一的 Human control surface。它通过 typed Remote 把每个 mutation 委托给 `ctx.agentTeam`，不绕过 Host authorization 或 ledger commits。不要重新加入 slash-command adapter 作为第二界面。

修改 schema、canonical output、presentation 或 preset 时，编辑前先阅读匹配的 Harness docs：

- `../deepseek-harness/docs/subsystems/tools.md`
- `../deepseek-harness/docs/cookbook/adding-a-tool.md`
- `../deepseek-harness/docs/subsystems/permission-presets.md`

## Typed Remote

Remote methods 通过 Team service 的 `@Remote` annotations 声明。`scripts/generate-typert.mjs` 使用 Harness `WorkspaceAnalyzer` 和 `FaceModelEmitter`，在 `packages/agent-team/lib/` 下生成 Host 和 Client artifacts。

稳定流程如下：

```text
Host face declaration
        │ generate:typert
        ▼
Typert Host artifact + Remote client artifact
        │ ctx.remote.$mount(...)
        ▼
Client remote service
```

`InvocationDescriptor` 是 local reflection metadata，不是 wire message。Wire request 和 response fields 保持为显式 typed values。修改 Remote 时更新 declaration 和 tests，重新生成，然后运行 typecheck/build；不要手工编辑 artifact。

## Client plugin 和 slot composition

Team browser plugin 是 external Client plugin。Shipped Shell 继续拥有 outer layout。Team 增加一个 additive footer action，并动态 shadow 三个 seats：

```text
sidebar.footer.action       additive Team entry
sidebar.workspaces          Team shadow, priority -100
conversation                Team shadow, priority -100
sidebar.settings            Team shadow, priority -100
```

Browser activation 顺序是：

```text
Client plugin apply
  → ctx.remote.$mount(agentTeamRemote)
  → ctx.inject(['remote.agentTeam'], ...)
  → register Team footer and mode shadows
```

`dsh.client.inject` 描述 client module graph；它不保证 apply order、service readiness 或 slot declaration order。如果 declaration 可能稍后出现，使用 `ctx.slots.inject()`，让 registration 跟随 declaration lifetime，并随 owning fiber disposal。

Slot parent 的 `children` declaration 同时是 render site 和 render authority。两个存活的 parent entries 不能声明同一个 child slot。特别是 Team 的 `sidebar.workspaces` shadow 不得重新声明 shipped `sidebar.workspaces.directoryFlow`；即使 Team entry priority 更高，Harness SlotCore 也会拒绝这个 duplicate。不要复制 private WorkspaceBrowser、ConversationRoot、Shell 或 private CSS 来规避它。

Team feature 需要现有 Harness capability 时，使用 public service 或 package export。对于 directory selection，先检查 `ctx.workspaces.pickDirectory()` 和 `host.pickDirectory` path，再考虑 Team-specific picker。如果 public contract 无法表达目标 composition，记录这个 limitation，选择 Team-owned plugin 或新设计，不要静默依赖 private implementation details。

## Client data 和 presentation boundary

`packages/client-agent-team/src/client/` 下的 components 不接触 `ctx`、operation ledger 或 Host classes。Data 与 callbacks 通过 Client slot contract 进入，包括 owner props、runtime props、declared store 或 inject face。Presentation layer 消费 Host projections 和本地 navigation state，不自行发明 durable facts。

UI work 的边界如下：

- Human navigation 从 Channels 开始，沿 Workspace → Channel → Thread；真实 Task 是其 Thread 上的 card/header overlay。Channel composer 默认创建 taskless Thread，并提供默认关闭的「作为任务」控件以原子创建 Task。taskless Thread 保留 normal read/reply/inbox behavior，但在 promotion 前隐藏 Task status、Claims 和 Task-resolution controls。Promotion 是 durable、non-optimistic 的 Host mutation；成功后 Client 重新读取 Thread 和 supplemental projections，而不是本地合成 Task。Client 不显示或轮询 Human Inbox。Thread reads 使用 Host projections（`readThread`、`threadHistory`）和 Host mutations（replies、promotion、Task actions）。当前 Thread UI 不提供 Attention controls 或 observations；其 Host Remote methods 留给后续自有 UI。Browser 会持久化 Team navigation mode、Workspace selection 以及最近选中的 Channel 或 Thread，回到 Team 时恢复位置，但不持久化 unread 或 Attention。Agent Inbox 仍由 Host 持有，并通过 `team_inbox` 提供。
- Sidebar row order（Channels/Agents）是每个 browser 的 Human presentation preference，保存在 `localStorage`，加载时折叠到 Remote default order 上（保留的 refs 保持顺序，移除的 refs 丢弃，新的 refs 追加）；它从不成为 ledger fact。Whole-row native drag 复用 Harness list interaction model，并且是 Team-owned rows 唯一的重排控件。
- 只有嵌入的 Team Member Session 会接管 public `conversation.composer.bar` seat。其 Team-owned composer 渲染 owner overlay，并使用 public input state/actions 以及两个 Team trigger sources：`/compact` 采用 public Session command admission，`@` 从当前 Workspace 插入 structured stable Member ref，不发送 notification。两个 source 对普通 Sessions 都不返回 candidates；普通 Session 继续使用 shipped composer 以及原有 command/reference vocabulary。Member composer 当前不提供 image/file attachment control；Channel 和 Thread attachment flows 保持不变。
- 有对应能力时复用 public Harness primitives 和 `--dsw-*` theme tokens。
- CSS 保持在 CSS Modules 中；不要 import private Harness CSS。
- Runtime presence 必须与 Claim 和 Task state 分离。
- Task resolution controls 会修改 Task 和 Claim。Closed Task 对 replies 和 new Attention 是 terminal；reopen 会恢复 open Task，但不会恢复此前的 Attention。
- Message、Activity、Claim 和 Task 的 presentation 要保持区分且用户可读；不要暴露 opaque refs 或 internal enums。
- Durable mutations 不做 optimistic update；失败时保留 input，并渲染下一份 Host projection。
- 保持 Team mode enter/leave、refresh recovery、slot restoration 和 narrow layout behavior。

UI redesign 已完成。需要理解当时的取舍时，查 [`.scratch/archive/2026-08/ui-redesign/`](../.scratch/archive/2026-08/ui-redesign/)；它是历史设计背景，不是当前实现权威。UI 改动的当前验收规则见 [`development.zh.md`](development.zh.md)。

## Workspace、Session 和 storage reuse

Team 读取现有 Harness Workspace projection，不创建第二套 Workspace store 或 Session tree。当前 Client 不调用 `ctx.workspaces.pickDirectory()` 或 `ctx.workspaces.create()`；需要创建 Workspace 时，用户回到普通 Session UI。

Member sessions 出现在普通 Session list 中，并且在 Host 保持 Member Agent live 时可继续读取。Cold Member session（suspended Member、activation failed，或 Host 尚未完成 restoring）无法通过 generic Session UI resume：该路径会在 ambient shipped roster 中解析 session 记录的 preset，而该 roster 刻意不包含 bundle-private `team-member` preset，因此 resume 会明确失败，而不会用错误 composition 重建 history。请通过 Team panel resume 这些 Members，或使用健康的 bundle 重启；不要给 ambient roster 增加 Team fallback。

修改 Workspace、Session、storage、persistence 或 Thread Inbox 时，先阅读相关 Team source/tests，然后阅读：

- `../deepseek-harness/docs/subsystems/workspace.md`
- `../deepseek-harness/docs/subsystems/session.md`
- `../deepseek-harness/docs/subsystems/storage.md`
- `../deepseek-harness/docs/subsystems/persistence.md`
- `../deepseek-harness/docs/defensive-patterns.md`

Team ledger 仍是唯一的 Team durable authority。Recovery 和 teardown 改动需要 failure-window 或 composition evidence，不能依赖 silent fallback。

Shipped bundle composition 只通过 public per-domain route table 把 `agent_team` domain 路由到 SQLite backend；其他 domains 保持 JSON default。SQLite medium（`$DSH_HOME/storages/agent_team.sqlite`）在首次 routed open 时全新创建；旧的 `agent_team.json` medium 永远不会被读取或迁移——是否移动或删除由 operator 决定。
