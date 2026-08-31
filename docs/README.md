# dsh-agent-team Documentation

English | [中文](README.zh.md)

This directory contains the maintained engineering documentation for this repository. `AGENTS.md` keeps only rules that every task must know; use this index for detailed workflows, architecture, domain language, and cross-repository navigation.

## Documentation entry points

| Document | Purpose | Read it when |
| --- | --- | --- |
| [`development.md`](development.md) | Setup, commands, generated artifacts, live/UI preview, browser replay, and release checks | Starting development, running verification, changing a package, or changing release layout |
| [`dsh-release-compatibility.md`](dsh-release-compatibility.md) | Evaluating new DSH versions, isolated certification, installation checks, and release gates | DSH releases, updating `peerDependencies`, or investigating cross-version installation failures |
| [`architecture.md`](architecture.md) | Host, tools, command, typed Remote, Client plugin, and authority boundaries | Changing runtime, RPC, preset, Client, or persistence |
| [`domain-model.md`](domain-model.md) | Stable Agent Team vocabulary | Changing domain semantics, type names, or the collaboration contract |
| [`team-collaboration.md`](team-collaboration.md) | The implemented five-tool, Thread Attention, Inbox, reading, mention, and mutation-fence contract | Changing collaboration semantics, model-facing tools, or Agent notifications |
| [`frontend-design.md`](frontend-design.md) | Long-lived Team Client UI system: principles, layout, typography, components, accessibility, and verification | Changing visible UI or interaction under `packages/client-agent-team/src/client/` |
| [`harness-navigation.md`](harness-navigation.md) | Routes through this repository and `../deepseek-harness`, including source entry points and integration traps | Unsure which Harness document, package, source, or test to inspect |

## Documentation rules

- Documentation records verifiable engineering facts, stable maintenance workflows, and still-valid architecture boundaries.
- Source and tests define implementation behavior. When prose conflicts with code, fix the documentation; do not use documentation to describe behavior the code does not implement.
- `.scratch/` contains active work and archived designs, research, tickets, prototypes, and validation evidence. It is not an authority for current implementation or APIs. Read [`.scratch/README.md`](../.scratch/README.md) first; link to archives from maintained docs only for historical context, and verify conclusions against source and tests before recording them.
- Each fact has one maintained home. Commands, exports, manifests, and generated scripts remain authoritative in their own files; maintained docs record the maintenance rules, boundaries, and routes that are not obvious from those files.
- When a code change invalidates current behavior, workflow, or boundaries in maintained docs, update the docs in the same change.
- Write uncertain facts as `> TODO:` instead of guessing.

## Where to start

- **Host or domain:** read [`architecture.md`](architecture.md) and [`domain-model.md`](domain-model.md), then use `packages/agent-team/src/` and its tests as authority; use `.scratch/README.md` to locate historical decisions when needed.
- **Tools, preset, or `/team`:** read the relevant sections of [`architecture.md`](architecture.md), then consult the Harness cookbook and subsystem docs.
- **Client or UI:** read [`frontend-design.md`](frontend-design.md), the Client section of [`architecture.md`](architecture.md), and the UI acceptance rules in [`development.md`](development.md); use [`harness-navigation.md`](harness-navigation.md) for the cross-repository route.
- **Installation, build, tests, or Remote generation:** read [`development.md`](development.md), then inspect the actual `package.json` or script implementation.
