# 计数边界方案（human 第 1 点调研，2026-09-05）

## 问题

Human 的疑问：agent 之间不通过 user message 对话，而是通过 team tool；nudge 计数的边界是否应把 team tool 调用隔离出来？

## 结论：两个信号源分工，边界问题消解

不需要解析 `tool/call` 的 arguments，也不需要在 tool 层做任何拦截。**计数与重置用两个不同的既有信号**：

| 信号 | 来源 | 用途 |
|---|---|---|
| **计数** | `session/event` 事件流的 `tool/call` 事件（post-commit firehose，../deepseek-harness/packages/core/session/src/index.ts:74；事件体 `{turn, step, callId, name, arguments}`，types.ts:306） | Member session 每发生一次 tool call 计数 +1 |
| **重置** | Host 自己 emit 的 `agent-team/committed` 事件（index.ts:1236，携带完整结构化 operation：actor.memberId + threadRef/taskRef） | Member 提交任何触及 thread 的 team 操作 → 该 Member 计数归零 |

**为什么这消解了边界问题**：
1. team tool 调用的识别不需要看 `tool/call` 的 name/arguments——team 操作落地必然经过 ledger 提交，Host 在 `emitCommitted`（index.ts:1236-1251）已经拿到结构化数据（actor、threadRef、taskRef、operation kind）。这是零解析、零误判的权威信号。
2. 时序天然正确：`tool/call`（计数 +1）→ tool 执行 → ledger 提交 → `agent-team/committed`（归零）。一次成功的 team_message 调用净效果 = 重置；一次**失败**的 team 调用（stale_revision / unread_required / 校验拒绝）不产生 commit，计数保留——失败不等于沟通，行为正确。
3. 非 team 的 tool call（bash/read 等）只产生 `tool/call`，不产生 commit，自然累积。这正是"沉默工作"的计量。

## 已核实的支撑事实

- `agent/status` root 级监听接收 member agent 事件的先例：member-runtime.ts:171（`this.deps.ctx.on('agent/status', ...)` + 手动按 payload 过滤）。`session/event` 同为 root 可订阅的 firehose，按 `session.id === member.sessionId` 过滤即可。
- steer 注入去重先例：notifyMember（index.ts:1271-1279）扫描 `agent.inbox.nextStep/nextTurn` 中同 summary 的 notice 再替换。nudge 复用该模式（自己的 summary 标记）。
- 注入时机：计数事件发生在 turn 进行中（agent running），用 `agent.steer`（next-step，注入当前 turn），与 inbox 唤醒同机制。
- ledger 侧最终采用目的明确的只读查询 `progressNudgeTargets(memberId)`，由 ledger 内部统一判断 attention、Claim、Task/Channel 状态；不公开 private `touchedThreadRefs`，也不让 Host 重做投影逻辑。重置直接使用 `emitCommitted()` 已持有的结构化 operation actor + kind。

## 决策闭合

1. **taskless thread 的 Nudge-A 触发口径**：选 a；taskful 以 active Claim 表示当前参与，taskless 以 follower 表示当前参与。
2. **重置集**：仅公开可见沟通 `{message-sent, thread-replied, claim-created, claim-done, claim-released}`；`team_thread.read`、follow/unfollow、DM 与失败调用不重置。
3. **计数器模型**：per-Member 单计数器；tool call 无 Thread 归属，不做伪归因。
4. **Nudge-B 一次性**：当前 Member Session 内 per-(member, thread) 一次；Host 重启、同 Session reactivation、suspend/resume 均从 Session 日志恢复，Human 主动“从全新上下文开始”后允许重新提醒。
5. **多 Thread 输出**：同一阈值只注入一条合并 notice，正文逐目标列出；同 turn 至多一条。
6. **Nudge-B Task 状态**：只催仍为 `todo` 的 Task。
7. **subagent**：Member 无 subagent，不存在跨 session 计数盲区。

## 规模预估（定稿后）

