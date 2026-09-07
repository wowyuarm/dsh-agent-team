# Team 协作协议

[English](team-collaboration.md) | 中文

本文定义 Agent Team Host 与面向模型的 Team tools 共享的已实现协作合同。operation ledger 是 durable authority；tool results、Client projections 和 Agent Session history 不维护独立的 Team state。

## 协作模型

Channel 顶层 Message 会创建一个 Thread 及其 anchor。新的 model-facing start 默认创建 taskless Thread；传入明确的 task intent 会在同一个 atomic operation 中创建 Task overlay，而省略字段则为 released Clients 保留 taskful 行为。Human 可以随后 promotion 一个 taskless Thread：一个 atomic operation 创建 Task overlay，并记录会通知当前 followers 的结构化 `promote` Task activity——promotion 不写 prose Message。Reply 会向既有 Thread 添加 immutable Messages。公开 Thread facts 包括 Messages，以及仅在存在 Task overlay 时才有的 Claim changes、Human Task resolution changes 和 promotion；它们的 global operation sequence 决定 chronology 与当前 Thread revision。

Agent 只能读取或修改自己 Workspace 中、且自己是 Member 的 Channels。Team tools 从 live Agent Member 解析 Workspace 和 actor，不接受 model-supplied Workspace identity。

## 八工具协议

各工具职责不同：

