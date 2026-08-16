# Agent Team M2 UI/UX 设计基线

日期：2026-08-16
状态：M2 第一阶段 UX grill 完成；实施范围见 `../m2-ui/spec.md` 与 `../m2-ui/issues/`。
位置说明：`.scratch/` 探索性内容。

## 1. 设计原则

- Team UI 是 DSH Web 的 feature plugin，不定义第二套主题、组件库或 Shell。
- Workspace 是项目与 cwd 的既有事实；Channel 和 Agent Member 在 Team 模式下按 Workspace 组织，但不混入默认 Session 树。
- Operation ledger 与 Agent runtime 是权威；Client 只经 typed RPC 读不可变投影和提交 Human authority 请求。
- Team 模式与默认对话模式互相替换但不互相复制：进入时动态占用 seats，退出时释放并恢复 shipped UI。
- Channel/Thread 只显示显式 Message 与协作 Activity，不显示任何成员的内部 session events。
- 第一阶段先交付可体验的协作闭环；Agent DM、Thread inbox、附件、搜索、URL 和 prompt 设计延期。

## 2. Team 模式

默认 DSH sidebar：

```text
┌─ sidebar ─────────────────┐
│ DeepSeek HARNESS      [←] │
│                           │
│ Workspace A               │
│   Session 1               │
│   Session 2               │
│                           │
│ 团队                      │
│ 设置                      │
└───────────────────────────┘
```

点击“团队”后保留顶部 Shell，替换 sidebar body 与 center column，并隐藏 Settings：

```text
┌─ Team sidebar ────────────┐
│ DeepSeek HARNESS      [←] │
│                           │
│ Workspace A               │
│   [Channels] [Agents]     │
│   #frontend          [+]  │
│   #backend                 │
│                           │
│ Workspace B               │
│   [Channels] [Agents]     │
│   #research          [+]  │
│                           │
│ 成员                      │
│ ← 对话                    │
└───────────────────────────┘
```

行为：

- Team 模式动态 shadow `sidebar.workspaces`、`conversation` 与 `sidebar.settings`；退出或 plugin unload 后 shipped occupants 自动恢复。
- DSH 品牌栏、sidebar 折叠控制和 layout 始终由 shipped UI 持有。
- Team 模式隐藏 Settings；底部只有全局“成员”和“← 对话”。
- 进入 Team 模式不会改变底层当前 Session；退出时继续看到之前的 Session。
- 浏览器本地只保存 `mode + workspaceId`。刷新后恢复 Team 与 Workspace；失效 Workspace 自动清除。tab、Channel 和 Thread 不持久化。
- 不增加 URL/router，不响应浏览器 Back/Forward。
- Workspace 使用 Host registry 顺序，不做搜索或 Team 专用排序。
- 新建 Workspace 复用现有 Client Workspace runtime 和 `sidebar.workspaces.directoryFlow` 交互契约，不修改 DSH 核心。
- sidebar 收起到 rail 后不显示 Workspace/Channel/Agent 行，只保留 Shell 控件和 Team/返回入口；重新展开恢复 Team 目录。

## 3. Workspace 目录

每个 Workspace 是一个项目；Agent Member 的 cwd 是 Workspace path。一个 Agent Member 只绑定一个 Workspace，可加入该 Workspace 的多个 Channels。

### 3.1 Channels / Agents

- 每个 Workspace 提供 `Channels` 与 `Agents` 两个 tab；首次默认 Channels。
- active tab 右侧 `+` 打开创建面板。
- 不同 Workspace 可以存在同名、同描述 Agent；同一 Workspace name 唯一。唯一身份始终是 memberRef。
- Agent 不具有人格或跨 Workspace 身份；name/description 只是该 Workspace 内的协作名片。
- Agent 创建第一阶段只填写 name 与 description，固定使用 shipped team-member preset 和 Host default model。Model/provider/preset 选择延期。

### 3.2 Agent 状态

Agent runtime status 是进程投影，不写 Team ledger：

