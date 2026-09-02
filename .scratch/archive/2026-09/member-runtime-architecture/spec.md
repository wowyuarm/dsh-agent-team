# Agent Team Member Runtime 目标设计

状态：active — Phase 1 形状已于 2026-09-02 与操作者确认（见 §0、§6、§7、§13.3、§16 与 `issues/`）；§9–§15 的 Runtime Revision / 热重载设计保留为长期记录

最后核对：2026-09-02

## 0. 本期边界

**本期包含（Phase 1，2026-09-02 确认）：**

- 持久 Member capabilities 配置（`tools` allow-list + `skills` 显式勾选），挂在 Member 实体上经全部 lifecycle operation 流转，`addMember` / Member 编辑 Remote 携带；
- Tools 双接缝：共享基线上的 `tools.restrict()` 减法（activation apply + turn 边界活更新），以及 Team 已知可选 tool 的 per-member mount 加法接缝（本期验证机制，v1 UI 列表 = 标准集）；
- Skills：共享 preset 的 `skill-filesystem` row 移除，per-Member wrapper provider（内部实例化 Harness 导出的 `FileSystemSkillProvider`，按 selection ref 过滤）+ Member 私有 `skills/` 目录 + member-context 暴露路径 + 上传 Remote（写入私有目录）；
- 创建/编辑 Member 卡片 UI：Tools 复选（默认全勾）、Skills（默认不选 = 自动加载全部可发现；显式勾选 + 上传），创建流程频道选择页移除（Remote `channelRefs` 保留可选字段）；
- 配置在 Member create / resume / Host restore 时生效；tools 与 skills 勾选支持 turn 边界活更新（同 Session，下一 `request/header` / replacement catalog 记录）；
- Host 校验（未知名 drop + warning，不 fail-closed）、隔离与生命周期测试。

**本期不包含：** 运行中 Runtime revision apply、scope rebind、Plugin graph 热重载、reload contract、revision event、按 revision 冷回放、任意 Plugin authoring、新的 Harness composition swap seam，以及 provider roots 级配置的 UI（roots 变化仍归 next activation）。

后文 §9–§15 保留这些内容作为长期设计记录，不应转成当前 implementation tickets。

## 1. Thesis

**建议把 Team Member 定义为高于 Agent/Session 的稳定运行主体，并新增 Member Runtime Revision / Runtime Instance，而不是把 `team-member` preset 继续膨胀成一个万能配置。**

`team-member` 应退回为默认模板和 Team 必需契约。每个 Member 的实际 Plugin graph 必须以独立实例挂载；Runtime revision 变化时保留 Member、Session、Workspace、Memory 和 Team 权限，在 Agent idle boundary 原子切换 Runtime scope。下一 step 重新组装 prompt、Tool schemas 和 Skill catalog，并将新契约写入同一 Session 的 `request/header`。

置信度：高。当前 DSH 已经提供 Agent scope、rollback-covered setup、scoped Tools/Skills、Fiber disposal 和 preset mount audit；主要不确定性是冷 Session 如何长期解析旧 Runtime revision，以及是否需要将 isolated composition instance 提炼成 Harness 公共服务。

## 2. 设计原则

1. **一个概念只有一个生命周期 owner。** Team Host 管 Member 和 Member Runtime；AgentLoop 管 Agent/Session；Plugin Fiber 管 effects。
2. **Team ledger 仍是 Member intent 的唯一持久权威。** Client、Plugin loader 和生成的 preset 文件都不维护第二份 Member 配置状态。
3. **共享 Host capability，隔离 Member composition。** 不复制 `agents`、`sessions`、`tools`、`skills`、`llm`、Workspace、sandbox、Web 或 Team Host。
4. **可见性隔离与实例隔离分开定义。** Tool 不可见不等于其 Plugin 没有共享状态；目标必须同时说明两者。
5. **运行时变化必须可重建。** 每次 Member activation 都从持久 Runtime revision 恢复，不依赖上次进程留下的 Fiber。
6. **模型可见契约变化必须在 Session 内留下明确边界。** Tool schemas、prompt 和 Plugin graph 变化后，下一 step 必须记录新的 `request/header`；Runtime revision operation 记录切换原因和配置，旧历史保持原样。
7. **热重载是 Member lifecycle，不是 Loader 事件的别名。** 用户操作只影响目标 Member；模块级 HMR 的全局影响必须明确暴露。
8. **Plugin 是可信代码，不是沙箱单位。** `isolate` 只隔离 Cordis service realm；权限仍由 Session sandbox、approval 和 Host policy 执行。

