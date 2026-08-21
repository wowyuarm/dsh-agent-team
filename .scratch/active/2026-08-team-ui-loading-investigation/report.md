# Agent Team 页面加载缓慢调查报告

- **日期：** 2026-08-21
- **状态：** 调查完成，待评审
- **范围：** Web Client 中 Channels、Agents、Channel 和 Thread 页面偶发加载缓慢。
- **不在范围内：** 模型推理、外部网络、Agent 实际执行任务所需时间。
- **结论可信度：** 本报告中的“已确认”均已对照当前 Client、Host 和 Harness Remote 源码；性能量级仍需要按“验证计划”在真实数据规模下测量。

## 1. 问题

用户反馈：打开 Channels、Agents、Threads 等页面时，加载速度有时明显变慢，且慢的程度不稳定。

当前实现的主要问题不是单一慢请求，而是以下链路叠加：

1. 页面首次进入就会同时发起多项 Remote 请求；
2. 全局变更通知不区分当前 Workspace、Channel 或 Thread，任何 Team 活动都可能刷新当前页面；
3. Thread 的“读取”本身会产生持久化写入，并立即唤醒当前页面的变更监听，导致首次打开自动再刷新一次；
4. 列表接口表面上有 `limit`，但仍返回和构造完整 Workspace 投影；
5. 每次提交后，Host 都会同步为全部在线 Agent 重算 Inbox；
6. 快速切换页面后，旧的 long-poll 请求未被取消；
7. Host 冷启动时顺序恢复每个 Agent。

结果是：少量 Team 数据时问题不明显；随着 Workspace、Task、Thread、消息和 Agent 数量增加，或多个 Agent 同时活动时，加载的平均时间和偶发长尾都会变大。

## 2. 当前数据流

```text
React 页面
  │
  ├─ ctx.remote.agentTeam.members(...)
  ├─ ctx.remote.agentTeam.view(...)
  ├─ ctx.remote.agentTeam.changes(...)
  ├─ ctx.remote.agentTeam.readThread(...)
  └─ ctx.remote.agentTeam.threadHistory(...)
          │
          ▼
浏览器 typed Remote
  → HTTP POST /api/<namespace>/<method>
  → 浏览器端 schema 校验
  → Host 端 schema 校验
  → AgentTeam Host service
  → AgentTeamLedger 内存投影 / 持久化 operation ledger
```

Harness 的每个 Remote 调用都通过独立 HTTP request 执行，并在浏览器和 Host 两侧对参数与结果进行严格 schema 校验。因此，重复请求和过大 payload 的成本不仅在 Host 计算，也包括传输和双侧解析。

相关 Harness 实现：

- `../deepseek-harness/packages/api/gateway/src/client/index.ts:351-411`
- `../deepseek-harness/packages/api/gateway/src/index.ts:143-185`
- `../deepseek-harness/packages/client/connection/src/client/rpc.ts:17-48`

## 3. 已确认发现

### 3.1 Thread 首次打开必定触发重复刷新

**严重性：高。直接影响打开 Thread。**

Thread 页面首次挂载时，同时启动以下工作：

```text
打开 Thread
  ├─ readThread()                 读取并确认已读
  ├─ refreshSupplemental()
  │   ├─ members()
  │   └─ view(... threadRef ...)
  └─ changes(afterVersion: 0)     等待任何 Team 变更
```

随后 `readThread()` 不是纯读取：它以新生成的 `requestId` 写入一条 `team/thread-read` operation。成功提交后，Host 调用 `emitCommitted()`，进而调用 `emitChanged()`，全局变更版本增加。

当前 Thread 页面自己的 `changes(afterVersion: 0)` 会因此立即返回或被唤醒，并再执行：

```text
members()
view(... threadRef ...)
threadHistory(limit: 100)
```

与此同时，初始 `readThread()` 成功后还会串行请求一次 `threadHistory(limit: 20)`。

因此一次普通的 Thread 打开，通常至少包含：

