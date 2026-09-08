# @wowyuarm/dsh-agent-team/tools

[English](README.md) | 中文

面向 Agent Team Member 的模型工具。本包在调用方 Agent preset scope 内注册工具，不提供或替换 Host service。

## 工具

- `team_inbox` 列出调用方 Member 的有界未读 Thread 摘要，先按 direct work、再按最近活动排序；只有 Thread 存在真实 Task overlay 时才出现 Task standing。header 给出 unread/direct 总数与展示的 Threads 数（有界列表之外仍有未读时给出截断结论）；每个条目显示精确的 unread/direct 计数、Channel ref 与 Task standing。页脚把阅读指向 `team_thread read`；渲染不携带 revision 与写令牌。
- `team_thread` 读取 Thread、分页历史、follow 或 unfollow。`threadRef` 是主身份；`taskRef` 只对 released task-only Client 是 Host alias。五个 action 分开渲染：`status`/`follow`/`unfollow` 一行只回答 Attention 问题；`read` 渲染结果、Thread 身份、导向（有 Host 提供的 background 时给 full anchor，否则给 bounded anchor subject，anchor 已在 facts 中时绝不重复）、只含 active Claims、带行内 unread/direct 标记的按时间 facts、read-through/剩余未读页脚；`history` 渲染历史页（首页 full anchor、continuation 页 bounded subject，绝无当前 Claims 或 advice）。`read` 推进持久 watermark，是 next-write token 的读侧唯一来源——仅在未读清零时渲染；你自己的已提交 public mutation 也会回传一份新 token。Activity facts 结构化渲染——actor、Task ref，以及每条 activity claim、完成、接受或 release 的 Claim refs。确认仍为 done 状态 Task 的未读验收的那次 read 附带一段 `contextAdvice`（用量、路由预算、`min(128_000, handoffAt)` 任务边界阈值、keep/rollover/handoff-now 唯一动作）；它只是建议，测量失败时降级为显式 `unavailable` 文案。
- `team_message` 创建顶层 Thread、回复既有 Thread 或发送 DM。默认创建 taskless Thread；传入 `asTask: true` 才原子创建 Task。commit 的 start/reply 渲染一个 committed-verb 结果（Thread created / reply added），携带 Message、Thread 与可选 Task refs，以及恰好一个 next-write token hand-off。Reply 在检查令牌新鲜度前先拒绝未读工作。类型化拒绝以 `Not committed` 开头，保留重读与审慎重试所需的结构化 refs 与计数，不渲染数字 revision 或写令牌——恢复路径是 read-and-reconsider。DM 区分 `Delivered` 与 `Recorded, not delivered`（携带 delivery note 与禁止盲目重发的警告）。
- `team_claim` 通过 `list`、`claim`、`done`、`release` 读取或修改调用方 Member 的 Direction Claim；它只适用于真实 Task。`list` 渲染 Task/Thread 身份与只有 active Claims 的 collision surface，且无写令牌。commit 的 mutation 点名动作（Claim created/completed/released），先渲染权威的受影响 Claim，再 hand-off 一个 next-write token。拒绝与 message 拒绝共享同一形式。Direction 互斥键执行 Unicode NFKC normalization、trim、空白压缩和确定性大小写折叠。
- `team_view` 是 address book：有界、按 membership 授权的 Channel、顶层 Thread 与 Member 摘要——是当前的地址簿，不是工作队列。Threads 是唯一分页目录：newest-first 行携带 threadRef、Channel ref、bounded anchor subject 与行内 Task standing（绝无第二个 Task 索引，也不渲染 revision 或消息数）。cursor 只延续 Thread 行；continuation 页只渲染 Threads，翻页可达全部获授权的顶层 Threads，包括 taskless 与不在首页的 taskful。
- `context_rollover` 为调用方 Member 安排一次进入全新上下文的 rollover。工具向 Host 校验有界的私有 `handoff`（及可选 `relatedFiles`；传入 `checkpointRef` 则改为回返到已记录的 checkpoint），结束当前 turn 并返回 `status: 'scheduled'`；Host 只在成功的 tool result 持久落盘后才执行真正的换窗。`checkpointRef` 在工具与参数两级 description 上做了 copy hardening：普通续代与压力换窗必须省略，只有引用 `context_timeline` 结果中列为 restorable 的精确 ref 时才提供——绝不合成或猜测。当下不可能成功的 `checkpointRef`——伪造、未 resolve、无法归属、不缩减、不可测量、超预算或被多个 active Claim 阻塞——以 model-visible 的 error result 拒绝，而不是返回假 `scheduled`；可变 guards（jobs、route limits）在换窗 seam 复查，seam 失败后 Member 仍可通过后续 turn 的显式 fresh rollover 恢复。`context_rollover` 与 `context_checkpoint` 都会结束 Agent turn（换窗后不得再接旧代工作；checkpoint 在其所属 turn 结束时 resolve）。
- `context_checkpoint` 为调用的 Member 记录一个命名的当前上下文 checkpoint。durable checkpoint 就是 Session projection 折叠的成功 `tool/call`+`tool/result` 对；返回的 ref 由 Member Session 身份加 tool call id 确定性派生。工具体不做 lifecycle 副作用，但会结束 turn：checkpoint 在其所属 turn 结束时 resolve，因此模型把它作为一个完整工作单元的最后动作来记录。
- `context_timeline` 返回该 Member 跨当前 Session 与已归档祖先 lineage 的上下文代际有界结构视图：已记录的 checkpoints 与 handoff/Team/compaction 边界，无法证明可安全回返的条目携带拒绝原因。仅结构信息——不含任何 transcript 正文。fresh 的 `context_rollover` 从不需要先查 timeline。

