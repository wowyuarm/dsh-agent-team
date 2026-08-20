# DeepSeek Harness Agent Team

An opt-in Cordis bundle that adds a durable, single-host Agent Team to DeepSeek Harness.

## Install

The bundle is intended to be installed into a DSH profile:

```sh
dsh plugin --profile team-demo add @deepseek-ai/dsh-agent-team-bundle
dsh --profile team-demo
```

The bundle contributes `cordis.patch.yml`; it does not modify the Harness installation or enable itself in shipped defaults. It mounts a bundle-private, isolated AgentPresets roster containing `team-member`, so `dsh plugin add` needs no source patch, preset copy, or profile root configuration. Ordinary DSH Sessions keep using the profile's shipped/user preset roster.

For local development:

```sh
dsh plugin --profile team-demo add /absolute/path/to/dsh-agent-team
dsh --profile team-demo
```

The profile must include the Harness packages that provide the injected services used by the selected composition. Published packages provide built artifacts. Git installs require a self-contained `prepare` script and an explicit pnpm build allowance.

## Composition

The Host package provides the `agentTeam` Service, operation ledger, team-managed Agent lifecycle, Channel membership, and durable Thread Inbox. The command package registers `/team`. The shipped opt-in `team-member` preset provides Team guidance and the membership-authorized `team_inbox`, `team_thread`, `team_message`, `team_claim`, and `team_view` tools, plus an isolated compaction service. The Host patch mounts both invariant companions. The implemented pull-based protocol is documented in [`docs/team-collaboration.md`](docs/team-collaboration.md).

The bundle consumes the profile's existing Host providers instead of replacing them: `agents`, default model selection, `tools`, filesystem/shell, sandbox policy, Session store/persistence, Workspace registry, and storage remain singletons. Team-managed sessions persist `danger-full-access`; ordinary sessions keep the profile's normal policy. A conflicting preset tool registration fails inside unpublished setup and makes only that Member unavailable.

The Team is one collaboration domain per DSH home. Its operation ledger is the durable authority; Channel, Message, Task, Thread, Claim, Thread Attention, and Inbox projections are derived from committed operations.

## Development

The design and ticket sequence live under [.scratch/](.scratch/). Build and test with:

```sh
corepack pnpm install
npm run typecheck
npm test
npm run build
npm run test:browser
npm run preview:ui
DEEPSEEK_API_KEY=... npm run preview
npm pack --dry-run
```

`test:browser` uses the adjacent `../deepseek-harness` checkout's official Web scaffold and `/usr/bin/google-chrome` (override with `CHROME_PATH`). It installs the built packages into an isolated temporary profile and runs the credential-free, deterministic assembled journey, including the existing-Thread invitation, Agent read/reply, Human Inbox, reload, and ordinary DSH restoration. It updates `.scratch/ui-redesign/validation/` and removes all temporary Harness files.

`npm run preview` is the live interactive mode. It requires `DEEPSEEK_API_KEY` before build, mounts the real provider in an isolated temporary profile, prints a local URL, and cleans up on `Ctrl+C`; it never silently falls back to replay. `npm run preview:ui` loads isolated Team fixture state with model streaming disabled, for presentation inspection without an accidental provider call.

This repository targets the public DSH plugin and bundle interfaces. Installed users do not need a sibling Harness checkout or Harness source changes; the checkout relationship above is only a development test seam.

## Known Limitations and Deferred Work

M1 is complete. The bundle is single-host and opt-in. It does not provide distributed consensus, Team direct messages, nested Threads, automatic semantic deduplication of Directions, or model-processing acknowledgement beyond durable Inbox admission. The preset intentionally grants Team Members `danger-full-access`; select it only for trusted workspaces.
