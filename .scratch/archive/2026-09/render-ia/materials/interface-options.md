# Team tool result interface options

This is a design synthesis for discussion, not the chosen specification. It combines direct source/test inspection with the independent trace evidence in `cole-trace-audit.md`.

## 1. Constraints every design must satisfy

1. A result is a decision interface: outcome first, then the current facts needed for the next decision, then the one safe continuation or recovery route.
2. Thread is the collaboration context. Task is an optional overlay on a Thread; it is never a second directory entity.
3. Directory selection and pagination describe one set of rows with one ordering. Snapshot rosters must not masquerade as part of an event-sequence page.
4. Reads remain bounded. Empty and exhausted states are explicit.
5. Existing full refs, Thread revision, unread/direct counts, affected Claim identity, and continuation cursor stay next to the action that consumes them.
6. Typed collaboration rejections are expected outcomes. They say that no mutation committed and preserve the already-successful read-before-retry loop; raw validation/authorization/unknown-ref errors remain errors.
7. Message bodies remain authoritative in `team_thread read/history`. A directory or Inbox may carry one deterministic, bounded anchor-derived subject, but never unread reply bodies.
8. `team_thread read` keeps its healthy incremental semantics and a self-orienting current context. This work changes the model-facing result interface, not Attention or watermark authority.
9. The Host ledger remains the only Team authority. Filtering must happen before pagination at the Host projection seam; the tool adapter must not join an arbitrary page to a different full snapshot and call it one directory.
10. Interface changes must account for long-lived Member Sessions whose tool schemas were fixed when the Session was created.

## 2. Common result grammar

All options use the same semantic order, without forcing verbose headings onto one-line results:

```text
Outcome
Current context / affected entity
Action-specific items or facts
Continuation or recovery
```

Mutation outcomes use explicit language:

- `Committed — ...`
- `Not committed — unread_required: ...`
- `Not committed — stale_revision: ...`
- `Not committed — member_not_following: ...`
- `Delivered — ...` / `Recorded, not delivered — ...`

Read outcomes name the read and its effect:

- `Inbox — 9 unread updates, 2 direct, 3 Threads shown.`
- `Read committed — acknowledged 4 unread updates; 1 remains.`
- `History — 10 older facts shown.`

A shared Thread summary is the only directory row shape:

```text
thread:<uuid> · channel:<uuid> · [task:<uuid> (#N), <status>] · revision N — <bounded subject>
```

`subject` is a single-line, whitespace-collapsed, bounded preview of the Thread anchor. Its full body remains in `team_thread`; the same formatter must serve `team_view` and `team_inbox` so the concept has one authority.

## 3. Option A — explicit semantic scopes inside `team_view`

### Interface

```ts
team_view({
  scope?: 'overview' | 'threads' | 'members' // default: overview
  channelRef?: string
  limit?: number
  cursor?: number
})
```

The optional selector keeps the five-tool protocol while making the caller's question explicit. No required parameter is added, so old no-argument calls remain valid.

### Scope semantics

#### `overview` (default)

Answers: “Where can I start work, what Task work is currently open, and which Members are present?”

- Authorized Channels: `channelRef + name`.
- A bounded page of nonterminal Task Threads only (`todo | in_progress | in_review`), newest anchor first, using the shared Thread summary row.
- A compact Member identity roster: `memberRef + handle + presence`, without descriptions.
- `limit/cursor/hasMore` apply only to the open-work rows; the footer names that set explicitly.
- A later overview page does not repeat the Channel and Member context sections.
- Empty state is `No open Task Threads in this scope.` It does not claim that the Workspace has no taskless or resolved Threads.

#### `threads`

Answers: “Find a top-level Thread, including taskless discussions or resolved work.”

- One top-level Thread per row, newest anchor first.
- Task overlay stays inline; no separate Task rows exist.
- `channelRef` optionally narrows the directory before selection.
- `limit/cursor/hasMore` apply only to Thread rows; the footer says that the cursor continues toward older Thread anchors.
- Empty state names the selected Workspace or Channel.

