# dsh Agent Team 可行性分析

日期：2026-08-14
状态：可行性分析，基于用户的初步需求清单（R1-R12）。所有判定对照 dsh 仓库
2026-08-14 的真实机制。
位置说明：`.scratch/` 探索性内容，不属于 `docs/` 正式文档层级。
方法：逐条需求 → dsh 现有机制 → 判定（✅ 现有机制直接支持 / 🟡 需新建但有明确
扩展点 / ❌ 有架构冲突）。具体实现设计（包结构、schema）留待澄清后展开。

## 需求基线（转述自用户初步想法）

- R1 Web UI 需要拓展：workspace 作为项目入口、channel 视图、agent 管理面板、
  task 展开视图、可能的 DM 功能。
- R2 一个 workspace 是项目的入口。
- R3 每个 session 是一个 channel；每个 channel 可选 1 个 human + 多个 agents
  （agents 可选）。
- R4 管理 agents 有专门面板：管理角色定位，以及可能拓展的 DM 功能。
- R5 channel 内发的一条消息默认作为一条 task；后续回复（讨论/claim/推进）使该
  task 能展开（thread）。对 agent 而言 session 不变，只在 UI/UX 上有区别。
- R6 agents 必须显式指定该 task thread 才能后续回复；没有指定不能默认发到
  channel（channel 的每条消息默认作为 task，但回复必须显式指定）。
- R7 同一 task 可以有多个 claim，但必须说明负责的方向与职责（如讨论、coding、
  review）。
- R8 task thread 中 agent 与人的相互回复只展示 agent 通过 message tool 发出来
  的消息，不展示各种 events。
- R9 agent 必须通过 message 显式发出消息。
- R10 agents 默认收不到 channel 通知；只有直接 @mention、或在 task thread 中被
  @mention 过（进入 follow），才收到；agent 可主动 unfollow thread 停止接收。
- R11 message 发送时若 task thread 出现新消息（agent 正处 tool call），应拒绝
  发送并说明有新消息到达、需重新组织。
- R12 新消息默认是追加 turn 的。

## 判定总表

| 需求 | dsh 机制 | 判定 |
| --- | --- | --- |
| R1 Web UI 拓展 | client 插件体系：Slots / Conversation nodes / typert RPC / `ui-*` 系列 | ✅ |
| R2 workspace 项目入口 | `ctx.workspaceRegistry`：持久化 workspace 记录、session 归属、顺序、归档 | ✅ |
| R3 session=channel | 见逐条分析 | 🟡 |
| R4 agent 管理面板 | Team Member registry + UI；M2 direct chat 打开 Member session，真正 Team DM 为未来 Place 类型 | ✅ |
| R5 消息即 task + thread 展开 | 团队消息对象（task 状态 + 父消息归属）+ UI 投影；agent session 不动 | ✅ |
| R6 显式指定 task thread | message 工具 schema 强制 target 参数，无 target 拒绝 | ✅ |
| R7 多 claim + 方向声明 | 自定 claim 模型（task × agent × 职责），不继承 Raft 单 owner | ✅ |
| R8 只显示 message 工具消息 | 团队消息流独立记录；agent 内部 events 留在各自 session log | ✅ |
| R9 显式 message 发送 | 对外发言唯一通道 = message 工具 | ✅ |
| R10 通知模型 | 投递策略逻辑：mention/follow/unfollow → `Agent.send` | ✅ |
| R11 并发拒绝发送 | 乐观并发：base revision 对比 + 工具返回错误，模型重新组织 | ✅ |
| R12 追加 turn | `InboxTarget`：`'next-step'`（追加当前 turn 下一步）/ `'next-turn'` | ✅ |

结论先行：**全部需求在 dsh 上可行**，无一条需要改 agent loop（符合"plugins, not
loop changes"）。R3 的"session=channel"需要一个语义澄清（见 D1），但实现可行。
主要新建面是：团队对象服务、message 工具、投递策略、Web UI 拓展。

## 逐条分析

### R1 Web UI 拓展 —— ✅

dsh 的浏览器 UI 本身就是插件面：`dsh.client` 包声明进 client modules，Slots 承载
可插拔区域，Conversation Node 引擎渲染会话内卡片，typert RPC 提供 client→host
数据通道。channel 视图、agent 管理面板、task 展开视图都是新的 client 插件，不
触碰 agent loop。现有 `ui-workspace` / `ui-sidebar` / `ui-agent-preset` 是直接
先例。

