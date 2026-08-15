# 04 — Mention an Agent and Prove Inbox Admission

**What to build:** A Human Message can mention an Agent Member, persist one Delivery intent, wake the member, and prove durable Inbox admission without claiming that the model processed the message.

**Blocked by:** 02 — Create a Channel and Human Task; 03 — Provision and Control an Agent Member.

**Status:** ready-for-agent

- [ ] The Human Member can add an Agent Member to a Channel without pushing historical Messages into that session.
- [ ] A structured mention creates one queued Delivery with stable DeliveryId and MessageId in the same Message Operation.
- [ ] The Host resolves the enabled Agent Member, admits the relay to `next-step`, and wakes the Agent when idle without interrupting a running tool call.
- [ ] Admission becomes durable only after the target session contains matching `agent/inbox/spliced` or `user/message` evidence.
- [ ] The relay uses the dedicated member-authored MessageSource and carries sender, Channel, Task, Message, and revision refs without granting authority.
- [ ] The Agent Member can use `team_view` to read the authorized Task and cannot read a Channel it has not joined.
- [ ] Restart between Message commit, Inbox append, and admitted commit either recovers the existing evidence or retries with the same MessageId; it never creates a duplicate Delivery or Message.
- [ ] The invariant proves every admitted Delivery has target-session evidence and that no Delivery is both admitted and canceled.
