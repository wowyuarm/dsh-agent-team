# 调研：harness session-query 家族 × Team context 管理，缺口与开放问题

**日期：** 2026-09-10（Reeve 首轮调研，全部对照两仓库源码/README 核实）
**用途：** 讨论输入，非 spec。当前行为以 `packages/` 源码与测试为准。

## 1. 已有能力（已核实）

### 1.1 Harness `session-query/` 家族（human 说的「工具包」）
位置：`../deepseek-harness/packages/session-query/`。四包：

| 包 | 角色 | ctx key |
|---|---|---|
| `session-query` | 统一会话历史查询服务：精确 read、关系 trace、过滤 | `ctx.sessionQuery` |
| `session-query-sqlite` | SQLite FTS5 全文搜索后端 | 注册到 `ctx.sessionQuery` |
| `tool-session-query` | 5 个模型工具 | 注册到 `ctx.tools` |
| `session-log-export` | Web `/export` 下载 ZIP | `ctx.sessionLogDownload`（browser） |

`tool-session-query` 的 5 个**只读**工具：
- `session_search`：跨 session 按字面查询，排名 + 标题 + 最佳片段；**总是排除 caller 自身 session**。
- `session_event_search`：在**一个已授权 session 内**按字面查询 events；对当前 session 会停在调用它的 step 之前。
- `session_trace`：一个 session 的祖先链 + 后代树；未授权边界只显示 marker，不泄 id。
- `session_event_trace`：一个 event 的位置替换关系 + 引用的 source-event 关系。
- `session_event_read`：一个 event 的完整 JSON + 可选邻居摘要。

关键性质（决定我们能否直接借用）：
- **授权基 = caller session 的 cwd**，且是 **exact-string cwd 相等**。跨 session 访问要求 target 与 caller 的 cwd 完全相同；无 cwd 的 caller 只能看自己。授权来自 `ToolExecution.exec.agent`，**从不由模型自报**。
- 结果 **cursor-free**：不暴露 cursor/offset/page-size，也没有模型可控 limit；结果超限就让模型收窄查询。
- 时间戳边界是带时区 ISO 8601 → 转成 inclusive epoch-ms 过滤。
- **opt-in**：shipped host 组合**不挂** `tool-session-query`（挂它会给每个请求加一段 guidance + 5 个 schema）。
- 配置：`maxSearchResults`（默认 100）、`searchTimeoutMs`（默认 30000）。

### 1.2 后端挂载现状（2026-09-10 第三轮纠错后，以此为准）
- harness `packages/bundle/base/cordis.patch.yml` 与 `web-app` **已挂 `session-query-sqlite` 模块**，但 shipped config 是 `path: ':memory:'` + **`openAt: never`**：exact read/filter/title/lineage trace 可用；**全文搜索默认关闭，SQLite 不导入、不打开，今天没有 FTS 索引**。
- provider 已实现 `first-search` 懒开启与 persisted/live corpus 的首次 reconciliation；Team bundle 可用后置 patch 改为 `first-search` + 专用 derived-index 路径，无需新索引实现或 schema migration。
- **`tool-session-query` 未进任何 shipped preset，也未进 Team 的 team-member preset**（已 grep 确认）。→ 查询模块与 provider 实现现成，但 **FTS 需显式启用、member 模型侧 interface 需 Team 自有**。

### 1.3 Team 现有 context 管理（Team 自有，`packages/agent-team/`）
harness **没有** rollover/checkpoint/timeline；这三者是 Team 自有（`context-management.ts` / `context-projection.ts` / `context-source.ts` + `tool-agent-team/src/context-tools.ts`）。CHANGELOG 0.1.9 落地。

- `context_checkpoint`：在**当前 turn 结束时**记一个命名的、私有的、可 restore 的锚点。
- `context_rollover`：结束当前 generation，作为同一 Member 进入新 generation；无 checkpointRef = 全新空上下文（只由 handoff 播种，默认最便宜路径）；带 checkpointRef = 返回某个 restorable 锚点。**从不回滚任何外部副作用**（文件/git/job/Team facts/browser）。
- `context_timeline`：列出**有界**的结构锚点（命名 checkpoint、Team 边界、handoff/compaction 边界、head），跨当前 generation 与已归档祖先；给出 retained/discarded token 估算与每个锚点带入的 Threads，并标注**哪些 restorable**。