```text
readThread
members + view
threadHistory(20)
changes
members + view + threadHistory(100)
```

这不是偶发分支：首次读取使用新的 UUID，因此不是幂等重试，正常情况下会提交新的 operation。

**相关实现：**

- `packages/client-agent-team/src/client/TeamThreadPage.tsx:108-131`：生成 request id 并调用 `readThread()`。
- `packages/client-agent-team/src/client/TeamThreadPage.tsx:135-167`：补充数据与 100 条被动历史刷新。
- `packages/client-agent-team/src/client/TeamThreadPage.tsx:170-223`：首次加载、历史加载和 `changes` 循环。
- `packages/agent-team/src/index.ts:373-380`：`readThread()` 发生 durable commit 后调用 `emitCommitted()`。
- `packages/agent-team/src/ledger.ts:723-742`：`readThread()` 写入 operation table。
- `packages/agent-team/src/index.ts:606-613`：`emitCommitted()` 触发全局变更通知。

**用户侧表现：** 首次进入 Thread 时常比进入普通 Channel 更慢；Agent、任务、消息较多时尤为明显。

### 3.2 `changes` 是全局通知，任何 Team 活动都会刷新当前页面

**严重性：高。造成随机、与当前页面无关的加载。**

Host 只维护一个 `changeVersion`。`changes({ afterVersion })` 不带 Workspace、Channel 或 Thread 范围。只要版本发生变化，所有等待的页面都会收到通知。

```ts
// packages/agent-team/src/index.ts:206-217
if (this.changeVersion > request.afterVersion || !this.accepting) {
  return { version: this.changeVersion }
}
// 否则最长等待 25 秒
```

下列事件都会使版本增加：

- 任意 ledger commit；
- Agent 进入 error；
- Agent 从 error 恢复并进入 running；
- Host 初始化、Member 激活、服务关闭等生命周期事件。

Channels、Agents、Channel、Thread 三类页面都各自维护一个从 `0` 开始的 `changes` 循环。页面不会共享已知版本、数据缓存或刷新协调器。

示例：用户正在查看 Workspace Alpha 的一个 Channel。此时 Workspace Beta 中 Agent 回复、任一 Agent 状态变化，Alpha 当前页面仍会重新请求自己的成员和频道投影。

**相关实现：**

- `packages/agent-team/src/index.ts:131-153`：Agent error/running 会 `emitChanged()`。
- `packages/agent-team/src/index.ts:205-222`：全局 long-poll。
- `packages/agent-team/src/index.ts:657-661`：版本递增并唤醒全部 waiters。
- `packages/client-agent-team/src/client/TeamAgentsPanel.tsx:50-74`：Agents 面板的独立监听与整表刷新。
- `packages/client-agent-team/src/client/TeamChannelPage.tsx:71-102`：Channel 页的独立监听与整页刷新。
- `packages/client-agent-team/src/client/TeamThreadPage.tsx:204-223`：Thread 页的独立监听与补充投影/历史刷新。

**用户侧表现：** 即使用户没有操作当前页面，只要 Team 内其他活动发生，当前列表或频道会重新进入 loading 或产生请求；多个 Agent 同时工作时更明显。

### 3.3 `view(limit: 1)` 并不小；它仍构造完整 Workspace 投影

**严重性：高。数据增长后的主要持续成本。**

Channels 面板和 Agents 面板都把 `view({ limit: 1 })` 用作“轻量”加载。实际上 `limit` 只限制 timeline 中选择的 facts/items；Host 仍返回当前 Workspace 的完整 metadata：

```text
channels        全部可见频道
members         全部频道成员关系
tasks           全部可见 Task
threads         全部可见 Thread
taskNumbers     全部可见 Task 编号
claims          全部可见 Claim
items           仅此项受 limit 约束
activities      仅此项受 limit 约束
```

Host 每次 `view()` 都重新执行：

