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

Host 包提供 `agentTeam` Service 和 operation ledger，command 包注册 `/team`。Agent 工具与 team-enabled preset 属于独立的可选行，将在后续 M1 票据中加入。

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

M1 的 03-09 票据会加入成员生命周期、Agent preset provision、团队工具、投递恢复和真实组合测试。目前的包只包含初始 ledger 与 Human command adapter。
