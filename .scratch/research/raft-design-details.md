# Raft 产品设计细节报告

> 目标：为"在 DeepSeek Harness 上原生实现类似 Raft 的 agent team"提供可借鉴的产品设计细节。
> 检索日期：2026-08-14。数据来源：`github.com/botiverse/raft-docs`（main，`content/`）。全部内容由 `curl -sL https://raw.githubusercontent.com/...` 实读，无 web_search 兜底。

---

## 0. 关键核实声明

任务描述在 **D 节把 "held/draft/--anyway 机制" 设定为消息页的关键**。**该机制在 raft-docs 的 messages 首页及其全部 41 个 markdown 文件里都不存在**——我对整个仓库跑过对 `held`/`anyway`/`draft`/`stale`/`concurrent`/`interrupt`/`blocked`/`override` 等词的全量 grep，无一命中（唯一接近的 "interrupt" 出现在 Activity 页"push 通知才打断你"，与发送保护无关）。因此 D 节标注为"**未能读取（该机制在文档中未记录/不存在）**"，并给出基于 Raft 实际消息约束的替代设计建议。其余各节全部实读。

---

## A. 任务系统（来源：`features/collaboration/tasks/index.md`、`divide-the-work/index.md`、`hand-off-your-first-task/index.md`）

### 任务是什么
- 任务 = **一条消息 + 跟踪元数据**（编号、状态、可选 owner）。"把对话变成承诺"。
- 任务带：**编号**（channel 内顺序递增，task #1/#2/#3…）、**状态**、**owner（可选）**。
- 任务**只能由顶层消息**（channel 或 DM 的顶层消息）转化而来；**thread 内的消息不能转任务**（thread 消息是"讨论上下文"）。

### task 状态机（完整状态）
文档给出 5 个状态，是这类产品的核心：
1. **Todo** — 还没人认领（未开始）
2. **In progress** — 有人 claim 了、正在做（owned, moving）
3. **In review** — 工作做完了、等队友评审
4. **Done** — 已评审并完成
5. **Closed** — 取消 / 不做；**可逆**（closed 可 reopen 回上一状态）

> 简写流转：`todo → in progress → in review → done`；`closed` 是旁支且可逆。
> 状态更新对 channel 内所有人可见。

### owner / claim / unclaim 的精确语义
- **一个任务同一时刻只有一个 owner。**
- **Claim 表示"我来负责"**，语义与边界：
  - **防止重复劳动**：一旦被 claim，其他人就知道"已被拿走"；
  - **一人一 owner**：任务被 claim 后，其他人转去找未 claim 的活；
  - **Unclaim 即释放**：任务回到"可被认领"状态，供其他人认领。
- **谁可以 claim**：任何成员（人类或 agent）。文档未设"claim 需权限/角色"限制。
- **claim 后别人还能不能动**：文档措辞是"others move on to unclaimed work"——即别人**不会/不应**再动已 claim 的任务；这是靠约定（"the rule"）而非强制锁定。
- **unclaim 的后果**：释放任务，回到 todo/可认领，不删除任何内容或历史。

### 子任务机制
- 无结构化的"子任务树"，是**扁平方式**：大任务拆成**互相之间不阻塞的子任务（subtasks）**，各自独立可完成 → agent 可并行；有依赖的按 **phase 分组并打标签**，标注"哪些现在能跑、哪些要等"。
- 一项推荐工作流：由 agent 提任务拆分方案、人类先审再开工（`divide-the-work`）。
- 文档明确 agent 可以**自己创建新任务**，例如"把大任务拆成子任务并行"。

### task 与顶层消息 / thread 的关系
- 任务消息就是该任务 **thread 的 anchor**；
- **每个任务有且只有一个 thread**（任务消息本身作为 anchor）；
- 工作讨论、进度、结果都发在任务的 thread 里，让主 channel 保持干净：
  - 任务消息本身只显示状态；thread 里装细节；
- 任务里被 @mention 或参与 thread 的 agent 会自动 follow，从而收到通知。

### 任务板 UI 构成
- 每个 channel 有一个**任务板**（`Tasks` tab），任务按状态分组；
- 板上呈现：**todo**（open & unclaimed）、**in progress**（谁在做）、**in review**（等评审）、**done**（完成）、**closed**（已取消）。
- 任务消息自带编号与状态标（携带 task number + status）。

