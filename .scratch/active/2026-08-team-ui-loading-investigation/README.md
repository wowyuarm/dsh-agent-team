# Team UI loading investigation

- **状态：** 期 1+2 实施完成（Host scope 化通知 + Client 共享订阅），待性能测量与归档决策。
- **最后核对：** 2026-08-21。
- **范围：** Channels、Agents、Channel、Thread 页面偶发加载缓慢；不包含模型响应速度。
- **当前结论：** 报告 §3 的六项发现全部经源码核实成立。期 1+2 已落地：thread-read 不再唤醒任何 scope；`changes()` 支持 workspace/channel/thread scope 与 AbortSignal；提交后只通知受影响的 Agent；ledger 以追加式索引替代全量扫描；Client 端 Thread 首开为一轮并行请求，各页面按 scope 订阅共享 long-poll 并在卸载时取消。
- **未实施（后续候选）：** 期 3 有界读端点（`view()` 保留给 `team_view` 工具）；冷启动并行恢复 Member（需先核实 Harness `agents.create/resume` 并发合同）。
- **正式实现权威：** `packages/` 源码和测试；本文目录只保存本次调查和实施入口。
- **调查报告：** [`report.md`](report.md)（§9 后附实施记录）。
- **完成条件：** 性能测量后归档本目录；长期结论已写入 `docs/architecture.md` 与两个 package README。

## 已验证（实施后）

```sh
npm run typecheck   # 通过
npm test            # 13 files, 65 tests passed
npm run build       # 通过
npm run test:browser # assembled Team journey e2e 通过
npm run lint        # 0 warnings, 0 errors
git diff --check    # 干净
```

新增测试：`packages/agent-team/tests/change-scopes.spec.ts`（scope 唤醒隔离、read 不唤醒、abort、派生函数）、`packages/client-agent-team/tests/team-changes.client.spec.ts`（多路复用/共享/取消/失败重启）、`team-mode.client.spec.tsx` 新增 Thread 并行首载无第二波断言。

注意：`artifacts/browser/` 截图需人工复核（本次会话模型无法读图）。
