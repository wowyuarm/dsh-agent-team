# Session Trace Context Provider：讨论与调研汇总

状态：proposal / handoff

最后核对：2026-09-01

> 本文是交给后续 Agent 的研究和设计快照，不是当前实现规范，也不改变 `packages/`、测试、`docs/` 或 Harness 的行为。实现前必须重新核对源码和当前 Harness contract。

## 1. 背景与实际需求

最初的目标是“在 `scripts/` 写一个脚本，提取 Sessions、分析 trace，用它评判 Team tools”。讨论后需求已经收敛：脚本不应该替调用方做最终评测，而应该提供**准确、详细、可逐步展开的 Session trace context**，由调用它的 Agent 继续分析。

我们现在真正需要观察的是 Member Session 中发生了什么，例如：

- 每个 `turn`、`step` 的边界和顺序；
- 模型发出了哪些 `tool/call`，调用了什么工具，原始 arguments 是什么；
- 每个调用是否有对应的 `tool/result`，结果如何返回，是否带 error/meta；
- Team notification 或其他注入是以什么 `user/message` 进入模型上下文的；
- `request/header` 中当时可见的 system prompt、tool schemas、model route 是什么；
- assistant 输出、token usage、取消、中断、失败和重试的原始记录；
- 必要时，某个事件前后的有限上下文、surface 状态和 source/replacement 关系。

这些事实足以让另一个 Agent 研究 Team tool 的调用策略、摩擦点和行为效果，但脚本本身不应据此自动宣布“工具有效”或“工具无效”。

## 2. 已确认的用户要求

以下是当前讨论中已经明确的要求：

1. **只关注 Session trace。** 第一阶段不需要 Team ledger，也不需要把 Session event 与 Team operation、Thread、Claim 或 Inbox projection 关联起来。
2. **渐进式提供 context。** 不要第一次调用就暴露整份 Session、所有 tool arguments、所有 tool results 或全部历史正文。
3. **调用方 Agent 负责额外分析。** 脚本输出是证据和导航，不是可信的最终解释；调用方必须能根据 `sessionId + seq` 回查原始事件。
4. **准确优先。** 不能为了好看的摘要丢失 seq、事件类型、时间、原始 payload 或截断边界；不能把缺失事件静默当作“不存在”。
5. **先研究 Harness 已有能力。** DSH 已经有 Session search/query plugin，应尽量借鉴其 exact read、trace、bounded window 和错误语义，避免重复实现不兼容的读取器。
6. **当前先写交接资料，不直接实现脚本。** 本 work item 只保存讨论、调研和候选设计。

## 3. 当前项目事实

### 3.1 本项目边界

根据本仓库的 `AGENTS.md`、`docs/architecture.md` 和 `docs/harness-navigation.md`：

- `packages/agent-team` 是 Team Host、ledger、projection 和 Member lifecycle 的 authority；
- `packages/tool-agent-team` 提供五个模型可见 Team tools：`team_inbox`、`team_thread`、`team_message`、`team_claim`、`team_view`；
- Team tools 只在显式 `team-member` preset 中出现，普通 DSH Session 不应获得 Team guidance 或 Team tools；
- Team ledger 是 Team facts 的唯一持久 authority，但本 work item **不读取它**；
- 外部 bundle 不应为了普通 Team 工作修改 `../deepseek-harness`、Agent loop 或 shipped defaults。

因此，trace provider 第一阶段只把 Team tool 当成普通 Session event 中的工具调用名称来观察。它可以允许按工具名筛选或定位 `team_` 前缀，但不能自行解释 Team ledger 语义，也不应把工具结果重建成第二套 Team authority。

### 3.2 当前 Session 存储观察

当前本地 DSH home 中可以看到类似：

```text
$DSH_HOME/sessions/<project-key>/<session-id>/session.jsonl.zstd
```

也存在 `agent_team.sqlite`，但它属于 Team ledger，第一阶段明确不纳入读取范围。Session backend 可能随部署变化：当前实际环境以 JSONL/Zstandard 为主，Harness 也提供 SQLite Session persistence。因此脚本不能在输出中无依据地声称“支持所有 Session backend”。

