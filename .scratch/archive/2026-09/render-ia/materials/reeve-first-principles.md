# Reeve audit — Team tool results as decision interfaces

This is an independent research note, not the chosen specification.

## 1. First principle

A Team tool result is not a serialization of the ledger projection. It is the interface between one completed operation and the model's next decision.

Every result should let the caller answer, in order:

1. **What happened?** The requested read or mutation succeeded, was rejected without side effects, or failed.
2. **What is true now?** Identify the relevant Thread/Task/Claim/Member and the current state needed for this decision.
3. **What can I legally do next?** Supply the address, concurrency fact, continuation key, or corrective route required for the next action.

A fact belongs in an action's default render when removing it makes one of those answers ambiguous or causes a predictable extra/incorrect action. A fact does not belong merely because it exists in the structured projection.

## 2. Cross-tool invariants

1. **Outcome precedes snapshot.** A rejected mutation must never visually resemble a committed mutation; current state is supporting context, not the result itself.
2. **One entity, one row in a directory.** Task is a Thread overlay, not a second navigation hierarchy. A taskful Thread must not require joining two lists.
3. **Time semantics are explicit and coherent.** Do not place an old historical page beside an unlabelled current snapshot as if both were selected on the same basis.
4. **Addressability is local.** The result that asks the caller to read, reply, retry, page, mention, or mutate must carry the ref needed for that exact action.
5. **Concurrency is local.** An existing-Thread mutation result or rejection must expose the current revision at the point where the caller decides whether to reread or retry. A revision is operational state, never prose to quote publicly.
6. **Thread is the collaboration context.** Channel answers where the Thread lives; Task adds work state; Claim adds one Member's direction. Render nesting should follow that ownership.
7. **Action-specific depth.** Sharing one renderer does not justify showing the same snapshot for `status`, `follow`, `read`, and `history`; each action has a different next decision.
8. **Empty is a state, not missing output.** Empty renders must name what is empty and whether the caller is done or should continue elsewhere.
9. **Normal rejections teach recovery.** `unread_required`, `stale_revision`, and `member_not_following` are expected collaboration outcomes. Each must state that nothing committed and give the one safe corrective route.
10. **Raw errors remain precise.** Schema/authorization/unknown-ref failures should identify the invalid field/ref and correction without pretending to be a typed collaboration result.

## 3. Intent and failure-mode matrix

### `team_view`

**Primary caller intents**

- Discover the authorized Channels available for a new Thread.
- Find current/open Team work and obtain its Thread or Task ref.
- Locate an older known Thread deliberately.
- Find a Member to mention or DM and understand their current availability/responsibility.

These are distinct questions. The current no-argument call attempts to answer all four at once.

**Verified current mismatch**

- Thread rows are selected from top-level anchor facts in chronological `after` order; the initial page therefore starts with the oldest Threads.
- Task rows come from every visible current Task, independent of which Thread anchors are in that page.
- Channels and Members are complete current snapshots repeated beside that historical Thread page.
- The numeric cursor paginates only the selected fact/Thread stream; Channels, Members, Tasks, and the full Thread projection are current snapshots repeated on every page. The maintained prose currently overstates this as one cursor covering Channels, Threads, and Members.
- Task rows repeat Thread/Channel/revision already represented by taskful Thread rows.
- Thread rows have identity and state but no subject, so a caller can see `#63 (done)` without knowing what #63 was about.

**Predictable bad decisions**

- Treat the oldest page as the current work queue.
- Choose work from the all-Task list, then search a different Thread list for its context.
- Increase the generic discovery call instead of asking a narrower semantic question.
- Copy a long Member ref incorrectly from an unrelated roster scan.
- Assume a roster description is needed for routine Thread discovery, or miss presence because it is buried inside prose.

**Facts tied to next actions**

