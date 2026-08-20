# Agent Team 协作 UI 模式研究

日期：2026-08-17  
范围：Slack、Linear、GitHub 官方文档与 GitHub Copilot / Linear Agents 官方文档  
目标：为 Agent Team M2 第一阶段确认可复用的协作 UI 模式，不复制产品品牌、主题或超出当前领域的功能。

## 1. 结论摘要

Agent Team 当前设计已经选中了成熟产品中最有价值的共同结构：

- **Workspace → Channel → Thread** 作为由宽到窄的导航层级；Channel 承载公开协作消息，Thread 承载单条工作事项的深入讨论。
- **Message 与 Activity 分开**：人类和 Agent 的明确消息是共享内容；状态变化、Claim、Task 操作是派生协作事实，不伪装成消息。
- **Task 具有稳定身份、状态和责任边界**：Channel 中快速扫描，Thread 中查看细节和执行状态操作。
- **Agent runtime presence 与任务状态分开**：运行中不等于已认领，错误也不等于任务失败。
- **结构化 @mention** 只从当前可见、可参与的成员中选择；显示名不是持久身份。
- **创建和管理集中在上下文入口**：Channel header 管理成员，侧栏 tab 的 `+` 创建当前类型，表单提交一次完成有约束的原子操作。
- **窄布局优先保留上下文和返回路径**：侧栏收起为 rail，手机端将导航和对话分层，不把所有信息压进一行。

M2 的限制也应继续保留：不引入搜索、URL 路由、Thread inbox、Agent DM、附件、slash commands、模型选择、第二套主题或客户端业务状态。

## 2. 研究范围与判断方法

“采用”表示该模式能直接服务 Agent Team 当前的 Workspace、Channel、Member、Message、Task、Thread、Claim、Follow、Delivery 和 Host 权威投影约束；“拒绝”表示模式本身成熟，但会扩大第一阶段领域、改变注意力模型，或与当前权威边界冲突。

官方产品文档描述的是产品行为，不是对 Agent Team 的一对一设计要求。以下结论优先采用多个产品都出现的稳定模式；单一产品的高级功能只作为后续候选，不作为 M2 需求。

## 3. Workspace 与 Channel 导航

### 3.1 观察到的成熟模式

