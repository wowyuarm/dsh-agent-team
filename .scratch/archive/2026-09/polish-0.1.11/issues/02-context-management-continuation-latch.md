# 02 — Checkpoint continuation latch 判定收成一处

**What to build:** 「一个 checkpoint 的续接是否已经被认领」的判定（含 latch key 计算与 `scheduledContinuations` 占位）只有一个定义点，调度路径与崩溃修复路径不会各自漂移。
**Blocked by:** None — can start immediately
**Status:** complete（0.1.11 A 桶，2026-09-12 实施）

**删/并什么：** `packages/agent-team/src/context-management.ts` 中 `scheduleCheckpointContinuations`（约 290–296）与 `repairContinuations`（约 407–413）各重复一遍同一段 7 行判定：`turnEndSeq === -1` 跳过、`continuationDelivered(...)` 跳过、拼 `${memberId}:${checkpointRef}` latch、查/写 `scheduledContinuations`。收成一个返回「是否抢到 latch」的 helper。

**证据（2026-09-12）：** jscpd 报了这对 clone（7 行/66 tokens）。两处当前逐行一致；差别只在抓到 latch 之后做什么（排队 followup vs 立刻 followup），这正是可以被参数化的部分。

**删除标准：** 私有 helper，无对外契约。两条路径分别由
`packages/agent-team/tests/member-lifecycle.spec.ts` 的 rollover 段与 pressure policy 段覆盖，
且 `repairContinuations` 的存在意义（崩溃后的重复投递抑制）本身有断言。

**预期净减：** ≈ −6 行

**风险 / 需要契约判断的点：** 低。注意保持 `scheduledContinuations.delete(latch)` 的失败回滚语义（调度路径在 catch 里删除、修复路径在 catch 里删除）——helper 只负责抢 latch，回滚仍留在各自调用点的 catch 中，不要把这部分也吞进 helper。

**验证：** `npm test`（重点 `member-lifecycle.spec.ts`）+ `npm run typecheck`

- [ ] 两处判定共用同一 helper，latch key 只有一个生成点
- [ ] 失败回滚行为不变（两侧 catch 仍各自释放 latch）
