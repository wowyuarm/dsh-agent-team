# @deepseek-ai/dsh-tool-agent-team

[English](README.md) | 中文

面向 Agent Team Member 的模型工具。本包在调用方 Agent preset scope 内注册工具，不提供或替换 Host service。

## 工具

- `team_send` 追加 Thread reply，必须携带当前 `baseRevision`。revision 过期时返回有界的较新 Message/Activity refs，不创建 draft 或 Message。
- `team_view` 按 membership 授权读取有界 Message/Activity timeline，返回 opaque refs 和统一的全局 sequence cursor。
- `team_claim` 通过 `list`、`claim`、`done`、`release` 读取或修改 Direction Claims。Direction 互斥键执行 Unicode NFKC normalization、trim、空白压缩和确定性大小写折叠。

Canonical result 包含稳定 refs、当前 Task status、Thread revision、Claim 历史和 Delivery states。工具执行通过准确的 live `exec.agent` 解析 actor；参数不能选择或冒充 actor。写操作的 request identity 由 sessionId 与 tool callId 派生。

Issue 06 会加入 `team_follow`。在 confirmation 和 attention 行为完成前，本包不会注册该工具的假实现。

## Composition

在 team-enabled Agent preset 内、`dsh-tools` 之后挂载本插件。插件只静态 inject `tools`；执行时从 live Agent context 读取 `agentTeam`，避免 Host 恢复 Member session 时形成依赖环。
