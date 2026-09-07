import { describe, expect, it } from 'vitest'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { apply } from '../src/index.ts'

/**
 * Decision-surface tests for every Team tool's model-facing result render.
 * The schema carries structured facts, but renders are the only channel a
 * result reaches the model through: each test here locks one field the
 * model needs for its next decision — refs to address, unread/direct
 * markers, pagination cursors, and error-retry fields — that a render
 * previously dropped or degraded.
 */
function tools(): Map<string, ToolDefinition> {
  const registered = new Map<string, ToolDefinition>()
  apply({ tools: { register: (tool: unknown) => {
    const definition = tool as ToolDefinition
    registered.set(definition.name, definition)
  } } } as never)
  return registered
}

function renderText(tool: ToolDefinition, value: unknown): string {
  const blocks = tool.output.render({}, value as never)
  return blocks.map(block => block.type === 'text' ? block.text : '').join('\n')
}

describe('team_message.start renders the refs it created', () => {
  it('a taskless start shows the new Thread ref so the model can act on it immediately', () => {
    const text = renderText(tools().get('team_message')!, {
      kind: 'committed', messageRef: 'message:9a1c', threadRef: 'thread:3f21b0e4-1111-4222-8333-444455556666',
      revision: 8201,
    })
    expect(text).toContain('message:9a1c')
    expect(text).toContain('thread:3f21b0e4-1111-4222-8333-444455556666')
    expect(text).toContain('8201')
  })

  it('a taskful start also shows the new Task ref', () => {
    const text = renderText(tools().get('team_message')!, {
      kind: 'committed', messageRef: 'message:9a1d', threadRef: 'thread:3f21b0e4-1111-4222-8333-444455556666',
      taskRef: 'task:0d7b2c41-aaaa-4bbb-8ccc-ddddeeeeffff', revision: 8202,
    })
    expect(text).toContain('thread:3f21b0e4-1111-4222-8333-444455556666')
    expect(text).toContain('task:0d7b2c41-aaaa-4bbb-8ccc-ddddeeeeffff')
  })
})

describe('team_message error paths render their retry fields', () => {
  it('unread_required names the Thread, its revision, and the pending unread counts', () => {
    const text = renderText(tools().get('team_message')!, {
      kind: 'unread_required', threadRef: 'thread:3f21b0e4-1111-4222-8333-444455556666',
      taskRef: 'task:0d7b2c41-aaaa-4bbb-8ccc-ddddeeeeffff', revision: 8394, unreadCount: 2, directCount: 1,
    })
    expect(text).toContain('unread_required')
    expect(text).toContain('thread:3f21b0e4-1111-4222-8333-444455556666')
    expect(text).toContain('8394')
    expect(text).toContain('2')
    expect(text).toContain('1')
  })

  it('stale_revision names the current revision to retry with, not only the rejected one', () => {
    const text = renderText(tools().get('team_message')!, {
      kind: 'stale_revision', threadRef: 'thread:3f21b0e4-1111-4222-8333-444455556666',
      expectedRevision: 8387, revision: 8394,
    })
    expect(text).toContain('stale_revision')
    expect(text).toContain('thread:3f21b0e4-1111-4222-8333-444455556666')
    expect(text).toContain('8387')
    expect(text).toContain('8394')
  })

  it('member_not_following names the Member refs that were not enrolled', () => {
    const text = renderText(tools().get('team_message')!, {
      kind: 'member_not_following', memberIds: ['member:6d5ac10d-3ef6-4466-a1f7-d105ca1b6da5'],
    })
    expect(text).toContain('member_not_following')
    expect(text).toContain('member:6d5ac10d-3ef6-4466-a1f7-d105ca1b6da5')
  })
})

