# dsh-agent-team / deepseek-harness 导航

日期：2026-08-17

维护要求：这是一份正式工程导航文档。它只记录已对照当前源码、测试或 Harness 文档核实的跨仓库路线；改变 package、脚本、slot 或安装方式时必须同步检查并更新它。它不是 Harness 的替代文档，也不改变本项目的产品决策。当前行为以源码和测试为准。

## 1. 两个仓库的职责分界

| 问题 | 先看本仓库 | 再看 `../deepseek-harness` | 权威性 |
| --- | --- | --- | --- |
| Agent Team 的领域对象、权限、ledger、Task/Claim/Thread Attention/Inbox 语义 | `docs/domain-model.md`、`docs/team-collaboration.md`、`packages/agent-team/src/` 与 tests；历史来由按 `.scratch/README.md` 查 archive | 只在需要确认被消费的 DSH service contract 时查 Harness | 本仓库实现；历史资料不定义当前行为 |
| Host package 的具体行为 | `packages/agent-team/src/{index,ledger,spec,types}.ts` 及 `tests/` | `docs/architecture.md`、相关 `subsystems/*`，确认 Agent/Session/Workspace/Storage/Typert 的宿主能力 | 本仓库实现；Harness 只拥有底层能力事实 |
| Model-facing tools 与 preset | `docs/team-collaboration.md`、`packages/tool-agent-team/src/index.ts`、`packages/agent-team/preset/team-member/agent.cordis.yml` | `docs/cookbook/adding-a-tool.md`、`docs/subsystems/tools.md`、`docs/subsystems/permission-presets.md` | 本仓库工具语义；Harness 规定扩展接口 |
| Human command | `packages/command-agent-team/src/index.ts` | `docs/subsystems/commands.md`、`docs/cookbook/extension-cookbook.md` | 本仓库命令；Harness 规定 `ctx.commands` |
| Client plugin / Team mode / UI | `docs/architecture.md`、`docs/development.md`、`packages/client-agent-team/src/client/`；历史取舍见 `.scratch/archive/2026-08/ui-redesign/` | `docs/subsystems/client-modules.md`、`.agents/notes/implemented/architecture/2026-07-23-client-plugin-loading-model.md`、`packages/client/AGENTS.md`、对应 shipped UI package 源码 | 本仓库实现与 UI 验收规则；Harness 规定加载、slot、React 分层 |
| Typed Remote | `docs/architecture.md`、`packages/agent-team/src/index.ts` 的 `@Remote`、`scripts/generate-typert.mjs` | `docs/subsystems/typert.md`、`packages/typert/{generator,loader,protocol,registry}`、`packages/api/remotes` | Harness 规定生成/装配，Host 与 Team 规定远程方法 |
| 发布、profile、bundle 安装 | `README.md` / `README.zh.md`、`cordis.patch.yml`、四个 package manifests | `README.md`、`docs/cookbook/adding-a-package.md`、profile/bundle 文档和 `packages/bundle/*` | Harness 规定安装器与 bundle 机制；本仓库规定外部 bundle 布局 |
| 实际 Web 验收 | `docs/development.md`、`scripts/run-browser-test.mjs`、`scripts/team-ui.e2e.ts`、`artifacts/browser/` | `apps/web` scaffold、`docs/testing.md`、`packages/client/*/tests` | 脚本产生本次审查材料；归档证据只保留里程碑代表图 |

**遇到不确定的 Harness 行为时，先查上游文档，再读实现和测试。** 不要把 `.scratch/` 中的探索结论当作 Harness API；也不要为了适应 Harness 猜测而改写 Team 的领域语义。若现有公共接口不支持目标交互，记录为 Harness 限制并调整 Team 接入设计，或在本 bundle 内实现替代 plugin。

## 2. 按改动类型查阅路径

### 2.1 修改 Host service、ledger 或生命周期

1. 本仓库：`packages/agent-team/src/` 和测试是当前实现；`docs/domain-model.md` 和 `docs/team-collaboration.md` 是正式领域入口。需要历史设计背景时按 `.scratch/README.md` 定位 archive。
2. 先读 `packages/agent-team/src/index.ts`、`ledger.ts`、`spec.ts`、`types.ts`，再读同目录 tests，确认 operation 是否通过唯一 authority/ledger 写入；不要把 `.scratch/` 当作当前实现规范。
3. Harness：
   - `docs/architecture.md`：插件平面、Service Definition/Provider/Consumer 与 agent-loop 边界；
   - `docs/subsystems/storage.md`：`ctx.storageDomain` 的 typed domain API；
   - `docs/subsystems/workspace.md`：`ctx.workspaceRegistry`、Workspace ID、cwd 与 session 归属；
   - `docs/subsystems/typert.md`：若 service 要暴露 Remote；
   - `docs/defensive-patterns.md`：生命周期、并发、持久化或 teardown 改动。
