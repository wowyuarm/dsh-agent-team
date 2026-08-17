# Agent Team UI Redesign Baseline

日期：2026-08-17
状态：ready-for-agent；调研已完成，本轮只产出设计文档与 tickets，不修改产品代码
范围：重做 `packages/client-agent-team` 的信息架构、视觉结构和交互表达；保留已验证的 Host、ledger、typed Remote、Team mode slot takeover 和持久化边界

## 1. 为什么需要重做

M2 已证明 Agent Team 的功能闭环、外部 bundle 安装、Host/Client 边界、桌面/窄屏无溢出和退出恢复，但这不等于 UI 已达到 DSH Web 的产品质量。

当前实现主要使用原生 `button`、`input`、`textarea` 和约 490 行自定义 CSS。它消费 DSH theme token，却没有充分消费 DSH 的组件、信息密度、交互状态和 surface 结构。因此当前页面像“运行在 DSH Shell 中的独立测试界面”，而不是 DSH 的原生协作模式。

后续验收必须分成两条独立门槛：

1. **功能正确**：authority、幂等、revision、Claim/Task 状态、实时刷新、恢复和卸载仍然正确。
2. **原生体验**：组件语言、层级、密度、反馈、窄屏重排和可访问性与 DSH Web 一致。

任一门槛未通过，都不能称为 UI 完成。

## 2. 不改动的边界

- 不改变 Agent Team domain schema、operation ledger 或 authority。
- 不改变 `mode + workspaceId` 持久化；Channel、Thread、tab 和表单仍为 transient state。
- 不增加 Agent DM、Thread inbox、附件、搜索、URL routing、模型选择或 prompt tuning。
- 不修改 Harness core；只依赖已发布的公共 Client package、service 和 slot contract。
- 不复制 shipped WorkspaceBrowser、Conversation 或 Settings 的私有实现。
- 不让 Client 解释 Operation；Client 继续通过 typed Remote 读取 Host projection。
- Team mode 继续动态 shadow `sidebar.workspaces`、`conversation`、`sidebar.settings`；`sidebar.footer.action` 保持 additive。

## 3. 设计目标

- **同一产品**：Team surface 使用 DSH 的 primitive、token、字号、行高、控件尺寸和 overlay 语法。
- **工作界面**：信息密度适合反复扫描和操作，不使用大面积空白、装饰卡片或营销式构图。
- **层级明确**：Place、Message、Task、Claim、Activity、Presence 在视觉上各有稳定角色，不靠用户猜测。
- **操作就地**：主流程操作靠近其对象；低频管理动作进入 Menu/Modal，不长期占据主内容。
- **状态可信**：loading、empty、error、pending、confirmation、stale revision 都有明确但克制的反馈；不使用假 optimistic state。
- **窄屏可用**：不是把桌面布局压窄，而是重排 header、controls、participants、timeline 和 composer。
- **可卸载**：重做不改变 slot 生命周期；重复 enter/leave、refresh 和 unload 继续恢复 shipped UI。

## 4. Surface 架构

### 4.1 桌面 Team mode

```text
┌────────────── Sidebar 280px ──────────────┬──────────── Conversation ────────────┐
│ Team workspace selector              [+] │ # channel-name             [Members] │
│ Channels | Agents                         │ Channel purpose / participant summary │
│                                          ├───────────────────────────────────────┤
│ CHANNELS                                 │ timeline                              │
│ # delivery                     2 members │ Human / Agent message rows            │
│ # backend                      1 member  │ task footer → Thread                   │
│                                          │                                       │
│ AGENTS                                   │                                       │
│ ● builder                     available  ├───────────────────────────────────────┤
│ ◌ reviewer                      working  │ mention affordance + composer + Send  │
├──────────────────────────────────────────┤                                       │
│ [Team / Back to conversations]           │                                       │
└──────────────────────────────────────────┴───────────────────────────────────────┘
```

原则：sidebar 负责导航和轻量状态；中央页负责当前 Channel/Thread；创建和全局管理不以内嵌大表单长期挤压列表。

### 4.2 Channel

```text
┌ # delivery ─────────────────────────────────────────── [•••] ┐
│ M2 完整协作验收 · 2 agents                                  │
├──────────────────────────────────────────────────────────────┤
│ Human                                      10:32              │
│ 请协作完成验收                                                 │
│ @builder @reviewer                                             │
│ Task #1 · In progress · 2 replies                    [Open →] │
│                                                              │
│ builder                                    10:35              │
│ 已完成 API 接口                                                 │
├──────────────────────────────────────────────────────────────┤
│ [@ Mention]                                                    │
│ Write a message…                                      [Send] │
└──────────────────────────────────────────────────────────────┘
```

- Header 固定表达 Channel 名称、purpose 和 participant summary。
- 成员增删属于 header menu / Members modal，不在 timeline 上方常驻管理表单。
- Message 是主体；Task metadata 是顶层 Message 的 footer，不伪装成第二张卡片。
- timeline 从顶部自然开始，composer 固定在内容底部；空 Channel 使用有动作的 compact empty state。