### R2 workspace 作为项目入口 —— ✅

`ctx.workspaceRegistry` 已存在：持久化 workspace 记录（按真实路径 canonical 化）、
session 按 cwd 归属、稳定顺序、归档。GUI 已有 workspace 分组。把 workspace 用作
"项目入口"是它已有的定位，团队层只需在 workspace 上挂 channel/成员对象。

### R3 每个 session 是一个 channel —— 🟡（语义澄清 D1）

dsh 的 session 是 **per-agent** 的：一个 session 被一个 agent 驱动，session log
由该 agent 的 loop 写入。而用户描述的 channel 是多成员容器（1 human + 多 agents）。
两者不能直接等同：**多个 agents 共用一个 channel ≠ 多个 agents 共用一个 session**。

可行的映射（推荐）：**channel 是团队层持久化对象**（有自己的消息流与成员表），
UI 上每个 channel 显示为一个"会话"视图；每个 agent 成员仍有自己的 session
（channel 消息按 R10 规则投递到其 inbox/session）。agent 的 session 不被 channel
结构改变（R5 的"session 不变"与之一致）。纯 human 的 channel（无 agent）也成立，
因为它不依赖某个 agent 的 session。

### R4 agent 管理面板 —— ✅

角色定位 = 团队成员的 description/role 字段（团队成员注册表），管理面板是 client
插件 + typert RPC 的增删改。DM 功能 = 一种场所类型（成员间私有场所），列为拓展
项，不影响首版结构。

### R5 消息即 task + thread 展开，agent session 不变 —— ✅

任务对象 = 顶层消息 + task 状态；thread = 消息的父归属结构（单层）。这与 Loom
raft-channel 研究的结论完全一致："外部 reply thread 只是消息回复容器，不是
agent 的内部工作线"——在 dsh 里 thread 同样只是团队消息的归属字段，agent 的
session/工作线不受影响，UI/UX 上的"展开"纯属投影。

### R6 显式指定 task thread —— ✅

message 工具的 schema 要求 target（task/thread 引用）为必填；工具实现拒绝无
target 的调用（返回错误而不是猜测默认）。"channel 消息默认作为 task，但回复必须
显式指定"= 创建 task 时自动绑定 channel，后续消息必须携带 task 引用。工具层
校验即可，不需要新机制。

### R7 多 claim + 方向声明 —— ✅

与 Raft 的单 owner 不同，我们的 claim 模型自定：一条 claim 记录 =（task, agent,
职责方向, 状态）。同一 task 可有多个并行 claim（讨论/coding/review 各司其职）。
团队任务表按此设计即可，无外部协议约束。
已决（D5，2026-08-14）：同方向互斥——同一 task 同一方向只允许一个 claim，原子
校验；不同方向并行（讨论/coding/review）。这保留了 Raft"claim 抢占防重复"的
原子性，同时支持多职责并行。

### R8 thread 只显示 message 工具的消息 —— ✅

团队消息流是**独立的持久化记录**，只有 message 工具写入。agent 的内部 events
（tool calls、thinking、内部事件）留在各自 session log，不进入团队消息流。UI 的
channel/thread 视图只渲染团队消息流。这与 dsh 哲学天然一致：session log 是内部
事实（可审计），团队消息流是协作投影（可展示）——两者分离，谁也不污染谁。

### R9 显式 message 发送 —— ✅

对外发言的唯一通道是 message 工具；其他工具（bash/fs 等）在权限设计上不写团队
消息流。这是工具面的边界设计，不需要新机制。

### R10 通知模型（默认静默，mention/follow 才投递，可 unfollow）—— ✅

投递策略是 dsh 的本地 policy，不是 Raft 原样语义。Raft 将 joined-channel membership 与 ordinary delivery 绑定；dsh 将 Channel 可见性和 Inbox notification 分开，只对 structured mentions 与 Thread followers 建 queued Delivery。Unfollow 停止普通订阅投递，`team_view` 保留主动读取；投递经 `Agent.send(message, target, wakeup)` 进入 Agent Inbox。

### R11 并发拒绝发送 —— ✅

