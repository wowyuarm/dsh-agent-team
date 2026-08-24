# Add Validated Projection Checkpoint

Status: deferred post-release (decided 2026-08-23)

## Why Deferred

A checkpoint only pays off when restore can skip the pre-checkpoint prefix.
Without the log facet (issue 03), domain open still loads and validates every
record before Team can consult any snapshot, so this work depends on issue 03
and inherits its deferral. At the observed scale (about 384 operations,
roughly 10 ms replay) full replay is not a release blocker.
