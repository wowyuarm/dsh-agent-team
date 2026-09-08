import { describe, expect, it } from 'vitest'
import { renderText, teamTools, occurrences } from './render-text.ts'

/**
 * Discriminating render tests for the five model-facing Team tools.
 * Renders are the only channel a tool result reaches the model through, so
 * each test locks the presence AND absence of exactly the fields the next
 * decision needs. Absence assertions target field labels/concepts —
 * `revision`, a `baseRevision` hand-off — never bare numbers, because fact
 * sequences, read-through watermarks, and cursors legitimately render.
 */

const THREAD = 'thread:d78400e4-4925-4065-87b1-3f81b4a4b5fb'
const TASK = 'task:3245ad40-43fd-4191-a416-7dcaf3a340f2'
const CHANNEL = 'channel:046dd831-c679-4279-b6aa-7813476cf12e'
const CLAIM = 'claim:326f0b21-a41c-4c47-be18-ad0d4ecfc139'

describe('team_view renders one address book', () => {
  it('first page: labelled sections, newest-first subjects, Task inline — no Task index, message count, or revision label', () => {
    const text = renderText(teamTools().get('team_view')!, {}, {
      channels: [{ channelRef: CHANNEL, name: 'general' }],
      members: [{ memberId: 'member:6e8a5b10-df16-4ec0-943a-63738010953f', kind: 'agent', handle: 'Tars', description: 'builder', presence: 'available' }],
      threads: [
        { threadRef: THREAD, channelRef: CHANNEL, revision: 8394, messageCount: 120, subject: 'Review the render contract', taskRef: TASK, status: 'in_progress', taskNumber: 7 },
        { threadRef: 'thread:aaaa1111-0000-4000-8000-000000000001', channelRef: CHANNEL, revision: 100, messageCount: 3, subject: 'Should Member descriptions change after the rename?' },
      ],
      tasks: [{ taskRef: TASK, threadRef: THREAD, channelRef: CHANNEL, status: 'in_progress', revision: 8394 }],
      cursor: 8394, hasMore: true,
    })
    expect(text).toContain('Team directory')
    expect(text).toContain('Channels — current')
    expect(text).toContain('Members — current')
    // Sections come in order: Channels, Threads, Members.
    expect(text.indexOf('Channels — current')).toBeLessThan(text.indexOf('Threads'))
    expect(text.indexOf('Threads')).toBeLessThan(text.indexOf('Members — current'))
    // Each Thread row carries its bounded subject and inline Task standing.
    expect(text).toContain(`${THREAD} · ${CHANNEL} · ${TASK} (#7), in_progress — Review the render contract`)
    expect(text).toContain('thread:aaaa1111-0000-4000-8000-000000000001 · channel:046dd831-c679-4279-b6aa-7813476cf12e · taskless — Should Member descriptions change after the rename?')
    // No second Task index: the taskful Thread appears once.
    expect(occurrences(text, THREAD)).toBe(1)
    // No revision-labelled field, no message count, no write token.
    expect(text).not.toContain('revision')
    expect(text).not.toContain('message')
    expect(text).not.toContain('baseRevision')
  })

  it('the footer names the Thread cursor and whether older anchors remain', () => {
    const text = renderText(teamTools().get('team_view')!, {}, {
      channels: [], members: [], threads: [], tasks: [], cursor: 0, hasMore: false,
    })
    expect(text).toContain('Thread cursor 0; hasMore=false — no older Threads remain.')
    const more = renderText(teamTools().get('team_view')!, {}, {
      channels: [], members: [], threads: [], tasks: [], cursor: 8394, hasMore: true,
    })
    expect(more).toContain('Thread cursor 8394; hasMore=true — older Thread anchors exist; page again with this cursor.')
  })

  it('a continuation page renders only the Threads section', () => {
    const text = renderText(teamTools().get('team_view')!, { cursor: 8394 }, {
      channels: [{ channelRef: CHANNEL, name: 'general' }],
      members: [{ memberId: 'member:6e8a5b10-df16-4ec0-943a-63738010953f', kind: 'agent', handle: 'Tars', description: 'builder', presence: 'available' }],
      threads: [{ threadRef: THREAD, channelRef: CHANNEL, revision: 8394, messageCount: 120, subject: 'Review the render contract' }],
      tasks: [], cursor: 100, hasMore: false, page: 'threads',
    })
    expect(text).toContain('Threads')
    expect(text).not.toContain('Channels — current')
    expect(text).not.toContain('Members — current')
    expect(text).toContain('Thread cursor 100; hasMore=false')
  })

  it('prints each structured subject verbatim on its Thread row', () => {
    const text = renderText(teamTools().get('team_view')!, {}, {
      channels: [], members: [],
      threads: [{ threadRef: THREAD, channelRef: CHANNEL, revision: 1, messageCount: 1, subject: 'One deterministic bounded subject line' }],
      tasks: [], cursor: 0, hasMore: false,
    })
    expect(text).toContain('— One deterministic bounded subject line')
  })

  it('the shared subject formatter collapses whitespace and truncates deterministically (read C-branch)', () => {
    const longBody = `Systematically   review\n\tthe five model-facing  Team tool ${'x'.repeat(120)} results tail-that-must-not-appear`
    const text = renderText(teamTools().get('team_thread')!, { action: 'read', threadRef: THREAD }, {
      kind: 'read', threadRef: THREAD, revision: 9010, following: true,
      anchor: { messageRef: 'message:anchor', sender: 'human', body: longBody, sequence: 8888 },
      claims: [],
      facts: [{ sequence: 9010, kind: 'message', body: 'one new fact', sender: 'human', mentions: [], unread: true, direct: true }],
      readThroughSequence: 9010, remainingUnreadCount: 0,
    })
    expect(text).toContain('  — Systematically review the five model-facing Team tool ')
    expect(text).toMatch(/…$/m)
    expect(text).not.toContain('tail-that-must-not-appear')
    expect(text).not.toContain('\t')
  })
})

