# Agent Team UI Redesign Ticket Plan

日期：2026-08-17
状态：archived；2026-08-17 已完成。以下内容记录当时的 Client presentation 实施计划。
设计权威：`design/team-ui-redesign.md`
范围合同：`spec.md`
证据：`research/`

## 不可变约束

- 不修改 Host、ledger、Remote schema、authority、operation interpretation、`TeamNavigation` persistence 或 slot takeover lifecycle。
- 不新增 Remote，不解释 Operation，不做 durable optimistic state。
- 保持 `mode + workspaceId` 持久化；Channel、Thread、tab、draft 和 form state 保持 transient。
- 保持 requestId reuse、stale revision refresh、draft preservation、non-optimistic mutation、enter/leave/reload/unload restore。
- 只使用 Harness public package exports；不导入 `./src/*`、`WorkspaceBrowser`、`SidebarRoot`、`InputBar`、`MessageItem` 等 private implementation。
- 只用 `@deepseek-ai/dsh-client-ui-primitives` 解决通用 chrome；不建立 Team UI framework、generic form system 或新 component library。
- 每票只迁移自己的 CSS selectors；保留现有 functional tests 和 browser runner 绿色。

## 依赖图

```text
UI-01 Center surface foundation
  -> UI-02 Sidebar navigation / rail
  -> UI-03 Agent / Channel creation modals
  -> UI-04 Channel surface
  -> UI-05 Thread / Claims / Activity
  -> UI-06 Members / responsive / a11y / final acceptance
```

## Tickets

### UI-01 — Center surface foundation

**Blocked by:** None

**交付：** Channel 和 Thread 共享稳定的 DSH-style center geometry。页面使用 `auto minmax(0, 1fr) auto`，header、timeline、composer 形成连续工作流；empty/loading 不再把内容推到页面底部。普通命令迁移到 public `Button`，multiline composer 保留 Team-local textarea。

**独立验收：** 1440×960 的 Channel/Thread populated、empty、loading；390×844 Thread；timeline 独立滚动、composer 稳定停靠、无横向 overflow；所有 Remote payload 与现有行为测试不变。

### UI-02 — Sidebar navigation and Team rail

**Blocked by:** UI-01

**交付：** Workspace、Channel、Agent 从 card/form 视觉变为紧凑 navigation rows。Tabs 具备完整 ARIA，selected/focus/hover 层级清楚，Agent runtime state 继续使用 StateDot + accessible text。窄屏继续复用 Harness 56px rail，不新增第二套 Shell。

**独立验收：** Workspace/Channels/Agents populated、empty、loading/error、available/working/error/unavailable；1440×960 sidebar 与 390×844 rail；Workspace、tab、Channel selection 和 Team enter/leave/persistence 不变。

### UI-03 — Agent and Channel creation modals

**Blocked by:** UI-02

**交付：** Agent 和 Channel 创建从 sidebar inline form 迁移到 public `Modal`。使用 `Input`、`Button`、必要的 semantic native checkbox；失败保留输入和 member selection，pending 只锁当前 modal，retry 保持既有 requestId/payload。

**独立验收：** Agent create、Channel create、failure、retry、unavailable member、pending；1440×960 和 390×844 named dialog；Escape/mask close、focus restore、body scroll、no optimistic row。

### UI-04 — Channel surface

**Blocked by:** UI-03

**交付：** Channel header、timeline、Task footer、mention Menu 和 Channel-scoped member Modal。Message、Task footer、member summary 的层级明确；mention 使用 public `Menu` + structured Member refs，不再常驻 checkbox fieldset；membership mutation 仍由现有 controller 调用。

**独立验收：** populated/empty/loading Channel、send success/error、draft/recipient preservation、mention Menu、member join/remove pending/error、Channel→Thread；1440×960 和 390×844；Activity/raw enum 不进入 Channel timeline。

### UI-05 — Thread surface

**Blocked by:** UI-04

**交付：** Thread 成为明确的 Task work surface：Task header、合法 Human actions、Claim rows、Presence、Message/Activity timeline、reply composer 和 accepted/closed read-only state。Activity 本地化，不能显示 enum/ref；Claim state 与 runtime presence 分离。只有 Channel/Thread 两个真实调用方出现后才抽薄 `TeamMentionMenu`。

**独立验收：** active/accepted/closed Thread、Claim done/release、Activity/Message 分层、load older、stale revision、confirmation、draft preservation、reopen guidance；桌面/窄屏截图；现有 baseRevision、requestId、polling、pagination 和 Host action 不变。

### UI-06 — Global Members, responsive, accessibility and final acceptance

**Blocked by:** UI-05

**交付：** Global Members 使用 public `Modal`；完成跨 surface narrow reflow、keyboard/focus/live-region/a11y；更新真实 browser runner 与视觉对照截图。全局 Members 只读、按 Workspace 分组，不增加 DM/search/management authority。

**独立验收：** Members named dialog 的 open/close/focus/escape/mask/error/loading；1440×960 与 390×844 Channel/Thread/rail/modal；keyboard-only enter→Members→Channel→Thread→back→leave；重复 enter/leave、reload、unload 恢复 shipped occupants；46 functional tests、typecheck、build、pack、browser 全绿。

## 实施顺序说明

每票都必须先保持已有行为测试绿色，再改变 presentation。不要先做全局 CSS 重写，也不要为了复用 private Harness component 而修改 Harness core。若某个复合 UI 在两票中都需要，先用两个具体 caller 验证，再抽最小 Team-owned presenter。
