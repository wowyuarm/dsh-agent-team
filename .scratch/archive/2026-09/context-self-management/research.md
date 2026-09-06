# Compaction / context 自管理重设计 — 调研报告

状态：**设计已由 Human 验收，进入 Tars 实现 + Reeve review 轨道**。当前实施契约见 [`spec.md`](spec.md)，唯一实施 ticket 见 [`issues/01-implement-context-self-management.md`](issues/01-implement-context-self-management.md)；本 README 保留研究与决策证据。
最后核对日期：2026-09-05
当前前沿：等待 Tars 认领实施；Reeve 已认领计划与独立质量审查（claim:bedcdc11-8c97-4dc4-88f4-8682b311a94a）。
结束条件：生产代码、判别性测试、维护文档和真实 browser 验收通过；Human 接受后把长期结论移入正式 docs，再归档此目录。
源头：Roadmap thread:7cef1c15（task:58f05513）；实施 task:e1f642bb-b6f8-4bd8-a0cd-b147b9411bba
历史认领：Momo（claim:ee72721e）；Reeve 设计（claim:ba9a2e0c-8027-4e6d-90f8-387124ecaa71）

## 一、Human 六轮陈述的演进梳理

| 轮 | 原话要点 | 背后的诉求 |
|---|---|---|
| 3796 | 重新设计定制 agent-team 的 compaction | 现状不满意：shipped compaction-basic 不合团队场景 |
| 6220 | 让 member agent 自己 compact；prompt 引导时机（任务完成？）；探索回滚？如何设计 tool | 决策权下放给 agent：什么时候压缩、压什么 |
| 6281 | dsh 命令注册表支持 agent 作用域 shadowing；team-member preset 放自定义 compact 命令只对成员生效 | 机制定位：preset 隔离组合，不动全局 |
| 6286 | human 验收 task 通知 agent 时，prompt 可声明：去更新记忆、或回到过去 checkpoint 并 compact | 事件驱动的压缩时机：验收=天然边界 |
| 6732 | 不再只是单 session？借 codex new_context；agent 自己管理 session | 结构跃迁：session 从"宿主管理的容器"变"agent 的资源" |
| 7156 | session 不再暴露给产品层，模型内化 session 概念；自己管理 context（回滚+compact）；自己从 sessions 搜索过去经历（session=context infra） | 终局形态：agent 拥有跨 session 的记忆主权 |
| 7157 | 是 agent 自己 compact，还是到新 session 去 handoff？ | 核心二分法：同 session 内压缩 vs 换窗交接 |
| 7159→7167 | 「这是想法，不代表就要这么实现」；这轮实际重新考虑 agent-team 的 session 与 context 管理，human 与 Reeve 深度探索，Momo 先初步梳理 | 定位：概念探索，非立即实施 |

## 二、外部材料深读结论

### A. Codex new_context（blog: context-window-rollover + obelisk-dsh-plugin）

**模型**：不做摘要的换窗。模型维护 handoff note → 调 `new_context`（只声明 intent）→ sampling 完成后的安全边界 host 整体替换 active history → 新窗口只带 handoff；旧历史留在持久层按稳定 ID 回查。

**关键设计点**：
1. 三层 prompt：guidance（常驻）+ near-limit reminder（每窗一次）+ fallback reserve（base 耗尽后再给一次受限采样）。Codex 的 fallback 只是 prompt 软约束；obelisk 插件升级为 host 硬裁剪（system-prompt assemble 过滤 wire schemas + tools.guard 执行层拒绝）
2. 两阶段切换：工具只置 flag，真正替换推迟到 sampling 成功的安全边界（agent/pre-step）——防兄弟 tool call 副作用不确定
3. handoff 是 prose（非结构化 JSON），语义契约靠 prompt：四分栏证据分级（规格确认事实 / agent 推断 / 未解决冲突 / 未验证项）——**推断不许因重复提取而固化成事实**（pilot 发现的真实失败模式）
4. 不加 window_id：canonical session_id + message_uuid 两个锚点就够；窗口边界从相邻两次 new_context 派生，不物化
5. durable log 里 tool/call + tool/result 成功 pair 就是 rollover intent，无需新 event 类型、无需第二份 store；运行时状态由 host-only session projection 增量折叠
6. A/B pilot（200K）：rollover 比 compact 快 22.5%、主 session tokens 少 49.4%、工具错误 0 vs 8；恢复 message 短 53% 且证据边界清晰

### B. pi-context（ttttmr，xlab blog）

**模型**：Git-like session tree 操作三件套（改名后：context_checkpoint / context_timeline / context_compact）。kimi d-mail 的时间回溯启发，「无损时间旅行」。

**关键设计点**：
1. 三工具语义：checkpoint=打命名锚点（label 节点）；timeline=看当前路径骨架（checkpoints/摘要/分支点/user 轮次/当前位置 + HUD：上下文占用、离最近 tag 距离、compact 提示）；compact=从更早锚点建 summary 分支续走
2. 实现细节（src/index.ts 逐行读过）：
   - compact 是两阶段：工具只存参数返回 "compact start"，turn_end 时 ctx.abort()，agent_end 且 idle 后才真正 branchWithSummary + navigateTree——和 Codex 的安全边界思想一致
   - **取消检测**：didConversationAdvance——若 compact 请求后对话又前进了（非 passive entry），取消压缩并通知 agent 重试。防陈旧 summary
   - backupCheckpoint：压缩前给当前位置留恢复锚点（"回到未来"），SUM 记录来源节点
   - checkpoint 名去重（DFS 全树查）、自动挑"最后一个有意义节点"（跳过内部工具调用）
