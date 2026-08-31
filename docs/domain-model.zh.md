# dsh-agent-team 领域词汇

[English](domain-model.md) | 中文

## Agent Team

一个 dshHome 内唯一的共享协作域。Agent Team 保存跨成员的协作事实，不共享成员的模型上下文、session transcript 或私有记忆。

## Member

Agent Team 中可被授权读取、发言、认领和接收 Inbox 提示的稳定身份。Member 由不可变的 member ref 标识，并绑定一个 workspace。首版包含 Human Member 和 Agent Member。

## Human Member

当前 Harness 用户对应的特殊 Member。Human Member 参与消息、claim 和 activity，并拥有 channel、成员、验收及 task 终态的管理权限。

## Agent Member

由 Agent Team 创建和管理的 Member。一个 Agent Member 绑定一个 dsh session、一个显式 team-enabled preset 和一个 workspace；普通 session 与 fork 不自动获得成员身份。

## Workspace

一个项目及其共享工作目录。Agent Member 的 session cwd 是其 Workspace 的项目目录；成员私有记忆不存放在项目根目录。

## Channel

Workspace 内的持久协作场所。Agent Member 必须显式加入 Channel 才能读取、发言、认领或 follow；Human Member 可以管理和查看 Workspace 内全部 Channel。

## Message

Member 在 Channel 或已有 Thread 中显式发出的不可变内容。每条 Channel 顶层 Message 原子创建一个 Thread；新 Client/tool 默认创建 taskless Thread，显式选择「作为任务」才在同一次提交中附加真实 Task。Thread Message 只延续已有 Thread。

## Task

附着在既有 Thread 上的可选 work-tracking overlay，而不是 Thread 存在的前提。它可由顶层 Message 的显式「作为任务」意图原子创建，或由 Human promotion 原子附加；promotion 同时追加一条公开说明 Message。Task 的工作状态从 Claims 派生，Human acceptance 与 closed 是显式覆盖事实：常规验收要求全部 Claim 完成（in_review）；Human 也可在 in_progress 时提前验收，accept 操作随之把当时仍 active 的 Claims 投影为 done 并在 activity 记录 `completedClaimRefs`（owner 各自收到通知），不伪造 owner 的 claim-done 事件。面向 Human 的 `Task #N` 是 Task 在 home Channel 内的 durable 创建序号：taskful 顶层发送和后续 promotion 均参与排序，taskless anchor 最初在时间线的位置不参与；既有 ledger 的编号保持不变。它不是稳定身份；跨频道导航和持久引用必须使用 branded `taskRef`。

## Thread

Channel 内独立的单层公开协作 aggregate：它总有 `threadRef`、anchor Message 和 revision，但可不带 Task。Thread revision 随公开 Message 递增；Taskful Thread 的 Claim 变化和 Task resolution 也递增。对既有 Thread 的公开写入必须携带该 Thread 的当前 revision。taskless Thread 仍支持 reply、follow、structured mention、Inbox、read 与 history，但没有 Claims、Task status 或 accept/close/reopen。协作读写优先以 `threadRef` 定位；released task-only Client 可以用 `taskRef` 作为仅限 taskful Thread 的 Host compatibility alias，而 Task/Claim 操作仍以 `taskRef` 为身份。revision 是内部并发令牌：仅供工具 baseRevision 透传，不作为消息正文的可引用事实。

## Claim

Member 对 Task overlay 中某个 Direction 的工作承诺。taskless Thread 没有 Claim。Claim 的状态为 active、done 或 released；同一 Task 中规范化后相同的 Direction 最多有一个 active Claim。多 Claims 是 dsh 对 Raft 单 owner 的有意偏离，不同文本仍可能表达重复工作。

## Direction

Claim 的自由文本工作方向。比较时执行 Unicode 规范化、首尾空白删除、连续空白压缩和大小写折叠；不推断同义词。

## Thread Attention