1. 扫描全部 message 与 activity，组装并排序 `publicFacts()`；
2. 过滤全部 task；
3. 再扫描 top-level message 计算 task number；
4. 对每个返回 message 再扫描全部 message 计算该 Thread 的 `messageCount`；
5. 通过 `threads × visibleTasks` 判断可见 Thread；
6. 构造并冻结完整响应对象；
7. 经过 Host 与浏览器两侧 schema 校验。

因此“当前列表只显示少量内容”不能保证请求小，也不能保证计算量小。工作区历史增长时，`view(limit: 1)` 的成本依然随完整 Workspace 数据增长。

**相关实现：**

- `packages/client-agent-team/src/client/TeamChannelsPanel.tsx:46-51`：Channels 面板请求 `view({ limit: 1 })`。
- `packages/client-agent-team/src/client/TeamAgentsPanel.tsx:75-82`：Agents 面板请求 `view({ topLevelOnly: true, includeActivities: false, limit: 1 })`。
- `packages/agent-team/src/ledger.ts:820-879`：`view()` 的完整投影构造。
- `packages/agent-team/src/ledger.ts:1448-1465`：每次重新组装、排序 public facts。
- `packages/agent-team/src/ledger.ts:1658-1689`：claims/task numbers 等重复扫描。
- `packages/agent-team/src/types.ts:798-839`：`view` 返回完整投影的类型合同。

**用户侧表现：** Channels 或 Agents 列表本身很简单，但在历史任务多的 Workspace 中仍会变慢；请求响应体会明显大于页面展示的数据。

### 3.4 每次 commit 都同步为所有在线 Agent 重算 Inbox

**严重性：高。Agent 和 Task 增加后，所有写操作变慢。**

每次持久化提交，包括 Human 的 `readThread()`，都会：

```text
commit operation
  → emitChanged()
  → 对全部 live Agent 调用 notifyMember()
       → inboxForAgent()
            → 遍历该 Workspace 所有 Task
            → 对每个 Task 重新建立该 Thread facts 并排序
```

这个计算发生在发回当前 Remote 请求结果之前。即便 Human 的阅读确认通常不会给其他 Agent 增加未读内容，当前实现仍会检查每个 Agent 的完整 Inbox。

**相关实现：**

- `packages/agent-team/src/index.ts:606-613`：每个 commit 遍历所有 `handles`。
- `packages/agent-team/src/index.ts:615-650`：`notifyMember()` 读取 Agent Inbox、计算签名、尝试发送提醒。
- `packages/agent-team/src/ledger.ts:700-719`：`inbox()` 遍历 Task。
- `packages/agent-team/src/ledger.ts:1427-1465`：未读判断会筛选并排序 Thread facts。

**用户侧表现：** Agent 数量和历史 Task/Thread 数量增加后，打开 Thread、回复、Claim、关闭任务等 mutation 的延迟都可能增加；Host CPU 会在提交时短时上升。

### 3.5 旧的 `changes` long-poll 请求没有取消

**严重性：中高。快速切换后产生无效工作和长尾。**

`changes` 最长等待 25 秒。Channels/Agents/Channel/Thread 页面卸载时，只通过 `active = false` 阻止结果写回 React state；请求本身没有传递 `AbortSignal`，Host 侧的 waiter 也没有被取消。

用户快速切换 Workspace、tab、Channel 或 Thread 时，已经不需要的请求仍会保留至：

- 发生下一次全局变更；或
- 25 秒超时。

这些 stale request 返回后仍会经过网络传输和 schema 校验，只是被 Client 丢弃。大量切换时，Host 还需要维护和唤醒更多 waiter。

**相关实现：**

- `packages/agent-team/src/index.ts:205-222`：25 秒 waiter。
- `packages/client-agent-team/src/client/TeamAgentsPanel.tsx:51-74`：仅使用 `active` flag。
- `packages/client-agent-team/src/client/TeamChannelPage.tsx:80-101`：仅使用 `active` flag。
- `packages/client-agent-team/src/client/TeamThreadPage.tsx:204-223`：仅使用 `active` flag。
- `../deepseek-harness/packages/api/gateway/src/client/index.ts:351-411`：Remote 支持 descriptor 级取消，但当前 Team Remote 形状未使用。

