# 01 — Boot an empty Agent Team

**What to build:** An opt-in real composition can start one empty Agent Team, initialize or replay its durable operation ledger, expose its status through the human command plane, and unload without leaving live registrations or storage handles.

**Blocked by:** None — can start immediately.

**Status:** completed

- [x] A real Loader composition mounts the Team Host capability and `/team status` reports an empty Team without starting a model turn.
- [x] The first boot creates a versioned ledger; a later boot replays the same empty state.
- [x] Ledger records are validated at the durable read boundary, and malformed headers, schemas, sequence gaps, or broken previous-operation links fail loudly.
- [x] Repeating one request id with the same operation returns its original receipt; reusing it with a different payload is rejected.
- [x] The package-owned invariant validates ledger identity, sequence, previous links, and request-id uniqueness.
- [x] Disposing and remounting the Host Fiber removes and restores the Service, command registration, projection, listeners, and Domain handle without leaks.
- [x] Focused package tests, the first REAL-composition smoke, and relevant documentation contracts pass.
