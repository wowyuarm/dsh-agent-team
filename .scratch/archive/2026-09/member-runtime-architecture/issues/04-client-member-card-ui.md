# Member Card UI（移除频道层编辑，仅此）

Status: done (2026-09-02, Tars — 创建流程频道页 + 编辑卡频道区块移除完成)

> 范围更新（2026-09-02，与 Human 对齐）：**大幅收缩**——不做 Tools 复选、不做 Skills 列表、不做上传控件（skills 目录即能力面，Member 自装自管）。本 ticket 仅移除 agent card 的频道层编辑与创建流程的频道选择页。

## Goal

Member 创建流程与编辑卡片移除频道层：创建流程不再有频道选择页；编辑卡片的"频道成员"区块移除（成员管理走频道侧，Channel membership 的即时 add/remove 流程保留在频道面）。`channelRefs` Remote 字段保留可选（"可留空、后续加频道、DM 可达"已是受支持语义）。

## Decisions（2026-09-02 确认）

- 创建流程的频道选择页移除；Remote `addMember` 的 `channelRefs` 保留为可选字段。
- 编辑卡片的频道成员区块移除；Host 的 channel membership Remote 不变（频道侧入口继续使用）。
- 不做 Tools 区块、Skills 区块、上传控件——tools.allow 是无 UI 的接口预留（01/02）；skills 是 Member 自管的私有目录（03）。
- 架构约束：Web Client 是唯一 Human Team 控制面；durable UI 变更非乐观（guardrail）。

## Files / Areas

- `packages/client-agent-team/src/client/`：创建流程（删频道页）、编辑卡片（删频道成员区块）。
- 相关组件测试更新（被删区块的用例移除/改写）。
- `npm run test:browser` 与 `artifacts/browser/` 截图（desktop + 390×844）、键盘/focus、dialog/menu 可访问性、普通 DSH restoration 检查。

## Acceptance

- 创建流程无频道页；创建出的 Member 未加频道时仍可被 DM 唤醒、后续可从频道侧加频道。
- 编辑卡片无频道成员区块；频道的成员管理流程不受影响。
- 现有编辑功能（handle/description/model）不回归。
- 浏览器测试通过并人工检查截图；键盘与读屏路径可用。

## Outcome（2026-09-02 实施记录）

- **创建流程**：`MultiMenuField` 初始频道选择器移除（对话框只剩 名称/说明/模型）；`channelRefs` 恒为空数组提交（Remote 字段保留可选——"可留空、后续加频道、DM 可达"语义不变）；表单状态/重试语义同步简化。
- **编辑卡**：频道成员 fieldset 移除（`useChannelMembership`/memberships 状态/加载 effect 一并删除）；编辑器只剩 handle/description/model + capabilities echo（01）；编辑器 doc 注释更新为 "Channel membership is managed from the Channel side"。
- **上游收缩**：`TeamAgentsPanel` 不再接收 `loadChannels`/`joinChannel`/`removeChannelMember`（AgentRow → 编辑器链同步）；`TeamWorkspaceBrowser` 传参收缩。频道侧流程（新建频道初始成员 MultiMenuField、编辑频道成员行、管理成员对话框）原样保留。
- **死键清理**：locales 双语删除 `initialChannels`/`noChannelsForAgent`/`channelsPickerEmpty`/`channelsPickerCount` 四个无消费者键；`channelMembersSection`/`addToChannel` 等频道侧键保留。
- **测试**：client spec 3 用例改写——创建断言"无初始频道按钮"（负向）+ `channelRefs: []`；membership 编辑用例改为"编辑器无频道区 + handle/description 编辑提交 updateMember"；e2e 全链路重构——成员经频道编辑器"添加"入 engineering（正向验证频道侧流程成为唯一入会路径），Agent 编辑器断言 添加/移除 按钮计数为 0。
- **test:browser**：全链路 e2e 通过（21.5s）；desktop 1440×960 + narrow 390×844 截图全部刷新（agent-create-modal / agent-edit-modal / channel-create-modal 双视口），对话框边界断言（narrow ≤390 不溢出）沿用既有 guard。