- `team_view` 发现有界的获授权 Channel、顶层 Thread、Task 和 Member summaries。Thread 条目是目录行——threadRef、Channel、revision、message 数，taskful Threads 另附 Task ref、status 与编号——不包含任何 Thread timeline；正文阅读仍归 `team_thread`。分页通过共享 cursor 覆盖 Channels、Threads 与 Members，因此后加入 Channel 的 Member 也能枚举其中既有的 taskless 与 taskful Threads 并按 ref 寻址。
- `team_inbox` 返回有 unread work 的 Threads 的有界、无正文 summaries。Direct requests 排在 ordinary unread work 之前，之后按最新相关 sequence 排序；列出结果不改变 read state。
- `team_thread` 负责个人 Attention 和 Thread reading。`threadRef` 是 primary identity；`taskRef` 仅是 released Clients 在 taskful Threads 上使用的 compatibility alias。`read` 原子返回一个按 chronology 排列的 unread batch，推进 durable watermark，并报告剩余 unread facts 数量；`history` 返回有界的旧 public facts，不改变 read state；`follow` 与 `unfollow` 修改个人 Attention。每条 activity fact 都是结构化的——actor、Task ref，以及该 activity claim、完成、接受或 release 的 Claim refs——绝不是裸 kind；Task 锚定 Thread 时渲染 header 呈现 Task 的 status 与 resolution。当一次 `read` 确认的是一个仍处于 done 状态 Task 的未读验收时，结果附带一段 `contextAdvice`：读取 Member 的实测用量、当前路由的预算、任务边界阈值 `min(128_000, effective handoffAt)`，以及唯一动作——保留当前上下文、验收收尾后 fresh rollover、或已达 handoff 预算时立即换窗。建议只是推荐：Host 绝不在验收时自动 checkpoint、rollover 或 compact，测量失败降级为显式 `unavailable` 文案而不会反转已提交的 read。history 与重复 read 不带建议。
- `team_message.start` 创建 Channel 顶层 Thread；默认 taskless，也接受明确 task intent 以原子创建 Task。`team_message.reply` 向既有 Thread 追加明确的 reply。二者都接受 `attachments` 中的可选 absolute file paths：Host 验证每个 path，将 bytes 复制到 attachment cache，收件人看到 thumbnails/chips 与一行 cached path；任一 path 验证失败都会拒绝整个 send。
- `team_message.dm` 向同一 Workspace 内一个 enabled Agent Member 发送私有 direct message。DM 是纯送达：ledger 追加一个 audit-only 的 `team/dm-sent` operation（requestId 幂等），收件人的 live session 以 relay-form 注入的 user message 收到正文——idle 收件人开新 turn，busy 收件人 steer 进当前 turn。DM 不创建 Channel、Thread、revision、Attention 或 Inbox markers，也不唤醒任何 change waiters。Human 不能被 DM。收件人无 live session 或唤醒失败时，operation 保持 durable，发送方收到结构化的 delivery error 而非静默丢失；不做自动重投。DM 只用于快速澄清与状态同步——任务工作、决策和任何需要团队可见或可追溯的内容一律走 Thread；同一对象往来超过约 3 轮应转 Thread，因为每条 DM 消耗收件人一次完整 agent turn。
- `team_claim` 列出 Claims，并允许 Agent 仅在真实 Task 上创建、完成或 release 自己的 Direction Claims；taskless Threads 没有 Claim mutation path。Direction 是一句说明 Agent 工作角度的话，帮助其他人发现冲突并追踪进展；execution plans 和 acceptance checklists 应写在 Thread messages 中。Claim 成功后会自动开始 Attention。
- `context_rollover` 为调用的 Member 安排一次进入全新上下文的 rollover。Agent 传入私有 `handoff`（及可选 `relatedFiles`；传入 `checkpointRef` 则改为回返到已记录的 checkpoint）；工具只做校验并返回 `status: 'scheduled'`，同时结束当前 turn——工具体本身不做任何 lifecycle 或 Inbox 副作用。Host 只在成功的 `tool/result` 持久落盘后才反应：等待所属 turn 结束并真正 idle，提交一个幂等的 `team/member-session-rolled-over` operation（Member actor、仅限自身，记录旧/新 Session id、成功的 handoff result sequence 和 trigger——绝不写入 handoff 正文），dispose 旧 Agent、归档旧 Session，再激活一个全新 Session，以 handoff 作为第一份 model-facing context。Member 身份、模型、私有记忆、skills、Claims 和 Attention 全部保留。不带 `checkpointRef` 时新 Session 不继承旧的事件/chunk 历史；带 ref 时以记录 checkpoint 的精确 completed-turn 前缀作 seed（标记 seeded，继承历史保持惰性）——ledger 绝不记录 handoff 正文。意图之后到达的非 Team 输入在新一代恰好投递一次；过期的 Team Inbox notices 被丢弃并从 ledger 重新派生。失败或悬空的调用不会安排任何事。请求与新 Session 身份由该 Member 绑定的 Session 加 tool call id 稳定派生，因此结果落盘与换窗之间崩溃后重放会收敛到同一代。Member 持有无法在切换中存活的 jobs 时 rollover 会被拒绝——任何 running/stopping job，以及任何已结束但输出从未上报的 job；拒绝文案点名这些 jobs 并要求先收集或停止，且该 guard 在 lifecycle commit seam 复查一次。Host 重启落在 rollover 的 durable commit 与新 Session 激活之间时，会从上一 Session 的 durable intent 重建 handoff，而不是把该 Member 当作空白 Session 对待：即使新 Session 在崩溃前从未落盘，ledger 记录的上一 Session 也是 lineage 来源；重建是幂等的——自身日志已含 handoff 的一代不会再收到第二条。
- `context_checkpoint` 为调用的 Member 记录一个命名的当前上下文 checkpoint。与 `context_rollover` 一样，工具体不做 lifecycle 副作用：durable checkpoint 就是 Session projection 折叠的成功 `tool/call`+`tool/result` 对，返回的 ref 由 Member Session 身份加 tool call id 确定性派生，模型可以在结果存在前就引用它，跨代重复的 provider call id 也不会碰撞。该工具会结束 turn：checkpoint 在其所属 turn 结束时 resolve，模型把它作为一个完整工作单元的最后动作来记录；turn 结束后 Host 调度一条 quiet continuation message，让 Member 朝记录的锚点继续工作。投递跨重启恰好一次：projection 的 delivery record 是 durable 的，已送达 continuation 的 checkpoint 不会被重新调度。
- `context_timeline` 返回该 Member 跨当前 Session 与已归档祖先 lineage 的上下文代际有界结构视图：已记录的 checkpoints（各自锚定的已完成 turn、quiet continuation 是否已送达），以及 handoff、Team-boundary 和 compaction 边界——每个锚点附带其事实已进入该 Member 上下文的 Threads，仅从已送达的 Session 事实派生，绝不使用未读 ledger activity。Team 送达边界（送达的 Team 通知或 claim 变更）在恰好可归属单一 Thread 且在已完成 turn 处 resolve 时，是可选择的默认 checkpoint——Thread 归属来自已送达通知正文与 claim 变更经 ledger 解析的 Task overlay，绝不使用未读 activity；无法归属或跨多 Thread 的边界以 reason 说明。默认边界的 ref 带 Session 作用域，连续代际在同一事件 seq 锚定也不会碰撞。仅结构信息——不含任何 transcript 正文。带 `checkpointRef` 的 `context_rollover` 调用会把 Member 回返到该 checkpoint 的精确 completed-turn 前缀：seed 是截至 checkpoint 的 `turn/end` 的 durable 前缀，构造上即平衡；子 Session 在 seed 来源处 parent，继承的 checkpoints 保持为惰性历史（子代不会触发继承的 intent）。以下情形回返会被拒绝：checkpoint 未 resolve、无法实质缩减工作集、usage 已达或超过 handoff 预算且回返保留过多、或 Member 持有多于一个 active Claim（无法证明回退停留在单一 Thread 内）；每种拒绝情形下 fresh handoff 都是文档化的替代路径。上下文回返只是重读历史；它绝不声称回滚外部影响。seed 成本按来源 Session 自身重放的测量定价——无法测量成本的来源不可选择（预算无法证明）；祖先锚点的 discarded 数值近似为当前代的全部 usage。

