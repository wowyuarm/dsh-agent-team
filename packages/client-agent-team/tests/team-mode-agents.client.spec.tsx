// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { runtimeWithTeam } from './harness.tsx'

usePinnedBrowserLanguages('zh-CN')
afterEach(cleanup)
beforeEach(() => { localStorage.clear() })

describe('Team agent surfaces', () => {
  it('renders agent rows draggable with the saved personal order folded in', async () => {
    const b = await runtimeWithTeam({ mode: 'team', workspaceId: 'w1' })
    await waitFor(() => expect(b.view.container.querySelectorAll('[draggable="true"]').length).toBeGreaterThanOrEqual(4))
    const rows = b.view.container.querySelectorAll('[draggable="true"]')
    for (const row of rows) expect(row.querySelector('[class*="agentSelect"]')).not.toBeNull()
    await b.runtime.dispose()
  })

  it('enters Team with existing Workspaces and restores the shipped seats', async () => {
    const b = await runtimeWithTeam()
    expect(b.view.getByText('普通工作区')).toBeTruthy()
    // The conversation seat carries the shipped ConversationRoot; its
    // resident [data-composer-seat] node stands in for the old baseline text.
    expect(b.view.container.querySelector('[data-composer-seat]')).toBeTruthy()
    fireEvent.click(b.view.getByRole('button', { name: '团队' }))
    await waitFor(() => expect(document.documentElement.dataset.agentTeamMode).toBe('team'))
    expect(b.runtime.sessions.list.getSnapshot().current).toBe('ordinary-session')
    expect(await b.view.findByRole('heading', { name: '频道' })).toBeTruthy()
    expect(b.view.getAllByText('Alpha')).toHaveLength(2)
    expect(b.view.queryByText('设置')).toBeNull()
    const membersTrigger = b.view.getByRole('button', { name: '成员' })
    const delayedMembers = Promise.withResolvers<Awaited<ReturnType<typeof b.members>>>()
    b.members.mockReturnValueOnce(delayedMembers.promise)
    fireEvent.click(membersTrigger)
    const membersDialog = await b.view.findByRole('dialog', { name: '成员' })
    expect(within(membersDialog).getByRole('status').textContent).toContain('正在加载 Agent')
    delayedMembers.resolve({ ok: true, value: [b.status('member:builder', 'w1', 'builder', 'available')] } as never)
    await waitFor(() => expect(within(membersDialog).getAllByText('@builder')).toHaveLength(2))
    expect(within(membersDialog).getByText('Alpha')).toBeTruthy()
    expect(within(membersDialog).getByText('Beta')).toBeTruthy()
    const membersContent = membersDialog.querySelector('[tabindex="-1"]')
    await waitFor(() => expect(document.activeElement).toBe(membersContent))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(b.view.queryByRole('dialog', { name: '成员' })).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(membersTrigger))
    b.members.mockRejectedValueOnce(new Error('members transport failed'))
    fireEvent.click(membersTrigger)
    expect((await b.view.findByRole('alert')).textContent).toContain('members transport failed')
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(document.activeElement).toBe(membersTrigger))

    fireEvent.click(b.view.getByRole('button', { name: '对话' }))
    await waitFor(() => expect(document.documentElement.dataset.agentTeamMode).toBeUndefined())
    expect(await b.view.findByText('普通工作区')).toBeTruthy()
    expect(b.view.container.querySelector('[data-composer-seat]')).toBeTruthy()
    expect(await b.view.findByText('设置')).toBeTruthy()
    expect(b.runtime.sessions.list.getSnapshot().current).toBe('ordinary-session')
    await b.runtime.dispose()
  })

  it('loads Workspace Agents and creates a durable Member without optimistic rows', async () => {
    const b = await runtimeWithTeam({ initialChannels: true })
    fireEvent.click(b.view.getByRole('button', { name: '团队' }))
    expect(await b.view.findByText('从左侧选择一个频道开始协作')).toBeTruthy()

    expect(await b.view.findByText('builder')).toBeTruthy()
    expect(b.view.getByRole('img', { name: '可用' })).toBeTruthy()
    expect(b.view.getByRole('img', { name: '工作中' })).toBeTruthy()
    expect(b.view.getByRole('img', { name: '错误: model failed' })).toBeTruthy()
    expect(b.view.getByRole('img', { name: '不可用: preset missing' })).toBeTruthy()
    expect(b.members).toHaveBeenCalledWith({ workspaceId: 'w1' })

    const addAgentTrigger = b.view.getByRole('button', { name: '添加 Agent' })
    fireEvent.click(addAgentTrigger)
    expect(b.view.getByRole('dialog', { name: '添加 Agent' })).toBeTruthy()
    const agentName = b.view.getByLabelText('名称')
    await waitFor(() => expect(document.activeElement).toBe(agentName))
    fireEvent.change(agentName, { target: { value: 'reviewer' } })
    fireEvent.change(b.view.getByLabelText(/说明/), { target: { value: 'Reviews changes' } })
    // Creation has no Channel page: the Member joins Channels later from the
    // Channel side and stays reachable through its DM view meanwhile.
    expect(b.view.queryByRole('button', { name: /初始频道/ })).toBeNull()
    b.addMember.mockResolvedValueOnce({ ok: false, error: { message: 'connection lost' } } as never)
    fireEvent.click(b.view.getByRole('button', { name: '创建 Agent' }))
    expect((await b.view.findByRole('alert')).textContent).toContain('connection lost')
    expect((b.view.getByLabelText('名称') as HTMLInputElement).value).toBe('reviewer')
    expect(b.view.queryByText('reviewer')).toBeNull()
    fireEvent.click(b.view.getByRole('button', { name: '创建 Agent' }))

    expect(await b.view.findByText('reviewer')).toBeTruthy()
    expect(b.addMember).toHaveBeenLastCalledWith(expect.objectContaining({
      workspaceId: 'w1', channelRefs: [], handle: 'reviewer', description: 'Reviews changes', presetId: 'team-member',
    }))
    expect(b.addMember.mock.calls[0]![0].requestId).toBe(b.addMember.mock.calls[1]![0].requestId)
    await waitFor(() => expect(document.activeElement).toBe(addAgentTrigger))
    fireEvent.click(addAgentTrigger)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(b.view.queryByRole('dialog', { name: '添加 Agent' })).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(addAgentTrigger))
    await b.runtime.dispose()
  })

  it('creates an Agent with empty description, no Channels, and an optional model', async () => {
    const b = await runtimeWithTeam({ initialChannels: true })
    fireEvent.click(b.view.getByRole('button', { name: '团队' }))
    await b.view.findByText('builder')
    fireEvent.click(b.view.getByRole('button', { name: '添加 Agent' }))
    fireEvent.change(b.view.getByLabelText('名称'), { target: { value: 'bare' } })
    // Description stays empty; the placeholder marks it optional.
    expect(b.view.getByPlaceholderText('留空则暂无描述')).toBeTruthy()
    // Pick a model through the capped menu; pinning reveals the effort row.
    fireEvent.click(await b.view.findByRole('button', { name: '模型' }))
    fireEvent.click(await within(document.body).findByRole('menuitem', { name: 'DeepSeek Chat' }))
    fireEvent.click(b.view.getByRole('button', { name: /推理强度/ }))
    fireEvent.click(await within(document.body).findByRole('menuitem', { name: 'high' }))
    // No Channel picker exists at creation; Channels join later from the Channel side.
    expect(b.view.queryByText('选择初始频道')).toBeNull()
    fireEvent.click(b.view.getByRole('button', { name: '创建 Agent' }))
    expect(await b.view.findByText('bare')).toBeTruthy()
    expect(b.addMember).toHaveBeenLastCalledWith(expect.objectContaining({
      workspaceId: 'w1', handle: 'bare', description: '', presetId: 'team-member', channelRefs: [],
      model: { provider: 'deepseek-official', model: 'deepseek-chat', reasoningEffort: 'high' },
    }))
    await b.runtime.dispose()
  })

  it('creates a Channel atomically with selected available Members and manages committed membership', async () => {
    const b = await runtimeWithTeam()
    fireEvent.click(b.view.getByRole('button', { name: '团队' }))
    expect(await b.view.findByText('还没有频道')).toBeTruthy()
    fireEvent.click(b.view.getByRole('button', { name: '新建频道' }))
    fireEvent.change(b.view.getByLabelText('名称'), { target: { value: 'backend' } })
    fireEvent.change(b.view.getByLabelText(/说明/), { target: { value: 'API implementation' } })
    fireEvent.click(b.view.getByRole('button', { name: /初始成员/ }))
    const unavailable = await within(document.body).findByRole('menuitem', { name: /offline/ }) as HTMLButtonElement
    expect(unavailable.disabled).toBe(true)
    fireEvent.click(await within(document.body).findByRole('menuitem', { name: /builder/ }))
    b.createChannel.mockResolvedValueOnce({ ok: false, error: { message: 'connection lost' } } as never)
    fireEvent.click(b.view.getByRole('button', { name: '创建频道' }))
    expect((await b.view.findByRole('alert')).textContent).toContain('connection lost')
    fireEvent.click(b.view.getByRole('button', { name: '创建频道' }))

    expect(await b.view.findByText('# backend')).toBeTruthy()
    expect(b.createChannel).toHaveBeenLastCalledWith(expect.objectContaining({
      workspaceId: 'w1', name: 'backend', description: 'API implementation', memberIds: ['member:builder'],
    }))
    expect(b.createChannel.mock.calls[0]![0].requestId).toBe(b.createChannel.mock.calls[1]![0].requestId)
    fireEvent.click(b.view.getByRole('button', { name: '# backend' }))
    fireEvent.click(await b.view.findByRole('button', { name: '管理成员' }))
    const manager = b.view.getByRole('dialog', { name: '频道成员' })
    expect(within(manager).getByText('@builder')).toBeTruthy()
    fireEvent.click(within(manager).getByRole('button', { name: '移除' }))
    await waitFor(() => { expect(b.removeChannelMember).toHaveBeenCalledWith(expect.objectContaining({ memberId: 'member:builder' })) })
    await b.runtime.dispose()
  })

  it('edits Channel membership from the sidebar row menu with idempotent retries', async () => {
    const b = await runtimeWithTeam({ initialChannels: true })
    fireEvent.click(b.view.getByRole('button', { name: '团队' }))
    expect(await b.view.findByText('# engineering')).toBeTruthy()

    fireEvent.click(b.view.getByRole('button', { name: 'engineering 的操作' }))
    fireEvent.click(await b.view.findByRole('menuitem', { name: '编辑频道' }))
    const editor = b.view.getByRole('dialog', { name: '编辑频道' })
    expect(within(editor).getByText('@builder')).toBeTruthy()
    // The fixture starts with an empty membership: builder's row offers Add.
    const builderRow = within(editor).getByText('@builder').closest('div') as HTMLElement
    expect(within(builderRow).getByRole('button', { name: '添加' })).toBeTruthy()
    // Offline members cannot join from here; their row stays disabled.
    const offlineRow = within(editor).getByText('@offline').closest('div') as HTMLElement
    expect((within(offlineRow).getByRole('button', { name: '添加' }) as HTMLButtonElement).disabled).toBe(true)

    b.joinChannel.mockResolvedValueOnce({ ok: false, error: { message: 'membership failed' } } as never)
    fireEvent.click(within(builderRow).getByRole('button', { name: '添加' }))
    expect(within(builderRow).getByRole('button', { name: '更新中…' })).toBeTruthy()
    expect((await within(builderRow).findByRole('alert')).textContent).toContain('membership failed')
    fireEvent.click(within(builderRow).getByRole('button', { name: '添加' }))
    await waitFor(() => { expect(b.joinChannel).toHaveBeenCalledTimes(2) })
    // The retry reuses the committed direction's request id until success.
    expect(b.joinChannel.mock.calls[0]![0].requestId).toBe(b.joinChannel.mock.calls[1]![0].requestId)
    await waitFor(() => { expect(within(builderRow).getByRole('button', { name: '移除' })).toBeTruthy() })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(b.view.queryByRole('dialog', { name: '编辑频道' })).toBeNull()
    await b.runtime.dispose()
  })

  it('renames Channel display facts from the editor and refreshes the row', async () => {
    const b = await runtimeWithTeam({ initialChannels: true })
    fireEvent.click(b.view.getByRole('button', { name: '团队' }))
    expect(await b.view.findByText('# engineering')).toBeTruthy()

    fireEvent.click(b.view.getByRole('button', { name: 'engineering 的操作' }))
    fireEvent.click(await b.view.findByRole('menuitem', { name: '编辑频道' }))
    const editor = b.view.getByRole('dialog', { name: '编辑频道' })
    // Save stays disabled until something actually changes.
    expect(((within(editor).getByRole('button', { name: '保存' }) as HTMLButtonElement)).disabled).toBe(true)
    fireEvent.change(within(editor).getByLabelText('名称'), { target: { value: 'platform' } })
    fireEvent.change(within(editor).getByLabelText(/说明/), { target: { value: 'Infrastructure work' } })
    fireEvent.click(within(editor).getByRole('button', { name: '保存' }))
    await waitFor(() => { expect(b.updateChannel).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'w1', channelRef: 'channel:engineering', name: 'platform', description: 'Infrastructure work',
    })) })
    // The committed rename rides the projection refresh, not an optimistic row edit.
    expect(await b.view.findByText('# platform')).toBeTruthy()
    expect(b.view.queryByText('# engineering')).toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    await b.runtime.dispose()
  })

  it('offers 恢复 and 重启 in the row menu only where they apply and routes both through the Host remote', async () => {
    const b = await runtimeWithTeam({ initialChannels: true })
    fireEvent.click(b.view.getByRole('button', { name: '团队' }))
    await b.view.findByText('builder')

    // A healthy Member's menu carries only the editor entry.
    fireEvent.click(b.view.getByRole('button', { name: 'builder 的操作' }))
    const healthyMenu = await within(document.body).findByRole('menu')
    expect(within(healthyMenu).getByRole('menuitem', { name: '编辑 Agent' })).toBeTruthy()
    expect(within(healthyMenu).queryAllByRole('menuitem', { name: '恢复' })).toEqual([])
    expect(within(healthyMenu).queryAllByRole('menuitem', { name: '重启' })).toEqual([])
    // The error Member additionally gets the recovery entry.
    fireEvent.click(b.view.getByRole('button', { name: 'failed 的操作' }))
    fireEvent.click(await within(document.body).findByRole('menuitem', { name: '恢复' }))
    await waitFor(() => {
      expect(b.recoverMember).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'w1', memberId: 'member:failed' }))
    })
    // The unavailable Member gets the restart entry for a failed activation.
    fireEvent.click(b.view.getByRole('button', { name: 'offline 的操作' }))
    fireEvent.click(await within(document.body).findByRole('menuitem', { name: '重启' }))
    await waitFor(() => {
      expect(b.recoverMember).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'w1', memberId: 'member:offline' }))
    })
    // A restart that leaves the Member unavailable surfaces the diagnostic on the row.
    const alert = await b.view.findByRole('alert')
    expect(alert.textContent).toContain('重启已执行，成员仍不可用：preset missing')
    // A transport rejection surfaces as the row alert too.
    b.recoverMember.mockRejectedValueOnce(new Error('connection lost'))
    fireEvent.click(b.view.getByRole('button', { name: 'offline 的操作' }))
    fireEvent.click(await within(document.body).findByRole('menuitem', { name: '重启' }))
    await waitFor(() => { expect(b.view.getByRole('alert').textContent).toContain('重启执行失败：connection lost') })
    await b.runtime.dispose()
  })

  it('retires the manual clear-context action and follows a Member rollover exactly once', async () => {
    const b = await runtimeWithTeam({ initialChannels: true })
    fireEvent.click(b.view.getByRole('button', { name: '团队' }))
    await b.view.findByText('builder')

    // The manual clear-context row action is retired: Members manage their
    // own context through the new_context tool, and every row menu —
    // available, working, error, unavailable — omits the entry entirely.
    for (const handle of ['builder', 'worker', 'failed', 'offline']) {
      fireEvent.click(b.view.getByRole('button', { name: `${handle} 的操作` }))
      const menu = await within(document.body).findByRole('menu')
      expect(within(menu).queryByRole('menuitem', { name: '从全新上下文开始' })).toBeNull()
      fireEvent.keyDown(document, { key: 'Escape' })
    }

    // While no Member page is embedded, a rollover binding change never
    // redirects the conversation seat.
    // Prime the change stream: the first wake advances the probe loop so
    // later publishes reach the listener (no roster change is attached to it).
    b.publishChannelUpdate()
    await new Promise(resolve => setTimeout(resolve, 30))
    b.members.mockImplementation(async () => ({ ok: true, value: [
      b.status('member:builder', 'w1', 'builder', 'available'),
    ].map(entry => ({ ...entry, member: { ...entry.member, sessionId: 'session:builder-next' } })) }))
    b.publishChannelUpdate()
    // The roster now reports only builder on the new binding: wait for the
    // refresh to land (worker's row disappears) before opening the page.
    await waitFor(() => { expect(b.view.queryByRole('button', { name: '打开 worker 的会话' })).toBeNull() }, { timeout: 3000 })
    expect(b.runtime.sessions.calls.some(call => call.method === 'open' && String(call.args[0]).includes('builder-next'))).toBe(false)

    // Open the Member's live page: the conversation seat embeds the
    // post-rollover Session the roster now reports.
    await b.runtime.sessions.add({ id: 'session:builder-next' as never, summary: { title: 'builder', cwd: '/work/alpha' } } as never)
    fireEvent.click(b.view.getByRole('button', { name: '打开 builder 的会话' }))
    await waitFor(() => {
      expect(b.view.getByRole('button', { name: '打开 builder 的会话' }).getAttribute('aria-current')).toBe('page')
    })
    const opened = b.runtime.sessions.calls.filter(call => call.method === 'open').length

    // A rollover that lands while the commit window still reports the Member
    // unavailable does not redirect — the new Session does not exist for the
    // client yet.
    b.members.mockImplementation(async () => ({ ok: true, value: [
      { ...b.status('member:builder', 'w1', 'builder', 'unavailable', 'context rollover in progress'), member: { ...b.status('member:builder', 'w1', 'builder', 'unavailable').member, sessionId: 'session:builder-next-2' } },
    ] }))
    b.publishChannelUpdate()
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(b.runtime.sessions.calls.filter(call => call.method === 'open').length).toBe(opened)

    // Navigating away during the commit window cancels the follow: leaving
    // the Member page (back onto a Channel) rebinds the seat, so the later
    // active refresh must not yank the pane onto the new Session.
    fireEvent.click(b.view.getByRole('button', { name: '# engineering' }))
    await waitFor(() => { expect(b.view.getByRole('button', { name: '打开 builder 的会话' }).getAttribute('aria-current')).toBe(null) })
    b.members.mockImplementation(async () => ({ ok: true, value: [
      b.status('member:builder', 'w1', 'builder', 'available'),
    ].map(entry => ({ ...entry, member: { ...entry.member, sessionId: 'session:builder-next-2' } })) }))
    b.publishChannelUpdate()
    await new Promise(resolve => setTimeout(resolve, 80))
    expect(b.runtime.sessions.calls.filter(call => call.method === 'open' && String(call.args[0]).includes('builder-next-2')).length).toBe(0)

    // Returning to the Member page after the rollover settled opens the
    // post-rollover generation directly — the observation baseline has
    // already absorbed the change, so no pending follow remains.
    await b.runtime.sessions.add({ id: 'session:builder-next-2' as never, summary: { title: 'builder', cwd: '/work/alpha' } } as never)
    fireEvent.click(b.view.getByRole('button', { name: '打开 builder 的会话' }))
    await waitFor(() => {
      expect(b.runtime.sessions.calls.filter(call => call.method === 'open' && String(call.args[0]).includes('builder-next-2')).length).toBe(1)
    })
    await b.runtime.dispose()
  })

  it('edits Agent identity and pins a Member model through the editor', async () => {
    const b = await runtimeWithTeam({ initialChannels: true })
    fireEvent.click(b.view.getByRole('button', { name: '团队' }))
    await b.view.findByText('builder')

    fireEvent.click(b.view.getByRole('button', { name: 'builder 的操作' }))
    fireEvent.click(await b.view.findByRole('menuitem', { name: '编辑 Agent' }))
    const editor = b.view.getByRole('dialog', { name: '编辑 Agent' })
    // The Host catalog arrives session-independently; the picker rides the
    // shared Menu primitive with the default entry leading each open.
    const modelTrigger = await within(editor).findByRole('button', { name: '模型' })
    await waitFor(() => { expect(modelTrigger.textContent).toContain('跟随全局默认') })
    fireEvent.click(modelTrigger)
    const modelMenu = within(document.body).getByRole('menu')
    expect(within(modelMenu).getByText('DeepSeek')).toBeTruthy()
    fireEvent.click(within(modelMenu).getByRole('menuitem', { name: 'DeepSeek Reasoner' }))
    await waitFor(() => { expect(modelTrigger.textContent).toContain('DeepSeek Reasoner') })
    fireEvent.change(within(editor).getByLabelText('名称'), { target: { value: 'architect' } })
    fireEvent.change(within(editor).getByLabelText(/说明/), { target: { value: 'System design owner' } })
    fireEvent.click(within(editor).getByRole('button', { name: '保存' }))
    await waitFor(() => { expect(b.updateMember).toHaveBeenCalledWith(expect.objectContaining({
      memberId: 'member:builder', handle: 'architect', description: 'System design owner',
      model: { provider: 'deepseek-official', model: 'deepseek-reasoner' },
    })) })
    // The renamed handle reaches the roster through the refreshed projection.
    expect(await b.view.findByText('architect')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    await b.runtime.dispose()
  })

  it('opens the Member Session inside Team mode from the Agent card', async () => {
    const b = await runtimeWithTeam({ mode: 'team', workspaceId: 'w1', initialChannels: true })
    await b.runtime.sessions.add({ id: 'session:member:builder' as never, summary: { title: 'builder', cwd: '/work/alpha' } } as never)
    await b.view.findByText('builder')
    fireEvent.click(await b.view.findByRole('button', { name: '# engineering' }))
    expect(await b.view.findByRole('heading', { name: '# engineering' })).toBeTruthy()
    expect(document.documentElement.dataset.agentTeamMode).toBe('team')
    // Team views own the conversation seat before the card click.
    expect(b.view.container.querySelector('[data-phase]')).toBeNull()

    fireEvent.click(b.view.getByRole('button', { name: '打开 builder 的会话' }))
    await waitFor(() => {
      expect(b.runtime.sessions.calls.some(call => call.method === 'open' && call.args[0] === 'session:member:builder')).toBe(true)
    })
    // The card stays inside Team mode: the chrome remains mounted and the
    // conversation seat yields to the shipped root rendering the Member Session.
    expect(document.documentElement.dataset.agentTeamMode).toBe('team')
    await waitFor(() => { expect(b.view.container.querySelector('[data-phase]')).toBeTruthy() })
    expect(b.view.container.querySelector('[data-team-conversation]')).toBeNull()
    // The single positioning highlight moves to the selected Agent card; the
    // workspace overview row goes quiet.
    const card = b.view.getByRole('button', { name: '打开 builder 的会话' })
    await waitFor(() => { expect(card.getAttribute('aria-current')).toBe('page') })
    for (const row of b.view.container.querySelectorAll('[aria-current="page"]')) {
      expect(row).toBe(card)
    }

    // Explicit Team navigation closes the embedded Member view again.
    fireEvent.click(await b.view.findByRole('button', { name: '# engineering' }))
    await waitFor(() => { expect(b.view.container.querySelector('[data-team-channel]')).toBeTruthy() })
    expect(b.view.container.querySelector('[data-phase]')).toBeNull()
    expect(card.getAttribute('aria-current')).toBeNull()
    await b.runtime.dispose()
  })

  it('rebinds the underlying session when leaving an embedded Member view, so an off-seat rollover never blanks the seat', async () => {
    const b = await runtimeWithTeam({ mode: 'team', workspaceId: 'w1', initialChannels: true })
    // Added without taking the selection: the Human's ordinary session stays
    // current, the way a real Member session exists beside it on the Host.
    await b.runtime.sessions.add({ id: 'session:member:builder' as never, summary: { title: 'builder', cwd: '/work/alpha' } } as never, { current: false })
    await b.view.findByText('builder')
    fireEvent.click(await b.view.findByRole('button', { name: '# engineering' }))

    // Enter the Member page: the seat embeds the Member session while the
    // underlying DSH current still points at the Human's ordinary session
    // only until open() moves it.
    fireEvent.click(b.view.getByRole('button', { name: '打开 builder 的会话' }))
    await waitFor(() => { expect(b.runtime.sessions.list.getSnapshot().current).toBe('session:member:builder') })

    // Leaving the Member page through Team navigation must rebind the
    // underlying current back to the Human's original session exactly once —
    // a stale current would later mask to undefined when the Host disposes
    // the Member session (rollover), remounting the whole conversation seat.
    fireEvent.click(b.view.getByRole('button', { name: '# engineering' }))
    await waitFor(() => { expect(b.view.container.querySelector('[data-team-channel]')).toBeTruthy() })
    expect(b.runtime.sessions.list.getSnapshot().current).toBe('ordinary-session')
    const restores = b.runtime.sessions.calls.filter(call => call.method === 'open' && call.args[0] === 'ordinary-session')
    expect(restores).toHaveLength(1)
    const seat = b.view.container.querySelector('[data-team-channel]') as HTMLElement

    // The later rollover disposal of the Member session is now invisible to
    // the seat: current was already rebound, so no undefined gap, no remount.
    await b.runtime.sessions.remove('session:member:builder')
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(b.runtime.sessions.list.getSnapshot().current).toBe('ordinary-session')
    expect(b.view.container.querySelector('[data-team-channel]')).toBe(seat)
    expect(b.view.getByRole('heading', { name: '# engineering' })).toBeTruthy()
    await b.runtime.dispose()
  })

  it('clears the stale current when a Member view closes and its return target is gone', async () => {
    const b = await runtimeWithTeam({ mode: 'team', workspaceId: 'w1', initialChannels: true })
    await b.runtime.sessions.add({ id: 'session:member:builder' as never, summary: { title: 'builder', cwd: '/work/alpha' } } as never, { current: false })
    await b.view.findByText('builder')
    fireEvent.click(await b.view.findByRole('button', { name: '# engineering' }))
    fireEvent.click(b.view.getByRole('button', { name: '打开 builder 的会话' }))
    await waitFor(() => { expect(b.runtime.sessions.list.getSnapshot().current).toBe('session:member:builder') })

    // The return target dies while the Member page is embedded (the Host
    // disposed the Human's ordinary session). Leaving the Member view must
    // not leave the stale Member session as current — the seat clears into
    // the no-session view instead of waiting for a later removal to mask it.
    await b.runtime.sessions.remove('ordinary-session')
    fireEvent.click(b.view.getByRole('button', { name: '# engineering' }))
    await waitFor(() => { expect(b.view.container.querySelector('[data-team-channel]')).toBeTruthy() })
    expect(b.runtime.sessions.list.getSnapshot().current).toBeUndefined()
    const clears = b.runtime.sessions.calls.filter(call => call.method === 'clear')
    expect(clears).toHaveLength(1)
    // The dead target is never opened: unknown ids fail loud in the service.
    expect(b.runtime.sessions.calls.some(call => call.method === 'open' && call.args[0] === 'ordinary-session')).toBe(false)
    await b.runtime.dispose()
  })

  it('edits Agent facts without a Channel membership section', async () => {
    const b = await runtimeWithTeam({ initialChannels: true })
    fireEvent.click(b.view.getByRole('button', { name: '团队' }))
    await b.view.findByText('builder')

    fireEvent.click(b.view.getByRole('button', { name: 'builder 的操作' }))
    fireEvent.click(await b.view.findByRole('menuitem', { name: '编辑 Agent' }))
    const editor = b.view.getByRole('dialog', { name: '编辑 Agent' })
    // Channel membership is managed from the Channel side: the editor carries
    // only handle, description, and model.
    expect(within(editor).queryByRole('button', { name: '添加' })).toBeNull()
    expect(within(editor).queryByRole('button', { name: '移除' })).toBeNull()
    expect(within(editor).queryByText(/频道成员/)).toBeNull()
    expect(within(editor).getByLabelText('名称')).toBeTruthy()
    fireEvent.change(within(editor).getByLabelText(/说明/), { target: { value: 'Edited description' } })
    fireEvent.click(within(editor).getByRole('button', { name: '保存' }))
    await waitFor(() => { expect(b.updateMember).toHaveBeenCalledWith(expect.objectContaining({
      memberId: 'member:builder', handle: 'builder', description: 'Edited description',
    })) })
    await waitFor(() => expect(b.view.queryByRole('dialog', { name: '编辑 Agent' })).toBeNull())
    await b.runtime.dispose()
  })

})