3. Skill 驱动（15K 字）：working-set 模型（raw context / state summary / discardable process 三分类）、continuation boundary 判定（"下一动作是否新阶段"而非"任务是否完成"；交付求反馈≠边界）、start-of-turn 分类、七种场景 references 按需加载
4. 命名教训：从 context_tag/log/checkout 改名为 checkpoint/timeline/compact——**管理的是对话历史不是 repo 状态**，避免 git 概念误植
5. 明确边界声明：context 导航不改文件/进程/浏览器/ticket/数据库——只动对话历史

### C. 两者对比

| 维度 | codex new_context / rollover | pi-context |
|---|---|---|
| 数据模型 | 线性 log + surface 替换（append-only 不删） | 树（分支+跳转，多世界保留） |
| 压缩单位 | 整窗换掉（handoff 全权代表） | 段落级（从任意锚点分叉） |
| 回滚 | 无（旧历史在持久层可查不可回） | 有（backup checkpoint + 树导航，无损） |
| 取证 | session_id/message_uuid 回查（需 obelisk 索引） | 树上直接看（timeline 骨架） |
| 触发 | host 预算驱动（三层 prompt+fallback） | agent 判断（skill 引导 + HUD 提示） |
| 工具面 | 1 个（new_context，handoff 做参数） | 3 个（checkpoint/timeline/compact） |

## 三、dsh / agent-team 现状核实（全部 file:line 实证）

### dsh 已有的接缝
- **CompactionEngine 抽象**（packages/core/compaction/.../index.ts:96）：compactIfNeeded（自动压力）/ compactNow（手动）/ compactRegion（强制区间）三个抽象方法，替换消息带 compactCheckpointSource 事务身份。**可子类化替换 compaction-basic——这正是我们 preset 已用的挂载方式**
- **surfaceOp: {op:'replace', start, end}**（session types.ts:395-405）：公开的表面替换原语，"any surface-replacing producer may use it"——不止 compaction 可用
- **agents.create 带 seed**（core/agent/index.ts:60-108）：fork 供给 balanced completed-turn prefix + inheritedEventCount + parentSession lineage——**dsh 有 fork 原语，但只能整段 seed 前缀，无逐消息分支树**
- **session_query 五工具**（session-query/tool-session-query：session_search / session_event_search / session_trace / session_event_trace / session_event_read）：已实现「session 作为 context infra」的检索面。**但默认 bundle 不挂载**（--dump-config 验证：只有 session-query-sqlite 服务，无 tool-session-query）——agent-team preset 可以加挂
- **命令 shadowing**：command-compact 在 agent 上下文注册即可遮蔽（human rev 6281 说的机制成立）
- **agent/pre-step、system-prompt/assemble、tools.guard、agent/request-error**：rollover 插件用的全部接缝 dsh 都有

### agent-team 已有的相关机制
- **AutoCompactionCoordinator**（auto-compaction.ts）：验收 accept 后 200K 阈值触发 compactNow + steerPreCompaction 提示先行——已是「事件驱动的 compaction 时机」，但决策在 host 不在 agent
- **clearMemberContext**：renew session（dispose+archive+新建，sessionId 换新）——粗暴版"换窗"
- **preset compaction 组**：compaction-basic + command-compact + tool-result-pruner（8K 阈值），isolate 隔离

## 四、路线评估（供 human 与 Reeve 讨论）

### 路线 1：pi-context 式三工具（agent 主动管理）
- **可行性：中高**。checkpoint=自定义 session 事件或 label 映射；timeline=读 session log 投影渲染骨架+HUD（tokenMeter 有占用数据）；compact 的"从锚点分叉"用 surface replace（不是真树分叉——dsh 无逐消息分支，但 replace[start,end] + 保留 log 可以模拟"压缩到锚点"语义：从锚点后的段落替换为 summary 节点）
- 差异：dsh 线性 log，没有 pi 的真树——"回到未来"（无损跳回）做不到 surface 级，但整 log 保留意味着可以再 fork 出来（agents.create + seed）
- 工具数量：3 个都挂在 team-member preset 内（工具注册不走命令注册，更自然）

### 路线 2：codex rollover 式换窗（agent 主动 + host 兜底）
- **可行性：高**。obelisk-dsh-plugin 已证明全部接缝够用（blog 即实证）；我们不需要 obelisk——session_query 工具族就是回查面。差异点：需要 host 侧 budget 判定 + fallback 硬裁剪（tools.guard），这些接缝 dsh 全有
- 与 agent-team 的契合：member 是长生命周期 agent，跨 task 连续工作，换窗比压缩更贴合"task 边界"（一个 task 一窗，验收后 handoff 进下一窗）
- 关键问题：member 的 Team 身份/记忆（private memory、claim 状态）在换窗后如何延续——但这些都是 ledger/文件持久层，本就不依赖 session 内容，天然无碍

### 路线 3：混合（pi 的工具面 + rollover 的预算兜底）
- checkpoint/timeline 给 agent 结构感知（便宜、无模型调用）；compact 用 handoff 语义（四分栏证据分级）；host 保留 pressure 兜底（预算硬限制时强制，模型不配合时不死锁）
- pi-context 的取消检测（conversation advanced）+ codex 的安全边界（pre-step 替换）都是必抄的防御

