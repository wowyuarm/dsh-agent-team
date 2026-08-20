# dsh-agent-team 文档

这里是本仓库需要持续维护的正式工程文档。`AGENTS.md` 只保留每次工作都必须知道的规则；具体流程、架构和跨仓库导航按需从这里进入。

## 文档入口

| 文档 | 用途 | 什么时候读 |
| --- | --- | --- |
| [`development.md`](development.md) | 安装、命令、生成物、测试和发布检查 | 开始开发、运行验证、修改 package 或发布布局 |
| [`architecture.md`](architecture.md) | Host、tools、command、typed Remote、Client plugin 和 authority 边界 | 修改运行时、RPC、preset、Client 或持久化 |
| [`team-collaboration.md`](team-collaboration.md) | 已实现的五工具、Thread Attention、Inbox、读取、mention 与 mutation fence 合同 | 修改 Team 协作语义、模型工具或 Agent 通知时 |
| [`harness-navigation.md`](harness-navigation.md) | 本仓库与 `../deepseek-harness` 的查阅路线、源码入口、已知接入陷阱 | 不确定应该查哪个 Harness 文档/package/source 时 |

## 文档规则

- 文档描述当前可验证的工程事实、稳定的维护流程和仍然有效的架构边界。
- 实现行为以源码和测试为准；文档与代码冲突时先修正文档，不能用文档解释代码没有实现的行为。
- `.scratch/` 继续保存设计、研究、ticket 和历史验证材料，不是当前实现或 API 的权威来源。正式文档可以引用其中的设计背景，但写入本目录前必须对照源码和测试。
- 每个事实只有一个正式归属。命令、导出、package manifest 和生成脚本仍以对应文件为最终来源；正式文档只记录不容易从文件本身看出的维护规则、边界和查阅路线。
- 代码修改导致正式文档中的当前行为、流程或边界失效时，在同一改动中更新文档。
- 不确定的事实写成 `> TODO:`，不要猜测。

## 从哪里开始

- **改 Host 或 domain：** 读 [`architecture.md`](architecture.md) 的 Host 章节，再回到 `.scratch/CONTEXT.md` / `.scratch/design/architecture.md` 了解设计背景，最后以 `packages/agent-team/src/` 和测试为准。
- **改 tools、preset 或 `/team`：** 读 [`architecture.md`](architecture.md) 的对应章节，再查 Harness cookbook 和 subsystem 文档。
- **改 Client 或 UI：** 读 [`architecture.md`](architecture.md) 的 Client 章节与 [`harness-navigation.md`](harness-navigation.md) 的 Client 路线；UI 视觉范围再读 `.scratch/ui-redesign/README.md`。
- **改安装、构建、测试或 Remote 生成：** 读 [`development.md`](development.md)，再查看对应 `package.json` / script 的实际实现。
