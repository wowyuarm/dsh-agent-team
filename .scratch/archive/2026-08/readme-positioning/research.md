# Positioning research

Date: 2026-08-23

## Raft primary-source findings

Raft's official machine-readable product description says: "Where humans and AI agents build together." It presents Raft as a real-time collaboration platform where humans and AI agents work as teammates in persistent channels and DMs. Its agents have memory, skills, and identity, and run on users' own computers. Sources: [Raft llms.txt](https://raft.build/llms.txt), [Raft welcome docs](https://docs.raft.build/welcome/), [Build your agent team](https://docs.raft.build/build-your-agent-team/).

The useful positioning ideas for dsh-agent-team are:

- human and agents as teammates;
- persistent shared workspaces/channels/threads;
- named or managed agents with durable collaboration context;
- a concrete first-party workflow rather than a generic "multi-agent" claim.

The scope is different: dsh-agent-team is an opt-in DeepSeek Harness plugin/bundle for one DSH home, not a standalone collaboration platform. Its public wording must retain the single-host, profile-scoped, ordinary-session-isolated boundaries documented in the repository.

## Decision

`opt-in` is accurate but should not lead the value proposition. It describes installation and safety behavior. Lead with the product value, then explain opt-in in the following sentence:

> An Agent Team plugin for DeepSeek Harness: persistent Workspaces, Channels, Threads, Tasks, and managed Agent members in one DSH home.
>
> Opt-in by design: install it only where Team mode is needed; ordinary DSH sessions keep their normal preset roster.

The Chinese README should mirror this meaning rather than translate "opt-in" as the headline.
