# 上游差异与兼容性评估：dsh-v0.1.2-rc.1 → dsh-v0.1.5-rc.1

> 只读差异评估（2026-09-10）。基线：`dsh-v0.1.2-rc.1`（Team 认证基线，CI `DSH_HARNESS_TAG` 同值）。候选：`dsh-v0.1.5-rc.1`。本文件只记录证据与分类，未做隔离认证；凡未经 build/boot 验证的推断一律标「待隔离认证」。
>
> 分类口径：**无关**＝上游变了但 Team 不消费；**需回归**＝消费面存在但未证实断裂，需在认证梯中验证；**疑似断裂**＝有类型/结构性证据指向断裂但未实跑；**确认断裂**＝上游接口移除/签名变化且 Team 调用点直接踩中。

---

## 1. 版本事实

| 项 | 证据 |
|---|---|
| 候选 tag | `dsh-v0.1.5-rc.1`（GitHub Release，2026-09-10 03:09 UTC，prerelease，作者 imccyu） |
| npm dist-tags | `latest` 与 `next` 均已指向 `0.1.5-rc.1`（npm publish 03:12 UTC）——**上游移动了，安装面会真实触发，不能拖延** |
| 相对基线 | ahead 1486 commits；完整仓库 `git diff` 为 6766 文件、+208222/−58150，其中 `packages/` 为 2635 文件、+133490/−32968 |
| 新增上游包 | `session-format`/`session-format-v0-to-v1`/`v1-to-v2`/`v2-to-v3`/`session-format-catalog`、`client/ui-sidebar-documentpreview`、`ui-sidebar-files`、`ui-sidebar-right`、`host/open-in-app`、`experimental/agent-team*`（见 §8） |
| 发布说明要点 | Session V3 格式；生命周期持有 `SessionHandle`、`agentLoop.create()` 异步化、session 锁；插件 Agent API 移除 `ctx.agent`；Inbox API 改为类型接口；Web 面板 API（原 `conversation` Slot 迁移为 `main` 的 `conversation` key）；实验性 Agent Teams 可从 npm 安装；`send_message` 统一 steer 语义；pi-ai 0.85.1；persona 前后缀拆分 |
| Team 当前 peers | `package.json:133+` 全部 dsh peer 为 `>=0.1.2-rc.1 <0.2.0`；`packages/agent-team/tests/shipping.spec.ts:86` 断言所有 dsh peer 区间单一一致 |
| **semver 不匹配（已实测）** | semver@6.3.1：`satisfies('0.1.5-rc.1', '>=0.1.2-rc.1 <0.2.0')` = **false**（`includePrerelease: true` 才为 true）。npm 默认规则下 prerelease 只匹配含同 `[major,minor,patch]` 元组的比较器；该 range 内无 `(0,1,5)` 元组。与 `.scratch/archive/2026-09/dsh-adaptation-playbook` 记录的「prerelease 只对同一 base 版本放开，跨版本线是硬抬」一致 |

结论：`0.1.5-rc.1` 落在现有 peers 之外，属于**硬切换候选**；任何「安装成功」都不是兼容证据（上轮实测教训），必须检查依赖图是否混代并真实启动。

---

## 2. Host / Agent

### 确认断裂 #1：`ctx.agent` 移除 → Team Member 激活的 setup commit 必炸

- **上游**：`packages/core/agent/src/index.ts` @ `dsh-v0.1.5-rc.1`
  - `Context` 接口删除 `agent?: Agent` 字段（index.ts diff：`-agent?: Agent` 段整体移除）；
  - 删除 `ctx.accessor('agent', { get: () => undefined })` 注册（原保证普通 ctx 上 `ctx.agent` 干净读 undefined；`Agent.ctx` 以 own property 遮蔽）；
  - `AgentSetup` 签名改为 `(agentCtx: Context, agent: Agent) => AgentSetupCommit | ...` —— **Agent 改为显式第二参数传入**；
  - `CreateAgentOptions`/`ResumeAgentOptions` 新增 `parentAgent?: Agent`。
