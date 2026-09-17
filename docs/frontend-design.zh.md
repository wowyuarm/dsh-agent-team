# Team Client 前端设计文档

[English](frontend-design.md) | 中文

本文记录 `packages/client-agent-team/src/client/` 的长期 UI 设计体系：设计原则、布局骨架、排版、颜色与身份、组件合同、交互模式、可访问性基线和验证流程。它只沉淀跨工作项稳定的决策与合同；进行中的工作项、短期问题和未实现的计划记录在 `.scratch/active/`，不进入本文。实现以源码和测试为准，文档与代码冲突时先修正文档。

## 设计原则

1. **优先复用 Harness 公共原语**（`@deepseek-ai/dsh-client-ui-primitives`）：`MarkdownText`、`Button`、`Pill`、`Modal`、`Tooltip`、`Input`、`StateDot`、图标，以及 `useDismissOnOutsidePointer`、`useAnchoredMaxHeight` 等 hook。Team 不重写这些能力；composer textarea 是唯一例外（`Input` 原语明确只做单行）。`MessageText` 已不在集合内——该原语在 0.1.5 被移除，`TeamMessage` 自行渲染纯文本正文、Markdown 委托给 `MarkdownText`。
2. **只用 DSH alias token 取色**，且只允许主题实际定义的名字（`@deepseek-ai/dsh-client-ui-theme` 的 `design-platform.css` 与 `gradient-shadow-text.css` 是唯一定义处）：文字 `--dsw-alias-label-*`、边框 `--dsw-alias-border-l1..l4`（+`l2-darkmode-thin`/`inverted*`）、背景 `--dsw-alias-bg-*` 与 `--dsw-alias-interactive-bg-*`、状态 `--dsw-alias-state-*`、阴影 `--dsw-shadow-lv1..lv3`、具体值 `--dsw-specific-*`。禁止凭印象引用主题不存在的 token——`var()` 对未定义变量会静默回退 initial，边框/背景直接隐形（2026-08 教训：`border-subtle`/`border-default`/`text-*`/`fill-tertiary`/`surface-primary` 曾整批不存在，时间线全部发丝线与 loading 点从未渲染过）。Team 自有变量只允许派生值（见头像色相）。
3. **聊天密度优先于 assistant 排版密度**：正文统一 14px 档；markdown 原语自带的标题/列表间距在本包内收紧。
4. **渐进披露**：默认状态安静（细边框、无底色），hover/focus 才提升反馈；次要信息用 tertiary 文字色。
5. **durable mutation 不做乐观更新**：提交失败保留输入并以 Host 报错为准；成功后从 Host 投影刷新（`mergeChannelView` 合并而非整体替换）。
6. **键盘与读屏基线不妥协**：所有自定义复合控件都有 role、aria 状态和完整键盘路径。

## 设计语言对齐（DSH 0.1.5）

Team Client 渲染在 shipped DSH 外壳内部，必须讲基础 UI 的设计语言。本节是**耐久合同**；可重复执行的机械审计是 `node scripts/audit-ui-parity.mjs`（任何可见 UI 改动后、每次 DSH 升级后都跑一次——其中的 shipped 参考 tripwire 会在 harness checkout 不再定义本对齐所依赖的原语时报警，提示重新核对基线）。

| 维度 | 规则 | shipped 参考 |
| --- | --- | --- |
| 纯图标控件 | 28×28 圆形，`border-radius: 999px`，`corner-shape: round`，透明底色，hover 用 `--dsw-alias-interactive-bg-hover-solid`（composer）/ `--dsw-alias-interactive-bg-hover`（侧栏） | `InputBar.module.css .add`、`SidebarRoot.module.css .iconButton` |
| 主圆形动作（发送/停止） | 34×34 圆形，`--dsw-alias-button-info-fill`，静态 `#fff` 图形，hover info-hover，disabled `opacity .4` + `cursor: default`，`translateY(-2px)` 座位补偿 | `InputBar.module.css .primary` |
| 列表行 | 8px 圆角；`aria-current="page"` 叶子行底色；hover `--dsw-alias-interactive-bg-hover` | `SidebarRoot.module.css .panelRow` |
| 队列/结果行（双行） | 整宽按钮，8px 圆角、左右 8px 内缩，每条事实独占一行、各自省略，hover `--dsw-alias-interactive-bg-hover`，焦点环内缩。字号分级两行：主体 14px/22px primary；来源/元信息 12px/18px tertiary，其中显著片段（频道名）提到 secondary 600；行内 `Task #N` 是 6px、11px/15px 的小胶囊。哪一行承载哪条事实，由该面自己的信息顺序决定。 | `ui-workspace/src/client/rows/Rows.module.css .searchResultRow`（8px 圆角、8px 内缩、整宽按钮、hover 底色、14px 标题 + 12px 元信息） |
| 胶囊与圆形 | 任何**实质无上限**的圆角——`border-radius: 50%`、`999px`，或等于盒子一半高度的 pill 圆角——都必须在同一条规则内配 `corner-shape: round`。平台把所有圆角面按 `superellipse(1.5)` 弯曲，会把正圆压成方圆、把胶囊两端切平；shipped 的全圆角块 100% 配对，审计对未配对者直接报错。 | `ui-theme/src/styles/corner-shape.css`；`Tag.module.css`、`StateDot.module.css`、`SidebarRoot.module.css .iconButton` |
| 计数徽标 | 读者看到的每一处计数共用一枚胶囊，声明只有一份，在 `countBadge.module.css .badge`：18px 高、`min-width: 18px`，`border-radius: 999px` 配 `box-sizing: border-box`（单字符保持正圆，不被 padding 撑成椭圆），底色 `--dsw-alias-state-business-primary`、文字 `--dsw-alias-label-primary-foreground`，为 0 隐藏、超过 99 显示 `99+`，数字挂在控件的可访问名（`aria-label`）上，不能只存在于视觉徽标里。 | `Tag.module.css`（只读胶囊语言）；`countBadge.module.css .badge` |
| 小胶囊 | 6px 圆角，`--dsw-alias-interactive-bg-hover` 底色 | `ReferenceChip.module.css .chip` |
| 控件间距 | composer/侧栏工具组内兄弟控件间距 12px | `InputBar.module.css .tools/.trailing` |
| 键盘焦点 | 可见焦点环：`outline: 2px solid var(--dsw-alias-label-primary)`；列表行 `outline-offset: -2px`，图标级控件 `1px`。`outline: none` 仅当同一条规则内有**环级替代**时才允许——outline、`box-shadow` 扩散、有边框控件的 `border-color`、文本控件的 `text-decoration`；只有底色/颜色属于 hover 反馈，不构成焦点指示（shipped 对小控件干脆保留 UA 默认环）。环色随控件含义：行与图标控件用 `label-primary`，composer/Thread 等输入邻接控件用 `business-primary`（shipped 把 business 锚定在输入、链接与表格滚动上）。豁免：`aria-activedescendant` listbox 行（mention 弹层）——焦点留在文本输入框，选中态由 `[aria-selected]` 呈现 | `SidebarRoot.module.css .panelRow:focus-visible`；`InputBar.module.css .add`（保留 UA 环，不写 `outline: none`） |
| 图标语义 | 图形沿用基础 UI 的含义：`+` = 命令菜单、回形针 = 附件、铅笔 = 编辑、向上箭头 = 发送。**禁止**把 shipped 图形挪作他用；也**禁止**只跟随上游重命名而不比对图形——被改名的符号可能携带不同图形（见 [dsh-release-compatibility.zh.md](dsh-release-compatibility.zh.md) §「DSH 0.1.6-alpha.1」） | `InputBar.tsx`（`+`）、`ui-conversation/…/apply.ts`（回形针） |
| 模式控件（composer） | 改变主操作**语义**的控件（「作为任务」）是**模式**而不是动作：它保留可见文字标签，与附件控件同处左侧分组，形态为 28px 高的 pill（24px 圆角、13/20px 字重 500、透明底色、hover `--dsw-alias-interactive-bg-hover`、`aria-pressed` 打开时 `--dsw-alias-button-primary-fill` + `--dsw-alias-label-primary-foreground`）。文字**只允许**在窄容器分支（`@container (max-width: 460px)`）里隐藏、绝不删除——该分支下 `aria-label`、`title`、`aria-pressed` 仍保证读屏与键盘可用 | `InputBar.module.css .row`（size container）、`ui-permission-presets/…/PermissionSelect.module.css`（带字模式 chip，同样 460px 收起标签；DSH 0.1.6 已将其移出 `ui-conversation`） |

