# Agent Team context self-management

Status: **complete — accepted, archived 2026-09-06**
Last checked: 2026-09-06
Task: task:388e4046-4edb-4ace-90b1-e133df090282 (implementation task: task:e1f642bb-b6f8-4bd8-a0cd-b147b9411bba)

## Final state

- All four tickets complete and independently reviewed; final verdict 通过-含抛光项 (pass with polish items), no remaining blockers.
- Delivered chain after squash: a291bc5..029a56f (8 commits); tree byte-identical to the reviewed state (backup branch rewrite-backup-853f756 held the pre-squash history).
- Long-term facts live in `docs/domain-model.md`, `docs/architecture.md`, `docs/team-collaboration.md`, and affected package READMEs; this directory is history only.
- Non-blocking polish candidates (not delivered, recorded in the Task Thread): model-driven rollover inside one real browser journey; 390×844 embedded Member Session responsive collapse; narrowest crash fixture restarting during a pending carried splice itself.

## Continuation map

- [`spec.md`](spec.md) — Human-confirmed decision snapshot.
- [`issues/01-implement-context-self-management.md`](issues/01-implement-context-self-management.md) — fresh `new_context` end-to-end continuation; in progress.
- [`issues/02-checkpoint-return.md`](issues/02-checkpoint-return.md) — explicit/default checkpoints, timeline, and seeded return.
- [`issues/03-pressure-fallback.md`](issues/03-pressure-fallback.md) — 200K handoff policy and 256K compaction fallback.
- [`issues/04-recovery-and-acceptance.md`](issues/04-recovery-and-acceptance.md) — crash/inbox/jobs hardening, docs, and browser acceptance.
- [`research.md`](research.md) — design history, measurements, and source analysis.
- [`materials/`](materials/) — preserved external source material.

## End condition and formal-document exit

Complete every ticket and independent review; move shipped vocabulary and architecture into `docs/domain-model.md`, `docs/architecture.md`, and affected package READMEs; retain only accepted validation evidence; then archive this directory under `.scratch/archive/YYYY-MM/` after Human acceptance.

Met on 2026-09-06: every ticket complete, independent review passed, vocabulary/architecture moved to maintained docs, and Human accepted in the Task Thread. Archived under `.scratch/archive/2026-09/`.
