# dsh 版本适配 playbook（经验收敛）

状态：**活跃**——从 0.1.2-rc.1 适配（2026-09-03 → 09-04 发布 0.1.7）收敛的完整流程经验，供下次 dsh 版本发布时直接复用。
最后核对：2026-09-04
任务：task:452d14a8（Aster 认证 / Reeve 评审 / Ferry 移植发布）
结束条件：方法论被 `docs/dsh-release-compatibility.md` 或 Ferry 私有 release-ladder skill 吸收后归档。

## 这是什么

dsh 上游每出一个新版本（alpha/rc/stable），我们要判断"适配多少、怎么验、怎么发"。本文是从 rc.1 一轮实战提炼的分阶段 playbook：**扫描 → 认证 → 评审 → 合并 → 发布**，含每个阶段的坑。

权威分工：扫描与认证的**结论**以当时的认证工作项为准（本轮在认证副本 `.scratch/active/dsh-0.1.2-alpha-tracking/`，258 行，未进主仓 git）；本文是**流程**经验，不承载本轮的具体断裂清单。

## 阶段 0：触发与准备（tag 出现即启动，不等 stable）

- 上游无 changelog，release commit 纯版本 bump——**git tag diff 是唯一可靠信源**。别浪费时间找 release notes。
- dsh 的 `latest` dist-tag 可能直接指 prerelease（本轮 rc.1 同时是 latest+next）——**新装用户从 tag 指到 prerelease 那一刻起就在踩组合坑**，所以"等 stable 再适配"的默认答案已经被推翻：latest 指针就是发版信号。
- 准备隔离环境：`deepseek-harness-<tag>/`（checkout 到 tag，**重新 build，勿复用旧 lib/node_modules**——会掩盖声明或运行时不兼容）+ `dsh-agent-team-compat-<tag>/`（副本）。日常 checkout 不动。

## 阶段 1：扫描（Aster 方法论，结论摘录）

三层提取，逐层收紧：

1. **peerDeps × tag 矩阵**：`git log <prev>..<tag` name-only diff 与我们 40+ 个 dsh peerDeps 求交。坑：包目录名 ≠ npm 名（`packages/preset/agent-presets` vs `dsh-agent-presets`），必须读各目录 package.json 的 `name` 反查。排除纯文档文件后计数。
2. **符号级扫描**：我们 import 的每个 `pkg::symbol` 逐个在新源码验证存在性。三重漏：多行 `export type {...}` 漏匹配、type-only re-export 链、以及最阴的——**符号在但形状变了**（必填参数增删、判别联合收紧，全都是编译期才显形）。
3. **编译器复核（权威，不可省）**：用新 checkout 的 paths 对我们全部包编译。**typeRoots 陷阱（本轮最大教训）**：typeRoots 必须指本仓的 `node_modules/@types`——指到 harness checkout 会没有 `@types/react`，React 相关错误全灭，既凭空造错又漏真断裂（本轮 108/12 伪数据 vs 101/13 权威数字）。
- 探针纪律：迁移目标合并单一文件一次编译 + **负控**（import 不存在符号必须报 TS2305，证明探针真的在解析）。
- 首现版本用逐 tag grep **源码内容**（不是目录存在性）；同区间的不同 commit 落点可能差几个 tag。
- **`scripts/` 在 typecheck/test/lint 之外**：e2e 的真实断裂只在 `test:browser` 暴露，"typecheck 已过"不代表 e2e 没断。

## 阶段 2：认证（隔离环境全梯）

- 隔离副本里跑完整梯子（typecheck/test/build/lint/test:browser/pack/diff-check），并做**真实安装验证**：`npm pack` 出的包在空目录对目标 dsh 版本装一遍——npm 直装与 `dsh plugin`（pnpm 转发）两条路径都要试。
- **分裂图检测（本轮关键发现）**：旧 peer 区间被旧版本满足时 npm 静默 hoist 旧代——安装 exit 0 但顶层混两代包、核心单例双份、host 启动即崩。"装得上"≠"装得对"，启动实测不可省。
- prerelease 区间语义：`>=0.1.1-rc.2 <0.2.0` **不匹配** `0.1.2-rc.1`（prerelease 只对同一 base 版本放开）——跨版本线是硬抬，不是顺手对齐。
- 上游缺陷只记录不改上游（本轮：`dsh-api-workspace-controller` 的 d.ts 在 `skipLibCheck: false` 下报错，可单独 import 复现）。