- **Team 调用点**：`packages/agent-team/src/index.ts:2074` `const setup = async (agentCtx: Context) => {...}`，`commit` 在 2117 行读 `const agent = agentCtx.agent`，随后在 2118 行对缺失 Agent 抛错；该 setup 经 `this.ctx.agents.create/resume({ ..., setup })`（2160–2175 行）进入。
- **分类**：**确认断裂**（运行时）。0.1.5 下 `agentCtx.agent` 不再存在：读取走 Cordis context proxy（可能 unknown-property 抛错），即便返回 undefined，commit 也必然抛 `agent-team setup has no unpublished Agent` → 每个 Member 激活失败。类型面在 0.1.5 下同样报错（`agentCtx.agent` 属性不存在）。
- **修复方向（供认证期参考）**：`setup: async (agentCtx, agent) => ...`，commit 闭包捕获第二参数 `agent`；与上游 0.1.5 的 AgentSetup 契约对齐。

### 其余 Agent 消费面：签名仍可对上，需回归

| 符号 | 0.1.5 状态 | Team 使用 | 分类 |
|---|---|---|---|
| `installModelSelection(agentCtx, selection)` | 仍在 `model-selection.ts` 导出，双参签名不变 | `index.ts:2080` | 需回归（行为扩展：新增 `agent/pre-step` prepend 监听器、模型切换 notice 追加——Team 自身也注册 `agent/pre-step`，监听器顺序/语义需在认证中观察） |
| `agentEvents` | 仍在 `dispatch.ts` 导出 | 导入于 Team src | 需回归 |
| 事件名 `agent/turn-stopping`、`agent/pre-step`、`agent/request-error` | 均在 `runtime-types.ts`（0.1.5） | Team setup 内 `agentCtx.on(...)` 三个 handler | 需回归（`agent/pre-step` payload 新增 `step` 字段，Team 解构 `{agent, messages, signal}` 不冲突） |
| `PreStepDecision`、`AgentHandle`、`ModelSelectionRef` | 仍在 | 类型导入 | 需回归 |
| `ctx.agents.create/resume` | 服务仍在，选项新增 `parentAgent`（可选） | `index.ts:2160–2175` | 需回归（不传 `parentAgent` 属合法用法，但上游新增「子代理归属」语义，Team 的成员会话是否应传父级属产品决策，认证中确认） |
| `dsh-agent-loop` 默认导出 `AgentLoop` | 仍在，config `agents: z.array(...)` 不变 | 仅测试：`member-skills/member-tool-policy/member-lifecycle.spec.ts` `ctx.plugin(AgentLoop, { agents: [] })` | 需回归（`create()` 异步化、session 锁新增——Team 生产代码不直接实例化 AgentLoop，走 `ctx.agents`） |

---

## 3. Session / 持久化

- **上游（0.1.5）**：
  - 格式 V3：`packages/core/session/src/types.ts:88` `SESSION_FORMAT_VERSION = 3`；发布说明明确「升级后的会话不支持降级读取」，旧日志经 `session-format-v2-to-v3` 迁移。
  - `dsh-session` 删除 `chunk-rows.ts`（`decodeStorageRecord`、`packChunkRuns`、`ChunkRow`、`StorageRecord` 出口移除，−375 行）；`adoptSessionEvent` 校验收紧（`validateSessionEventData` + `validateSurfaceMetadata`，seed/event 信封校验更严）。
  - `dsh-session-persistence` 重构为 SessionHandle 生命周期 API：`create/open` 返回 `SessionHandle`，新增 `SessionAlreadyOwnedError`/`SessionOwnershipLostError`/`SessionHandleClosedError` 等；同一 session 至多被一个进程持有（session 锁）。
  - `dsh-session-projection`：`ProjectionDefinition` 接口（key/stateSchema/init/apply/wire）**逐字段不变**（两 tag 对比一致）。
- **Team 生产消费面（很薄）**：
  - `dsh-session`：仅类型/品牌导入 `SessionId`、`SessionLogOffset`、`SessionSeq`、`SessionEvent` —— 0.1.5 `types.ts` 全部仍导出（已逐一核对），**签名面无断裂**；
  - `dsh-session-persistence`：仅 `index.ts:19` `import type {} from '@deepseek-ai/dsh-session-persistence'`（模块增强/类型注入，不实例化）；
  - `dsh-session-projection`：`context-projection.ts:26/268/325` `ProjectionDefinition` + `declare module '@deepseek-ai/dsh-session-projection/types'` —— 0.1.5 该子路径与接口仍在。
