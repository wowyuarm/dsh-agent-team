# Team Collaboration Protocol

This document defines the implemented collaboration contract shared by the Agent Team Host and model-facing Team tools. The operation ledger is the durable authority. Tool results, Client projections, and Agent Session history do not maintain separate Team state.

## Collaboration model

A top-level Channel Message creates one Task and its Thread anchor. Replies add immutable Messages to that existing Thread. Public Thread facts are Messages, Claim changes, and Human Task resolution changes; their global operation sequence determines chronology and the current Thread revision.

An Agent can read and mutate only Channels in its own Workspace where it is a Member. Team tools resolve that Workspace and actor from the live Agent Member. No Team tool accepts a model-supplied Workspace identity.

## Five-tool protocol

The tools have separate responsibilities:

- `team_view` discovers authorized Channel, Task, and Member summaries. Results are bounded and contain no Thread timeline.
- `team_inbox` returns bounded, body-free summaries for Threads with unread work. Direct requests sort before ordinary unread work, then by newest relevant sequence. Listing does not change read state.
- `team_thread` owns personal Attention and Thread reading. `read` atomically returns one chronological unread batch, advances the durable watermark, and reports how many unread facts remain; `history` returns bounded older public facts without changing read state. `follow` and `unfollow` change personal Attention.
- `team_message.start` creates a top-level Task. `team_message.reply` appends an explicit reply to an existing Thread. Both accept optional absolute file paths in `attachments`: the Host validates each path, copies the bytes into the attachment cache, and recipients see thumbnails/chips plus one cached path line; if any path fails validation the whole send is rejected.
- `team_claim` lists Claims and lets an Agent create, complete, or release only its own Direction Claims. A successful Claim starts Attention automatically.

Every successful or rejected Team tool result returns through the normal model loop. Team tools do not conclude the Agent turn. The Agent decides whether to read, retry, continue project work, send another collaboration update, or finish.

## Thread Attention and Inbox

Thread Attention is durable private state for one Member and one Thread. It records the start of the current attention period and a contiguous read watermark. Creating a Task, creating a Claim, explicitly following, or accepting a Human invitation starts Attention.

An Agent can unfollow only when it has no active Claim on the Task. Unfollow ends the current Attention period and discards that period's unread work. A later follow starts at the current Thread tail; abandoned history does not become unread again.

While Attention is active, Messages, Claim changes, and Task accept/close/reopen activities from other Members become ordinary unread facts. A structured mention creates a durable direct marker for its recipient. The sender's own mutation does not become unread for the sender. Follow, unfollow, and read operations are not public Thread facts and do not advance Thread revision.

The first read in an Attention period returns the Task anchor, current Task state, current Claim snapshot, limited recent background, and the bounded unread batch. Background facts are orientation only and are marked as already read. `team_thread.history` is the only tool for paging older Thread facts.

The Human Client opens the Channels workspace by default. Human navigation follows Workspace → Channel → Task → Thread; the Client does not display, enter, or poll a Human Inbox. Opening a Task Thread performs the durable Human Thread read. A bounded read that leaves unread facts exposes an explicit continue-reading action. The current Thread surface shows public revisioned facts, Claims, and runtime risk, but intentionally does not render follow/unfollow buttons or Human-only follow/unfollow observations. History paging never acknowledges new work. Passive change polling acknowledges an arriving batch only while the reader is pinned to the timeline bottom — the facts are rendering in front of them — and otherwise exposes the explicit read action; updates arriving off-screen always wait for that explicit action.

## Structured mentions

Recipients are selected with Member refs. Text such as `@name` has no mention semantics by itself: only Members passed in the `mentions` parameter render as mention chips, and the Client parses the body for those handles case-insensitively with an optional leading `@`. Human bodies always carry their chips inline, and plain-prose Agent bodies do too; rich Markdown Agent bodies fall back to a trailing chip row because inline chips cannot interleave with block-level Markdown rendering. Mentioned names absent from the body also render as a trailing chip row.

A top-level Message may mention Agents directly: mentioned Members start following the new Task Thread and receive the Message. In an existing Thread, an Agent may mention another Agent only when that Agent already follows it; a Member reply that mentions an unfollowed Agent returns `member_not_following`, commits no Message, and issues no confirmation token. A Human reply mentioning an unfollowed Agent goes through the Host-owned one-use confirmation flow before any operation commits. An Agent may mention the Human without making the Human a follower.

## Mutation fences

A public mutation on an existing Thread must use the current `baseRevision`. The Host checks fences in this order:

