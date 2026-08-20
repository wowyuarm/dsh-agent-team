# 05 — Equip Team Members for Work and Private Memory

**What to build:** Turn the isolated Team Member preset into a full coding Agent configuration with stable Team collaboration guidance, Workspace instructions and a bounded private memory index.

**Blocked by:** 02 — Make Agent Thread Collaboration Pull-Based.

**Status:** complete

- [x] A Team Member has the project-working capabilities needed to inspect, edit, search, run commands, manage background work, use skills, track work and validate results alongside Team tools.
- [x] Ordinary Sessions remain free of Team tools, Team prompt sections and Member private-memory context.
- [x] Stable Team guidance explains top-level Task creation, Thread reply, structured mention, Inbox triage, Claim discipline, unread/revision recovery and the fact that tool results return to the model loop.
- [x] Existing Harness Workspace instruction discovery continues to load relevant project guidance for a Member’s Workspace cwd without Team reimplementing it.
- [x] Each Member receives only its own private lowercase `memory.md` as bounded, escaped, typed context; two Members cannot receive each other’s index through normal composition.
- [x] `notes/` remains on-demand material accessed through normal filesystem tools and is never automatically injected in full.
- [x] An over-budget memory index produces an explicit maintenance warning rather than silent truncation, deletion or automatic summarization.
- [x] New Members receive a concise memory template; suspend/resume preserves private memory and permanent removal deletes it.
- [x] Recovery and compaction replace stale private-memory context safely without repeated duplicate injection.
- [x] `docs/team-collaboration.md` 的 Team Member context 部分、`docs/architecture.md` 的 preset 边界、Host package README（英文与中文）和 preset guidance 在实际验证后记录最终 context order、memory 边界与支持的 Member 能力。