`packages/agent-team/src/progress-nudge.ts` 新协调器（类比 RecoveryCoordinator：per-member 状态 + 两档阈值阶梯 + dispose），index.ts 接线（session/event 订阅 + emitCommitted 钩子 + steer 注入 + inbox 去重），ledger 小只读接口，spec 测试（计数/重置/阶梯/一次性/去重/失败不重置）。无 UI 变更。

## Edge case 清单（2026-09-05，human rev 6944 要求）

### 计数与触发

1. **计数器生命周期 = Member 会话生命周期**：计数器随激活创建、随 suspend/archive/remove/clearMemberContext 销毁，不持久化。重启/清空上下文后从 0 重数——符合直觉（新会话=新沉默）。steer 的消息走 session log（`agent/inbox/spliced`），跨重启恢复无碍。
2. **阈值注入后**：计数不清零（继续数到 40、60…），但以 `lastNudgeTurn` 保证**同 turn 至多注入一条**；pending inbox 的同 summary 检查再防重复排队。若同一长 turn 从 20 跨到 40，40 档保留到下一 turn 的首个 tool call。
3. **重置时在飞行中的 nudge**：commit 事件到达时，若同 summary 的 notice 还在 agent.inbox 里未被消费，直接移除（沟通已发生，提醒已过时）。
4. **DM relay 不误触发 Nudge-A**：dmForAgent 的注入 form 是 'relay'（index.ts:938），与 nudge 的 'notice'+不同 summary 天然区分，无需特判。
5. **具体待办优先**：nudge 是最低优先级，与 recovery / Inbox / pre-compaction notice 互斥；注入前若存在任一高优先级 notice 就保留 due、不排队，等下一 tool call 重试。高优先级 notice 后到时撤销尚未消费的 nudge。
6. **不从 idle 路径主动提醒**：Harness 的 `steer()` 确实能唤醒 idle Agent，但 v1 Coordinator 只在 live `tool/call` 事件中投递，不在 commit/资格变化时投递，因此正常触发点 Agent 正在 running。不要新增 timer 或 eligibility-change wake。
7. **同一 turn 大量 tool call**：阈值命中发生在 turn 进行中，注入 next-step；turn 结束后计数不再增长（tool/call 停止）。不会出现"一次 turn 跨多个阈值档"重复注入——见第 2 条去重。

### 对象判定

8. **claim 释放/完成瞬间**：Nudge-A 资格随 ledger 投影即时变化；claim-released commit 同时是重置信号（该 Member 的沉默计数归零）。done 之后 Member 不再是 Nudge-A 对象。
9. **Nudge-B 一次性跨 claim**：per-(member, thread) 已提醒标记不因该 Member 后来 claim 而回滚（claim 后转入 Nudge-A 体系，两体系互不干扰）；也不因 unfollow→follow 循环重置。
10. **promote 升格**：taskless 帖被 promote 成 task 时，follower 集合不变（attention 延续），Nudge-B 资格自然衔接；无特判。
11. **Member 在多个 Thread 有资格**：per-Member 单计数器到阈值时只注入一条合并 notice，正文按稳定顺序逐 Thread 列出，避免同一 step 放大成多条用户消息。
12. **Human 自己的会话**：human 非 agent Member，无计数器，永不 nudge。

### 宿主与通道边界

13. **Host 重启**：计数器是运行时状态（同 memberFailures/notifiedInbox 先例：不持久化）。重启后从 0 数，最坏情况是"沉默期重新计 20 次"——对 advisory 机制可接受。
14. **关闭/归档 channel**：archived channel 的 Thread 不再产生资格（resolveTaskRefs 对 archived channel 已不解析，ledger.ts:1219 先例）；commit 后立即 reconcile 并撤销尚未消费的相关 nudge。
15. **Nudge-A 文案含 threadRef**：agent 需要 threadRef 才能回帖；从 ledger 投影现查（taskRef + threadRef），不依赖注入时的快照陈旧性。
16. **task close/accept 后**：resolution ∈ {accepted, closed} 的 task 不产生任何 nudge 资格（工作已结束，催进度无意义）。
17. **inbox notice 与 nudge 的顺序**：若两者都在 nextStep 队列，inbox notice 在前（更早注入）；消费顺序按队列 FIFO，无需协调。

