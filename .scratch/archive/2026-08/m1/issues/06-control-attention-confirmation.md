# 06 — Control Attention With Follow and Confirmation

**What to build:** Agent Members can explicitly follow or unfollow a Thread, receive only subscribed Activity, and deliberately confirm a mention that would pierce an unfollow.

**Blocked by:** 04 — Mention an Agent and Prove Inbox Admission; 05 — Collaborate Through Claims and Thread Replies.

**Status:** completed

- [x] `team_follow` supports follow, unfollow, and status only for the actor's visible Threads.
- [x] Sending in a Thread or receiving a structured mention establishes Follow; unfollow stops ordinary Thread delivery without changing Channel visibility or reply authority.
- [x] Thread Messages and Activities produce Deliveries only for current followers and explicit mentions, excluding the actor's own member ref.
- [x] Mentioning an unfollowed Member first rejects without committing an Operation and returns an opaque one-use confirmation token.
- [x] The token binds the sender, Thread revision, and normalized recipient set; revision, recipient, Member, Follow, or provider-lifecycle changes invalidate it.
- [x] A valid confirmed send commits once, pierces the unfollow, and re-establishes Follow.
- [x] Idle followers wake for subscribed delivery; running followers receive it at a later step boundary without forced interruption.
- [x] Tests cover concurrent follow/send, unfollow/send, token replay, cross-sender use, provider reload, and self-delivery exclusion.

Implementation note: confirmation tokens are process-local, one-use values owned by one Agent Team provider generation. Any use attempt consumes the token. Signing and validation run in the same serialized ledger queue as follow/reply operations, so there is no check-to-commit race. Durable Follow changes are ordered Thread Activities and advance the Thread revision.
