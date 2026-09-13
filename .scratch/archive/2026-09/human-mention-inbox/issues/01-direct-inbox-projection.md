# 01 — Direct-only Human inbox projection with row preview

**What to build:** A Human can ask the Host, per Workspace, for only Threads that currently mention them, and each row already carries Channel name, optional Task number, a truncated top-level title, and the newest mention time — without follow-unread leaking into the count.
**Blocked by:** None — can start immediately
**Status:** complete

- [x] The direct-only call returns no Thread whose only unread is ordinary follow traffic
- [x] `totalUnreadCount` on that call matches the direct total (badge-safe)
- [x] A structured Human mention appears even when the Human does not follow the Thread
- [x] Each item includes Channel display name, optional Task number, first-line top-level preview capped at 120 characters, and newest mention time
- [x] A durable Thread read that consumes the direct markers drops the item on the next inbox call
- [x] Tests cover the above without a UI
