# Member Runtime 源码调查

状态：2026-08-31 已核对当前 `dsh-agent-team` 与相邻 `deepseek-harness` 源码；本文只记录调查事实，不定义当前产品行为。

## 1. 调查问题

本文回答四个问题：

1. 当前 Team Member 已经在哪些层面是一等实体？
2. 当前 `team-member` preset 是否为每个 Member 创建独立 Plugin composition？
3. DSH 现有 scope、Tools、Skills、Agent、Session、Loader 和 HMR 能提供哪些隔离与重载能力？
4. 哪些能力可以直接复用，哪些能力仍缺少正式边界？

## 2. 当前对象与生命周期

当前关系如下：

```text
Team ledger
  └─ AgentTeamAgentMember
       ├─ memberId                 稳定 Team 身份
       ├─ workspaceId              稳定 Workspace 绑定
       ├─ sessionId                当前 Session / Agent 身份
       ├─ presetId                 激活时选择的 Agent preset
       ├─ model?                   Member 模型选择
       ├─ privateMemoryPath         Host 私有路径
       └─ state                    enabled / suspended / inactive

AgentTeam Host
  └─ handles[memberId] → AgentHandle
                          └─ Agent
                              ├─ Session
                              ├─ Agent.ctx / Agent scope
                              ├─ Inbox
                              └─ model selection ref
```

证据：

- `packages/agent-team/src/types.ts` 的 `AgentTeamAgentMember` 持久保存上述字段。
- `packages/agent-team/src/index.ts` 的 `addMember()` 先提交 Member，再调用 `activateMember()`。
- `activateMember()` 通过 `ctx.agents.create()` / `resume()` 创建 Agent，在 unpublished `setup(agentCtx)` 中挂载 preset、校验五个 Team tools、安装 Member model selection，完成后才发布 Agent。
- `suspendMember()`、`resumeMember()`、`removeMember()`、`clearMemberContext()` 均由 Team Host 串行管理 AgentHandle 和 Session。
- `packages/agent-team/tests/member-lifecycle.spec.ts` 使用真实 AgentLoop、Session、AgentPresets、Tools 和持久化后端验证创建、暂停、恢复、移除、Session renewal 和 composition 丢失恢复。

结论：Member 已经是 Team 领域和 Agent 生命周期的一等实体；它不是普通 Session 上的临时标签。

## 3. 当前 `team-member` preset 的真实含义

### 3.1 它是正式 AgentPreset，但属于 Team 私有 roster

`cordis.patch.yml` 在 `wowyuarm-agent-team-scope` group 中对 `agentPresets` 做 service isolation，并同时挂载：

- `@wowyuarm/dsh-agent-team/preset-roster`
- `@wowyuarm/dsh-agent-team/host`

`packages/agent-team/src/preset-roster.ts` 在这个隔离 realm 中创建一个 `AgentPresets` service，只扫描包内 `packages/agent-team/preset/`，默认 preset 为 `team-member`，不包含普通用户 preset root。

因此：

- `team-member` 使用 DSH 正式的 AgentPreset 发现、挂载和 scope 机制。
- 它不是普通 DSH Session roster 中供用户选择的 preset。
- `agentPresets` 的 bundle 级 isolation 只把 Team roster 与普通 roster 分开，并没有为每个 Member 再创建一份 roster。

### 3.2 同一 preset 的 Plugin 实例由所有 Member 共享

相邻 Harness 的 `packages/preset/agent-presets/src/index.ts` 明确采用 standing composition：

```text
Agent scope key → preset standing scope key → global
```

`AgentPresets.ensureStanding()` 对一个 preset id 只挂载一次 composition；`mount()` 只是把 Agent scope 的 parent 绑定到 standing scope。`packages/preset/agent-presets/tests/mount.spec.ts` 明确验证：

- 两个 Session 使用同一 preset 不会重复挂载；
- 两个 Agent 通过 `serviceFor()` 读取同一个 isolated service 实例；
- Session 隔离依赖 Plugin 自己按 Agent/Session key 管理状态，而不是依赖每 Session 一个 Plugin 实例。

因此当前多个 Team Member 的关系是：

```text
Member A Agent ─┐
                ├─→ shared team-member standing composition
Member B Agent ─┘      ├─ shared tool Plugin fibers
                       ├─ shared skill provider Plugin fiber
                       ├─ shared prompt/listener fibers
                       └─ shared isolated services in that preset generation
```

