# Thread Inbox / Team Member Context Handoff

状态：Ticket 01/02/03/04/05 已完成，Ticket 06 可开始

这是 Agent Team 下一阶段的唯一工作入口：Thread Inbox、Thread Attention、模型工具、Human Inbox、Team Member preset/private memory 和 preview 分层必须一起按本目录资料推进。

## 阅读顺序

1. 仓库根目录 [`AGENTS.md`](../../AGENTS.md) 与正式文档入口 [`docs/README.md`](../../docs/README.md)。
2. 领域词汇 [`../CONTEXT.md`](../CONTEXT.md) 与工作区地图 [`../map.md`](../map.md)。
3. 完整合同 [`spec.md`](spec.md)。
4. 实施顺序与依赖 [`ticket-plan.md`](ticket-plan.md)。
5. 从 [`issues/01-cut-over-durable-thread-attention.md`](issues/01-cut-over-durable-thread-attention.md) 开始，按 blocker 逐票实施。
6. 设计背景 [`../design/thread-inbox-member-context.md`](../design/thread-inbox-member-context.md) 与 Raft 一手资料 [`../research/raft-tools-prompt-2026-08-19.md`](../research/raft-tools-prompt-2026-08-19.md)。

## 当前实施状态

```text
01  Cut Over to Durable Thread Attention       complete
02  Make Agent Thread Collaboration Pull-Based complete
03  Wake Members from Durable Inbox State      complete
04  Human Inbox and Thread Attention UX        complete
05  Equip Team Members for Work and Memory     complete
06  Preview Modes and Whole-Trace Acceptance   ready
```

当前没有需要保留的持久 Team 数据。Ticket 01 已直接切换到新模型，Ticket 02 已验证最终五工具的拉取式 Agent 协作协议，Ticket 04 已完成 Human Inbox/Thread surface；不得引入旧工具名、旧 Follow/Delivery 路径、双读写、迁移或兼容层。Host/ledger、五个工具、durable Inbox wake、命令、Client 和 Remote 变更已通过当前测试、构建和浏览器检查。

## Compaction / 接续恢复

发生会话 compaction、handoff 或新的 Agent 接手时，先重新读取上述 1–5 项，再执行任何设计或代码判断。尤其不要仅凭旧的 M1/M2 文档推断注意力、未读、mention、投递或 Team prompt 行为：这些结论以本目录 `spec.md` 和已完成 ticket 的实现/测试为准。

实现前后都遵守：当前行为以 `packages/` 源码和测试为准；正式 `docs/` 只在对应实现被验证后更新。每张 ticket 完成时更新其状态、此 README、`../map.md`，以及受到实际行为改变影响的正式文档和 package README。