### agent 的典型任务工作流（tasks 页 + hand-off 页一致）
1. 看到未认领任务或收到请求
2. **Claim 任务**
3. 在任务 thread 里发进度更新
4. 做完设为 **in review** 并贴结果
5. 人类验收后 agent 设为 **done**

> 文档强调：**agent 会自动 claim 任务**——当 agent 收到一条需要行动的请求，它开工前先 claim；如果 claim 失败（被别人抢先了）就放弃并去干别的。这是 agent 之间协调的核心规则，**无需人类手动指派**。

---

## B. thread（来源：`features/messaging/threads/index.md`、补充 messages/collaboration）

### 结构与限制
- **单层/无嵌套**：thread 不能嵌套，thread 里不能再开 thread。
- **仅顶层消息可作 anchor**：只有 channel/DM 的顶层消息能成为 thread 起点；已在 thread 内的消息是"讨论上下文"，不能成为新 anchor，也不能转任务。
- 开启方式：hover 消息 → 气泡图标"Reply in thread"，或右键 → Open Thread。

### anchor 语义
- 第一条回复创建 thread；发起回复的那条原消息成为 **anchor**。
- thread 有回复后，消息下方出现 **reply-count 徽章**，点击可重开 thread。
- thread 回复**不进入主 channel 流**（保持 channel 干净）。

### follow / unfollow 精确语义
- **自动 follow 的触发条件**：① 你往 thread 里发消息；或 ② 你在 thread 里被 @mention。
- **Follow 的后果**：为该 thread 的新回复接收通知。
- **Undollow**：当你在该 thread 的工作完成后可主动 unfollow；**unfollow 不会把你移出 thread**——你仍能读、仍能回复，只是静音更新。

### 在 thread 里发消息的副作用
- 若你是 thread 参与者，发送会"自动 follow"；
- 若你在 channel 里被 @mention（thread 成员），会自动 follow 该 thread 并收到新回复通知（见消息页的 @mention 说明）。

> Raft 没有"默认对所有 thread 静音、只在被 @mention 才收到"的设计——**默认是"参与即关注"**。

---

## C. 通知与注意力模型（来源：`get-pinged-when-it-matters/index.md`、`features/messaging/activity/index.md`、`catch-up-in-one-place/index.md`、`features/messaging/dms/index.md`、`features/messaging/channels/index.md`）

### 什么事件通知什么人（push 通知）
通知"跟随你的成员关系（membership）"：
- **DM 总是 ping**（无论双方加入与否）。
- **你加入的 channel**：每一条消息都投递/通知（加入即 opt-in；离开即 opt-out）。
- **你 follow 的 thread**：有新回复就 ping。
- **@mention**：即便在**你还没加入**的 channel 里被 @mention，也能收到通知。
- **Server-wide mute**：一个全局开关，全部静音。
- **无 per-channel 通知设置**——"你的 membership 已经表达了你在乎什么"。
- 设计哲学："安静的基线，真正 ping 你的都是你确实需要知道的。"

### Activity（pull 聚合）与过滤
- Activity 把**整个 server** 与你相关的东西聚合成一个 feed（按时间倒序，最新在前）：
  - 你**加入的 channel 里的消息**；
  - 你 **follow 的 thread 里的回复**（含任务 thread，会带任务当前状态）；
  - **DM**；
  - **@mention**（**含你未加入的 channel**）。
- **三个过滤**：**All**（全部）、**Unread**（只看未读）、**Mentions**（只看 @你）。
- **Saved 是独立面**：手动 bookmark 任何消息（待办、决策、链接/产物），持久直到手动移除。设计句："Activity 是发生到你身上的事；Saved 是你主动选择保留的。"
- 推荐 triage 顺序（catch-up 页）：Mentions 优先（crew 在等你答复）→ Unread 其次 → 其余可继续自行运转。每个会话保留"读到的位置"，重开从第一条未读开始。

### "默认静默"相关设计
- **不存在"默认静默"**：Raft 的默认基线是积极的——**DM 必 ping、加入的 channel 全量投递、参与即关注 thread**。
- 但对外围噪声有 pull 优先的设计：进度更新/例行任务搬动/agent 闲聊**属于 Activity 而非 push**——"能等一小时的不该 ping"。
- **@mention 被确立为"这需要你"，所以值得打断**（对人和 agent 都是一种共享约定）。

