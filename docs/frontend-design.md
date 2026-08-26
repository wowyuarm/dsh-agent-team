# Team Client 前端设计文档

本文记录 `packages/client-agent-team/src/client/` 的长期 UI 设计体系：设计原则、布局骨架、排版、颜色与身份、组件合同、交互模式、可访问性基线和验证流程。它只沉淀跨工作项稳定的决策与合同；进行中的工作项、短期问题和未实现的计划记录在 `.scratch/active/`，不进入本文。实现以源码和测试为准，文档与代码冲突时先修正文档。

## 设计原则

1. **优先复用 Harness 公共原语**（`@deepseek-ai/dsh-client-ui-primitives`）：`MarkdownText`、`MessageText`、`Button`、`Pill`、`Modal`、`Tooltip`、`Input`、`StateDot`、图标，以及 `useDismissOnOutsidePointer`、`useAnchoredMaxHeight` 等 hook。Team 不重写这些能力；composer textarea 是唯一例外（`Input` 原语明确只做单行）。
2. **只用 DSH alias token 取色**，且只允许主题实际定义的名字（`@deepseek-ai/dsh-client-ui-theme` 的 `design-platform.css` 与 `gradient-shadow-text.css` 是唯一定义处）：文字 `--dsw-alias-label-*`、边框 `--dsw-alias-border-l1..l4`（+`l2-darkmode-thin`/`inverted*`）、背景 `--dsw-alias-bg-*` 与 `--dsw-alias-interactive-bg-*`、状态 `--dsw-alias-state-*`、阴影 `--dsw-shadow-lv1..lv3`、具体值 `--dsw-specific-*`。禁止凭印象引用主题不存在的 token——`var()` 对未定义变量会静默回退 initial，边框/背景直接隐形（2026-08 教训：`border-subtle`/`border-default`/`text-*`/`fill-tertiary`/`surface-primary` 曾整批不存在，时间线全部发丝线与 loading 点从未渲染过）。Team 自有变量只允许派生值（见头像色相）。
3. **聊天密度优先于 assistant 排版密度**：正文统一 14px 档；markdown 原语自带的标题/列表间距在本包内收紧。
4. **渐进披露**：默认状态安静（细边框、无底色），hover/focus 才提升反馈；次要信息用 tertiary 文字色。
5. **durable mutation 不做乐观更新**：提交失败保留输入并以 Host 报错为准；成功后从 Host 投影刷新（`mergeChannelView` 合并而非整体替换）。
6. **键盘与读屏基线不妥协**：所有自定义复合控件都有 role、aria 状态和完整键盘路径。

## 布局骨架

- 对话面（channel/thread）：`display:grid; grid-template-rows: auto 1fr auto`——header / 可滚动时间线 / composer 三段，`height:100%`，内部滚动 `overscroll-behavior: contain`。
- 内容列 `max-width: 880px` 居中；时间线左右 padding `clamp(18px, 3vw, 36px)`。
- 断点 `@media (max-width: 600px)` 收紧 padding、header 纵排；验收必须覆盖 390×844 无横向溢出。
- 侧栏由宿主 `sidebar` slot 决定宽窄（wide/rail 二态）；rail 模式下 Team 只渲染图标按钮列。
- Team 的 mode、Workspace 以及最后选中的 Channel/Thread 写入浏览器缓存；切回 Team 或刷新后恢复最后位置。未读和 Attention 不写入浏览器缓存。
- 欢迎态是独立居中 surface（eyebrow + h1 + 引导文案），不进入三段骨架。
- Thread 头部信息层级：`Task #N` 与状态 Pill 同一行（`.titleLine`），任务标题为副行；Claims 用公共 `DisclosureRow` 折叠为一行摘要，展开才渲染 Claim 列表；header 动作区只在 open 任务出现（验收/关闭），accepted 任务保留 header 重新打开主按钮。
- 关闭任务是终态：composer 槽位换成解释性提示条（`.closedBar/.closedNotice`，文案 + 唯一的重新打开动作），不再渲染禁用的输入框。
- 频道页与 Thread 页对称：频道页有返回行（`backToChannels` 清除 `channelRef` 回到频道列表）；时间线空/加载态在自由空间内居中（`.emptySurface` + `margin:auto`）。
- 侧栏两个面板（Agents/Channels）都订阅 `{kind:'workspace'}` 变更；共享的 `TeamChangeStream` 按 scope 复用一条长轮询，订阅方的首次探针静默采样版本（不唤醒），唤醒只来自停泊轮询的后续解析——这是既定契约（见 `team-changes.client.spec.ts`）。
- 发送幂等：Channel 顶层发送与 Thread reply 一致按 requestId 幂等。`committed` 与确定性拒绝（如 `member_not_following`）后换新 id；`confirmation_required` 保留同 id 续发同一操作；传输异常保留 id 以便安全重试（Host 按 requestId 去重并返回原结果）。

