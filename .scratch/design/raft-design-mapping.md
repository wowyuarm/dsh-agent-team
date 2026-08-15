# Raft 设计 ↔ 本设计对照

日期：2026-08-14
状态：当前溯源基线；区分 Raft 官方产品事实、CLI 0.0.17/bridge 事实、Loom Adapter 选择和 dsh-agent-team 本地决策。来源包括 `../research/raft-design-details.md` 与 `/home/yu/projects/Loom/.scratch/archive/raft-channel/` 全部归档研究。
用途：标注每个需求的 Raft 溯源——直接借鉴 / 修改（有意偏离）/ dsh 特有，
并指出偏离带来的必须补齐的语义。

## 1. 关键事实修正

- **held/draft/--anyway 机制在 raft-docs 中不存在**（全仓库 41 个 md 全文 grep
  无命中）。该机制是 `@botiverse/raft@0.0.17` CLI `message send` 的
  `--send-draft` / `--anyway` 行为（Loom 研究从 tarball 实解包确认），官方
  docs 未将其文档化。→ R11 的溯源表述改为"借鉴 Raft CLI 的并发保护行为，
  官方 docs 无对照语义"。
- **Raft 的并发协调不是靠发送校验，而是靠 claim 抢占**：claim 失败即放弃是
  防重复工作的唯一原子机制；发送侧无任何冲突检测。

## 2. R1-R12 逐条溯源

| 需求 | Raft 对应设计 | 关系 | 语义后果 |
| --- | --- | --- | --- |
| R1 Web UI 拓展 | Web app：server 容器、channel 视图、task board、成员面板、profile tabs | 借鉴结构 | 无冲突 |
| R2 workspace 项目入口 | Raft server 的 shared workspace 是协作面，agent-owned workspace 另行隔离 | 修改 | dsh Workspace 同时限定 Team scope 与共享项目 cwd；private memory 另行隔离 |
| R3 channel（1 human + 多 agents） | channel 成员含 human 与 agent，同一消息语义 | 直接借鉴 | 无冲突 |
| R4 agent 面板 + direct chat | Raft member/profile + 持久私有 DM | 部分借鉴 | dsh M2 direct chat 只打开 Member session，不是 Team DM |
| R5 消息默认即 task | **Raft 是显式标记**（As Task / Convert / Create）才是 task | **修改** | 见 §3.1 |
| R6 显式指定 task thread | agent 发送必须指定目标场所/thread | 直接借鉴 | 无冲突 |
| R7 多 claim + 方向声明 | **Raft 严格单 owner**（claim 失败即放弃） | **修改** | 见 §3.2 |
| R8 只显示 message 消息 | thread 里只有 agent 发出去的消息 + 状态；内部活动不进 thread | 借鉴（Raft 隐含支持） | 无冲突 |
| R9 显式 message 发送 | `message send` 是 agent 唯一对外发言路径 | 直接借鉴 | 无冲突 |
| R10 默认静默 + unfollow | **Raft 加入 channel 即全量投递**；@mention 是 attention signal 不是 delivery filter；thread 参与即 follow、可 unfollow | **修改收紧** | 见 §3.3 |
| R11 并发拒绝发送 | Raft docs 无此机制；CLI 0.0.17 有 held/draft/--anyway 行为 | **dsh 特有实现**（灵感来自 CLI 行为） | 见 §3.4 |
| R12 追加 turn | Raft 无 turn 概念（agent 收件箱顺序消费） | **dsh 特有** | 无冲突 |
| D26 Delivery | Raft wake acceptance 与 `message check` ack 都不表示模型处理，remote send 还有 unknown outcome | **dsh 特有本地恢复** | dsh queued/admitted/canceled 只保证 Inbox admission |

## 3. 四个实质偏离及其必须补齐的语义

### 3.1 消息默认即 task（R5，偏离 Raft 的显式 As Task）

Raft 有意区分"对话"与"承诺"：普通顶层消息不是 task，显式标记才上 board；
"board 是团队的共享记忆，对话归对话、承诺变任务"。用户设计把**每条顶层消息
默认作为 task**，取消了这层区分——好处是零操作成本、一切可追踪；代价是
channel 里的闲聊、说明、打招呼也全部成为 task 记录。

已决（D6，2026-08-14）：默认建 task（初始 todo），无承诺消息可由人或 agent 标
closed 收束；board 视图默认隐藏 closed。

### 3.2 多 claim + 方向声明（R7，偏离 Raft 的单 owner）

Raft 的单 owner 是防重复劳动的核心机制（claim 失败即放弃，无需人工指派）。
多 claim 模型保留了并行协作（讨论/coding/review 各司其职），但**失去了自动
防重复**——必须补一个新约束：

已决（D5，2026-08-14）：**同方向互斥**——同一 task 同一方向只允许一个 claim
（原子校验）；不同方向并行。既保留 Raft 防重复的原子性，又支持多职责并行。
claim 自身的状态（活跃/释放）与释放后 thread 历史的归属留待具体设计。

### 3.3 默认静默（R10，偏离 Raft 的加入即全量投递）

Raft 哲学："通知=成员关系的直接映射"（加入 channel 即 opt-in；@mention 是
attention signal，不是 delivery filter；DM 必 ping）。用户设计是**默认静默**：
加入 channel 的成员可读全部内容，但只有 @mention / follow 的 thread 才投递。

在 dsh 上这个偏离反而更自然：Agent inbox 是唯一队列，静默=不投递，可读=主动
查看工具。但需要把 Raft 没有明确分离的两层显式分开：

