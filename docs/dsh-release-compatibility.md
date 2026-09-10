# DSH Release Compatibility Certification

English | [中文](dsh-release-compatibility.zh.md)

This document defines the fixed process for certifying an external `dsh-agent-team` bundle against new DeepSeek Harness (DSH) releases. A DSH version is supported only after installation, composition, and runtime have been proven. A DSH release triggers certification; it does not automatically trigger a Team release.

This is not a Team behavior specification. Team behavior is defined by `packages/` source and tests; the DSH interface is defined by the adjacent Harness checkout's source, tests, and published packages.

## 1. Triggers

Run certification when any of the following occurs:

- DSH publishes a stable or prerelease version.
- Team adds, changes, or removes a dependency on a DSH Host, Remote, Client, slot, preset, Session, Workspace, or Storage capability.
- A user reports installation, startup, or Team-mode failure on a DSH version.

Documentation-only DSH changes that do not alter the certified range do not require certification.

## 2. Version facts and support rules

### 2.1 Team and DSH versions

The Team bundle evolves independently according to Team changes. It does not mechanically follow DSH: existing peers may already cover a candidate; Team fixes may ship without a DSH release; and one DSH release may require several Team fixes or none.

DSH compatibility is expressed by peerDependencies in the root `package.json` and by the certified baseline here, not inferred from the Team bundle version. A compatibility-only range change still requires a new Team bundle because users obtain the new manifest from a published package.

### 2.2 The single version basis

Certify an immutable GitHub release tag, such as `dsh-v0.1.1-rc.2`, together with the same set of npm packages published by that tag. Record the tag, date and release notes, `@deepseek-ai/dsh` version, directly peered DSH packages, and whether installation resolves exactly one DSH dependency set at that version. Never use npm `latest` to identify the newest DSH; prereleases may be on `next`.

### 2.3 npm prerelease ranges

Prerelease ranges are not ordinary continuous intervals. For example, `>=0.1.0-rc.8 <0.2.0` does not match `0.1.1-rc.2`: a comparator containing `0.1.0-rc.8` enables prereleases on that same `0.1.0` baseline only.

Do not infer compatibility from a shared major version or hide unverified versions behind a broad range. Only when a candidate falls outside current peers and certification passes should all `@deepseek-ai/dsh-*` peerDependencies be moved together to the new version line and a new Team bundle be published. The result must resolve without nested old DSH packages.

## 3. Certification process

### 3.1 Discover and assess

1. Run `gh release list --repo deepseek-ai/deepseek-harness` to identify the latest release tag and notes.
2. Compare the previous certified tag's commits and changed files with the candidate.
3. Review the consumed surface first: Host (Agent, preset, Session, Workspace, Storage, Sandbox); Remote (Typert protocol and API remotes); Client (runtime, loader, slots, sidebar, layout, conversation, workspace, locale); and Team preset (tools and permissions).
4. Classify changes as unrelated, regression-required, or possibly incompatible. For suspected incompatibility, identify the upstream public interface and this repository's call site; release notes alone are insufficient.

### 3.2 Isolated certification environment

Use an independent checkout at the candidate tag, not the everyday `../deepseek-harness` checkout:

```text
Daily development
├── deepseek-harness/
└── dsh-agent-team/

Temporary certification
├── deepseek-harness-<tag>/
└── dsh-agent-team-compat-<tag>/
```

Build the certified Harness checkout first so Team TypeScript facades point at its declarations. Do not reuse old `lib/` or `node_modules`; that can conceal declaration or runtime incompatibility.

Then run in the isolated Team copy:

```sh
node scripts/sync-paths.mjs
npm run generate:typert
npm run typecheck
```

Typert output must be stable. Review generator output and the Remote contract before changing Team source; never hand-edit `packages/agent-team/lib/typert.*`.

### 3.3 Automated verification

Run the narrow tests for the changed surface, then at least:

```sh
npm test
npm run build
npm pack --dry-run
git diff --check
```

