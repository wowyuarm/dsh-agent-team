# 开发与交付

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
- `npm run typecheck`：先生成 Typert，再检查四个 package。
- `npm test`：先生成 Typert，再运行 Vitest。
- `npm run build`：先生成 Typert，构建四个 package，并用 Harness 的 `tsdown` 构建 Client bundle。
- `npm run lint`：运行 ESLint。
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

`test:browser` 固定使用 keyless、确定性的 Host/Client 驱动，不读取真实 provider 凭据。代表性链路从已有 Thread 开始，Human 两次确认邀请未关注 Agent，随后验证 Agent Inbox 读取/回复、Human Inbox 与 Thread、页面 reload 后的 Host 持久事实，以及退出 Team mode 后普通 DSH surface 恢复。

## UI 改动与浏览器证据

可见 UI、Client bundle、slot、Remote activation 或交互行为改动必须运行 `npm run test:browser`。该脚本把本次 journey 的截图写入 Git 忽略的 `artifacts/browser/`，不会覆盖归档证据或制造工作区 diff。检查截图时至少覆盖：

```text
1440×960：信息层级、空/加载/错误状态、控件密度与普通 DSH 恢复
390×844 ：无横向溢出、关键内容可见、modal/menu 位于视口内
键盘     ：焦点可见、Tab/Enter/Space/Escape 行为、dialog/menu 的 accessible name
状态     ：提交失败保留输入；durable mutation 以 Host 返回投影为准
```

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
dsh plugin --profile team-demo add @deepseek-ai/dsh-agent-team-bundle
dsh --profile team-demo
```

本地目录安装：

```sh
dsh plugin --profile team-demo add /absolute/path/to/dsh-agent-team
dsh --profile team-demo
```

`cordis.patch.yml` 是 bundle patch 的入口。它将 Host、command、Client 和 invariant rows 加入 opt-in profile，并在隔离的 `agentPresets` scope 中挂载 `team-member` roster。普通 Session 的 shipped/user preset roster 不应被 Team bundle 改写。

真实安装验证必须使用已构建 package 的发布布局。直接 symlink 到源码可能绕过 profile 内的 peer fallback，导致与真实安装不同的结果；`scripts/team-ui.e2e.ts` 和 `scripts/team-ui.preview.ts` 已采用复制 package 的方式。

## 交付前核对

- 改动没有偷偷加入 shipped DSH defaults。
- package README、manifest、导出和可见行为保持一致。
- Remote 变更已经重新生成，不存在手写 artifact。
- Client 改动有真实 composition 或 browser 证据，而不只有组件单测。
- 测试和 lint 命令实际执行过，汇报时只写真实结果。
- `git diff --check` 通过。
- Live preview、UI preview 与 browser replay 没有隐式模式切换；需要模型的检查明确选择 live 或 replay。
- 没有 API key、profile 凭据、临时 overlay、临时 Harness 测试或浏览器产物被提交。
