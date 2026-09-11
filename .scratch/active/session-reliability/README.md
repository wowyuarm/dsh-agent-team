# Session reliability: 存量 session 可读性（0.1.10）与持久层重设计（下一版）

## Status

active — 工作项开启于 2026-09-10，Human 在 task:6ed30f62 Thread 中定调（10239）。01 与 02 均已 complete，并通过全机存量验证（2026-09-11）；rc.2 认证进行中。

**发布条件：01 与 02 必须同批（0.1.10）上线。** 01 单独上线会把 parent 变可读，从而触发「纯 legacy 形状当前世代被重复投递 handoff」这条引信（见 `materials/duplicate-handoff-fuse.md`）；02 的幂等守卫是同批的安全阀。

## 背景与目标

**0.1.10 目标（本工作项第一阶段，补丁式）**：所有 enabled 成员的所有 session（当前会话 + 完整 lineage 祖先）在 dsh 0.1.5 下可读。理由：后续要做 session search 与基于任意 checkpoint 的 handoff，两者都直接读祖先日志，读不出 = 功能缺口。

**下一版本（第二阶段，重设计）**：session 状态变化（写坏或 dsh 接口变化）近期多次引发外部 issue 与内部事故（2026-09-10 全员不可用事件、0.1.2 SQLite schema 废弃、0.1.5 格式迁移拒绝）。该领域将在下一版深入讨论并重新设计；本工作项同时充当重设计的证据库。

## 问题系列记录（时间序）

1. **0.1.2**：SQLite storage schema 废弃（dsh 侧），成员持久化读取断——首次「持久层变动 → agents 不可用」。
2. **2026-09-10 事件**：共享日常 harness 升级到 0.1.5-rc.1 时，live 成员会话仍带未迁移的 v0 历史 → 2 分钟内全员 unavailable。
3. **0.1.5 格式链**：v2→v3 迁移的封闭 `SOURCE_KINDS` 白名单（`session-format-v2-to-v3/src/payload.ts:112`）拒绝我们 0.1.9 写过的自定义 source kind（`agent-team-context-handoff` / `-continuation`）。数据零写入、字节完好，只是读不出。拒绝发生在插件挂载之前 → 读时拦截兼容不可能。
4. **E 类**：4 个 artifact 的 `turn/start` 未闭合上一 turn（v1→v2 审计拒绝，`session-format-v1-to-v2/src/migration.ts:135`）。其中 1 个是 Momo 的上一代（replay 源）。
5. **D 类**：1 个 seq gap（已归档成员 Cindy，非 0.1.5 引起）。
6. **外部 issue 多次反馈**：同属「session 状态变化 → agents 不可用」形状（Human 确认，具体 issue 号由 Human 补充）。其中一份用户报告（0.1.1→0.1.5 后 15/35 会话打不开，四类拒绝）已存 `materials/external-report-upgrade-refusals.md`——其第 3 类（插件自定义 source kind）与我们 B 类同因，第 2 类（descriptor v2）即我们 C 类。

## 根因链（代码级验证，2026-09-10）

```
成员可用性 = 能否读出 ledger 绑定的 session（单点）
  → 读失败走 activation catch（index.ts:2282）→ setMemberFailure → unavailable
```
- 失败入口①：当前会话主读被拒（升级后首启即中）。
- 失败入口②：`replayCarriedInput`（issue #13 修复引入的崩溃恢复路径）读上一代被拒 → throw（`:1638`，仅 `corrupt session log` 文案 fail-open）。
- `replayCarriedInput` 的 fail-closed 是 #13 的**有意设计**（绝不静默丢成员输入）；补丁不得整体翻转，只对「确定性格式拒绝类」fail-open（重试无意义），IO/未知错误保持 throw。

## 本机存量普查（2026-09-10，真实 persistence API 逐 artifact 读）

| 类别 | 数量 | 形状迁移（v3 兄弟）能否恢复可读 |
| --- | --- | --- |
| B：自定义 source kind，无 v3 兄弟 | 46（全为 enabled 成员祖先）+ 7 当前会话（人工抢救过，envelope 对新代码惰性） | **能**（纯形状改写，Vera 已验证 0 mismatch / 回读无损 / 回滚=删 v3） |
| E：turn/start 未闭合 | 4（3 个 Team 会话，1 个为 Momo prev） | **不能（已实验证实）**——拒绝在 v1→v2 迁移审计，且该审计要求 seq 严格递增，合成 `turn/end` 修复行无法物理插入（实测报 `seq gap`）。可用性由 02 的 fail-open 兜底；完整修复属上游 |
| D：seq gap | 1（Cindy，已归档） | 不迁（目标限定 enabled 成员；且需坐标重编号，超出「只增不改」） |