**restorable 门控**（`index.ts:1806-1842`，保守策略）：
- 必须是完成的 turn 边界（`turnEndSeq !== -1`）。
- head 不可选（返回它不丢弃任何东西）。
- 成本无法度量 → 不可选（绝不把未知按 0 计价）。
- `handoff` / `compaction` source → 不可选（起新代/重写可见面，不是安全回返目标）。
- `team-boundary` → 仅当「turn 完成 且 恰好一个 Thread 的 facts 由此边界进入上下文」；多 Thread / 不可归属 → 不可选。
- `agent` / 可选 boundary → 仅当 retained < handoff 预算（否则不materially 缩小工作集）。

→ **穿越目标 = 一个有界的、预录/自动检测的锚点集，且全在自身 lineage 内。**

## 2. 缺口（human 的原话拆解）

> 「仍然无法去搜索session并选择任意节点"穿越"过去」

1. **无 member 侧会话搜索**：`tool-session-query` 未进 team-member preset。Member 现在只能靠 `context_timeline` 看**结构锚点**，无法**按内容全文搜索**自己过去的 events。
2. **穿越目标受限**：只能到预录 checkpoint / 自动检测边界（且被上面的门控大幅收窄），**不能选搜索命中的任意 event 节点**穿越过去。

## 3. 开放问题（需讨论/拍板，按优先级）

**Q1 授权/隐私模型（最高优先，卡死一切）**
所有 member session 都用 `cwd: workspacePath`（`index.ts:2138` 已核实）——**全员同 cwd**。若直接挂 `tool-session-query`，它的 exact-cwd 授权会让**任意 member 搜索/读取任意其他 member 的 session events**，直接违反 Team 隐私模型（member 私有记忆/推理不可互见）。
→ 决策点：member 搜索的可达范围是「仅自身 lineage」还是「跨 member」？若仅自身，需要在 cwd 之外加 **member 身份授权层**（Team 自有），不能裸用 harness 的 cwd 授权。

**Q2 「任意节点穿越」语义**
现有 restore 要求「完成的 turn 边界 + 可证预算 + 缩小工作集」。任意 mid-turn event 破坏「干净前缀」假设（可能落在 tool call 无 result、半个 turn 处）。
→ 决策点：穿越目标是「仅 turn 边界 event」还是「真正任意 event」？后者要定义如何裁剪出可重放的干净前缀。

**Q3 预算可证性与门控统一**
timeline 现在拒绝「成本不可度量 / 不缩小工作集」的锚点。一个搜索命中未必满足。
→ 决策点：搜索命中的穿越是否沿用同一套门控，还是另立规则（例如允许「放大」上下文的返回）。

**Q4 跨 generation / 跨 session**
搜索能达归档祖先（甚至 trace 到祖先链）；restore 现在只在自身 lineage。
→ 决策点：能否穿越到**归档祖先 generation** 里的节点？跨 session（非 lineage）是否允许（与 Q1 耦合）。

**Q5 分片顺序（我的倾向）**
「只读会话搜索」与「任意节点穿越」是两件难度差很大的事。建议**先只读搜索**（把 tool-session-query 以 Team 授权层包装后进 preset，范围先锁自身 lineage），拿到端到端价值；**再**攻「任意节点穿越」。
→ 决策点：是否接受这个拆分与顺序。

**Q6 与现有 checkpointRef 模型的关系**
穿越是「扩展 `context_rollover` 的 checkpointRef 接受一个 event 派生 ref」还是「新工具」？
→ 决策点：接口形态。

**Q7 外部副作用（约束，非问题）**
穿越与今天的 rollover 一样**绝不回滚**文件/git/job/Team facts。任何设计都必须保留这条，并在 handoff/落地节点让新上下文重新核验外部状态。

## 4. 可借用 vs 需自建（第二/三轮收敛后）
- **可直接借用**：`ctx.sessionQuery` interface + `session-query-sqlite` 的搜索/reconciliation 实现（shipped 默认关闭；Team patch 显式启用）。
- **需 Team 自建**：按 Member 自身 parentSession lineage 的授权、面向召回的深工具 interface、搜索命中到现有 checkpointRef 的映射。
- **不再需要**：任意 raw event 的新 restore engine 或前缀裁剪；human 已拍板穿越只复用 `context_rollover(checkpointRef)`。
- **红线**：不改 harness、不建第二套会话存储、穿越不回滚外部副作用、保守门控优先（宁可命中无 checkpointRef，也不给不可证的穿越）。

---

## 5. 第二轮（2026-09-10，human 收窄方向后）

