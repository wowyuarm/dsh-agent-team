# @wowyuarm/dsh-agent-team/client

[English](README.md) | 中文

可选的 Agent Team Web Client。它通过公开的 Client slots 和 typed Host Remote 接口提供 Team mode，不在浏览器侧维护 Team 数据或未读状态。

## Human 工作流

进入 Team mode 后默认打开 Channels。Human 导航路径是 Workspace → Channel → Task → Thread；Client 不显示、不进入、也不轮询 Human Inbox。打开 Task 的 Thread 会调用 Host 的 `readThread`，然后展示公开 Thread 时间线、分页历史、Claims，以及处于错误状态且仍有 active Claim 的 Agent 风险。当前 Thread UI 不展示关注/取消关注按钮，也不展示 Human 的关注/取消关注观察。Human 消息按字面文本渲染，Agent 消息使用 Harness 共享的 Markdown 原语渲染；时间线打开时定位到底部（或未读分界线），仅在读者停留在底部时跟随新消息，前插更早历史时保持视口稳定。读者停留在底部时正看着到达的更新会被立即持久确认；读者已向上滚动时，同样的更新会计入显式的"新更新"操作。

侧栏行自带控件：行级 ⋯ 菜单打开对应编辑器——`updateChannel` 修改频道名称/说明；`updateMember` 编辑 Agent 名称/说明，并可为该成员固定可选的 provider/model（缺省即清除覆盖、回到 Host 默认继承；对活跃成员改模型由 Host 静默停用再以同一 Session 重激活，立即生效）。模型选择经与会话无关的 `llm.models` RPC 读取 Host 目录。点击 Agent 卡片会退出 Team 模式并打开该成员的会话页。

Client 使用以下 Host 接口：

- `readThread`：确认一个 Thread 的未读批次。
- `threadHistory`：读取更早事实，不改变已读状态。
- `updateChannel`：提交频道名称/说明的展示事实修改。
- `updateMember`：提交 Agent 名称/说明编辑，以及可选的成员级模型覆盖。
Host Remote 仍提供 `threadObservations` 和 `changeAttention`，供后续 UI 与 Agent 工作流使用；当前 Human Thread surface 不渲染这些控制或观察。`changes` 提供轻量的范围化变更通知：每个请求声明一个 `scope`（workspace、channel 或 thread），只有匹配的事件会唤醒对应 long-poll；Thread 读取会持久化提交但不唤醒任何 scope，因为它不改变任何共享投影。Client 通过 `TeamChangeStream` 在每个 scope 上共享一条可取消的 long-poll，面板与页面不会为同一 scope 并行发起 `changes` 请求，最后一个订阅者离开时轮询即被取消。打开 Task Thread 只发出一轮并行请求（`readThread`、有界历史、成员、频道视图），不会出现自触发的第二波请求。

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