The following evidence is required:

| Capability | Required conclusion |
| --- | --- |
| Host recovery | Team ledger, Member creation, suspension, resume, and removal work under JSON and SQLite. |
| Preset isolation | `team-member` mounts; ordinary Sessions receive no Team tools or guidance. |
| Remote | Host face generates and Client mounts the generated Remote. |
| Client slots | Enter, leave, and restoration of the three Team shadows work; `sidebar.workspaces.directoryFlow` is not redeclared. |
| Publication layout | A packed root bundle installs through a real profile without source symlinks. |

### 3.4 Browser composition

Any bundle, Client module, Remote activation, slot, or DSH Client package change requires:

```sh
npm run test:browser
```

Run it against the candidate Harness checkout and verify ordinary DSH → Team mode → ordinary DSH restoration. Cover Remote mounting, Team entry/reload/exit, existing Channel/Thread/Member flows, 390×844 layout, keyboard focus/dialogs, and absence of Team tools, guidance, and UI in ordinary Sessions. Handle browser output as described in `development.md`; do not commit routine screenshots or temporary Harness tests.

### 3.5 Dependency graph installation

When the candidate is outside current peers, resolve an installation in an empty directory using the candidate DSH and updated packed Team bundle. Confirm there is no peer conflict, every Team DSH peer is satisfied, no second old DSH set is pulled in, and the real published-layout profile passes browser verification.

### 3.6 Upgrade viability

Sections 3.3–3.5 all build their evidence from **newly created** Sessions, which are written in the candidate's native format and never traverse a released-format migration. Two failure classes are therefore invisible to them, and both have shipped: a Member preset row whose config no longer matches its plugin schema (runtime-only), and released artifact content that the candidate's migration audit refuses. Add both checks whenever the candidate changes the Session format, the message-source vocabulary, or any shipped preset row:

- **Existing-history upgrade.** Take a profile that already holds Member Sessions written by the previous certified line — including at least one rolled-over generation — and open them under the candidate. Every one must load; a refusal is a release blocker, not a data problem, because the audit is fail-closed and leaves the source artifact unchanged. Record the artifact count checked and the result per artifact.
- **Published-bundle viability.** Determine whether the **currently published** Team bundle still functions on the candidate DSH, not just the candidate bundle. Install the published version against the candidate in an empty directory, boot it, and exercise Member creation. This decides release urgency: when `latest` has already moved to the candidate, an incompatible published bundle breaks new installs outright, which makes the round release-blocking rather than routine.

A custom Session message source kind is the durable trap behind the first check: `@deepseek-ai/dsh-llm` documents `MessageSourceMap` as merge-extensible, but the released-format migration audit admits a closed, build-static list of source kinds, so a plugin that adds one writes logs that a later format generation refuses wholesale. Prefer encoding plugin semantics in the admitted `plugin` + `form` + `sections`/`summary` shape over declaring a new kind.

## 4. Results and release gates

| Result | Action |
| --- | --- |
| Candidate is within current peers and all checks pass | Record the certified baseline and evidence; do not change the manifest or publish Team. |
| Candidate is outside current peers and all checks pass | Atomically update all DSH peers, compatibility docs, and Team version; verify the dependency graph and publish. |
| Any check fails | Do not widen peers or publish; record and handle under section 5. |

A peer expansion requires source assessment, passing Typert generation, typecheck, tests, build, pack checks, real browser composition, a conflict-free dependency graph, consistent compatibility wording in `package.json`, architecture/development docs and README, and no temporary material committed. Never widen a range before verification.

## 5. Failure handling

- **Only npm peer conflict:** do not claim support; revise the peer-range strategy and resolve again.
- **Typecheck or Typert failure:** locate the upstream interface change and Team call site, change Team source/tests, and repeat certification.
- **Browser composition failure:** isolate Client module, Remote, slot, and ordinary DSH restoration boundaries; do not bypass with private shipped UI or compatibility fallbacks.
- **Session or Storage recovery failure:** check for an announced persistence-format change; do not add silent Team ledger compatibility reads or fallback.
- **Insufficient public upstream API:** choose a maintainable bundle-owned design or propose a separate Harness contract change; do not change Harness shipped defaults to accommodate Team.

