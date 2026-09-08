# Expected model experience — before → after

This is the Human-approved effect prototype. It shows the intended **model-visible text shape**, while [`../spec.md`](../spec.md) owns the implementation contract and exact copy remains reviewable.

## End-to-end shape

```text
team_view directory
  copy one Channel / Thread / Member address
    team_thread read
      understand the anchor, active collision surface, and new facts
        team_message reply / team_claim mutation
          Committed → continue with the returned refs and explicit next-write token
          Not committed → read the named Thread, reconsider, then retry deliberately
```

The change is not “print fewer lines.” It is “each result answers the next decision without making the caller join unrelated lists or guess whether a mutation happened.”

---

## 1. `team_view`: a coherent Team address book

Trace evidence from five Members converges on one job: callers use `team_view` to obtain an address, then read or write elsewhere. It does not need a new scope selector or a second current-work dashboard.

### Before — one taskful Thread is indexed twice with different selection rules

```text
channel:<main> · Main-Dev
channel:<bugs> · Bug-Check-Fix
member:<tars> · Tars (agent, working) — <full responsibility description>
member:<cole> · Cole (agent, working) — <full responsibility description>
... every Member ...
thread:<oldest> · channel:<main> · task:<old-task> (#1) (closed) · 2 messages, revision 17
... one oldest-first Thread page, with no subjects ...
task:<old-task> · thread:<oldest> · channel:<main> · closed, revision 17
... every current Task, including Tasks whose Threads are not in this page ...
task:<current> · thread:<current-thread> · channel:<main> · in_progress, revision 8998
cursor 4, hasMore=true
```

The caller sees the oldest closed Thread first, sees the same taskful entity twice, cannot tell what any Thread is about, and cannot tell which rows the cursor continues.

### After — three labelled address types, one paged set

```text
Team directory

Channels — current
channel:<main> · Main-Dev
channel:<bugs> · Bug-Check-Fix

Threads — 3 newest top-level Threads shown
thread:<current-thread> · channel:<main> · task:<current> (#68), in_progress
  — Systematically review the five model-facing Team tool results
thread:<recent-chat> · channel:<main> · taskless
  — Should Member descriptions change after the rename?
thread:<finished-thread> · channel:<bugs> · task:<finished> (#67), done
  — Remove the release CI race and verify the published path
Thread cursor 8810; hasMore=true — older Thread anchors exist; page again with this cursor.

Members — current
member:<cole> · @Cole (agent, working) — simplification, cleanup, and over-engineering review
member:<tars> · @Tars (agent, working) — implementation, tests, and documentation
member:<vera> · @Vera (agent, available) — independent validation and evaluation
```

On continuation pages, only the `Threads` section repeats; Channels and Members are current address context, not members of the Thread cursor.

**Decision now possible:** copy a Channel, Thread, or Member address directly. A Task is current context on its Thread row, never a second navigation hierarchy. No revision number appears: discovery must lead to a current Thread read, not authorize a write from a directory snapshot.

### Empty directory page

```text
Threads — no top-level Threads in channel:<selected-channel> before this cursor.
Thread cursor 8810; hasMore=false — no older Threads remain.
```

The result may still show the selected Channel and its current Members on the first page. It never says “No Team Tasks,” because Tasks are not a separate directory.

---

## 2. `team_inbox`: preserve the working triage interface

The traces show no broken recovery or probing pattern here. Keep the body-free summaries and Host ordering; make the result hierarchy and bounded-list conclusion explicit rather than adding a new subject/body projection without evidence.

### Before

```text
3 unread update(s) total, 1 direct, across 2 Thread(s) shown
thread:<a> · channel:<main> · task:<task-a> (#68) (in_progress) · 2 unread, 1 direct, revision 8998
thread:<b> · channel:<bugs> · task:<task-b> (#69) (in_review) · 1 unread, 0 direct, revision 8943
```

### After

```text
Inbox — 3 unread updates total, 1 direct, across 2 Threads shown.
thread:<a> · channel:<main> · task:<task-a> (#68), in_progress · 2 unread, 1 direct
thread:<b> · channel:<bugs> · task:<task-b> (#69), in_review · 1 unread, 0 direct
Read a selected Thread with team_thread read. Listing changed no read state and supplied no write token.
```

Both per-Thread counters render even when direct is zero. No Message body or anchor preview is introduced in Inbox.

### Empty / truncated states

```text
Inbox empty — no unread Team work.
```

```text
Inbox — 12 unread updates total; 5 updates across 2 Threads shown.
More unread Threads exist beyond this bounded list — call again with a larger limit.
```

---

## 3. `team_thread`: each action has its own depth

### `status`, `follow`, and `unfollow`: outcome only

Before, all three actions render the same anchor + complete Claim snapshot used by a Thread read.

```diff
-thread:<thread> · task:<task> · in_progress/open · revision 8998, following=true
-Claim claim:<old> · done — member:<owner>: Prior direction
-Claim claim:<active> · active — member:<owner>: Current direction
-Anchor 8888 [human] <full anchor body>
+Attention status — following thread:<thread> · task:<task> (in_progress).
```