describe('team_inbox renders triage, not a read', () => {
  it('header totals, both per-row counters (including zero direct), truncation conclusion, and a read route', () => {
    const text = renderText(teamTools().get('team_inbox')!, {}, {
      totalUnreadCount: 9, totalDirectCount: 2,
      items: [
        { threadRef: 'thread:aaaa1111-0000-4000-8000-000000000001', channelRef: CHANNEL, taskRef: TASK, status: 'in_progress', revision: 100, unreadCount: 4, directCount: 2, taskNumber: 7 },
        { threadRef: 'thread:bbbb2222-0000-4000-8000-000000000002', channelRef: CHANNEL, revision: 101, unreadCount: 3, directCount: 0 },
      ],
    })
    expect(text).toContain('Inbox — 9 unread update(s) total, 2 direct, across 2 Thread(s) shown')
    expect(text).toContain('thread:aaaa1111-0000-4000-8000-000000000001 · channel:046dd831-c679-4279-b6aa-7813476cf12e · task:3245ad40-43fd-4191-a416-7dcaf3a340f2 (#7), in_progress · 4 unread, 2 direct')
    expect(text).toContain('thread:bbbb2222-0000-4000-8000-000000000002 · channel:046dd831-c679-4279-b6aa-7813476cf12e · 3 unread, 0 direct')
    expect(text).toContain('team_thread read')
    expect(text).toContain('no write token')
  })

  it('a truncated bounded list says more exists; a drained list does not', () => {
    const truncated = renderText(teamTools().get('team_inbox')!, {}, {
      totalUnreadCount: 12, totalDirectCount: 5,
      items: [{ threadRef: 'thread:aaaa1111-0000-4000-8000-000000000001', channelRef: CHANNEL, revision: 100, unreadCount: 7, directCount: 3 }],
    })
    expect(truncated).toContain('beyond this bounded list')
    const drained = renderText(teamTools().get('team_inbox')!, {}, {
      totalUnreadCount: 2, totalDirectCount: 0,
      items: [{ threadRef: 'thread:aaaa1111-0000-4000-8000-000000000001', channelRef: CHANNEL, revision: 100, unreadCount: 2, directCount: 0 }],
    })
    expect(drained).not.toContain('beyond this bounded list')
  })

  it('empty inbox states there is no unread Team work', () => {
    const text = renderText(teamTools().get('team_inbox')!, {}, { totalUnreadCount: 0, totalDirectCount: 0, items: [] })
    expect(text).toContain('Inbox empty — no unread Team work.')
  })

  it('renders no subject, body, revision label, or write token', () => {
    const text = renderText(teamTools().get('team_inbox')!, {}, {
      totalUnreadCount: 1, totalDirectCount: 1,
      items: [{ threadRef: 'thread:aaaa1111-0000-4000-8000-000000000001', channelRef: CHANNEL, revision: 100, unreadCount: 1, directCount: 1 }],
    })
    expect(text).not.toContain('revision')
    expect(text).not.toContain('baseRevision')
    expect(text).not.toContain('Subject')
  })
})