`team-member` 目前是“共享的 Member 基础运行环境”，不是“一个 Member 的独立 Plugin 容器”。

### 3.3 composition 文件变化不会更新正在运行的 Member

`AgentPresets.ensureStanding()` 记录 `agent.cordis.yml` 的 mtime/size。文件变化后，后续 Session 会创建新的 standing generation，已加入旧 generation 的 Session 继续使用旧实例。源码和 `mount.spec.ts` 的 “editing a composition file” 用例均验证这一点。

这提供了“新 Session 使用新 generation”，不提供“正在运行的 Member 自动切换 generation”。

## 4. Agent 本身已经具备独立 scope 和 Fiber 生命周期

相邻 Harness 的 `packages/core/agent-loop/src/agent.ts` 中，`ReactLoopAgent` 构造时执行：

- `createScope(loopCtx, this)`：以 Agent 对象作为 scope key；
- `this.ctx = this.scope.ctx.extend({ agent: this })`：建立 Agent-scoped Context。

`packages/core/agent-loop/src/index.ts` 的 creation transaction 保证：

1. 私下创建 Session、Agent 和 Agent scope；
2. 等待 `setup(agentCtx)` 完成；
3. setup 失败时回滚，不发布 Session 或 Agent；
4. 发布后由 `AgentHandle.dispose()` 执行停止、排空、scope unwind、Agent/Session detach。

因此每个 Member 已经有可靠的 scoped registration owner。通过 `agentCtx` 注册的 Tool、Skill provider、prompt section、event listener 或 child Plugin 都可以随该 Member Agent 卸载。

当前 Team activation 只在该 setup 中调用 `agentPresets.mount()`，没有安装 Member-specific overlay。

## 5. Tools 隔离能力

`packages/core/tools/src/index.ts` 的 `ToolRuntime` 使用 `ScopedLayers`：

- Host Context 注册到 global layer；
- preset standing Context 注册到 preset layer；
- `agent.ctx` 注册到该 Agent 的 exact layer；
- 读取按 `Agent → preset → global` 合并，近层同名 Tool 覆盖远层；
- `restrict()` 可在某个 scope 过滤其继承的 Tool；
- `guard()`、`tools/*` listeners 和执行解析同样按 Agent scope 分发；
- scope disposal 会删除 exact-layer 注册。

`packages/core/tools/tests/scoped.spec.ts` 已验证：

- 一个 Agent 的 scoped Tool 对其他 Agent 不可见、不可执行；
- scoped Tool 可覆盖 global Tool；
- `restrict()` 只影响目标 scope；
- scope dispose 后没有残留；
- restriction 也能过滤从 preset ancestor 继承的 Tool。

因此，Member 级 Tool **可见性和执行隔离**不需要第二个 `ToolRuntime`。可直接使用现有 Agent scope。

需要区分四种隔离：

| 层面 | 当前 DSH 能力 | 当前 Team 是否使用 |
| --- | --- | --- |
| Tool schema 可见性 | Agent scope / restriction | 仅使用共享 preset surface |
| Tool 执行解析 | 与 schema 使用同一 scoped resolver | 是，但没有 Member 差异 |
| Tool policy/listener | scoped event 与 guard | 可用，尚无 Member 配置 |
| Tool Plugin 实例状态 | 取决于 Plugin 挂载位置 | 当前同 preset 的 Member 共享实例 |

只加 `restrict()` 能隐藏和阻止 Tool，但不会自动移除该 Plugin 注册的其他 prompt/listener，也不会把共享 Plugin 内部状态变为 Member 私有。严格的 Plugin 实例隔离仍需要按 Member 挂载 Plugin Fiber。

## 6. Skills 隔离能力

`packages/skill/skill/src/index.ts` 的 `SkillRegistry` 也使用 `ScopedLayers`：

- Skill provider 和 runtime skill 可注册到 global、preset 或 Agent exact layer；
- 查询接收 `scope` 和 `cwd`；
- 近层同名 Skill 覆盖远层；
- provider 缓存 key 包含完整 scope chain；
- provider disposal 会失效缓存并撤销目录。

`packages/skill/tool-skill/src/index.ts` 在每个 step 中使用调用 Agent 作为 scope，并将完整 replacement catalog 作为 durable `skill-catalog` message 写入 Session。Skill catalog 变化属于 DSH 已设计的原会话动态更新路径。

