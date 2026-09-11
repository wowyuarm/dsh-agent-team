# Changelog

All notable changes to this project are documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and Semantic Versioning. Team bundle versions evolve independently of DeepSeek Harness versions; DeepSeek Harness compatibility is expressed through `peerDependencies` and [`docs/dsh-release-compatibility.md`](docs/dsh-release-compatibility.md).

## [Unreleased]

- Member Sessions record rollover handoffs and checkpoint continuations in the message-source shape the released Session format admits: the handoff envelope and the checkpoint correlation now travel as named snapshot sections instead of package-specific source kinds and fields, so Sessions written by this version stay readable when a later format generation migrates them. Logs already on disk that carry the retired shapes are repaired at startup by the pass below; the original artifact is never written.

- Member Sessions written by a released line that the current format migration refuses are repaired at startup: for every `enabled` Member the bundle walks the Session lineage and, for an artifact refused because of the retired Team source kinds, admits the source into the shipped shape, proves the whole artifact through the format catalog, and publishes one current-format sibling (`session.v3.jsonl.zstd`) beside it. The original artifact is never written, so deleting the sibling rolls the repair back; an artifact refused for a structural defect (an unclosed turn, a seq gap) is left byte-identical with a diagnostic, and a readable generation that still carries the retired kinds is logged rather than rewritten. Completion is cached per Member, so later starts skip a finished walk. Verified on a full real store: 44 artifacts repaired, no byte changed in any pre-existing artifact, nothing published on a second walk.

- The `Related files` section of a rollover handoff carries the exact JSON array of paths instead of a comma-joined string, so a path containing a comma survives the round trip; sections written by earlier versions are still read.

- Members whose retired previous Session log is corrupt no longer get stuck `unavailable` after a restart: carried-input replay is skipped once the current generation has already started its own turns, and a `corrupt session log` error during the replay fails open with a warning (missing/IO unreadable causes stay fail-closed). Activation failures now log the member handle for the operator.

- Fixed Channel archival and Channel member removal writing an incomplete inbox cleanup when the Channel held a taskless Thread: the commit path collected Threads from the Task projection only, while replay validation expects every Thread of the Channel, so archiving such a Channel (or removing a Member from it) made the next start fail with `invalid Channel archival inbox cleanup`. The commit scope now matches validation, and records written by 0.1.7–0.1.9 with exactly that legacy cleanup are repaired in memory on load (the stored ledger is untouched); any other mismatch still fails validation.

- Members gain `web_fetch`: the `team-member` preset's `tool-web` row now registers fetch (`fetch: true`), resolving the Host's anonymous HTTP fetch provider, and the `web_search` guidance automatically recommends fetching a specific result. This was disabled only while the preset carried its own web service rows (which had no fetch provider); since the preset moved to the host-service architecture the disabled flag was stale.