### 3.3 Canonical Session event vocabulary

Harness `@deepseek-ai/dsh-session` 当前的核心 event 包括：

- `turn/start`、`turn/end`；
- `step/start`、`step/end`；
- `user/message`；
- `assistant/chunk`、`assistant/message`；
- `tool/call`、`tool/result`；
- `todo/write`；
- `request/header`、`request/context`；
- `session/end-seed`；
- 以及通过可扩展 `SessionEventMap` 合并的其他 event type。

`SessionEvent` 的 canonical 定位字段是 `seq`、`time`、`type`、`data`，此外可能有 `ignorable`、`sourceEventSeqs` 和 `surfaceOp`。`tool/call` 的 data 包含 `callId`、工具 `name` 和模型原样生成的 JSON `arguments`；`tool/result` 用对应调用身份表达模型可见结果，并可能含 `error` 和 tool-owned `meta`。

`request/header` 是下一次请求的完整 snapshot，可能包含 system prompt 和 tool schemas；它是 log-only event，不应和 message surface 混为一谈。`assistant/message` 可带 `usage` 和 `interrupted`。

这些是事件结构事实，不等于脚本应该在第一层默认展开它们的全部正文。

## 4. Harness `session-query` 调研结论

调研的主要文件：

- `../deepseek-harness/docs/subsystems/session-query.md`
- `../deepseek-harness/packages/session-query/session-query/README.md`
- `../deepseek-harness/packages/session-query/session-query/src/types.ts`
- `../deepseek-harness/packages/session-query/session-query/src/index.ts`
- `../deepseek-harness/packages/session-query/session-query/src/tracing.ts`
- `../deepseek-harness/packages/session-query/session-query/src/documents.ts`
- `../deepseek-harness/packages/session-query/tool-session-query/README.md`
- `../deepseek-harness/packages/session-query/tool-session-query/src/operations.ts`
- `../deepseek-harness/packages/session-query/tool-session-query/src/presentation.ts`
- `../deepseek-harness/packages/session-query/session-query-sqlite/README.md`

### 4.1 它不是单纯的全文搜索

`@deepseek-ai/dsh-session-query` 是一个统一的 Session retrieval family，包含：

- logical session listing；
- 完整 raw log read；
- 轻量事件记录；
- current model surface read；
- bounded exact event read；
- event relationship trace；
- parent/child lineage trace；
- provider-independent event filter；
- 可选 backend 提供的 full-text search。

核心启发是：**事实读取、导航索引和全文搜索应该分层**。搜索是定位入口，不应该取代 exact read，也不应该成为 trace provider 自己的判断层。

### 4.2 可直接借鉴的数据语义

Harness 的轻量 `SessionEventRecord` 只有：

```text
sessionId / seq / type / time / surface
```

其中 `surface` 区分：

- `current`：当前模型 surface 中的 event；
- `shadowed`：曾进入 surface、后来被 replacement 替换的 event；
- `log-only`：只在 raw log 中存在，不进入当前模型 surface 的 event。

`readEvent({ sessionId, seq, before, after })` 返回一个完整 target 和有限 raw-event window，并携带 `startSeq`、`endSeq`。这是渐进式 context 的直接模板：调用方先拿索引，再明确请求少量 raw events。

`traceEvent({ sessionId, seq })` 返回机械关系：

- `replacedBy`；
- `replacementChain`；
- `replacedEventSeqs`；
- `sourceEventSeqs`；
- `derivedEventSeqs`。

这些关系可以作为后续增强，但它们仍是事件结构关系，不是语义结论。

`readSurface()` 返回完整当前 model surface，适合在调用方明确要求“模型当时看到的当前内容”时使用；它不应成为普通 timeline 的默认输出。

### 4.3 必须区分两种 “trace”

Harness 的 `session_trace` 模型工具主要对应 `traceSession()`：追踪 Session 的 `parentSession` 和递归 descendants，是**Session lineage**。

