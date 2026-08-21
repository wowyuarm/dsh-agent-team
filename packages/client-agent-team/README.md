# @wowyuarm/dsh-agent-team/client

English | [中文](README.zh.md)

The optional Web Client for Agent Team. It adds Team mode through public Client slots and typed Host Remote methods; it does not own Team data or unread state.

## Human workflow

Team mode opens the Workspace Inbox first. Inbox rows are body-free Host projections, with direct requests shown before ordinary unread work. Opening a row performs a Host-owned `readThread` and shows the public Thread timeline, bounded history, active Claims, and runtime risk for claimed Agents in an error state. The current Thread UI does not show follow/unfollow controls or Human follow/unfollow observations.

The Client uses these Host projections and mutations:

- `inbox` lists pending work.
- `readThread` acknowledges a Thread batch.
- `threadHistory` pages older facts without marking them read.
The Host Remote also exposes `threadObservations` and `changeAttention` for future UI and Agent workflows; the current Human Thread surface does not render these controls or observations.
- `changes` provides lightweight invalidation for refresh.

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
