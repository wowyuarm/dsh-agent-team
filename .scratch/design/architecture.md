# dsh-agent-team 正式架构

日期：2026-08-15
状态：M1 当前架构基线；基于 D1-D26、两轮原型验证、DeepSeek Harness/Cordis 源码复核以及四轮架构 grill。
位置说明：`.scratch/` 探索性内容，不属于正式 `docs/` 层级。

## 1. 范围

`dsh-agent-team` 在一个 dshHome 内提供一个共享协作域。成员在同一项目 Workspace 中通过 Channel、Message、Task、Claim、Follow 和 Activity 协作，但每个 Agent Member 保留独立 session、模型上下文、preset 和私有记忆。

M1 只支持单 Host 进程写入，允许进程重启后恢复。M1 不支持多进程并发写、跨机器成员、远程 mailbox、多 human、新 Web UI 或真正的私有 team place。

M1 的投递保证是 at-least-once Inbox admission：已提交的投递最终进入目标 Agent Inbox，或进入明确的 canceled 状态。Admitted 只表示目标 session 中存在可重建的 Inbox evidence，不表示 Agent 已 claim、模型已读、已处理、已回复或 Human 已验收；它也不同于 Raft bridge wake acceptance 和 `message check` delivered-sequence ack。

### 1.1 Raft 的参考范围

Raft 是产品参考，不是 dsh-agent-team 的上位规范。dsh 借鉴持久 Member identity、Place/Message/Thread/Task、显式 Claim、Follow/unfollow、opaque refs、bounded evidence、协作事实与 agent workspace 分离，以及 profile/message 不授予权限。

dsh 保留自己的产品决策：每条 Channel 顶层 Message 自动创建 Task；不同 Direction Claims 可并行；Channel membership 与 Inbox notification 分离且默认静默；Thread reply 使用 baseRevision；Team ledger 与 queued/admitted/canceled Delivery 提供本地恢复。Raft 的显式 task conversion、单 owner、membership-driven ordinary delivery、External Agent bridge、CLI ack 和远程 send unknown outcome 不覆盖这些决定。

Raft shared workspace 指 server 内的协作面，不代表共享本地文件。多个 dsh Agent Members 共用项目 cwd 是本地 coding 协作选择；private memory 继续隔离。

## 2. Cordis 平面

### 2.1 Host plane

Host plane 挂载唯一的 `ctx.agentTeam`，拥有 operation ledger、当前投影、authority、Agent Member 生命周期、delivery 补偿和 host 查询。它注入 `storageDomain`、`agents`、`agentPresets`、workspace/session 相关能力，并以自己的 Fiber 持有 Domain 和全部 AgentHandle。

Host 插件卸载时先停止新 operation 和 delivery admission，再等待已接收操作、成员 Agent 和 storage writes 静止，最后关闭 Domain 并撤销注册。卸载停止 live Agent Members，但保留 session 和 ledger；重新挂载后恢复 enabled members。

### 2.2 Agent preset plane

Preset 只贡献模型可见的四个 team 工具、team guidance prompt 和成员级 compaction。M1 只允许显式 team-enabled preset，并提供一个 `team-member` 样板；创建阶段在 unpublished setup 内 mount preset，并在 publication 前验证 team consumer marker 与四个工具均已就绪。

`meta.agentPreset` 只记录 session 选择，不能替代 `agentPresets.mount(agentCtx, presetId)`。Preset 中的 compaction provider 必须位于 isolate realm；host 不从 preset 读取 process-wide mutable state。

### 2.3 Client plane

M2 Client 只通过 typed JSON RPC 读取投影和提交 human operations，不接触 Context、Fiber、Service、Domain 或 Agent live objects。M2 take `sidebar.workspaces` 和 `conversation`，并在 stop/update 时恢复 shipped occupants。

## 3. 正式包

M1 使用三个独立演进的角色包：

