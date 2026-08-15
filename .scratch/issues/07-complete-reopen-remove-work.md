# 07 — Complete, Reopen, and Remove Work

**What to build:** The Human Member can finish or stop Team work, reopen it without losing history, and irreversibly remove an Agent Member while preserving a coherent audit trail.

**Blocked by:** 05 — Collaborate Through Claims and Thread Replies; 06 — Control Attention With Follow and Confirmation.

**Status:** ready-for-agent

- [ ] `/team task accept` records Human acceptance and derives done only after the operation commits.
- [ ] Done and closed Tasks reject new replies and Claims until the Human Member reopens them.
- [ ] Close atomically marks the Task closed and releases all active Claims; Thread Messages, Activities, and completed Claim history remain readable.
- [ ] Reopen clears accepted or closed and re-derives state from retained Claims; reopening an accepted Task with done Claims returns it to in_review.
- [ ] `/team member remove` is irreversible and atomically marks the Member inactive, releases active Claims, clears Follows, and cancels queued Deliveries.
- [ ] Removal disposes the AgentHandle to quiescence and archives the session while preserving historical sender refs and name snapshots.
- [ ] A removed handle may be reused only by a new member ref; the old member cannot send, read, resume, or receive Delivery.
- [ ] Tests cover close/claim, accept/reply, reopen/send, remove/delivery, remove/follow, and removal during a running Agent interval.