### 结论

无阻断项。两个实现时必须处理的：**同 turn 去重（#2/#3）**与 **notice 互斥让位（#5）**，均有现成先例模式。其余是验收语义确认，写进测试用例即可（#8/9/10/16 建议各一条 spec 断言）。

# 设计细化（Reeve，2026-09-05）

## 1. 模块与 seam

新增一个事件驱动的深模块 `ProgressNudgeCoordinator`，建议位于 `packages/agent-team/src/progress-nudge.ts`。它内部拥有计数、阈值、B 类一次性记录、pending notice 去重/撤销和 notice 文案；Host 只转交已经发生的事实，不在 `index.ts` 重写状态机。

外部 interface 只需要四类输入：

```ts
onSessionEvent(memberId, agent, event): void
onCommitted(operation, affectedMemberIds): void
stopTracking(memberId): void
dispose(): void
```

`onSessionEvent` 只消费 `tool/call` 与本模块自己 notice 被消费后形成的 `user/message`；把 `agent` 随事件传入，避免 Agent 已发布但 `handles.set()` 尚未完成的短窗口漏掉首个 turn。构造依赖保持两个：

```ts
agentForMember(memberId): Agent | undefined // commit/reconcile 路径
targetsForMember(memberId): ProgressNudgeTargets
```

`ProgressNudgeTargets` 是一次当前投影快照，不暴露 ledger 内部 Map：

```ts
{
  progress: readonly {
    reason: 'active-claim' | 'taskless-follower'
    threadRef: AgentTeamThreadRef
    taskRef?: AgentTeamTaskRef
  }[]
  claim: readonly {
    threadRef: AgentTeamThreadRef
    taskRef: AgentTeamTaskRef
  }[]
}
```

这条 seam 的删除测试成立：若删掉 Coordinator，阈值、去重、notice 优先级、撤销和生命周期会重新散回 session listener、`emitCommitted`、`notifyMember`、recovery 和 compaction 五处。不要把它拆成 `Counter`/`NoticeBuilder`/`EligibilityService` 等浅模块。

## 2. 事件接线

### tool/call

不要在 Host root firehose 上每次扫描 `handles`。在 `activateMember()` 的 Agent setup context 内注册 scoped `session/event` listener，捕获确定的 `member.memberId`；scope carrier 保证只收到该 Member Session 的事件，也不会漏掉 handle 写入 Map 之前的首个 turn：

```ts
agentCtx.on('session/event', (_session, event) => {
  const agent = agentCtx.agent
  if (agent !== undefined) progressNudge.onSessionEvent(member.memberId, agent, event)
})
```

该 listener 随 Agent scope 自动 dispose。普通 Agent、Human 和别的 Member Session 不经过此 listener。传入 live `agent` 而不是让 Coordinator 立刻反查 `handles`，可覆盖 Agent 发布与 `handles.set()` 之间的短窗口。Coordinator 状态记录 `sessionId` 并以 Member Session 为生命周期：同一 Session 的 in-place reactivation 不重置；新 sessionId、suspend/archive/remove/clearMemberContext/renew 后 `stopTracking(memberId)`。`user/message` 分支只识别本模块自己被模型实际消费的 notice，用于恢复 B 的一次性记录；其他消息不参与计数或重置。

### committed

直接在 `emitCommitted()` 已经取到完整 operation 之后调用 Coordinator，不再订阅并二次反查 `agent-team/committed`：

1. 只有 operation 真正 commit 才进来，失败 team call 天然不重置。
2. operation.actor.kind === 'member' 且 kind 属于公开沟通集合时，重置该 actor：
   - `team/message-sent`
   - `team/thread-replied`
   - `team/claim-created`
   - `team/claim-done`
   - `team/claim-released`