**用户侧表现：** 连续切换多个 Thread 或 Workspace 后，后续响应和刷新更容易拥挤；过一段时间可能出现不再需要的请求响应。

### 3.6 Host 冷启动按 Agent 顺序恢复，且重复读取 Session 清单

**严重性：中。仅解释冷启动、重连或插件重载时的慢。**

Host 初始化期间会遍历已启用 Member，并逐个等待 `activateMember()` 完成。`activateMember()` 内部还会读取一次完整的 `sessionPersistence.list()` 来判断该 Member 的 Session 是否存在。

```text
Host 启动
  → ledger replay
  → enabled Member A：sessionPersistence.list() → resume/create
  → enabled Member B：sessionPersistence.list() → resume/create
  → enabled Member C：sessionPersistence.list() → resume/create
```

这条路径不解释普通情况下的每次页面切换，但能解释“有时”特别慢：浏览器刚连接、Host 刚启动、断线重连或插件重载之后，Remote 服务要等整个初始化结束才能稳定可用。

**相关实现：**

- `packages/agent-team/src/index.ts:162-179`：打开 Domain、replay ledger、顺序恢复 Member。
- `packages/agent-team/src/index.ts:512-535`：每次激活读取 `sessionPersistence.list()`。

## 4. 页面级请求链路

### 4.1 Channels 面板

首次显示：

```text
view({ workspaceId, limit: 1 })
members({ workspaceId })
```

两者并发，但 `view(limit: 1)` 仍构造完整 Workspace metadata。该面板没有监听普通 Team changes；创建 Agent 的中间状态变化后会触发 refresh。

**实现：** `packages/client-agent-team/src/client/TeamChannelsPanel.tsx:46-75`。

### 4.2 Agents 面板

首次显示：

```text
members({ workspaceId })
view({ workspaceId, topLevelOnly: true, includeActivities: false, limit: 1 })
changes({ afterVersion: 0 }) → 每次变更后 members() 再刷新
```

列表本身只展示 Agent，但为了创建 Agent 时选择初始 Channel，额外请求 `view()` 读取频道列表。

**实现：** `packages/client-agent-team/src/client/TeamAgentsPanel.tsx:38-82`。

### 4.3 Channel 页面

首次显示：

```text
view({ workspaceId, channelRef, direction: 'before', topLevelOnly: true, includeActivities: false, limit: 20 })
members({ workspaceId })
changes({ afterVersion: 0 }) → 每次任意全局变更后重复上述两项
```

当前 Channel 的初始投影也会因为其他 Workspace 或 Agent 状态的变化而刷新。

**实现：** `packages/client-agent-team/src/client/TeamChannelPage.tsx:46-102`。

### 4.4 Thread 页面

首次显示：

```text
readThread()                        durable write
members() + view(thread)            supplemental projection
changes(afterVersion: 0)             被上述 write 唤醒
  → members() + view(thread) + threadHistory(100)
readThread() 成功后 → threadHistory(20)
```

这是目前最明确、最需要先修复的慢路径。

**实现：** `packages/client-agent-team/src/client/TeamThreadPage.tsx:170-223`。

## 5. 原因之间的放大关系

```text
Thread 打开
  │
  ├─ readThread 写入 ledger
  │    │
  │    ├─ 触发全局 version++
  │    ├─ 唤醒所有页面的 changes waiters
  │    └─ 同步扫描所有 live Agent Inbox
  │
  └─ 当前 Thread 自己收到 version 变化
       │
       ├─ members()                  全 Workspace 成员状态
       ├─ view()                     全 Workspace 元数据与全表扫描
       └─ threadHistory(100)         大历史读取
```

当多个 Agent 正在回复、Claim 或状态变更时，以上过程会互相叠加。问题表现为“有时慢”，是因为请求数和计算量取决于最近是否有全局变更、当前有多少 stale long-poll、Workspace 历史规模、在线 Agent 数，以及 Host 是否刚重启。

