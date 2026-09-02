# Provide Member-Private Skills（wrapper provider + 私有目录，默认空）

Status: done (2026-09-02, Tars — wrapper + 默认空 + 活更新 + 端到端自装完成)

Blocked by: 01-member-capabilities-schema.md

> 范围更新（2026-09-02，与 Human 对齐）：**skills 默认只加载 Member 私有 `skills/` 目录，不继承全局/项目 roots（默认空）**；**上传 Remote 移除**——给 Member 传 skill 的方式是 DM/附件告诉它，Member 用自己的 fs 工具自装（一等公民能力自决）。UI 不做 skills 列表（04 同步收缩）。

## Goal

把 skills 从共享 preset row 迁移为 per-Member wrapper provider：**只扫描该 Member 的私有 `skills/` 目录**（`includeDefaultRoots: false`），显式勾选构成 name allow-list；私有目录初始为空，Member 自装 SKILL.md 即入自己的 catalog。

## Verified Mechanics（2026-09-02 调研）

- SkillRegistry 无 allow/deny API；catalog 视图 = global 层 + 整条 scope 链 providers（近层同名覆盖）；provider 缓存键含完整 scope chain（两 Member 天然分开）。因此隔离必须把 provider 挪到 Member scope，不能在共享 provider 上加目录。
- web bundle 已禁用 Host 层 `skill-filesystem` 与 `tool-skill` row（`bundle/web-app/cordis.patch.yml`，"presets own local discovery"）——Member 的 skill 视图当前只来自 preset 层，移除共享 row 后无 global 层泄漏。
- `SkillProvider` 接口仅 `name` + `list(options)` + `get(candidate, options)`（`skill/src/index.ts:248`）；`FileSystemSkillProvider` 是导出类（constructor: ctx, control, config）。⇒ Team-owned wrapper：`apply` 到 `agentCtx`，内部实例化 harness provider（**roots = `customSkillDirs: [私有 skills 目录]`，`includeDefaultRoots: false`**），`list()` 按 selection ref 过滤，`get()` 透传；不修改 Harness、不复制扫描权威，watch/invalidate 经同一 control 透传。
- **默认空的产品语义**：现状 Member 会看到 project/user/bundled skills；改后默认 catalog 为空（除非自装）。Human 已确认接受该语义变更（观测数据：5/9 成员从不用 skills，共享 roots 是噪音）。全局共享需求走项目 `.agents/skills/`（用户级决定），不属 Member 私有能力面。
- selection ref 活更新：ref 变化 + `control.invalidate()` ⇒ 下一 step catalog 查询得到新集，`tool-skill` 写 durable replacement catalog（每 step 全量替换已是既有协议）。不换 Session、不需要 Runtime revision。
- 私有目录：`join(privateMemoryPath, 'skills')`（`privateMemoryPath = dshHomePath('agent-team', 'members', <memberId>)`，src/index.ts:426）；`initializePrivateMemory()` 一并 mkdir；`cleanupRemovedMember()` 的整目录 rm 自动覆盖。suspend / session renewal 保留。
- 自装：member-context（`src/member-context.ts`）已注入私有路径组，增加 private skills directory 一行；Member 用 fs 工具写 SKILL.md（YAML front matter name/description），watcher/invalidate 自然入 catalog（auto 模式立即可用；显式模式勾选后可用）。**自装是唯一的 skill 安装路径**（无上传 Remote）；Human 通过 DM/附件把内容交给 Member，Member 自行落盘。
- wrapper 过滤是"过滤 list() 输出"不是"不扫描"：显式模式下未勾选 skill 仍在目录里被扫描——这是性能语义非安全语义，测试需锁定过滤正确性。
- 双 Member 同 watch 一目录的场景已不存在（各 Member 只扫自己私有目录），watcher 成本与共享 workspace skills 无关。

## Files / Areas

- `packages/agent-team/preset/team-member/agent.cordis.yml`：移除 `skill-filesystem` row（保留 `tool-skill`）。
- `packages/agent-team/src/`：wrapper provider（新文件）、setup 挂载、selection ref 保存与编辑路径、私有目录 provisioning、member-context 路径行。
- `packages/agent-team/tests/`：catalog 隔离与生命周期用例。

## Acceptance

- 新建 Member 的 catalog 为空（默认空语义生效）；自装 SKILL.md 后进入自己 catalog，另一 Member 不可见。
- 显式勾选 Member 的 catalog 恰为其勾选集；未勾选 skill 不可列出、不可 load（wrapper 过滤正确性）。
- 编辑勾选在下一 step 以 durable replacement catalog 生效，同 Session 历史保留。
- Member 自装 SKILL.md 进入自己的 catalog（auto 与显式两种模式）；Member remove 后私有目录（含 skills）一并删除。
- 共享 preset row 移除后：Member 不再看到 project/user/bundled skills（预期行为变更）；普通 DSH Session 不受影响（其 skill 来源不经过 team preset）。
- suspend/resume 与 Host restart 后 catalog 能力恢复一致。
- 一次真实自装→发现→load 的端到端用例（为 05 的 prompt 引导提供实测依据）。

## Outcome（2026-09-02 实施记录）

