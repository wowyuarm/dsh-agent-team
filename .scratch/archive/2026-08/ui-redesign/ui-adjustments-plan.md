# Team UI 调整计划

日期：2026-08-17
状态：archived；对应调整已在 2026-08-18 完成。
范围：`packages/client-agent-team` 的 Client presentation；不修改 Host、ledger、Remote schema、authority 或持久化。

## 当前已确认的问题

### 第一阶段：输入框

- mention 目前常驻占据输入框上方一整行，不符合 DSH composer 的输入驱动交互。
- 输入框缺少明确的 placeholder 和稳定的 DSH-style surface，空状态下不容易发现。
- DSH 原生 `InputBar` 是 `ui-conversation` 的 private implementation，绑定 Harness Session/Input machine，不能直接接管 Team Channel/Thread 的提交链。
- Team 保留自己的 textarea、draft、structured `memberRef`、pending/error/revision/confirmation 语义；只复制 DSH composer 的视觉和可迁移交互：浮动 surface、输入上方候选菜单、textarea focus、IME-safe Enter、Esc/Arrow 导航、发送按钮。

目标交互：

```text
普通状态
┌──────────────────────────────────────────────┐
│ 写一条消息…                                  │
│                                      [↑]     │
└──────────────────────────────────────────────┘

输入 @ 后
┌──────────────────────────────────────────────┐
│ @bu                                          │
│ ┌──────────────────────────────────────────┐ │
│ │ ● @builder                         可用  │ │
│ │ ● @reviewer                        可用  │ │
│ └──────────────────────────────────────────┘ │
│                                      [↑]     │
└──────────────────────────────────────────────┘
```

验收：

- 未输入 `@` 时没有 mention 工具行。
- 在合法边界输入 `@`，候选菜单从输入框上方出现；输入过滤候选。
- 鼠标选择和 ArrowUp/ArrowDown/Enter/Escape 可用，选择时 textarea 保持可继续输入。
- 发送仍提交 `memberId[]`，失败保留 draft 和 recipients，成功后清空。
- Shift+Enter 换行；中文输入法组合期间 Enter 不发送、不误选候选。
- Channel 和 Thread 共用同一套 composer。
- 390×844 无横向溢出，候选菜单不遮住输入框且受视口限制。

### 第二阶段：内容层级和布局

1. Channel/Thread 使用稳定的 `header → timeline → composer` 三段结构；消息从 header 下自然开始，避免少量内容被大面积空白吞掉。
2. Message 显示 sender、kind、正文和可点击的 Task footer；减少重复的 `Human 成员` 信息，Task footer 明确可进入 Thread。
3. Thread 固定 Task header、Claims work row、Message/Activity timeline；窄屏把 Claim 操作自然换行，低频 Task 操作必要时收进更合适的 header 布局。
4. 空 Channel 显示上下文明确的 empty state，同时保持 composer 可用。
5. Agents tab 不再在中央区显示“选择工作区”；中央 welcome 根据 active tab 表达当前上下文。

### 第三阶段：导航细节

1. Sidebar 统一文案，Channel 成员数量不显示裸数字。
2. selected Channel/Workspace 的层级更明确，但保留 DSH sidebar 的紧凑 row 语法。
3. collapsed rail 保留 Channels/Agents 的可识别 Tooltip 和当前选中态。
4. 不把 Agent/Channel 创建表单重新放回 Sidebar；Modal 和 Members Modal 维持现有模式。

## 明确不做

- 不 deep-import Harness `InputBar`、`WorkspaceBrowser`、`ConversationRoot` 或私有 CSS。
- 不伪造 Harness Session/Input machine。
- 不新增搜索、URL routing、Thread inbox、Agent DM、附件、slash commands、模型/Provider/Preset 控制。
- 不做 optimistic durable fact；Team mutation 仍以 Host projection 为准。
- 不一次性重写整个 Client package；每阶段通过现有 functional tests 和真实 browser journey。

## 实施顺序

1. 新增 Team-owned `TeamComposer`，替换 Channel/Thread 现有 `TeamMentionPicker + textarea`。
2. 删除旧的常驻 mention picker 和不再需要的样式/测试选择器。
3. 先跑 `typecheck`、Client tests、browser journey，确认输入行为和 Host payload 未变。
4. 调整 Channel/Thread surface CSS 与 presenter 文案。
5. 修复 Agents tab 中央 welcome 和 Sidebar 信息表达。
6. 再跑完整检查，并用真实 Web 截图检查桌面、窄屏、mention menu、Thread。

## 完成门槛

- `npm run typecheck`
- `corepack pnpm exec vitest run --reporter=dot`
- `npm run build`
- `npm run test:browser`
- `git diff --check`
- 真实截图确认输入框、mention menu、Channel、Thread 和窄屏布局没有明显回退。
