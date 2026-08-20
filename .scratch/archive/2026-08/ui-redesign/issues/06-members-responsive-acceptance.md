# 06 — Global Members, responsive and accessibility acceptance

**What to build:** Global Members 使用 public Modal；完成跨 surface narrow reflow、keyboard/focus/live-region/a11y，并用真实 browser 对照截图验收。全局 Members 只读、按 Workspace 分组，不增加 DM/search/management authority。

**Blocked by:** 05 — Thread, Claims and Activity surface

**Status:** complete (`UI-06` implementation commit follows this ticket update)

- [x] Global Members 只在 Team mode 出现，使用 named public Modal，支持 Escape/mask close、focus restore、narrow body scroll。
- [x] Global member list 按 Workspace 分组，loading/empty/transport error 有稳定状态，不伪造 projection。
- [x] 390×844 下 Channel、Thread、mention Menu、Members Modal 和 56px rail 无 overflow、遮挡、逐字换行或不可达 controls。
- [x] keyboard-only 可完成 enter Team → Members → Channel → Thread → back → leave；focus、tab、menu、dialog、alert 语义完整。
- [x] 重复 enter/leave、persisted Team mode、refresh、plugin unload 恢复 shipped WorkspaceBrowser、Conversation、Settings 和 footer registrations。
- [x] 更新 `npm run test:browser` 截图和 DOM assertions；保留旧 M2 baseline 作为对照。
- [x] 全量 48 functional tests、typecheck、build、pack、browser journey 通过。