## 排版体系

| 元素 | 规格 |
| --- | --- |
| 页头 h1 | 20px/28px, weight 600 |
| 发送者名 | 13px/20px, weight 600, primary；右侧同行跟随时间元信息 |
| 消息时间 | 11px/20px, tertiary；当天 HH:mm，同年 MM-DD HH:mm，跨年完整日期（`formatMessageTime`，本地时区） |
| Human 正文 | 14px/22px（`.messageText` 容器统一 pre-wrap/break-word；无 mention 时直接渲染 `MessageText` 原语） |
| Agent 正文 | markdown 原语渲染；根节点 `font:` shorthand 被重置为继承，与 Human 共用同一文字网格（14px/22px）。标题用聊天刻度（h1 17px、h2 16px、h3–h6 15px，margin 12px 0 4px），页面 h1 保持最高层级；段落/列表 margin 6px、`li + li` 间距 2px、strong 600；pre 8px 外边距 + 10px 12px 内边距、13px；表格 cell 纵向 padding 5px |
| 任务/活动行 | 11–12px, tertiary, 活动行居中 |
| 空/加载态 | 13px tertiary；加载点 8px 脉冲动画（reduced-motion 下关闭） |

消息时间来自 Host 投影：`AgentTeamMessage.occurredAt` 与包裹它的 ledger 操作同源（旧账本在回放时归一化）。分组 run 只在 run 头部渲染名字与时间；run 内被折叠的消息若与上一条间隔 ≥5 分钟（`team-separators.ts` 的 `RUN_GAP_MINUTES`，`isRunGap` 单一权威判断），由回合分隔线补回它的时刻（见下）。

## 颜色与身份

- **Agent 头像**：按 `memberId` 字符串哈希出稳定色相（`hash*31+charCode mod 360`），`hsl(var(--team-avatar-hue) 42% 46%)` 底 + 白色首字母；同一成员跨页面、跨会话颜色不变。侧栏 Agent 行复用同一身份语言（24px 缩版），presence 指示叠在头像右下角，描边环取 `--dsw-specific-sidebar-fill` 与侧栏底色同色。
- **Human 头像**：`--dsw-alias-state-business-primary` 强调底色，与所有 Agent 区分；DOM 上以 `[data-human]` 标记。
- **presence 圆点**：available=done 绿、working=ongoing、error 红、unavailable 用灰色叉点（`TeamPresenceDot` 的 `presenceDotState` 映射，头像角标与独立圆点共用）。
- 错误一律 `--dsw-alias-state-error-primary` 并配 `role="alert"`。

## 组件合同

### TeamMessage（消息行）

- Props：`senderName`、`memberId`、`human`、`body`、可选 `occurredAt`（名字行时间元信息）、可选 `mentionHandles`（Human 正文中的 mention chip 集合）、可选 `senderTitle`（悬停显示成员描述）、`grouped`、`children`（渲染进 messageBody 尾部，承载任务卡等扩展）。
- 分组规则：相邻两条同为消息且 sender 相同才折叠；活动行会打断 run。折叠行隐藏头像与名字（`visibility:hidden` 保持栅格对齐），padding 收紧为 `2px`。
- 头像首字母取 senderName 去掉 `@` 后首个字符大写。

### 消息块（messageRun）