## 3. 目标领域模型

### 3.1 Member

Member 继续是稳定 Team 身份：

```ts
interface AgentTeamAgentMember {
  memberId: AgentTeamMemberId
  workspaceId: WorkspaceId
  sessionId: SessionId
  handle: string
  description: string
  model?: AgentTeamModelSelection
  runtimeRevisionId: AgentTeamRuntimeRevisionId
  privateMemoryPath: string
  state: 'enabled' | 'suspended' | 'inactive'
}
```

建议最终移除公开的 `presetId`：当前产品只允许 Team 私有 roster，Client 也硬编码 `team-member`。这个字段看似通用，实际把“Team 必需基础契约”“用户选择的能力配置”“运行中的 Plugin 实例”压成一个字符串。

### 3.2 Runtime Profile

可选的可复用 authoring source，描述“想让 Member 有哪些能力”。它可以来自：

- 内置 `team-member` 模板；
- Human 复制并编辑的 profile；
- 将来的受控 UI；
- 安装包提供的版本化 profile。

Profile 可以修改，不直接绑定正在运行的 Member。Profile 编辑只有在 Human 执行“应用”后才产生 Runtime revision。

### 3.3 Runtime Revision

Runtime revision 是一次不可变、可重建的能力快照。它至少包含：

```ts
interface AgentTeamRuntimeRevision {
  runtimeRevisionId: AgentTeamRuntimeRevisionId
  sourceProfileId?: string
  manifest: MemberRuntimeManifest
  manifestDigest: string
  createdAtSequence: number
}
```

要求：

- `manifest` 是有界、JSON-safe、无 secret 的规范化 Cordis composition manifest；
- credentials、API keys 和本机设置只存稳定 ref，由 Plugin 在执行时解析；
- revision ID 可由 request ID 或 canonical manifest digest 派生，保证重试幂等；
- Team operation 保存完整 manifest 或一个能校验并恢复完整 manifest 的持久值；
- 从 manifest 生成的 `agent.cordis.yml` 只是可重建缓存，不是 authority；
- Plugin identity 长期应包含已解析 package version/integrity。只有 bare specifier 而没有版本，不能声称 revision 真正不可变。

### 3.4 Runtime Instance

Runtime instance 是进程内 composition 对象，不写 ledger，也不拥有 AgentHandle：

```ts
interface MemberRuntimeInstance {
  memberId: AgentTeamMemberId
  runtimeRevisionId: AgentTeamRuntimeRevisionId
  key: ScopeKey
  composition: Scope
  status: 'preparing' | 'active' | 'disposing' | 'failed'
  diagnostic?: string
}

interface MemberExecution {
  agent: Agent
  handle: AgentHandle
  currentRuntime: MemberRuntimeInstance
  parentBinding: ScopeParentBinding
}
```

`MemberExecution` 持有稳定 AgentHandle 和 Session；Runtime Instance 只拥有一个 revision 的 Plugin Fibers。热切换替换 `currentRuntime`，不 dispose Agent。Host restart 后从 Runtime revision 创建新 instance，并恢复原 Session。

### 3.5 Runtime Profile、Revision、Instance 的关系

```text
mutable Runtime Profile
          │ Human applies
          ▼
immutable Runtime Revision ──────── recorded in Team ledger
          │ instantiate for one Member
          ▼
process-local Runtime Instance ──── Scope + Plugin Fibers + AgentHandle
          │ drives
          ▼
Session / model requests
```

不要把 Profile、Revision 和 Instance 都叫 preset。Preset 是 composition source；Revision 是持久快照；Instance 是实际运行物。

## 4. 目标 scope 与 composition 结构

### 4.1 当前结构

```text
Agent A ─┐
         ├─→ shared `team-member` standing scope → global Host services
Agent B ─┘
```

### 4.2 目标结构

```text
Agent A scope
    │ parent
    ▼
Member A Runtime scope
    ├─ persona / prompt plugins
    ├─ Member A tool plugins
    ├─ Member A skill provider
    ├─ Team protocol + five Team tools
    └─ isolated per-Member services
             │
             ▼
        global Host services

Agent B scope
    │ parent
    ▼
Member B Runtime scope
    ├─ its own Plugin Fibers
    ├─ its own skill provider/watchers
    └─ its own isolated services
             │
             ▼
        the same global Host services
```

