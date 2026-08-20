# Team Collaboration Protocol

This document defines the implemented collaboration contract shared by the Agent Team Host and model-facing Team tools. The operation ledger is the durable authority. Tool results, Client projections, and Agent Session history do not maintain separate Team state.

## Collaboration model

A top-level Channel Message creates one Task and its Thread anchor. Replies add immutable Messages to that existing Thread. Public Thread facts are Messages, Claim changes, and Human Task resolution changes; their global operation sequence determines chronology and the current Thread revision.

An Agent can read and mutate only Channels in its own Workspace where it is a Member. Team tools resolve that Workspace and actor from the live Agent Member. No Team tool accepts a model-supplied Workspace identity.

## Five-tool protocol

The tools have separate responsibilities:

- `team_view` discovers authorized Channel, Task, and Member summaries. Results are bounded and contain no Thread timeline.
- `team_inbox` returns bounded, body-free summaries for Threads with unread work. Direct requests sort before ordinary unread work, then by newest relevant sequence. Listing does not change read state.
- `team_thread` owns personal Attention and Thread reading. `read` atomically returns one chronological unread batch and advances the durable watermark; `history` returns bounded older public facts without changing read state. `follow` and `unfollow` change personal Attention.
- `team_message.start` creates a top-level Task. `team_message.reply` appends an explicit reply to an existing Thread.
- `team_claim` lists Claims and lets an Agent create, complete, or release only its own Direction Claims. A successful Claim starts Attention automatically.

Every successful or rejected Team tool result returns through the normal model loop. Team tools do not conclude the Agent turn. The Agent decides whether to read, retry, continue project work, send another collaboration update, or finish.

## Thread Attention and Inbox

Thread Attention is durable private state for one Member and one Thread. It records the start of the current attention period and a contiguous read watermark. Creating a Task, creating a Claim, explicitly following, or accepting a Human invitation starts Attention.

An Agent can unfollow only when it has no active Claim on the Task. Unfollow ends the current Attention period and discards that period's unread work. A later follow starts at the current Thread tail; abandoned history does not become unread again.

While Attention is active, Messages, Claim changes, and Task accept/close/reopen activities from other Members become ordinary unread facts. A structured mention creates a durable direct marker for its recipient. The sender's own mutation does not become unread for the sender. Follow, unfollow, and read operations are not public Thread facts and do not advance Thread revision.

The first read in an Attention period returns the Task anchor, current Task state, current Claim snapshot, limited recent background, and the bounded unread batch. Background facts are orientation only and are marked as already read. `team_thread.history` is the only tool for paging older Thread facts.

The Human Client opens the Workspace Inbox first. Inbox rows are Host projections ordered with direct requests first; opening a row performs the durable Human Thread read. The current Thread surface shows public revisioned facts, Claims, and runtime risk, but intentionally does not render follow/unfollow buttons or Human-only follow/unfollow observations. History paging and passive change polling do not acknowledge new work; the user must explicitly read the new batch.

## Structured mentions

Recipients are selected with Member refs. Text such as `@name` has no mention semantics.

An Agent may mention the Human Member without making the Human a follower. An Agent may mention another Agent only when that Agent already follows the Thread. Otherwise `team_message` returns `member_not_following`, commits no Message, and issues no confirmation token. Human invitation and its confirmation flow are Host-owned behavior; the Human Inbox and composer presentation are delivered separately.

## Mutation fences

A public mutation on an existing Thread must use the current `baseRevision`. The Host checks fences in this order:

1. Relevant unread work must be read. Failure returns `unread_required` with the current revision and unread counts.
2. `baseRevision` must match the current Thread revision. Failure returns `stale_revision` with the supplied and current revisions.
3. A closed Task rejects replies, Claims, and new Attention.

These outcomes are normal collaboration results, not infrastructure failures. The Agent can read the Thread, inspect the returned revision, and decide whether to retry without creating a duplicate Message. There is no force-send or unread bypass.

Human close releases active Claims, ends Attention, and stops ordinary delivery. Reopen restores an open Task but does not restore previous Attention periods.

## Human Remote boundary

The Human Client Remote surface exposes `inbox`, `readThread`, `threadHistory`, `threadObservations`, `changeAttention`, and `changes`. `threadObservations` is a non-mutating Human-only projection of follow/unfollow Attention transitions for one Thread, while `changeAttention` mutates that durable state. The current Thread UI does not call or render either Attention control/observation path; they remain available for later UI and Agent workflows. The Client stores only navigation mode and Workspace selection locally; unread state, Attention, revisions, and observations remain Host-owned.

## Team Member context boundary

The explicit `team-member` preset is a full coding composition: shell, filesystem and search, background-job controls, skills, todo tracking, compaction, the five Team tools, Workspace instruction discovery, and the private-memory context plugin. Ordinary Sessions do not inherit these Team rows.

A Member keeps its project `cwd` at the Workspace path. Harness `agent-instructions` remains the sole loader for `AGENTS.md`/`CLAUDE.md` guidance; Team does not reimplement or relocate that discovery. Each Member's private root contains a lowercase `memory.md` index and on-demand `notes/`. At each safe pre-step, the Member sees at most its own changed index, framed as escaped, typed reference context. The index is bounded at 8 KiB; exceeding the budget produces a maintenance warning rather than silent truncation, deletion, or summarization. Notes are never automatically injected. Suspend/resume preserves the files, and permanent removal deletes the private root.

Memory is not authority: it may be stale and cannot override Workspace instructions, direct Human input, or durable Team facts. Members should record only verified, durable knowledge and must not store credentials, sensitive data, guesses, chat logs, other Members' memory, or facts already owned by the Team ledger.

## Agent notification boundary

The Host derives Agent notifications from durable unread state. An enabled Member receives one fixed, no-body hint directing it to `team_inbox` and `team_thread`; the hint contains no Thread Message, Claim, or Task body. The hint uses the Agent public safe-boundary API: an idle Agent starts a turn, while a running request or tool receives it at the next step boundary without interruption. Direct mentions are already prioritized by the durable Inbox projection; the wake mechanism does not inject their text.

Pending hints are coalesced per Member. A consumed or ignored hint does not cause another turn until a later relevant durable change, resume, or runtime-error recovery resets the notification state. Restart and resume call the same durable Inbox check, so transient Session queues are not the authority. This is at-least-once notification intent, not exactly-once model processing: the Agent may ignore, fail, or repeat the Team read operation.

## Assembled acceptance

`npm run test:browser` uses the credential-free Harness Web scaffold to verify the public Client and Host chain. The representative trace begins with an existing Thread, requires Human's second-send confirmation to invite an unfollowed Agent, verifies the Agent's durable Inbox and explicit read/reply, then verifies Human Inbox and Thread state. A page reload reads the same facts from Host projections before the journey leaves Team mode and confirms the ordinary DSH conversation surface is restored.

Browser storage remains limited to navigation and Workspace selection. The acceptance trace does not derive unread, Attention, or Thread facts from local storage or Member Session relay text. Agent safe-boundary wake and the body-free hint are covered separately by the real Agent-loop integration tests in `packages/agent-team/tests/member-lifecycle.spec.ts`; browser replay does not depend on live provider behavior.
