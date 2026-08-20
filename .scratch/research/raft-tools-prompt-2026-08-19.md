# Raft tools、Agent prompt 与协作消息模型：一手资料调研

- **检索日期：**2026-08-19
- **用途：**为 `dsh-agent-team` 下一阶段设计提供对照；Raft 是外部产品，不是要复制的规格。
- **资料范围：**仅使用 Raft/Botiverse 官方网站、`botiverse` GitHub 组织公开仓库、官方公开 npm 包。GitHub 内容均通过 `gh` 获取。没有登录产品 UI、没有使用第三方文章、截图或二手转述。
- **版本固定：**公开 CLI `@botiverse/raft@0.0.17`；包 SHA-1 `cedd5c23255288db1636a3248310fcea331aecbf`，SHA-512 integrity 见 npm 元数据。`raft-docs` 查询时 `main` 为 `e48db790af571246a3a397b9e90fd95cc630d34c`（2026-08-19）；`raft-external-agents` 为 `72c31894f933b9aa9243195d038d66ee79589593`（2026-06-12）。

## 摘要（不超过 250 字）

Raft 公开 agent CLI：`message check` 拉取 inbox；`message send`、`task claim` 用已见序号检查新消息，旧回复 hold 为 draft，复查后重发或 `--anyway`。还公开 Claude Code 方向提示、无正文 wake hint 和源码。托管 agent 完整 prompt、inbox 字段、服务端算法未公开。DSH 可借鉴拉取 inbox、版本围栏、待发草稿；不能由 UI 反推协议，也不应照搬单 owner task。

---

## 1. 证据等级与公开边界

| 等级 | 资料 | 可确认的范围 |
| --- | --- | --- |
| A：可执行公开工件 | `@botiverse/raft@0.0.17` 的官方发布包 | 命令名、参数、CLI 本地行为、向 server 提交的字段、CLI 渲染的成功/held 文本；**不等于**服务端内部实现或完整响应 schema。 |
| A：公开源代码 | `botiverse/raft-external-agents` | Claude Code channel 插件的 MCP tool、wake HTTP 协议、hook、方向提示、活动上报边界。 |
| A：官方文档/官网 | `docs.raft.build`、`raft.build` | 产品已承诺的用户与 agent 行为，例如 follow、thread history、Activity、频道权限、任务单 owner。 |
| 未公开 | Raft 服务器、托管 runtime、完整 Agent Manual 内容、产品 UI 后端请求 | 不能由文案、截图或 CLI 名称补全为 API 事实。以下凡未公开均明确标注。 |

### 直接资料入口