### 关于 agent 如何"看到"消息（重要，source: activity 页）
- **Agent 不用 Activity 这种人类方式**；它们通过**收件箱投递**接收——agent 检查新消息时，能看到自上次检查以来累积的**所有**消息（等同于人类一段时间后再打开 Activity）。→ 这对"并发/未读"很关键（见 D）。

---

## D. 消息发送的并发 / 未读保护 —— 要求的 held/draft/--anyway 机制（关键，如实报告）

**该机制在 raft-docs 中未被记录/不存在。**

- 我在 messages 页、以及整个仓库 41 个 md 文件里对 `held`/`anyway`/`draft`/`stale`/`concurrent`/`override`/`blocked` 等做全量 grep，均无命中。
- 也就是说：任务描述中"发送时若 thread 出现新消息则拒绝发送、要求重新组织、`--anyway` 绕过"这套并发保护——**Raft 公开文档不写、也不支持**。Raft 对发送的保护方式完全不同（见下）。

Raft 实际的消息发送-协作规则（来源：messages 页、tasks 页、hand-off 页）：

1. **消息发出即永久，不可编辑、不可删除**（messages 页 "What messages can't do"）。如需修正，**在 thread 里补一条回复**。
2. **无任何"发送前冲突检测/held/重写"**。agent 是通过"收件箱投递"顺序消费：agent 检查时读自上次以来的全部累积消息、按序处理。
3. **claim 是唯一的并发原子保障**（如前 A 节）：`claim 失败即放弃` 是防重复工作的机制——**不是靠消息发送校验，而是靠任务所有权的抢占**。
4. 因此面对你的需求 (5)"发送时若 thread 出现新消息则拒绝发送"：**Raft 不做**。它靠 (a) 所有参与者都被投递了全部消息（活动页），(b) agent 在 thread 里的答复天然在上下文里，(c) 人类在 thread 里追加反馈，agent"从上次离开的地方继续，把你说的都当新上下文"（hand-off 页）。它假设 agent 能容忍新消息插入，无需"拒绝发送"。

### 对 DeepSeek Harness 的设计建议（如果确实需要 held/draft/--anyway）
该机制其实是 Claude Code 系 agent 的"提交按钮式"保护（有未读新消息时提醒"re-organize"、可强制 anyway），Raft 没有。你们在 Harness 上若要实现 (5)，可自行引入，Raft 没有可对照语义——不要误以为可"继承 Raft 现成机制"。

---

## E. 团队工作流：build-your-agent-team / divide-the-work / hand-off-your-first-task 的完整协作循环

### 核心循环（hand-off 页提炼）："describe, hand off, let it run, review"
1. **Describe（描述工作）**：在 channel 以对同事的口吻告诉 agent"你要什么、为什么"，具体怎么做留给 agent；含糊它会反问。允许**连续多发**上下文（多条消息、链接、跟进想法），agent 读 channel 时按序全收。
2. **Hand off（转成任务）**：把要干的活变成 task（convert / As Task / Create）。任务从 **unclaimed** 开始；agent claim 后开工，状态翻成 in progress，并显示 owner。
3. **Let it run（放手跑）**：agent 在任务 thread 里持续发进度；agent 在电脑在线时持续工作。若停了或结果不符预期，在 thread 里回复它"哪不对/缺什么"，它**接着上次进度继续**，把你说的当新上下文。
4. **Review and close（评审与关闭）**：agent 完成后设为 in review 并贴结果；人类读结果，好→说好并标 done，不好→在 thread 里说清哪里不对，agent 重新接回。
   - **反馈不是一次性的**：agent 记住它，下次任务回来更接近你要的。

### divide-the-work 的分工细节
- **任务来源 3 条路**（都落在同一处）：转向量转任务 / 发送时勾 As Task / 手动 Create Task。
- **单 owner 规则**防两人干同一件事："claimed→被占有；unclaimed→谁都能拿"。
- **并行拆分**：不可阻塞的子任务各自并行；有依赖的按 phase 分组并打标签。
- **建议让 agent 自主拆分、人类先审**（越了解项目效果越好）。
- 结果："board 是团队的共享记忆；对话归对话、承诺变成任务、没人重复做一件事。"

### 通知在协作中的用法（get-pinged 页 + 教程）
- **@mention 意义** = "这需要你"；团队（人+agent）严守该约定，mention 才值得打断。
- 认领 / 汇报 / 验收 / 交接在 tutorial 里高度依赖 @mention 和 thread（见 F）。

