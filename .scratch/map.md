# dsh-agent-team 工作区索引

日期：2026-08-15
状态：D1-D26 与 M1 架构已冻结；两轮原型验证完成；M1 已拆为 9 个本地 tracer-bullet tickets。Issue 01-08 已完成，当前 frontier 是 issue 09。
位置：本仓库 `.scratch/`（独立项目 dsh-agent-team；探索性内容，不走 docs gate）。

## 目的

在 dsh 上以原生 Cordis plugins 实现受 Raft 启发的 agent team 协作层，不接入 Raft 服务、不改 dsh 内核。dsh 借鉴 Member/Channel/Message/Thread/Task/Follow 等对象，但有意采用自动 Task、多 Direction Claims、默认静默、baseRevision 和本地 operation-ledger Delivery。

## 文档地图

| 文件 | 一句话定位 | 层级 |
| --- | --- | --- |
| `CONTEXT.md` | 领域词汇：Member、Workspace、Channel、Task、Claim、Activity、Delivery、Operation | 词汇层 |
| `spec.md` | 综合 spec：问题、方案、用户故事、决策、测试、范围 | 交付物 |
| `design/panorama.md` | 上层思想与设计原则（成员认知独立、协作事实分离） | 思想层 |
| `design/architecture.md` | M1 当前架构：Cordis 平面、包、ledger、authority、生命周期、投递与验收 | 架构层 |
| `design/feasibility.md` | 可行性判定（R1-R12 → dsh 机制）+ **D1-D26 决策基线**（权威清单） | 决策层 |
| `design/raft-design-mapping.md` | Raft 产品事实、Loom 选择与 dsh 借鉴/偏离对照 | 决策层 |
| `design/design-ux.md` | agent 持久化模型 + UI/UX 结构 + client Slot 落点与风险 | 设计层 |
| `design/tools-research.md` | 工具集研究：Loom schema 借鉴点 + dsh 工具规范 + 候选形态 | 设计层 |
| `research/raft-design-details.md` | Raft 官方产品设计精读 | 事实层 |
| `/home/yu/projects/Loom/.scratch/archive/raft-channel/` | Raft primary sources、CLI/bridge facts 与 Loom Adapter 决策；仅作溯源参考 | 外部参考 |
| `prototype/task-state.html` | task 状态派生的可玩原型（另一 session） | 验证层 |
| `validation/2026-08-14-validation.md` | 首轮验证：12 项核心机制全过 + 修正清单 | 验证层 |
| `validation/2026-08-15-validation.md` | 第二轮全方位验证：上轮未验证项 + D23/D24 新机制（权威） | 验证层 |
| `validation/pitfalls.md` | 31 条动态验证与正式架构踩坑记录 | 验证层 |
| `issues/01-*.md` … `issues/09-*.md` | M1 九个 tracer-bullet tickets，含 blocking edges 与验收标准 | 实施层 |

相互联系：`CONTEXT.md` 固定领域词汇；`spec.md` 是综合出口；`feasibility.md` 的 D1-D26 是决策清单；`design/architecture.md` 是 M1 当前实现基线；`design-ux.md` / `tools-research.md` 展开 UI 与工具；`raft-design-mapping.md` 记录 Raft 溯源；`validation/` 保存真实机制证据。

## 决策基线状态

- **已定（D1-D26）**：D1-D22 固定范围模型与协作语义；D23 固定四工具；D24 固定 M1/M2/M3；D25 记录第二轮验证；D26 固定单 Host 可恢复范围、at-least-once admission、operation ledger、严格成员权限、Thread revision、Task 终态、显式 confirmation token、Workspace/Member 关系、Member suspend/remove、两类 MessageSource 与完整 M1 验收。
- **实现基线**：`design/architecture.md` 规定正式包、ledger record、authority、投递、AgentHandle 所有权、四工具、`/team`、invariant 和 teardown；字段级 TypeScript 类型与诊断文案在实现中按该基线收敛。

## 验证状态

- **首轮（2026-08-14）**：多 agent 共存、成员创建、安静/唤醒投递三原语、
  Model-visible ⟺ logged、乐观并发闭环、`KvTable.update` 原子 RMW、tokenMeter、
  Slot 挂载与 take（可逆）、M2 Member direct chat 复用 `ctx.sessions.open`（不是 Team DM）。
- **第二轮（2026-08-15，全方位）**：compaction 实际触发（manual 真实摘要 +
  自动压力）、team-member preset 正反例、成员 create/resume（inbox 重放）、四工具
  全形态真实模型驱动、claim 多成员并发一胜一败、task 派生状态 13 组合、D19/D20/D15
  真实模型闭环、冷恢复补偿投递、invariant 正负例、`/team` 命令生命周期、
  MessageSource 合并点确认。
- **待收尾**：无。client 两席 take+渲染已由用户目视确认，验证插件已停止。
  后续清理（`cordis_undefine` 两个验证插件、删除验证 preset 与 domain 文件）为
  可选项，保留作 M1 参考。

## M1 Ticket Frontier

- **已完成**：`issues/01-boot-empty-agent-team.md` 至 `issues/08-recover-durable-failure-windows.md`（本地 dev 基线：tsconfig paths 别名到 sibling deepseek-harness 源码，vitest + tsc 双绿；REAL composition 与 SQLite 文件重开已覆盖 durable failure windows、并发线性化、remove/archive 补偿、teardown 和重挂重建）。
- **可立即开始**：`issues/09-ship-m1-runnable-composition.md`。
- **可靠性与组装**：08 等待 01-07；09 等待 01-08。

每个 ticket 必须独立保持其声明的验证路径成立；不要把 package 层完成当作 vertical slice 完成。