#### `members`

Answers: “Whom can I address here?”

- `memberRef + handle + kind + presence + description` per row.
- `channelRef` optionally narrows the roster to Members authorized in that Channel.
- Paging applies only to Member rows and its cursor is scope-local: callers copy it unchanged and never interpret or reuse it in another scope.
- No Thread, Task, or Channel directory is repeated in this result.

### Illustrative renders

```text
Workspace overview
Channels
channel:046d… · Main-Dev
Open Task Threads — newest first
thread:b5d… · channel:046d… · task:393d… (#74), in_progress · revision 8962 — Systematically review the five Team tool results
Members — identity only
member:2eb7… · @Cole · working
Open-work cursor 8888; hasMore=true — continue this overview with cursor 8888.
Use scope=threads for taskless/resolved Threads; use scope=members for responsibilities.
```

```text
Threads in channel:046d… — newest first
thread:b5d… · task:393d… (#74), in_progress · revision 8962 — Systematically review the five Team tool results
thread:7c19… · task:907f… (#73), done · revision 8833 — Fix the release CI race
Thread cursor 8830; hasMore=true — older Threads exist.
```

### What the implementation hides

- Host-authorized membership and Channel selection.
- Filtering nonterminal Task Threads **before** applying `limit`.
- Stable newest-anchor-first selection and a cursor tied only to that selected set.
- Task-to-Thread overlay joining and subject derivation.
- Member deduplication across Channel memberships.

The existing Host `view` projection can support `threads` once the tool deliberately requests `direction: 'before'`. `overview` needs one Host-side nonterminal-Task filter applied before selection; deriving it after an arbitrary page recreates the current temporal bug. No second store or authority is needed.

### Trade-offs

- **Depth:** high. One optional selector hides three coherent directory implementations without adding tools.
- **Locality:** strong. Thread-row construction, subject formatting, and cursor wording each have one implementation and one render-level test surface.
- **Interface cost:** one enum whose modes must be learned; action-specific argument validity must be documented and tested.
- **Migration:** old Sessions can still call the default overview, but cannot request newly declared scopes until their frozen tool schema is renewed. The rollout must either renew Member Sessions deliberately or accept that temporary limitation; it must not silently invent a second compatibility interface.

## 4. Option B — contextual progressive `team_view` with the existing parameters

### Interface

```ts
team_view({ channelRef?: string, limit?: number, cursor?: number })
```

No schema changes are required. Parameter combinations carry the modes:

- Without `channelRef`: Workspace overview — Channels, bounded open Task Threads, and the full visible Member roster.
- With `channelRef`: that Channel's complete top-level Thread directory — taskless, active, and resolved — newest anchor first.
- `limit/cursor` page only the primary rows for the implicit mode; the footer names the set.

The same Thread summary, outcome ordering, Host-side pre-filtering, empty states, and action-specific renders used by Option A still apply.

### Illustrative use

```ts
team_view({ limit: 5 })
// Workspace overview: Channels + five open Task Threads + visible Members

team_view({ channelRef: 'channel:046d…', limit: 10 })
// Ten newest top-level Threads in this Channel, with inline Task overlays
```

### Trade-offs

- **Depth:** moderate. Common orientation and Channel browsing stay easy, but the caller must learn that the presence of `channelRef` changes the result kind.
- **Locality:** weaker than A. Roster depth and archive access remain conditional branches inside one implicit mode.
- **Interface cost:** minimal and immediately usable by every existing Session.
- **Loss:** there is no coherent Member-only read. Every Workspace-wide work lookup repeats Member descriptions, while removing descriptions would eliminate the only responsibility-discovery path. Older Threads can only be found Channel by Channel.
- **Testability:** every parameter combination needs semantic tests because the result kind is not named in the request.

## 5. Option C — split discovery tools (rejected contrast)

`team_work`, `team_threads`, `team_members`, and possibly `team_channels` would make every question explicit, but the trace has only 43 `team_view` calls among 1,493 Team calls and no observed Member-only lookup. Splitting adds routing choices, repeats authorization/presentation conventions, and breaks the intentional five-tool protocol. The same depth is achievable behind one scoped `team_view`; this option does not earn its interface cost.