describe('team_thread status/follow/unfollow render Attention only', () => {
  const base = {
    kind: 'status', threadRef: THREAD, taskRef: TASK, taskNumber: 7, revision: 8394, status: 'in_progress', resolution: 'open', following: true,
    anchor: { messageRef: 'message:anchor', sender: 'human', body: 'anchor body', sequence: 1 },
    claims: [{ claimRef: CLAIM, direction: 'renderer fidelity', state: 'active', owner: 'member:6e8a5b10-df16-4ec0-943a-63738010953f' }],
    facts: [],
  }
  it('status renders one Attention outcome line', () => {
    const text = renderText(teamTools().get('team_thread')!, { action: 'status', threadRef: THREAD }, base)
    expect(text).toBe(`Attention status — following ${THREAD} · ${TASK} (#7), in_progress/open.`)
  })

  it('follow/unfollow render one Attention-changed line; no anchor, Claims, facts, revision label, or token', () => {
    const follow = renderText(teamTools().get('team_thread')!, { action: 'follow', threadRef: THREAD }, { ...base, kind: 'follow' })
    expect(follow).toBe(`Attention changed — now following ${THREAD} · ${TASK} (#7), in_progress/open.`)
    const unfollow = renderText(teamTools().get('team_thread')!, { action: 'unfollow', threadRef: THREAD }, { ...base, kind: 'unfollow', following: false })
    expect(unfollow).toBe(`Attention changed — no longer following ${THREAD} · ${TASK} (#7), in_progress/open.`)
    for (const text of [follow, unfollow]) {
      expect(text).not.toContain('anchor body')
      expect(text).not.toContain(CLAIM)
      expect(text).not.toContain('revision')
      expect(text).not.toContain('baseRevision')
    }
  })

  it('a taskless Attention render omits Task standing', () => {
    const text = renderText(teamTools().get('team_thread')!, { action: 'status', threadRef: THREAD }, {
      kind: 'status', threadRef: THREAD, revision: 8394, following: false,
      anchor: { messageRef: 'message:anchor', sender: 'human', body: 'anchor body', sequence: 1 },
      claims: [], facts: [],
    })
    expect(text).toBe(`Attention status — not following ${THREAD}.`)
  })
})