### 已识别的分歧点（human 拍板项）
1. **单 session 深耕 vs 多 session 交接**（rev 7157 的问题）：pi/codex 都是单 session 内换窗/压缩；「新 session handoff」意味着跨 session 状态迁移，成本高但隔离彻底。倾向：先单 session 内（两条路线都支持），跨 session 是后续演进
2. **验收时机**（rev 6286）：accept 通知里加"建议 compact/更新记忆"引导——与现有 steerPreCompaction 同族，便宜可先做
3. **回滚需求强度**：真树（dsh 无）vs surface replace 模拟（够用）vs fork 逃生舱（agents.create seed）。pi 的"回到未来"在 dsh 上等价物=fork 出旧分支
4. **工具面语言**：pi 改名教训——避免 git 词，用 checkpoint/timeline/compact 这类对话原生词
5. **session_query 挂载**：无论选哪条路线，把 tool-session-query 加进 preset 都是「session=context infra」的基础设施（低成本高收益，可独立先做）

## 五、规模预估（定方向后）
- 路线 1/3（三工具）：新 src/agent-context-tools.ts（~400-600 行）+ preset 行 + spec 测试（checkpoint 去重/timeline 渲染/compact 两阶段+取消检测/边界不变量）+ persona 引导段。中等规模
- 路线 2（rollover）：协调器 + budget + fallback 裁剪 + preset。参照 obelisk 七文件结构，中等偏大
- 共同前置：session_query 挂载（1 行 preset + 验证）

## 六、Human 三分工方案与 Momo 分析（rev 7178 / 7180）

**Human 方案**：超阈值 200K → 借现有 compaction-basic 兜底；验收通知 → harness prompt 引导 agent 更新 memory/notes 后回 checkpoint（如第一次被 @mention 进 task thread 处）；全部发生在一个 session 内。问：还需要 agent 主动 handoff new_context 吗？

**Momo 分析要点**：
- 方案成立的深层理由：member 工作=task 切片，mention→验收天然是 continuation boundary；thread 汇报帖+memory = 分散版 handoff note（Team 机制分担了通用 new_context 要解决的状态保全）；codex new_context 的成本（budget+fallback+工具面）在 agent-team 场景收益比不高
- 前提：回 checkpoint 无现成工具但零件全——surface replace 公开原语可实现"X 之后全替换为注入消息"；append-only 保留=可查回（无损回溯的 dsh 等价）；规模中等
- 缺口①：compaction-basic 摘要的有损性不变，改法=摘要 prompt 加四分栏证据分级（一行改动），非换 new_context；缺口②：中途主动性靠 tool-result-pruner 先跑再看
- 建议清单：checkpoint 打点（近免费）/ 验收引导 prompt（同族 steerPreCompaction）/ rollback 工具（中）/ 四分栏摘要 prompt（可选）/ session_query 挂载（前置）
- 待拍板：rollback 执行者=agent 工具（主动，Momo 倾向+强引导）vs host 直接替换（强制）

## 七、Checkpoint 锚点机制定稿讨论（rev 7182 / 7185）

**Human 问**：有损性等价确认；rollback 给 agent、host 只通知，同意；checkpoint 不止 mention 进入点，也可是探索/重做节点；锚点维护选每个 tool call 还是 team ledger 基准（如 team_claim 状态）？

**Momo 建议（rev 7185）**：
- 锚点 = ledger 事件驱动的 host 打点 + agent 可补探索锚点。理由：语义密度（ledger 事件天然是可回卷边界，tool call 99% 是过程噪音）、成本（近零）、pi 的命名纪律佐证好锚点本来就是语义事件
- 锚点集映射：task 边界（mention 进/claim created/claim done/accepted，host 注入通知时顺手记 seq）；探索边界（agent 用 context_checkpoint 工具，语义化命名，禁流水号）
- 多 task 并行：锚点表按 (member, threadRef) 组织；回卷只允许"无 active claim 覆盖"区间——验收 A 的回卷不能吃掉进行中 B 的上下文
- 存储：无新存储，锚点 = (seq, 名称, 来源) host 侧映射；回卷用 surfaceOp replace
- 防御：pi 取消检测必须抄（turn 边界执行 + 替换前检查新锚点）；强制兜底不做（现有 AutoCompactionCoordinator 天然冗余兜底）
- 收敛形态七件套：host 打锚点 + agent 补探索锚点 + 验收通知回卷引导 + rollback 工具 + 取消检测 + compaction-basic 四分栏兜底 + session_query 挂载

## 八、Session 膨胀与滚动瘦身（rev 7187 / 7189）

**Human 问**：session 不断膨胀的影响？替换 dsh 自带 compaction（单独模型摘要，成本高效果差）→ 让 agent 写 handoff，但 session 不暴露给 agent，harness 自动建新 session 以 handoff 为首条 user_message 续跑；Client UI 随新 session 变化。session_query 本轮不落地。

