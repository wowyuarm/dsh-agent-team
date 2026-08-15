# 02 — Create a Channel and Human Task

**What to build:** The Human Member can create a Channel in a Workspace, send an immutable top-level Message that automatically creates a Task and Thread, and read the resulting collaboration facts after restart.

**Blocked by:** 01 — Boot an empty Agent Team.

**Status:** completed

- [x] The current Harness human resolves to one stable Human Member with management authority independent of MessageSource fields.
- [x] `/team channel create` validates the Workspace and creates a Channel whose refs remain stable across restart.
- [x] `/team send` creates one top-level Message, Task, Thread, Follow state, and recipient-intent set in one atomic Operation.
- [x] Every Channel top-level Message creates a Task; Thread Messages do not create another Task.
- [x] `/team view` returns bounded results with typed opaque refs, a sequence cursor, and current Thread revision.
- [x] The Human Member can inspect all Channels in the Workspace, while unknown, cross-type, or cross-Workspace refs are rejected.
- [x] Restart replay reconstructs identical Channel, Message, Task, Thread, sequence, and revision views.
- [x] Package tests cover immutable records, default pagination, exact limits, cursor continuation, and invalid refs.

Implementation note: the Message Operation persists only caller-owned and derived collaboration facts. The operation receipt is returned from the ledger boundary and is not duplicated inside `operation.data`. Identical request retries return the original value with no new operation; replay reconstructs the same refs and projection.
