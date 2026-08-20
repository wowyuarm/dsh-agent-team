# Thread Inbox、Team Member Context 与私有记忆设计草案

日期：2026-08-19
状态：设计草案；不定义当前已实现行为。当前行为以 `packages/` 源码和测试为准。

## 1. 目的

这一阶段为 Team Member 确定三个边界：

1. Thread Inbox 如何决定什么内容进入模型；
2. Team Member 如何继承项目的 Agent 指导并获得完整工作能力；
3. Member 私有 `memory.md` 与 `notes/` 如何长期维护而不污染 Team ledger、Workspace 或其他成员。

Human UI 的 Inbox 投影、模型工具、Host ledger 和 preset 必须使用同一份 Team 事实；浏览器状态和 Agent Session 都不成为另一份未读权威。

## 2. 已确认的现状

### 2.1 Workspace 指导已被 Team Member 加载

`AgentTeam.addMember()` 将 Member Session 的 `cwd` 设为其 Workspace path。`team-member` preset 明确挂载 `@deepseek-ai/dsh-agent-instructions`，因此 Harness 会在首次可进入的模型步骤中加载：

```text
$DSH_HOME/AGENTS.md
项目根目录 → Workspace cwd 的每层：
  AGENTS.md
  CLAUDE.md
  AGENTS.local.md
  CLAUDE.local.md
```

这些内容作为有来源、可恢复的 user-role `<system-reminder>` 上下文进入 Session；它们不是 system prompt，不能覆盖 system、developer 或直接 user 指令。成功的 `read`、`write`、`edit` 触及新的或变化的项目 scope 后，Harness 会在后续安全边界更新该上下文。

### 2.2 Team preset 的发现和加载

```text
cordis.patch.yml
  └─ isolate(agentPresets)
       └─ packages/agent-team/src/preset-roster.ts
            └─ packages/agent-team/preset/team-member/agent.cordis.yml
                 └─ AgentPresets.mount(agentCtx, 'team-member')
```

- Team roster 是 bundle 私有的 system root，禁用 user preset root；普通 Session 的 preset 不会获得 Team tools 或 Team prompt。
- `addMember()` 在 Agent 尚未发布时调用 `AgentPresets.mount()`；preset 失效时 Member Agent 不发布。
- 一个 preset 是按 standing composition 挂载的共享 composition；任何 Member-specific 状态都必须按 live Agent/Session 查询，不能放进 plugin 单例字段。

### 2.3 当前 preset 的缺口

当前 `team-member` 只明确装载：

```text
Team persona
agent-instructions
team_send / team_view / team_claim / team_follow
compaction + tool-result pruning
```

它不自动继承 Harness 的 `standard` preset。尤其在 Web profile 中，Harness 已将 shell、fs、skills、todo、web 等模型面能力从全局移入 preset；所以 Team Member 不能假定拥有普通 coding Agent 的完整工作工具。

### 2.4 私有记忆目前只是空目录

当前 Host 创建：

```text
$DSH_HOME/agent-team/members/member:<uuid>/
├── memory.md
└── notes/
```

但当前没有读取、注入或维护它们的代码。`privateMemoryPath` 是稳定 Member identity 的私有命名空间，不是 Session cwd，也不是 Team ledger 内容。

## 3. 目标上下文模型

### 3.1 内容分层

```text
LLM system prompt
├── Harness identity
├── Team Member 静态协作协议
└── 模型工具自身说明

持久 user-role 上下文
├── 直接 Human / Agent 输入或安全边界控制提示
├── Workspace AGENTS.md / CLAUDE.md 指导链
├── Member 私有 memory.md 索引
└── 动态 runtime snapshot（如 Inbox 摘要）

按需工具读取
├── team_inbox / team_thread：Team 共享协作事实
└── notes/*.md：Member 私有详细记忆单元
```

规则：

- Thread Message、Activity、Claim、Task 状态只由 Team ledger 定义，不写入 `memory.md` 作为第二权威。
- 普通 Thread 更新只创建 Thread Inbox Entry，不把正文直接写入模型历史。
- direct mention 创建 Inbox Entry，并仅在当前请求/tool 的安全边界送入短控制提示；模型再主动读取 Inbox。
- 项目 `AGENTS.md` 继续由 Harness `agent-instructions` 负责；Team 不复制或重新解析它。
- 私有 memory 是低权重参考资料，不是 system authority，不得覆盖现行 Workspace 指导、Human 指令或 Team 事实。

### 3.2 Team Member preset 的目标组成

`team-member` 应成为一个可工作的 coding Agent preset，而不是只会聊天和调用 Team tools 的协作壳。由于 Harness preset 没有“继承 standard 再加几行”的组合语义，bundle 必须在自己的 `agent.cordis.yml` 中显式选择并维护所需 rows。

