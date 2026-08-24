# 工作资料

`.scratch/` 保存跨会话工作项的设计快照、研究、实施 tickets、原型和可复查的里程碑证据。它不定义当前产品行为、公开 API、稳定维护流程或架构边界；这些以 `packages/`、测试、package README 和 `docs/` 为准。

## 目录

```text
.scratch/
├── active/                 # 尚未结束的工作项
├── archive/YYYY-MM/<work>/ # 已完成工作项的历史资料
└── local/                  # Git 忽略的私人草稿和临时输出
```

每个 `active/<work>/` 必须有短 `README.md` 作为唯一接续入口，并包含状态、最后核对日期、当前前沿、结束条件和正式文档出口。工作项使用一个目录：`spec.md` 记录已确认的决策快照，`issues/NN-<slug>.md` 一张实施 ticket 一个文件，研究、原型和验证证据只在确有复查价值时保留。

完成工作项时：关闭或删除未完成 tickets，将长期有效结论写入正式文档，删除无溯源价值的过程材料，再移入 `archive/YYYY-MM/`。归档中的旧状态和术语仅代表当时的工作上下文，不能覆盖当前实现。

## 临时材料和 UI 证据

`.scratch/local/`、`artifacts/` 和 `artifacts/browser/` 被 Git 忽略。临时日志、agent handoff、下载物、调试截图和日常 browser test 输出放在那里，不进入归档。

UI 改动需要真实浏览器自检时，`npm run test:browser` 会把本次截图写入 `artifacts/browser/`。它们用于审查本次改动，不是自动视觉回归基线，也不会改动 Git 工作区。只有人工确认能说明已完成工作项验收结论的少量代表图，才复制进对应归档的 `archive/YYYY-MM/validation/`；每张图都必须在同目录 README 中说明证明的验收点和复跑命令。一个浏览器 journey 跨多个 UI ticket 时，可以像本仓库一样集中保存。

详细 UI 改动检查和证据选择规则见 [`../docs/development.md`](../docs/development.md)。
