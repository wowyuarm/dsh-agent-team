# 08 — `team_view` structured `tasks[]` 的 `revision ?? 0` 哨兵

**What to build:** 结构化输出不再为缺失的 revision 伪造 `0`：要么让该字段可选并省略，要么把它从 tasks[] 里去掉。
**Blocked by:** None — can start immediately
**Status:** complete（2026-09-12 本轮实施）

**删/并什么：** `packages/tool-agent-team/src/index.ts` 约第 673–674 行的 tasks[] 映射：
`revision: view.threads.find(thread => thread.threadRef === task.threadRef)?.revision ?? 0`；
配套地，它的输出 schema（约第 264 行）把 `revision` 声明为 `required: true`，正是这个 required 逼出了哨兵。

**证据（2026-09-12）：**
- 全仓库没有任何消费者读取 `team_view` 的 `tasks[].revision`（src + tests 只有空数组渲染夹具；
  生命周期断言打的是 Host `view()` 层，不是工具输出）。
- 该分支实际不可达：Host 的 `viewForAgent` 返回未分页的完整 `tasks`/`threads` map，
  `find` 必然命中；今天它是「为了满足 required schema 而编造的值」，而不是真实语义。
- 这是上一轮 render-IA 终审时我 filed 的同类问题（required 字段逼出 fabricated sentinel），
  与 `render-IA` 记录里的方向一致。

**删除标准：** 工具输出的 structured schema 是模型可见契约，所以这条归 B 桶：需要人决定
「让字段可选并省略」还是「直接删掉 tasks[].revision」。若选前者，写法沿用本文件已有的
条件展开风格（`...(x === undefined ? {} : { x })`），与 `taskNumber` 一致。

**预期净减：** ≈ −1 行（收益是去掉一个假值，不是行数）

**风险 / 需要契约判断的点：** 模型可见契约变更。风险点是：模型若已习惯该字段存在，
删除会比变可选更激进——建议采纳「变可选 + 省略」而不是删除字段名。
另外请确认没有 Tool 描述文本承诺 tasks[] 一定带 revision。

**验证：** `npm test`（`packages/tool-agent-team/tests/*-render.spec.ts`）+ `npm run typecheck`

- [x] tasks[] 不再出现 `?? 0` 之类的伪造值——采纳「变可选 + 省略」：schema 改 `{ type: 'number' }`（不再是 required），mapper 用条件展开省略
- [x] schema 与实现一致（可选即真的可省略），既有渲染测试全绿——`npm test` 536 passed / 1 skipped、`npm run typecheck` 0

**实施记录（2026-09-12）：** 动手前复核了「无消费者」与「分支不可达」两条证据，均仍成立（`ledger.view` 的 `threads` 是未分页全集，只有 `items` 分页），
所以这条是「schema 不再说谎」而非行为修复。**顺带发现、故意未动、已上报**：同文件 `ledger.view` 的 `taskNumbers.get(task.taskRef) ?? 0`
使 `...(item.taskNumber === undefined ? {} : ...)` 永不触发，缺失时会渲染成 `(#0)`——同类假值，但属另一条契约，不在本条范围。
