# 06 — Separate Preview Modes and Verify the Whole Trace

**What to build:** Make live Team interaction, model-free UI inspection and deterministic browser replay explicit workflows, then prove one representative Thread Inbox trace across the assembled bundle.

**Blocked by:** 03 — Wake Members from Durable Inbox State; 04 — Human Inbox and Thread Attention UX; 05 — Equip Team Members for Work and Private Memory.

**Status:** ready-for-agent

- [ ] `npm run preview` launches a credentialed, isolated temporary Team profile that can issue real model calls and fails clearly before launch when credentials are unavailable.
- [ ] A separate UI-only preview renders Team fixture state without silently issuing a model call; model-triggering interactions are unavailable or clearly rejected.
- [ ] Browser replay remains credential-free and deterministic rather than relying on live provider behavior.
- [ ] One assembled acceptance trace starts from an existing Thread, has Human deliberately invite an unfollowed Agent, lets the Agent wake and read/reply, and verifies Human Inbox, Thread state and ordinary DSH restoration.
- [ ] The trace verifies that the same durable facts survive reload/replay and are not reconstructed from browser-local unread state or Session relay text.
- [ ] Build, generated Remote artifacts, type checks, targeted/integration tests, browser checks, lint, package dry-run and whitespace checks pass at the appropriate scope.
- [ ] `docs/development.md`、根 README、相关 package README、`docs/README.md` 和已存在的 `docs/team-collaboration.md` 只在对应脚本、preset、tool、Host 和 Client 行为被验证后更新；`map.md` 与本目录 README 指向已完成 evidence。