- Members now have time awareness. Every agent-facing collaboration surface carries absolute event instants rendered in the fixed Team coordination zone UTC+8 with an explicit offset (`2026-09-08T17:00:00+08:00`): `team_thread` fact lines and anchors stamp each fact with its committing operation's instant, `team_inbox` rows carry `newestOccurredAt` (same snapshot as `newestSequence`), `team_view` Thread rows carry `lastActivityAt`, automatic notifications state `Occurred at:`, DM relays and their prior-DM context cite instants, and committed mutations render `Committed at:` from the receipt. The same stored instant renders byte-identically on every reread path — read, history paging, post-compaction rebuild, old-ledger replay — and pre-envelope ledgers normalize on replay; only absolute timestamps are rendered, never relative text.
- The `team-member` preset gains a `member-time-context` clock row: the first step of every eligible Member turn receives one durable snapshot with the current instant, the elapsed time since the preceding model-visible event (folded from the Member Session's own events, so restart/resume/compaction derive identical baselines; a rollover renders elapsed `unavailable`; a wall-clock rollback clamps to `0s`), and the ordering-authority note that sequence and revision — not wall-clock time — determine ordering and concurrency. Later steps of the same turn stay quiet within the refresh interval (default 30 minutes, preset-configurable), so a tool-dense turn of quick steps produces exactly one snapshot line. The shipped `dsh-time-context` stays unmounted because its browser-zone policy would ask background-woken Members to confirm dates with an absent user.
- The five model-facing Team tools now render as one decision interface: `team_view` is an address book (newest-first Thread catalog with a bounded anchor subject and inline Task standing — no second Task index, no revision or message count), `team_inbox` states total/shown unread and direct counts with a truncation conclusion, and `team_thread` renders its five actions separately (one-line Attention answers; read outcome → identity → orientation → active Claims → facts → watermark; history with full anchor on the first page and bounded subject on continuation).
- The write basis is now an opaque next-write token instead of an ambient revision number: `Next write — baseRevision: N (copy exactly; never derive or cite)` appears only on a fully drained `team_thread read` and a committed public mutation (`team_message` start/reply, `team_claim` mutation). Directory rows, inbox, Attention status/follow/unfollow, history, claim listings, partial reads, and every typed rejection render no revision and no token; rejections begin `Not committed` and route to read-and-reconsider.
- Committed message results name their action (`Committed — Thread created.` / `Committed — reply added.`); claim mutations render the authoritative affected Claim first instead of the full archive, and `team_claim list` shows only active Claims.
- The team-member preset, tool descriptions, `baseRevision` parameter descriptions, package READMEs, and the bilingual collaboration docs tell the same story: discover (`team_view`) → read until clear (`team_thread read`) → copy the token into one deliberate public mutation; after a rejection, read and reconsider.
- Maintenance: one shared typed-rejection formatter, one bounded-subject formatter, and one shared render-test helper replace per-tool duplication; the unreachable `team_message` render fallback and the unread-activity ellipsis line are removed.

## [0.1.9] - 2026-09-07

- Members manage their own context: `context_rollover` ends the current context and continues as the same Member in a new one, `context_checkpoint` records a restorable anchor before a risky operation, and `context_timeline` inspects the context lineage (checkpoint, first-arrival, and Task claim boundaries labeled by their semantics) and picks an anchor to return to.
- Member context no longer needs watching: near the budget a Member receives one notice suggesting `context_rollover`; at the hard limit the Host compacts before the next request, so a task is not interrupted by context exhaustion.
- Context switches survive restarts and crashes: pending switches replay safely and a crash rebuilds the handoff from the last recorded state.
- `team_view` now lists top-level Threads (with revision and message count), so Members can discover discussions they were not mentioned in.
- Windows support: attachment file names and member memory directories are sanitized per Windows rules (illegal characters, reserved device names, trailing dots and spaces), legacy memory directories migrate automatically, and legacy colon-spelled memory directories merge into the canonical path on activation, with conflicting content archived under a `.colon-twin` suffix.
- Team tool results carry more complete decision information: thread/inbox lines show channel, status, unread/direct counts, and revision; Claims show status, owner, and direction.
- Fixed an intermittent session-retirement race during member activation that could fail startup.
- Fixed the underlying session not rebinding after leaving an embedded member view, which could cross replies.
- Fixed early-accept notifications carrying an empty finished-claim clause.
- Fixed a poisoned rollover pending that could not recover; recovery now retries and prevalidates the checkpointRef.
- The manual "start from a fresh context" action is removed; Member context management is fully delegated to Members and the Host pressure policy.
- CI gains Linux and Windows (Git Bash) lanes, and build/dev scripts are adapted for Windows environments.

## [0.1.8] - 2026-09-05

- Members that run 20 tool calls (then 40, 60…) without posting to a Thread receive a reminder in the current turn, listing the Tasks they hold a Claim on and the Threads they follow, asking for a brief note on what is confirmed, what remains, and any blocker. A reminder the member has not read yet is revoked once the member commits a message.
- A member following a still-`todo` Task it has never claimed receives one `team_claim` reminder after 5 tool calls (once per Thread per Session), suggesting it state its direction in the Thread first. Both reminders are advisory, write nothing to the ledger, and never wake an idle member.
- Team tools and the Web Client accept abbreviated refs: `task:0f0ad7` and any 6+ unambiguous hex prefix resolve to the matching Task / Thread / Member / Channel / Claim. Ambiguous prefixes are rejected with the candidate full refs, prefixes shorter than 6 hex characters are not accepted, and a Task ref renders as a link only after the Host confirms it — unresolved text stays plain.
- On Thread surfaces the mention candidate list ranks the current Thread's followers above the remaining roster, because mentioning a follower delivers directly while a non-follower needs the Human's two-step invitation.
- Member sessions now use the same shipped composer as ordinary sessions: the Team's own hint strip and its `/compact` and `@member` entry points are removed. Member context still compacts automatically past the threshold, and members still get the pre-compaction hint to persist key conclusions first.
- Member guidance separates the two channels: Team messages go to the ledger (visible to the team, revisitable), while a session reply goes straight to the Human who reads the output. It also states that a member's private memory/notes/skills are readable only by that member — restate the content inside the message instead of pointing at a note path.
- Task chips, thread pills, and member avatars share one status-dot component, so the same state renders at the same size and color everywhere.
- The mention candidate list keeps the keyboard selection inside the visible area when the roster needs scrolling.
- The new-update jump hint at the bottom of a Thread disappears once the reader scrolls to the newest message.

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
