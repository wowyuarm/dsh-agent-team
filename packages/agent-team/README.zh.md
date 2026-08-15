# @deepseek-ai/dsh-agent-team

[English](README.md) | 中文

一个 dshHome 内唯一 Agent Team 的 Host capability。`ctx.agentTeam` 拥有 append-only operation ledger、重建当前协作 projection，并作为后续同一 capability 内 Member Agent 和 Delivery worker 的 lifecycle owner。[Agent Team 架构 Agent Note](../../../.agents/notes/proposed/architecture/2026-08-15-agent-team-operation-ledger.md)记录持久化和包拓扑决策。

## Service 约定

Service 依赖 `ctx.storageDomain`，并在 Cordis 发布 `ctx.agentTeam` 前打开带版本的 `agent_team` Domain。首次启动为稳定 Human Member 追加一条 `team/initialized` operation；后续启动重放同一 operation，不追加新记录。

`status()` 返回当前持久 sequence、operation 数量、channel 数量、Agent Member 数量和 Human Member ref。它不发起模型请求，也不写 storage。`validateLedger()` 对照持久 operation table 检查包内 projection。

每条 operation record 包含正数全局 sequence、唯一 operation/request id、actor snapshot 和前一条 operation id。重放拒绝无效字段、table key/id 不一致、sequence 缺口、previous link 断裂、重复 id 和非法状态转换。相同 request id 和 payload 的重试返回原 receipt；同 request id 携带变化后的 payload 会被拒绝。

## 持久化与生命周期

`storage-domain` 在持久读取处校验每条 record，并拒绝被其他版本标记的 backend unit。Team 只在 `KvTable.put()` 完成后更新 projection。其 Fiber 持有 Domain handle；dispose 通过 Cordis 移除拒绝新的 Service 调用，排空已接受的 Domain write，并在名称可重新打开前关闭 backend unit。

M1 支持单个 Host writer。Ledger 永久保留，不提供 snapshot 或 compaction。

## Composition

挂载 storage backend、`dsh-storage`、`dsh-storage-domain`、本 Service 及其 invariant companion。`/team` 等 Human control 是独立 Consumer。

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
