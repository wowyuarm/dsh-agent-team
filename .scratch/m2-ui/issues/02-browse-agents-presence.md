# 02 — Browse Agent Members and Runtime Presence

**What to build:** A Human Member can create and browse Workspace-scoped Agent Members in Team mode and understand whether each Agent is available, working, failed or unavailable through native DSH status presentation.

**Blocked by:** 01 — Enter and Leave Team Mode.

**Status:** ready-for-agent

- [ ] Every Workspace has an Agents tab beside Channels, and its add action opens a DSH-styled creation panel for name and description.
- [ ] First-stage Agent creation binds the Member to the selected Workspace and uses the shipped team-member preset plus Host default model; model, provider and preset selectors are absent.
- [ ] Member ref remains the immutable identity, while Agent name is unique only within one Workspace; different Workspaces may contain identical names and descriptions.
- [ ] The Host and typed Client adapter expose runtime presence independently from durable Member lifecycle: idle live Agent is available, running Agent is working, current loop/tool failure is error, and unusable or non-live Member is unavailable.
- [ ] Error remains visible until the next Agent loop starts; unavailable diagnostics survive projection refresh and do not block other Members.
- [ ] Agent rows use only state dots for visible status: DSH success green for available, animated ongoing blue for working, error red for error and semantic neutral gray for unavailable.
- [ ] Status dots include Tooltip and accessible status text; error and unavailable states expose a concise diagnostic without relying on color alone.
- [ ] A local creating state prevents Channel membership selection until Host creation settles; failure preserves the durable Member as unavailable when applicable and offers a retry path.
- [ ] The global “成员” action opens a read-only, scrollable panel grouping all Agent Members by Workspace; it provides no search, mutation or DM navigation.
- [ ] REAL Agent loop tests prove idle/running/error/recovery transitions, while Client tests and browser snapshots prove same-name cross-Workspace rows, state-dot accessibility and non-optimistic creation behavior.
