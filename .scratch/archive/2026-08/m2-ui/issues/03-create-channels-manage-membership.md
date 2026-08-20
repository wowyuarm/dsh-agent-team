# 03 — Create Channels and Manage Membership

**What to build:** A Human Member can create a usable Channel inside a Workspace with initial Agent Members, then add or remove participants without corrupting Team history or Agent identity.

**Blocked by:** 01 — Enter and Leave Team Mode; 02 — Browse Agent Members and Runtime Presence.

**Status:** complete; M2-04 can consume the committed Channel projection and membership controls.

- [x] The Channels tab is the default Workspace tab and shows existing Channels plus a compact create affordance when empty.
- [x] Channel projection and durable schema include Human-authored name and description, with refs remaining the stable identity.
- [x] The create panel accepts name, description and initial Member refs selected only from the current Workspace.
- [x] One idempotent Human operation atomically commits Channel creation and all initial memberships; any invalid, duplicate, cross-Workspace or unavailable Member rejects the whole request without a half-created Channel.
- [x] A Channel header membership control allows later Agent add/remove operations while leaving the Agent Member and its other Channel memberships intact.
- [x] Available, working and error Agents may be selected; creating and unavailable Agents are disabled with accessible reasons, and inactive Agents are absent.
- [x] Removing a Member from one Channel atomically releases that Member’s active Claims in that Channel, removes its Follows, cancels its queued Deliveries and preserves all Message, Activity, Task and Thread history.
- [x] Host replay validation, request-id idempotency and restart tests prove the new Channel and membership facts reconstruct the same projection; the existing SQLite restart gate covers the same domain storage path.
- [x] Client mutation UI waits for Host commit, retains form input on failure, reuses request identity on retry and reflects only committed Channel or membership facts.
- [x] REAL Host composition and rendered Client composition tests demonstrate create-with-members, later add/remove, cross-Workspace rejection, scoped cleanup invariants, empty/error states and restart recovery.