### 5.1 human 的三点定调（thread:d0da83df 9763）
1. **Q1 拍板**：每个 member 只能搜自己的 session。human 记得「有个 session 字段有帮助」。
2. **Q2 大幅简化**：「穿越」就是现有 `context_rollover` → query 到 checkpoint → agent 自决去不去（= 回滚到过去锚点，和现在一样）。**不需要新的任意-raw-event restore 语义**。
3. 要求先调研 obelisk 项目（context as infra 参照）。

### 5.2 human 记得的「session 字段」= `parentSession`（已核实）
- rollover 建新 generation 时**确实设了** harness `SessionHeader.parentSession`（`index.ts:2140` `meta.parentSession: effectiveParent`），并在 `1402-1416/1493/1651-1659` 读它来走 lineage。
- 所以 member 的各 context generation 通过 **`parentSession` 链**串联；harness `session_trace`（祖先链 + 后代树）**已经能看到**这条链。
- 另有一条冗余的权威来源：Team ledger 的 rollover 操作（append-only，`previousSessionId/newSessionId` + `previousSessions` map + `rolloverSeeds` envelope），可重建 member→全部 generation 的绑定。
- → **「一个 member 的自身历史」= 它的 parentSession lineage**（等价于 ledger 里该 member 的 generation 链）。

### 5.3 Q1 授权的正解（已收敛）
- 全员 member session 同 `cwd`，harness session-query 只按 **exact-cwd** 授权 → cwd 不足以隔离 member。
- 正解：**按自身 parentSession lineage 限定可达范围**（Team 侧再加一层 lineage-ownership 过滤，cwd 授权是必要非充分）。member 只能搜到/trace 到自己 lineage 内的 session。

### 5.4 Q2 收窄后的设计形态（已收敛）
穿越 = 复用现有 `context_rollover(checkpointRef)`，**不新增 restore 路径**。真正缺的是「**发现**要穿越到哪个锚点」：
- `context_timeline` 已跨「当前 generation + 归档祖先」，但它是**结构性**的（无正文），且只列有界锚点。
- 缺全文**搜索**：按内容找到过去某个时刻 → 定位到其所在（或最近的）**restorable checkpoint / 源 session+through-seq** → 交给 `context_rollover`。
- 因此桥梁 = 「搜索命中 → 映射到可穿越锚点」。这落在 §3-Q6 的接口选择上：搜索结果直接携带可用的 checkpointRef，或让 timeline 支持按 lineage 全文过滤。

