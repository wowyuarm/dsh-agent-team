# @deepseek-ai/dsh-agent-team

[English](README.md) | 中文

一个 dshHome 内唯一 Agent Team 的 Host capability。`ctx.agentTeam` 拥有 append-only operation ledger、重建当前协作 projection，并作为后续同一 capability 内 Member Agent 和 Delivery worker 的 lifecycle owner。[Agent Team 架构 Agent Note](../../../.agents/notes/proposed/architecture/2026-08-15-agent-team-operation-ledger.md)记录持久化和包拓扑决策。

## Service 约定

Service 使用 `ctx.storageDomain`、`ctx.workspaceRegistry`、`ctx.agents`、`ctx.agentDefaultModel`、`ctx.agentPresets`、`ctx.tools`、`ctx.sessions` 和 `ctx.sessionPersistence`，并在 Cordis 发布 `ctx.agentTeam` 前打开带版本的 `agent_team` Domain。首次启动为稳定 Human Member 追加一条 `team/initialized` operation；后续启动重放同一 operation，不追加新记录。

`status()` 返回当前持久 sequence、operation 数量、channel 数量、Agent Member 数量和 Human Member ref。它不发起模型请求，也不写 storage。`validateLedger()` 对照持久 operation table 检查包内 projection。

每条 operation record 包含正数全局 sequence、唯一 operation/request id、actor snapshot 和前一条 operation id。重放拒绝无效字段、table key/id 不一致、sequence 缺口、previous link 断裂、重复 id 和非法状态转换。相同 request id 和 payload 的重试返回原 receipt；同 request id 携带变化后的 payload 会被拒绝。

## 持久化与生命周期

`storage-domain` 在持久读取处校验每条 record，并拒绝被其他版本标记的 backend unit。Team 只在 `KvTable.put()` 完成后更新 projection。其 Fiber 持有 Domain handle；dispose 通过 Cordis 移除拒绝新的 Service 调用，排空已接受的 Domain write，并在名称可重新打开前关闭 backend unit。

创建 Member 时，先提交稳定的 Member/session/Workspace/preset/private-memory 身份，再执行 unpublished Agent setup。Setup 挂载指定 preset，并在发布前检查带 marker 的 `team_send` 和全部四个 Team tools。失败只把该 Member 标为 unavailable。Suspend 等待所属 `AgentHandle` 完全停止；resume 和 Host remount 恢复同一个持久 session。

每个 Team 管理的 session 都会持久写入 `danger-full-access`。项目 cwd 仍是 Workspace 路径，私有记忆位于 `$DSH_HOME/agent-team/members/<memberId>/`。普通 session 和 fork 不获得 Team 身份。

把 Member 加入 Channel 只授予之后的 read/send/claim authority，不向 Member session 注入历史 Message。Structured mention 会在 Message operation 内保存一个 queued Delivery，并固定 DeliveryId 与 MessageId。Host 使用 wakeup 将 member-authored `agent-team-relay` 送入 `next-step`，只有目标 session 出现匹配的 `agent/inbox/spliced` 或 `user/message` evidence 后才提交 `delivery-admitted`。重启恢复会复用已有 evidence，或使用同一个 MessageId 重试。Admitted 只表示已进入 Inbox，不表示模型已经处理。

Member reply 必须携带准确的当前 Thread revision，并在一个 operation 内更新 Message、Follow、Delivery 和 Thread facts。显式 follow/unfollow 是有序 Activity。结构化 mention 指向 unfollowed Member 时，必须先取得 process-local one-use confirmation token，首次调用不提交 operation；确认成功后重新建立 Follow。claim/done/release 是有序的 host-authored Activity。Active Claim 只排斥相同的 normalized Direction；不同 Direction 可以并行。显式 Human resolution 下 Task 为 `closed` 或 `done`；否则存在 active Claim 时为 `in_progress`，没有 active 但至少一个 done 时为 `in_review`，其余为 `todo`。Close 在同一 operation 内 release active Claims；reopen 保留 Claim 历史并重新派生状态。Member remove 先原子标记 inactive、release owned active Claims、清除 Follows、cancel queued Deliveries，再由 Host 等待 Agent 静止并归档 session。Message 与 Activity facts 共用一个有界 sequence cursor。

M1 支持单个 Host writer。Ledger 永久保留，不提供 snapshot 或 compaction。

## Composition

Bundle 使用 Host 已有的 singleton provider，不重复挂载 `agents`、默认模型选择、`tools`、`fs`、`sandboxPolicy`、Session store/persistence、Workspace registry 或 storage 的替代实现。Host services 只挂载一次，再挂载本 Service 及 invariant companion。`/team` 等 Human control 是独立 Consumer。

Team-enabled preset 在自身 Agent scope 注册四个工具，并用 `markAgentTeamPreset()` 标记 `team_send` definition。Tool row 应在执行时读取 `ctx.agentTeam`，不能静态 inject；否则 Host remount 恢复成员时会形成启动环。Scoped tool 重名会在 unpublished setup 阶段失败，只使对应 Member unavailable。Host service provider 重复则仍是 composition error，应删除重复行，不做叠加。

## Model Experience

### Host collaboration state

#### What the model sees

本包不向模型提供任何内容。`ctx.agentTeam` 不注册 prompt、tool、schema 或模型可见 message；面向模型的 Agent Team Consumer 拥有这些影响。

#### Token effect

Ledger、projection 和 Human status read 不增加模型 token。

#### KV Cache effect

Host ledger 和 Human status read 不改变模型请求或 cache reuse。

## Known Limitations and Deferred Work

- **单 Host writer** — 不支持多个进程并发写同一 dshHome；operation serialization 只在进程内生效。
- **永久 ledger** — M1 不提供 snapshot 或 compaction，storage 会随已提交协作事实增长。
- **没有 remote provider seam** — 在真实 remote Consumer 需要另一 Provider 前，本包合并 capability definition 和唯一实现。
