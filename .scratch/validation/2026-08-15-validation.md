# dsh Agent Team 第二轮全方位验证报告

日期：2026-08-15
方法：动态 Cordis 插件（plugin `tmvrt-1`，pkg-1…pkg-19；client 插件 `tmvru-2`）在
真实 dsh 进程（npx 部署 rc.6，web profile，127.0.0.1:3080）中逐项验证。证据来自
工具返回、事件流、session 持久化文件与 sessionQuery 冷读。本轮覆盖：上轮全部
未验证项 + D23（四工具）/ D24（里程碑 M1 边界）所引入的新机制。
状态：全部计划内验证项完成（含 client 两席 take+渲染的用户目视确认）。

## 1. 结果总表

| # | 验证项 | 方法 | 结果 |
| --- | --- | --- | --- |
| 1 | compaction 实际触发（manual） | 成员 preset 引擎 `serviceFor(agent,'compaction').compactNow` | ✅ 15 节点 / 6015 tokens 被真实模型摘要替换；`compaction/start→summary→replace→end` 完整落盘；surface 6416→818 tokens |
| 2 | compaction 自动压力触发 | preset 引擎自带 `agent/pre-step` 监听（thresholdRatio 0.001） | ✅ turn 4 pre-step 处自发 `compaction/start`，无任何外部调用 |
| 3 | team-member preset 正例 | `tmvrt-member`（persona + compaction isolate 组） | ✅ `standingKeyFor` mounted OK；成员级 `serviceFor('compaction')` 可寻址、host 无泄漏 |
| 4 | preset 反例 | `tmvrt-bad`（compaction-basic 无 isolate） | ✅ 拒绝："row(s) published process-global service(s) [compaction]; a preset service must sit behind an `isolate` realm" |
| 5 | 成员创建/resume | `agents.create`（setup 内 `agentPresets.mount`）/ `agents.resume` | ✅ 创建即带 preset+工具；resume 从持久化恢复全量事件与 inbox（Inbox = replay-once projection） |
| 6 | 四工具全形态（D23） | team_send/view/claim/follow 由真实模型驱动 | ✅ 全部 action 分支闭环：发送（建 task/reply）、revision 冲突拒绝并携带 newer 消息（base 0 vs 1 实测）、unfollow-mention 首拒+同参放行、mention→follow 落行（f-task-2-tmvrt-m1 active:true）、view 分页（limit=1 → nextCursor="1"）+ opaque refs + claim 状态、claim list/claim/done/release/同方向冲突/多方向歧义守卫（"you hold several claims (docs, tests); name a direction"）、follow status/unfollow/follow |
| 7 | claim 同方向互斥（D5） | task 行 `KvTable.update` 原子 RMW | ✅ 并发双成员抢同方向：恰好一个 active（tmvrt-m1 胜）；败者 log：tool/result 冲突 + 模型复述"already held by tmvrt-m1 (active)" |
| 8 | task 派生状态全组合（D16） | 13 组合矩阵 + 真实流转 + closed/accepted 覆写 | ✅ empty→todo、active→in_progress、全 done→in_review、全 release→todo、closed 覆写一切、accepted→done、reopen 恢复派生；**done+release 混合→in_review（决策未覆盖边，见 §4-F3）** |
| 9 | D19 claim 变化通知 | claim/done/release → 全部 follower 投递 prompt | ✅ 每次变化收到 `[team:claim]` prompt 且落盘（inject→splice→user/message） |
| 10 | D15 unfollow-mention 二次放行 | 真实模型：首次拒绝→同参重试→放行 | ✅ m1 两次 `team_send`（相同 target/text/mentions）：首拒、模型复述原因并重试、成功投递并 re-follow |
| 11 | D20 成员移除 | member_remove 服务逻辑 + 真实模型行为 | ✅ claims 自动 release→task 回 todo；follow 行删除；roster inactive；被移除者发送被拒（模型理解"not a team member"） |
| 12 | 冷恢复补偿投递 | stop 插件→新包重开 domain→resume 成员→补偿重投 | ✅ pending 行跨插件边界存活；重投后 `agent/inbox/spliced` 落盘、nextStep=1；invariant 复核 17/17 干净 |
| 13 | invariant（Model-visible ⟺ logged） | delivery 行 ↔ session log 证据关联 + 负例 | ✅ 正例 0 违例；伪造无落盘 delivered 行被精确抓出（18 查 1 违例）；证据公式见 §2.5 |
| 14 | `/team` 命令（D24 M1 human 面） | `ctx.commands.register` + `commands.execute` | ✅ `command/run`+`command/done` 落盘、返回 board 文本、无模型轮 |
| 15 | team MessageSource 合并点 | 类型源码确认 + 动态替代端到端 | ✅ 合并点=`MessageSourceMap`（dsh-llm）；`{kind:'plugin', form:'relay'}` 全场景可用 |
| 16 | client take+渲染（M2 预研） | `sidebar.workspaces` + `conversation` priority -1 | ✅ 两席 take 成功（occupants: dyn/tmvru-2 active，x6 被遮蔽）；render-ack 回写（host.call 全链路）；诊断零错误；用户目视确认两处渲染；用户手动 stop/run 循环 3 次——每次 stop 官方 UI 恢复（take 可逆再证） |