乐观并发控制：agent 上下文中看到的 thread 版本 = base revision；message 工具
调用携带该 revision；工具执行时对比团队消息流的当前 revision，不一致则返回错误
（说明有新消息到达），模型在同一 turn 内重新组织。dsh 的工具管线支持工具返回
错误让模型修正，时序自洽（新消息按 R12 追加为当前 turn 下一步输入，模型重新
组织时已经可见）。
溯源更正（2026-08-14）：raft-docs 中不存在 held/draft/--anyway 的文档化设计
（全仓库 grep 无命中）；该行为只在 CLI 0.0.17 的 `message send --send-draft` /
`--anyway` 中存在（Loom 研究 tarball 验证）。本需求在 dsh 上是自研实现（base
revision 检查），灵感来自 CLI 行为而非 Raft 文档语义；dsh 的 turn 内修正取代了
CLI 的 draft 文件机制。

### R12 默认追加 turn —— ✅

`Agent.send` 的 `InboxTarget` 只有两个值：`'next-step'`（追加为当前 turn 的下一
步边界，不打断）与 `'next-turn'`（排队新 turn）。"默认追加"= 投递默认走
`next-step`，恰好是 dsh 的既有语义。见 D2 澄清。

## 已确认的设计决策（2026-08-14 与用户确认）

- **D1（R3）channel 与 session 的映射**：channel 是团队层持久化对象，UI 上显示
  为会话视图；每个 agent 成员有自己的 dsh session，channel 消息按通知规则投递
  到各自 inbox。
- **D2（R12）"追加 turn"语义**：新消息默认追加为当前 turn 的下一步输入
  （`InboxTarget: 'next-step'`，不打断当前工作）。
- **D3（R10 推论）任务知晓方式**：主动查看与 @mention 并行——agent 有主动查看
  工具（列出待认领 task、场所活动），可在自己节奏内主动 claim；@mention 是
  即时投递的直接信号。
- **D4（R5 推论）task 生命周期**：首版带状态机（todo → in_progress → in_review
  → done / closed），与 claim 绑定流转；done 需明确验收。
- **D5（R7 补充）claim 防重复**：同一 task 同一方向只允许一个 claim（原子校验），
  不同方向并行——保留 Raft 防重复的原子性，同时支持多职责并行。
- **D6（R5 补充）消息-task 收束**：每条顶层消息默认建 task（初始 todo）；无承诺
  消息可由人或 agent 标 closed 收束；board 视图默认隐藏 closed。
- **D7（Q1，D26 精确化）团队范围**：一个 dshHome 一个 Team；Channel 归 Workspace；Human 为 Host 级管理员，Agent Member 绑定一个 Workspace/session/cwd，只能加入该 Workspace 的 Channels。
- **D8（Q2）消息保留**：首版无删除/编辑，消息发出即 effect。
- **D9（Q3）human 身份**：首版单 human（当前 GUI 用户）。
- **D10（Q4）follow**：发言即 follow；thread 的每个新消息都构建 prompt 投递给
  参与该 thread 的 agent。
- **D11（Q5）task 验收**：agent 可用 task tool 自行完成 task（done 不强制 human
  验收）；human 仍可验收。
- **D12（Q6）claim 方向**：自由文本 + 工具描述推荐词；claim 状态（含其他 agent
  的 claim 与方向）展示给模型作为预防，同方向互斥的原子校验作为兜底。
- **D13（Q7，D26 补全）Agent Member 管理**：创建时指定 handle、description、Workspace 与显式 team-enabled preset；成功后 enabled/live。Suspend 停止 AgentHandle 并保留 session、Claims、Follows 与 queued Deliveries；Remove 不可逆，归档 session、保留 inactive Member record 和历史。
- **D14（Q9）mention 两侧语法**：agent 侧结构化 `mentions` 参数（投递目标）；
  正文可含 @handle 展示文本（不解析）；human 侧输入框成员选择器（显示 name 与
  description，复用现有组件）。
- **D15（Q10，D26 修订）unfollow-mention 检查**：mention 始终穿透且重新 Follow；首次发送拒绝并返回绑定 sender、Thread revision 与 recipient set 的一次性 confirmation token，第二次 `team_send` 必须显式携带 token。状态变化或 provider unload 后 token 失效。
- **D16（Q13，D26 补全）Task 状态规则**：Claims 是工作进度的唯一输入，Human accepted/closed 是显式覆盖事实；无 Claim → todo；存在 active → in_progress；无 active 且至少一个 done → in_review；accepted → done；closed → closed。Done/closed 后必须 reopen；close 自动 release active Claims，reopen 保留 Claim 历史并重新派生。Agent 完成自己的 Claim，Task done 由 Human 验收。
- **D17（Q15）agent 顶层消息**：允许；target=channel 引用即创建新 task（初始
  todo，D6 对 agent 同样生效）。Agent 发顶层消息的典型意图 = 创建任务以分配；M1 讨论走 Thread，真正 Team DM 留待独立 Place 设计。