两个 Runtime scope 即使使用相同 Runtime revision，也不得共享 Plugin instance。复用的是 manifest 和 Host capability，不是 Fiber。

### 4.3 可复用的现有 Harness 机制

第一机制验证应优先使用公开能力，而不是复制 Loader：

1. `ctx.agentPresets.resolve(revisionPresetId)` 只解析不可变 source，不调用共享的 `AgentPresets.mount()`；
2. `createScope(agentCtx, runtimeKey)` 创建 Agent-owned Runtime scope；
3. `mountPreset(runtimeScope.ctx, preset)` 在该 scope 独立挂载 composition，并复用现有 inactive-row 与 leaked-service audit；
4. `bindScopeParent(agentKey, runtimeKey)` 在 unpublished setup 中完成 Agent → Runtime 绑定；
5. Agent disposal 自动销毁 Runtime scope；
6. 原型显式验证 `composedPreset()` / `serviceFor()` 能否通过这个直接 parent key 找到本 Member mount。

这个路径不能与 `AgentPresets.mount()` 混用：一个 Agent scope key 只能绑定一次 parent；后者会先把它绑定到按 preset id 共享的 standing mount。独立 Runtime 路径必须只使用 `mountPreset(runtimeScope.ctx, preset)` 后再绑定 Agent → Runtime。

若原型证明该组合对 ownership、cold read 或 reload 不足，再考虑向 Harness 提取正式的 `instantiate()` API。不要一开始就 fork `AgentPresets`。

## 5. `team-member` 的新定位

### 5.1 当前问题

当前 `team-member/agent.cordis.yml` 同时承担：

- Team 身份和协作协议；
- 五个 Team tools；
- coding Tools；
- Skills provider 与 skill consumer；
- Workspace instructions；
- Web tool；
- todo/jobs；
- compaction；
- tool presentation。

这使“是不是 Team Member”和“能做哪些工作”成为同一个开关。

### 5.2 建议定位

`team-member` 保留为默认 **Runtime Profile template**，不再代表运行中的 Member instance。

必须存在的 Team contract：

- persona 中的 Team 安全与协作规则；
- `member-context`；
- 五个 Team tools 和 `AGENT_TEAM_PRESET_MARKER`；
- Team Host 身份解析；
- 必需的 tool presentation / Workspace instruction contract；
- Host 明确依赖的 compaction seam（若 auto-compaction 继续是必需行为）。

可配置的工作能力：

- bash / pwsh；
- filesystem / search；
- web；
- jobs / todo；
- Skills provider roots；
- LSP、session query 或未来工具；
- 额外 Member plugins；
- Plugin-specific config。

长期 Runtime manifest 应由“必需 Team contract + 用户能力 rows”规范化生成。用户不能删除 Team contract；Host 在 unpublished setup 末尾继续验证五个 Team tools 和 marker。

## 6. Tools 隔离方案

### 6.1 本期方案：共享基线 + per-Member 双接缝

共享 `team-member` standing composition 仍是所有 Member 的 tool 基线；per-Member 定制发生在这个基线之上的 Agent scope，减法与加法都有：

- **减法（可见性/执行）**：activation 在 `agentCtx` 调用 `tools.restrict({ allow })`，allow = 用户配置 ∪ 五个 Team tools；调用顺序必须是 mount → restrict → `validateMemberPreset()`（validate 校验 restrict 后的可见面，天然证明并集正确；`restrictableNames` 是调用时的继承面快照，未知名会抛错，故配置中的未知名由 Host 先 drop 并记录 warning，不 fail-closed）；
- restriction 对整条继承链生效（global 层 + preset 层），隐藏即不可执行（执行解析走同一视图）；agent own-layer 注册不受 restriction 影响；
- Host 保留每 Member 的 restriction disposer；编辑 allow-list 时对 live Agent 解除旧限制并注册新限制（走 lifecycle/maintenance gate 等 turn 边界），下一 step 写入新 `request/header`——**不换 Session，不需要 Runtime revision**；
- **加法（实例级）**：setup 中 `agentCtx.plugin(toolPlugin, perMemberConfig)` 把 tool plugin 挂到该 Member 的 agent exact layer——per-Member Fiber 与 config，其他 Member 不可见不可执行。Team 已知可选 tool（如 session-query）经此接缝提供；v1 UI 列表仍以标准集为主；
- **覆盖**：Member exact layer 同名注册 shadowing preset 层定义，可给单个 Member 换 config 版本。

