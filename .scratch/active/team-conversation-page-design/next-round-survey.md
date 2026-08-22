# 下一步优化调研（round4 候选，只调研不实施）

- 状态：survey，待用户挑选与排期
- 最后核对：2026-08-22
- 前置边界：round3（`.scratch/active/team-client-ui-round3/`，消息 run hover 块、mention chip、聊天排版刻度）由另一会话认领进行中，本清单不与其重叠；round1/2 与本轮 A1–F1 已合入。

## P0 —— 高价值、低成本、无契约依赖

### 1. 时间线日期分隔线（原 B2）
- 现状：消息只有名行时间（round2），跨天阅读无时间锚点；`formatMessageTime` 已产出完整日期能力。
- 方向：渲染事实序列时在"日界"插入分隔行（复用 activity 行的弱化居中语言，key 如 `dateSeparator`）；数据用已合入的 `message.occurredAt`。
- 成本：小（纯 Client 渲染分组）；风险：与 round3 的 run 分块逻辑叠加时需对齐"分块单位"，等 round3 合入后做。

### 2. Composer 收件人显式化
- 现状：recipients 由 @mention 隐式决定且不可见；发送后 `memberNotFollowing` 报错才暴露差异（`TeamComposer.tsx` 只在 mention 弹层里看到人）。
- 方向：composer 卡内一行"将通知：@a @b"chips（tertiary 弱化），随 recipients 变化；为 confirmation 文案提供视觉锚点。
- 成本：小；风险：无。

### 3. Channel 发送幂等重试对齐 Thread reply 模式
- 现状不对称：Thread `reply()` 失败后保留同一 `replyRequestId` 重试（防双发）；Channel `send()` 每次点击生成新 UUID（响应丢失时可能重复投递）。
- 方向：send 失败保留 requestId 直到 committed，与 reply 一致。
- 成本：小（约 10 行）；风险：无，属健壮性修正。

### 4. 侧栏频道列表缺 workspace 变更订阅
- 现状：`TeamChannelsPanel` 只在挂载/creatingAgents 变化时刷新；`TeamAgentsPanel` 订阅了 `{kind:'workspace'}`。他端增删成员或频道时频道列表静默过期。
- 方向：补同款订阅（注意去抖，避免与主区页面重复全量拉取）。
- 成本：小；风险：需验证不引入循环刷新。

## P1 —— 中成本、纯 Client 可达

### 5. 刷新恢复深链（原 G1）
- 现状：`readSnapshot()` 故意丢弃 channelRef/taskRef/threadRef，刷新落回频道列表。
- 方向：持久化三级引用；恢复时经 `view()` 校验，ref 失效逐级回退（thread→channel→列表）并保持现有"只存 mode+workspace"的降级路径可关。
- 取舍：这是产品行为变化（用户此前默认刷新归位），需用户点头再动。

### 6. Agents tab 主区视图（原 C2）
- 现状：选 Agents tab 且未选 agent 时主区死胡同一句话；成员信息只在侧栏行。
- 方向：主区 Agent 详情卡（presence/diagnostic、描述、其 Claim 列表及状态、所在频道）。数据全部已在 `members()` + `view().claims/members` 中，无需新 Host 面；导航加 `selectMember(memberId)`（内存态即可）。
- 成本：中（新页面组件 + 路由分支 + 测试）；风险：信息架构需用户确认展示密度。

### 7. 管理成员弹层搜索
- 现状：Modal 平铺全体 workspace 成员，人多时难找。
- 方向：顶部 Input 过滤 handle/description；复用公共 Input。
- 成本：小-中。

## P2 —— 大改动或依赖 Host 契约决策

### 8. 未读徽标（侧栏频道行）
- 现状：ledger 每操作携带私有 `inbox` delta，但 `AgentTeamView`/`AgentTeamChannel` 投影零未读字段；Human 侧目前只能靠进 Thread 读才知道。
- 阻塞点：需要在 agent-team 公开 Remote 上新增 Human 可读的 hint 查询（如 `view` 附带 per-channel/thread 未读计数）。属公开契约扩展，须走 typert 再生 + 兼容性核对（`docs/dsh-release-compatibility.md`），不是纯 UI 项。
- 若立项：先写 Harness 导航调研记录（harness-navigation.md 流程），再设计查询形状。

### 9. Attention 控制暴露
- 现状：`team/thread-attention-changed` 操作与 read 返回的 attention 快照都在，但架构明示"当前 Thread UI 不暴露 Attention 控件"是刻意边界。
- 方向（若做）：Thread header 加 关注/取关 + 关注中的 Thread 过滤。需产品决策 + 架构文档同步改口。

### 10. 时间线键盘消息导航
- ↑↓ 或 j/k 在消息间移动焦点（roving tabindex on messageRun 单位，依赖 round3 的 run 结构定型）。
- 成本：中大；收益：读屏/键盘用户体验跃升，但需与 run hover 视觉联动设计。

### 11. 草稿暂存
- 切换 thread/channel 丢草稿。sessionStorage 按 ref 键存 draft+recipients，卸载前写、挂载时恢复。
- 成本：小-中；风险：隐私模式降级路径要安静。

## 观察项（不动，仅记录）

- Thread 页每次 workspace change 都并行拉 members+view(limit 1)（refreshSupplemental）：团队规模下可接受，若未来 hint 查询落地可一并瘦身。
- 空态/加载态居中后，错误态仍在顶部（带 retry 动作，可辩护）；若统一居中需保证 alert 不被 composer 遮挡。

## 建议组合

下一轮若由本工作项继续：P0 全部四项 + P1.7（都是小步快跑）；G1/C2 待用户单独拍板；P2 三项先不做。与 round3 合流顺序：日期分隔线排在 round3 之后。

## 执行记录（2026-08-22）

P0 四项已在 `feat/team-page-p0` worktree 分支完成并全链路验证（typecheck/lint/build/83 单测/浏览器 E2E 全绿）：

- ①侧栏频道订阅：`TeamChannelsPanel` 补 `{kind:'workspace'}` 订阅（与 AgentsPanel 对齐）。实现中确认 `TeamChangeStream` 按 scope 复用单条长轮询且首次探针静默采样——订阅后共享轮询常驻，线程页加入既有轮询不再产生新调用，属预期语义（对应 spec 断言改为"覆盖即可"，注释说明）。
- ②发送幂等：Channel `send()` 与 reply 同款 requestId 策略——committed/确定性拒绝换新 id、`confirmation_required` 同 id 续发、传输异常保留 id（Host ledger 按 requestId 去重返回原结果）。顺带修复：channel 页此前把 `confirmation_required` 当通用错误渲染，现按 mention 确认文案处理。
- ③收件人提示行：composer 卡内 `.notifyRow`（`composerNotify` key），recipients 非空时显示将通知的句柄。
- ④日期分隔线：新增 `team-separators.ts` 单一权威实现 `chunkRunsWithDays`（run 分块 + 日界打断 + 活动继承日界），channel/thread 两页接入，`.daySeparator` 样式放 thread.module.css；首条消息不带头部锚。测试含跨天打断、活动继承、跨年标签与种子消息集成用例。

遗留：分支合并回主分支被并行会话在主树的未提交重构阻塞（其改动覆盖 TeamChannelsPanel/TeamThreadPage 等同名文件）；待其落地后 rebase 再合并。