当前 `packages/agent-team/preset/team-member/agent.cordis.yml` 在共享 standing preset 中挂载一份 `dsh-skill-filesystem`。它默认按 Member Session 的 cwd 查项目 roots，也读取用户 roots。因此：

- 不同 Workspace 的 Member 会因 cwd 不同看到不同 project skills；
- 同一 Workspace、同一 preset 的 Member 默认使用同一个 provider 实例和同一组配置；
- 当前没有 Member 私有 Skills root，也没有 Member-specific provider 配置；
- SkillRegistry 当前没有与 `tools.restrict()` 对等的 catalog allow/deny API。Agent exact layer新增 provider只能覆盖同名 Skill，不能整体屏蔽 ancestor provider 的其他 Skill。

要实现严格 Member Skills 隔离，不能只在当前共享 provider 上增加一个私有目录。可行路径是：

1. 从共享 `team-member` composition 中移除默认 filesystem provider；
2. 在每个 Member scope 或每个 Member 独有 preset generation 中挂载 provider；
3. provider 明确列出该 Member 可见的 private/shared roots；
4. 保留共享 `SkillRegistry` 和 `skill` consumer，不复制服务。

## 7. Plugin service isolation 的边界

Cordis 的 Plugin Fiber 是一个 Plugin application instance，拥有 config、dependencies、effects 和 disposer。Loader 的 `isolate` 为 service name 创建独立 symbol realm。

相邻 Harness 的 `packages/preset/agent-presets/src/mount.ts` 会拒绝 preset 中向 root realm 发布 service 的 row；preset service 必须：

- 放在 `isolate` realm 中；或
- 移到 Host composition。

但 `isolate` 只隔离 service resolution，不是安全沙箱，也不自动隔离文件、网络、进程、全局变量或模块单例。一个用户 Plugin 与 shell access 同等可信。Plugin 内部若使用模块级可变状态，即使有多个 Fiber，也可能继续跨 Member 共享。

当前同一 `team-member` standing generation 中的 isolated service 仍由所有使用该 generation 的 Member 共享。若要求 service instance 也按 Member 分开，必须让每个 Member 使用不同的 composition instance。

## 8. 哪些服务应继续属于 Host

以下能力当前是 Host plane 或请求时按 Agent/Session 解析，不应为了 Member 隔离而复制：

- `ctx.agents`、`ctx.sessions`、Session persistence；
- `ctx.tools`、`ctx.skills` registry；
- `ctx.llm` adapter registry；
- Workspace registry；
- filesystem、shell、subprocess、sandbox provider；
- Web provider；
- Team Host 和 Team ledger。

当前 per-Member model selection 已通过 `installModelSelection(agentCtx, ref)` 安装在 Agent scope；`updateMember()` 可原地修改 ref。LLM adapter/provider route 仍为 Host registry。Member 可选择不同 route，不等于每个 Member 加载一份 adapter Plugin。

Sandbox policy 从 Session log 和 Session cwd 按调用解析；共享 provider 不等于共享权限状态。

## 9. Loader 与 HMR 的实际语义

### 9.1 配置树更新

`vendor/include/src/index.ts` 的 `Include.refresh()` 串行读取配置并调用 `EntryGroup.update()`。`vendor/loader/src/config/group.ts` 对新增、修改和删除 rows 做批量更新，失败时尝试恢复旧 rows。

`vendor/loader/src/config/entry.ts` 的更新语义包括：

- 仅 config 变化：调用 Fiber update/restart，失败时恢复旧 config；
- name/inject/group 变化：先 dispose 旧 Fiber，再启动新 Plugin，失败时重启旧 Plugin；
- disable：dispose；
- rollback 也失败时抛出聚合错误。

这可以支持一个独有 composition tree 的配置重载，但重载期间不保证任意外部读者都看不到短暂卸载状态。调用方仍需在 Agent idle boundary 串行化，并对失败状态负责。

### 9.2 模块源码 HMR

`vendor/hmr/src/index.ts` 按 Plugin callback/runtime 处理模块变化。一个 Plugin runtime 的 `fibers` 会整体被删除并用新模块重新创建。因此，同一模块在多个 Member 下的多个 Fiber 仍属于同一个源码 HMR 单元。

结论：

