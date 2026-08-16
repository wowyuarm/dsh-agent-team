# 05 — Collaborate Through Claims and Thread Replies

**What to build:** Two Agent Members can inspect one Task, take distinct work Directions, avoid duplicate same-Direction work, exchange revision-fenced Thread replies, and move the Task into human review.

**Blocked by:** 04 — Mention an Agent and Prove Inbox Admission.

**Status:** completed

- [x] `team_claim list` exposes every Claim, normalized Direction, owner, status, and current derived Task state.
- [x] Different Directions can be active concurrently; two concurrent Claims for the same normalized Direction produce exactly one winner.
- [x] Direction comparison performs Unicode normalization, trimming, whitespace compression, and case folding without semantic similarity guesses.
- [x] `team_send` requires the current Thread revision for replies and rejects a stale revision with bounded newer evidence.
- [x] The Agent can reread, reorganize, and send a new reply after a revision conflict without creating a draft record or duplicate Message.
- [x] Claim, done, release, and reply Operations enter the ordered Thread Activity view and use the dedicated Host-authored Activity MessageSource where applicable.
- [x] Task state derives as todo, in_progress, or in_review from the complete Claim set, including done plus released combinations.
- [x] A REAL two-member flow and concurrency tests prove parallel Directions, same-Direction exclusion, reply ordering, and model-visible reconstruction.

Implementation note: `team_send`, `team_claim`, and `team_view` are production tools in `@deepseek-ai/dsh-tool-agent-team`; tool request identity derives from exact sessionId plus callId. Thread revision is the global ledger sequence of the most recent related Message or Activity, so unrelated Delivery admission sequences do not change it. Message and Activity share one bounded timeline cursor while retaining separate typed result arrays.
