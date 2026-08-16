# DeepSeek Harness Agent Team

这是一个为 DeepSeek Harness 提供持久化单 Host Agent Team 的可选 Cordis 组合包。

## 安装

组合包应安装到 DSH profile：

```sh
dsh plugin --profile team-demo add @deepseek-ai/dsh-agent-team-bundle
dsh --profile team-demo
```

组合包贡献 `cordis.patch.yml`，不会修改 Harness 安装，也不会进入随附的默认组合。

本地开发时可以安装本地项目：

```sh
dsh plugin --profile team-demo add /absolute/path/to/dsh-agent-team
dsh --profile team-demo
```

profile 必须提供当前组合所需的 Harness 服务。发布包包含构建产物；Git 安装需要自包含的 `prepare` 脚本，并需要用户显式允许 pnpm 执行安装构建。

## 组合内容

Host 包提供 `agentTeam` Service、operation ledger、Team 管理的 Agent 生命周期、Channel membership 和 durable Inbox admission，command 包注册 `/team`。`@deepseek-ai/dsh-tool-agent-team` 已提供按 membership 授权的 `team_send`、`team_view`、`team_claim` 和 `team_follow`；随包 preset 会在后续 M1 issue 加入。

Bundle 使用 profile 已有的 Host provider，不替换 `agents`、默认模型选择、`tools`、filesystem/shell、sandbox policy、Session store/persistence、Workspace registry 或 storage；这些服务保持 singleton。Team 管理的 session 持久使用 `danger-full-access`，普通 session 继续使用 profile 原有策略。Preset tool 冲突会在 unpublished setup 内失败，只让对应 Member unavailable。

一个 DSH home 对应一个协作域。operation ledger 是持久权威；Channel、Message、Task、Thread、Follow 和 Delivery 投影都由已提交 Operation 派生。

## 开发

设计文档和票据顺序位于 [.scratch/](.scratch/)。使用以下命令构建和测试：

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

本项目面向 DSH 的公开插件与 bundle 接口，运行时不依赖旁边的 DeepSeek Harness checkout。

## 已知限制与延后工作

M1 的 08-09 issue 会加入更多故障恢复和最终可安装组合。Issue 01-07 已提供 ledger、Human command adapter、Agent Member lifecycle、durable Delivery、revision-fenced reply、Direction Claims、Follow attention、one-use mention confirmation、Human Task 完成/重开、不可逆 Member 移除和四个正式工具。
