# Session reliability：事故证据与下一阶段设计判断

last-checked: 2026-09-14

**本文是事故证据记录与候选方案比较，不是已确认的设计。** 当前确认的范围以 [`../README.md`](../README.md) 为准：只提取统一读取 seam 与统一回返锁点规则，不建完整 Member Session Binding 模块，也不新增 `ready/degraded/repairing/blocked` 状态机。下面第 4 节推荐的 B、A 方案已被该决定取代，保留作比较记录。

## 结论

近期故障不是同一个 bug 反复出现，但共同暴露了一条错误的产品等式：

```text
Member 可工作 = Team ledger 正常
              × Team Host / preset 正常装载
              × 当前 Session 可识别、可恢复并成功激活

历史能力 = 当前 Session 可工作 × 所需祖先 Session 可读
```

当前实现把第一条等式任一环失败都压成 `availability/presence = unavailable`，又让部分祖先读取参与激活。结果是：上游接口换代、包实例错位、当前日志格式拒绝、已退役祖先损坏、真正的模型运行错误，在用户眼里都是“Agent 灰了”；而 `recoverMember` 对确定性格式拒绝只会再跑一遍同样动作。0.1.10 的迁移与 fail-open 补丁解决了已知数据，但没有给这个领域建立稳定的接口。

下一阶段不应先扩充一串 UI 状态，也不应把所有 Session 语义搬入 Team ledger。应先建立一个 Team-owned 的 **Member Session Binding 模块**：Host 生命周期代码只向它询问“当前绑定如何恢复”“某项 lineage 能力是否可用”，不再散落调用 `stat/open/list`、拼接错误文案并自行决定 fail-open/closed。模块内部保留小而结构化的结果；Client 只获得影响用户行动的聚合状态。

## 证据

### DSH 的接口和格式契约确实发生了硬切换

DSH `0.1.2-rc.1` 的 `SessionPersistence` 是 `create/inspect/borrowSession/list/listSnapshots`；`0.1.5-rc.2` 改成持有生命周期的 `create/open/flush/stat/list`，其中 `open()` 返回 `SessionHandle`，读句柄必须关闭，写句柄还承担唯一写所有权。Team 在 `b2cdf73` 一次迁移了全部读取调用点（当前 `index.ts` 内 8 处 `open/stat/list`），说明这不是单一调用点变化，而是 Host 生命周期依赖的 seam 发生了整体替换。

0.1.5 同时引入 released-format migration（Harness commit `d1521ea783`）。`packages/session/session-format-v2-to-v3/src/payload.ts` 的 `SOURCE_KINDS` 是封闭集合，迁移独立于已安装插件；旧 Team 写入的 `agent-team-context-handoff/-continuation` 因此整份 artifact 被 `SessionFormatUnsupportedError` 拒绝。`5dd6373` 改用获准的 `plugin + form:'snapshot' + sections`，`956b85a` 再通过只新增 v3 兄弟修复存量。全机验证是 23 个 enabled Members、44 份修复成功、6 份因未闭合 turn 等结构缺陷保持原样，既有 artifact 零改写，见 `.scratch/active/session-reliability/issues/01-lineage-v3-sibling-migration.md`。

Harness 已提供稳定错误类型：`SessionPersistenceNotFoundError`、`SessionAlreadyExistsError`、`SessionAlreadyOwnedError`、`SessionPersistenceCorruptionError`、`SessionFormatUnsupportedError`。Team 当前只有格式拒绝走类型判断，腐败仍靠 `/corrupt session log/` 文案正则，未知/IO 又在不同调用点被吞掉、包装或抛出。这正是结构化分类应该集中到一个模块的理由。

### Team-member notes 显示了三种不同故障层

