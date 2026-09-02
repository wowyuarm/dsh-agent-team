# Persona/member-context：引导 Member 认识与管理私有空间

Status: done (2026-09-02, Tars — persona 四要点 + member-context skills 路径行完成)

> 新增 ticket（2026-09-02，Human 提出：prompt 层带进本轮）。基于 Vera 的实测反馈（DM 采集，见 prototype-findings Round 3 附注）优化措辞。

## Goal

通过 team-member preset persona 与 member-context 的路径注入，引导每个 Member 认识自己的私有空间（`$DSH_HOME/agent-team/members/<id>/` 下的 memory.md、notes/、skills/）是它自己的 workspace：可以放自己的 skills/tools、自主管理、按需读取，并知道怎么装 skill、什么值得沉淀。

## 内容要点（2026-09-02 Human 终稿方向）

1. **物理事实**：私有空间的确切绝对路径（member-context 注入路径行）；memory.md / notes/ 已存在，skills/ 是自己的能力目录；用 fs 工具直接读写即可，无特殊通道。**绝对路径提醒**：cwd 是 workspace repo，相对路径全解析到 repo——私有空间必须走注入的绝对路径。
2. **装 skill 的具体操作**：SKILL.md 格式（YAML front matter name/description）、放到自己 skills/ 下、watcher 自然发现（03 的端到端测试提供"装完怎么验证"的实测表述）。
3. **沉淀标准（Human 修正）**：私有空间收的是**可复用资产**——可复跑的脚本、被索引、以后能用上的笔记，沉淀成 notes 或 skill 并在 memory.md 登记索引（Vera 的分层范本：notes=知识 / obs-scripts=复跑工具 / repo scripts=正式交付）。repo 只留正式交付是仓库要求；私有空间的准入标准是"以后用得上"，不是"一次性"。
4. **不做显式 skill 工作流触发引导（Human 指示）**：不写"某职责先加载某 skill"式的流程说明——旧 skills 的 use-when-user 触发词与 Team 场景（成员 agent 自主决定做什么）不匹配，显式工作流反而生硬。persona 只讲清空间与装法，用不用由 Member 按任务自主判断。

## Files / Areas

- `packages/agent-team/preset/team-member/agent.cordis.yml`：persona 文案。
- `packages/agent-team/src/member-context.ts`：私有路径注入行（含 skills/）。
- `packages/agent-team/tests/`：member-context 注入断言更新。

## Acceptance

- member-context 注入含 skills/ 路径行；persona 覆盖上述四要点。
- 03 的端到端自装用例与 prompt 引导表述一致（装法/验证法对得上）。
- 既有 persona 内容（Team 协作协议、DM 引导、memory 纪律）不回归。
- 验证含一次真实"按 prompt 引导自装私有 skill 并被发现"的用例（可集成测试模拟）。

## Outcome（2026-09-02 实施记录）

- **persona 段**（preset yml，替换原 private memory 段）：四要点按 Human 终稿方向落成一段完整引导——
  1. 物理事实：私有空间绝对路径由 member-context 注入、cwd 相对路径陷阱提醒（"always use the injected absolute paths"）；
  2. 装 skill：写 SKILL.md（YAML front matter name/description + 正文）到 skills/，"catalog discovers it automatically within its filesystem-watch window, so a later catalog query lists it"——与 03 端到端实测的发现时序（200ms 稳定窗 + 下一查询）表述一致；
  3. 沉淀标准：可复用资产（"a re-runnable script, a note a future task will consult"）进私有空间并在 memory.md 登记索引；"the repository receives only formal deliverables" 仓库要求单列；一次性产物两边都不收；
  4. 无显式触发工作流："Whether to use any installed skill is your own judgment per task — nothing requires loading one."（Human 指示：use-when-user 触发词与成员 agent 自主场景不匹配，不写流程化触发）。
- **member-context**：注入块（renderMemberMemory 与 unavailable 两处）加 `Private skills directory: <path>/skills` 行——03 已落地，05 验收的"路径行存在"由新增测试断言锁定。
- **测试**：member-context.spec 新增 skills 路径行断言；shipping.spec 新增 persona 四要点关键词断言（absolute paths / SKILL.md / YAML front matter / formal deliverables / own judgment per task）。
- **验收对照**："真实自装并被发现"用例即 03 的端到端测试（vi.waitFor 发现 + get 加载），prompt 表述与该实测时序对得上；既有 persona 内容（Team 协作协议、DM 引导、memory 纪律）原样保留在前后段。
