# Agent Note: Agent Team operation ledger

Status: proposed

[English](2026-08-15-agent-team-operation-ledger.md) | 中文

## Problem

独立 Agent session 需要共享协作域，但不能共享模型上下文、transcript 或私有 memory。该域必须跨 Host 重启保存，在单一写入点执行 authority，将 message 投递到精确 member session，并在卸载时不保留 live Cordis 或 Agent reference。

`storage-domain` 只保证单条 record 的原子持久化，不提供跨 record 或 Session log 的 transaction。基于可变 task、member、follow 和 delivery table 的设计会在多 record mutation 失败后暴露部分提交的协作事实。Tool result 或 command lifecycle event 也无法与 Team storage 原子提交。

## Proposal

一个 dshHome 有一个 Agent Team。`@deepseek-ai/dsh-agent-team` 发布 `ctx.agentTeam`，并将 Service Definition 与唯一 local implementation 合并。它拥有带版本的 append-only operation ledger，通过 replay 重建当前 projection，串行化 Host write，并持有 Agent Member handle 和 Delivery worker。M1 package 保持 opt-in。

每个业务 mutation 写入一条 immutable operation record，其中包含全局 sequence、operation id、幂等 request id、timestamp、actor snapshot、带 discriminant 的 payload 和 previous operation id。只有 durable write 完成后才更新内存 projection 或发送 commit event。启动时校验 record 字段、table key identity、连续 sequence、previous link、operation/request 唯一性、由 authority 决定的状态 transition 和重建后的 projection。

第一条 operation 建立稳定 Human Member。相同 request id 的一致重试返回原 receipt；同一 request id 携带不同 actor、operation kind 或 payload 时拒绝。Tool Consumer 从 exact session 和 tool call 派生 request id。Human command 从 command execution identity 派生 request id。

Host capability、model Tool Consumer 和 Human command Consumer 分别位于 `dsh-agent-team`、`dsh-tool-agent-team` 和 `dsh-command-agent-team`。Team-enabled Agent preset 挂载 Tool Consumer 和 member-private compaction。Client UI 不属于 M1，之后通过同一 Host intent 的 typed JSON projection 消费数据。

一条 Channel 顶层 Message 创建一个 Task 和 Thread。工作状态从多个 Direction Claim 派生，Human accepted 和 closed 事实作为显式覆盖。Channel membership 授予 visibility，但不订阅普通 delivery。Mention 和 Follow record 创建持久 Delivery intent，其状态为 `queued`、`admitted` 或 `canceled`；admission 只表示 exact Inbox evidence 存在，不表示模型已处理或任务已完成。

Host Fiber 拥有 Domain、operation admission、Delivery worker 和所有 AgentHandle。Teardown 关闭 admission，使 confirmation token 失效，停止 notification，等待 worker 和 AgentHandle，排空已接受的 storage write，并关闭 Domain。持久 session 和 ledger record 在卸载后保留；remount 恢复 enabled member。

## Alternatives considered

**可变 domain table** 被拒绝，因为 `storage-domain` 不能原子更新 task、claim、follow、member 和 delivery record。为每种 mutation 增加 recovery marker 会重复 event log，同时产生更多待校验状态。

**以 Session log 作为 Team authority** 被拒绝，因为协作跨越独立 session，且一条 Team operation 不能原子追加到多个 log。Session event 继续作为 Inbox admission 和模型可见 provenance 的 evidence。

**在 M1 增加 provider registry** 被拒绝，因为当前只有一个 local implementation，也没有 remote Consumer。出现第二种实现时，capability 可以再拆分 Provider。

**采用 Raft 兼容的 task ownership 和 delivery** 被拒绝作为 governing model。Raft 仍是产品参考；dsh 保留自动 Task、非等价 Direction 的并行 Claim、默认静默的 Channel membership、显式 Thread revision 和本地 Delivery recovery。

## Acceptance criteria

M1 通过真实 opt-in Loader composition 启动，在 JSON 和 SQLite storage 上重放，提供 `/team` Human control 和四个 scoped model tool，创建 exact member session，证明 Inbox admission，支持 Claim/Follow/task lifecycle operation，并恢复每个 ledger、Inbox、member 和 teardown failure window。Package test、package-owned invariant、HMR disposal、keyless snapshot 和真实 composition smoke 覆盖这些路径。

## Risks

M1 的永久 ledger 不做 compaction。完整 replay 成本和 query index 延后到测量结果证明需要 snapshot 时再处理，且 snapshot 必须保留 audit 和 ref identity。单进程 serialization 不允许多个 Host writer。At-least-once Inbox admission 能证明 durable evidence，但不能证明模型处理或执行了某条特定 Delivery。