- 一个 run = 一次发言：同一 sender 连续的消息 + 其 Task 入口卡包进一个 `.messageRun` 块；活动行与未读边界打断 run。
- 日界同样打断 run：跨天的相邻消息之间插入居中的日期锚（`.daySeparator`，`MM-DD`，跨年用完整 `YYYY-MM-DD`，与消息时间的数字风格一致）。活动没有自己的时钟 instant，继承前一条消息的日界、不触发锚；时间线的第一条消息不带头部锚。分块逻辑统一在 `team-separators.ts` 的 `chunkRunsWithDays`（单一权威实现）。
- 块内分界：折叠行若自带 Task 入口卡（`.messageRow[data-grouped]` 且 `:has(.messageBody > button)`），上方画一条 border-l2 发丝线并稍增间距；普通文字接续不加线，避免整块被切碎。
- 回合分隔线（`TeamRunDivider`）：同一 sender 的相邻消息间隔 ≥5 分钟即视为两次独立发言（agent 长发布常间隔小时级，纯折叠会抹掉层次与时刻），run 保持一块，但两者之间渲染全宽 border-l3 发丝线 + 线下首行标注后一条消息的时间（`formatMessageTime` 同款格式，`role="separator"`，缩进对齐正文列 38px=头像 28+间距 10）；该线替代其后折叠行自带的任务卡发丝线（相邻选择器覆盖），不叠双线。频道页与 Thread 页共用同一判断与组件。
- hover 面合同：静止完全隐形（透明边框占位防抖动）；hover 只浮现一条细边框（border-l3），无底色无阴影——避免与块内 Task 入口卡自身的 hover 底色叠层；圆角 10px；水平用等量 padding/负 margin 向文字列两侧外扩 10px（窄屏 6px），文字永不位移；垂直方向块间保留 2px 空隙（`margin: 2px` + `padding: 3px`），相邻块的 hover 边框互不接触，同时让消息间距稍大。120ms 过渡，reduced-motion 下关闭。
- 不做常驻卡片边框——消息边界感只在指针交互时出现，避免"给内容加笼子"的刻意感。

### Mention 强调

- 仅 Human 字面正文渲染 mention chip：`splitMentions(text, handles)` 按 Channel 已知 handle 分段（大小写不敏感；前置为词字符的不算，如邮箱），chip 为主题色浅底 + 极淡阴影 + 圆角。
- Agent markdown 内 @handle 保持原样：markdown 原语无文本节点挂点，源级替换有破坏语法风险——已知限制，待原语提供钩子后再补。

### 时间线滚动（timeline-scroll）

- 策略：读者停留在底部（距底 <48px 视为 pinned）时跟随新内容；不在底部时不打扰。
- 确认合同：pinned 读者的被动到达直接做持久 `readThread` 确认（消息已在其眼前渲染，不再弹"新更新"提示）；非 pinned 时才计入显式的"读取 N 条新更新"。确认读取失败或被更新一次读取取代时回退到显式提示。
- 前插更早历史时按 scrollHeight 差值补偿 scrollTop，视口内容不跳动。
- 显式跳转：未读分界线跳转查询 `[data-thread-boundary]` 并留 12px 余量；"标记为已读"/"继续阅读" 分别触发 latest/boundary 跳转。
- contentKey 必须随渲染事实变化（当前用 `长度:末位factKey` 组合串）。

### Composer 与 @mention

- textarea 自增高（上限 180px），Channel / Thread composer 出现时自动聚焦且不滚动时间线；Enter 发送、Shift+Enter 换行；IME composition 期间 Enter 不触发发送。发送期间输入框保持聚焦但只读，避免重复提交；发送按钮点击不抢走焦点，发送完成后可直接继续输入。未关注成员的首次发送返回确认提醒时，保留草稿与收件人，输入框自动恢复焦点，第二次 Enter 可直接确认发送。composer 卡片沿用 DSH 默认静态边框，不因 `focus-within` 改色。
- mention 弹层向上展开，`role="listbox"`，textarea 以 `aria-controls/aria-activedescendant/aria-expanded` 关联；↑↓ 循环、Tab/Enter 接受候选、Escape 关闭；外点关闭复用 `useDismissOnOutsidePointer`；高度钳制复用 `useAnchoredMaxHeight`（cap 320px）。
- 接受候选后光标落点精确到插入文本之后；删除提及文本会同步收缩 recipients。
- 收件人显式化：recipients 非空时草稿与工具栏之间渲染 quiet 提示行（`.notifyRow`，`composerNotify` 文案 + `{ids}` 句柄列表），发送前即可看到"将通知谁"；空集合不占位。
- 草稿缓存：draft/recipients 不在页面局部，而是按 `channel:<channelRef>` / `thread:<threadRef>` 键存入每 Client 上下文一份的 `TeamDraftStore`（`drafts.ts`，单一 localStorage 键 `dsh.agent-team.drafts.v1`，写穿持久化、按 savedAt 淘汰最旧 ~50 条）。切换视图或刷新后草稿与收件人原样恢复；发送提交成功即清除对应键，失败保留；Composer 挂载收敛会剔除不再匹配文本/已失效的收件人。