Record candidate tag, symptom, affected interface, reproduction command, and next step. Do not turn an unverified inference into a compatibility claim.

## 6. Current baseline

The current certified baseline is DSH `0.1.5-rc.1`. Certification covered Typert generation, full typecheck, 492 tests (1 skipped), build, pack checks, lint, and real browser composition with published-layout installation, Remote mount, Team entry/exit, and ordinary DSH restoration.

This candidate fell outside the previous `>=0.1.2-rc.1 <0.2.0` peers and required source adaptation, so peers moved as a hard cut to `>=0.1.5-rc.1 <0.2.0`; the bundle no longer runs on the `0.1.2-rc.1` line. Seven upstream breaks drove it: `ctx.agent` left `AgentSetup` (setup now receives the live `Agent` as its second argument); the root `conversation` slot became a keyed `main` entry (Team registers `main` with key `conversation` at priority `-100`, and the harness renders with `renderSlot('main', {}, { entryKey: 'conversation' })`); `SessionPersistence.inspect()`/`borrowSession()` were replaced by the handle API (`open(id, 'read')` + `read()` + `close()`, `stat()` returning header snapshots, and the detached `Session.create` factory); the `assistant/chunk` event type left the Session vocabulary; `MessageText` left `dsh-client-ui-primitives` (TeamMessage renders its text directly); keyed-slot conflict diagnostics replaced the single-slot wording in tests; and the `dsh-persona` row renamed its config key `text` → `prefix`. That last one is runtime-only: the member preset composes from disk, so typecheck, unit tests, and build all stayed green while every Member failed to activate with `preset "team-member" failed to mount: … $.prefix missing required value`. Session persistence is now the shipped JSONL backend with a released-format migration chain (v0/v1/v2 → V3), so the previous SQLite-schema disposal note no longer applies.

Preset composition has no compile-time or unit-test guard: the member specs compose a synthetic preset, so a row whose config no longer matches its plugin schema surfaces only in the real browser journey. Treat `npm run test:browser` as the certification gate for shipped preset rows.

This round exposed a second, wider blind spot that §3.6 now covers: every check above builds its evidence from newly created Sessions, which never traverse a released-format migration. Two shipped failures lived in that gap. First, Team declares two custom Session message source kinds (`agent-team-context-handoff`, `agent-team-context-continuation`) to carry rollover handoffs; dsh `0.1.2-rc.1` shipped no session-format packages at all, so those logs were harmless until `0.1.5-rc.1` introduced the migration chain and its closed source-kind audit began refusing them wholesale (`cannot safely transform unclassified message source`). The audit is fail-closed and leaves the source artifact byte-identical, so the effect is unreadable Sessions, not damaged data: affected Members show as unavailable while their durable state stays `enabled`. Second, the published `0.1.9` bundle still calls `ctx.agent`, `SessionPersistence.inspect()`, and `borrowSession()` — all removed in `0.1.5-rc.1` — so on a new install Member creation throws from the setup path even though the peer warning does not block installation and the host boots normally. Both classes are release-blocking while npm `latest` points at the candidate; §3.6 is the check that surfaces them before release.

Two verification facts were recorded without patching. An isolated Harness checkout needs `pnpm build:native-system` before the Team suite: the JSONL backend's flock lease locking loads a gitignored Node-API addon (`native/system/packages/<platform>/bin/{glibc|musl}/system.node`) that only the native build produces. And `npm run typecheck` before `npm run build` fails on the `@wowyuarm/dsh-agent-team/time-format` and `member-time-context` imports, which resolve through the built `lib/` self-link rather than the sync-paths `own` map; build first (a latent repo gap, not a compatibility defect).