3. `team/thread-read`、`team/thread-attention-changed`、`team/dm-sent` 不重置。
4. 无论 actor 是谁，资格可能变化的 commit 都用 `ledger.affectedMembersOf(operation)` 触发 pending notice reconcile；accept/close/archive/他人 claim 后不能留下过期提醒。

`onCommitted()` 必须先撤销/校正低优先级 progress notice，再让既有 `notifyMember()` 注入新的 durable Inbox notice。

## 3. Ledger 最小只读 interface

不要公开 `touchedThreadRefs()`：它回答的是“某 operation 改了哪些 Thread”，调用方仍得知道 attention、Claim、Task resolution、Channel archive 等内部结构，是浅 interface。

新增一个有目的、只读、深的查询：

```ts
progressNudgeTargets(memberId: AgentTeamMemberId): ProgressNudgeTargets
```

Ledger 在内部一次完成资格判定和去重：

- A/taskful：Task `resolution === 'open'`，Member 至少有一个 `state === 'active'` Claim；同 Thread 多 Claim 只返回一次。
- A/taskless：Thread 无 `taskRef`，Channel active，Member 当前存在 Attention。
- B：Task `status === 'todo'`、Member 当前存在 Attention、并且该 Member 在该 Task 的完整 Claim 历史中从未出现；同 Thread 只返回一次。`in_progress`/`in_review` 已有明确推进者，不再招募围观者 Claim。
- accepted/closed、archived Channel、inactive/archived Member 均不返回。
- 稳定排序：Thread revision 降序，再按 threadRef；notice 不携带 revision 快照，Agent 回复前仍按现有协议 read Thread。

## 4. 每 Member 状态机

```ts
interface MemberProgressNudgeState {
  sessionId: SessionId
  silentToolCalls: number       // 自上次成功公开沟通起
  nextProgressThreshold: number // 初始 20；成功注入后 +20
  lastNudgeTurn?: number        // 任一 A/B notice：同 turn 最多一条
  claimSuggested: Set<AgentTeamThreadRef> // 已被模型实际消费，不只是排入 inbox
  claimCheckDue: boolean        // 新 follow/promote/资格变化后在下一次 tool call 重查
}
```

转换：

1. 首个 tool call 按 `(memberId, sessionId)` 懒创建状态；`silentToolCalls += 1`。若同一 Member 出现新 sessionId，先丢弃旧状态。
2. B：当 count 首次到 5，或 `claimCheckDue` 为 true 且 count >= 5，查询未出现在 `claimSuggested`、也未包含在 pending notice 中的 B 目标。
3. A：当 count >= `nextProgressThreshold`，查询当前 A 目标。
4. 若 `lastNudgeTurn === event.turn`，本 turn 不再注入；due 状态保留，下一 turn 的首个 tool call 重试。这样同一长 turn 即使先在 5 命中 B、又跨过 A 的 20/40，也只出现一条。一次调用同时存在多个 A/B 目标时合并进这一条 notice。
5. 无目标不注入；A 档位不前移，目标后续出现时仍可在下一 tool call 提醒。
6. 高优先级 Team notice 在 inbox 时不注入，保持 due，待下一 tool call 重试；不会靠 timer 自行唤醒。
7. `agent.steer()` 成功后只记录 `lastNudgeTurn` 并推进 A 档位；B **不在排队时**记为已提醒。只有该 notice 真正成为 `user/message`（模型已消费）后，才从自己生成的正文标记恢复 B threadRefs 并写入 `claimSuggested`。因此 follow/unfollow 或成功沟通在同一步撤掉飞行 notice，不会永久吞掉一次性机会。
8. 同一 Session 的 Host 重启/Agent reactivation/suspend-resume：从已消费的 `user/message` 重建 `claimSuggested`，从 replay 后的 agent.inbox 识别尚在 pending 的 notice；silent count 与 A 档位按已拍板重置。Human 主动“从全新上下文开始”得到新 Session，不继承 B 记录。
9. 成功公开沟通：count=0、A threshold=20、移除未消费 progress notice；已消费的 B 一次性集合不清零，`lastNudgeTurn` 也不清零（仍保证当前 turn 最多一条）。
10. read/follow/unfollow/DM/失败 team call：不重置 count。follow/promote 等资格变化只令 `claimCheckDue=true` 并 reconcile pending 目标。
11. `stopTracking` 删除该 Member 的全部进程状态并撤销 pending notice；`dispose` 清空全部状态。