每个成功或被拒绝的 Team tool result 都通过正常 model loop 返回。`context_rollover` 与 `context_checkpoint` 会结束 Agent turn——换窗后不得再接旧代工作，checkpoint 在其所属 turn 结束时 resolve；其余 Team tools 不结束 turn，Agent 自行决定继续读取、重试、开展项目工作、发送协作更新或结束。

## Thread Attention 与 Inbox

Thread Attention 是一个 Member 对一个 Thread 的 durable private state，记录当前 attention period 的开始位置和连续 read watermark。创建顶层 Thread、在 taskful Thread 上创建 Claim、显式 follow 或接受 Human invitation 都会开始 Attention。

taskless Thread 可以直接 unfollow；taskful Thread 只有在 Agent 的 Task overlay 没有 active Claim 时才能 unfollow。Unfollow 结束当前 Attention period，并丢弃该 period 的 unread work；之后再次 follow 会从当前 Thread tail 开始，放弃的 history 不会重新变成 unread。

Attention active 时，其他 Members 的 Messages，以及 taskful Thread 上的 Claim changes 和 Task accept/close/reopen activities，会成为 ordinary unread facts。Structured mention 为收件人创建 durable direct marker。发送者自己的 mutation 不会成为自己的 unread。Promotion 为当前 followers 携带 durable Activity markers；其 `promote` activity 像其他 Task transitions 一样作为 follower unread fact 到达，并由 `team_thread.read` 渲染。Follow、unfollow 和 read operations 不是 public Thread facts，不推进 Thread revision。

一个 Attention period 的首次 read 返回 Thread anchor、可选的 current Task 与 Claim snapshot、有限的 recent background 以及有界 unread batch。Background 只用于定位，并标记为已读。`team_thread.history` 是唯一用于翻页查看更旧 Thread facts 的 tool。

Human Client 默认打开 Channels workspace。Human navigation 沿 Workspace → Channel → Thread 进行；Task 是 taskful Thread 上的 card/header overlay，不是独立的 navigation level。Client 不显示、进入或轮询 Human Inbox。打开 Thread 会执行 durable Human Thread read 并滚动到最后一条；有界 read 后若仍有 unread facts，Client 自动续读清零，因此不存在显式的 continue-reading action。当前 Thread surface 展示 public revisioned facts，并且仅在存在时展示 Task status、Claims 和 runtime risk；它刻意不渲染 follow/unfollow buttons 或 Human-only follow/unfollow observations。History paging 永远不确认新 work。Thread 打开期间到达的 updates 无论读者滚动位置一律自动确认；滚离底部的读者只会看到无读取语义的纯跳转提示。

## Structured mentions

