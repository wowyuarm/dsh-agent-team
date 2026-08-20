# Agent Team UI Visual / UX Audit

日期：2026-08-17
证据：`.scratch/archive/2026-08/validation/browser/`、`packages/client-agent-team/src/client/`、DeepSeek Harness first-party Web source/docs
范围：只审计 Client presentation；功能正确性与 native-feel quality 分开评价

## 1. 总结

当前 Team UI 的功能边界基本正确：真实 Workspace/Member/Channel/Thread projection、bounded pagination、non-optimistic mutation、draft preservation、unavailable gate、slot takeover/restore 和窄屏无 horizontal overflow 均有证据。

但 native-feel 较弱。当前页面主要由 46 处 raw form/control elements 和约 490 行共享自定义 CSS 构成，只使用了 DSH token 和少量 icons/StateDot/Tooltip。结果是：布局属于 DSH Shell，内部交互和信息层级却像测试夹具。

**结论：M2 functional baseline 完成；UI visual/native baseline 未完成。**

## 2. P0 Findings

### P0-1 Channel/Thread 没有采用 DSH Conversation 的稳定宽度轴与内容节奏

现象：

- `desktop-channel.png` 中 header 后出现大面积空白，第一条 Message 靠近底部；timeline 不能形成连续阅读流。
- composer 是裸 textarea + button/checkbox，视觉上像普通表单，不像 DSH 输入区域。
- Thread 的 claims、messages、activities 没有共同的内容轴。

证据：

- Team：`team.module.css` `.teamConversation`, `.channelTimeline`, `.channelComposer`；`TeamChannelPage.tsx`、`TeamThreadPage.tsx`。
- DSH：`ui-conversation` `ConversationRoot.module.css`, `ChatView.module.css`, `InputBar.module.css` 使用 resident skeleton、scroll host、固定 column rhythm 和稳定 composer card。

影响：核心协作页面没有建立“header → timeline → composer”的工作界面，内容少时尤其像空白测试页。

建议：

- center surface 采用明确 grid：`auto minmax(0, 1fr) auto`。
- timeline 从 header 下自然开始；空状态占 timeline 起点，不用 `space-between` 撑开。
- Channel/Thread 共享 content max-width、inline padding 和 scroll host。
- composer 自行实现薄 Team textarea，但对齐 DSH 的 card、focus、disabled、error toast 和键盘行为；不导入 private `InputBar`。

### P0-2 Sidebar 的密度、selected state 和控制层级与 DSH first-party 不一致

现象：

- Team Workspace、Channel、Agent row 使用较高行高、边框和散开的文字。
- selected Channel/Workspace 主要依靠弱背景或 `aria-current`，视觉不明确。
- tabs、加号、状态、列表标题没有稳定的 28/36px control rhythm。

证据：

- Team：`TeamWorkspaceBrowser.tsx`, `TeamWorkspaceRow.tsx`, `TeamChannelsPanel.tsx`, `TeamAgentsPanel.tsx`, `.workspaceRow`, `.channelCard`, `.tab`, `.iconButton`。
- DSH：`ui-sidebar/SidebarRoot.module.css` 使用 12/6 padding；`ui-workspace/WorkspaceBrowser.module.css` 和 `rows/Rows.module.css` 使用 28px icon controls、紧凑 row、2px list gap、明确 selected/focus/hover hierarchy。

影响：Team sidebar 与 Shell 的品牌栏/底部动作像来自两个产品，列表扫描效率低。

建议：Channel/Agent 改成 compact navigation row，去掉 card border；selected fill/text/indicator 明确；创建操作移入 Modal，sidebar 不长期展开表单。

### P0-3 Channel/Thread header 没有形成上下文、状态与动作的一体结构

现象：Thread 的返回按钮、`Task #1`、状态、Accept/Close/Reopen 分散；Channel name、purpose、成员管理没有清晰 baseline。窄屏时操作容易被压成多行杂乱布局。

证据：`TeamChannelPage.tsx`, `TeamThreadPage.tsx`, `.channelPageHeader`, `.threadActions`；对照 `ui-conversation` resident header/breadcrumb/action layout。

建议：

- Channel：title + purpose/participant summary + overflow menu。
- Thread：back + Task number + status + primary action + overflow menu。
- 合法状态动作仍由 Host contract决定；视觉只重排，不扩大 authority。
- 窄屏 status 独立第二行，低频动作进入 Menu。

## 3. P1 Findings

### P1-1 重造了 Harness 已有的 Button/Input/Modal/Menu chrome

现象：`.primaryButton`, `.textButton`, `.iconButton`, raw `<input>` / `<button>` 分布在全部 surface，hit area、focus ring、hover/disabled hierarchy 不一致；部分 Thread action 近似浏览器默认按钮。

建议：直接迁移 public `Button`, `Input`, `Menu`, `Modal`, `Tooltip`。只有 multiline composer textarea 保留 Team-local control。

### P1-2 Members panel 不是完整 Modal

现象：`TeamFooterAction.tsx` 使用 fixed `<section role="dialog">`，缺少 body portal、Escape/mask close、焦点陷入/恢复和标准 DSH dialog geometry。

对照：`ui-primitives/Modal.tsx` 已提供 controlled portal、mask、Escape close、title/description/footer。