describe('team_thread read/history render markers and pagination', () => {
  it('read shows unread/direct markers and the remaining-unread footer', () => {
    const text = renderText(tools().get('team_thread')!, {
      kind: 'read', threadRef: 'thread:d78400e4-4925-4065-87b1-3f81b4a4b5fb',
      taskRef: 'task:3245ad40-43fd-4191-a416-7dcaf3a340f2', revision: 8394, status: 'in_progress', resolution: 'open', following: true,
      anchor: { messageRef: 'message:anchor', sender: 'human', body: 'anchor', sequence: 1 },
      claims: [{ claimRef: 'claim:326f0b21-a41c-4c47-be18-ad0d4ecfc139', direction: 'renderer fidelity', state: 'active', owner: 'member:6e8a5b10-df16-4ec0-943a-63738010953f' }],
      facts: [
        { sequence: 8402, kind: 'message', body: 'decision', sender: 'member:6d5ac10d-3ef6-4466-a1f7-d105ca1b6da5', mentions: [], unread: true, direct: true },
        { sequence: 8387, kind: 'message', body: 'already-read background', sender: 'human', mentions: [], unread: false, direct: false },
      ],
      readThroughSequence: 8402, remainingUnreadCount: 3,
    })
    expect(text).toContain('claim:326f0b21-a41c-4c47-be18-ad0d4ecfc139')
    expect(text).toContain('member:6e8a5b10-df16-4ec0-943a-63738010953f')
    expect(text).toContain('326f0b21')
    expect(text).toContain('unread')
    expect(text).toContain('direct')
    expect(text).toContain('8402')
    expect(text).toContain('3')
  })

  it('history shows its cursor and whether older facts remain', () => {
    const text = renderText(tools().get('team_thread')!, {
      kind: 'history', threadRef: 'thread:d78400e4-4925-4065-87b1-3f81b4a4b5fb', revision: 8394, following: true,
      anchor: { messageRef: 'message:anchor', sender: 'human', body: 'anchor', sequence: 1 },
      claims: [],
      facts: [{ sequence: 8300, kind: 'message', body: 'older fact', sender: 'human', mentions: [] }],
      cursor: 8300, hasMore: true,
    })
    expect(text).toContain('8300')
    expect(text).toContain('hasMore')
    expect(text).toContain('true')
    const exhausted = renderText(tools().get('team_thread')!, {
      kind: 'history', threadRef: 'thread:d78400e4-4925-4065-87b1-3f81b4a4b5fb', revision: 8394, following: true,
      anchor: { messageRef: 'message:anchor', sender: 'human', body: 'anchor', sequence: 1 },
      claims: [],
      facts: [{ sequence: 8300, kind: 'message', body: 'older fact', sender: 'human', mentions: [] }],
      cursor: 8300, hasMore: false,
    })
    expect(exhausted).toContain('hasMore')
    expect(exhausted).toContain('false')
  })
})

describe('team_view renders pagination and Task-to-Thread mapping', () => {
  it('shows the cursor and hasMore so another page can be requested', () => {
    const text = renderText(tools().get('team_view')!, {
      channels: [{ channelRef: 'channel:046dd831-c679-4279-b6aa-7813476cf12e', name: 'general' }],
      members: [{ memberId: 'member:6e8a5b10-df16-4ec0-943a-63738010953f', kind: 'agent', handle: 'Tars', description: 'builder', presence: 'available' }],
      threads: [{ threadRef: 'thread:d78400e4-4925-4065-87b1-3f81b4a4b5fb', channelRef: 'channel:046dd831-c679-4279-b6aa-7813476cf12e', revision: 8394, messageCount: 120,
        taskRef: 'task:3245ad40-43fd-4191-a416-7dcaf3a340f2', status: 'in_progress', taskNumber: 7 }],
      tasks: [{ taskRef: 'task:3245ad40-43fd-4191-a416-7dcaf3a340f2', threadRef: 'thread:d78400e4-4925-4065-87b1-3f81b4a4b5fb', channelRef: 'channel:046dd831-c679-4279-b6aa-7813476cf12e', status: 'in_progress', revision: 8394 }],
      cursor: 8394, hasMore: true,
    })
    expect(text).toContain('cursor')
    expect(text).toContain('8394')
    expect(text).toContain('hasMore')
    expect(text).toContain('true')
  })

  it('Task rows include their Thread, Channel, and revision', () => {
    const text = renderText(tools().get('team_view')!, {
      channels: [],
      members: [],
      threads: [],
      tasks: [{ taskRef: 'task:3245ad40-43fd-4191-a416-7dcaf3a340f2', threadRef: 'thread:d78400e4-4925-4065-87b1-3f81b4a4b5fb', channelRef: 'channel:046dd831-c679-4279-b6aa-7813476cf12e', status: 'in_progress', revision: 8394 }],
      cursor: 0, hasMore: false,
    })
    expect(text).toContain('task:3245ad40-43fd-4191-a416-7dcaf3a340f2')
    expect(text).toContain('thread:d78400e4-4925-4065-87b1-3f81b4a4b5fb')
    expect(text).toContain('channel:046dd831-c679-4279-b6aa-7813476cf12e')
    expect(text).toContain('in_progress')
    expect(text).toContain('8394')
  })

  it('a page with nothing left states no more items follow', () => {
    const text = renderText(tools().get('team_view')!, {
      channels: [], members: [], threads: [], tasks: [], cursor: 0, hasMore: false,
    })
    expect(text).toContain('hasMore')
    expect(text).toContain('false')
  })
})