**Momo 分析（rev 7189）**：
- 膨胀影响分层：模型成本已被投影管理（surface≠log）；真实影响=log 增长带来的 resume 全量 replay 变慢（阈值1）+ 回查噪声（阈值2）+ 摘要滚雪球（阈值3）。缓坡非悬崖，建议阈值触发非固定周期
- **关键洞察**：新 session+handoff 首消息 vs 原 session surface replace，模型视野几乎相同，差异全在记账层——前者 log 归零重计（治本），后者 log 继续涨（治标）。log 膨胀主诉求 → 新 session 对症
- 先例：clearMemberContext 已趟通完整生命周期（dispose→archive→新 sessionId 重建→activate→Client 归档可见性），renewMemberSession 是现成 ledger 操作，parentSession lineage 现成
- handoff 张力的解法：不暴露 session 概念，注入「移交请求」（task 语义），agent 写 team_thread 帖或工具调用，harness 拿来建新 session。免费收益：handoff 双沉淀（thread 公开 + 新 session 私有）
- 待拍板：①触发阈值（事件数+resume 耗时双指标 vs 固定周期，Momo 倾向前者）；②handoff 未交付时等 idle 边界 vs 强制降级 handoff（Momo 倾向等 idle，不打断工作流）
- 本轮范围修订：session_query 挂载移出本轮；锚点/回卷降级为可选（新 session 滚动瘦身是主诉求）

## 九、终局形态校准（rev 7192 / 7194）

**Human 校准**（Momo 此前两处误读被纠正）：
- 「不暴露 session」≠「不管理 session」：agent 有 new_context 声明（handoff），harness 承担建新 session/dispose 旧 session 等 side effect；agent 眼里只有一个连续"工作上下文"
- handoff 不进 thread（私有上下文移交，非公开汇报；"双沉淀"建议作废）
- 搜索工具 = member scope 统一检索面（agent 搜"我的经历"而非"我的 sessions"）
- **200K 不再 compaction，直接触发 agent handoff**——整个自动 compaction 层被替换，compaction-basic 可能完全不挂
- 是否开新 session human 未定，回来与 Reeve 进一步聊

**Momo 保留的坚持（rev 7194）**：强制路径不死锁——两层阈值+缓冲区。**Human 定稿（rev 7196）：降级路径直接复用自动 compaction**（compaction-basic 保留为最后防线，正常路径 handoff 优先、拒绝配合才落摘要压缩）——无需新造降级 handoff 组装逻辑。

**给 Reeve 的讨论清单**（按重要性）：①两阶段切换的边界选择（turn-stopping vs idle vs pre-step，实现风险最集中处）；②强制路径降级 handoff 内容（claims 快照/thread 通知/锚点表）；③旧 session archive 保留供回查；④handoff 首消息 plugin source 标记（Client 识别）；⑤与 progress nudge 的家族关系（机制复用 steer+notice+去重，语义分开）。

## 十、Reeve 独立核实与实测（rev 7230，推翻两个早期假设）

**机制真值（file:line）**：换窗必须两阶段是硬约束（index.ts:577 拒绝 running 换 session；runMaintenance 非 idle 同步抛错——模型调 new_context 时自己就在 running 相位）；obelisk 边界=agent/pre-step（turn-stopping 只做窄事：硬上限下 inject 续 turn 让下个 pre-step 有机会强制换窗）；工具只记意图（pending 状态由 session projection 从 tool/call+result 折出）；失败恢复有 preserveClaimedInput + WeakSet latch。

**实测（15 天 371 turn 最大 member session）**：log 73MB 解压/843K events（96.6% 是 assistant/chunk）；全量 restore 仅 1.4s、deriveMessages 0ms——**resume 慢不成立（Momo 假设1被推翻）**；26 次 compaction 摘要长度随机波动——**摘要雪球不成立（Momo 假设3被推翻，blog 的失败模式是内容质量非长度）**；真实成本=常驻内存 258MB heap/session（13 个 session 外推 776MB，进程 RSS 1.48GB）——**膨胀的本质是 heap，dispose 是唯一解**；11% 采样点越 200K（507/4632）——换窗是主路径高频操作非救场，handoff 质量决定日常体验。

**设计参数修正**：缓冲区不能按 per-step 增量算（max 单步 48K、turn 边界可跳 253K）；obelisk 默认 reserve policy 在我们的 route 上不可用（gpt-5.6-sol 会把 remind 阈值压成 0，无 maxTokens 的 route 直接 throw）——阈值必须自定且缺 maxTokens 时降级。

**新证据下的路线倾向**：新 session 证据强（dispose 释放 heap 是唯一解；clearMemberContext 全链路已趟通）。**待 human 拍板的障碍**：renewMemberSession 只收 human actor（ledger.ts:521 assertHumanActor）——模型触发换窗需新 actor 语义或新 operation kind。**后续纠错**：tool schema 并非永久冻结在 Session 创建时刻；同一 Session 的真实日志在 resume 边界从 6→7→9→10 个 `team_message` properties，说明新 Agent composition/resume 会重取 live tool providers。真正的更新边界是 live Agent composition，而不是 Session id。

**Momo 确认（rev 7232）**：两个假设认账；四分栏 prompt 工艺从降级项升回主路径设计项（高频换窗下 handoff 质量决定体验）。

**三组补充接缝证据（rev 7239）**：pre-step 是 waterfall 且可替换进入 step 的 messages（runtime-types.ts:227-238）；turn-stopping 是 serial 仅 turn 即将关闭时触发（:269-285）；compaction-basic 的 auto 同时注册 pre-step 压力 + request-error 溢出恢复，而 team-member preset 当前**未覆盖 auto**（agent.cordis.yml:77-95 无 auto 配置），所以 basic auto 与 Team 的 accepted-task `AutoCompactionCoordinator` 实际并存。真实日志的 30 次 compaction/start 中 25 次为 in-turn pressure/overflow、5 次为 standalone maintenance，证明 basic auto 才是主要 pressure owner。compaction 实测耗时 p50 84.6s / p90 118.5s / max 148.3s（LLM 摘要是一次模型调用），失败 4 次——**fallback 必须保留但要把 handoff 主路径与长 maintenance 隔离**（maintenance 期间 agent status=idle，member 显示 available 但实际不能工作）。