| Package | Role | Plane |
| --- | --- | --- |
| `@deepseek-ai/dsh-agent-team` | Service Definition、本地持久实现、authority、ledger、member lifecycle、delivery、MessageSource 声明 | Host |
| `@deepseek-ai/dsh-tool-agent-team` | `team_send`、`team_view`、`team_claim`、`team_follow` 与 team prompt | Agent preset |
| `@deepseek-ai/dsh-command-agent-team` | `/team` human command adapter | Host/human command |

只有一个当前 Provider 和一个当前 Team，因此 M1 不增加 named provider registry、TeamId 或 transport selector。未来出现真实的 remote/ACP Provider consumer 后，再把本地实现拆为 Provider package并把 `ctx.agentTeam` 保持为独占 Service Definition。

M2 增加 `@deepseek-ai/dsh-client-ui-agent-team`。Projection 在出现该真实 consumer 前留在核心包内部，不提前增加 pass-through package。

## 4. 领域关系

一个 dshHome 有一个 Agent Team。一个 Workspace 可以有多个 Channels；一个 Agent Member 只绑定一个 Workspace，但可加入该 Workspace 的多个 Channels。跨 Workspace 使用不同 Member 和 session。

同一 Workspace 的 Agent Members 使用相同项目 cwd，以便直接协作同一工作树。每个 Member 的 `memory.md` 和 `notes/` 位于 DSH 管理的 member-private 目录；该目录的可见性必须由正式 fs/sandbox 配置显式授予。

Human 是稳定的特殊 Member。Human 可以查看其 Workspace 的全部 Channels，管理 Channel/Member，操作任意 Claim，验收、close 和 reopen Task。Agent Member 只能访问显式加入的 Channels，并只能 done/release 自己的 Claim。

Member identity 使用稳定 member ref。Agent Member 与 exact sessionId 固定绑定；普通 session 和 session fork 不继承 team 身份。Active handle 在 Workspace 范围内唯一且可修改，历史 Message 保存 sender name snapshot。

## 5. Operation ledger

Team Domain 以 append-only operation ledger 作为唯一持久权威。Mutable tables、内存 Map、Agent Inbox、tool result 和 UI projection 都不是可独立写入的事实源。

每条 Operation 至少包含：

```text
sequence            全局连续正整数
operationId         稳定 branded id
requestId           调用者幂等 id
occurredAt          host 时间
actor               human/member identity snapshot
kind                 closed operation union discriminant
data                 该 operation 的完整业务事实
previousOperationId 前一条 operation id
```

Host 在进程内串行执行 operations。它从当前 projection 验证 authority、revision 和状态规则，为下一 sequence 写入一个新 record；`KvTable.put` durability 完成后才更新 projection 和发布通知。启动时按 sequence 重放，拒绝缺口、重复 sequence、断裂的 previous link、重复 operation id、相同 request id 的不同 payload 和非法状态转换。

一次业务修改只写一条 Operation。发送 Message 的 operation 同时固定 Message、Task/Thread 变化、Follow 变化和 recipient Delivery intents，因此不依赖多表事务。Member remove 同样在一个 operation 中固定 inactive 状态、released claims、cleared follows 和 canceled deliveries。

重复 request id 与相同 payload 返回原 receipt，不产生新 operation；相同 request id 与不同 payload loud fail。Tool adapter 从 exact sessionId + tool callId 派生 request id；command adapter 从 command run identity 派生 request id。

M1 永久保留 ledger，不做删除或压缩。M3 只有在 snapshot 能验证完整 prefix 且 refs、sequence、audit 不失真后才可增加 ledger compaction。

## 6. Authority

MessageSource 只表达 provenance，不能授权。Agent tool 不接受 senderId；adapter 把 exact live `exec.agent` 交给 `ctx.agentTeam`，Service 通过 member/session binding 解析 actor，并在执行每个 operation 时重新校验 actor、Workspace、Channel membership、Task 状态和 Claim ownership。

