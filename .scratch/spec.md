# Spec: dsh 原生 Agent Team（Raft 模式的 plugin 化实现）

日期：2026-08-14
状态：M1 已交付；M2 第一阶段细化见 `m2-ui/spec.md` 与 `design/design-ux.md`。探索性内容，未进入正式 docs 层级。

## Problem Statement

用户想在 DeepSeek Harness 上构建一个 agent team——多个 agent 与人类在同一项目
（workspace）下协作，而不是单个 agent 配工具。团队需要：每个成员有自己的持久
身份、workspace 与连续上下文；channel 作为协作场所；消息、task、claim 是协作
的原子事实；注意力按需投递（默认静默，点名/关注才打扰）；人类在 Web UI 里看到
团队全貌并能管理、验收、介入。约束：一切以 dsh-plugin 方式实现，不修改 dsh 内核、
不改 agent loop；模式借鉴 raft.build 的团队协作设计，但不接入 Raft 服务。

Raft 只提供产品参考。自动 Task、多 Direction Claims、默认静默、baseRevision、operation ledger 和 queued/admitted/canceled Delivery 是 dsh 的本地决定，不按 Raft 的显式 task conversion、单 owner 或 joined-channel ordinary delivery 复刻。

## Solution

以原生 Cordis capability `dsh-agent-team` 在一个 dshHome 内实现单 Host、可重启的团队协作层，不修改 agent loop。M1 的 `dsh-agent-team` Host package 持有 operation ledger、authority、Member AgentHandles 和 Delivery 补偿；`dsh-tool-agent-team` 由显式 team-enabled preset 挂载；`dsh-command-agent-team` 提供临时 `/team` human adapter。M2 增加 Team Client UI。

Operation ledger 是 Team 唯一持久权威，每次业务修改以一个 record 原子提交。消息发出即 effect且不可编辑/删除；每条 Channel 顶层消息创建 Task；Task 工作状态从 Claims 派生；attention 默认静默，仅 mention 与 Follow 产生 queued Delivery；投递承诺 at-least-once Inbox admission，不承诺模型处理 exactly-once；admitted 只表示目标 session 有可重建的 Inbox evidence。

## User Stories

1. 作为 human，我想在 workspace 下创建并命名 channel，以组织一个项目的协作。
2. 作为 human，我想把 agent 成员加入/移出 channel，控制每个场所的参与者。
3. 作为 human，我想在 Agents 面板创建 agent（name、description、preset），团队
   增加一个成员。
4. 作为 human，我想编辑 agent 的 name/description，让分工表达保持准确。
5. 作为 human，我想查看 agent 的 workspace（memory.md 与 notes/），了解它的记忆
   与笔记。
6. 作为 human，我想在 M2 后续通过独立 Human-visible DM transcript 与 Agent Member 对话，同时让 Agent 内部 session 保持 append-only；该 DM 的持久化与投递在第一阶段 UI 后单独设计。
7. 作为 human，我想在 channel 发消息且它自动成为一条 task，任何承诺都被追踪。
8. 作为 human，我想在消息中 @ 成员（输入框成员选择器，显示 name 与 description），
   点名需要它处理的人或 agent。
9. 作为 human，我想点击消息底部的 `#n` 标签进入 task thread 视图，看到该 task
   的讨论、参与者与 claim 状态。
10. 作为 human，我想在 thread 视图手动操作任一 claim 的状态（如标 done），且该
    操作会通知被操作的 agent（构建 prompt）。
11. 作为 human，我想在 agent 们全部完成后验收 task（in_review → done）。
12. 作为 human，我想把无承诺消息或不再做的 task 标 closed 收束（可 reopen）。
13. 作为 human，我想看到每个 task 上全部 agent 的 claim 与方向，知道谁在 coding、
    谁在 review。
14. 作为 human，我想移除一个 agent 成员，其 active claim 自动释放、历史消息保留、
    其 session 归档。
15. 作为 agent，我收到被 @mention 的消息（构建 prompt 投递），知道自己被点名。
16. 作为 agent，我 follow 的 thread 的每个新消息都会投递给我（构建 prompt）。
17. 作为 agent，我在某 thread 发言即自动 follow 它，之后能收到它的后续回复。
18. 作为 agent，我主动 unfollow 一个 thread 停止被它的普通回复打扰，但 mention
    仍能穿透并重新 follow。
19. 作为 agent，我可以在 Channel 发顶层 Message 创建新 Task（如分配任务）；M1 的协作讨论走 Task Thread。
20. 作为 agent，我回复时必须显式指定 task thread（不带 target 的发送被拒绝）。
21. 作为 agent，我 claim 一个 task 并声明方向（如 coding/review），方向是同方向
    互斥的（同方向重复 claim 被原子拒绝）。
22. 作为 agent，我主动查看待认领 task 与各 claim 状态（不依赖被 @）。
23. 作为 agent，我完成自己的 claim（done）或释放（release），claim 状态变化会
    通知该 thread 的全部参与成员。
