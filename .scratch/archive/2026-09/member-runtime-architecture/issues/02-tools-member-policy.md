# Apply Member Tool Policy（restrict 减法 + mount 接缝 spike）

Status: done (2026-09-02, Tars — restrict apply + 活更新 + spike 完成)

Blocked by: 01-member-capabilities-schema.md

> 范围更新（2026-09-02，与 Human 对齐）：**缩为机制验证**——restrict 的 apply 与活更新保留（后续 Runtime Revision 的前置，不产生废料），per-member mount 降为 spike 记录；无 UI 交付（tools 复选列表明确不做）。tools.allow 是接口预留。

## Goal

在 activation 与编辑路径上落地 per-Member tool 策略机制：共享基线上的 `tools.restrict()` 减法（含 turn 边界活更新），并 spike 验证 per-member mount 加法接缝。

## Verified Mechanics（2026-09-02 调研）

- `tools.restrict({ allow })` 必须在 scoped context 调用；空 filter 抛错；返回 disposer，agent scope dispose 自动解除（`core/tools/src/index.ts:1071`）。
- restriction 对整条继承链生效（`view(scope)` 对 inherited 面要求 `layers.every(layer => layer.admits(name))`），preset 层的 Team tools / coding tools 都可被隐藏，隐藏即不可执行（UNKNOWN_TOOL）；agent own-layer 注册不受 restriction 影响。
- `restrictableNames` 是调用时的继承面快照：未知名直接抛错 ⇒ 调用顺序必须 mount → restrict → `validateMemberPreset()`，且 validate 放在 restrict 之后正好校验 restrict 后的可见面。
- allow = 用户配置 ∪ `AGENT_TEAM_TOOL_NAMES`；配置中的未知名先 drop + warning（见 01）。
- 活更新：dispose 旧 restriction + 注册新 restriction，走 lifecycle/maintenance gate 等 turn 边界；下一 step 重组 schemas 并写新 `request/header`，同 Session 保留，无需 Runtime revision。每个 step 的 schemas 视图是现算的（`view()` 无缓存），ref 式更新可行。
- 加法接缝（spike 级）：`agentCtx.plugin(toolPlugin, perMemberConfig)` 挂 agent exact layer——per-Member Fiber/config，其他 Member 不可见；机制（inject 经 scope chain 解析、listener 按 scope 分发、exact-layer shadowing）已验证，逐 plugin 需实测。**spike 对象：session-query**（无状态、无 watcher、Team 语境有用——Human 已确认）。spike 结果记入本 ticket Outcome 与 prototype-findings，不进 UI、不承诺交付。
- 编辑入口：Member 编辑 Remote（01 的 capabilities 字段）触发本 ticket 的 apply 路径。
- 防误删注释：restrict apply 与 mount spike 代码处注明"有意的接口预留：Runtime Revision 依赖此接缝，cleanup 时勿删"，不带版本号措辞。

## Files / Areas

- `packages/agent-team/src/index.ts`：`activateMember()` setup（src/index.ts:1005 附近）插入 restrict；新增 live-apply 路径与 disposer/ref 保存（`modelSelections` Map 同款模式）。
- mount 接缝 spike：session-query 的 per-member 真实挂载验证，结果记录。
- `packages/agent-team/tests/`：隔离与生命周期用例。

## Acceptance

- 两个 Member 配置不同 allow-list：`tools.schemas(scope)` 与执行解析均不同；互相不影响。
- suspend/resume A 后 A 恢复相同能力，B 全程不变。
- allow-list 含未知名时：activation 成功、名称被 drop、warning 出现在投影且带已知名集合摘要。
- 编辑 allow-list 在 turn 边界生效：同 Session 下一 `request/header` 记录新 schema 集；进行中调用被移除 tool 得到诚实错误。
- 非法/失败场景只阻断目标 Member（activation 失败 → unavailable + diagnostic），其余 Member 不受影响。
- Host restart（`teamFiber.dispose()` + 重建）后两 Member 从持久配置恢复各自能力。
- 普通 DSH Session（无 preset）看不到 team_* tools（回归断言）。
- spike：session-query 经 per-member mount 仅目标 Member 可见可执行；结果记入 Outcome。
- 无任何 tools 相关 UI 变更。

## Outcome（2026-09-02 实施记录）

- **restrict apply**：`activateMember()` setup 内顺序 mount → `applyMemberToolPolicy` → `validateMemberPreset`（validate 观察限制后的可见面）。allow = 配置去重∪五个 Team tools；未知名 drop + warning（`capabilityWarnings` 派生区，name + knownNames 摘要）；`tools.restrict()` 的 scoped-context/unknown-name 抛错自然冒泡为该 Member 的 activation failure（unavailable + diagnostic，与 Reeve 对齐）。
- **disposer 生命周期**：`memberRestrictions` Map（modelSelections 同款）；suspend/remove/clearMemberContext/reactivateMember/Host dispose 全路径释放，activation 失败也释放。
- **活更新**：`updateMember` 检测 capabilities 深比较变化 → idle 时立即 `reapplyMemberToolPolicy`（dispose 旧 + 注册新，同 Session；下一 step 的 schemas 现算生效，模型 request tools 已断言新面）；running 时等待 turn 结束（idle 或非 running 状态即边界）。
- **关键实现事实（与 Reeve 讨论的竞态修正）**：lifecycle Remote 经 `enqueueLifecycle` 严格串行——"edit 等待期间发起 suspend"的实际次序是 suspend 排在 edit 之后：turn 结束 → edit 完成并 apply → suspend 才执行。因此 Remote 路径上不存在"suspend 竞争掉 swap"的窗口；`session/disposed` 监听器覆盖的是 lifecycle 之外的销毁（Host dispose、bundle reload）。测试按真实串行语义锁定（edit pending 于 running turn → 释放 → 同 Session swap → 排队的 suspend 随后执行 → resume 恢复新面）。
- **spike（session-query per-member mount）**：真实 `@deepseek-ai/dsh-tool-session-query` 插件（从相邻 harness checkout 路径加载，非 Team 依赖）经 `holderAgent.ctx.plugin(toolPlugin, {})` 挂载；`SessionQueryEngine` 最小 stand-in（实现两个 abstract search 方法）在 member agent ctx 上 provide。结论：**机制成立**——session_search/session_trace 等五工具出现在目标 Member 的 exact layer，sibling 与普通 Session 不可见；`tools.execute()` 真实调用路由到该 Member 的 engine 实例（standIn.searches 断言）。执行路径已验证（非仅注册面）。局限记录：tool plugin 从相邻 checkout 绝对路径加载（spike 定位，非生产形态）；stand-in engine 未覆盖 SQLite 全文索引路径。
- **测试**：`member-tool-policy.spec.ts` 7 用例（隔离、未知名 drop+warning、suspend/resume/restart 恢复、idle 活更新 + request tools 断言、running 等待 + 串行排队语义、普通 Session 回归、spike）。
- **无 UI 变更**；capabilities 校验/清理链路复用 01 的 schema。
