# DSH 发版兼容性认证

[English](dsh-release-compatibility.md) | 中文

本文定义外部 `dsh-agent-team` bundle 跟进 DeepSeek Harness（DSH）新版本的固定流程。目标是让一个 DSH 版本只有在实际证明可以安装、组装和运行后，才被声明为受支持版本。DSH 发版触发兼容性认证，不自动触发 Team bundle 发版。

本文不定义 Team 行为。Team 行为仍以 `packages/` 源码和测试为准；DSH 接口以相邻 Harness checkout 的源码、测试和发布包为准。

## 1. 触发条件

出现下列任一情况时，执行一次认证：

- DSH 发布新的正式版或预发布版。
- Team 新增、修改或移除了对 DSH 的 Host、Remote、Client、slot、preset、Session、Workspace 或 Storage 依赖。
- 用户报告 Team bundle 在某个 DSH 版本上安装、启动或进入 Team mode 失败。

只更新 DSH 的说明文档而不改变已认证版本范围，不需要执行认证。

## 2. 版本事实与支持规则

### 2.1 Team 版本与 DSH 版本

Team bundle 的版本独立演进，遵循 Team 自身的变更；它不与 DSH 版本机械同步。原因是两者可以独立变化：

- 已有的 peerDependencies 已覆盖候选 DSH，认证通过后只需记录认证结果，不需要发布 Team；
- Team 修复缺陷或增加功能时需要独立发布，不能等待 DSH 发版；
- 一个 DSH 版本可能需要多次 Team 修复或没有任何 Team 改动。

DSH 兼容性由根 `package.json` 的 peerDependencies 和本文件的已认证基线表达，不由 Team bundle 的自身版本号推断。仅兼容性范围变更而没有功能改动时，仍需发布一个新的 Team bundle 版本，因为用户只能从已发布包取得新的 `package.json`。

### 2.2 唯一版本依据

认证对象是 DSH 的不可变 GitHub release tag，例如 `dsh-v0.1.1-rc.2`，以及该 tag 发布的同一组 npm 包。

检查时同时记录：

- GitHub release tag、发布日期和 release notes；
- `@deepseek-ai/dsh` 版本；
- Team 直接 peer 的 DSH 包版本；
- 实际安装后是否只有一套同版本的 DSH 依赖图。

不要用 npm 的 `latest` tag 判断“最新 DSH”。DSH 的当前预发布版本可能只挂在 `next`，而 `latest` 仍指向较旧版本。

### 2.3 npm 预发布版本规则

npm 的 prerelease 版本范围不是普通的连续区间。比如：

```text
>=0.1.0-rc.8 <0.2.0
```

不匹配 `0.1.1-rc.2`。包含 `0.1.0-rc.8` 的比较器只会启用同一 `0.1.0` 版本基线上的预发布版本。

因此，不允许根据主版本号相同就假定兼容；也不允许用过宽范围掩盖未经验证的版本。只有候选 DSH 不在当前 peerDependencies 范围内、且认证通过时，才将根 `package.json` 内全部 `@deepseek-ai/dsh-*` peerDependencies 一起更新到新的版本线，并发布新的 Team bundle。它们必须保持一个可解析、无嵌套旧版 DSH 包的依赖图。

## 3. 认证流程

### 3.1 发现与初步评估

1. 用 `gh release list --repo deepseek-ai/deepseek-harness` 确认最新发布 tag 和发布说明。
2. 对比上一个已认证 tag 与候选 tag 的提交和改动文件。
3. 优先审查本 bundle 消费的接口面：
   - Host：Agent、Agent preset、Session、Workspace、Storage、Sandbox；
   - Remote：Typert protocol、API remotes；
   - Client：runtime、module loader、slots、sidebar、layout、conversation、workspace、locale；
   - Team preset：tools 和 permission preset。
4. 将变更分为“无关”“需要回归验证”“疑似接口不兼容”。疑似不兼容先定位到具体的上游公开接口和本仓库调用处，不能只依据 release note 下结论。

发布说明只用于确定审查重点，不能替代源码和运行验证。

### 3.2 建立隔离认证环境

认证必须使用候选 tag 的独立 Harness checkout，不能切换日常开发用的 `../deepseek-harness` checkout。

```text
日常开发目录
├── deepseek-harness/                 # 保持当前开发状态
└── dsh-agent-team/

认证临时目录
├── deepseek-harness-<tag>/           # 固定在候选 release tag
└── dsh-agent-team-compat-<tag>/      # Team 源码的隔离副本
```

在认证 Harness checkout 中先完成其自身的构建，使 Team 的 TypeScript facade 指向候选 tag 的实际声明文件。不要把旧 checkout 的 `lib/` 或 `node_modules` 当作候选版本的构建结果复用；这会掩盖声明或运行时不兼容。

再在隔离 Team 副本中运行：

```sh
node scripts/sync-paths.mjs
npm run generate:typert
npm run typecheck
```

Typert 生成结果必须稳定。若结果变化，先审查生成物和 Remote contract，再决定是否修改 Team 源码；不要手改 `packages/agent-team/lib/typert.*`。

### 3.3 自动验证

先运行与变更面匹配的窄测试，再至少运行：

```sh
npm test
npm run build
npm pack --dry-run
git diff --check
```

以下能力必须有通过证据：

