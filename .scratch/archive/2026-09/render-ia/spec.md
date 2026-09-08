# Team tools result information architecture

**Status:** Approved by the Human on 2026-09-07. This document is the confirmed decision snapshot for implementation.

## Objective

Make the five model-facing Team tools form one coherent decision interface:

```text
discover an address
  → read current Thread facts until clear
    → make one deliberate public mutation
      → understand whether it committed and what to do next
```

Every render must follow the smallest applicable form of:

```text
outcome → affected/current entity → action-specific facts → continuation or recovery
```

The implementation must optimize the complete model interface—input/output schemas, tool and parameter descriptions, rendered results, and Team Member preset narration—not render copy in isolation.

## Fixed boundaries

- Keep the existing five tools: `team_view`, `team_inbox`, `team_thread`, `team_message`, and `team_claim`.
- Keep existing input parameters and Host collaboration semantics.
- Do not add a discovery scope, new tool, Inbox subject, search/ranking, Task filter, or snapshot-isolated cursor.
- Do not change authorization, Attention, unread ordering/watermarks, mention/invitation, Claim ownership, Task transitions, idempotency, or mutation ordering.
- Do not change the Human Client UI.
- Preserve structured result fields needed for compatibility and diagnostics even when the model render deliberately omits them.
- Output-only `subject` enrichment is allowed; no Member input-schema renewal may be required.

## 1. Discovery: `team_view`

`team_view` is an address book, not a current-work dashboard.

### Selection and ordering

- Ask the existing Host top-level projection for `direction: 'before'` so the first page contains the newest Thread anchors.
- Apply an optional `channelRef` before selection using existing Host authorization.
- Render selected Thread rows newest-first.
- `limit`, `cursor`, and `hasMore` describe only top-level Thread rows. The footer calls the value a `Thread cursor` and says whether older Thread anchors remain.
- Repeated use of the returned cursor must reach every authorized top-level Thread, including taskless and off-page taskful Threads.
- Do not invent snapshot isolation: Channel, Member, and Task standing are current; Thread ordering and cursor follow anchor chronology.

### Render

First page sections are:

1. `Channels — current`: authorized Channel ref and name.
2. `Threads`: one selected top-level Thread per row.
3. `Members — current`: visible Member ref, handle, kind, presence, and description.

Continuation pages may render only `Threads`; Channels and Members are not members of the Thread page. A Channel-filtered first page shows only that Channel and its visible Members.

One Thread row contains:

```text
threadRef · channelRef · optional taskRef (#number), status — bounded subject
```

The subject comes from the selected anchor Message: collapse whitespace to one line and truncate deterministically through one shared formatter. Task is an inline overlay; never render a second Task index. Keep taskless Threads. Omit message count and revision from the default render because neither changes the next legal action. Empty/exhausted pages name the selected scope and retain the Thread-cursor verdict.

The structured `tasks`, `revision`, and `messageCount` fields may remain for compatibility. Add a structured bounded subject if the renderer needs it.

## 2. Triage: `team_inbox`

Preserve Host ordering, body-free bounded summaries, counters, and the fact that listing does not acknowledge work.

- Header: total unread, total direct, number of Threads shown, and a bounded-list truncation conclusion.
- Row: Thread ref, Channel ref, optional inline Task ref/number/status, exact unread count, and exact direct count including zero.
- Footer: route body reading and acknowledgement to `team_thread read`.
- Empty state: explicitly say there is no unread Team work.
- Do not add a subject or Message body.
- Do not render revision or a next-write token. Inbox routes to a required current read, which supplies a fresher mutation basis.

## 3. Thread actions: `team_thread`

The five actions must not share one maximal render.

### `status`

Render one Attention-status outcome with Thread ref, optional Task standing, and following state. Render no revision/write token, anchor, Claims, or timeline facts.

### `follow` / `unfollow`

Render one `Attention changed` outcome with Thread ref, optional Task standing, and the resulting following state. Render no revision/write token, anchor, Claims, or timeline facts. Preserve the active-Claim unfollow guard.

### `read`

Render in this order:

1. `Read committed`, acknowledged unread count, and remaining unread count.
2. Thread ref, optional current Task standing/resolution, and following state. Revision is not identity content.
3. Orientation:
   - if returned facts include the anchor sequence, render that fact once and add no separate anchor;
   - else if any returned structured fact has `unread === false`, render the full anchor before the Host-supplied background facts;
   - else render only the deterministic bounded anchor subject.
