# Agent Team context self-management — confirmed specification

Status: confirmed for implementation by Human
Task: task:e1f642bb-b6f8-4bd8-a0cd-b147b9411bba
Implementation owner: Tars (after Claim)
Design/review owner: Reeve

This file is an implementation snapshot, not current product authority. Production code, tests, package README, and maintained `docs/` become authoritative only after delivery.

## Goal

One durable Team Member manages a succession of private model-working contexts without Human Session administration:

```text
model-controlled fresh continuation       new_context(handoff)
model-controlled return to an old anchor  new_context(handoff, checkpointRef)
host safety fallback                      context >= hard limit -> compaction
```

The Member identity, Team ledger facts, private memory, Claims, Attention, and filesystem remain continuous. Previous Session logs are archived, never deleted by rollover.

## Product budget

```text
effectiveHardLimit = min(256_000, routeContextWindow - safeOutputReserve)
effectiveHandoffAt = min(200_000, effectiveHardLimit - handoffReserve)
```

- `>= effectiveHandoffAt`: one pressure notice per context generation. The model should normally call fresh `new_context`.
- `>= effectiveHardLimit`: no unprotected model request. The Host forces CompactionEngine recovery in the current Session.
- Provider `CONTEXT_WINDOW_EXCEEDED` before the estimate reaches the hard line uses the same recovery implementation and one bounded retry.
- `compaction-basic.auto` is disabled. Agent Team owns both policy entry points while reusing the public CompactionEngine implementation.

## Model-facing interface

Exactly three new Team-member-only tools:

```ts
context_checkpoint({ name: string })
  -> { checkpointRef: string, name: string }

context_timeline({ limit?: number })
  -> {
    usageTokens: number
    hardLimit: number
    handoffAt: number
    items: Array<{
      checkpointRef: string
      name: string
      source: 'agent' | 'team-boundary' | 'handoff' | 'compaction' | 'head'
      retainedTokens: number
      discardedTokens: number
      affectedThreads: string[]
      restorable: boolean
      reason?: string
    }>
  }

new_context({
  handoff: string
  checkpointRef?: string
  relatedFiles?: Array<{ path: string; reason: string }>
})
  -> { mode: 'fresh' | 'from-checkpoint', status: 'scheduled' }
```

There is no model-facing `context_compact` or separate checkout tool. `new_context` is the sole context-generation mutation; the optional checkpoint controls its seed.

Tool names and guidance exist only in the explicit Team Member preset. Ordinary Sessions must not acquire them.

## Context checkpoint

A Context Checkpoint is a private, opaque, restorable reference to a completed-turn prefix in one Member context lineage. It is not a Team ledger entity and never means filesystem or external-state rollback.

### Sources

A timeline candidate becomes restorable only after it maps to a completed `turn/end`:

1. A successful model call to `context_checkpoint`.
2. Team semantic facts that actually entered this Member's model context:
   - successful `team_claim` claim/done/release transitions in the Session;
   - structured Team notification delivery for mention, claim transition, Task accept, or related state change.
3. Handoff and compaction boundaries.
4. The latest completed head.

A raw Team ledger sequence is never used as a Session fork boundary. A durable Team fact that was never delivered or consumed by this Member does not create a conversation checkpoint.

### Explicit checkpoint turn semantics

A successful `context_checkpoint` result concludes the current turn. A Host-generated quiet follow-up continues work in the next turn. The checkpoint reference resolves to the completed `turn/end` containing the tool result. Failed or dangling calls produce no checkpoint.

The follow-up is scheduled only after the successful tool result is durably appended. Replay repairs a crash between that result and the follow-up without duplicating an already delivered follow-up.

### Selection

`context_timeline` returns a bounded structural list, not transcript content. The model selects an opaque `checkpointRef`, normally the smallest sufficient working set. It must expose estimated retained/discarded tokens and affected active Threads.

A return is rejected when the checkpoint:

- is unresolved, stale, outside the Member lineage, or no longer has a valid completed-turn prefix;
- would retain a context at or above the handoff budget and therefore does not materially shrink the working set;
- might cross context belonging to another active Claim/Thread. V1 must reject when it cannot prove single-Thread coverage; with multiple active Claims, prefer a fresh handoff covering all of them;
- has any non-terminal or terminal-but-unreported background job whose ownership/output cannot survive generation replacement.