普查方法、A/B 对照、引信清单见 task:6ed30f62 Thread（消息 3e8ae1e8 / fe8b0dfe / 42a1d262）与各成员私有 notes。

**验证后修正（2026-09-11，全机 E2E）**：上表 B 类 46 的计数里，实际被 migration 拒绝且带旧 source kind 的是 47 份（含 3 份 B+E 复合缺陷），其中 44 份修复成功（`issues/01` 文末证据表）。修正要点：①「纯 B 可修」是 44，不是 46——差额来自 3 个 B+E 复合缺陷与 lineage 可达性；②B+E 复合缺陷（Tars/Reeve/Ferry 各处一份）在 read 路径被 B 类错误遮住、只有 admit 后才暴露 E，因此**不能**半迁移，按设计整份不动；③E 类实测 3 个（Reeve/Momo/Cole 各一份，非本插件写入），普查期的第 4 个（Momo prev）随 lineage 可达性不同而计在别处。

## 第一阶段（0.1.10 补丁）决策快照

- 迁移**作为包内代码**交付（不是脚本/runbook）：外部用户的机器只能通过随包代码触达。
- 机制：读原始 v0（zstd 帧，绕过 persistence 准入）→ B 类改写 message source 为准入形状（`5dd6373` 的 `plugin` + `form:'snapshot'` + 具名 `sections`）/ E 类事件原样透传 → 写 `session.v3.jsonl.zstd` 兄弟。
- **只增不改**：v0 原件永不触碰；v3 兄弟是从 v0 的派生物，可重推导（含 7 个已救但 envelope 惰性的会话）。
- 触发面：plugin 启动维护遍（覆盖完整 lineage，不挂激活路径——search 不经激活就读祖先）。
- 幂等：v3 已存在且为准入形状则跳过。
- 迁移失败：记日志并继续，绝不阻塞激活（最后防线是 replay fail-open 硬化）。
- 并行硬线（defense in depth）：`replayCarriedInput` 对 `SessionFormatUnsupportedError` 类（确定性拒绝）改警告 + 继续；IO/未知保持 throw。尊重 #13 的「不静默丢输入」意图。
- 幂等守卫（02，随 01 同批）：`reconstructMissingHandoff` 的触发条件从「无 handoff boundary」扩展为「无 boundary **且** own events 不含 legacy handoff source」——避免 01 落地后对纯 legacy 形状的当前世代二次注入。

## 第二阶段（下一版重设计）议题池

- Team 语义内容（handoff/continuation）退出 session 日志、改为 prompt 组装注入（ledger 已是 durable 权威）——消除 B 类再生的唯一途径；代价：transcript 可移植性、exactly-once 投递重做。
- fold 层把 legacy handoff kind 识别为 handoff boundary（而不是靠 02 的守卫）：对 session search 也有益，但会改投影层边界语义，与 session search 改动面重叠（Iris 提出，本轮未采纳）。
- 上游契约：v2→v3 目录给插件注册点，或被拒 artifact 的官方修复入口。
- 可用性与可读性解耦的产品形态（可修复状态 vs unavailable）。
- dsh 版本钉定（peer 精确版本，Human 已表态不支持范围）。

## last-checked

2026-09-11（01 全机存量验证 + 02 实现）。

## current frontier

01 complete、02 complete（代码在 `956b85a` / `810d6a`，单测 11 + 集成 1 + 全机 E2E 证据在 `issues/01` 文末）。rc.2 认证进行中（隔离 checkout）。Vera 的迁移探针（私有 notes `obs-scripts/session-migration/`）是转换逻辑的现成输入；Iris 的重复投递引信证据记在 `materials/duplicate-handoff-fuse.md`。

**发布门槛（Human 决定）**：peer `>=0.1.5-rc.1 <0.2.0` 已覆盖 rc.1/rc.2，但 npm `latest` 上的 0.1.9 仍是旧 peer range（新装 0.1.5 的用户装不上）→ 需要 0.1.10 bump + publish，且 01/02 必须同批。

## Completion conditions（第一阶段）

- 23 个 enabled 成员的全部 lineage artifact 经真实 persistence API 逐个读取：0 个**单独 B 类**拒绝（实测 44 修复、5 个残留拒绝全部由 E 类结构缺陷引起）。
- 迁移幂等（重跑无写入）、v0 字节不变（前后 sha256 对照）。
- replay 硬化有测试（格式拒绝 → 警告继续；IO → throw）。
- 重复 handoff 引信有守卫与单测（legacy handoff source 视为「handoff 已在日志中」）。
- docs 同步（架构文档的 session 处理小节 + dsh-release-compatibility 的基线记录）。

## Formal-doc exit

耐久结论（迁移行为契约、根因链、上游限制）落 `docs/architecture.md` 与 `docs/dsh-release-compatibility.md` 后，本目录归档进 `archive/2026-09/`（或当时月份）。
