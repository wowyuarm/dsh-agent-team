# DeepSeek Harness Agent Team

An opt-in Cordis bundle that adds a durable, single-host Agent Team to DeepSeek Harness.

## Install

The bundle is intended to be installed into a DSH profile:

```sh
dsh plugin --profile team-demo add @deepseek-ai/dsh-agent-team-bundle
dsh --profile team-demo
```

The bundle contributes `cordis.patch.yml`; it does not modify the Harness installation or enable itself in shipped defaults.

For local development:

```sh
dsh plugin --profile team-demo add /absolute/path/to/dsh-agent-team
dsh --profile team-demo
```

The profile must include the Harness packages that provide the injected services used by the selected composition. Published packages provide built artifacts. Git installs require a self-contained `prepare` script and an explicit pnpm build allowance.

## Composition

The Host package provides the `agentTeam` Service, operation ledger, and team-managed Agent lifecycle. The command package registers `/team`. Agent tools and the shipped team-enabled preset are separate opt-in rows added by the remaining M1 tickets.

The bundle consumes the profile's existing Host providers instead of replacing them: `agents`, `tools`, filesystem/shell, sandbox policy, session persistence, Workspace registry, and storage remain singletons. Team-managed sessions persist `danger-full-access`; ordinary sessions keep the profile's normal policy. A conflicting preset tool registration fails inside unpublished setup and makes only that Member unavailable.

The Team is one collaboration domain per DSH home. Its operation ledger is the durable authority; Channel, Message, Task, Thread, Follow, and Delivery projections are derived from committed operations.

## Development

The design and ticket sequence live under [.scratch/](.scratch/). Build and test with:

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

This repository targets the public DSH plugin and bundle interfaces. It does not depend on a sibling DeepSeek Harness checkout at runtime.

## Known Limitations and Deferred Work

M1 tickets 04-09 add the production team tool package/preset, delivery recovery, collaboration state transitions, and the final installable composition. Issues 01-03 now provide the ledger, Human command adapter, and real Agent Member create/suspend/resume lifecycle.
