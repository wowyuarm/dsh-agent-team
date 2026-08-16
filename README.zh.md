# DeepSeek Harness Agent Team

这是一个为 DeepSeek Harness 提供持久化单 Host Agent Team 的可选 Cordis 组合包。

## 安装

组合包应安装到 DSH profile：

```sh
dsh plugin --profile team-demo add @deepseek-ai/dsh-agent-team-bundle
dsh --profile team-demo
```

组合包贡献 `cordis.patch.yml`，不会修改 Harness 安装，也不会进入随附的默认组合。包内同时提供 `agent-presets/team-member/agent.cordis.yml`。在 opt-in profile 中把该目录注册为 system AgentPresets root，或把 `team-member` 目录放到 `$DSH_HOME/.agent-presets/`，然后用 preset id `team-member` 创建 Team Member。

本地开发时可以安装本地项目：

```sh
dsh plugin --profile team-demo add /absolute/path/to/dsh-agent-team
dsh --profile team-demo
```

profile 必须提供当前组合所需的 Harness 服务。发布包包含构建产物；Git 安装需要自包含的 `prepare` 脚本，并需要用户显式允许 pnpm 执行安装构建。

## 组合内容

Host 包提供 `agentTeam` Service、operation ledger、Team 管理的 Agent 生命周期、Channel membership 和 durable Inbox admission，command 包注册 `/team`。随包的 opt-in `team-member` preset 提供 Team guidance、按 membership 授权的 `team_send`、`team_view`、`team_claim`、`team_follow`，以及隔离的 compaction service。Host patch 同时挂载两个 invariant companion。

Bundle 使用 profile 已有的 Host provider，不替换 `agents`、默认模型选择、`tools`、filesystem/shell、sandbox policy、Session store/persistence、Workspace registry 或 storage；这些服务保持 singleton。Team 管理的 session 持久使用 `danger-full-access`，普通 session 继续使用 profile 原有策略。Preset tool 冲突会在 unpublished setup 内失败，只让对应 Member unavailable。

一个 DSH home 对应一个协作域。operation ledger 是持久权威；Channel、Message、Task、Thread、Follow 和 Delivery 投影都由已提交 Operation 派生。

## 开发

设计文档和票据顺序位于 [.scratch/](.scratch/)。使用以下命令构建和测试：

```sh
corepack pnpm install
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

本项目面向 DSH 的公开插件与 bundle 接口，运行时不依赖旁边的 DeepSeek Harness checkout。

## 已知限制与延后工作

M1 已完成。Bundle 是单 Host、显式 opt-in 的组合，不提供分布式共识、Team direct message、嵌套 Thread、Direction 语义去重，也不把 durable Inbox admission 解释为模型已经处理。`team-member` preset 会授予 `danger-full-access`，只应在可信 Workspace 中使用。
