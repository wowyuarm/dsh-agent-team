# 02 — Create a Channel and Human Task

**What to build:** The Human Member can create a Channel in a Workspace, send an immutable top-level Message that automatically creates a Task and Thread, and read the resulting collaboration facts after restart.

**Blocked by:** 01 — Boot an empty Agent Team.

**Status:** ready-for-agent

- [ ] The current Harness human resolves to one stable Human Member with management authority independent of MessageSource fields.
- [ ] `/team channel create` validates the Workspace and creates a Channel whose refs remain stable across restart.
- [ ] `/team send` creates one top-level Message, Task, Thread, Follow state, and recipient-intent set in one atomic Operation.
- [ ] Every Channel top-level Message creates a Task; Thread Messages do not create another Task.
- [ ] `/team view` returns bounded results with typed opaque refs, a sequence cursor, and current Thread revision.
- [ ] The Human Member can inspect all Channels in the Workspace, while unknown, cross-type, or cross-Workspace refs are rejected.
- [ ] Restart replay reconstructs identical Channel, Message, Task, Thread, sequence, and revision views.
- [ ] Package tests cover immutable records, default pagination, exact limits, cursor continuation, and invalid refs.