- **Team 测试消费面**：`JsonlSessionPersistence`、`SessionProjectionRegistry`、`SessionTitle`（member-*.spec.ts）直接依赖 persistence/projection 运行时 —— 这些是 0.1.5 大改区。
- **分类**：生产代码**需回归**（薄消费面 + 校验收紧），测试基建**需回归**（直接依赖 SessionHandle 时代 API 的 backend）。**疑似断裂**：暂无——Team 不直接调用 `create/open`/`SessionHandle`，但 `ctx.agents.create/resume` 底层走新 persistence，是否触发锁/校验差异只能靠隔离认证。Team 自有 SQLite ledger 域（`storage-domain` 路由 `agent_team: sqlite`）不受 Session 格式 V3 影响，但 `cordis.patch.yml` 的 storage-domain 覆盖行「跟随上游行键」——`packages/storage` 有 22 文件变更，**patch 维护需回归**。

---

## 4. Inbox

- **上游（0.1.5）**：`packages/core/agent/src/inbox.ts` 整体删除（−220 行）；`Inbox` 改为类型接口，不再导出可构造运行时类；插件经 `agent.inbox` 读写待处理消息；`hasPending`/`claim` 不再是公共接口。
- **Team**：`ledger.ts:43–46` 的 `AgentTeamInbox`/`AgentTeamInboxRequest`/`AgentTeamInboxDelta`/`AgentTeamInboxItem` 是 **Team 自有 ledger 投影**（channel/member inbox 派生自 ledger facts，grep 全仓 inbox 命中均为 Team 域概念），**不消费上游 `Inbox` 类**。
- **分类**：**无关**（直接调用面）。注意两点边界，不混淆：
  - 上游 `agent.inbox` 语义（待处理消息读写）与 Team inbox 概念重叠，但 Team 从未经 `agent.inbox` 读写；
  - `#13` Channel 归档重启失败是 Team 自有 ledger 投影的收集范围 bug（taskless Thread 漏收集），**不是**本上游变更引起，但 0.1.5 认证梯应顺带重跑 channel 归档用例验证投影在新 persistence 上行为不变。

---

## 5. Remote / Typert

- **上游（0.1.5）**：`packages/typert` 19 文件变更（+397/−158）：
  - `protocol/src/index.ts` 仅删 2 个 type 出口：`TypertContextAdapter`、`TypertHostContextIdentity`（`types.ts` 合并为 host-only 的 `TypertHostContextAdapter`，`identifyHost` 从 registry 接口移除）；
  - `Remote` 装饰器、`TypertRemoteService` 抽象类、`bindTypertRemote` **仍在且签名未变**（已核对 0.1.5 index.ts:141/153/174–189）；
  - `generator/src/analyzer.ts` +198 行、`registry/src/service.ts` −17 行 —— 生成器行为有实质变化。
- **Team**：`index.ts` 导入 `Remote, TypertRemoteService` from `@deepseek-ai/dsh-typert-protocol`（13 处导入）；`scripts/generate-typert.mjs` 每次 test/build 前**重新生成** `lib/typert.remote-client.*`；`packages/agent-team/tests/typert-generation.spec.ts` 校验生成物。
- **分类**：**需回归**。符号面（`Remote`/`TypertRemoteService`）无断裂；但生成器 analyzer 变更可能改变生成产物形态，必须跑 `npm run generate:typert` + typert-generation spec + shipping spec 验证。另：`dsh-api-remotes`/`dsh-api-session-controller`/`dsh-api-workspace-controller` 所在 `packages/api` 共 114 文件变更（Team 的 `remote.session`/`remote.agentTeam` 契约与 `client.inject` 列表依赖这些包）——**本轮未逐项核对 api 包 client/host 接口，标「待隔离认证」**。

---

## 6. Web slots / panels

### 确认断裂 #2：根级 `conversation` Slot 移除 → Team conversation 座位无法挂载