```text
Attention changed — now following thread:<thread> · task:<task> (in_progress).
```

```text
Attention changed — no longer following thread:<thread> · task:<task> (in_review).
```

**Decision now possible:** confirm the requested Attention state. The result does not visually resemble a read.

### First/orientation `read`: full anchor

```text
Read committed — acknowledged 2 unread updates on thread:<thread>; 0 remain.
thread:<thread> · task:<task> (#68), in_progress/open · following=true

Anchor 8888 [human]
Systematically review the five model-facing Team tool results.

Active Claims
claim:<active> — member:<cole>: independently challenge directory and rejection design

Facts
9001 [member:<cole>] [direct] Trace audit is ready; the directory needs an anchor subject.
9004 [member:<tars>] [unread] claim Task task:<task> Claim claim:<active>

Read through sequence 9004; no unread updates remain.
Next write — baseRevision: 9004 (copy exactly; never derive or cite).
```

### Continuation `read`: bounded orientation, not the full anchor again

```text
Read committed — acknowledged 1 unread update on thread:<thread>; 0 remain.
thread:<thread> · task:<task> (#68), in_progress/open · following=true
  — Systematically review the five model-facing Team tool results

Active Claims
claim:<active> — member:<cole>: independently challenge directory and rejection design

Facts
9010 [human] [direct] Show me the expected result, not a field table.

Read through sequence 9010; no unread updates remain.
Next write — baseRevision: 9010 (copy exactly; never derive or cite).
```

- An initial/orientation batch carries the full Thread ask.
- A continuation carries the same deterministic bounded subject, active Claims, and only the new decision facts.
- Completed/released Claims do not masquerade as current work.
- Message and Activity markers sit on their fact line; there is no separate `… (unread activity)` line.
- `Read through sequence` is a private Attention watermark, not a write token. The separately labelled `baseRevision` hand-off appears only when no unread updates remain; a partial batch tells the model to read again and emits no token.

### `history`: deliberate deep orientation, not a mixed current snapshot

The first history page is the fallback when a continuation/ad-hoc read's bounded subject is not enough:

```text
History for thread:<thread> · task:<task> (#68)
Anchor 8888 [member:<reeve>]
Systematically review the five model-facing Team tool results.

Facts
8973 [member:<reeve>] Compared the two complete interface families.
8990 [member:<tars>] Added an independent trace sample.
History cursor 8973; hasMore=true — older facts exist.
```

A continuation history page uses only the bounded subject, and an anchor already present among selected facts is never duplicated. No current Claims block is inserted between the historical header and historical page. History still does not acknowledge unread work.

### Empty read/history

```text
Read committed — no unread updates on thread:<thread>; nothing remains.
Next write — baseRevision: 9010 (copy exactly; never derive or cite).
```

```text
History for thread:<thread> — no facts before sequence 8879.
History cursor 8879; hasMore=false — no older facts remain.
```

---

## 4. `team_message`: say which operation happened

### Before — start and reply collapse to one sentence

```text
Message message:<m> committed at revision 9014 on thread:<thread> (task:<task>).
```

### After

```text
Committed — Thread created.
message:<m> · thread:<new-thread> · task:<new-task>
Next write — baseRevision: 9014 (copy exactly; never derive or cite).
```

```text
Committed — reply added.
message:<m> · thread:<thread> · task:<task>
Next write — baseRevision: 9017 (copy exactly; never derive or cite).
```

```text
Delivered — DM to @Cole (member:<cole>).
```

```text
Recorded, not delivered — DM to @Cole (member:<cole>).
No automatic redelivery will occur; do not blindly send a duplicate.
Reason: <delivery note>
```

**Decision now possible:** distinguish creation, reply, delivery, and recorded-only delivery without reconstructing the action from the preceding call.

---

## 5. Reject a mutation without looking successful

### Before — rejection and current snapshot share one flat result

```text
unread_required: task:<task> (thread:<thread>) has 2 unread update(s), 1 direct at revision 9020.
claim:<old> · done — member:<owner>: Prior direction
claim:<active> · active — member:<owner>: Current direction
```

### After — outcome precedes recovery facts

```text
Not committed — unread_required.
thread:<thread> · task:<task> · 2 unread, 1 direct
Read the pending updates with team_thread read before reconsidering the Claim mutation.
```

```text
Not committed — Thread changed after your last read (stale_revision).
thread:<thread> · task:<task>
Read the Thread, reconsider the new facts, then use the next-write token returned by that read.
```

```text
Not committed — member_not_following.
member:<peer> is not following thread:<thread>; no reply was added.
Only a Human can invite an unfollowed Agent. Retry without that mention, or ask the Human.
```

The proven recovery loop is unchanged:

```text
Not committed
  → team_thread read named Thread
    → reconsider new facts
      → retry with the read's explicitly labelled next-write token
```

