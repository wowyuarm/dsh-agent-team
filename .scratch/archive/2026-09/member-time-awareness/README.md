# Team Member 时间感知

**状态：** 已完成并归档（2026-09-08）。实现：`packages/agent-team/src/time-format.ts`（唯一 UTC+8 固定偏移 formatter）、`packages/agent-team/src/member-time-context.ts`（per-step durable clock snapshot，preset row `member-time-context`）、`AgentTeamThreadFact` envelope `occurredAt`（单一 per-sequence operation 投影）、inbox `newestOccurredAt`、view `lastActivityAt`、通知 `Occurred at:`、DM 时刻、mutation receipt `Committed at:`；测试见 `member-time.spec.ts` / `member-time-context.spec.ts` / `member-time-context-integration.spec.ts` / `time-format.spec.ts` 及 lifecycle/render 断言；稳定契约已写入 `docs/team-collaboration(.zh).md`、`docs/domain-model(.zh).md`、`CHANGELOG.md`、tool README 双语对。实现 task:85d48cd8（#69）。  
**最后检查：** 2026-09-08  
**当前前沿：** 无待办。时区两次拍板（固定 UTC+8 + 显式偏移，取代本文 UTC 默认值）以 [spec.md](spec.md) 为准；多时区配置留给未来配置层任务。  
**完成条件：** （原条件）Member 在每次模型 step 都知道可核对的当前时刻和经过时长；所有面向 Member 的 Team 协作事实携带准确事件时刻；测试覆盖长时间 idle、resume、rollover、compaction、时钟回拨和旧 ledger replay——已全部交付并通过完整检查梯（typecheck / test 475 通过 / lint / build / test:browser / pack --dry-run / git diff --check）。  
**正式文档出口：** 已完成（见上）。以下正文保留为归档时的设计过程记录。

## 结论

应当让 Team Member 同时拥有两类时间信息：

1. **现在是什么时候**：每个模型 step 开始前注入一次 durable clock snapshot。
2. **协作事实是什么时候发生的**：`team_thread`、`team_inbox`、`team_view`、自动通知和 DM 都返回事件的绝对时间。

只加“当前日期”不够。Member 即使知道现在是 9 月 8 日，如果 Thread 中的消息没有时间，仍然无法判断消息是 2 分钟前、昨天还是上个月产生的。反过来，只给消息时间而不给当前时刻，也无法稳定判断事件已经过去多久。

推荐所有 Agent-facing 时间使用带 `Z` 的 ISO 8601 UTC，例如 `2026-09-08T01:12:34Z`。UI 继续按浏览器本地时区显示，不改变现有 Human 体验。

## 当前缺口

当前实现已经保存时间，但没有完整交给 Member：

- Team ledger operation 有 `occurredAt`；Message 也有 `occurredAt`。
- Human Client 已使用 Message `occurredAt` 显示本地时间和日期分隔。
- `team_thread` 在渲染 anchor 和 Message facts 时丢掉了 `occurredAt`。
- Activity 只有 ledger sequence；其所属 operation 有 `occurredAt`，但 Thread fact 没有暴露。
- `team_inbox` 只有 `newestSequence`、unread count 和 revision，没有最新未读发生时间。
- `team_view` 能发现 Thread，但没有最后活动时间。
- direct mention、Task/Claim notification 和 DM relay 没有事件时刻。
- Team Member preset 没有动态 clock context。Persona 中写一个启动日期会随着长时间 Session 运行而过期。

因此 Member 当前只有顺序观念，没有可靠的时长和新旧观念。

## 产品语义

### 1. Team clock

每个 eligible `agent/pre-step` 在最终 prompt 后追加一条 source-attributed snapshot：

```text
Team clock sampled while preparing turn 18, step 4: 2026-09-08T01:12:34Z
Elapsed since the preceding model-visible event: 17m 4s.
Team collaboration timestamps use UTC. Sequence and revision, not wall-clock time, determine ordering and concurrency.
```

要求：

- 每个 step 采样，而不是仅在 Session 创建、每个 turn 或每隔固定分钟采样。工具执行、后台等待和 idle wake 之后都可能跨越较长时间。
- snapshot 作为普通 durable Session message 保存，保证 restart、request reconstruction 和 compaction 看到的证据一致。
- elapsed 第一优先基于上一条 model-visible event；同一 turn 的后续 step 基于上一次 clock snapshot。
- wall clock 回拨时 elapsed 夹到 `0s`，但不得篡改或重排历史。
- snapshot 只提供观察信息，不成为 Team ledger authority。
- `context_rollover` 后的新 Session 从新的 clock baseline 开始，不跨 Session 猜测 elapsed。

### 2. Team event time

所有会影响 Member 下一步判断的协作表面返回绝对事件时刻：

| 表面 | 新增信息 | 用途 |
| --- | --- | --- |
| `team_thread.read/history/status` | anchor、Message、Activity 的 `occurredAt` | 判断请求、回复和状态变化发生多久 |
| `team_inbox` | `newestOccurredAt` | 在多个未读 Thread 之间判断新旧 |
| `team_view` | top-level Message 的 `occurredAt`、Thread 的 `lastActivityAt` | 发现长期沉默或刚刚活跃的工作 |
| automatic Inbox notification | direct Message、Task/Claim Activity 的 `Occurred at`；ordinary route 的 newest time | wake 后立即理解通知时效 |
| DM relay/history | 当前 DM 和相邻上一条 DM 的 `occurredAt` | 避免把旧上下文误当作刚刚发生 |
| mutation result | 已提交 Message/Claim/Task transition 的 `occurredAt` | 让发送方知道 durable commit 的实际时刻 |