- **0.1.2**：`packages/client/ui-layout/src/client/index.ts:65` SlotMap 声明 `'conversation': { kind: 'single'; scope: 'session-maybe'; owner: ConvOwnerProps }`（index.ts:128 注册同键）；`AppFrame.tsx:205` `<CenterColumn>{renderSlot('conversation', {})}</CenterColumn>` —— 根级单槽。
- **0.1.5**：`ui-layout` SlotMap 仅 `'sidebar' | 'main' | 'rightbar' | 'shell.overlay'`，其中 `'main': { kind: 'keyed'; scope: 'root' }`；`AppFrame.tsx:42` `renderSlot('main', {}, { entryKey: panelId ?? 'conversation' })` —— **根级 `conversation` 槽不存在了**，「conversation」退化为 `main` keyed 槽内的一个 panel key。
- **Team**：`packages/client-agent-team/src/client/index.ts` `registerModeShadow` 的槽名联合类型 `'sidebar.workspaces' | 'conversation' | 'sidebar.settings'`；对 `ctx.slots.inject('conversation', ...)` 且 reconcile 内 `ctx.slots.register({ name: 'conversation', priority: -100, ... })`。
- **0.1.5 的 `slots.inject` 契约**：`packages/client/ui-renderer/src/client/registry.ts:172` `inject(key: keyof SlotMap & string, callback)` —— key 必须 ∈ SlotMap；`conversation` 不在 0.1.5 SlotMap，故注入永不配对任何声明，Team conversation shell 不会渲染；类型面（`keyof SlotMap`）在 0.1.5 下同样报错。register 对未知 key 的具体行为（静默丢弃或抛错）**待隔离认证**。
- **分类**：**确认断裂**（结构证据充分：槽声明删除 + inject 契约收窄；实跑表现待认证确认是静默不渲染还是抛错）。
- **边界**：`'sidebar.workspaces'` 与 `'sidebar.settings'` 两个键在 0.1.5 `ui-sidebar/src/client/contract/slots.ts:39/45` **仍存在**（`sidebar.panellist` 为新增 list 槽），但 `ui-sidebar` 全包 71 文件变更（SidebarRoot、panel-list、contract）→ Team 的 sidebar 两个座位需回归。Team 对 `dsh-client-ui-conversation` 仅 `import type {}`（模块增强），无直接组件消费。

---

## 7. preset / tools

- **`dsh-agent-presets`**：`mount(agentCtx, id?)` 0.1.5 签名不变（`packages/preset/agent-presets/src/index.ts:414`）；Team 调用 `this.ctx.agentPresets.mount(agentCtx, member.presetId)`（index.ts:2078）→ **符号面无断裂**，需回归（预设组合/`includeShippedRoot` 行为若受 0.1.5 影响）。
- **默认工具调整（发布说明）**：SDK/Headless/ACP 默认 read/write/edit；Web `minimal`/`sdk-minimal` 仅持久 shell，`str_replace_editor` 需显式启用。Team 的 team-member preset 自带工具清单（`preset-roster`、member-runtime tool policy）——是否继承上游新默认值决定影响面，**需回归**；Team 预设若显式列全工具则应为无关。
- **`dsh-tools`**：Team 7 处导入（工具 API 类型/注册面），`packages/core/tools` 在 diff 内，本轮未逐符号核对 → **待隔离认证**。
- **`cordis.patch.yml`**：`storage-domain` 覆盖行须跟随上游行键（patch 内注释自述），`packages/storage` 22 文件变更 → **需回归**（boot sweep 校验）。

---

## 8. 官方 experimental Agent Teams（0.1.5 新增）

- **上游新增包**（均 0.1.5-rc.1）：`@deepseek-ai/dsh-experimental-agent-team`、`@deepseek-ai/dsh-experimental-tool-agent-team`、`@deepseek-ai/dsh-experimental-client-ui-agent-team`、`@deepseek-ai/dsh-experimental-agent-team-profile`、`@deepseek-ai/dsh-experimental-agent-team-web-profile`（src 含 mailbox/persisted/projection/roster/task-board）。
- **与 Team 关系**：
  - **无包名冲突**（`@deepseek-ai/dsh-experimental-*` vs `@wowyuarm/dsh-agent-team`）；
  - 官方 profile 需用户**显式添加**，不默认启用 —— 默认场景下与 Team bundle **无关**；
  - 若同一 harness 同时启用官方 agent-team profile 与 Team bundle：两者都实现 Team 概念（工具、面板、持久化），存在 `send_message` 类工具/槽位/scope 冲突可能 → **需隔离认证**（`isolate.agentPresets` 只隔离 preset，不隔离其他插件面）。
- 发布说明「Agent Team 的 `send_message` 统一采用 steer 语义」指**上游**实验包，不影响 Team bundle 自身工具语义。