该阶段实现的是**可见性与执行隔离**（减法）加 per-Member 实例挂载（加法）；减法不卸载共享 Plugin 的 listener/effects。文档和 UI 必须明确这一边界，不把它包装成完整 Member Plugin Runtime。

### 6.2 目标方案：只挂载选择的 Tool Plugins

目标 Runtime manifest 只包含该 Member 选择的 Tool Plugin rows。这样：

- Tool schema 不注册就不可见、不可执行；
- Tool Plugin listener/effects 也不运行；
- stateful Tool Plugin 每 Member 一个 Fiber；
- scoped Tool registry 仍是共享 `ctx.tools`；
- Host provider（fs/shell/web/jobs）继续共享，并在每次调用中接收 Agent/Session identity。

`restrict()` 仍可作为防御性 policy，但不再承担“卸载 Plugin”的职责。

## 7. Skills 隔离方案

### 7.1 私有目录

每个 Member 新增：

```text
$DSH_HOME/agent-team/members/<memberId>/
├─ memory.md
├─ notes/
└─ skills/
```

`skills/` 与 memory/notes 同属 Member 私有 namespace。Member remove 一并删除；suspend、Session renewal 和 Runtime reload 保留。

### 7.2 provider 规则

不要继续让所有 Member 继承共享 `dsh-skill-filesystem` 默认 roots。从共享 preset composition 中移除 `skill-filesystem` row（web bundle 本就禁用 Host 层 row，Member 的 skill 视图只来自 preset 层，因此移除后没有 global 层泄漏），并在每个 Member 的 setup 中挂载一个 Team-owned wrapper provider：

- wrapper 是一个 Team plugin，`apply` 到 `agentCtx`（agent exact layer），内部实例化 Harness **导出的** `FileSystemSkillProvider`（roots 配置 = 默认 project/user/bundled roots 不变 + `customSkillDirs` 增加 Member 私有 `skills/` 目录），`list()` 输出按该 Member 的 selection ref 过滤，`get()` 透传；不修改 Harness、不复制扫描权威，watch 与 `control.invalidate` 经同一 control 透传；
- **默认不选 = selection ref 为空 = 自动加载全部可发现的 skills**（现状 roots + 私有目录增量，行为对齐现状）；显式勾选 = name allow-list；
- selection ref 是 Member-scoped 可变 ref（与 model selection ref 同款模式）：编辑勾选时原地更新 ref 并触发 `control.invalidate()`，下一 step 查询得到新 catalog，`tool-skill` 写 durable replacement catalog，历史保持诚实——**不换 Session，不需要 Runtime revision**；
- `ctx.skills` registry 仍共享，wrapper 注册在该 Member 的 agent scope；同名 Skill 的覆盖规则沿用 DSH；
- 上传：Host Remote 方法把上传的 skill 文件净化写入 `join(privateMemoryPath, 'skills')`（路径封闭在该目录内）；watcher/invalidate 自然刷新 catalog；显式模式下自动加入该 Member 的勾选；
- 自装：member-context 在私有路径说明中加入 private skills directory 一行，Member 可用 fs 工具往自己的 `skills/` 写 SKILL.md 自装 skill（auto 模式立即可用；显式模式需勾选后可用）。

provider roots、provider Plugin 或 invocation policy 的变化仍属于 Runtime revision 变化（本期不开放其 UI）。

## 8. Provider、Workspace、Memory、Permission 的层级

| 能力 | 所属层 | 说明 |
| --- | --- | --- |
| Member identity / Workspace binding | Team ledger | 稳定领域事实 |
| current Session id | Team ledger | Runtime revision 热切换默认保持；仅显式清空上下文时更新 |
| model route selection | Member intent + Agent scoped ref | adapter registry仍共享；当前可原地更新 |
| Workspace cwd | Session header | 不由 Plugin graph复制 |
| private memory / notes / skills files | Member private namespace | Member 生命周期资源 |
| Tool / Skill registry | Host singleton | 通过 scope 产生不同视图 |
| Tool / Skill Plugin fibers | Member Runtime Instance | 目标为每 Member 独立 |
| LLM adapters / Web / fs / shell / sandbox providers | Host singleton | 请求时按 Agent/Session解析 |
| sandbox / approval state | Session log | 不放入 Runtime manifest 的可变状态 |
| Team ledger / Host | Host singleton | 绝不在 Member Runtime 中再次提供 |