- **preset row 移除**：`skill-filesystem` row 删除（保留 `tool-skill`），shipping.spec 断言同步（显式断言 row 不存在）；注释说明 skills 是 per-Member Host 挂载。
- **wrapper provider**（`src/member-skills.ts`，`mountMemberSkillProvider(agentCtx, config): () => void`）：内部实例化 Harness `FileSystemSkillProvider`（`customSkillDirs: [私有 skills 目录]`, `includeDefaultRoots: false`）；`list()` 按 selection ref 过滤（list()-output 过滤语义，目录仍被扫描/watch——性能语义非安全语义，测试锁定）；`get()` 透传。
- **关键实现发现（排障记录，值得 Reeve 归档进 prototype-findings）**：provider 挂载不走 `agentCtx.plugin()`——从 Host activation 代码（Host async-trace fiber）挂载的 plugin fiber 不落在 agent scope 上；也不走 plugin `inject`（会像 member-context 的 agentTeam 依赖一样在 Host 启动恢复期间卡住 activation）。**正确接缝 = traceable service 解析**：`agentCtx.get('skills').registerProvider(...)`，与 `tools.restrict()` 同构（02 已验证的形状），disposer 由 Host 自管（`skillProviderDisposals` Map，六个 dispose 路径全释放）。另：registry 对 provider `list()` 抛错是静默 skip（warn 日志 + 空 catalog）——wrapper 构造漏参这类 bug 表现为"catalog 空"而非 activation 失败，调试时先直调 provider.list()。
- **私有目录 provisioning**：`initializePrivateMemory` 一并 mkdir `skills/`（与 notes 同级）；`cleanupRemovedMember` 整目录 rm 自动覆盖（测试断言 remove 后目录不可写）。
- **selection ref 活更新**：`MemberSkillSelectionRef { current, swap }`；`swap(allow)` 由 provider 绑定（更新 current + `control.invalidate()` 清 registry 缓存），updateMember 的 capabilities 编辑在 turn 边界（`applyCapabilityEdit`，与 tools 限制同处）swap——同 Session，下一 catalog 查询生效（cache key 含 revision，invalidate 后重扫）。
- **watcher 时序（产品语义）**：自装 SKILL.md 后 catalog 发现经 chokidar `awaitWriteFinish`（默认 200ms 稳定窗）→ invalidate → 重扫。测试用 `vi.waitFor` 等待发现而非竞速；真实 Member 体验 = "装完自然入 catalog"（下一查询或 watcher 触发，先到者）。
- **端到端验证**：默认空（新 Member + 普通 Session 双断言）→ 自装 code-review.md → 发现（仅 owner）→ `skills.get` 全文加载 → sibling 不可见 → 移除随 Member 目录删除；显式勾选过滤（未勾选不可列/不可 load）+ 编辑 live-swap（收窄/放宽/清除回 auto）；suspend/resume/Host restart 恢复一致 catalog。
- **依赖路径**：`@deepseek-ai/dsh-skill`（registry 类型）与 `@deepseek-ai/dsh-skill-filesystem`（provider 类）加入 `scripts/sync-paths.mjs` 的 harnessSrc 映射（dsh-storage-sqlite 同款），三份 tsconfig facade 重生成；`./member-skills` 加入 package.json exports。两包已是 peerDependencies（宿主 base bundle 提供 registry；skill-filesystem 仅 preset 时代引用，现在 Host 直接 import 类——peerDep 语义不变）。
- **member-context**：注入块加 `Private skills directory: <path>/skills` 行（renderMemberMemory 与 unavailable 两处），05 在此基础上完善引导文案。

## Follow-up（2026-09-02，Human 验收反馈：内置 meta-skill + skill 不止单 SKILL.md）

- **双 root**：`customSkillDirs: [内置只读 core-skills, 私有 skills/]`——同名时实测（dual-root probe）第一个 customDir 胜出（同 CUSTOM_RANK 下 list 先到先得），内置跨升级稳定，Member 装变体换名字。
- **内置 `member-skill-manager`**：`packages/agent-team/core-skills/`（**不能放 preset/ 下**——agent-presets 会把 preset root 下每个合法命名目录当 roster row，shipping roster 断言锁定单 preset）；SKILL.md + references/{writing-great-skills,auth-and-config}.md 目录形态，按私有空间语义改编自 Loom core-skills（绝对路径注入、Member 私有目录、DM 交 credentials、与 memory 纪律同源）。
- **默认 catalog 语义变化**：不再是空，而是内置集（meta skill）；测试基线同步（default = ['member-skill-manager']，自装后 append，sibling 恰为内置集）。
- **分发**：`core-skills/**/*` 加入 package files glob；`BUNDLED_SKILLS_DIRECTORY` 从模块发射位置 resolve（lib/ 与 src/ 均正确相对）。
- **真实体验观察**（2026-09-02 全员装配，Tars 实测）：写盘与 catalog 查询同 turn 时，watcher invalidation 已过稳定窗——发现**在本 turn 内即时可见**，快于测试里的 `vi.waitFor(200ms)` 语义；与"下一查询或 watcher 触发，先到者"的文档表述不冲突但更精确（装的时机落在稳定窗内时，查询前已 invalidate）。