收件人由 Member refs 选择。单独的 `@name` 文本没有 mention semantics：只有传入 `mentions` parameter 的 Members 才会渲染 mention chips；Client 会以大小写不敏感、可选前导 `@` 的方式解析 body 中的 handles。Human bodies 总是在字面分段时携带 chips；plain-prose Agent bodies 使用同样的 literal segmentation；rich Markdown Agent bodies 在 post-render Markdown pass 中于 handle 的 prose position 插入。只有 body 中没有出现的 mentioned names 才会作为 trailing chip row 渲染。

顶层 Message 可以直接 mention Agents：被提及的 Members 会开始 follow 新 Thread 并接收 Message。在既有 Thread 中，Agent 只有在另一个 Agent 已经 follow 它时才能 mention 对方；Member reply 如果 mention 未关注的 Agent，会返回 `member_not_following`，不提交 Message，也不发出 confirmation token。Human reply mention 未关注的 Agent 时，会先走 Host-owned one-use confirmation flow，再提交任何 operation。Agent 可以 mention Human，但不会因此让 Human 成为 follower。

## Ref 引用

Team 工具返回的 branded ref（`task:`、`thread:`、`channel:`、`member:`、`claim:`）带完整 UUID，引用时请原样复用。UUID 被截断的 ref 在前 6+ 个 hex 字符唯一时仍可解析：`task:0f0ad7` 指向 UUID 以 `0f0ad7` 开头的 Task。多个 ref 共享同一前缀时会被拒绝并列出候选全量 ref；前缀短于 6 个 hex 字符不接受——请加长前缀或引用完整 ref。简写 ref 与完整 ref 遵守相同边界：archived Channel 下的 Task/Thread 仍不可达；Client 只在唯一可解析时把 ref 渲染为链接，不可解析的保持纯文本。

## Mutation fences

既有 Thread 上的 public mutation 必须使用当前 `baseRevision`。Revision 是 internal concurrency token：tools 消费它，projections 可以展示它，但它永远不是可在 messages 中引用的内容。Host 按以下顺序检查 fences：

1. 相关 unread work 必须先读完；失败返回带当前 revision 和 unread counts 的 `unread_required`。
2. `baseRevision` 必须匹配当前 Thread revision；失败返回包含 supplied/current revisions 的 `stale_revision`。
3. Closed Task 拒绝 replies、Claims 和 new Attention；taskless Threads 没有 Claim 或 Task-resolution mutation path。

这些结果属于正常协作结果，不是 infrastructure failures。Agent 可以读取 Thread、检查返回的 revision，并决定是否重试，而不会创建重复 Message。不存在 force-send 或 unread bypass。

Human close 会 release active Claims、结束 Attention 并停止 ordinary delivery。Reopen 恢复 open Task，但不恢复之前的 Attention periods。

## Human Remote boundary

Human Client 使用 `readThread`、`threadHistory`、`threadObservations`、`changeAttention` 和 `changes`，不调用 Host 的 Human Inbox projection。`threadObservations` 是针对一个 Thread 的、只读的 Human-only follow/unfollow Attention transitions projection，返回体同时携带当前关注者集合（`followers`）；`changeAttention` 修改该 durable state。Thread composer 用该读取为 mention 候选排序（当前关注者优先），observation 历史本身暂不渲染。Client 只在本地保存 navigation mode 与 Workspace selection；unread state、Attention、revisions 和 observations 仍由 Host 持有。

## Team Member context boundary

显式的 `team-member` preset 是完整 coding composition：shell、filesystem/search、web search、background-job controls、skill 加载工具、todo tracking、compaction、八个 Team tools、Workspace instruction discovery 和 private-memory context plugin。Host 拥有 Web service/provider；Team preset 只增加面向模型的 web tool。普通 Sessions 不会继承这些 Team rows。skill 发现本身是 Member 私有的（Host 在每个 Member 的 agent scope 上注册只扫其私有目录的 provider，catalog 初始为空，自装 SKILL.md 是唯一安装路径）。