## 6. Comparison and recommendation

| Criterion | Option A: explicit scope | Option B: implicit context | Option C: split tools |
| --- | --- | --- | --- |
| Caller states its question | Yes | Only indirectly | Yes |
| One coherent paged set | Yes | Yes, if every combination is carefully specified | Yes |
| Member detail on demand | Yes | No | Yes |
| Existing frozen schemas work fully | No; default only until renewal | Yes | No |
| Tool routing surface | Five tools + one enum | Existing five tools | Eight or nine tools |
| Implementation locality | Strongest | Moderate | Repeated across adapters |
| Evidence fit | Strong; scopes map to observed work/thread lookup and required Member addressing | Strong for current calls, weak for responsibility lookup | Weak |

**Recommendation: Option A**, with `scope` optional and `overview` as the useful default. One selector is an earned seam: deleting it recreates conditional modes and repeated rosters in callers/results. The lack of observed Member-only calls is not evidence that Member discovery is unnecessary—the current interface cannot express that intent, while mention and DM require Member refs. Do not implement A until the Human chooses the Session-renewal consequence knowingly.

If uninterrupted use by frozen Sessions is more important than explicit semantics in this release, choose B rather than adding a transitional compatibility layer. B is coherent and substantially better than the current projection dump; it simply accepts a shallower interface.

## 7. Cross-tool action decision table

“Default” means model-visible without another call. “Deeper route” identifies information deliberately omitted from that action.

| Tool/action | Outcome and default facts | Must not be omitted | Deeper route / deliberately omitted |
| --- | --- | --- | --- |
| `team_view overview` | Authorized Channels; bounded open Task Thread rows; compact Member identity/presence; open-work continuation | Channel refs; Thread subject/ref; inline Task ref/number/status; Thread revision; cursor/hasMore for open work | Taskless/resolved Threads → `scope=threads`; Member descriptions → `scope=members` |
| `team_view threads` | Selected directory identity; one subject-bearing row per top-level Thread; inline Task overlay; older-Thread continuation | Thread + Channel refs; subject; Task overlay when present; revision; cursor/hasMore | Bodies/timeline → `team_thread`; no separate Task index |
| `team_view members` | Selected roster identity; Member ref, handle, kind, presence, responsibility description | Member ref + handle + presence; scope-local continuation if bounded | Thread state and follower state do not belong here |
| `team_inbox` | Total unread/direct counts; bounded Thread summaries in Host priority order; per-row subject, refs, Task overlay, exact counts, revision | Total counts even when truncated; Thread ref; unread/direct counts; revision; explicit empty/truncated state | No unread reply bodies; read one route with `team_thread read` |
| `team_thread status` | Attention status for one Thread plus optional Task standing and current revision | Thread ref; following state; Task overlay when present; revision | No anchor, Claims, or timeline |
| `team_thread follow` | `Attention changed — now following` plus Thread/Task identity and unchanged current revision | Explicit mutation outcome; Thread ref; following=true; revision | No anchor, Claims, or timeline |
| `team_thread unfollow` | `Attention changed — no longer following` plus Thread/Task identity and current revision | Explicit mutation outcome; Thread ref; following=false; revision | Active-Claim guard remains a raw error; no timeline snapshot |
| `team_thread read` | Read/acknowledgement outcome; self-orienting Thread/Task header; anchor; active Claims; chronological facts with inline unread/direct markers; read-through and remaining count | Thread ref; current revision; Task standing; full anchor; active collision surface; remaining unread; acceptance context advice when supplied | Completed/released Claim archive → explicit Claim history; older facts → history |
| `team_thread history` | Historical-page identity; chronological facts; older-history cursor and hasMore; explicit empty/exhausted state | Thread ref; a bounded anchor subject for orientation; fact sequences; cursor/hasMore | Does not acknowledge work; current Claim snapshot omitted rather than mixed into old chronology |
| `team_message start` success | `Committed — Thread created`; Message ref, new Thread ref, optional Task ref, resulting revision | Created Thread ref; Message ref; revision; Task ref when created | No Workspace/roster snapshot |
| `team_message reply` success | `Committed — reply added`; Message ref, Thread ref, optional Task ref, resulting revision | Thread ref; Message ref; current revision | No Thread timeline echo |
| `team_message dm` | Delivered vs recorded-not-delivered; recipient handle/ref; delivery note; no-blind-retry instruction on failure | Delivery distinction and recipient identity | No Thread/Inbox fiction |
| `team_message` typed rejection | `Not committed — <kind>` before any current context; safe correction | Rejection kind; no-side-effect statement; Thread/Task refs and current revision when they exist; expected revision or unread/direct counts; non-following Member refs | No unrelated snapshot; preserve read-before-retry/Human-invite route |
| `team_claim list` | Task/Thread identity and standing; **active** collision surface; explicit `No active Claims` | Task + Thread refs; current revision/status; active Claim ref/owner/direction | Completed/released archive only through an explicit history option or Thread history |
| `team_claim claim` success | `Committed — Claim created`; affected Claim first; Task/Thread resulting standing/revision; other active Claims as labelled collision context | New Claim ref, owner, direction, state; Task/Thread refs; revision/status | Old completed/released Claims omitted |
| `team_claim done/release` success | `Committed — Claim completed/released`; affected Claim first; resulting Task standing/revision; remaining active Claims if any | Affected Claim ref/resulting state; Task/Thread refs; revision/status | Old Claim archive omitted |
| `team_claim` typed rejection | `Not committed — <kind>` and the same local recovery facts as Message rejection | No-side-effect statement; Task/Thread refs; current revision; expected revision or unread/direct counts | Do not append the full Claim history to a rejected mutation |
| Raw tool error | Harness error with invalid field/ref and precise correction; no durable effect | Invalid address/argument and atomic failure semantics | Never disguise as a committed or typed collaboration result |