- Member 独有配置文件或 composition tree 可以只重载一个 Member；
- 修改大家共同引用的 Plugin 模块源码，会影响该模块的所有 Fiber，不是 Member-targeted reload；
- 若要让不同 Member 同时运行不同 Plugin 代码版本，需要不同的版本化 module specifier/artifact，而不是依赖普通 HMR。

### 9.3 当前 Team 已出现的 reload 故障

当 bundle row reload 导致 Team preset roster subtree 被销毁时，旧 Agent 的 scope parent 仍指向已销毁的 standing key。`agentPresets.composedPreset()` 和 `serviceFor()` 随后返回 `undefined`，Tools 也消失。

当前 `packages/agent-team/src/index.ts` 已：

- 在 `memberStatus()` 中识别 orphaned composition；
- 在 `recoverMember()` 和 auto-compaction 路径中重新激活 Member；
- 通过 `member-lifecycle.spec.ts` 覆盖恢复。

这证明“Member lifecycle owner 必须同时拥有 composition generation”是实际需求，不是推测。

## 10. Session 与运行时契约

每次模型请求的 provider/model、system prompt 和 Tool schemas 都会写入 Session `request/header`。因此运行时变化后，下一次请求可以记录新的 header。

DSH 自带的 AgentPreset 产品入口把 `recompose()` 限制在 blank Session，避免普通产品流程任意切换整套 preset；该限制由调用方检查，`recompose()` 本身不读取 Session history。这是 AgentPreset 产品策略，不是 AgentLoop 或 Session 的机械限制。

AgentLoop 在每个 step 重新组装 system prompt 和 Tool schemas；变化后的完整请求契约会作为新的 `request/header` 写入同一 Session。Skill provider/catalog 也已支持动态变化，并用 durable replacement catalog 保持模型历史诚实。因此从 Session 重建角度，Tools、prompt 和 Plugin graph 都可以在同一 Session 内切换，只要切换由专门的 Runtime lifecycle 管理并记录 revision，而不是直接复用普通 preset picker。

需要区分两种“兼容”：

- **历史可重建**：旧 tool call/result 留在历史中；每次请求的 `request/header` 记录当时生效的 prompt 和 schemas。DSH 已提供这一基础。
- **Plugin 活状态可迁移**：jobs、terminal、watcher、缓存或 Plugin 私有内存能否跨 Fiber replacement 保留。这不是 Session 能自动解决的，需要 Plugin 声明 reload contract，或由 runtime 等待排空后重建。

因此不能把所有 Plugin reload 都视为同一种操作：

- Skill catalog/body、Member memory、model route 已有原会话动态更新协议；
- Tool schema、prompt 和无外部活状态的 Plugin graph 可在 Agent idle boundary 切换 Runtime revision，并让下一 step 记录新 header；
- 持有运行中 jobs/terminal/外部资源的 Plugin 必须先达到 quiescence，或显式拒绝热切换；只有 Human 主动清空上下文或 Plugin 合同明确要求时才创建新 Session。

## 11. 一等实体判断

| 层面 | 当前状态 | 判断 |
| --- | --- | --- |
| Team 领域身份 | ledger 中有稳定 `memberId` 和完整 lifecycle operations | 一等实体 |
| Agent 生命周期 | Host 持有 AgentHandle，负责 create/resume/suspend/remove/recover | 一等实体 |
| Session 与 Workspace | Member 持久绑定且由 Host恢复 | 一等实体 |
| Model selection | Member 可独立覆盖并原地更新 | 一等配置 |
| private memory/notes | Member 私有路径，Host 管生命周期 | 一等资源边界 |
| Agent preset | 正式 DSH preset，但所有 Member 默认共享同一 standing composition | 一等 preset，不是 Member runtime |
| Tools/Skills 配置 | 由共享 preset 固定，没有 Member durable spec | 缺失 |
| Plugin composition generation | 没有 Member-owned durable revision/effective status | 缺失 |
| Member-targeted reload | 只能 dispose/resume 整个 Agent；普通 HMR按模块影响所有 Fiber | 部分具备 |

## 12. 调查结论

当前架构不需要“把 Member 变成 Agent”或“给 Member 再造一个 Cordis”。Member 已经稳定拥有 Agent、Session、Workspace 和 Agent scope。

真正缺少的是一个 Team-owned、可持久配置、可重建的 **Member Runtime Generation**：它把一个稳定 Member 与一次明确的 AgentPreset/Plugin composition 绑定，并让 Host 能区分 desired configuration、当前生效 generation 和 activation/reload failure。
