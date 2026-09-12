# 06 — Client 编辑对话框保存生命周期收成一处

**What to build:** 「保存中禁用 / 提交 / 成功后 onCommitted + onClose / 失败就地报错 / finally 复位」这一套编辑对话框生命周期只有一份实现；Channel 编辑与 Member 编辑共享它。
**Blocked by:** None — can start immediately
**Status:** complete（0.1.11 A 桶，2026-09-12 实施；净减估计写错，实际接近 0 或略增）

**删/并什么：** `packages/client-agent-team/src/client/TeamChannelsPanel.tsx`（编辑对话框 `save`，约 364–386）与
`packages/client-agent-team/src/client/TeamMemberEditor.tsx`（约 172–194）各有一份约 20 行的同构实现
（`pendingRequest.current` 复用、`setSaving`、`updateChannel`/`updateMember`、成功即 `onCommitted`+`onClose`、catch 转字符串、finally 复位）。
抽成一个 `runDialogSave({ request, call, onCommitted, onClose, setError, setSaving, pendingRequest })` 之类的 helper。

**证据（2026-09-12）：** jscpd 报了这对 clone（20 行/79 tokens），两份实现除被调用的 mutation 与标题外逐行相同。
这是「一个域概念两处实现」的典型——两个编辑对话框的保存语义必须永远一致，但现在靠人手工保持一致。

**删除标准：** helper 只承载生命周期骨架，mutation 调用与对话框内容仍留在各自组件。
覆盖在 `packages/client-agent-team/tests/team-mode-agents.client.spec.tsx` 与浏览器套件的编辑流程。

**预期净减：** ≈ −18 行

**风险 / 需要契约判断的点：** 中低。两个组件对 `pendingRequest` 的语义略有差别（Channel 侧额外持有 `saving` 与 payload 构造），
搬运时以「骨架共享、payload 本地」为界；若发现需要传 3 个以上回调才能对齐，就停手并按第 09/10 项的处理方式退回保留。

**验证：** `npm run test:browser`（编辑 Channel / 编辑 Member 的成功与失败路径）+ `npm test`

- [ ] 保存生命周期骨架只有一处实现
- [ ] 成功关闭、失败就地报错、保存中禁用、请求 id 复用四项语义不变
