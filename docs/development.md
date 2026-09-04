# Development and Delivery

English | [中文](development.zh.md)

## Scope

This document records maintenance workflows for the repository. Exact command definitions remain authoritative in the root `package.json`, package manifests, and `scripts/`; update configuration first when a command changes, then update this document.

## Start developing

This repository is an independent external DSH bundle. End users install the published package; local development and real Web verification require the adjacent `../deepseek-harness` checkout.

```text
../
├── deepseek-harness/
└── dsh-agent-team/
```

Install dependencies with the command specified by the root README:

```sh
corepack pnpm install
```

`pnpm-workspace.yaml` includes `packages/*` in the workspace and disables automatic peer installation. The root `node_modules` and adjacent Harness checkout provide the packages and source mappings needed for local development.

## Verification gradient

Run the smallest sufficient checks for the change:

```sh
npm run generate:typert
npm run typecheck
npm test
npm run build
npm run lint
npm pack --dry-run
git diff --check
```

Their responsibilities are:

- `generate:typert` emits Typert Host/Remote artifacts from the Host face in `packages/agent-team/src/`.
- `typecheck` regenerates Typert and checks Host, tools, and Client sources.
- `test` regenerates Typert and runs Vitest. `scripts/isolate-dsh-home.setup.ts` gives each test file an isolated `DSH_HOME`; tests needing a particular home must save and restore it. Startup does not prune ledger-unknown Member directories; explicit Member removal removes that Member's private memory.
- `build` uses the restricted Node cleaner to clear package `lib/` directories, regenerates Typert, builds all three source trees, and uses Harness `tsdown` for the Client bundle. The published artifact remains one root npm package.
- `lint` runs oxlint.
- `pack --dry-run` checks the root bundle's published contents.

Changes affecting browser bundles, Client modules, slots, Remote activation, bundle manifests, or visible UI must also run:

```sh
npm run test:browser
```

This builds first, copies built packages into a temporary profile, starts the official Harness Web scaffold, and runs the real journey with `/usr/bin/google-chrome` (override with `CHROME_PATH`). The sandbox setup provisions Playwright's own chromium at that path when the base image ships no browser. It cleans the temporary profile and Harness test files afterward.

There are three explicit preview/verification paths:

```sh
npm run preview:ui                         # keyless Team fixture
npm run test:browser                       # repeatable keyless browser acceptance
DEEPSEEK_API_KEY=... npm run preview       # real model interaction
```

`preview` and `preview:ui` use temporary profiles and storage and clean up on `Ctrl+C`. `preview` always uses the real DeepSeek adapter and fails when credentials are missing; it does not silently switch to replay. `preview:ui` uses a keyless route-only adapter whose fixture does not call a model; an accidental model request fails explicitly.

The browser journey uses a deterministic keyless Host/Client driver. It covers Agent Inbox reading/replying, Human Channel and Thread navigation, persistence after reload, and restoration of the ordinary DSH surface after leaving Team mode.

## UI changes and browser evidence

Visible UI, Client bundle, slot, Remote activation, or interaction changes must run `npm run test:browser`. Screenshots go to ignored `artifacts/browser/` and do not overwrite archived evidence. Review at least:

```text
1440×960: hierarchy, empty/loading/error states, density, and ordinary DSH restoration
390×844 : no horizontal overflow, visible key content, modal/menu inside the viewport
Keyboard: visible focus, Tab/Enter/Space/Escape behavior, accessible dialog/menu names
State: failed submits preserve input; durable mutations render Host projections
```

These screenshots are human review material, not pixel snapshots. Keep only a small set of milestone images under `.scratch/archive/YYYY-MM/<work>/validation/`, with filenames, acceptance points, and rerun commands. Keep debug screenshots, recordings, logs, and complete test-run image sets ignored.

## Generated files

Do not edit these directly:

- `packages/agent-team/lib/typert.host.*`
- `packages/agent-team/lib/typert.remote-client.*`
- `tsconfig.json`
- `tsconfig.types.json`
- `tsconfig.build-deps.json`

Remote artifacts come from `scripts/generate-typert.mjs`; TypeScript path facades come from `scripts/sync-paths.mjs`:

```sh
npm run generate:typert
node scripts/sync-paths.mjs
```

The `tsconfig*.json` facades must not gain `include` or `files`; they must continue matching repository files and adjacent Harness source/declarations.

## Sandbox and CI environments

The test and type systems are not self-contained: they resolve 40+ `@deepseek-ai/dsh-*` packages from the adjacent Harness checkout (both `src/` and a built `lib/`). Sandboxed agents and CI runners must reproduce that layout instead of improvising their own.

**Checkout naming is the contract.** Clone the Harness as the sibling `../deepseek-harness` — the default directory name every script falls back to — and check out the latest certified release tag. Sibling checkouts with tag-suffixed names (`../deepseek-harness-<tag>/`) belong to isolated certification environments only (see [dsh-release-compatibility.md](dsh-release-compatibility.md) §3.2); pointing tooling at one is the root cause of mass false test failures. A checkout with a non-default name must be selected explicitly with `DSH_HARNESS_DIR`.

**Setup, in order:**