我们当前推荐的“session trace”则是**Session event timeline**：按 raw event 顺序观察 turn、step、模型输出和 tool execution。两者不能混名：

- 首版核心应是 event timeline；
- 若将来支持 lineage，应使用明确的 `lineage`/`parent-child` 命名；
- `traceEvent` 只应在调用方指定 seq 后展开单个事件关系。

### 4.4 模型工具层不应原样复用

`@deepseek-ai/dsh-tool-session-query` 在 `session-query` 之上做了：

- workspace authorization；
- caller/self 排除；
- search result collection 和 cap；
- text presentation；
- tool schema 和 system guidance；
- optional spill policy integration。

这些是模型消费层职责，不是本地离线分析脚本的必要组成。我们可以借鉴其“search → exact read/trace”的使用路径，但不要把它的 plain-text presentation 当成 canonical data，也不要让脚本因为没有命中就生成结论。

### 4.5 Search backend 不是 canonical authority

`@deepseek-ai/dsh-session-query-sqlite` 的 SQLite FTS5 是 derived index。它负责全文索引的 reconciliation、ranking、snippet、cursor generation；exact reads 和 surface/tracing 仍属于统一 query service 的语义。

因此后续脚本如果加入 search：

- search 只能做导航；
- 命中结果必须能回到 `sessionId + seq`；
- 不应直接把 FTS index 当成 Session log；
- cursor、index generation、source availability 必须明确暴露或在输出里说明；
- search 不应替代 raw event read。

## 5. 建议的第一版目标

### 5.1 角色定位

脚本应被视为：

> 一个只读、离线、Session-only、渐进式的 context provider；它暴露 canonical event 的导航和局部读取能力，调用方 Agent 负责解释和评判。

它不是：

- Team metrics dashboard；
- 自动 trace classifier；
- Team ledger inspector；
- 永久 telemetry collector；
- 会把所有事件压缩成一个“看起来完整”的摘要器。

### 5.2 建议的读取层次

下面是建议的概念接口，命令名仍待后续 Agent 确认：

#### Level 0：Session listing

提供 Session header 和可用于选择目标的最小元信息：

- `sessionId`；
- `createdAt`；
- `cwd`；
- `parentSession`（如果有）；
- `origin`、`delegationDepth`、`agentPreset`（如果有）；
- source/backend availability；
- 是否能读取、读取失败的结构化诊断（不能把失败伪装成空列表）。

不加载所有 event body。

#### Level 1：Event timeline/index

对一个 Session 返回有界、轻量的 event rows：

```text
sessionId, seq, time, type, surface, turn?, step?, callId?, toolName?
```

其中 `turn`、`step`、`callId`、`toolName` 是从 canonical event data 提取的机械索引字段；如果某个事件没有该字段则省略，不应猜测。

默认不返回：

- message 正文；
- tool arguments；
- tool result body；
- system prompt；
- 完整 tool schemas；
- assistant token chunks。

timeline 必须有 `limit`、明确的 seq 范围、`truncated`/`next` 或等价 continuation 信息。

#### Level 2：Bounded event window

调用方用指定的 `seq` 或范围展开局部事件，类似 Harness `readEvent(before, after)`：

- 返回 target 或范围内的 canonical event；
- 允许 `before`、`after` 或 `fromSeq`/`toSeq`；
- 有硬上限；
- 返回实际 `startSeq`、`endSeq`；
- 若存在未包含的相邻事件，明确说明，不输出“完整 trace”的措辞。

这是分析 `tool/call` 后面紧邻的 `tool/result`、某个 notification 前后的 `step`、或某次 request/header 变化的主要入口。

#### Level 3：Exact event

调用方明确指定 `sessionId + seq` 时，返回该 event 的 canonical payload。建议默认仍以 JSON 结构返回，不转写成解释性 prose。

`tool/call`、`tool/result`、`user/message`、`assistant/message` 和 `request/header` 可能含大量正文或敏感数据，因此 exact read 必须是显式 drill-down，而不是 timeline 的隐式内容。

#### Level 4：可选的机械关系 / surface

后续可按需提供：

