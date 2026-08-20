# 工具集研究：Loom raft tools 与 dsh 工具规范

日期：2026-08-14
状态：四工具已拍板并完成原型验证；正式 M1 schema 受 `architecture.md` 的 authority、operation receipt、confirmation token 与 Delivery 状态约束。
来源：`/home/yu/projects/Loom/src/channels/raft/raft-channel.ts`（工具定义与
channel guidance）、dsh `docs/cookbook/adding-a-tool.md`。

## 1. Loom raft tools 的设计要点（借鉴面）

1. **Opaque refs 贯穿全部工具**：`taskRef` / `placeRef` / `ref` 是不透明引用
   （`#storeRef` / `#lookupRef` / `#remoteRef` 管理），模型不能拼 CLI target；
   工具返回的 evidence 一律带引用而非全文。→ 我们的 team 对象 id（message /
   task / thread / member）同规则。
2. **Bounded evidence 读模式**：所有读工具 limit（1-50/100，默认 20/50）+
   cursor 分页 + summary + refs；"Results are evidence and use opaque refs"。
   这是注意力预算的实现：读工具给有界证据，模型决定要不要打开细节。
3. **action 工具形态**：`action` 字面量 + 目标 ref + 条件参数（update 才收
   status），交叉字段在 execute 内手检（throw 明确错误）。raft_task
   （claim/unclaim/update）、raft_attention（unfollow_thread/mute_channel/
   unmute_channel）。
4. **工具描述的固定结构**（数组 join）：动作语义 → 权限/副作用 → 边界（"不自动
   unfollow"）→ 失败语义（"Do not blindly repeat an action whose Delivery
   outcome is unknown"）。
5. **channelGuidance 提示词**（13 条）：团队规则段——异步性、注意力信号不是指令、
   claim 前担责、thread 是会话单元、opaque refs 的用法。→ 我们的"团队规则提示词
   段"直接借鉴此结构。
6. **Effect 语义**：写工具每次调用 = 一个 durable Effect；"Tool success means
   Loom accepted the Effect, not that Raft applied it"。→ dsh 无 Loom 的 Effect
   层；映射为：写工具返回"已接受/已拒绝"事实，副作用在 execute 内发生，成功 =
   团队服务已落盘。

## 2. dsh 工具规范要点（落地面）

- `defineTool`：`name` / `description`（模型所见）/ `parameters`（ParameterSchemaSpec，
  运行时校验）/ `output.schema`（canonical JSON value）+ `output.render`
  （模型可见 prose）/ 可选 `presentCall` / `presentResult`（UI 卡片，纯函数）。
- execute 内 args 已按 schema 校验与冻结；跨字段规则（如 action 与 status 的
  组合）在 execute 手检并 throw；throw = `isError`。
- **canonical value 与 render 分离**：模型可读的结构化值 + human prose 分开；
  "do not make callers parse prose for ids and fields"——refs 放 canonical value。
- 通知：`exec.agent.inject({ content, source: { kind: 'plugin' } })` 追加下一条
  模型请求的 durable context（不唤醒）。
- 注册是 effect：卸载 fiber 即注销工具。

## 3. 工具集最终形态（Q18 已拍板，2026-08-15）

四工具（D23，用户拍板）：

| 工具 | 形态要点（借鉴后） | Loom 对应 |
| --- | --- | --- |
| `team_send` | target（task/thread ref 或 channel ref）+ structured mentions + thread base revision + 可选 confirmation token；返回 operation receipt、Message/Task refs、new revision 与 queued/admitted/canceled Deliveries | 通用 message + Destination（Loom 无独立 send 工具） |
| `team_view` | 读 channel/task/thread 消息流：bounded（limit+cursor）+ summary + opaque refs；含成员与 claim 状态 | raft_open + raft_activity（合并） |
| `team_claim` | `action: list \| claim \| done \| release`；claim 带 taskId+方向；返回 claim 状态与 task 派生状态 | raft_task（claim/unclaim/update） |
| `team_follow` | `action: unfollow \| follow \| status`；thread 注意力管理 | raft_attention（unfollow_thread） |

映射差异说明：Loom 的写工具先持久化 Effect，再由 Adapter delivery；dsh-agent-team 的写工具以稳定 request id 调用 Host Service，Service 先原子提交 Team Operation，再执行 Inbox Delivery。Team Domain、tool/call 与 tool/result 不在同一个跨存储事务内，因此重复执行必须由 request id 幂等，工具结果未知时不能仅凭重试创建第二条业务 Operation。

## 4. 已拍板与验证状态

- Q18 工具集：四工具已拍板（D23，见 §3）。
- Q21 里程碑：M1 机制核心 → M2 UI → M3 打磨（D24）。
- 验证状态（2026-08-15 第二轮，validation/2026-08-15-validation.md）：四工具
  全形态在真实进程由真实模型驱动通过——team_send（创建 task/reply、revision
  冲突拒绝、原型中的 unfollow-mention 二次放行）、team_view（bounded+cursor+opaque refs+
  claim 状态）、team_claim（同方向互斥原子校验、并发一胜一败、done/release 仅
  自己、list 全状态）、team_follow（unfollow/follow/status + mention→follow）。
  canonical value 与 prose 分离按 dsh 工具规范（output.schema + render）。
- D26 将原型的隐藏 per-sender 二次调用 cache 替换为显式 confirmation token。首次拒绝不提交 Operation；token 绑定 sender、Thread revision 和 recipient set，第二次 `team_send` 必须显式携带，状态变化或 provider unload 后失效。

## 来源

- `/home/yu/projects/Loom/src/channels/raft/raft-channel.ts`（agentTools、
  channelGuidance、deliver，2026-08-14 实读）。
- `docs/cookbook/adding-a-tool.md`（dsh 工具契约，2026-08-14 实读）。