- **D18（Q16）human 操作面**：human 可 claim；human 可操作任何 claim 的状态
  （标 done = 验收实质）；human 可标 closed。thread 视图展示全部 agents 及其
  claim 状态。
- **D19（Q19）claim 状态变化通知**：作为 thread 事件投递给该 thread 的全部
  follow 成员（构建 prompt）；human 操作通知被操作 agent 是此规则的实例。
- **D20（Q20）成员移除**：active claim 自动 release（task 状态重新派生）；
  历史消息保留（sender 显示已移除）；session 归档（log 保留）；follow 状态
  清除不再投递；成员记录标记 inactive（保审计）。
- **D21（Q8）channel 创建与管理权限**：首版 human 专属——human 在 UI 建 channel
  （名称 + 初始成员）、加/移成员；agent 不能建 channel、不能改成员。后续视需要
  开放给 admin 级 agent。
- **D22（原型验证结论，2026-08-14）**：核心机制在真实 dsh 进程全部验证通过
  （validation/2026-08-14-validation.md）：peer 投递三原语（`inject` /
  `send(msg,target,wakeup)` / `followup`）行为符合 D2/D10；投递内容可完整从
  session log 重建（Model-visible ⟺ logged）；乐观并发（R11）在真实模型行为上
  闭环（conflict → 重组织 → 重发成功）；claim 同方向互斥原语 = `storageDomain`
  + `KvTable.update` 原子 RMW（team 对象持久化落点确认）；tokenMeter 可用
  （compaction 测量端）；client Slot 挂载与 take（`sidebar.workspaces`、
  `conversation`）可行可逆；M2 direct chat = `ctx.sessions.open(id)`（不是 Team DM）。修正：compaction 是
  可选 capability，team preset 需显式挂 compaction-basic 行；`MessageSource`
  正式包用声明合并新增 `team` kind（动态验证以 `plugin` kind + `form:'relay'`
  替代）。未验证留正式实现：冷恢复补偿投递、compaction 实际触发、claim 多成员
  并发端到端、take 后完整渲染面。
- **D23（Q18）工具集最终形态（2026-08-15 拍板）**：四工具——`team_send`
  （target: task/thread ref 或 channel ref + mentions + base_revision；execute
  内两项发送前检查）、`team_view`（bounded 读 + opaque refs + sender/claim 状态，
  纯读）、`team_claim`（action: list | claim | done | release；claim 带 taskId +
  方向，同方向互斥原子校验；done/release 仅操作自己的 claim；list 含全部 claim
  状态）、`team_follow`（action: unfollow | follow | status）。schema 借鉴 Loom
  raft tools（opaque refs / bounded evidence / action 形态 / canonical value
  与 prose 分离），详见 tools-research.md §3。
- **D24（Q21，D26 补全）里程碑**：M1 机制核心（Host Service + 四工具 + team-enabled preset + isolate compaction + relay/activity MessageSources + invariant + 完整 `/team` + REAL composition/reliability tests，不做新 UI）→ M2 UI（#channel、Channel/Thread、Agents、Member direct chat）→ M3 ledger snapshot、attention aggregation 与性能。
- **D25（第二轮全方位验证结论，2026-08-15）**：上轮未验证项 + D23/D24 新机制全部
  验证通过（validation/2026-08-15-validation.md）：compaction manual 与自动压力
  实际触发、team-member preset 正反例、成员 create/resume（含 inbox 重放）、四工具
  全形态真实模型驱动、claim 多成员并发一胜一败、派生状态 13 组合、D19/D20/D15
  闭环、冷恢复补偿、invariant 正负例、`/team` 命令、MessageSource 合并点确认。
  以下保留原型时点结论，其中 (3)(4) 已由 D26 正式收敛或替换。精确化：(1) 成员创建/恢复由 team 服务执行时，setup 必须显式
  `agentPresets.mount(agentCtx, presetId)`——`meta.agentPreset` 只写 session
  header，agent-loop 工厂不自动挂载；(2) 投递 durable 证据分两段：停驻 inbox =
  `agent/inbox/spliced`（inserted 含 message id），认领后 = `user/message`，
  invariant 据此双证据判定；(3) 原型将 done+release 混合定为 in_review，D26 已正式采纳；(4) 原型使用 per-sender 二次放行 cache，D26 已替换为显式 confirmation token；(5) 发送者按 memberId 排除自投递，mention 必须
  落 follow 行（R10/D15"被 @mention 即 follow"）；(6) 动态插件创建的成员归创建
  fiber 所有（插件更新即 dispose），M1 的成员创建必须落在 host 行、重启后 resume；
  (7) client 两席 take+渲染已激活验证：occupants 实测 take 成功、host.call 数据流
  回写、零诊断错误、用户目视确认 + stop/run 循环证明可逆。
