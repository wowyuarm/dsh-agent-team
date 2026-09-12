# 13 — ledger apply() 的「离场快照落账」块收成一处

**What to build:** 重放时把一条离场 operation 的 claims/activities/tasks/threads/inbox 写进投影，只有一份实现、一个固定顺序。
**Blocked by:** 11
**Status:** complete（2026-09-12 本轮实施）

**删/并什么：** `packages/agent-team/src/ledger.ts` 的 `apply()` 里，四个离场分支各重复同一段落账：
`channel-member-removed`（约 2388–2396）、`channel-archived`（2397–2408）、`member-removed`（2409–2418）、
`member-archived`（2419–2430），外加 `claim-*`（2449–2456）与 `task-changed`（2457–2464）两个近似变体。
抽成 `applyReleaseSnapshot(target, data, occurredAt)`，处理 claims → activities → tasks → threads → inbox 这一串。

**证据（2026-09-12）：** 该文件内 `target.claims.set(claim.claimRef, claim)` 出现 5 次、
`this.appendActivityFact(target, activity, operation.occurredAt)` 4 次、`target.tasks.set(...)` 4 次、
`target.threads.set(...)` 4 次、`this.applyInboxDelta(target, operation.data.inbox)` 9 次；
jscpd 把这些分支两两报了 5 处 clone（7–9 行）。

**删除标准：** 私有方法；顺序与内容是 replay 语义，必须逐项等价。
覆盖在 `packages/agent-team/tests/agent-team.spec.ts` 的冷重放用例（把 ledger 从存储重新打开后断言投影）
与 `member-lifecycle.spec.ts` 的 archive/remove 用例。

**预期净减：** ≈ −20 行

**风险 / 需要契约判断的点：** 中。两个必须守住的点：
1. **块内顺序即语义**（先 claims 再 activities 再 tasks/threads 最后 inbox delta）。抽取时不能重排、不能合并循环。
2. 各分支在落账前后还有自己的独有动作（如 `target.members.set`、`membership.delete`、`channels.set`、
   `channelRefByThread.set`）。helper 只覆盖共同的那一串，独有动作留在分支里。

**验证：** `npm test`（`agent-team.spec.ts` 冷重放、`member-lifecycle.spec.ts`）+ `npm run typecheck`

- [x] 四个离场分支共用同一落账 helper（`applyReleaseSnapshot`），块内顺序不变
- [x] 各分支独有动作（成员/成员关系/channel 写入）仍在原处
- [x] 冷重放投影与改动前一致（`npm test` 536 passed / 1 skipped）

**实施记录（2026-09-12）：** 顺序逐项保留 claims → activities → tasks → threads → inbox，未重排、未合并循环。
`claim-*` 与 `task-changed` 两个近似变体**故意未折入**：它们是单数字段（`data.claim` / 标量）而非数组形状，
折入需要另一套分支，属于「形状相似、概念不同」。这两个残余 clone 在改动前就存在（token 数逐字节相同），本轮未增减。
