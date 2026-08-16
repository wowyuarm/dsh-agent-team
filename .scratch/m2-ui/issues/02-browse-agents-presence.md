# 02 — Browse Agent Members and Runtime Presence

**What to build:** A Human Member can create and browse Workspace-scoped Agent Members in Team mode and understand whether each Agent is available, working, failed or unavailable through native DSH status presentation.

**Blocked by:** 01 — Enter and Leave Team Mode.

**Implementation status:** Host Remote boundary is complete. `AgentTeam` exposes generated `members` and `addMember` methods through `./typert` and `./remote`; the Client mounts the generated contribution through `ctx.remote.$mount()`. `scripts/generate-typert.mjs` creates an isolated temporary package registration under the local Harness checkout, analyzes it with the existing Harness Host project inventory, writes deterministic artifacts back to this package, and always removes the temporary package. No generated artifact is hand-written and Harness core remains unchanged.

**Status:** complete; M2-03 must consume the exposed creating/unavailable state when it adds Channel membership pickers.

- [x] Every Workspace has an Agents tab beside Channels, and its add action opens a DSH-styled creation panel for name and description.
- [x] First-stage Agent creation binds the Member to the selected Workspace and uses the shipped team-member preset plus Host default model; model, provider and preset selectors are absent.
- [x] Member ref remains the immutable identity, while Agent name is unique only within one Workspace; different Workspaces may contain identical names and descriptions.
- [x] The Host and typed Client adapter expose runtime presence independently from durable Member lifecycle: idle live Agent is available, running Agent is working, current loop/tool failure is error, and unusable or non-live Member is unavailable.
- [x] Error remains visible until the next Agent loop starts; unavailable diagnostics survive projection refresh and do not block other Members.
- [x] Agent rows use only state dots for visible status: DSH success green for available, animated ongoing blue for working, error red for error and semantic neutral gray for unavailable.
- [x] Status dots include Tooltip and accessible status text; error and unavailable states expose a concise diagnostic without relying on color alone.
- [x] A local creating state disables creation until Host settlement; a durable unavailable result remains visible and retries with the same idempotent request. M2-03 must disable these states in its Channel membership picker.
- [x] The global “成员” action opens a read-only, scrollable panel grouping all Agent Members by Workspace; it provides no search, mutation or DM navigation.
- [x] REAL Agent loop tests prove idle/running/error/recovery transitions, while real rendered Client composition proves same-name cross-Workspace rows, four-state accessibility and non-optimistic creation behavior. Full Chromium journey remains owned by M2-06.