---

## F. investing-research-team 教程：3 agent 协作完整实例

### 角色划分（source: 教程 tables + Step 3/6）
| Agent | Description（生产环境即分工表达） | 责任 |
|---|---|---|
| **Walter** | Investment Steward（投资管家） | 持有组合上下文、守住来源纪律；把团队锚定在你组合上；自动跑组合快照循环 |
| **Clara** | Research Lead（研究牵头） | 研究 + 起草 memo；把问题转成有来源支撑的备忘 |
| **Marcus** | Risk Reviewer（风险评审） | 评审证据质量/新鲜度/无支撑主张/缺反方论点/过度自信/集中度风险/与组合匹配度 |

三人 run 在 Codex CLI（同一台/可不同台，混合 runtime 也允许）。

### 流程如何流转
1. **Step 1 建队**：3 个 agent 各给 name + 一行 description。
2. **Step 2 先向 Walter 打招呼**：一条消息说明他要当 steward；"他以后都记得"。选 Walter 先，因为他要 onboard 另两人。
3. **Step 3 建 `#investing-onboarding`（安静房间）**：邀请 3 人进 channel（Raft 里 agent **只看到它加入的 channel**，所以全队必须在场才能对话）。然后：
   - 让 Walter 先盘点自己有哪些研究工具/能力、能做什么不能做什么、如何区分事实与解读，写一份 onboarding note；
   - （可选）教 Walter 用 OpenCLI，再由 Walter 教 Clara 做一次真实抓取（NVDA 最新价），让 Marcus 评审她"source 强不强/新不新/有没有不支撑的地方"；
   - Walter 给 Clara 派研究/起草 lane、给 Marcus 派评审 lane，end with 一份 team note 明示分工。
4. **Step 4 建工作 channel `#my-investing`**：邀请 3 人，用一条消息写清 ground rules/lane。
5. **Step 5 设自动循环**：让 Walter 设一个 recurring reminder（收盘跑组合快照）；先写"loop contract"（节奏/校验/预算/工具/升级路径），把持仓数据放 thread 里当单一事实源。→ 这展示**人类只在"定义契约 + 给数据"处介入**，之后循环自动，进展显形在 channel/thread。
6. **Step 6 首个任务**：一行 `First task: research Nvidia ...` 启动整个协作——Clara 研究起草、Marcus 评审证据与风险、Walter 把它锚定到组合；人类随时可 into 重定向/追问/反驳，"全程你在掌舵"。

### thread 用法
- onboarding 讨论 + 工作讨论都走 thread；组合快照历史走 thread；**持仓明细放专用 thread 作为 source of truth**。
- 消息页提示：可要求"每个 update 发成 channel 新消息而非 thread 回复"（本例中 Walter 的快照更新明确要求发 channel）。

### 人类在哪些环节介入
- 建队/定义分工、发 onboarding 指令、写 ground rules、定义 loop contract、提供持仓源数据、下达首个任务、评审产出的 memo、随时中途中止/重定向。（评审闭环见 E。）

---

## G. agent 身份与 UI（来源：`features/agents/index.md`、external、runtime、workspace、lifecycle、troubleshooting）

### profile 三要素
创建 agent 设 3 项：**Name**（显示名 + @mention 句柄）、**Description**（做什么——"面向团队和其他 agent"，好描述帮团队知道该把什么交给它）、**Runtime**（跑的 AI 引擎）。

### 成员面板 / profile 面板 tab 构成
- Agent 出现在成员面板的 Agents 列表；点击 agent 或消息里的名字打开 detail panel，tabs：**Profile**（含 role 与 runtime config）、**Activity**、**Chat**、**Reminders**、**Workspace**、**Apps**（tabs 可拖动重排）。
- Create 入口：Computers → Create / 侧边栏 quick-create / **另一个 agent 通过 API 创建**。
- **Profile 可自更新**：agent 随经验可自己更新自己的 description 反映真实分工（提示"设每周提醒维护自己 1–2 句的描述"）。

### 角色（Member / Admin）
- Agent 有服务角色 member/admin；新 agent 默认 member。
- Member agent 不能直接建 channel/加成员/改服务 profile，但可把它做成 **action card 供人类评审提交**；Admin agent 可自主做这些。
- 只有 owner/admin 能改 agent 角色；**agent 不能成为 server owner**（owner 始终是人）。

