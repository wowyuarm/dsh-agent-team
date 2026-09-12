# 0.1.11 打磨：简化审计轮（已收尾）

## 状态

**本轮完成并已归档。** A 桶 01–07（Task task:6417ca31）与 B 桶被采纳的 5 条（08、11、12、13、15，Task task:7c2cb5ee）均已实施并通过门禁；
09、10、14 三条经阅读后裁定保留（理由移入 `KEEP-decisions.md` §9–§11，ticket 已删）；16 非代码，转交 Reeve / Ferry。
审计人与实施人：Cole。归档完成后，human 决定把本目录随本轮代码一并提交（覆盖先前的「scratch 先不要 commit」指示），因此本册及其 tickets 现在**是入库的**。

**最后核对日期：** 2026-09-12（行号、clone 数、测试数均为该日实跑结果）。
**核对基线：** 审计基线 `389fd92`（审计中途 master 被推进过，每条候选都在该 HEAD 上重新核对过）；
A 桶验证基线 `e619c9f`；B 桶改动全部在工作区，**当时尚未提交**。

## 实施结果

### 门禁（2026-09-12 实跑）

| 门 | 结果 |
|---|---|
| `npm test` | **536 passed / 1 skipped**（含 `check:docs`、`check:core-skills`、generate:typert） |
| `npm run typecheck` | 0 错（三个包） |
| `npm run lint` | 0 warnings / 0 errors（129 files） |
| `npm run duplication` | **11 clones / 118 行 (0.57%) / 1041 tokens** |
| `npm run test:browser` | 本轮**未跑**——B 桶未改任何 client 文件；A 桶改 client 时跑过（真实 Web 完整旅程 1 passed） |

### jscpd：26 → 11 clones（两轮合计）

| 时点 | clones | 重复行 | tokens |
|---|---|---|---|
| 审计基线 `389fd92` | 26 | 291 (1.41%) | 2597 |
| A 桶后 `e619c9f` | 20 | 222 (1.07%) | 2138 |
| **B 桶后（本轮）** | **11** | **118 (0.57%)** | **1041** |

两轮合计 **−15 clones / −173 行 / −1556 tokens**。分布：`ledger.ts` 10 → 4 处、`spec.ts` 4 → 1 处、client 7 → 5 处、scripts 1 处不动。
基线不是抄底稿：在 detached worktree 上按 commit 实跑（`git worktree add --detach <sha>`，跑完 `remove --force`）。

**残余 4 处 `ledger.ts` clone 里 2 处是刻意留的**：item 14 的两个离场主体（保留，见 §11）、`claim-*`/`task-changed` 落账近似变体
（单数字段、形状不同，折入需要另一套分支）。后两者在改动前就存在且 token 数完全相同，本轮未增减——不是本轮引入的回归。

### 净行数（诚实版）

- A 桶：**+6 行**（底稿估 −51）。
- B 桶：**源码 −21 行、测试 +26 行、合计 +5 行**（底稿对这 5 条估 −85）。
- 两轮合计：**源码 −15 行、测试 +26 行、净 +11 行**（底稿估 A+B 约 −190）。
- 偏差原因与 A 桶同一条教训：**审计阶段的行数估计不可信**（A 桶 7 条里错了 3 条）。B 桶的 `+26` 全部是新增的负向验证用例——
本轮刻意用测试行换「合并后不能更宽松」的证据，这是有意为之，不是估算失手。
- **收益口径仍是「同一件事只剩一处」，不是行数。** 26 → 11 处 clone 也不等于 15 个概念各归一，两者不互相折算。

## B 桶的裁定与理由

| # | 内容 | 裁定 | 落点 |
|---|---|---|---|
| 08 | `team_view` `tasks[].revision ?? 0` 假值 | **做** | schema 改可选 + mapper 省略（不删字段名） |
| 11 | `spec.ts` 四个离场 data 的五个共同字段 | **做** | `releaseSnapshotFields` |
| 12 | `changeScopes` 的 Thread/Channel 展开 | **做** | `withReleasedActivityScopes`（3 参数） |
| 13 | `apply()` 的离场快照落账块 | **做** | `applyReleaseSnapshot`（顺序逐项保留） |
| 15 | 两个 replay 校验器合并 | **做**（判据有修正，见下） | `validateReleaseCleanup(..., memberId \| undefined, ...)` |
| 09 | client 四处刷新 effect 收 Hook | **保留** | `KEEP-decisions.md` §9 |
| 10 | Thread mutation runner | **保留** | `KEEP-decisions.md` §10 |
| 14 | removeMember/archiveMember 离场主体 | **保留**（读后裁定） | `KEEP-decisions.md` §11 |
| 16 | 本地 5 个陈旧分支 | **转交** | 见下「边界与转交」 |

裁定依据是 human 给的「代码质量 + 后续可拓展性」：11/12/13/15 都在持久化格式与重放路径上，
把「新加一种离场 operation 要改四处」变成「改一处」，而这四处过去靠人手工保持一致、**出错不报错**。