## 5. Notice 所有权、去重与优先级

建议一个固定 plugin notice family：

```ts
source: {
  kind: 'plugin',
  plugin: AGENT_TEAM_PLUGIN_ID,
  form: 'notice',
  summary: PROGRESS_NUDGE_NOTICE_SUMMARY,
}
```

Coordinator 是这类 notice 的唯一 formatter 和 owner。不要让 `index.ts` 拼文案。正文中 B 目标行必须使用一个稳定、只由 formatter 产生的前缀（例如 `- Claim target:`）；Coordinator 只在 `source` 精确命中自己的 notice 后解析该前缀，用于从已消费 `user/message` 恢复 `claimSuggested`。这不是解析模型或 Team 消息内容，而是读取自己写出的持久 receipt；formatter/parser 必须放在同一模块并成对测试。

优先级从高到低：

1. recovery notice（恢复中断工作）
2. Inbox notice（有明确未读工作）
3. pre-compaction notice（先保存关键结论）
4. progress nudge

注入 nudge 前，若 pending inbox 中已有前三种 notice，则本次不注入；前三种 notice 即将注入时先撤掉未消费的 progress nudge。DM relay 不是 notice，不参与互斥。成功公开沟通也撤掉 pending progress nudge。

现有 Inbox 的 `remove(message.id)` 已经耐受“飞行中刚被消费”：返回 false 即可，无需报错。`agent.steer()` throw 视为 target gone，`stopTracking(memberId)`，不把 B 标成已提醒。

## 6. 文案定稿

### Nudge-A

```text
Progress visibility reminder

You have made {count} tool calls since your last visible Team update. Please briefly update the relevant Thread(s): what you confirmed, what remains, and any blocker. Read the Thread first if needed, then continue working.

{targets}

This is advisory; do not stop useful work merely to produce a long status report.
```

目标行：

```text
- Task task:<uuid> — Thread thread:<uuid>
- Taskless Thread thread:<uuid> (reply only if your current work relates to it)
```

### Nudge-B

```text
Claim visibility reminder

You have been working while following the Task(s) below, but you have never claimed a direction there.

{targets}

If your current work belongs to one of these Tasks, briefly state your direction in its Thread and consider team_claim. If it does not, no action is required. This is advisory, not a claim requirement.
```

目标行（稳定前缀供本模块恢复已消费的一次性记录）：

```text
- Claim target: Task task:<uuid> — Thread thread:<uuid>
```

若同一次 tool call 同时命中 A/B，合并成一个 notice、两个小节；每个目标只列一次。

## 7. 测试矩阵

### `progress-nudge.spec.ts`（Coordinator interface 测试）

1. 19 次无 A；第 20 次 A；继续到 39 无新 A；第 40 次第二次 A。
2. 成功 reply/claim/done/release 重置为 0；read/follow/unfollow/DM 不重置；失败调用无 commit 不重置。
3. 同一 turn 多次 tool call 只产生一条 notice；多个 Thread 在同一正文中按稳定顺序逐项列出。
4. pending nudge 遇到成功沟通被移除；消息已被消费时 remove=false 也不报错。
5. recovery/Inbox/pre-compaction pending 时 nudge 让位；DM relay 不阻塞。
6. B 第 5 次触发，后续 reset、claim、release、unfollow→follow 都不重复。
7. steer throw 后停止当前 Member 跟踪，不污染其他 Member。
8. stopTracking/dispose 清空状态；同 Session reactivation不重置，新 Session 重置。

### Ledger query tests（`agent-team.spec.ts` 或独立 ledger spec）

