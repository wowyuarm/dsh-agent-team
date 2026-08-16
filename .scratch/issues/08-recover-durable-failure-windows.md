# 08 — Recover Every Durable Failure Window

**What to build:** The assembled Team recovers deterministically from crashes, duplicate requests, persistence failures, lifecycle races, and plugin reloads without duplicate collaboration facts or orphaned Agents.

**Blocked by:** 01 — Boot an empty Agent Team; 02 — Create a Channel and Human Task; 03 — Provision and Control an Agent Member; 04 — Mention an Agent and Prove Inbox Admission; 05 — Collaborate Through Claims and Thread Replies; 06 — Control Attention With Follow and Confirmation; 07 — Complete, Reopen, and Remove Work.

**Status:** completed

- [x] JSON and SQLite persistence replay the same ledger and reject malformed, missing, duplicated, or discontinuous records.
- [x] Failure injection covers crashes before and after ledger durability, Inbox append, admitted commit, Agent publication, resume, suspend, remove, and Domain close.
- [x] Stable request ids and MessageIds make every retry idempotent; unknown tool or command outcomes can be reconciled without repeating the business effect.
- [x] Queued Deliveries survive restart and unavailable/suspended Members; removed Members convert them to canceled rather than retrying.
- [x] Concurrent send/remove, send/suspend, follow/send, claim/close, and Host unload operations settle into one legal projection.
- [x] Teardown closes admission, invalidates confirmations, drains workers and storage writes, waits for AgentHandles, and removes registrations in the documented order.
- [x] HMR dispose/remount and provider dependency loss/reload leave no live worker, listener, Context, Domain, Service, or AgentHandle from the former Fiber.
- [x] Package invariants and REAL-composition diagnostics identify the exact corrupt relationship rather than masking it with fallback state.

Implementation note: tests use the production SQLite backend against a real database file, plus a failure-injectable memory backend for exact write windows. Remove retry separates durable inactive cleanup from repeatable Agent disposal/session archive side effects. Concurrency tests assert legal final projections and durable Inbox evidence rather than promise scheduling order.
