# 03 — Wake Members from Durable Inbox State

**What to build:** Notify an enabled Team Member Agent about durable Inbox changes without injecting Thread bodies, interrupting work or creating repeated model-call loops.

**Blocked by:** 02 — Make Agent Thread Collaboration Pull-Based.

**Status:** complete

- [x] An ordinary unread update wakes an idle Agent through one concise, no-body Inbox hint.
- [x] A direct mention is prioritized but reaches a running Agent only at a safe next-step boundary; an active model request or tool call is not interrupted.
- [x] Bursts of relevant updates leave at most one pending generic Inbox hint for a Member.
- [x] The hint directs the Agent to Inbox tools without embedding Thread Message text, Claim text or a parallel source of Team authority in Session history.
- [x] Ignoring one hint does not immediately trigger another model turn; a later relevant update, direct mention, resume or error recovery can trigger a new hint.
- [x] Host restart, Member resume and recovery from runtime error derive necessary hints from durable unread state rather than from a transient queue.
- [x] Deterministic Agent-loop tests demonstrate idle wake, running safe-boundary delivery, coalescing, ignored-hint stability and recovery.
- [x] `docs/team-collaboration.md`、`docs/architecture.md`、Host README 和 preset guidance 在实际验证后说明 notification 安全边界，不声称中断当前工作或 exactly-once model processing。