1. **模块装载层**：GitHub [#12](https://github.com/wowyuarm/dsh-agent-team/issues/12) 中源码 TSX 入口与已构建插件分别加载 `dsh-scope/src` 和 `lib`，scope identity 分裂，preset 校验失败；[#15](https://github.com/wowyuarm/dsh-agent-team/issues/15) 中 Desktop runtime 与旧 profile 依赖树分线，两份 `agent-presets` 抢同一 settings namespace，Host 半边未激活。它们不属于 Session 数据损坏，但最终同样表现为 Agent 不可用或 Team UI 消失。
2. **Session 接口层**：[#14](https://github.com/wowyuarm/dsh-agent-team/issues/14) 精确暴露 0.1.2 时代 `inspect()` 与 0.1.5 `stat/open` 的代际错位；存在性探测误判后转去创建同名 Session，八个成员重启即 `session already exists`。
3. **Session 数据层**：Reeve/Ferry 的上一代日志出现重复 seq，`replayCarriedInput` 的 fail-closed 让已退役日志永久阻塞当前成员；`dabeb0b` 加入“当前世代已经运行则不读上一代”和 bounded corruption fail-open。随后 0.1.5 格式拒绝又击中当前会话与祖先，`8103d6a` 才对确定性 `SessionFormatUnsupportedError` fail-open。

因此共同问题不是“Session 校验太严”。严格校验保护了历史含义和用户数据；共同问题是 Team 没有把**装载健康、当前 Session 激活资格、祖先能力健康**分开，也没有让调用方显式声明“这次读取失败应阻塞什么”。

### GitHub #13 的关联记录有误

`member-session-architecture` 的合并前材料和历史 ticket 02 曾称 `replayCarriedInput` 是 issue #13 修复引入。Git 历史不支持该说法：函数由 `f20755a`（2026-09-06，checkpoint/recovery delivery 评审修复）引入，`dabeb0b`（2026-09-10）因 Reeve/Ferry 上一代日志腐败事故而硬化。GitHub [#13](https://github.com/wowyuarm/dsh-agent-team/issues/13) 是 Channel archival inbox cleanup 的 ledger 提交/回放不一致，与 carried-input replay 无因果关系。#13 仍是“持久化状态使重启失败”的旁证，但不是该恢复路径的来源。

## 当前设计中的混叠

`AgentTeamAgentMemberStatus` 同时暴露 `availability` 与 `presence`，两者都含 `unavailable`；`memberStatus()` 又把 durable lifecycle、是否有 handle、激活失败、rollover 窗口、preset orphan、runtime error、compaction error折进这两个字段。这里存在四个独立维度：

- **lifecycle**：enabled / suspended / archived / inactive，来自 ledger；
- **runtime**：idle / working / error / stopped，来自当前进程；
- **current binding**：missing / resumable / refused / corrupt / ownership blocked / transitioning；
- **capability health**：history/search/checkpoint-return/replay 是否完整，可能仅因某个祖先不可读而降级。

不应把四维的笛卡尔积直接做成一个巨大枚举。内部保留结构化事实，外部聚合成少量用户行动状态即可：

- `ready`：当前可工作；
- `degraded`：当前可工作，但某项历史能力不可用；
- `repairing`：有确定性、自动进行中的修复；
- `blocked`：当前不能工作，需要升级、修复数据或处理环境；
- lifecycle 非 enabled 时继续显示 suspended / archived。

`diagnostic` 应由结构化原因渲染，而不是成为唯一事实。这样新增 Harness 错误类型不会要求所有调用点同时学会字符串匹配。

## 设计候选

### A. 只扩充 status 枚举

实现最小，但根因仍在：`index.ts` 的每个 Session 读取点继续各自分类错误并决定阻塞范围，状态迟早再次漂移。不推荐。

### B. Member Session Binding 模块（推荐）

小接口示意：

```ts
interface MemberSessionBinding {
  restoreCurrent(member): Promise<RestoreResult>
  inspectCapability(member, capability): Promise<CapabilityResult>
}
```

`restoreCurrent` 负责 `stat/open/resume-or-create`、错误类型归一化、remediation 协调和 binding 一致性；`inspectCapability` 为 timeline、checkpoint return、handoff reconstruction、carried-input replay声明各自的 required/best-effort 语义。`AgentTeam` 只编排 ledger、Agent 与 UI 变更，不再知道 artifact 世代和迁移细节。当前 `SessionRemediation` 应成为它的内部策略，而不是再加一层并行 authority。

这不是为了未来 backend 做抽象：已有两个真实代际适配（inspect 与 handle API）、多个真实消费策略和真实自动修复，seam 已经存在，只是散落着。若删除该模块，复杂度会重新散回 `activateMember`、timeline、checkpoint、replay 等调用点，符合 deep module 的删除检验。

### C. 把 handoff/continuation 全部移出 Session 日志

可消除 Team 自定义 source 造成的格式迁移风险，但 handoff prose 当前只存在新世代 Session，ledger 只保存可验证 envelope。迁出意味着重做 transcript 可移植性、崩溃恢复与 exactly-once 投递。它可以作为后续独立设计，不是本次可靠性 seam 的前置条件。

### D. 让 Team ledger 镜像 Session 健康或内容

会产生第二持久化权威，健康状态也会随 Harness 升级立即过期，违反 ledger 只保存 Team facts 的边界。拒绝。

## 推荐的落地边界

1. ledger 中的 Member 和 session binding 继续是 durable authority；不持久化健康结论。
2. 当前 Session 读不出仍阻塞激活，不能伪装成 active；但 Member 身份仍是 enabled，UI 应显示具体 `blocked` 原因和可行动作。
3. 祖先读不出默认只降级依赖它的能力。例外必须显式：已提交 checkpoint return 的 seed 无法证明时应 fail-closed，绝不能静默创建空白 child；普通 timeline/history 截断可 degraded；已退役世代的 carried input 只有在无法证明已投递时才保留 fail-closed。
4. 自动修复只处理 Team 能证明由自身旧写法造成、并可全量校验的 artifact；未知结构不改写。`956b85a` 的只增不改原则继续保留。
5. 运行时/profile 模块分线不塞进 Session Binding；它属于独立的 Host boot health。UI/日志应能区分“Team Host 未启动”和“Member Session blocked”。

## 首个 proof 与证伪条件

先不要改 UI。提取一个纯分类/决策原型，拿现有 fixture 与真实错误类型跑矩阵：

| 输入 | 预期 Member | 预期能力 |
| --- | --- | --- |
| 当前 Session `SessionFormatUnsupportedError`，可修 | repairing → ready | 全部恢复 |
| 当前 Session 未知结构拒绝 | blocked | 不激活、不改数据 |
| 祖先格式拒绝，当前已运行 | ready/degraded | timeline/search 截断；当前工作不受阻 |
| committed checkpoint seed 不可读 | blocked | 禁止空白 child |
| retired carried-input source 腐败且当前未运行 | blocked 或需人工确认 | 不静默丢输入 |
| retired carried-input source 腐败且当前已运行 | ready/degraded | 跳过 replay并记录原因 |

首个 proof point：把 `activateMember`、`contextTimelineForAgent`、`recordedCheckpointPrefix`、`replayCarriedInput` 的错误决策搬到同一模块后，现有行为测试不降级，并能新增一个测试证明“同一个祖先拒绝只让 timeline degraded，却让 committed seed blocked”。

证伪条件：如果提取后接口仍需暴露 event 数组、artifact 路径、format 版本和每个调用点的错误类，模块没有形成深度，应撤回而只保留共享错误分类函数；如果无法给出 capability-specific 决策而最终仍只有一个 `available` 布尔值，则该设计没有解决单点绑定；如果需要把健康状态写进 ledger 才能工作，则 seam 放错了位置。
