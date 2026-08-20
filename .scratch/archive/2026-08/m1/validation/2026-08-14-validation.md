# dsh Agent Team 初步验证报告

日期：2026-08-14
方法：动态 Cordis 插件（plugin `tmvrf-1`，迭代 pkg-1…pkg-7）在真实 dsh 进程中
逐项验证核心机制；证据来自工具返回、事件流与 session log 读取。
状态：全部计划内验证项通过；未验证项与修正清单见 §5-§6。

## 1. 验证结果总表

| # | 验证项 | 方法 | 结果 | 关键证据 |
| --- | --- | --- | --- | --- |
| 1 | 多 agent 同进程共存 | `ctx.agents.list()` | ✅ | 进程内 4 个 live agent（2 running + 2 idle）；创建测试成员后 5 个 |
| 2 | 创建团队成员 agent | `agents.create({sessionId, meta, agentOptions, setup})` | ✅ | `teamtest-msu3y6c` 创建即 idle；`meta.agentPreset` 可指定 preset；`setup` 可 restrict |
| 3 | 安静投递 `inject` | `member.inject(UserMessage)` | ✅ | inbox.nextStep 0→1，状态保持 idle（未唤醒） |
| 4 | `send(next-step, wakeup=false)` | 三参 `Agent.send` | ✅ | inbox.nextStep 1→2，仍 idle；next-step 队列语义确认 |
| 5 | 唤醒投递 `followup` | `member.followup(UserMessage)` | ✅ | 状态 idle→running→idle，完整 turn 执行 |
| 6 | Model-visible ⟺ logged | `sessionQuery.readSession` | ✅ | 成员 log：`agent/inbox/spliced`×5、`turn/start`、`user/message`×4（3 条投递全部落盘）、`request/*`、`assistant/message`、`turn/end`——投递内容可完整重建 |
| 7 | 乐观并发（R11） | `team_send` 工具带 baseRevision | ✅ | conflict（rev 1 vs 2）→ 返回新消息 → 模型重组织 → 重发成功；"工具错误→模型修正"闭环真实发生 |
| 8 | 团队对象持久化通道 | `storageDomain.open` + `KvTable` | ✅ | put/get 正常；**`KvTable.update` 是原子 RMW——D5 同方向 claim 互斥的原语**（"Atomic read-modify-write on the domain's write chain"） |
| 9 | token 测量（compaction 输入侧） | `tokenMeter.measure` | ✅ | surfaceTokens 21.6 万 / 275 nodes——"token 阈值触发"的测量端可用 |
| 10 | client Slot 挂载 | `slots.register` + pkg-7 激活 | ✅ | `sidebar.footer.action`（Agents 触发器）与 `conversation.session.header.actions`（Team 按钮）注册后 client 运行无诊断错误 |
| 12 | client Slot take 行为 | pkg-8：priority -1 短暂 take + 自动恢复 | ✅ | `sidebar.workspaces` 与 `conversation` 均 took → 6s 后 restored（take-log 证据，双端无错误） |
| 11 | Member direct chat/workspace UI 的现成 API | client Service 目录 | ✅ | `ctx.sessions.open(id)` 打开任意 session；该视图不是 Team DM；`ctx.workspaces` 提供 create/rename/archive |

## 2. 关键机制结论

### 2.1 peer 投递管道（D2/D10 的载体）——全部成立

`Agent.inject`（安静）/ `Agent.send(msg, target, wakeup)`（路由）/ `Agent.followup`
（唤醒）三种投递在真实 agent 上行为符合设计预期：安静投递只入 next-step 队列
不打断；唤醒投递走完整 turn 生命周期。**团队服务的投递策略（mention/follow/
unfollow → 投递或不投递）只需选择这三种原语**，无需任何新管道。

### 2.2 投递归因

验证用 `source: { kind: 'plugin', plugin: 'dsh-agent-team', form: 'relay' }`——
`plugin` kind 是现成扩展点，`form: 'relay'` 的官方语义即"A message another agent
addressed to this one"。正式包应通过声明合并新增 `team` kind（动态插件无法声明
合并，正式包无此限制）。