一致性裁决按面记录在本文档（见下文各组件合同）：裁决为「接受偏差」时必须在对应小节写明原因——审计脚本报告机械偏差，文档拥有判断。

## 布局骨架

- 对话面（channel/thread）：`display:grid; grid-template-rows: auto 1fr auto`——header / 可滚动时间线 / composer 三段，`height:100%`，内部滚动 `overscroll-behavior: contain`。
- 内容列 `max-width: 880px` 居中；时间线左右 padding `clamp(18px, 3vw, 36px)`。
- 断点 `@media (max-width: 600px)` 收紧 padding、header 纵排；验收必须覆盖 390×844 无横向溢出。
- 侧栏由宿主 `sidebar` slot 决定宽窄（wide/rail 二态）；rail 模式下 Team 只渲染图标按钮列。
- Team 的 mode、Workspace、最后选中的 Channel/Thread 以及 Inbox 页位置（navigation 事实，不是未读事实）写入浏览器缓存；切回 Team 或刷新后恢复最后位置。未读和 Attention 不写入浏览器缓存。
- 欢迎态是独立居中 surface（eyebrow + h1 + 引导文案），不进入三段骨架。
- Thread 是导航终点；Task 只在存在时叠加为 header/card。taskful Thread 的头部将 `Task #N` 与状态 Pill 放在同一行（`.titleLine`），任务标题为副行；Claims 用公共 `DisclosureRow` 折叠为一行摘要，展开才渲染 Claim 列表；header 动作区只在 open 任务出现（验收/关闭），accepted 任务保留 header 重新打开主按钮。taskless Thread 显示 Thread 标题与唯一的「转为任务」动作，不显示状态、Claims 或 Task resolution controls。
- 关闭任务是终态：composer 槽位换成解释性提示条（`.closedBar/.closedNotice`，文案 + 唯一的重新打开动作），不再渲染禁用的输入框。taskless Thread 保持普通 reply composer。
- 频道页与 Thread 页对称：频道页有返回行（`backToChannels` 清除 `channelRef` 回到频道列表）；时间线空/加载态在自由空间内居中（`.emptySurface` + `margin:auto`）。
- 侧栏两个面板（Agents/Channels）都订阅 `{kind:'workspace'}` 变更；`TeamChangeStream` 在每个页面内按 scope 共享一个流式订阅，每次开场或重连基线都触发补读，之后响应匹配的通知。Channel 刷新成功后清除加载错误，不清除无关的操作错误。
- 发送幂等：Channel 顶层发送与 Thread reply 一致按 requestId 幂等。Channel composer 的「作为任务」是默认关闭的原生 pressed control（自绘 pill，选中态为 primary 底色，hover 不改变按压底色；形态与座位见设计语言表的「模式控件」行）；新发送显式携带 taskless 意图，选中时才原子创建 Task。`committed` 与确定性拒绝（如 `unread_required`、`stale_revision`）后换新 id；`confirmation_required` 保留同 id 续发同一操作；传输异常保留 id 以便安全重试（Host 按 requestId 去重并返回原结果）。成功发送后「作为任务」复位为关闭。

## 排版体系

| 元素 | 规格 |
| --- | --- |
| 页头 h1 | 20px/28px, weight 600 |
| 发送者名 | 13px/20px, weight 600, primary；右侧同行跟随时间元信息 |
| 消息时间 | 11px/20px, tertiary；当天 HH:mm，同年 MM-DD HH:mm，跨年完整日期（`formatMessageTime`，本地时区） |
| Inbox 行时间 | 11px/18px, tertiary, `tabular-nums`；今天只显示 `HH:mm`，上一个本地日历日显示「昨天 HH:mm」，更早回落消息时间形态，精确本地时刻挂在元素的 `title` 上。Thread 入口行的后续动态时间用的是同一个标签 |
| Human 正文 | 14px/22px（`.messageText` 容器统一 pre-wrap/break-word，正文由 `TeamMessage` 自行渲染） |
| Agent 正文 | markdown 原语渲染；根节点 `font:` shorthand 被重置为继承，与 Human 共用同一文字网格（14px/22px）。标题用聊天刻度（h1 17px、h2 16px、h3–h6 15px，margin 12px 0 4px），页面 h1 保持最高层级；段落/列表 margin 6px、`li + li` 间距 2px、strong 600；pre 8px 外边距 + 10px 12px 内边距、13px；表格 cell 纵向 padding 5px |
| 任务/活动行 | 11–12px, tertiary, 活动行居中 |
| Thread 入口行 | 12px/18px tertiary，`fit-content`；hover/focus-visible 只提亮文字并把 chevron 前推 2px |
| 入口状态簇 | 11px/18px，领起入口行：18px 头像圈、8px 状态点、状态词、18px 未读胶囊（11px/600） |
| 空/加载态 | 13px tertiary；加载点 8px 脉冲动画（reduced-motion 下关闭） |

消息时间来自 Host 投影：`AgentTeamMessage.occurredAt` 与包裹它的 ledger 操作同源（旧账本在回放时归一化）。分组 run 只在 run 头部渲染名字与时间；run 内被折叠的消息若与上一条间隔 ≥5 分钟（`team-separators.ts` 的 `RUN_GAP_MINUTES`，`isRunGap` 单一权威判断），由回合分隔线补回它的时刻（见下）。