### agent 之间如何互相识别
- 通过 @mention 句柄、成员面板里的 description、以及它们共读的 channel/thread 上下文。description 即"分工表达"——推荐写法见各教程：用**一条 lane** 而非**职位头衔**（"handles data questions" / "owns the docs" / "Investment Steward"）。
- 定位哲学：role 不是指派出来的职位，是"在你给它的活和纠正里长出来的"（build-your-agent-team）。

### 身份 vs 会话（关键，source: agents 页）
- **Agent 是持久身份，不是聊天会话**：重启（bounce 进程、保留 session）/ reset session（清 runtime 上下文）都不丢名字/workspace/memory/channel 成员资格。→ 这直接回你的假设 (6)。

### 生命周期与状态点
- 状态点：Green online / Yellow(pulsing) busy / Orange error / Gray offline（实时更新）。
- Idle/active：无活→idle（进程存活、低保资源）；有消息/@mention/reminder→active。触发即激活，"总是在场，不是总在跑"。
- Reset 三种程度：Restart（续旧 session）/ Session reset（清对话、保 workspace）/ Full reset（清对话+workspace）。
- 删除：永久移除，历史消息保留、但丢失存在感/成员资格/task claims，workspace 从磁盘清理。
- Workspace：agent 自有持久目录（memory files / working files / cloned repos / notes），跨 idle 与 session reset 存活，full reset 才清；**不要直接改磁盘上的 workspace 文件**，改要发给 agent 让它自改。

### External / Runtime（来源：external 页、runtime 页）
- **External Agent（Experimental 徽章）**：你自己跑进程、用 `raft agent login`（device-authorization，人类浏览器批准）接进来；连上后是完整 server 成员（送收消息/claim task/set reminders/attachment/search/manage profile/apps）。能力与 managed 一致，权限按成员资格裁剪。状态点对外部 agent 可能不准（已知局限）。
- **Runtime**：Claude Code/Codex CLI/Antigravity/Kimi/Copilot/Cursor/Gemini CLI/OpenCode/Pi。running 靠你自己的订阅；Raft 不中转。runtime 可后换（只影响下次 start 的 runtime session，identity/workspace/memory 保留）。服务器可**混合 runtime**；他人日常看不到 agent 用哪个 runtime。

---

## H. 与设计假设的逐条对照

| # | 你的假设 | Raft 支持度 | 细节与来源 |
|---|---|---|---|
| (1) channel 每条顶层消息默认是一条 task | **冲突** | Raft 里**只有被显式标记的顶层消息**才是 task；`As Task` toggle / 右键 Convert / Create 三者任一。普通顶层消息不是 task。来源：tasks 页（"a task is a message ... has been marked as trackable"）+ hand-off Step 2。 |
| (2) 同一 task 多个 agent 并行 claim 并各自声明职责方向（讨论/coding/review） | **冲突** | Raft 是**严格单 owner**："one owner at a time"，claimed 后别人转去未认领的活；claim 失败即放弃——**不支持多 agent 同 task 并行、各自声明方向**。并行靠"把大任务拆成互相不阻塞的独立子任务"实现。方向分工靠各自的 description/lane，而非同一 task 的多责任人。来源：tasks 页 + divide-the-work 页。 |
| (3) agent 默认收不到 channel 通知，只有被 @mention 或 follow thread 才收到，可主动 unfollow | **部分冲突** | Raft **channel 默认全量投递**：加入 channel → 每条消息都投/通知，@mention 只是"attention signal，不是 delivery filter"（消息页原话）；且你**未加入**的 channel 里被 @mention 也会到。**thread 的 follow/unfollow** 部分支持你的假设——参与即 follow、可主动 unfollow。但"默认静默、仅 mention/follow"与 Raft 相反：Raft 默认 agent 在它加入的 channel 上是**全量可见**的。来源：messages 页、get-pinged 页、threads 页、channels 页。 |
| (4) task thread 只显示 agent 明确发出的消息，不显示内部活动 | **支持（隐含）** | task 状态**只**映射到一个公开状态字段/状态点变化；thread 里**只有 agent 发出去的消息**（进度更新/结果），内部工具调用、原始思考不在 thread 里。human 只看公开消息与状态。来源：activities 页（"task threads show the task's current status"）、tasks 页、hand-off 页。 |
| (5) 发送时若 thread 出现新消息则拒绝发送、要求重新组织 | **不支持（Raft 无此机制）** | 见 D 节：Raft 无 held/draft/--anyway；靠"全量投递 + agent 按序消化 + claim 抢占"解决并发，不拒绝发送。若你要 (5)，是自研特性，无 Raft 可对照语义。 |
| (6) agent 的"会话"保持连续，thread 只是 UI 展开 | **部分支持** | Raft agent **是持久身份**（身份/workspace/memory 跨 session），且在任何 conversation（channel/DM/thread）里"接着上次进度继续"。但 Raft 的 thread 不是纯 UI 展开：它是**有 anchor 的独立子对话**，有 follow/unfollow、有 reply-count badge、有"仅参与才收通知"的边界；任务 thread 更是单一事实源。Raft 中 agent 的连续性主要由**身份 + workspace/memory** 提供，而非"thread 只是同一会话的 UI"。来源：agents 页（"identity vs session"）、threads 页、workspace 页。另注意：Raft thread **不能嵌套**，这在你的设计中是否也保留需你自行决策。 |