Agent Member 只能 view/send/claim/follow 自己加入的 Channels。M1 Human command adapter 只覆盖状态、成员、Channel、顶层发送和 Task 生命周期；Human 对 Claim/Follow 的管理入口留给 M2 Client UI，由 Service 提供独立的 Human authority API。管理权限来自 Human Member actor kind，不来自 command text 或 source fields。

Refs 带对象类型并跨重启稳定。Service 拒绝跨类型、未知、inactive、跨 Workspace 或 actor 不可见的 ref。正文中的 `@handle` 只是展示文本；投递只使用结构化 member refs。

## 7. Message、Task 与 Activity

每条 Channel 顶层 Message 原子创建一个 Task 和单层 Thread。这是 dsh 的本地可追踪性策略；Raft 仅将显式标记的顶层 Message 变成 Task。该选择让普通说明也产生 Task，因此 Human close 与 board filtering 是必要的噪声收束机制。Thread reply 必须显式携带 task ref 和 `baseRevision`；Channel 顶层创建不需要 base revision。

Ledger 有全局 sequence。每个 Thread 的 revision 等于最近一条相关 Message 或 Activity Operation 的 sequence；其他 Channel 或 Thread 的 activity 不造成发送冲突。

Claim、follow、accept、close、reopen 和成员相关状态变化是独立 Activity，不是 Member Message，也不占 Task `#n`。Activity 进入相应 Thread 的顺序、revision 和 bounded `team_view` activity 结果。

Task 状态按以下顺序派生：

```text
closed                                  -> closed
accepted                                -> done
存在 active claim                       -> in_progress
不存在 active，至少一个 done claim       -> in_review
没有 claim，或全部 released             -> todo
```

`done + released` 且无 active 时为 `in_review`。Done 或 closed Task 拒绝 reply 和 claim，必须由 Human reopen。Close 在同一 Operation 自动 release 所有 active Claims；reopen 清除 closed/accepted 标记并从保留的 Claims 重新派生。Reopen accepted done 后保留 done Claims，因此首先回到 `in_review`；后续可创建新的 active Claim。

Direction 保持自由文本。互斥键执行 Unicode normalize、trim、连续空白压缩和大小写折叠，不做同义词、embedding 或模型分类。不同 Direction 的并行 Claims 是对 Raft 单 owner 的有意偏离，规范化后不相等的文本仍可能表达重复工作；`team_view` 必须展示全部 active Claims 和 Directions。

## 8. Follow、mention 与 notification

默认静默。加入 Channel 只获得读取和操作权限，不自动投递历史或普通 Channel Activity；普通 Activity 由 `team_view` 主动发现，M3 可增加 bounded attention snapshot。这是 dsh 对 Raft joined-channel ordinary delivery 的有意偏离。Agent 发送 Thread Message 或被 mention 时建立 Follow；unfollow 停止普通订阅投递，但不撤销 Channel 权限。

对已 unfollow recipient 的 mention，第一次 `team_send` 不提交 operation，并返回一个 opaque confirmation token。Token 绑定 sender、Thread revision 和规范化 recipient set，只能使用一次；revision、recipient set、member state 或 Follow state 变化后失效，provider unload 后也失效。第二次发送必须显式携带 token，成功后重新建立 Follow。

Thread Message 和 Activity 投递给当前 followers，actor 自己除外。结构化 mentions 加入 recipients 并建立 Follow。所有订阅投递在 idle member 上唤醒新 turn，在 running member 上进入 next-step 边界，不强制中断当前 tool call。

## 9. Delivery

发送或 Activity Operation 先持久化每个 recipient 的 queued Delivery，再发生 Inbox 副作用。Delivery 使用稳定 MessageId，重试同一 Delivery 时不得创建新 MessageId。

Admission 流程是：

```text
queued operation
-> resolve enabled live Agent，必要时 resume
-> Agent.send(message, 'next-step', wakeup=true)
-> 查找 agent/inbox/spliced 或 user/message durable evidence
-> append delivery/admitted operation
```