Use a fresh handoff instead when those guards reject a return.

## New context modes

### Fresh

- New empty Session generation.
- `parentSession` points to the previous active Session.
- First model-facing message is the model-authored handoff with a verifiable Host envelope.
- Previous active Session is disposed and archived.

### From checkpoint

- New seeded Session containing the exact balanced completed-turn prefix through the checkpoint.
- `parentSession` points to the actual seed source Session, which may be an archived ancestor.
- The rollover operation separately records the previous active Session so Client continuity and audit do not confuse it with seed lineage.
- First own model-facing message is the handoff describing useful later discoveries and all external side effects.
- Previous active Session is disposed and archived. The seed source remains preserved.

Returning to a checkpoint is intentionally more expensive than fresh rollover because it retains raw prefix events. It is for discarding a bad/noisy later branch, not the default pressure path. V1 has no arbitrary-message checkout, sibling-branch navigation, or return-to-future feature.

## Handoff contract

The tool accepts one prose string rather than a large structured schema. Guidance requires it to cover:

1. current objective and every active Thread/Claim;
2. verified facts and evidence;
3. inferences and unresolved conflicts;
4. current external side effects and verification state;
5. one explicit next step.

The Host does not rewrite model prose. It adds only verifiable envelope fields such as previous/new Session IDs, trigger, tool-result sequence, and checkpoint reference. The first message uses a custom `agent-team-context-handoff` source, `form: 'snapshot'`, version 1.

Context actions never revert files, Git state, running processes, browser state, Team facts, tickets, databases, or remote calls.

## Durable authority and permission

Add `team/member-session-rolled-over`.

- Actor: the calling Member.
- Authorization: actor Member ID equals the target Member, the calling Agent is the currently bound live generation, and the durable previous Session binding still matches at commit.
- Stable request and new Session identity derive from the successful tool call for idempotent replay.
- Ledger data contains Member projection, previous active Session ID, new Session ID, seed source/through-sequence when applicable, successful handoff tool-result sequence, checkpoint reference when applicable, and trigger. It does not contain private handoff prose.
- The Host is executor, not a synthetic business actor.

The 256K path compacts rather than creating a handoff-less Session, so V1 needs no Host/system actor.

## Rollover ordering

```text
successful new_context tool/result
  -> conclude current turn
  -> admission gate captures/holds later inbox work
  -> completed turn + idle
  -> snapshot/revalidate source and guards
  -> commit member-session-rolled-over operation
  -> dispose previous Agent
  -> archive previous active Session
  -> create/activate new Agent generation
  -> deliver handoff first
  -> rederive Team Inbox from ledger; preserve non-Team queued input exactly
```

A successful tool call is durable pending intent. Restart replays it; IDs and operation idempotency make completion safe to retry.

## Prompt

Use short static guidance in the Team Member preset plus two dynamic notices:

- Static: working-set principle, semantic trigger guidance, tool choice, no external rollback, and no context switch merely while awaiting review.
- One-shot pressure notice: current/effective limits, active Claims, running jobs, fresh-by-default recommendation.
- First-generation handoff snapshot: model prose plus Host envelope.

Do not ship a large context-management skill in V1.

## Product continuity

- One Member row remains visible; Session generations are infrastructure.
- While rollover is pending, presence remains working/organizing rather than flashing available.
- If the current page is the previous active Session, Client follows the new Session automatically.
- If the Human is browsing an older archived Session, Client does not redirect.
- Previous Session remains inspectable.
- Rollover failure preserves the old log and exposes a recoverable error.
- Remove the visible “从全新上下文开始” row action. Keep Recover/Restart for broken Members. A Host clear-context remote may remain temporarily as a hidden migration escape hatch, not as a product workflow.

## Explicit non-goals

- No changes to the DeepSeek Harness checkout or shipped defaults.
- No full Session-tree UI.
- No arbitrary message-node checkout or return-to-future navigation.
- No new Harness `ContextForm`.
- No handoff prose in Team Threads or the Team ledger.
- No parallel checkpoint database.
- No global Session-query model tools.
