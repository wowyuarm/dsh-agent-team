# 06 — Verify the Complete Team UI Journey

**What to build:** A product reviewer can run the opt-in bundle in real DSH Web, complete the first M2 collaboration journey and verify that leaving or unloading Team restores the ordinary DSH experience unchanged.

**Blocked by:** 01 — Enter and Leave Team Mode; 02 — Browse Agent Members and Runtime Presence; 03 — Create Channels and Manage Membership; 04 — Collaborate in a Channel; 05 — Collaborate in a Task Thread.

**Status:** complete

- [x] One documented opt-in composition mounts the Host, bundle-private Team preset/tools, typed RPC adapter and Team Client package without adding Team UI to unrelated compositions.
- [x] The real GUI journey enters Team mode, selects or creates a Workspace, creates two Agent Members, creates a Channel with membership, sends and mentions, observes runtime states, opens a Thread, replies, changes Claim/Task state, returns to Channel and exits to Conversations.
- [x] Desktop and narrow/mobile Playwright screenshots cover Team sidebar, collapsed rail, Agent states, Channel, Thread and global Members panel; DOM composition tests cover empty, creating, unavailable and failure states.
- [x] DOM assertions confirm all primary surfaces render nonblank, the 390x844 layout collapses to a 56px rail, and the document has no horizontal overflow or incoherent overlap.
- [x] Repeated Team enter/leave, browser refresh and full plugin unload restore shipped WorkspaceBrowser, Settings and Conversation without stale shadows; refresh intentionally retains only mode + Workspace.
- [x] A deliberate primary-slot conflict at Team priority fails loudly, while the additive footer action coexists with the shipped sidebar.
- [x] SQLite restart preserves Channel, membership, Message, Task, Thread and Claim projection; runtime Agent state re-derives without becoming a durable ledger fact.
- [x] Full M1 and M2 test, typecheck, clean build, browser, invariant, pack and tarball-content checks pass; the bundle includes the Client entry, declarations and private preset asset.
- [x] Documentation describes the shipped first-slice UX and explicitly defers Agent DM, Thread inbox, attachments, search, URL routing, model/provider selection and prompt tuning.
- [x] Real browser screenshots are stored under `.scratch/m2-ui/validation/m2-06/`; `npm run test:browser` reproduces the journey with the official Harness Web scaffold.