---

## I. 本设计可借鉴与应放弃的清单

### 可借鉴的具体机制（带语义）
1. **"任务 = 带跟踪元数据的消息"的模型**：编号 + 状态 + owner，任务天然挂在 channel，任务消息作为其 thread 的 anchor。轻量、直观、UI 与消息流统一。
2. **单 owner claim 抢占即并发保障**：claim 失败即放弃（无需手动指派），这是"防重复劳动"的最小机制——值得在 Harness agent team 上复刻。
3. **状态机 5 态 + closed 可逆**：todo/in progress/in review/done/closed，可逆 closed 兜底。
4. **大任务拆"互不阻塞子任务并行 + 依赖分 phase"**，并让 agent 提交拆分方案给人先审——是天然适配多 agent 并行与人类的评审点。
5. **"参与即 follow、可主动 unfollow"的 thread 注意力模型**：follow 语义清晰（发消息或被 mention 才 follow），干净地把通知收敛到相关人。
6. **通知 = 成员关系的直接映射**（DM 必 ping、加入 channel 即 opt-in、被 mention 即使未加入也达、server-wide mute 兜底），无 per-channel 设置——把模型做简单，值得学。
7. **push / pull 分离**：push 只给"确实需要你"的事（@mention、DM、follow 的 thread、评审）；进度/例行搬动/agent 闲聊进 pull 的 Activity。这是防通知洪水的关键分层。
8. **Activity 三过滤 All/Unread/Mentions + Saved 独立**，及"Mentions 优先 → Unread → 其余可自行运转 + 会话保留读位"的 catch-up 流程。
9. **agent 的 thread 里只放"明确发出的消息 + 状态"，内部活动不进 thread**（你的假设 4 也成立），保 UI 极简。
10. **agent 是持久身份而非会话**：restart/session reset 各不相同，name/workspace/memory/memberships 保留；workspace 作为 agent 私有持久记忆目录（memory files/working files/notes），可要求 agent 自律 tidy——这套"身份/记忆/连续"基建很适合 Harness。
11. **每个 agent 自己的 workspace 持久化 + 可自维护 description**（profile 自描述、每周提醒更新 1–2 句 lane）。
12. **"lanes not job titles"**：用一条 lane 描述分工，让角色在工作中长出来；description 即分工表达，agent 之间靠它互认。
13. **混合 runtime**：团队可混合不同 CLI runtime，他人不知 agent 背后引擎——若 Harness 想接多 provider 可借鉴。
14. **onboarding 接力**：先教一个 agent，再让它 onboard 队友（"一个房间，先带好一个，再让他带剩下的"）——很实用的多 agent 冷启动流程。
15. **External Agent（device-auth login 进 server 当完整成员）** 的存在本身，证明了"外部自有 runtime agent 也能有 server 席位"是成立的模式（含 wake 提示与 credential profile 管理）。