## 9. Runtime 更新与热重载语义（暂缓）

### 9.1 三类变化

| 变化 | 处理 | Session |
| --- | --- | --- |
| `memory.md`、notes、Skill body/catalog | provider/context 自己失效并发布 replacement | 保留 |
| model selection | 更新 Agent-scoped selection ref，下一请求记录新 header | 保留 |
| Runtime manifest：Tools、prompt、Plugin graph、provider roots/config | 准备新 Runtime revision，在 idle boundary 原子切换 scope | **保留** |
| Human 明确选择“从新上下文开始” | Runtime revision 可保持或同时更新 | **新 Session** |

是否能保留 Session 与“新旧 Tool schema 是否相同”无关。DSH 已有三种同 Session 更新通道：

- 动态 context 变化：注入 durable replacement message；
- Skill catalog 变化：注入完整 replacement catalog；
- system prompt / Tool schemas 变化：每个 step 重新组装，并在变化时写新的完整 `request/header`。

旧 tool call/result 继续作为历史消息存在；下一请求只发布当前 Tool schemas。必要时 Runtime Plugin 再注入一条 model-visible replacement notice，明确当前 revision 已替代旧能力，避免模型从旧历史推断已删除的工具仍可调用。

这里的“增量”是 **Session 级增量**，不是在 live graph 上逐 row 拆装。实现仍应准备一套完整新 generation，全部 mount/audit 成功后一次 rebind；否则模型或执行管线可能观察到半套 prompt、Tools 或 listeners。真正需要判断的是 Plugin 活状态：有运行中 job、terminal、外部事务或不可排空资源的 Plugin 必须先达到 quiescence，或通过 reload contract 明确拒绝切换。

### 9.2 Member-level hot apply

“应用新 Runtime”定义为：无需重启整个 DSH，也不清空目标 Member 的 Session，只替换其 Runtime Instance。

```text
Human applies profile
  → Host 规范化并验证 immutable Runtime revision
  → 在旧 Runtime 仍服务时准备新 Runtime scope
  → mount rows，等待全部可用，校验 Team contract / service leaks
  → 等待 Agent idle boundary
  → 提交 revision intent，并原子 rebind Agent scope parent
  → 下一 step 重新组装 prompt / Tool schemas / Skill catalog
  → AgentLoop 把新请求契约写入同一 Session 的 request/header
  → 排空并销毁旧 Runtime scope
  → publish active；失败则保留旧 Runtime
```

保持：

- `memberId`、handle、description；
- **同一个 `sessionId` 和完整模型历史**；
- Workspace；
- Channel membership、Claims、Attention、Inbox；
- private memory/notes/skills；
- model override（除非同一操作修改）。

更换：

- Runtime Instance；
- Plugin Fibers；
- Runtime revision ref；
- 下一请求中的 system prompt、Tool schemas 和 Skill catalog。

旧 Runtime 必须在新 Runtime 完成 mount/audit 前继续服务。Host 使用 `agent.runMaintenance()` 占住真正的 idle phase：后续 waking input 留在 Inbox，直到切换结束才进入下一 turn。scope parent 的 rebind 是进程内 commit point；新 revision 准备失败时不改变 Agent。rebind 后若旧 Runtime 无法排空，应报告 teardown failure，但不能把 Agent 绑回一个已继续执行的旧 generation。

### 9.3 失败语义

Runtime revision apply 必须分成 prepare 与 commit：

- **prepare 失败**：保留旧 Runtime 和同一 Session，返回准确 failed row / missing service / leaked service 诊断；ledger 不得宣称新 revision 已生效。
- **commit 成功**：Agent scope parent 指向新 Runtime，Member projection 更新为新 revision；下一 step 记录新 `request/header`。
- **旧 Runtime teardown 失败**：新 Runtime 继续生效，Host 报告资源清理错误并重试清理；不得静默双跑两个可接收 Agent events 的 generation。
- **Host 在 commit 窗口崩溃**：startup 以 ledger 的 desired revision 重建 Runtime；Session 中尚无新 header 表示新 revision 还没服务过模型请求，不构成历史矛盾。

当前 Cordis 可以准备独立 scope，但原子 rebind、旧 listener 停止接收事件和 teardown 顺序仍需机制原型验证。若现有 primitive 不足，再向 Harness 增加 composition swap handle；不要用一个已发布的影子 Agent 模拟事务。

### 9.4 自动恢复

