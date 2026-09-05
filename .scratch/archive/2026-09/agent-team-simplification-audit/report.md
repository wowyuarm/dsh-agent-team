# dsh-agent-team 简化与结构审查报告

日期：2026-09-05 · HEAD：`e2dad2a` · 基线：296 tests passed / 1 skipped。

**Headline：1 处可删（e2e 脚本未用变量），2 处边缘级清理候选；文件/导出粒度零死代码，ledger/Thread-page/全部 5 处预留 seam 经消融证据维持不动——与 2026-08 裁决完全一致，无需任何结构级 Task。**

## 排序清单

| # | 位置 · 删什么 · 替代方案 | 证据类型 | 风险 |
|---|---|---|---|
| 1 | `scripts/team-ui.e2e.ts:320` · 删除整行 `const reviewerMember = ...` · 无需替代，声明后零使用 | 静态（oxlint 警告 + grep 全文件仅 1 处出现） | 无 |
| 2 | `sidebar-order.ts:19` 与 `sidebar-drag.tsx:14` · 两处重复定义 `type SidebarDropMarker = 'before' \| 'after'` · 删 sidebar-drag 的定义，从 sidebar-order import | 静态（export 扫描 + 人读确认） | 极低：1 行 union type |
| 3 | `TeamComposer.tsx:193-227` · `selectOption` 的 @all 分支与成员分支共享尾部（insert/caret/recipients/setMention/RAF focus，约 8 行×2）· 提取组件内 `commitMention` helper | 静态（jscpd 60-token 克隆 + 人读） | 极低：纯组件内重构，RAF focus 时序保持 |
| 4 | `.jscpd.json` `threshold: 1` · 实测重复率 1.75%，`npm run duplication` 永远以非零退出，作为 2753090 引入的 gate 已失效 · 阈值调到 2（实测 1.75% 之上留回归余量） | 静态（实测） | 无（不动代码行为） |

**边缘候选，倾向不做：** `team-ui.preview.ts:2-18` ≡ `team-ui.ui-preview.ts:3-19`（17 行相同前导）——两个都是占位符模板入口，抽公共 helper 省 ~15 行但给模板上下文增加跨文件依赖；文件总共 26/43 行，不值得。TeamChannelsPanel/TeamMemberEditor 的 15 行 modal-save 信封克隆同理。

## 消融证据（校准后）

仪器：couple-map + 入口可达性 + 逐 export 消费扫描（dsh 适配版，本目录 `instrument/`；
机器上不存在假定的私有 dsh-ablate.mjs）。校准发现 worktree 陷阱（详见 README）：
唯一正确做法是 worktree 建为仓库兄弟目录；对照实验（零干预）校准后 296/0 与主
checkout 基线完全一致。

| 靶 | 操作 | 结果 | 结论 |
|---|---|---|---|
| 对照（无干预） | 仅 worktree+跑套件 | 296 passed / 0 failed | 仪器有效 |
| `timeline-scroll.ts`（闭包 9 文件） | 真删 | 余下 247 passed / 0 failed | 无静态闭包之外的动态触点；但它是 2 个页面的承重 hook，**不动** |
| `ProgressNudgeCoordinator.maybeNudge`（打桩 throw） | stub | 274 passed / 22 failed，失败精确落在 progress-nudge.spec + member-lifecycle.spec | 运行时足迹与静态 fan-in 一致，无隐藏耦合面，**不动** |

## 「不动」清单（本次重新验证过）

- **ledger.ts（3353 行）**：仅 index.ts + 4 个测试文件引用；39 方法 authority 闭包裁决维持。
- **TeamThreadPage（790 行）**：513-583 的「最大克隆」实为同一变更信封（幂等 requestId
  簿记 + committed/unread_required/stale 三分支）套不同 RPC；2026-08 的 locality 裁决
  不排除组件内提 helper，但信封只有 2.5 个调用点，提取收益低于间接成本。
- **occurredAt 规范化 / `team/member-context-cleared` legacy 操作**（ledger.ts:1618/2140）：
  170 legacy anchor 政策未变，维持。
- **静态零 fan-in 的全部「死文件候选」均为动态入口**：`preset-roster.ts`
  （cordis.patch.yml:9 按名加载）、`member-context.ts`（preset/team-member/agent.cordis.yml:65）、
  `invariant.ts`、`client/index.ts`、`tool-agent-team/index.ts`（package.json 子路径导出）、
  `css-modules.d.ts`（`*.module.css` 环境声明，tsc 必需）。
- **`mountMemberSkillProvider`**：命名空间 import（member-runtime.ts:195 ← index.ts:1151），
  静态扫描盲区，实际有完整调用链，且是 5 处 "Deliberate interface reservation" seam 之一
  （spec.ts:62、member-skills.ts:8、member-runtime.ts:75/104、entities.ts:74）。
- **Runtime Revision 预留注释**「no UI writes it today」与代码一致（client 无写点），无 doc rot。

## 结构层

**无提案。** 三层证据全部指向同一结论：文件粒度可达性零缺口、导出粒度零死代码、
消融无隐藏耦合。唯一超过 1000 行的文件（ledger.ts、index.ts）都受 2026-08 裁决约束
且无新证据推翻。`member.model` 可选与 attachments 可选属现行语义（裁决已确认非兼容残留）。

## 落地记录（同日代码提交）

- #1/#2/#3/#4 全部实施并通过 typecheck + oxlint（0 警告）+ vitest（296 passed /
  1 skipped，与基线一致）+ duplication gate（24 clones，1.69% < 2，首次通过）。
 TeamComposer 克隆与 SidebarDropMarker 类型重复在克隆统计中消失（25→24 clones）。
- test:browser 未跑：改动为零行为意图的内部重构与脚本清理，按批量发布节奏由
  dev profile 日常通道覆盖（AGENTS.md「narrowest applicable check」）。