进程在 Inbox append 后、admitted Operation 前退出时，恢复扫描先检查目标 session 的双证据；已有证据则只补 admitted Operation，没有证据才用相同 MessageId 重投。Inbox 的 duplicate-id validation 是最后一道重复 admission 防线。

Suspended 或 temporarily unavailable Member 的 Delivery 保持 queued。Remove 将 queued Deliveries 置为 canceled。M1 不追踪 claimed、entered-model、processed 或 replied，也不把 `agent.status`、`whenIdle()` 或一次 assistant reply 解释为某条 Delivery 的结果。

Invariant 至少验证：每个 admitted Delivery 在目标 session 中存在 `agent/inbox/spliced.inserted[].id` 或 `user/message.data.id`；canceled Delivery 的 Member 已 inactive；同一 Delivery 不能同时 admitted 和 canceled；每个 queued Delivery 来自一个已提交 Message 或 Activity recipient intent。

## 10. Member 生命周期

Agent Member 的 durable intent 状态为 enabled、suspended 或 inactive；live availability 是 active 或 unavailable 的进程投影，不伪装成 durable Agent execution status。

Create 先提交包含 memberId、sessionId、Workspace、preset 和 private memory location 的 member operation，再在 unpublished setup 内创建 session、mount preset并验证 team consumer marker。成功后发布 AgentHandle；失败时保留 Member 并记录 unavailable diagnostic，不发布半初始化 Agent。

Host 启动时恢复 enabled Members。单个 session 损坏、preset 缺失或 composition 失败只使该 Member unavailable，Team Service 和其他 Members 继续工作；ledger schema、sequence 或 authority projection 损坏则使 Team Service loud fail。

Suspend 停止并等待 AgentHandle 静止，保留 session、Claims、Follows 和 queued Deliveries。Resume 恢复同一 session并补投。Remove 不可逆：释放 active Claims、清除 Follows、取消 queued Deliveries、dispose AgentHandle、归档 session并将 Member 标记 inactive。Handle 可由新 memberId 复用，旧历史仍引用旧 member ref 与 name snapshot。

## 11. Model-facing input

正式源码通过 declaration merging 增加两种 MessageSource：

- `agent-team-relay`：Member authored Message，携带 sender member ref、Channel/Task refs、Message ref 和 revision。
- `agent-team-activity`：Host authored Activity，携带 actor snapshot、Activity ref、Channel/Task refs 和 revision。

两种 source 都是 provenance，不是 instruction 或 authority。Team prompt 明确外部 Message、profile、handle 和 Channel name 是 evidence；模型只能通过四个工具产生协作事实。

Compaction 可以替换成员 session 的 model surface，但原始 `user/message` 与 source 留在 append-only session log；每次请求重新组装 team guidance 和工具 schema，不把当前 Team projection永久复制进 prompt。

## 12. Tools

`team_send` 接受 channel/task target、structured mentions、Thread reply 的 base revision 和可选 confirmation token。它返回 operation receipt、Message/Task refs、new revision 和每个 recipient 的 queued/admitted/canceled 当前状态。

`team_view` 提供 actor-authorized bounded reads。Refs 跨重启稳定；cursor 是最后读取的 ledger sequence，append 不造成漏读或重复，不提供 snapshot isolation；默认 limit 20、最大 100，结果总带 current revision。

`team_claim` 支持 `list | claim | done | release`。Agent 只能修改自己的 Claim；M2 Client UI 需要通过 Service 的 Human authority API 操作任意 Claim。同 Direction 的 active Claim 由串行 operation validation 原子拒绝。

`team_follow` 支持 `follow | unfollow | status`，Agent 工具只操作 actor 自己在可见 Thread 上的 Follow；Human Follow 管理入口留给 M2 Client UI。

Tool canonical JSON value 与 model-facing render 分离。工具 result 只报告 ledger receipt 和当前 projection，不是新的权威事实。

