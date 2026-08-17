# Agent Team UI Redesign Handoff

## 当前结论

M2 functional baseline 已完成，commit `9ae7cc3`。当前 UI 功能可用，但 native-feel 未达标：页面运行在 DSH Shell 中，却没有充分复用 DSH public primitives、密度、surface 结构和成熟协作 UI 语法。

下一轮只做 Client presentation redesign，不改 Host/domain/Remote/authority/ledger。

## 下一步唯一入口

1. 先读 [`../design/team-ui-redesign.md`](../design/team-ui-redesign.md)：设计权威。
2. 再读 [`spec.md`](spec.md)：范围合同、非目标、状态和测试门槛。
3. 再读 [`../design/research/team-ui-visual-audit.md`](../design/research/team-ui-visual-audit.md)：当前 UI 的问题排序。
4. 再读 [`../design/research/dsh-ui-reuse-inventory.md`](../design/research/dsh-ui-reuse-inventory.md)：可以复用的 public API 与禁止依赖的 private implementation。
5. 再读 [`../design/research/collaboration-ui-patterns.md`](../design/research/collaboration-ui-patterns.md)：采用/拒绝的成熟协作模式。
6. 按 [`ticket-plan.md`](ticket-plan.md) 和 [`issues/`](issues/) 从 `01` 开始做。

## Ticket frontier

- `01-center-surface-foundation.md`：complete；证据在 `validation/ui-01/`。
- `02-sidebar-navigation-rail.md`：complete；证据在 `validation/ui-02/`。
- `03-create-modals.md`：complete；证据在 `validation/ui-03/`。
- `04-channel-surface.md`：complete；证据在 `validation/ui-04/`。
- `05-thread-surface.md`：当前 frontier；04 已完成，可立即做。
- `06-members-responsive-acceptance.md`：blocked by 05。

## 不要做

- 不要因为 UI 重做修改 Host、ledger、Remote schema、authority 或 persistence。
- 不要 import Harness `./src/*`、`WorkspaceBrowser`、`SidebarRoot`、`InputBar`、`MessageItem` 等 private implementation。
- 不要一次性重写整个 `team.module.css`。
- 不要加入 Agent DM、Thread inbox、search、URL routing、attachments、slash commands、model/provider/preset controls。
- 不要把 functional tests green 当成视觉完成。

## 已知事实

- 可直接复用：`Button`、`Input`、`Modal`、`Menu`、`Tooltip`、`HoverCard`、`Pill`、`StateDot`、`Toast`、`MessageText`、public icons。
- 没有 public multiline composer、Message row 或 Team domain row；这些由 Team 做薄 presenter。
- composer 仍需保留 textarea，但要遵守 DSH focus、density、token、keyboard 语法。
- `StateDot` 没有 neutral/unavailable state；不要伪造其他 StateDot state。
- 外部 plugin 只使用公开 `ctx.workspaces.pickDirectory()` / `create()`，不声明 WorkspaceBrowser 私有 directory-flow child slot。
- M2 只持久化 `mode + workspaceId`；刷新后 Channel/Thread/tab 回到 transient 初始状态，这是正确行为。

## 开工前门禁

```bash
npm run typecheck
corepack pnpm exec vitest run --reporter=dot
npm run build
npm run test:browser
```

每张票完成后都跑现有 functional gate；最终再跑 `npm pack` 和真实 browser screenshot 对照。开发预览在本仓库执行：

```bash
npm run preview
```

不是在相邻 `deepseek-harness` 根目录执行。
