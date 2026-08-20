# 验证阶段踩坑记录（动态 Cordis 插件）

日期：2026-08-14 至 2026-08-15
来源：动态 plugins `tmvrf-1`、`tmvrt-1` 与 `tmvru-2` 的两轮迭代。每条记录保留原型现象、原因和正式包约束。

## 1. 动态工具必须经 harness.defineTool 构造

- 现象：手写 ToolDefinition 对象后 `ctx.tools.register(obj)` → 报错
  `dynamic tool registration must use a tool returned by harness.defineTool(...)`。
- 原因：动态插件运行时对工具定义做来源校验，只接受 harness 内置构造器产出的定义。
- 做法：`const t = harness.defineTool({...}); harness.registerTool(ctx, t)`。

## 2. object JSON schema 必须显式 additionalProperties

- 现象：`output.schema = { type: 'object' }` → 报错
  `unsupported JSON schema: schema.additionalProperties must be explicitly true or false`。
- 做法：所有 object schema 显式写 `additionalProperties: true` 或 `false`。

## 3. 工具 parameters 根必须是 open 的

- 现象：parameters 根写 `additionalProperties: false` → 报错
  `parameters.additionalProperties must be true or omitted because the implicit parameter root is open`。
- 做法：parameters 根用 `additionalProperties: true`（或省略）；output.schema
  不受此限（但也要显式声明）。

## 4. tools.restrict() 对未知工具名是 loud fail

- 现象：`restrict({ deny: ['bash','write','edit'] })` → 报错
  `restrict() names unknown global tools "bash", "write", "edit"; known global tools: team_send, team_verify`。
- 揭示的事实（比坑本身更有价值）：**无 preset 的 agent 在创建 setup 阶段的全局
  工具层只有动态/全局注册的工具**；bash/write/edit 属于 preset 的 scoped 注册，
  在 setup 阶段（preset 未 mount）不可见、也不可 deny。
- 对正式设计的含义：team 成员的"无工具裸成员"或"工具裁剪"必须通过 preset 行的
  组合（restrict 的 allow/deny 只对当时可见的全局工具有效），或依赖 preset 的
  工具行裁剪。验证中测试成员 deny 了 team 工具后即为纯文本回复 agent。

## 5. storage domain 名必须匹配 UNIT_NAME_RE

- 现象：`storageDomain.open({ name: 'dsh-team-verify', ... })` → 报错
  `invalid unit name 'dsh-team-verify'`。
- 规则：`UNIT_NAME_RE = /^[a-z][a-z0-9_]*$/`（小写开头，无连字符）。
- 做法：domain 名用 snake_case（如 `dsh_team`）。

## 6. compaction 服务未挂载（环境事实，非报错）

- 现象：`ctx.get('compaction') === undefined`，而 tokenMeter 可用。
- 原因：当前 host 组合没有 compaction-basic 行；compaction 是可选 capability。
- 对设计的含义：team 成员的"token 阈值自动 compaction"不是开箱即有的——
  team preset / host 组合必须显式挂载 compaction-basic 行；触发用
  `compactIfNeeded(agent, 'pressure' | 'context-overflow')`。

## 7. client 包激活需要用户批准

- 现象：host-only 包 `cordis_run` 直接 running；含 client 代码的包返回
  `awaiting user approval`，需用户在 UI 批准后才激活。
- 做法：host 验证与 client 验证拆成两个 package 顺序推进（host 先行不需要批准）；
  正式 client 包按 dsh 流程请求批准。

## 8. MessageSource 新增 kind 需要声明合并（动态插件不可行）

- 现象：`MessageSourceMap` 是 merge-extensible（"plugins add their own kinds"），
  但动态插件无法做 TS 声明合并。
- 验证中的替代：`{ kind: 'plugin', plugin: 'dsh-agent-team', form: 'relay' }`
  ——`form: 'relay'` 官方语义即"A message another agent addressed to this one"，
  恰好是团队投递的语义。
- 正式包：通过 `declare module` 合并新增 `team` kind（带 sender/member 字段）。

## 9. root 事件监听会被自身活动淹没

- 现象：验证插件在 root `ctx.on` 监听 `session/event`，inspect 返回的日志全是
  自己当前 turn 的 assistant/chunk 等事件，把目标成员的事件挤出窗口。
- 做法：按事件载荷里的 session id 过滤目标成员；正式实现的投递确认逻辑同样要
  按成员 session 过滤，不能依赖"事件都是目标成员的"假设。

## 10. 动态插件无 zod，storageDomain 需要 zod schema