describe('team_thread read orients by structured facts', () => {
  const anchor = { messageRef: 'message:anchor', sender: 'human', body: 'Systematically review the five model-facing Team tool results', sequence: 8888 }

  it('branch A: the anchor among the facts renders once, with no separate anchor line', () => {
    const text = renderText(teamTools().get('team_thread')!, { action: 'read', threadRef: THREAD }, {
      kind: 'read', threadRef: THREAD, taskRef: TASK, revision: 9004, status: 'in_progress', resolution: 'open', following: true,
      anchor,
      claims: [{ claimRef: CLAIM, direction: 'renderer fidelity', state: 'active', owner: 'member:6e8a5b10-df16-4ec0-943a-63738010953f' }],
      facts: [
        { sequence: 8888, kind: 'message', body: anchor.body, sender: 'human', mentions: [], unread: false, direct: false },
        { sequence: 9004, kind: 'message', body: 'Trace audit is ready', sender: 'member:6d5ac10d-3ef6-4466-a1f7-d105ca1b6da5', mentions: [], unread: true, direct: true },
      ],
      readThroughSequence: 9004, remainingUnreadCount: 0,
    })
    expect(occurrences(text, anchor.body)).toBe(1)
    expect(text).not.toContain(`Anchor ${anchor.sequence}`)
    expect(text).not.toContain('Subject —')
    expect(text).toContain('Active Claims')
    expect(text).toContain(`${CLAIM} — member:6e8a5b10-df16-4ec0-943a-63738010953f: renderer fidelity`)
    // Exactly one token hand-off at zero unread.
    expect(occurrences(text, 'baseRevision')).toBe(1)
    expect(text).toContain('Next write — baseRevision: 9004 (copy exactly; never derive or cite).')
  })

  it('branch B: unread===false background facts precede a full anchor; done Claims stay out of current context', () => {
    const text = renderText(teamTools().get('team_thread')!, { action: 'read', threadRef: THREAD }, {
      kind: 'read', threadRef: THREAD, taskRef: TASK, revision: 8402, status: 'in_progress', resolution: 'open', following: true,
      anchor,
      claims: [
        { claimRef: 'claim:old', direction: 'prior direction', state: 'done', owner: 'member:6e8a5b10-df16-4ec0-943a-63738010953f' },
        { claimRef: CLAIM, direction: 'renderer fidelity', state: 'active', owner: 'member:6e8a5b10-df16-4ec0-943a-63738010953f' },
      ],
      facts: [
        { sequence: 8387, kind: 'message', body: 'already-read background', sender: 'human', mentions: [], unread: false, direct: false },
        { sequence: 8402, kind: 'message', body: 'decision', sender: 'member:6d5ac10d-3ef6-4466-a1f7-d105ca1b6da5', mentions: [], unread: true, direct: true },
      ],
      readThroughSequence: 8402, remainingUnreadCount: 3,
    })
    // Full anchor renders before the facts.
    expect(text).toContain(`Anchor ${anchor.sequence} [human]`)
    expect(text).toContain(anchor.body)
    // Only the active Claim is current collision surface.
    expect(text).toContain(CLAIM)
    expect(text).not.toContain('claim:old')
    // Partial read: no token, told to read again.
    expect(text).not.toContain('baseRevision')
    expect(text).toContain('3 unread update(s) remaining — call team_thread read again.')
  })

  it('branch C: continuation read (no unread===false background) renders only the bounded subject', () => {
    const text = renderText(teamTools().get('team_thread')!, { action: 'read', threadRef: THREAD }, {
      kind: 'read', threadRef: THREAD, taskRef: TASK, revision: 9010, status: 'in_progress', resolution: 'open', following: true,
      anchor,
      claims: [],
      facts: [
        { sequence: 9010, kind: 'message', body: 'Show me the expected result, not a field table.', sender: 'human', mentions: [], unread: true, direct: true },
      ],
      readThroughSequence: 9010, remainingUnreadCount: 0,
    })
    expect(text).toContain(`  — ${'Systematically review the five model-facing Team tool results'}`)
    expect(text).not.toContain(`Anchor ${anchor.sequence} [`)
    expect(occurrences(text, 'baseRevision')).toBe(1)
  })

  it('unread Activity markers render inline on the fact line; no ellipsis-only second line exists', () => {
    const text = renderText(teamTools().get('team_thread')!, { action: 'read', threadRef: THREAD }, {
      kind: 'read', threadRef: THREAD, taskRef: TASK, revision: 8190, status: 'done', resolution: 'accepted', following: true,
      anchor: { messageRef: 'message:anchor', sender: 'human', body: 'anchor body', sequence: 1 },
      claims: [],
      facts: [{ sequence: 8190, kind: 'activity', activity: 'accept', actor: 'human', taskRef: TASK, completedClaimRefs: [CLAIM], acceptedClaimRefs: [CLAIM], unread: true, direct: false }],
      readThroughSequence: 8190, remainingUnreadCount: 0,
    })
    expect(text).toContain(`8190 human accept Task ${TASK} completed claims ${CLAIM} accepted claims ${CLAIM} [unread]`)
    expect(text).not.toContain('…')
    expect(text).not.toContain('(unread activity)')
  })

  it('an advice-carrying read keeps its guidance section and the token after it', () => {
    const text = renderText(teamTools().get('team_thread')!, { action: 'read', threadRef: THREAD }, {
      kind: 'read', threadRef: THREAD, taskRef: TASK, revision: 8190, status: 'done', resolution: 'accepted', following: true,
      anchor: { messageRef: 'message:anchor', sender: 'human', body: 'anchor body', sequence: 1 },
      claims: [],
      facts: [{ sequence: 8190, kind: 'activity', activity: 'accept', actor: 'human', taskRef: TASK, unread: true, direct: false }],
      readThroughSequence: 8190, remainingUnreadCount: 0,
      contextAdvice: { usageTokens: 96_000, taskBoundaryThreshold: 128_000, handoffAt: 200_000, hardLimit: 256_000, action: 'keep', guidance: 'Keep the current context.' },
    })
    expect(text).toContain('Context guidance — 96,000 tokens used')
    expect(text).toContain('Action: keep. Keep the current context.')
    expect(text.indexOf('Context guidance')).toBeLessThan(text.indexOf('Next write'))
  })

  it('a read with no new facts states it explicitly and still hands off the token', () => {
    const text = renderText(teamTools().get('team_thread')!, { action: 'read', threadRef: THREAD }, {
      kind: 'read', threadRef: THREAD, revision: 9010, following: true,
      anchor, claims: [], facts: [],
      readThroughSequence: 9010, remainingUnreadCount: 0,
    })
    expect(text).toContain('no unread updates on')
    expect(text).toContain('No new facts to acknowledge.')
    expect(text).toContain('Next write — baseRevision: 9010')
    expect(text).not.toContain('Active Claims')
  })
})