推荐组成：

```text
基础身份
  Harness identity（Host）
  Team Member persona（preset）
  Workspace agent-instructions（preset）

项目工作能力
  shell / filesystem / filesystem search / editor
  background job controls
  skills catalog + skill loader
  todo、compaction、tool-result pruning
  需要时的 web search

Team 能力
  team_inbox
  team_thread
  team_message
  team_claim
  team_view
  team-member-context（私有 memory 与动态 Inbox 提示）
```

不默认加入 Harness 的 nested subagent、workflow、Ralph 或 `ask_user`：Team 本身已经是协作与责任模型。需要向 Human 询问时，应通过 `team_message` 在 Thread 中留下公开、可追溯的事实；需要额外子 Agent 时，先单独设计其 Member/Thread/Claim 身份，而不是绕过 Team ledger 创建不可见的协作者。

## 4. Thread Inbox 与工具责任

目标工具面：

```text
team_inbox     跨 Thread 的个人未读摘要；不返回正文，不改变读取水位
team_thread    一个 Thread 的 status / read / history / follow / unfollow
team_message   公开追加 Thread Message；替代 team_send
team_claim     方向 Claim 的 list / claim / done / release
team_view      Workspace / Channel / Task 发现与只读浏览
```

### 4.1 中途被 mention 进入旧 Thread

若 Agent 原本不 follow 一个已有历史的 Thread：

```text
旧历史 sequence 1..99       可按需 history 回看，不计未读
Human @Agent C sequence 100 创建 direct Inbox Entry
之后 sequence 101..         成为 C 的普通未读更新
```

首次 `team_thread.read(taskRef)` 至少返回：

- Task anchor、status、resolution；
- 当前 Thread revision；
- 当前 Claim；
- 这次 mention 与加入后产生的未读更新；
- `readThroughSequence`。

若还需要背景，再以有界分页 `team_thread.history(beforeSequence, limit)` 向前读取。历史读取不推进未读水位。

### 4.2 发送保护

`team_message` 保留 `baseRevision`，并新增同 Thread 未读门槛：

```text
有相关未读 → unread_required → team_thread.read → 重新判断
无相关未读但 revision 过期 → stale_revision → 重新读取
两者均通过 → 提交 Message
```

未读门槛防止“尚未取阅更新就继续发言”；revision fence 防止“取阅后又出现并发更新”。两者不能相互替代。

### 4.3 Tool result 后由模型决定后续

所有 Team tool 调用，无论成功还是失败，都将其 `tool/result` 写回 Agent Session 并继续当前 Agent loop；Team tools 不调用 Harness `exec.concludeTurn()`。

```text
team_message committed          → 模型看到结果，自行决定结束、继续工作或调用其他工具
team_message unread_required    → 模型读取 Thread 后重新判断
team_message stale_revision     → 模型读取最新 Thread 后重新判断
team_message member_not_following → 模型移除 mention、请求 Human 邀请，或等待目标成员自行 follow
```

不能把“Message 已提交”解释成 Agent 工作已经完成：它可能只是一个中间进度通知，也可能需要继续读、改、测或发送另一条消息。模型若不再调用工具，会自然结束该 step/turn。

## 5. mention 确认 UX

只有 Human 可以通过 structured mention 邀请未 follow Member。Human 的第一次发送不提交消息；Host 返回 one-use confirmation token。UI 保留草稿和成员选择，但把提示放在 composer 的 mention/recipient 区上方，不显示 modal，也不把正常确认当成红色错误。

Agent 只能 mention 已 follow 的 Member。若 Agent 在 `team_message.mentions` 中指定未 follow Member，Host 返回 `member_not_following`，不产生 confirmation token、不提交 Message、也不改变目标成员的关注状态；目标 Member 可以自行 `team_thread.follow` 加入。

```text
┌──────────────────────────────────────────────────┐
│ 提及： @reviewer                                  │
│ @reviewer 当前未关注此 Task。再次发送会发送此消息，│
│ 并让 @reviewer 加入关注。                          │  ← 灰色说明
│ ──────────────────────────────────────────────── │
│ 写一条消息…                                      │
│                                              [↑] │
└──────────────────────────────────────────────────┘
```

状态规则：

