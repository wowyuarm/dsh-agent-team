# 04 — 调用方接入 seam;timeline 截断显式标记

**What to build:** 全部逐会话读取调用点不再自行分类 Session 失败;模型的 `context_timeline` 结果显式说明历史在哪一个祖先、因何原因提前截断。同一个不可读祖先只降级历史能力,不波及成员可用性。

**Blocked by:** 03 — stored Session 读取 seam 与五类 typed failure

**Status:** complete
**验证记录：** 2026-09-12，在合并树 `9d8362d` 上核过：第 1/2/3/5/6 条由 Aster 对照代码与测试逐条核（`index.ts` 仅剩启动期 `list()`；replay 分类 `1678/1688/1692`；seed 与 prefix 按类别 fail-closed `1500/1621`；timeline `incompleteFrom` 渲染于 `context-tools.ts:165`；矩阵三用例 `member-lifecycle.spec.ts:2386`／`3522`+`3569`／`4168`），第 7 条由全量 `532 passed / 1 skipped` 支撑，第 4 条由 Vera 对五个消费者的 base→tree 逐行 diff 证实「仅改为经 seam 读取与按类别分派，分支结果未变」。


- [x] `index.ts` 内不再有 seam 之外的逐会话 `sessionPersistence.open/stat` 调用(启动期一次 `list()` 盘点除外;remediation 的原始字节读属其自身修复路径)
- [x] `replayCarriedInput`:refused/corrupt → 警告+跳过(日志含 session id、成员、原因);io/unknown → 维持阻塞;判别经类别,不经文案
- [x] `resolveCheckpointSeed` / `recordedCheckpointPrefix`:任何类别 fail-closed,错误信息含类别与原因
- [x] `reconstructMissingHandoff` / `sourceUsageTokens`:策略不变,经类别表达
- [x] timeline:祖先不可读 → walk 停止,结果带 `incompleteFrom {sessionId, reason}`,工具输出渲染该行;成员可用性不受影响
- [x] 矩阵测试:同一不可读祖先 → timeline 截断+标记且成员仍 active;不可读 committed seed → return 阻塞;不可读当前绑定 → 激活阻塞
- [x] 既有 fail-open/fail-closed 行为测试全部保持绿色