## 颜色与身份

- **Agent 头像**：按 `memberId` 字符串哈希出稳定色相（`hash*31+charCode mod 360`），`hsl(var(--team-avatar-hue) 42% 46%)` 底 + 白色首字母；同一成员跨页面、跨会话颜色不变。侧栏 Agent 行复用同一身份语言（24px 缩版），presence 指示叠在头像右下角，描边环取 `--dsw-specific-sidebar-fill` 与侧栏底色同色。
- **Human 头像**：`--dsw-alias-state-business-primary` 强调底色，与所有 Agent 区分；DOM 上以 `[data-human]` 标记。
- **presence 圆点**：available=done 绿、working=ongoing、error 红、unavailable 用灰色叉点（`TeamPresenceDot` 的 `presenceDotState` 映射）。这一映射有两种呈现：凡是「把成员列成行」的地方都用 `TeamMemberAvatar` 的角标（首字母 + 右下角圆点），而 composer 的收件人菜单用裸 `TeamPresenceDot`——那是菜单行不是花名册行。所以花名册行统一靠头像角标、菜单保留圆点，这个不对称是有意的，不是遗漏。
- **Thread 入口头像叠放**：`TeamAvatarStack` 复用同一套色相哈希，但不挂 presence 圆点——它回答「谁在做这件事」，不回答「谁现在在线」。
- 错误一律 `--dsw-alias-state-error-primary` 并配 `role="alert"`。

## 组件合同

### TeamMessage（消息行）

- Props：`senderName`、`memberId`、`human`、`body`、可选 `occurredAt`（名字行时间元信息）、可选 `mentionHandles`（Human 正文中的 mention chip 集合）、可选 `senderTitle`（悬停显示成员描述）、`grouped`、`children`（渲染进 messageBody 尾部，承载入口行等扩展）。
- 分组规则：相邻两条同为消息且 sender 相同才折叠；活动行会打断 run。折叠行隐藏头像与名字（`visibility:hidden` 保持栅格对齐），padding 收紧为 `2px`。
- 头像首字母取 senderName 去掉 `@` 后首个字符大写。
- 超长正文折叠：display 字符数超过 `MESSAGE_COLLAPSE_CHARS`（`team-formatters.ts` 单一权威，600）的正文默认收进限高预览（约 8 行 / 176px，底部 alpha 渐隐遮罩，不涂主题底色），预览下方「展开全文」安静文本钮展开，展开后同位置「收起」收回（`aria-expanded` 翻转）。按钮独占一行，反馈是文字级的（变色 + 下划线，无底色框）；markdown 根节点的 `font: inherit` 重置选择器按后代匹配（`.messageBody .messageMarkdown > div:first-child`），夹具容器不得隔断它，否则预览字号会大于展开态。夹具容器对可折叠正文**常驻**、展开/收起只切换类名——不能出现/消失式包裹，那会重挂载 Markdown 子树并丢掉渲染后注入的 ref 链接与 mention chip。是否折叠只由正文本身决定——确定性默认，无需持久化，也不构成 Host 事实；夹具只包正文分支，run 分组、附件条、兜底 chip 行与 children 都在夹具外照常渲染，预览内 ref/mention 照常可点。

### 消息块（messageRun）

- 一个 run = 一次发言：同一 sender 连续的消息 + 其 Thread 入口行包进一个 `.messageRun` 块；活动行与未读边界打断 run。
- 日界同样打断 run：跨天的相邻消息之间插入居中的日期锚（`.daySeparator`，`MM-DD`，跨年用完整 `YYYY-MM-DD`，与消息时间的数字风格一致）。活动没有自己的时钟 instant，继承前一条消息的日界、不触发锚；时间线的第一条消息不带头部锚。分块逻辑统一在 `team-separators.ts` 的 `chunkRunsWithDays`（单一权威实现）。
- 块内分界：折叠行若自带 Thread 入口行（`.messageRow[data-grouped]` 且 `:has([data-thread-entry])`），上方画一条 border-l2 发丝线并稍增间距；普通文字接续不加线，避免整块被切碎。锚点是入口行自己的 `data-thread-entry`，不是「正文里的某个 button」——长文折叠的展开/收起钮与正文里渲染出的 Task ref 链接都是 button，按 button 认边界会误判。
- 回合分隔线（`TeamRunDivider`）：同一 sender 的相邻消息间隔 ≥5 分钟即视为两次独立发言（agent 长发布常间隔小时级，纯折叠会抹掉层次与时刻），run 保持一块，但两者之间渲染全宽 border-l2 发丝线 + 线下首行标注后一条消息的时间（`formatMessageTime` 同款格式，`role="separator"`，缩进对齐正文列 38px=头像 28+间距 10）；该线替代其后折叠行自带的入口行发丝线（相邻选择器覆盖），不叠双线。频道页与 Thread 页共用同一判断与组件。
- run 是纯分组块，无 hover 边框/底色/阴影、无常驻边框——回合分隔线、日界锚与未读线承担全部消息边界感，run 自身只保留块间 2px 垂直空隙（`margin: 2px` + `padding: 3px`），不给内容"加笼子"。

### Mention 与 Task ref 强调

- mention chip 渲染：Human 字面正文在字面分段时挂 chip，Agent plain-prose 正文复用同一条 `splitMentionNames` 分段，Agent 富 Markdown 正文则在公共 `MarkdownText` 渲染完成后于普通文字节点原位替换出 chip。三种路径都只挂 Message 已解析 mention 列表内的 handle（大小写不敏感、必须带 `@` 书写——裸名是正文、永不挂 chip，代码段落保持原文），且 effect 重跑不会对已生成的 chip 再包层；正文未出现的名字才落到尾部兜底 chip 行，不与内联 chip 重复。
- 已知的 branded Task ref（`task:*`）通过 Host 的 `resolveTaskRefs` 批量解析，在 Human 字面文本、Agent plain-prose 和 Agent 富 Markdown 的原出现位置渲染为可点击的 `Task #N`；不再在富 Markdown 正文下方重复补入口。富 Markdown 在公共 `MarkdownText` 完成渲染后替换普通文字节点和"整段恰好是一个 ref"的行内代码（模型把 ref 当标识符加反引号样式是常态）；代码围栏、缩进代码、混合内容的行内代码和已有链接保留原文。模型输出的双冒号/大写拼写（如 `task::…`）在 `splitBrandedRefs` 解析口统一归一化为 ledger 铸造的单冒号小写 ref 后再解析与导航。
- 点击当前视图未加载的 Task ref 时，Client 解析其所属 Workspace、Channel 和 Thread 后跨频道跳转；解析失败的 ref 保留为非导航原文。已解析链接用原始 ref 作为 tooltip。Task number（如 `Task #12`）是 Task 在其 home Channel 内的创建序号，Host 侧单一派生（`taskNumbers`），频道任务卡、Thread 标题、跨频道 ref 解析与 Agent inbox 标注共用同一口径；序号跨频道不唯一，稳定导航身份始终是 branded Task ref。

