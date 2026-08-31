# 开发与交付

[English](development.md) | 中文

## 适用范围

本文记录本仓库的维护流程。命令的具体定义仍以根目录 `package.json`、各 package manifest 和 `scripts/` 为准；如果命令发生变化，先改配置，再更新本文。

## 开始开发

本仓库是独立的外部 DSH bundle。最终用户只需要安装发布包；本地开发和真实 Web 验证需要相邻的 `../deepseek-harness` checkout。

```text
../
├── deepseek-harness/
└── dsh-agent-team/
```

安装依赖使用仓库 README 规定的命令：

```sh
corepack pnpm install
```

`pnpm-workspace.yaml` 将 `packages/*` 纳入 workspace，并关闭自动 peer 安装。根项目的 `node_modules` 和相邻 Harness checkout 提供本地开发所需的包与源码映射。

## 检查梯度

根据改动范围运行最小但足够的检查：

```sh
npm run generate:typert
npm run typecheck
npm test
npm run build
npm run lint
npm pack --dry-run
```

这些命令的职责如下：

- `npm run generate:typert`：从 `packages/agent-team/src/` 的 Host face 生成 Typert Host/Remote artifacts。
- `npm run typecheck`：先生成 Typert，再检查 Host、tools 和 Client 三个源码目录。
- `npm test`：先生成 Typert，再运行 Vitest。Vitest 通过 `scripts/isolate-dsh-home.setup.ts` 给每个测试文件一个一次性的 `DSH_HOME`，隔离 Member activation 创建或复用的 `$DSH_HOME/agent-team/members/member:*` 私有 memory。需要特定 home 的测试自行设置并保存/恢复该变量（见 `member-lifecycle.spec.ts`）。启动不会自动清理账本不认识的 Member 目录；显式 Member remove 才删除该 Member 的私有 memory，因此介质重置后如需清理旧目录，由操作者手动删除对应 `member:` 目录。
- `npm run build`：先由受限 Node cleaner 清空 Host、tools 与 Client 三个 package 的 `lib/`，再生成 Typert、构建三个源码目录，并用 Harness 的 `tsdown` 构建 Client bundle；这样删除源码后遗留的旧产物不会进入 pack。最终发布物仍是一个根 npm 包。
- `npm run lint`：运行 oxlint。
- `npm pack --dry-run`：检查根 bundle 的发布内容。

影响 browser bundle、Client module、slot、Remote activation、bundle manifest 或可见 UI 的改动，还要运行：

```sh
npm run test:browser
```

它会先 build，然后在临时 profile 中复制已构建 package，启动 Harness 官方 Web scaffold，用 `/usr/bin/google-chrome` 跑真实 journey；`CHROME_PATH` 可以覆盖浏览器路径。测试结束后会清理临时 profile 和 Harness 测试文件。

预览与浏览器验证分为三条显式路径：

```sh
# 真实模型交互；启动前要求 DEEPSEEK_API_KEY
npm run preview

# 无模型 UI 检查；加载隔离的 Team fixture，意外模型调用会明确失败
npm run preview:ui

# 无凭据、可重复的组装浏览器验收
npm run test:browser
```

`preview` 与 `preview:ui` 都使用临时 profile、临时 storage 和已构建 package，输出本地 URL，并在 `Ctrl+C` 后清理。`preview` 固定使用 Harness 的真实 DeepSeek adapter，不会因缺少凭据静默切换到 replay；凭据缺失时会在 build 和启动前失败。`preview:ui` 固定使用 keyless route-only adapter，初始 fixture 不触发模型；任何误触发的模型请求都会以明确错误终止，不能伪装成可用的真实交互。

`test:browser` 固定使用 keyless、确定性的 Host/Client 驱动，不读取真实 provider 凭据。代表性链路从已有 Thread 开始，Human 两次确认邀请未关注 Agent，随后验证 Agent Inbox 读取/回复、Human Channel 与 Thread、页面 reload 后的 Host 持久事实，以及退出 Team mode 后普通 DSH surface 恢复。

## UI 改动与浏览器证据

可见 UI、Client bundle、slot、Remote activation 或交互行为改动必须运行 `npm run test:browser`。该脚本把本次 journey 的截图写入 Git 忽略的 `artifacts/browser/`，不会覆盖归档证据或制造工作区 diff。检查截图时至少覆盖：

