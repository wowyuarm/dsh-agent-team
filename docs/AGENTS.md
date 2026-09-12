# docs/ Work Rules

This directory holds the repository's maintained engineering documentation. The root `AGENTS.md` keeps rules every task must know; this file only governs how to work here — routing a change to the document that owns its facts, and the discipline that keeps the set truthful.

## Routing

A change that invalidates a documented fact updates the owning document in the same change:

| Change touches | Update |
| --- | --- |
| Domain vocabulary, concepts, or collaboration semantics | [`domain-model.md`](domain-model.md) |
| Package ownership, Host authority, Remote/preset/Client boundaries, or internal mechanisms | [`architecture.md`](architecture.md) |
| Model-facing tools, Attention, Inbox, or the collaboration contract | [`team-collaboration.md`](team-collaboration.md) |
| Visible UI or interaction under `packages/client-agent-team/src/client/` | [`frontend-design.md`](frontend-design.md) |
| Environment setup, verification, generated files, or release workflow | [`development.md`](development.md) |
| DSH certification, `peerDependencies`, or installation checks | [`dsh-release-compatibility.md`](dsh-release-compatibility.md) |
| Cross-repository lookup | [`harness-navigation.md`](harness-navigation.md) |
| User-visible behavior | [`../CHANGELOG.md`](../CHANGELOG.md) |

The full index and Where to start paths are in [`README.md`](README.md).

## Maintenance discipline

- Source and tests define implementation behavior. When prose conflicts with code, fix the documentation — never record behavior the code does not implement.
- One fact has one maintained home; cross-link between documents instead of duplicating the fact.
- Maintained docs ship as bilingual pairs: change `foo.zh.md` in the same change as `foo.md`, translating prose while keeping technical terms (Agent, Workspace, Channel, Thread, Task, Claim, preset, Remote) in English.
- A new maintained document gets an index row and a Where to start path in both `README.md` and `README.zh.md` in the same change.
- Write uncertain facts as `> TODO:` instead of guessing.
- Run `npm run check:docs` after changing a document here, adding a maintained one, or editing any of the four README pairs (the repository root and one per package); it decides the pairing, switcher, relative-link, and index rules above. The shipped core skills under `packages/agent-team/core-skills/` have their own gate, `npm run check:core-skills`. Both commands are described in [`development.md`](development.md).
- Commit doc changes as one Conventional Commits subject line (`docs: ...`) over only your own staged paths — never `git add -A` in the shared worktree — and run `git diff --check` before committing.
- `.scratch/` is work history, not an authority; move conclusions into these documents only when durable, and never rewrite archives to match new code.

AGENTS.md files are single-language: this file and the root `AGENTS.md` are English, while maintained docs keep their `.zh.md` pairs.
