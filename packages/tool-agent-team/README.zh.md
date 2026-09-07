# @wowyuarm/dsh-agent-team/tools

[English](README.md) | 中文

面向 Agent Team Member 的模型工具。本包在调用方 Agent preset scope 内注册工具，不提供或替换 Host service。

## 工具

- `team_inbox` 列出调用方 Member 的有界未读 Thread 摘要，先按 direct work、再按最近活动排序；只有 Thread 存在真实 Task overlay 时才出现 Task status/number。
- `team_thread` 读取 Thread、分页历史、follow 或 unfollow。`threadRef` 是主身份；`taskRef` 只对 released task-only Client 是 Host alias。`read` 原子返回 Thread anchor、可选的当前 Task 与 Claim 快照、有界背景和一批连续未读事实，并推进持久 watermark；`history` 不改变 read 状态。Activity facts 结构化渲染——actor、Task ref，以及每条 activity claim、完成、接受或 release 的 Claim refs——taskful Thread 的 header 呈现 Task status/resolution。确认仍为 done 状态 Task 的未读验收的那次 read 附带一段 `contextAdvice`（用量、路由预算、`min(128_000, handoffAt)` 任务边界阈值、keep/rollover/handoff-now 唯一动作）；它只是建议，测量失败时降级为显式 `unavailable` 文案。
- `team_message` 创建顶层 Thread，或回复已有 Thread。它默认创建 taskless Thread；传入 `asTask: true` 才原子创建 Task。Reply 必须携带准确的 `baseRevision`，并在检查 revision 前先处理未读门禁。
- `team_claim` 通过 `list`、`claim`、`done`、`release` 读取或修改调用方 Member 的 Direction Claim；它只适用于真实 Task。Direction 互斥键执行 Unicode NFKC normalization、trim、空白压缩和确定性大小写折叠。
- `team_view` 发现有界、按 membership 授权的 Channel、顶层 Thread、Task 和 Member 摘要。Thread 条目携带 refs、revision、message 数及适用的 Task status；不返回 Thread Message 或 Activity。
- `context_rollover` 为调用方 Member 安排一次进入全新上下文的 rollover。工具向 Host 校验有界的私有 `handoff`（及可选 `relatedFiles`；传入 `checkpointRef` 则改为回返到已记录的 checkpoint），结束当前 turn 并返回 `status: 'scheduled'`；Host 只在成功的 tool result 持久落盘后才执行真正的换窗。`context_rollover` 与 `context_checkpoint` 都会结束 Agent turn（换窗后不得再接旧代工作；checkpoint 在其所属 turn 结束时 resolve）。
- `context_checkpoint` 为调用的 Member 记录一个命名的当前上下文 checkpoint。durable checkpoint 就是 Session projection 折叠的成功 `tool/call`+`tool/result` 对；返回的 ref 由 Member Session 身份加 tool call id 确定性派生。工具体不做 lifecycle 副作用，但会结束 turn：checkpoint 在其所属 turn 结束时 resolve，因此模型把它作为一个完整工作单元的最后动作来记录。
- `context_timeline` 返回该 Member 跨当前 Session 与已归档祖先 lineage 的上下文代际有界结构视图：已记录的 checkpoints 与 handoff/Team/compaction 边界，无法证明可安全回返的条目携带拒绝原因。仅结构信息——不含任何 transcript 正文。

Agent 不能通过 mention 静默把另一个 unfollowed Agent 加入 Thread；Host 返回 `member_not_following`。Human confirmation 属于单独的 Host/Client 流程。Closed Task 在 Human reopen 前拒绝 reply、Claim 和新的 Attention；taskless Thread 没有 Claim 或 Task resolution mutation path。

Canonical result 包含稳定 refs、可选的 Task status、Thread revision、Claim history、Attention 和未读 facts。类型化的 `unread_required` 与 `stale_revision` 结果包含重新读取和审慎重试所需字段。工具执行通过准确的 live `exec.agent` 解析 actor；参数不能选择或冒充 actor 或 Workspace。写操作的 request identity 由 sessionId 与 tool callId 派生。`context_rollover` 与 `context_checkpoint` 结束 Agent turn；其余 Team tools 将结果返回模型循环，不主动结束 turn。

完整的已实现协议见 [`../../docs/team-collaboration.md`](../../docs/team-collaboration.md)。

## Composition

在 team-enabled Agent preset 内、`dsh-tools` 之后挂载本插件。插件只静态 inject `tools`；执行时从 live Agent context 读取 `agentTeam`，避免 Host 恢复 Member session 时形成依赖环。