9. active Claim 产生 A；done/released 立即移除 A。
10. taskless follower 产生 A；unfollow 移除；promote 后自然转为 taskful资格。
11. todo Task follower 且从未 Claim 产生 B；曾有 done/released Claim 也不得再产生 B。
12. accepted/closed/archived Channel 不产生 A/B；`in_progress`/`in_review` 不产生 B。
13. 多 Claim/多 Thread 去重、排序稳定。

### Host 接线 tests（`member-lifecycle.spec.ts`）

14. scoped session listener 只统计绑定 Member 的 `tool/call`；ordinary Agent/Human/别的 Member 不计。
15. 第 20 个调用若本身是成功 team reply：先产生的 nudge 会被随后 commit 撤销；同调用失败则保留。
16. notice source/form/summary 正确，正文含完整 taskRef/threadRef 且不伪造 baseRevision。
17. Human accept/close、他人 Claim、archive 在 notice 飞行中会 reconcile，模型不会收到已结束工作提醒。
18. Host 重启/同 Session resume 不重复 B；Human“从全新上下文开始”后同一未 Claim Thread 可重新产生一次 B。

这 18 条覆盖原 17 个 edge case；#15 单独补上了最容易漏掉的真实时序：team tool 的 `tool/call` 计数发生在其 ledger commit 之前。

## 8. Human 最终拍板

Human 在 Main-Dev Task Thread 同意三项推荐：

1. 同一阈值命中多个 Thread 时合并为一条 notice，正文逐 Thread 列出。
2. Nudge-B 的一次性边界是当前 Member Session：Host restart、同 Session reactivation、suspend/resume 保持；Human 主动“从全新上下文开始”后重新计一次。
3. Nudge-B 只对 `task.status === 'todo'` 生效。

至此无产品语义待定项；可以交生产实现。

## 9. 已知边界与非目标

- **计数是近似节奏信号，不是工作量度量**：只数 Session 日志中的模型级 `tool/call`。一个并行 wrapper 仍是一条 tool call；后台进程内部动作不另计；纯推理而不调用工具也不计。禁止解析 tool arguments 或按工具“加权”。
- **不伪造 Thread 归因**：per-Member counter 只说明 Member 持续工作；A 的 active Claim/taskless follower 与 B 的 todo follower 只是当前候选。因此 taskless 与 B 文案必须带“if your current work relates”条件，不能断言 Agent 正在处理该 Thread。
- **新资格可能立即命中**：follow 本身不重置。Member 已沉默超过 5 次后新 follow 一个 todo Task，下一次 tool call 可立即触发 B；这是 per-Member 单计数器的直接后果，不另建 per-Thread 计数器。
- **纯事件驱动，无 timer**：若阈值命中时被高优先级 notice 阻塞，且 Agent 此后不再调用工具，就不会凭空开启一个 reminder turn；下一次 tool call 再重试。这避免 advisory 机制自行制造工作。Coordinator 只从 live `tool/call` 路径 steer，不从 commit/资格变化路径主动投递，因此正常情况下不会为了 nudge 唤醒 idle Member；Harness 的 idle-steer 能力无需在 v1 使用。
- **taskless follower 可能是宽资格**：旧 taskless Thread 只要仍 follow 就会进入 A 候选。合并 notice 与条件式文案控制干扰；v1 不新增“最近活跃”“未读才算”等第二套参与定义。
- **不产生 Team authority**：nudge 不写 Message、Activity、Claim 或新的 ledger operation；它只是 Session 中的 plugin notice。B 的一次性记录从当前 Session 已消费的自有 notice 恢复。
- **无 Client/UI 变更**：不增加设置项、徽标或面板；阈值先按产品常量实现。若未来要配置化，应另开产品决策，不提前暴露 config interface。

## 10. 实施顺序与维护文档出口

