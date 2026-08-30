# @wowyuarm/dsh-agent-team/tools

[English](README.md) | 中文

面向 Agent Team Member 的模型工具。本包在调用方 Agent preset scope 内注册工具，不提供或替换 Host service。

## 工具

- `team_inbox` 列出调用方 Member 的有界未读 Thread 摘要，先按 direct work、再按最近活动排序；只有 Thread 存在真实 Task overlay 时才出现 Task status/number。
- `team_thread` 读取 Thread、分页历史、follow 或 unfollow。`threadRef` 是主身份；`taskRef` 只对 released task-only Client 是 Host alias。`read` 原子返回 Thread anchor、可选的当前 Task 与 Claim 快照、有界背景和一批连续未读事实，并推进持久 watermark；`history` 不改变 read 状态。
- `team_message` 创建顶层 Thread，或回复已有 Thread。它默认创建 taskless Thread；传入 `asTask: true` 才原子创建 Task。Reply 必须携带准确的 `baseRevision`，并在检查 revision 前先处理未读门禁。
- `team_claim` 通过 `list`、`claim`、`done`、`release` 读取或修改调用方 Member 的 Direction Claim；它只适用于真实 Task。Direction 互斥键执行 Unicode NFKC normalization、trim、空白压缩和确定性大小写折叠。
- `team_view` 发现有界、按 membership 授权的 Channel、真实 Task 和 Member 摘要，不返回 Thread Message 或 Activity。

Agent 不能通过 mention 静默把另一个 unfollowed Agent 加入 Thread；Host 返回 `member_not_following`。Human confirmation 属于单独的 Host/Client 流程。Closed Task 在 Human reopen 前拒绝 reply、Claim 和新的 Attention；taskless Thread 没有 Claim 或 Task resolution mutation path。

Canonical result 包含稳定 refs、可选的 Task status、Thread revision、Claim history、Attention 和未读 facts。类型化的 `unread_required` 与 `stale_revision` 结果包含重新读取和审慎重试所需字段。工具执行通过准确的 live `exec.agent` 解析 actor；参数不能选择或冒充 actor 或 Workspace。写操作的 request identity 由 sessionId 与 tool callId 派生。Team tools 将结果返回模型循环，不主动结束 turn。

完整的已实现协议见 [`../../docs/team-collaboration.md`](../../docs/team-collaboration.md)。

## Composition

在 team-enabled Agent preset 内、`dsh-tools` 之后挂载本插件。插件只静态 inject `tools`；执行时从 live Agent context 读取 `agentTeam`，避免 Host 恢复 Member session 时形成依赖环。
