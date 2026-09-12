# C 桶 — 看起来能删但应当保留

这一册不产生 ticket。它的作用是防止 0.1.11 为指标做表演性删除：下列每一项都有明确的保留理由，
每条都指向具体证据（测试、契约、或既有结论）。**要删其中任何一项，先推翻这里的理由，不要只引用数字。**

## §1 — `legacy|backward|compat|fallback|deprecated` 89 处命中

判定：**基本全部保留。** 这是本轮最典型的假线索：关键词命中高，可删的几乎为零。
分布（2026-09-12 实跑）：`session-remediation.ts` 33、`ledger.ts` 16、`member-runtime.ts` 12、
client `team-formatters.ts` 9、`TeamMessage.tsx` 4、`context-source.ts` 3、`context-projection.ts` 3，
其余零散。逐类理由：

- **legacy Session artifact remediation（`session-remediation.ts` 全部 33 处）。**
  读取并就地修复 0.1.10 之前的 Member Session 产物（legacy envelope kind、
  `agent-team-context-handoff` / `-continuation` 源类型）。这是「老数据还要能读」的路径，
  删掉等于让已存在的本地 Session 直接读不出来。`tests/session-remediation.spec.ts`（389 行）正是它的契约。
- **legacy ledger 记录重放（`ledger.ts` 的 legacy 归一化）。** 本地账本存在真实的老记录
  （上一轮质量审计记录：本地有 170 个 legacy occurredAt 锚点；`ledger.ts` 里有 in-place clear 的 legacy 审计记录、
  acceptance discriminator 之前的旧 accept、Channel 归档的 legacy cleanup 修复路径）。
  这些是**读取路径**，不是兼容层残留：删掉就重放不了自己的历史。`agent-team.spec.ts` 里有多条
  「cold-replays a legacy …」用例专门守着它们。
- **legacy 内存目录迁移（`member-runtime.ts`）。** 从冒号目录迁到净化路径的一次性迁移，幂等；
  安装过旧版本的机器仍在走这条路。删掉会让老成员的内存目录找不到。
- **legacy 工具名解码（`context-projection.ts`）。** `new_context` → `context_rollover` 改名后，
  历史记录里仍是旧名；解码器要同时认新旧。
- **`fallback` 家族（client）。** `fallbackNames` / `fallbackRefs` 是消息渲染的**兜底 chip 行**
  （没匹配上 mention/ref 的名字与 ref 落到尾部展示），是领域概念不是兼容层；
  `ledger.ts:2632 occurredAtForFactFrom(..., fallback?)` 是显式的兜底时间戳参数。
- **`compat` 字面命中** 多为文档引用（`docs/dsh-release-compatibility.md`）与一句注释，无代码可删。

## §2 — scripts 的两个 preview harness（jscpd 的 scripts clone）

`scripts/team-ui.preview.ts` ↔ `scripts/team-ui.ui-preview.ts`（17 行/141 tokens）看起来是「一份实现两种叫法」，
实际不是：

- **两种模式是产品决策**：`npm run preview` 用真实 DeepSeek adapter、缺凭据即失败；
  `npm run preview:ui` 用 keyless fixture、不触发模型。`docs/development.md`（第 69–74 行）与两份 README 都成对记录了它们，
  并把「不会静默切换到 replay」写成契约。删掉任一个都是删功能。
- **共享那 17 行在技术上不可共享**：这两个文件是**模板**——`run-preview.mjs` / `run-ui-preview.mjs`
  读它们、替换 `__TEAM_ROOT__` / `__OVERLAY__` / `__HOME__`，然后写进 Harness 检出目录当 e2e 用
  （`apps/web/tests/__external-agent-team-preview.e2e.ts`），在那里 import 的是 **Harness 自己的**
  `apps/web/tests/scaffold.ts`。也就是说它们运行在别人的仓库里，无法 import 我们仓库内的共享模块。
  为了消 17 行重复而引入第三个被复制过去的产物，只会把耦合做得更深。