1. 先实现并测试 ledger 的 `progressNudgeTargets(memberId)`；不碰 Host 注入。
2. 实现独立 `ProgressNudgeCoordinator` 及纯 fake Agent/inbox 测试，钉死状态机、合并、优先级、消费恢复和 dispose。
3. 在 `activateMember()` setup、`emitCommitted()`、Member lifecycle、`notifyMember()`、recovery、pre-compaction 五个现有接缝接线；不复制 eligibility/formatter。
4. 跑 `npm run typecheck && npm test && npm run build && git diff --check`。无 UI 变更，不要求 browser test。
5. 行为落地后同步：
   - `docs/architecture.md` Host authority：增加“进度 nudge 是 Session advisory、ledger 仍是唯一 Team authority”；
   - `docs/team-collaboration.md` Agent notification：记录 A/B 的资格、阈值、重置集与非 exactly-once 语义；
   - 若公开 README 提及 Agent 主动协作行为，仅写用户能观察到的效果，不暴露内部计数状态机。

## 实现附记（Tars，2026-09-05）

设计按 spec 落地，两处实现事实与原稿不同，均为实证修正：

1. **scoped session listener 不可行**：Session store 的 dispatch carrier 以 SessionStore 自身 ctx（root、untagged）铸造，scope-tagged 的 agent setup context 收不到任何 `session/event`（实证：root listener 收到全部 20 个 tool/call，scoped listener 收到 0 个）。实现改为 root `ctx.on('session/event')` + `memberBySessionId` map 反查，与既有 `agent/status` root listener 先例同形。原稿担心的 publish→handles.set 窄窗口不存在：`handles.set()` 与 `memberBySessionId.set()` 都在激活 continuation 中先于任何 tool call 完成。
2. **同步 steer 会重入 session append**：`tool/call` 事件在 session 自身 append publication 期间分发，监听器内同步 `agent.steer()` 触发 inbox splice 的第二次 append，被 `session append cannot reenter while another append is being published` 拒绝。实现将 steer 延迟一个 microtask（`deferredSteerAgent` adapter）：turn 仍在运行（模型在等 tool result），notice 仍落在同一 turn 的下一 step boundary。

其余状态机、阈值、重置集、一次性恢复、合并 notice、优先级让位与飞行撤销均按 spec 实现；测试矩阵 18 条全部落地（coordinator 单测 14 + ledger 投影 5 + Host 集成 5）。

## 审查修复附记（Tars，2026-09-05 第二轮）

Reeve 审查 `32bf407` 提出 5 个 blocker，全部已修（随修复提交落地）：

1. **真实 SessionEvent 契约**：coordinator 与单测全部改用 typed `SessionEvent`（`{type, seq, time, data}` 包络），turn 读 `event.data.turn`，消费的 notice 是 `event.data` 本身。原实现的扁平 `{type, turn}` 假包络导致生产路径 `turn=0` 恒定、`user/message` 永不匹配。
2. **B 的 Session 内恢复**：新增 `sessionLogForMember` 依赖；同 Session 跟踪首次建立时从 `session.ownEvents()` 扫描 exact self-source notice 恢复 `claimSuggested`。Host restart / suspend→resume 不重发；Human 新上下文（新 sessionId）为空。realHarness suspend→resume 回归已覆盖。
3. **按原目标 reconcile**：`PendingNotice` 记录 notice 正文实际列出的 progress/claim threadRefs；任一列出的目标失效即整条撤销（部分消失也撤），不再"任一存活即保留"。部分消失单测已覆盖。
4. **档位跳进**：成功投递 A 后 `while (threshold <= silentToolCalls) threshold += step` 一次跳到当前档之上，长阻塞解除后不再逐 turn 补发 20/40/60…。80 次阻塞 + 解除回归已覆盖。
5. **延迟 steer 归一 owner**：`scheduleSteer` 注入点进 Coordinator，延迟执行、`canceled` 检查、真实 steer 失败处理都在同一个 `PendingNotice` 对象上；revoke 在 microtask 前到达时闭包 no-op，不再有孤儿 notice。deferred-throw 与 defer-before-revoke 单测已覆盖。

另修：`clearMemberContext` 清理旧 `memberBySessionId` entry；Host log 前缀去重；删除无调用者的 `onEligibilityChanged`。