24. 作为 agent，我发送消息时若 thread 出现了新消息，发送被拒绝并提示重新组织
    （携带 base revision 检查）。
25. 作为 agent，我 mention 一个已 unfollow 该 Thread 的成员时被提示重新思考；首次拒绝返回 confirmation token，第二次显式携带该 token 才放行。
26. 作为 agent，我的上下文是 append-only 的，token 达到阈值自动 compaction。
27. 作为 agent，我的 workspace 就是 memory.md 与 notes/，我的记忆与笔记都在那里。
28. 作为 agent，投递给我的新消息默认追加到我当前 turn 的下一步，不打断我正在
    做的工作。
29. 作为 agent，我完成自己的 claim 后，若全部 claim 都 done，task 进入 in_review
    等待 human 验收，而不是自动完成。
30. 作为 agent，我的团队输入携带 sender、场所、可见成员与回复落点的事实，我能
    判断对谁、在哪里发言。
31. 作为 agent，未启用团队插件的我完全没有团队面（无工具、无提示词段）。
32. 作为团队成员（human 或 agent），我在 channel/thread 视图中只看到成员显式
    发出的消息，看不到任何人的内部 events。
33. 作为团队成员，task 状态变化（含 claim 变化）作为 thread 事件对所有参与成员
    可见，团队共享同一份进度事实。

## Implementation Decisions

- **Cordis 平面**：Host 挂 `ctx.agentTeam` 与持久化；显式 team-enabled preset 挂四工具、guidance 和 isolate compaction；M2 Client 只经 typed JSON RPC 访问 Host projection。不改内核或 agent loop。
- **正式包**：M1 为 `dsh-agent-team`、`dsh-tool-agent-team`、`dsh-command-agent-team`；只有一个 Provider 和一个 Team，不增加 registry、TeamId 或 transport selector。
- **团队范围**：一个 dshHome 一个 Team；Channel 归 Workspace；Agent Member 绑定一个 Workspace/session/cwd，可加入该 Workspace 多个 Channels。多个 Members 共享项目 cwd，private memory 以 memberId 隔离。
- **authority**：Human 是稳定特殊 Member 和唯一管理员；Agent tool 由 exact live Agent 解析 Member，不接受 senderId。Agent 只能访问显式加入的 Channels并修改自己的 Claims；MessageSource 不授权。
- **持久权威**：append-only operation ledger 是唯一事实源。每个业务 operation 单 record 原子提交，带连续 sequence、operationId、幂等 requestId、actor 和 previous link；投影、Inbox、tool result 和 UI 都不能独立写状态。
- **消息与 revision**：每条 Channel 顶层 Message 创建 Task；Thread reply 必须显式 target 与 base revision。全局 sequence 排序，每个 Thread revision 只受该 Thread 的 Message/Activity 影响。
- **Task 状态**：closed 覆盖 accepted，accepted 为 done，存在 active Claim 为 in_progress，无 active 且至少一个 done Claim 为 in_review，其余为 todo；done+released 无 active 为 in_review。Done/closed 后必须 Human reopen；close 自动 release active Claims；reopen 保留 Claim 历史并重新派生。
- **Claim**：direction 为自由文本，执行 Unicode normalize、trim、空白压缩和大小写折叠后精确判等；同 Task 同规范化 Direction 只允许一个 active Claim。
- **Follow 与 mention**：默认静默；发言或 mention 建立 Follow。Mention 已 unfollow Member 时首次拒绝并返回绑定 sender、Thread revision 与 recipients 的一次性 confirmation token；第二次显式携带 token 后放行并 re-follow。
- **Activity**：claim/follow/accept/close/reopen 等是 host-authored Activity，不是 Member Message，也不占 Task `#n`；Activity 计入 Thread 顺序/revision并投递当前 followers，actor 除外。
- **Delivery**：先在 Message/Activity Operation 中持久化 queued intents，再调用 Agent Inbox；admitted 以 `agent/inbox/spliced` 或 `user/message` 证据确认，Remove 时 queued 变 canceled。Idle follower 会被唤醒，running follower 在 next-step 边界接收。M1 不声称 claimed/processed/replied。
- **Member lifecycle**：只支持 team-managed Agent。Enabled Member 启动时 resume；单 Member 失败标 unavailable 而不阻塞 Team。Suspend 保留 identity/session/Claims/Follows/queued Deliveries；Remove 不可逆并 release/clear/cancel/archive。Plugin unload 停止 live AgentHandles、保留 sessions；fork 不继承身份。
- **工具**：`team_send`、`team_view`、`team_claim`、`team_follow` 使用 stable typed refs、sequence cursor、默认 limit 20/最大 100，并分离 canonical value 与 render。
- **模型来源**：Member-authored relay 与 host-authored Activity 使用不同 MessageSource kind；source 只记录 provenance。
- **里程碑**：M1 交付机制、临时 `/team` adapter、invariant、REAL composition、keyless snapshot、JSON/SQLite restart、HMR 和 failure injection；M2 第一阶段交付 Team mode、Workspace/Agent/Channel/Thread Client UI；M2 后续单独设计 Agent DM 与 Thread inbox；M3 处理 ledger snapshots、attention aggregation 和性能。
- **UI 落点（M2）**：Team 入口 → `sidebar.footer.action`；Team 模式动态 shadow `sidebar.workspaces`、`conversation` 与 `sidebar.settings`，退出时释放并恢复 shipped UI。Agent runtime presence 以状态点显示；Agent DM 与 Thread inbox 延期。完整设计见 `design/design-ux.md` 与 `m2-ui/spec.md`。
- **借鉴与偏离 Raft**（design/raft-design-mapping.md）：借鉴任务即消息、状态机、
  参与即 follow、push/pull 分离、lanes not job titles 等；偏离：消息默认即 task
  （Raft 显式 As Task）、多 claim 带方向（Raft 单 owner）、默认静默（Raft 加入即
  全量投递）；R11 的并发检查灵感来自 CLI 0.0.17 的 held/draft 行为（官方 docs
  未记录）。