## 6. 建议的修复方向

以下是建议的最终方向，不建议只给当前 UI 增加延迟、轮询间隔或临时缓存来掩盖问题。

### 6.1 优先级 P0：消除 Thread 的自触发重复刷新

目标：首次 Thread 打开只完成必要的读取和渲染，不让由自身 `readThread()` 引起的变更再次刷新同一页。

可接受的实现方式需要满足：

- 页面在发起读取前记录或订阅当前版本；
- 自己已知的 `readThread` commit 不触发被动刷新；
- 初始 `readThread` 返回已经包含的 Task、Thread、Claims、facts 不重复从 `view()` / `threadHistory()` 拉取；
- 旧历史仅在用户点击“加载更早内容”或确有缺口时请求。

需要决定：`readThread` 是否继续作为 durable acknowledgement operation；若保留，应让 Client 或 Host 能区分“本页面自己的已读确认”和外部内容变更。

### 6.2 优先级 P0：按范围提供变更通知

目标：当前 Workspace/Channel/Thread 只在相关数据真正变化时刷新。

建议的最终接口不是全局版本号加 Client 过滤，而是在 Host 侧建立明确的 scope：

```text
Workspace change scope
Channel change scope
Thread change scope
Agent presence scope
```

每个 scope 应提供：

- 单调版本或事件序列；
- 可取消的等待；
- 明确的变更类型或足以判断要更新的最小信息；
- 不泄漏 ledger operation 本身。

这样可以避免 Beta 的事件刷新 Alpha，也可以让 Thread 收到仅与该 Thread 有关的新增 facts 或状态变化。

### 6.3 优先级 P0：Client 统一管理 Team 投影和请求生命周期

目标：一个 scope 的数据只加载一次；组件切换不产生并行重复请求；离开页面立即取消无用请求。

建议：

- 建立 Team Client store/query coordinator，而不是每个 React 页面自己维护 `changes` while loop；
- 按 Workspace / Channel / Thread 存放当前投影、版本和 in-flight request；
- 同 key 请求合并；
- 页面 unmount 或导航改变时使用 `AbortController` 取消 long-poll 和普通读取；
- 使用 Host scope version，而不是每个组件从 `0` 开始；
- 页面只订阅其显示所需的数据切片。

注意：这个 store 只能缓存 Host projection，不能成为 Team 事实的第二权威来源；持久状态仍以 Host 为准。

### 6.4 优先级 P1：拆分 `view()`，让列表接口真正有界

目标：Channels、Agents、Channel、Thread 不再为展示少量内容传输整个 Workspace graph。

建议拆分为独立、明确有界的投影：

```text
listChannels(workspaceId)
listWorkspaceMembers(workspaceId)
readChannel(channelRef, cursor, limit)
readThread(threadRef, cursor, limit)
listThreadClaims(taskRef)
```

具体接口命名可以调整，但每个响应应有明确的分页和体积上限；`limit` 应限制实际响应，而不是只限制其中一个数组。

旧的通用 `view()` 在替换完成后应移除，不保留并行投影或兼容路径。

### 6.5 优先级 P1：为 Host 读取和 Inbox 建立投影索引

目标：避免每次读取都扫描并排序所有历史 facts。

建议至少维护：

```text
threadFactsByThreadRef
messageCountByThreadRef
taskNumbersByWorkspaceAndChannel
claimsByTaskRef
tasksByWorkspace
threadsByTaskRef
inboxDirtyMembers 或按 commit delta 标记的待通知 Member
```

关键要求：这些索引是 ledger replay 后可重建的 Host 内部 projection，不是第二份 durable authority。写 operation 后在同一 Host projection 更新，重启时从 ledger 统一重建。

此外，`emitCommitted()` 不应对每次 commit 都重算全部 Agent Inbox；Host 已知 operation 的 inbox delta，应只检查可能受影响的 Member。Human 的 `thread-read` 通常不需要通知其他 Agent。