4. Harness 源码定位：按服务名到对应 `packages/<group>/<package>/src`；本项目当前实际消费的 paths 由生成的 `tsconfig.json` 记录。

完成标准：新事实只有一个 Host authority 和一个 durable commit path；新增 model-visible input 已有 session-log 依据；对应 package tests 和 REAL composition test 说明它的生命周期。

### 2.2 修改 model-facing tool 或 preset

- 本仓库：`docs/team-collaboration.md`、`packages/tool-agent-team/src/index.ts`（五个工具及运行时依赖）、`packages/agent-team/preset/team-member/agent.cordis.yml`（只在 team-enabled scope 中挂载）；历史工具研究仅在需要溯源时查 archive。
- Harness 文档：`docs/cookbook/adding-a-tool.md`、`docs/subsystems/tools.md`、`docs/subsystems/permission-presets.md`、`docs/subsystems/system-prompt.md`。
- Harness 源码：`packages/core/tools/src/{index,schema,presentation}.ts`、`packages/preset/agent-presets/src`。

工具 schema、canonical output、execute 与 presentation 是不同层。不要让 Host service 直接变成全局工具；不要把 `output`、`execute`、`timeoutMs` 等实现字段泄漏到 model request。工具只在显式 team preset scope 中存在，普通 Session 不应出现 Team tools 或 guidance。

### 2.3 修改 `/team` 命令

- 本仓库：`packages/command-agent-team/src/index.ts`、`tests/command-agent-team.spec.ts`。
- Harness：`docs/subsystems/commands.md`；源码 `packages/interaction/commands/src`。

命令是 interactive adapter，不绕过 `ctx.agentTeam` 的 authority；注册属于 plugin effect，fiber 销毁后命令应消失。

### 2.4 修改 Client package、browser bundle 或加载图

1. 本仓库：先读 `docs/architecture.md` 的 Client 章节、`docs/development.md` 的 UI 验收规则和目标组件；需要解释既有视觉结构时，再读 `.scratch/archive/2026-08/m2-ui/design/dsh-client-plugin-development.md` 与 `.scratch/archive/2026-08/ui-redesign/`。
2. Harness：
   - `docs/subsystems/client-modules.md`：`dsh.client`、boot graph、browser module；
   - `.agents/notes/implemented/architecture/2026-07-23-client-plugin-loading-model.md`：Loader 与 client module runtime 的两层模型；
   - `packages/client/AGENTS.md`：Client props、slot、React/data-layer 分层；
   - `docs/web-styling.md`：`--dsw-*` token、CSS Modules、`clsx`；
   - `docs/cordis-tutorial/01-first-plugin.md`、`02-lifecycle-and-effects.md`、`03-services.md`：插件注册与生命周期。
3. Harness 源码按功能查：
   - slot 类型与声明：`packages/client/ui-slots/src/`；
   - slot runtime：`packages/client/runtime/src/client/slots.ts`；
   - shell/sidebar：`packages/client/ui-layout/src/client/`、`ui-sidebar/src/client/`；
   - conversation：`packages/client/ui-conversation/src/client/`；
   - workspace：`packages/client/ui-workspace/src/client/`；
   - primitives/theme：`packages/client/ui-primitives/src/`、`ui-theme/src/styles/`；
   - client loading：`packages/client/modules/src/client/manifest.ts`。

本项目 Client 的运行时顺序是：先 `ctx.remote.$mount(agentTeamRemote)`，再通过 `ctx.inject(['remote.agentTeam'], ...)` 注册依赖该 Remote 的 UI。`dsh.client.inject` 是加载图元数据，不是 slot 或 apply 顺序保证；slot registration 必须适应 declaration 尚未出现的情况。

**Slot 关键规则：** parent entry 的 `children` 声明同时代表 render site 与 render authority。同一 child slot 不能由两个仍存活的 parent entry 同时声明。Team shadow `sidebar.workspaces` 时不能复制 shipped `sidebar.workspaces.directoryFlow` child；当前 Harness 的 `SlotCore` 会拒绝它。需要 workspace picker 时先查 Harness 的 `ctx.workspaces.pickDirectory()`（`packages/client/runtime/src/client/workspaces/service.ts`，经 `host.pickDirectory`）和现有 picker packages，再决定接入或把限制记录在设计中。

