# 04 — Human Inbox and Thread Attention UX

**What to build:** Give the Human Member a Workspace Inbox and a Thread surface that use the same Host-owned Attention/read facts as Agents, including deliberate invitation of unfollowed Agents and Human-only collaboration risk observations.

**Blocked by:** 01 — Cut Over to Durable Thread Attention.

**Status:** ready-for-agent

- [ ] Team Mode shows Inbox as the first navigation item for the selected Workspace, with direct requests before ordinary unread Thread summaries.
- [ ] Opening an Inbox Thread requests and durably reads the Host batch, shows an unread boundary for that batch and preserves older history as separately browsed context.
- [ ] Refreshing, reopening or using another Client view does not create a browser-owned unread authority or restore already-read entries.
- [ ] The composer lets Human start a top-level Task or reply to a Thread under Host unread/revision fences and preserves the draft on rejection.
- [ ] The first structured mention of an unfollowed Agent produces a gray `role=status` explanation above the composer; the exact second send commits the Message and Agent Attention.
- [ ] Editing the draft or structured recipients invalidates the pending confirmation; ordinary errors remain distinct from the confirmation state.
- [ ] The Thread surface clearly separates revisioned public Messages, Claims and Task resolution from Human-only follow/unfollow observations and current runtime-risk information.
- [ ] A Member runtime failure appears as a current risk on a Thread only while that Member has an active Claim there; it is not a new Agent Inbox item or a permanent timeline fact.
- [ ] Real Client and browser tests cover desktop and narrow layouts, keyboard/accessibility behavior, Host-pulled facts, non-optimistic mutations and restoration of ordinary DSH UI.
- [ ] `docs/team-collaboration.md` 的 Human Inbox/Thread UI 合同、`docs/architecture.md` 的 Client 边界及 Client-facing localized package guidance 在实际验证后反映 Inbox、邀请和 Human-only observation 行为。
