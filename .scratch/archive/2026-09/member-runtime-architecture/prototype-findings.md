# Member Runtime 原型前调研(2026-09-02)

状态:调研记录 — 为 Phase 0/1 讨论准备;不定义当前行为。本文核对日期为 2026-09-02,基于 `dsh-agent-team` master@17a0460 与相邻 `deepseek-harness` 当前 checkout。

## Round 0 — 文档与代码漂移

- Harness 侧自 2026-08-28 起无提交;`research.md` 的 Harness 事实全部仍有效。
- Team 侧新增 DM 功能(`team_message` 增加 `dm` action、`team/dm-sent` ledger op)。Team tools **仍是五个**(`AGENT_TEAM_TOOL_NAMES`,DM 不是新 tool),spec 中"五个 Team tools"契约无需改数。
- `team-member` preset yml 仅 persona 文案变化;`skill-filesystem` row 仍在共享 standing composition 中。

## Round 1 — Harness 机制核对(含 research.md 未记载的细节)

### tools.restrict() 的真实语义(`core/tools/src/index.ts`)

- `restrict({ allow?, deny? })` 必须在 scoped context(agent.ctx)调用;空 filter 抛错;返回 disposer,agent scope dispose 时自动解除。
- **restriction 对整条继承链生效**:`view(scope)` 对 inherited 面(= global 层 + preset standing 层 + 链上所有祖先层)要求 `layers.every(layer => layer.admits(name))`。preset 层的 Team tools 和 coding tools 都可被 agent 层 restriction 隐藏,执行解析同一视图,隐藏即不可调用(UNKNOWN_TOOL)。
- **own-layer 豁免**:agent exact 层自己注册的 tool 不受 restriction 影响("own registrations … outside the filter above")。对目标设计无矛盾——Phase 2 的 Member Runtime scope 是 agent scope 的 **parent**,其 tools 属于 inherited 面,可被 restrict;agent 自己注册的东西本来就该始终可见。
- **`restrictableNames` 是调用时的继承面快照**:restrict() 只能命名当前已继承的 tool 名,未知名字直接抛错。⇒ 调用顺序必须是 `mount()` → `restrict()` → `validateMemberPreset()`;这样 validate 校验的是 restrict 后的可见面,天然证明"∪ 五个 Team tools"正确。restrict 不能挪到 mount 之前。
- restrict 只影响可见性/执行,不卸载 Plugin、不影响 prompt section 与 listener——与 spec §6.1 的定位一致。

### Skills 侧

- `dsh-skill-filesystem` 配置与 spec §7.2 的 yaml 示例逐项吻合:`providerName`、`includeDefaultRoots`(false 时 project/user/bundled roots 全部排除)、`customSkillDirs`(始终扫描)、watch 族配置。每个 provider 实例有独立 watcher 与 disposer。
- SkillRegistry 无 allow/deny API;catalog 视图 = global 层 + 整条 scope 链的 providers(近层同名覆盖);provider 缓存键含完整 scope chain(两个 Member 天然分开)。
- **web bundle 已禁用 Host 层 `skill-filesystem` 与 `tool-skill` row**(`bundle/web-app/cordis.patch.yml`:"presets own local discovery")。所以 Member 的 skill 视图当前只来自 preset 层;把共享 provider 从 preset 移到 per-Member 挂载后,**没有 global 层泄漏**,隔离成立。(CLI 部署的 standard preset 自挂 provider,与 Team bundle 无关。)
- `includeDefaultRoots: false` 会同时排除 `$DSH_BUNDLED_SKILL_DIR` 的 bundled skills——若未来做"private-only"配置,需要决定是否显式保留 bundled 目录。

## Round 2 — 原型/Phase 1 的确切落点

