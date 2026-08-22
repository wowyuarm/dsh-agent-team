# Team Client UI Round 3 — 消息块 hover、mention 强调、聊天排版刻度

- 状态：active
- 最后核对：2026-08-21
- 前置：round 2 已合入（`23879c0`），设计基准见 `docs/frontend-design.md`

## 反馈（用户，2026-08-21）

1. 排版仍不舒服：挤、重点不明确 —— 根因：消息内 markdown 标题用文档级字号（比页面 h1 大），段落间距偏紧。
2. @mention 需要视觉强调：阴影/底色突出。
3. raft.build 式设计：每条消息（含 task button）作为一块区域，hover 显示边框，突出消息边界与层次。用户疑问：是否太过刻意？

## 设计结论

- hover 块**不做刻意感**的三个前提：静止完全隐形；hover 面外扩（padding+负 margin）文字不动；块的单位是"一次发言"（run：同 sender 连续消息+task chip），不是单条消息。
- 聊天排版刻度：消息内标题 h1 17px / h2 16px / h3 15px / h4+ 14px，全部 weight 650/600；段落 margin 6px；列表 li 间距 2px；表格 cell padding 6px 10px；pre padding 10px 12px 字号 13。
- mention 强调（Human 消息）：浅底 pill + 极淡阴影（`0 1px 2px rgb(0 0 0 / 0.08)`）；Agent markdown 内 @handle 保持原样（原语无挂点，源级替换有破坏语法风险——记录为已知限制）。

## 任务

- D1 消息内标题降级 + 间距放宽（conversation.module.css）
- D2 Human 消息 mention 分段渲染 + mention chip 样式
- D3 messageRun 包装（连续同 sender 消息+task chip 为一块）+ hover 面（仅边框、无底色无阴影——用户反馈后从"边框+底色"收敛，避免与 task button hover 叠层；padding+负margin 外扩）
- 验证：typecheck / vitest（快照更新）/ lint / build / test:browser 双尺寸截图
- D4 任务卡状态 StateDot：`taskStatusDot` 映射五态全有点（in_progress=ongoing、in_review=warning、done=done 复用 DSH `StateDot`；todo=空心圆环、closed=tertiary 灰实心+10%光晕，`.taskDotQuiet` 镜像 StateDot 几何），8px 固定座位置于 Task #N 前保证各卡同轴。用户反馈两轮：①点移到 Task #N 之前；②todo/closed 也要有点以统一样式。

## 退出标准

- 完成后更新 `docs/frontend-design.md`（排版刻度表、run/hover 合同、mention 合同），本目录归档至 `.scratch/archive/2026-08/team-client-ui-round3/`
