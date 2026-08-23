# Add Log-Oriented Storage Contract

Status: deferred post-release (decided 2026-08-23)

## Why Deferred

The public seam does not exist: `StorageBackend` exposes only the `kv` facet.
Adding a log facet means modifying `../deepseek-harness` storage packages,
which is outside this bundle's boundary unless separately approved later. A
KV-only snapshot cannot substitute for it because domain open still eagerly
`loadAll()`s and validates every record, so no tail-only startup is reachable
through today's contract.

## Post-release Path

Record a Harness extension requirement describing the needed facet semantics
(durable append, range reads, tail read, per-record failure boundaries,
close draining). Then decide between upstream acceptance and a Team-owned
interim store with one clear authority and a removable package boundary.
