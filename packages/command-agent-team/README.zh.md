# @deepseek-ai/dsh-command-agent-team

[English](README.md) | 中文

面向 Human 的 [`ctx.agentTeam`](../agent-team/README.md) `/team` control。插件通过 [`ctx.commands`](../../interaction/commands/README.md)注册一个全局 command，使交互 adapter 无需启动模型 turn 即可执行 Team intent。

## Command 约定

`/team` 和 `/team status` 返回当前持久 ledger sequence、operation 数量、channel 数量和 Agent Member 数量。在对应 M1 operation 可通过 Host capability 使用前，其他输入返回 `usage: /team status`。

Command output 是实时 presentation state。通用 `command/run` 和 `command/done` event 记录 command execution，而 Agent Team operation ledger 仍是协作事实的唯一 authority。

## Composition

挂载 `dsh-commands`、`dsh-agent-team` 和本插件。Command registration 是 effect，并在本插件 Fiber dispose 时消失。

## Model Experience

### Human `/team` control

#### What the model sees

Slash input 和直接 status 或 usage output 不进入模型请求。

#### Token effect

执行 `/team` 不增加模型 token。

#### KV Cache effect

Command discovery 和直接 output 不改变模型请求或 cache reuse。

## Known Limitations and Deferred Work

- **仅支持 status** — channel、member、message、claim、follow 和 task command 会随能够执行 authority 和持久 transition 的 Host intent 一起加入。
- **无 headless presentation** — 只有消费 `ctx.commands` 的 adapter 才会暴露该 command。