| 状态 | 事实 | 呈现 |
| --- | --- | --- |
| `available` | live Agent idle，没有 loop | DSH success 绿色静态点 |
| `working` | Agent loop running，含模型等待与正常 tool call | DSH ongoing 蓝色动态点 |
| `error` | 当前活动发生 loop/tool error，保留到下一次 loop 启动 | DSH error 红色静态点 |
| `unavailable` | 无可用 AgentHandle、suspended/inactive 或 setup/resume 失败 | 语义 neutral/disabled 灰色静态点 |

列表不显示状态文字；Tooltip 与无障碍文本提供状态名称，error/unavailable 提供简短原因。`unavailable > error > working > available` 是组合事实的显示优先级。`creating` 仅是本地 pending UI，创建完成前不能加入 Channel。

### 3.3 全局成员面板

“成员”不属于某个 Workspace tab；它打开 frame overlay 中的只读 Modal：

```text
┌─ 成员 ────────────────────┐
│ Workspace A               │
│   ● Alice                 │
│   ◌ Bob                   │
│                           │
│ Workspace B               │
│   ● Alice                 │
└───────────────────────────┘
```

第一阶段只按 Workspace 分组查看所有 Agent，不提供搜索、管理或 DM 导航。

## 4. Channel 创建与成员管理

创建 Channel：

```text
┌─ 新建 Channel ────────────┐
│ 名称                      │
│ 描述                      │
│ 成员                      │
│ [Alice] [Bob]             │
│                           │
│              [取消] [创建]│
└───────────────────────────┘
```

- Channel name、description 和 initialMemberRefs 由一条 Human operation 原子提交；任一 Member 非法则全部失败。
- 后续可从 Channel header 管理 membership。
- available/working/error Agent 可加入；creating/unavailable 禁用；inactive 不显示。
- 从 Channel 移除 Member 不删除 Agent：释放该 Channel 内 active Claims、清除 Follows、取消 queued Deliveries，历史 Message/Activity/Task/Thread 保留。

## 5. Channel 页面

```text
┌─ #frontend ──────────────────────────────┐
│ frontend                                  │
│ 前端实现与评审                            │
│                                           │
│ [A] Alice · Agent                         │
│     请实现新的导航栏                      │
│     Task #12 · In progress · 4 replies   │
│                                           │
│ [H] Human                                 │
│     请补充移动端状态                      │
│     Task #13 · Todo · 0 replies          │
│                                           │
│───────────────────────────────────────────│
│ [@成员] 输入消息…                 [发送]  │
└───────────────────────────────────────────┘
```

- Channel 没有 backing Session，不用 Session view 模拟。
- Human 与 Agent Message 使用同一布局；名字首字符只作小型视觉标识。
- 消息行显示 name 与 Member kind；description 放 HoverCard，不在每条消息重复。
- 每条顶层 Message 固定创建 Task；底部显示 Task 编号、派生状态和 Thread Message count，整个 footer 进入 Thread。
- 初始加载最新 bounded page，向上加载旧事实；cursor 使用 ledger sequence。
- Team composer 复用 DSH 的视觉、键盘、focus 和 disabled 约定，但只实现 text、结构化 @mention 和 Send。
- mention 候选只包含当前 Channel Members，持久化 memberRef，不解析纯文本名字。
- 不挂 slash command、model、provider、permission、queue、attachment 或 Session trigger。
- Mutation 不做业务事实 optimistic commit；发送失败保留 draft。

## 6. Thread 页面

```text
┌─ ← #frontend ────────────────────────────┐
│ Task #12                     [状态操作]  │
│                                           │
│ 参与成员                                  │
│ ● Alice   navigation · active            │
│ ◌ Bob     tests · done                   │
│                                           │
│ [A] Alice                                 │
│     导航结构完成                          │
│                                           │
│ [H] Human                                 │
│     请补一个键盘交互测试                  │
│                                           │
│───────────────────────────────────────────│
│ [@成员] 回复 Thread…              [发送]  │
└───────────────────────────────────────────┘
```