### 2.3 并发保护（R11）——模型行为级验证

冲突拒绝 → 携带新消息的错误结果 → 模型在同一 turn 重读新消息重新组织 → 重发
成功。完整闭环在真实模型行为上成立；不需要 draft 文件（dsh 的 turn 内修正取代
CLI 的 draft 机制）。

### 2.4 持久化原语（D5/D6 的载体）

`storageDomain` + `KvTable.update` 原子 RMW 是 claim 同方向互斥的正确原语：
"concurrent updates never interleave"。team 对象库（成员/场所/消息/task/claim）
可按 workspace registry 模式落在 storage domain 上。

## 3. client UI 落点

- `slots.register({ name, id, order, label }, component)` 是无风险 seat 的标准
  注册 API；list 槽需要 id/order/label。
- `sidebar.footer.action` 与 `conversation.session.header.actions` 已实际挂载
  （pkg-7 运行中，UI 可见性由用户确认）。
- **高风险 seat 的 take 行为已验证（pkg-8）**：`sidebar.workspaces` 与
  `conversation` 均以 `priority: -1` 成功遮蔽 shipped UI（证据：take-log
  took → 6 秒后 restored 两条完整记录，宿主与浏览器双端运行无诊断错误）。
  结论：take 机制可行、可逆（disposer 恢复）；剩余风险是替换后完整渲染面的
  工作量，而非机制可行性。
- M2 Agent Member direct chat 复用 `ctx.sessions.open(agentSessionId)`；该视图不是 Team DM。

## 4. 首轮结束时的未验证项（已由第二轮覆盖）

以下是 2026-08-14 首轮结束时的历史状态；第二轮结果见 `2026-08-15-validation.md`。正式 TypeScript `MessageSource` 声明仍属于 M1 源码实现，其他机制与 Client take+渲染均已完成真实验证。

1. **冷恢复补偿投递**：成员 session 冷（进程重启后）时 outbox 补偿——需要 team
   持久化实现后，重启进程验证。
2. **compaction 实际触发**：当前 host 组合未挂载 compaction 服务（`ctx.get
   ('compaction')` 为 undefined）；compaction-basic 是成熟包，需在 team preset
   显式挂载（+ tokenMeter 已存在）。
3. **claim 状态机的多成员并发**：`KvTable.update` 原子性已确认，但两个成员
   同时 claim 的端到端行为留给正式实现测试。
4. **take 后的完整渲染面**：take/恢复机制已验证（§3）；替换 `sidebar.workspaces`
   与 `conversation` 后的完整团队 UI（channel 视图、thread 视图、任务板）是
   正式实现的渲染工作量。
5. **正式 `team` MessageSource kind**：需声明合并，动态插件不可行。

## 5. 对设计文档的修正清单

1. `design-ux.md §1`：compaction 是**可选 capability**，当前 host 组合未挂载；
   team preset 必须显式包含 compaction-basic 行（tokenMeter 已在）。触发策略
   用 `compactIfNeeded(agent, 'pressure'|'context-overflow')` 的既有语义。
2. `feasibility.md`：投递实现确认三原语选择（inject / send+target / followup），
   `MessageSource` 用声明合并加 `team` kind。
3. 团队对象持久化确认落点：storageDomain（Domain + KvTable），claim 互斥用
   `KvTable.update` 原子 RMW。
4. `design-ux.md §2`：M2 Agent Member direct chat 复用 `ctx.sessions.open()`，无需自建路由；不等于 Team DM。

## 6. 踩坑记录

独立文档：`validation/pitfalls.md`。

## 7. 结论

**设计基线（feasibility + raft-design-mapping + design-ux）的核心机制全部在真实
dsh 进程验证通过**：peer 投递三原语、多 agent 共存、log 可重建、乐观并发、
持久化原子原语、token 测量、client Slot 挂载。没有发现需要改变设计方向的
架构障碍；发现两处需要进设计文档的修正（compaction 显式挂载、MessageSource
声明合并）。剩余风险集中在 UI 两个 shadows-shipped-ui seat 的替换工作量与
冷恢复补偿的实现细节，均属于正式实现阶段。
