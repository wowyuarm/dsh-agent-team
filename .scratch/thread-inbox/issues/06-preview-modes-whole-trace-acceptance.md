# 06 — Separate Preview Modes and Verify the Whole Trace

**What to build:** Make live Team interaction, model-free UI inspection and deterministic browser replay explicit workflows, then prove one representative Thread Inbox trace across the assembled bundle.

**Blocked by:** 03 — Wake Members from Durable Inbox State; 04 — Human Inbox and Thread Attention UX; 05 — Equip Team Members for Work and Private Memory.

**Status:** complete

- [x] `npm run preview` launches a credentialed, isolated temporary Team profile that can issue real model calls and fails clearly before launch when credentials are unavailable.
- [x] A separate UI-only preview renders Team fixture state without silently issuing a model call; model-triggering interactions are unavailable or clearly rejected.
- [x] Browser replay remains credential-free and deterministic rather than relying on live provider behavior.
- [x] One assembled acceptance trace starts from an existing Thread, has Human deliberately invite an unfollowed Agent, lets the Agent wake and read/reply, and verifies Human Inbox, Thread state and ordinary DSH restoration.
- [x] The trace verifies that the same durable facts survive reload/replay and are not reconstructed from browser-local unread state or Session relay text.
- [x] Build, generated Remote artifacts, type checks, targeted/integration tests, browser checks, lint, package dry-run and whitespace checks pass at the appropriate scope.
- [x] `docs/development.md`、根 README、相关 package README、`docs/README.md` 和已存在的 `docs/team-collaboration.md` 只在对应脚本、preset、tool、Host 和 Client 行为被验证后更新；`map.md` 与本目录 README 指向已完成 evidence。

Evidence: commit `5daa860` separates live and UI preview modes. `scripts/team-ui.e2e.ts` verifies the assembled existing-Thread invitation, Agent durable Inbox/read/reply, Human Inbox/Thread reload, and ordinary DSH restoration. `packages/agent-team/tests/member-lifecycle.spec.ts` verifies the real safe-boundary wake path and body-free hint. Final release checks were rerun during closeout; `npm run lint` remains unavailable because this external repository has no ESLint configuration.