### 计数胶囊（count capsule）

- `TeamCountBadge.tsx` 配上 `countBadge.module.css .badge` 是**唯一**一枚计数胶囊，读者能看到的每一处计数都穿它：Channel feed 的 Thread 入口、以及 Inbox 队列行。同一套声明每面各写一份（共享之前就是如此），正是 feed 那一份落到与队列行不同的行盒、数字彼此差出一个像素的原因。侧栏「收件箱」入口**有意不在其列**：它把未读说成一个点而不是一个数字（见「Inbox（收件箱）」），因为读者扫侧栏问的是「有没有东西在等」，而数量随每一条 fact 变动、是**专门去问**才要的答案，所以它留在控件自己的可访问名里。
- 这份规则是：高 18px、`min-width: 18px` 配 `box-sizing: border-box`（平台没有全局 border-box reset，否则内边距会把一位数字撑成椭圆）、`border-radius: 999px` 配 `corner-shape: round`、`display: inline-flex` 双向居中、11px/600 配 `font-variant-numeric: tabular-nums`（两位计数不会推动墨迹）、`line-height: 18px`——行盒就取胶囊自己的高度，而不是各面碰巧继承到的值（一面的入口行继承 `normal`，另一面自己设了高度），再加 `flex: none`，座位被挤时 Inbox 行不会把圆圈压小。定位仍留在挂胶囊的那个面上（`className`），因为窄轨要把它钉在 36px 图标盒内。
- 计数为 0 不渲染任何东西：计数的缺失不是「一枚写着 0 的胶囊」。超过 99 显示 `99+`。`tone` 只换墨色：Thread 点名了这位读者时是实心底色，只是有新动静时用**完全相同的几何**画成 `--dsw-alias-border-l2` 发丝线——发丝线那 1px 边框从它自己的内边距里出（4px + 1px 就是实心那份的 5px），于是两种墨色在任何计数下都是同一个边框盒、同一个内容盒——同一 Thread 再次被点名时行不会跳动。`label` 决定计数如何抵达读屏：有 label 时胶囊是 `role="img"`，由它的可访问名与 `title` 承载数字；没有 label 时是 `aria-hidden`，因为外层控件已经说了这个数。
- 数字墨迹落在字体给它的位置上，而两个轴不是一回事。纵向墨迹居中；横向它落在盒中心偏右约半个像素处——十个数字都是同一个半像素，在本仓库的装配产物与 operator 自己那张（另一套字体栈的）截图里都量得到。这既不是布局造成的，也不是任何声明能改的：对胶囊自身的文本取 `Range`，advance 框正好落在盒中心（0.00px，两种墨色、十个数字皆然），所以剩下的只是字形墨迹在自己 advance 里的落点。规则真正负责的是「一个字符保持 18px 的盒子」——`min-width` 只是下限、内容仍能把它顶穿，这正是浏览器旅程读**实际盒子**而不是读声明的原因——以及「三处共用同一条规则、不会互相漂移」。`scripts/audit-ui-parity.mjs` 直接从这条规则上读这些声明，重新引入第二份拷贝会让审计报错。

### 成员花名册（member rosters）

- `TeamMemberRow.tsx` 是「画一个人」的唯一实现：`TeamMemberIdentity`（带 presence 角标的 `TeamMemberAvatar` + handle 与 description）加一个可选的 membership 动作。Channel 的「管理成员」弹层、编辑频道里的成员区、底栏只读成员列表都渲染它；侧栏 Agents 则把同一个 `TeamMemberIdentity` 放进自己的选择按钮里——所以同一批成员在不同面之间不会出现身份、字号或截断口径的漂移。
- 行是三轨网格：24px 头像、`minmax(0, 1fr)` 文案、`auto` 动作；8px 圆角、8px/10px 内边距、最小高度 40px，hover 用 `--dsw-alias-interactive-bg-hover`。handle 为 12px/18px、weight 500、主色；description 为 11px/16px、tertiary，且在文案轨内省略号截断，不去顶宽网格。
- 只读花名册不渲染动作，第三轨随之塌缩，把宽度还给 description，而不是留一个空洞。membership 动作是整行唯一的控件：一个 `Button size="sm" variant="outline"`，至少 64×28，标签在 添加/移除/更新中… 之间变化而外形不变；行自身的失败信息作为 `role="alert"` 渲染在行内文案轨下方。窄于 600px 时动作落到身份下方并与文案左对齐——被压窄的弹层放不下第三列。
- membership 语义跟随 Host：加入要求 `availability === 'active'`（Host 会拒绝其他 availability），退出只要求 membership 事实本身，所以已经加入但暂时不可用的成员仍然保留可用的 移除。
- 只有侧栏 Agents 在写法上不同：它像目录那样直呼 `builder`，其余花名册按 composer 的称呼写 `@builder`。

### 失败态呈现（failure surfaces）

- 投影失败的呈现只有两种，选哪一种等于声明「屏幕上还剩什么」。**整面失败**（从未加载出投影）用 `errorState`：与它所替代的 loading / empty 面共用同一份空白区居中（`margin: auto`、`padding: 32px 0`），保持在 880px 阅读列内，取 12px/18px 的 error 字号与 `--dsw-alias-state-error-primary`，内容是 Host message 加一个重新发起读取的 `重试`——message 与按钮同在一个 `role="alert"` 里。**行旁失败**（行还在）用内联 `error`：在内容列内 `margin: 0`，读作所属列表的最后一行，而不是让已有内容的面重新居中。
- 两种失败都不充当空态：空的判定要求「投影成功返回且确实为空」（`view !== undefined`、无 error、里面没有东西）。所以断连永远不会被读成「这个工作区是空的」。
- 侧栏用同一套形状的 rail 尺度：Panel 自身的失败行是 11px/16px 的 `--dsw-alias-state-error-primary`，左侧缩进 12px，使文字落在它所替代的行标签上（列表缩进 4px + 行缩进 8px），而不是落在 Panel 边缘；行自身的失败（`rowAlert`）在行内保持同一尺度。
- Panel 失败按 Panel 记：每个挂载中的 Panel 各自报告它看到的那次断连，所以一次断连会在侧栏出现同一条消息，正文自身读取也失败时再在页面上出现一次。
- Panel 失败行不带重试按钮：侧栏靠 change stream 自愈——断连只上报一次，传输恢复后唤醒全部 listener（见 [`architecture.md`](architecture.md)）。

### 时间线滚动（timeline-scroll）