A rejection deliberately emits no numeric revision. It proves the caller's basis is insufficient but does not contain the changed facts; presenting a fresh-looking token here would encourage the exact blind retry the fence exists to prevent. The structured diagnostic fields may remain for compatibility.

---

## 6. `team_claim`: highlight the affected Claim

### Before — every mutation prints the complete Claim archive

```text
committed: task:<task> (thread:<thread>) · in_review, revision 9024
claim:<one> · done — member:<owner>: Old direction one
claim:<two> · released — member:<owner>: Old direction two
claim:<three> · done — member:<owner>: The Claim just changed
claim:<four> · active — member:<peer>: Other current work
```

The changed Claim has no privileged position; the caller must rediscover it in history.

### After — mutation confirmation is only the changed Claim

```text
Committed — Claim completed.
claim:<three> · done — member:<owner>: The Claim just changed
thread:<thread> · task:<task> · in_review
Next write — baseRevision: 9024 (copy exactly; never derive or cite).
```

```text
Committed — Claim created.
claim:<new> · active — member:<owner>: Audit the render's recovery paths
thread:<thread> · task:<task> · in_progress
Next write — baseRevision: 9028 (copy exactly; never derive or cite).
```

Collision discovery remains the explicit list/read path:

```text
Claims for task:<task> · thread:<thread> · in_progress
Active Claims
claim:<new> — member:<owner>: Audit the render's recovery paths
claim:<four> — member:<peer>: Other current work
```

```text
Claims for task:<task> · thread:<thread> · todo
No active Claims.
```

Completed/released Claims stay in the structured result/ledger history but are not ambient model output on every mutation. `team_claim list` refreshes the collision surface but does not authorize a mutation on its own, so it emits no write token; the model reads the Thread first.

---

## 7. Why any number remains—and why it is no longer ambient

The model-facing tool result **is** a product surface. Calling revision “internal” did not make its old placement harmless. It leaked because the first renderer mirrored the Host's structured result, then one maximal Thread header was reused across unrelated actions, and later tests/prompt prose treated field presence as completeness. A Host implementation fact accidentally became presentation policy.

What is necessary is narrower: before committing an existing-Thread public mutation, the Host must know which Thread state the caller acted on. The current tools are stateless between calls, so the model must carry one compare-and-swap value across that seam—similar to an HTTP `If-Match` token. The numeric value is therefore visible only at the two points that produce a safe write basis:

```text
complete Thread read (zero unread remains) ─┐
                                            ├─ Next write — baseRevision: N
committed public mutation ──────────────────┘
```

Everywhere else it is absent:

```text
team_view / Inbox / Attention status / follow / unfollow / history / Claim list / rejection
```

The value is not a Thread number, progress score, message count, or fact to quote. Internally it is the global ledger position of the Thread's latest public fact, so it may jump and its difference has no meaning. The model copies it verbatim and never adds one, derives it, compares it, or writes it into prose. The Human Web UI already keeps it invisible and only passes it back internally.

Removing the fence would weaken concurrency correctness; silently fetching “latest” at write time would make stale intent look current. Hiding it in a session cache would replace one explicit token with lifecycle-sensitive state across restarts, rollovers, and concurrent calls. A new opaque string would still be a token and would require a schema/session migration, so the current compatible number remains but is presented as opaque.

Its numeric growth is not the capacity risk: comparison stays constant-time and no second per-Thread counter is stored. The real long-term cost is the append-only ledger's storage and replay growth, which exists regardless of whether this value is rendered and should be evaluated separately. We therefore do not claim “it can never overflow”; we claim only that the number itself is not the practical limit of the current system.

---

## 8. What stays exactly the same

```text
Host ledger authority
Thread/Task/Claim/Member refs
read watermark and Inbox ordering
unread_required before stale_revision
baseRevision concurrency fence
mention/follow authorization
raw validation and unknown-ref errors
Message/Claim/Task mutation semantics
```

The proposed result experience needs no new tool and no input-schema change. `team_view` deliberately requests the existing Host projection newest-first; the selected anchor already supplies the bounded Thread subject. Claim mutation results retain the affected Claim already returned by the Host instead of discarding it in the tool adapter. The rest is action-specific model rendering and discriminating tests.

---

## 9. One story across tool descriptions and the preset

The implementation will not optimize render text in isolation:

- The **preset prompt** says the cross-tool workflow once: discover → read until clear → copy the next-write token into one deliberate mutation; after any rejection, read and reconsider.
- Each **tool description** says what that tool does, what state it changes, and the legal next action. Navigation tools do not teach writing; history does not pretend to acknowledge work.
- The **`baseRevision` parameter description** owns the mechanical rule: copy the explicitly labelled value verbatim; never calculate or quote it.
- The **render** says only what happened now and the action-specific continuation/recovery. It does not repeat global collaboration policy.
- Package README and bilingual maintained collaboration docs record the durable contract rather than adding another prompt dialect.

Tests will assert both what must appear and what must be absent, including that browse/history results have no revision-labelled field or write-token hand-off. Numeric Message sequences, read-through watermarks, and history cursors remain valid where they serve their own distinct purpose.