### Task 入口卡（channel 时间线内）

- 语义：top-level 频道消息进入其 Task Thread 的唯一入口，展示 `Task #N`、任务状态与消息计数，点击触发 `selectThread`。
- 形态合同：fit-content 紧凑胶囊（细边框 quiet 默认态），内容 `状态点` · `Task #N`(600) · 状态 · 计数 · chevron 图标；箭头位置由内容流构造保证一致，不使用全宽拉伸。状态点用 `taskStatusDot` 映射，五个状态全有点、8px 固定座位保证各卡同轴：in_progress=ongoing 蓝圈、in_review=warning 琥珀、done=done 绿（复用 DSH `StateDot`，与 presence 同语言）；todo=空心圆环（未开始的空位）、closed=tertiary 灰实心点带 10% 光晕（镜像 StateDot 几何的 `.taskDotQuiet`）。hover/focus 渐进反馈：底色与边框提升、箭头右移 2px（120ms 过渡，reduced-motion 下关闭）；focus-visible 用主题色 outline。状态与计数用 tertiary 弱化，`aria-label` 带 `openTask` 文案。

### 状态胶囊与弹层

- Thread 状态用公共 `Pill`（与 `Task #N` 同行）；频道成员数与在线数等元信息用 `.headerMeta` 行内分隔（`memberCount` + `onlineCount`，error/unavailable 不计为在线）。
- Claims 折叠用公共 `DisclosureRow`（`expandOnRowClick`，标题 `Claims · N`），键盘闭环由原语保证；Claim 行缩进对齐标题文字。
- 所有弹层走公共 `Modal`：打开时焦点入内容区，关闭后焦点回到触发按钮（`queueMicrotask` 延迟聚焦模式）。

### 侧栏工作区浏览器

- 骨架：工作区列表 + 「频道」「Agents」两个常驻可折叠分区，同处一个滚动容器；分区头是原生 button 折叠头（`TeamSidebarSection`，`aria-expanded`），右侧只放新增按钮。刻意保持安静：折叠头无 hover 底色，仅 chevron 变色反馈；不展示分区计数。
- 行形态：频道行保留 `#` 标识；Agent 行复用头像语言并叠加 presence 角标。行内元数据（成员计数、presence 文字）已移除，保持列表简洁。
- 定位高亮单一化（对齐宿主会话树「父静叶亮」的惯例）：任一时刻侧栏只有一行携带 `aria-current='page'` 与 hover 底色——打开频道/Thread 时是频道行，成员会话视图打开时是被选 Agent 卡片（`.agentSelect[aria-current='page']`），否则是所选工作区的概览行；被浏览的工作区行其余时候保持安静，仅以 `data-selected` 让文件夹图标换成 open 形态并着 business 色（镜像宿主 `folderActive`），不再与叶子行同时点亮。
- 行级 ⋯ 菜单：`TeamRowMenu` 复用公共 `Menu`（`portal` + `closeOnPointerLeave`，锚为裸 ellipsis 图标按钮），hover / focus-within / 菜单开启三种状态可见；菜单开启时该行钉住 hover 底色（`data-menu-open`）。菜单含「编辑」入口，打开对应编辑器；error 态成员额外出现「恢复」项，走 `recoverMember` Remote（Host 向该成员活跃会话 steer 续作 prompt，运行时动作、不落 ledger）。
- 频道编辑器（`编辑频道`）：名称/说明输入框 + 成员增删字段集。保存钮无改动即禁用（dirty 门），提交走 `updateChannel` Remote（幂等 request 同载荷复用），成功后由投影刷新回填行文案——不做乐观行内改名；成员增删仍走既有 join/remove Remote（request 按 方向+成员+频道 键复用）。
- Agent 编辑器（`编辑 Agent`）：名称/说明输入框 + 模型选择 + 成员字段集。模型选择复用公共 `Menu` 原语：触发钮呈 Input 形态（当前值 + 旋转 chevron），选项首行「跟随全局默认」，其后按 provider 分组标题 + 模型行、选中尾勾；目录经宿主级 `llm.models` 取得，不依赖任何活跃会话。提交走 `updateMember` Remote：缺省模型即清除覆盖（回到 Host 默认继承）；改模型对活跃成员立即生效（Host 静默 dispose + 重激活，同 sessionId），纯展示编辑不重启。
- Agent 卡片会话视图：Agent 行的头像与文案整体是选择按钮（`打开 {name} 的会话`），点击不再退出 Team 模式——导航快照保留当前 Channel/Thread，并叠加运行时字段 `memberSessionId`（附 `returnToSessionId`，均不持久化），再调用 `sessions.open(memberSessionId)`；`conversation` 影子此时让位，由 shipped 会话根在 Team 侧栏之间渲染该成员会话。任何显式 Team 导航（选工作区/频道/Thread）都会关闭成员视图并恢复该 Team 位置；页脚「对话」关闭成员视图、还原 `returnToSessionId` 后离开 Team，普通外壳不会停在成员会话里。
- 窄屏 rail 保留两个图标按钮，点击请求展开侧栏并聚焦对应分区头部。