同一 Runtime revision 因 roster reload 或 orphaned scope 丢失时，可以恢复同一 Session；当前 `reactivateMember()` 已有这一语义。

显式 Plugin graph 变化产生新 revision，但同样保留 Session。两者区别在于前者重建同一 revision，后者在日志中提交新的 revision boundary，并由下一次 `request/header` 记录新的模型请求契约。

## 10. Module HMR 的明确限制

必须区分：

1. **Member config reload**：只重建目标 Member composition，可以做到隔离。
2. **Skill file reload**：provider 按 Member scope 失效，可以做到隔离。
3. **Plugin module source HMR**：Cordis HMR 按 Plugin runtime 替换该 callback 的所有 Fibers；同一模块被多个 Member 使用时会一起变化。

因此产品不能承诺“修改共享 Plugin 源码只热重载一个 Member”。要支持不同 Member 同时运行不同代码版本，必须使用版本化 module artifact/specifier，使它们不属于同一个 Plugin runtime identity。

生产定义中的 Runtime revision 应引用固定 Plugin version。开发模式下的源码 HMR是调试便利，不是持久 Runtime 语义。

## 11. 权限与可变更权限

Runtime composition 是可信代码，权限等同本机 shell。建议：

- 只有 Human Remote / Host policy 能提交 Runtime revision；
- Team tools 不增加任意 `plugin_load` 或 `plugin_reload`；
- Agent 可以提出变更或编辑草稿，但不能把自己的草稿直接变成生效 composition；
- 若未来允许自治安装，必须是显式 capability，经过 approval，并由 Host 规范化、审计、commit、activate；
- manifest 禁止嵌入 credentials，使用 Host settings/credential refs；
- mount 继续拒绝 root-realm service leak；
- required Team tools、identity binding、Workspace boundary 和 Session permission 不能由 Member Plugin 覆盖。

## 12. 冷 Session、回放和旧 revision

同一 Session 可以跨多个 Runtime revisions。冷读不能只看 Session header 的初始 `agentPreset`；它必须按时间边界解析当时的 Tool presenter 和 composition metadata。

建议新增 Team-owned log-only `member-runtime/selected` Session event，记录 `runtimeRevisionId`。事件在 scope rebind commit 时追加；后续 `request/header` 记录该 revision 第一次实际发送给模型的完整 prompt/schema。冷读 tool call/result 时，按相邻 `member-runtime/selected` 或请求 header 边界选择 revision 对应的 presenter。

需要补齐的生命周期：

- Runtime revision artifact 在任何 Session event、Team Member 当前配置或持久 tool presentation 仍引用时不得删除；
- 生成的 YAML/目录是 manifest 的缓存，可从 ledger 重建；
- Live Member 使用 per-Member Runtime mount；cold reader 可按 revision 使用 read-only standing mount；
- 旧 live Runtime 在 rebind 后排空即释放，不需要等 Session 结束；
- read-only standing generation 需要引用计数或受控缓存，不能每次 profile 保存都永久增加 watcher/Fiber。

若原型发现当前 presenter 只接受一个 Session-level preset scope、无法按事件边界选择 revision，应把这一限制升级为 Harness extension requirement；不要让 Client 私下猜 Tool presentation。

## 13. Host API 与状态投影建议

### 13.1 durable operations

建议使用整值 operation，避免 Plugin rows 在多个独立 patch operation 中形成半配置：

- `team/member-runtime-revised`
  - `member`：保持 `sessionId`，更新 `runtimeRevisionId`；
  - `previousRuntimeRevisionId`；
  - `runtimeRevision`：规范化 manifest 与 digest；
- 或在创建时由 `team/member-added` 携带初始 Runtime revision。

Team ledger 与 Session log 是两个持久介质，不能声称跨介质原子提交。Host 应在 `runMaintenance()` 的 admission gate 内执行可恢复的有序协议：

1. 新 Runtime 已完成 prepare/audit；
2. durable commit `team/member-runtime-revised`，确立 desired revision；
3. rebind Agent scope parent；
4. 同步向当前 Session append `member-runtime/selected`；
5. 释放 gate，允许下一 turn；
6. 下一 step 的 `request/header` 记录新 revision 第一次实际用于模型请求的完整契约。

若进程在第 2–4 步崩溃，startup 以 Team ledger 的 desired revision 重建；在 gate 释放前不会有模型请求使用未记录的 composition。Team operation 是 Member configuration authority；Session event 是执行历史的 revision boundary。不要把 Tools、Skills 和 Plugins 拆成多个可见的半配置操作。

