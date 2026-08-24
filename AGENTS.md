# Repository Guidelines

## Scope and authority

`dsh-agent-team` is an opt-in, externally installable Cordis bundle for DeepSeek Harness. It adds a single-host Agent Team without modifying the Harness repository, the agent loop, or shipped defaults.

Read [`docs/README.md`](docs/README.md) first. It is the maintained documentation index:

- [`docs/development.md`](docs/development.md): setup, commands, generated files, testing, and release checks.
- [`docs/architecture.md`](docs/architecture.md): package ownership, Host authority, Remote, preset, and Client boundaries.
- [`docs/harness-navigation.md`](docs/harness-navigation.md): which Harness docs, packages, source, and tests to inspect for each kind of change.

Use this authority order:

1. **Current behavior:** source and tests under `packages/`. When prose disagrees with code, code wins.
2. **Maintained engineering guidance:** `docs/`. Update it when a code or workflow change invalidates it; it must not define behavior that the code does not implement.
3. **Harness contract:** `../deepseek-harness/docs/`, its applicable `AGENTS.md`, and the corresponding Harness source/tests.
4. **Work history:** `.scratch/`. It contains active work items and archived design, research, tickets, prototypes, and validation evidence. It is not an implementation or API authority. Read [`.scratch/README.md`](.scratch/README.md) before using it; then verify relevant history against code, tests, and the Harness contract.

Keep production code self-explanatory through clear names, types, and structure. Comments explain only non-obvious constraints, ownership, or reasons; they are not the sole definition of current behavior.

## Before editing

- Identify the owning package and read its source, tests, package manifest, and README.
- Read the matching section of [`docs/architecture.md`](docs/architecture.md).
- For anything that consumes a Harness capability, follow [`docs/harness-navigation.md`](docs/harness-navigation.md) into the adjacent checkout before designing the change.
- Treat `.scratch/` as background context, not as a specification to implement blindly. New cross-session work belongs in one `.scratch/active/<work>/` directory; close it into the archive only after durable conclusions have moved to maintained documents.

## Architecture guardrails

- `packages/agent-team` is the only Team authority. Its append-only operation ledger is the durable source of Team facts; projections, tools, commands, Remote, and UI do not maintain parallel authority.
- `packages/tool-agent-team` provides the five model-facing Team tools only through the explicit `team-member` preset. The Web Client is the only Human Team control surface; do not restore a slash-command adapter.
- Team is an external plugin. Do not modify `../deepseek-harness`, its agent loop, or shipped defaults for ordinary Team work. If a public Harness extension point is insufficient, record the limitation and decide whether to implement a Team-owned plugin or change the design.
- Typed Remote declarations are the input; Typert artifacts are generated. Never hand-edit `packages/agent-team/lib/typert.*`.
- The Client uses public Harness plugin and slot APIs. Mount the generated Remote, wait for `remote.agentTeam`, and use `ctx.slots.inject()` when a declaration may not exist yet; `dsh.client.inject` is not an activation-order guarantee.
- A slot parent’s `children` declaration is its render authority. Do not copy private shipped UI or redeclare `sidebar.workspaces.directoryFlow` from the Team workspace shadow; live duplicate child declarations are rejected by Harness SlotCore, regardless of priority.
- Keep durable UI mutations non-optimistic. Authorization, membership, revisions, idempotency, and stable branded refs are enforced by the Host.
- Keep Team tools/guidance inside the isolated Team preset. Ordinary Sessions must not acquire Team behavior accidentally.

## Code and documentation conventions

- Use ESM, strict TypeScript, `.ts`/`.tsx` local imports, existing package names, and existing branded domain types.
- Keep one authoritative formatter/projection per domain concept. Do not add speculative registries, compatibility layers, fallback authorities, or duplicate stores.
- Do not hand-edit generated `tsconfig*.json` path facades. Change `scripts/sync-paths.mjs` and regenerate.
- Update the affected maintained document, package README, and tests when a non-trivial change alters a public contract or workflow. Do not update archived `.scratch/` material merely to make it agree with new code.
- For visible UI changes, run the applicable component checks and `npm run test:browser`, inspect the new `artifacts/browser/` screenshots at desktop and 390×844, and verify keyboard/focus, dialog/menu accessibility, loading/error/empty states, and ordinary DSH restoration. Keep only a small, human-approved milestone set under `.scratch/archive/.../validation/`; routine screenshots stay ignored.
- Write each commit message as one Conventional Commits subject line: `type: lowercase imperative summary` (`feat`, `fix`, `chore`, `refactor`, `test`, `perf`, `docs`), with no body. Match the existing `git log` style.
- Do not commit credentials, temporary profiles, browser overlays, generated test files, browser artifacts, or build residue.

## Checks

Run the narrowest applicable check, then escalate for the changed surface. The exact workflow is in [`docs/development.md`](docs/development.md).

```sh
npm run typecheck
npm test
npm run build
npm run test:browser
npm run lint
npm pack --dry-run
git diff --check
```

`npm run test:browser` is required for changes that can affect the assembled Web bundle, Client loading, slot takeover, Remote activation, or visible UI. It uses the adjacent Harness checkout and a temporary profile; it does not modify the Harness repository permanently.

Release cadence is batched: between releases the operator daily-drives a locally linked build as a lightweight acceptance channel, so choose the narrowest applicable check per change instead of demanding full acceptance for every small fix. When asking the operator to preview or accept a change, point them at the dev profile (`dsh web --profile web-dev`); the default `web` profile stays on the published stable release. See "Profile 模式与发布节奏" in [`docs/development.md`](docs/development.md).

## Further reading

- Domain and Host behavior: `packages/agent-team/src/`, its tests, and `docs/architecture.md`.
- Tools and preset: `packages/tool-agent-team/`, `packages/agent-team/preset/`, and the matching Harness subsystem docs.
- Client or UI: `packages/client-agent-team/src/client/`, `docs/architecture.md`, and `docs/harness-navigation.md`.
- Client or UI: `packages/client-agent-team/src/client/`, `docs/architecture.md`, `docs/harness-navigation.md`, and, when needed, the relevant `.scratch/archive/` work history; verify all behavior in code and tests.