describe('team_thread history renders deep orientation only', () => {
  const anchor = { messageRef: 'message:anchor', sender: 'member:reeve', body: 'Systematically review the five model-facing Team tool results', sequence: 8888 }

  it('first page renders the full anchor unless the selected facts contain it', () => {
    const text = renderText(teamTools().get('team_thread')!, { action: 'history', threadRef: THREAD }, {
      kind: 'history', threadRef: THREAD, taskRef: TASK, revision: 9100, status: 'in_progress', resolution: 'open', following: true,
      anchor,
      claims: [{ claimRef: CLAIM, direction: 'd', state: 'active', owner: 'member:x' }],
      facts: [
        { sequence: 8973, kind: 'message', body: 'Compared the two complete interface families.', sender: 'member:reeve', mentions: [] },
        { sequence: 8990, kind: 'message', body: 'Added an independent trace sample.', sender: 'member:tars', mentions: [] },
      ],
      cursor: 8973, hasMore: true,
    })
    expect(text).toContain(`History for ${THREAD} · ${TASK}`)
    expect(text).toContain(`Anchor ${anchor.sequence} [member:reeve]`)
    expect(text).toContain(anchor.body)
    expect(text).toContain('History cursor 8973; hasMore=true — older facts exist; page again with beforeSequence set to the cursor.')
    // No current Claims snapshot, no advice, no token.
    expect(text).not.toContain('Active Claims')
    expect(text).not.toContain('Context guidance')
    expect(text).not.toContain('baseRevision')
    // When the anchor IS among the selected facts, it never duplicates.
    const withAnchor = renderText(teamTools().get('team_thread')!, { action: 'history', threadRef: THREAD }, {
      kind: 'history', threadRef: THREAD, revision: 9100, following: true,
      anchor,
      claims: [],
      facts: [{ sequence: 8888, kind: 'message', body: anchor.body, sender: 'member:reeve', mentions: [] }],
      cursor: 8888, hasMore: true,
    })
    expect(occurrences(withAnchor, anchor.body)).toBe(1)
    expect(withAnchor).not.toContain(`Anchor ${anchor.sequence} [`)
  })

  it('continuation pages render only the bounded subject', () => {
    const text = renderText(teamTools().get('team_thread')!, { action: 'history', threadRef: THREAD, beforeSequence: 8973 }, {
      kind: 'history', threadRef: THREAD, revision: 9100, following: true,
      anchor,
      claims: [],
      facts: [{ sequence: 8900, kind: 'message', body: 'An older fact.', sender: 'human', mentions: [] }],
      cursor: 8900, hasMore: false,
    })
    expect(text).toContain(`  — ${anchor.body.slice(0, 60)}`)
    expect(text).not.toContain(`Anchor ${anchor.sequence} [`)
    expect(text).toContain('History cursor 8900; hasMore=false — no older facts remain.')
  })

  it('an empty page states no facts before the cursor', () => {
    const text = renderText(teamTools().get('team_thread')!, { action: 'history', threadRef: THREAD }, {
      kind: 'history', threadRef: THREAD, revision: 9100, following: true,
      anchor,
      claims: [],
      facts: [],
      cursor: 8879, hasMore: false,
    })
    expect(text).toContain('No facts before this cursor.')
    expect(text).toContain('History cursor 8879; hasMore=false')
  })
})