一个 Member 对一个 Thread 的私有、持久关注周期。Attention 记录 follow 状态、开始位置和连续 read watermark；它是 Member × Thread 的个人状态，不进入公开 Thread revision，也不因 read/follow 产生其他成员的 Agent Inbox 工作。创建顶层 Thread、成功 Claim、显式 follow 或 Human 确认邀请可开始 Attention；taskless Thread 可直接 unfollow，taskful Thread 仅在该 Member 没有 active Claim 时可 unfollow；两者都会结束当前周期并放弃该周期的未读，之后重新 follow 从当时 Thread 尾部开始。

## Thread Inbox

Team ledger 从 Thread Attention 与 direct mention 派生的成员级未读投影。普通 Message、Claim 变化和 Task resolution 变化只对当前 follower 形成 ordinary unread；structured mention 形成 direct unread。`team_inbox` 返回跨 Thread 摘要，`team_thread.read` 原子返回连续未读批次并推进 watermark，`team_thread.history` 只回看历史。Inbox 是 Host 权威，不是 Agent Session queue、浏览器状态或 per-message read 表。Human Web 不提供 Inbox 界面；它从 Channel 直接浏览和打开 Thread。

## Follow

Follow 是 Thread Attention 的一个操作语义，不是独立的持久对象或旧版 Delivery 订阅。follow 控制普通 Thread 更新是否形成该成员的 Inbox 工作；它不撤销 Channel 可见性。unfollow 在没有 active Claim 时结束当前 Attention 周期。

## Activity

由 Agent Team 记录的协作状态事实。Claim create/done/release 与 Task accept/close/reopen 是公开、revisioned Thread timeline facts；follow/unfollow 与 read-watermark 是 Attention audit facts，不进入公开协作时间线。Agent runtime error 可作为 Human UI 的当前风险观察，但不是 ledger Thread Activity 或 Agent Inbox 事实。

## Inbox Hint

Host 由 durable Thread Inbox 状态派生给 Agent 的安全边界提示。Ticket 01 只实现 durable Inbox projection；Agent runtime wake hint 属于 Ticket 03，尚未实现。提示最多合并为每个 Member 一个无正文 Inbox hint；它不是 Message/Activity 正文投递，也不表示模型已读取、处理、回复或验收。普通更新可唤醒 idle Member，running Member 在安全 next-step 边界收到提示；恢复时从 durable unread 重新派生。

## Operation

Agent Team ledger 中一次不可变的原子业务提交。每个 Operation 有全局递增 sequence、稳定 operation id、幂等 request id、actor 和一种业务事实。

## Revision

特定 Thread 最近一次相关 Operation 的 sequence。Revision 是 optimistic concurrency fence，不是消息数量。

## Ref

跨重启稳定、带对象类型且不可由调用者拼接的标识。Member、Channel、Task、Thread、Message、Claim 和 Operation 使用不同的 branded refs；Attention 由 Member 与 Thread 的组合标识，不暴露为可伪造的调用者对象。

## Team DM

未来可能增加的私有 Place 类型，具有独立 participant set、visibility、Message、Thread、Attention 与 Inbox 语义。M2 第一阶段不实现 DM；后续方向是把 Human-visible DM transcript 与 Agent 内部 append-only session 分开持久化，具体 authority 与通知语义待单独设计。

## Runtime Presence

Agent Member 的进程内可用性投影，不是 ledger 事实。M2 UI 使用 available（live idle）、working（Agent loop running）、error（当前 loop/tool failure，保留到下一次 loop 启动）与 unavailable（无可用 AgentHandle 或 lifecycle/setup/resume 阻止调用）；列表以状态点呈现，和 Claim 状态分离。

## Suspend

临时停止 Agent Member 的 live Agent，同时保留成员身份、session、claims、Thread Attention、未读状态和私有 memory。Resume 恢复同一 session，并由 durable unread 决定是否重新提示 Inbox。

## Remove

不可逆地停用 Agent Member。Remove 释放 active claims、结束 Thread Attention、删除私有 memory、归档 session；历史 Message、Activity 和身份快照永久保留。
