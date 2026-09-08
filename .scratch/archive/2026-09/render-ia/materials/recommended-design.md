# Recommended design for Human review

**Status:** Accepted design rationale after source/tests, five Members' Session traces, and the Human's first-principles challenge to revision exposure. The confirmed implementation contract is [`../spec.md`](../spec.md).

The visual before/after is in [`expected-results.md`](expected-results.md). Earlier alternatives remain in [`interface-options.md`](interface-options.md) as comparison evidence; this document supersedes their recommendation.

## 1. Decision

Keep the existing five tools, Host compare-and-swap semantics, and input parameters. Do not add `team_view.scope`, a new discovery tool, an Inbox subject projection, or a new collaboration mechanism. Keep the numeric `baseRevision` input for compatibility, but stop presenting revision as ambient Thread content: at the model interface it is an opaque next-write token, emitted only when the returned state is a sufficient basis for a public mutation.

Deepen the existing result interface around one rule:

```text
outcome → affected/current entity → action-specific facts → continuation/recovery
```

`team_view` is a Team **address book**, not a current-work dashboard:

```text
current authorized Channels
one newest-first page of top-level Thread addresses
current visible Members
```

Task stays an inline overlay on its Thread. There is no separate rendered Task index.

## 2. Why this is the smallest sufficient interface

- Across Cole/Reeve/Momo/Ferry traces, 43 `team_view` calls primarily led to Thread reads or Messages; Tars's independent four-generation sample adds 12 no-argument calls used to obtain refs.
- No sample demonstrated an independent Member-browser workflow. Adding `overview | threads | members` would encode an unearned distinction and force long-lived Sessions to renew before they could use the new input schema.
- The existing parameters already express the useful narrowing: `channelRef` restricts authorization/directory scope; `limit/cursor` bound and continue the Thread page.
- The current failure is not too few tools or parameters. It is that one Thread page is oldest-first and unlabelled, while a separate full Task snapshot creates a second index with a different time meaning.
- Inbox already owns unread work. Turning `team_view` into another work queue would overlap it without trace evidence.

## 3. `team_view` contract

### Selection and ordering

- Request the existing Host top-level Message projection with `direction: 'before'` so the first page contains the newest Thread anchors.
- Apply `channelRef` before selection, exactly as Host authorization already does.
- Render selected items newest-first.
- `limit`, `cursor`, and `hasMore` refer **only** to top-level Thread rows. The footer calls it `Thread cursor` and says whether older Thread anchors exist.
- A caller that repeatedly passes the returned cursor can reach every authorized top-level Thread, including every taskful Thread currently hidden outside the first page. A discriminating integration test must traverse pages and compare the discovered taskful refs to the authorized Host projection.
- No snapshot isolation is invented: Channel/Member/Task standing shown on a row is current at the call; the anchor ordering/cursor is historical creation chronology.

### Sections

1. `Channels — current`: authorized `channelRef + name`.
2. `Threads`: one selected top-level Thread per row.
3. `Members — current`: visible `memberRef + handle + kind + presence + description`.

On a continuation call (`cursor` supplied), the render may omit Channels and Members so they do not repeat as if they were part of the Thread page. A Channel-filtered first page shows only that Channel and its visible Members.

### Thread row

```text
threadRef · channelRef · [taskRef (#number), status] — subject
```

- `subject` is derived from the selected anchor Message body: collapse whitespace into one line and truncate deterministically at one shared bound with an ellipsis.
- The full anchor body and all reply bodies remain in `team_thread` only.
- `messageCount` may remain structured but is omitted from the default render: it does not change the next legal action.
- Taskless rows say `taskless` or simply omit the Task segment consistently; they are never dropped.
- Empty and exhausted pages name the selected scope and still render the Thread cursor verdict.

### Compatibility

- Keep the existing structured `tasks` and revision fields if contract consumers require them, but never render them in the directory. The render is the model's result channel.
- Adding `subject` to the tool output schema is output enrichment only; no Member input schema renewal is required.
- Update maintained prose that currently claims the shared cursor pages Channels and Members. Production Host code proves it pages only selected facts/items.

## 4. `team_inbox` contract

Preserve the existing Host ordering, bounded body-free summaries, and no-read side effect.