### 4.3 Thread

```text
┌ [←] Task #1                         In review      [Accept] [•••] ┐
│ 请协作完成验收 · #delivery · 3 messages                         │
├─────────────────────────────────────────────────────────────────┤
│ WORK                                                           │
│ ● builder   实现验收功能                 Done                    │
│ ◌ reviewer  检查结果                     Active                  │
├─────────────────────────────────────────────────────────────────┤
│ DISCUSSION                                                      │
│ Human / Agent message rows                                      │
│ ── builder marked “实现验收功能” done · 10:41 ──                │
│ Human 已检查 Thread                                             │
├─────────────────────────────────────────────────────────────────┤
│ [@ Mention]  Reply…                                      [Send] │
└─────────────────────────────────────────────────────────────────┘
```

- Task header 承担返回、编号、状态和合法 Human actions。
- Claim 是 compact work table/list，不和 presence 合并；presence 只用状态点表达 runtime。
- Message 与 Activity 共用时间轴，但视觉类型必须不同：Message 是内容，Activity 是低强调 system row。
- accepted/closed 后 composer 保留上下文但清楚说明需 reopen，不只依赖 disabled button。

### 4.4 Agents 和创建流程

```text
Sidebar Agents list              Add Agent modal
┌ Agents                    [+]  ┌ Add Agent ─────────────────────┐
│ ● builder        available    │ Name        [                ] │
│ ◌ reviewer         working    │ Description [                ] │
│ ! tester       unavailable    │                                │
└──────────────────────────────  │             [Cancel] [Create] │
                                └────────────────────────────────┘
```

- Agents tab 是紧凑列表，不在列表内展开完整创建表单。
- 点击 Agent row 打开其真实 Member session；本阶段不创建 Team DM。
- unavailable 的 diagnostic 通过 Tooltip/HoverCard 或 detail row 提供，不把长错误直接塞进列表。
- 创建 pending 非 optimistic；成功后 row 出现，失败后 modal 保留输入并显示错误。

### 4.5 Channel 创建和成员管理

- 新建 Channel 使用 Modal：name、purpose、initial members；确认后一次 Host operation 创建。
- Channel row 显示名称、轻量成员数和选中态，不用独立 card 边框。
- Members modal 同时用于全局浏览和当前 Channel membership，但标题、scope 和可执行动作必须明确。
- join/remove pending 只锁定对应 Member 行，失败保留 Host projection，不做 optimistic toggle。

### 4.6 窄屏 390×844

```text
┌ rail 56 ┬───────────────────────────────┐
│ [T]     │ [←] Task #1          [•••]  │
│ [#]     │ In review                     │
│ [A]     ├───────────────────────────────┤
│         │ Claims (horizontal compact)   │
│         │ timeline                      │
│         │                               │
│         ├───────────────────────────────┤
│ [Back]  │ Reply…                 [Send] │
└─────────┴───────────────────────────────┘
```

- 继续复用 Harness 56px rail，不增加 Team 专属 hamburger shell。
- Header 操作折叠为 icon/menu；状态另起一行，禁止硬塞在单行。
- Claim row 允许内容换行，但 owner、direction、state 不按字符逐字换行。
- mention recipient 进入 menu/popover，不在 composer 上方铺满 checkbox。
- Modal 在窄屏使用稳定边距和可滚动 body；按钮不被挤出 viewport。

## 5. 信息与视觉语法

| 对象 | 稳定视觉角色 | 禁止做法 |
|---|---|---|
| Workspace / Channel / Agent | sidebar navigation row | 每项独立浮动 card |
| Runtime Presence | `StateDot` + accessible text | 把 presence 当 Claim state |
| Message | timeline content row | 所有消息都画完整边框卡片 |
| Task | 顶层 Message footer + Thread header | 与 Message 重复显示两套正文 |
| Claim | compact work row | 用裸文本和 Message 混排 |
| Activity | 低强调 system row | 直接显示内部 enum（如 `done · member:human`） |
| Mention | composer menu + visible recipient tokens | 永久展示一组 checkbox |
| 创建/管理 | Modal/Menu | 在导航列表内展开长表单 |
| 错误 | 就地 error/Toast，保留输入 | 清空 draft 或只写 console |
| Pending | 对应 control busy/disabled | 全页无差别锁死 |

## 6. DSH 复用边界

权威清单：`research/dsh-ui-reuse-inventory.md`。结论：

- 优先使用 `@deepseek-ai/dsh-client-ui-primitives` 的 `Button`、`Input`、`Modal`、`Menu`、`Tooltip`、`HoverCard`、`Pill`、`StateDot`。
- composer textarea 不误用单行 `Input`；若 conversation package 没有公开可复用 composer，则 Team 实现薄 textarea，但沿用公开 token、尺寸、focus 和 key behavior。
- 不从 Harness package 的私有文件路径导入 Workspace/Session row；只有 package export 明确公开时才能复用。
- public primitive 解决 chrome，不替 Team 承担 domain state 或 Remote mutation。