- 策略：读者停留在底部（距底 <48px 视为 pinned）时跟随新内容；不在底部时不打扰。
- 确认合同：Thread 打开期间到达的事实一律自动做持久 `readThread` 确认（pinned 读者当场看见，滚离底部的读者由纯跳转提示引导回底），确认失败时回退为既有 error surface；不存在任何手动读取动作。
- 打开即清零：打开 Thread 直接滚动到最后一条；有界批次若返回剩余未读，Client 以串行循环自动续读（每轮 mint 新 requestId 复用 Host 幂等缓存语义），连续 50 轮未清零视为异常并显示错误提示。
- 前插更早历史时按 scrollHeight 差值补偿 scrollTop，视口内容不跳动。
- 跳转：`scrollToBottom` 立即滚到底部；「↓ N 条新更新」提示按钮只滚到底、无读取语义，读者回到底部即消失。
- contentKey 必须随渲染事实变化（当前用 `长度:末位factKey` 组合串）。

### Composer 与 @mention

- textarea 自增高（上限 336px），Channel / Thread composer 出现时自动聚焦且不滚动时间线；Enter 发送、Shift+Enter 换行；IME composition 期间 Enter 不触发发送。发送期间输入框保持聚焦但只读，避免重复提交；发送按钮点击不抢走焦点，发送完成后可直接继续输入。未关注成员的首次发送返回确认提醒时，保留草稿与收件人，输入框自动恢复焦点，第二次 Enter 可直接确认发送。composer 卡片沿用 DSH 默认静态边框，不因 `focus-within` 改色。
- mention 弹层向上展开，`role="listbox"`，textarea 以 `aria-controls/aria-activedescendant/aria-expanded` 关联；↑↓ 循环、Tab/Enter 接受候选、Escape 关闭；外点关闭复用 `useDismissOnOutsidePointer`；高度钳制复用 `useAnchoredMaxHeight`（cap 320px）。高亮行始终通过 `scrollIntoView`（`block: 'nearest'`）保持在弹层可视区内，成员多时键盘选中的候选不会被折叠隐藏。Thread 面通过 Human-only 的 `threadObservations` 读取（首屏并行一轮 + 每次 thread 域 wake）获取当前关注者集合，候选排序时关注者排在其余 roster 顺序之前——关注者收到直达投递，非关注者需要两次发送的邀请流程；Channel 面保持 roster 顺序。
- 接受候选后光标落点精确到插入文本之后；删除提及文本会同步收缩 recipients。
- Member Session 输入面即 shipped composer 本身，不做任何修改：Team 不注册任何成员会话的 composer 表面——无接管、无 trigger sources、无 dock 提示条。键盘合同、命令与引用菜单、附件与普通会话完全一致。
- 收件人提示行：通知集合非空时在草稿与工具栏之间渲染 quiet 提示行（`.notifyRow`，`composerNotify` 文案 + `{ids}` 句柄列表），发送前即可看到"将通知谁"。集合是菜单选中的 recipients 与正文手打 `@Handle` 的并集（`mentionedMemberIds` 从草稿派生，与 Host 同一套大小写不敏感、Unicode 词边界的规则），`@all` 按菜单的展开口径列出全部可投递成员；空集合不占位。派生集合只用于显示，不进发送 payload——Channel 之外的名字在正文里只是散文，作为显式 recipients 会被拒绝。
- 草稿缓存：draft/recipients 不在页面局部，而是按 `channel:<channelRef>` / `thread:<threadRef>` 键存入每 Client 上下文一份的 `TeamDraftStore`（`drafts.ts`，单一 localStorage 键 `dsh.agent-team.drafts.v1`，写穿持久化、按 savedAt 淘汰最旧 ~50 条）。切换视图或刷新后草稿与收件人原样恢复；发送提交成功即清除对应键，失败保留；Composer 挂载收敛会剔除不再匹配文本/已失效的收件人。Channel 的「作为任务」意图不进入草稿缓存：默认关闭，成功提交后再次复位关闭。
- taskless Thread 的「转为任务」是 Human-only durable mutation，不做乐观 overlay。成功后重新读取 Thread 与补充 Channel/Member 投影；unread/stale fence 时保留 Host 返回错误并重新读取相关事实。

### Thread / Task 入口行（channel 时间线内）

- 语义：每个 top-level 频道消息进入其 Thread 的唯一入口，形态是正文下方**一行**安静的行——既陈述状态，也负责开门。点击走 `selectThread`，不把 Task 作为独立导航层。`Task #N` 是 home Channel 内 durable Task creation 的展示编号，不是稳定身份；跨视图导航使用 branded Task ref。
- 方位（本条的硬约束）：入口的任何状态都**不放在身份行上**。一个 run 里的后续消息没有自己的身份行内容，状态簇停在那里只会孤零零地悬在行尾；而任何靠右的落点都要读者为真正想看的价值横穿整列。状态改为**领起入口行**——与上方正文同一个左缘，且整条 feed 的所有入口共用一个 x；shipped DSH 的行也是这么做的（`SkillRow` 折叠态的首位槽、`JobListAction` 触发钮「点在前、计数在后」）。
- 状态簇（`.stateCluster`）：taskful 入口依次是 Task **在办 Claim 的所有者头像叠放**、`taskStatusDot(status)` 对应的 8px `TeamStateDot`、本地化状态词——`in_progress`→ongoing、`in_review`→warning、`done`→done 走共享 `StateDot`，`todo` 是空心圆环、`closed` 是 tertiary 安静点，五个状态共用同一套形态语言。Claim 是 Host 事实而非装饰：只有 `in_progress`/`in_review` 的 Task 才有所有者，`released` 的 Claim 已不是工作，所有者按 Claim 顺序去重，done/closed 的 Task 不留叠放——那段历史状态词已经说完了。taskless 入口不虚构状态点。`TeamAvatarStack` 是 18px 交叠圆圈，用共享成员色相，最多 3 枚 + `+N` 一枚；圆圈本身是装饰，所以整个叠放是一个 `role="img"`，标签写出完整名单（`claimers`）。
- 入口行的其余部分：12px/18px tertiary、`fit-content`、自身无底色无边框——hover 与 `:focus-visible` 只把文字提亮到 primary 并把 chevron 前推 2px（120ms，reduced-motion 下关闭），焦点环 2px 主题色。状态之后接「这条入口是什么」：taskful 是 `Task #N`；taskless 在有后续动态时是本地化 Thread label，入口消息仍是最新事实时是 `replyAction`（回复）。有后续动态时追加 `· 最近活动 <HH:mm>`，与 Inbox 行同一个近度标签——今天就是裸时刻，只有「不是今天的第一天」才带日子词（`昨天 HH:mm`）——判据是 Host 的 `lastActivityAt` 不同于入口消息自己的 `occurredAt`，即「这条消息之后事情又动过」；精确本地时刻挂控件的 `title`。**消息计数已退场**：这里读者真正要行动的量是未读，不是正文有多少。390 窄列下入口行整体换行（`flex-wrap`）：门文案落到状态下一行，而不是把行撑出阅读列。
- 未读胶囊：计数「这条 Thread 上有多少需要**我**」的动态，也是 taskless 讨论唯一能携带的簇成员。数据来自频道本次 refresh 本就要发的 Workspace Inbox 整片未读——Host 的三类合并判断（我 follow 的 Thread 上的活动、提到我的、我的 Task/Claim 变化）才是权威；Client 用 `threadRef` join 进列表，**绝不**用 `item.mentions` 自行推导。未读为 0 是「没有徽标」而不是「显示 0」，超过 99 显示 `99+`。它就是共享计数胶囊（见「计数胶囊」），因此不会与侧栏入口、Inbox 行之间产生漂移。未读读取失败时**清空徽标**而不是展示读者已不能信任的计数，并按其他读取失败同样的 inline 失败行走文案。
- `aria-label` 依卡型与计数：未读为 0 用 `openTask`/`openThread`，带计数用 `openTaskUnread`/`openThreadUnread`。胶囊本身 `aria-hidden`，计数经这枚「开门」控件自己的 label 抵达读屏——这也正是把数字与它所属 Thread 绑在一起的通道。状态簇留在控件**外面**：带 label 的 button 会把后代从可访问性树上剪掉，放进去等于让所有者叠放自己的名字沉默。

