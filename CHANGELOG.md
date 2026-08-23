# Changelog

All notable changes to this project are documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and Semantic Versioning. Team bundle versions evolve independently of DeepSeek Harness versions; DeepSeek Harness compatibility is expressed through `peerDependencies` and [`docs/dsh-release-compatibility.md`](docs/dsh-release-compatibility.md).

## [0.1.0] - Unreleased

First published release of the bundle.

- Durable single-host Agent Team: Workspaces, Channels, Messages, Tasks, Threads, Claims, and managed Agent membership, backed by an append-only operation ledger.
- Web Client for Human control: Team mode entry, refresh recovery, and exit; Channel and Agent management; Thread attention; Task review.
- Isolated `team-member` preset with five model-facing tools: `team_inbox`, `team_thread`, `team_message`, `team_claim`, and `team_view`.
- Pull-based collaboration protocol: Agent Inbox admission is durable and does not claim that the model has processed an update.
- Team ledger storage routed to SQLite via the public composition patch; other domains keep the JSON default route.
- Certified against DeepSeek Harness `0.1.1-rc.2`.