### 一条必须公开的判据修正（第 15 项）

我裁定时给自己写死「helper 签名 ≤3 参数」这条硬判据，而合并后的校验器是 **6 个参数，字面上不满足该判据**。
我判定该判据在此处**不适用**而非「已满足」：它来自 ticket 06/10，那些多出来的参数是**行为回调**，
多回调才是「共享的是形状不是概念」的信号；而本校验器的 6 个参数全部是**它必须读取的数据**，**回调数为 0**，
且合并前的 Member 版校验器本来就已经是 6 个参数。**判据的真实内容是「行为回调数」，不是原生参数个数**——
这条已写成 `KEEP-decisions.md` 末尾的可复用规则。若 human 认为字面判据优先，第 15 项可整条回退（改动当时尚未提交）。
细节（等价性证明、负向验证覆盖、非空转证明）见 `issues/15` 的实施记录。

## 当前 frontier

- **谁在做什么：** 无人在办。A 桶与 B 桶采纳项都已交付；保留项的裁定已入册。
- **下一步：** human 决定 scratch 目录与代码改动是否落提交；`issues/16` 转交后由 Reeve / Ferry 确认。
- **阻塞：** 无。
- **未跨过的边界：** Roadmap Thread thread:a7e019ad 所在 Channel 我始终没有授权（读取被拒），
  所以这份清单**没有**与 Roadmap 既有条目做过去重——Momo 已替我做过去重（结论：与已排期条目无重复，
  并指出 07 与 #36 改同一批文件、08 是 render-IA/#33 的残留 follow-up），此处保留该记录以免重获授权后再重复一遍。

## 边界与转交

- **`issues/16`（本地 5 个陈旧分支）已转交 Reeve / Ferry**：`pr-18` / `pr18-fix` 是 0 独有提交、可直接删；
  三个 `backup-pre-*` 是 history rewrite 前的快照，需他们确认后处置。
  **任何情况下都不要 push 这三个分支。** 仓库 `wowyuarm/dsh-agent-team` 是**公开**仓库，
  pre-rewrite 的 lineage 一旦推送就不可撤回，这个决定点只在 push 之前存在。
- 本轮**未**改动 `origin/master`（仍为 `389fd92` 起算的远端状态），本地进展全部未 push，留给发布节奏。

## 正式文档出口（按 `docs/AGENTS.md` 路由逐条判过，结论：本轮**无**维护文档需要改）

- **`docs/architecture.md`**：路由条目是「包归属、Host 权威、Remote/preset/Client 边界或内部机制」。
  本轮 B 桶未新增任何模块，只改现有文件内部结构；A 桶新增的 `host-access.ts` / `team-dialog-save.ts` 是包**内部**取用器与 Hook，
  不改变包归属，且 `architecture.md` 第 21–22 行对 tool/client 两个包的描述仍是准确的（它逐一点名 agent-team 的
  `member-runtime` / `ledger` / `spec` / `types` / `invariant`，那是有权威边界的模块，不是一个模块清单）。
- **`docs/team-collaboration.md`**：08 动了 `team_view` 的模型可见输出，但该文档第 29 行只约束 **Thread 行**
  （「never revision or message count」），从未承诺 `tasks[]` 一定带 `revision`；改动后 Thread 行行为不变，**没有文档事实被推翻**。
- **`CHANGELOG.md`**：路由条目是「用户可见行为」。本轮无可观察的行为差异（08 那条哨兵本来就不可达，是「schema 不再说谎」）；
  沿用 A 桶被验收时的先例——那轮同样未动 `CHANGELOG.md`，它随发布节奏写。

## 这轮的方法（保留作过程记录）

不把指标当结论。`jscpd` / 关键词扫描只用来**定位**，每条候选都要落到源码、测试或契约上回答
「为什么现在删/并是安全的」。落不下来的，进 `KEEP-decisions.md`。

复现证据（都已在 2026-09-12 实跑）：

```
npm run duplication        # 审计基线 26 clones / 291 行；本轮后 11 / 118
grep -rniE 'legacy|backward|compat|fallback|deprecated' packages/*/src   # 89 命中（含 .tsx 口径）
npm test                   # 536 passed / 1 skipped
```

计数口径说明（已与 Momo 对齐）：差异来自 `--include` 范围，不是事实分歧。
`--include=*.ts` 是 **85**；`--include=*.ts --include=*.tsx` 是 **89**（本节采用）；
完全不加 `--include` 是 **90**，多出的 1 条来自 `conversation.module.css` 里的注释。
**结论不受口径影响**——逐条核过后可删的约等于零，见 `KEEP-decisions.md` §1。

## 两条必须先更正的口径