- **插入点**:`activateMember()` 的 `setup`(src/index.ts:1005)现有顺序 mount → validateMemberPreset → installModelSelection。restrict 与 per-Member provider 挂载插在 mount 之后、validate 之前。
- **持久配置落点**:`AgentTeamAgentMember` 被完整内嵌进 member-added/suspended/resumed/renewed 等所有 lifecycle op(types.ts:333 起)。给它加一个可选能力配置字段即可自动流经全部操作与投影;不需要新 op kind 承载配置。`addMember` Remote request(types.ts:636)加同形可选字段。
- **私有 skills 目录**:`privateMemoryPath = dshHomePath('agent-team', 'members', <memberId>)`(src/index.ts:426);skills root 即 `join(privateMemoryPath, 'skills')`,由 `initializePrivateMemory()` 一并 mkdir,`cleanupRemovedMember()` 已有整目录 rm。
- **向 Member 暴露路径的模式**:member-context 以 durable replacement context 注入绝对路径,Member 用自己的 fs 工具读写。private skills 沿用同一模式(在 member-context 输出中加一行 Private skills directory)。
- **代码内挂 plugin 有先例**:preset-roster.ts 用 `ctx.plugin(AgentPresets, {...})`;原型在 setup 内 `agentCtx.plugin(skillFilesystem, config)`(包内直接 import `@deepseek-ai/dsh-skill-filesystem`,注入 `skills` 服务经 scope chain 解析到 Host 单例)。
- **测试基建可复用**:member-lifecycle.spec.ts 已有真实 Cordis ctx + `teamFiber.dispose()` 模拟重启、`failingMount` 注入故障、persistent backend 模式;"Host restart 后恢复"直接沿用。
- **失败隔离天然成立**:setup 抛错 → creation transaction 回滚 → memberFailures.activation → member unavailable,其余 Member 不受影响;无需新机制。
- **per-Member provider 的代价**:每个 Member 一份 watcher;共享 workspace skills 时同一目录被 watch N 次。watchMaxProjects 默认 128,小团队规模无碍,记为已知成本。

## 待讨论决策(带建议)

1. **Phase 0 与 Phase 1 合并**。"Host restart 后恢复"要求配置先持久化,纯机制原型绕不开 ledger/Remote schema。建议:一次实施 = 实体字段 + Host apply(restrict + per-Member provider)+ lifecycle 测试;UI 单独决策(见 4)。
2. **Skills 默认行为**。spec §7.2 要求"共享 Workspace skills 必须显式配置";但翻转默认 = 现有 Member 立即失去 workspace/user skills,是行为回归。建议 Phase 1 默认 = `includeDefaultRoots: true` + customSkillDirs 加私有目录(≈现状 + 私有增量);显式配置可收紧为 private-only。bundled skills 是否随 private-only 保留另议。
3. **allow-list 未知名处理**。restrict() 遇未知名会抛错并使 activation 失败。建议:commit 时按已知能力集合校验;activation 时若环境差异导致未知名,drop + diagnostic(不 fail-closed),避免 Harness 改工具名把 Member 变砖。
4. **UI 时机**。无 UI 则 allow-list 不可达(仅 Remote 可设)。选项:(a) Phase 1 带最小 Create/Edit 表单(tools 复选 + private skills 开关),付出 browser 测试成本;(b) 机制先行,默认全量 tools + 私有目录自动生效,UI 下一批。倾向 (b) 先落地、(a) 紧随,但 (a) 的最小范围需要定义。
5. **Member 自写 private skills 是否默认开启**。member-context 暴露路径后,Member 可用 fs 工具写 SKILL.md,下一步即进入自己的 catalog(能力自扩)。与 project skills 对等、注入面等价,建议默认允许并在 persona 加一句引导;若要 Human-only 则 Phase 1 不暴露路径。
6. **配置字段形状与命名**。建议 `capabilities?: { tools?: { allow?: readonly string[] }, skills?: { includeWorkspaceRoots?: boolean, privateOnly?: boolean } }` 之类最小形状;命名应与 Phase 2 的 Runtime Revision 词汇不打架(revision 是快照,capabilities 是 Member intent)。
7. **限制 vs 未来热更新**。restrict() 返回 disposer,理论上可对 live Agent 原子换 allow-list(下一 step 记录新 header)。spec 已明确本期不做 live apply——记录这是"将来便宜的路径",与 Phase 2 全量 revision apply 分开评估。

## Round 3 — 产品讨论输入(2026-09-02,方向已初步认同,细节待确认)

### 用户新增的产品决策方向

- Tools/Skills 选择进入**创建与编辑 Member 卡片**;创建流程中的**频道页移除**(Remote `channelRefs` 保持可选字段,Member 后续加频道、DM 可达已支持)。
- Skills:**默认创建时什么都不选 = 自动加载所有能发现的 skills**(现状 roots + 新增私有目录增量);显式勾选才构成 allow-list。附带上传入口。
- 上传的 skill 文件写入 **Member 私有目录、与 memory/notes 同处**(`members/<id>/skills/`),这样 Member 之后也能用 fs 工具自己安装 skill。