- Start a Thread: Channel ref + Channel name.
- Read/reply/follow a Thread: Thread ref; Task ref/number/status when taskful; current revision where a mutation will follow.
- Decide what work is current: open/closed standing and a meaningful subject, not identity alone.
- Mention/DM a Member: Member ref + handle + presence; responsibility description only when selecting whom to contact.

### `team_inbox`

**Primary caller intent:** decide which unread Thread to read next.

The current module is already relatively deep: it returns body-free summaries ordered by direct work and recency, gives total and per-Thread unread/direct counts, and does not mutate read state.

**Risks to preserve against**

- An empty bounded list being mistaken for a fully drained Inbox.
- A direct marker being reduced to a boolean when several updates exist.
- Task status being shown without the Thread ref that `team_thread read` needs.
- Adding Message bodies here and creating a second read authority.

**Needed result shape:** one labelled Inbox summary followed by one row per Thread. No roster, Claim history, or Message body belongs here.

### `team_thread`

`team_thread` is one tool with five materially different intents:

- `status`: inspect personal Attention and current Thread/Task standing.
- `follow`: confirm that future activity will enter personal Attention.
- `unfollow`: confirm that Attention ended; active-Claim rejection remains an error path.
- `read`: understand and acknowledge the next unread batch in current collaboration context.
- `history`: inspect older chronology without acknowledging new work.

**Current temporal/layering risks**

- One shared renderer prints current Claims and the anchor even for status/follow/unfollow, where mutation confirmation is the decision.
- History facts are historical while Claims are a current snapshot; without section semantics they look co-temporal.
- Anchor and Claims can repeat on every incremental read even when the next decision concerns only newly arrived facts.
- Activity lines and Message lines use different marker conventions; unread activity becomes a separate ellipsis line.
- `following=true` is compact but less explicit than the action outcome when follow/unfollow was requested.

**Action-specific facts**

- `status`: Thread ref, optional Task overlay/standing, revision, following state. No chronology is required.
- `follow`/`unfollow`: explicit outcome, Thread ref, optional Task ref/standing, following state. Do not render unrelated anchor prose as mutation output.
- `read`: Thread identity/standing/revision, active collision surface, orientation anchor when needed, chronological facts with direct/unread provenance, and read continuation state.
- `history`: Thread identity, requested historical facts, anchor orientation when necessary, and older-history continuation state. Any current snapshot must be labelled current rather than presented as part of the old page.

### `team_message`

**Primary caller intent:** know whether a start/reply/DM took effect and what address/state to use next.

**Success paths**

- `start`: say that a Thread was created; show Message ref, Thread ref, optional Task ref, and resulting revision.
- `reply`: say that a reply committed; show Message ref, Thread ref, optional Task ref, and resulting revision.
- `dm`: distinguish delivered from recorded-but-not-delivered and identify the recipient.

The renderer receives the original action but currently ignores it, collapsing start and reply into generic "Message committed".

**Rejection paths**

- `unread_required`: nothing committed; show Thread/Task, pending counts, current revision, and `team_thread read` as the corrective route.
- `stale_revision`: nothing committed; distinguish rejected revision from current revision, then require reread before retry.
- `member_not_following`: nothing committed; name the non-followers and retain Thread/Task/revision whenever the structured outcome has them.

**Observed raw-error path**

A mistyped Member ref in a multi-recipient start rejected the whole operation with a precise unknown-ref error. This is correct atomic behavior; a redesign should make Member discovery/copying clearer rather than weakening validation.

### `team_claim`

**Primary caller intents**

- `list`: inspect collision-relevant Directions before choosing an angle.
- `claim`: know whether a Direction was created and what Claim ref now identifies it.
- `done`/`release`: know whether the addressed Claim changed state and what the Task/Thread standing became.

**Current risks**

- Every result prints the entire Claim history, so the changed Claim is not distinguished from old done/released Claims.
- On a typed rejection, the rejected outcome and current Claim snapshot share one flat block, which can obscure that no mutation occurred.
- `list` and mutation actions use the same snapshot even though list needs a collision surface while mutation needs an affected-Claim confirmation.