**Reeve 进度**：文档与完整七问判断在写；唯一 blocker=renewMemberSession human-actor 权限语义待 human 拍板。

## 十一、Reeve 七问结论（证据版，rev 7239）

本节是设计判断，不是实现承诺。证据优先级为当前源码/测试 > Harness 公共契约 > 外部 obelisk 先例 > 本报告的测量脚本；涉及 `../deepseek-harness` 的路径只作契约引用，本仓库不修改 Harness。

### 1. 真开新 Session，还是原 Session 内 surface replace？

**判断：主路径开新 Session；原 Session surface replace 仅作为降级 compaction 的内部机制。** 两种方式对模型可见消息都能实现“旧窗口被新 handoff 取代”：Session surface 的公开 `surfaceOp:{op:'replace'}` 会替换当前节点区间并递增 `replaceGeneration`（Harness `packages/core/session/src/surface.ts:330-380`），因此不是能力缺口。可是它不释放旧 Session 持有的事件对象：最大真实 Member 日志展开后 843,502 events，restore 约 1.4s，而 retained heap 约 250–258 MB/session；其中 assistant/chunk 约占 73%。13 个日志按实测比例外推约 776 MB，运行中的 `dsh --profile web-dev` RSS 约 1.48 GB。唯一有明确释放语义的路径是 `agent.dispose()`：它 cancel、等待 idle、dispose scope 并 detach（Harness `packages/core/agent-loop/src/index.ts:556-600`）；Session persistence 在 `session/disposed` 后也 retire/release retained state。故 surface replace 治标（模型 projection 变瘦），新 Session + dispose 才治 resident heap。

仓库已有可复用生命周期：`clearMemberContext` 先检查非 running，再 `renewMemberSession`，dispose 旧 handle、archive 旧 id、用新 id `activateMember`（`packages/agent-team/src/index.ts:567-614`）；`activateMember` 也已有 `parentSession` lineage（`packages/agent-team/src/index.ts:1141-1150`）。但新 Session 不是免费抽象：dispose 会清掉该 Agent owner 的后台 jobs（Harness `packages/jobs/jobs-local/src/index.ts:450-475`），Inbox 是 Session 的 replay projection 且 dispose cancel 会清除 queued messages；todos 为 Session-scoped、在 `turn/start` reset。Claims、attention/read watermark 以 memberId 与 `(memberId, threadRef)` 持久化，换 Session 不应丢失。新方案必须显式处理“哪些 transient state 要取消、哪些 durable Team facts 由 ledger 重读”。

### 2. 两阶段切换边界：agent/pre-step、agent/turn-stopping，还是 idle-after？

**判断：工具只声明 intent；`agent/pre-step` 负责测压/提示/硬限制，handoff 工具在成功 result 上 `concludeTurn()`，真正的 Session dispose/create 只能由 Host 在 idle-after 执行。** 这是新 Session 路线与 obelisk 原 Session surface replace 路线的关键差异。`agent/pre-step` 是 waterfall，handler 可 reject 或替换将进入 step 的 messages（Harness `packages/core/agent/src/runtime-types.ts:227-238`），因此它是注入一次性 handoff notice、检查 hard limit 与降级 compaction 的正确接缝；但在当前 Agent 自己的 pre-step handler 里 dispose/create 会等待该 driver 收敛，不能作为新 Session 生命周期边界。obelisk 能在这里完成 `surfaceOp:{op:'replace'}`，正是因为它不销毁 Agent/Session。

handoff 工具只校验正文、related files 等参数，让成功 `tool/call + tool/result` 被旧 Session projection 折成 pending，并调用公开 `ToolRunContext.concludeTurn()`。同批 sibling tool calls 已先结算，随后 turn 正常结束，Host coordinator 等 `agent.whenIdle()` 后经 lifecycle queue 串行执行 durable rollover operation → dispose old Agent → archive old Session → create new Session (`parentSession=old`) → 以 handoff 为 seed 首消息。崩溃恢复只需从旧 Session 的成功 tool result 和 rollover operation anchor 继续幂等完成，不把 handoff 正文写进 Team ledger。

`agent/turn-stopping` 是 serial，仅在模型没有 live tool/steer continuation、turn 即将关闭时 dispatch（Harness `packages/core/agent/src/runtime-types.ts:269-285`; loop `agent.ts:305`）。它既不执行 swap，也不承载长 maintenance；只保留一个窄 fallback：已到 hard limit、模型尚未产生 handoff 时，`inject()` 一次 next-step continuation 给予最后交接机会。仍无 handoff或 provider overflow 时走 compaction fallback。最终职责图是：`pre-step = pressure/gate`，`tool = durable intent + concludeTurn`，`turn-stopping = one-shot continuation`，`idle-after = lifecycle swap`。

### 3. 降级阈值与 AutoCompactionCoordinator 如何改造？