### 6.6 优先级 P2：改进冷启动恢复

目标：减少 Host 就绪前的线性等待。

建议：

1. 在恢复循环前只调用一次 `sessionPersistence.list()`，建成 `Set<SessionId>`；
2. 在确认 Harness Agent 生命周期和资源限制后，并行或设有并发上限地恢复 enabled Member；
3. 保证失败仍只影响对应 Member，不阻断其他 Member 及 Host 的可用性。

这项改动需先查阅 Harness 的 Agent 创建/恢复并发合同，不能未经验证地直接并发化。

## 7. 验证计划

### 7.1 浏览器网络录制

在至少有一个 Thread、多个 Agent 的 profile 中：

1. 清空浏览器 Network；
2. 打开一个 Thread；
3. 导出 HAR，按 `readThread`、`changes`、`members`、`view`、`threadHistory` 分组；
4. 记录每类请求数量、开始时间、耗时、响应体大小。

预期现象：

```text
readThread
members + view
threadHistory(20)
changes 被 readThread 的 commit 唤醒
members + view + threadHistory(100)
```

同时比较 `view` 的 `items.length` 与整个响应大小；若 items 很少、tasks/threads/claims/members 很多，即可直观看到 `limit` 没有约束整体 payload。

### 7.2 全局失效验证

1. 打开 Workspace Alpha 的 Channel；
2. 让 Workspace Beta 的 Agent 回复，或让无关 Agent 的运行状态改变；
3. 观察 Alpha 是否仍发起 `members()` 和 `view()`。

预期：当前实现会刷新 Alpha，证明变更范围过大。

### 7.3 stale long-poll 验证

1. 连续切换多个 Thread 或 Workspace；
2. 在 Host `changes()` 与 `emitChanged()` 处使用本地 debugger/logpoint 观察；
3. 记录 waiter 数量与清理时间。

预期：离开页面的 waiters 会保留到下次全局变更或 25 秒 timeout。

### 7.4 Host CPU 与数据规模阶梯

构建 Small / Medium / Large 三组可重复 fixture：

| 规模 | Channels | Tasks / Threads | Messages | Agent Members |
| --- | ---: | ---: | ---: | ---: |
| Small | 3 | 20 | 100 | 2 |
| Medium | 10 | 500 | 5,000 | 8 |
| Large | 20 | 2,000 | 20,000 | 20 |

每组分别测量：

```text
view({ limit: 1 })
view({ channelRef, limit: 20 })
readThread()
threadHistory({ limit: 100 })
一次 reply 的端到端耗时
```

Node CPU profile 重点观察：

```text
AgentTeamLedger.view
publicFacts
taskNumbers
threadFactsFrom
AgentTeam.inboxForAgent / notifyMember
schema decode / validation
```

### 7.5 冷启动测量

从停止 Host 到第一个 Team Remote 可用，分别记录：

- ledger replay 与 validation 时间；
- 每个 `activateMember()` 的耗时；
- `sessionPersistence.list()` 调用次数；
- enabled Member 数量与总时间的关系。

## 8. 建议验收标准

实施前，Team 应先确定可量化目标。建议至少覆盖：

| 指标 | 建议要求 |
| --- | --- |
| 打开 Thread 的首次请求链 | 不应由自身 read acknowledgement 触发第二轮全量刷新 |
| 无关 Workspace 变更 | 不应刷新当前 Workspace / Channel / Thread |
| 页面离开后的请求 | long-poll 和读取请求可取消，不应保留至 25 秒 timeout |
| 列表响应大小 | 随页面需要的分页大小增长，不随整个 Workspace 历史无界增长 |
| commit 通知成本 | 只处理受该 operation inbox delta 影响的 Agent |
| 数据规模回归 | Medium / Large fixture 下测量并设定明确上限 |
| 正确性 | Inbox、Attention、权限、revision、idempotency 与 durable ledger 合同保持不变 |

