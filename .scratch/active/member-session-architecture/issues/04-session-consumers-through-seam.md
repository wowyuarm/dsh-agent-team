# 04 — 调用方接入 seam;timeline 截断显式标记

**What to build:** 全部逐会话读取调用点不再自行分类 Session 失败;模型的 `context_timeline` 结果显式说明历史在哪一个祖先、因何原因提前截断。同一个不可读祖先只降级历史能力,不波及成员可用性。

**Blocked by:** 03 — stored Session 读取 seam 与五类 typed failure

**Status:** complete

- [ ] `index.ts` 内不再有 seam 之外的逐会话 `sessionPersistence.open/stat` 调用(启动期一次 `list()` 盘点除外;remediation 的原始字节读属其自身修复路径)
- [ ] `replayCarriedInput`:refused/corrupt → 警告+跳过(日志含 session id、成员、原因);io/unknown → 维持阻塞;判别经类别,不经文案
- [ ] `resolveCheckpointSeed` / `recordedCheckpointPrefix`:任何类别 fail-closed,错误信息含类别与原因
- [ ] `reconstructMissingHandoff` / `sourceUsageTokens`:策略不变,经类别表达
- [ ] timeline:祖先不可读 → walk 停止,结果带 `incompleteFrom {sessionId, reason}`,工具输出渲染该行;成员可用性不受影响
- [ ] 矩阵测试:同一不可读祖先 → timeline 截断+标记且成员仍 active;不可读 committed seed → return 阻塞;不可读当前绑定 → 激活阻塞
- [ ] 既有 fail-open/fail-closed 行为测试全部保持绿色