describe('team_message renders its outcome', () => {
  it('start: Committed — Thread created with refs and exactly one token', () => {
    const text = renderText(teamTools().get('team_message')!, { action: 'start', channelRef: CHANNEL, body: 'x' }, {
      kind: 'committed', action: 'start', messageRef: 'message:9a1c', threadRef: THREAD, taskRef: TASK, revision: 8201,
    })
    expect(text).toContain('Committed — Thread created.')
    expect(text).toContain(`message:9a1c · ${THREAD} · ${TASK}`)
    expect(occurrences(text, 'baseRevision')).toBe(1)
    expect(text).toContain('Next write — baseRevision: 8201 (copy exactly; never derive or cite).')
  })

  it('reply: Committed — reply added with a different identity line', () => {
    const text = renderText(teamTools().get('team_message')!, { action: 'reply', threadRef: THREAD, baseRevision: 8201, body: 'x' }, {
      kind: 'committed', action: 'reply', messageRef: 'message:9a1d', threadRef: THREAD, revision: 8202,
    })
    expect(text).toContain('Committed — reply added.')
    expect(text).toContain(`message:9a1d · ${THREAD}`)
    expect(text).not.toContain('Thread created')
    expect(occurrences(text, 'baseRevision')).toBe(1)
  })

  it('dm: Delivered vs Recorded-not-delivered with the no-blind-duplicate warning', () => {
    const delivered = renderText(teamTools().get('team_message')!, { action: 'dm', memberRef: 'member:peer', body: 'x' }, {
      kind: 'dm-sent', recipientMemberId: 'member:peer', recipientHandle: 'Cole', delivered: true,
    })
    expect(delivered).toBe('Delivered — DM to @Cole (member:peer).')
    const recorded = renderText(teamTools().get('team_message')!, { action: 'dm', memberRef: 'member:peer', body: 'x' }, {
      kind: 'dm-sent', recipientMemberId: 'member:peer', recipientHandle: 'Cole', delivered: false, deliveryNote: 'no live session',
    })
    expect(recorded).toContain('Recorded, not delivered — DM to @Cole (member:peer).')
    expect(recorded).toContain('No automatic redelivery will occur; do not blindly send a duplicate.')
    expect(recorded).toContain('Reason: no live session')
  })

  it('typed rejections begin Not committed, keep refs/counts/recovery, and render no numeric revision or token', () => {
    const unread = renderText(teamTools().get('team_message')!, { action: 'reply', threadRef: THREAD, baseRevision: 8000, body: 'x' }, {
      kind: 'unread_required', threadRef: THREAD, taskRef: TASK, revision: 8394, unreadCount: 2, directCount: 1,
    })
    expect(unread).toContain('Not committed — unread_required.')
    expect(unread).toContain(`${THREAD} · ${TASK} · 2 unread, 1 direct`)
    expect(unread).toContain('team_thread read')
    expect(unread).not.toContain('8394')
    expect(unread).not.toContain('baseRevision')

    const stale = renderText(teamTools().get('team_message')!, { action: 'reply', threadRef: THREAD, baseRevision: 8387, body: 'x' }, {
      kind: 'stale_revision', threadRef: THREAD, expectedRevision: 8387, revision: 8394,
    })
    expect(stale).toContain('Not committed — the Thread changed after your last read (stale_revision).')
    expect(stale).toContain('Read the Thread, reconsider the new facts')
    expect(stale).not.toContain('8387')
    expect(stale).not.toContain('8394')
    expect(stale).not.toContain('baseRevision')

    const notFollowing = renderText(teamTools().get('team_message')!, { action: 'reply', threadRef: THREAD, baseRevision: 8394, body: 'x' }, {
      kind: 'member_not_following', memberIds: ['member:6d5ac10d-3ef6-4466-a1f7-d105ca1b6da5'], threadRef: THREAD,
    })
    expect(notFollowing).toContain('Not committed — member_not_following.')
    expect(notFollowing).toContain('member:6d5ac10d-3ef6-4466-a1f7-d105ca1b6da5 not following')
    expect(notFollowing).toContain('Only a Human can invite an unfollowed Agent')
  })
})

