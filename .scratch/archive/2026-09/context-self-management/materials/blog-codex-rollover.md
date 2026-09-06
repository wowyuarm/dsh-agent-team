## 问题：上下文用完了怎么办

长任务做到一半，模型的 context window 快满了。传统答案是 compaction：让模型把整段历史总结成摘要，再丢掉原文，带着摘要继续。这条路能用，但摘要是一种有损压缩。如果摘要里没写到一些细节，它就永远从模型的视野里消失了。

Codex 给出的是另一个思路：**不做摘要的换窗（context rollover）**。模型在窗口存续期间自己维护一份 handoff note，主动声明「我要换上下文窗口」，宿主在一个安全边界把活动历史整体换掉，新窗口只带这份 handoff 继续推理；旧历史没有删除，只是从模型视野里移到了持久层，缺细节时再按稳定 ID 回去取证。

我看到这个思路就觉得很有意思：obelisk 是一个更好的 query history 的底座，如果把它和 handoff 很好地结合起来，效果岂不是会更好？

所以我们尝试了一下，在 DeepSeek Harness（DSH）上把同样的控制流做成了一个纯插件。不改 DSH 核心、不改特权插件，你可以将它作为一个插件接入。

我们想聊聊两个问题：

* Codex 的 `new_context` 到底是怎么实现的

* 我们的 rollover 插件是怎么把这套机制搬到 DSH 上的。

那么，让我们开始吧。

## 一、Codex 的 new\\_context 是怎么实现的

