# 01 — Enter and Leave Team Mode

**What to build:** A Human Member can enter Team mode from the DSH sidebar, browse Host Workspaces in a Team-specific sidebar and return to the unchanged Conversation experience without losing the selected Session.

**Blocked by:** None — M1 is complete; this ticket can start immediately.

**Status:** complete

**Implementation reference:** `.scratch/design/dsh-client-plugin-development.md` (especially §§1-5).

- [x] The opt-in bundle ships one Team Client package through the existing DSH client-module mechanism and exposes one typed Client adapter as the only UI-to-Host business seam.
- [x] A “团队” footer action enters Team mode while the DSH brand row, sidebar collapse control and layout remain owned by shipped UI.
- [x] Team mode dynamically shadows only the Workspace region, center conversation region and Settings seat; Settings is absent while Team mode is active.
- [x] The Team sidebar lists real Host Workspaces in Host registry order, defaults to the Channels tab and renders a quiet Team empty state in the center column.
- [x] Team mode uses the public Workspace runtime to pick and create a Workspace; it does not copy the shipped WorkspaceBrowser, re-declare its private directory-flow child slot, add search or add Team-specific sorting.
- [x] The sidebar bottom shows global “成员” and “← 对话” actions, and the collapsed rail shows only stable Shell/Team navigation icons rather than Workspace rows.
- [x] “← 对话” disposes every Team shadow registration, restores the shipped Workspace browser, Settings and Conversation occupants, and returns to the previously selected ordinary Session.
- [x] Browser-local state persists only Team mode and selected Workspace; stale Workspace ids fall back to the first real Workspace, while tab, Channel and Thread state remain transient.
- [x] An equal-priority competing primary slot occupant fails loudly instead of silently replacing Team or shipped navigation (enforced by the DSH SlotCore contract).
- [x] Real Client composition tests and DOM snapshots prove enter/leave, refresh recovery, stale Workspace fallback, collapsed sidebar behavior, plugin unload restoration and preservation of ordinary Session selection. Full Chromium journey coverage is tracked by M2-06.