### 解锁"按 skill 勾选"的新机制事实

- `SkillProvider` 接口极小(`name` + `list(options)` + `get(candidate, options)`,skill/src/index.ts:248),且 `FileSystemSkillProvider` 是**导出类**。
- ⇒ Team 侧可写一个 per-Member 过滤 wrapper:在 setup 里 `agentCtx.plugin(...)` 挂一个 Team provider,内部实例化 `FileSystemSkillProvider`(roots 配置不变),`list()` 输出按 Member 的 skill-name allow-list 过滤。**不需要改 Harness、不复制扫描权威、watch/invalidate 透传 control。**

### 活更新路径(回答"改 tools 要不要换 session")

- **不用换 session,不需要 Runtime revision。** 每个 step 重组 tool schemas 并写入新 `request/header`;`restrict()` 返回 disposer,可对 live Agent dispose 旧限制 + 注册新限制。
- Skills 选择同理可活更新:wrapper 读一个 Member-scoped selection ref(model selection ref 的同款模式),ref 变化时调 `control.invalidate()`;下一 step 查询得到新 catalog,`tool-skill` 写 durable replacement catalog,历史保持诚实。
- 边界:上述活更新覆盖 **tool allow-list + skill name allow-list**;provider roots/目录配置变化仍是 plugin graph 变化,归 next activation(与 spec §9.1 三类变化表一致)。apply 应走现有 lifecycle/maintenance gate 等 turn 边界,不要在 step 中途切换。

### 提案的卡片形状(待用户确认)

- Tools:静态复选列表(preset 可配置行:bash/pwsh、fs、fs-search、jobs、todo、web…),默认全勾 = 无限制;五个 Team tools 锁定显示 required。列表是静态的,适合全选默认。
- Skills:动态 catalog,不适合静态全选 → **默认 auto(不选 = 全部可发现 skills,含私有目录)**;提供显式 picker(列出当前可发现 catalog,含私有)进入 allow-list 模式;上传 = 写私有目录 + (显式模式下)自动加入勾选。
- 遗留小点:(a) 显式模式要不要"排除若干个"的反向语义(Phase 1 建议只做正向 allow-list + 全选按钮);(b) 显式模式下 Member 自装的 skill 需勾选后才可用(可接受,上传流程自动勾);(c) allow-list 未知名 drop + diagnostic; (d) tools 默认全勾还是与 skills 一致的"不选 = auto"——建议 tools 全勾、skills auto,理由如上。


## 原型断言点清单(Phase 0 七项的落地形态)

1. 两个 Member 不同 allow-list → `tools.schemas(scope)` 与执行解析不同。
2. 两个 Member 各自 provider → 各自 catalog 含(且仅含)自己的私有 skill;共享 preset 的 skill-filesystem row 移除(此为产品行为变更,Phase 1 落地)或原型期保留共享 row 做增量对照。
3. suspend A → A 的 restriction/watcher 随 scope 解除;resume A 恢复;B 全程 `schemas` 不变。
4. 非法配置 → 仅 A activation 失败 unavailable + diagnostic;B active。
5. dispose teamFiber + 重建 → 两 Member 从持久配置恢复各自能力。
6. 普通 DSH Session(无 preset)的 tool/skill 视图无 team_* 与 Member 私有目录。

## Round 4 — "怎么为单独 Agent 定制 tool"(2026-09-02 讨论)

用户疑问:共享 preset 让一个 tool 进入所有配置,那 per-member 定制从何谈起。

答案:共享 preset 只是**基线**,Agent scope 本身就是 per-member 定制接缝,减法加法都有:

- **减法(可见性/执行)**:`restrict({ allow/deny })` 按 Member 过滤共享面。tool 插件仍共享运行,但每个 Member 的 schema 与可执行子集独立。
- **加法/换配置(实例级)**:setup 中 `agentCtx.plugin(toolPlugin, perMemberConfig)` 把 tool plugin 挂到该 Member 的 agent exact layer——per-Member Fiber、per-Member config,其他 Member 不可见不可执行(own-layer 注册,且不受 restrict 影响,见 Round 1)。与 per-Member skill provider wrapper 是同一接缝。
- **覆盖标准 tool**:同位 shadowing——Member exact layer 同名注册覆盖 preset 层定义(view() 规则),可给单个 Member 换 config 版本。