**判断：使用显式 token 数，不从 route 的 `maxTokens` 推导；采用“接近阈值提醒 → 200K handoff 主触发 → hard-limit/交接失败时 compaction 兜底”的三层策略。** 阈值依据 turn-level peak，而不是 per-step 增量：真实最大 Member 的 4,632 sampling points 中 507（11%）超过 200K，峰值 253,491；371 turns 中 67（18%）peak 超过 200K，14 个 contiguous >200K episodes；200K 以上 overshoot p90 34,445、max 53,491，且 turn boundary 曾一次跳 253,491。因而不把 200K 当“有充裕空间”的软提示；在请求会跨过阈值、而后续 step 可能继续增长的情况下，提醒必须提前且只发一次/每代一次。建议 `hardLimit = contextWindow - explicitOutputReserve`、`effectiveHandoffAt = min(200K, hardLimit - explicitFallbackReserve)`：200K 是容量足够 route 的产品触发点，小窗口自动提前。reserve 应由可配置 token 数表达并用 replay 校准（当前数据给出 output reserve ≥24K、handoff/fallback buffer 约 40–56K 的起始量级），不能采用 obelisk 默认 `outputReserveTokens = maxTokens`：实测输出 p99.9 约 5,285、最大 16,425，路线 `gpt-5.6-sol` 的 contextWindow 272K/maxTokens 128K 会算出 hardLimit 144K、baseLimit 16K、reminder 0；缺 `maxTokens` 的 route 还会 throw。另有 route 报 provider `inputTokens:0`，所以不能只依 provider usage；使用 token-meter/request-context 的 cache-inclusive 测量，必要时以请求上下文估算。

阈值策略应按 generation/session 维护去重状态：near-limit 一次性 notice（source 带 generation）；成功 handoff 后清除；失败/硬上限进入 fallback。Fallback 不另造一套 summary owner，而是改造 `AutoCompactionCoordinator` 为每 Member 管理 pending、idle fence、measure、compact/retry/failure 与恢复；它现在只在 Human accept 后调度、等待 idle、严格 `>200,000` 才 `compactNow`（`packages/agent-team/src/auto-compaction.ts:7-18,49-161`）。正常 handoff 的 pending/threshold driver 应接入同一个 coordinator 的 Member-keyed state，但 handoff 主路径必须不等待 80–148s 的 summary maintenance（真实成功 compaction 26 次，p50 84.6s、p90 118.5s、max 148.3s）。

关键排他性：`compaction-basic` 一个 `auto` flag 同时注册 `agent/pre-step` pressure hook 与 `agent/request-error` context-overflow retry（Harness `packages/compaction/compaction-basic/src/index.ts:127-224`）；team-member preset 当前没有 `auto:false`（`packages/agent-team/preset/team-member/agent.cordis.yml:77-95`）。因此 Team rollover owner 不能与另一个 automatic pressure owner 无条件共存；要么由 Team 明确接管 pre-step pressure、关闭 basic auto 并保留/重建 overflow recovery，要么接受其 hook 先运行并设计清晰的 pending/replace generation 去重。外部 obelisk 的 compatibility assertion 将 automatic surface-pressure owner 视为 exclusive，这个冲突必须在实现前决策，不能靠 listener 顺序猜测。

### 4. 旧 Session archive 而非删除？

**判断：archive，不删除；并把新 Session 的 `parentSession` 指向旧 id。** `workspaceRegistry.archiveSession` 要求 id 在 live 或 persistence 中存在、写入 registry-global archive set，且保留 workspace accounting/可恢复位置（Harness `packages/workspace/workspace/src/index.ts:227-267`）。当前 clear 流程正是 dispose 后 archive（`index.ts:598-607`）。删除会破坏 handoff 事故调查、人工回查、跨窗口 provenance，也与“模型只看连续工作上下文、Host 保留历史”相冲突。归档应是可见性策略，不等于物理擦除；保留稳定 id、header lineage，并为回查提供明确“旧窗口”关系。一次 Member 只显示当前 Session，旧 id hidden，避免 UI 将每次 rollover 当成额外活跃成员。

### 5. handoff 首消息的 plugin source 与 form 如何让 Client 识别？

**判断：首消息使用现有 semantic form，不新增 Harness `form`；优先声明 Team 自有 source kind，或短期复用现有 plugin kind，但必须携带 version 与结构化 handoff 字段。** `ContextForm` 是闭合但可扩展的语义 union，Client 已知 `snapshot`/`notice` 等形式；`snapshot` 要求非空 `sections[{name,text}]`，`notice` 只要求 `summary` 不超过 120 字。由于 Handoff 本体包含四象限证据、旧/新 Session anchors、related files、generation 等 metadata，推荐声明 `MessageSourceMap` 自有 `kind`（遵循 `session-reference` 的 `declare module` 先例），沿用 `form:'snapshot'`、`version:1`、`sections` 作为主载荷，附加 `sessionId`, `previousSessionId`, `handoffStatus`, `trigger`, `relatedFiles`。这样不修改 Harness；Client 对未知 kind 仍可见并按 kind 标注，已知 form 字段不合约时才 opaque。若当前 package ABI 约束不允许新增 kind，则 fallback 为 `{kind:'plugin',plugin:AGENT_TEAM_PLUGIN_ID,form:'snapshot'}`，不要伪装成 `notice`（notice 的 ≤120 summary 不适合正文）。首消息只进新 Session surface，不进 Team Thread；它是 private context handoff，不是公开协作事实。

