# Member Session 读取与自愈 — 已确认设计(spec)

日期:2026-09-11,讨论收敛后写入。行为权威仍是 `packages/` 源码与测试;本文是决策快照。

## 1. 一个读取 seam

新增内部模块 `StoredSessionReader`(src/stored-session-reader.ts),是 Team 对 stored Session 的唯一读取入口:

- `read(id)` → 完整已验证的 `{header, inheritedEventCount, events}`,或五类 typed failure 之一。
- `exists(id)` → stat 级存在性探测(激活的 persisted 判断)。
- 启动时的一次性 `list()` 盘点保留为直接调用:它是引导期全量清单,不是逐会话读取,无分类语义。
- 句柄生命周期(open→read→close)、artifact 路径、格式世代、错误文案匹配,全部藏在模块内。调用方不接触 `SessionHandle`。

失败五类(判别顺序):

| kind | 判别 | 语义 |
| --- | --- | --- |
| `missing` | `SessionPersistenceNotFoundError` / stat undefined | 会话不存在 |
| `refused` | `SessionFormatUnsupportedError`(含迁移审计变体),带 `location` | 确定性拒绝,重试永远无效 |
| `corrupt` | `SessionPersistenceCorruptionError`,或 `/corrupt session log/` 文案(上游 jsonl 抛裸 Error,不修) | 内容损坏 |
| `io` | 带字符串 `code` 的系统错误 | 瞬态,可重试 |
| `unknown` | 其余 | 未分类 |

corrupt 文案匹配永久收在 seam 内;上游文案变化时退化为 `unknown`,退化方向保守(corrupt 类的 fail-open 变回 fail-closed,宁可阻塞不丢输入)。typed 判别沿 `error.cause` 链(深度 ≤4)下探,覆盖 harness 包装。

## 2. 失败影响归消费方(策略不变,分类集中)

| 消费方 | 策略 |
| --- | --- |
| 当前绑定激活(存在探测、resume 内部拒绝) | 阻塞激活,Member 保持 enabled,diagnostic 说明 |
| `recordedCheckpointPrefix` / `resolveCheckpointSeed` | 任何失败 fail-closed;错误带类别 |
| `replayCarriedInput` | refused/corrupt → 警告+跳过;io/unknown → 阻塞(不静默丢输入) |
| `reconstructMissingHandoff` | 任何失败 → 警告+跳过(best-effort) |
| `contextTimelineForAgent` | 截断 lineage walk,结果带 `incompleteFrom {sessionId, reason}`,不再静默断链 |
| `sourceUsageTokens` | 失败 → undefined → UNKNOWN 定价 |

关键验收:同一个不可读祖先只截断 timeline(成员仍可用);不可读 committed seed 阻塞 checkpoint return;不可读当前绑定阻塞激活。

回返锚点:timeline 候选与 seed 解析继续共享同一组锚点/定价 helper(`checkpointByRef`、`retainedEstimate`、`threadsEnteringContext`);不新增第二套判断;rollover 执行时仍重验可变 guard(claim 数、预算、nonshrinking)。读取 seam 不拥有锚点评估,也不拥有 Agent lifecycle。

## 3. 成员重启 = 有界自愈

现状:修复(SessionRemediation)只在进程启动时运行;成员级"重启"对确定性格式拒绝是安慰剂(重跑同样失败的激活,修复不在这条路径)。

改法:`resume` Remote 的 failed-activation 分支,当上次激活失败类别为 `session-refused`:

1. 对该成员跑同一套 remediation(复用启动时已打开的实例;同一幂等门控与全量校验;被拒会话无法 open,不存在活跃写者,发布 sibling 安全)。
2. 修出 artifact(repaired > 0)→ 重试一次激活 → 成员恢复。
3. 走完无物可修(walk 完成且 repaired = 0,含 E 类上游缺陷与缓存已判定)→ diagnostic 标 `remediable: false`,不再重试,不再提供重启动作。
4. walk 本身 io 失败(completed = false)→ remediable 不置位,可再次点击重试修复。

0.1.10 补丁的去留:remediation 是"修的人",seam 是"读的人",互不替代;幂等 + 完成标记门控(format 版本 + 会话绑定),已修复用户零重跑;DSH 新格式版本使标记失效、自动重扫,需重新审视的只有 remediation 一处;退役不按时间表。

## 4. diagnostic 结构化(不加状态机)

`AgentTeamAgentMemberStatus.diagnostic` 从 `string` 改为结构对象(Client 与 Host 同捆发布,无版本偏斜;Typert 重新生成):

```text
{ class, detail, location?, sessionId?, remediable? }
class ∈ session-refused | session-unreadable | preset-composition
       | rollover | runtime | activation
```

- `availability/presence` 枚举不变;不建 ready/degraded/repairing/blocked 状态机;不写 ledger。
- 激活失败分类:Team 读取调用点抛 `StoredSessionReadError`(携带 typed failure)→ session-refused / session-unreadable;preset 装载/校验失败(#12 形状)以 `PresetCompositionError` 标记 → preset-composition;harness resume 的原始拒绝经 typed/文案判别归入前两类;其余 → activation(可重启,detail 说明)。
- Client 按类选动作:refused+remediable=false → 显示 artifact 路径与"重启无效",不提供重启;rollover → 瞬态不提供动作;其余 unavailable → 提供重启(对 refused 是自愈触发器)。

## 5. 明确不做

- 不建第二 Session store、不把健康写进 ledger、不新增完整状态机、不弱化 DSH fail-closed 校验。
- E 类(turn 未闭合等上游结构缺陷)无插件侧机械路径:已退役世代靠 fail-open 保可用性,当前世代如实阻塞并标 non-remediable,修复属上游责任。
- Host 装载健康(#15 形状:preset 命名空间争抢、Host 半边未激活)不属本工作项;本轮只做到 diagnostic 能区分"这不是 Session 问题"。
- Session search(`context_search`/`context_read`)继续压后,建立在 seam 与锚点契约之上。
- 第一版 seam 不做读取缓存(重复读是本地文件低频操作;有实测痛点再优化)。

## 6. 范围外已确认事实(引用时不再重查)

- harness `agents.resume` 以 write 句柄 open:被拒会话无人能持有写租约,内联修复无竞态。
- 上游 jsonl `corrupt session log` 系列为裸 Error(session-persistence-jsonl/src/format.ts),无法 instanceof。
- 测试中 'failed to load' 来自 member-lifecycle 自己的 preset 假实现,非 harness 文案。
