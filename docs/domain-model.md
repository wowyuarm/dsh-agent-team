# dsh-agent-team Domain Vocabulary

English | [中文](domain-model.zh.md)

## Agent Team

The single shared collaboration domain in one DSH home. It stores cross-member collaboration facts, not model context, session transcripts, or private memory.

## Member

A stable identity authorized to read, speak, claim work, and receive Inbox hints. A Member is identified by an immutable branded ref and bound to a Workspace. The first release has Human and Agent Members.

## Human Member

The special Member corresponding to the current Harness user. It participates in Messages, Claims, and Activities and can manage Channels, Members, acceptance, and Task terminal state.

## Agent Member

A Member created and managed by Team. It is bound to one DSH Session, explicit team-enabled preset, and Workspace; ordinary Sessions and forks do not gain membership automatically.

## Member Capabilities

Durable capability intent on the Member entity (optional `capabilities` field: `tools.allow` and `skills.allow`), carried verbatim through every lifecycle operation and restored by Host restart replay. Pure intent: allow-list names are not validated against any known-name set at commit time — a Harness upgrade that renames or removes tools can never make an old ledger unreplayable; divergence from the names known at activation is derived as a runtime warning (`capabilityWarnings`, a projection-derived state, never persisted — persisted warnings would lie after Host restart or upgrades). `tools.allow` is a deliberate interface reservation (no UI write path) that future Runtime Revision manifest orchestration depends on; do not remove during cleanup.

## Workspace

A project and shared working directory. An Agent Member's Session cwd is the Workspace project directory; private memory lives outside the project root.

## Channel

A persistent collaboration place in a Workspace. An Agent must explicitly join to read, speak, claim, or follow; Human Members can manage and view every Workspace Channel.

## Message

Immutable content explicitly sent in a Channel or existing Thread. Every top-level Channel Message atomically creates a Thread; new Clients/tools default to a taskless Thread, while explicit 「作为任务」 creates a real Task in the same commit. A reply continues an existing Thread.

## Task

An optional work-tracking overlay attached to an existing Thread, not a prerequisite for a Thread. It can be created by explicit top-level task intent or added by Human promotion. Promotion also appends a public explanation Message. Task status is derived from Claims; Human acceptance and close are explicit facts. Human-facing `Task #N` is the durable Task creation ordinal within its home Channel: taskful starts and promotions participate, while a taskless anchor's original position does not. It is not identity; stable cross-channel references use branded `taskRef`.

## Thread

An independent, single-level public collaboration aggregate inside a Channel. It always has `threadRef`, an anchor Message, and a revision, but may have no Task. Public Messages increment revision; Taskful Claim and resolution changes do too. Existing-Thread writes require current revision. A taskless Thread still supports replies, follows, structured mentions, Inbox, reads, and history, but has no Claims, Task status, or resolution controls. Collaboration uses `threadRef` first; a released task-only Client may use `taskRef` as a Host compatibility alias only for taskful Threads, while Task/Claim operations use `taskRef` identity. Revision is an internal concurrency token, not citable message content.

## Claim

A Member's commitment to one Direction in a Task overlay. Taskless Threads have no Claims. States are active, done, and released; after normalization, one Task has at most one active Claim for the same Direction. Multiple Claims intentionally allow different text that may describe duplicate work.

## Direction

Free-text work direction for a Claim. Comparisons apply Unicode normalization, trim, whitespace compression, and case folding; synonyms are not inferred.

## Thread Attention

A private persistent attention period for one Member and Thread. It records follow state, start position, and contiguous read watermark and is not public revision. Creating a Thread, a successful Claim, explicit follow, or Human invitation starts Attention. Taskless Threads may be unfollowed directly; taskful Threads require no active Claim. Unfollow ends the period and abandons its unread work; following later starts at the current tail.

## Thread Inbox

Member-level unread projection derived from Thread Attention and direct mentions. Ordinary Messages, Claim changes, and Task resolution changes become ordinary unread for current followers; structured mentions create direct unread. `team_inbox` summarizes across Threads; `team_thread.read` returns one batch and advances the watermark; `history` only looks back. Host owns Inbox; it is not a Session queue, browser state, or per-message read table. Human Web has no Inbox page and opens Threads from Channels.

## Follow

An operation on Thread Attention, not an independent subscription object. Follow controls whether ordinary updates create Inbox work and does not revoke Channel visibility.

## Activity

A recorded collaboration-state fact. Claim create/done/release, Task accept/close/reopen, and promotion are public revisioned Thread facts; follow/unfollow and read watermarks are private Attention audit facts. Runtime errors may be current Human UI risk but are not ledger Activity or Inbox facts.

## Inbox Hint

A safe-boundary hint derived from durable Thread Inbox state. A hint is bounded and may wake an idle Agent or arrive at a running Agent's next safe step; it does not mean the model read, handled, replied to, or accepted anything. Durable Inbox is rediscovered after resume.

## Operation

One immutable atomic business commit in the Team ledger. Each operation has global sequence, stable operation ID, idempotent request ID, actor, and one business fact.

## Revision

The sequence of the latest operation relevant to a Thread. It is an optimistic concurrency fence, not a Message count.

## Ref

A restart-stable, typed identifier that callers cannot safely construct by concatenation. Member, Channel, Task, Thread, Message, Claim, and Operation use distinct branded refs. Attention is identified by Member plus Thread.

## Team DM

A possible future private Place with its own participants, visibility, Messages, Threads, Attention, and Inbox. M2 does not implement DM; the authority and notification design remains separate.

## Runtime Presence

An in-process availability projection, not a ledger fact: available (live idle), working (loop running), error (current loop/tool failure), and unavailable (no usable handle or lifecycle/setup/resume block). It is separate from Claim state.

## Suspend

Temporarily stop a Member's live Agent while retaining identity, Session, Claims, Attention, unread state, and private memory. Resume uses the same Session and durable unread to decide whether to hint Inbox.

## Remove

Irreversibly deactivate an Agent Member: release active Claims, end Attention, delete private memory, and archive its Session. Historical Messages, Activities, and identity snapshots remain.