describe('Team archival surfaces', () => {
  it('archives an Agent from the row menu behind a destructive confirm', async () => {
    const b = await runtimeWithTeam({ initialChannels: true })
    fireEvent.click(b.view.getByRole('button', { name: '团队' }))
    await b.view.findByText('builder')

    // The danger entry sits in every Member's row menu.
    fireEvent.click(b.view.getByRole('button', { name: 'builder 的操作' }))
    fireEvent.click(await within(document.body).findByRole('menuitem', { name: '归档' }))
    expect(b.view.getByRole('dialog', { name: '归档 Agent：builder' })).toBeTruthy()
    // The notice states the recoverability contract: data kept, no restore
    // entry point yet.
    expect(b.view.getByRole('dialog', { name: '归档 Agent：builder' }).textContent).toContain('暂无恢复入口')
    expect(b.archiveMember).not.toHaveBeenCalled()
    // Cancel closes without routing.
    fireEvent.click(b.view.getByRole('button', { name: '取消' }))
    expect(b.view.queryByRole('dialog', { name: '归档 Agent：builder' })).toBeNull()
    expect(b.archiveMember).not.toHaveBeenCalled()
    // Confirm routes the durable archive; the archived state arrives through
    // the workspace refetch and the row disappears.
    fireEvent.click(b.view.getByRole('button', { name: 'builder 的操作' }))
    fireEvent.click(await within(document.body).findByRole('menuitem', { name: '归档' }))
    fireEvent.click(await b.view.findByRole('button', { name: /^归档$/ }))
    await waitFor(() => {
      expect(b.archiveMember).toHaveBeenCalledWith(expect.objectContaining({ memberId: 'member:builder' }))
    })
    await b.publishChannelUpdate()
    await waitFor(() => expect(b.view.queryByRole('button', { name: 'builder 的操作' })).toBeNull())
    await b.runtime.dispose()
  })

  it('archives a Channel from the row menu behind a destructive confirm', async () => {
    const b = await runtimeWithTeam({ initialChannels: true })
    fireEvent.click(b.view.getByRole('button', { name: '团队' }))
    await b.view.findByText('# engineering')

    fireEvent.click(b.view.getByRole('button', { name: 'engineering 的操作' }))
    fireEvent.click(await within(document.body).findByRole('menuitem', { name: '归档频道' }))
    expect(b.view.getByRole('dialog', { name: '归档频道：engineering' })).toBeTruthy()
    expect(b.view.getByRole('dialog', { name: '归档频道：engineering' }).textContent).toContain('暂无恢复入口')
    expect(b.archiveChannel).not.toHaveBeenCalled()
    fireEvent.click(b.view.getByRole('button', { name: '取消' }))
    expect(b.view.queryByRole('dialog', { name: '归档频道：engineering' })).toBeNull()
    fireEvent.click(b.view.getByRole('button', { name: 'engineering 的操作' }))
    fireEvent.click(await within(document.body).findByRole('menuitem', { name: '归档频道' }))
    fireEvent.click(await b.view.findByRole('button', { name: /^归档频道$/ }))
    await waitFor(() => {
      expect(b.archiveChannel).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'w1', channelRef: 'channel:engineering' }))
    })
    await b.publishChannelUpdate()
    await waitFor(() => expect(b.view.queryByRole('button', { name: 'engineering 的操作' })).toBeNull())
    await b.runtime.dispose()
  })
})