### 状态胶囊与弹层

- Thread 状态用公共 `Pill`（与 `Task #N` 同行）；频道成员数与在线数等元信息用 `.headerMeta` 行内分隔（`memberCount` + `onlineCount`，error/unavailable 不计为在线）。
- Claims 折叠用公共 `DisclosureRow`（`expandOnRowClick`，标题 `Claims · N`），键盘闭环由原语保证；Claim 行缩进对齐标题文字。
- 所有弹层走公共 `Modal`：打开时焦点入内容区，关闭后焦点回到触发按钮（`queueMicrotask` 延迟聚焦模式）。

### 侧栏工作区浏览器

- 骨架：工作区列表与「频道」「Agents」两个常驻分区共用同款原生 button 折叠头（`TeamSidebarSection`，`aria-expanded`，默认展开）；「频道」「Agents」同处一个滚动容器，分区头右侧只放新增按钮。刻意保持安静：折叠头无 hover 底色，仅 chevron 变色反馈；不展示分区计数。折叠状态是本浏览器偏好：工作区分区全局一份，「频道」「Agents」按工作区分键，经 `sidebar-sections.ts` 写 localStorage（`dsh.agent-team.sidebar-sections`），刷新与重挂载后保持，不进 ledger。
- 行形态：频道行保留 `#` 标识；Agent 行复用头像语言并叠加 presence 角标。行内元数据（成员计数、presence 文字）已移除，保持列表简洁。
- 定位高亮单一化（对齐宿主会话树「父静叶亮」的惯例）：任一时刻侧栏只有一行携带 `aria-current='page'` 与 hover 底色——打开频道/Thread 时是频道行，成员会话视图打开时是被选 Agent 卡片（`.agentSelect[aria-current='page']`），否则是所选工作区的概览行；被浏览的工作区行其余时候保持安静，仅以 `data-selected` 让文件夹图标换成 open 形态并着 business 色（镜像宿主 `folderActive`），不再与叶子行同时点亮。嵌入的成员会话是唯一能压在「读者仍身处其上的 Team 面」之上的覆盖层——那可能是 Inbox 页，也可能是他打开该 Agent 时所处的频道/Thread——此时高亮归它自己的 Agent 卡片：下层那个面保留原位但不携带高亮，覆盖层关闭后原样取回（Inbox 入口同样如此，它的页面在屏上时才是被标记的那一行）。
- 行级 ⋯ 菜单：`TeamRowMenu` 复用公共 `Menu`（`portal` + `closeOnPointerLeave`，锚为裸 ellipsis 图标按钮），hover / focus-within / 菜单开启三种状态可见；菜单开启时该行钉住 hover 底色（`data-menu-open`）。菜单含「编辑」入口，打开对应编辑器；error 态成员额外出现「恢复」项，走 `recoverMember` Remote（Host 向该成员活跃会话 steer 续作 prompt，运行时动作、不落 ledger）。历史上的「从全新上下文开始」入口已移除——Member 经 `context_rollover` 工具自管上下文，Host 侧 clear-context Remote 保留为无可见入口的迁移逃生门。
- 频道编辑器（`编辑频道`）：名称/说明输入框 + 成员增删字段集。保存钮无改动即禁用（dirty 门），提交走 `updateChannel` Remote（幂等 request 同载荷复用），成功后由投影刷新回填行文案——不做乐观行内改名；成员增删仍走既有 join/remove Remote（request 按 方向+成员+频道 键复用）。
- Agent 编辑器（`编辑 Agent`）：名称/说明输入框 + 模型选择。模型选择复用公共 `Menu` 原语：触发钮呈 Input 形态（当前值 + 旋转 chevron），选项首行「跟随全局默认」，其后按 provider 分组标题 + 模型行、选中尾勾；目录经宿主级 `llm.models` 取得，不依赖任何活跃会话。提交走 `updateMember` Remote：缺省模型即清除覆盖（回到 Host 默认继承）；改模型对活跃成员原地更新 live model selection，保持 Agent 与 Session 身份不变，后续请求使用新选择；纯展示编辑不重启。Agent 创建流程没有频道选择页，Agent 编辑器没有成员区块——频道成员只在频道侧管理（创建对话框初始成员、频道编辑器成员行、成员管理对话框）；未入频道的 Member 仍可经 DM 触达。
- 引入入口（`从其他 Workspace 引入`）：创建对话框内的 disclosure 按钮，在新建与引入两个视图间切换；引入视图复用共享 `TeamMemberRow` 名册，仅列全局存在且尚未参与此处的 Member（含 suspended——加入不依赖可用性）；确认走持久 `joinWorkspace` Remote，失败保留弹层与请求以便重试（requestId 复用），成功后行经 workspace 重取出现。Agent 行上的破坏性动作按上下文分档：非创建 workspace 显示「从此 Workspace 撤回」（仅退出该参与，确认文案陈述其他 workspace 的工作、session 与私有记忆不受影响）；创建 workspace 显示「归档」（全量归档，多参与时注明同时从其他 N 个 workspace 收起）。Agent 行上刻意不加按 workspace 的归属徽标：参与关系通过在每个已参与 workspace 列表中的出现呈现（Host 参与投影），Client 不再叠加过滤。对话框主体只保留一条块节奏——模式切换按钮是它的第一个块，与它所切换的内容之间留 16px——而其中的名册保持共享的 2px 行距，说明行与加载/空态行走对话框自己的 12/18 说明标尺，这样引入 Member 时不会把同一份名册画成第二种密度、也不会让说明文字顶上标题的字号。
- Agent 卡片会话视图：Agent 行的头像与文案整体是选择按钮（`打开 {name} 的会话`），点击不再退出 Team 模式——导航快照保留当前 Channel/Thread，并叠加运行时字段 `memberSessionId`（附 `returnToSessionId`，均不持久化），再调用 `sessions.open(memberSessionId)`；`conversation` 影子此时让位，由 shipped 会话根在 Team 侧栏之间渲染该成员会话。任何显式 Team 导航（选工作区/频道/Thread）都会关闭成员视图并恢复该 Team 位置；页脚「对话」关闭成员视图、还原 `returnToSessionId` 后离开 Team，普通外壳不会停在成员会话里。Member 经 `context_rollover` 换新上下文时，Agents 面板观察该 Member 的旧→新 Session 绑定，仅在嵌入页正是被观察的旧 live Session id 时恰好跟随一次，归档视图不跳转。
- 窄屏 rail 三个图标按钮自上而下：收件箱（`IconQueueOutline14`，16px）→ 频道（`IconListPenOutline16`）→ Agents（`IconAgentPresetOutline16`）；不复用 checklist（任务）或 user（成员）图标。收件箱图标是目的地：点击打开 Inbox 页并请求展开侧栏；频道/Agents 图标点击请求展开侧栏并聚焦对应分区头部。
- 「收件箱」入口：宽栏是 Workspaces 节之上的一张卡片，窄轨是 rail 第一枚图标；两者用同一套方式标记未读——图标**左上角一个点**，数值取各可见 Workspace 的整片未读 Inbox 合计（mention 只是其中一类），为 0 时不渲染：没有未读就是没有这个记号，而不是画一个空点。点是 8px 的 `--dsw-alias-state-business-primary`——队列给「点名了这位读者」的 Thread 用的同一种实心墨，于是同一个颜色走到哪里都还是「这需要你」——外加 2px 所在表面的描边（`--team-mark-ring`：凡是自己上底色的表面都把它设成当下这层底色——卡片在悬停与当前页时、rail 按钮在悬停、聚焦与当前页时——取不到时回落 `--dsw-alias-bg-base`），因此它读起来是压在图标笔画上的一个记号，而不是与笔画糊在一起——卡片有底色时也一样。点挂在图标自己的包裹层（`.inboxMark`：`position: relative`、`flex: 0 0 16px`）上、两轴各 `-2px`，因此无论那枚图标坐在 34px 卡片里还是 36px rail 按钮里，点都落在同一个字形的同一个角上；在窄轨上它也始终留在 rail 区域会裁剪到的那个 36px 控件盒内部。数字没有消失，只是搬了家：宽窄两处的可访问名都报出它（`收件箱，6 条未读`，与点代表的是同一个合计），窄轨还把同一句作为悬停提示重复一次——数量只需一次 hover，侧栏本体永远不印数字。Inbox 页作为屏上面孔时卡片/图标携带 `aria-current='page'`，窄轨那枚图标还带上卡片同款当前页底色——rail 没有文字，底色是它唯一能说「你在这」的东西；被嵌入的成员会话覆盖期间它只是被记住的位置，不携带高亮。
- `TeamConversation` 第四个面：Thread | Channel | Inbox | welcome。选 Inbox 清掉 Channel/Thread 面；选 Workspace、Channel 或 Thread 清掉 Inbox。从 Inbox 行进入 Thread 后，Back 落在该行 Thread 的频道——Inbox 不进返回栈；再进 Inbox 走左侧卡片或窄轨图标。
- Inbox 页：页面走**共享对话座位**——与 Channel/Thread 相同的页头带、880px 居中阅读列、`clamp(18px, 3vw, 36px)` 边距与稳定 scrollbar gutter，切换面时内容列不位移。页头除 h1 外还有一行计数，形态是**分段而不是句子**——读者扫数字而不必解析从句：Thread 数、页面真正关心的整片未读数（primary 600 墨色，两侧保持 secondary）、以及提及总数（**仅当队列里真有提及时才出现**）；分段之间只靠间距分隔，窄座位换行时不会把标点拖到行首——每一段本来就自带单位词。对每个可见 Workspace 发一次 Inbox 调用，合并成 **Host 自己的行序**——先提及、再最新、Thread ref 破平——合并不能另起一套顺序：靠提及挤进截断线的行，合进来之后不能沉到更新、但没被提及的行下面（各 Workspace 切片本来就是这个顺序发到的）。页面按 Host 的两片渲染：上段「需要我」＝未读队列（页头那段计数只数它），下段「最近活跃」＝读者写过 Message 的 Thread——回复过的无论是否 follow 都算他的，自己发起、还没人回复的也算——按最新活跃降序、跨 Workspace 合计上限 5、与上段不重复——两段共用同一个行组件，下段的行没有未读计数（零＝不渲染胶囊，而不是渲染一枚写着 0 的胶囊），但**保留每一行都有的那条领起簇**：行是 grid，第一轨就是领起簇自己画出来的宽度再加行内 8px 间距，两段画哪个簇都取自同一条 Thread 事实、而不是段落给的，于是同一 Thread 在两段之间移动时不会换形状，而它画哪个簇是 Thread 自己的事实、不是段落给的；打开页不确认任何内容——打开页不是 read，只有点开行的 durable Thread read 清 marker 与徽标。行是整宽的 8px 圆角队列行，形态取自 shipped 双行结果行（左右 8px 内缩、共享 `--dsw-alias-interactive-bg-hover` 底色、焦点环内缩），排布是一个 grid，第一轨属于这条 Thread 上的人、宽度就等于它画出来的那个簇，加行内 8px 间距：领起簇挂在里面、每一行都有（无论有没有未读）——为计数预留的槽位在没有未读的 Thread 上永远是空的——行说的每一句都从它之后那一列起——身份行、它下方的摘要、以及上方的段标题共用同一条左缘（距行缘 34px）——每一行只画一张脸时如此，段标题也内缩到这一条；真带叠放的行按每多一张脸右移 12px，是它自己画出来的宽度，而不是别行为最宽簇预留的宽度，而改前一行有两条（计数与摘要 8px、溯源 34px）、段标题还有第三条。行承载 Human 定死的信息顺序：(0) 每行以**「谁在这条 Thread 上」**领起——Task 有活跃 Claim 所有者时画那套叠放，用 Channel feed 的原话（`claimers`）和同一条判定（见上文 Thread 入口行：未 released 的 Claim、Task 处于 in_progress/in_review、按 Claim 顺序去重）；没有活跃所有者时回落到这一行时刻背后的人（`newestActor`），因为那是关于这条 Thread 唯一已知的事。两者都由 Host 解析好，行不必自己拿 Member 名册，且同一 Thread 在两段里画的是同一个簇；(1) 身份行——频道用 13px/20 primary 600 领起，只有当屏幕上的行跨了不止一个 Workspace 时前面才加 `workspace / `（把同一个名字印满每一行，是拿行里最好读的位置去放一个常量；一旦第二个 Workspace 进入列表它自己就回来，因为那时两行必须还能分辨），taskful 时后面接同一枚发丝线 chip `Task #N`。这一行**保持为一个文本节点串**，分隔符本身就是独立文本节点，因为拆成多个样式化子项会丢掉控件可访问名里的空格；同时它用省略号压成一行：窄座位缩短溯源，而不是把一行折成三行，`overflow: hidden` 则保证比座位还宽的频道名不会把滚动条推进共享 timeline。身份是队列读者扫读的对象，所以由它承担整行的墨色；在改前，摘要拿着最重的墨、身份反而最轻，一页读下来是十段黑字而不是十个条目；(2) 计数胶囊收在身份行右端、与时刻相隔一个行内间距——共享计数胶囊（见「计数胶囊」）：Thread 点名了这位读者时是实心底色，只是有新动静时用**完全相同的几何**画成 `--dsw-alias-border-l2` 发丝线，于是两种未读共用一套语法、只靠墨色区分，Thread 再次被点名时行也不会跳动；计数超过 99 显示 `99+`，其中的提及拆分经胶囊自身的 label 抵达读屏与 hover——行的可见文本始终是 Thread 本身，不再有第二枚可见计数；(3) 下方的摘要——直接渲染 Host `previewText`（120 字帽），13px/20 secondary，落在身份行自己那一列、只占一行，因为它是身份的佐证，而不是这一行的主题；(4) 最新时刻跟在计数之后收在身份行末端，11px tertiary `tabular-nums`——今天就是裸 `HH:mm`（读者就在今天里，而把日子词印满每一行等于把标签的第一个词花在永远不变的那一段上），「不是今天的第一天」用「昨天 HH:mm」，更早回落消息时间形态（同年 `MM-DD HH:mm`、跨年完整日期），精确本地 `YYYY-MM-DD HH:mm` 挂在元素的 `title` 上。每个段标题自带本段的条数——队列的条数，以及被截到五条的「最近活跃」实际在屏上的条数——同样内缩到那条 34px 的列上，读者不必数行就知道这一段有多少。点击行选择该行 Workspace 并打开 Thread。空态讲**共享空态语言**（与 Channel/Thread 同一套 13px `strong` 标题 + 12px 提示），文案「收件箱是空的」+「你参与的 Thread 有新活动、或有人提到你时，会出现在这里」；loading/error/retry 复用共享对话类，后台刷新失败保留行并以 `role='alert'`、`--dsw-alias-state-error-primary` 报告。
- 刷新语义：Inbox 页打开时订一次无 scope 的 changes，唤醒重拉列表，离开即停；徽标同法订阅，唤醒只重拉合计（`limit: 1`），绝不拉列表。徽标还会在每次 durable Thread read 完成后直接刷新——Host 的 changes 对 read 刻意不唤醒（read 不改变任何共享 projection），但该 read 消费了读者自己的未读（含 mention marker）。

