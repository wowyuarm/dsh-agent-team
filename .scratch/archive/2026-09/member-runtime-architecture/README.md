# Agent Team Member Runtime

状态：**已归档（2026-09-02，Human accept task:307a356b）**——Phase 1 七 commits（d974e9b / 828b526 / c240fa3 / fa848ca / 51d8579 / d791094 + scratch 收尾 a1ac415）+ 全员技能装配与自沉淀（九人各按职能装配推荐 skill、共沉淀 9 个私有 skill）；Runtime Revision / Plugin graph 热重载维持暂缓

最后核对：2026-09-02（Phase 1 实施完成日）

## 当前范围（2026-09-02 定稿）

1. 持久 Member capabilities 配置（`tools.allow?` 接口预留 + `skills.allow?`）经 Member 实体与 lifecycle operation 流转；create / resume / Host restore 时生效；编辑走 turn 边界活更新，不换 Session。
2. Tools 双接缝机制：`tools.restrict()` 减法（activation apply + 活更新 + 测试）+ per-member mount 加法 spike（session-query 验证）；**无任何 tools UI**，代码注释防 cleanup 误删，不带版本号措辞。
3. Skills：共享 preset 的 `skill-filesystem` row 移除；per-Member wrapper provider **只扫私有 `skills/` 目录（`includeDefaultRoots: false`，默认空，不继承全局）**；Member 自装 SKILL.md 即入 catalog；**无上传 Remote**（传 skill = DM/附件告诉 Member，其自装）。
4. UI 仅移除：创建流程频道选择页 + 编辑卡片频道成员区块（`channelRefs` Remote 保留可选）；不做 Tools/Skills 区块。
5. Persona/member-context 引导 Member 认识与管理私有空间（memory/notes/skills），含装 skill 方法、沉淀纪律、职责工作流显式触发引导（基于 Vera 实测反馈与 skill 使用观测数据）。

主线：Agent Member 成为 workspace 下可拓展的一等公民——持久 capabilities、私有 skills namespace、per-Member provider/restriction，从"共享 preset 的参数化实例"变成"有独立属性的实体"。

## 暂缓范围

- 同一 Session 的 Runtime revision 原子切换；
- Plugin graph 热替换、reload contract 和旧 generation 排空；
- `member-runtime/selected` Session event 与按 revision 的冷回放；
- provider roots 级配置的 UI（roots 变化仍归 next activation）；
- 任意 installed Plugin 的 authoring / apply UI；
- 为此新增 Harness composition swap seam；
- tools 的 UI 配置面（接口保留，无真实使用场景支撑时不做）。

这些方向在 DSH 机制上可行，但不进入近期设计和实施。

## 当前结论

- Member 已经是 Team ledger 中的一等领域实体，也是 Team Host 管理的一等 Agent/Session 生命周期单元。
- `team-member` 是 DSH `AgentPresets` 中的普通 preset，但当前所有使用该 preset 的 Member 共享同一份 standing composition 和 Plugin 实例。它不是 Member 独享的 Plugin runtime。
- 当前 `Agent.ctx`、`dsh-scope`、`ctx.tools` 和 `ctx.skills` 已具备实现 Member 级可见性隔离的主要基础；短期不需要创建第二套 Agent、Session、Tools 或 Skills 服务。
- **Tools 与 Skills 在 DSH 中的"平等外挂"模型是：composition row（`agent.cordis.yml` 中同为可配置 row）+ 两个同构的 scoped registry**（ToolRuntime 与 SkillRegistry 均为 global/preset/agent 分层、近层 shadowing、scope-chain 缓存键）。DSH 没有把二者合并成单一"capability"对象；Member capabilities 配置因此定位为覆盖两个同构 registry 的 policy 层，而将来的 Runtime manifest 保持统一的 composition rows。
- Phase 1 的两个接缝（restrict 减法 + per-member mount 加法）正是将来 Runtime Revision manifest 编排的原语（manifest = 必需 Team contract + member deltas）；本期实现不产生废料。
- 长期不应把 `team-member` preset 本身"升级成 Member"。正确目标是分开：**Member**（持久身份与协作权限）、**Runtime Profile**（可编辑能力配置来源）、**Runtime Revision**（不可变快照）、**Runtime Instance**（进程内装载）、**Agent / Session**（执行与模型历史）。
- 不为每个 Member 创建独立 Cordis root；Member Plugin 运行在同一 Host root 下的独立 scope/Fiber 子树中。
- **产品判断（2026-09-02）**："给 Member 关 tool"的直接功能价值小（可信 agent、danger-full-access，关 tool 只减 schema 噪音不限制能力）；本轮价值在架构（一等公民 + Phase 2 前置）与 skills（私有自管）。skills 默认空的语义变更经观测数据支撑（5/9 成员从不用 skills）与 Human 确认。

## 文档入口

- [`research.md`](research.md)：当前 `dsh-agent-team` 与相邻 `deepseek-harness` 的源码事实、生命周期和隔离边界。
- [`prototype-findings.md`](prototype-findings.md)：2026-09-02 四轮机制核对（restrict 语义、skills 无 deny 的 wrapper 解法、活更新路径、产品讨论决策记录）。
- [`spec.md`](spec.md)：目标模型、Phase 1 形状（§0、§6、§7、§13.3、§16）、Plugin reload 语义（§9–§15 暂缓）与验证路径。**注意**：§13.3 的 UI 示意与 §0 的早期范围已被 2026-09-02 的最终对齐超越（无 tools UI、无上传、skills 默认空）——以 issues/ 与本 README 为准。
- [`issues/`](issues/)：Phase 1 实施 tickets（01-05）与阻塞关系。

## 当前前沿

**Phase 1 全部落地（2026-09-02）**：01 capabilities schema（d974e9b）→ 02 tools 机制 + spike（828b526）→ 03 member-private skills（c240fa3）→ 05 prompt 引导（fa848ca）→ 04 UI 收缩（51d8579）。每 ticket 一个 commit、独立 review 通过（Reeve 五连 review，无遗留修改项）、258 测试 + test:browser 全链路全绿。实施期两项关键工程发现已归档 prototype-findings Round 5/6：lifecycle 严格串行下活更新编辑的等待语义；skills provider 的 traceable-service 挂载接缝（`agentCtx.get('skills').registerProvider`，与 `tools.restrict` 同构）。等待 Human 验收后关闭归档。

## 结束条件

该工作项满足以下条件后才能关闭并归档：

1. ✅ Phase 1 按 `issues/`（01-05）实施完成并验证（2026-09-02，五 commits + 五连 review）。
2. ✅ 已确认的长期结论写入 `docs/architecture.md`、`docs/domain-model.md`、相关 package README 和 Harness 导航文档（capabilities/tools/skills 语义、persona 引导、frontend-design 的频道侧编辑语义）。
3. Runtime Revision / 热重载方向明确为后续独立工作项或正式搁置（暂缓维持，见"暂缓范围"）。
4. 当前行为仍以 `packages/`、测试和 `docs/` 为准；本目录不作为公开 API 或实现权威。

**剩余动作**：Human 验收 → 满足条件 3 的归档决定 → 关闭工作项。
