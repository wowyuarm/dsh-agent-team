# Session Trace Context Analysis

状态：active — 研究与交接阶段，尚未实现脚本

最后核对：2026-09-01

## 当前范围

为后续在 `scripts/` 下实现一个离线 Session trace context provider 做准备。它的职责是从 DSH 的 canonical Session event log 中逐步提取准确、可回溯、有界的上下文，供另一个 Agent 继续分析 Team tools 的实际行为。

当前明确的边界：

1. 第一阶段只关注 Session trace，不读取或关联 Team ledger、Inbox、Thread、Task、Claim 等 Team projection。
2. 输出事实和导航信息，不直接判断 Team tools 是否有效，也不生成“成功/失败”“协作有益/有害”等结论。
3. 采用渐进式读取：先给 Session 元信息和轻量事件索引，再由调用方按 `seq`、`turn`、`step` 或事件类型主动展开局部事件。
4. 保留 `sessionId`、`seq`、`type`、`time` 等来源定位信息；任何派生字段都必须标明是派生结果，不能冒充 canonical event。
5. 优先借鉴 Harness `session-query` 的 exact read、bounded window、surface classification 和 source relationship 语义；不直接照搬其模型工具层或 workspace authorization。

## 暂缓范围

- Team ledger 读取、跨 Session Team operation 关联和协作因果图；
- 自动评测、评分、A/B 比较、工具价值结论；
- 修改 `../deepseek-harness`；
- 为了脚本新增运行时 telemetry 或 Session event；
- 在没有确认读取方式前复制 Harness 私有 JSONL/SQLite 实现；
- 把 Harness 的 `session_trace`（parent/child lineage）误当成本项目首要的事件时间线。

## 文档入口

- [`spec.md`](spec.md)：讨论汇总、Harness 调研、需求、建议架构、候选读取方案、渐进式接口和未决问题。

## 当前前沿

**2026-09-01 spike 结论（Vera，方案 A 已验证可行）**：最小 Cordis composition（`SessionStore` + `JsonlSessionPersistence({root: $DSH_HOME/sessions})` + 一个只抛错的 `SessionQueryEngine` 子类）即可在离线脚本中完整复用 exact read 家族——`listSessions` / `readSession` / `listEvents` / `filterEvents` / `readEvent`，全程零 FTS、零 live session、零写入。实测（126 个真实 Session、34 个 team-member）：

- `listSessions()` 134ms；`listEvents()` 对 21771 事件 236ms；`readSession()` 全量 replay-validation 943ms。
- packed chunks / zstd 解码 / seq 连续性 / surface 分类（current/shadowed/log-only）全部由 Harness 定义，脚本零格式代码。
- `readEvent` 返回 `startSeq/endSeq` 窗口语义；`SESSION_QUERY_EVENT_NOT_FOUND` 结构化错误可直接透传。
- 注意：`SessionEventRecord` **不含** `toolName`（`listEvents` 只有 sessionId/seq/type/time/surface）；tool 名在 raw `tool/call` 的 `data.name`（含 `turn/step/callId/arguments`），配对键是 `tool/call.data.callId` ↔ `tool/result.data.message.source.callId`。team-tool 导航因此需要 provider-independent 的 `filterEvents({kind:'type',values:['tool/call']})` + 派生字段提取（spec §5.2 的 derived navigation fields 正好覆盖）。`filterEvents` 的 filter 词表只有 `seq/time/type/surface/text`，无 toolName kind。
- 运行方式：需 `tsx`（或等价 TS loader）从 harness checkout 以绝对路径 import `vendor/cordis`、`packages/core/session`、`packages/session/session-persistence-jsonl`、`packages/session-query/session-query` 的 src（pnpm workspace 的包内 node_modules 才有完整 symlink 图，examples/ 顶层不全）。

**结论：采用方案 A。** 方案 B（直接用 `SessionPersistence` API）已无必要——A 的 composition 就是三个 `ctx.plugin()` 调用；方案 C 不需要。第一版 backend 承诺：JSONL/Zstandard（SQLite Session persistence 理论上同 API 可挂，留待需要时验证）。

后续实现要点：CLI 形状按 spec §9；timeline 的 `turn/step/callId/toolName` 作为 derived fields 从 raw event 提取；默认不展开正文（`filterEvents` 的 search document `text` 会展开语义文本，timeline 应基于 `listEvents` + 局部 `readEvent` 而非 search documents）。

## 结束条件

1. 后续 Agent 根据 `spec.md` 确认第一版输入 backend、CLI 形状和输出 contract。
2. 明确 canonical Session reader 的复用路径，并验证 `.jsonl.zstd`、packed chunks、seq 连续性和损坏日志的处理语义。
3. 实现渐进式读取与来源定位，至少覆盖 Session 列表、轻量 timeline 和有界 exact event read。
4. 测试证明默认输出不会展开大段正文，显式展开时不会静默截断或丢失来源信息。
5. 若行为或工作流成为长期稳定契约，再将结论迁移到 `docs/`；本目录始终只是工作交接资料，不是实现或 API 权威。