待原型验证:各 harness tool plugin 是否都能安全 `apply` 到 agentCtx(inject 经 scope chain 解析、listener 按 scope 分发——机制已验证,逐 plugin 待测)。

UI 含义:v1 tools 列表 = 标准集(勾选=减法);Team 已知可选 tool(如 session-query/lsp)可进同一列表,实现为 per-member mount;任意第三方 plugin 安装仍是 Phase 3。与 Phase 2 关系:restrict + per-member mount 正是将来 Runtime Revision manifest 编排的原语(manifest = 必需契约 + member deltas),Phase 1 不产生废料。

## Round 5 — Phase 1 实施实证(2026-09-02,commit 828b526)

Round 4 的"待原型验证"由 02 的 spike 落地回答,并补充两个实现事实:

### mount 接缝实证(session-query spike)

- **机制成立,含执行路径**:真实 `@deepseek-ai/dsh-tool-session-query` 插件经 `memberAgent.ctx.plugin()` 挂 agent exact layer;`SessionQueryEngine` 最小 stand-in(实现 searchSessions/searchEvents 两个 abstract 方法)provide 在同一 member ctx。验证:session_search 等五工具出现在目标 Member 的 exact layer,sibling 与普通 Session 不可见;`tools.execute()` 真实调用路由到该 Member 的 engine 实例(standIn.searches 断言)——非仅注册面。
- **局限**(spike 定位,非生产形态):tool plugin 从相邻 harness checkout 绝对路径加载(生产需经依赖/包内路径);stand-in 未覆盖 SQLite 全文索引路径。

### 活更新的真实生命周期语义(修正 Round 2 的竞态预设)

- **lifecycle Remote 经 `enqueueLifecycle` 严格串行**:"edit 等待 turn 边界期间发起 suspend"的实际次序是 suspend 排队于 edit 之后——turn 结束 → edit 完成并 apply → suspend 才执行。Remote 路径上不存在"suspend 竞争掉 swap"的窗口。`session/disposed` 监听器补位 lifecycle 之外的销毁(Host dispose、bundle reload)。
- **restrict 抛错语义**:drop 发生在 restrict 之前,所以配置未知名不会触发 restrict 抛错;仅"Team tool 名不在继承面"这类 preset 异常会让 restrict 抛 unknown-name,自然冒泡为该 Member 的 activation failure(unavailable + diagnostic),其余 Member 不受影响。
- **edit 等待而非拒绝**:running 时 edit 等 turn 结束(同 Session swap,下一 model request 的 tools 已断言新面),排队在其后的生命周期操作最终一致。

## Round 6 — skills provider 的挂载接缝修正(2026-09-02,commit c240fa3)

Round 5 的 mount 接缝(session-query spike 用 `agentCtx.plugin()`)对 tool plugin 成立,但对 **skill provider 挂载不成立**——03 实施排障半天的关键发现:

- **`agentCtx.plugin()` 从 Host activation 代码挂载不落 agent scope**:Cordis 的 plugin fiber 落在调用方的 async-trace fiber(即 Host),不是目标 agent 的 scope。spike 能过是因为 tool plugin 的 apply 同步注册工具,scope 判定在调用时机;provider 注册需要正确的 scoped layer,挂错位置 = 隔离失效。
- **plugin `inject` 也不行**:声明 inject `['skills']` 会在 Host 启动恢复期间把 activation 卡死——member-context 对 agentTeam 的教训同款(preset row mount 时 Host 服务未就绪)。
- **正确接缝 = traceable service**:`agentCtx.get('skills').registerProvider(control => provider)`——服务实例从 agent ctx 解析,注册落 agent exact layer,与 `tools.restrict()` 同构(02 已验证的形状)。disposer 由 Host 自管(六路径释放)。无 registry 部署时 `get` 返回 undefined,返回空 disposer 优雅降级。
- **高危静默面:registry 对 provider `list()` 抛错是静默 skip**(warn 日志 + 空 catalog,不向上抛)。wrapper 构造错误(如漏传 selection)表现为"catalog 空"而非报错——排障需直调 `provider.list()`。wrapper 类实现必查:构造参数、目录存在性、list() 内部异常,任何一处错都是静默空 catalog。
