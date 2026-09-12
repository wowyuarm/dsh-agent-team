# 01 — Pending rollover intent 字面量收成一处

**What to build:** Member 从 `pending` 恢复 intent 时，字段清单只有一个定义点；以后给 intent 加字段不会漏改其余两处。
**Blocked by:** None — can start immediately
**Status:** complete（0.1.11 A 桶，2026-09-12 实施）

**删/并什么：** `packages/agent-team/src/context-management.ts` 里同一段 `intent: { toolCallId, resultSeq, turn, handoff, ...checkpointRef?, relatedFiles }` 字面量出现 3 次（约 229–240、363–374、381–391），收成一个模块内私有 helper（如 `intentFromPending(pending)`）。

**证据（2026-09-12）：** jscpd 在这个文件报了 3 处 clone，其中两处正是这段字面量（12 行/72 tokens、11 行/60 tokens）；第三处出现在 `MemberTransition` 里，同一个字段表。三处当前逐字段一致，但没有任何机制保证一致。

**删除标准：** 纯模块内私有重构，不触碰持久化格式与对外类型。行为由既有测试覆盖：
`packages/agent-team/tests/member-lifecycle.spec.ts` 的 rollover/checkpoint 段（约 1663 起）与
`packages/agent-team/tests/context-projection.spec.ts` 直接断言恢复后的 intent 形状。

**预期净减：** ≈ −12 行

**风险 / 需要契约判断的点：** 低。唯一判断是 helper 放在本模块还是 `member-runtime.ts`——建议留在本模块，避免为 6 个字段新增跨模块依赖。

**验证：** `npm test`（重点 `member-lifecycle.spec.ts`、`context-projection.spec.ts`）+ `npm run typecheck`

- [ ] 三个使用点都走同一个 helper，字段表只剩一处
- [ ] 恢复语义不变：既有 rollover/checkpoint 测试全绿