**Action-specific facts**

- `list`: Task/Thread identity and standing/revision; active Claims (owner + direction + ref) as the primary collision surface. Historical Claims require an explicit reason to appear.
- `claim`: committed/rejected outcome; on success highlight the newly created Claim and current Task standing; show other active Claims only if needed to preserve collision awareness.
- `done`/`release`: committed/rejected outcome; highlight the target Claim's resulting state, Task standing, Thread ref, and current revision.

## 4. Candidate interface families (not decisions)

### Family A — action-scoped `team_view`

Add an explicit discovery action, for example `overview | threads | members`:

- `overview`: Channels plus current open work summary; no full roster descriptions or archive directory.
- `threads`: Thread directory with Task overlay inline, semantic state selection, subject, and a deliberate older-history continuation.
- `members`: roster with Member ref, handle, presence, and responsibility description.

**Leverage:** each result answers one question and stays internally coherent. The implementation can hide projection joins and ordering behind the existing tool seam.

**Cost/risk:** expands the public parameter interface and requires a compatibility decision for no-argument calls. It also exposes that the current Host view is an event projection, not yet an ideal directory query.

### Family B — contextual progressive `team_view`

Keep the small parameter surface but give parameter combinations distinct semantics:

- no arguments: Workspace overview (Channels, active work, compact roster identity/presence);
- `channelRef`: that Channel's Thread directory with inline Task overlay;
- a new optional Member selector or detail flag: responsibility-rich roster/detail;
- deliberate continuation operates only within the chosen semantic view.

**Leverage:** the common call is useful without learning an action enum; Channel narrowing naturally maps to navigation.

**Cost/risk:** implicit mode changes can be harder to learn and test. A single result still risks combining unrelated overview sections, and Member detail lacks a natural selector today.

### Family C — split discovery modules

Replace `team_view` with separate Channel/Thread/Member discovery tools.

**Leverage:** each interface is maximally explicit.

**Cost/risk:** increases the tool surface and routing burden, duplicates authorization/presentation conventions, and weakens the existing five-tool protocol. This family is a useful contrast but is unlikely to earn its interface cost unless A/B cannot express the real use cases cleanly.

## 5. Preliminary recommendation to challenge

Prefer **Family A** unless trace review shows no meaningful ambiguity in implicit modes. One `team_view` module remains, but explicit actions state the caller's question. Behind that seam, the implementation should construct a coherent directory view rather than pass through `AgentTeamView` wholesale.

Regardless of family:

- Thread is the only directory row for collaboration; Task is rendered inline as its overlay.
- Open/current work and older completed work are different discovery intents, not sections to flatten together.
- Member description belongs to Member-selection intent, not every Thread-discovery result.
- `team_thread`, `team_message`, and `team_claim` renderers branch on action/outcome instead of formatting one maximal snapshot.
- Structured results may remain backward compatible while model-facing render behavior is improved, but fields whose semantics are themselves incoherent must be corrected at the Host projection seam rather than hidden cosmetically.

## 6. Questions for Cole/Human

1. Is no-argument `team_view` primarily a Workspace orientation call, a current-work dashboard, or a complete directory entry point?
2. Should a Thread subject be the anchor body, a bounded derived title, or remain unavailable until `team_thread read`? Identity-only rows cannot support work selection well.
3. Which Task states count as current work for default discovery (`todo`, `in_progress`, `in_review`), and is accepted/closed work one explicit historical mode?
4. For `team_claim list`, are completed/released Claims part of collision avoidance or only audit history?
5. Does every `team_thread read` need to be self-orienting with the anchor/current Claims, or should repeat reads render only the new decision delta while structured data remains complete?
6. Is preserving no-argument `team_view` behavior important enough to justify a transition mode, or can this model-facing interface change atomically with its prompt/tests?
