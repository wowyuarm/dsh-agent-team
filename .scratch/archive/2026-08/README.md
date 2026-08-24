# 2026-08 工作归档

这些资料记录 Agent Team 在 2026-08 已完成或已收口的工作项。它们用于追溯设计和验收；当前实现以 `packages/`、测试和 `docs/` 为准。

| 工作项 | 结果 | 历史资料 |
| --- | --- | --- |
| M1 | 建立单 Host 的 durable Team ledger、成员、Channel/Task/Claim 和初版工具协议 | [`m1/`](m1/) |
| M2 UI | 交付第一版 Team mode、Workspace/Channel/Thread/Agent Client 闭环 | [`m2-ui/`](m2-ui/) |
| UI redesign | 将第一版 UI 重做为 DSH native-feel 结构，并完成浏览器验收 | [`ui-redesign/`](ui-redesign/) |
| Thread Inbox | 用 Thread Attention 和 durable Inbox 替换旧 Follow/Delivery 模型，并交付五工具与完整 Member context | [`thread-inbox/`](thread-inbox/) |
| Conversation page | 收口 Channel/Thread 页头、空态、关闭态和可访问性，并记录下一轮候选 | [`team-conversation-page-design/`](team-conversation-page-design/) |
| UI round 3 | 完成消息 run、mention 强调、聊天排版刻度和 Task 状态点 | [`team-client-ui-round3/`](team-client-ui-round3/) |
| Sidebar sections | 完成侧栏分区、编辑器、成员模型固定和 Agent 会话跳转 | [`team-sidebar-sections/`](team-sidebar-sections/) |
| UI loading investigation | 收口 scoped invalidation、共享可取消 long-poll 与 Host 投影索引优化 | [`team-ui-loading-investigation/`](team-ui-loading-investigation/) |
| Ledger storage | 以 v1 域版本重置与公开组合路由把 Team ledger 切到 SQLite，移除随历史增长的 JSON 整文件重写成本；checkpoint/log 方向显式延后并记录在案 | [`agent-team-storage-architecture/`](agent-team-storage-architecture/) |
| README positioning | 以价值优先的产品定位更新 README 与 package 元数据，保留 opt-in 与单主机边界表述 | [`readme-positioning/`](readme-positioning/) |

代表性浏览器图在 [`validation/browser/`](validation/browser/)。它们是已确认的里程碑证据；日常测试输出不写入此目录。
