# 02 — Sidebar navigation and Team rail

**What to build:** Workspace、Channel、Agent 从 card/form 视觉变为紧凑 navigation rows。Tabs 具备完整 ARIA，selected/focus/hover 层级清楚，Agent runtime state 继续使用 StateDot + accessible text。窄屏继续复用 Harness 56px rail。

**Blocked by:** 01 — Center surface foundation

**Status:** ready-for-agent

- [ ] Workspace、Channel、Agent rows 使用 compact navigation density，不使用独立 card border。
- [ ] selected、hover、focus-visible 状态清楚；Workspace/Channel selection 行为不变。
- [ ] Tabs 使用 `tablist`、`tab`、`aria-selected`、`aria-controls` 和 `tabpanel`。
- [ ] available/working/error/unavailable 仍由 StateDot + accessible text 表达，diagnostic 不撑开 row。
- [ ] 1440×960 sidebar 与 390×844 56px rail 均可读、无文字溢出；icon-only controls 有 label 和 Tooltip。
- [ ] loading、empty、Remote error 和 Team enter/leave/persistence 行为保持正确。
- [ ] 现有 functional tests、typecheck、build 和 browser journey 继续通过。
