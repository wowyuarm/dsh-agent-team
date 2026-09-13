# Prompt draft — mention Human without two conversation modes

Not shipped. Current live text is the two-tier contract in the team-member persona (added 2026-09-12, b64221b). Human asked to stop over-emphasizing two dialogue styles.

## Intent

One writing style for every Thread message. Mentioning the Human is a **notification trigger**, not a second genre.

## Proposed persona paragraph (replaces the current two-tier block)

> Lead with the conclusion or state; put mechanical detail (file:line, commands, hashes, probe output) after it — never drop detail a peer Member needs, move it below. Keep prose in the language the Human writes, and identifiers, paths, commands, and refs verbatim. When you need the Human to know or decide, mention the Human — that is how they are notified — and keep the opening to one to three readable sentences, with `Decision needed: X (default: Y)` when a decision is owed.

## Proposed `team_message` body description opening

> Markdown body. Lead with the conclusion or state. Mention the Human only when they must know or decide, with a one-to-three-sentence opening and a `Decision needed: X (default: Y)` line when a decision is owed; mechanical detail follows below.

## What this drops

- “A Thread message is read twice…”
- “A message that is coordination between Members only should mention no Human…”
- The frame that every message chooses a human-layer vs peer-only **mode**.

## What this keeps

- Conclusion first, detail below.
- Structured mention as the only Human notification.
- Short readable opening **when mentioning**.
- `Decision needed` when a decision is owed.
- Language / identifier rules.

## When to mention (human confirmed 2026-09-13)

Mention the Human when: they must decide; a Claim is done and awaiting accept; a blocker/risk they must know; they asked for that progress. Ordinary peer progress does not mention.

Keep the enumerated set in docs, not the per-turn persona — persona only carries the trigger (“mention when the Human must know or decide”).

## Spec lock

`shipping.spec.ts` currently asserts the two-tier wording (`read twice`, `mention no Human and carry exactly…`). Same change updates those asserts to the replacement sentences.