### 13.2 process-local status

Client status 可增加：

```ts
runtime: {
  revisionId: AgentTeamRuntimeRevisionId
  state: 'active' | 'reloading' | 'error' | 'unavailable'
  diagnostic?: string
}
```

不要把 process-local Fiber ID、scope key 或 Loader Entry 对象暴露到 wire。

### 13.3 UI 示意（Phase 1：创建与编辑共用，频道选择页移除）

```text
┌─ New Agent / Edit Agent ─────────────────────────────┐
│ Identity   Model   Tools   Skills                    │
│ （频道选择页已移除；channelRefs 保留为可选 Remote 字段）│
│                                                      │
│ Tools（默认全勾 = 无限制；五个 Team tools 锁定 required）│
│ [✓] Files   [✓] Shell   [✓] Search                   │
│ [✓] Jobs    [✓] Todo    [✓] Web                      │
│                                                      │
│ Skills（默认不选 = 自动加载全部可发现的 skills）       │
│ (•) 自动 — 私有 + Workspace + 用户 roots             │
│ ( ) 仅勾选项：[✓] pdf-review [✓] deploy [ ] … [全选] │
│ [+ 上传 skill → 写入该 Member 私有 skills/ 并自动勾选]│
│                                                      │
│ Changes apply to the next turn; history is retained.│
│                                      [Cancel] [Apply]│
└──────────────────────────────────────────────────────┘
```

交互要求：

- 创建与编辑共用同一张卡片；创建流程不再有频道选择页（Member 后续加频道、DM 可达已是受支持语义）；
- Tools：静态复选列表，默认全勾；取消勾选构成 allow-list 减法；Team tools 锁定显示 required；
- Skills：默认「自动」不变（catalog 是动态的，静态全选会失真）；显式勾选 = 正向 allow-list（本期不做“排除若干个”的反向语义，提供全选按钮）；上传在显式模式下自动勾选；
- 明确提示改动从下一 turn 生效，当前 Session 历史保留；Apply 非乐观，等待 Host commit；
- Apply 走 turn 边界（lifecycle gate）；Agent 正在运行时显示等待状态，不强制切换；
- “从新上下文开始”保留为独立 Human 操作，不与能力编辑绑定；
- activation 失败保留表单和诊断，不伪装成功；required Team contract 不提供关闭开关。

## 14. 方案对比

| 方案 | 优化目标 | 代价 | 结论 |
| --- | --- | --- | --- |
| Conservative path：共享 `team-member` + 每 Agent Tool restriction + 私有 Skill provider | 最快提供不同 Tools/Skills catalog | Plugin instances 仍共享；无法满足长期独立 Plugin；cold-read overlay 需处理 | 仅作为机制验证和短期交付 |
| Clean target：Runtime Profile → immutable Revision → per-Member Runtime Instance；同 Session 原子热切换 | 边界完整、可重建、保留上下文并支持独立 Plugin 生命周期 | 需要 revision event、按边界冷回放和 composition swap seam | **目标方案** |
| Staged clean path：先 scoped Tools/Skills，随后引入独立 mount/revision，再开放任意 Plugin | 降低一次性风险，同时每阶段都朝目标收敛 | 需要明确不把第一阶段包装成最终架构 | **推荐实施路径** |

## 15. 不应采用的方案

- 不为每个 Member 创建新的 Cordis root 或复制 Host services。
- 不创建第二套 Tools/Skills registry。
- 不把 `isolate` 当进程、文件或权限沙箱。
- 不把一个 mutable `presetId` 当成可回放的 Runtime revision。
- 不在 Agent running、Plugin 活资源未排空、或新 Runtime 未完成 audit 时 rebind scope parent。
- 不只改 scope parent 而不追加 Runtime revision event；否则冷回放无法知道能力何时变化。
- 不依赖普通 HMR 提供 Member-targeted module reload。
- 不在 ledger 中保存 API key、token 或任意 Plugin secret。
- 不增加 compatibility layer 同时维护旧 `presetId` 和新 Runtime authority；项目尚未发布稳定 Runtime contract，应一次迁移内部调用与数据格式。
- 不先设计复杂 Marketplace、依赖求解器或远程 Plugin 安装；当前第一个问题是单机、已安装 Plugin 的作用域和生命周期。

## 16. 分阶段实施建议

### Phase 0 — 本期机制原型（已并入 Phase 1，2026-09-02）

