# materials 上游机制摘要（2026-09-10 核验）

供本工作项长期引用的上游事实，均已在 dsh `dsh-v0.1.5-rc.1` tag 逐条读过源码；引用时给结论不给行号（行号易过期，文件路径稳定）。

## 读取准入链（为什么读时拦截兼容不可能）

- `packages/session/session-format-v2-to-v3/src/payload.ts`：`SOURCE_KINDS` 为封闭白名单（15 项，含上游自用的 `team-message`，无第三方自定义入口）。`user/message` 事件的 source kind 不在表内 → `SessionFormatUnsupportedMigrationError('cannot safely transform unclassified message source')`。目录注释明言 "independent of mounted plugins"——拒绝发生在插件挂载之前。
- `packages/session/session-format-v1-to-v2/src/migration.ts`：`turn/start` 未闭合上一 turn → 同类拒绝（E 类来源）。
- `packages/session/session-persistence-jsonl/src/format.ts`：v3 逐行读走 `assertV3RowAdmission`（结构性校验），注释明确该层 "不解释 log relationships"——**这是 E 类可以走 v3 兄弟恢复可读性的机制支点**（turn 闭合检查只存在于 v1→v2 迁移审计，不在 v3 逐行准入）。
- `session-persistence-jsonl`：同一 session id 下存在 `session.v3.jsonl.zstd` 时**优先读取**；选中代已是当前版本则直接读、不再走升级链。
- `packages/session/session-query/`（search 基础）：`cold-read.ts` 走同一条 `persistence.open` 门——被拒 session 在 search 面同样不可见。

## 写入侧（v3 兄弟的合法性与边界）

- v3 是当前版本格式：写入需过 `assertV3EventAdmission`（结构性）+ encoder。B 类改写后的形状即 master `5dd6373` 现在写的 `plugin` + `form:'snapshot'` + 具名 `sections`。
- `system/message` 要求 source.kind === 'plugin' 且 `plugin` 名非空字符串；`user/message` 的 source 只要 kind 在白名单内，`plugin` kind 无额外约束（信封自由度即来自这里）。
- **E 类机械修复不可行（2026-09-10 实验）**：向事件流插入合成 `turn/end`（上游为「可识别中断」自己生成的同款形状）被 seq 审计拒绝——`SessionFormatError released Session row N has seq gap`，物理行必须严格递增，无法在既有 seq 之间插行。改写既有行同理属于伪造历史。结论：E 类无插件侧路径，只能上游修或 fail-open 兜底可用性。
- **P2 机制已端到端验证（2026-09-10，真实 B 类祖先副本）**：物理帧读 → admit 变换 → `sessionFormatCatalog.createRestore(header,{recovery:'recoverable',validation:'current'})` 内存全量迁移（4151 v0 行折叠 531 事件）→ `encodeCurrentHeader`/`encodeCurrentEvent` 逐行编码 + 每行独立 zstd 帧（checksum）→ 放置 `session.v3.jsonl.zstd` → 真实 `JsonlSessionPersistence`（compression:'zstd'）open+read/close/stat 全部通过，sections 与 `handoffOf` reader 契约逐名对齐。catalog 公开 API 自足，无需第二 persistence 实例。

## 验证结论的出处（真实数据）

- 转换无损：Vera 在真实 artifact 上 4465 行全量比对 0 mismatch、当前 `handoffOf` reader 回读信封无损、回滚 = 删 v3 兄弟（task:6ed30f62 Thread）。
- 普查与 A/B 对照：Aster 用真实 persistence API 逐 artifact 读取（本机 189 artifact），双臂对照（有/无 v3 兄弟）证实「有 v3=活、无 v3=unavailable」为文件级事实（Thread 消息 fe8b0dfe / 42a1d262）。
- **v0 行的真实物理形状（fixture 校准，2026-09-11）**：`user/message` 行带 `surfaceOp: 'append'`；`turn/end` 的 data 必带 `reason`（如 `{kind:'completed'}`）；body 事件的 seq 从 0 连续编号（header 行除外）。缺 `surfaceOp` 或 `reason` 都会在 v2→v3 / v0→v1 阶段以不同文案拒绝，易与 source-kind 拒绝混淆。
- **seq gap ≠ E 类拒绝：gap 触发 torn-tail 截断而非拒绝（2026-09-11 实验）**。v0 读取的 recoverable 路径把「seq 不连续之后的全部内容」当可恢复尾部**丢弃**——artifact 因此 READ-OK（读到截断前缀）。E 类（`does not close the prior turn`）只由 v1→v2 审计在 seq 连续时抛出。含义：(a) fixture 必须保持 seq 连续才能测 E 类；(b) 真实 D 类 artifact 的读路径行为是「截断可读」，普查中其 REFUSED 来自更早的校验——不影响本轮范围，个案待查。
- **DomainFacility.open 同名域二次调用抛 `already-open`**（`storage-domain/src/index.ts:105`）。插件生命周期内只 open 一次缓存域；`SessionRemediation.open` 的 catch 把 open 失败降级为「无缓存重走」，所以正确用法是插件启动时 open 一次并持有。
- **B+E 复合缺陷存在（2026-09-11 全量 E2E 发现）**：`agent-team-rollover-22e6d24a…`（Reeve lineage 深度 10 的祖先）同时带旧 source kind 与 turn 未闭合——B 类拒绝在读取时**遮蔽**了 E 类；transform 后的 catalog 内存校验把 E 暴露出来，remediation 按设计 left-untouched（不产生半迁移状态）。这就是外部用户报告「一次只报一个错」级联的实锤。结果口径：46 个 B 类可修中的 1 个实际是 B+E，纯 B 可修 = 45；该成员的可用性兜底由 02（fail-open）覆盖。
