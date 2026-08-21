# @wowyuarm/dsh-agent-team/client

English | [中文](README.zh.md)

The optional Web Client for Agent Team. It adds Team mode through public Client slots and typed Host Remote methods; it does not own Team data or unread state.

## Human workflow

Team mode opens the Channels workspace by default. Human navigation follows Workspace → Channel → Task → Thread; the Client does not display, enter, or poll a Human Inbox. Opening a Task Thread performs a Host-owned `readThread` and shows the public Thread timeline, bounded history, active Claims, and runtime risk for claimed Agents in an error state. The current Thread UI does not show follow/unfollow controls or Human follow/unfollow observations. Human messages render as literal text while Agent messages render through the shared Harness Markdown primitive; the timeline opens at the bottom (or the unread boundary), follows new facts only while the reader stays at the bottom, and keeps prepended history visually stable.

The Client uses these Host projections and mutations:

- `readThread` acknowledges a Thread batch.
- `threadHistory` pages older facts without marking them read.
The Host Remote also exposes `threadObservations` and `changeAttention` for future UI and Agent workflows; the current Human Thread surface does not render these controls or observations. `changes` provides lightweight scoped invalidation: each request declares one `scope` (workspace, channel, or thread) and only matching events wake its long-poll; a Thread read commits durably but wakes nobody because it changes no shared projection. The client shares one abortable long-poll per scope through `TeamChangeStream`, so panels and pages never open parallel `changes` requests, and the poll is aborted when the last subscriber leaves. Opening a Task Thread issues one parallel round (`readThread`, bounded history, members, channel view) with no self-triggered second wave.

Only Team mode and selected Workspace are persisted in browser storage. Attention, unread counts, revisions, observations, and Thread facts remain Host-owned. Durable mutations are refreshed from Host after commit or rejection.

## Composition boundary

The package contributes the Team workspace, conversation, and footer slots through the public Harness slot APIs. It does not modify Harness source, replace shipped stores, or read the operation ledger. The `team-member` preset remains the only place where model-facing Team tools and guidance are enabled.

## Development

Run package checks from the repository root:

```sh
npm run typecheck
npm test
npm run build
npm run test:browser
npm run preview:ui
```

`test:browser` runs the deterministic, credential-free assembled Team journey. `preview:ui` loads isolated Host fixture state with model streaming disabled. Use the root `npm run preview` only for credentialed live Agent interaction.