- **可见性**（成员能读什么：channel 成员可读全部历史）与**通知**（什么投递到
  谁的 inbox：仅 mention/follow）是两层独立语义——Raft 把两者绑在 membership
  上，我们显式分层。
- follow 的建立条件（借鉴 Raft）：在 thread 发言即 follow、被 @mention 即
  follow；可主动 unfollow（静音不退出）。

### 3.4 并发拒绝发送（R11，dsh 特有实现）

Raft docs 无对照语义；CLI 的 held/draft 行为是灵感来源。dsh 实现：message
工具携带 base revision，执行时对比 thread 当前 revision，不一致返回错误，模型
在同一 turn 重新组织（新消息已按 R12 追加为 next-step 输入，重组织时可见）。
不需要 draft 文件——dsh 的 turn 内修正天然取代了 CLI 的 draft 机制。

### 3.5 本地 Delivery receipt（D26，dsh 特有）

Raft bridge 的 wake `2xx` 只表示 notice 被本地 runtime 接受；`message check` ack 只表示 server delivered sequence 被确认；remote `message send` 在响应丢失时可能是 unknown。dsh-agent-team 不经过该 bridge/CLI，而是先提交本地 Operation，再用稳定 MessageId 投递 Agent Inbox。

`admitted` 只表示目标 session 中存在 `agent/inbox/spliced` 或 `user/message` evidence，不表示模型已读、处理或回复。Suspended/unavailable Member 保持 queued，Remove 转 canceled；Inbox append 与 admitted Operation 之间崩溃时按双证据补偿。

## 4. dsh 侧的架构优势（对照后的确认）

- **Raft 用三个东西凑出 agent 连续性**（持久身份 + workspace + memory，session
  reset 还分三档）；**dsh 的 session 一个就够**（持久 log、冷恢复、fork）。用户
  R5 的"session 不变，thread 只是 UI 展开"正是 dsh 比 Raft 更简洁的地方。
- **默认静默在 dsh 是免费能力**：inbox 是唯一队列，不投递即安静；Raft 需要
  通过 mute/leave 组合才能接近。
- **R8 的"只显示 message 消息"在 dsh 是天然分离**：session log 留内部事实，
  团队消息流是独立投影。

## 5. 可借鉴机制（选自 raft-design-details.md I 节，映射到本设计）

| Raft 机制 | 本设计采纳方式 |
| --- | --- |
| Task 由顶层 Message 承载编号/状态/owner 元数据 | ✅ 对象结构基础；dsh 自动为每条顶层 Message 创建 Task 是有意扩展 |
| 5 态状态机 + closed 可逆 | ✅ dsh 以 Claims + Human accepted/closed 派生 |
| 大任务拆互不阻塞子任务并行 | ✅ 成员内部用 dsh subagent/workflow 承载 |
| 参与即 follow、可 unfollow | ✅ R10 的 follow 语义 |
| DM/mention/follow 与 Activity pull 面的信号分级 | ✅ 借鉴信号分级；dsh 不继承 joined-channel ordinary delivery，改为 mention/Follow 才投递 + `team_view` 主动读取 |
| Activity 三过滤 + Saved 独立 | ✅ 主动查看工具的分组参考 |
| thread 只放明确消息 + 状态 | ✅ R8 |
| lanes not job titles（description 即分工表达） | ✅ R4 的角色定位面板 |
| agent 可自更新 description | ✅ 留作管理面板的扩展能力 |
| onboarding 接力（先带一个，再由它带队友） | ✅ 团队冷启动流程参考 |
| 混合 runtime（成员用不同模型） | ✅ dsh 的 per-agent 模型路由天然支持 |

## 6. 不继承的 Raft 约束

- 消息不可编辑/不可删除 → M1 同样不可编辑/删除，但这是 dsh 当前 policy，不是必须继承的 Raft 模式。
- 严格单 owner → 已偏离为多 Direction Claims；精确文本互斥不消除语义重复风险。
- thread 不能嵌套 → 首版沿用单层，但不视为永久约束；Task close 不删除 Thread。
- 仅显式标记的顶层消息成为 task → dsh 不设转换操作，每条 Channel 顶层消息自动创建 Task。
- 加入 channel 即 ordinary delivery → 已偏离；dsh membership 是可见性，mention/Follow 才产生 Delivery。
- Raft 持久 DM → M1/M2 不实现 Team DM；M2 direct chat 是 Member session access。
- Reminder、attachment、profile/membership writes → 不进入 M1，未来各自定义 authority、持久化与 failure semantics。

## 7. 对 feasibility.md 的修订

- R11 溯源更正：held/draft/--anyway 是 CLI 0.0.17 行为（tarball 确认），
  raft-docs 未记录；dsh 实现为 base revision 检查，无 draft 文件。
- R7 判定补充：多 claim 需新增"同方向互斥"约束（或明确自由 claim 决策）。
- R10 判定补充：可见性与通知显式分层。

## 来源

- `../research/raft-design-details.md`（Raft 官方文档产品事实，2026-08-14）。
- `/home/yu/projects/Loom/.scratch/archive/raft-channel/research/raft-primary-sources.md`、`raft-domain-and-agent-collaboration.md`、`raft-cli-capabilities.md`（primary sources、CLI 0.0.17、bridge/wake 与 failure facts）。
- `/home/yu/projects/Loom/.scratch/archive/raft-channel/design/raft-individual-interaction-model.md`（Loom Adapter 选择，不作为 dsh runtime 规范）。
- `feasibility.md` D1-D26 与 `architecture.md`（dsh 当前产品和实现决策）。