### 5.5 obelisk 调研（AGPL，github.com/tommy0103/obelisk）——概念参照，非可依赖组件
- **形态**：跨 provider（Claude/Codex/Kimi/Pi/**DeepSeek Harness `~/.dsh/sessions`**）统一 SQLite **FTS5** 索引；agent 侧写 JS/SQL query（`search()/context()/sql()` + `sessions/memories/summaries/workflows/failures/fileHistory` helper）本地跑、自然语言作答；人类侧 Electron app 浏览/统计/recap。
- **记忆层**：检索出结论 → agent 提议 markdown memory 文件 → 用户批准后 `--attune` 注册 → 未来 `memories()` 召回（「synthesis cache，不替代 raw 证据」）。与我们 member 私有 memory/notes 思路同源。
- **值得借鉴的点**：① 「agent 写查询 + 人类浏览」共享一个索引的双面设计；② 索引增量重建；③ 「transcript 是攻击者可控」的 deny-by-default 安全立场（对我们把 session 正文喂回模型同样成立）。
- **不适配/须区分**：obelisk 是**独立进程 + 全局 `~/.obelisk` 库 + 跨 provider**，跨会话无隔离；我们要的是**单 host 内、按 member lineage 严格隔离**的能力，且**红线是复用 harness `ctx.sessionQuery`（已挂 FTS 后端），不另起一套存储**。obelisk 只作产品形态与安全立场的参照。

---

## 6. 第三轮（2026-09-10，human 拍板接口形态后的交互模型调研）

### 6.1 human 的定调（thread:d0da83df 9774）
1. 接口形态：**前者**——搜索结果直接携带 checkpointRef；tool description 负责教这个用法。
2. **先把搜索做好**：穿越不是目的、只是附加（搜到 ref 可去 rollover）。核心愿景 = **session as context infra**：member 自己过去的经历可以被自己找回、召回。
3. 深入调研题：**是否让 member agent 写 py/js/ts 脚本去搜？还是别的交互方式？** 要切身处地从 member 视角想。

### 6.2 服务能力核实（决定选项上限，零 harness 改动的前提下）
`ctx.sessionQuery` 的过滤器面（`session-query/src/types.ts`，已实读）：
- session 过滤：`id`、`cwd`、`created-at` 区间、**`parent`**、`availability`（live/persisted）。过滤器数组 AND，子句内 OR。
- event 过滤：`seq` 区间、`time` 区间、`type`、`surface`（current/shadowed/log-only）、`text`（字面扫描）。
- 两种搜索：跨 session（`SessionSearchRequest`）与单 session 内（`SessionEventSearchRequest`）；query 一律**作为数据解释，绝不作为可执行 FTS 语法**。
- 命中：跨 session 按最强命中 event 分组；单 session 命中带 plain-text excerpt 片段。
- **关键**：`id` 过滤器 + Team 侧先算 lineage ⇒ 可在**服务边界**强制「仅自身 lineage」（每次调用都带 `sessionFilters: [{kind:'id', values: <该 member 全部 generation 的 session id>}]`），授权可证、可测试。

### 6.3 交互模型三选项，从 member 的座位上想

member 需要找回过去的真实场景（切身处地）：
1. 「我之前对 X 的结论是什么？」——手里有关键词（task ref、文件名、报错串、某个短语）→ **字面搜索 + 片段 + 下钻**即可。
2. 「我们当时在哪一步拍板 Y？」——同上，搜索 → 命中 → 读邻域。
3. 「task Z 我动过哪些文件？」——搜 Z → 多命中翻页 → read。
4. 「把所有 session 里的失败 tool call 聚合统计」——**这才是脚本的主场**，但这是分析不是找回；human 的原话是「经历被找回、召回」= **检索，不是计算**。

**选项 A：窄声明式工具**（沿 tool-session-query 已验证的阶梯：跨库搜索 → 单 session event 搜索 → 读 event/邻域）
- member 视角：一次调用即得排名+片段；两三步内回答上面 1-3。学习成本≈零（与我们五工具的 decision-interface 设计语言一致）。
- 授权：lineage 在服务边界强制，模型不可越权（模型自报的 session id 在 lineage 外即 typed rejection）。
- 缺点：query 是单字面量，无 FTS 布尔组合；复杂结构化召回要多次调用人工取交集。

**选项 B：member 写 JS/TS（或 py）查询脚本**（obelisk 式）
- member 视角：表达力天花板高（组合过滤、跨 session join、自定义排序），一次脚本答复杂问题。
- 真实成本：① 沙箱执行面——harness `code-runtime`（worker-thread TS / Python 子进程）是给 PTC `run_code` 的，**没有暴露 sessionQuery 的 binding**，加 binding = 新 harness 表面（或 Team 自建 binding 接缝，需自行保证 lineage 注入，脚本不可信）；② 资源/DoS 界限、结果渲染、调试迭代成本；③ 我们的红线「不改 harness」与「Team 工具保持窄面」直接相抵。
- obelisk 选脚本 fits **它的**语境（一个人的全机语料、独立进程、无多租户隔离）；我们的语境（单 host、多 member 严格隔离、进程内服务）fits 窄工具。抄它的交互模型会把它的安全模型一起抄进来。

**选项 A+（我的推荐）**：窄声明式工具 + Host 组合的结构化过滤
- 工具参数暴露服务的结构化过滤（时间区间、event type、surface），**由 Host 组合**，不暴露 cursor/limit/offset（沿 tool-session-query 的 cursor-free 哲学）。
- 每次调用服务端强制 lineage id 过滤；tool description 教「召回阶梯 + 命中可喂 context_rollover（带 ref）」。
- **脚本式查询明确不做**；只有真实使用反复出现「多次搜索人工取交集」的表达力天花板（例如成员频繁手动做两词交集、跨 session 聚合）才重新讨论。届时走 harness code-runtime + lineage-scoped binding 的公开扩展点，而不是 Team 私搭。

### 6.4 附带核实事项（写 spec 前要锁）
- 归档（rollover 退役）的 member session 在 corpus 中的 availability：应为 persisted 且仍被索引（`SessionRecord.persisted` 字段），spec 阶段用实测锁死。
- `session_event_search` 对 caller 当前 session 的截断语义（停在调用 step 前）对 member 检索自身当前代同样适用，spec 时确认包装层是否需要显式说明。
