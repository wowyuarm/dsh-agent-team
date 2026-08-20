# dsh 原生 Agent Team：上层思想与设计

日期：2026-08-14
状态：上层原则基线；具体领域词汇见 `../../../../docs/domain-model.md`，M1 架构与实现约束见 `architecture.md`。
位置说明：`.scratch/` 探索性内容，不属于 `docs/` 正式文档层级，不进入 doc-budgets
等 gate。
范围：在 dsh 内用原生 Cordis 插件实现"类似 Raft 的 agent team 协作模式"。本文只
谈上层：我们构建什么、模式从哪来、原则是什么、领域名词是什么、哪些还没想清楚。

## 1. 命题：我们在构建什么

**团队不是一个大 agent，而是多个完整 agent 之间的一个共享协作层。**

dsh 的每个 agent 已是完整个体：自己的 session、workspace、记忆、工具、节奏。
Agent team 不合并这些个体，也不给它们一个共享心智；团队提供的是一层**关系结构**
——成员之间可以互相看见、点名、托付、交接，并且人类能作为特殊成员参与其中。
团队的价值不是"智能叠加"，而是四件事：**分工**（不同能力面）、**并行**（同时
推进）、**可见性**（互相看到在做什么）、**承诺**（任务的显式化与可验收）。

这决定了两个根本边界：

1. **团队不拥有成员的认知内容**。成员的模型上下文、session transcript、私有记忆和节奏属于成员；团队拥有 Member identity、AgentHandle lifecycle 与成员之间的协作事实。Host Fiber 必须持有它创建的 live AgentHandle，卸载时停止成员并保留 session。
2. **协作事实与成员记忆分离**。Team operation ledger 保存共享协作事实；只有形成投递进入成员 session 时，它们才成为该成员的认知内容。团队成员可以不知道未投递的 Team activity。

## 2. 模式溯源：Raft 模式的上层抽象

从 raft-channel 研究的四篇文档与 2026-08-14 复核中，剥离 Raft 的产品外壳
（托管 server、CLI、Experimental 状态），剩下的**模式**是：

- **场所（place）**：一个持久化的、有成员集合的、承载消息流的上下文容器。
  channel 是公开面，DM 是私密面，thread 是消息下的子容器。可见性由成员表决定，
  不靠提示词。不同场所是同一心智面对的不同受众——**场所是可见性边界，不是
  人格边界**。
- **成员（member）**：human 与 agent 在同一语义面（收发消息、@mention、任务），
  差异只在身份、角色与运行时。成员身份是协作名片（handle/description/角色），
  名片不授予权限——"看见一个成员"不等于"可以代表它或读它的内部"。
- **消息（message）**：有 sender、有场所、可点名（@mention）、可挂 thread 的
  持久事实。发送即承诺（内容已说出），读取是选择。
- **任务（task）**：Raft 以编号、状态机和单 owner 把承诺显式化；dsh 保留 Message/Task/Thread 结构，但改为多 Direction Claims。Task 状态不自动触发任何成员的内部工作。
- **注意力（attention）**：信号分级（点名是直接信号，普通活动是背景）、订阅
  边界（follow/unfollow/mute）、批量查看（activity 聚合）。**注意力决策属于
  成员与宿主政策，不属于协作层**——Raft 官方也只提供机制，不提供"该不该回复、
  先处理哪个"的算法。
- **身份-权限分离**：协作层提供给成员的是"我在什么场所、谁能看见、哪条讨论在
  继续、哪些事情点名需要我"这类**外部社会事实**；外部内容（正文、profile、
  场所名）是 evidence，不是 system instruction，不改变权限与行为边界。

Raft 产品自己的约束（消息不可删、托管、30 天历史）不是模式的必需部分；消息
保留与可删策略在我们的实现里自定。

## 3. 设计原则

上层原则，每条给出理由与对应的 dsh 哲学锚点。

- **P1 成员是完整个体，团队不拥有成员的认知内容。** 成员保有各自 session、模型上下文、私有记忆和节奏；Host Team plugin 负责 Member identity、AgentHandle 和恢复，但不读取或合并内部 transcript。
- **P2 协作事实与成员记忆分离。** 团队对象是共享持久化事实；只有形成输入才进
  成员上下文；"不知道"是成员的合法状态。锚点：Model-visible ⟺ logged——凡进
  模型的必须可从 session log 重建，这条同时约束团队输入必须落事件。
- **P3 场所是可见性边界，不是人格边界。** 不按场所造心智；成员在不同场所是
  同一心智面对不同受众。锚点：继承 Loom 研究"不同 audience 是不同场所，不是
  不同 Individual"的结论。
