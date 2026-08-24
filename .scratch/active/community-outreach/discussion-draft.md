# Community outreach materials

Status: active
Last checked: 2026-08-24
Current frontier: awesome-dsh-plugin submission branch ready (`wowyuarm:add-wowyuarm-dsh-agent-team`); open the PR after repo age passes 24h (GitHub repo created 2026-08-23T16:05:44Z -> eligible 2026-08-24T16:05:44Z).
Exit condition: merged entries on tracked registries; archive after links are stable and maintained docs point at them.

## Submission tracker

| Target | Status | Notes |
| --- | --- | --- |
| awesome-dsh-plugin/awesome-dsh-plugin (~11.8k★) | branch ready, PR pending age gate | one YAML `data/plugins/wowyuarm__dsh-agent-team.yml` + 1 screenshot entry; READMEs regenerated (+1 line each only); category `workflow`; CI needs repo ≥1 day & ≥10 commits |
| dsh-market/dsh-market (~2k★) | covered automatically | catalog is fetched live from awesome-dsh-plugin.com/plugins.json; do NOT PR entries there |
| AdamPlatin123/awesome-dsh-plugins radar | PR opened | [#290](https://github.com/AdamPlatin123/awesome-dsh-plugins/pull/290) PLUGINS.md 🔌 单插件 row, title `docs: 登记 dsh-agent-team`, maintainerCanModify=true; topic-based auto-discovery also covers us |
| deepseek-harness official discussion | human opens first post | draft below |

## Official discussion draft

**Title:** Agent Team — durable multi-agent collaboration plugin (Web UI)

> [dsh-agent-team](https://github.com/wowyuarm/dsh-agent-team) is an opt-in bundle that adds a single-host Agent Team to DeepSeek Harness: Workspaces, Channels, Threads, Tasks, Claims, and managed Agent members, backed by an append-only operation ledger as the single authority.
>
> The Web Client gets a **Team mode**: enter and exit freely, create Channels and Agents, hand off Tasks, and review Thread updates; ordinary Sessions keep their normal preset roster and never see Team tools or guidance. Managed agents work through an isolated `team-member` preset exposing five tools: `team_inbox`, `team_thread`, `team_message`, `team_claim`, `team_view`.
>
> Install (certified against DSH `0.1.1-rc.2`):
>
> ```sh
> dsh plugin --profile web add @wowyuarm/dsh-agent-team
> dsh web
> ```
>
> npm: https://www.npmjs.com/package/@wowyuarm/dsh-agent-team · Docs: docs/README.md in the repo · Issues and feedback: https://github.com/wowyuarm/dsh-agent-team/issues

## Conventions learned

- awesome-dsh-plugin: descriptions must be literal claims checked against code; no marketing words; quote `en:` if it contains ": "; regenerate READMEs via their script; ≤3 entries/PR; change only own entries (screenshots.json needs 1-space-indent textual insert, not re-serialization).
- Radar PLUGINS.md: title format `docs: 登记 <name>`; 运行级 starts 待测 until their k8s pipeline tests it; enable maintainer edits.
