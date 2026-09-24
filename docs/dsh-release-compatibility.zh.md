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

浏览器产物按 `docs/development/generated-and-seams.zh.md` 处理，不提交日常截图和临时 Harness 测试文件。

### 3.5 安装依赖图验证

候选 DSH 不在当前 peerDependencies 范围内时，在一个空目录中，使用候选 DSH 和更新后的已打包 Team bundle 做一次安装解析。确认：

- npm 或 DSH plugin 安装不报告 peer dependency conflict；
- Team 的每个 DSH peer 都由候选版本满足；
- 不出现被 Team 拉入的第二套 rc.8 或其他旧版 DSH 包；
- 用发布布局启动的实际 profile 通过浏览器验证。

### 3.6 升级可行性

3.3–3.5 各节的证据都建立在**新建** Session 之上：新 Session 以候选版本的原生格式写入，**从不经过 released-format 迁移**。

因此有两类失效对它们是隐形的，而两类都已经发布过：成员 preset 行的配置与其 plugin schema 不再匹配（只在运行时显形），以及旧 artifact 内容被候选版本的迁移审计拒绝。

只要候选版本改动了 Session 格式、message source 词表或任何随包 preset 行，就要补上这两项检查：

- **带已有历史的升级。** 取一个已经按上一条已认证版本线写入过 Member Session 的 profile——其中至少包含一个 rollover 世代——在候选版本下打开它们。每一个都必须能加载；出现拒绝就是 release blocker，而不是数据问题，因为该审计是 fail-closed 的且不改动源 artifact。记录检查过的 artifact 数量与逐个结果。
- **已发布产物的存活面。** 判定**当前已发布**的 Team bundle 在候选 DSH 上是否仍然可用，而不只是候选 bundle 可用。在一个空目录里把已发布版本装到候选 DSH 上、启动它、并实际走一次成员创建。这一项决定发版紧迫性：当 npm `latest` 已经指向候选版本时，一个不兼容的已发布 bundle 会直接打断全新安装——这使本轮成为 release-blocking，而不是例行跟踪。

第一项检查背后有一个长期陷阱：自定义 Session message source kind。`@deepseek-ai/dsh-llm` 把 `MessageSourceMap` 记为可合并扩展的 sum type，但 released-format 迁移审计只准入一份封闭且 build-static 的 source kind 列表；声明新 kind 的插件写出的日志，会被下一个格式世代整体拒绝。

这个陷阱还有**后半段**：该审计同时把 `plugin` source 的**成员**钉死为 `kind`、`plugin`、`form`、`sections`、`summary`，因此把同一份载荷改挂到已准入的 kind 之下，仍会因任何自造信封字段而失败。

两半都是 fail-closed，且报的是不同错误；因此认证证据必须跑通本包**实际产出**的 source，而不只是它们声明的 kind。

正确做法是把插件语义编码进已准入的形状：结构化载荷用 `form: 'snapshot'` 下的具名 `{ name, text }` sections，人类可读单行用 `form: 'notice'` 下的 `summary`，其余散文放进不受约束的 model-facing 正文。

section 的 `text` 是插件自己的字符串、会被逐字读回，因此列表要编码成 JSON，不要用分隔符拼接：路径或名字本身就可能包含那个分隔符，拆开后会还原出与写入不同的值。

自造成员没有通用槽位——上游 `compact` 插件是靠为其 plugin id 开特例才拿到一个——因此确实需要自造成员的插件应当向上游提出该需求。

### 3.7 并存的另一套 Team 实现

Harness 随附一套 experimental Agent Teams，以独立 profile bundle 形式发布（`@deepseek-ai/dsh-experimental-agent-team-profile`、`@deepseek-ai/dsh-experimental-agent-team-web-profile`）。

它是与本 bundle 竞争的另一套 Team 实现，而不是本 bundle 依赖的扩展点：它注册自己的 model-facing 工具族（`spawn_teammate`、`send_message`、`list_agents`、`wait_agent`、`interrupt_agent`、`team_task_*`），在自己的 profile patch 里禁掉随附的全局 subagent 行以腾出这些名字，并自带成员、任务、store 与 client 面板。