- `event relationship`：借鉴 `traceEvent`；
- `surface`：返回当前 model surface；
- `lineage`：明确作为 parent/child Session 关系，不混入 event timeline；
- literal search：仅用于定位，命中后仍回到 exact read。

这些不应阻塞最小可用的 listing、timeline 和 bounded event read。

### 5.3 推荐的 Agent 使用流程

```text
1. list：找到候选 Session，确认 cwd / agentPreset / availability
2. timeline：获取有界事件索引，不展开正文
3. 按 type/toolName/turn/step/callId 定位感兴趣 seq
4. bounded read：读取目标前后有限事件
5. exact event：只展开必要的 tool/call、tool/result、message 或 request/header
6. 可选 relationship/surface：确认 replacement/source 或模型当前 surface
7. Agent 自己结合多段证据分析，不把脚本摘要当结论
```

对于 Team tools，调用方可以先按 `toolName` 找 `team_inbox`、`team_thread`、`team_message`、`team_claim`、`team_view`，再读取对应的 `tool/call` 和 `tool/result`。脚本不需要也不应该凭 Session trace 推导 Thread revision、unread authority 或 Claim state。

## 6. 输出 contract 的关键要求

### 6.1 来源可回溯

每个 event 相关结果必须带：

- `sessionId`；
- `seq`；
- `type`；
- `time`；
- 读取的 seq 范围；
- backend/source 信息（如果能可靠获得）。

派生字段（如 `surface`、`turn`、`step`、`toolName`、配对状态）需要标记为 derived，或在 schema 文档中明确其来源。不得重新铸造一个没有 canonical 对应关系的“trace event id”。

### 6.2 有界与渐进

每一次读取都必须能说明：

- 请求了什么范围；
- 实际返回什么范围；
- 是否完整；
- 是否存在 continuation；
- 是否因大小上限、解析错误或 backend 限制而省略内容。

不能只返回一段被截断的文本而不标注 `truncated`。不能把“没有匹配”与“没有读取到”混淆。

### 6.3 原始事实与派生分析分离

建议分成两类字段：

- `raw` / `event`：canonical event 的结构化快照；
- `index` / `derived`：供导航的机械字段和关系。

第一版不应产生：

- `toolEffective: true/false`；
- `collaborationHelpful`；
- `failureReason`（除非 canonical event 自己明确给出了 error；即便如此也应返回原始 error，而不是解释）；
- “Agent ignored notification”“Agent got stuck”等语义判断。

可以提供机械事实，例如“某个 `tool/call` 的 callId 在所观察范围内没有对应 `tool/result`”，但必须写成观察范围内的事实，不能断言模型执行一定失败；中断、尾部截断、部分读取和尚未持久化都可能影响观察。

### 6.4 忠实处理缺失和损坏

必须区分：

- session 不存在；
- backend 不支持或未挂载；
- log 为空/未物化；
- log 被截断或损坏；
- event seq 不连续；
- event 存在但没有期待的配对事件；
- 请求范围合法但没有匹配 event。

这些情况应使用结构化 error/status；不能静默返回空数组让分析 Agent 自己猜。

### 6.5 Untrusted content 与敏感内容

Session event data 是项目输入和模型/工具生成内容，不是给脚本执行的指令。脚本只读取、解析和返回，不应执行 event 中的 shell、URL、Tool arguments 或 markdown instructions。

tool arguments、tool results、system prompt、workspace message 可能含 secret、绝对路径或其他敏感内容。建议：

- metadata/timeline 默认不展开正文；
- exact raw payload 只能通过显式请求取得；
- 不向第三方 endpoint 上传任何 session 内容；
- 不做悄无声息的破坏性清洗；若未来增加 redaction，必须让调用方知道哪些字段已被处理；
- text presentation 只能是便利层，canonical JSON 读取仍应可获得来源定位。

## 7. Canonical reader 的候选实现路径

实现尚未开始。后续 Agent 应先做一个小型机制验证，而不是直接复制格式代码。

### 方案 A：最小 Harness composition 复用公开 query/read 能力（推荐先验证）