```text
1440×960：信息层级、空/加载/错误状态、控件密度与普通 DSH 恢复
390×844 ：无横向溢出、关键内容可见、modal/menu 位于视口内
键盘     ：焦点可见、Tab/Enter/Space/Escape 行为、dialog/menu 的 accessible name
状态     ：提交失败保留输入；durable mutation 以 Host 返回投影为准
```

浏览器本地的呈现偏好（如 Team 侧栏 Channels/Agents 行序，`dsh.agent-team.sidebar-order`）属于 UI 偏好持久化：改动其口径时按上表验证拖拽与刷新后的 reconcile。

这组截图是本次变更的人工审查材料，不是像素级 snapshot test。完成一个 UI 工作项后，只有能说明验收结论的少量代表图可以提交到 `.scratch/archive/YYYY-MM/<work>/validation/`，并必须附带文件名、验收点和复跑命令。调试截图、重复截图、录屏、浏览器日志和每次 test run 的完整图片集保持在 `artifacts/` 或 `.scratch/local/`，不得提交。

## 生成文件

以下文件由脚本生成，不要直接编辑：

- `packages/agent-team/lib/typert.host.*`
- `packages/agent-team/lib/typert.remote-client.*`
- `tsconfig.json`
- `tsconfig.types.json`
- `tsconfig.build-deps.json`

Remote artifacts 使用 `scripts/generate-typert.mjs` 生成；TypeScript path facades 使用 `scripts/sync-paths.mjs` 生成。修改输入后重新运行生成脚本，并检查生成结果是否稳定。

```sh
npm run generate:typert
node scripts/sync-paths.mjs
```

`tsconfig*.json` path facades 不应添加 `include` 或 `files`；它们需要保持对当前仓库文件和相邻 Harness source/declaration 的匹配行为。

## 外部安装验证

发布形态是根 bundle：

```sh
dsh plugin --profile web add @wowyuarm/dsh-agent-team
dsh web
```

本地目录安装：

```sh
dsh plugin --profile web add /absolute/path/to/dsh-agent-team
dsh web
```

`cordis.patch.yml` 是 bundle patch 的入口。它将 Host、Client 和 invariant rows 加入 opt-in profile，并在隔离的 `agentPresets` scope 中挂载 `team-member` roster。普通 Session 的 shipped/user preset roster 不应被 Team bundle 改写。

真实安装验证必须使用已构建 package 的发布布局。直接 symlink 到源码可能绕过 profile 内的 peer fallback，导致与真实安装不同的结果；`scripts/team-ui.e2e.ts` 和 `scripts/team-ui.preview.ts` 已采用复制 package 的方式。

### Profile 模式与发布节奏

日常自用与开发验收使用两个并存 profile，互不干扰：

- **稳定模式**（`--profile web`）：依赖 npm 发布版（`^0.1.x` 语义化范围），pnpm lockfile 锁定已装版本；发布后需手动 `dsh plugin --profile web update @wowyuarm/dsh-agent-team` 才会跟进新版。
- **开发模式**（`--profile web-dev`）：依赖 `link:` 本地检出，rebuild + 重启即用最新代码。注意宿主加载的是构建产物 `packages/*/lib/`：改完源码只重启而不 `npm run build`，成员会话仍会拿到旧工具清单（工具清单在激活时从当前运行代码派生）——先 build 再重启才生效。

启动运行时必须与安装形态匹配。稳定 profile 由发布版 dsh（全局安装的 `@deepseek-ai/dsh`，宿主全程运行 `lib/` 构建产物）启动；checkout 里的 `pnpm dsh`（tsx + tsconfig paths，宿主运行 `src/` 源码）只能启动 `link:` 安装的 profile。npm 安装的 bundle 周围没有 tsconfig paths，其 harness 依赖会解析到各包的 `lib/`，与宿主的 `src/` 实例形成两份模块——`dsh-scope` 的 scope 标签是模块内 Symbol，跨实例不一致，成员激活的 preset 校验会以 `selected preset is not team-enabled` 失败，表现为稳定 profile 全体 Agent 不可用（2026-08 诊断确认）。见到该症状时，先核对启动用的 `dsh` 是发布版还是 checkout 的 `pnpm dsh`。