## Testing Decisions

- **包级**：覆盖 ledger replay、authority、Task 状态矩阵、Direction normalization、refs/cursor、confirmation token、幂等 collision、revision/claim races和错误路径。
- **可靠性**：对 ledger commit、Inbox append、admitted commit、Member create/resume 与 teardown 的崩溃窗口做 failure injection；JSON 与 SQLite backend 都验证 restart、重复 operation 和补偿 Delivery。
- **组装级**：通过 Loader/app 的 REAL composition 启动 Host 与两个 team-enabled Members，完成 send、claim、reply、accept、restart、suspend/resume、remove和补投。
- **快照**：keyless snapshot 固定四工具 schema/render、两种 MessageSource、team guidance 与 `/team` human output。
- **不变量**：核心包检查 ledger sequence/link、idempotency、Task projection、Member lifecycle 和 Delivery 双证据；每个 consumer package拥有自己的 invariant companion或具体 no-runtime-invariant 说明。
- **UI**：M2 增加真实 Client/Host typed RPC、browser snapshot、真实 GUI journey/GIF、desktop/mobile viewport 与三席 Slot take/restore 验收。
- **原型验证**（2026-08-14 首轮 + 2026-08-15 第二轮，见
  validation/2026-08-14-validation.md 与 validation/2026-08-15-validation.md）：
  首轮验证 peer 投递三原语、投递落 session 事件、revision 检查、claim 原子原语
  （KvTable.update）、Slot 挂载与 take；第二轮验证 compaction 实际触发（manual +
  自动压力）、team-member preset 正反例、成员 create/resume、四工具全形态、
  claim 多成员并发端到端、task 派生状态全组合、D19/D20/D15 真实模型闭环、冷恢复
  补偿投递、invariant 正负例、`/team` 命令、MessageSource 合并点。全部在真实 dsh 进程通过；client 两席 take、RPC、渲染、用户目视和 stop/run 可逆性也已完成。

## Out of Scope

- M2 第一阶段不实现 Agent DM。后续方向是独立持久的 Human-visible transcript 投递到 Agent 内部 append-only session；其 Place、visibility、Delivery 与失败恢复另行设计。
- M2 第一阶段不改变 Thread attention。Thread inbox、unread cursor、`team_inbox`/`team_view` 扩展、`team_send` 未读门禁与相关 prompt 在 UI 实测后另行 grill。
- 多 human、成员邀请/自加入体系。
- 移动端/跨设备访问。
- 附件上传下载、消息编辑/删除、消息历史版本。
- agent 建 channel、成员管理权限开放给 agent。
- 跨进程/跨机成员（每成员独立 dsh 进程 + dsh-sdk/ACP）。
- 复杂权限分级（角色体系）、子团队、跨 workspace 的组织形态。
- 接入 Raft 服务本身（本设计是模式本土化，不是桥接）。
- 团队级共享记忆（超出协作事实的共享面）。
- attention snapshot 的完整聚合面（M3 打磨项）。
- Team reminder、attachment、profile mutation 和 self-service membership。Reminder 不得隐式驱动成员 schedule/goal/pulse；其余三类操作必须先独立定义 visibility、authority、持久化和 failure semantics。

## Further Notes

- 决策基线 D1-D26 记录于 design/feasibility.md；D26 补齐可靠性、authority、operation ledger、Workspace/Member、Task 终态、Member lifecycle、MessageSource 和 M1 验收。
- `CONTEXT.md` 是领域词汇入口，`design/architecture.md` 是 M1 当前实现基线；Raft 对照、UI/UX、工具研究和上层原则分别由对应 design 文档拥有。
- 本文件位于 `.scratch/dsh-agent-team/`，不走正式 docs gate。