- 左上返回 Channel；不增加 URL 路由。
- Member runtime 状态只用状态点；Claim owner、Direction 与 active/done/released 文本单独显示，二者不合并。
- Human reply 使用当前 baseRevision、结构化 mentions、Follow 与 Delivery 规则。
- stale revision 时刷新 Thread，不自动重放 Human 输入。
- Human 可对具体 Claim 执行 done/release，不可代 Agent 新建 Claim，也不直接改 Agent Follow。
- Human 可执行 Task accept/close/reopen；状态操作只放 Thread header。
- 页面显示 Message 与协作 Activity；Task/Claim operation 仍由 ledger 派生投影。

## 7. Client 与 Host 接缝

- 一个 Team Client adapter 是唯一业务接缝：typed RPC + immutable projection + mutation result + changed notification。
- Host changed signal 只提示事实变化；Client 重新拉当前 bounded projection，不在浏览器折叠 Operation event。
- Agent runtime status 变化也通过同一 adapter 更新。
- 所有 durable mutation 等 Host commit 后再显示。表单和 draft 可本地 pending；Agent `creating` 是允许的临时状态。
- slot 冲突采用显式 priority 并 fail loud；不建立通用 mode registry。

## 8. Agent DM（延期但已定方向）

旧设计“直接打开 Agent Member 的内部 session”已废弃。后续 Agent DM 将使用独立持久的 Human-visible transcript，再把 Human 消息投递给 Agent 的内部 append-only session：

```text
Agent Member
├── internal session
│   ├── Team delivery
│   ├── loop/tool events
│   └── append-only model context
└── Human-visible DM transcript
    ├── Human 明确消息
    └── Agent 明确回复
```

该 DM 不在第一阶段 tickets 中；其 Place、visibility、Delivery、失败恢复、管理入口和 session 呈现需单独设计。Trajectory 不应用于 Human-visible DM transcript。

## 9. Thread inbox（UI 完成后单独 grill）

现行 M1 Follow/mention/Delivery 语义在 M2 第一阶段保持不变。后续候选方向：

- 普通 Thread Message 为参与 Member 建立独立 unread inbox item，只提示“有未读消息”，不直接把正文塞进模型上下文。
- 显式 @mention 同时留下 durable inbox item，并在 next-step 边界 steer 目标 Agent，不中断正常 tool call。
- 新 mention 进入持续 Thread 的 Agent 可先看到 Thread 当前状态、参与成员与 Message count，再按 bounded cursor 回读历史；不能一次把全部历史塞进 context。
- 候选新增 `team_inbox` 或扩展 `team_view`，读取与 mark-read 分开。
- 候选 `team_send` 门禁只应考虑当前 Thread 中相关且早于发送基线的未读事实；“任何未读都拒绝”可能让无关消息阻塞工作，尚未定案。
- unread cursor、提示重试、Follow 关系和 prompt 文案全部待 UI 实测后再决定。

## 10. 验收

- 真实 Client plugin + typed RPC + Host composition。
- Team mode 三席 take/restore：`sidebar.workspaces`、`conversation`、`sidebar.settings`。
- desktop 与窄/mobile browser snapshot，无重叠、无文本溢出。
- 完整 GUI journey：团队 → Workspace → Agent → Channel → Message/mention → Thread → Human reply → Claim/Task operation → Channel → 对话。
- 退出/卸载后默认 DSH sidebar、Settings、Conversation 和当前 Session 均恢复。
- M1 REAL composition、SQLite restart、typecheck、build 和 pack 保持通过。

## 来源

- 本会话 2026-08-16 UX grill Q1-Q46 与 ponytail review。
- DSH `web-styling`、Client Modules、ui-sidebar、ui-workspace、ui-layout、ui-conversation、ui-primitives contracts。
- M1 当前事实：`architecture.md`、`spec.md` 与 issues 01-09。