## §3 — 静态「无 importer」的文件（knip 类工具的假阳性）

按 basename 反查 import 时，这些文件看起来没人引用：`invariant.ts`、`member-context.ts`、
`member-time-context.ts`、`preset-roster.ts`，以及各包的 `index.ts`。**全部保留**，它们都是动态入口：

- 四个模块都是 **Cordis companion plugin**，各自导出 `name` / `apply` / `inject`，由
  `cordis.patch.yml`、preset 或 `package.json` 的 `exports` 按**字符串名**挂载
  （`./invariant`、`./member-context`、`./member-time-context`、`./preset-roster`）。
- `invariant.ts` 还挂着一个真实消费者：`tests/change-scopes.spec.ts` 通过 `dsh-invariants` 注册它，
  每次 commit 跑 `validateLedger()`。
- 各包 `index.ts` 是 `exports` 的落点，静态扫描天然看不到。

注：本项与上一轮质量审计的结论一致——静态死代码工具在这个仓库不可作为删除依据，必须先做运行时验证。

## §4 — `use-sync-external-store` 开发依赖 + Vitest alias

源码里 `from 'use-sync-external-store'` 命中 **0** 次，看起来是纯冗余依赖。**保留。**
`vitest.config.ts:37` 把它 alias 到本地包，Harness 的 `ui-renderer/bind` 在装配后的 Client 测试路径上
通过这个 shim 解析 selector；上一轮质量审计已经记录过：删依赖或删 alias 会导致 React hook dispatcher 失败
（`.scratch/archive/2026-08/agent-team-quality-audit/report.md`）。版本还被刻意钉在 1.2.0。

## §5 — `spec.ts` 里 24 处 `...operationBase` 外壳

看起来最诱人：一个 `operation(kind, data)` helper 能干掉二十多行。**不要做。**
`kind: z.literal('team/...')` 是 discriminated union 的类型收窄来源；把 kind 变成 helper 参数后，
推断出的是宽化的 string literal，union 收窄与 `AgentTeamOperation` 的类型完整性都会退化（或需要引入泛型机制来救）。
用一个带泛型的 schema 工厂去省声明式样板，是把类型确定性换成行数——与仓库「不要投机抽象」的护栏相反。
真正安全的那部分（四个离场 data 的五个共同字段）**已作为第 11 项实施**（`releaseSnapshotFields`，2026-09-12）：五个字段只剩一处定义，
四个 schema 各自保留 `kind` 字面量与 `.strict()`，`typecheck` 与冷重放均绿——这也反证了本条判断：**能安全复用的正是那五个字段，不是那 24 处外壳。**

## §6 — `ledger.ts` 不拆模块

3673 行、10 处内部 clone，看起来是拆包首选。**模块边界不动。**
上一轮质量审计已结：`ledger.ts` 是一个 39 方法的闭包，拆出去会引入跨模块共享的可变投影状态，
提取暂缓。本轮只在**文件内**去重（第 12–15 项），不新建模块、不搬投影。
顺带一个反向证据：这个文件虽然最大，但**没有**任何一处 clone 是「整段逻辑重复」级别的结构性问题——
它的重复都是同一段落账/校验被多个 operation 分支各抄一遍。

## §7 — TeamComposer 的 mention 选项两分支，以及两个页面的 composer props 块

`TeamComposer.tsx` 约 287–296 与 302–311 是 `@all` 与「某个成员」两个 `<button role="option">` 分支，
共用 10 行属性；两个页面的 `<TeamComposer .../>` props 块也高度相似。**保留。**
两分支的差别正是内容本身（一个是 presence dot + handle + description，一个是 all-count），
提取一个「选项外壳」只会把两条清晰的 JSX 换成一次回调/children 传递；
props 块则是显式的属性管道，两个调用点传的 props 集合确实不同（follower、placeholder、asTask）。
属于「形状相似、概念不同」。

## §8 — `member-lifecycle.spec.ts` 4368 行

