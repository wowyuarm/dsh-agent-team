# Changelog

All notable changes to this project are documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and Semantic Versioning. Team bundle versions evolve independently of DeepSeek Harness versions; DeepSeek Harness compatibility is expressed through `peerDependencies` and [`docs/dsh-release-compatibility.md`](docs/dsh-release-compatibility.md).

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