**Client 复用规则：** 复用 public package exports、`ui-primitives` 和 theme token；不要 import shipped package 的私有组件/私有 CSS；不要复制 WorkspaceBrowser、ConversationRoot 或整个 Shell；组件不直接接触 `ctx`，业务数据从 slot owner props、store 或 inject face 进入。

### 2.5 修改 typed Remote、Host/Client RPC 或生成物

- 本仓库：`packages/agent-team/src/index.ts` 的 service/`@Remote` 声明、`packages/agent-team/src/types.ts`、`scripts/generate-typert.mjs`；生成物在 `packages/agent-team/lib/typert.*`，不要手写。
- Harness：`docs/subsystems/typert.md`；源码 `packages/typert/generator/src`、`loader/src`、`protocol/src`、`registry/src`、`packages/api/remotes/src`。

`InvocationDescriptor` 是本地反射描述，不是 wire message；wire payload 必须来自显式 typed request/response。修改 Host Remote 后先运行 `npm run generate:typert`，再 typecheck、build，并检查生成结果是稳定的。Client mount contribution 使用 generated `/remote`，不要自行复制 RPC 协议。

### 2.6 修改 Workspace、Session 或目录选择

- 本项目：Team 只读取 `ctx.workspaces.list` projection；当前 UI 设计不复制 Workspace 创建/浏览，不调用 `ctx.workspaces.pickDirectory()` 或 `ctx.workspaces.create()`，无 Workspace 时回到普通 Session UI。
- Harness docs：`docs/subsystems/workspace.md`、`docs/subsystems/session.md`、`docs/subsystems/storage.md`。
- Harness source：`packages/workspace/workspaces/src`（registry/service）、`packages/client/runtime/src/client/workspaces/service.ts`、`packages/client/ui-workspace/src/client/`、`packages/host/directory-picker*/src`。

Workspace ID 是 branded id；路径通过 Host service 规范化；session cwd 归属必须由 Host projection 判断。不要在 Client 自己实现路径语义或第二套 Workspace store。

### 2.7 修改 storage / persistence / replay / Thread Inbox

- 本项目：`docs/team-collaboration.md`、`packages/agent-team/src/ledger.ts`、相关 projection/lifecycle 源码和 JSON/SQLite backend tests；Thread Attention 与 Inbox 的历史设计背景在 `.scratch/archive/2026-08/thread-inbox/`。
- Harness docs：`docs/subsystems/storage.md`、`docs/subsystems/persistence.md`、`docs/subsystems/session-persistence` 相关章节、`docs/defensive-patterns.md`。
- Harness source：`packages/storage/storage-domain/src`、`storage-json/src`、`storage-sqlite/src`、`packages/session/session-persistence*/src`。

Team ledger 是唯一持久权威；projection、Inbox、Remote 和 UI 不能另写事实。遇到崩溃窗口先增加 failure-injection/恢复测试，不添加静默 fallback。

### 2.8 修改 CSS、UI primitives 或 responsive layout

- 本项目：先读目标组件和 `*.module.css`，再读 `docs/architecture.md` 与 `docs/development.md`；需要历史视觉审计或 public UI reuse 清单时，查 `.scratch/archive/2026-08/ui-redesign/{design,research}/`。当前行为以组件源码和测试为准。
- Harness：`docs/web-styling.md`；`packages/client/ui-primitives/src`；`packages/client/ui-theme/src/styles`；`packages/client/AGENTS.md` 的 styling 和 component 规则。

先解决 surface grid、信息层级和 control reuse，再调颜色/圆角。保证 CSS Modules、`--dsw-*` token、键盘焦点、dialog/menu accessible name 和 390×844 reflow。

## 3. 外部 bundle 的安装与验证

### 已核实的用户安装方式

```sh
dsh plugin --profile team-demo add @deepseek-ai/dsh-agent-team-bundle
dsh --profile team-demo
```

本地开发安装：

```sh
dsh plugin --profile team-demo add /absolute/path/to/dsh-agent-team
dsh --profile team-demo
```

`cordis.patch.yml` 以 `dsh.bundle.patch` 暴露 bundle；它在 `dsh-agent-team-scope` 的 `cordis:group` 中挂载 Host、command、client 和 invariant rows，并以 `isolate.agentPresets: true` 只给 Team preset 加入 `team-member`。普通 DSH preset roster 不被改写。

### 验证顺序