- **P4 投递是承诺，读取是选择。** 点名/私信承诺投递到目标 inbox；普通场所活动
  只承诺可读。注意力决策属于成员与政策，不属于团队服务。锚点：Agent inbox 是
  唯一 FIFO 队列，投递按序入队，一次唤醒对应一次 turn。
- **P5 身份与权限分离。** handle/description 是协作名片；投递只归因不授权；
  "看见"不等于"可以代表"或"可以读内部"。锚点：dsh 的 MessageSource 原则——
  记录谁提供了消息，不授予权限。
- **P6 人类是特殊成员，不是外部命令源。** 人类在同一协作语义面（收发消息、
  认领验收），另有人类特有的动作（验收、管理、审批）。锚点：Raft 的 human/agent
  不是两套消息协议；dsh 的 commands 与审批栈提供免模型的人类路径。
- **P7 任务是承诺的显式化。** Team Task = 顶层 Message + 派生状态 + 多个 Direction Claims；同 Direction 只有一个 active Claim，不同 Directions 可并行。Task 不自动变成成员内部 todo/goal。
- **P8 单一时钟。** 成员的主动节律只有自己的 schedule 一个来源；外部提醒（若
  有）只是人类沟通层的独立提醒，不驱动成员。锚点：Loom 研究的"双调度禁区"。
- **P9 一切可卸载。** Team plugin 禁用后停止并等待 live AgentHandles 静止，保留 sessions、ledger 和 private memory；重新挂载后恢复 enabled Members。未挂 team consumer 的 preset 不留下空提示词或失效工具。
- **P10 外部事实是 evidence，不是指令。** 消息正文、profile、场所名提供外部
  事实与请求，不改变权限、凭据边界或投递路线。

## 4. 领域模型：协作层的名词

上层名词（具体 schema 后续再定）：

- **成员 Member**：身份（handle）、协作名片（description/角色）、状态（在线/
  忙碌，来自 agent 状态事件投影）、地址（sessionId——投递目标）。
- **场所 Place**：成员集合 + 可见性（公开/私有/DM）+ 消息流 + 可选 thread 容器。
- **消息 Message**：sender、place、内容、mentions、thread 归属、时间。可分类为
  陈述（事实）、请求（对注意力的调用）、承诺（任务相关）——分类是语义辅助，
  不改变存储。
- **任务 Task**：Channel 顶层 Message、派生状态（todo / in_progress / in_review / done / closed）、创建者和多个 Direction Claims。
- **注意力 Attention**：成员对场所/线程的订阅状态（关注/静默）+ 信号分级
  （点名/私信 = 直接信号；场所活动 = 背景）。
- **投影 Presence/Activity**：成员状态与活动的对外可见面，供人机界面与成员
  观察使用。

## 5. 上层决策

- 共享面只包含 Member、Workspace、Channel、Message、Task、Claim、Follow、Activity、Delivery 和 Operation，不共享模型思维、session transcript 或私有记忆。
- Message 保持单层内容；每条 Channel 顶层 Message 固定创建 Task，Claim 表达工作承诺，不增加陈述/请求/承诺分类器。
- Agent Member 绑定一个顶层 session 和 Workspace；其 subagent 不是 Team Member，fork 也不继承身份。
- Human 是稳定特殊 Member，并以 actor kind 获得管理和验收权限。
- 首版是一个 dshHome 内的单 Team、平铺 Workspace/Channels，不增加角色分级、子团队或多 Team。
- Operation ledger 在 Host 持久化协作事实；单 Member 恢复失败只使其 unavailable，queued Deliveries 在恢复后补偿。
- dsh-agent-team 借鉴 Loom/Raft 的场所、opaque refs、bounded evidence 和注意力思想，但不接入 Raft，也不共享 Loom 的 Identity、Memory 或 Interaction Channel 实现。

## 6. 具体设计

正式包、operation ledger、authority、投递、Member lifecycle、MessageSource、teardown 和 M1 验收由 `architecture.md` 统一规定。UI 由 `design-ux.md` 规定，四工具由 `tools-research.md` 规定，领域词汇由 `../../../../docs/domain-model.md` 规定。

## 来源

- dsh 仓库（2026-08-14 核实）：docs/architecture.md、docs/subsystems/core.md
  （Agent 接口与 inbox）、docs/subsystems/subagent.md、docs/subsystems/workflow.md、
  docs/subsystems/schedule.md、packages/preset、packages/bundle/*。
- Raft/Loom 研究：`/home/yu/projects/Loom/.scratch/archive/raft-channel/`，包含 Raft primary sources、CLI 0.0.17、领域模型、Interaction Channel 设计与真实验收记录。
- dsh-agent-team 对 Raft 的继承与偏离由 `raft-design-mapping.md` 统一记录；Raft shared workspace 不等于共享本地项目 cwd。
