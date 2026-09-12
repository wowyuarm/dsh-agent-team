# 03 — stored Session 读取 seam 与五类 typed failure

**What to build:** Team 对 stored Session 的每次逐会话读取都经过一个内部 reader;任何 Harness persistence 失败都被归一为五类 typed failure(missing/refused/corrupt/io/unknown)之一,句柄保证关闭。纯新增,尚无调用方迁移。

**Blocked by:** None — can start immediately

**Status:** complete
**验证记录：** 2026-09-12，Aster 在合并树 `9d8362d`（本地 `master` `20e9ebb`）上对照 `stored-session-reader.ts` 逐条核过全部 5 条；该模块单测 10/10 通过，全量 `npm test` 532 passed / 1 skipped。


- [x] `read(id)` 返回完整已验证的 `{header, inheritedEventCount, events}` 或 typed failure(含 sessionId、detail;refused 带 artifact location)
- [x] `exists(id)` 经 stat 做存在性探测,非 missing 异常照旧上抛
- [x] 判别顺序:NotFound→missing;FormatUnsupported(沿 cause 链)→refused+location;Corruption 或 `/corrupt session log/` 文案→corrupt;字符串 `code` 的系统错误→io;其余→unknown
- [x] open/read/close 任何一步失败都返回分类结果,句柄 close 在 finally 中保证
- [x] 单测矩阵:五类各一 fixture + cause 链包装 + close 失败 + 非 Error 抛出值
