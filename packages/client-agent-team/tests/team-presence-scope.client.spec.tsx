// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, waitFor } from '@testing-library/react'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { runtimeWithTeam } from './harness.tsx'

usePinnedBrowserLanguages('zh-CN')
afterEach(cleanup)
beforeEach(() => { localStorage.clear() })

describe('presence-scope wake wiring (issue #21)', () => {
  it('refreshes member rows on a presence wake without catalog or Inbox refetches', async () => {
    const b = await runtimeWithTeam({ mode: 'team', workspaceId: 'w1', initialChannels: true })
    await waitFor(() => expect(b.members.mock.calls.length).toBeGreaterThanOrEqual(1))
    await waitFor(() => expect(b.viewChannels.mock.calls.length).toBeGreaterThanOrEqual(1))
    const inboxCalls = b.inbox.mock.calls.length
    const channelCalls = b.viewChannels.mock.calls.length
    const memberCalls = b.members.mock.calls.length

    // Agent running/idle reaches the Client as a presence-scope wake: the
    // Agents panel refreshes its rows (green dots), while the Channels
    // panel's view() and the scope-less Inbox badge stay parked. The first
    // publish is consumed by each poll's silent probe, so publish twice; the
    // badge also debounces, so wait past that window before asserting
    // stillness.
    b.publishPresence()
    b.publishPresence()
    await waitFor(() => expect(b.members.mock.calls.length).toBeGreaterThan(memberCalls))
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(b.viewChannels.mock.calls.length).toBe(channelCalls)
    expect(b.inbox.mock.calls.length).toBe(inboxCalls)

    // A workspace commit still refreshes the sidebar catalog.
    b.publishChannelUpdate()
    b.publishChannelUpdate()
    await waitFor(() => expect(b.viewChannels.mock.calls.length).toBeGreaterThan(channelCalls))
    await b.runtime.dispose()
  })
})