1. 在本仓库先 `npm run typecheck`、`npm test`、`npm run build`、`npm pack --dry-run`。
2. 若改了 browser 代码或 bundle，运行 `npm run test:browser`；它会构造临时 profile、复制发布布局、使用 Harness 官方 Web scaffold 和 `/usr/bin/google-chrome`（可用 `CHROME_PATH` 覆盖），完成后删除临时 Harness 测试和 profile 文件。
3. 要手动查看页面，运行 `npm run preview`；它启动同一真实 composition，输出本地 URL，直到 `Ctrl+C` 停止。
4. 验收时同时检查普通 Session：没有 team preset 的普通 Session 不应出现 Team tools、Team guidance 或 Team UI。
5. 需要确认 Harness 公共 API 时，在相邻 checkout 读源码/测试；不要把临时 overlay、browser test 或生成文件提交到 Harness。

### 开发 checkout 的特殊依赖

`npm run generate:typert` 通过相邻 `../deepseek-harness` checkout 的 `WorkspaceAnalyzer` / `FaceModelEmitter` 生成 Host/Remote artifact。根项目的 `tsconfig*.json` 由 `scripts/sync-paths.mjs` 根据 Harness `tsconfig.base.json` 生成，分别让测试读 Harness source、类型检查读 Harness declarations、build 读已构建 declarations。不要手改这些 facade，也不要在其中添加 `include`/`files`。

这意味着：用户安装已发布 bundle 不需要 sibling Harness checkout；只有本地开发的 Typert、typecheck、build 与真实浏览器验证需要它。

## 4. Session 研究证据与踩坑

本次交接重点查阅的 Pi session：

`/home/yu/.pi/agent/sessions/--home-yu-projects-dsh-agent-team--/2026-08-15T15-25-36-664Z_01a00607-4c18-7e99-b169-4746e2805485.jsonl`

该 session 约 29 MB、6040 行。它记录了从“先在 Harness 内做”转为“新建独立 `dsh-agent-team` 外部可安装 opt-in bundle”的决策、M1/M2 ticket 推进、Typert/Client bridge、真实 Web 验收和当前 UI redesign frontier。session 原文不是 AGENTS.md 的常规必读内容；需要历史细节时按该路径检索，结论以本仓库当前设计和源码为准。

已从 session 和源码核实的关键踩坑：

1. **不要把所有问题改回 Harness。** Team 是外部 plugin；如果 Harness 现有 UI 或 contract 不满足目标，先判断是否能在本 bundle 实现替代 plugin。只有确实需要修改 Harness 公共 contract 时才另行决策。
2. **Remote service 需要动态等待。** Client `apply` 阶段不能假设 mounted Remote 已存在；先 `$mount`，再 `ctx.inject(['remote.agentTeam'], ...)`，让 UI 在 service ready 后注册。
3. **`dsh.client.inject` 不等于 apply 顺序。** 它描述 client graph 依赖，不能用来保证某个 slot declaration 已完成；用 `ctx.slots.inject()` 等待 declaration。
4. **Child slot 冲突不是 priority 问题。** shipped `WorkspaceBrowser`（priority 0）和 Team shadow（priority -100）都声明 `sidebar.workspaces.directoryFlow` 时，live parent 同时声明同名 child 会被 `SlotCore` 拒绝。声明 child 就是拥有 render authority，不能复制私有 child 来“补齐” shipped UI。
5. **真实 Web 组合优先于手工 `ctx.plugin()` 测试。** slot winner、Loader、bundle installation、client module 和 unload/restore 需要 REAL composition；单元测试不能证明这些。
6. **本地安装要模拟发布布局。** 直接 symlink package 可能绕过 profile 内的 peer fallback，造成假失败；browser 验收应复制已构建 package 的发布布局到临时 profile，再通过真实 `dsh plugin add`/profile 组合验证。
7. **Overlay 不要重复挂载全局 tool package。** `dsh-tool-agent-team` 由 team-member preset 在隔离 scope 中挂载；再把它作为全局 row 会让普通 composition 错挂工具。
8. **Generated artifact 不手写。** Typert 输出和 path facades 都由脚本生成；遇到输出漂移先修 generator 输入或脚本，不直接改 `lib/` / `tsconfig*.json`。

## 5. 当前状态

实现状态、已完成事项和延期范围以当前源码、测试和 package README 确认；本文不复制会快速过时的状态清单。`.scratch/` 仅提供 active work 或归档溯源，不承担当前项目入口。

## 6. 维护边界

- 本文引用的 Harness 路径和规则来自当前 checkout；Harness 变更后必须重新核对源码和 docs。
- 历史 session 中的思考、临时命令和失败尝试不自动成为当前规则；只把能被现有代码、测试或上游文档复核的结论写入这里。
- 本文是查阅路线，不复制 package manifest、命令清单或领域 spec；这些事实仍由源文件和 `docs/development.md` / `docs/architecture.md` 负责。
- `.scratch/` 可保留详细研究，但正式文档引用它时必须标明其设计/历史性质。
