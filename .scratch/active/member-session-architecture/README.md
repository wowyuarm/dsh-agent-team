# Member Session architecture — 可靠读取、历史召回与安全回返

## Status

active — 统一工作项由原 `session-reliability` 与 `session-search-and-travel` 合并而来。0.1.10 的存量修复与 replay 硬化已经发布并完成验证；当前先完成 Session 读取与回返规则的重新设计。Session search 与搜索命中关联的历史 rollover 是同一方案的后续扩展，不与基础设计并行实施。

last-checked: 2026-09-14（合并两个工作项并锁定新方案范围）。

## Goal

建立一套简单、统一的 Member Session 方案，解决两个反复出现的问题：

1. DSH Session persistence interface 或格式契约变化时，Team 只在一个读取 seam 适配，不再由 lifecycle、timeline、checkpoint 和 recovery 调用点分别处理 `stat/open/read/close` 与错误文案。
2. Session 读取失败只影响真正依赖它的行为：当前绑定或已提交 checkpoint seed 无法证明时阻塞；普通历史读取失败只截断该次历史能力，不把仍能工作的 Member 判为 unavailable。

目标形态：

```text
Member durable identity + current binding       Team ledger authority
                      │
                      ▼
             unified stored-Session read
           open → read → close + typed failure
                      │
             ┌────────┴────────┐
             │                 │
      current activation   lineage consumers
                           timeline / recovery /
                           later search + rollover
```

本设计不创建第二套 Session store，不把 Session health 写进 ledger，不新增完整状态机，也不弱化 DSH 的 fail-closed 校验。

## Confirmed decisions

### One read seam

Team 需要一个小型内部读取入口，返回完整、已验证的 stored Session inspection，并将 Harness 稳定错误类型归一化。它隐藏 handle lifecycle；调用方不接触 artifact 路径、格式世代或错误文案匹配。

该 seam 只负责读取和分类，不负责 Member lifecycle、Agent create/resume、UI、ledger 或 remediation authority。现有 `SessionRemediation` 是读取失败后的受限修复策略，继续遵守“仅修 Team 可证明由自身旧写法造成的 artifact、全量验证、只增不改”。

### Failure impact belongs to the consumer

| Consumer | Read failure policy |
| --- | --- |
| Current bound Session activation | Block activation; Member durable lifecycle remains `enabled`, runtime status explains the activation failure |
| Committed checkpoint-return seed | Fail closed; never replace a committed return with a blank child |
| Handoff/carried-input crash recovery | Preserve existing delivery proof: skip only when delivery/supersession can be proven or the failure is a deterministic bounded class |
| Timeline and ordinary history reads | Stop or mark that result incomplete; do not change current Member availability |
| Later Session search/read | Return partial results with unreadable-history diagnostics; do not change current Member availability |

Do not create a product-wide `ready/degraded/repairing/blocked` state machine for this work. Member status continues to answer whether the current Agent can work. Historical completeness is reported by the feature that reads history.

### One return-anchor policy

Timeline, later search enrichment, and `context_rollover(checkpointRef)` must not maintain separate definitions of a safe historical return. Extract one read-only anchor evaluation from the existing timeline/seed resolver rules; rollover revalidates the same anchor at execution time together with mutable guards.

A historical rollover is not reopening an old Session and not rolling back the current Session. It creates a new context generation seeded from an exact, validated prefix ending at a completed-turn anchor. Files, Git state, jobs and Team facts are never rolled back.

### Search may be broad; return stays narrow

The later search capability may search/read every Session ever bound to the same Member, including archived generations and abandoned branches after checkpoint return. The Team ledger derives ownership; a guessed Session id or shared Workspace cwd never grants access.

A search hit may receive a `checkpointRef` only when its source belongs to the current active lineage and the shared anchor policy proves a completed, safe prefix that contains the hit. Abandoned branches remain searchable evidence but are not return targets. Historical return continues through the existing `context_rollover(checkpointRef)` path; there is no second restore engine and no arbitrary mid-turn event return.

