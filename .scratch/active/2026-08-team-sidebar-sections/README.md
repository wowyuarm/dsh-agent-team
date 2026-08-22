# Team 侧栏分区化（M1 + M2 已落地）

## 状态

M1（分区化侧栏）与 M2（编辑语义 + 模型固定 + 卡片跳转）均已实现并通过全部检查；本工作项完结，结论已迁入正式文档。

最后核对：2026-08-22。

## 已落地

1. **M1（纯客户端，见 git 历史(fd6131e)）**
   - 宽屏侧栏：工作区列表 + 「频道」「Agents」两个常驻可折叠分区替掉原双 tab（`TeamSidebarSection`）。
   - 频道行 `#` 标识 + hover/focus 行级 ⋯ 菜单；Agent 行复用会话头像语言 + presence 角标。
   - 分区头刻意安静；窄屏 rail 两图标改为「请求展开并聚焦对应分区」。
2. **M2（Host update 操作 + 编辑器 + 跳转）**
   - Ledger 新增 `team/channel-updated`（全量 channel 快照）与 `team/member-updated`（全量 member 快照），镜像 suspend/resume 的快照风格；顺序回放校验通过，actor 句柄快照在改名后仍历史有效。
   - `AgentTeamAgentMember.model?: {provider, model}`：缺省 = 每次激活继承 `agentDefaultModel.currentSelection()`；对活跃成员改模型由 Host 在 `enqueueLifecycle` 内 dispose 后同 sessionId 重激活——立即生效，无需重启 Host；纯展示编辑不重启。
   - Remote 新增 `updateChannel` / `updateMember`（幂等 request 同载荷复用、漂移即碰撞报错）；typert 重新生成。
   - 编辑器对话框：名称/说明输入框 + 保存 dirty 门 + 成员字段集；模型选择复用公共 `Menu` 原语（Input 形态触发钮 + provider 分组 + 选中尾勾），目录经宿主级 `llm.models` RPC 取得（不依赖任何会话状态，error 成员也可编辑）。
   - Agent 卡片跳转：行选择钮先 `leaveTeam()` 卸载全部 Team 影子，再 `sessions.open(memberSessionId)`。注意 DSH 对无人类发言的空白会话渲染 hero 形态（带该会话 workspace/preset chips），e2e 以 preset chip 断言落点。
   - handle 可改：NFKC/大小写不敏感唯一性排除自身；@提及 为结构化 memberId 引用，展示期解析句柄，改名安全。

## 关键取舍记录

- 不复用 `session.selectModel`：该 RPC 有全局默认副作用（`defaults.saveDefaultModelSelection`），与成员级覆盖冲突；成员目录改走 host-scoped `llm.models`。
- 模型下拉不用原生 `<select>`，按用户要求对齐 DSH 已有 `Menu` 下拉语言。
- 清除模型覆盖必须显式 omit 键再展开（`...prior` 会把旧 model 带回）——单测曾抓到该回归。

## 结束条件（已满足）

update 操作贯通 types → ledger → Host → remote → 投影；编辑器字段点亮；单测（ledger update ops + lifecycle 立即生效 + 客户端编辑器/跳转）与浏览器 journey 全绿；正式文档同步。

## 正式文档出口

- UI 合同：`docs/frontend-design.md`「侧栏工作区浏览器」一节。
- Client 工作流与 Host 接口清单：`packages/client-agent-team/README.md`（及 zh 版）。
- 行为以源码为准：`packages/agent-team/src/`（types/spec/ledger/index）、`packages/client-agent-team/src/client/`（`TeamWorkspaceBrowser` / `TeamChannelsPanel` / `TeamAgentsPanel` / `navigation.ts`）。