“Host restart 后从持久配置恢复”要求 capabilities 先持久化，纯机制原型绕不开 ledger/Remote schema，因此原型不再独立存在；其机制验证点成为 Phase 1 的测试核心（见下）。

### Phase 1 — 本期 Member-scoped Tools / Skills（当前实施范围，拆分见 `issues/`）

- 持久 Member capabilities schema（Member 实体可选字段，经全部 lifecycle operation 流转）与 Remote 携带（addMember / 编辑）；
- Tools 减法：activation `tools.restrict()`（∪ 五个 Team tools）+ disposer 保留 + 编辑时 turn 边界活更新；
- Tools 加法接缝：per-member `agentCtx.plugin()` mount 机制验证（至少一个 Team 已知可选 tool 的真实挂载）；
- Skills：共享 preset row 移除；per-Member wrapper provider + selection ref + 私有 `skills/` 目录 provisioning + member-context 路径行 + 上传 Remote（净化写入）；
- 创建/编辑卡片 UI：Tools/Skills 区、频道选择页移除、非乐观 apply 与“下一轮生效”文案；browser 测试与截图检查；
- 机制测试：两个 Member 不同 allow-list 与 catalog、suspend/resume 隔离、失败只阻断目标 Member、Host restart 恢复、普通 DSH Session 不可见、活更新后 `request/header` 与 replacement catalog 变化；
- 配置在 Member create / resume / Host restore 时生效；未知名 drop + warning；
- 暂不开放任意 Plugin rows 与 provider roots 配置 UI。

### Phase 2 — Runtime Revision（暂缓）

- 新 branded revision id 和 ledger operation；
- 规范化 immutable manifest；
- generated revision artifact / cold-read resolver；
- Member update 在同 Session 原子绑定 revision，并追加 runtime selection event；
- 下一 step 的 `request/header` 证明新 prompt/schema 生效；
- UI Runtime state、等待安全边界和失败诊断；
- revision retention / GC。

### Phase 3 — Arbitrary installed Plugins（暂缓）

- composition authoring / copy workflow；
- JSON-safe config 与 secret refs；
- service leak audit、required Team contract、dependency diagnostics；
- version/integrity pinning；
- Human approval；
- Member-targeted config apply。

### Phase 4 — Harness seam（暂缓，仅在未来原型证明需要时）

可能的公共能力是“按 instance key 挂载一个 immutable Agent composition，并返回 owned handle/read scope”，而不是 Agent Team 特例：

```ts
interface AgentCompositionHandle {
  readonly key: ScopeKey
  readonly sourceId: string
  dispose(): Promise<void>
}

instantiate(source: AgentPreset, options: {
  owner: Context
  instanceKey: ScopeKey
}): Promise<AgentCompositionHandle>
```

该 seam 应继续复用 Tool/Skill scoped registries和 mount audit。只有 Team 原型确实无法安全处理 ownership/cold read/ref counting 时，才提交 Harness 设计。

## 17. First Proof Point

本期最小证明是一个真实 composition test：同一 Host、同一共享 `team-member` preset 下创建两个 Member，用 exact-scope restriction 和 per-Member skill provider 让两边的 Tool schemas、可执行 Tools 与 Skill catalogs 不同；suspend / resume 其中一个后恢复相同能力，另一个始终不变。

该证明不涉及 `createScope + mountPreset + bindScopeParent` 的独立 Plugin composition，也不验证热重载。

## 18. Falsifier

以下任一事实会推翻或显著修改目标方案：

1. Public AgentPreset API 无法让 per-Member mount 同时保持 `composedPreset()`、`serviceFor()`、cold transcript presentation 和完整 teardown；
2. 主要 Tool/Skill plugins 假设每 preset 单例，多个 isolated Fiber 会产生不可修复的模块级共享状态或资源冲突；
3. DSH 的 request reconstruction 或冷回放无法用 revision event + `request/header` 正确表达同一 Session 的 composition 变化；
4. revision artifact 无法在不建立第二份 authority 的前提下重建；
5. per-Member watchers/Fibers 的资源成本在预期 Member 数量下不可接受，且共享实例无法通过显式 per-Agent state 达到同等隔离。

若第 1 项成立，应先设计 Harness composition-instance seam；若第 2 或第 5 项成立，应按 Plugin 类型允许“共享但按 Agent key 隔离”，但必须在 manifest 中明确声明，不能继续默认共享所有 Plugin。
