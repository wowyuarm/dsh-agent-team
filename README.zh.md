# DeepSeek Harness Agent Team

这是一个为 DeepSeek Harness 提供持久化单 Host Agent Team 的可选 Cordis 组合包。

## 安装

组合包应安装到 DSH profile：

```sh
dsh plugin --profile web add @wowyuarm/dsh-agent-team
dsh web
```

组合包贡献 `cordis.patch.yml`，不会修改 Harness 安装，也不会进入随附的默认组合。组合包会挂载一个私有、隔离的 AgentPresets roster，其中包含 `team-member`；因此 `dsh plugin add` 后不需要修改源码、复制 preset，也不需要配置 profile root。普通 DSH Session 仍使用 profile 原有的系统/用户 preset roster。

本地开发时可以安装本地项目：

```sh
dsh plugin --profile web add /absolute/path/to/dsh-agent-team
dsh web
```

profile 必须提供当前组合所需的 Harness 服务。发布包包含构建产物；Git 安装需要自包含的 `prepare` 脚本，并需要用户显式允许 pnpm 执行安装构建。

## 组合内容

Host 包提供 `agentTeam` Service、operation ledger、Team 管理的 Agent 生命周期、Channel membership 和持久 Thread Inbox；Web Client 是唯一的人工控制界面。随包的 opt-in `team-member` preset 提供 Team guidance，以及按 membership 授权的 `team_inbox`、`team_thread`、`team_message`、`team_claim`、`team_view` 五个工具，并提供隔离的 compaction service。Host patch 挂载其 invariant companion。已实现的拉取式协作协议见 [`docs/team-collaboration.md`](docs/team-collaboration.md)。

Bundle 使用 profile 已有的 Host provider，不替换 `agents`、默认模型选择、`tools`、filesystem/shell、sandbox policy、Session store/persistence、Workspace registry 或 storage；这些服务保持 singleton。Team 管理的 session 持久使用 `danger-full-access`，普通 session 继续使用 profile 原有策略。Preset tool 冲突会在 unpublished setup 内失败，只让对应 Member unavailable。

一个 DSH home 对应一个协作域。operation ledger 是持久权威；Channel、Message、Task、Thread、Claim、Thread Attention 和 Inbox 投影都由已提交 Operation 派生。

## 开发

当前工程说明位于 [`docs/`](docs/README.md)；进行中的工作和历史设计证据按 [`.scratch/`](.scratch/README.md) 组织。使用以下命令构建和测试：

```sh
corepack pnpm install
npm run typecheck
npm test
npm run build
npm run test:browser
npm run preview:ui
DEEPSEEK_API_KEY=... npm run preview
npm pack --dry-run
```

`test:browser` 使用相邻 `../deepseek-harness` checkout 的官方 Web scaffold 和 `/usr/bin/google-chrome`（可用 `CHROME_PATH` 覆盖）。命令会把构建后的包安装到隔离临时 profile，运行无凭据且确定性的组装旅程，包括已有 Thread 邀请、Agent 读取/回复、Human Inbox、reload 和普通 DSH surface 恢复；本次审查截图写入 Git 忽略的 `artifacts/browser/`，随后删除所有 Harness 临时文件。

`npm run preview` 是真实交互模式。它在 build 前要求 `DEEPSEEK_API_KEY`，在隔离临时 profile 中挂载真实 provider，打印本地 URL，并在 `Ctrl+C` 后清理；它不会静默切换到 replay。`npm run preview:ui` 会加载隔离的 Team fixture，并禁用模型 streaming，供开发者检查界面而不会意外调用 provider。

本项目面向 DSH 的公开插件与 bundle 接口。安装用户不需要相邻 Harness checkout，也不需要修改 Harness 源码；上述 checkout 关系仅是开发测试接缝。

## 已知限制与延后工作

Bundle 是单 Host、显式 opt-in 的组合，不提供分布式共识、Team direct message、嵌套 Thread、Direction 语义去重，也不把 durable Inbox admission 解释为模型已经处理。它要求 DSH `0.1.0-rc.8`；从旧版 DSH SQLite Session 数据库升级时，直接删除旧数据库并重新开始，因为 DSH rc.8 会拒绝旧 Session schema。Team ledger 有意不提供迁移或兼容路径。`team-member` preset 会授予 `danger-full-access`，只应在可信 Workspace 中使用。