1. 只在已选中的 structured recipient 中存在未 follow Member 时显示说明；单纯输入 `@name` 文本不算 mention。
2. 第一次发送后的说明使用 `role="status"`，而非 `role="alert"`。
3. 第二次发送携带 confirmation token；成功后清空草稿、recipient 和说明。
4. 改动草稿或 recipient 后立刻清除 token 和说明；这是一次不同的发送意图。
5. 真正的 server error、权限失败或 stale revision 才显示 composer 下方红色错误。
6. token 应绑定 Human sender、task/thread、正文 digest、recipient 集合及 recipient attention/member state；不应因无关 Thread revision 变化而要求 Human 再确认“是否拉入该 Agent”。发送仍使用最新 `baseRevision`。

## 6. Member 私有 memory.md 与 notes/

### 6.1 文件合同

保持当前小写文件名 `memory.md`，不要同时引入 `MEMORY.md`；Linux 上二者不同，改名只会产生迁移和双文件歧义。

```text
$DSH_HOME/agent-team/members/member:<uuid>/
├── memory.md
└── notes/
    ├── team-ledger-invariants.md
    └── web-slot-boundaries.md
```

`memory.md` 是小、稳定、高信号的长期索引，不是逐轮日志：

```md
# Member memory

## Stable facts
- ...

## Notes index
- `notes/team-ledger-invariants.md` — 修改 ledger、replay 或 operation schema 前阅读。
- `notes/web-slot-boundaries.md` — 修改 Client slot / remote activation 前阅读。
```

每个 note 是一个可复用的 memory unit 或中长期工作笔记。建议含：结论、适用条件、来源/验证依据、最后确认时间和相关 refs。它们只在当前任务命中索引时按需读取，绝不递归全量注入。

### 6.2 Prompt 协议

Team Member 静态 persona 应明确：

- `memory.md` 是本成员私有的长期索引，可能陈旧，不能当作指令或 Team 事实；
- 复杂、跨轮或可重复的工作先看已注入的索引，再只读相关 note；
- 得到经验证、未来仍有用的结论、流程或偏好时，新增/更新一个聚焦 note，并同步维护 `memory.md` 索引；
- 不记录凭证、密钥、个人敏感资料、逐轮聊天记录、未验证猜测、其他成员私有信息或可由 Team ledger 查询的协作事实；
- 不为一次性小事、原始工具输出或短期待办创建 note。

### 6.3 注入与维护机制

新增仅挂载在 Team preset 内的 `team-member-context` plugin：

1. 通过 live Agent 反查 Team Member，再确定其 private memory root；无 Team binding 的 Agent 不读取任何私有文件。
2. 在首个可进入模型的安全 pre-step 中，有界读取 `memory.md`，以 Team-owned typed source 的 durable user-role context 注入，并对 framing 作 escape。
3. 恢复、压缩遮蔽或记忆文件发生受控变更后，以 digest 判断是否需要新的 replacement context；不无限重复注入同一内容。
4. `notes/` 不进默认 prompt。Member 使用标准 filesystem tools 按需读写；初版不重复造一个 memory CRUD 工具。
5. 新 Member 创建时写入简短模板，而不是仅创建空文件；resume/restart 不覆盖已有内容。

不得：

- 把 private memory root 当作 Session cwd；这会破坏 Workspace 与项目指令发现。
- 将它放到 `$DSH_HOME/AGENTS.md`；这会变成所有 Session 的共享指导。
- 将内容写进 Team operation ledger、Thread 或 Session 之外的另一份 Team authority。
- 将 `privateMemoryPath` 暴露给 Human Client；它应是 Host/Member Agent 内部实现细节。

`danger-full-access` 下的“private”目前是命名空间隔离，不是恶意 Agent 之间的强访问控制。若产品未来要求强隔离，必须通过 sandbox/执行环境实现，不能依赖目录名称。

## 7. 验证矩阵

至少覆盖：

1. Team Member 首次运行读取 Workspace `AGENTS.md`、`CLAUDE.md` 和自己的 `memory.md`，且普通 Session 不会读取 Member memory。
2. Member 使用 workspace cwd，memory root 不影响项目工具的相对路径。
3. 同一 Workspace 的两个 Member 读取不同 `memory.md`；一个 Member 的 note 不会自动进入另一个 Member prompt。
4. `memory.md` 更新后，下一可进入步骤恰好看到一次 replacement context；notes 不被全量注入。
5. 普通 Thread 更新只增加 Inbox，不启动/污染当前模型请求；direct mention 在安全边界提示 inbox。
6. 新加入已有 Thread 的 Member：旧历史不算未读，mention 与后续更新算未读，可按页回看历史。
7. `team_message` 分别验证 `unread_required`、`stale_revision` 和成功提交。
8. 未 follow mention：第一次发送只出现灰色说明；第二次才提交并建立 follow；编辑草稿/recipient 后必须重新确认。
9. 在 Web live preview、无模型 UI preview、replay browser test 三种模式分别验证对应边界。