- **D26（正式架构复核与 grill，2026-08-15）**：M1 限定为一个 dshHome 内的单 Host 可重启 Team；投递承诺 at-least-once Inbox admission，不承诺模型处理 exactly-once。Team Domain 用 append-only operation ledger 作为唯一持久权威，每个业务操作单 record 原子提交；全局 sequence 排序，Thread revision 只受该 Thread 的 Message/Activity 影响。Agent tool 由 exact live Agent 绑定 Member authority，Agent 只能访问显式加入的 Channel；Human 是稳定特殊 Member和唯一管理员。Agent Member 绑定一个 Workspace/session/cwd，成员共享项目 cwd、私有记忆按 memberId 隔离；只允许显式 team-enabled preset。Plugin unload 停止 AgentHandle 但保留 session，suspend 可恢复，remove 不可逆，fork 不继承身份。Task 的 done/closed 必须 reopen 后继续，close 自动 release active Claims，done+released 无 active 为 in_review。D15 改为显式 confirmation token。Delivery 状态限定 queued/admitted/canceled，idle follower 投递会唤醒。Member relay 与 host Activity 使用不同 MessageSource kind。M1 `/team` 覆盖完整机制，并要求 HMR、REAL composition、keyless snapshot、JSON/SQLite restart、幂等和崩溃窗口 failure injection。完整架构见 `architecture.md`。

## 实现形态（2026-08-15 确认）

以 **dsh-plugin 方式**展开：全部能力以 Cordis 插件行挂载，不修改 dsh 内核、不改
agent loop。三个平面的插件行：

- **host 组合行**：`ctx.agentTeam`、operation ledger、authority、Member AgentHandle、queued/admitted/canceled Delivery 补偿和 host projection。Host Fiber 卸载时停止 live Members 并保留 sessions；重新挂载后恢复 enabled Members。
- **preset 行**：显式 team-enabled preset 贡献四工具、team guidance 和 isolate 内 compaction。Preset 不是 Member 身份或持久化来源；Member record + session log + ledger 共同提供恢复事实。
- **client 插件行**：M2 提供 workspace 入口、Channel/Thread 视图和 Agent 管理，只经 typed JSON RPC 访问 Host projection。Slot 落点见 design-ux.md §2-3。

M1 包按真实演进角色拆为 `dsh-agent-team`、`dsh-tool-agent-team` 和 `dsh-command-agent-team`；M2 再增加 Client UI package。完整接口与所有权见 `architecture.md`。

## 结论

在 dsh 上搭建这套 agent team **可行**，判定依据是 dsh 的四个既有事实：

1. **投递管道现成**：`Agent.send(message, target, wakeup)` + inbox 唯一队列 +
   `next-step`/`next-turn` 边界，正好覆盖 R10-R12 的全部投递语义。
2. **持久化与可重建现成**：session log 是每 agent 的 durable 事实（Model-visible
   ⟺ logged 约束团队输入必须落事件）；团队对象持久化可循 session-persistence /
   workspace registry 的现有模式。
3. **UI 是可插拔面**：client 插件 + Slots + Conversation nodes + typert，R1/R4
   的 UI 拓展是插件工作，不触碰内核。
4. **无需改 loop**：所有需求落在工具层、服务层、UI 层——正是 dsh "plugins, not
   loop changes" 的扩展点。

主要新建面（待澄清后展开设计）：团队对象服务（成员/场所/消息/task/claim +
持久化）、message 工具（强制 target + revision 检查）、投递策略服务、Web UI
（workspace 入口、channel 视图、agent 面板、task 展开）。三块均有 dsh 现有
模式可循，无未知技术风险。

## 来源

- dsh 仓库（2026-08-14）：`packages/core/agent/src/types.ts`（`Agent.send`、
  `InboxTarget`）、`packages/workspace/workspace/README.md`（workspace registry）、
  `packages/client/*`（client 插件体系）、`docs/subsystems/core.md`、
  `docs/architecture.md`。
- 需求基线：用户本会话提供的 R1-R12 初步想法。
