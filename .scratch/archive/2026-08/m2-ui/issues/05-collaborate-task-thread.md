# 05 — Collaborate in a Task Thread

**What to build:** A Human Member can enter a Task Thread, read its explicit discussion and work state, reply with optimistic concurrency protection and exercise Human-owned Claim and Task controls.

**Blocked by:** 04 — Collaborate in a Channel.

**Status:** complete as the M2 functional baseline. Browser interaction/layout evidence passed under M2-06; DSH native-feel redesign is tracked separately by `../../ui-redesign/spec.md`.

- [x] The Task footer opens a Thread page with an explicit back control that restores the originating Channel without URL routing.
- [x] The Thread header shows Task number, derived status and Human actions for accept, close and reopen only when each transition is valid.
- [x] Participant rows separate Agent runtime state dots from Claim state, and each Claim shows its concrete owner, Direction and active/done/released state.
- [x] The Host exposes Human-authorized Thread reply using the current base revision, structured mentions, Follow and Delivery rules without allowing the Client to forge an Agent actor.
- [x] The Thread composer uses the same text/mention-only Team composer contract as Channel and preserves the draft on failure.
- [x] A stale revision refreshes the Thread and presents the conflict without automatically replaying or clearing the Human’s intended reply.
- [x] The Host exposes Human authority to mark one specific Claim done or released; Human cannot create a Claim for an Agent or directly change an Agent Follow.
- [x] Claim and Task mutations remain single idempotent Operations, re-derive Task status and deliver existing Activity notifications under M1 semantics.
- [x] Thread history loads the latest bounded page, includes explicit Messages plus relevant Activity, supports older-page reads and reports Thread Message count separately from revision.
- [x] Closed or accepted Tasks reject replies and Claim changes until Human reopen; UI controls and Host authority independently enforce the same rule.
- [x] REAL two-Agent tests prove Human reply, stale revision, Claim done/release, accept/close/reopen, activity delivery, non-optimistic failures and replay after SQLite restart.
- [x] Browser interaction and snapshots prove Channel↔Thread navigation, state-dot-only runtime status, Claim readability, accessible controls and narrow/mobile layout without overlap.