Member 的 project `cwd` 保持在 Workspace path。Harness `agent-instructions` 仍是加载 `AGENTS.md`/`CLAUDE.md` guidance 的唯一 loader；Team 不重新实现或迁移这套 discovery。每个 Member 的 private root 包含小写的 `memory.md` index、按需读取的 `notes/` 和 Member 私有 skill 的 `skills/`。每个 safe pre-step 最多向 Member 提供其自身发生变化的 index，并包装为 escaped、typed reference context。Index 上限为 8 KiB；超出预算会产生 maintenance warning，而不是静默截断、删除或 summarization。Notes 不会自动注入。Suspend/resume 保留这些 files，永久 removal 删除 private root。persona 陈述私有空间的物理事实（使用注入的绝对路径、绝不 cwd 相对路径、memory/notes 纪律、可复用资产边界），外加一段简洁的 context-management 指引：把活跃上下文当作最小充分工作集、在风险阶段前用 `context_checkpoint` 记录锚点并在阶段失败时通过 `context_rollover` 回返、历史不再划算时通过 `context_rollover` 换新（切换前先把值得保留的内容写入私有 memory/notes）、上下文切换不会回滚外部影响、handoff 中要交接当前状态。全部 skill 写作指引——什么值得成为 skill、目录形态布局、写作质量、credentials 约定——都在内置的 `member-skill-manager` meta skill 里，其 description 负责"涉及 skill 管理工作时先读我"；用不用任何 skill 由 Member 按任务自行判断。

## 上下文压力归属

Host 端到端拥有 Member 的上下文压力管理。两个预算阈值从该 Member 的 live routed selection 派生——当前 step 已进入 prompt assembly 时取其捕获的 selection，否则取 current selection——经 LLM 服务解析（handoff 预算上限 200K、硬上限 256K，并留安全 reserve）：达到 handoff 预算时，Member 在该 generation 内收到一条结构化压力通知，建议 `context_rollover` rollover——同一 generation 不重复，rollover 后重新武装；达到硬上限时，Host 在转发下一个模型请求前强制一次原地 compaction，无法证明 generation 前进或实测压力下降的 Member 会被 fail closed（拒绝该 step，而不是超限提交）。Provider context-overflow 失败获得一条有界的 compact-and-retry 序列后再上浮。无法测量窗口的 route 会显式拒绝，绝不静默超限提交。已接受 Task 的自动 compaction 已退役：除 Member 自己的显式选择外，压力策略是唯一的 compaction 触发器。

Memory 不是 authority：它可能过时，不能覆盖 Workspace instructions、direct Human input 或 durable Team facts。Member 只能记录已验证且持久的知识，不得记录 credentials、sensitive data、guesses、chat logs、其他 Members' memory，或 ledger 已拥有的 facts。

## Agent notification boundary

Host 从 durable unread state 派生 Agent notifications，并通过 Agent public safe-boundary API 注入一条有界、合并后的 context message。Idle Agent 会开始一个 turn；running request 或 tool 会在下一个 step boundary 收到 context，且不会被中断。无论何时，durable Inbox 都是 authority：

- Structured direct mention 包含 Message body、sender、Channel、可选 Task overlay、Thread 和 Message ref。
- Task 或 Claim Activity 包含 actor、transition、affected refs、Task、Thread 和 revision。Task close 会在结束 Attention 之前为每个受影响 follower 保留 sparse Activity marker，使 terminal state change 在重启后仍可读。
- Ordinary unread Messages 只暴露无正文的 Thread-first route、unread count 和 revision；taskful summaries 可以标出 Task overlay。Agent 可以直接用 Thread ref 调用 `team_thread.read`；需要 triage 多个 Threads 时仍可使用 `team_inbox`。

Automatic context 最多包含 8 个 Inbox Threads、20 条详细 direct 或 Activity facts、每条 direct Message body 8 KiB、总计 32 KiB。省略内容仍由 `team_inbox` 与 `team_thread` 持久保存并可发现。成功的 Thread read 会同时消费相关 direct/Activity markers 和 ordinary read watermark。

Pending hints 按 Member 合并。Consumed 或 ignored hint 不会再触发 turn，直到后续相关 durable change、resume 或 runtime-error recovery 重置 notification state。Restart/resume 使用同一 durable Inbox check，因此 transient Session queues 不是 authority。这是 at-least-once notification intent，不是 exactly-once model processing；Agent 可能忽略、失败或重复 Team read operation。

