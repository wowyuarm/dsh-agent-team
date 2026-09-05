# 简化与结构审查（消融仪器 + 报告）

日期：2026-09-05 · HEAD：`e2dad2a` · 状态：已完成，结论已落地为代码提交。

## 这是什么

一次全仓简化审查（机械层 → 消融层 → 语义层），外加一套为本仓库校准过的
codebase-ablation 消融仪器。2026-08 的质量审计
（`.scratch/archive/2026-08/agent-team-quality-audit/`）的裁决被逐条重新验证，
全部维持：ledger 不拆、Thread-page 保持 locality、occurredAt 规范化保留、
不拆包；5 处 "Deliberate interface reservation" seam 确认为活代码或故意预留。

## 核心结论

- 文件粒度：除编译器专用的 `css-modules.d.ts` 外，**没有静态不可达的源文件**；
  静态零 fan-in 的文件全部是动态入口（cordis.patch.yml、preset yml、package.json
  子路径导出、vitest glob）。
- 导出粒度：修正两类扫描盲区（`import * as` 命名空间调用、配置字符串加载）后
  **没有死导出**。
- 消融：对照 296/0；删 `timeline-scroll.ts` 闭包后余下 247/0（无动态触点）；
  stub `maybeNudge` 后 22 个失败精确落在 progress-nudge.spec + member-lifecycle.spec
  （运行时足迹 = 静态 fan-in，无隐藏耦合）。

## worktree 校准陷阱（复跑前必读）

`harness-dir.mjs` 以 `../deepseek-harness` 兄弟目录解析 harness checkout：

1. worktree 放 `/tmp`：解析不到兄弟 checkout，vitest 配置加载即崩。
2. 在 worktree 父目录放 harness symlink：vite 沿 realpath 与 symlink 两条路径
   各加载一次 harness 模块，双实例使 `FiberState.UNLOADING` 变 undefined，
   5 个 spec 文件套件级失败（第一次对照实验的伪影来源）。
3. `DSH_HARNESS_DIR` env 指向真实 checkout：会打脸 `harness-dir.spec` /
   `shipping.spec` 自身的解析断言。

唯一正确做法：**worktree 直接建为仓库的兄弟目录**（脚本内已是
`/home/yu/projects/.dsh-ablation-<slug>` 形式）。`packages/*/lib`（gitignored
生成产物）与 `node_modules` 从主 checkout symlink 进 worktree。

## 复跑

```bash
node instrument/couple-map.mjs <repoDir> /tmp/couple-map.json
node instrument/reach.mjs <repoDir>            # 入口可达性（含 tests 作动态根）
node instrument/export-scan.mjs <repoDir> <file.ts> ...   # 逐 export 消费
node instrument/ablate-delete.mjs <repoDir> <repo-root-relative target> /tmp/out.json
node instrument/ablate-stub.mjs <repoDir> <file> '<regex>' '<replacement 含 $$MARKER$$>' /tmp/out.json
```

消融脚本不经 build 直跑 `npx vitest run`（tsconfig paths 指向源码与已生成的
`lib/typert.*`，删 src 不影响测试管线）。解读前先跑一次零干预对照
（ablate-stub 自替换一行注释即可），任何失败先按伪影排查。

## 目录

- `report.md` — 审查报告全文（排序清单、消融证据、不动清单）。
- `instrument/` — dsh 适配版消融仪器（原版脚本假设 `src/`+`test/` 布局，
  这里适配 packages 布局、`.tsx`、显式 `.ts` import 扩展、子路径映射）。
- `results/` — 校准后的对照/删除/打桩消融原始 JSON 与 couple-map 输出。