### 可不继承的 Raft 产品约束（我们不必带上的包袱）
1. **消息不可编辑/不可删除（permanent once sent）**：Raft 为"可靠记录"牺牲了修正能力，靠 thread 补回复。DeepSeek Harness 的 agent agent-loop 通常**必然可编辑/可重放**会话内容——不必继承 "永不可改"。
2. **单 owner / claim 即独占**：若你们真的要"同一 task 多 agent 并行、各声明职责方向"（假设 2），就必须**偏离 Raft 的单 owner 独占**，引入"多责任人 + 方向声明"结构——Raft 不提供，需自研。
3. **thread 不能嵌套（单层）**：若 Harness 需要更深的讨论结构（比如"任务 → 子问题 → 评审"多层），单层限制不必继承。
4. **Experimental 徽章事项（External Agent 状态点会不准）**：这类"外部进程的活性探测不可靠"的已知局限，你们若接外部 agent 应直接内建更稳的健康信号。
5. **"多 owner 不支持"**：Raft 在这点是**刻意取舍**（防重复工作的 rule），不是能力缺失；若你们想要并行分工，取舍要重新做。
6. **Raft 依赖"加入 channel 全量投递 + @mention 作为 attention signal 而非 delivery filter"**：你们假设 (3) 要"默认静音、仅 mention/follow 才到"——这是**比 Raft 更安静**的模型，Raft 无现成"默认静默"开关（只有 server-wide mute），需自建（如"agent 默认不读全 channel，只被 mention 或 follow 的目标 thread 唤醒"）。
7. **任务限制在 channel 内、thread 消息不能转任务**：若 Harness 想让 thread 内讨论也能提级为任务，需放宽 Raft 的"仅顶层消息可转任务"限制。

---

## 附：实际读取成功的 URL 列表（检索日期 2026-08-14，全部 HTTP 200）

必读页面：
- https://raw.githubusercontent.com/botiverse/raft-docs/main/content/build-your-agent-team/index.md
- https://raw.githubusercontent.com/botiverse/raft-docs/main/content/divide-the-work/index.md
- https://raw.githubusercontent.com/botiverse/raft-docs/main/content/hand-off-your-first-task/index.md
- https://raw.githubusercontent.com/botiverse/raft-docs/main/content/tutorials/investing-research-team/index.md
- https://raw.githubusercontent.com/botiverse/raft-docs/main/content/features/collaboration/tasks/index.md
- https://raw.githubusercontent.com/botiverse/raft-docs/main/content/features/messaging/threads/index.md
- https://raw.githubusercontent.com/botiverse/raft-docs/main/content/features/messaging/activity/index.md
- https://raw.githubusercontent.com/botiverse/raft-docs/main/content/get-pinged-when-it-matters/index.md
- https://raw.githubusercontent.com/botiverse/raft-docs/main/content/features/messaging/channels/index.md
- https://raw.githubusercontent.com/botiverse/raft-docs/main/content/features/messaging/dms/index.md
- https://raw.githubusercontent.com/botiverse/raft-docs/main/content/features/messaging/messages/index.md
- https://raw.githubusercontent.com/botiverse/raft-docs/main/content/features/agents/index.md
- https://raw.githubusercontent.com/botiverse/raft-docs/main/content/features/agents/external/index.md
- https://raw.githubusercontent.com/botiverse/raft-docs/main/content/features/agents/runtime/index.md

补充核对页面（HTTP 200）：
- https://raw.githubusercontent.com/botiverse/raft-docs/main/content/features/agents/lifecycle/index.md
- https://raw.githubusercontent.com/botiverse/raft-docs/main/content/features/agents/workspace/index.md
- https://raw.githubusercontent.com/botiverse/raft-docs/main/content/features/agents/troubleshooting/index.md
- https://raw.githubusercontent.com/botiverse/raft-docs/main/content/features/agents/reminders/index.md
- https://raw.githubusercontent.com/botiverse/raft-docs/main/content/catch-up-in-one-place/index.md
- https://raw.githubusercontent.com/botiverse/raft-docs/main/content/features/collaboration/index.md
- https://raw.githubusercontent.com/botiverse/raft-docs/main/content/features/collaboration/comments/index.md
- https://raw.githubusercontent.com/botiverse/raft-docs/main/content/features/messaging/index.md

未能在文档中找到（如实标注）：**任务描述 D 节的 held/draft/--anyway 发送并发保护机制**——已对全仓库 41 个 md 文件做全量关键词 grep（held / anyway / draft / stale / concurrent / override / blocked / interrupt），均无命中，判断为"该机制在 raft-docs 未记录或不存在"。报告中 D 节据此如实说明，未作编造。
