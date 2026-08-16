# 04 — Mention an Agent and Prove Inbox Admission

**What to build:** A Human Message can mention an Agent Member, persist one Delivery intent, wake the member, and prove durable Inbox admission without claiming that the model processed the message.

**Blocked by:** 02 — Create a Channel and Human Task; 03 — Provision and Control an Agent Member.

**Status:** completed

- [x] The Human Member can add an Agent Member to a Channel without pushing historical Messages into that session.
- [x] A structured mention creates one queued Delivery with stable DeliveryId and MessageId in the same Message Operation.
- [x] The Host resolves the enabled Agent Member, admits the relay to `next-step`, and wakes the Agent when idle without interrupting a running tool call.
- [x] Admission becomes durable only after the target session contains matching `agent/inbox/spliced` or `user/message` evidence.
- [x] The relay uses the dedicated member-authored MessageSource and carries sender, Channel, Task, Message, and revision refs without granting authority.
- [x] The Agent Member can use `team_view` to read the authorized Task and cannot read a Channel it has not joined.
- [x] Restart between Message commit, Inbox append, and admitted commit either recovers the existing evidence or retries with the same MessageId; it never creates a duplicate Delivery or Message.
- [x] The invariant proves every admitted Delivery has target-session evidence and that no Delivery is both admitted and canceled.

Implementation note: the Host flushes the target Session through `ctx.sessions.flush()` before committing `team/delivery-admitted`; an in-memory Inbox event alone is not durable evidence. Delivery admission is process-serialized, mention establishes recipient Follow state, and Member Agents inherit the existing Host `agentDefaultModel`. `@deepseek-ai/dsh-tool-agent-team` currently ships the complete `team_view`; later issues add the remaining three tools rather than exposing placeholder commands.