> baseline：`new_context` 初版 PR [#27488](https://github.com/openai/codex/pull/27488)，history/notes 扩展 PR [#39827](https://github.com/openai/codex/pull/39827)，fallback reserve PR [#33255](https://github.com/openai/codex/pull/33255)。

### 1.1 模型

Codex 的"换窗"不是扩大 context window，而是**模型主动触发、无摘要的上下文轮换**：

```text
模型维护 handoff note
      ↓
模型调用 new_context（只声明 intent）
      ↓
本轮 sampling 成功到达安全边界
      ↓
host 变更 window ID、替换活动 history、持久化空摘要 checkpoint
      ↓
同一 user turn 在新窗口继续 inference
      ↓
模型读取 note；缺少细节时按 window/item 查询 history
```

### 1.2 三层 prompt：guidance、reminder、fallback

token 预算按模型配置，模型切换时换成新模型自己的阈值。围绕预算有三层 prompt：

* **Guidance**：持续有效的 developer instruction，要求模型在压力临界前主动维护 handoff。

* **Near-limit reminder**：剩余预算到阈值后一次性注入，提醒模型立刻更新 handoff 并择机调用 `new_context`。每段窗口最多提醒一次。

* **Fallback reserve**：base budget 归零后再给模型一次采样机会，prompt 要求它停止任务、恰好写一次 note、调用 `new_context`、不调用其他工具。

注意最后一层只是 **prompt 约束**：下一轮模型仍能看到常规工具面，host 没有硬裁剪 tool plan。模型不遵守时，buffer 耗尽后 host 强制 rollover。这是 Codex 留下的一个明确的软约束缺口。

### 1.3 new\\_context：两阶段

初版工具叫 `new_context`，无参数，只对模型暴露。handler **不清 history**，只置一个 flag，然后返回 "A new context window will start without summarizing conversation history."

为什么必须两阶段？工具调用发生在 response stream 的调度阶段，此时同一 response 可能还有兄弟 tool calls，stream 也可能尚未收到 `response.completed`；立即替换 history 会让工具输出无处归属、兄弟调用副作用不确定、stream 失败时状态半切换。所以 Codex 用一次性 intent，真正的切换推迟到 sampling 成功完成后的安全边界：旋转 window identity、重建 initial context、替换 history，并持久化一条**摘要为空**的 compaction 记录。

语义上关键的两点：旧消息（包括当前 user request 和 `new_context` 调用本身）不进入新窗口；同一 user turn 继续 inference。

### 1.4 handoff 的「结构化要求」是 prompt 

一个常见误解是 Codex 的 handoff 是结构化数据。实际上 notes API 的有效负载只有 `{ path, text }`，后端把 `text` 当 opaque text，不验证任何字段。"结构化"完全来自 model prompt 的语义要求：checkpoint 应覆盖 goal、decisions、progress、learnings、next steps、未完成请求的 window/item ID 等；至于模型写成 Markdown 还是 JSON，没有任何机器校验。

准确的分工是：notes API 负责自由文本持久化（强一致性，用于切窗时记录），model prompt 负责语义清单，history 负责在 note 不完整时追溯原始证据（最终一致性，用于取证）。

### 1.5 取证平面与已知边界

history/notes 扩展给模型加了九个 direct-model-only 工具，恢复顺序写在 model prompt 里：先读 note → 有精确 `window_id + item_id` 就直接 `read_item` → 只记得关键词用 `search_contents` → 恢复到够用就继续干活，而不是把旧窗口整个搬回来。session\\_id 等身份由 host 注入，模型不能自称。

初版 PR review 还暴露了几个被作者接受的边界：与 `new_context` 同批的兄弟工具副作用随旧 history 被丢弃；当前 user request 不自动带入新窗口；intent 置位后 stream 失败可能造成延迟切窗。这些边界，后来都成了我们插件设计时要显式回答的问题。

## 二、DSH rollover 插件：同样的控制流，更小的抽象

我们的约束从一开始就很明确：**不改 DSH 核心、不改特权插件**，只用公开 plugin seams 实现同样的换窗能力；历史检索复用已有的 Obelisk 插件（它已经把 DSH session 索引进 SQLite + FTS5）。

最终形态是 `packages/dsh-plugin` 内放入一个默认不挂载的 `context-window` extra plugin。源码为七个文件：`context-window.ts`（入口/组装钩子/预算接入）、`context-window-budget.ts`（纯函数预算判定）、`context-window-state.ts`（host-only 投影）、`context-window-rollover.ts`（安全边界替换）、`context-window-prompt.ts`（guidance/reminder/fallback 文案）、`context-window-identity.ts`（Obelisk 身份适配）、`context-window-related-files.ts`（文件引用校验）。

### 2.1 工具参数：handoff 直接作为参数

和 Codex 的无参数 `new_context` + 独立 notes API 不同，我们把 handoff 合并进工具调用：

```ts
new_context({
  handoff: string,          // 必填，非空 prose
  related_files?: Array<{   // 选填，结构化文件引用
    path: string            // 必须归一化且在 workspace 内
    reason: string
    role: 'spec' | 'decision' | 'implementation' | 'test' | 'handoff' | 'other'
  }>
})
```

handoff 保持 prose——这是讨论中明确过的决策：Codex 自己就是 prose + prompt 约束的形式，没必要发明一套模型需要额外学习、host 还要解析校验的 JSON schema。handoff 该覆盖什么（goal、decisions、progress、learnings、next steps、未完成请求、重要 action）由 guidance/reminder/fallback 三层 prompt 持续约束。

值得一提的是，prompt 里后来加了四个证据分级栏目——`SPEC-CONFIRMED REQUIREMENTS`（goal、progress、next steps，必须引用 user/spec/source）、`AGENT INFERENCES`（永远不许写成 `LOCKED DESIGN`，也不许因重复而升级为已确认）、`UNRESOLVED CONFLICTS`、`UNVERIFIED ACCEPTANCE CRITERIA`。

`related_files` 是唯一保留的结构化字段，原因写在代码注释里：文件引用保持结构化，host 才能校验 workspace 包含性、原样持久化 role、并不经解析模型 prose 就能渲染。

模型**不提交** session\\_id、message\\_uuid、window number 之类的标识——这些是 host fact，不能信任模型自称。handler 只做参数校验和 identity 预检，返回一句 "A fresh context will start after this sampling step."，不动任何 history。

### 2.2 不加 window\\_id：两个锚点就够了

这是整个设计里最重要的一次减法。最初的草案曾考虑给 Obelisk 加 `window_id`、加消息区间查询。讨论中被砍掉了，理由链是：

1. Obelisk 已经有稳定的 canonical `session_id` 和 `message_uuid`；
2. UUID 不可排序（assistant UUID 里 `t10` 字典序小于 `t2`），所以"UUID 区间"是个伪抽象——窗口边界本来就可以由相邻两次 `new_context` 在 canonical timeline 上派生，不需要物化；
3. 模型真正需要的不是区间，而是两个可操作的锚点：`session_id` 用来把恢复查询 scope 在当前任务（避免和全局历史召回混淆），`message_uuid` 指向触发换窗的那条 assistant tool-use 消息，直接传给 `context(uuid)` 就能从上一段上下文的末尾展开。

所以换窗后新 surface 上保留的唯一一条消息长这样：

```text
Previous context is available in Obelisk.
session_id: <canonical Obelisk session id>
message_uuid: <previous-context assistant tool-use UUID>

<handoff>
<模型写的原始 prose>
</handoff>

<related_files> ... </related_files>
```

字段名直接对应 Obelisk helper 的入参，模型可见内容里不出现 `window_id`、`transition_id` 这类无法操作的实现词汇。这些标识由 host 用与 Obelisk 索引器**完全相同**的 canonical identity helper 计算，因此切窗不等索引刷新：handoff 可以引用一个"未来一定会被索引出来"的 UUID，等 Obelisk catch up 后自然可解析。

### 2.3 删掉 rollover commit 状态机

研究文档曾经建议过一套完整的 rollover 事务：`context-window/requested` event、`commitRollover()`、WindowTransition、active-window 指针、原子提交。写 spec 时复盘发现这是把 Codex 的持久化模型整体搬了过来，而没有先验证 DSH 已有的 durable log 是否覆盖了这些职责。

答案是已经覆盖了。DSH 的 append-only event log 里：

```text
assistant/message
→ tool/call(name = new_context, arguments = { handoff })   // 持久化了 intent 和参数
→ tool/result(success)                                     // 证明 runtime 已接受
```

成功的 tool pair 合起来就是 durable 的 model-requested rollover intent。PTC（run\\_code 嵌套调用）模式同理：`tool/code-dispatch-start` + `tool/code-dispatch` + 外层 `run_code` 的成功 result。只有 call 没有成功 result，不触发 rollover；pair 成功但 replacement 还没发生，下一个安全边界补上；replacement 已经引用同一 rootCallId，后续 replay 是 no-op。

于是没有新增任何 event 类型、没有第二份 rollover store。运行时状态由一个 **host-only session projection**（`obeliskContextWindow`）从 durable event 增量折叠出来：配对 native/PTC 的 call 与 result、记录 `pending` 换窗、跟踪 `reminderClaimed` / `fallbackClaimed`、在换窗 message 落地时递增 `generation` 并清零上一代的 claim。投影是纯读模型，没有 cache 也能从完整 replay 重建。

### 2.4 三段预算与硬约束 fallback

预算策略（`context-window-budget.ts`）是一个纯函数：

```text
hardLimit = contextWindow - outputReserveTokens      // 保证最后一次响应能完成
baseLimit = hardLimit  - fallbackReserveTokens       // 正常任务预算

显式 new_context 已成功     → rollover(model)
totalTokens ≥ hardLimit     → rollover(hard-limit)   // 强制换窗
totalTokens ≥ baseLimit 且 fallback 已 claim → rollover(hard-limit)
totalTokens ≥ baseLimit     → fallback               // 给一次受限采样
baseRemaining ≤ reminderThreshold 且未 claim → remind
否则                         → continue
```

和 Codex 的三个区别：

* **数值不照抄**。Codex 的 6,144 / 16,384 是模型 catalog 值；我们的三个 reserve 默认取当前请求的 effective `maxTokens`，随 adapter/模型实际输出上限变化，并允许显式配置覆盖。模型切换时用本次 assembly 捕获的 route（provider/model）解析新容量，不回退到上一请求的 durable header。

* **预算由 host 计算**。token 计量走 DSH tokenMeter，包括按 route 给图片定价；模型不自报 token usage。

* **fallback 是硬约束**。进入 fallback phase 后，`system-prompt/assemble` 钩子把 wire tool schemas 过滤到只剩 `new_context`（PTC 模式只留 `run_code` transport），同时 `tools.guard` 在执行层拒绝除 `new_context` 之外的一切调用。

fallback 期间如果模型请求在 transport 层彻底失败（downstream retry 用尽），插件在 `agent/request-error` 边界直接执行 forced rollover、恢复完整工具面并返回一次 retry——不等一个永远不会触发的 `turn-stopping`。

### 2.5 安全边界上的 surface replacement

所有破坏性操作集中在 `{ prepend: true }` 的 `agent/pre-step` listener——上一批工具已 settle、下一次模型请求尚未从 active surface 派生 history 的公开安全点。对 explicit trigger：

1. 从投影读出已配对校验的 handoff；
2. 用 root call 的 `turn/step` 算出 `session_id` / `message_uuid`；
3. 校验当前 surface 非空、token 计量与 surface 节点一一对应（不通过则中止，旧 history 保持 authoritative）；
4. 先追加一条 DSH 现有的 `compaction/prune` shadow-price 记录（只负责让 token 投影正确扣账，不表示任何 intent）；
5. 紧接着追加 `user/message`，以 `surfaceOp: { op: 'replace', start, end }` 替换整个 active surface；
6. `flush` 成功前不 dispatch 下一次模型请求；flush 失败会 latch，下一次 pre-step 先重试。

这条 replacement message 的 source（`obelisk-context-handoff`，带 trigger 和两个锚点）同时就是唯一的 durable rollover 结果。旧消息全部留在 append-only log 里，Obelisk 继续索引完整历史——"模型看不到旧历史"不等于"系统删除旧历史"。

如果模型始终不写 handoff 就把 reserve 耗尽，host 执行 **forced rollover**：同一条替换路径，但换成 host 生成的降级 handoff（`handoffStatus: 'missing'`），明确告诉新窗口"上一段没留下 handoff，请用这两个锚点从 Obelisk 恢复任务"。这条路径必须能前进——缺 handoff 可以降级，系统不能死锁。

另一个组合约束：启用本插件必须关闭 `compaction-basic.auto`，两个自动 pressure policy 不能竞争同一段 history。插件在 load 和每次真实 prompt 组装前检查，发现冲突 fail fast。手动 `/compact` 不受影响。

## 三、验证

**Smoke test**：在真实 DSH session 里注入验证标记（如 `CW-TEST-2333`），触发换窗后新窗口正确复述标记并回复 `ROLLOVER_OK`，handoff 跨边界恢复成功。

**A/B pilot**（200K 声明窗口、同一 held-out 长程任务、各跑一次，rollover vs compact）：

| 指标                        |  compact |    rollover |
| ------------------------- | -------: | ----------: |
| 总耗时                       | 74.3 min |    57.6 min |
| 主 session 步数              |      477 |         341 |
| 主 session provider tokens |    52.9M |       26.8M |
| 边界次数（主 session）           |    6 次摘要 | 6 次 handoff |
| fallback / 强制换窗           |        — |       0 / 0 |
| 主 session 工具错误            |        8 |           0 |

机制层面的信号很干净：6 次 reminder 全部由模型主动 `new_context` 处理，每次换窗都产出带 canonical 锚点的 prose handoff、在同一 user turn 继续，没有触发一次 fallback 或强制换窗；效率上 rollover 快 22.5%、主 session tokens 少 49.4%、步数少 28.5%。

**pilot 暴露了一个真实的失败模式。** 通过 obelisk 逐条回放 rollover 对应的的 session 时发现：agent 在早期形成了一个未经验证的范围误判，而后续每份 handoff 都忠实地把这个误判继承下来、并一步步固化成了"LOCKED DESIGN"。换窗机制没有丢信息，它把错误信息也记录下来了。

这个发现直接催生了上文提到的四分栏 prompt：handoff 必须区分"规格确认的事实"和"agent 自己的推断"，不允许因重复提取而将模糊推断升级为事实。

**300K 复跑**。带着四分栏 prompt 和 `related_files` 在 300K 窗口重跑同任务，3 次换窗全部主动完成，handoff 按"规格事实 / agent 推断 / 冲突 / 未验证项"组织，第三份还附了 11 个 `{path, reason, role}` 文件锚点；后续窗口可以直接按证据等级接着执行，没有重新探索。

**直接对比切窗恢复 message 的质量。** 把 compact 臂的 6 份自动摘要和当前 rollover 的 handoff 摆在一起，看"换窗后模型实际看到的第一条消息"：

| 对比项  | compact 摘要                       | rollover handoff                         |
| ---- | -------------------------------- | ---------------------------------------- |
| 平均长度 | 约 20.8K 字符，逐次累积膨胀                | 约 9.8K，短约 53%                            |
| 证据边界 | 把推断写进 "Primary Request"，猜测被固化成事实 | 明确区分规格、推断、冲突、未验证项                        |
| 可执行性 | 大量堆积的文件、历史错误和研究细节                | 下一步更聚焦，附结构化 related files                |
| 恢复能力 | 只能依赖摘要本身覆盖全面                     | 有 `session_id` / `message_uuid`，缺细节可定点回查 |

**就切窗恢复 message 本身而言，rollover 的 handoff 质量高于 compact 的自动摘要**——优势不是"记得更多"，而是"更清楚哪些内容可信、下一步做什么"；compact 更像不断膨胀的全量笔记，且会把猜测写成事实。

## 四、设计判断

回头看，**值得复用的是 Codex 的控制流，不是它的存储模型**。

复用的部分：模型感知的分层预算 prompt、一次性 reminder + 受限 fallback reserve、intent/commit 两阶段切窗、稳定锚点引用、active context 与 durable history 分离、按需取证。

强化或简化的部分：

* intent 不需要新 event。durable tool log 里的成功 pair 就是 intent；

* 不需要 window\\_id / transition record。canonical session\\_id + message\\_uuid 就是可操作的边界；

* handoff 保持 prose，语义契约交给 prompt，结构化只留给 host 需要校验的字段（related\\_files）；

* handoff 的语义契约从"覆盖清单"升级为"证据分级"。规格事实与 agent 推断分栏，推断不许因重复而固化成事实；

* fallback 的工具限制是 host 硬裁剪，不是 prompt 软约束；

* 模型身份类字段一律 host 注入，模型自称一概不信。

最小正确协议最终是：

```text
模型写 prose handoff → new_context（只记 durable intent）
→ sampling step 完成 → pre-step 安全边界
→ prune 计价 + surface replace + flush
→ 同一 user turn 在新 context 继续
→ 缺细节时按 session_id / message_uuid 从 Obelisk 取证
```

## 参考

* Codex PR：#27488（new\\_context 初版）、#39827（history/notes 扩展）、#33255（fallback reserve）

* 插件与源码：[tommy0103/obelisk-dsh-plugin](https://github.com/tommy0103/obelisk-dsh-plugin)（可直接安装的 standalone 发布仓库）、[tommy0103/obelisk](https://github.com/tommy0103/obelisk)（开发仓库）

* 本仓库：`docs/codex-new-context-window-handoff-implementation.md`（调研全量笔记，含 Codex 侧完整 PR 索引）、`docs/dsh-context-window-extra-plugin-spec.md`（插件规格）、`packages/dsh-plugin/src/context-window*.ts`（实现）、`output/context-window-ab-pilot-20260902/`（200K A/B pilot）、`output/context-window-rollover-related-files-300k-run-20260903/`（四分栏 + related\\_files 的 300K 复跑）
