# 重复 handoff 投递引信（01 落地后才会触发）

测量者：Iris（2026-09-11，真实 persistence API + 真实 artifact；原始证据在 task:6ed30f62 Thread 消息 `5bf8229d`）。本文是 02 那一条验收项的机制记录。

## 现象

01 的迁移落地后，下一次启动时 **Tars 与 Cole** 会被 `agent.steer()` 重复投递一次 handoff：不是历史浏览降级，而是活会话注入。

## 证据链（逐环实测）

| 环节 | Tars | Cole |
| --- | --- | --- |
| 当前世代（v3，已抢救） | `64b9e2a8…`：54 events | `57acf380…`：27 events |
| 内含 source | 2× legacy `agent-team-context-handoff`（inbox/spliced @seq3 + user/message @seq7-8），**0 个 modern source** | 同形状 |
| fold 出的 handoff boundary | **0**（新 reader 按命名 section 读，不认旧 kind） | **0** |
| header.parentSession | `75e8a36f…` | `26fb5dac…` |
| 父代今天的状态 | REFUSED（真实 API `SessionFormatUnsupportedError`） | 同 |
| 父代 admit 后 fold | pending=NON-NULL，handoff 2012 chars @resultSeq 69474 | pending=NON-NULL，handoff 2564 chars @resultSeq 73224 |

## 机制

`index.ts`：`if (!state.boundaries.some(b => b.source === 'handoff'))` → 边界为 0 时击穿 → `reconstructMissingHandoff` 读 parentSession → 今天 parent REFUSED（warn 后返回，无害）；01 迁移后 parent 可读 → fold `pending !== null` → `agent.steer(handoff)` → **同一份 handoff 第二遍注入当前世代**。

讽刺点：该函数注释明言「Idempotent: once any handoff exists in the new Session's own log this never runs」，而实现这个幂等的就是那行 boundary 检查——它恰好看不见 legacy 形状的 handoff。

## 为什么本机只有这两个

本机 7 个已抢救当前会话里，其余 5 个（Reeve/Ferry/Momo/Tome/Aster）的当前世代含 modern source → 有 boundary → 守卫不触发。**只有 Tars/Cole 是「纯 legacy 形状、零 boundary」**。其它用户机器上没有「可读但惰性」的当前世代（全被拒 → 迁移成准入形状 → boundary 自然出现），但代码守卫对任何形态都是正确防线。

## 修法（02 采纳）

把幂等判定从「boundary 存在」扩展为「boundary 存在**或** own events 含 legacy handoff source」——用 `session-remediation.ts` 已有的 `containsLegacySource`，按 kind `agent-team-context-handoff` 判（continuation 不算，它不触发 handoff 重建）。这与函数注释的意图对齐：新 Session 的 log 里只要有过 handoff，就不重建。

**未采纳的更大改法**：让 fold 层把 legacy handoff kind 识别为 handoff boundary（对后续 session search 也有益）。改动面覆盖投影层边界语义，与 session search 的改动区重叠，留给下一阶段重设计（见 README 的 phase-2 主题池）。