## 2. 关键机制结论

### 2.1 compaction（上轮未验证项 #2）

当前部署 **web profile 在 host 层禁用 compaction-basic/plan-mode**（dsh-web-app
bundle patch 行 348/359：tokenMeter 留 host，compaction backend 移入 presets）。
因此 D24 的"team-member preset 样板含 compaction-basic 行"**在本部署成立且必须**：
preset 里的 compaction-basic 必须进 isolate 组（反例拒绝文本见 §1-4）；成员级引擎
可由 host 侧 `ctx.agentPresets.serviceFor(member, 'compaction')` 寻址（isolate realm
不泄漏到 host）。自动压力触发由引擎在 realm 内注册的 `agent/pre-step` 监听完成，
团队服务无需参与；thresholdRatio × 模型 contextWindow 是触发口径（opencode-go
adapter 无 context 容量时抛 `TargetPressureConfigError`，仅告警继续）。manual 路径
对过小 span 返回 `summary` 分类错误（摘要不比原文短——正确行为）。

### 2.2 成员生命周期（M1 实现前提）

- `meta.agentPreset` 只写 session header；**preset 挂载必须由创建者的 setup 调用
  `agentPresets.mount(agentCtx, id)`**（agent-loop 工厂不自动挂）。setup 若返回
  Promise，其 resolve 值会被当作 AgentSetupCommit 调用 `.commit()`——必须 async
  setup 内 await、返回 undefined。
- 动态插件创建的成员归创建 fiber 所有：**插件包更新/停止会 dispose 其创建的
  成员**。session 持久化文件不受影响，`agents.resume({resumeSessionId})` 是真实
  冷恢复原语（Inbox 由 log 中 `agent/inbox/spliced` 重放重建）。M1 含义：成员创建
  必须落在 host 行（fiber 与进程同寿），重启后由 host 组合 resume。

### 2.3 团队对象持久化

`storageDomain.open` 的 `DomainSpec` **必填 `version`**，records 用 zod schema 的
`.parse()` 在 open 时校验（动态环境用 `{safeParse, parse: v=>v}` 替代）。domain 数据
跨插件 stop/start 完整存活（pending 行、16 条投递、task/message/claim/follow 全在）。
claim 互斥原语 = task 行 `KvTable.update`（原子 RMW，写链串行）——双成员并发实测
恰好一个赢家。

### 2.4 投递与通知

`member.inject(message)` 落 next-step：运行中成员下一步可见（本轮 D19 通知即时出现在
我当前 turn），空闲成员停留 inbox 直到唤醒。投递的 durable 证据分两段：**停驻期 =
`agent/inbox/spliced`（inserted 数组含 message id）；被认领后 = `user/message`**。
冷恢复补偿 = 扫描 status=pending 的 delivery 行 → 对已 resume 成员重投（写行→splice
→标 delivered 的窗口即崩溃窗口）。

### 2.5 invariant 公式（M1 直接可用）

"投递给成员的每条团队消息可从 session log 重建"的精确判据：
`delivery.status==='delivered' ⇒ 成员 session log 存在 (user/message with
data.id===inboxId) ∨ (agent/inbox/spliced with inserted[].id===inboxId)`。
正例 17/17、伪造负例被精确抓出。注意 `ctx.invariants` 注册表在本部署 host 未挂载
（dsh-invariants 行不在 web 组合）——正式包的 invariant companion 需 host 组合挂
dsh-invariants 行（companion 模式照 session-invariant 源码，见上轮已读）。

