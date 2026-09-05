# dsh-agent-team 文档

[English](README.md) | 中文

这里是本仓库需要持续维护的正式工程文档。`AGENTS.md` 只保留每次工作都必须知道的规则；具体流程、架构和跨仓库导航按需从这里进入。

## 文档入口

| 文档 | 用途 | 什么时候读 |
| --- | --- | --- |
| [`development.zh.md`](development.zh.md) | 安装、命令、生成物、live/UI preview、browser replay 和发布检查 | 开始开发、运行验证、修改 package 或发布布局 |
| [`dsh-release-compatibility.zh.md`](dsh-release-compatibility.zh.md) | DSH 新版本的评估、隔离认证、安装验证和发布门槛 | DSH 发版、更新 peerDependencies 或排查跨版本安装失败 |
| [`architecture.zh.md`](architecture.zh.md) | Host、tools、command、typed Remote、Client plugin 和 authority 边界 | 修改运行时、RPC、preset、Client 或持久化 |
| [`domain-model.zh.md`](domain-model.zh.md) | 稳定的 Agent Team 领域词汇 | 修改领域语义、类型命名或正式协作合同 |
| [`team-collaboration.zh.md`](team-collaboration.zh.md) | 已实现的五工具、Thread Attention、Inbox、读取、mention 与 mutation fence 合同 | 修改 Team 协作语义、模型工具或 Agent 通知时 |
| [`frontend-design.zh.md`](frontend-design.zh.md) | Team Client 的长期 UI 设计体系：设计原则、布局骨架、排版、组件合同、可访问性基线与验证流程 | 修改 `packages/client-agent-team/src/client/` 的可见 UI 或交互时 |
| [`harness-navigation.zh.md`](harness-navigation.zh.md) | 本仓库与 `../deepseek-harness` 的查阅路线、源码入口、已知接入陷阱 | 不确定应该查哪个 Harness 文档/package/source 时 |

## 文档规则

- 文档描述当前可验证的工程事实、稳定的维护流程和仍然有效的架构边界。
- 实现行为以源码和测试为准；文档与代码冲突时先修正文档，不能用文档解释代码没有实现的行为。
- `.scratch/` 保存 active work 与 archive 的设计、研究、tickets、原型和验证材料，不是当前实现或 API 的权威来源。先读 [`.scratch/README.md`](../.scratch/README.md)；正式文档只在需要解释历史背景时链接归档资料，并在写入前对照源码和测试。
- 每个事实只有一个正式归属。命令、导出、package manifest 和生成脚本仍以对应文件为最终来源；正式文档只记录不容易从文件本身看出的维护规则、边界和查阅路线。
- 代码修改导致正式文档中的当前行为、流程或边界失效时，在同一改动中更新文档。
- 不确定的事实写成 `> TODO:`，不要猜测。

## 从哪里开始

- **改 Host 或 domain：** 边界查 [`architecture.zh.md`](architecture.zh.md)，词汇查 [`domain-model.zh.md`](domain-model.zh.md)；`packages/agent-team/src/` 和测试是权威。需要决策来由时再按 `.scratch/README.md` 查 archive。
- **改 tools、preset 或 `/team`：** 查 [`architecture.zh.md`](architecture.zh.md) 的对应章节，再查 Harness cookbook 和 subsystem 文档。
- **改 Client 或 UI：** UI 体系查 [`frontend-design.zh.md`](frontend-design.zh.md)，跨仓库路线查 [`harness-navigation.zh.md`](harness-navigation.zh.md)。
- **改安装、构建、测试或 Remote 生成：** 查 [`development.zh.md`](development.zh.md)，再看对应 `package.json` / script 的实际实现。
