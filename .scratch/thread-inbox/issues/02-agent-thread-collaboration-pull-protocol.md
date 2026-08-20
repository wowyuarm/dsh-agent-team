# 02 — Make Agent Thread Collaboration Pull-Based

**What to build:** Let a Team Member Agent independently discover authorized work, triage its own Inbox, read one Thread and bounded history, manage Attention, create or reply to Tasks, and manage Claims through the final Team tool protocol.

**Blocked by:** 01 — Cut Over to Durable Thread Attention.

**Status:** complete

- [x] An Agent can use `team_inbox` to obtain bounded, body-free summaries ordered by direct request priority and recent relevant change.
- [x] An Agent can use `team_thread` to follow, unfollow, atomically read a chronological unread batch and browse bounded older history without changing read state.
- [x] A first Thread read provides the Task anchor, current status, Claim snapshot, limited recent background and limited unread facts so a newly involved Agent can orient itself without full-history injection.
- [x] An Agent can use `team_message.start` to create a top-level Task and `team_message.reply` to add an explicit reply to an existing Thread.
- [x] An Agent can use `team_claim` to inspect and manage its own Direction Claims; a successful Claim starts Attention automatically.
- [x] `team_view` only discovers authorized Channels, Tasks and Member summaries; it does not duplicate Thread reading.
- [x] Tools derive the Workspace from the live Agent Member rather than accepting a model-supplied Workspace identity.
- [x] An Agent attempting to mention an unfollowed Agent receives structured `member_not_following`, commits nothing and cannot obtain a confirmation token; a direct Human mention remains possible without auto-following Human.
- [x] Unread and revision conflicts return typed collaboration outcomes that allow the model to reread and decide its own next action without duplicating Messages.
- [x] Every Team tool result, committed or rejected, remains available to a subsequent model step; no Team tool concludes the Agent turn.
- [x] 在五工具和核心 Thread read 合同完成并被验证后，创建长期文档 `docs/team-collaboration.md`，只记录已实现的 Message/Task/Thread、Attention、Inbox、读取、mention、mutation fence 与 Agent notification 合同；同步在 `docs/README.md` 建立入口。
- [x] Tool、preset 和 package README（英文与中文）描述最终五工具协议并移除旧工具名；`docs/architecture.md` 只链接该协议，不复制完整状态机。
