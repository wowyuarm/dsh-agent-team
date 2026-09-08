# Cole trace audit — simplification / repetition / failure-mode evidence

Independent evidence note for the render-IA work item. Extracted offline from the
four current members' session logs (`~/.dsh/sessions/--home-yu-projects-dsh-agent-team--`,
multi-frame zstd) by a throwaway analyzer (since deleted with its raw output per the
`.scratch` transient-artifact rule — it persisted full chat bodies); only the durable
aggregates below are kept. Evidence only — no interface decision here.

Corpus: Cole 251 team calls, Momo 628, Ferry 614, Reeve 16 (Reeve's session is a
fresh rollover; his history lives in the archived rollover sessions). Full team
history 2026-08-28 → 2026-09-07, spanning the pre- and post-`9b9f53b`
(threads enumerated in `team_view`, 09-06 20:35) and post-`ebbd13b`
(decision-surface fields, 09-07 11:34) render forms.

## 1. Usage mix (what the tools are actually for)

Aggregate across members:

| tool | calls | share |
|---|---|---|
| team_thread read | 636 | 42% |
| team_message | 468 | 31% |
| team_claim | 153 | 10% |
| team_view | 43 | 3% |
| team_inbox | 55 | 4% |

`team_thread read` is the dominant loop (read → reply → read), re-reads of the
same ref are the norm, not the exception (Cole: 131 reads / 11 distinct refs).

## 2. team_view — directory evidence

**Every observed team_view call already used a limit or channelRef** (Cole 4/4,
Momo 26/26, Ferry 12/12, Reeve 1/1). No-argument calls: zero in the corpus.
Members self-bounded to small pages (mode ≈3–5) — the 30KB unbounded case
(Reeve `limit:100`, 09-07) produced 88 thread rows + 83 task rows, of which
30/30 first-page thread rows were closed/done, while the task section carried
current state. Double indexing of the same taskful Threads confirmed.

**Post-enumeration directory rows have no subject.** A 09-07 Ferry render shows
30 thread rows, all closed; nothing distinguishes "what the work was about"
except refs. The anchor body is the only subject source that exists without
Host changes.

**Calls correlate with intent**: next team action after team_view was
`team_thread` (read/status/history) in 26/43 cases, `team_message` in 14,
`team_inbox` 2, `team_view` again (channel narrow) 1. Momo's pattern
`view(limit:4) → team_thread history(limit:1, taskRef)` repeated 11× — using
team_view as a taskRef lookup table, then probing one thread with limit:1.

**Roster on every call**: 10 member lines × full description on all 43 calls.
Reeve's Q2 (subject) and Momo's member-depth question both trace to real cost.

## 3. team_thread — repetition and marker evidence

- Consecutive same-ref re-reads carry on average 81–98% new content — re-reads
  are incremental batches, not redundant churn. The render's read watermark
  works; a delta-only redesign would save little and risk orientation loss.
- Anchor line repeated in only 8/131 Cole reads (dedup guard works; earlier
  renders pre-`ebbd13b` lacked the header ref entirely — fixed 09-07).
- The unread-activity ellipsis marker appeared in 2/782 thread results —
  effectively dead render path (message facts dominate; activities rarely
  unread-marked alone).
- `history limit:1` is a real usage idiom (Momo 11×): a cheap "peek" that the
  current render answers with a full header + anchor + claim lines. No
  action-specific rendering exists today (all five actions share one renderer).

## 4. team_message / team_claim — rejection and identity evidence

- Typed rejections are a primary path: 83/1509 results (5.5%) — team_message
  unread_required 47, stale_revision 16; team_claim stale 10 / unread 10.
- Recovery is uniformly one extra step: next team call after every one of
  Cole's 16 rejections was `team_thread read` (16/16, gap 1 step). The retry
  fields in the render work; the round trip itself is the tax.
- team_claim renders the full Claim history on every mutation: Ferry 167 claim
  lines across 74 results, 134 (80%) done/released historical lines — the
  mutation decision needs the affected claim + active collision surface, not
  the archive.
- team_message success renders are already minimal (avg 87B).

## 5. Addressing evidence

- 1630/1633 refs in calls were full-length; 3 abbreviations total. Full refs
  are the working convention; abbreviation is a rare fallback, not a load path.
- Arg-shape anomalies (spaced JSON like `{"limit": 5}`, `{"action": "read"}`)
  occur in 90/1493 calls (6%) and are tolerated by the parser — models drift
  to spaced JSON when formatting is loose. Not a render issue; a schema-strictness fact worth knowing.
- No `member_not_following` rejections in the corpus (mention discipline held);
  one raw unknown-ref rejection from a mistyped member ref in a multi-recipient
  start (Reeve's note) — atomic reject is correct behavior.

## 6. What the evidence says about Reeve's §6 questions

1. **No-arg team_view**: Tars (added 09-07) shows 12 no-arg calls in his sessions —
   together with my 43 parameterized calls both serve the same "get a ref"
   intent. The evidence supports the address-book framing (fixed parameters,
   no scope enum) that superseded Families A/B.
2. **Subject**: anchor body (bounded) — directory rows without subject forced
   Momo into view→history(limit:1) probes; the subject line would delete that
   idiom.
3. **Current work states**: open (todo/in_progress/in_review) as default;
   closed/done as explicit filter/section — 30/30 closed rows led Ferry's
   first page, which is the temporal-inversion failure Reeve identified.
   Superseded nuance: in the final address-book design, team_view is the
   address book and open-work is owned by team_inbox, so this point lands in
   inbox/thread-row standing rather than a view-side work queue.
4. **Claim list**: active-only default; historical claims are audit, not
   collision surface (Ferry's 80% historical line share).
5. **Repeat reads**: CORRECTION (2026-09-07 final round): my earlier
   "8/131 reads carry anchor" mixed two render generations. Split at ebbd13b
   (09-07 11:34): pre-boundary reads never render an anchor line (no such
   line existed); post-boundary continuation reads carry it in 21/21
   observed. Current-generation anchor share is 1-15% of read bytes (mean ~6%),
   claims lines 2-20%. The self-orienting header (threadRef+revision+claims)
   stays; the anchor's first/continuation split is agreed — first read
   full anchor, continuation bounded subject, discriminated by existing facts
   (anchor-sequence-in-batch / readThroughSequence), no new schema state.
6. **Atomic change**: renders changed twice in two days (9b9f53b, ebbd13b,
   c9cd568) with spec updates and no transition mode; model-facing render
   changes are already routine — atomic with prompt/spec/doc sync is the
   established migration path.

## 7. Simplification ledger (candidates independent of interface family)

| # | what | evidence | saving |
|---|---|---|---|
| S1 | team_view: drop the Tasks render section (keep structured field) | 83 duplicate rows in one render | ~40% of directory bytes |
| S2 | team_claim: active-only claim lines on mutation; archive on explicit list | 134/167 lines historical | ~70% of claim result bytes |
| S3 | team_view: subject column from anchor body | 11 view→history(1) probes | deletes an idiom |
| S4 | unread-activity ellipsis marker | 2/782 results | dead path |
| S5 | shared rejection formatter for message/claim | 4 template copies in source | code dup only |
| S6 | renderText helper dedup across 3 spec files | 3×3-line copies | test infra |
| S7 | unreachable fallback in team_message render (304) | messageOutcome never returns other kinds | dead code |

S5–S7 are from source reading (`packages/tool-agent-team/src/index.ts`), not
traces; they hold regardless of which interface family is chosen.
