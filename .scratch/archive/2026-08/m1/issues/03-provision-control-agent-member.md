# 03 — Provision and Control an Agent Member

**What to build:** The Human Member can create a team-managed Agent Member with a shared project cwd and private memory, then suspend and resume the same durable session without publishing a partially configured Agent.

**Blocked by:** 01 — Boot an empty Agent Team; 02 — Create a Channel and Human Task.

**Status:** complete

- [x] `/team member add` accepts a Workspace, unique active handle, description, and explicitly team-enabled preset.
- [x] Member creation fixes one stable member ref to one sessionId and Workspace; a normal session fork receives no Team identity or authority.
- [x] Unpublished setup mounts the selected preset, validates the team consumer marker and four tools, and publishes the Agent only after setup succeeds.
- [x] Agent Members in one Workspace use the shared project cwd while member-private memory paths remain distinct and explicitly accessible under the assembled fs policy.
- [x] The Host retains the AgentHandle and waits for complete quiescence during suspend, plugin unload, or failed setup rollback.
- [x] Suspend preserves the Member identity, session, Claims, Follows, and queued Deliveries; resume restores the exact session.
- [x] A missing preset, damaged session, or composition failure marks only that Member unavailable with an actionable diagnostic; the Team and other Members remain usable.
- [x] REAL-composition coverage proves create, suspend, resume, unavailable isolation, setup rollback, and remount recovery.

Implementation note: team-managed sessions persist `danger-full-access`; the Workspace path remains cwd and member-private memory lives under `$DSH_HOME/agent-team/members/<memberId>/`. The bundle consumes existing Host providers rather than replacing them. Team tool rows register in preset scope and resolve `ctx.agentTeam` at execution time to avoid a Host-remount dependency cycle.
