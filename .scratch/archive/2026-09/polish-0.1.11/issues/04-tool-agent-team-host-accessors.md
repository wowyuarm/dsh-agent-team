# 04 — Team tool 的 Host 取用器收成一处

**What to build:** `service(agent)` / `member(agent)` 这对取用器只有一个定义点；`team_message` 系工具与 `context_*` 系工具拿到的 Host 是同一套校验与同一套报错文案。
**Blocked by:** None — can start immediately
**Status:** complete（0.1.11 A 桶，2026-09-12 实施）

**删/并什么：** `packages/tool-agent-team/src/context-tools.ts`（约 16–26）与 `packages/tool-agent-team/src/index.ts`（约 147–157）各自定义了一份逐字相同的 `service` 与 `member`。抽到一个小组件模块（如 `host-access.ts`），两处 import。

**证据（2026-09-12）：** jscpd 报了这对 clone（11 行/99 tokens），两份实现逐字相同，包括两条 throw 文案
（`Agent Team Host is unavailable`、`team tool requires an active Team Member`）——而这两条是模型可见的错误文本。

**删除标准：** 纯模块内去重，不改任何模型可见输出。这 11 行的行为由两个包的既有工具测试覆盖：
`packages/tool-agent-team/tests/*-render.spec.ts`（含工具在无 Host / 非 Member 场景下的拒绝渲染）。

**预期净减：** ≈ 0 行（删掉 11 行重复，新增约 12 行的单一模块）——**收益是单一定义，不是行数**，
请按「消除双份定义 + 两条模型可见文案不会再单独漂移」来评估，不要按 jscpd 数字评估。

**风险 / 需要契约判断的点：**
- **循环 import 是硬约束：** `index.ts` 已经 import `context-tools.ts`，所以 `context-tools.ts` 不能反向 import `index.ts` 来复用。必须新建第三个模块，两个使用方都从它 import。
- 两条 throw 文案保持不变。

**验证：** `npm run typecheck` + `npm test`（`packages/tool-agent-team/tests/`）

- [ ] `service` / `member` 只有一处定义，`index.ts` 与 `context-tools.ts` 都从共享模块取
- [ ] 无 Host / 非 Member 的拒绝文案与改动前逐字相同
