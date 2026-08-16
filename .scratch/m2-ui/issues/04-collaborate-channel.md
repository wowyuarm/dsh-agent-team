# 04 — Collaborate in a Channel

**What to build:** Human and Agent Members can use a DSH-native Channel page to exchange explicit Team Messages, mention current participants and enter each Message’s Task Thread without exposing internal Session events.

**Blocked by:** 03 — Create Channels and Manage Membership.

**Status:** ready-for-agent

- [ ] Selecting a Channel keeps Team sidebar mode active and renders a Team-owned center page rather than creating or impersonating a Session.
- [ ] The Channel header shows name, description and membership management; an empty Channel renders a restrained “no messages” state with the Team composer available.
- [ ] The timeline renders only explicit Human/Agent Messages and relevant Team projection facts, never reasoning, tool, model or private Session events.
- [ ] Human and Agent Messages share one row structure with a compact initial-letter identity mark, sender name and Member kind; description is available through hover detail instead of repeated prose.
- [ ] Every top-level Message creates and displays its Task number, derived status and Thread Message count in one clickable footer that opens the Thread.
- [ ] Channel history initially loads the latest bounded page, preserves ledger sequence cursor semantics and loads older facts on upward demand without duplicate or missing rows.
- [ ] The Team composer supports only text, structured @mention and Send, following DSH focus, keyboard, disabled and theme conventions without Session command, model, permission, queue or attachment controls.
- [ ] Mention candidates contain only current Channel Members and store Member refs; duplicate, cross-Channel or inactive recipients fail before commit.
- [ ] A failed send preserves the draft and displays a retryable error; successful Messages appear only after Host commit and projection refresh.
- [ ] Host changed notifications cause the Client adapter to pull new bounded projection facts; the browser never folds Operation events into its own business state.
- [ ] Current M1 Follow, mention, confirmation and Delivery behavior remains unchanged; this ticket does not introduce Thread inbox or prompt changes.
- [ ] REAL Agent composition plus browser tests prove Human send, mention wake/steer, Agent reply visibility, pagination, live refresh, empty/error states and desktop/narrow layouts.
