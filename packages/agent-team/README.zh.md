# @wowyuarm/dsh-agent-team

[English](README.md) | 中文

一个 dshHome 内唯一 Agent Team 的 Host capability。`ctx.agentTeam` 拥有 append-only operation ledger、重建当前协作 projection，并作为同一 capability 内 Member Agent 的 lifecycle owner。Thread Attention 和 Member Inbox 是 Host 的持久 projection。未读状态变化时，本包通过 Agent 的公开安全边界 API 发送一次有界、合并的 context 通知；不会中断正在执行的请求，也不运行 Session delivery worker。[Agent Team 架构 Agent Note](../../../.agents/notes/proposed/architecture/2026-08-15-agent-team-operation-ledger.md)记录持久化和包拓扑决策。

## Service 约定

Service 使用 `ctx.storageDomain`、`ctx.workspaceRegistry`、`ctx.agents`、`ctx.agentDefaultModel`、`ctx.agentPresets`、`ctx.tools`、`ctx.sessions` 和 `ctx.sessionPersistence`，并在 Cordis 发布 `ctx.agentTeam` 前打开带版本的 `agent_team` Domain。首次启动为稳定 Human Member 追加一条 `team/initialized` operation；后续启动重放同一 operation，不追加新记录。

`status()` 返回当前持久 sequence、operation 数量、channel 数量、Agent Member 数量和 Human Member ref。它不发起模型请求，也不写 storage。`validateLedger()` 对照持久 operation table 检查包内 projection。

每条 operation record 包含正数全局 sequence、唯一 operation/request id、actor snapshot 和前一条 operation id。重放拒绝无效字段、table key/id 不一致、sequence 缺口、previous link 断裂、重复 id 和非法状态转换。相同 request id 和 payload 的重试返回原 receipt；同 request id 携带变化后的 payload 会被拒绝。

## 持久化与生命周期

`storage-domain` 在持久读取处校验每条 record，并拒绝被其他版本标记的 backend unit。Team 只在 `KvTable.put()` 完成后更新 projection。其 Fiber 持有 Domain handle；dispose 通过 Cordis 移除拒绝新的 Service 调用，排空已接受的 Domain write，并在名称可重新打开前关闭 backend unit。

创建 Member 时，先提交稳定的 Member/session/Workspace/preset/private-memory 身份，再执行 unpublished Agent setup。Setup 挂载指定 preset，并在发布前检查带 marker 的 `team_message` 和全部五个 Team tools。失败只把该 Member 标为 unavailable。Suspend 等待所属 `AgentHandle` 完全停止；resume 和 Host remount 恢复同一个持久 session。

Member 可携带持久能力意图（`capabilities.tools.allow`、`capabilities.skills.allow`）。它随全部 lifecycle operation 原样流转，Host restart 后原样重放，commit 时不做已知名校验（Harness 升级不会破坏旧 ledger）；与已知名的偏差在 activation 时派生为不持久化的 `capabilityWarnings`。`tools.allow` 是有意的接口预留（当前无 UI 写入路径），供后续 Runtime Revision manifest 编排依赖。编辑语义与 `model` 一致（absent 即清除）：不管理 capabilities 的调用方必须回传已存储的值，否则其编辑会清掉该覆盖。

每个 Team 管理的 session 都会持久写入 `danger-full-access`。项目 cwd 仍是 Workspace 路径，私有记忆位于 `$DSH_HOME/agent-team/members/<memberId>/`。没有标题的 Member session 会通过 session-title service 以 handle 命名，普通 Session 列表因此直接显示 Member 身份；显式重命名或任何既有标题始终优先。隔离的 `team-member` preset 还提供 coding 工具、面向模型的 Web 搜索、Workspace instruction discovery 和 Team protocol guidance。共享的 Web service 与 provider 仍由 Host 持有；preset 只挂载面向模型的 Web tool。小写 `memory.md` 是有界的 8 KiB 参考索引，只有该 Member 的内容变化时才注入；`notes/` 只通过 filesystem tools 按需读取。超预算索引只产生维护警告，不静默截断。普通 session 和 fork 不获得 Team 身份或私有记忆上下文。Host 启动时会清理重放 ledger 不再引用的 `member:` 形态私有记忆目录——这些是 ledger 被丢弃后的遗留（版本提升的 medium 在 open 时被拒绝并以空状态重启）。清理失败会使启动失败；非 `member:` 形态的条目保持原样。

