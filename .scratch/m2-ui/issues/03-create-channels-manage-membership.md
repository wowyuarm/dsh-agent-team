# 03 — Create Channels and Manage Membership

**What to build:** A Human Member can create a usable Channel inside a Workspace with initial Agent Members, then add or remove participants without corrupting Team history or Agent identity.

**Blocked by:** 01 — Enter and Leave Team Mode; 02 — Browse Agent Members and Runtime Presence.

**Status:** ready-for-agent

- [ ] The Channels tab is the default Workspace tab and shows existing Channels plus a compact create affordance when empty.
- [ ] Channel projection and durable schema include Human-authored name and description, with refs remaining the stable identity.
- [ ] The create panel accepts name, description and initial Member refs selected only from the current Workspace.
- [ ] One idempotent Human operation atomically commits Channel creation and all initial memberships; any invalid, duplicate, cross-Workspace or unavailable Member rejects the whole request without a half-created Channel.
- [ ] A Channel header membership control allows later Agent add/remove operations while leaving the Agent Member and its other Channel memberships intact.
- [ ] Available, working and error Agents may be selected; creating and unavailable Agents are disabled with accessible reasons, and inactive Agents are absent.
- [ ] Removing a Member from one Channel atomically releases that Member’s active Claims in that Channel, removes its Follows, cancels its queued Deliveries and preserves all Message, Activity, Task and Thread history.
- [ ] Host replay validation, request-id idempotency and SQLite restart prove the new Channel and membership facts reconstruct the same projection.
- [ ] Client mutation UI waits for Host commit, retains form input on failure and reflects only committed Channel or membership facts.
- [ ] REAL Client/Host tests demonstrate create-with-members, later add/remove, cross-Workspace rejection, cleanup invariants, empty/error states and restart recovery.