发布节奏是批量的：两次发布之间，操作者将本地构建日常自用，作为轻量验收渠道——日常使用反馈等同有效验证。agent 与贡献者按检查梯度选择最窄检查即可，不必为每个小改动要求完整验收；累积若干修复与优化、在日常使用中稳定后，再批量发新版。

每次发布后随即在稳定 profile 执行上述 update 命令。稳定 profile 与开发 profile 共享全局 ledger 存储（`$DSH_HOME/storages/`）：稳定 profile 停留在旧版而 ledger 已被新版写入时，启动会因记录 schema 校验失败而崩溃（2026-08 的 0.1.1 即是这种"写得出、读不回"的中间版本）。

本 bundle 的最低兼容版本是 DSH `0.1.1-rc.2`。当前 DSH SQLite Session schema 不兼容旧版本；升级时删除旧 SQLite Session 数据库后重新开始。不要为 Team ledger 或 Member Session 添加迁移、读取旧格式或静默回退逻辑。

## Team ledger 存储路由

`agent_team` 域经根 `cordis.patch.yml` 的公开组合路由到 SQLite 后端：插入一行 `@deepseek-ai/dsh-storage-sqlite`（介质为 `$DSH_HOME/storages/agent_team.sqlite`），并以顶层覆写行把 `storage-domain` 配置为 `backend: json` 加 `routes: { agent_team: sqlite }`。其余域保持 JSON 默认路由。

- 覆写必须是顶层行而非 insert 列表项：insert 只追加新行，重复 id 会让装配失败。`packages/agent-team/tests/shipping.spec.ts` 用生产解析器（`loadOverlayPatches` + `applyEntryPatches`）模拟「Web bundle 层 + 本 bundle 层」叠加来锁住这一接线。
- `@deepseek-ai/dsh-storage-sqlite` 以 regular dependency 声明：它不在 dsh 应用清单的 heal 闭包里，peer 声明在真实安装中可能无法解析。上游给 `storage-domain` 行增加键时，需要同步复述到覆写行。
- 路由切换创建新的空 SQLite 介质；旧 `agent_team.json` 不被读取也不迁移，由使用者自行搬移或删除。
- `preview` 与 `preview:ui` 使用手写最小 overlay，不挂载该后端，仍走 JSON 默认路由。

### 存储基准

基准只测存储层写入路径（不含账本校验成本，那部分与后端无关），负载为约 3.4 KB 的典型操作文档：

```sh
DSH_BENCH_STORAGE=1 npx vitest run packages/agent-team/tests/storage-bench.spec.ts
```

2026-08-23 实测（WAL、逐次持久化）：

| 后端 | 操作数 | 总耗时 | 单次均值 | p95 |
| --- | --- | --- | --- | --- |
| JSON | 1k | 15.1s | 15.0ms | 19.5ms |
| SQLite | 1k | 5.9s | 5.9ms | 7.7ms |
| JSON | 10k | 401s | 40.1ms | 64.1ms |
| SQLite | 10k | 66s | 6.6ms | 10.6ms |

JSON 整文件重写的单次写成本随历史线性增长（1k→10k 涨了约 2.7 倍）；SQLite 稳定在逐语句 fsync 下限附近且不随历史增长。启动侧仍是全量 `loadAll()` 加全量重放，本阶段不变；后续 checkpoint/log 方向见 [`.scratch/archive/2026-08/agent-team-storage-architecture/`](../.scratch/archive/2026-08/agent-team-storage-architecture/)。

## 交付前核对

- 改动没有偷偷加入 shipped DSH defaults。
- package README、manifest、导出和可见行为保持一致。
- Remote 变更已经重新生成，不存在手写 artifact。
- Client 改动有真实 composition 或 browser 证据，而不只有组件单测。
- 测试和 lint 命令实际执行过，汇报时只写真实结果。
- `git diff --check` 通过。
- Live preview、UI preview 与 browser replay 没有隐式模式切换；需要模型的检查明确选择 live 或 replay。
- 没有 API key、profile 凭据、临时 overlay、临时 Harness 测试或浏览器产物被提交。
