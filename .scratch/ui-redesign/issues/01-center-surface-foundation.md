# 01 — Center surface foundation

**What to build:** Channel 和 Thread 共享稳定的 DSH-style center geometry。header、timeline、composer 形成连续工作流；empty/loading 不再把内容推到页面底部。普通命令使用 public `Button`，multiline composer 保留 Team-local textarea。

**Blocked by:** None — can start immediately.

**Status:** complete (`UI-01` implementation commit follows this ticket update)

- [x] Channel 和 Thread 使用 `auto minmax(0, 1fr) auto` 的 center layout，timeline 独立滚动，composer 稳定停靠。
- [x] 1440×960 的 populated、empty、loading Channel/Thread 都有稳定内容轴；不出现大面积无意义空白。
- [x] 390×844 Thread header、timeline、composer 可读且无横向 overflow。
- [x] 普通 header/back/send 控件使用 public DSH `Button` 和 icons；不导入 Harness private Conversation component。
- [x] 所有 Remote payload、requestId、refresh、draft 和 stale 行为保持不变。
- [x] 现有 46 项 functional tests、typecheck、build 和 browser journey 继续通过。
- [x] 新增 `.scratch/ui-redesign/validation/ui-01/` 截图，保留旧 M2 baseline 截图不覆盖。
