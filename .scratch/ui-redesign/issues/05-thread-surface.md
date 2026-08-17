# 05 — Thread, Claims and Activity surface

**What to build:** Thread 成为明确的 Task work surface：Task header、合法 Human actions、Claim rows、Presence、Message/Activity timeline、reply composer 和 accepted/closed read-only state。Activity 本地化，Claim state 与 runtime presence 分离。

**Blocked by:** 04 — Channel surface

**Status:** complete (`UI-05` implementation commit follows this ticket update)

- [x] Thread header 一眼表达返回路径、Task number、localized status 和下一合法 Human action。
- [x] Claim rows 分开 owner、direction、Claim state；runtime presence 继续单独用 StateDot 表达。
- [x] Message 与 Activity 按 sequence 合并但使用不同 renderer；Activity 使用用户文案，不包含 raw enum、opaque actor ref 或 debug string。
- [x] `accept`、`close`、`reopen`、Claim done/release 的现有 Host authority 和 payload 不变。
- [x] stale revision 刷新 projection、显示可理解 alert、保留 draft/recipients，并遵循既有 requestId/baseRevision 规则。
- [x] accepted/closed Thread 显示 read-only 原因和 reopen guidance；confirmation 仍是显式二次提交。
- [x] 1440×960 和 390×844 截图覆盖 active、accepted、closed、mention Menu；stale/load older 由现有 controller tests 覆盖。
- [x] 现有 48 项 functional tests、typecheck、build 和 browser journey 继续通过。