1. **jscpd 的分布重心在内核，不在渲染层。** 基线 26 处 clone 里 **17 处**在 `agent-team`：
   `ledger.ts` 10 处、`spec.ts` 4 处、`context-management.ts` 3 处；client 侧 7 处、tool 1 处、scripts 1 处。
   此前口头汇报的「client 8 处」是 console 输出尾部截断造成的读数错误。**中心结论：重复的重心在持久化内核。**
   （更正链：我先报成「15 处」是笔算错，10+4+3=17；Momo 的「client 8 处」是读数错误。以本节为准。）
2. **`legacy|backward|compat|fallback|deprecated` 89 处命中基本是假线索。** 逐条核过后，
   绝大多数是**持久化格式兼容**（legacy Session artifact remediation、legacy ledger 记录重放修复、
   legacy 内存目录迁移、legacy 工具名解码），其余是领域词（消息渲染的兜底 chip 行、A/B 兜底参数）。
   删任何一条都可能让已有本地数据读不出来。见 `KEEP-decisions.md` §1。

## 三个桶

| 桶 | 含义 | 文件 |
|---|---|---|
| A 可直接做 | 低风险内部去重/改字，有测试兜底 | `issues/01`–`07`（已实施） |
| B 需契约确认 | 动到持久化格式或模型可见契约 | `issues/08`、`11`–`13`、`15`（已实施） |
| C 保留 | 看起来能删、实际必须留，逐条给理由 | `KEEP-decisions.md` |

（编号不连续是收尾的结果：未实施的 ticket 已按 human 指示删除，只留做过的，理由留在 `KEEP-decisions.md`。
`issues/` 的骨架沿用 `.scratch/AGENTS.md` 的 ticket 格式，额外补了审计字段；`Status` 用 `complete` 表示已实施。）

## 预期收益（诚实版）

A+B 全部净减的底稿估计约 190 行，**实际源码净 −15 行**（见上）。
**这不是这轮的价值主张。** 真正的收益是消除「同一件事写三份、改一份忘两份」的漂移风险——
本轮把持久化重放路径上四处靠人手工保持一致、**且出错不报错**的副本钉死（11/12/13/15），
外加去掉一个伪造的模型可见字段值（08）。凡是为了让 jscpd 数字变好看而做的删除，一律进 C 桶。

## 不在本轮范围

- `ledger.ts` 拆模块：上一轮质量审计已结（39 方法闭包、提取暂缓），本轮不翻案，只做文件内去重。
- 渲染层 formatter：上一轮 render-IA 终审已确认共享 formatter 都有真实复用方，不重新翻案。
- `.scratch/active/member-session-architecture/` 是别人的在办工作项，本轮未触碰。
- **已核实的「顺带发现」，结论：描述属实，但不可达，判定为不是缺陷，故未改代码。**
  原始观察：`tool-agent-team/src/index.ts` 里 `...(item.taskNumber === undefined ? {} : ...)` 永不触发，而 ledger 的
  `taskNumbers.get(...) ?? 0`（三处：`ledger.ts` 1463 `resolveTaskRefs`、1517 `items[]`、1538 `taskNumbers` 列表）会编造 `0`。
  **可达性证明**（逐点位枚举，不是抽样）：
  1. 能把**新** `taskRef` 写进投影的 operation kind 只有两个——`team/message-sent`（带 `data.task`）与 `team/thread-promoted`；
     `tasks.set` 的全部点位（2383/2393/2402/2410/2447，后者含离场快照）里，2402/2410/2447 只引用**已存在**的 taskRef。
     `taskNumbers`（2937）恰好只读这两个 kind，因此它对投影中的每个 Task 都产出编号。
  2. 查询侧：`visibleTasks`（1508）受 `channelRefs` 约束，而 `channelRefs` 自身已按 `channel.workspaceId === request.workspaceId`
     过滤（1493–1496），所以 `visibleTasks` ⊆ `taskNumbers` 的键集；`resolveTaskRefs` 的查询同样要求 channel 的 workspaceId 匹配。
  结论：三处 `?? 0` 在当前 operation 集合下**不可达**，模型可观察层本来就正确省略。
  **为什么不做「诚实化」修改**：要让「无编号」变成可表示，必须放宽 `taskNumber` 的类型，而 Client 在
  `task-refs.ts:12` 以 **required** 消费它、`TeamMessage.tsx` 直接 `taskLabel(resolved.taskNumber)`——
  为一个不可达分支放宽一条公开 Remote 契约，收益为负。与第 08 项的关键区别：08 的 `required: true` 是在
  **模型可见 schema** 上断言了一个编造的事实；这里模型可见 schema 本来就标 optional、实现也已正确省略，**可观察层已经诚实**。
  **它什么时候才会变成真问题**：将来新增一种会把 Task 写入 `state.tasks` 的 operation kind 而忘记同步 `taskNumbers`。
  那时 `?? 0` 会把「不知道」变成「第 0 号」并渲染出来（`(#0)` / `Task #0`）。届时的正确修法不是继续加兜底，
  而是让 `taskNumbers` 直接从 `state.tasks` 派生（Map 首次插入顺序即创建顺序），使其对投影**构造上完备**。