1. Clone `../deepseek-harness`, check out the latest certified release tag (currently `dsh-v0.1.2-rc.1`; advance it per certification), then run `corepack pnpm install` (one workspace-wide install) and `corepack pnpm build:lib`. Always use `corepack pnpm` — both repositories pin `pnpm@11.7.0` through `packageManager`, and a bare `pnpm` depends on whatever the environment preinstalled. Do not reuse stale `lib/` or `node_modules/` from an earlier build — old artifacts can conceal declaration or runtime incompatibility.
2. Build the Harness `apps/web` dist with `corepack pnpm build:web` if the workflow needs `test:browser`; the workspace install already provisioned its dependencies.
3. Inside this repository, install with `corepack pnpm install`. Never run `npm install`: it silently breaks the workspace symlinks into the adjacent checkout's vendor packages, and the failure surfaces later as a misleading `Cannot find module 'zod'`.
4. Link the Harness workspace and vendor packages into this repository's `node_modules` with `node scripts/link-harness-packages.mjs`, then build the bundle with `npm run build`. Host tests resolve preset rows and the bundle's own unpublished rows (for example `@wowyuarm/dsh-agent-team/member-context`) through real `node_modules` lookups from this repository root, exactly as a profile install of the published bundle would.
5. Regenerate the TypeScript path facades against the fresh checkout with `node scripts/sync-paths.mjs`. A fresh clone must not trust the committed facades: `sync-paths` is not part of any npm script, and skipping it leaves the facades pointing at the paths baked in at generation time. `sync-paths` also emits the `@deepseek-ai/dsh-client-locale/src/*` wildcard the test harness's locale-table import needs.
6. Smoke-check with `npm run typecheck && npm test`. Green means the environment is right; mass false failures (see below) mean it is not — fix the environment before debugging the diff.

**Environment variables:**

| Variable | Required for | Notes |
| --- | --- | --- |
| `CHROME_PATH` | `test:browser` (optional) | Defaults to `/usr/bin/google-chrome`; set only when the sandbox Chrome lives elsewhere |
| `DSH_HARNESS_DIR` | certification escapes only | Points at a tag-suffixed sibling checkout; unset for everyday work — the default name is the contract |
| `DEEPSEEK_API_KEY` | `npm run preview` | Real-model preview fails fast without it; test and browser paths never need it |

**Symptoms of a wrong environment, not wrong code:** mass `TypeError ... reading 'UNLOADING'` / `FiberState` undefined failures mean Vitest resolved a stale or missing Harness checkout; `Cannot find module 'zod'` means npm broke the pnpm links. Fix the environment before debugging the diff.

**The checkout pointer is centralized and fails fast.** `scripts/harness-dir.mjs` is the single source of truth every consumer (Vitest, `sync-paths`, `build-client`, `generate-typert`, the browser/preview runners) resolves through: `DSH_HARNESS_DIR` wins when set, then the `.generated-harness` marker that `sync-paths` writes (so tests follow the same checkout the facades were generated against — a forgotten env var after a cert-run generation cannot split them), then the default sibling name. A resolved checkout that does not exist aborts immediately with the sibling Harness checkouts that do exist and pointers to the fix, instead of surfacing as the far-away symptoms above.

## External installation verification

The published layout is the root bundle:

```sh
dsh plugin --profile web add @wowyuarm/dsh-agent-team
dsh web
```

A local directory can be installed with:

```sh
dsh plugin --profile web add /absolute/path/to/dsh-agent-team
dsh web
```

`cordis.patch.yml` is the bundle patch entry point. It adds Host, Client, and invariant rows to the opt-in profile and mounts the `team-member` roster in the isolated `agentPresets` scope. Ordinary shipped/user preset rosters must not be changed.

Always verify the built publication layout. A source symlink can bypass profile peer fallback and differ from a real installation; the browser scripts copy built packages for this reason.

### Profiles and release cadence

Stable and development profiles are intentionally separate:

- **Stable (`--profile web`)** uses the npm release (`^0.1.x`), with the lockfile selecting the installed version. Run `dsh plugin --profile web update @wowyuarm/dsh-agent-team` after a release.
- **Development (`--profile web-dev`)** uses a local `link:` checkout. Rebuild before restarting: the Host loads `packages/*/lib/`, so restarting without `npm run build` keeps old tools and behavior.

The runtime must match the installation form. Published `dsh` runs the stable profile from built artifacts; checkout `pnpm dsh` runs source through tsx and paths and should only start a linked profile. Mixing them can create two module instances whose scope Symbols differ and can produce `selected preset is not team-enabled`.

Release cadence is batched. Between releases, daily use of a local build is a lightweight acceptance channel; choose the narrowest check for each small change and batch a release after accumulated fixes are stable.

Stable and development profiles share `$DSH_HOME/storages/`. If a stable old version reads a ledger written by a newer version, schema validation can fail; update the stable profile after each release.

The minimum compatible DSH version is `0.1.2-rc.1`. The current DSH SQLite Session schema is not compatible with older versions: delete old SQLite Session data and start fresh. Do not add Team ledger or Member Session migration, old-format reads, or silent fallbacks.

## Team ledger storage routing

The `agent_team` domain is routed to SQLite through the public composition in `cordis.patch.yml`, using `$DSH_HOME/storages/agent_team.sqlite`; other domains retain the JSON default. The override must be a top-level row, not an insert item, and the SQLite package is a regular dependency. Routing creates a new empty SQLite medium; an old `agent_team.json` is not read or migrated. `preview` and `preview:ui` use a minimal JSON overlay.

The storage benchmark measures only backend writes, not ledger validation:

```sh
DSH_BENCH_STORAGE=1 npx vitest run packages/agent-team/tests/storage-bench.spec.ts
```

The startup path remains full `loadAll()` plus full replay; checkpoint/log work is historical direction in the archive.

## Delivery checklist

- No shipped DSH defaults were changed accidentally.
- Package README, manifest, exports, and visible behavior agree.
- Remote changes were regenerated; no artifacts were hand-edited.
- Client changes have real composition or browser evidence, not only component tests.
- Reports contain only checks that actually ran.
- `git diff --check` passes.
- Live preview, UI preview, and browser replay do not switch modes implicitly.
- No API keys, profile credentials, temporary overlays/tests, or browser artifacts are committed.
