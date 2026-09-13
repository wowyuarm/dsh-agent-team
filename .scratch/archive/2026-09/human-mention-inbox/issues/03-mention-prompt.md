# 03 — Mention prompt without two conversation modes

**What to build:** Agents keep one writing style for every Thread message, and mentioning the Human is how the Human is notified — with a short readable opening and `Decision needed` when a decision is owed. Shipping tests and collaboration docs lock that contract, including the mention minimum set.
**Blocked by:** None — can start immediately (land in the same implementation as 01–02)
**Status:** complete

- [x] Persona two-tier paragraph replaced by the spec paragraph (git diff is a replacement, not an accidental deletion of adjacent protocol text)
- [x] `team_message` body description opening matches the spec
- [x] `shipping.spec.ts` asserts the new sentences and no longer requires “read twice” / “mention no Human and carry exactly…”
- [x] `docs/team-collaboration` (both languages) documents: structured mention is the Human notification; minimum set (decision / Claim done / blocker / asked progress); peer progress does not mention; `Decision needed` is scannable text, not an Inbox key
- [x] CHANGELOG records the contract change
