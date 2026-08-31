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
    expect(b.view.getByText('普通对话')).toBeTruthy()
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
    expect(await b.view.findByText('普通对话')).toBeTruthy()
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
    // Channels ride the shared multi-select Menu now: open, check, leave open.
    fireEvent.click(b.view.getByRole('button', { name: /初始频道/ }))
    fireEvent.click(await within(document.body).findByRole('menuitem', { name: 'engineering' }))
    // The trigger keeps its aria-label; the count renders as content.
    expect(b.view.getByText('已选 1 个频道')).toBeTruthy()
    b.addMember.mockResolvedValueOnce({ ok: false, error: { message: 'connection lost' } } as never)
    fireEvent.click(b.view.getByRole('button', { name: '创建 Agent' }))
    expect((await b.view.findByRole('alert')).textContent).toContain('connection lost')
    expect((b.view.getByLabelText('名称') as HTMLInputElement).value).toBe('reviewer')
    expect(b.view.queryByText('reviewer')).toBeNull()
    fireEvent.click(b.view.getByRole('button', { name: '创建 Agent' }))

    expect(await b.view.findByText('reviewer')).toBeTruthy()
    expect(b.addMember).toHaveBeenLastCalledWith(expect.objectContaining({
      workspaceId: 'w1', channelRefs: ['channel:engineering'], handle: 'reviewer', description: 'Reviews changes', presetId: 'team-member',
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
    // Channels stay untouched: the picker shows the empty prompt.
    expect(b.view.getByText('选择初始频道')).toBeTruthy()
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

  it('offers 从全新上下文开始 only for idle Members and requires a destructive confirm', async () => {
    const b = await runtimeWithTeam({ initialChannels: true })
    fireEvent.click(b.view.getByRole('button', { name: '团队' }))
    await b.view.findByText('builder')

    // The available Member gets an enabled clear entry.
    fireEvent.click(b.view.getByRole('button', { name: 'builder 的操作' }))
    const healthyMenu = await within(document.body).findByRole('menu')
    const clearItem = within(healthyMenu).getByRole('menuitem', { name: '从全新上下文开始' }) as HTMLButtonElement
    expect(clearItem.disabled).toBe(false)
    fireEvent.keyDown(document, { key: 'Escape' })
    // The working Member's entry is disabled with a reason label.
    fireEvent.click(b.view.getByRole('button', { name: 'worker 的操作' }))
    const workingMenu = await within(document.body).findByRole('menu')
    const workingClear = within(workingMenu).getByRole('menuitem', { name: '从全新上下文开始' }) as HTMLButtonElement
    expect(workingClear.disabled).toBe(true)
    expect(within(workingMenu).getByText('成员正在工作中，完成后才能清空上下文')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    // An error Member is also gated, but the reason must name its own state
    // instead of claiming the Member is working.
    fireEvent.click(b.view.getByRole('button', { name: 'failed 的操作' }))
    const failedMenu = await within(document.body).findByRole('menu')
    const failedClear = within(failedMenu).getByRole('menuitem', { name: '从全新上下文开始' }) as HTMLButtonElement
    expect(failedClear.disabled).toBe(true)
    expect(within(failedMenu).getByText('成员当前不可用，恢复在线且空闲后才能清空上下文')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })

    // Confirm before routing: the first click only opens the destructive dialog.
    fireEvent.click(b.view.getByRole('button', { name: 'builder 的操作' }))
    fireEvent.click(await within(document.body).findByRole('menuitem', { name: '从全新上下文开始' }))
    expect(b.view.getByRole('dialog', { name: '从全新上下文开始：builder' })).toBeTruthy()
    expect(b.clearMemberContext).not.toHaveBeenCalled()
    // Cancel closes without routing.
    fireEvent.click(b.view.getByRole('button', { name: '取消' }))
    expect(b.view.queryByRole('dialog', { name: '从全新上下文开始：builder' })).toBeNull()
    // Confirm routes through the Host remote with the Member identity.
    fireEvent.click(b.view.getByRole('button', { name: 'builder 的操作' }))
    fireEvent.click(await within(document.body).findByRole('menuitem', { name: '从全新上下文开始' }))
    fireEvent.click(await b.view.findByRole('button', { name: '确认清空' }))
    await waitFor(() => {
      expect(b.clearMemberContext).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'w1', memberId: 'member:builder' }))
    })
    // The seat is not embedded here, so no window rebuild is triggered.
    expect(b.refresh).not.toHaveBeenCalled()

    // While the Member's Session is embedded, a successful clear forces the
    // resident window to rebuild from host truth — the pane falls back to the
    // blank hero instead of keeping the disposed generation's stale history.
    await b.runtime.sessions.add({ id: 'session:member:builder' as never, summary: { title: 'builder', cwd: '/work/alpha' } } as never)
    fireEvent.click(await b.view.findByRole('button', { name: '打开 builder 的会话' }))
    await waitFor(() => {
      expect(b.runtime.sessions.calls.some(call => call.method === 'open' && call.args[0] === 'session:member:builder')).toBe(true)
    })
    await waitFor(() => {
      expect(b.view.getByRole('button', { name: '打开 builder 的会话' }).getAttribute('aria-current')).toBe('page')
    })
    fireEvent.click(b.view.getByRole('button', { name: 'builder 的操作' }))
    fireEvent.click(await within(document.body).findByRole('menuitem', { name: '从全新上下文开始' }))
    fireEvent.click(await b.view.findByRole('button', { name: '确认清空' }))
    await waitFor(() => { expect(b.refresh).toHaveBeenCalledTimes(1) })

    // A transport rejection surfaces as the row alert.
    b.clearMemberContext.mockRejectedValueOnce(new Error('connection lost'))
    fireEvent.click(b.view.getByRole('button', { name: 'builder 的操作' }))
    fireEvent.click(await within(document.body).findByRole('menuitem', { name: '从全新上下文开始' }))
    fireEvent.click(await b.view.findByRole('button', { name: '确认清空' }))
    await waitFor(() => { expect(b.view.getByRole('alert').textContent).toContain('清空上下文失败：connection lost') })
    // A failed clear leaves the embedded seat untouched.
    expect(b.refresh).toHaveBeenCalledTimes(1)
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
    expect(b.view.container.querySelector('[data-baseline-conversation]')).toBeNull()

    fireEvent.click(b.view.getByRole('button', { name: '打开 builder 的会话' }))
    await waitFor(() => {
      expect(b.runtime.sessions.calls.some(call => call.method === 'open' && call.args[0] === 'session:member:builder')).toBe(true)
    })
    // The card stays inside Team mode: the chrome remains mounted and the
    // conversation seat yields to the shipped root rendering the Member Session.
    expect(document.documentElement.dataset.agentTeamMode).toBe('team')
    await waitFor(() => { expect(b.view.container.querySelector('[data-baseline-conversation]')).toBeTruthy() })
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
    expect(b.view.container.querySelector('[data-baseline-conversation]')).toBeNull()
    expect(card.getAttribute('aria-current')).toBeNull()
    await b.runtime.dispose()
  })

  it('edits an Agent Channel membership from the sidebar row menu', async () => {
    const b = await runtimeWithTeam({ initialChannels: true })
    fireEvent.click(b.view.getByRole('button', { name: '团队' }))
    await b.view.findByText('builder')

    fireEvent.click(b.view.getByRole('button', { name: 'builder 的操作' }))
    fireEvent.click(await b.view.findByRole('menuitem', { name: '编辑 Agent' }))
    const editor = b.view.getByRole('dialog', { name: '编辑 Agent' })
    // No membership yet: every Channel row offers Add and the offline Agent stays blocked.
    expect(within(editor).getByRole('button', { name: '添加' })).toBeTruthy()
    fireEvent.click(within(editor).getByRole('button', { name: '添加' }))
    await waitFor(() => { expect(b.joinChannel).toHaveBeenCalledWith(expect.objectContaining({
      channelRef: 'channel:engineering', memberId: 'member:builder', workspaceId: 'w1',
    })) })
    await waitFor(() => { expect(within(editor).getByRole('button', { name: '移除' })).toBeTruthy() })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(b.view.queryByRole('dialog', { name: '编辑 Agent' })).toBeNull()
    await b.runtime.dispose()
  })

})
