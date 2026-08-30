# Community outreach materials

状态与当前前沿以 [`README.md`](README.md) 为唯一接续入口；本文件保存操作细节、human 认可的定位表述和已发布正文存档。

## Official discussion operations (delegated to Shipper, 2026-08-24)

Canonical post: https://github.com/deepseek-ai/deepseek-harness/discussions/4303
Title: DSH｜dsh-agent-team｜帮 human 有序管理任务：持久身份 Agent + Channel 职责 + Task Thread 串联协作
Category: Show Your Plugins!

Cadence:
- Post a release comment within 24h of every npm release (changelog highlights + npm/GitHub links).
- Edit the main post when positioning-level features land.
- Weekly sweep of Show Your Plugins! and Q&A for multi-agent/task/workspace threads; reply helpfully as wowyuarm.

Positioning (human-approved framing, supersedes "单主机持久化 Agent 团队" phrasing):
- Agents are persistent identities for sessions, not throwaway runs.
- Workspaces organize different agents/sessions per project.
- The human manages Channels and responsibilities; @mentions route work.
- Task Threads chain multiple session agents so work advances coherently.
- Essence: help humans manage tasks in an orderly way and use agents as real collaborators.

Posted body is archived below.

---

**dsh-agent-team** 把多 Agent 协作变成一件可以有序管理的事。

**核心想法**

- **Agent 是持久身份，不只是会话。** 每个 Agent 成员有自己的记忆与职责边界，跨会话保持连续性。
- **Workspace 组织一切。** 不同项目放在不同 Workspace，各自管理自己的 Agents 与 Channels。
- **Human 管 Channel 与职责。** 你决定谁在哪个频道、负责什么；@提及把工作路由到对的 Agent。
- **Task Thread 串联推进。** 用 Task 认领方向、Thread 保持上下文，多个 Session Agent 围绕同一条工作线推进而不散乱。

对 human 的价值：有序地管理任务，把 agents 用成真正的协作成员，而不是一堆平行开立的会话。

**安装**（已认证 DSH `0.1.1-rc.2`）：

```sh
dsh plugin --profile web add @wowyuarm/dsh-agent-team
dsh web
```

安装后在 DSH 导航进入 **Team mode** 即可开始；普通 Session 不受影响（opt-in bundle）。

- GitHub: https://github.com/wowyuarm/dsh-agent-team
- npm: https://www.npmjs.com/package/@wowyuarm/dsh-agent-team
- 反馈与问题：https://github.com/wowyuarm/dsh-agent-team/issues

> 本帖随版本更新长期维护，更新记录见评论区。EN: dsh-agent-team gives a DeepSeek Harness home durable Workspaces, Channels, Threads, Tasks, and managed Agent members with persistent identities — so a human can organize work and let agents collaborate through Task Threads.