### Search follows the redesign

Session search remains the two-step recall interface already researched (`context_search` and `context_read`), backed by the existing Harness `sessionQuery` capability and a Team-owned Member authorization layer. Its implementation begins only after the read seam and return-anchor policy are in place. Search is the primary future value; rollover enrichment is optional metadata on a safe hit.

## Evidence and corrections

- DSH `0.1.2-rc.1` exposed `create/inspect/borrowSession/list/listSnapshots`; `0.1.5-rc.2` replaced that surface with handle-based `create/open/flush/stat/list`. Commit `b2cdf73` had to adapt the Team call sites.
- DSH 0.1.5 released-format migration rejects unclassified historical payloads before plugin mount. Team 0.1.9's custom handoff/continuation source kinds triggered that path; `5dd6373`, `956b85a` and `8103d6a` changed future writes, repaired provable artifacts and bounded replay failure.
- Full-store validation repaired 44 artifacts, left structural defects untouched, changed zero existing artifact bytes and produced no writes on the second pass. See `issues/01-lineage-v3-sibling-migration.md`.
- GitHub issues [#12](https://github.com/wowyuarm/dsh-agent-team/issues/12), [#14](https://github.com/wowyuarm/dsh-agent-team/issues/14) and [#15](https://github.com/wowyuarm/dsh-agent-team/issues/15) cover distinct module-loading and persistence-interface failures that all surfaced as disabled/unavailable Members.
- Correction: `replayCarriedInput` was introduced by `f20755a` and hardened after the Reeve/Ferry retired-log corruption incident by `dabeb0b`. GitHub [#13](https://github.com/wowyuarm/dsh-agent-team/issues/13) concerns Channel archival ledger cleanup and did not introduce this recovery path.

Detailed evidence is retained in `materials/`.

## Current frontier

Design before implementation:

1. Specify the smallest stored-Session inspection result and typed failure categories using Harness public error classes.
2. Inventory the current consumers (`activateMember`, timeline, checkpoint seed resolution, handoff reconstruction, carried-input replay, token measurement) and assign each the policy in the table above.
3. Define one anchor-evaluation result shared by timeline observation and rollover revalidation without moving Agent lifecycle into the reader.
4. Prove the seam with existing fixtures before changing any Client status or implementing search.

After these are confirmed, write narrow implementation tickets. The later search work reuses the same read/anchor contracts and adds Member-owned-history authorization, inherited-prefix deduplication and the two recall tools.

## Completion conditions

### Session redesign

- One internal read seam owns `open → read → close` and typed error normalization.
- Existing consumers no longer classify Session failures independently by message text.
- Tests prove the same unreadable ancestor only truncates timeline/history, while an unreadable committed seed blocks checkpoint return and an unreadable current binding blocks activation.
- Timeline and rollover use one return-anchor policy; rollover still revalidates mutable guards at execution.
- No new durable authority, Session store, health ledger or broad compatibility fallback is introduced.
- Maintained architecture and domain documentation reflects the implemented contract.

### Later Session search and historical rollover extension

- A Member can search and read only Sessions previously bound to that Member, including abandoned branches; guessed ids and same-cwd Sessions owned by another Member are rejected.
- Search/read tolerate unreadable history as partial results.
- Search enrichment only returns anchors from the current active lineage and uses the shared return-anchor policy.
- Historical return creates a new seeded generation through `context_rollover(checkpointRef)` and never rolls back external state.
- Search uses the existing Harness query/index authority rather than a second Team index.

## Formal-doc exit

When the redesign is implemented, move stable mechanisms into `docs/architecture.md` / `architecture.zh.md`, and vocabulary into `docs/domain-model.md` / `domain-model.zh.md`. When search tools are implemented, add their model-facing contract to `docs/team-collaboration.md` / `team-collaboration.zh.md` and the Harness navigation route to `docs/harness-navigation.md` / `harness-navigation.zh.md`. Then archive this work item under `.scratch/archive/YYYY-MM/member-session-architecture/`.
