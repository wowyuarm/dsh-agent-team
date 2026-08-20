# dsh-agent-team 工作区索引

日期：2026-08-19
状态：D1-D27、M1、M2 functional baseline、UI native-feel redesign 与 Thread Inbox Ticket 01–06 均已完成。当前没有开放 ticket。
位置：本仓库 `.scratch/`（独立项目 dsh-agent-team；探索性内容，不走 docs gate）。

## 目的

在 dsh 上以原生 Cordis plugins 实现受 Raft 启发的 agent team 协作层，不接入 Raft 服务、不改 dsh 内核。dsh 借鉴 Member/Channel/Message/Thread/Task 等对象，但采用自动 Task、多 Direction Claims、Thread Attention、durable Inbox、默认静默和 baseRevision。

## 文档地图

| 文件 | 一句话定位 | 层级 |
| --- | --- | --- |
| `CONTEXT.md` | 领域词汇：Member、Workspace、Channel、Task、Claim、Thread Attention、Inbox、Activity、Operation | 词汇层 |
| `spec.md` | 综合 spec：问题、方案、用户故事、决策、测试、范围 | 交付物 |
| `design/panorama.md` | 上层思想与设计原则（成员认知独立、协作事实分离） | 思想层 |
| `design/architecture.md` | M1 当前架构：Cordis 平面、包、ledger、authority、生命周期、投递与验收 | 架构层 |
| `design/feasibility.md` | 可行性判定（R1-R12 → dsh 机制）+ **D1-D27 决策基线**（权威清单） | 决策层 |
| `design/raft-design-mapping.md` | Raft 产品事实、Loom 选择与 dsh 借鉴/偏离对照 | 决策层 |
| `design/design-ux.md` | M2 已实现的功能 UX、Client Slot 接管、Agent runtime 状态与延期边界；不是最终视觉基线 | 设计层 |
| `design/team-ui-redesign.md` | UI native-feel 重做基线：surface 架构、DSH 复用边界、桌面/窄屏布局、状态与验收 | 设计层 |
| `design/research/*.md` | 当前视觉审计、DSH public UI 复用清单、成熟协作产品模式 | 事实层 |
| `ui-redesign/README.md` | UI redesign handoff 唯一入口、阅读顺序、frontier 与开工门禁 | 交付物 |
| `ui-redesign/spec.md` | Client-only UI redesign 用户故事、约束、测试与交付顺序 | 交付物 |
| `ui-redesign/ticket-plan.md` | 6 张 UI vertical tickets 的依赖图、范围和验收 | 交付物 |
| `ui-redesign/issues/*.md` | UI-01 至 UI-06 本地 tickets | 交付物 |
| `design/dsh-client-plugin-development.md` | DSH Client plugin 开发基线：dsh.client、bundle、Cordis lifecycle、Slot takeover、Workspace 复用、测试接缝与 compaction 恢复点 | 实施基线 |
| `m2-ui/spec.md` | M2 第一阶段综合 spec：用户故事、实现决策、测试与明确延期 | 交付物 |
| `design/tools-research.md` | 工具集研究：Loom schema 借鉴点 + dsh 工具规范 + 候选形态 | 设计层 |
| `research/raft-design-details.md` | Raft 官方产品设计精读 | 事实层 |
| `/home/yu/projects/Loom/.scratch/archive/raft-channel/` | Raft primary sources、CLI/bridge facts 与 Loom Adapter 决策；仅作溯源参考 | 外部参考 |
| `prototype/task-state.html` | task 状态派生的可玩原型（另一 session） | 验证层 |
| `validation/2026-08-14-validation.md` | 首轮验证：12 项核心机制全过 + 修正清单 | 验证层 |
| `validation/2026-08-15-validation.md` | 第二轮全方位验证：上轮未验证项 + D23/D24 新机制（权威） | 验证层 |
| `validation/pitfalls.md` | 31 条动态验证与正式架构踩坑记录 | 验证层 |
| `issues/01-*.md` … `issues/09-*.md` | M1 九个已完成 tracer-bullet tickets | 实施层 |
| `m2-ui/issues/01-*.md` … `06-*.md` | M2 第一阶段六个 tracer-bullet tickets，含 blocking edges 与验收标准 | 实施层 |
| `research/raft-tools-prompt-2026-08-19.md` | Raft 官方 CLI、外部 Agent tools 与 orientation/wake 机制的一手资料调研 | 事实层 |
| `design/thread-inbox-member-context.md` | Thread Inbox、Team Member context、私有 memory 与灰色 mention 确认的设计草案 | 设计层 |
| `thread-inbox/README.md` | Thread Inbox 后续工作的唯一接续入口、阅读顺序、ticket 状态与 compaction 恢复规则 | 交付物 |
| `thread-inbox/spec.md` | 已确认的 Thread Inbox / Team Member Context 综合 spec | 交付物 |
| `thread-inbox/ticket-plan.md` | 六张后续 vertical tickets 的依赖图与交付范围 | 交付物 |
| `thread-inbox/issues/*.md` | Thread Inbox 01–06 本地 tickets，含 blocking edges 与验收标准 | 实施层 |

