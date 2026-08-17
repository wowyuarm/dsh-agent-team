# 04 — Channel surface

**What to build:** Channel header、timeline、Task footer、mention Menu 和 Channel-scoped member Modal。Message、Task footer、member summary 层级明确；mention 使用 public Menu + structured Member refs，不再常驻 checkbox fieldset。

**Blocked by:** 03 — Agent and Channel creation modals

**Status:** ready-for-agent

- [ ] Channel 首屏形成 header → timeline → composer 结构；populated、empty、loading 都稳定。
- [ ] Message 显示 sender/kind/body；Task footer 显示 Task number、派生状态、Thread count，不重复正文。
- [ ] header membership 管理进入 Channel-scoped Modal；join/remove pending 和失败状态保持 non-optimistic。
- [ ] mention Menu 只显示当前 Channel 合法成员；selected recipients 使用 compact tokens，提交仍是 Member refs。
- [ ] send success/error、draft preservation、same requestId retry 行为保持不变。
- [ ] 不渲染 Activity、raw operation enum 或 opaque ref 到 Channel timeline。
- [ ] 1440×960 和 390×844 截图覆盖 populated、empty、send error、mention Menu、member Modal。
- [ ] 现有 functional tests、typecheck、build 和 browser journey 继续通过。