## 数据刷新语义

- channel 视图：change 事件触发 `refresh()` 时按 `messageRef` 去重合并新窗口与已加载历史（`mergeChannelView`），cursor 取更旧者，`hasMore = fresh.hasMore || current.cursor < fresh.cursor`。新窗口对它覆盖到的每条消息**权威**——change 唤醒必须让该行的活字段（Task 状态、最新时刻、未读）跟着新事实一起动——而更早加载的历史消息保留而不是丢弃。每次 refresh 还会读一次 Workspace Inbox 切片并据此重建「threadRef → 未读」映射；该读取失败则清空映射。
- thread 视图：被动事实合并进 currentFacts；打开与到达的读取全部自动推进 durable read pointer（有界批次余量由串行续读循环清零），`newFactsCount` 仅驱动纯跳转提示。
- `loadOlder` 有并发保护（loadingOlder 状态禁用按钮）。

## 文案与本地化

- 全部用户可见文案经 locale key（`locales.ts` zh/en 同构，key 类型取自 zh）。禁止在组件里拼接英文句子。
- 参数化 key 的约定：`{count}` 数量、`{ids}` 成员句柄列表、`{kind}` 内部种类、`{number}` 任务号、`{actor}`/`{direction}` 活动主体。
- 错误文案跟随 Host：有明确补救动作的拒绝走 locale key（`staleRevision`、`memberNotFollowing`），而 Client 无法更好地措辞的失败——例如传输断开——直接展示 Host 自己的 message。

