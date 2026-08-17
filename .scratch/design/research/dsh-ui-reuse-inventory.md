# DSH Web UI Public Reuse Inventory

日期：2026-08-17
范围：`deepseek-harness` `0.1.0-rc.5` Client packages；面向外部 `dsh-agent-team` Client plugin
结论：直接复用 public primitives 和 slot/service contracts；不得依赖 Harness 私有 composite component 源码

## 1. Public API 判断规则

外部插件只依赖 package root 或 `./client` 明确导出的 API：

- `@deepseek-ai/dsh-client-ui-primitives`
- `@deepseek-ai/dsh-client-ui-*/client`
- package root 中明确导出的 contract/type

以下路径即使在相邻 workspace 中可解析，也不视为稳定 public UI API：

- `@deepseek-ai/dsh-client-ui-*/src/...`
- `deepseek-harness/packages/.../src/client/...`
- `SidebarRoot`、`WorkspaceBrowser`、`ConversationRoot`、`InputBar`、`MessageItem` 等 implementation component

理由：这些 package 的发布文件是 `lib/**`；`./src/*` 是 workspace 源码通道，不是 external plugin 的长期组件合同。Harness Client package 的公开复用面主要是 primitives、slot contracts 和 service faces，不是现成复合页面。

## 2. `ui-primitives` 可直接复用

证据：`packages/client/ui-primitives/src/index.ts`、对应 component source 和 package manifest。

| Export | 关键 contract | Agent Team 用途 |
|---|---|---|
| `Button` | `primary/ghost/outline/toolbar`；`md/sm`；icon + native attrs | 全部普通命令、header actions、Modal footer、icon controls |
| `Input` | single-line input；icon + native attrs | Agent/Channel name、description（单行时） |
| `Modal` | controlled；portal；title/description/footer；Escape/mask close；headless | Agent create、Channel create、global/channel Members |
| `Menu` | controlled；items；selected；dense/compact；portal；viewport positioning | header overflow、mention picker、membership actions |
| `Tooltip` | hover/focus；fixed placement；delay/side/maxWidth | icon-only actions、presence labels、disabled reason |
| `HoverCard` | delayed card；optional copy | Agent diagnostic、Channel/Member detail |
| `StateDot` | `done/warning/ongoing/error`；aria-hidden | available/working/error；语义文字另行提供 |
| `Pill` | static/interactive chip；active | Task/Claim state、selected mentions（克制使用） |
| `DisclosureRow` | compact expandable row | 可选：折叠 advanced/error detail，不用于主导航 |
| `Toast` | body portal；transient alert | transport/operation feedback；持久错误仍需就地呈现 |
| `MessageText` | literal message text renderer | Team Message body，避免自行处理基础文本展示 |
| `MarkdownText` | markdown renderer | 当前 Team Message 是纯文本，默认不启用 markdown；未来明确需要再用 |
| public `Icon*` | lucide-like DSH icon set | plus/back/ellipsis/user/check 等 controls |

### Primitive 缺口

- 没有 public multiline composer / textarea component。
- 没有 public message row / chat bubble。
- 没有 public Channel、Thread、Claim、Member 或 Agent row。
- `StateDot` 没有 neutral/unavailable state；Team 需使用克制的 local neutral dot，或在 Harness 正式增加 public state 后再迁移。
- `Input` 是单行 atom，不能拿来代替 composer textarea。

## 3. Public Slot / Service Contracts

### 3.1 `ui-layout`

- `sidebar`: `single/root`，替换整个左栏。
- `conversation`: `single/session-maybe`，替换整个中心区。
- `details`: `single/session`，替换整个右栏。
- `shell.overlay`: `list/root`，additive overlay。
- `ctx.layout`: sidebar/details 控制 service。

Team 当前不替换 `root`，而是 shadow `sidebar.workspaces`、`conversation`、`sidebar.settings`，边界正确。

### 3.2 `ui-sidebar`

`SidebarRoot` 声明：

- `sidebar.workspaces`: `single/root`，owner `{ wide, expandSidebar }`；完整 browsing region。
- `sidebar.settings`: `single/root`，owner `{ wide }`。
- `sidebar.footer.action`: `list/root`，owner `{ wide }`。

`SidebarRoot` 本身不是 public component。Team 应继续：

- shadow `sidebar.workspaces`；
- 用 additive `sidebar.footer.action` 放 Team/Back 和 Members；
- 不接管 `root` 或复制 Shell。

### 3.3 `ui-workspace`

公开的是 `WorkspaceBrowserProps`、`WorkspacePickerProps` 和 directory-flow contract types；没有 public `WorkspaceBrowser` / row component。

