# Spec — Team Client UI Round 2

状态：已确认方向，未开始实现。本文是决策快照，不定义正式行为；完成后长期结论写入 `docs/frontend-design.md`。

## D1 消息时间戳（名字行展示）

- 用户确认的展示位置：发送者名字同一行右侧，tertiary 小字元信息。
- 数据来源：ledger 操作本就携带 `occurredAt`，但 `AgentTeamMessage` 投影未暴露。需在 agent-team 投影中为 Message 补充时间字段并重新生成 typert artifacts。
- 展示规则草案：当天显示 HH:mm，同年显示 MM-DD HH:mm，跨年显示完整日期；分组 run 只在 run 头部渲染（与名字同规则）。
- 影响面：`packages/agent-team/src/types.ts`、消息投影构造点、typert 再生成、tool 渲染如有字面拼接、client fixtures 与单测、channel/thread 两处名行 UI。

## D2 排版统一

- 现状问题：Agent markdown 根节点自带 `font:` shorthand，覆盖容器设定的 14px，导致 Human 字面文本与 Agent markdown 字号/字族不一致；用户反馈"层次不好、大小不统一、名字与正文字体不好"。
- 方向：正文统一到同一档规格（目标 14px 档、同字族），markdown 根节点的字号/字族在本包内显式覆盖；名字行建立 13px/600 + 时间元信息 11–12px tertiary 的层级；活动行维持弱化居中。
- 验收：同一 Thread 内 Human 与 Agent 消息正文视觉同档；1440×960 与 390×844 截图检查。

## D3 Task 入口卡重设计

- 用户反馈：多条堆叠时不友好；箭头横向位置不一致（依赖 `width:100% + margin-left:auto`，不同行表现不同）；希望默认安静、触碰再有进一步反馈。
- 方向：
  - fit-content 紧凑胶囊，不再拉伸全宽——箭头位置由内容流构造保证一致；
  - 结构 `Task #N`(600) · 状态 · 计数 · chevron；细边框 quiet 默认态；
  - hover/focus 渐进：底色提升 + 边框增强 + 箭头右移位移（transition ~120ms，reduced-motion 关闭）；
  - 堆叠形态：卡片间距收紧、与消息体保持固定间距，多条连续时读作任务列表而非大按钮。
- 验收：单条与多条堆叠两种形态的浏览器截图；键盘 focus-visible 可见。

## 实施顺序

1. D1 Host 投影扩展（types → 投影 → typert 再生成 → client fixtures/测试）
2. D2 排版统一 + 名行元信息（依赖 D1 的时间字段）
3. D3 任务卡重设计（独立，可并行）

## 结束核对清单

- [ ] 全部检查命令绿（typecheck/test/lint/build/test:browser）
- [ ] 截图两档尺寸人工过目
- [ ] `docs/frontend-design.md` 更新排版表、Task 入口卡合同、消息行元信息，删除对应 TODO
- [ ] 本目录归档至 `.scratch/archive/2026-08/team-client-ui-round2/`