1. CLI 发布包：<https://registry.npmjs.org/@botiverse/raft/-/raft-0.0.17.tgz>；官方包元数据：<https://registry.npmjs.org/@botiverse/raft/0.0.17>。包 `package.json` 声明该包是 “Canonical Raft agent-facing CLI”；`bin` 为 `raft` 与遗留别名 `slock`。官方外部 agent 文档也明确要求安装 `npm i -g @botiverse/raft@latest`：[External Agents](https://docs.raft.build/features/agents/external.md)。
2. 公开文档源码：<https://github.com/botiverse/raft-docs>；官网的机器索引明确把它列为官方公开文档：[docs.raft.build/llms.txt](https://docs.raft.build/llms.txt)。
3. 公开 Claude Code bridge/plugin：<https://github.com/botiverse/raft-external-agents>。
4. Raft 官网产品定位与公开文章：[raft.build](https://raft.build/)、[Agent inbox 与 held draft](https://raft.build/resources/blog/is-having-agents-in-the-room-meant-to-be-chaotic/)。

---

## 2. Agent 实际可调用的命令、输入与可见输出

### 2.1 总览：公开 CLI 的能力面

**事实。**执行官方包的 `raft --help`，版本为 `0.0.17`。其根命令列出：`auth`、`agent`、`channel`、`thread`、`server`、`user`、`manual`、`inbox`、`message`、`attachment`、`task`、`mention`、`profile`、`integration`、`reminder`、`action`。

- **输入共同点：**外部 agent 以 `raft agent login --server <url> --agent <agent-id> --profile-slug <slug>` 建本地 credential profile；随后 `RAFT_PROFILE=<slug>` 或全局 `--profile <slug>` 选择身份。
- **授权共同点：**官方文档说外部 agent 连上后是完整 server member，权限按成员资格裁剪；可在其有权范围发消息、认领 task、设 reminder、查消息、管自己的 profile。[来源：External Agents](https://docs.raft.build/features/agents/external.md)。
- **输出共同点：**公开 help 与 bundle 可证明 CLI 输出人可读文本，部分命令支持 `--json`；没有可公开访问的登录 server，故本次**不把未实测的 server JSON 响应字段写成稳定合同**。

| 语义组 | 命令与主要输入 | 可确认输出/效果 | 直接证据 |
| --- | --- | --- | --- |
| 收件箱与消息 | `message check`；`inbox check`；`message read --target --before/--after/--around --limit`；`message search --query --target --sender --sort --before/--after --limit --offset`；`message resolve <id>` | `message check` 是非阻塞 drain，CLI help 明说“**Acks delivered seqs before returning**”；按 seq 排序，最多连续 drain 50 轮，仍有余量时提示再次执行。`inbox check` 只展示 pending targets、不 drain 正文，且 bundle 限为 managed-runner。`read` 有历史窗口，`search` 有分页 offset。 | 发布包 `dist/index.js`，源段 `src/commands/message/check.ts`、`src/commands/inbox/check.ts`、`src/commands/message/read.ts`、`src/commands/message/search.ts`；同包可执行 `--help`。产品层确认 agent inbox 是累计消息拉取：[Activity](https://docs.raft.build/features/messaging/activity.md)。 |
| 发送与并发保护 | `message send --target '#channel'|'dm:@peer'|…:threadId`，正文必须 stdin；`--attachment-id`；重发 draft 时 `--send-draft`，必要时 `--anyway` | 普通成功文本为 `Message sent to … Message ID: …`；若 server 返回 `state === "held"`，本地保存 `{content, attachmentIds, reholdCount, seenUpToSeq}` draft，显示“Your message has been saved as a draft”，引导改写、重发或不发；`--anyway` 只能配合 `--send-draft`。 | 发布包 `dist/index.js`，源段 `src/commands/message/send.ts`；官网的产品解释：[held draft](https://raft.build/resources/blog/is-having-agents-in-the-room-meant-to-be-chaotic/)。 |
| Task / claim | `task list --target --status`；`task create --target --title`（title 可重复）；`task claim --target (--number|--message-id)+`；`task unclaim --target --number`；`task update --target --number --status todo|in_progress|in_review|done|closed` | `claim` 可批量输入 task number 或 message id。server 返回 freshness-held 时 CLI 明示 “Your task claim was not applied”；引导先读新上下文再重试。产品规则：一个 task 同时一位 owner，claim 防重复劳动。 | 发布包 `dist/index.js`，源段 `src/commands/task/*.ts`；[Tasks](https://docs.raft.build/features/collaboration/tasks.md)。 |
| Thread / channel 注意力 | `thread unfollow --target <thread> [--reason]`；`channel join/leave/mute/unmute --target`；`channel info <target>`；`channel members <target>` | unfollow 只停止 ordinary delivery，不取消读/回帖权；频道可 join、leave、mute。 | CLI help；[Threads](https://docs.raft.build/features/messaging/threads.md)、[Channels](https://docs.raft.build/features/messaging/channels.md)。 |
| Mention | `mention pending`；`mention notify <resolutionIds…>`；`mention add <resolutionIds…>`，均可 `--json` | 这是**发送方**处理 unresolved mention target 的 action，非“读取我被 mention 的 inbox”命令。公开文档仅承诺 @mention 是 attention signal，不是频道成员的 delivery filter；公开频道对未加入者 mention 会给 notify-or-add prompt。 | CLI help；[Messages](https://docs.raft.build/features/messaging/messages.md)。 |
| Reminder | `reminder schedule --title (--delay-seconds|--fire-at) [--repeat] --message-id`；`list/cancel/snooze/update/log` | agent-created reminder 必须锚定 message id；支持一次性、重复、snooze、更新、取消与自己的 lifecycle log。产品语义为 reminder 触发时唤醒创建者，并在锚定表面发通知。 | CLI help；[Reminders](https://docs.raft.build/features/agents/reminders.md)。 |
| 身份、查找与附件 | `profile show/update`；`server info`；`user info <name>`；`attachment upload --path --target`、`view`、`comments` | profile 可改 display name、description、avatar；attachment upload 上限 50 MB；message search 是有权范围内跨频道查找。 | CLI help；[Members](https://docs.raft.build/features/server/members.md)、[Search your raft](https://docs.raft.build/search-your-raft.md)。 |
| 操作说明与外接服务 | `manual get/search`；`integration list/login/env/invoke`；`action prepare`；`agent bridge` | Manual 从**当前 server**获取；bundle 只公开 `manual get index` 是枚举入口，未公开具体主题正文。`agent bridge` 支持 `wake-channel`、poll、state dir、wake/activity endpoint。 | CLI help；[External Agents](https://docs.raft.build/features/agents/external.md)、[wake contract](https://github.com/botiverse/raft-external-agents/blob/main/docs/wake-endpoint-contract.md)。 |

### 2.1.1 完整命令目录（按公开 `--help`）

下表补足上一表未逐项展开的命令。除明确标为 `--json` 的命令外，官方 help 只承诺人可读 CLI 输出；成功 JSON 形状未作为公开稳定合同。所有输入选项和命令名的证据均为 [官方发布包](https://registry.npmjs.org/@botiverse/raft/-/raft-0.0.17.tgz) `dist/index.js` 中对应 `src/commands/<组>/<命令>.ts` 的 source-map 注释与可执行 `--help` 输出。

| 组 | 完整公开命令 | 输入与输出/作用（准确概述） |
| --- | --- | --- |
| `auth` | `whoami` | 无子参数；输出从本地环境解析的 agent context，token redact。 |
| `agent` | `login`、`login start`、`login wait`、`login status`、`list`、`bridge` | login 输入 server、agent id、profile slug；start 输出浏览器交接和 device code，wait 用该 code 轮询并保存 credential，status 报 credential 是否可用/过期/需重新登录；list 列出当前用户可 mint credential 的 agent。bridge 输入 poll、state dir、adapter 与 wake/activity endpoint，作为长期 bridge 运行。 |
| `channel` | `info`、`members`、`create`、`update`、`add-member`、`remove-member`、`join`、`leave`、`mute`、`unmute` | `info/members` 取 target；create 输入 name/description/`--private`，update 输入 target/name/description/public-private，增删成员输入 target 与 `--user` 或 `--agent`；后四项改变自身频道 membership 或 ordinary Activity delivery。create/update/member 管理要求 agent 有 server admin authority。 |
| `thread` | `unfollow` | 输入 thread target 和可选 `--reason`；输出 thread-local unfollow notice 的结果。 |
| `server` / `user` | `server info`、`server update`、`user info <name>` | server info 是有界 server facts（`--full` 为 legacy inventory）；server update 要 admin authority；user info 输出可见 human/agent 及可见 membership。 |
| `manual` / `knowledge` | `manual get <topic>`、`manual search <keywords>`；`knowledge` 是 legacy alias | get/search 可带 `--reason`，search 可带 `--scope recipes`；输出 server 提供的 Manual topic 或搜索结果。 |
| `inbox` | `check` | 无输入；仅 managed runner 可用，输出不含正文的 pending inbox target snapshot，不推进 cursor。 |
| `message` | `send`、`check`、`read`、`search`、`resolve`、`react` | send/read/search/check 见上；resolve 输入 exact message id，输出 canonical message；react 输入 `--message-id --emoji [--remove]`，添加/删除本人的 reaction，官方 guidance 要求显式请求或明显 acknowledgement 时才使用。 |
| `attachment` | `upload`、`view`、`comments` | upload 输入绝对 `--path`、target、可选 MIME；view 输入 id/输出本地路径；comments 输入 attachment id 和 limit。 |
| `task` | `list`、`create`、`claim`、`unclaim`、`update` | 输入/语义见上一表；list 可按 status 过滤；create 的 `--title` 可重复，形成批量 task。 |
| `mention` | `pending`、`notify <resolutionIds…>`、`add <resolutionIds…>` | 输入是发送方未解决 mention 的 resolution IDs；三项均支持 `--json`。没有公开 `remove` 子命令。 |
| `profile` | `show [target]`、`update` | show/update 支持 `--json`；update 可更新 avatar file/url、display name、description。 |
| `integration` | `list`、`login`、`env`、`invoke`、`app` | 管理 Raft app/registered service 的 agent login、局部环境或 manifest HTTP action；公开 help 不足以证明第三方 service 的参数/响应 schema。 |
| `reminder` | `schedule`、`list`、`cancel`、`snooze`、`update`、`log` | 输入和 reminder 语义见上一表；`list --all/--status`，其他操作用 reminder id。 |
| `action` | `prepare` | B-mode quick-commit shortcut：准备 action card 供 human commit；这不是 agent 直接执行受限管理动作的证明。 |

### 2.2 `message check`、`inbox check` 与 history 的精确区分

1. **`message check`：会消耗（ack）投递的 agent inbox。**官方 CLI help 明示 “Drain the agent inbox (non-blocking). Acks delivered seqs before returning.” bundle 的实现调用 event API、按 `seq` 升序聚合、记录每个 target 已消费的最大 seq。它和“读频道历史”不是一个动作。
2. **`inbox check`：只查看 target 摘要。**公开 bundle 的命令描述为 “without draining or reading message content”，并在 external profile 下直接报错，建议用 `message check`。因此不能把它当作外部 agent 通用 inbox API。
3. **`message read`：显式 history 窗口。**target 可以是 channel、DM 或 thread；`before`/`after`/`around` 加 `limit` 明确提供追赶与分页方向。
4. **`message search`：另一个历史恢复入口。**官方文档说 agent 可搜索它有权看到的历史，用于恢复其忙碌期间或加入前发生的工作；命中打开后有上下文。[Search your raft](https://docs.raft.build/search-your-raft.md)。

**结论。**Raft 至少公开区分了“投递积压（check）”“不读正文的 target 概览（managed inbox check）”“指定对话历史（read）”“跨可见范围检索（search）”；不能把它简化成单一未读计数。

### 2.3 发送与 claim 的 freshness/held 合同

官方文章对 held draft 的准确概述是：每次 send 携带该草稿对应的 room version；未变化就 commit，发生变化就 hold，返还简短的新到达说明，草稿仍是一等状态。agent 可 revise、send as-is、保持沉默，或反复被 hold 后显式 send anyway。[来源：官网文章](https://raft.build/resources/blog/is-having-agents-in-the-room-meant-to-be-chaotic/)。

发布包提供了可核验的落地细节：

```text
首次发送：已消费的 target 最大 seq -> seenUpToSeq -> server
server 返回 held：本地保存 draft + 新 seenUpToSeq
raft message send --send-draft：重查 freshness 后发送草稿
raft message send --send-draft --anyway：继续发送仍陈旧的草稿
```

- 普通 send 不接受位置参数或 `--content`；正文只从 stdin 读。这降低 shell 参数误传/转义歧义，但不是协作语义本身。
- `--anyway` 不是第一次发送的绕过开关，且不能与 stdin 正文或 attachments 同时用在 draft 重发路径。
- `task claim` 同样处理 freshness-held：**claim 不会被应用**；该命令没有草稿可重发，只能在读取新上下文后重新 claim。

**公开但未能确定的部分：**server 如何计算 room version、hold 返回的完整 JSON、是否存在每 target 以外的全局 sequence、draft 的保存路径/生命周期、claim 竞争的原子性实现都未公开；不得从 bundle 的字段名或 UI 推断。

---

## 3. Agent system prompt、instructions、reminder/context hint

### 3.1 已公开的精确文本

**Claude Code 外部 agent 的方向提示（orientation）。**官方 External Agents 文档给出完整 `--append-system-prompt`：

> `You are connected to Raft, a shared workspace for humans and agents. Treat Raft as your primary collaboration surface with people and other agents; use the terminal as a tool for local work. If you need the operating guide, run raft manual get raft-cli-overview.`

来源：[External Agents](https://docs.raft.build/features/agents/external.md)。公开插件源码也把同一文本定义为 `RAFT_SESSION_ORIENTATION`，并说明 SessionStart 同步注入，resume/compaction 后再注入：

- 源码：[`plugins/raft-channel/src/activity.ts`](https://github.com/botiverse/raft-external-agents/blob/main/plugins/raft-channel/src/activity.ts)，符号 `RAFT_SESSION_ORIENTATION` / `buildSessionStartOutput`。
- hook 声明：[`hooks/hooks.json`](https://github.com/botiverse/raft-external-agents/blob/main/plugins/raft-channel/hooks/hooks.json)，`SessionStart` 非 async，其他活动 hook 为 async。

**Wake hint。**公开插件将 server 到 runtime 的 wake 限制为 content-free metadata，注入可见上下文的短提示包含：

> “Raft wake hint received.”
>
> “Run `raft message check` to pull the pending message.”

并提示首次会话可运行 `raft manual get raft-cli-overview`，`raft profile show` 只用于确认身份，不能作为频道/thread 权限或回帖 target 的来源。

- 源码：[`plugins/raft-channel/src/wake.ts`](https://github.com/botiverse/raft-external-agents/blob/main/plugins/raft-channel/src/wake.ts)，`channelBatchContent`。
- 协议：[`docs/wake-endpoint-contract.md`](https://github.com/botiverse/raft-external-agents/blob/main/docs/wake-endpoint-contract.md)。协议规定 wake body **不得含 message body、channel name、sender identity**；runtime adapter 不持 Raft credential、不推进 delivery/read/model_seen cursor。

**CLI 自带的操作提示。**官方 CLI `--help`、held 文本、错误 `suggestedNextAction` 会提示下一步，例如 `message check` 后的 “More messages are pending. Run … again.”、held 后如何改写/重发。这是工具输出中的 context hint，不是模型系统提示。来源：发布包 `dist/index.js`，源段 `src/commands/message/send.ts` / `check.ts`。

### 3.2 Reminder 的公开上下文

官方公开的是行为，不是 reminder 被唤醒时注入 prompt 的原文：reminder 锚定 message 或 thread，触发时唤醒创建它的 agent，并向锚定表面发布通知；仅作者收到 wake，可管理自己的 reminder。[Reminders](https://docs.raft.build/features/agents/reminders.md)。

**未公开：**reminder wake 给模型的具体文本、会带多少 anchor/thread 历史、是否进入 inbox、与普通 message check 的 cursor 关系。

### 3.3 未公开，不能假定的 prompt/instructions

| 项目 | 调研结论 | 不能作出的推断 |
| --- | --- | --- |
| 托管 Raft agent 的完整 system prompt | **未公开。**公开站点和公开 GitHub org 中没有 server/managed-runtime 源码；官方 npm metadata 的 repository 指向 `botiverse/slock`，但该 GitHub repo 对匿名 `gh` 和 `git ls-remote` 都不可访问。 | 不能把 External Agent 的 1 段 orientation 当成托管 agent 的完整 system prompt，更不能臆造 prompt 中的角色、工具步骤或安全规则。 |
| `raft manual get raft-cli-overview` 内容 | **未公开。**CLI 明说 Manual 从 current server 取得；公开资料只有如何执行和 `index` 入口。 | 不能用 CLI 子命令清单推断 Manual 的操作顺序、团队策略或 prompt 内容。 |
| inbox admission、read/model_seen cursor | **未公开。**wake contract 只定义 runtime component 不碰 cursor；它没有给出 server cursor 数据模型。 | 不能声称 Raft 是 exactly-once、at-least-once 的“消息正文投递”系统，或断言何时标已读。 |
| managed agent 运行中收到新消息时如何重建上下文 | **未公开。**官网文章描述 turn-based 问题和 inbox 设计原则，公开 plugin 只实现外部 Claude Code 的 wake。 | 不能从“agent 变 active”或状态灯推断 prompt splice、即时中断或全历史重放策略。 |

---

## 4. Channel、thread、follow、mention、加入与历史追赶

### 4.1 Channel membership 与 message visibility/delivery

| 事实 | 准确概述与直接来源 |
| --- | --- |
| 公开频道在加入前可读 | 公开频道对所有 server member 可见、可自行加入、加入前可读；agent 可自行加入。官方还区分“可读”与“auto-delivery”：agent 未加入公开频道可读，但只有加入后得到 auto-delivery。[Channels](https://docs.raft.build/features/messaging/channels.md) |
| 私有频道不允许 agent 自行加入 | 私有频道只对成员可见/可读；owner 或 admin 才能添加 agent。[Channels](https://docs.raft.build/features/messaging/channels.md) |
| mention 不是频道成员的 delivery filter | 已加入频道的成员本来就收到每条消息；`@mention` 是指向某人的 attention signal。公开频道可 mention 未加入者，产品会给 notify-or-add prompt，不会自动拉其入会。[Messages](https://docs.raft.build/features/messaging/messages.md) |
| agent 活跃触发 | 官方 lifecycle 文档称 joined channel 出现新消息、被 mention、或 reminder fire 时，agent 变 active 并处理。[Lifecycle](https://docs.raft.build/features/agents/lifecycle.md) |

**必要保留。**“收到”“auto-delivery”“active”是官方产品文案；它们**不是**公开的 runtime API、queue 事务语义或 prompt 注入顺序。

### 4.2 Thread 与 follow

| 事实 | 准确概述与直接来源 |
| --- | --- |
| Thread 结构 | 顶层 channel/DM message 才可作 anchor；首条 reply 创建 thread；reply 不进入主 flow；不能嵌套。[Threads](https://docs.raft.build/features/messaging/threads.md) |
| 历史 | 打开 thread 可读从 anchor 开始、按序的完整 replies 历史。[Threads](https://docs.raft.build/features/messaging/threads.md) |
| 自动 follow | 在 thread 发言或在其中被 @mention 时自动 follow；follow 后接收新 reply notification。agent 也适用。[Threads](https://docs.raft.build/features/messaging/threads.md) |
| unfollow | 可停止通知，但不移出 thread，仍可读和 reply；CLI 提供 `raft thread unfollow --target … [--reason]`。[Threads](https://docs.raft.build/features/messaging/threads.md) 与官方发布 CLI。 |
| Task relation | Task 是带元数据的 message；一个 task 同时一位 owner；task anchor 的 thread 放进度和结果。官方推荐 agent 先 claim，claim 失败则转向别的未认领工作。[Tasks](https://docs.raft.build/features/collaboration/tasks.md) |

### 4.3 中途加入、历史追赶、unread 与 inbox

1. **中途进入公开频道：**官方确认加入前可读；因此历史可通过 `message read` 或 search 获取。官网介绍文章也写“new agent joins a channel, reads the history, and starts contributing”，但这只是产品层承诺，没有给出自动读多少页、是否自动写入 agent context。[Introducing Raft](https://raft.build/resources/blog/introducing-raft-where-humans-and-agents-build-together/)。
2. **普通历史追赶：**`message read` 的 `before/after/around/limit` 与 `message search` 的 `limit/offset` 都是公开 CLI 输入；可以确认 agent 可以主动分段读，不可确认新成员是否一定自动全量追赶。
3. **人类 unread：**Activity 汇集 joined channels、followed threads、DM、mentions；有 All/Unread/Mentions，打开 conversation 从 first unread 开始。[Activity](https://docs.raft.build/features/messaging/activity.md)、[Catch up in one place](https://docs.raft.build/catch-up-in-one-place.md)。
4. **agent inbox：**Activity 文档明确说 agent 不以人类 Activity 方式工作，而在 inbox delivery 上通过 check 看到上次检查后的累计消息。结合公开 CLI，可确认 agent 以 pull/drain 读 inbox，且 `message check` acknowledgement 会推进本地“已消费 seq”。**不能确认**服务端 unread 的数据定义、UI 红点的源、或 check 前后所有 message 是否永久可再读。

### 4.4 运行中消息与 held draft

Raft 官方文章把 agent 描述为 turn-based：agent 推理/起草时不能同时看新到消息。它给出的明示处理是：

```text
入站：inbox 把 mention、thread updates 等变为可查询项；agent 有余力再 pull。
出站：send 携带写作所见 room version；房间已动则 hold 草稿，交由 agent revise / send as-is / silence / informed override。
```

来源：[Is Having Agents in the Room Meant to Be Chaotic?](https://raft.build/resources/blog/is-having-agents-in-the-room-meant-to-be-chaotic/)。公开 bundle 对应了入站 `message check` 和出站 `seenUpToSeq`/draft/`--anyway`。

**不能延伸为：**Raft 会在模型生成中途抢占/中断；所有 thread update 一定立即唤醒每个 agent；或 held 一定针对“thread”而非 target/room 的某种服务端版本。以上没有公开一手实现。

---

## 5. 对 DSH Agent Team 的借鉴与不可照搬项

DSH 当前已经具备与此调研直接相关的基础：Team Host 的 append-only ledger 是 authority；`team_view` 返回有 cursor/`hasMore` 的有界视图；`team_send` 有 thread `baseRevision`、stale revision 后 reread 的约束；delivery 要先取得 Session Inbox evidence 再落 durable admission；`team_follow` 将 follow 与可读/可回帖权分离。来源：本仓库当前 `docs/architecture.md`、`packages/tool-agent-team/src/index.ts`、`packages/agent-team/src/index.ts`，不是 Raft 资料。

### 可借鉴

| 方向 | Raft 一手证据 | 对 DSH 的具体价值 |
| --- | --- | --- |
| 拉取式 inbox，不把通知正文直接塞进工作上下文 | 官网明确说 mention/thread update/notification 是可查询 item，由 agent 决定何时 pull；外部 wake 只传 content-free metadata。 | 延续 DSH 的 non-blocking delivery：保持“安全 next-step 边界才提示”，让 `team_view`/专用 inbox 投影成为正文读取入口，避免普通 thread 更新污染工作上下文。 |
| 每个工具输出给“信息 + 下一步” | Raft search 文章明确反对 raw IDs/full dumps，要求 preview 加明确 next action。[A Comfortable AX for Agent Search](https://raft.build/resources/blog/a-comfortable-ax-for-agent-search/) | `team_view`、stale revision、未读/mention 结果都应给 opaque ref、有限 preview、cursor/hasMore、下一步命令；不要靠 agent 猜该重读哪个 thread。 |
| 出站 freshness fence + durable draft | Raft message send 的 `seenUpToSeq`、held、`--send-draft`、`--anyway` 是公开、可执行的闭环。 | DSH 已有 `baseRevision` fence；可评估把 stale send 从“仅错误”升级为“保留待发送草稿 + 指出新增消息 + 重新组织/明确越过”。是否做应以 DSH 单一 ledger authority 落账，而非复制 Raft 本地 CLI draft store。 |
| claim 也要防止基于旧上下文提交 | Raft `task claim` 也可能 freshness-held，且不会应用 claim。 | DSH Direction Claim 已支持同 task 不同方向并行。对同一 direction 的 claim/release/done 继续维持 revision/幂等围栏，不能只保护 reply。 |
| follow 与参与权分开 | Raft 官方说明 unfollow 后仍能读和 reply。 | DSH 现有 `team_follow` 已符合；可保持其为注意力/投递订阅，而非授权开关。 |
| 明示外部 runtime 的最小 wake 边界 | Raft wake 不含正文，runtime 不拥有业务 cursor；bridge 与 runtime 职责分开。 | 若 DSH 后续接外部 agent，保留 Host 对 delivery/read state 的唯一权威；wake adapter 只负责通知，不能成为第二套 inbox 或确认机制。 |

### 不可照搬 / 需要明确偏离

| 项目 | 原因 |
| --- | --- |
| **Raft 的单 owner task claim** | Raft 明示一 task 一 owner；DSH 当前的长期设计是同一 task 可按不同 normalized direction 并行 claim。这是产品模型分歧，不应为了“像 Raft”删除 DSH 的方向 claim。 |
| **Raft 的“加入频道即普通消息全量 delivery”** | DSH Working Memory 已确定普通 Thread 更新不进 agent context、mention 在安全 next-step 边界提示。Raft 的频道模型可作对照，不应推翻 DSH 的降噪取舍。 |
| **Raft 本地 CLI 文件式 draft 行为** | 发布 bundle 显示 draft 保存在 CLI 一侧；DSH 的 durable Team 事实必须只由 Host ledger 负责。若采用 held draft，应在 Host ledger 中建一条权威事实/投影，不能在工具或 UI 放平行状态。 |
| **将 External Agent orientation 当作完整人格/团队提示** | 官方仅公开一段四句 orientation；托管 system prompt 与 Manual 未公开。DSH 必须基于自身 preset/工具合同写提示，不能猜测并移植 Raft 的隐藏 prompt。 |
| **从 Raft UI 反推协议** | 本调查没有用 UI 推导任何未公开行为；官方 docs 与 bundle 都不足以证明 server cursor、自动追赶窗口、unread 算法、实时中断机制。DSH 不应为追求表面相似而实现这些猜测。 |

---

## 6. 明确未公开清单

以下项目在本次允许范围内没有找到可验证的一手公开实现或合同，报告不下结论：

1. 托管 Raft agent 的完整 system prompt、各 runtime 的 prompt 差异、prompt 版本和 compaction 后完整重建内容。
2. `raft manual` 的 topic 清单、`raft-cli-overview` 正文、recipe 内容及其是否自动注入 context。
3. server 的 message/inbox/thread/task API 路径、完整 JSON schema、权限校验、idempotency key、cursor 持久化与 ack 事务算法。
4. unread/Activity 的数据表、何时标 read、mention 与 follow 的 dedupe 规则、频道 mute 对 mention/reminder 的精确优先级。
5. 新成员自动追赶的实际范围、分页大小、是否自动注入全历史到模型、history retention。
6. managed runtime 的 wake/retry、运行中消息是否中断模型、模型何时执行 `message check`、是否保证一个消息被某个模型看见。
7. held 判定的服务端算法、room version 范围、draft 服务端/客户端持久化边界、`--anyway` 审计行为。
8. task claim 的服务器并发原子性、失败返回结构、任务状态变迁的完整授权规则。

这些空白应在将来获得 Raft 官方公开规范、官方可访问源码或受授权的产品/API 观察后再补；不能由产品页面、截图、命令名、状态灯或宣传语补写。

---

## 7. 本次验证记录

- 通过 `gh api` 获取 `botiverse` 官方公开仓库列表、两仓库 tree、raw 文件和 commit SHA；未把无法访问的 `botiverse/slock` 当作公开源码。
- 下载官方 npm registry 的精确 tarball，执行 `raft --version`、根 `--help` 及 message/inbox/task/channel/thread/mention/reminder/attachment/profile/manual/agent 等子命令 `--help`；版本输出为 `0.0.17`。
- 仅对发布包中可审阅的 `dist/index.js` 作静态核验；没有伪造登录凭据、调用私有服务端 endpoint 或从 UI 抓取网络请求。
- 本次仅新增此 `.scratch/research/` 报告；未修改生产代码、正式文档或测试。
