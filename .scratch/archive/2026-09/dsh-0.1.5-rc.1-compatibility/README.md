# DSH 0.1.5-rc.1 差异与兼容性评估

## 状态

**complete / archived** —— 候选已认证并落地为当前基线，peer 已移到 `>=0.1.5-rc.1 <0.2.0`。评估报告见 `materials/upstream-diff.md`（只读差异评估的原始产出）。

## 最后检查

2026-09-10 —— 认证、适配、CI 全绿。耐久结论已移入维护文档：`docs/dsh-release-compatibility.md` §6（基线、七处断裂、`main` keyed panel 座位、migration chain 与 fail-closed 语义）、§3.6（升级可行性）、`docs/development.md` 环境契约（corepack shim + `build:native-system`）、`docs/architecture.md`（上下文自管理）。

## 结果

**认证基线**：DSH `0.1.5-rc.1`，peer `>=0.1.5-rc.1 <0.2.0`（硬切，不再支持 `0.1.2-rc.1` 线）。源适配七处断裂：`ctx.agent` 离开 `AgentSetup`；根 `conversation` slot 变为 keyed `main` entry；`SessionPersistence.inspect()`/`borrowSession()` 被 handle API 取代；`assistant/chunk` 离开 Session 词汇表；`MessageText` 离开 `dsh-client-ui-primitives`；keyed-slot 冲突诊断措辞；`dsh-persona` row 的 `text` → `prefix`（运行时专属，只在真实 browser journey 显形）。

**落地 commit**：`f8d3dd7`（docs: session-source 迁移规则）+ `c43a986`（fix: 让认证 harness 在干净 runner 上可安装，折叠了 corepack shim / lockfile+`minimumReleaseAgeExclude` / harness host addon `build:native-system` / rollover 测试采样竞态四条）。CI `run 34484222667` 双 lane 绿（各 499 passed / 1 skipped）。

**该工作项暴露的两个非兼容性缺陷**（都在 CI 首次运行时才现形，本地全被掩盖）：

1. **认证 harness 自身 script 内部调裸 `pnpm`**（0.1.2 时代是裸 `npm`；根 script 里 8 → 26 处）。本地被 `~/.local/bin/pnpm` 这个 corepack shim 掩盖。修法：`corepack enable pnpm` 落在 CI 两个 job、`.hoplite/settings.json`、`docs/development.md`。
2. **peer move 未同 commit 提交 `pnpm-lock.yaml`**。CI 默认 `frozen-lockfile`，而本地 install 会就地改写锁文件——所以本地永远看不见。规则已写入 `docs/development.md`。

**第三个缺陷只在真正消费 checkout 时显形**：harness 的 host addon `native/system/packages/<platform>/bin/<libc>/system.node` 被 gitignore，`build:lib` **不**产出它，只有 harness 自己的 `test` script 会先跑 `build:native-system`——而本仓是**直接**对那个 checkout 跑 Vitest。缺它时 JSONL flock 租约锁加载失败 → 成员激活失败（`Agent is not an active Team Member`），85 个测试红/挂。修法：两个 CI job 的 harness 步骤都加 `corepack pnpm build:native-system`（`--host-addon-only` 在非 Linux/macOS 直接 exit 0）。

## 未闭合（不属本工作项，交 Human / Ferry）

- **发布通道**：npm `latest` 仍是 0.1.9（peer 为旧 range，且代码读已删除的 `agentCtx.agent`），**装了 dsh 0.1.5 的用户当前用不了已发布 bundle**。需一次 bump + publish。另：`>=0.1.5-rc.1 <0.2.0` 对 `0.1.6-rc.1` 判 false（预发布只与同 tuple 比较器匹配），下一版建议直接钉精确版本。
- **存量 session 迁移**：本机 47 个 v0 仍带已退役的自定义 message source kind（全部落在 `--home-yu-projects-dsh-agent-team--`），fail-closed 拒绝且零写入，数据完好。机械迁移已在真实 artifact 上端到端验证（4465 行 0 mismatch、reader 回读无损、回滚=删 v3）。建议只做文档化 runbook、不自动改写用户存储。
- 上游 descriptor-v2（本机 2 例，非 Team 引起）：Human 已裁决不管。

## 形式化出口

已执行：耐久结论移入 `docs/`（见上），本工作项归档到 `.scratch/archive/2026-09/`。