本 bundle 的工具是 `team_view`、`team_inbox`、`team_thread`、`team_message`、`team_claim`，只在其 `team-member` preset 内注册。

认证覆盖的是**未挂载**这些 experimental 包的 profile；同时挂载两者属于**不支持**的组合：会出现两套 Team authority、两个工具族、两块 UI surface，而它们之间既无共享权威也无命名规则。

一个 profile 只选一套 Team profile。

本条是**记录性结论、不是实测结论**——没有跑过共存验证，本 bundle 也不检查、不避让那套 experimental 实现。

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
5. `package.json`、`docs/architecture/host-authority.zh.md`、`docs/development/environments-and-install.zh.md` 和 README 中的兼容性表述一致；
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

当前 Team bundle 的已认证基线是 DSH `0.1.7-rc.1`；以下几段保留产生前几条基线的 `0.1.5` 历史。

DSH peers 正好声明这条已认证线：`>=0.1.7-rc.1 <0.1.8`，因此本仓库尚未验证的线会落在声明区间之外，而不是在未经核实的兼容声明下被装上。

经路由的 sqlite 后端是 vendored fork，根本不是 dependency（GitHub issue #28）：上游包只以 devDependency 钉在 fork 来源版本 0.1.5-rc.2，用作字节兼容 fixture 参照；每次兼容认证先把 fork 与该版本文件对一遍 diff，再做其他事。

本基线取代的 `0.1.5-rc.1` 认证覆盖 Typert 生成、完整类型检查、499 个测试（1 个跳过）、构建、打包检查、lint，以及真实 browser composition（外部发布布局安装、Remote mount、Team mode 进入与退出、普通 DSH 恢复），peers 为 `>=0.1.5-rc.1 <0.1.6`。

`0.1.5-rc.2` 随后在同一 peer 区间上认证，manifest 无改动。

本 bundle 对该线的依赖是结构性的，不是偶然的。候选版本只要改动以下任一项，就是 peer 范围变更，而不是 patch：

- 根 `main` slot 以 keyed 条目注册（key `conversation`、priority `-100`），并经 `renderSlot('main', {}, { entryKey: 'conversation' })` 渲染。
- Session 经 handle API 访问（`open(id, 'read')` + `read()` + `close()`，`stat()` 返回 header 快照）。
- 成员 preset 的 `dsh-persona` 行把配置放在 `prefix` 下。
- `team-member` preset 以 `@deepseek-ai/dsh-agent-preset` 声明行与其 `@deepseek-ai/dsh-agent-preset-registry` 并列，落在 Team 自己的 `isolate` group 内。
- 本 bundle 写出的每条持久 message source 携带生产者自身的 kind；退役的 `{ kind: 'plugin', plugin: … }` wrapper 在写入时即被拒绝。

preset 组合没有编译期或单测守卫：成员类 spec 用的是合成 preset，因此某个行的配置与新 plugin schema 不匹配时，只有在真实 browser journey 里才会暴露——此时类型检查、单测、构建全绿，而所有成员都以 `preset "team-member" failed to mount: … $.prefix missing required value` 激活失败。

把 `npm run test:browser` 当作随包 preset 行的认证闸门。

§3.6 补上了上述检查的一个盲区：它们的证据都来自**新建** Session，而新 Session 从不经过 released-format 迁移。

迁移拒绝是 fail-closed 的，且不改动源 artifact 一个字节，因此后果是 Session 读不出来、而不是数据损坏；不兼容的已发布 bundle 对安装期检查同样不可见，只在创建成员时显形。

当 npm `latest` 指向候选版本时，这两类都是 release-blocking。

存量历史的升级可行性是**实测**的，不是假定的：0.1.5 候选版的封闭 source-kind 审计会拒绝已发布线写出的每一份 Member artifact，此后 bundle 携带的启动期修复在本机全量 store 上修复了 44 份被拒 artifact，6 份因 Session 结构缺陷未动，没有向任何既有 artifact 写入一个字节，第二次遍历零发布。

### DSH 0.1.7-rc.1