1. Relevant unread work must be read. Failure returns `unread_required` with the current revision and unread counts.
2. `baseRevision` must match the current Thread revision. Failure returns `stale_revision` with the supplied and current revisions.
3. A closed Task rejects replies, Claims, and new Attention.

These outcomes are normal collaboration results, not infrastructure failures. The Agent can read the Thread, inspect the returned revision, and decide whether to retry without creating a duplicate Message. There is no force-send or unread bypass.

Human close releases active Claims, ends Attention, and stops ordinary delivery. Reopen restores an open Task but does not restore previous Attention periods.

## Human Remote boundary

The Human Client uses `readThread`, `threadHistory`, `threadObservations`, `changeAttention`, and `changes`; it does not call the Host's Human Inbox projection. `threadObservations` is a non-mutating Human-only projection of follow/unfollow Attention transitions for one Thread, while `changeAttention` mutates that durable state. The current Thread UI does not call or render either Attention control/observation path; they remain available for later UI and Agent workflows. The Client stores only navigation mode and Workspace selection locally; unread state, Attention, revisions, and observations remain Host-owned.

## Team Member context boundary

The explicit `team-member` preset is a full coding composition: shell, filesystem and search, web search, background-job controls, skills, todo tracking, compaction, the five Team tools, Workspace instruction discovery, and the private-memory context plugin. The host owns the Web service/provider; the Team preset adds only the model-facing web tool. Ordinary Sessions do not inherit these Team rows.

A Member keeps its project `cwd` at the Workspace path. Harness `agent-instructions` remains the sole loader for `AGENTS.md`/`CLAUDE.md` guidance; Team does not reimplement or relocate that discovery. Each Member's private root contains a lowercase `memory.md` index and on-demand `notes/`. At each safe pre-step, the Member sees at most its own changed index, framed as escaped, typed reference context. The index is bounded at 8 KiB; exceeding the budget produces a maintenance warning rather than silent truncation, deletion, or summarization. Notes are never automatically injected. Suspend/resume preserves the files, and permanent removal deletes the private root.

Memory is not authority: it may be stale and cannot override Workspace instructions, direct Human input, or durable Team facts. Members should record only verified, durable knowledge and must not store credentials, sensitive data, guesses, chat logs, other Members' memory, or facts already owned by the Team ledger.

## Agent notification boundary

The Host derives Agent notifications from durable unread state and injects one bounded, coalesced context message through the Agent public safe-boundary API. An idle Agent starts a turn; a running request or tool receives the context at the next step boundary without interruption. The durable Inbox remains the authority in every case:

- A structured direct mention includes its Message body, sender, Channel, Task, Thread, Message ref, and current revision.
- A Task or Claim Activity includes the actor, transition, affected refs, Task, Thread, and revision. Task close retains a sparse Activity marker for every affected follower before ending Attention, so the terminal state change remains readable after restart.
- Ordinary unread Messages expose only a body-free Task route with unread count and revision. The Agent can call `team_thread.read` directly; `team_inbox` remains available when several Threads require triage.

Automatic context is bounded to eight Inbox Threads, twenty detailed direct or Activity facts, 8 KiB per direct Message body, and 32 KiB overall. Anything omitted remains durable and discoverable through `team_inbox` and `team_thread`. A successful Thread read consumes the relevant direct and Activity markers together with the ordinary read watermark.

Pending hints are coalesced per Member. A consumed or ignored hint does not cause another turn until a later relevant durable change, resume, or runtime-error recovery resets the notification state. Restart and resume call the same durable Inbox check, so transient Session queues are not the authority. This is at-least-once notification intent, not exactly-once model processing: the Agent may ignore, fail, or repeat the Team read operation.

## Assembled acceptance

`npm run test:browser` uses the credential-free Harness Web scaffold to verify the public Client and Host chain. The representative trace begins with an existing Thread, requires Human's second-send confirmation to invite an unfollowed Agent, verifies the Agent's durable Inbox and explicit read/reply, then verifies the Human Channel and Thread state. A page reload reads the same facts from Host projections before the journey leaves Team mode and confirms the ordinary DSH conversation surface is restored.

Browser storage remains limited to navigation and Workspace selection. The acceptance trace does not derive unread, Attention, or Thread facts from local storage or Member Session relay text. Agent safe-boundary wake and the three notification forms—direct mention, Task/Claim Activity, and body-free ordinary route—are covered separately by the real Agent-loop integration tests in `packages/agent-team/tests/member-lifecycle.spec.ts`; browser replay does not depend on live provider behavior.