| 能力 | 验证结论 |
| --- | --- |
| Host 恢复 | JSONL 与 SQLite 下的 Team ledger、Member 创建、挂起、恢复和移除正常。 |
| preset 隔离 | `team-member` 可挂载，普通 Session 不获得 Team tools 或 guidance。 |
| Remote | Host face 能生成，Client 能 mount generated Remote。 |
| Client slot | Team mode 进入、退出和三处 shadow 的恢复正常；不重声明 `sidebar.workspaces.directoryFlow`。 |
| 发布布局 | 打包后的根 bundle 可以通过真实 profile 安装，未依赖源码 symlink。 |

### 3.4 浏览器组合验证

只要 bundle、Client module、Remote activation、slot 或 DSH Client 包发生变化，都必须运行：

```sh
npm run test:browser
```

该命令必须在候选 Harness checkout 上运行，并验证：

```text
普通 DSH Session ──进入 Team mode──> Team 页面可用
       ▲                                  │
       └────────退出 Team mode────────────┘
```

最少覆盖：

- Remote mount 后 Team UI 注册；
- Team mode 的进入、刷新恢复、退出和普通 DSH surface 恢复；
- Channel、Thread、Member 等已有主流程；
- 390×844 窄屏无横向溢出，键盘焦点与对话框可用；
- 普通 Session 没有 Team tools、Team guidance 或 Team UI。

浏览器产物按 `docs/development.zh.md` 处理，不提交日常截图和临时 Harness 测试文件。

### 3.5 安装依赖图验证

候选 DSH 不在当前 peerDependencies 范围内时，在一个空目录中，使用候选 DSH 和更新后的已打包 Team bundle 做一次安装解析。确认：

- npm 或 DSH plugin 安装不报告 peer dependency conflict；
- Team 的每个 DSH peer 都由候选版本满足；
- 不出现被 Team 拉入的第二套 rc.8 或其他旧版 DSH 包；
- 用发布布局启动的实际 profile 通过浏览器验证。

## 4. 认证结果与发布门槛

认证完成后，按以下结果处理：

| 认证结果 | 后续动作 |
| --- | --- |
| 候选 DSH 已在当前 peerDependencies 范围内，且全部验证通过 | 在本文件记录已认证基线和验证证据；不修改 manifest，不发布 Team。 |
| 候选 DSH 不在当前 peerDependencies 范围内，且全部验证通过 | 原子更新所有 DSH peerDependencies、兼容性文档和 Team 自身版本，完成安装依赖图验证后发布 Team。 |
| 验证未通过 | 不扩大 peerDependencies，不发布 Team；按第 5 节记录和处理。 |

扩大 peerDependencies 并发布时，必须同时满足：

1. 已完成候选 tag 的源码评估；
2. Typert 生成、类型检查、测试、构建、打包检查均通过；
3. 真实 browser composition 通过；
4. 安装依赖图无 peer conflict 和嵌套旧版 DSH 包；
5. `package.json`、`docs/architecture.zh.md`、`docs/development.zh.md` 和 README 中的兼容性表述一致；
6. 认证使用的临时 checkout、profile、测试文件和截图不进入提交。

不要先放开版本范围，再补验证。

## 5. 未通过时的处理

| 现象 | 处理 |
| --- | --- |
| 只有 npm peer conflict | 不声明支持候选 DSH；修正 peer 范围的策略后重新解析和验证。 |
| 类型检查或 Typert 失败 | 定位上游接口变更和 Team 调用点；修改 Team 源码与测试，重新执行完整认证。 |
| browser composition 失败 | 按 Client module、Remote、slot、普通 DSH 恢复四个边界定位；不得用私有 shipped UI 或兼容 fallback 绕过。 |
| Session 或 Storage 恢复失败 | 先确认 DSH 是否声明了持久化格式变更；不为 Team ledger 增加静默兼容读取或 fallback。 |
| 上游公开接口不足 | 在本 bundle 内选择可维护的替代设计，或单独提出 Harness 接口改动；不要修改 Harness shipped defaults 来迁就 Team。 |

失败结论应记录候选 tag、现象、受影响接口、复现命令和下一步。不把未经验证的推断写成兼容性结论。

## 6. 当前基线

当前 Team bundle 的已认证基线是 DSH `0.1.2-rc.1`。认证在该 tag 的 Harness library/Web build 上完成，覆盖 Typert 生成、完整类型检查、262 个测试（1 个跳过）、构建、打包检查、lint 和真实 browser composition；浏览器旅程通过了外部发布布局安装、Remote mount、Team mode 进入和退出，以及普通 DSH surface 恢复。

这个候选版本落在旧 peers 之外且需要源码适配，因此 peers 按硬切换整体移动到 `>=0.1.2-rc.1 <0.2.0`；本 bundle 不再运行在 `0.1.1-rc.2` 上。三处上游移除决定了这一点：`effectiveSandboxMode` 从 `dsh-sandbox-policy` 移除（改为读取 `sandboxMode` session projection）、`session.events` 变为 `snapshotEvents(SessionLogOffset, SessionLogOffset)`、`AgentPresets` 增加 `includeShippedRoot`。`@deepseek-ai/dsh-client-runtime` 已被上游删除，因此它的 peer 与 `dsh.client.inject` 顺序行一并移除；把它留在旧区间会直接导致安装失败。

两条上游事实只记录、不修补：`@deepseek-ai/dsh-api-workspace-controller` 的声明在 `skipLibCheck: false` 下报错（`TypertClientRemote` 上没有 `workspace` 属性），单独 import 该包即可复现；Member Session 现在内嵌的 shipped composer 会暴露全部全局命令词汇，这是单独跟踪的产品决策，不是兼容性缺陷。