涉及 Client、Remote 或可见 UI 的改动，还必须运行：

```sh
npm run typecheck
npm test
npm run build
npm run test:browser
git diff --check
```

## 9. 调查边界与当前状态

- 本次调查未修改生产代码。
- 本次调查确认了逻辑上的重复请求、无范围 invalidation、全量投影构造和同步 Inbox 扫描。
- 本次调查尚未采集真实 profile 的 HAR、CPU profile 与按规模耗时数据；这些属于下一步实施前/后的量化验证。
- 当前工作区有两处与本调查无关的未提交生产代码改动：
  - `packages/agent-team/src/ledger.ts`
  - `packages/tool-agent-team/src/index.ts`
- 已验证：`npm test` 成功，11 个测试文件、53 个测试全部通过。

## 10. 实施记录（2026-08-21，期 1+2）

评审结论：§3 六项发现全部核实成立；§6 方向正确但做了三处修正——

1. **自触发刷新**：不采用"客户端识别自己的 commit"（receipt 无法映射回 changeVersion），改用更强的不变量：`team/thread-read` 只推进读者私有水位，不改变任何共享投影，因此派生 scope 为空集，不唤醒任何人。Thread 首开同时改为单轮并行（readThread ∥ threadHistory(20) ∥ members ∥ view）。
2. **范围通知**：保留单一全局 `changeVersion`（wire 结果 `{version}` 不变），仅在请求加可选 `scope`，Host 按 waiter scope 过滤唤醒；每个 scope 的单调性由全局版本天然继承。语义：undefined=广播；空数组=无人唤醒；非空=全局 waiter + 匹配 scope waiter。presence/成员生命周期/激活失败改为 workspace scope（原先是无条件广播）。
3. **`view()` 不删除**：它是 `team_view` 工具的模型侧合同；内部已改建于追加式索引（orderedFacts/topLevelMessages/messageCountByThread/factsByThread/attentionByThread），成本大降。面向 Human 的有界读端点留待期 3。

### 已落地改动

Host（`packages/agent-team`）：

- `types.ts`：新增 `AgentTeamChangeScope`；`AgentTeamChangesRequest.scope?`。
- `index.ts`：`changes(request, signal?)` 支持 scope 校验、AbortSignal 取消、25s 超时保留；`emitChanged(scopes?)` 按操作派生 scope 唤醒；`emitCommitted` 改为定向通知（`ledger.affectedMembersOf` ∩ live handles）；agent error/running 与 `activateMember` finally 改为 workspace scope；冷启动 `sessionPersistence.list()` hoist 为一次调用。
- `ledger.ts`：Projection 新增 byOperation/orderedFacts/factsByThread/topLevelMessages/messageCountByThread/attentionByThread 追加式索引（applyTo 维护，replay 可重建）；`threadFactsFrom`/`publicFacts`/`taskNumbers`/messageCount 改读索引；`prepareReadFrom` 深拷贝 attentionByThread 内层 Set；新增公开派生函数 `getOperation`/`changeScopesOf`/`affectedMembersOf`。

Client（`packages/client-agent-team`）：

- 新增 `team-changes.ts`：`TeamChangeStream` 每 scope 一条可取消 long-poll，多订阅者共享，静默探针避免挂载即双取，失败通知并注销，最后一名订阅者离开时 abort。
- `slots.ts`：`loadChanges` 替换为 `subscribeChanges(scope, listener)`；`index.ts` 注入 stream。
- `TeamThreadPage`：首开并行一轮 + thread/workspace 双订阅（thread→被动事实刷新，workspace→补充数据）；`TeamChannelPage`：channel→全量刷新，workspace→仅成员；`TeamAgentsPanel`：workspace 订阅。

### 验证

typecheck / test（13 files, 65 tests）/ build / test:browser（assembled journey e2e）/ lint（0 warnings）/ git diff --check 全部通过。新增测试见目录 README。性能量级测量（Small/Medium/Large fixture）仍待实施后补测。