四象限正文应由稳定 prompt contract 约束，而不是把模型推断伪装成 Host facts：`SPEC-CONFIRMED REQUIREMENTS`、`AGENT INFERENCES`、`UNRESOLVED CONFLICTS`、`UNVERIFIED ACCEPTANCE CRITERIA`。每项给出处/置信度；Host 只追加可验证 envelope（旧/新 id、trigger、generation），不替模型重写 handoff。handoff 为空或 schema 不合格时视为 missing，走 forced fallback；不要将任意自然语言当成已验证事实。

### 6. 与 progress nudge 的家族协调

**判断：机制复用，语义分开；复用 `steer/inject`、notice source、per-member dedupe/revoke、以及 session-generation reset。** progress nudge 已按 `(memberId, sessionId)` 管理 silent tool-call 梯度、每 turn 最多一次、可撤销 pending notice；Inbox/recovery 也已形成优先级链（`notifyMember` recovery > Inbox > progress nudge，`packages/agent-team/src/index.ts:1308-1343`）。Context pressure/handoff 应是第四类 lifecycle/maintenance notice，不能复用 progress 的 thread ladder 或把“需要换窗”伪装成“进度提醒”。

在每个 Member 状态中增加独立的 context-window state（pending intent、generation、reminderClaimed、handoff status、fallback claimed、last measured pressure），清理/替换时按新 Session id 重置 transient state；通知协调器只负责互斥与去重，建议排序为 recovery > handoff > Inbox > progress nudge。handoff tool 成功或 rollover coordinator claim pending 后应 revoke 同一代剩余 nudge；换窗时 queued Inbox 不能无条件复制到新 Session，必须由 ledger notification facts 重新生成，避免 stale duplicate。所有延迟 steer 均采用成功后提交、取消/失败清理的模式。

### 7. multi-task 并行 edge case：锚点按 `(member, threadRef)`

**判断：不可用单一 Member checkpoint。** 一个 Member 可以并行持有多个 Claim；ledger 的 lifetime claim 判定已按 `claim.owner === memberId && claim.taskRef === taskRef`（`packages/agent-team/src/ledger.ts:597-602`），attention 的 key 也明确由 `(memberId, threadRef)` 组成（`ledger.ts:1894-1902,2273-2281`），这说明 thread 维度是现有事实模型的自然粒度。handoff schema/prompt 需要为每个 active Claim/Thread 生成独立锚点条目：`memberId, threadRef, taskRef?, claimRef(s), claimStatus, lastReadThrough, newestSequence, pending/unread counts, relevant session event range`；共享的 session/generation 只作为 envelope，不能把一个 task 的 checkpoint 当成全员单一游标。

切换时，Host 不向 Thread 写 handoff；新 Agent 首消息读取 handoff 中的锚点表，再通过 `team_inbox`/`team_thread` 重新取得当前 durable facts。若一项任务在 handoff 生成后被 Human 接受、Claim 被释放或 Thread revision 变化，旧锚点只是 stale hint，不应覆盖 ledger；模型必须以当前 Thread revision/read result 为准。若多个 task 同时触发，合并为一份按 `(member, threadRef)` 去重的 handoff，保留每项 latest revision，而不是启动多个 Session rollover；若某项没有 active claim，只能进入“unresolved/verification”区，不能凭旧记忆继续宣称 owned。

### 实施前必须由 Human 决定的两项

1. **权限语义**：`renewMemberSession` 当前在 `ledger.ts:521` 强制 `assertHumanActor`，且 `types/entities.ts:40-53` 没有 host/system actor。自动 rollover 不应复用 `agentTeamHumanActor()` 冒充 Human；建议新增 `team/member-session-rolled-over` operation，并在审计中分别表达 `requestedBy = member/model | hard-limit policy` 与 `executedBy = host`。具体是扩 Actor union 还是把 initiator/executor 放进该 operation 的结构字段，仍需 Human 决定。
2. **basic auto 的所有权切换**：建议关闭 `compaction-basic.auto`，由 context coordinator 独占 pre-step pressure 与 `agent/request-error` overflow recovery，但继续复用同一个 CompactionEngine implementation。单一 owner 更可证明，也避免两个 auto handler 靠 listener 顺序竞争；不能为独占而粗暴丢掉最后的 overflow 防线。

## 十二、Human rev 7263 后的减法版产品设计（256K + checkpoint）

Human 明确：context 产品最大线取 256K，届时自动 compaction 兜底；需讲清 Agent 自管理的产品效果/触发/edge cases；checkpoint 回到过去不能遗漏；避免过度设计；权限由 Reeve 决定；自管理落地后移除“从全新上下文开始”按钮。

### 最小产品形态：3 tools、2 条主动路径、1 条兜底

```text
主动 A：new_context(handoff)                         → 全新 generation，日常低成本路径
主动 B：context_checkpoint → context_timeline
        → new_context(handoff, checkpointRef)        → 从过去锚点建立 continuation
兜底：  effective context >= 256K                    → Host 自动 compaction，仍在原 Session
```

只暴露三个工具：

1. `context_checkpoint({name}) -> {checkpointRef}`：创建语义锚点。
2. `context_timeline({limit?})`：返回 bounded 骨架和当前 usage；每项包含 opaque ref、名称/来源、预计保留/丢弃 tokens、受影响 active Threads。
3. `new_context({handoff, checkpointRef?, relatedFiles?})`：唯一 lifecycle mutation；无 checkpoint 为 fresh，有 checkpoint 为 return-to-checkpoint。