DSH `0.1.7-rc.1` 已认证，并推动基线前移。全部 `@deepseek-ai/dsh-*` peers 从 `>=0.1.5-rc.1 <0.1.6` 整体移动到 `>=0.1.7-rc.1 <0.1.8`：比较符只在自身 base tuple 上开放预发布，旧区间够不到任何 `0.1.6` 或 `0.1.7` 切点。被移除的 `@deepseek-ai/dsh-agent-presets` peer 随其指名的包一并删除。

本轮由两处上游契约变化驱动，且都需要源码适配：

- **preset 体系被替换。** 经 `@deepseek-ai/dsh-agent-presets`（`roots`/`trust`）的文件系统发现已移除；preset 改为声明行——host 级单例 `@deepseek-ai/dsh-agent-preset-registry`，加上每个 preset 一行 `@deepseek-ai/dsh-agent-preset` 声明（`config: { id, plugins }`）。
- **Team 的声明行随之迁移。** `cordis.patch.yml` 在同一个 `isolate: { agentPresets: true }` group 内声明注册表（`default: team-member`）与 `team-member` 定义行，把退役 roster 的条目列表原样内联为 `config.plugins`——包括两处 `!!js` 平台表达式，其语义由 preset 对子表达式的推迟求值保留。
- **Host 调用点一个未动。** `agentPresets` 服务调用面未变；`preset-roster.ts` 与 `preset/` 目录是删除而不是改写，浏览器通道的 overlay 携带同样的行。
- **Session format V4 要求生产者署名的 message source。** jsonl 写入路径以 `format v4 message requires a producer-owned source kind` 拒绝 `{ kind: 'plugin', plugin: … }`，因此本 bundle 的九个写点改为写入三个生产者 id 作为 kind。
- **released V3 历史无需在磁盘上改写。** 读时转换把每个 wrapper 改名为 `plugin:<producer>`、保留 `form`/`sections`/`summary`；读侧对全部三个 id 的两种形状按精确身份识别，绝不用 `plugin:` 前缀判定——同一份日志里还有保留自身 kind 的第三方行。

启动期修复（`session-remediation.ts`）在同一变更中移除，已经 Human 批准：它发布的正是 V4 写入拒绝的 wrapper，留着会主动制造读不回来的文件。

它针对的 0.1.5 前自定义 kind 在读时转换之前就被 released v2→v3 迁移链拒绝；确定性的 `session-refused` 激活失败现在在每次重启重试中报告同一失败，而不再被修复。

还有一处变化止步于测试 fixture：rc.1 把 `IconUserOutlineArtwork` 的路径重画到半像素网格上，没有改名、没有改 wrapper，因此 `settingsAction` 图标的 `data-content` 指纹从 `612cfab9` 变为 `68b4b343`，一行已提交快照随之刷新。源码无改动。

### DSH 0.1.7-rc.2

DSH `0.1.7-rc.2` 在同一 peer 区间上认证通过，manifest 无改动。候选版本落在 `>=0.1.7-rc.1 <0.1.8` 之内，因此按 §4 记录基线而不移动 peer，所有版本位仍指向该区间下界。tag `477b4f42`（2026-09-24）在 npm 尚未发布它时就完成认证：当时 `next` 仍指向 `0.1.7-rc.1`。

本 bundle 引入的符号没有被删除或改名。peer 包内的差异是 213 个非文档文件，集中在 bundle 组合进去的随包 Client 界面（`ui-primitives` 55、`ui-conversation` 22、`ui-workspace` 15）；`session-format-catalog`、`session-persistence` 与 Typert 协议只改了 manifest，因此不重新触发 §3.6。

两处上游变化止步于测试 fixture，都没有改动 bundle 源码。随包 layout 与 sidebar 现在 inject `shortcuts` 服务，接管测试台因此提供两个父级都需要的空 catalog 与空注册器。

sidebar 自身的标记也变了：logo 行多了 `data-window-drag`，新会话图标与文字被重新包进 mask/content 结构。容器快照因此把这两处细节折叠成同一形状，因为已提交的快照必须对认证区间内每个切点成立，而不只是对最新的那个。

认证树上的证据：`npm run typecheck`、`npm test`（741 通过、1 跳过）、`npm run lint`、`npm run build`、`npm pack --dry-run`（251 文件）、`npm run test:browser`（4 条 journey）。
