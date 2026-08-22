# Team 侧栏分区化（M1 已落地，M2 编辑语义待定）

## 状态

M1 已实现并通过全部检查；M2 未开始，等人工确认编辑范围。

最后核对：2026-08-22。

## 当前前沿

1. **已落地（M1，纯客户端）**
   - 宽屏侧栏：工作区列表 + 「频道」「Agents」两个常驻可折叠分区替掉原双 tab（`TeamSidebarSection`）。
   - 频道行 `#` 标识 + hover/focus 显示行级 ⋯ 菜单（`TeamRowMenu`，复用公共 `Menu` portal 模式）；Agent 行复用会话头像语言 + 右下 presence 角标（`TeamMemberAvatar`），presence 文字标签移除。
   - ⋯ →「编辑」入口指向 M1 成员管理对话框：频道成员增删、Agent 加入/退出频道（既有 `joinChannel`/`removeChannelMember` Remote，幂等 request 按 方向+成员+频道 键）。名称/说明为只读事实展示。
   - 分区头刻意安静：无 hover 底色、仅 chevron 变色；不显示分区计数；频道行不显示成员数。
   - Agents 分区常驻后 workspace scope 长轮询由侧栏持有，Thread 页打开时不再重复发起第二个 workspace poll（共享 `TeamChangeStream`）；导航 `activeTab`/`selectWorkspaceTab` 整体移除。
   - 窄屏 rail 两图标改为「请求展开并聚焦对应分区」。
2. **待讨论（M2）**：Host ledger 新增 update 类操作后的可编辑字段——
   - `team/channel-updated`（name/description）、`team/member-updated`（description）；
   - handle 是否允许修改未决（涉及 @提及 解析与历史消息一致性）；
   - 对话框内把只读字段换成可编辑输入。

## 结束条件

M2：update 操作贯通 types → ledger → Host → remote → 投影，编辑对话框字段点亮，单测 + 浏览器 journey 覆盖改名与描述路径，正式文档同步。

## 正式文档出口

- UI 合同：`docs/frontend-design.md`「侧栏工作区浏览器」一节。
- 行为以源码为准：`packages/client-agent-team/src/client/`（`TeamWorkspaceBrowser` / `TeamSidebarSection` / `TeamChannelsPanel` / `TeamAgentsPanel` / `TeamRowMenu` / `TeamMemberAvatar` / `navigation.ts`）。
