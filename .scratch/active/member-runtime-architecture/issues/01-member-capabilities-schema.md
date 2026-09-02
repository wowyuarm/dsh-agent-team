# Add Durable Member Capabilities Schema

Status: done (2026-09-02, Tars — schema/flow/projection-channel complete; drop+warning computation lands in 02)

Blocks: 02-tools-member-policy.md, 03-skills-member-provider.md

> 范围更新（2026-09-02，与 Human 对齐）：tools 只做接口（无 UI 写入路径），skills 默认只加载 Member 私有 `skills/` 目录（默认空、不继承全局 roots）。本 ticket 按此更新。

## Goal

把 Member 的能力配置（tools allow-list + skills 显式勾选）做成 Member 实体上的持久可选字段，经全部 lifecycle operation 与投影流转，并由 Remote 携带。本 ticket 只做 schema 与流转，不实现 apply（在 02/03 中做）。

**tools.allow 是有意的接口预留**：本轮无任何 UI 写入路径，仅 Remote 可设；它是后续 Runtime Revision manifest 编排的原语之一，cleanup 时勿删（代码注释同样注明）。

## Verified Mechanics（2026-09-02 调研）

- `AgentTeamAgentMember`（`packages/agent-team/src/types.ts:64`）被完整内嵌进 member-added / suspended / resumed / session-renewed 等所有 lifecycle operation——给实体加可选字段即自动流经全部操作，不需要新 op kind。
- `addMember` Remote request 在 `types.ts:636`；Member 编辑走既有 update Remote。
- 决策（2026-09-02）：字段名用 `capabilities`，不占用 Runtime Revision 词汇（revision 是快照，capabilities 是 Member intent）。形状最小化：
  - `capabilities?.tools?.allow?: readonly string[]` —— absent = 全部标准 tools；**接口预留，无 UI**；
  - `capabilities?.skills?.allow?: readonly string[]` —— absent = 自动加载该 Member 私有 `skills/` 目录中的全部 skills（目录默认空，不继承全局/项目 roots）；显式勾选 = 只加载列出的名字。
- 未知名策略：commit 时不做严格白名单；activation 时 drop 未知名并记录 warning（不 fail-closed，避免 Harness 改工具名使 Member 无法激活）。warning 需要出现在 status 投影中（独立于 failure diagnostic 的 `capabilityWarnings` 或等价物）。**drop 判定的对照集本身会漂移**（Harness 升级改名/删 tool）：warning 应携带当时已知工具名集合的摘要，使远期 warning 可诊断。
- 五个 Team tools（`AGENT_TEAM_TOOL_NAMES`）不进持久 allow-list——它是 Host 在 apply 时强制并集的必需契约，不是用户配置。
- 防误删注释：capabilities 字段声明、restrict apply 路径、schema 定义处注明"有意的接口预留：Runtime Revision 依赖此接缝，cleanup 时勿删"。**不带任何版本号措辞。**

## Files / Areas

- `packages/agent-team/src/types.ts`、`spec.ts`、`ledger.ts`（如需校验）。
- `packages/agent-team/src/index.ts` 的 addMember / update Remote 与投影。
- Typert 声明重生成（不手改 `lib/typert.*`）。
- `packages/agent-team/tests/`（schema 流转与重启恢复用例）。

## Acceptance

- addMember 携带可选 capabilities；持久化后 Host restart 重放恢复相同配置。
- capabilities 经 suspend/resume/session-renew 操作原样保留。
- 投影携带配置与（如有）warning；`privateMemoryPath` 类 Host-internal 字段不被暴露的既有规则不被破坏。
- 单元测试覆盖流转与重放，含一条"Harness 工具名漂移"模拟（配置引用已不存在的 tool 名 → activation 成功、drop、warning 带已知名摘要）。

## Outcome（2026-09-02 实施记录）

- `AgentTeamMemberCapabilities`（`tools?.allow?` / `skills?.allow?`）挂在 `AgentTeamAgentMember`，全部 lifecycle operation 自动流转；`memberSchema` 加可选字段，旧 ledger（无 capabilities 记录）重放不变。
- 未知名策略按 Reeve 精确化落地：**commit 零白名单校验**（纯 intent，Harness 改名不破坏重放），`AgentTeamCapabilityWarning`（name + knownNames 摘要）定义在 **status 投影派生区**（`AgentTeamAgentMemberStatus.capabilityWarnings?`），01 阶段恒 absent，02 在 activation 产生。空白名（whitespace-only）在 commit 拒绝。
- updateMember 与 `model` 同语义：absent 即清除（update 请求带防误用注释）；`assertSameMemberAdd/Update` 纳入 capabilities 深比较（requestId 幂等碰撞检测覆盖）。
- Client 编辑卡片回传已存储 capabilities（编辑不管理 capabilities 的调用方必须 echo，否则一次 handle 编辑会静默清除 Remote 写入的配置）。
- 防误删注释按 Human 措辞要求：types.ts / spec.ts / ledger.ts 均为"有意的接口预留：Runtime Revision 依赖此接缝，cleanup 时勿删"，无版本号。
- 测试：`update-operations.spec.ts` 新增 capabilities 全流转用例（add 携带 → 未知名照常 commit → suspend/resume 原样 → echo 保留 / absent 清除 / 再 pin skills-only → requestId 碰撞 → 空白名拒绝 → cold replay → 模拟 Host restart 后 membersForClient 恢复 + warnings 通道 absent）。
- 文档同步：docs/architecture.md + .zh.md（Host authority 列表新条目）、docs/domain-model.md + .zh.md（新词条 "Member Capabilities"）、packages/agent-team/README.md + .zh.md（Durability and lifecycle 段）。
