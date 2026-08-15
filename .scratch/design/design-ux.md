# Agent 持久化模型与 UI/UX 设计（修正版）

日期：2026-08-14
状态：M2 UI/UX 基线；Slot take 已完成真实渲染和可逆性验证。Member、Workspace 与持久化语义以 `architecture.md` 为准。
位置说明：`.scratch/` 探索性内容。

## 1. Agent 持久化模型（修正）

用户修正："session 不变"指**每个 agent 的 context 一直追加**（append-only，token
阈值触发 compaction）；agent 有**单独 workspace**（memory.md + notes/）；插件名
暂定 `dsh-agent-team`。

成员的 session、Agent loop、compaction 与 cwd 复用 dsh 现成能力；Team 仍需自建 Member lifecycle、operation ledger、Delivery 补偿和 private memory 位置管理：

| 用户要求 | dsh 对应 |
| --- | --- |
| Agent Member 的持久身份 | Team Member record + exact sessionId；preset 只定义该 session 的组成 |
| context 一直追加 | Session log 是 append-only；compaction 替换 model surface，但原始 log 保留 |
| token 阈值触发 compaction | Team-enabled preset 在 isolate realm 挂 compaction-basic；host 通过 agent preset service lookup 访问成员级引擎 |
| 项目 Workspace | 同一 Workspace 的 Members 共享项目 cwd；一个 Member 不跨 Workspace |
| 私有记忆 | DSH 管理的 member-private 目录保存 `memory.md` + `notes/`，不放项目根目录 |
| 一个 Agent Member 一个 session | direct chat = 打开该 Agent Member 的 session；普通 fork 不继承 Team identity |

`dsh-agent-team` 复用 Session、Agent、preset、compaction 和 workspace registry，但 Host plugin 负责 Member create/resume/suspend/remove、private memory location、operation ledger 和 queued Delivery 补偿。

## 2. UI/UX 结构（用户确认版）

### 2.1 侧边栏布局

```text
┌─ sidebar ──────────────┐
│ 工作区 A               │  ← 现有 workspace 浏览区
│   └ session 1..n       │  ← 现有（agent 会话仍在这里）
│   └ #channel-name      │  ← 新增：项目展开时额外的 channel 分组
│        └ channel 1..n  │  ← 点进 channel 内视图
│ 工作区 B               │
│   └ …                  │
│                        │
│ ┌──────────────┐       │  ← 新增：Agents 按钮（settings 上方）
│ │ Agents ▾     │       │  ← 点击向上展开 agents 卡片
│ │ [card][card] │       │     进一步点击进入该 agent 的 direct chat
│ └──────────────┘       │
│ 设置                   │  ← 现有
└────────────────────────┘
```

### 2.2 channel 内视图

- 复用输入框；消息显示**只渲染 team 消息**（名字代替头像，暂不做头像）；
  agent 内部 events 不进入该视图（R8）。
- 每条顶层消息 = 一个 task（D6），消息底部有 `#n` 标签（该 channel 的第 n 个
  task）；点击标签进入该 task 的 thread 视图。
- 无承诺消息标 closed 后从默认 board 隐藏（D6）。

### 2.3 thread 视图

- 复用 channel 视图组件；延续该 task 的交流（R6：回复必须显式带 target）。
- 顶层 bar：task 状态改变 button（D4 状态机）+ 当前 thread 参与者显示。

### 2.4 Agents 面板与 direct chat

- 左下角 Agents 按钮（settings 上方）→ 展开 Agent Member 卡片（name + description + availability）。
- 点击 Agent Member 卡片 → 打开其 dsh session direct chat（append-only + compaction）。Client 侧复用 `ctx.sessions.open(agentSessionId)`，无需新路由。
- Direct chat 顶部 actions：编辑 Member name/description、查看 member-private memory。
- Direct chat 是 human 管理/对话入口，不是 Team DM，不创建 Team Message、Task、Thread、Follow 或 Delivery。

## 3. UI 落点对照（client Slot 树实测，2026-08-14）

| UI 元素 | Slot | 风险 |
| --- | --- | --- |
| 左下角 Agents 按钮 | `sidebar.footer.action`（list，`replaceRisk: none`，"Optional actions beside Settings at the sidebar foot"） | 无（位置在 Settings 旁；若要严格"上方"需 footer 结构微调） |
| Agents 卡片展开层 | `shell.overlay`（list，frame-wide floating layer）或自渲染浮层 | 无 |
| Agent Member direct chat 顶部 actions | `conversation.session.header.actions`（list，`replaceRisk: none`） | 无（direct chat 即该 Member session 对话） |
| 工作区下 #channel 区域 | `sidebar.workspaces`（single，被 ui-workspace 占据，`replaceRisk: shadows-shipped-ui`） | **高**：需 take 该 seat 自渲染浏览区（session 列表 + channel 组），或另找注入点 |
| channel/thread 视图 | `conversation`（single，被 ui-conversation 的 ConversationRoot 占据，`replaceRisk: shadows-shipped-ui`）；take 后所有子 seat（composer/view/chat.node）随之消失，需自行声明或自渲染 | **高**：需替换整个中心列（含 no-session hero 与普通对话状态的委托） |
| channel 视图输入框 | 复用 InputBar 组件（take conversation 后由我们的 root 挂载） | 中（组件复用方式落地时验证） |

两个 single-seat 落点已经通过动态 Client plugin 完成 take、Host RPC、两处真实渲染、用户目视和三次 stop/run 恢复验证。剩余风险不是 Slot 机制，而是 M2 必须在 replacement root 中委托普通 session/no-session 状态并长期跟随 shipped UI 行为。Channel 没有 backing session，因此不使用 `conversation.view` 把它伪装成 session tab。

## 4. 对 feasibility.md 的影响

- 实现形态节的 client 插件行按本文件细化。
- Member 底层 session 与 compaction 复用 dsh；Member lifecycle、private memory location、operation ledger 和 Delivery 补偿由 Team Host plugin 新建。
- 两个 shadows-shipped-ui seats 的 take 机制已经验证；完整 UI 属 M2，必须补普通 Conversation 委托、routing、loading/error/empty、responsive 与 browser snapshot/GIF。

## 来源

- client Slot 树：本会话 `Slots.listSubTree` 实测（sidebar / conversation /
  sidebar.workspaces / conversation.session.header.actions 等契约）。
- compaction：`packages/compaction/compaction/README.md`（Service Definition、
  compaction-basic provider、tokenMeter 压力触发）。
- Session：`docs/subsystems/core.md`、`docs/architecture.md`（append-only log）。
- 用户修正意见：本会话 2026-08-14。