## 3. client 渲染面（验证完成）

`sidebar.workspaces` 与 `conversation` 两席契约已实测（single seat、
`shadows-shipped-ui`、priority -1 可 take；`conversation` 的 standardProps 含
useSessions/useWorkspaces/useSession/useProjection/useInput/inputActions）。插件
`tmvru-2/pkg-20`（host: 重开 domain + `team-board`/`render-ack` RPC；client: 两席
take + 最小团队视图 + 渲染确认回写）经 UI 审批激活（run-20，current pkg-20）。
**验证结果**：

1. ✅ occupants：`sidebar.workspaces` 与 `conversation` 均为
   `registrant: dyn/tmvru-2`（priority -5 / -6，active: true），shipped `x6`
   转 active: false——两席 take 成功、官方实现被遮蔽；
2. ✅ 数据流：`team_probe acks` 读到 `conversation-1786790625268`——client 组件
   挂载后 `host.call('team-board')` 取板、`render-ack` 回写（client→host RPC 全链路）；
3. ✅ 诊断：`cordis_inspect_self(tmvru-2, pkg-20)` host/client 均 running、无
   waitingFor、无 client-render 错误；
4. ✅ 目视确认（用户 2026-08-15）：sidebar #channel 区域（chan-1 + task 状态 +
   成员名）与中心列 Team view（4 条团队消息）均正常显示；用户随后手动
   stop→run→stop 循环 3 次，每次 stop 官方 UI 完整恢复、run 重新 take——**take
   可逆性与恢复路径由用户侧实测确认**；
5. 收尾状态：伪造负例行 `d-fake-negative` 已从 domain 文件删除；两个验证插件
   均已停止（定义保留，可按需 `cordis_undefine`）；`dsh_team_v2.json` 与
   tmvrt-member preset 保留为 M1 参考。

## 4. 发现与修正清单（对 design 文档）

本节保留验证时点结论。D26 已正式固定 done+release 为 in_review，并用显式 confirmation token 替换 F4 原型中的隐藏 per-sender cache。

- **F1（D24 确认）**：team-member preset 的 compaction-basic 必须进 isolate realm；
  host 已挂 compaction 的部署不应再在 preset 挂（避免双引擎）。当前 web profile
  host 无 compaction ⇒ preset 挂载路径正确。
- **F2（新机制）**：成员创建/恢复由 team 服务（host 行）执行时，setup 必须显式
  `agentPresets.mount`；成员归 team 服务 fiber 所有，host 行不受插件热更新影响。
- **F3（决策边）**：D16 未覆盖 done+release 混合——本实现定为 in_review（有 done
  且无 active）。建议补进决策文本或标记为实现面选择。
- **F4（投递规则）**：mention → 自动 follow（R10/D15 "被 @mention 即 follow"）必须
  在发送实现中落 follow 行；发送者排除自投递时按 memberId 排除（不能用 name）。
- **F5（D15 实现）**：二次放行确认缓存应 per-sender（全局缓存 = 其他成员同内容
  免费放行）。
- **F6（D19 展示）**：通知 prompt 的 from 字段用 roster name（成员可见面）。
- **F7（M1 测试面）**：REAL-composition 测试可直接用 `ctx.tools.execute` + 注册
  agent 的模式（tool-todo loader-composition 先例已读）；双成员端到端验收在本轮
  动态插件里已等价达成（真实模型并发 claim/发送/移除全链路）。

## 5. 踩坑增补

见 `validation/pitfalls.md` 新增条目（pkg 迭代中 12 条新坑：inject 声明时机、
ctx.effect 语义、DomainSpec.version、user/message data 形状、AbortController 缺失、
AgentSetup commit 语义、假 zod 的 parse、pkg 更新 dispose 成员等）。

## 6. 结论

上轮全部未验证项 + 本轮 D23/D24 引入的新机制全部验证通过（含 client 两席
take+渲染：occupants 实测、RPC 数据流、用户目视确认与 stop/run 循环的可逆性）。
没有发现推翻 D1-D24 的障碍；发现 3 个需要回写设计文档的精确化（F2/F3/F5）与
1 个决策未覆盖边（F3 done+release 混合）。M1 机制核心的实现路径全部有实证支撑。
