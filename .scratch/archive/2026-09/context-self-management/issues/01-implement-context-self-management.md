# 01 — Fresh context continuation

**What to build:** A Team Member can call `new_context` with a private handoff, finish its current turn, and continue automatically as the same Member in a fresh context. The old Session is archived, the live Client follows once, and no manual “从全新上下文开始” action remains.
**Blocked by:** None — can start immediately
**Status:** complete

Implementation Claim: claim:15c18a41-79f6-4a23-a503-5bb0d04704b0
Review Claim: claim:bedcdc11-8c97-4dc4-88f4-8682b311a94a
Confirmed design: [`../spec.md`](../spec.md)

## Product demonstration

Starting from a live Team Member conversation:

1. The model calls `new_context({ handoff })` without a checkpoint.
2. All tool calls in that model step settle; the turn closes.
3. The Host switches the Member to a fresh context and archives the previous Session.
4. The new context receives the handoff first and continues without Human input.
5. If the Human was viewing that live Member context, the Client follows to the new one exactly once. An older archive view does not move.

## Required behavior

- [x] Add `new_context` only to the explicit Team Member tool set; an ordinary Session never receives it.
- [x] Keep the tool a thin adapter: validate bounded handoff/related-file input, return `status: 'scheduled'`, call `concludeTurn()`, and perform no lifecycle or inbox side effect in the tool body.
- [x] React only after the successful `tool/result` is durably appended. Failed, dangling, malformed, or inherited historical calls never schedule a transition.
- [x] Add an idempotent `team/member-session-rolled-over` operation. Its actor is the calling Member, authorized only for itself and its currently bound live Session.
- [x] Record previous active Session, new Session, successful handoff result sequence, and trigger without putting private handoff prose in the Team ledger.
- [x] Derive the request and new Session identity stably from the successful tool call; replay converges on one operation and one generation.
- [x] Reuse one internal Member-lifecycle implementation rather than copying `clearMemberContext` ordering.
- [x] Wait for the containing completed turn and true idle before the swap. Sibling tool calls must settle in model order.
- [x] Gate later input from opening another old-generation model request. Preserve non-Team input; discard and rederive stale Team Inbox notices after activation.
- [x] Create a genuinely fresh Session: do not seed/copy the previous context. Set lineage parent to the previous active Session.
- [x] Use a custom `agent-team-context-handoff` source with existing `snapshot` form and version 1. Deliver model prose plus verifiable Host envelope as the first model-facing context.
- [x] Preserve Member identity, state, model selection, private memory, skills, Claims, Attention, and Team Inbox authority.
- [x] Dispose the old Agent and archive its Session; never delete the previous log.
- [x] Keep one visible Member row and continuous working presence through rollover. Failure leaves a recoverable status and preserved old log.
- [x] In the mounted Agents panel, observe the same Member's old→new Session binding. Follow only when the current page equals that observed old live ID; do not add a Remote continuity field unless a discriminating test proves it necessary.
- [x] Remove the visible clear-context menu item, confirmation UI, local state, translations, and consumed Client prop chain. Recover/Restart remain the broken-Member path.
- [x] Add concise static context guidance to the Team Member preset. Do not ship a large skill.

## Authority and lifecycle invariants

- Team ledger owns only the current Member→Session binding and rollover audit.
- The old Session log owns the successful private intent/handoff text.
- Process state contains locks/promises only and must be reconstructible.
- The Host is executor, not a synthetic Human/system actor.
- No side effect may outrun successful `tool/result` durability.
- A failed transition must not leave two live Agents for one Member or zero recoverable Session bindings.

## Discriminating verification

- [x] Ledger validation rejects another Member, a stale previous binding, and an idempotency-key replay with different data; an exact retry returns the original receipt.
- [x] A scripted step containing `new_context` plus sibling calls proves all results commit before rollover.
- [x] A tool execute/render/result failure proves no operation, new Session, archive, or continuation occurs.
- [x] Fresh mode proves the new Session does not inherit old event/chunk history.
- [x] The handoff is the first model-facing context and has the expected custom source/envelope.
- [x] Old Session archives; private memory, Claims, Attention, and unread Team work survive.
- [x] Later direct input is delivered once in the new generation; stale Team notices are regenerated from current ledger state.
- [x] Client test proves one live old→new follow and no redirect for a nonmatching archived ID.
- [x] Component/browser test proves the clear-context action is absent and ordinary DSH navigation still restores.
- [x] Targeted Host/tool/Client tests, typecheck, build, lint, and `git diff --check` pass for this slice. Because visible Client behavior changes, final ticket 04 will also run the full browser journey at desktop and 390×844.

## Out of scope for this ticket

Checkpoint creation/selection/seeded return belongs to ticket 02. Automatic 200K/256K policy belongs to ticket 03. Exhaustive crash-cut and job hardening belongs to ticket 04; this ticket still must establish the durable ordering and one happy-path replay needed by those later slices.