**Slack：工作区、导航栏、侧栏和会话列表分层。** Slack 官方把 workspace switcher、navigation bar、sidebar 区分为不同层级；Home 下的 sidebar 列出 channels 和 DMs，并支持分组、排序、过滤、折叠为 icons only 或调整宽度。[Slack sidebar](https://slack.com/help/articles/212596808-Adjust-your-sidebar-preferences)

**Slack：Channel 是围绕共同目的组织人的地方。** 官方定义 Channel 用于把合适的人、工具和信息集中到一个项目或主题中；创建 Channel 先输入名称，再选择类型和成员流程。[Slack join a channel](https://slack.com/help/articles/205239967-Join-a-channel)、[Slack create a channel](https://slack.com/help/articles/201402297-Create-a-channel)

**Slack：Channel 的短描述放在上下文头部。** Slack 把 topic / description 作为说明会话用途的短文本，而不是在每条消息重复。[Slack channel topic and description](https://slack.com/help/articles/201654083-Set-a-conversation-topic-or-channel-description)

**Linear：workspace 是容器，team 是工作组织单位。** Linear 的 workspace 容纳 issues、teams 等内容；team 拥有自己的 workflow 和 issue 集合。[Linear concepts](https://linear.app/docs/conceptual-model)

### 3.2 对 Agent Team 的采用

- **采用 Workspace → Channels / Agents 两个 tab。** 这保持项目边界清晰：Channel 是协作场所，Agents 是该 Workspace 的成员目录；不把 Channel 混入默认 Session 树。
- **采用 Host registry 顺序。** 不复制 Slack 的用户自定义排序、过滤和隐藏规则；M2 已明确 Workspace 使用既有 Host registry 顺序，不新增排序模型。
- **采用 Channel header 的 name + description。** description 用于说明用途，消息行只显示发送者和 member kind，description 放 hover detail。
- **采用上下文内创建入口。** 当前 tab 右侧 `+` 打开创建面板；创建 Channel 表单包含 name、description、initial members，并由一次 Human operation 原子提交。
- **采用显式返回。** Thread 左上返回 Channel；Team 模式底部有“← 对话”，保留 DSH 外壳和当前 Session。

### 3.3 明确拒绝

- **拒绝把 Team Workspace 设计成第二套 DSH Workspace/Session 树。** Agent Team 的 Workspace 是项目/cwd 事实，不是新的聊天 Session 容器。
- **拒绝 Slack 式自定义 sections、recent-activity 排序、搜索和过滤。** 它们对大规模协作产品有价值，但当前 M2 没有搜索、排序或 unread inbox 的领域支持；加入会制造第二套导航事实。
- **拒绝 URL deep links 和浏览器 Back/Forward。** 当前合同要求 root-local navigation，Channel、Thread 和 tab 不持久化。
- **拒绝复制 Slack 的频道类型、公开/私有权限和管理员设置。** 当前 Channel 成员资格由 Host operation 和既有 authority 规则决定，第一阶段没有复杂角色权限模型。

## 4. Participants、presence 与身份

### 4.1 观察到的成熟模式

**Slack：availability dot 与 status message 是两个概念。** 官方明确区分：status 是一条说明当前情况的消息，availability 是名字旁的 active/away 点；availability 由活动状态推断，也可手动设置。[Slack status and availability](https://slack.com/help/articles/201864558-Set-your-Slack-status-and-availability)

**Linear：Agent 像 workspace 中的用户一样参与，但责任仍需单独表达。** Agent 可以被 mention、被分派、发表评论；Linear 还明确区分人类 assignee 与 Agent delegation，人的 primary ownership 不因 Agent 工作而消失。[Linear AI Agents](https://linear.app/docs/agents-in-linear)、[Linear assign and delegate](https://linear.app/docs/assigning-issues)

**GitHub：Agent 管理面提供集中状态与控制。** GitHub 的 Agents tab 用于发起、监控活动 session、查看 live logs、steer session，并在完成后进入 Pull Request review。[GitHub agent management](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/agent-management)

### 4.2 对 Agent Team 的采用

- **采用小型状态点，不在列表里重复状态文字。** available / working / error / unavailable 用 DSH semantic colors 和 accessible label；Tooltip 提供名称和诊断。
- **采用 presence 与 work state 分离。** runtime status 只表达进程投影；Claim owner、Direction、active/done/released 和 Task status 单独显示。一个 Agent 可以 working 但没有当前 Claim，也可以有 active Claim 但 runtime 暂时 unavailable。
- **采用稳定的 machine identity。** mention 和 membership 持久化 `memberRef`，不持久化 name；同一 Workspace 内 name 唯一，不建立跨 Workspace persona。
- **采用参与成员的轻量上下文。** Thread 中显示参与成员、member kind、runtime dot、Claim owner 和 Claim state；不显示内部 session events、tool calls 或 reasoning。
- **采用失败可见且可恢复。** Agent error 保留到下一次 loop 启动；creating 是本地 pending UI，creating/unavailable 不进入 Channel membership picker。

### 4.3 明确拒绝

- **拒绝 Slack 的手工 away/status 文案。** Agent runtime status 是 Host 进程投影，不是用户自填状态，也不写入 Team ledger。
- **拒绝 GitHub Agent management 的 live session logs、thought process、steering。** 当前 Channel/Thread 明确排除内部 session events；Host authority 只向 Client 提供不可变协作投影和 runtime status。
- **拒绝 Linear 的 workspace-wide installed agent / team access 管理。** M2 Agent 固定绑定一个 Workspace，使用 shipped preset 和 Host default model；不暴露安装、provider、model 或 guidance 管理。
- **拒绝把 agent 名称当作全局身份。** Agent 不具有人格或跨 Workspace 身份，`memberRef` 才是稳定身份。

## 5. Message、Activity 与 Thread

### 5.1 观察到的成熟模式

**Slack：Thread 用来避免 Channel 混乱。** 官方说明 Thread 围绕特定消息组织详细讨论，不把细节继续堆进 Channel；用户从原消息打开 Thread，回复可选择是否回显到主 Channel。[Slack threads](https://slack.com/help/articles/115000769927-Use-threads-to-organize-discussions)

**Linear：评论和 threaded replies 是 issue 内的协作层。** Linear issue 有 comment 输入框；评论可以建立 thread，thread 可以 resolved，以表示问题已回答或决定已形成。[Linear comments and reactions](https://linear.app/docs/comment-on-issues)

**Linear：Activity 是按日期记录的变化，不是普通评论。** My Issues 的 Activity 单独列出 issue created、updated、state changed、commented、reaction、opened pull request 等事件。[Linear My Issues](https://linear.app/docs/my-issues)

**GitHub：Issue/PR 页面把讨论、状态和 review 操作分成不同区域。** Issue 负责持续协作；PR review 在 Files changed 中逐文件评论，pending comments 在提交 review 前只对自己可见，最终通过 Comment / Approve / Request changes 提交明确结果。[GitHub review changes](https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/reviewing-proposed-changes-in-a-pull-request)

### 5.2 对 Agent Team 的采用

- **采用 Message 与 Activity 的语义分离。** Channel/Thread 只显示显式 Message 和相关协作 Activity；不显示任意成员的内部 session events。
- **采用“一条顶层 Message 对应一个 Task”的扫描结构。** Channel 中显示 message、Task number、派生 status 和 Thread message count；点击 footer 进入 Thread。
- **采用独立 Thread 页面，而不是把所有状态控制塞进消息行。** Thread header 放 Task accept/close/reopen 和 Claim done/release；正文展示消息与相关 Activity。
- **采用同一 Message layout 给 Human 和 Agent。** 发送者首字符、name、member kind 和正文结构一致；区别来自 member kind 和状态点，而不是两套卡片。
- **采用 bounded history + load older。** Slack/Linear 的 thread 入口证明“按上下文深入”比在主列表展示全部内容更清楚；Agent Team 进一步按 ledger sequence 游标加载最新 bounded page，再按需读取旧事实。
- **采用明确的 stale revision 处理。** Host 拒绝旧 revision 时刷新 Thread，不自动重放 Human 输入，避免把失败意图隐式重复提交。

### 5.3 明确拒绝

- **拒绝 Slack 的“reply 也可回显主 Channel”选项。** Agent Team 每条顶层 Message 固定创建 Task，Thread reply 不复制到 Channel，避免一条协作事实出现两个可误读位置。
- **拒绝 Linear 的 reactions、附件、inline comments 和 AI summaries。** 它们不是 M2 核心闭环；当前 spec 明确延期附件和 prompt 设计，也没有 reaction 或摘要事实。
- **拒绝 GitHub 的逐行 diff review 模式。** Agent Team 当前没有 code diff / file review domain；只借用“待提交内容与最终状态操作分开”的原则，不引入 Files changed、Viewed 或 review approval。
- **拒绝把 ledger operation event 原样渲染成时间线。** Client 只能拉 Host 的 immutable projection；operation event 是权威输入，不是用户界面中的第二种内部日志。

## 6. Task、Claim、状态与责任

### 6.1 观察到的成熟模式

**Linear：Issue 是稳定工作单位，状态属于 workflow。** Issue 有唯一 ID，属于一个 team，拥有 status、assignee、comments 等属性；workflow status 用于列表分组和 board 列。[Linear concepts](https://linear.app/docs/conceptual-model)、[Linear create issues](https://linear.app/docs/creating-issues)

**Linear：单一 owner 清晰表达责任，Agent delegation 不替代人类 owner。** 官方说明 issue 一次分配给一个人以保持责任明确；Agent 可以被 delegate，但 human assignee 仍负责。[Linear assign and delegate](https://linear.app/docs/assigning-issues)

**GitHub：层级任务用父子关系和完成进度表达。** Sub-issues 在父 issue 下展示，显示 `1/3 (33%)` 等完成进度，并能从子 issue header 回到 parent。[GitHub browsing sub-issues](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/browsing-sub-issues)

**GitHub Copilot：Agent task 使用有限、可查询的状态集合。** 官方 API 示例把 task state 作为可查询字段，包含 queued、in_progress、completed、failed、idle、waiting_for_user、timed_out、cancelled。[GitHub cloud agent API](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/use-cloud-agent-via-the-api)

### 6.2 对 Agent Team 的采用

- **采用稳定 Task number。** Task number 在 Channel footer 和 Thread header 中保持一致，作为人类可引用的工作身份。
- **采用 Task status 与 Claim state 两层。** Task 是 Human 可 accept/close/reopen 的工作结果；Claim 是 Agent 协作方向和执行占用。不能用一个“working”标签代替两者。
- **采用 owner / direction / state 分列。** Thread participant 区显示 Claim owner、Direction 和 active/done/released；runtime dot 另行显示 Agent 当前进程状态。
- **采用从列表扫描到详情操作的层次。** Channel footer 只显示编号、派生状态、回复数；状态操作集中在 Thread header，防止列表中误触或信息过密。
- **采用保留历史。** 移除 Member 时清理其 active Claims、Follows、queued Deliveries，但保留历史 Message/Activity/Task/Thread；这与成熟 issue 系统保留讨论与历史的原则一致。
- **采用有限状态和可查询投影。** UI 不自行推断状态，不把异步过程做成假 optimistic fact；durable mutation 只有 Host commit 后才显示。

### 6.3 明确拒绝

- **拒绝 GitHub 的多 assignee 模式。** Agent Team 的成员参与、Claim owner 和 Human authority 已有明确规则；不把多个 assignee 当作解决并行协作的通用办法。
- **拒绝 GitHub 的 sub-issue 多层级树。** M2 只有 Message → Task → Thread，未定义 nested tasks；引入层级任务会改变 ledger domain。
- **拒绝 Linear 的 priority、labels、cycles、projects、triage 和 custom views。** 这些是成熟 issue tracker 的规划层，不是 Agent Team 当前 domain。
- **拒绝把 Agent task 的 queued/waiting/timed-out 等外部状态完整搬入 Member runtime 状态。** 当前 runtime 状态合同只有 available、working、error、unavailable；Task/Claim 使用自己的派生状态。

## 7. Composer 与 @mention

### 7.1 观察到的成熟模式

**Slack：输入 `@` 后从成员列表选择，并用 mention 触发通知。** 官方流程是输入 `@`、输入名字或从候选列表选择；候选存在重名时要求进一步选择。Mention 的通知语义取决于 Channel / DM 成员资格。[Slack mentions](https://slack.com/help/articles/205240127-Use-mentions-in-Slack)

**Slack：未发送内容自动保存为 draft。** 发送消息页面说明，开始写但未发送的消息会保存到 Drafts & sent，并可以重新打开。[Slack send and read](https://slack.com/help/articles/201457107-Send-and-read-messages)

**Linear：评论框是明确提交动作，未发送内容保留。** Linear comment 需要点击 Comment 或使用快捷键提交；未发送评论在 issue 和 Drafts 中可见。[Linear comments](https://linear.app/docs/comment-on-issues)

**Linear：创建表单支持 modal / full-screen 两种密度。** 常用创建动作可以用 modal 打开，复杂创建可进入 full-screen；创建 issue 需要 title 和 status，其他属性可选。[Linear create issues](https://linear.app/docs/creating-issues)

### 7.2 对 Agent Team 的采用

- **采用结构化 mention token。** 输入 `@` 显示当前 Channel Members，选择后保存 `memberRef`；不根据纯文本名字推断收件人。
- **采用 DSH composer 的键盘、focus、disabled 和主题约定。** Team composer 只提供 text、structured mention、Send，保持与现有 DSH 的交互一致。
- **采用失败保留 draft。** Send 失败时保留用户输入；Host 没有 commit 的 durable fact 不显示为已发送消息。
- **采用小型上下文表单。** Channel create 面板只收 name、description、initial members；Agent create 只收 name、description；不把 model/provider/preset 等未交付配置塞入表单。
- **采用候选范围约束。** mention 与 membership picker 只看当前 Workspace/Channel 合法成员；creating/unavailable 禁用或不可选。

### 7.3 明确拒绝

- **拒绝 Slack 的 `@channel`、`@here`、`@everyone` 广播 mention。** 当前 spec 只允许 Channel Members 的结构化 memberRef，不新增广播通知和大范围权限语义。
- **拒绝 slash commands、attachments、emoji、formatting、schedule、model controls 和 permission controls。** Slack/Linear 的完整 composer 很成熟，但与第一阶段“只实现 text、mention、Send”的边界冲突。
- **拒绝 Linear 的 command menu / global shortcut 作为必需入口。** 它们可作为将来可访问性增强，但 M2 不新增 command menu、搜索和 URL create flow。
- **拒绝 optimistic message bubble。** Slack/Linear 可以对成熟产品做本地 draft 或即时交互；Agent Team 的 durable facts 必须等 Host commit，避免 UI 与 ledger 分叉。

## 8. Create / manage surfaces

### 8.1 观察到的成熟模式

- Slack 在 Channel header 管理 topic、description、通知与成员相关设置；Channel creation 从导航中的 `+` 进入。[Slack create channel](https://slack.com/help/articles/201402297-Create-a-channel)、[Slack topic/description](https://slack.com/help/articles/201654083-Set-a-conversation-topic-or-channel-description)
- Linear 在 issue header / properties sidebar 修改 status、assignee 等属性；创建 issue 用集中 modal，复杂创建可 full-screen。[Linear create issues](https://linear.app/docs/creating-issues)、[Linear assign and delegate](https://linear.app/docs/assigning-issues)
- GitHub 在 issue / PR 右侧 sidebar 放 assignees、labels、project 等上下文属性；review 最终操作集中到 Submit review。[GitHub issue quickstart](https://docs.github.com/en/issues/tracking-your-work-with-issues/quickstart)、[GitHub review changes](https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/reviewing-proposed-changes-in-a-pull-request)

### 8.2 对 Agent Team 的采用

- **采用按上下文放置管理入口。** Channel header 管 membership；Thread header 放 Task 和 Claim 的 Human authority 操作；不在 sidebar 做全局管理矩阵。
- **采用原子提交表单。** Channel name、description、initialMemberRefs 一次提交，任一 Member 非法则全部失败；这比先创建再逐个加入更符合 Host ledger 约束。
- **采用只读全局成员 Modal。** “成员”放在 Team 全局而不是某个 Workspace tab，按 Workspace 分组；第一阶段只查看，不提供 DM、搜索或管理。
- **采用权限收窄的具体操作。** Human 可对具体 Claim done/release，可对 Task accept/close/reopen；不可替 Agent 新建 Claim，也不直接改 Agent Follow。
- **采用显式 pending / error。** 表单本地 pending，提交结果由 Host projection 决定；失败显示可理解的错误并保留输入。

### 8.3 明确拒绝

- **拒绝 GitHub / Linear 的大量可编辑属性 sidebar。** Agent Team 没有 labels、priority、milestones、projects、cycles 等属性，不创建空的“通用属性面板”。
- **拒绝通用 command palette、批量编辑和全局管理页。** 当前 domain 没有批量 mutation 或搜索需求；通用入口会让 authority 边界不清。
- **拒绝允许 Human 直接代 Agent 改 Follow 或新建 Claim。** 成熟产品的快捷操作不能越过 Agent Team 的 Human/Agent authority 分界。

## 9. 窄布局与 mobile / rail

### 9.1 观察到的成熟模式

**Slack：桌面侧栏可调宽、icons only；移动端把 Home 作为会话列表。** 官方文档描述桌面 sidebar 可调宽或只显示图标；移动端 Home 提供 conversations，并把 Threads、Drafts & sent 等放在顶部快捷入口。[Slack sidebar](https://slack.com/help/articles/212596808-Adjust-your-sidebar-preferences)、[Slack send and read](https://slack.com/help/articles/201457107-Send-and-read-messages)、[Slack mobile customization](https://slack.com/help/articles/29788684062739-Customize-the-Slack-mobile-app)

**GitHub review：主内容和辅助上下文分区。** Pull Request 的 Files changed、file tree、review sidebar 和 progress bar 分担不同任务；用户可以逐文件折叠和追踪已查看内容。[GitHub review changes](https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/reviewing-proposed-changes-in-a-pull-request)

**Linear：issue 详情把核心内容与 properties sidebar 分开。** Issue 的正文、评论、thread 与状态/责任属性并列，但各自有清晰职责。[Linear concepts](https://linear.app/docs/conceptual-model)、[Linear comments](https://linear.app/docs/comment-on-issues)

### 9.2 对 Agent Team 的采用

- **采用 DSH shell 不变、Team 内容替换内部 seat。** 保留品牌栏和 collapse control；Team 只接管 sidebar body、center conversation 和 Settings seat。
- **采用 collapsed rail 只保留 shell controls 和 Team/返回入口。** 收起时隐藏 Workspace、Channel、Agent 行，展开后恢复目录；这避免窄宽度下文字溢出。
- **采用单列窄布局的优先级：上下文标题 > 消息正文 > composer。** Channel header 的描述可折叠/截断并用 hover detail；Task footer 保持可点击但不强行显示所有 Claim 细节。
- **采用 Thread 的返回路径而非并排永久双栏。** 第一阶段 Thread 用中心列替换 Channel，左上显示返回 Channel；不引入 Slack 独立窗口或 GitHub 多面板 review 工作区。
- **采用固定底部 composer。** 输入区在 Channel/Thread 底部，正文区域独立滚动；窄屏只保留 mention、text、Send。
- **采用列表中的 compact identity。** 首字符、短 name、member kind、状态点足够识别，不建立 avatar 图片和宽 profile card。
- **验收采用 desktop + narrow/mobile snapshot。** 重点检查无重叠、无溢出、状态点可辨识、collapse/restore 可用。

### 9.3 明确拒绝

- **拒绝 Slack 独立 Thread window。** 它适合桌面多窗口，但当前 Team 不增加并行窗口、URL 或额外导航状态。
- **拒绝 GitHub 的 file tree / review progress bar。** Agent Team 没有文件 review 工作流；只借用分区和折叠的密度原则。
- **拒绝在窄屏强行保留 Workspace、Channel、participants、Claims 全部同时可见。** 这会破坏当前“同一中心列、显式返回、bounded projection”的简化模型。
- **拒绝为 mobile 添加第二套交互或移动专用状态模型。** 只做 responsive layout，复用 DSH primitives 和同一 Host projection。

## 10. 最终采用清单（M2 可直接作为验收基线）

1. Workspace 是项目/cwd 事实；Team sidebar 不混入 Session tree。
2. Workspace 下提供 Channels / Agents tab，Channels 默认打开，使用 Host registry 顺序。
3. Channel header 显示 name + description；Channel header 管 membership。
4. 每条顶层 Message 固定创建 Task；Channel footer 只显示 Task number、派生 status、Thread count。
5. Thread 是独立中心页面，左上返回 Channel；Task 操作在 header，Claim 细节在正文上下文。
6. Human / Agent Message 共享布局；内部 reasoning、tool call、session event 不进入协作面。
7. Agent runtime dot 与 Claim/Task state 分开；状态点有 Tooltip 和 accessible text。
8. `@` 候选只来自当前 Channel Members；持久化 memberRef；不支持广播 mention。
9. Channel/Agent create 采用小型上下文表单；Channel 初始成员原子提交。
10. durable mutations 等 Host commit；失败保留 draft，不显示不存在的业务事实。
11. 初始加载最新 bounded page，向上按 ledger sequence load older。
12. sidebar collapse 成 rail；窄屏保持 header、正文、composer 的单列优先级。
13. Team mode 只 shadow 三个明确 seat，退出/unload 后 shipped DSH occupants 恢复。

## 11. 最终拒绝清单（避免范围漂移）

- Session view 模拟 Channel。
- 通用 mode registry、通用属性 sidebar、复制 DSH 核心目录 UI。
- Search、custom sorting、URL deep links、browser history。
- Agent DM、Thread inbox、unread gating、跨 Workspace Agent persona。
- Attachments、reactions、slash commands、formatting、scheduling、model/provider/preset controls。
- GitHub 式 sub-issue hierarchy、multi-assignee、line-level code review。
- Slack 式 `@channel` / `@here` / `@everyone` 广播。
- live internal session logs、thought process、steering controls。
- optimistic durable facts、offline mutation queue、复杂 role/permission 系统。

## 12. 来源索引

### Slack

- [Adjust your sidebar preferences](https://slack.com/help/articles/212596808-Adjust-your-sidebar-preferences)
- [Join a channel](https://slack.com/help/articles/205239967-Join-a-channel)
- [Create a channel](https://slack.com/help/articles/201402297-Create-a-channel)
- [Set a conversation topic or channel description](https://slack.com/help/articles/201654083-Set-a-conversation-topic-or-channel-description)
- [Use threads to organize discussions](https://slack.com/help/articles/115000769927-Use-threads-to-organize-discussions)
- [Use mentions in Slack](https://slack.com/help/articles/205240127-Use-mentions-in-Slack)
- [Send and read messages](https://slack.com/help/articles/201457107-Send-and-read-messages)
- [Set your Slack status and availability](https://slack.com/help/articles/201864558-Set-your-Slack-status-and-availability)
- [Customize the Slack mobile app](https://slack.com/help/articles/29788684062739-Customize-the-Slack-mobile-app)

### Linear

- [Concepts](https://linear.app/docs/conceptual-model)
- [Create issues](https://linear.app/docs/creating-issues)
- [Assign and delegate issues](https://linear.app/docs/assigning-issues)
- [My issues](https://linear.app/docs/my-issues)
- [Comments and reactions](https://linear.app/docs/comment-on-issues)
- [AI Agents](https://linear.app/docs/agents-in-linear)

### GitHub

- [Using issues](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues)
- [Quickstart for GitHub Issues](https://docs.github.com/en/issues/tracking-your-work-with-issues/learning-about-issues/quickstart)
- [Browsing sub-issues](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/browsing-sub-issues)
- [Reviewing proposed changes in a pull request](https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/reviewing-proposed-changes-in-a-pull-request)
- [About agent management](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/agent-management)
- [Using Copilot cloud agent via the API](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/use-cloud-agent-via-the-api)

## 13. 与 Agent Team 当前设计文件的对应关系

本报告以以下本地约束为准，而不是反向改写产品范围：

- [`../../m2-ui/design/design-ux.md`](../../m2-ui/design/design-ux.md)：Team mode、Workspace/Channel 目录、runtime status、Message/Activity 分离、composer、Thread、Host projection 与窄布局验收。
- [`../../m2-ui/spec.md`](../../m2-ui/spec.md)：M2 第一阶段 user stories、typed RPC seam、非 optimistic mutation、pagination、明确 out-of-scope 清单。

研究报告没有修改代码或上述设计文件。
