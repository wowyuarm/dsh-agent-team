# Agent Team UI Redesign Spec

日期：2026-08-17
状态：ready-for-agent；三份调研报告已完成，具体 tickets 见 `ticket-plan.md` 与 `issues/`
依赖：M2 functional baseline（commit `9ae7cc3`）
设计基线：`../design/team-ui-redesign.md`

## 1. 问题

Agent Team 已具备完整功能闭环和真实浏览器证据，但当前 Client UI 主要由原生 HTML 控件与自定义 CSS 组成，只消费 DSH theme tokens，没有充分复用 DSH primitives、信息密度和 surface 语法。结果是功能属于 DSH，体验却像嵌入 DSH Shell 的独立测试界面。

本阶段只重做 Client presentation 和 interaction structure。Host、ledger、Remote、authority、projection、slot takeover 与 persistence 不变。

## 2. 用户故事

1. Human 进入 Team 后，第一眼能识别当前 Workspace、Channels、Agents 和所选对象，不需要学习第二套 UI。
2. Human 能从紧凑 sidebar 扫描 Channel membership 和 Agent runtime state，不被创建表单挤开。
3. Human 使用 DSH 风格 Modal 创建 Agent/Channel；失败保留输入，pending 不制造假事实。
4. Human 打开 Channel 后立即看到 header、timeline 和 composer，不面对大面积无意义空白。
5. Human 能区分 Message、Task footer、Activity、Claim、Task status 和 runtime presence。
6. Human 通过 menu/modal 管理 Channel members，而不是在主 timeline 上方长期展开管理区。
7. Human 使用 mention menu 选择当前 Channel Members，而不是操作永久 checkbox 列表。
8. Human 打开 Thread 后能快速判断 Task 状态、当前 work directions、讨论历史和下一合法动作。
9. Human 在 accepted/closed Thread 中看得到为何不能回复，以及如何 reopen。
10. Human 在 390×844 窄屏上仍能阅读 timeline、操作 header、选择 mention 和发送，不出现逐字换行、遮挡或不可达控件。
11. Keyboard 和 screen-reader 用户能使用 tabs、menus、modals、composer 和 icon buttons。
12. Plugin enter/leave/reload/unload 后 shipped UI 与当前 Session 仍完整恢复。

## 3. 实现决策

- 使用 DSH public primitives；不 import Harness 私有 Workspace row、MessageItem 或 InputBar 源码。
- Team 自己保留 Message/Activity/Claim/Task 的领域 presenter，因为这些对象不属于 Session conversation projection。
- 创建与低频管理进入 Modal/Menu；sidebar 和 timeline 只保留导航、内容和局部动作。
- sidebar row 不使用 card；Channel/Agent 采用紧凑 row + selected/hover/focus state。
- Channel timeline 从 header 下方自然开始；composer 作为稳定底部区域，不用 `space-between` 制造空白。
- Thread 把 Claims 作为 work section；Message 与 Activity 按 sequence 合并但使用不同 renderer。
- Activity 必须本地化为用户文案，不显示 operation enum 或 opaque actor ref。
- mentions 继续提交 Member refs；menu token 只是 presentation。
- 不做业务 optimistic update；失败保留 draft/form，重试遵守已有 requestId 规则。
- narrow layout 复用 Harness 56px rail，Team center 内部单独重排 header、sections、menu 和 composer。

## 4. 公开依赖

目标依赖保持在现有 Harness `0.1.0-rc.5` public package 范围内。优先使用：

- `@deepseek-ai/dsh-client-ui-primitives`: `Button`, `Input`, `Modal`, `Menu`, `Tooltip`, `HoverCard`, `Pill`, `StateDot`, `Toast`, public icons。
- `@deepseek-ai/dsh-client-ui-slots`: slot props、locale 和 store contracts。
- `@deepseek-ai/dsh-client-ui-sidebar`, `ui-conversation`, `ui-workspace`: 只使用公开 slot/type contract，不导入私有 composite component。
- `clsx`: 与 Harness styling contract 一致地组合 CSS Module states。

最终矩阵由 `../design/research/dsh-ui-reuse-inventory.md` 冻结。

## 5. 非目标

- 不增加新 Host Remote 或 domain operation。
- 不引入新 component library、Tailwind 或 Team theme。
- 不修改 Harness core，不要求用户 source patch。
- 不实现 Agent DM、Thread inbox、附件、搜索、URL routing、model/provider/preset 选择。
- 不复制 DSH Session transcript、composer machine、attachment 或 command system。
- 不用动画或装饰掩盖层级问题。

## 6. 测试

### Component / composition

- public primitive usage 和 Team thin presenter 的 DOM 测试；
- Modal open/close/focus restore；
- Menu keyboard selection；
- tabs ARIA；
- loading/empty/error/pending/confirmation/stale/read-only states；
- same request retry 和 non-optimistic projection；
- repeated Team enter/leave/unload。

### Real browser

- 1440×960：sidebar Channels、Agents、create modal、Channel、Thread、Members modal；
- 390×844：56px rail、Channel、Thread、mention menu、modal；
- 无 horizontal overflow、遮挡、逐字换行或 viewport 外 controls；
- screenshot 同时包含新 UI、旧 Team baseline 和 shipped DSH reference；
- keyboard-only 走一遍创建、发送、打开 Thread、返回和退出 Team。

### Gates

现有 typecheck、46 tests、build、pack、SQLite/replay 和完整 browser journey 全部保持通过。视觉门槛独立验收，不能由功能测试替代。

## 7. 交付顺序

具体依赖关系和每票验收见 [`ticket-plan.md`](ticket-plan.md)；下一次开发从 [`issues/01-center-surface-foundation.md`](issues/01-center-surface-foundation.md) 开始。

1. UI foundation 与 sidebar/creation；
2. Channel header/timeline/composer；
3. Thread header/claims/activity/composer；
4. Members/modal、responsive、a11y 和最终 browser comparison。

每一步都应是可运行的纵向切片；不做一次性 CSS 大爆炸。
