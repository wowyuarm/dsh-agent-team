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

The Host package provides the `agentTeam` Service and operation ledger. The command package registers `/team`. Agent tools and the team-enabled preset are separate opt-in rows and will be added by the later M1 tickets.

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

M1 tickets 03-09 add member lifecycle, agent preset provisioning, team tools, delivery recovery, and the assembled real composition. The current package set contains the initial ledger and Human command adapter only.
