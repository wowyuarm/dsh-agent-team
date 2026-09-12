# 07 — preset 里那句缺谓语的规则补完整（含测试断言同步）

**What to build:** 模型读到的 preset 规则是通顺英文；`shipping.spec.ts` 的断言与它同一次改动内保持一致。
**Blocked by:** None — can start immediately
**Status:** complete（0.1.11 A 桶，2026-09-12 实施；预算常量 8872 → 8889 同变更上调）

**删/并什么：** 不是删除，是修一句话。`packages/agent-team/preset/team-member/agent.cordis.yml` 第 11 行现在写的是
`a successful public mutation's returned token may basis the next deliberate mutation`——`may basis` 缺谓语。

**证据（2026-09-12）：** 原文见 preset 第 11 行；`packages/agent-team/tests/shipping.spec.ts` 第 110 行
逐字断言了同一个残缺片段（第 108 行的注释也抄了一遍）。所以这句话有两处副本，改一处不改另一处会直接红。

**删除标准：** 纯文案。建议改为 `a successful public mutation's returned token may serve as the basis for the next deliberate mutation`；
三处（preset 正文、断言、注释）同改。这是模型可见的协作规则文本，改完要人眼读一遍，不要只跑测试。

**预期净减：** 0 行

**风险 / 需要契约判断的点：** 低。唯一判断是措辞——它描述的是「成功 mutation 返回的 token 可以作为下一次 mutation 的依据」，
不要在改写中增加或削弱规则本身（这轮只修语法，不改语义）。若顺势想改语义，另开条目。

**验证：** `npm test`（`packages/agent-team/tests/shipping.spec.ts`）+ 人眼读 preset 第 11 行

- [ ] preset 句子语法完整、语义与原文一致
- [ ] `shipping.spec.ts` 的断言与注释同步更新，测试全绿