> TODO：原始 transport message 应该换成本地化文案，还是保持 Host 的原话？当前各面是原样展示。

## 可访问性基线

- 侧栏分区折叠头是原生 button（`aria-expanded`），键盘 Enter/Space 由原生行为保证。
- 长消息的「展开全文/收起」是原生 button 并携带 `aria-expanded`，键盘 Enter/Space 原生可达。
- 行内 ⋯ 菜单按钮带 `aria-label`（`{name} 的操作`）与 `aria-expanded/haspopup`；菜单项由公共 `Menu` 提供完整键盘与外点关闭路径。
- listbox/option 完整键盘闭环（见 composer 一节）；Channel composer 的「作为任务」使用原生 button 的 `aria-pressed`，Space/Enter 均可切换。
- 图标按钮均有 aria-label；装饰元素 `aria-hidden`。
- Thread 入口的「开门」控件是一枚原生 button，label 同时携带 Thread 与它的未读数；旁边画出的胶囊 `aria-hidden`，头像叠放是单个带标签的 `role="img"`，且刻意留在按钮之外以保住它自己的可访问名。
- 消息时间线区域使用专用 `timelineLabel`（"消息时间线"），不误用频道/参与者标签；Thread 内部事实分组段不带重复的区域标签。
- 未读分界线 `role="separator"` 仅作信息展示（不再驱动滚动定位）；run 内回合分隔线同样 `role="separator"`，可访问名称即其标注的时刻。
- 新增可见 UI 必须通过 `npm run test:browser` 的桌面 1440×960、窄屏 390×844 和键盘检查（见 `development.md`）。

## 验证与演进流程

- 影响可见 UI、Client bundle、slot 或 Remote activation 的改动：`npm run typecheck && npm test && npm run lint && npm run build && npm run test:browser`。Thread-first 变更的 browser 验收还须覆盖默认 taskless 发送、default-off 「作为任务」键盘切换、promotion 后 Host reread、taskless header/Claim gating，以及桌面与 390×844。
- 截图写入 Git 忽略的 `artifacts/browser/`，仅供本次审查；少量能说明验收结论的代表图复制进 `.scratch/archive/YYYY-MM/<work>/validation/` 并附 README 说明。
- 本文档描述的行为变化必须在同一次改动中同步更新；历史设计来由归档到 `.scratch/archive/`，正式文档只链接不转述。
- CSS Module 里 TSX 引用了、但模块没定义的 class 会解析成 `undefined`，元素因此**无样式渲染**，且 build、类型检查、测试都不会报错。当某条规则的存在与否决定布局时，要到组装后的 bundle 里取证（computed style、offset 或截图），不要只读 TSX；把依赖它的状态写成断言，而不是写成注释。
