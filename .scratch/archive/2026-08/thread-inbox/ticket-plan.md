# Thread Inbox / Team Member Context — Ticket Plan

状态：archived；2026-08-20 已完成。以下内容记录当时的实施顺序。
来源：[`spec.md`](spec.md)

## 依赖图

```text
01 Attention Ledger Cutover
├── 02 Agent Thread Tool Protocol
│   ├── 03 Durable Agent Inbox Hints
│   └── 05 Full Coding Member Context
├── 04 Human Inbox and Thread UX
└── 06 Preview Modes and Whole-Trace Acceptance
     ├── 03
     ├── 04
     └── 05
```

## 01 — Cut Over to Durable Thread Attention

**Blocked by:** None — can start immediately.

**What it delivers:** Team Host directly replaces the old Follow/Delivery attention model with durable Member × Thread Attention, read watermark and direct-mention state. Human and Agent projections can reliably identify unread work, first-read background, close/reopen cleanup, Channel authority and revision/unread mutation fences after restart.

**Why this is a wide refactor:** current Follow, Delivery admission, Host Remote types and replay validation are entwined in the same durable operation union. With no user data to preserve, a single cutover is safer than a sidecar Inbox, compatibility names or dual authority.

**Acceptance focus:** durable replay and idempotency; old-history-not-unread invitation; attention lifecycle; direct Human mention; Claim auto-follow; unread/revision races; close/reopen/suspend/remove behavior; no legacy attention path remains.

## 02 — Make Agent Thread Collaboration Pull-Based

**Blocked by:** 01 — Cut Over to Durable Thread Attention.

**What it delivers:** A Team Member Agent can discover authorized work, triage its Inbox, read one Thread and its bounded history, follow or unfollow, create a top-level Task, reply to an existing Thread, and manage Claims through the final five-tool protocol. The Agent receives typed collaboration rejections and decides its own next action after every tool result.

**Acceptance focus:** `team_inbox`, `team_thread`, `team_message`, `team_claim` and `team_view` have non-overlapping responsibilities; no model-supplied Workspace id; Agent cannot invite an unfollowed Agent; every result returns to the next model step; `unread_required` and `stale_revision` support recovery without duplicate Messages.

## 03 — Wake Members from Durable Inbox State

**Blocked by:** 02 — Make Agent Thread Collaboration Pull-Based.

**What it delivers:** An enabled Member Agent is safely notified when durable Inbox state changes: ordinary updates wake an idle Agent through one coalesced no-body hint; direct mention receives priority; a running request or tool is not interrupted; restart, resume and error recovery restore a needed hint.

**Acceptance focus:** real Agent-loop safe-boundary behavior; one pending hint per Member; no repeating wake loop after an ignored hint; no direct Thread body injection; durable recovery derives notifications from ledger state rather than transient Session queues.

## 04 — Human Inbox and Thread Attention UX

**Blocked by:** 01 — Cut Over to Durable Thread Attention.

**What it delivers:** A Human can use a Workspace Inbox, open and durably read a Thread, see a local unread divider, review bounded history, create or reply to Tasks under the same Host fences, and deliberately invite an unfollowed Agent through the gray two-send composer flow. The Thread UI additionally presents Human-only follow/unfollow and active-claim runtime-risk observations without making them Agent work.

**Acceptance focus:** Inbox ordering/counts/direct priority; typed Remote remains the only Client seam; no optimistic Team fact; confirmation token invalidation; draft preservation; accessible gray status versus real errors; follow/error observations remain non-revisioned and non-notifying; desktop and narrow browser behavior.

## 05 — Equip Team Members for Work and Private Memory

**Blocked by:** 02 — Make Agent Thread Collaboration Pull-Based.

**What it delivers:** Team Members run as full coding Agents while retaining isolated Team behavior. They receive project instruction files, the final Team collaboration prompt and a bounded private memory index; they can use normal project tools and load/write private notes on demand.

**Acceptance focus:** explicit coding-preset composition; ordinary Sessions never receive Team capability; two Members never receive each other’s memory; `memory.md` replacement is escaped, bounded and restore-safe; over-budget behavior is a maintenance warning rather than silent truncation; suspend/resume retain and remove deletes private memory.

## 06 — Separate Live Preview, UI Preview and Replay Verification

**Blocked by:** 03 — Wake Members from Durable Inbox State; 04 — Human Inbox and Thread Attention UX; 05 — Equip Team Members for Work and Private Memory.

**What it delivers:** Developers can deliberately choose a credentialed isolated live preview, a no-model UI preview and deterministic replay browser verification. One representative old-Thread invitation trace proves the assembled Host, Agent, Client and persistent state agree across the appropriate modes.

**Acceptance focus:** live preview fails clearly without credentials and does not use the keyless replay adapter; UI preview cannot silently call a model; replay remains deterministic; browser journey covers Human invitation, Agent wake/read/reply, Human Inbox/Thread state and ordinary DSH restoration; docs, package checks and release layout are current.