## 7. 状态设计

每个 surface 必须在文档和测试中覆盖：

- initial loading；
- bounded refresh；
- empty；
- populated；
- mutation pending；
- Host validation error；
- transport error + same-request retry；
- stale revision + refreshed projection + preserved draft；
- mention confirmation；
- unavailable Member diagnostic；
- accepted/closed read-only Thread；
- narrow viewport；
- plugin leave/unload restore。

加载状态不得让旧 Workspace/Channel 内容短暂显示在新 selection 下。错误反馈不得改变尚未被 Host commit 的视觉事实。

## 8. 可访问性

- icon-only controls 必须有 accessible name 和 Tooltip。
- Modal 具备 dialog name、Escape/mask close、初始焦点和关闭后焦点恢复。
- tabs 使用 `tablist/tab/tabpanel`，不是仅靠样式的普通按钮。
- presence dot 为装饰，状态文字或 `aria-label` 承担语义。
- Activity 文案使用用户语言，不暴露 opaque ref 或内部 enum。
- 所有表单错误和 stale conflict 使用 `role=alert` 或等价 live region。
- keyboard focus 必须可见；Menu、Modal、composer 和 timeline action 可全键盘操作。

## 9. 代码边界

建议把当前单一 `team.module.css` 和大组件拆成 surface-owned 模块：

```text
client/
├─ shared/          # Team-only thin wrappers and formatting; no domain state
├─ sidebar/         # workspace/channel/agent navigation
├─ channel/         # header, timeline, composer
├─ thread/          # task header, claims, activity timeline, composer
├─ members/         # global/channel members modal
└─ create/          # Agent/Channel modal flows
```

约束：

- Remote orchestration 留在 surface controller/hook，presentational row 不直接调用 Remote。
- Message/Activity/Task/Claim formatter 各有单一实现。
- 不建立通用 UI framework，不复制 DSH primitives。
- 只有能删除实际重复或隔离复杂状态时才抽组件。

## 10. 实施顺序

1. **Primitive migration**：Button/Input/Modal/Menu/Tooltip/StateDot；移除重复 button/input/modal chrome。
2. **Sidebar redesign**：紧凑 navigation rows、创建 modal、Agent/Channel 状态；保持 transient tab。
3. **Channel redesign**：header、timeline、task footer、composer mention menu、membership modal。
4. **Thread redesign**：Task header、Claim rows、Activity formatter、reply composer、closed state。
5. **Responsive pass**：390×844 rail、header action collapse、modal/composer reflow。
6. **State/a11y pass**：loading/empty/error/pending/confirmation、keyboard、focus、screen-reader names。
7. **Real browser acceptance**：桌面/窄屏截图、完整 journey、视觉对比、leave/unload restore。

每一步都必须保持现有 Host/Client composition tests 通过；不要等到最后再恢复功能正确性。

## 11. 完成标准

### 功能门槛

- 现有 typecheck、46 项测试、build、pack、SQLite/replay 和 browser journey 全部继续通过。
- 不新增 Harness source patch、Operation interpretation 或 optimistic authority。

### 原生体验门槛

- 主要按钮、输入、Modal、Menu、Tooltip 和 presence 不再由 Team 重造已有 DSH primitive。
- sidebar、Channel、Thread、Members 的层级在 5 秒内可扫描理解。
- 桌面中心区不再出现无意义大面积空白；timeline 从 header 下自然开始，composer 稳定停靠。
- Activity 不暴露内部 enum/ref；Claim、Presence、Task status 清楚分离。
- 390×844 下无逐字换行、横向 overflow、遮挡或不可达操作；不是单纯缩小桌面布局。
- 截图需同时与旧 Team 截图和 shipped DSH surface 对照，由 Human 做最终视觉纠偏。

## 12. 调研依据与文档关系

- 当前浏览器证据：`../m2-ui/validation/m2-06/`。
- 当前实现：`packages/client-agent-team/src/client/`。
- 当前视觉审计：`research/team-ui-visual-audit.md`。
- DSH public primitive / slot inventory：`research/dsh-ui-reuse-inventory.md`。
- 成熟协作产品模式与 adopted/rejected 清单：`research/collaboration-ui-patterns.md`。
- DSH styling contract：`deepseek-harness/docs/web-styling.md`。
- 实施范围合同：`../ui-redesign/spec.md`。
- 实施 tickets：`../ui-redesign/issues/`；下次会话只从 `../ui-redesign/README.md` 进入。

文档优先级：领域与 authority 冲突时以 `../CONTEXT.md` / `architecture.md` 为准；UI surface 与质量门槛以本文为准；具体 public API 事实以 reuse inventory 和 Harness 已发布类型为准；ticket 只能收窄本文，不能扩大范围。