describe('team_inbox renders totals and per-item exact counts', () => {
  it('header totals prevent a limit-truncated list from reading as fully drained', () => {
    const text = renderText(tools().get('team_inbox')!, {
      totalUnreadCount: 9, totalDirectCount: 2,
      items: [{ threadRef: 'thread:d78400e4-4925-4065-87b1-3f81b4a4b5fb', channelRef: 'channel:046dd831-c679-4279-b6aa-7813476cf12e',
        taskRef: 'task:3245ad40-43fd-4191-a416-7dcaf3a340f2', status: 'in_progress', revision: 8394, unreadCount: 2, directCount: 1, taskNumber: 7 }],
    })
    expect(text).toContain('9')
    expect(text).toContain('2')
    expect(text).toContain('channel:046dd831-c679-4279-b6aa-7813476cf12e')
    expect(text).toContain('in_progress')
  })

  it('each item shows its exact unread and direct counts, not a bare direct flag', () => {
    const text = renderText(tools().get('team_inbox')!, {
      totalUnreadCount: 7, totalDirectCount: 3,
      items: [
        { threadRef: 'thread:aaaa1111-0000-4000-8000-000000000001', channelRef: 'channel:046dd831-c679-4279-b6aa-7813476cf12e', revision: 100, unreadCount: 4, directCount: 2 },
        { threadRef: 'thread:bbbb2222-0000-4000-8000-000000000002', channelRef: 'channel:046dd831-c679-4279-b6aa-7813476cf12e', revision: 101, unreadCount: 3, directCount: 0 },
      ],
    })
    const firstLine = text.split('\n').find(line => line.includes('thread:aaaa1111'))!
    expect(firstLine).toContain('4')
    expect(firstLine).toContain('2')
    expect(firstLine).not.toBe('direct')
    const secondLine = text.split('\n').find(line => line.includes('thread:bbbb2222'))!
    expect(secondLine).toContain('3')
    expect(secondLine).toContain('0')
  })
})

describe('team_claim error paths render their retry fields', () => {
  it('unread_required names the Task/Thread refs and pending counts', () => {
    const text = renderText(tools().get('team_claim')!, {
      kind: 'unread_required', taskRef: 'task:3245ad40-43fd-4191-a416-7dcaf3a340f2', threadRef: 'thread:d78400e4-4925-4065-87b1-3f81b4a4b5fb',
      revision: 8394, status: 'in_progress', unreadCount: 2, directCount: 1,
      claims: [],
    })
    expect(text).toContain('unread_required')
    expect(text).toContain('task:3245ad40-43fd-4191-a416-7dcaf3a340f2')
    expect(text).toContain('thread:d78400e4-4925-4065-87b1-3f81b4a4b5fb')
    expect(text).toContain('8394')
    expect(text).toContain('2')
    expect(text).toContain('1')
  })

  it('stale_revision names the current revision to retry with', () => {
    const text = renderText(tools().get('team_claim')!, {
      kind: 'stale_revision', taskRef: 'task:3245ad40-43fd-4191-a416-7dcaf3a340f2', threadRef: 'thread:d78400e4-4925-4065-87b1-3f81b4a4b5fb',
      expectedRevision: 8387, revision: 8394, status: 'in_progress',
      claims: [],
    })
    expect(text).toContain('stale_revision')
    expect(text).toContain('8387')
    expect(text).toContain('8394')
  })
})
