# 01 — Enter and Leave Team Mode

**What to build:** A Human Member can enter Team mode from the DSH sidebar, browse Host Workspaces in a Team-specific sidebar and return to the unchanged Conversation experience without losing the selected Session.

**Blocked by:** None — M1 is complete; this ticket can start immediately.

**Status:** ready-for-agent

- [ ] The opt-in bundle ships one Team Client package through the existing DSH client-module mechanism and exposes one typed Client adapter as the only UI-to-Host business seam.
- [ ] A “团队” footer action enters Team mode while the DSH brand row, sidebar collapse control and layout remain owned by shipped UI.
- [ ] Team mode dynamically shadows only the Workspace region, center conversation region and Settings seat; Settings is absent while Team mode is active.
- [ ] The Team sidebar lists real Host Workspaces in Host registry order, defaults to the Channels tab and renders a quiet Team empty state in the center column.
- [ ] Team mode reuses the existing Workspace runtime and directory-flow contract to create a Workspace; it does not copy the shipped WorkspaceBrowser or add search or Team-specific sorting.
- [ ] The sidebar bottom shows global “成员” and “← 对话” actions, and the collapsed rail shows only stable Shell/Team navigation icons rather than Workspace rows.
- [ ] “← 对话” disposes every Team shadow registration, restores the shipped Workspace browser, Settings and Conversation occupants, and returns to the previously selected ordinary Session.
- [ ] Browser-local state persists only Team mode and selected Workspace; stale or foreign Workspace ids fall back safely, while tab, Channel and Thread state remain transient.
- [ ] An equal-priority competing primary slot occupant fails loudly instead of silently replacing Team or shipped navigation.
- [ ] Real Client composition tests and browser snapshots prove enter/leave, refresh recovery, collapsed sidebar behavior, plugin unload restoration and no regression to ordinary Session navigation.