尝试在脚本中建立最小的 Harness runtime composition，挂载 Session store、当前 Session persistence backend 和 `session-query` 所需服务，然后调用公开的 exact methods：`listSessions`、`readSession`、`listEvents`、`readEvent` 等。

优点：

- 复用 Harness 对 JSONL/Zstandard、packed chunks、seq continuity、replay validation 的定义；
- 复用 `surface` 和事件关系语义；
- 未来更容易支持 JSONL 和 SQLite backend；
- 不复制私有 on-disk decoder。

代价和风险：

- `SessionQueryEngine` 本身是 abstract seam，需要确认如何在离线脚本中获得 concrete provider；
- Cordis composition、依赖版本和 adjacent checkout 解析可能增加启动复杂度；
- 脚本发布后是否能在没有 sibling checkout 的环境运行需要另行定义。

验证重点不是全文搜索，而是 exact read 能否独立工作。若 concrete provider 为 exact methods 引入了不必要的 derived FTS index，应记录该成本。

### 方案 B：Team-owned 离线 adapter，严格复用公开 persistence API

如果方案 A 不适合 CLI，尝试直接挂载/调用 Harness 的公开 `SessionPersistence` API，让 backend 提供 `list`、`inspect`、`readFrom` 或等价的读取能力；Team 脚本只做渐进式 projection。

优点：比重建 Cordis query service 更轻，仍可避免自己解压和解释 JSONL。

风险：需要确认 persistence service 的构造和公开 API 是否适用于离线调用；必须保证读取语义与 live/resume 一致。

### 方案 C：独立复制 JSONL/Zstandard reader（不推荐作为起点）

直接扫描 `$DSH_HOME/sessions` 并复制 Harness 的 format/zstd 逻辑。

只有在公开 composition/API 无法用于离线脚本时才考虑。它的主要风险是：

- packed chunk 解码、格式版本、torn tail、repair、surface validation 可能与 Harness 漂移；
- 一旦 DSH 更新，脚本可能产生“看似能读、实际误读”的结果；
- 复制私有实现会形成第二个 Session authority。

若最终不得不采用，必须把支持的 `SESSION_FORMAT_VERSION`、compression、损坏处理和兼容范围显式写在输出中，并加入与 Harness fixture 的 golden tests；不能默默声称 backend-neutral。

### 当前推荐顺序

```text
先验证 A → 不适合时验证 B → 只有明确记录限制后才考虑 C
```

## 8. Backend 范围建议

当前实际环境主要观察到 `.jsonl.zstd` Session artifacts，因此第一版可以优先把 JSONL/Zstandard 做成真实验证目标，但接口应抽象为 backend-neutral，并且输出明确声明 source/backend。

SQLite Session persistence 是否在第一版支持仍是未决项：

- 如果方案 A/B 能通过公开 persistence API 读取 SQLite，支持它会更自然；
- 如果只能写 JSONL file walker，不应把 SQLite sessions 当成可读；
- 不应读取 Team 的 `agent_team.sqlite` 来“补全” Session trace；那属于明确排除的另一域。

最小第一版宁可只支持已验证的 JSONL/Zstandard，也不要用 fallback 路径把未支持 backend 伪装成空结果。

## 9. 可能的 CLI 形状（待确认）

这是交接用候选，不是已经批准的 API：

```text
list       列出可选 Session header
 timeline  输出一个 Session 的有界轻量 event index
 read      读取指定 seq 周围的 bounded canonical events
 event     读取指定 seq 的 exact canonical event
 relation  可选：读取一个 event 的 replacement/source relationships
 surface   可选：读取当前 model surface
 search    可选：literal/semantic 定位入口，结果必须能回到 seq
```

可考虑的通用参数：

```text
--home <path>          DSH_HOME；默认使用 DSH 的标准 home resolution
--session <id>         指定 Session；不应接受模糊 id 后静默选错
--workspace <path>     按 header.cwd 过滤
--from-seq <n>
--to-seq <n>
--before <n>
--after <n>
--limit <n>
--format json|text     Agent 默认更适合 json；text 只是人读便利层
--include-body         显式请求可展开正文；名称和语义待确认
```