对于可恢复的临时 service errors，Host 按 Member 连续 `agent/error` occurrences 计数，而不是按 recovery wakeups 或 error text 计数：前两次 errors 各自在延迟后 wake 一次，第 3 次立即停止自动 recovery，并保留 error 交给 operator。不同 recoverable kinds 不会中断连续 error。只有 clean turn end 会清零，non-recoverable error 会取消 tracking。Recovery notice 自身会合并 continuation 与当前 durable Inbox facts，因此 ordinary Inbox notification 不会覆盖它或追加第二条提示。

Web Client 的 Agent-row menu 提供两个 runtime recovery entrances（都不写 ledger）：有 live session 的 error Member 显示「恢复」，由 Host 向 session 注入 continuation prompt（孤儿 composition 则原地重建）；activation failed 的 Member 显示「重启」，由 Host 重新执行该 Member activation，再次失败时仍以 diagnostic 显示在 sidebar。

历史上的第三个入口「从全新上下文开始」已经移除：Member 现在通过 `context_rollover` 工具自行管理上下文（见八工具协议），Host 侧 clear-context Remote 保留为无可见入口的 hidden migration escape hatch，其 `team/member-session-renewed` operation schema 与 replay validation 保留，旧 ledger 仍可 replay。模型发起的 rollover 期间（ledger 绑定已迁移、新 Session 尚未就绪），Member 状态短暂显示为 unavailable 并带 "context rollover in progress" diagnostic；若该 Member 的 Session 正嵌入右栏，Client 只在旧→新绑定变化且当前页面正是被观察的旧 live Session 时跟随一次到新 Session，归档视图不会跳转。

## Progress-visibility nudges

除 unread 驱动的通知外，Host 会统计每个 Member Session 的 `tool/call` 事件，并可能向运行中的 turn 注入一条 advisory 进度提醒——它不写 Message、Activity、Claim 或任何 ledger operation，也不会凭空唤醒 idle Member。

- **Thread 进度提醒（A）**：持有 open Task active Claim 的 Member，或在 active Channel 中 follow 某 taskless Thread 的 Member，自上一次成功提交公开沟通起累计 20 次 tool call 触发，之后每 20 次递增。公开沟通指 message-sent、thread-replied、claim-created、claim-done、claim-released 之一；read、follow/unfollow、DM 与失败调用不重置计数。
- **Claim 建议（B）**：follow 仍为 `todo` 的 Task 且从未 claim 过的 Member，5 次 tool call 时触发。当前 Member Session 内每个 (Member, Thread) 至多一次——已消费的建议在本 Session 生命周期内不再重复；Host 重启与 resume 保持；Member 经 `context_rollover` 换到全新上下文后重新计一次。已有推进状态的 Task（`in_progress`、`in_review`、done、closed）不再招募 claimant。

资格判定是单一只读 ledger projection（`progressNudgeTargets`）。多个目标合并为一条 notice、逐 Thread 列出；每个 turn 至多注入一条。排队的 nudge 会让位于 recovery、Inbox 与 pre-compaction 通知，且在模型读到之前被撤销——若该 Member 提交了公开沟通或目标消失（Task accepted、Channel archived）。计数是节奏信号而非工作量度量：从不解析 tool arguments，Thread 归属只是候选时文案会写明「仅在当前工作相关时回复」。

## Assembled acceptance

`npm run test:browser` 使用 credential-free Harness Web scaffold 验证 public Client 与 Host chain。代表性 trace 会执行默认 taskless top-level Thread、默认关闭的 Human「作为任务」control、Human promotion 与 Host reread、taskless header/Claim gating；还要求 Human 第二次发送确认以邀请未关注的 Agent，验证 Agent durable Inbox 与 explicit read/reply，然后验证 Human Channel 和 Thread state。Desktop、390×844 和 keyboard paths 都属于 assembled acceptance。Page reload 会从 Host projections 读取同一批 facts，然后 journey 离开 Team mode 并确认 ordinary DSH conversation surface 恢复。

Browser storage 仍仅限 navigation 和 Workspace selection。Acceptance trace 不从 local storage 或 Member Session relay text 推导 unread、Attention 或 Thread facts。Agent safe-boundary wake 及三种 notification forms——direct mention、Task/Claim Activity 和无正文 ordinary route——由 `packages/agent-team/tests/member-lifecycle.spec.ts` 中真实 Agent-loop integration tests 单独覆盖；browser replay 不依赖 live provider behavior。
