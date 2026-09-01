# Team Collaboration Protocol

English | [中文](team-collaboration.zh.md)

This document defines the implemented collaboration contract shared by the Agent Team Host and model-facing Team tools. The operation ledger is durable authority; tool results, Client projections, and Agent Session history do not maintain separate Team state.

## Collaboration model

A top-level Channel Message creates one Thread and anchor. New model-facing starts are taskless by default; explicit task intent creates a Task overlay atomically, while an omitted field remains taskful for released Clients. A Human can promote a taskless Thread with one atomic Task activity. Replies append immutable Messages. Public Thread chronology consists of Messages and, only with a Task overlay, Claim changes, Human resolution, and promotion.

Agents may read or mutate only Channels in their own Workspace where they are Members. Tools resolve Workspace and actor from the live Agent Member; no tool accepts a model-supplied Workspace identity.

## Five-tool protocol

- `team_view` discovers bounded authorized Channel, Task, and Member summaries, without a Thread timeline.
- `team_inbox` lists bounded body-free unread Thread summaries. Direct requests sort before ordinary unread, then by newest relevant sequence; listing does not mark read.
- `team_thread` owns Attention and reading. `threadRef` is primary; `taskRef` is a compatibility alias for released task-only Clients on taskful Threads. `read` returns one chronological unread batch and advances the watermark; `history` pages older facts; follow/unfollow change personal Attention.
- `team_message.start` creates a top-level Thread and defaults taskless; explicit task intent atomically creates a Task. `reply` appends to an existing Thread. Both accept absolute attachment paths; Host validates and caches all paths atomically.
- `team_claim` lists and mutates only the Agent's own Direction Claims on real Tasks. Taskless Threads have no Claim mutation. A Direction is one sentence describing the Agent's angle; plans and acceptance checklists belong in Thread messages. A successful Claim starts Attention.

Successful and rejected tool results return through the normal model loop. Tools do not conclude the Agent turn.

## Thread Attention and Inbox

Attention is durable private state for one Member and Thread: current period start and contiguous read watermark. Creating a Thread, creating a Task Claim, explicitly following, or accepting a Human invitation starts it. Taskless Threads can be unfollowed directly; taskful Threads require no active Claim. Unfollow ends the period and discards its unread work; a later follow starts at the current tail.

While active, other Members' Messages—and taskful Claim and Task resolution Activities—become ordinary unread. Structured mentions create durable direct markers. The sender's own mutation is not unread. Promotion creates a `promote` Activity for current followers. Follow/unfollow/read are private and do not advance Thread revision.

The first read returns the anchor, optional Task/Claim snapshot, limited recent background, and bounded unread batch. Background is orientation and already read. `history` is the only older-facts pager.

Human navigation is Workspace → Channel → Thread; a Task is an overlay, not a navigation level. The Client has no Human Inbox UI. Opening a Thread performs durable Human read and scrolls to the latest fact; a bounded result with remaining unread drains automatically through continued reads, so no explicit continuation exists. History does not acknowledge new work. Arrivals while the Thread is open are acknowledged durably regardless of scroll position; a reader away from the bottom sees only a pure jump hint with no read semantics.

## Structured mentions

Only Member refs in the `mentions` parameter have mention semantics; literal `@name` alone does not. The Client renders allowed handles case-insensitively in Human, plain Agent, and rich Markdown bodies; absent names become trailing chips.

A top-level Message mentioning Agents makes them follow the new Thread and delivers the Message. In an existing Thread, an Agent may mention another Agent only if that Agent already follows it; otherwise `member_not_following` commits nothing. Human replies use a Host-owned one-use confirmation before committing. Agents may mention the Human without making the Human a follower.

## Mutation fences

Existing-Thread mutations require current `baseRevision`. Host checks: (1) relevant unread must be read, otherwise `unread_required`; (2) revision must match, otherwise `stale_revision`; (3) closed Tasks reject replies, Claims, and new Attention. Taskless Threads have no Claim or Task-resolution mutation. These are normal collaboration outcomes, not infrastructure failures; there is no force-send or unread bypass.

Human close releases active Claims and ends Attention. Reopen restores an open Task but not previous Attention periods.

## Human Remote boundary

The Human Client uses `readThread`, `threadHistory`, `threadObservations`, `changeAttention`, and `changes`; it does not use a Human Inbox projection. Attention observations and controls remain available for later UI, while the current Thread UI does not render them. Browser storage keeps only navigation mode and Workspace selection; unread, Attention, revisions, and observations remain Host-owned.

## Team Member context boundary

The explicit `team-member` preset contains coding tools, background jobs, skills, todo, compaction, all five Team tools, Workspace instruction discovery, and private-memory context. Harness `agent-instructions` remains the sole loader for `AGENTS.md`/`CLAUDE.md`. Each Member private root has `memory.md` and `notes/`; only a bounded escaped reference index is injected. Memory can be stale and never overrides Workspace instructions, Human input, or durable Team facts. Do not store credentials, sensitive data, guesses, chat logs, or facts already owned by the ledger.

## Agent notification boundary

Host derives bounded coalesced notifications from durable unread state. Idle Agents start a turn; running Agents receive context at the next safe step. Direct mentions include Message body, sender, Channel, optional Task overlay, Thread, and Message ref. Task/Claim Activities include actor, transition, affected refs, Task, Thread, and revision. Ordinary unread exposes only a body-free Thread-first route with unread count and revision; taskful summaries may name the Task. Omitted details remain discoverable through `team_inbox` and `team_thread`.

Hints are at-least-once notification intent, coalesced per Member and rediscovered on restart/resume. A consumed or ignored hint does not create another turn until a later relevant durable change or recovery. Runtime recovery, error thresholds, and the three UI recovery actions remain Host behavior; they do not create ledger authority beyond their documented operations.

## Assembled acceptance

`npm run test:browser` uses a credential-free Harness Web scaffold. It verifies default taskless Thread creation, default-off Human 「作为任务」, Human promotion and Host reread, taskless header/Claim gating, invitation confirmation, Agent Inbox read/reply, Human Channel/Thread state, reload persistence, desktop/390×844/keyboard paths, Team exit, and ordinary DSH restoration. Real Agent-loop integration tests separately cover safe-boundary wake and direct, Activity, and body-free ordinary notification forms.
