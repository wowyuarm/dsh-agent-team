# 03 — Provision and Control an Agent Member

**What to build:** The Human Member can create a team-managed Agent Member with a shared project cwd and private memory, then suspend and resume the same durable session without publishing a partially configured Agent.

**Blocked by:** 01 — Boot an empty Agent Team; 02 — Create a Channel and Human Task.

**Status:** ready-for-agent

- [ ] `/team member add` accepts a Workspace, unique active handle, description, and explicitly team-enabled preset.
- [ ] Member creation fixes one stable member ref to one sessionId and Workspace; a normal session fork receives no Team identity or authority.
- [ ] Unpublished setup mounts the selected preset, validates the team consumer marker and four tools, and publishes the Agent only after setup succeeds.
- [ ] Agent Members in one Workspace use the shared project cwd while member-private memory paths remain distinct and explicitly accessible under the assembled fs policy.
- [ ] The Host retains the AgentHandle and waits for complete quiescence during suspend, plugin unload, or failed setup rollback.
- [ ] Suspend preserves the Member identity, session, Claims, Follows, and queued Deliveries; resume restores the exact session.
- [ ] A missing preset, damaged session, or composition failure marks only that Member unavailable with an actionable diagnostic; the Team and other Members remain usable.
- [ ] REAL-composition coverage proves create, suspend, resume, unavailable isolation, setup rollback, and remount recovery.