相互联系：`CONTEXT.md` 固定领域词汇；`spec.md` 是 M1 历史综合出口；`feasibility.md` 的 D1-D27 是 M1/M2 决策清单；`design/architecture.md` 是当前 Host 实现基线；`design-ux.md` 保存 M2 历史功能 UX；`design/team-ui-redesign.md` 保存已完成 UI redesign 基线；`thread-inbox/README.md` 是当前后续工作的唯一入口；`validation/` 保存真实机制证据。

## 决策基线状态

- **已定（D1-D27）**：D1-D22 固定范围模型与协作语义；D23 固定四工具；D24 固定 M1/M2/M3；D25 记录第二轮验证；D26 固定单 Host 可恢复范围与完整 M1 验收；D27 固定 M2 第一阶段 Team mode、Workspace/Channel/Thread/Agent UI、runtime presence、三席动态 take/restore，以及 Agent DM/Thread inbox 延期边界。
- **实现基线**：`design/architecture.md` 规定正式包、ledger record、authority、投递、AgentHandle 所有权、四工具、`/team`、invariant 和 teardown；字段级 TypeScript 类型与诊断文案在实现中按该基线收敛。

## 验证状态

- **首轮（2026-08-14）**：多 agent 共存、成员创建、安静/唤醒投递三原语、
  Model-visible ⟺ logged、乐观并发闭环、`KvTable.update` 原子 RMW、tokenMeter、
  Slot 挂载与 take（可逆）、`ctx.sessions.open` direct-chat 技术捷径（D27 已决定不直接暴露内部 Agent session，后续 DM 改为独立 transcript）。
- **第二轮（2026-08-15，全方位）**：compaction 实际触发（manual 真实摘要 +
  自动压力）、team-member preset 正反例、成员 create/resume（inbox 重放）、四工具
  全形态真实模型驱动、claim 多成员并发一胜一败、task 派生状态 13 组合、D19/D20/D15
  真实模型闭环、冷恢复补偿投递、invariant 正负例、`/team` 命令生命周期、
  MessageSource 合并点确认。
- **M2 functional baseline（2026-08-17）**：外部 bundle 安装、typed Remote、Team mode、Workspace/Agent/Channel/Thread、Claim/Task Human actions、SQLite replay、1440×960 与 390×844 browser journey 已完成（commit `9ae7cc3`）。
- **UI quality debt**：上述 browser evidence 只证明功能闭环、无横向 overflow 和可恢复性；当前 Team UI 大量重造控件、信息层级弱，与 DSH Web native-feel 不一致。改造依据见 `design/team-ui-redesign.md`。

## Ticket Frontier

- **M1 已完成**：`issues/01-boot-empty-agent-team.md` 至 `issues/09-ship-m1-runnable-composition.md`（REAL Loader/Agent/Session/command/tool/persistence workflow、SQLite 文件重开、durable failure windows、并发线性化、remove/archive 补偿、teardown、npm build/pack 与 opt-in preset shipping 均有自动验证）。
- **M2 functional baseline 已完成**：`m2-ui/issues/01-*.md` 至 `06-*.md` 的领域与交互闭环已交付。
- **UI redesign 已完成**：`ui-redesign/issues/01-*.md` 至 `06-*.md` 已完成；其视觉/UI 证据仍供后续 Inbox UI 修改参考。
- **Thread Inbox 完成（2026-08-20）**：Ticket 01–06 已全部完成；live preview、无模型 UI preview、确定性 browser replay 与 whole-trace acceptance 已交付。
- **实施边界**：Thread Inbox 改变 Host、ledger、typed Remote、tools、preset、Client 和 preview；仍不修改 Harness core、agent loop 或 shipped defaults。
- **本轮明确延期**：Agent DM、附件、搜索、URL、Model/provider 选择、跨 Workspace Inbox、浏览器/桌面通知和多 Human Members。

每个 ticket 必须独立保持其声明的验证路径成立；不要把 package 层完成当作 vertical slice 完成。
