# @deepseek-ai/dsh-tool-agent-team

[English](README.md) | 中文

面向 Agent Team Member 的模型工具。本包在调用方 Agent preset scope 内注册工具，不提供或替换 Host service。

## 当前接口

`team_view` 通过准确的 live `exec.agent` 身份读取有界协作事实。Host 将该 Agent 解析为唯一 durable Member，并检查 Workspace 与 Channel membership；工具参数不能选择或冒充 sender。

Canonical result 包含 Channel、Message、Task、Thread refs、Task status、Thread revision、cursor 和 `hasMore`。Refs 是 opaque 值，调用方应原样复用。

后续 M1 issue 会在本包加入 `team_send`、`team_claim` 和 `team_follow`。在对应行为完成前，本包不会注册假实现。

## Composition

在 team-enabled Agent preset 内、`dsh-tools` 之后挂载本插件。插件只静态 inject `tools`；执行时从 live Agent context 读取 `agentTeam`，避免 Host 恢复 Member session 时形成依赖环。