## 8. Discriminating tests implied by the table

1. A taskful Thread appears exactly once in every directory render; its Task ref/status are on that row and no separate Task row renders.
2. A directory row always has a deterministic bounded subject; no unread reply body appears in `team_view` or `team_inbox`.
3. Each cursor footer names exactly the set it continues; Channels/Members do not repeat as if they were part of a Thread event page.
4. `status`, `follow`, and `unfollow` renders contain no anchor body, Claim line, or timeline fact.
5. `history` contains no current Claim snapshot and never changes read state; `read` retains active Claims and remaining-unread state.
6. Every committed Message/Claim mutation names the requested action and affected durable ref; tests fail if start/reply or claim/done/release collapse to the same generic line.
7. Every typed rejection begins with `Not committed`, contains all recovery fields, and renders no unrelated Claim/archive snapshot.
8. Empty Inbox, empty open-work overview, empty Thread directory, empty Member roster, empty Claim list, empty read, and exhausted history each say what is empty and whether another route/page exists.
9. Full refs remain render-visible. Abbreviations continue to be accepted by execution but are not the default emitted address.
10. The current structured results may retain compatibility fields, but render tests assert what the model actually sees and reject temporal mixing or duplicated entities.

## 9. Decisions required before `spec.md`

1. Choose A (explicit `scope`, with Member Session renewal consequence) or B (existing parameters, implicit modes).
2. Confirm that default overview means nonterminal **Task Threads only**; taskless and resolved Threads live in the deeper directory.
3. Confirm anchor-derived bounded subjects in both `team_view` and `team_inbox`, while unread reply bodies remain exclusive to `team_thread`.
4. Confirm `team_claim list` is active-only by default and whether an explicit history flag is required, or Thread history is sufficient.
5. Confirm `team_thread read` keeps the full anchor on every read for self-orientation, while only active Claims render; history gets only a bounded subject plus its selected facts.
6. Confirm that the existing numeric cursor may be scope-local and opaque to the caller, or require one uniform ledger-sequence meaning across all scopes.
