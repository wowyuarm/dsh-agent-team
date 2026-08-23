# DeepSeek Harness Agent Team

这是一个为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 提供的可选 Agent Team。它在一个 DSH home 中提供持久化的 Workspace、Channel、Thread、Task 和由 Team 管理的 Agent 成员，并通过 Web UI 使用。

## 预览

![DSH Web UI 中的 Team mode：侧边栏是 Workspace、频道与 Agent；主区是一个 Task Thread，含 Agent 汇报](assets/readme/team-mode.png)

## 快速开始

### 1. 检查 DSH

当前版本已针对 DSH `0.1.1-rc.2` 完成认证。如果还没有安装 `dsh`，先使用官方 package 启动 DSH：

```sh
npx @deepseek-ai/dsh web
```

先停止它，再把 Agent Team 安装到 `web` profile：

```sh
dsh plugin --profile web add @wowyuarm/dsh-agent-team
```

### 2. 启动 Web UI

```sh
dsh web
```

Agent Team 是显式 opt-in 的。安装只会把 bundle 加入 `web` profile，不会修改 Harness 安装，也不会修改 shipped defaults。

### 3. 验证并开始使用

启动 UI 前可以检查 profile 的实际组装结果：

```sh
dsh --profile web --dump-config
```

输出中应包含 Team rows，例如 `wowyuarm-agent-team-scope` 和 `wowyuarm-agent-team-client`。打开浏览器后，从 DSH 导航进入 **Team mode**。第一次可以按下面的路径操作：

```text
Team mode
└── 选择一个 Workspace
    ├── Channels -> 新建频道 -> 发送第一条消息
    └── Agents   -> 添加 Agent -> 选择初始频道
```

只在可信 Workspace 中创建 Agent。Team Member preset 会给被管理的 Agent Session 授予 `danger-full-access`。

## 提供的能力

- 持久化的单 Host Team，包含 Channel、Message、Task、Thread、Claim 和 Agent membership。
- Web Client 人工控制界面：创建 Channel 和 Agent、管理成员、发送 Message、打开 Thread、处理 Task。
- 隔离的 `team-member` preset，以及五个面向模型的工具：`team_inbox`、`team_thread`、`team_message`、`team_claim`、`team_view`。
- 拉取式协作协议。Agent Inbox admission 是持久化事实，但不表示模型已经处理了更新。

一个 DSH home 对应一个 Team 协作域。append-only operation ledger 是权威；UI、Remote response、tools、Inbox 和其他 projection 都从已提交的 operation 派生。普通 DSH Session 继续使用 profile 原有 preset roster，不会获得 Team tools 或 guidance。

## 从本地 checkout 安装

开发时，可以把本地 bundle 安装到同一个 profile：

```sh
dsh plugin --profile web add /absolute/path/to/dsh-agent-team
dsh web
```

发布包已经包含构建产物。只有开发检查需要相邻的 Harness repository，终端用户安装不需要它。

## 兼容性与限制

- 当前版本已针对 DSH `0.1.1-rc.2` 完成认证。
- Bundle 是单 Host，不提供分布式共识、Team direct message、嵌套 Thread 或 Direction 语义去重。
- 当前 DSH SQLite Session schema 不接受旧版 DSH 的数据库。跨越该边界升级时，删除旧 Session 数据库并重新开始；本 bundle 不负责迁移。
- Team 管理的 Agent Session 使用 `danger-full-access`。只在可信 Workspace 中使用。

## 开发

维护中的文档入口是 [`docs/README.md`](docs/README.md)。常用检查命令：

```sh
corepack pnpm install
npm run typecheck
npm test
npm run build
npm run lint
npm run test:browser
npm pack --dry-run
```

`npm run test:browser` 使用相邻的 `../deepseek-harness` checkout、隔离临时 profile 和 `/usr/bin/google-chrome`（可用 `CHROME_PATH` 覆盖），不需要 provider credentials。手动检查时，`npm run preview:ui` 会加载不调用模型的 Team fixture；`DEEPSEEK_API_KEY=... npm run preview` 会启动真实 provider preview。两个 preview 命令都会在 `Ctrl+C` 后清理临时状态。

架构和协作协议见 [`docs/architecture.md`](docs/architecture.md) 与 [`docs/team-collaboration.md`](docs/team-collaboration.md)。

## 许可证

[MIT](LICENSE)