## 数据刷新语义

- channel 视图：change 事件触发 `refresh()` 时按 `messageRef` 去重合并新窗口与已加载历史（`mergeChannelView`），cursor 取更旧者，`hasMore = fresh.hasMore || current.cursor < fresh.cursor`。
- thread 视图：被动事实合并进 currentFacts 并累计 `newFactsCount`；显式读取动作（标记已读/继续阅读）才推进 durable read pointer。
- `loadOlder` 有并发保护（loadingOlder 状态禁用按钮）。

## 文案与本地化

- 全部用户可见文案经 locale key（`locales.ts` zh/en 同构，key 类型取自 zh）。禁止在组件里拼接英文句子。
- 参数化 key 的约定：`{count}` 数量、`{ids}` 成员句柄列表、`{kind}` 内部种类、`{number}` 任务号、`{actor}`/`{direction}` 活动主体。
- 错误信息展示原始 Host message（如 transport 错误），包装句用 locale key。

## 可访问性基线

- 侧栏分区折叠头是原生 button（`aria-expanded`），键盘 Enter/Space 由原生行为保证。
- 行内 ⋯ 菜单按钮带 `aria-label`（`{name} 的操作`）与 `aria-expanded/haspopup`；菜单项由公共 `Menu` 提供完整键盘与外点关闭路径。
- listbox/option 完整键盘闭环（见 composer 一节）。
- 图标按钮均有 aria-label；装饰元素 `aria-hidden`。
- 消息时间线区域使用专用 `timelineLabel`（"消息时间线"），不误用频道/参与者标签；Thread 内部事实分组段不带重复的区域标签。
- 未读分界线 `role="separator"` 且携带 `[data-thread-boundary]` 供滚动定位；run 内回合分隔线同样 `role="separator"`，可访问名称即其标注的时刻。
- 新增可见 UI 必须通过 `npm run test:browser` 的桌面 1440×960、窄屏 390×844 和键盘检查（见 `development.md`）。

## 验证与演进流程

- 影响可见 UI、Client bundle、slot 或 Remote activation 的改动：`npm run typecheck && npm test && npm run lint && npm run build && npm run test:browser`。
- 截图写入 Git 忽略的 `artifacts/browser/`，仅供本次审查；少量能说明验收结论的代表图复制进 `.scratch/archive/YYYY-MM/<work>/validation/` 并附 README 说明。
- 本文档描述的行为变化必须在同一次改动中同步更新；历史设计来由归档到 `.scratch/archive/`，正式文档只链接不转述。
