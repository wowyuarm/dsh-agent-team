# 03 — 私有内存路径块收成一处

**What to build:** 注入给 Member 的私有内存说明块（memory 目录/memory.md/notes/skills 四个路径 + cwd 说明）只有一个定义点，正常渲染与「内存不可读」降级渲染不会说出两套路径口径。
**Blocked by:** None — can start immediately
**Status:** complete（0.1.11 A 桶，2026-09-12 实施；净减估计写错，实际 +6 行）

**删/并什么：** `packages/agent-team/src/member-context.ts` 的 `renderMemberMemory`（第 72 行）与 `renderUnavailableMemory`（第 76 行）各自内联同一段路径清单与外层说明文字。抽成 `memoryPathsBlock(privateMemoryPath)`，两处调用。

**证据（2026-09-12）：** 两行模板串都包含完全相同的四行路径清单（`Private memory directory:` / `Memory index:` / `Notes directory:` / `Private skills directory:`）与
"These paths are outside the Workspace cwd..." 一句，仅末句措辞与是否有 memory 正文不同。
jscpd 没报，因为整段写在一个长模板串里、低于 6 行阈值——**这是阈值漏网，不是真没重复**。

**删除标准：** 私有渲染 helper；改动必须让注入文本**逐字节不变**，由
`packages/agent-team/tests/member-context.spec.ts` 与 `member-context-integration.spec.ts` 兜底。
注意：这段文本正是每个 Member 实际看到的内存说明（本审计报告的读者就在读它），任何口径分叉都会直接污染成员行为，
所以「两处必须一致」本身就是契约。

**预期净减：** ≈ −5 行（另加一次真正的收益：路径清单只剩一处）

**风险 / 需要契约判断的点：** 低，但不可偷懒：不要顺手改写文案。只允许把公共部分提取出来拼接，
两段各自的差异句必须保留原样（已由测试断言）。

**验证：** `npm test`（重点 `member-context.spec.ts`、`member-context-integration.spec.ts`）

- [ ] 两处渲染共用同一路径块，路径清单只剩一处
- [ ] 生成的注入文本与改动前逐字节相同