输出只使用绝对 UTC，不输出“3 小时前”这类会随历史重放而失真的相对文案。Member 可使用 durable clock snapshot 自己计算年龄。

### 3. 顺序与时间的权威边界

- **ledger sequence / Thread revision**：事实顺序、并发和 stale 检查的唯一 authority。
- **operation `occurredAt`**：事件被 Host 提交时的 wall-clock observation。
- **Team clock snapshot**：模型准备当前 step 时的 wall-clock observation。

系统时钟可能回拨，两个事件也可能拥有相同时间。因此 Member 可以用时间判断“多久以前”，但不能用时间替代 sequence、revision 或 idempotency key。

## 时区策略

Team 协作统一使用 UTC，原因如下：

- Agent 可能由 Inbox、recovery、DM 或后台 continuation 唤醒，这些输入通常没有浏览器时区。
- Member 是长生命周期协作者，不应把某次浏览器连接的时区持久当成 Workspace 时区。
- UTC 与 ledger 的 ISO timestamp 一致，跨机器、restart 和 replay 不改变含义。

Human 在 Member Session 中提出“明天上午”一类本地日历意图时，浏览器时区仍属于该次 Human request，而不是 Team clock 的默认时区。若任务结果依赖本地日历边界，Member 应使用 request 中明确可得的时区；缺失或冲突时再向 Human 确认。当前方案不新增 Workspace timezone 设置。

## 实现方向

### 不直接挂载现有 `@deepseek-ai/dsh-time-context`

Harness 已有成熟的 durable per-step clock plugin，设计原则应复用：pre-step snapshot、durable history、elapsed baseline、回拨处理和 projection-based reconstruction。

但该 plugin 的产品语义面向浏览器 request：没有唯一 browser zone 时，它会要求模型向用户确认日期和时间。大部分 Team wake 来自 Inbox、DM、recovery 或 continuation，没有 browser zone；原样挂载会让后台 Member 经常得到不合适的“询问用户时区”指令。

因此推荐在 Team bundle 内提供一个窄的 `member-time-context` plugin：采用相同的 durable clock 机制，但把 Team coordination zone 固定为 UTC，不复制 browser-request authority。不要修改 Harness 默认 composition。

如果未来 Harness 为 `dsh-time-context` 提供公开的 non-browser / canonical-zone policy，再删除 Team 自有实现并改为直接配置该 plugin。

### 复用已有 ledger 时间

不要建立第二套 Team 时间存储：

- Message 继续使用现有 `message.occurredAt`。
- Activity 的时间从承载它的 operation `occurredAt` 投影出来。
- Thread `lastActivityAt` 从其 revision 对应 operation 派生。
- Inbox `newestOccurredAt` 从 newest unread fact 对应 operation 派生。
- 旧 ledger 不迁移；operation 已有时间，旧 Message 的 replay normalization 也已经从 operation 补齐 `occurredAt`。

建议把 `occurredAt` 放在 `AgentTeamThreadFact` envelope 上，使 Message 与 Activity 采用同一读取契约；Message 内现有字段暂不作为第二个 Agent-facing formatter。所有工具和通知共用一个 ISO UTC formatter，避免每个表面自行决定格式。

## 明确不做

- 不增加 deadline、reminder、scheduler、SLA 或超时自动状态变化。
- 不因为“很久没更新”自动催促、close、release Claim 或改变 Attention。
- 不把 wall-clock 时间用于 revision、ordering 或幂等判断。
- 不新增 Workspace timezone 设置或 UI。
- 不修改普通 DSH Session 的默认 prompt。
- 不在 persona 中写静态日期，也不要求 Member 每次主动执行 `date`。
- 不把相对时间写入 durable Team facts。

## 交付切片

实施时按以下顺序推进，每片都可单独验证：

1. **Clock slice**：新增 Team-only per-step UTC clock snapshot；覆盖多 step、长 idle、resume、rollover、compaction 和回拨。
2. **Thread slice**：统一 `AgentTeamThreadFact.occurredAt`，让 anchor、Message、Activity 的 read/history 输出时间。
3. **Discovery slice**：Inbox 增加 newest time，View 增加 last activity time。
4. **Delivery slice**：automatic notification、DM 和 mutation result 携带 commit time。
5. **Contract slice**：更新中英文协作文档、package README/CHANGELOG 和 model-facing render tests；执行 typecheck、完整 unit tests 和 build。此方案不改变 Web UI，原则上不要求 browser acceptance；若实现触及 Remote/Client shape，则补跑 `npm run test:browser`。

## 验收示例

### 长时间 idle 后收到 direct mention

Member 下一次请求中应同时看到：

```text
Team clock sampled while preparing turn 9, step 1: 2026-09-08T09:00:00Z
Elapsed since the preceding model-visible event: 2d 3h 12m 8s.

Direct Team mention
Occurred at: 2026-09-08T08:58:41Z
From: human
...
```

Member 可以判断这是一条 79 秒前的新请求，而不是仅凭 unread 猜测。

### 读取旧 Thread

```text
Anchor 101 · 2026-08-20T03:11:00Z [human] Investigate startup failure
118 · 2026-08-20T04:06:12Z [builder] Reproduced on Windows
126 · 2026-08-21T01:30:44Z human accepted Task task:...
```

Member 能看出讨论跨越两天；事实顺序仍由 `101 < 118 < 126` 决定。

## 需要确认的取舍

推荐直接采用以下默认值：

- Team coordination zone 固定为 UTC。
- clock 每个 model step 注入。
- exact timestamps 覆盖全部 Agent-facing Team 表面，而不是只补 `team_thread`。
- 时间只用于理解新旧，不驱动自动行为。

若这四点成立，方案没有需要先解决的产品歧义；后续可以据此拆 implementation tickets。