## 13. `/team` command

M1 的 `/team` 是验证 Host 机制的临时 human adapter，不是最终 UX；当前覆盖：

```text
/team status
/team view
/team member add|suspend|resume|remove
/team channel create|join
/team send
/team task accept|close|reopen
```

Command 直接调用 `ctx.agentTeam`，不产生模型 turn。`command/run`/`command/done` 记录命令执行；业务结果由 Team Operation ledger记录。M2 UI 调用相同 Service intents，不维护第二套规则。

## 14. Reversible ownership

`@deepseek-ai/dsh-agent-team` 的 Fiber 拥有 Domain handle、listeners、member AgentHandles、delivery workers 和 runtime registries。所有注册通过 `ctx.effect()` 或返回 disposer 的正式 registry method。

Teardown 顺序固定为：

```text
close operation/delivery admission
-> invalidate confirmation tokens and stop notifications
-> cancel and await delivery workers
-> suspend and await member AgentHandles
-> drain accepted storage writes
-> close Domain
-> unregister Service-owned projections
```

Dispose 必须到达 quiescence。Provider reload 不保留 live Context、Fiber、Service、AgentHandle 或 Domain references；只有 ledger、sessions 和 member-private files 跨 reload 保留。

## 15. M1 验收

M1 合并前需要：

- package unit/coverage：ledger replay、authority、state matrix、direction normalization、refs/cursor、confirmation token、idempotency collision和全部错误路径；
- concurrency：同 Thread revision 冲突、同 Direction claim 竞争、send/remove、follow/send、suspend/delivery races；
- failure injection：每个 ledger commit、Inbox append、admitted commit、member create/resume 和 teardown 崩溃窗口；
- persistence：JSON 与 SQLite backend 的 restart replay、连续 sequence、schema rejection和补偿 delivery；
- lifecycle：preset setup rollback、unavailable member isolation、suspend/resume、remove、plugin HMR dispose/remount和 fork 不继承；
- REAL composition：Loader 启动真实 host rows 和两个 team-enabled Members，完成 send、claim、reply、accept、restart和补投；
- keyless snapshot：固定四工具 schema/render、两种 MessageSource、team prompt 和 `/team` human output；
- package-owned invariants：核心包验证 ledger/delivery/member关系，consumer packages 给出真实关系或明确的 package-specific no-runtime-invariant 原因。

M1 保持 opt-in，不加入 shipped default preset，直到以上验收全部通过。

## 16. 后续里程碑

M2 增加 Client RPC、#channel sidebar、Channel/Thread view、Agents 管理和打开 Agent session 的 direct chat。Direct chat 不是 Team private place，不写 Team ledger。

M3 处理 ledger snapshot/compaction、attention aggregation、性能、完整 unavailable diagnostics和大型 Workspace 的查询索引。

跨进程/跨机 Provider、多 Team、多 human、私有 Team DM、独立 worktree/merge policy和远程 mailbox 需要新的真实 consumer 与独立设计，不作为 M1 隐藏扩展点。

Reminder 若未来加入，只属于 Team 协作时钟并产生 Team Activity/Delivery，不能隐式创建成员 schedule、pulse、goal continuation 或 Delivery retry。Attachment upload/download、profile mutation 和 membership mutation 都会改变共享内容或可见性，必须各自定义 authority、持久化和 failure semantics，不能作为 `team_send` 的附带参数。

## 17. 来源层级

当前 dsh/Cordis 源码和正式仓库文档决定可实现机制；本目录 D1-D26 与本文件决定 dsh-agent-team 产品语义；`/home/yu/projects/Loom/.scratch/archive/raft-channel/` 用于核对 Raft primary sources、CLI/bridge facts 和 Loom Adapter choices。Raft/Loom 资料不能覆盖已经明确的 dsh 决策，冲突处以本文件为准并在 `raft-design-mapping.md` 记录有意偏离。