4. Active Claims only, clearly labelled as the current collision surface. Do not render done/released Claims as current context.
5. Chronological facts. Put Message and Activity unread/direct markers on the fact line; delete the separate ellipsis-only unread Activity line.
6. Read-through watermark, remaining unread conclusion, and existing acceptance context advice when supplied.
7. If and only if remaining unread is zero, exactly one next-write hand-off:

```text
Next write — baseRevision: N (copy exactly; never derive or cite).
```

8. An explicit no-new-facts state when applicable.

The orientation discriminator uses structured facts, specifically positive `unread === false`; it must not parse marker text. Returned `readThroughSequence` is post-read and must not infer pre-read state. Durable Attention survives context rollover. Manual follow begins at tail plus one with read-through at tail and therefore exercises anchor-in-background branches; continuation and unfollowed ad-hoc reads exercise bounded-subject fallback.

A partial read with unread remaining renders no write token because its only legal next action is another read.

### `history`

- Render a historical-page outcome plus Thread/optional Task identity.
- On the first page (`beforeSequence` absent), render the full anchor as deliberate deep orientation unless the selected facts already contain it.
- On continuation pages, render only the bounded subject unless the selected facts contain the anchor; never duplicate it.
- Render only selected chronological facts and the cursor/hasMore continuation.
- Render no current Claim snapshot, revision/write token, read-state effect, or acceptance advice.
- Explicitly distinguish empty and exhausted states.

## 4. Message outcomes: `team_message`

Branch on both requested action and structured outcome.

### Success

- `start`: `Committed — Thread created`, Message ref, new Thread ref, optional Task ref, then exactly one next-write hand-off.
- `reply`: `Committed — reply added`, Message ref, Thread ref, optional Task ref, then exactly one next-write hand-off.
- `dm`: distinguish `Delivered` from `Recorded, not delivered`; include recipient handle/ref and delivery note. Recorded-only warns that no automatic redelivery occurs and forbids blind duplication.

### Typed rejection

Every typed rejection begins `Not committed` and never appends an unrelated snapshot.

- `unread_required`: Thread/optional Task refs, exact unread/direct counts, and `team_thread read` recovery.
- `stale_revision`: explain that the Thread changed after the caller's basis, name Thread/optional Task refs, and require read-and-reconsider before retry.
- `member_not_following`: name non-following Member refs and existing Thread/Task when present, state that no Message committed, and give Human-invitation or retry-without-mention routes.

No rejection render includes the supplied/current numeric revision or a next-write token. A rejection lacks the changed facts and is not a safe mutation basis. Keep canonical diagnostic fields structured. Raw validation, authorization, and unknown-ref failures remain Harness errors.

## 5. Claim outcomes: `team_claim`

### `list`

Render Task/Thread identity, current Task status, active Claims (ref, owner, direction), or explicit `No active Claims`. Do not render revision/write token. A current Thread read remains the required mutation basis. Historical Claims may remain structured/ledger-owned; add no history input without caller evidence.

### Mutation success

Name the requested action:

- `Committed — Claim created`
- `Committed — Claim completed`
- `Committed — Claim released`

Render the authoritative affected Claim first—ref, resulting state, owner, and direction—then Task/Thread identity and status, then exactly one next-write hand-off. Preserve the affected Claim already returned by the Host; do not infer it from a post-mutation list and do not append the full Claim archive.

### Typed rejection

Begin `Not committed`, give the same local refs/counts/read-before-retry recovery as Message rejection, render no numeric revision/write token, and append no Claim snapshot.

## 6. Why the write token exists and where it may appear

The necessary mechanism is a write-time freshness precondition, not a user-facing revision concept. Existing-Thread public mutations are serialized by the Host and compare the caller's `baseRevision` with the current Thread revision after enforcing unread-first.

The unread gate alone cannot cover an unfollowed/ad-hoc caller or an update racing between read and mutation. Removing the fence—or silently fetching the newest value during mutation—would authorize stale intent. A session-local hidden value would introduce lifecycle-sensitive mutable state across restart, rollover, and parallel calls. A new opaque string would still be a token while forcing Host/schema/session migration. Keep the compatible number but treat it as opaque.

The current representation is the global ledger operation sequence of that Thread's latest public Message, Claim change, promotion, or Task resolution. It changes only for a public fact on that Thread, may jump because unrelated durable operations occupy intervening positions, and has no meaningful arithmetic or magnitude. Follow, unfollow, and read do not advance it.