describe('team_claim renders the affected Claim', () => {
  it('list: active collision surface only, no token', () => {
    const text = renderText(teamTools().get('team_claim')!, { action: 'list', taskRef: TASK }, {
      kind: 'listed', taskRef: TASK, threadRef: THREAD, revision: 9024, status: 'in_progress',
      claims: [
        { claimRef: CLAIM, direction: 'Audit the render recovery paths', state: 'active', owner: 'member:owner' },
        { claimRef: 'claim:done', direction: 'finished angle', state: 'done', owner: 'member:owner' },
      ],
    })
    expect(text).toContain(`Claims for ${TASK} · ${THREAD} · in_progress`)
    expect(text).toContain('Active Claims')
    expect(text).toContain(`${CLAIM} — member:owner: Audit the render recovery paths`)
    expect(text).not.toContain('claim:done')
    expect(text).not.toContain('baseRevision')
    expect(text).not.toContain('revision')
  })

  it('list with no active Claims states it', () => {
    const text = renderText(teamTools().get('team_claim')!, { action: 'list', taskRef: TASK }, {
      kind: 'listed', taskRef: TASK, threadRef: THREAD, revision: 9024, status: 'todo',
      claims: [{ claimRef: 'claim:done', direction: 'finished', state: 'done', owner: 'member:owner' }],
    })
    expect(text).toContain('No active Claims.')
  })

  it('claim/done/release name different actions, render the affected Claim first, and hand off exactly one token', () => {
    const created = renderText(teamTools().get('team_claim')!, { action: 'claim', taskRef: TASK, baseRevision: 9024, direction: 'Audit the render recovery paths' }, {
      kind: 'committed', action: 'claim', taskRef: TASK, threadRef: THREAD, revision: 9028, status: 'in_progress',
      claim: { claimRef: CLAIM, direction: 'Audit the render recovery paths', state: 'active', owner: 'member:owner' }, claims: [],
    })
    expect(created).toContain('Committed — Claim created.')
    expect(created.indexOf(CLAIM)).toBeLessThan(created.indexOf(THREAD))
    expect(created).toContain(`${CLAIM} · active — member:owner: Audit the render recovery paths`)
    expect(occurrences(created, 'baseRevision')).toBe(1)

    const done = renderText(teamTools().get('team_claim')!, { action: 'done', taskRef: TASK, baseRevision: 9028, claimRef: CLAIM }, {
      kind: 'committed', action: 'done', taskRef: TASK, threadRef: THREAD, revision: 9024, status: 'in_review',
      claim: { claimRef: CLAIM, direction: 'd', state: 'done', owner: 'member:owner' }, claims: [],
    })
    expect(done).toContain('Committed — Claim completed.')
    expect(done).toContain('in_review')

    const released = renderText(teamTools().get('team_claim')!, { action: 'release', taskRef: TASK, baseRevision: 9028, claimRef: CLAIM }, {
      kind: 'committed', action: 'release', taskRef: TASK, threadRef: THREAD, revision: 9030, status: 'todo',
      claim: { claimRef: CLAIM, direction: 'd', state: 'released', owner: 'member:owner' }, claims: [],
    })
    expect(released).toContain('Committed — Claim released.')
    // A committed mutation appends no Claim archive: only the affected Claim renders.
    for (const text of [created, done, released]) {
      expect(occurrences(text, 'claim:')).toBe(1)
      expect(text).not.toContain('Active Claims')
    }
  })

  it('claim rejections share the outcome-first form with no numeric revision or token', () => {
    const unread = renderText(teamTools().get('team_claim')!, { action: 'claim', taskRef: TASK, baseRevision: 8000, direction: 'd' }, {
      kind: 'unread_required', taskRef: TASK, threadRef: THREAD, revision: 8394, unreadCount: 2, directCount: 1, claims: [],
    })
    expect(unread).toContain('Not committed — unread_required.')
    expect(unread).toContain(`${THREAD} · ${TASK} · 2 unread, 1 direct`)
    expect(unread).toContain('team_thread read')
    expect(unread).not.toContain('8394')
    expect(unread).not.toContain('baseRevision')
    expect(unread).not.toContain('Active Claims')

    const stale = renderText(teamTools().get('team_claim')!, { action: 'done', taskRef: TASK, baseRevision: 8387, claimRef: CLAIM }, {
      kind: 'stale_revision', taskRef: TASK, threadRef: THREAD, expectedRevision: 8387, revision: 8394, claims: [],
    })
    expect(stale).toContain('Not committed — the Thread changed after your last read (stale_revision).')
    expect(stale).not.toContain('8387')
    expect(stale).not.toContain('8394')
  })
})

describe('descriptions state the cross-tool workflow', () => {
  it('baseRevision parameter descriptions say copy verbatim and never increment/derive', () => {
    const tools = teamTools()
    for (const name of ['team_message', 'team_claim']) {
      const tool = tools.get(name)!
      const parameter = (tool.parameters as { properties?: Record<string, { description?: string }> }).properties?.baseRevision
      expect(parameter?.description).toContain('Copy the explicitly rendered value verbatim')
      expect(parameter?.description).toContain('never increment, derive, compare, or cite')
    }
  })

  it('team_thread description names read as the only token source; team_view says address book', () => {
    const tools = teamTools()
    expect(tools.get('team_thread')!.description).toContain('only source of a next-write token')
    expect(tools.get('team_view')!.description).toContain('address book')
    expect(tools.get('team_inbox')!.description).toContain('without marking anything read')
    expect(tools.get('team_claim')!.description).toContain('collision surface')
  })
})
