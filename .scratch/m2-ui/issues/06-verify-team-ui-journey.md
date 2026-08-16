# 06 — Verify the Complete Team UI Journey

**What to build:** A product reviewer can run the opt-in bundle in real DSH Web, complete the first M2 collaboration journey and verify that leaving or unloading Team restores the ordinary DSH experience unchanged.

**Blocked by:** 01 — Enter and Leave Team Mode; 02 — Browse Agent Members and Runtime Presence; 03 — Create Channels and Manage Membership; 04 — Collaborate in a Channel; 05 — Collaborate in a Task Thread.

**Status:** ready-for-agent

- [ ] One documented opt-in composition mounts the Host, Team preset/tools, typed RPC adapter and Team Client package without adding Team UI to unrelated compositions.
- [ ] The real GUI journey enters Team mode, selects or creates a Workspace, creates two Agent Members, creates a Channel with membership, sends and mentions, observes runtime states, opens a Thread, replies, changes Claim/Task state, returns to Channel and exits to Conversations.
- [ ] Desktop and narrow/mobile Playwright screenshots cover default Team sidebar, collapsed rail, Agent states, create panels, Channel, Thread, global Members panel and failure/empty/loading states.
- [ ] Canvas/DOM assertions confirm all primary surfaces render nonblank, text stays inside controls, no incoherent overlaps occur and keyboard focus remains visible.
- [ ] Repeated Team enter/leave, browser refresh, plugin stop/run and full unload restore shipped WorkspaceBrowser, Settings, Conversation, selected Session and all child slots without stale stores or listeners.
- [ ] A deliberate primary-slot conflict fails loudly, while ordinary additive Client plugins continue to coexist.
- [ ] SQLite restart preserves Channel, membership, Message, Task, Thread and Claim projection; runtime Agent state re-derives without becoming a durable ledger fact.
- [ ] Full M1 and M2 test, typecheck, clean build, browser, invariant, pack and tarball-content checks pass; the bundle includes the Client entry and declarations.
- [ ] Documentation describes the shipped first-slice UX and explicitly defers Agent DM, Thread inbox, attachments, search, URL routing, model/provider selection and prompt tuning.
- [ ] A real browser run or GIF is attached to the local validation record so the Human can review the actual interaction rather than infer it from code tests.
