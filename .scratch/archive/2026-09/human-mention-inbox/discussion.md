# Discussion snapshot — Human「提到我」

Working notes, not a spec. Confirmed vs open is the only split that matters.

## Confirmed (human 2026-09-13)

- Agent 互聊快是特点，不压速。跟不上是因为 Human 没有「提到我」面。
- Inbox 下一版落地；中文名「提到我」。
- **全局**，不是当前工作区内。
- 通知默认只认 structured `@mention` Human。正文 `@human`、单独的 `Decision needed` 行都不算。
- Thread 时间线不另藏未 mention 的消息；现有 600 字折叠够用。
- 不要过度强调两种对话方式。所有消息同一套写法；**单独向 Human 汇报时**必须 mention，并管开头的语言和信息量。
- Inbox 行优先级：**workspace → channel → task… → 顶层消息（截取）→ 时间**。
- prompt 与 Inbox **同一 scratch、一起实施**；继续讨论形态 / UX 后再动手。
- 从 Inbox 行进入 Thread 后，**返回到该 Channel**（Inbox 页仍可从左侧卡片再进）。
- 同一 Thread 多条未读 mention：**一行**，时间取最新。
- **打开 Thread 才算已读**（durable read 清 marker）。打开 Inbox 页本身不清。
- Mention 最小集：要 Human 决策；Claim 收工等验收；阻塞/风险 Human 必须知道；Human 点名要的进度。中途 agent 互聊进度不 mention。
- **窄轨要第三枚图标**，点进去就是 Inbox 页（不是只展开侧栏某一节）。候选：`IconQueueOutline14`（队列，未占用）。Channels 已用 `IconListPenOutline16`，Agents 已用 `IconAgentPresetOutline16`；不要复用 checklist（任务控件）或 user（成员）。徽标挂在这枚图标上。

## Closed into spec.md (2026-09-13)

Human: 「你自己去系统想一想设计吧。最后落文档」。剩余开放点由 Momo 收口，见 spec.md。本文件不再改决策。

## Proposed (superseded — see spec.md)

入口：**工作区列表之上一张「提到我」卡片**（徽标 = 跨 workspace 的 direct 计数）。点击后 **右侧 Channel/Thread 栏被接管为 Inbox 页**，而不是在侧栏里铺线程列表。

页上行：workspace / channel / task / 顶层消息截取 / 相对时间。点行 → 切 workspace（若需要）+ 打开该 Thread。Mention 原文进 Thread 再看。

刷新拆两层：

1. 徽标：Team 模式订一次无 scope 的 `changes()`，唤醒后对各 workspace 要 `totalDirectCount` 加总。不打开页面不拉行。
2. 列表：点卡片才拉；打开期间变化再拉。关闭页面停列表。

## Code facts that constrain the design

- Host 已有 Human `inbox` Remote，注释写明 Web Client 不消费。按 **workspace** 切片；条目 **无正文**；`unreadCount` 含 follow 普通未读，`directCount` 才是 mention。
- Direct marker 不依赖 Human follow；mention Human 不会把 Human 拉成 follower。
- `changes()` 可省略 scope = 任意 Team 提交都唤醒，适合跨 workspace 徽标。
- 顶层消息不在 inbox 投影里，要另走 Channel `view` 或新 home 级 Remote。
- Human 是全局身份；跨 workspace 可由 Client 合并现有 Remote，不必改 dsh。
- 机械通知只认 `mentions` 参数。persona 现把「人类层 vs 纯协作」写成两种对话，要收。

## Open — 继续讨论

### 入口与导航

- 卡片确认？（仍待：工作区列表之上一张「提到我」卡片 + 右侧接管 Inbox 页）
- Inbox 页选中时：宽栏 `aria-current` 落在「提到我」卡片；窄轨落在第三枚图标。
- 窄轨图标确认？默认 `IconQueueOutline14`。顺序建议：提到我 → Channels → Agents（通知面在浏览面之上）。

### 列表内容

- 「顶层消息截取」字数？建议首行、约 80–120 字。
- 一行里 workspace / channel / task 的视觉层级：三行 meta + 一行标题，还是一行面包屑？
- 空态文案：「还没有人提到你」？

### 刷新与权威

- 首版 Client 合并各 workspace `inbox` + 补顶层 view，还是先做 home 级仅-direct Remote（一次往返、可带预览）？
- 现成 `inbox()` 混 follow 未读，Human 切片必须 `directCount > 0`（或新参数）。谁做过滤：Client 还是 Host？
### Mention 行为

- 过度 mention 的纠偏：Inbox 变吵时再加规则，还是第一版就写进 prompt「不要为进度 mention」？建议第一版就把最小集写进 docs，persona 只留「向 Human 汇报才 mention」。
- `Decision needed` 行仍建议保留（方便扫），但不进 Inbox。

### Prompt 与发布

- prompt 是否等 Inbox UX 收敛后 **同一批 commit**，还是允许 prompt 先合、UI 后合？human：「和其一起实施」→ 默认同一批。
- shipping.spec 六条「两种对话」断言随 prompt 一起改。

### UX 边角

- 提到你的 Thread 已打开时：徽标是否仍亮、Inbox 行是否还在？打开中的 durable read 会清 marker，行应消失。
- 归档 Channel / 已关 Task 上的 mention：进 Inbox 吗？建议进，点进去走现有归档/关闭表面。
- 未 follow 的 Thread 被 mention：现在就能进（direct marker）；Inbox 是发现面，不必先 follow。