建议：global/channel Members 使用同一 Team-owned `Modal` presenter；明确 scope；global 只读，Channel 支持逐行 membership mutation。

### P1-3 创建 Agent/Channel 使用 inline gray form，破坏导航连续性

现象：创建表单直接展开在 sidebar list 内，挤走 Channels/Agents；字段和 errors 缺少统一层级；提交/取消动作弱。

建议：tab header `+` 打开 Modal；使用 Input/Button；失败保留输入；field/global error 明确；pending 只锁当前 modal submit。

### P1-4 Timeline 泄漏内部 enum/ref，Message/Activity/Claim 层级不足

现象：Thread 可显示 `done · member:human` 或类似 debug 文案；Claim 是带完整边框的 article，Activity 是裸小字；没有 actor display name、时间和本地化动作语义。

建议：

- Message row：sender + kind + time + body。
- Activity row：低强调 icon/line + 本地化 actor/action/direction/time。
- opaque refs 只用于 identity lookup，不直接显示。
- Claim：compact work row，owner/direction/state 分列；presence dot 与 Claim state 分开。

### P1-5 mention picker 是常驻 checkbox fieldset

现象：每个 composer 上方永久铺一组 `@member` checkbox，内容多时会占据主输入面积，窄屏退化明显。

建议：`@` / mention button 打开 Menu，选择后在 composer 内/上方显示 compact recipient tokens；持久化仍提交 Member refs，不从纯文本解析。

### P1-6 rail 状态只显示一个 Team glyph，发现性不足

现象：sidebar collapsed 后 Team browsing region 几乎为空；虽然功能不溢出，但无法判断当前 Workspace/Channel/Agent context。

边界：不能复制 private WorkspaceBrowser rail。建议至少保留 public icon controls 与 Tooltip：当前 tab icon、create/open directory action、selected context hint；具体 rail 数量保持克制，不建立第二套 shell。

## 4. P2 Findings

### P2-1 Loading / polling error / retry 表达不足

- Thread `loading` state 没有稳定 skeleton/reserved surface。
- polling error 可能停止 loop，只留下底部红字，没有 retry/reconnect action。
- surface 切换虽有 key/remount 防 stale content，但 loading 时层级跳变明显。

建议：reserved loading rows、compact inline alert + retry；transport failure 与 Host validation error 分开文案。

### P2-2 Empty state 只有通用文本，没有上下文动作

Channel empty 应把 composer 保持可用并提示“发送第一条消息”；Workspace 无 Channel/Agent 时给当前 tab create action；无 Workspace 时给 public directory picker action。不要使用大 hero card。

### P2-3 Localization 与用户语言不完整

中文字典仍混用 Channels、Agents、Channel、Claims、Human、Agent；Activity/Task/Claim 可能直接输出 enum。应区分技术专名（Agent、Channel 可按产品决定保留）与内部状态枚举；所有 Activity 必须是完整用户文案。

### P2-4 Typography 由大量局部 `font-size` 拼成

`team.module.css` 多处直接写字号，没有系统使用 DSH typography variables 与成对 line-height。建议按 sidebar label、body、metadata、heading 四级收敛，不复制每个 first-party component 的私有 CSS 数值。

### P2-5 responsive 只有 Shell rail，没有 Team center reflow

当前 390×844 在等待 56px rail 动画后不溢出，但 header actions、claim grid、mentions 仍是缩窄桌面布局。建议：header action menu、Claim single-column/compact row、mention Menu、Modal body scroll、composer stable controls。

## 5. Accessibility Audit

已有：部分 `role=alert`、aria-current、label、Tooltip/StateDot 辅助文案。

缺口：

- raw icon/text button focus style不统一；
- Members fake dialog 的 focus/escape/return 不完整；
- tabs 需要完整 `tablist/tab/tabpanel`；
- Activity 需可读文案，不读 opaque ref；
- unavailable diagnostic 需 Tooltip/HoverCard + accessible text；
- narrow icon-only controls 必须有 label + Tooltip；
- stale/confirmation/poll error 需 live region。

## 6. 功能正确性与体验质量分离

### 已验证功能

- real Host/Client composition；
- Workspace/Member/Channel/Message/Thread/Claim/Task journey；
- bounded pagination / change refresh；
- idempotent retry / draft preservation / stale revision；
- SQLite replay；
- slot enter/leave/unload restore；
- desktop/narrow nonblank 与 no overflow。

### 尚未达到的体验质量

- 与 DSH 的 primitive/chrome 一致；
- 信息层级和工作密度；
- Modal/Menu/composer 的成熟交互；
- Activity/Claim 用户语义；
- narrow reflow 与 keyboard-only journey；
- shipped DSH reference 对照截图。

## 7. 推荐顺序

1. transcript/composer width axis 和 center grid；
2. public Button/Input/Modal/Menu/Tooltip migration；
3. compact sidebar rows + create modal；
4. Channel/Thread header；
5. Message/Activity/Claim presenter；
6. mentions Menu；
7. loading/error/empty/localization；
8. narrow reflow + keyboard/a11y + screenshot comparison。

不要从颜色和圆角开始；当前根问题是 surface 结构和 hierarchy。
