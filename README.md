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

The Host package provides the `agentTeam` Service, operation ledger, team-managed Agent lifecycle, Channel membership, and durable Inbox admission. The command package registers `/team`. `@deepseek-ai/dsh-tool-agent-team` provides membership-authorized `team_send`, `team_view`, and `team_claim`; `team_follow` and the shipped preset are added by later M1 tickets.

The bundle consumes the profile's existing Host providers instead of replacing them: `agents`, default model selection, `tools`, filesystem/shell, sandbox policy, Session store/persistence, Workspace registry, and storage remain singletons. Team-managed sessions persist `danger-full-access`; ordinary sessions keep the profile's normal policy. A conflicting preset tool registration fails inside unpublished setup and makes only that Member unavailable.

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

M1 tickets 06-09 add attention controls, completion/removal, broader failure recovery, and the final installable composition. Issues 01-05 provide the ledger, Human command adapter, Agent Member lifecycle, durable Delivery, revision-fenced replies, Direction Claims, and three production tools.