单个 spec 文件占了测试代码的近三成，是「拆一拆」的直觉目标。**本轮不动。**
理由是**没有证据**：按 describe 段看过，它按 ticket 分组（Member lifecycle / progress nudge Host wiring /
rollover ticket 01 / checkpoint ticket 02 / pressure policy ticket 03 / recovery hardening ticket 04 /
内存目录 #7），90 个 `it` 没有发现重复用例；拆分是纯外观变更，还会打断「一个文件的测试共享同一套 harness」的现状。
（诚实交代：这是结构抽查，不是逐用例去重审计；若 0.1.11 想动测试，应另开一轮专门查用例重叠。）

---

# 收尾补入的保留理由（2026-09-12）

B 桶裁定后，`issues/09`、`issues/10`、`issues/14` 三张 ticket 被删除，理由按 human 的「不做的 ticket 也不要了，
但理由比 ticket 值钱」移入本册。**这三条都不该重开，除非下面的重开条件真的出现。**

## §9 —（原 ticket 09）client 四处「workspace 失效即刷新」effect 收成一个 Hook

判定：**保留。** ticket 自己就写了这是全清单**最容易写出 stale closure** 的一项，而且审计时的四个点里有两个
**嵌在更大的 effect 中**——订阅与清理语义和别的逻辑绑在一起，抽 Hook 就得把「订阅什么、何时清理」从原地搬走。
剩下两处各 9 行逐字相同的收益，换不回订阅/清理语义回归的风险。

**重开条件：** 出现真实 bug——某个面板的 failed 分支漏了刷新，或新增第五个面板时又抄了一遍。
届时应先对齐现有四处，而不是先做 Hook 抽象。

## §10 —（原 ticket 10）TeamThreadPage 两个 mutation 的生命周期收成 runner

判定：**保留。** 这是 jscpd 在 client 侧报的最大一处（26 行/162 tokens），但两段共享的是**形状不是概念**。
四处差异各自都是行为：是否允许已有 task、key 如何构造、projection 合并字段不同、`setMutating` 只在部分动作调用。
把四处参数化必然要 ≥2 个行为回调，而我在 ticket 里写死的停手判据是「签名 >3 参数或 ≥2 个回调就退回保留」——
**预期结论本来就是保留**，所以不该为它开一轮。

## §11 —（原 ticket 14）removeMember / archiveMember 的离场主体收成一处

判定：**保留**（读完两个方法后裁定；本项不在我先前宣布的实施范围内）。
两段主体（`ledger.ts` 1139–1150 与 1180–1191）今天确有 2 处 clone（14 行/163 tokens、7 行/66 tokens），
但差异不是常量而是行为与类型：

- `assertSameRemoval` / `assertSameArchival` 与 `removalResult` / `archivalResult` 两组映射，**3 个行为回调**；
- 目标状态 `inactive` / `archived` 与 operation kind `team/member-removed` / `team/member-archived` 两个字面量
  （合并后这两处正好是 `AgentTeamOperation` discriminated union 的收窄点）；
- **不对称的守卫**：archiveMember 多一条「已 archived 则报错」（`ledger.ts:1178`），removeMember 没有——
  这条差异不是参数，是控制流。

即使把两条守卫留在调用点，helper 仍需 6 个参数（含 2 个回调）才能容纳差异，超过本 ticket 写死的
「若 helper 需要 4 个以上参数就退回保留」。

**重开条件：** 出现第三种离场语义（例如「软隐藏」）时，三份主体才值得抽一个显式的离场主体构造器；两份不值得。

## 一条从上面三条里抽出来的可复用规则

**判据看「行为回调数」，不看原生参数个数。** 06/10 的停手判据（>3 参数）之所以有效，是因为那里多出来的参数
是回调——多回调正是「共享的是形状不是概念」的信号。把这条判据搬到纯数据参数的东西上（例如第 15 项的重放校验器：
6 个参数、0 个回调）就会误判。跨条目套用判据前，先确认判据**代理的那个东西**在新条目上是否真的存在。
