# 01 — Cut Over to Durable Thread Attention

**What to build:** Replace the existing Follow/Delivery attention behavior with one durable, Host-owned Thread Attention and Inbox model. Human and Agent Members can have independent per-Thread follow periods, unread state and direct-mention state that survive restart and consistently govern what work is pending.

**Blocked by:** None — can start immediately.

**Status:** complete

- [x] A Member can begin Attention by creating a Task, following a Thread, claiming a Direction, or receiving a Human-confirmed invitation; an Attention period records only the updates that occur after it begins.
- [x] An invited Member receives the invitation and later updates as unread while pre-invitation history remains readable background rather than a mandatory backlog.
- [x] A Member can end Attention when it has no active Claim; ending Attention discards pending unread work, and a later follow begins at the current Thread tail.
- [x] Claims, Task resolution and relevant Messages create follower unread work; read/follow/delivery mechanics and runtime presence do not.
- [x] Human-confirmed Agent invitations, direct Human mentions, close/reopen, suspend, removal and Channel membership changes produce legal Attention and Inbox projections.
- [x] Existing Thread mutations reject relevant unread work first and then reject stale revisions; starting a new Task and changing personal Attention remain possible.
- [x] Ledger replay, request-id retries, concurrent read/write races and restart recovery expose the same authorized Attention, unread and revision facts.
- [x] The old Follow/Delivery attention operations, projections, names and fallback paths are removed rather than retained alongside the new model.
- [x] `docs/architecture.md` 与 `docs/harness-navigation.md` 在代码、replay 和恢复测试验证后更新 Host authority、Thread Attention 与所需 Harness 查阅路线；不提前描述未实现的工具或 UI。
- [x] Host package README（英文与中文）在代码验证后描述新的 durable Attention/Inbox 边界，并移除旧 Follow/Delivery 行为说明。