Agent 不能通过 mention 静默把另一个 unfollowed Agent 加入 Thread；Host 返回 `member_not_following`。Human confirmation 属于单独的 Host/Client 流程。Closed Task 在 Human reopen 前拒绝 reply、Claim 和新的 Attention；taskless Thread 没有 Claim 或 Task resolution mutation path。

所有 agent-facing 渲染都在固定的 Team 协调时区 UTC+8 下携带带显式偏移的绝对事件时刻（`2026-09-08T17:00:00+08:00`）：`team_thread` 的 fact 行与 anchor 为每条 fact 标注其提交 operation 的时刻，`team_inbox` 行携带 `newestOccurredAt`，`team_view` 的 Thread 行携带 `lastActivityAt`，通知给出 `Occurred at:`，已提交变更从 receipt 渲染 `Committed at:`。同一存储时刻在任何重读路径中渲染完全一致；只渲染绝对 timestamp，绝不出现相对时间文案，且 sequence 与 revision——而非 wall-clock 时间——仍是顺序 authority。

Canonical result 以结构化字段暴露稳定 refs、可选 Task status、Thread revision、Claim history、Attention 和未读 facts。模型可见的渲染遵循 action decision surface：写令牌只出现在未读清零的 `team_thread read` 与一次已提交的 public mutation 上；浏览类结果（`team_view`、`team_inbox`、status/follow/unfollow、`history`、`team_claim list`）与所有类型化拒绝都不渲染 revision 与令牌。类型化的 `unread_required` 与 `stale_revision` 结果保留重新读取和审慎重试所需的结构化字段。工具执行通过准确的 live `exec.agent` 解析 actor；参数不能选择或冒充 actor 或 Workspace。写操作的 request identity 由 sessionId 与 tool callId 派生。`context_rollover` 与 `context_checkpoint` 结束 Agent turn；其余 Team tools 将结果返回模型循环，不主动结束 turn。

完整的已实现协议见 [`../../docs/team-collaboration.md`](../../docs/team-collaboration.md)。

## Composition

在 team-enabled Agent preset 内、`dsh-tools` 之后挂载本插件。插件只静态 inject `tools`；执行时从 live Agent context 读取 `agentTeam`，避免 Host 恢复 Member session 时形成依赖环。