---

## 9. 风险排序

| # | 风险 | 分类 | 依据 |
|---|---|---|---|
| 1 | **Member 激活 setup commit 读 `agentCtx.agent`** → 每个成员会话激活失败 | 确认断裂 | §2；`index.ts:2118` 必抛 |
| 2 | **Team conversation 座位（根级 `conversation` 槽）不渲染** | 确认断裂 | §6；0.1.5 槽声明删除 + `inject(key: keyof SlotMap)` 收窄 |
| 3 | **semver peers 不匹配 0.1.5-rc.1** → 安装期失败或混代依赖图 | 确认（版本面） | §1；semver@6.3.1 实测 false |
| 4 | Session V3 + SessionHandle/session 锁：成员会话读写路径、测试基建 | 需回归 | §3；生产面薄但底层全换 |
| 5 | Typert 生成器/registry 变更 + `packages/api` 114 文件：重新生成 remote-client 与 remote 契约 | 需回归 / 待认证 | §5 |
| 6 | `ui-sidebar`/`ui-layout` panel 重构：sidebar 两座位与 Team chrome | 需回归 | §6 |
| 7 | 官方 experimental Agent Teams 与 Team bundle 共存（仅双 profile 场景） | 需回归 / 待认证 | §8 |
| 8 | 低风险尾项：`installModelSelection` 语义扩展、`agent/pre-step` payload 增字段、`adoptSessionEvent` 校验收紧、`storage-domain` patch 维护、persona 前后缀拆分 | 需回归 | §2/3/7 |

未核实的明确清单（写死，不猜）：
- `packages/api` 下 `dsh-api-remotes`/`session-controller`/`workspace-controller` 的 client/host 接口逐符号核对；
- `dsh-tools` 7 处导入的符号面核对；
- `slots.register` 对未知 key 的实跑行为（静默 vs 抛错）；
- 新 persistence 下 `ctx.agents.create/resume` 的锁与校验差异；
- 0.1.5 build 下 typecheck 失败集合的精确列表（预期含 §2/§6 两处）。

---

## 10. 隔离认证路线（建议顺序）

1. **建立隔离目录**：按 `docs/dsh-release-compatibility.md` §3.2 在日常 checkout 之外创建 `deepseek-harness-dsh-v0.1.5-rc.1/` 与 `dsh-agent-team-compat-dsh-v0.1.5-rc.1/`；前者 checkout 候选 tag 后清理旧产物并重新安装、build，后者从当前 Team 建立独立副本。不要切换或复用日常 `../deepseek-harness` 的工作树和 `lib/node_modules`。
2. **同步候选类型并先验断裂**：在隔离 Team 副本中设置 `DSH_HARNESS_DIR=deepseek-harness-dsh-v0.1.5-rc.1`，运行 `node scripts/sync-paths.mjs`、`npm run generate:typert`、`npm run typecheck`。预期首先暴露 §2（`agentCtx.agent`）与 §6（`slots.inject('conversation')`）；修复方向分别为 setup 改 `(agentCtx, agent)`，以及按 0.1.5 `main` keyed panel 契约迁移 conversation 座位。
3. **测试与构建**：`npm test`（含 typert-generation/shipping spec，验证生成物与 peers 断言——shipping.spec 的 `>=0.1.2-rc.1 <0.2.0` 断言需随硬切换更新）、`npm run build`、`npm run lint`、pack 检查。
4. **真启动**：隔离 dsh home + 0.1.5 build 跑 `preview`/`preview:ui`；browser 旅程覆盖 Team mode 进入/退出、Member 激活、channel 归档重启（#13 回归）、普通 DSH surface 恢复；同时检查 `cordis.patch.yml` storage-domain 覆盖行是否仍匹配新 schema（boot sweep）。
5. **安装面**：隔离目录真实 `pnpm/npm install` 验证 peer 解析（`>=0.1.2-rc.1 <0.2.0` 对 0.1.5-rc.1 失败属预期；认证通过后 peers 整体硬切换，参照 `.scratch/archive/2026-09/dsh-adaptation-playbook`：跨版本线是硬抬，不是顺手对齐）。
6. **收尾**：认证通过后将基线、真实断裂与验证证据更新到 `docs/dsh-release-compatibility.md(.zh.md)`、`docs/architecture/development` 与 README；本工作项归档。