不另设 `context_checkout` 或 model-facing `context_compact`。256K compaction 是 Host safety policy，不让模型在两个近义“整理上下文”工具间选择。

### 预算与触发

```text
effectiveHardLimit = min(256K, routeContextWindow - safeOutputReserve)
effectiveHandoffAt = min(200K, effectiveHardLimit - handoffReserve)
```

- 200K：每 generation 一次强 handoff notice，默认建议 fresh `new_context`。
- 256K（或 route-safe 更低线）：pre-step 不再发不安全请求；无有效 handoff 时调用 CompactionEngine。provider 更早报 overflow，则同一 coordinator compact + retry。
- 语义触发：高噪声/高风险探索前 checkpoint；失败路径稳定后 return；稳定 phase → 已知 next phase 时 fresh；切换不相关 Thread/Task 前 checkpoint。刚交付且等待 Human 追问/验收时不整理，保留 raw trail。

### Checkpoint 定义与 safe boundary

**Context Checkpoint** = Member 私有 context lineage 上一个 completed-turn continuation anchor，只定位 conversation，不回滚外部状态。DSH 的 fork seed 必须是 completed-turn prefix（Harness `packages/core/session/src/index.ts:1131-1203`; session-controller `commands.ts:213-250`），故显式 checkpoint tool 成功后：

```text
successful tool result → opaque checkpointRef → concludeTurn()
→ anchor 绑定该 turn/end → quiet follow-up 在下一 turn 自动继续
```

若与 sibling calls 同批提交，锚点包含同批全部结果；prompt 要求精确锚点时单独调用。timeline 候选由现有 log/ledger 投影，不建第二 authority：Agent 显式 checkpoint、Team 语义边界（mention/claim/accept）、handoff/compaction 边界、HEAD。名称供阅读，opaque ref 供选择。

`new_context(..., checkpointRef)` 从该锚点 source Session 的 prefix 创建 seeded child，handoff 作为后继首消息；`parentSession` 表达 seed 来源，rollover operation 另记 previous active generation。它保留 checkpoint 前 raw context，所以成本高于 fresh；target 仍接近预算时拒绝并建议 fresh。v1 不做完整 Session tree UI、任意 message checkout、return-to-future/sibling navigation。

### 外部状态与 multi-task guard

Context navigation 永不修改/回滚文件、git、进程、browser、Team ledger、ticket/remote side effects；handoff 必须写明 checkpoint 后的当前外部状态和验证结果，新 Agent 先核实再继续。

锚点/影响按 `(memberId, threadRef)`。若 return-to-checkpoint 会跨过另一个 active Claim 的上下文，timeline 标记，mutation 拒绝；应改用覆盖全部 active Claims 的 fresh handoff。这样 task A 回卷不会悄悄吞掉 task B。

### Prompt 形态

不用 15K 大 skill；使用三层短文本：

1. 常驻 guidance（约 180–250 tokens）：working-set 思维；何时 checkpoint/timeline/new_context；context operation 不回滚外部状态；等待 review 时不整理。
2. 200K 一次性 notice：usage/256K、active Claims、running jobs、默认 fresh、必要时 timeline。
3. 新 generation 首消息：一个 prose handoff，至少覆盖 current objective/all active Threads、verified evidence、inferences/conflicts、external side effects/verification、explicit next step。Host 只添 ids/trigger/checkpointRef 等可验证 envelope。

### 产品表现与 Client continuity

- Sidebar 始终是同一个 Member；rollover 期间保持 working/“整理上下文”，不闪成 available。
- Human 正在看 previous active context 时，Client 根据 rollover old→new mapping 自动打开新 id；若在看更老 archive，则不跳。
- 新 context 首屏显示 `agent-team-context-handoff` source + existing `snapshot` form 的 handoff 卡；旧 context archive 可回看。
- rollover 失败保留旧 Session 并显示 error；不出现空白新会话。
- 删除 row menu 的“从全新上下文开始”；自然语言要求由 Agent 调 `new_context`。错误恢复继续使用 Recover/Restart。Host `clearMemberContext` remote 可先作为迁移期隐藏 escape hatch，成功验收后再删，不再是产品按钮。

### Edge cases

- 200K notice 被忽略：256K 自动 compact。
- 有 running background jobs：正常 rollover 拒绝并要求 collect/stop；逼近 hard limit 时 compact，不静默 cancel job。
- tool success 与新 Team 消息竞态：冻结旧 Agent next admission；新 Agent 从 ledger 重算 Inbox，不搬 stale queue。
- Host 在 tool result 后 crash：callId 派生稳定 request/new id，pending projection 重放后幂等续做。
- checkpoint 后 conversation 继续推进：对 anchor/head 重新校验；陈旧 intent 取消并要求 timeline 后重试。
- target 保留量太大或跨 active Claim：拒绝 checkpoint 路径，建议 fresh。
- compaction 失败：保留旧 Session，Member 进入 error，不删除/伪装成功。

### 权限决策（Reeve）

新增 `team/member-session-rolled-over` operation；actor 是调用工具的 Member，ledger 验证 `actor.memberId === target memberId` 且仍绑定当前 live Session。Host 是执行器而非业务 actor。256K 无 handoff时只 compaction、不 rollover，故 v1 不需要 Host/system actor，也不复用 `agentTeamHumanActor()` 冒充 Human。

