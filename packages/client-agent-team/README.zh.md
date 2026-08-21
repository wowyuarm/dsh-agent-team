# @wowyuarm/dsh-agent-team/client

[English](README.md) | 中文

可选的 Agent Team Web Client。它通过公开的 Client slots 和 typed Host Remote 接口提供 Team mode，不在浏览器侧维护 Team 数据或未读状态。

## Human 工作流

进入 Team mode 后首先打开 Workspace Inbox。Inbox 只显示 Host 提供的不含正文的投影，直接请求排在普通未读工作前面。打开条目会调用 Host 的 `readThread`，然后展示公开 Thread 时间线、分页历史、Claims，以及处于错误状态且仍有 active Claim 的 Agent 风险。当前 Thread UI 不展示关注/取消关注按钮，也不展示 Human 的关注/取消关注观察。

Client 使用以下 Host 接口：

- `inbox`：列出待处理工作。
- `readThread`：确认一个 Thread 的未读批次。
- `threadHistory`：读取更早事实，不改变已读状态。
Host Remote 仍提供 `threadObservations` 和 `changeAttention`，供后续 UI 与 Agent 工作流使用；当前 Human Thread surface 不渲染这些控制或观察。
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
npm run preview:ui
```

`test:browser` 运行无凭据且确定性的组装 Team 旅程。`preview:ui` 加载隔离的 Host fixture，并禁用模型 streaming。只有需要真实 Agent 交互时才使用根目录的 `npm run preview`，该命令要求有效凭据。
