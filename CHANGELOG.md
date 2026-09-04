# Changelog

All notable changes to this project are documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and Semantic Versioning. Team bundle versions evolve independently of DeepSeek Harness versions; DeepSeek Harness compatibility is expressed through `peerDependencies` and [`docs/dsh-release-compatibility.md`](docs/dsh-release-compatibility.md).

## [0.1.7] - 2026-09-04

- Fixes startup failure with current DSH. 0.1.6 combined with the current `@deepseek-ai/dsh` (latest is now 0.1.2-rc.1) installs cleanly — via npm directly or via `dsh plugin add` — but the host then fails to start, because the old peer range still resolves to the 0.1.1-rc.2 generation while DSH itself runs rc.1. This release fixes the combination and moves the certified baseline to DSH `0.1.2-rc.1`. Breaking for older DSH: this is a hard cut — the bundle no longer runs on 0.1.1-rc.2; users still on rc.2 must upgrade `@deepseek-ai/dsh` together with this release.
- Four previously missing peer declarations added (`dsh-api-session-controller`, `dsh-api-workspace-controller`, `dsh-client-ui-renderer`, `dsh-skill`). Two of them appear in the published type declarations, so consumers depending on Team types were relying on `@deepseek-ai/dsh` to pull them in transitively; they are now declared explicitly.
- Member sessions now use the full shipped composer. The restricted Team-only input box is gone: `/` and `@` menus, attachments, and the model picker come from the standard DSH input bar, with a slim Team hint strip above it (vocabulary hint + member turn errors, one quiet line on every viewport).
- Typing `/compact` as a full line now works in member sessions — it routes to the Team compact transaction whether picked from the menu or typed outright; `@member` still inserts structured references.
- Members and Channels can be archived — a reversible third state between suspend and remove. Archiving disposes the live session (member) while keeping private memory and logs on disk, releases the Member's active Claims with public activities, and hides archived entities from every Team surface; direct reads of archived threads return an explicit archived error.
- Member departure cleanup fixed: a departing member's Attention and markers now clear on every thread it followed, taskless ones included (was taskful only).
- README gains a Core-ideas section and a star nudge; docs updated to match the new member-session input surface and the rc.1 baseline.

## [0.1.6] - 2026-09-02

- Member runtime phase one: durable per-member capabilities schema, per-member tool policy, and member-private skills through per-member providers.
- Members can own their private space: the bundled member-skill-manager meta skill guides creating, installing, and maintaining private skills beside member roots.
- Member-to-member direct messages ship with focused context, recipient-handle error reporting, and correct reader-perspective context direction.
- Threads read their updates automatically without manual controls, and the client drops channel-level member editing in favor of the member-focused flow.
- The README now acknowledges Raft as the design inspiration for the collaboration shape.

## [0.1.5] - 2026-08-31

- Member sessions can start from a new context in place: renewing a session keeps the Agent identity, and error members get the same fresh-start path.
- Branded thread references navigate like Task references, and Human mentions render correctly in rich Markdown bodies.
- The team composer accepts pasted files as attachments, expands `@all` to all eligible members, and the member composer accepts mention candidates with Tab.
- Sidebar section collapse state persists per browser, and unclaimed `todo` Tasks can be accepted directly by the Human.
- Before automatic compaction, Members receive one advisory hint to persist their own key conclusions; writing remains the Agent's own call.
- Docs are now bilingual (English default path plus `.zh.md`), the Chinese README carries the full badge row, and builds allow esbuild scripts under pnpm 11.

## [0.1.4] - 2026-08-30

- Thread-first collaboration: start ordinary Threads without a Task, then promote a Thread to a Task when work is ready; structured promotion activity and optional Task overlays keep both paths durable.
- Add long-message expansion and clearer Thread/Channel conversation layouts, including stable reference chips and persisted workspace navigation.
- Add a Human restart action for unavailable Agent members and report the resulting runtime status in the Agent row.
- Keep composer task-mode state visible, preserve Thread header controls after replies, and improve Task reference and mention rendering.
- Refresh the bilingual README previews with current Team mode and Task Thread screenshots; archive completed diagnostics and maintenance records.

## [0.1.3] - 2026-08-29

- Member sessions now support direct Human editing and messaging, including session controls and a dedicated embedded composer.
- Accepted Tasks coordinate bounded automatic Member compaction when scoped token usage exceeds the threshold, without adding compaction facts to the Team ledger.
- Member recovery stops after three consecutive errors, and compaction state heals across preset reloads.
- Harden attachment payload sanitization, normalize legacy Team timestamps, and simplify Host and Client dispatch/rendering paths.
- Add stable Task reference formatting and inline mention rendering, plus the Awesome DSH Plugin listing badge in both README languages.
- Build cleanup, duplication checks, shipping specs, and browser test surfaces now better match the published bundle layout.

## [0.1.2] - 2026-08-27

- Human Thread replies now accept local file attachments; attachment chips, reference rendering, and draft previews are unified across message paths.
- Task references in Human and Agent prose resolve to Task numbers and navigate across Channels; Agent Markdown renders those references inline.
- Human members can accept a Task early while its open Claims finish their work.
- Channels and Agent members can be reordered per browser, with the chosen order restored after reload.
- Preserve member Sessions and pinned reasoning effort through model updates; fixes cover empty optional Team fields and cold-start records.
- Refresh the README Team mode capture to show the current collaboration UI.

## [0.1.1] - 2026-08-26

- Composer attachments: upload local files with cached bytes and thumbnail display, a larger zoom preview, and `team_message` delivery through the host attachment cache.
- Member recovery: resume or restart error-stopped members from the row menu, with automatic scheduled recovery that stands down after repeated failures.
- Restart member sessions in place, with distinct resume/restart row menu icons.
- Pin per-member reasoning effort together with the model selection.
- Simplified Agent and Channel creation: descriptions and initial Channels are optional, and both forms share the unified multi-select picker.
- Time dividers between wide same-sender message runs, and Team mode restores your last location after reload.
- Visual fixes: composer attach button alignment, suppressed stacked row fills while an Agent card menu is open, theme tokens limited to those the DSH theme defines, and a leveled divider hairline.

## [0.1.0] - 2026-08-24

First published release of the bundle.

- Durable single-host Agent Team: Workspaces, Channels, Messages, Tasks, Threads, Claims, and managed Agent membership, backed by an append-only operation ledger.
- Web Client for Human control: Team mode entry, refresh recovery, and exit; Channel and Agent management; Thread attention; Task review.
- Isolated `team-member` preset with five model-facing tools: `team_inbox`, `team_thread`, `team_message`, `team_claim`, and `team_view`.
- Pull-based collaboration protocol: Agent Inbox admission is durable and does not claim that the model has processed an update.
- Team ledger storage routed to SQLite via the public composition patch; other domains keep the JSON default route.
- Certified against DeepSeek Harness `0.1.1-rc.2`.
