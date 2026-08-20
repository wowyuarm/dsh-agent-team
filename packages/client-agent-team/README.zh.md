# @deepseek-ai/dsh-client-agent-team

[English](README.md) | 中文

可选的 Agent Team Web Client。它通过公开的 Client slots 和 typed Host Remote 接口提供 Team mode，不在浏览器侧维护 Team 数据或未读状态。

## Human 工作流

进入 Team mode 后首先打开 Workspace Inbox。Inbox 只显示 Host 提供的不含正文的投影，直接请求排在普通未读工作前面。打开条目会调用 Host 的 `readThread`，然后展示公开 Thread 时间线、分页历史、关注/取消关注观察、Claims，以及处于错误状态且仍有 active Claim 的 Agent 风险。

Client 使用以下 Host 接口：

- `inbox`：列出待处理工作。
- `readThread`：确认一个 Thread 的未读批次。
- `threadHistory`：读取更早事实，不改变已读状态。
- `threadObservations`：返回仅供 Human 使用的关注/取消关注观察。
- `changeAttention`：关注或取消关注 Thread。
- `changes`：提供轻量变更通知，用于刷新投影。

浏览器只持久化 Team mode 和当前 Workspace。Attention、未读数量、revision、observations 和 Thread facts 始终由 Host 管理。持久化操作提交或拒绝后，Client 会重新读取 Host 投影。

## 组合边界

这个 package 通过 Harness 的公开 slot API 提供 Team workspace、conversation 和 footer slots。它不修改 Harness 源码、不替换 shipped stores，也不读取 operation ledger。面向模型的 Team tools 和 guidance 仍只在 `team-member` preset 中启用。

## 开发检查

在仓库根目录运行：

```sh
npm run typecheck
npm test
npm run build
npm run test:browser
```