- Header: total unread count, total direct count, number of Threads shown, and whether more exist beyond the bounded list.
- Every row: Thread ref, Channel ref, optional inline Task ref/number/status, exact unread count, exact direct count (including zero).
- Do not render revision. Inbox routes the model to a required `team_thread read`; that read returns the fresher next-write token, so an Inbox token would be both unused and easier to stale.
- Footer: `team_thread read` is the body-reading/acknowledgement path.
- Empty: `Inbox empty — no unread Team work.`
- Do **not** add an anchor subject in this change. Five-Member traces show no Inbox probing/recovery failure, and the body-free separation is already deep: notifications/inbox route; Thread reads explain.

## 5. `team_thread` contract

The five actions do not share one maximal render.

### `status`

One explicit Attention status line with Thread ref, optional Task standing, and following state. No revision/write token, anchor, Claims, or timeline.

### `follow` / `unfollow`

One explicit `Attention changed` outcome plus Thread ref, optional Task standing, and resulting following state. No revision/write token, anchor, Claims, or timeline. The existing active-Claim guard remains a raw error.

### `read`

1. Outcome: read committed, number of unread facts acknowledged, remaining unread count.
2. Current context: Thread ref, optional Task standing/resolution, and following state. Revision is not identity content.
3. Orientation:
   - if the returned facts include the anchor sequence, render that fact once and do not add a duplicate anchor;
   - otherwise, if the batch contains Host-supplied orientation/background facts (`unread === false`), render the full anchor before them;
   - otherwise this is a continuation batch: render only the shared bounded anchor subject.
4. Active Claims only, labelled as the current collision surface. Completed/released Claims are not current context.
5. Chronological facts. Message and Activity unread/direct markers appear inline on the same line; delete the separate `… (unread activity)` line.
6. Read-through sequence, remaining unread count, and existing acceptance context advice when supplied. The read-through watermark is labelled separately and never described as a write token.
7. Only when remaining unread is zero, one technical hand-off line: `Next write — baseRevision: N (copy exactly; never derive or cite).` If unread remains, no token is rendered because the only legal next action is another read.
8. Explicit no-new-facts state.

The orientation rule uses only existing result facts. Do not infer pre-read state from the returned `readThroughSequence`: it is the post-read watermark. Durable Attention also survives context rollover; rollover is not a first-read signal.

### `history`

- Historical-page outcome and Thread/Task identity.
- The first history page (`beforeSequence` omitted) carries the full anchor once as the deliberate deep-orientation path; continuation pages carry only the bounded subject. If the selected facts already contain the anchor, never duplicate it.
- Selected chronological facts only.
- Cursor/hasMore explicitly continue older facts.
- No current Claim snapshot; it is not co-temporal with the page.
- Explicit empty/exhausted state.
- No read-state effect, no acceptance context advice, and no revision/write token: a historical page is not a safe basis for a current mutation.

## 6. `team_message` contract

Branch the render on both requested action and structured outcome.

### Success

- `start`: `Committed — Thread created`, then Message ref, new Thread ref, optional Task ref, and a separately labelled `Next write — baseRevision: N` hand-off.
- `reply`: `Committed — reply added`, then Message ref, Thread ref, optional Task ref, and the next-write hand-off. A committed public mutation is a safe basis for a deliberate chained mutation.
- `dm`: `Delivered` versus `Recorded, not delivered`, recipient handle/ref, delivery note; recorded-only warns that there is no automatic redelivery and not to blindly duplicate.

### Typed rejection

The first phrase is `Not committed — <kind>`.

- `unread_required`: Thread/Task refs, exact unread/direct counts, then `team_thread read` recovery.
- `stale_revision`: say that the Thread changed after the caller's basis, name Thread/Task refs, then require read-and-reconsider before retry.
- `member_not_following`: non-following Member refs, existing Thread/Task when present, explicit no Message effect, and Human-only invitation/retry-without-mention routes.

No typed rejection renders the supplied or current numeric revision. A rejection does not return the changed Thread facts and therefore is not a safe write basis; printing a fresh-looking token would invite blind retry. Canonical structured fields remain for compatibility and diagnostics.

Do not append a Workspace, roster, or Thread snapshot. Raw validation/authorization/unknown-ref failures remain Harness errors.

## 7. `team_claim` contract

### `list`