- 现象：`DomainSpec.tables[].valueSchema` 要求 zod schema，动态插件环境没有 zod。
- 验证中的替代：手写 `{ safeParse: v => ({ success: true, data: v }) }` 假对象，
  运行时未深入校验时可通过（put/get/update 全部正常）。
- 正式包：使用真 zod（参照 workspace registry 的 domain 定义模式）。

## 11. 事件载荷是位置参数，不是统一 payload 对象

- 现象：不同事件的监听器参数形状不同（`agent/inbox/inserted` 是
  `(payload: { agent, message })`，`session/event` 是 `(session, event)`），
  验证插件用 rest 参数 + 逐事件分支处理。
- 做法：正式包监听时按事件名写对应签名，不要假设统一 payload。

## 第二轮新增（2026-08-15，plugin `tmvrt-1` pkg-1…pkg-19 + `tmvru-2`）

## 12. apply 期 ctx.<svc> 属性访问需要 inject 声明，工具 execute 期 ctx.get 不需要

- 现象：apply 里 `ctx.storageDomain.open(...)` → 报错 `service "storageDomain" is
  not injected`；而更早的包里在工具 execute 内部 `ctx.get('storageDomain')` 正常。
- 做法：apply（或 async apply）内访问的服务一律声明 `inject: [...]`；工具 execute
  内的运行时访问用 `ctx.get(name)` + undefined 检查。

## 13. 动态环境没有 AbortController，工具 execute 的第二个参数 exec.signal 可用

- 现象：`new AbortController()` → `AbortController is not defined`。
- 做法：`execute(args, exec)`，用 `exec.signal`（当前 turn 的 abort 信号）转发给
  compaction 等需要 signal 的服务。

## 14. ctx.effect 回调立即执行，其返回值才是 disposer

- 现象：`ctx.effect(() => { domain.close() })` 导致 domain 立即被关闭。
- 做法：`ctx.effect(() => () => { domain.close() })`——外层回调立即运行，返回的
  函数在 fiber 卸载时执行。

## 15. DomainSpec.version 必填；reopen 时 records 用 schema.parse 校验

- 现象 1：漏写 `version` → 单元文件写出的 header 无 version，reopen 报
  `missing or foreign unit header`。
- 现象 2：假 zod（只有 safeParse）→ reopen 报 `stored record ... does not match
  its schema`（open 路径调 `.parse`，不是 safeParse）。
- 做法：`open({ name, version: 1, tables })`；动态假 schema 需同时给
  `{ safeParse, parse: v => v }`。正式包用真 zod（如 workspace registry）。

## 16. meta.agentPreset 只写 header，挂载必须由创建者的 setup 调 agentPresets.mount

- 现象：`agents.create({ meta: { agentPreset } })` 后 `composedPreset(member.ctx)`
  为 undefined——agent-loop 工厂不自动挂 preset。
- 做法：`setup: async (agentCtx) => { await ap.mount(agentCtx, presetId) }`。
  注意 setup 若返回 Promise，其 resolve 值会被当作 AgentSetupCommit 调
  `.commit()`（把 `ap.mount(...)` 直接 return 会崩）——必须内部 await、返回 undefined。

## 17. 动态插件创建的 agent 归创建 fiber 所有，包更新/停止即 dispose

- 现象：pkg-3 创建的 `tmvrt-a` 在 pkg-4 更新后从 live registry 消失（dispose 会
  停 loop、注销 agent、移出 store）；session 持久化文件保留。
- 做法：跨包场景用 `agents.resume({ resumeSessionId })` 恢复；M1 的成员创建必须
  在 host 行（fiber 与进程同寿）。

## 18. session.append 的形状：user/message 的 data 就是 message 本身

- 现象：`append('user/message', { message })` → tokenMeter fold 报
  `blocks is not iterable`（`deriveEventMessage` 对 user/message 直接 `return
  event.data`，assistant/message 才返回 `data.message`）。
- 现象 2：surface 事件 append 必须带第三参 `{ surfaceOp: 'append' }`。
- 做法：`session.append('user/message', userMessage, { surfaceOp: 'append' })`。

## 19. preset 内服务行必须 isolate；反例报错文本

- `standingKeyFor` 对 loose 服务行拒绝：
  `row(s) published process-global service(s) [compaction]; a preset service must
  sit behind an \`isolate\` realm or move to the host composition`。
- compaction-basic 配置：`retainRatio` 与 `retainTokens` 互斥。

## 20. 投递的 durable 证据分两段：停驻 = agent/inbox/spliced，认领后 = user/message

- 现象：invariant 只查 user/message 时，刚 inject 尚未被认领的投递被误报违例。
- 做法：证据 = `(user/message, data.id === inboxId) ∨ (agent/inbox/spliced,
  inserted[].id === inboxId)`；spliced 载荷形状 `{ target, start, removedCount?,
  inserted: UserMessage[], outcome? }`。

