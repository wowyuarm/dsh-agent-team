# member-time-awareness — 已收敛决策快照

**状态：** confirmed，Aster 实现（human 2026-09-08 拍板：不需要 tickets，直接实现）
**决策来源：** thread:7bab9a92（源 thread）+ thread:33b3da3e（show-me thread，时区两次拍板）。本文件是 README.md proposal 的**修正与确认层**——与 README 冲突处以本文件为准。

## 确认的决策（human 已拍板）

1. **协调时区：固定 UTC+8，带显式偏移**（`2026-09-08T17:00:00+08:00`）。**取代** README 原文的 "统一使用 UTC / 带 Z 的 ISO 8601"。
   - ledger 存储不动：`occurredAt` 继续存 UTC ISO，零迁移，旧 ledger 兼容照旧。
   - 换算只发生在 agent-facing render 层的**唯一 formatter**；多时区配置留给未来的配置层任务。
   - 为什么兼容 cache 不变量：+8 是固定偏移且无夏令时，UTC→+8 是确定性换算，同一 occurredAt 的渲染文本在任何重读路径中恒定。破坏 cache 的是「按环境换算」（浏览器时区 / DST / 跨机器漂移），不是固定偏移。
   - 显式偏移而非裸本地时间：自我说明、机器可解析、字典序可排序。
2. **clock 每 model step 注入**：每个 eligible `agent/pre-step` 追加一条 durable snapshot（README §1 全文有效）。
3. **exact timestamps 覆盖全部 Agent-facing 表面**（六表面清单见 README §2 表格，全部有效）。
4. **时间只用于理解新旧，不驱动任何自动行为**（README「明确不做」清单全部有效）。

## 硬不变量（验收条款，human 9305 拍板）

**同一历史事实的 occurredAt 在任何重读中必须是同一值。** 适用路径：再 read、history 翻页、compaction 后重建、旧 ledger replay。判别性断言必须写入测试（proposal 完成条件原文）。

推论：只输出绝对 timestamp（固定 UTC+8），禁止任何相对时间文案（「3 小时前」每次重读都变，必破 context cache）。

## 实现要点（已核实，2026-09-08 Reeve）

- `AgentTeamMessage.occurredAt` 已存在（必填字段 + stored form 的 replay normalization，ledger.ts L3557 一带），thread slice 对 Message 主要是 render 工作。
- `AgentTeamActivity` **没有** occurredAt，五类 Activity 都要从承载 operation 投影——这是 thread slice 的实际工作量。
- render 基线：85b3099 + f9d1c5a（五工具新 render 结构）；spec 断言机制在 `packages/tool-agent-team/tests/render-text.ts`。
- clock slice 先例：`packages/agent-team/src/progress-nudge.ts`（agent/pre-step + durable notice 形态）；preset 组合面在 `packages/agent-team/preset/team-member/agent.cordis.yml`。
- 不直接挂载 `@deepseek-ai/dsh-time-context`（browser-zone 语义不适配后台 wake）；Team 自有窄 plugin `member-time-context`，等 harness 开公开 non-browser policy 再迁移。
- 实现红线：不建第二套时间存储（全从 ledger 投影）；wall clock 回拨 elapsed 夹 0 但不篡改历史；clock snapshot 只做观察不做 authority。

## 交付顺序（无 tickets，实现顺序仍建议遵守）

clock → thread → discovery → delivery → contract（README「交付切片」五片定义有效，每片独立可验证）。

## 验收

- 测试覆盖：长时间 idle、resume、rollover、compaction、时钟回拨、旧 ledger replay。
- cache 不变量判别断言（见上）。
- spec 断言同步（render-text 机制现成）。
- 纯 Agent-facing 变更原则上不要求 `npm run test:browser`；触及 Remote/Client shape 则补跑。
- 完成后稳定契约写入 `docs/team-collaboration.md` / `.zh.md` + `CHANGELOG.md`。