## 阶段 3：评审（独立成员）

- 评审人自己重跑梯子（不采信执行者报告），做安装对照实验（本轮：三组 install 对照才找出正确 peer 移动方案——朴素全抬 ETARGET、单包留守 ERESOLVE、删 client-runtime peer + 补 storage-sqlite dep 才对）。
- 区分"兼容性缺陷"与"产品语义变化"：后者（如成员会话命令面全量开放）单独标记交 human 拍板，不混进兼容性修复。
- 清理项（死代码/恒真断言/过时注释）在合并前一并做掉，都在认证副本里。

## 阶段 4：合并（补丁移植，不是 git merge）

- 认证副本历史是本地 init 的，无共同祖先——**逐 commit 忠实移植**（每个 commit 导出独立 patch 依次 apply + 原信息 commit），保留 bisect 粒度；比单一大补丁好。
- 移植后 diff -r 校验最终树与副本一致（排除 dotfiles/node_modules）。
- 原子性要求：peerDeps + 文档 + README + compatibility §6 基线同一批 commit；**版本号与 CHANGELOG 留给发布 commit**（避免与认证工作撞）。

## 阶段 5：发布（主仓，DSH_HARNESS_DIR 指隔离 checkout）

环境坑（本轮实测，都曾让梯子假红）：

1. **node_modules 链接**：主仓 npm install 装的 16 个 `@deepseek-ai/*` 链接指日常 checkout——全部 48 个要镜像到 `<tag>` 认证 checkout（readlink 复制相对目标即可，同层结构解析一致）。self-link 是**三层** `../../../dsh-agent-team` 不是两层。
2. **lib 旧产物**：`packages/*/lib/` 是上次构建的产物，preset 行加载 lib 不加载 src——**build 必须在 test 前重跑**（梯子顺序设计的初衷），否则 35 个测试假挂。
3. 全程 `DSH_HARNESS_DIR=deepseek-harness-<tag>` env（脚本与 vitest 都已支持）。

发布顺序（硬切换类）：

1. CHANGELOG 草案按 diff 逐 commit 核实（规矩已在 release-ladder skill）——**兼容性修复条目写症状与解法，不写内部符号**；机制细节放 Release 正文与 compatibility 文档。
2. **先升全局 dsh 再更新 profile 的 Team**——顺序反了正好落进本版修的坑（ Reeve 提醒）。
3. stable profile 用精确版本 add；确认随动依赖（storage-sqlite）跟着走。
4. live 运营中的 server 不动，下次重启自然上新组合。
5. 发布材料（Release 双语 / #4303 + `> EN:`）写明版本要求（"需 dsh ≥ X"）。

## 协作协议（撞车教训）

- **移交后执行者不明确时，动手前先在 Thread 报"我开始做 X"**——本轮 Ferry/Aster 同时各自开跑移植，靠 stash 痕迹才发现。
- 认证副本与主仓的分工边界提前说清：副本做适配+评审+清理；主仓只接收移植 commit + 发布 commit。
- 上游跟踪工作项（如 alpha-tracking）留在认证副本不入主仓 git——移植只搬 tracked 文件，跨会话知识走本文档。

## 工具与技巧速查

- `npm view @deepseek-ai/dsh dist-tags`——判断 latest 是否指 prerelease。
- `git tag --list "dsh-v*"` + tag 间 log——唯一可靠信源。
- `diff -r --brief --exclude` 校验移植完整性。
- `npm pack --dry-run` 的 file count 与认证副本对齐（本轮 185）。
- 安装验证三件套：exit code / 顶层包版本分布（`ls node_modules/@deepseek-ai/*/package.json` 批量读版本）/ host import 实测。
