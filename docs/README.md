# dsh-agent-team Documentation

English | [中文](README.zh.md)

This directory contains the maintained engineering documentation for this repository. The root `AGENTS.md` keeps only rules that every task must know; [`AGENTS.md`](AGENTS.md) here routes doc edits and maintenance — read it before changing anything under `docs/`. Use this index for detailed workflows, architecture, domain language, and cross-repository navigation.

## Documentation entry points

| Document | Purpose | Read it when |
| --- | --- | --- |
| [`development.md`](development.md) | Setup, commands, generated artifacts, live/UI preview, browser replay, and release checks | Starting development, running verification, changing a package, or changing release layout |
| [`dsh-release-compatibility.md`](dsh-release-compatibility.md) | Evaluating new DSH versions, isolated certification, installation checks, and release gates | DSH releases, updating `peerDependencies`, or investigating cross-version installation failures |
| [`architecture.md`](architecture.md) | Host, tools, command, typed Remote, Client plugin, and authority boundaries | Changing runtime, RPC, preset, Client, or persistence |
| [`domain-model.md`](domain-model.md) | Stable Agent Team vocabulary | Changing domain semantics, type names, or the collaboration contract |
| [`team-collaboration.md`](team-collaboration.md) | The implemented eight-tool, Thread Attention, Inbox, reading, mention, and mutation-fence contract | Changing collaboration semantics, model-facing tools, or Agent notifications |
| [`frontend-design.md`](frontend-design.md) | Long-lived Team Client UI system: principles, layout, typography, components, accessibility, and verification | Changing visible UI or interaction under `packages/client-agent-team/src/client/` |
| [`harness-navigation.md`](harness-navigation.md) | Routes through this repository and `../deepseek-harness`, including source entry points and integration traps | Unsure which Harness document, package, source, or test to inspect |

## Documentation rules

Editing or adding a document under `docs/`? Routing branches and the maintenance discipline live in [`AGENTS.md`](AGENTS.md) — read it first.

## Where to start

- **Host or domain changes:** [`architecture.md`](architecture.md) for boundaries, [`domain-model.md`](domain-model.md) for vocabulary; `packages/agent-team/src/` and its tests are the authority. Use `.scratch/README.md` to locate historical decisions when needed.
- **Tools, preset, or `/team` changes:** the relevant sections of [`architecture.md`](architecture.md), then the Harness cookbook and subsystem docs.
- **Client or UI changes:** [`frontend-design.md`](frontend-design.md) for the UI system, [`harness-navigation.md`](harness-navigation.md) for the cross-repository route.
- **Installation, build, tests, or Remote generation:** [`development.md`](development.md), then the actual `package.json` or script implementation.
