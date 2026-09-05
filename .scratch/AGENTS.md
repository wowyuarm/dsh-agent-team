# .scratch 工作规则

本子树保存跨会话工作项：设计快照、研究、实施 tickets、原型和验收证据。它不是实现或 API 权威——当前行为以 `packages/` 源码和测试为准，维护规则以 `../docs/` 为准。本文件只约束"怎么在这里工作"。

## 工作项结构

每个 `active/<work>/` 一个目录，以短 `README.md` 为唯一接续入口，包含五项：状态、最后核对日期、当前前沿（谁在做什么、卡在哪）、结束条件、正式文档出口。

```
active/<work>/
├── README.md      # 接续入口（上述五项）
├── spec.md        # 已确认的决策快照——讨论收敛后写入
├── issues/        # tracer-bullet 实施票据，一张一个文件
│   ├── 01-<slug>.md
│   └── 02-<slug>.md
├── materials/     # 研究与外部材料（确有复查价值才保留）
└── validation/    # 人工确认的验收证据（见 development 文档）
```

## Ticket 纪律

每张 `issues/NN-<slug>.md` 用固定骨架，编号从 `01` 起按依赖顺序（阻塞者在前）：

```markdown
# NN — 标题

**What to build:** 这张票做成后可演示/可验证的端到端行为（用户视角，不是分层任务清单）
**Blocked by:** 阻塞它的票号，或 "None — can start immediately"
**Status:** ready | in-progress | complete

- [ ] 验收标准 1
- [ ] 验收标准 2
```

- **垂直切片**：每张票切一条穿过所有层的窄而完整的路径（schema → API → UI → 测试），完成即可独立验证；不做按层切的水平分工。
- **票据自足**：每张票在新 context 里可独立开工，不依赖读整个工作项历史。避免写具体文件路径和代码片段（会过时）；例外：原型产出的状态机/类型形状等决策密集片段可内联并注明来源。
- **Frontier 工作法**：阻塞全部完成的票就是 frontier，随时可开工；串行链即从上到下。
- **宽改造例外**：单一机械改动的爆炸半径覆盖全仓时，不硬塞进 tracer bullet，按 expand–contract 排序：先 expand（新旧并存），再分批迁移，最后 contract（删旧形式）。

## 生命周期

- **结束工作项**：关闭或删除未完成 tickets → 长期有效结论移入 `../docs/` 正式文档 → 删除无溯源价值的过程材料 → 移入 `archive/YYYY-MM/`。
- **归档即历史**：archive 中的旧状态和术语只代表当时的工作上下文，不覆盖当前实现；不为迎合新代码回写归档材料。
- **临时产物**：日志、调试截图、下载物放 `local/` 或 `artifacts/`（已 gitignore），不进 active 或 archive。

## 目录索引

见 [README.md](README.md)。
