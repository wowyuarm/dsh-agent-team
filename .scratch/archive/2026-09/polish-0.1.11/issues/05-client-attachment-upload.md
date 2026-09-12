# 05 — Client 附件上传循环收成一处

**What to build:** 「把待发文件逐个上传、任一失败即中止并保留 chips」只有一份实现；Channel 顶楼发言与 Thread 回复共享它。
**Blocked by:** None — can start immediately
**Status:** complete（0.1.11 A 桶，2026-09-12 实施；实现方式与该条的设想不同，见下）

**删/并什么：** `packages/client-agent-team/src/client/TeamChannelPage.tsx`（`send`，约 241–257）与
`packages/client-agent-team/src/client/TeamThreadPage.tsx`（`sendReply`，约 593–609）各自内联同一个 12 行上传循环：
遍历 `pendingFiles` → `putAttachment`（含 `bytesToBase64(await file.arrayBuffer())`）→ 失败即 `setError` 返回 → 成功则收集 attachmentId。
抽成共享异步 helper（返回 `{ ok: true, ids } | { ok: false, message }`），两个调用点各自保留自己的失败清理。

**证据（2026-09-12）：** jscpd 报了这对 clone（14 行/83 tokens，另有一处相关的 props 块）。两处循环逐字相同，
唯一差异是失败分支的清理动作（`TeamChannelPage` 会 `pendingSendId.current = undefined`，Thread 侧不动请求 id）。

**删除标准：** 行为由浏览器验收套件与本包的 Client 测试覆盖（发送失败路径有既有断言）。
helper 只负责「上传并返回结果」，**不负责**状态重置——那部分留在调用方，避免把两页的生命周期差异藏进共享层。

**预期净减：** ≈ −10 行

**风险 / 需要契约判断的点：** 中低。上传失败时的用户可见文案与 chips 保留行为必须逐字保持；
`putAttachment` 的 `mediaType` 空串转 `undefined` 这个细节容易在搬运时丢掉，属验收点。

**验证：** `npm run test:browser`（桌面 + 390×844，含发送失败/重试路径）+ `npm test`

**实施记录（2026-09-12，一条要留档的底稿错误）：** 这个 helper **不是本轮新抽的**。
`packages/client-agent-team/src/client/requests.ts` 里的 `uploadComposerFiles` 早就存在，
语义与底稿设想逐字一致（含 `mediaType` 空串转 `undefined`、逐个上传、失败即返回错误文案），
但**没有任何调用点**——两个页面各自内联了同一段循环，谁也没用它。
所以这条实际是「把一段死 helper 接上」而不是「抽一个新 helper」，我按 clone 定位时没回头查是否已有同名实现。
净效果相同（循环只剩一处），但底稿把「已有单一实现无人调用」误判成了「两份实现」。

- [ ] 上传循环只有一处实现，两个发送路径都调用它
- [ ] 失败时错误文案、chips 保留、请求 id 清理语义与改动前一致