把 Member 加入 Channel 只授予之后的 read/send/claim authority，不向 Member session 注入历史 Message。每条顶层 Message 都创建 Thread；新 Client/tool 显式选择 taskless，released Client 省略意图时仍保持 taskful；Human 可之后 promotion taskless Thread，原子附加 Task overlay 与结构化 `promote` Task activity。创建 Thread、创建 Claim、显式 follow、顶层消息 mention 到、或 Human 确认邀请会开始 Thread Attention。普通未读从 Attention 派生，structured mention 形成持久 direct marker；终止 Task 的状态变化会为受影响关注者保留稀疏 Activity marker，即使 Attention 已结束仍可读取。`team_inbox` 和 Thread read 是 Host projection，不是 Session inbox 内容。Direct mention context 包含消息正文和来源，Task/Claim 变化（含 promotion）包含简短状态事实，普通未读提供无正文的 Thread-first 路由。提示会合并，忽略提示不会形成循环，resume/runtime error recovery 会从持久未读状态重新判断是否提示。对于可恢复的服务错误，Host 会在连续 `agent/error` occurrence 的前两次后唤醒 Member；第 3 次错误则交给 operator，只有 clean turn 才会重置这段连续错误。

Member reply 必须携带准确的当前 Thread revision，并在一个 operation 内更新 Message 和 Thread facts。`threadRef` 是协作主身份；released task-only Client 可为 taskful Thread 传入 Host-resolved `taskRef` alias，而 Task/Claim 操作仍以 Task ref 为准。未读工作必须先 read；revision 过期时拒绝写入。Closed Task 拒绝 reply 和新的 Attention；reopen 恢复 Task，但不恢复之前的 Attention。taskless Thread 仍支持 reply、follow、mention、Inbox、read 和 history，但没有 Claim 或 Task resolution path。顶层消息可以直接 mention Agent：被 mention 的 Member 会开始关注新 Thread。在既有 Thread 中，Human 的 reply 提到 unfollowed Agent 时必须先取得 process-local one-use confirmation token 才提交 operation；Member 的此类 reply 会以 member_not_following 拒绝。Message fact 携带自身的 structured mention refs，Client 只为这些 Member 渲染 mention chip。claim/done/release 和 Task change 是有序的 host-authored Activity。Active Claim 只排斥相同的 normalized Direction；不同 Direction 可以并行。Task status 从 Claims 派生，Human accept/close 是覆盖事实。Close 原子释放 active Claims 并清除 Thread Attention。Member remove 原子标记 inactive、释放 owned active Claims、清除该成员的 Attention 和 direct markers，再归档 session。Message 与 Activity facts 共用一个有界 sequence cursor。

`changes()` 是 Client 失效通知流。每个请求声明一个可选 `scope`（workspace、channel 或 thread）和可取消的传输 signal；一次提交的 operation 只唤醒 scope 与该 operation 派生范围匹配的 waiter（成员生命周期与 presence 唤醒其 Workspace，内容操作唤醒其 Channel 与 Thread）。Thread read 会持久化提交但不派生任何 scope，因为它只推进读者自己的私有水位。每次提交后，Host 只通知 Inbox projection 可能被该 operation 改变的 Member——即 operation 的 Attention/marker delta 加上被触及 Thread 的当前关注者——而不是全部在线 Agent。

M1 支持单个 Host writer。Ledger 永久保留，不提供 snapshot 或 compaction。

## Composition

Bundle 使用 Host 已有的 singleton provider，不重复挂载 `agents`、默认模型选择、`tools`、`fs`、`sandboxPolicy`、Session store/persistence、Workspace registry 或 storage 的替代实现。Host services 只挂载一次，再挂载本 Service 及 invariant companion。`/team` 等 Human control 是独立 Consumer。

Team-enabled preset 在自身 Agent scope 注册五个工具，并用 `markAgentTeamPreset()` 标记 `team_message` definition。Preset row 应在执行时读取 `ctx.agentTeam`，不能声明静态 inject：Host 在自身激活期间恢复 Member 时就会挂载成员 preset，声明依赖 `agentTeam` 的 row 无法激活，会让每次启动恢复失败。Scoped tool 重名会在 unpublished setup 阶段失败，只使对应 Member unavailable。Host service provider 重复则仍是 composition error，应删除重复行，不做叠加。

## Model Experience

### Host collaboration state

#### What the model sees

启用的 Member 在持久未读工作出现后，可能收到一次有界、合并的 context 通知。Structured direct mention 包含消息正文和来源；Task/Claim Activity 包含简短状态变化；普通未读只包含 Thread-first 路由、数量和 revision，存在时附带 Task overlay。通知通过 Agent 的安全 step 边界排队，正在执行的模型请求和工具不会被中断。常见路径可以直接调用 `team_thread.read`；只有需要跨 Thread 分流时才调用 `team_inbox`。

#### Token effect

Ledger、projection 和 Human status read 不增加模型 token。

#### KV Cache effect

Host ledger 和 Human status read 不改变模型请求或 cache reuse。

## Known Limitations and Deferred Work

- **单 Host writer** — 不支持多个进程并发写同一 dshHome；operation serialization 只在进程内生效。
- **永久 ledger** — M1 不提供 snapshot 或 compaction，storage 会随已提交协作事实增长。
- **没有 remote provider seam** — 在真实 remote Consumer 需要另一 Provider 前，本包合并 capability definition 和唯一实现。
