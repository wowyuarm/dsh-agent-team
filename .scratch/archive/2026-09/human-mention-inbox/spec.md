# Spec — Human「提到我」Inbox + mention prompt

Confirmed 2026-09-13 (thread:f6ef5c64 / task:bf3e9db8 #36). Source of truth for this work item until it lands in `docs/`. Code and tests remain the implementation authority after ship.

## Problem

Agents already coordinate at commit-wake speed; that stays. The Human cannot keep up because follow-a-Thread shows the entire firehose, while structured mention of the Human is a first-class Agent signal and only a chip on the Human surface. Prompt two-tier wording (“human layer vs peer-only mode”) over-taught a genre split and did not create a place to look.

## Non-goals

- Do not throttle Agent turns or coalesce wakes.
- Do not hide or filter unmentioned messages inside a Thread. The 600-character clamp stays.
- Do not treat prose `@human` or a `Decision needed` line as notification. Only the `mentions` parameter.
- Do not introduce a cross-Workspace ledger. Host stays Workspace-scoped; the Client composes a home-wide queue.
- Do not modify `../deepseek-harness`.

## Product shape

One writing style for every Thread message. Mentioning the Human is a **notification trigger**, not a second genre.

The Human gets a home-wide queue named **提到我** that lists Threads with an unacknowledged structured mention of `member:human`. Opening a Thread is what marks those mentions read. The queue is a discovery surface; the Thread is still the conversation.

Prompt change and Inbox UI ship in the **same implementation**.

## Mention contract (prompt + docs)

### Persona (replace the current two-tier paragraph)

> Lead with the conclusion or state; put mechanical detail (file:line, commands, hashes, probe output) after it — never drop detail a peer Member needs, move it below. Keep prose in the language the Human writes, and identifiers, paths, commands, and refs verbatim. When you need the Human to know or decide, mention the Human — that is how they are notified — and keep the opening to one to three readable sentences, with `Decision needed: X (default: Y)` when a decision is owed.

### `team_message` body description (opening)

> Markdown body. Lead with the conclusion or state. Mention the Human only when they must know or decide, with a one-to-three-sentence opening and a `Decision needed: X (default: Y)` line when a decision is owed; mechanical detail follows below.

### When to mention (docs only, not persona)

Mention the Human when any of:

1. they must decide
2. a Claim is done and awaiting accept
3. a blocker or risk they must know
4. they asked for that progress

Ordinary peer progress does not mention. `Decision needed` stays on decision mentions for scannability; it is not an Inbox key. `shipping.spec.ts` locks the new sentences, not the old two-tier phrases.

## Inbox semantics

| Rule | Decision |
| --- | --- |
| Scope | Home-wide: every Workspace the Human can see |
| Admission | `direct` unread for `member:human` only (`directCount > 0`) |
| Dedup | One row per Thread; time = newest mention `occurredAt` |
| Read | Durable Thread read consumes direct markers. Opening the Inbox page does not |
| Follow | Not required. Mention does not enroll the Human as a follower |
| Live Thread | If that Thread is already open, the existing auto-ack clears markers; the row and badge drop |
| Archived / closed | No special case: if the Host projection still emits the item, show it and let existing Thread/Channel surfaces handle the click; if archival already hides the Thread from APIs, it will not appear |

## Host

Keep `inbox(workspaceId)` as the Workspace unit of authority. Add a **direct-only Human slice** so the Client never filters follow-unread by hand:

- Request flag (name at implementation): only items with `directCount > 0`; `totalUnreadCount` on that call equals the direct total (do not return a follow-firehose count next to a mention badge).
- Each item already has `channelRef`, optional `task`, `thread`, `newestOccurredAt`. **Add row preview on this slice** so the page does not N+1 Channel `view` calls: Channel display name, optional `taskNumber`, truncated top-level body (first line, same 120-character cap as existing task titles).
- No home-level Remote. The Client fans out one inbox call per Workspace and merges.

`changes()` with **no scope** remains the invalidation bus for the badge (any Team commit may change some Workspace’s direct count).

## Client IA

### Wide sidebar

A **提到我** card **above the Workspaces section**. Quiet row, same 8px radius / hover as other sidebar rows. Count badge = sum of direct totals across Workspaces; hide the badge at 0. Click selects the Inbox surface (right pane). `aria-current="page"` sits on this card while Inbox is open — it is the leaf, so Workspace overview is not current.

### Narrow rail

Three icon buttons, top to bottom: **提到我** (`IconQueueOutline14` at 16px) → Channels (`IconListPenOutline16`) → Agents (`IconAgentPresetOutline16`). Queue is unused elsewhere; do not reuse checklist (as-task) or user (members). Clicking 提到我 **opens the Inbox page** and expands the sidebar (so the selected card is visible), matching “a destination,” not “scroll to a section.” The same badge hangs on the icon.

### Right pane

`TeamConversation` gains a fourth surface: Thread | Channel | **Inbox** | welcome. Selecting Inbox clears the Channel/Thread pane the same way selecting a Channel clears a Thread. Persist `inbox` as a navigation location (not unread facts) next to mode / Workspace / last Channel-Thread, so reload restores the page.

### Inbox page rows

Priority, top to bottom in the row:

1. Breadcrumb one line: `workspace / #channel` and `Task #N` when taskful (omit Task on taskless)
2. Top-level message truncated to first line, 120 characters
3. Relative time of the newest mention (same formatter as message time)

Click → `selectWorkspace` if needed + `selectThread` for that Thread. Mention body is read in the Thread, not in the queue.

Empty: title「还没有人提到你」, hint「需要你知道或做决定时，成员会提到你」。Loading / error / retry match Channel page density.

### After a click

Thread back control goes to **that Thread’s Channel** (already confirmed). Re-enter Inbox from the card or rail icon. Do not stack Inbox as a back target.

## Refresh

1. **Badge** — while Team mode is mounted, one unscoped `changes()` subscription; on wake, refetch direct totals per Workspace and sum. No list fetch.
2. **List** — fetch on entering the Inbox page; keep listening while the page is open; stop list fetches when leaving. Opening the page is not a read.

## Verification

- Host tests: direct-only omits follow-unread; preview fields present; Human mention without follow still appears; Thread read clears the item.
- Client tests: card + rail + badge; Inbox page empty/rows; click navigates Workspace+Thread; back lands on Channel; rail order and `aria-current`.
- `shipping.spec.ts` for the new persona / body sentences.
- `npm run test:browser` + `dsh web --profile web-dev`: mention Human → badge; open Inbox → row; open Thread → badge/row clear; peer-only traffic does not admit.

## Formal docs on ship

Same change updates `docs/team-collaboration.md` (Human Inbox + mention set), `docs/frontend-design.md` (card, rail, page, rows), `docs/architecture.md` (Human Client **does** consume a direct-only Inbox projection), bilingual pairs, CHANGELOG.