The model-visible token may appear only after:

1. a `team_thread read` with zero remaining unread; or
2. a committed public Message or Claim mutation, including Thread start, that returns the resulting Thread state.

It is absent from `team_view`, `team_inbox`, `team_thread status/follow/unfollow/history`, `team_claim list`, partial reads, and all typed rejections. The Human Web UI already passes the Host revision internally without rendering the number and stays unchanged.

Numeric comparison is constant-time and stores no second per-Thread counter; digit growth is not a current operational constraint. Do not claim zero impact or impossible overflow. Append-only ledger storage, in-memory replay, and startup growth are the practical earlier capacity concerns and require separate persistence work regardless of presentation.

## 7. Prompt and description ownership

The model interface must tell one non-contradictory story:

- **Team Member preset:** cross-tool workflow and collaboration policy only—discover; read until clear; copy the returned next-write token into one deliberate public mutation; after rejection, read and reconsider.
- **Tool description:** that tool's intent, side effects, action distinctions, and legal next action.
- **Parameter description:** exact mechanics. `baseRevision` must say to copy the latest explicitly rendered value verbatim and never increment, derive, compare, or quote it.
- **Render:** only the current outcome, action-specific facts, and immediate continuation/recovery.
- **Package README and maintained bilingual collaboration docs:** durable implemented contract and rationale, using the same vocabulary.

Do not duplicate per-action templates into the preset or restate global collaboration policy in every render.

## 8. Implementation shape

Earn only local reuse inside the existing Team-tool module:

- one deterministic bounded-subject formatter shared by directory and Thread orientation;
- one Thread/Task identity formatter;
- one Claim-line formatter;
- one typed-rejection formatter parameterized by mutation noun;
- one render-text helper shared by render specs.

Delete the unreachable generic `team_message` render fallback and the separate unread-Activity ellipsis line. Do not add a renderer registry, class hierarchy, new package seam, compatibility adapter, or parallel state store.

## 9. Discriminating acceptance

Tests must assert both required presence and required absence. Absence checks target field labels/structured render concepts, not arbitrary equal numeric values: fact sequences, `Read through sequence N`, and `History cursor N` remain valid for their own purposes.

1. First directory page is newest-first; every Thread row has one bounded subject.
2. A taskful Thread appears once; no rendered Task index exists.
3. Cursor traversal reaches all taskless and taskful off-page Threads; continuation does not repeat Channels/Members as page rows.
4. Inbox preserves total and per-row unread/direct counts and renders no body/subject/revision-labelled field/write token.
5. Status/follow/unfollow render no supplied anchor, Claim, fact, revision label, or write-token sentinel.
6. Anchor-in-facts, background orientation (`unread === false`), continuation, manual-follow, and unfollowed ad-hoc read fixtures discriminate the three orientation branches without duplication.
7. Zero-remaining read renders exactly one `baseRevision` hand-off; partial read renders none.
8. First history page uses full-anchor fallback, continuation uses bounded subject, selected anchor never duplicates, and history renders neither current Claims nor write token.
9. Read includes active Claims only; done/released Claims stay out of current context.
10. Activity unread/direct marker is inline; no ellipsis-only second line exists.
11. Start/reply and claim/done/release outcomes name different actions and committed public mutations render exactly one hand-off.
12. Claim mutation returns the authoritative affected Claim and omits unrelated historical Claim sentinels; list shows active collision state and no token.
13. Typed rejections start `Not committed`, retain refs/counts/recovery, omit numeric revision/write-token labels, and omit unrelated snapshots.
14. Empty/exhausted states name what is empty and whether continuation exists.
15. Tool descriptions, parameter descriptions, preset workflow, package README, bilingual maintained collaboration docs, and CHANGELOG agree with the live behavior.
16. Existing integration coverage continues to prove Host authorization, unread-before-stale ordering, watermark, revision fence, atomic failure, taskless discovery, and late-joiner visibility.
17. Typert generation produces no diff because Host Remote and input contracts do not change.

## 10. Required verification

Run the narrow render tests first, then the affected lifecycle/integration suite, package typecheck, lint, documentation/link checks, and repository diff hygiene. This change does not affect the assembled Web bundle or visible Human UI, so browser verification is not required unless implementation expands beyond this approved boundary.