## 21. web profile 在 host 层禁用 compaction-basic/plan-mode（环境事实）

- 现象：Host Service 目录显示 compaction 存在，但动态插件 `ctx.get('compaction')`
  为 undefined——目录是能力层，运行时以 `ctx.get` 为准。
- 原因：dsh-web-app bundle 把 compaction backend / plan-mode 等移到 presets
  （"the agent plane moves behind agent presets"，行 348/359 disable）。
- 含义：team-member preset 必须自带 compaction-basic isolate 行（D24 成立）；
  成员级引擎用 `ctx.agentPresets.serviceFor(member, 'compaction')` 从 host 侧寻址。

## 22. client 包激活需要审批（同第 7 条），且新 plugin 需要新授权

- 现象：`tmvru-2/pkg-20`（含 client 代码）返回 `awaiting user approval`；
  host-only 包不需要。上轮 tmvrf-1 的授权不覆盖新 plugin。
- 做法：host 验证先行，client 验证拆成独立 plugin 让用户审批一次。

## 23. client take 的运行时呈现：registrant 为 `dyn/<pluginId>`，priority 被规范化

- 现象：注册时传 `priority: -1`，Slots 实测 occupants 显示 `registrant:
  dyn/tmvru-2`、priority 为 -5（sidebar.workspaces）与 -6（conversation）——
  运行时按 seat 分配/规范化优先级，仍稳定低于 shipped x6 的 0。
- 做法：断言 take 成功时看 occupants 的 active 标志与 registrant 前缀
  `dyn/`，不要拿注册时的 priority 数值与实测值逐字对比。

## 正式架构复核新增（2026-08-15）

## 24. storageDomain 没有跨 record 事务

- 风险：把 Message、Task、Follow 和 Delivery 分写多张 mutable tables，会在任一写入失败或进程退出时留下部分提交。
- 做法：Team Domain 以 append-only operation ledger 为唯一权威；一次业务修改写一个 record，再从 Operation 投影所有状态。

## 25. Team commit 与 tool result 不在一个事务

- 风险：Team Operation 已 durable，但进程在 `tool/result` 写入 session 前退出；模型或 replay 重试会产生第二条 Message/Claim。
- 做法：每次写操作携带稳定 request id；相同 request id + 相同 payload 返回原 receipt，不同 payload loud fail。Tool adapter 从 sessionId + callId 派生 request id。

## 26. MessageSource 不是 authority

- 风险：信任 source.sender、tool args.senderId 或正文 @handle，会允许调用者冒充其他 Member。
- 做法：Agent tool 把 exact live `exec.agent` 交给 Team Service解析 Member；Service 每次重新校验 Workspace、Channel membership、Task state 和 Claim ownership。

## 27. Agent 不是 lifecycle handle

- 风险：只保存 registry 返回的 Agent，无法执行完整 quiescent teardown；plugin unload 后可能残留 driver 或 scope resources。
- 做法：Host plugin 保存 `AgentHandle`，关闭 admission 后 dispose并等待 driver exit、registry removal 与 scoped context unwind。

## 28. admitted 不等于 consumed

- 风险：把 Inbox append、`agent.status`、`whenIdle()` 或一次 assistant reply 当成某条 Delivery 已处理。
- 做法：M1 Delivery 只记录 queued/admitted/canceled；admitted 只由 `agent/inbox/spliced` 或 `user/message` evidence证明，不追踪 claimed/processed/replied。

## 29. 可卸载不等于成员继续运行

- 风险：Team Fiber 创建的 AgentHandles 会随它 dispose；P9 若承诺 plugin 禁用后成员继续运行，就违反 Cordis effect ownership。
- 做法：plugin unload 停止 live Members并保留 sessions/ledger；remount 后恢复 enabled Members。临时单成员停机使用 suspend/resume。

## 30. Raft 产品事实、CLI 事实和本地决策不可混用

- 风险：把 CLI held/draft、Loom Effect/Delivery 或 Raft joined-channel notification 写成 dsh 必须复刻的产品合同。
- 做法：Raft 只作参考；自动 Task、多 Direction Claims、默认静默、baseRevision 和本地 Delivery 是 dsh 有意选择，统一在 `design/raft-design-mapping.md` 记录来源与偏离。

## 31. Member direct chat 不是 Team DM

- 风险：把 `ctx.sessions.open(agentSessionId)` 称为 DM，会让实现者误以为它具有 participant visibility、Team Message/Thread/Follow/Delivery 和 ledger history。
- 做法：M2 将其称为 Member session direct chat；真正 Team DM 是未来独立 Place 类型。