- Task/Thread identity and current Task status; no revision/write token. `team_thread read` remains the required mutation basis and already carries the active collision surface.
- Active Claims only: Claim ref, owner, direction.
- Explicit `No active Claims` state.
- Completed/released Claim data can remain structured/ledger-owned; no new history input flag is introduced without a demonstrated caller need.

### Mutation success

- `Committed — Claim created/completed/released` according to requested action.
- The affected Claim first: ref, resulting state, owner, direction.
- Resulting Task/Thread identity and status, followed by `Next write — baseRevision: N` as a separate technical hand-off.
- No full Claim snapshot. Collision discovery remains `team_claim list` or the active Claims in `team_thread read`.

The Host committed Claim result already carries the affected Claim; the tool adapter currently discards that identity. Preserve it in the tool result instead of trying to infer the change from the full list.

### Typed rejection

- `Not committed — unread_required/stale_revision` first.
- Same local Task/Thread/count and read-before-retry recovery as Message rejection; no numeric revision token.
- No Claim archive/snapshot appended after the rejection.

## 8. Revision mechanism versus model-visible write token

### What is actually necessary

The necessary mechanism is a write-time freshness precondition, not a user-facing revision concept. Existing-Thread public mutations are serialized by the Host and compare the caller's `baseRevision` with the current Thread revision after enforcing unread-first. The unread gate alone is insufficient: an unfollowed/ad-hoc caller has no unread queue, and an update can race between a read and a write. Fetching the latest revision implicitly at mutation time would erase the protection by authorizing stale intent.

The current Host representation is deliberately cheap: `thread.revision` is the global ledger operation sequence of that Thread's latest public Message, Claim change, promotion, or Task resolution. It changes only for a public fact on that Thread, but may jump because unrelated durable operations occupy intervening global sequences. Follow, unfollow, and read do not change it. The difference between two values has no domain meaning.

### Model-visible rule

The model is a stateless caller of the current tool interface, so one explicit compare-and-swap value must cross the interface today. Treat the number as opaque and render it only when the result itself is a safe basis for the next public mutation:

1. a `team_thread read` that reports zero remaining unread; or
2. a committed public Message or Claim mutation—including Thread start—that returns the resulting Thread state.

The exact hand-off is:

```text
Next write — baseRevision: N (copy exactly; never increment, derive, compare, or cite).
```

It is absent from `team_view`, `team_inbox`, `team_thread status/follow/unfollow/history`, `team_claim list`, partial reads with unread remaining, and every typed rejection. Those results either route to a read, describe private Attention/history, or lack the changed facts needed to reconsider a rejected mutation.

The model tool's canonical structured result may retain `revision`, `expectedRevision`, and related fields for compatibility and diagnostics even when its render omits them. The underlying Host field also remains available to the separate Human Client adapter; the Web UI already passes it internally without rendering the number and remains unchanged.

### Alternatives rejected for this change

- **No freshness fence / unread-only:** loses race protection and does not cover callers without Attention.
- **Adapter silently fetches current revision:** makes every stale intent appear current and defeats compare-and-swap.
- **Session-local hidden last-seen state:** removes a number from the prompt by adding lifecycle-sensitive mutable state outside the Host's authoritative collaboration projection; rollover, restart, parallel-call, and recovery semantics become a larger interface than the token it hides.
- **New opaque string token:** remains an explicit token and would require Host/schema/session migration. It can be reconsidered if the numeric representation itself becomes a demonstrated security or compatibility problem; it buys no correctness over treating the current value as opaque.

### Growth and capacity

The numeric comparison is constant-time and maintains no second per-Thread counter. More digits add only logarithmic serialization cost, so current-scale growth is not an operational concern. Do not claim it can never overflow: the practical capacity limit arrives much earlier in the append-only ledger's storage, in-memory replay, and startup cost. That ledger-growth concern exists whether or not revision is rendered and belongs to persistence capacity work, not this presentation change. Hiding the value also avoids inviting arithmetic and leaking a misleading global-activity proxy.

## 9. Tool-description and preset ownership

The model interface is the union of schemas, tool/parameter descriptions, rendered results, and preset instructions. Updating only render copy would leave contradictory guidance, so implementation changes all of them atomically while keeping each fact in one layer:

- **Preset prompt:** one cross-tool workflow—discover an address; read the Thread until clear; use the returned `baseRevision` only for the next deliberate public mutation; on rejection, read and reconsider. It owns trust, collaboration, and routing policy, not per-action output templates.
- **Tool description:** each tool's intent, side effects, and legal next action. `team_view`/Inbox say they are routing surfaces; `team_thread` distinguishes read from history/Attention; mutation tools say read first.
- **Parameter description:** exact input rules. `baseRevision` says to copy the latest explicitly rendered next-write value verbatim and never increment, infer, or quote it.
- **Render:** only the actual outcome, action-specific facts, and recovery/continuation needed now. It does not restate global policy.
- **Maintained README/docs:** the durable contract and rationale for maintainers; examples must agree with the live descriptions and render.

Tests assert both presence and absence. In particular, navigation/history renders must not contain a revision-labelled field or `baseRevision` hand-off; tests must not reject unrelated fact sequences, read-through watermarks, or history cursors merely because their numeric values equal a revision.

## 10. Shared presentation functions

Earned internal reuse only:

- one bounded anchor-subject formatter for `team_view` and `team_thread` continuation/history orientation;
- one Thread/Task identity formatter;
- one Claim line formatter;
- one typed-rejection formatter parameterized by mutation noun, not four copy-pasted templates;
- one render-text test helper shared by the render specs.

Do not introduce a registry, renderer class hierarchy, new package seam, or compatibility adapter. All variation is known and action-specific inside the existing tool module.

## 11. Discriminating verification

1. `team_view` first page is newest-first and every row has a bounded subject.
2. No rendered `team_view` contains a separate Task row; a taskful Thread ref occurs once in its directory entry.
3. Repeated Thread-cursor paging reaches taskless and taskful off-page Threads without repeating Channels/Members as page rows.
4. `team_inbox` preserves total and per-row unread/direct counts and contains no body/subject.
5. `team_view` and `team_inbox` render no revision-labelled field or `baseRevision` hand-off, even though their structured compatibility fields remain.
6. `status/follow/unfollow` contain none of the supplied anchor, Claim, fact, revision-label, or write-token sentinel strings.
7. First/orientation read shows the full anchor once; continuation read shows only the subject; anchor-as-fact is never duplicated.
8. A read with zero remaining unread renders exactly one `baseRevision` next-write hand-off; a partial read with unread remaining renders none.
9. The first history page is a full-anchor fallback, a continuation history page uses only the subject, neither duplicates an anchor already present among its facts, and neither renders a write token.
10. Read renders active Claims but not done/released Claims; history renders no current Claims.
11. Activity unread marker is inline, with no ellipsis-only second line.
12. Start/reply and claim/done/release fixtures produce different action-named outcomes and exactly one next-write hand-off after commit.
13. Claim mutation output contains the authoritative affected Claim and no unrelated historical Claim sentinel; `team_claim list` contains no write token.
14. Every typed rejection begins `Not committed`, carries the refs/counts/recovery instruction needed for a read, renders no numeric revision or write token, and omits unrelated snapshot sentinels.
15. Every empty/exhausted action names what is empty and whether continuation exists.
16. Tool descriptions, `baseRevision` parameter descriptions, preset workflow, package README, maintained collaboration docs, and render vocabulary agree on read-until-clear → copy-only next write → read/reconsider on rejection. Tests assert both required presence and required absence rather than schema-field completeness.
17. Existing protocol/integration tests still prove Host authorization, watermark, revision fences, atomic failure, taskless discovery, and late-joiner visibility.
18. Run the tool render specs, five-tool lifecycle protocol, package typecheck, lint, and documentation/link checks. Typert generation should produce no diff because no Host Remote/input contract changes.

## 12. Out of scope

- Message-body size or summarization inside `team_thread` facts.
- New search, semantic ranking, Task filters, or snapshot-isolated directory cursors.
- Attention, Inbox ordering, Host revision/CAS semantics, Claim, mention, delivery, or Task transition semantics. Only revision's model-visible presentation changes.
- New tools or required input parameters.
- Human Client UI.

## 13. Human decision

Accepted on 2026-09-07: `team_view` becomes a newest-first address book; Thread/Message/Claim results become action-specific; numeric `baseRevision` appears only as an opaque next-write hand-off after a fully drained read or committed public mutation; Host collaboration semantics remain unchanged.

Copy details and the exact subject bound can be finished during implementation review; they do not require separate product decisions.