第一版 output 更适合 JSON，因为调用方可以可靠地看到范围、状态和来源；text 可以渲染同一份结构化结果，但不能成为唯一格式。

## 10. 评测用途与非目标

未来分析 Agent 可以基于多个 Session 的 trace 自己研究：

- Team tool 是否被模型发现、调用和继续使用；
- `team_inbox`、`team_thread`、`team_claim`、`team_message`、`team_view` 的调用顺序和上下文；
- tool result 后是否产生后续行动；
- unread/revision 等结果是否导致再次 read/retry；
- 是否出现重复调用、长等待、取消、错误或循环；
- Team preset 的 tool schema/prompt 是否在 `request/header` 中确实可见。

但这些是调用方的分析问题。Session trace provider 不应：

- 从 tool name 推断 Team state；
- 用 Team ledger 的 projection 替换 event payload；
- 按调用次数给工具打分；
- 仅凭缺少 `tool/result` 判定工具失败；
- 仅凭 event time 判定因果；
- 将 session header 的 `agentPreset` 当成完整 Team Member identity authority。

## 11. 未决问题清单

交给后续 Agent 逐项确认：

1. 最小 Harness composition 是否能在脚本中直接复用 `session-query` exact read，而不强制建立不需要的 FTS index？
2. 如果使用 `session-query`，具体 concrete provider、Cordis boot 和 persistence mounting 方式是什么？
3. 第一版是否只承诺 JSONL/Zstandard，还是同时验证 SQLite Session persistence？
4. `timeline` 是否默认执行 `foldSurface()` 并提供 `surface`，还是先只返回 raw metadata？建议借鉴 Harness，但需测量 validation 成本和损坏语义。
5. 是否需要先实现 literal `search`，还是 `timeline` + type/toolName filter 已足够导航？
6. 是否将 `turn`、`step`、`callId`、`toolName` 放在轻量 index 中？建议放入，但明确它们是从 event data 提取的 derived navigation fields。
7. 默认 `limit`、最大窗口、输出字节上限如何设置？必须有 hard cap，并把 truncation/continuation 作为 contract。
8. exact event 的敏感字段如何处理？默认隐藏与显式 raw read 的边界需要后续 Agent 结合本地使用场景确认。
9. 是否需要对多个 Session 并行读取？如果支持，必须保持每个 Session 的 source、失败和截断状态互相隔离，不用一个失败吞掉全部结果。
10. 是否需要将这套读取能力作为通用 library 暴露给测试，而不只作为 CLI？若需要，应先定义单一 projection authority，避免 CLI 和库各自解析事件。

## 12. 交接给其他 Agent 的建议顺序

1. 阅读本文件和 `.scratch/README.md`，再重新检查 Harness `session-query` 当前源码；不要把本文件当作 API 权威。
2. 做一个只读的 composition spike：只验证 `list/read/listEvents/readEvent`，不接 Team ledger，不做评测。
3. 用现有真实 `.jsonl.zstd` Session 和一个小型 fixture 检查 packed chunks、tool call/result、request/header、interrupted turn、seq gap/corruption 的行为。
4. 根据 spike 结果确定 A/B/C reader 路线和 backend 支持声明。
5. 再写实现 plan，先完成 listing + timeline + bounded read；关系、surface、search 作为可独立验证的后续层。
6. 为每一层补测试：范围边界、空 Session、错误/截断、未配对 tool call、敏感正文默认不展开、输出可回溯到 canonical seq。
7. 最后才考虑是否需要更新 `docs/development.md` 或 package README；长期稳定 contract 不应只留在 `.scratch`。

## 13. 研究结论摘要

最重要的结论只有四条：

1. **首要产物不是 evaluator，而是 evidence navigator。**
2. **首要 trace 是 event timeline，不是 parent/child lineage。**
3. **首要接口是轻量 index → bounded window → exact event，全文 search 只是定位入口。**
4. **Session log 是第一阶段唯一事实源；Team ledger 暂时完全排除。**