当前 Harness 的 directory-flow child slot 属于 shipped WorkspaceBrowser parent declaration。外部 Team shadow 不可重复声明；Team 已改用 public `ctx.workspaces.pickDirectory()` + `ctx.workspaces.create({ path })`，应保持。

### 3.4 `ui-conversation`

公开了丰富 slot/type contract：

- `conversation.session.header.actions` / `utilities`：Session header additive actions；
- `conversation.chat.node`：绑定 Harness `ChatNode` model 的 keyed renderer；
- `conversation.input.*` / `composer.*`：绑定 Harness Session/Input machine；
- `conversation.composer.bar`：完整 default composer owner contract；
- `conversation`: whole center surface。

Team Message/Activity 不属于 Harness Session `ChatNode`，Team 也 shadow whole `conversation`。因此：

- 不能直接复用 `conversation.chat.node` 渲染 Team Message；
- 不能嵌入 private `InputBar`；
- 不应伪造 Session/Input machine 来换取默认 composer；
- 可以借鉴 DSH Conversation 的 width axis、scroll host、sticky composer、keyboard/focus 语法，自行实现薄 Team presenter。

### 3.5 `ui-settings`

公开 settings slots 和 scope service，没有 public Settings modal/panel component。Team 的 Members/create flow 应使用 `ui-primitives/Modal`，而不是导入 private `SettingsRoot`。

## 4. Agent Team Surface Matrix

| Team surface | 可直接复用 | Team 必须拥有 | 禁止依赖 |
|---|---|---|---|
| Sidebar shell entry | `sidebar.footer.action`, `Button`, `Tooltip`, icons | Team mode state | `SidebarRoot` implementation |
| Workspace/Channel/Agent nav | `Button`, `Menu`, `Tooltip`, `StateDot`, icons；`wide` owner prop | compact rows、selection、domain counts | `WorkspaceBrowser` / private rows |
| Agent create | `Modal`, `Input`, `Button`, `Tooltip`, `Toast` | form/request retry/unavailable rule | private workspace/settings forms |
| Channel create | `Modal`, `Input`, `Button`, `StateDot` | initial member selection + atomic request | generic settings panel |
| Channel header | `Button`, `Menu`, `Tooltip`, icons | Channel purpose/membership summary | Session header implementation |
| Channel timeline | `MessageText`, `Pill`, `Tooltip` | Team Message row、Task footer | `MessageItem`, `ChatNode` forgery |
| Channel composer | `Button`, `Menu`, `Tooltip`, `Pill`, `Toast` | multiline textarea、draft、Member-ref mentions | private `InputBar` |
| Thread header | `Button`, `Menu`, `Pill`, `Tooltip` | Task status/actions/back context | Session breadcrumb/header implementation |
| Claim rows | `StateDot`, `Pill`, `Button`, `Tooltip` | owner/direction/state presenter | issue/property panel imitation |
| Activity timeline | `MessageText`, icon/state token | localized Activity formatter | raw operation enum/ref |
| Thread composer | same as Channel composer | baseRevision/confirmation/stale flow | Session composer machine |
| Members | `Modal`, `Button`, `StateDot`, `Tooltip`, `HoverCard` | global/channel scope、membership mutation | private Settings modal |

## 5. Styling Contract

证据：`deepseek-harness/docs/web-styling.md`。

- CSS Modules + `clsx`。
- feature CSS 只消费 semantic `--dsw-alias-*`；不写 literal colors 或 theme selector。
- typography 优先使用已有 theme typography variables；字号与 line-height 成对。
- hover-only controls 必须保留 keyboard focus visibility。
- transitions 尊重 reduced motion。
- local CSS 只承担 Team domain geometry，不重造 shared control chrome。

## 6. 依赖建议

下一轮可增加 `clsx` 为 `client-agent-team` direct dependency，并继续保留 `@deepseek-ai/dsh-client-ui-primitives` peer。不要新增 component library。

如果下一轮发现复合组件在多个外部 plugin 中都有明确复用价值，应先在 Harness 中提炼、文档化并发布 public primitive，再升级 Team peer version。不要先从 `./src/*` 偷用，再把内部实现当事实标准。

## 7. 结论

1. `ui-primitives` 是 Agent Team 可直接复用的稳定视觉工具箱。
2. layout/sidebar/workspace/conversation/settings 对外主要提供 slot/service/type contract。
3. Team 必须自己呈现 Channel/Thread domain，但 chrome、控件、overlay、状态点和文本 renderer 不应重造。
4. “像 DSH”不等于 import 私有 DSH 页面；正确做法是使用 public primitives，遵守同一 layout、density、focus、motion 和 token 规则。
