# 03 — stored Session 读取 seam 与五类 typed failure

**What to build:** Team 对 stored Session 的每次逐会话读取都经过一个内部 reader;任何 Harness persistence 失败都被归一为五类 typed failure(missing/refused/corrupt/io/unknown)之一,句柄保证关闭。纯新增,尚无调用方迁移。

**Blocked by:** None — can start immediately

**Status:** complete

- [ ] `read(id)` 返回完整已验证的 `{header, inheritedEventCount, events}` 或 typed failure(含 sessionId、detail;refused 带 artifact location)
- [ ] `exists(id)` 经 stat 做存在性探测,非 missing 异常照旧上抛
- [ ] 判别顺序:NotFound→missing;FormatUnsupported(沿 cause 链)→refused+location;Corruption 或 `/corrupt session log/` 文案→corrupt;字符串 `code` 的系统错误→io;其余→unknown
- [ ] open/read/close 任何一步失败都返回分类结果,句柄 close 在 finally 中保证
- [ ] 单测矩阵:五类各一 fixture + cause 链包装 + close 失败 + 非 Error 抛出值
