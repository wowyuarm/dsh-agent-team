# dsh-agent-team 文档

[English](README.md) | 中文

这里是本仓库需要持续维护的正式工程文档。根 `AGENTS.md` 只保留每次工作都必须知道的规则；本目录的 [`AGENTS.md`](AGENTS.md) 负责文档改动与维护的路由——改动 `docs/` 下任何内容前先读它。具体流程、架构和跨仓库导航按需从这里进入。

## 文档入口

| 文档 | 用途 | 什么时候读 |
| --- | --- | --- |
| [`development.zh.md`](development.zh.md) | 安装、命令、生成物、live/UI preview、browser replay 和发布检查 | 开始开发、运行验证、修改 package 或发布布局 |
| [`dsh-release-compatibility.zh.md`](dsh-release-compatibility.zh.md) | DSH 新版本的评估、隔离认证、安装验证和发布门槛 | DSH 发版、更新 peerDependencies 或排查跨版本安装失败 |
| [`architecture.zh.md`](architecture.zh.md) | Host、tools、command、typed Remote、Client plugin 和 authority 边界 | 修改运行时、RPC、preset、Client 或持久化 |
| [`domain-model.zh.md`](domain-model.zh.md) | 稳定的 Agent Team 领域词汇 | 修改领域语义、类型命名或正式协作合同 |
| [`team-collaboration.zh.md`](team-collaboration.zh.md) | 已实现的八工具、Thread Attention、Inbox、读取、mention 与 mutation fence 合同 | 修改 Team 协作语义、模型工具或 Agent 通知时 |
| [`frontend-design.zh.md`](frontend-design.zh.md) | Team Client 的长期 UI 设计体系：设计原则、布局骨架、排版、组件合同、可访问性基线与验证流程 | 修改 `packages/client-agent-team/src/client/` 的可见 UI 或交互时 |
| [`harness-navigation.zh.md`](harness-navigation.zh.md) | 本仓库与 `../deepseek-harness` 的查阅路线、源码入口、已知接入陷阱 | 不确定应该查哪个 Harness 文档/package/source 时 |

## 文档规则

要修改或新增 `docs/` 下的文档？路由分支与维护纪律见 [`AGENTS.md`](AGENTS.md)——先读它。

## 从哪里开始

- **改 Host 或 domain：** 边界查 [`architecture.zh.md`](architecture.zh.md)，词汇查 [`domain-model.zh.md`](domain-model.zh.md)；`packages/agent-team/src/` 和测试是权威。需要决策来由时再按 `.scratch/README.md` 查 archive。
- **改 tools、preset 或 `/team`：** 查 [`architecture.zh.md`](architecture.zh.md) 的对应章节，再查 Harness cookbook 和 subsystem 文档。
- **改 Client 或 UI：** UI 体系查 [`frontend-design.zh.md`](frontend-design.zh.md)，跨仓库路线查 [`harness-navigation.zh.md`](harness-navigation.zh.md)。
- **改安装、构建、测试或 Remote 生成：** 查 [`development.zh.md`](development.zh.md)，再看对应 `package.json` / script 的实际实现。
