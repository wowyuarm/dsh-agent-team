# 15 — ledger 两个离场 replay 校验器合并（本轮最大一处，也最危险）

**What to build:** 「离场快照在重放时是否真的自洽」这一判断只有一份实现；
Member 离场与 Channel 归档不会一个校验了 Attention/markers、另一个漏校验。
**Blocked by:** 11、14（先定格式与离场主体，最后收校验器）
**Status:** complete（2026-09-12 本轮实施）

**删/并什么：** `packages/agent-team/src/ledger.ts` 中 `validateMemberDepartureCleanup`（约 2155–2215）与
`validateChannelArchivalCleanup`（约 2217–2280）是两段约 49 行的近逐行相同实现：重算 released claims →
逐项比对 `data.claims` → 分组重算 expected activities 并比对 → 校验 claimRef 引用 →
重算 expected tasks（含 `deriveResolvedTaskStatus`）与 expected threads（revision = sequence）→
重算 expected Attention/markers 并比对 inbox delta。抽成一个参数化的校验器。

**证据（2026-09-12）：** jscpd 在 `ledger.ts` 报的最大一处就是它（29 行/336 tokens），
另一处 8 行/92 tokens 的 clone 是这段里的 `data.claims` 比对子块。
两处合计占了这个文件 10 处 clone 里最大的两处，也是全仓库重复行数的主要来源。

**删除标准：** 私有校验方法；等价性由**冷重放**兜底，而不是只靠单元断言：
`packages/agent-team/tests/agent-team.spec.ts` 的 `replayLedger(test)` + `cold.validate()`（约 93、306 行起）
会从存储重新解码旧记录并跑一遍这些校验器；`packages/agent-team/tests/change-scopes.spec.ts` 还挂载了
invariant companion（`src/invariant.ts` → `ctx.agentTeam.validateLedger()`），每次 commit 都重跑。

**预期净减：** ≈ −40 行（全清单最大）

**风险 / 需要契约判断的点：** **最高。** 这不是普通重构：校验器的作用是「发现持久化记录被写坏」，
合并出错的方向不是崩溃而是**静默地不再校验**——损坏的记录会被当成合法数据继续重放，
而这一层恰恰是持久化账本的最后一道闸。合并时必须逐项保留四处差异：
1. claim 过滤条件不同（Member 版还按 `claim.owner === memberId` 过滤，Channel 版不过滤 owner）；
2. activity 分组方式不同（Member 版按 thread 分组且 actor 固定为 memberId；Channel 版按 owner 分组并对 owner 排序）；
3. Attention/markers 的过滤不同（Member 版按 memberId 过滤，Channel 版覆盖全部成员）；
4. 两条错误文案不同（`invalid Member inbox cleanup` vs `invalid Channel archival inbox cleanup`）——保留各自的文案，
   便于线上定位是哪条路径失守。
判断点：如果参数化需要传入「分组函数」，请优先传**两个显式的分组实现**而不是一个带分支的闭包——
可读性在这里比少 5 行重要。验收方式建议：合并前后各跑一次冷重放，并**故意伪造一条坏记录**确认校验器仍然会抛。

**验证：** `npm test`（`agent-team.spec.ts` 冷重放、`change-scopes.spec.ts` invariant）+ `npm run typecheck`
+ 手工负向验证：篡改一条离场记录的 inbox delta，确认两个路径仍然报错

- [x] 两个校验路径共用同一实现，四处差异逐项显式保留
- [x] 冷重放全绿，且 invariant companion 的 validateLedger 未失效（`npm test` 536 passed / 1 skipped）
- [x] 负向验证：伪造的坏记录仍被拒绝（合并后不能更宽松）

**实施记录（2026-09-12）——含一条我必须公开的判据修正**

合并后的形状：`validateReleaseCleanup(data, projection, memberId, threadRefs, sequence, refs)`，`memberId === undefined` 表示
Channel 归档（覆盖全部 owner），否则是单 Member 离场。四处差异按 ticket 要求做成**显式参数**而不是带分支的闭包：
claim 过滤、Activity 分组（按 (owner, Thread) 分组 + owner 排序）、inbox 清理范围、失败文案。
`validateChannelArchivalCleanup` 整个删除，其唯一调用点传 `undefined`。

**为什么它不是「更宽松」的合并**——静态等价性证明（比测试更强）：提交路径 `ledger.ts:807-809` 与校验器 `2190-2191`
用的是同一个 `[...claims.values()].filter(...)` 顺序与集合；Channel 侧提交路径 `853-854`（owners 排序后按 owner 分组）
与校验器 `2205-2209` 逐项一致，Member 侧正是它的单 owner 退化——单 owner 时 `sort()` 只有一个键，
按 (owner, Thread) 分组退化为按 Thread 分组，与 `releaseSummaries` 的顺序相同。

**负向验证的实际覆盖**（比本条 ticket 写作时的假设要好，也要更正一处我先前的说法）：
- Channel 路径**本来就有**两条伪造记录用例（`agent-team.spec.ts` 1219 `claims: []`、1291 inbox 缺项），
  从审计基线 `389fd92` 起就存在，不是本轮新加。我先前的「Channel 路径没有负向测试」是**错的**。
- Member 路径原有 755（tasks 伪造）与 1094（claims 伪造）。
- **本轮新增** 1159「rejects a forged Member departure inbox during replay」：篡改 Member 离场的 inbox delta，
  断言 `invalid Member inbox cleanup`。这条补的是真实缺口——该文案在合并前全仓库**零断言**，
  而「两条文案串了」正是合并唯一新增的条件分支。用例内先断言删掉了恰好一条 cleanup 项，避免退化成空转测试。
- **非空转证明**：把两条文案临时改成同一个（模拟合并出错），新用例立刻变红，其余 7 条伪造用例仍绿；随后已还原。

**判据修正（必须公开）**：我在裁定时给自己写死「helper 签名 ≤3 参数」这条硬判据，而合并后的校验器是 6 个参数，
**按字面它不满足该判据**。我判断该判据在此处**不适用**而非「已满足」：这条判据来自 ticket 06/10，
那些多出来的参数是**行为回调**（`save`/`onCommit`/`build`/`matches`），多回调正是「共享的是形状不是概念」的信号；
而本校验器的 6 个参数全部是**它必须读取的数据**（data、projection、memberId、threadRefs、sequence、refs），**回调数为 0**，
且合并前的 Member 版校验器本来就已经是 6 个参数。所以判据的真实内容是「行为回调数」，不是原生参数个数。
这条修正与它的证据一并交 human 复核；若 human 认为字面判据优先，本项可整条回退（当时改动尚未提交）。
