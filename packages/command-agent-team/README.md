# @deepseek-ai/dsh-command-agent-team

English | [中文](README.zh.md)

Human `/team` control over [`ctx.agentTeam`](../agent-team/README.md). The plugin registers one global command through [`ctx.commands`](../../interaction/commands/README.md), so interactive adapters execute Team intents without starting a model turn.

## Command contract

`/team` and `/team status` return the current durable ledger sequence, operation count, channel count, and Agent Member count. Any other input returns `usage: /team status` until its corresponding M1 operation is available through the Host capability.

The command output is live presentation state. Generic `command/run` and `command/done` events record command execution, while the Agent Team operation ledger remains the sole authority for collaboration facts.

## Composition

Mount `dsh-commands`, `dsh-agent-team`, and this plugin. The command registration is an effect and disappears when this plugin's Fiber is disposed.

## Model Experience

### Human `/team` control

#### What the model sees

The slash input and direct status or usage output are absent from model requests.

#### Token effect

Executing `/team` adds no model tokens.

#### KV Cache effect

Command discovery and direct output do not alter model requests or cache reuse.

## Known Limitations and Deferred Work

- **Status only** — channel, member, message, claim, follow, and task commands are added with the Host intents that enforce their authority and durable transitions.
- **No headless presentation** — only adapters that consume `ctx.commands` expose this command.
