# 09 — Ship the M1 Runnable Composition

**What to build:** A user can opt into one documented M1 composition, create two Agent Members, collaborate through the complete Team workflow, restart the Host, and observe the same durable outcome through commands and model tools.

**Blocked by:** 01 — Boot an empty Agent Team; 02 — Create a Channel and Human Task; 03 — Provision and Control an Agent Member; 04 — Mention an Agent and Prove Inbox Admission; 05 — Collaborate Through Claims and Thread Replies; 06 — Control Attention With Follow and Confirmation; 07 — Complete, Reopen, and Remove Work; 08 — Recover Every Durable Failure Window.

**Status:** completed

- [x] One opt-in composition mounts the Team Host capability, human command adapter, explicitly team-enabled member preset, four model tools, compaction isolate, persistence, and invariants.
- [x] The complete human journey creates a Channel and two Members, sends and mentions, claims two Directions, replies, follows/unfollows, accepts or reopens, suspends/resumes, and removes a Member.
- [x] A keyless REAL-composition scenario proves the same workflow through the actual Loader, Agent, Session, command, tool, and persistence paths.
- [x] Keyless snapshots pin the four tool schemas and renders, Team guidance, member relay source, Host Activity source, and representative `/team` output.
- [x] Restart during the scenario preserves operation receipts, refs, Thread revisions, Claims, Task state, Follow state, Member lifecycle, and Delivery evidence.
- [x] Package READMEs, subsystem documentation, Agent Note, config catalog inputs, and Model Experience sections describe the shipped current behavior and limitations.
- [x] Focused test, typecheck, build, hygiene, documentation, snapshot, persistence, and REAL-composition checks selected by the repository pre-push policy pass.
- [x] M1 remains opt-in and does not add Team tools or guidance to unrelated shipped presets.

Implementation note: the npm bundle ships the Host patch plus `agent-presets/team-member/agent.cordis.yml`. The Host patch never registers model tools; only the explicitly selected preset contributes Team guidance, four tools, and its isolated compaction service. `prepack` builds all three package entrypoints and declarations before npm assembles the tarball.
