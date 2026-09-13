// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { runtimeWithTeam } from './harness.tsx'
import { STORAGE_KEY } from '../src/client/navigation.ts'

usePinnedBrowserLanguages('zh-CN')
afterEach(cleanup)
beforeEach(() => { localStorage.clear() })

/** One direct-only Inbox row as the Host emits it; workspaceId tags the source Workspace. */
function inboxRow(workspaceId: string, threadRef: string, overrides: Record<string, unknown> = {}): { readonly workspaceId: string } & Record<string, unknown> {
  return {
    workspaceId,
    channelRef: 'channel:engineering',
    channelName: 'engineering',
    taskNumber: 1,
    task: { taskRef: 'task:1', channelRef: 'channel:engineering', threadRef, status: 'in_progress', resolution: 'open' },
    thread: { threadRef, taskRef: 'task:1', revision: 5 },
    unreadCount: 1,
    directCount: 1,
    previewText: 'Decision needed on the rollout',
    newestSequence: 9,
    newestOccurredAt: '2026-09-13T04:00:00.000Z',
    ...overrides,
  }
}

describe('Team mention-Inbox surfaces', () => {
  it('shows the cross-Workspace direct badge on the wide card and hides it at zero', async () => {
    const b = await runtimeWithTeam({ mode: 'team', workspaceId: 'w1' })
    const card = await b.view.findByRole('button', { name: '提到我' })
    expect(card.getAttribute('aria-current')).toBeNull()
    expect(within(card).queryByText('3')).toBeNull()
    // The scaffold's parked first probe consumes one publish; the second wakes.
    b.seedInbox([inboxRow('w1', 'thread:w1'), inboxRow('w2', 'thread:w2', { directCount: 2, unreadCount: 2 })])
    b.seedInbox([inboxRow('w1', 'thread:w1'), inboxRow('w2', 'thread:w2', { directCount: 2, unreadCount: 2 })])
    await waitFor(() => expect(within(card).getByText('3')).toBeTruthy())
    await b.runtime.dispose()
  })

  it('opens the Inbox page from the card with rows and marks the card as the current page', async () => {
    const b = await runtimeWithTeam({ mode: 'team', workspaceId: 'w1' })
    const card = await b.view.findByRole('button', { name: '提到我' })
    b.seedInbox([inboxRow('w2', 'thread:w2')])
    b.seedInbox([inboxRow('w2', 'thread:w2')])
    await waitFor(() => expect(within(card).getByText('1')).toBeTruthy())
    fireEvent.click(card)
    // The rows replace the empty state: one merged row for the seeded Workspace.
    const row = await b.view.findByRole('button', { name: /Beta \/ #engineering/ })
    expect(row.textContent).toContain('Task #1')
    expect(row.textContent).toContain('Decision needed on the rollout')
    expect(b.view.container.querySelector('[data-team-inbox] time')?.getAttribute('dateTime')).toBe('2026-09-13T04:00:00.000Z')
    expect(b.view.queryByText('还没有人提到你')).toBeNull()
    await waitFor(() => expect(card.getAttribute('aria-current')).toBe('page'))
    await b.runtime.dispose()
  })

  it('shows the empty state while nothing mentions the Human', async () => {
    const b = await runtimeWithTeam({ mode: 'team', workspaceId: 'w1' })
    fireEvent.click(await b.view.findByRole('button', { name: '提到我' }))
    expect(await b.view.findByText('还没有人提到你')).toBeTruthy()
    expect(b.view.getByText('需要你知道或做决定时，成员会提到你')).toBeTruthy()
    await b.runtime.dispose()
  })

  it('opens the row Thread through selectWorkspace + selectThread, drops the badge, and lands Back on its Channel', async () => {
    const b = await runtimeWithTeam({ mode: 'team', workspaceId: 'w1', seededMessages: [{ body: 'Thread opener', occurredAt: '2026-09-13T03:00:00.000Z' }], remainingUnreadCounts: [0], initialChannels: true, seedThreadRef: 'thread:w2' })
    const card = await b.view.findByRole('button', { name: '提到我' })
    b.seedInbox([inboxRow('w2', 'thread:w2')])
    b.seedInbox([inboxRow('w2', 'thread:w2')])
    await waitFor(() => expect(within(card).getByText('1')).toBeTruthy())
    fireEvent.click(card)
    const row = await b.view.findByRole('button', { name: /Beta \/ #engineering/ })
    fireEvent.click(row)
    // The row's own Workspace is selected first, then the Thread: the durable
    // read consumes the mention, and the persisted location is Thread + its
    // Channel — never the Inbox.
    await waitFor(() => expect(b.readThread).toHaveBeenCalled())
    // The badge drops from the completed read itself — reads never ride a
    // changes wake.
    await waitFor(() => expect(within(card).queryByText('1')).toBeNull())
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '')).toMatchObject({ mode: 'team', workspaceId: 'w2', channelRef: 'channel:engineering', threadRef: 'thread:w2' })
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '')).not.toHaveProperty('inbox')
    // Back goes to the Thread's Channel, not the Inbox.
    fireEvent.click(await b.view.findByRole('button', { name: '返回频道' }))
    await waitFor(() => expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '')).not.toHaveProperty('threadRef'))
    expect(b.view.container.querySelector('[data-team-inbox]')).toBeNull()
    await b.runtime.dispose()
  })

  it('orders the narrow rail 提到我 → Channels → Agents with the badge on the Inbox icon', async () => {
    const b = await runtimeWithTeam({ mode: 'team', workspaceId: 'w1' })
    // Collapse the fixture sidebar to the narrow rail.
    fireEvent.click(b.view.container.querySelector('[data-test-control]')!)
    const rail = await waitFor(() => {
      const nav = b.view.container.querySelector('nav[class*="railWorkspace"]')
      expect(nav).toBeTruthy()
      return nav as HTMLElement
    })
    const labels = [...rail.querySelectorAll('button')].map(button => button.getAttribute('aria-label'))
    expect(labels).toEqual(['提到我', '频道', 'Agents'])
    b.seedInbox([inboxRow('w1', 'thread:w1')])
    b.seedInbox([inboxRow('w1', 'thread:w1')])
    const inboxButton = within(rail).getByRole('button', { name: '提到我' })
    await waitFor(() => expect(within(inboxButton).getByText('1')).toBeTruthy())
    // The rail icon is a destination: clicking it opens the Inbox page and
    // asks the shell to expand the sidebar again.
    fireEvent.click(inboxButton)
    await waitFor(() => expect(b.view.container.querySelector('[data-team-inbox]')).toBeTruthy())
    await b.runtime.dispose()
  })

  it('requests only the direct-only slice for the badge and the Inbox page', async () => {
    const b = await runtimeWithTeam({ mode: 'team', workspaceId: 'w1' })
    const card = await b.view.findByRole('button', { name: '提到我' })
    b.seedInbox([inboxRow('w1', 'thread:w1')])
    b.seedInbox([inboxRow('w1', 'thread:w1')])
    await waitFor(() => expect(within(card).getByText('1')).toBeTruthy())
    fireEvent.click(card)
    await waitFor(() => expect(b.view.getByRole('button', { name: /Alpha \/ #engineering/ })).toBeTruthy())
    // The double returns rows only for directOnly calls, so the visible badge
    // and row already prove the flag rode the requests; assert it explicitly
    // so a dropped flag can never pass silently again.
    expect(b.inbox.mock.calls.length).toBeGreaterThan(0)
    for (const [request] of b.inbox.mock.calls) expect(request.directOnly).toBe(true)
    await b.runtime.dispose()
  })
})
