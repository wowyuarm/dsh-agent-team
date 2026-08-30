// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { runtimeWithTeam } from './harness.tsx'
import { TEAM_DRAFTS_STORAGE_KEY } from '../src/client/drafts.ts'

usePinnedBrowserLanguages('zh-CN')
afterEach(cleanup)
beforeEach(() => { localStorage.clear() })

describe('Team conversation surfaces', () => {
  it('opens a selected Channel in the Team center and sends only after Host commit', async () => {
    const b = await runtimeWithTeam({ remainingUnreadCount: 1 })
    fireEvent.click(b.view.getByRole('button', { name: '团队' }))
    fireEvent.click(await b.view.findByRole('button', { name: '新建频道' }))
    fireEvent.change(b.view.getByLabelText('名称'), { target: { value: 'backend' } })
    fireEvent.change(b.view.getByLabelText(/说明/), { target: { value: 'API' } })
    fireEvent.click(b.view.getByRole('button', { name: /初始成员/ }))
    fireEvent.click(await within(document.body).findByRole('menuitem', { name: /builder/ }))
    fireEvent.click(b.view.getByRole('button', { name: '创建频道' }))
    const backendChannel = await b.view.findByRole('button', { name: '# backend' })
    fireEvent.click(backendChannel)
    expect(backendChannel.closest('article')?.getAttribute('aria-current')).toBe('page')
    // Location moves to the leaf: the Channel row is the composition's only
    // aria-current='page', and the browsed Workspace row yields it.
    const currentPage = b.view.container.querySelector('[aria-current="page"]')
    expect(currentPage).toBe(backendChannel.closest('article'))
    expect(b.view.container.querySelectorAll('[aria-current="page"]')).toHaveLength(1)
    expect(await b.view.findByRole('heading', { name: '# backend' })).toBeTruthy()
    const channelPage = b.view.container.querySelector('[data-team-channel]') as HTMLElement
    const manageMembers = within(channelPage).getByRole('button', { name: '管理成员' })
    fireEvent.click(manageMembers)
    const pageManager = b.view.getByRole('dialog', { name: '频道成员' })
    expect(within(pageManager).getByText('@builder')).toBeTruthy()
    await waitFor(() => expect(document.activeElement).toBe(within(pageManager).getByRole('button', { name: '移除' })))
    const removal = Promise.withResolvers<Awaited<ReturnType<typeof b.removeChannelMember>>>()
    b.removeChannelMember.mockReturnValueOnce(removal.promise)
    fireEvent.click(within(pageManager).getByRole('button', { name: '移除' }))
    expect((within(pageManager).getByRole('button', { name: '更新中…' }) as HTMLButtonElement).disabled).toBe(true)
    expect((within(pageManager).getAllByRole('button', { name: '添加' })[0] as HTMLButtonElement).disabled).toBe(false)
    removal.resolve({ ok: false, error: { message: 'membership failed' } } as never)
    expect((await within(pageManager).findByRole('alert')).textContent).toContain('membership failed')
    expect(within(pageManager).getByRole('button', { name: '移除' })).toBeTruthy()
    fireEvent.click(within(pageManager).getByRole('button', { name: '关闭' }))
    await waitFor(() => expect(document.activeElement).toBe(manageMembers))
    const messageInput = b.view.getByRole('textbox', { name: '消息内容' }) as HTMLTextAreaElement
    fireEvent.change(messageInput, { target: { value: 'hello team @b' } })
    fireEvent.click(b.view.getByRole('option', { name: /@builder/ }))
    expect(messageInput.value).toBe('hello team @builder ')
    fireEvent.click(b.view.getByRole('button', { name: '作为任务' }))
    b.sendMessage.mockResolvedValueOnce({ ok: false, error: { message: 'send failed' } } as never)
    fireEvent.click(b.view.getByRole('button', { name: '发送' }))
    expect((await within(channelPage).findByRole('alert')).textContent).toContain('send failed')
    expect((b.view.getByRole('textbox', { name: '消息内容' }) as HTMLTextAreaElement).value).toBe('hello team @builder ')
    fireEvent.click(b.view.getByRole('button', { name: '发送' }))
    await waitFor(() => expect(b.sendMessage).toHaveBeenLastCalledWith(expect.objectContaining({ body: 'hello team @builder', recipients: ['member:builder'], asTask: true })))
    expect(b.sendMessage.mock.calls[0]![0].requestId).not.toBe(b.sendMessage.mock.calls[1]![0].requestId)
    // Mention segmentation splits the body into spans (and css-module classes
    // are hashed here), so match the body container by class substring.
    await waitFor(() => {
      const rows = Array.from(b.view.container.querySelectorAll('[data-human] div[class*="messageText"]'))
      expect(rows.some(row => row.textContent === 'hello team @builder')).toBe(true)
    })
    expect(b.view.queryByText('任务消息')).toBeNull()
    expect(b.view.getByText('待处理')).toBeTruthy()
    expect(b.view.getByText('1 条消息')).toBeTruthy()
    b.publishAgentReply()
    await waitFor(() => expect(b.view.queryByText('agent reply')).toBeNull())
    fireEvent.click(b.view.getByRole('button', { name: '打开 Task #1' }))
    expect(await b.view.findByRole('heading', { name: 'Task #1' })).toBeTruthy()
    fireEvent.click(b.view.getByRole('button', { name: /Claims/ }))
    expect(b.view.getByText('Implement API')).toBeTruthy()
    expect(b.view.queryByRole('button', { name: '关注 Thread' })).toBeNull()
    expect(b.view.queryByRole('button', { name: '取消关注' })).toBeNull()
    expect(b.view.queryByText('Human 观察')).toBeNull()
    fireEvent.click(await b.view.findByRole('button', { name: '继续阅读' }))
    await waitFor(() => expect(b.readThread).toHaveBeenCalledTimes(2))
    expect(b.view.queryByRole('button', { name: '继续阅读' })).toBeNull()
    expect(b.view.getByText('@builder 认领了「Implement API」')).toBeTruthy()
    expect(b.view.queryByText(/member:builder/)).toBeNull()
    expect(b.view.queryByText(/claim ·/)).toBeNull()
    expect(b.view.queryByRole('button', { name: '标记完成' })).toBeNull()
    fireEvent.change(b.view.getByRole('textbox', { name: '消息内容' }), { target: { value: 'human thread reply' } })
    b.reply.mockResolvedValueOnce({ ok: false, error: { message: 'stale Thread revision 2' } } as never)
    fireEvent.click(b.view.getByRole('button', { name: '发送' }))
    expect((await b.view.findByRole('alert')).textContent).toContain('stale Thread revision')
    expect((b.view.getByRole('textbox', { name: '消息内容' }) as HTMLTextAreaElement).value).toBe('human thread reply')
    expect(b.reply).toHaveBeenCalledTimes(1)
    fireEvent.click(b.view.getByRole('button', { name: '发送' }))
    expect(await b.view.findByText('human thread reply')).toBeTruthy()
    expect(b.reply.mock.calls[0]![0].requestId).toBe(b.reply.mock.calls[1]![0].requestId)
    fireEvent.click(b.view.getByRole('button', { name: '关闭任务' }))
    // The closed Thread swaps the composer for an explanatory notice with the reopen action.
    expect(await b.view.findByRole('button', { name: '重新打开' })).toBeTruthy()
    expect(b.view.getByText('任务已关闭，重新打开后可继续讨论')).toBeTruthy()
    expect(b.view.queryByRole('textbox', { name: '消息内容' })).toBeNull()
    expect(b.reply).toHaveBeenCalledTimes(2)
    fireEvent.click(b.view.getByRole('button', { name: '重新打开' }))
    await waitFor(() => expect((b.view.getByRole('textbox', { name: '消息内容' }) as HTMLTextAreaElement).disabled).toBe(false))
    fireEvent.click(b.view.getByRole('button', { name: '返回频道' }))
    expect(await b.view.findByRole('heading', { name: '# backend' })).toBeTruthy()
    await waitFor(() => expect(b.view.queryByText('agent reply')).toBeNull())
    await b.runtime.dispose()
  })

  it('linkifies branded refs in agent plain-prose bodies that skip the mention path', async () => {
    const taskRef = 'task:0f0ad7ce-11d3-4c05-8a9e-6f2b1c9d7e31'
    const b = await runtimeWithTeam({
      mode: 'team', workspaceId: 'w1', initialChannels: true,
      seedTaskRef: taskRef, seedThreadRef: 'thread:0f0ad7ce-11d3-4c05-8a9e-6f2b1c9d7e32',
      seededMessages: [
        { body: `ref 样本：本 Task 是 ${taskRef}，对照散文 channel:engineering 应保持纯文本。`, occurredAt: '2026-08-21T09:00:00.000Z', sender: 'agent' },
      ],
    })
    fireEvent.click(await b.view.findByRole('button', { name: '# engineering' }))
    // The Agent body has no mentions, so it previously fell through to the
    // Markdown renderer and dropped the ref link entirely.
    const link = await b.view.findByRole('button', { name: taskRef })
    fireEvent.click(link)
    await waitFor(() => expect(b.readThread).toHaveBeenCalledWith(expect.objectContaining({ taskRef })))
    await b.runtime.dispose()
  })

  it('resolves unknown task refs to task numbers and navigates on click', async () => {
    const citedRef = 'task:9c1b02aa-5d3e-4f0a-8b7c-1e2d3f4a5b6c'
    const b = await runtimeWithTeam({
      mode: 'team', workspaceId: 'w1', initialChannels: true,
      seedTaskRef: 'task:0f0ad7ce-11d3-4c05-8a9e-6f2b1c9d7e51', seedThreadRef: 'thread:0f0ad7ce-11d3-4c05-8a9e-6f2b1c9d7e52',
      seededMessages: [{ body: `看 ${citedRef}`, occurredAt: '2026-08-21T09:00:00.000Z' }],
    })
    fireEvent.click(await b.view.findByRole('button', { name: '# engineering' }))
    // The cited ref is not in the loaded timeline: it renders raw, resolves
    // through the Host lookup, and relabels to the human-facing number.
    const link = await b.view.findByRole('button', { name: citedRef })
    await waitFor(() => { expect(b.resolveTaskRefs).toHaveBeenCalled() })
    // The Host knows the cited Task: the label becomes the human-facing
    // number with the full ref on hover.
    await waitFor(() => { expect(link.textContent).toBe('Task #2') })
    expect(link.getAttribute('title')).toBe(citedRef)
    fireEvent.click(link)
    await waitFor(() => expect(b.readThread).toHaveBeenCalledWith(expect.objectContaining({ taskRef: citedRef })))
    await b.runtime.dispose()
  })

  it('confirms early acceptance and lists the Claims completed with it', async () => {
    const b = await runtimeWithTeam({
      mode: 'team', workspaceId: 'w1', initialChannels: true,
      seedTaskStatus: 'in_progress',
      seededMessages: [{ body: '开工任务', occurredAt: '2026-08-21T09:00:00.000Z' }],
    })
    fireEvent.click(await b.view.findByRole('button', { name: '# engineering' }))
    // The active Claim arrives with the agent activity refresh.
    b.publishAgentReply()
    fireEvent.click(await b.view.findByRole('button', { name: '打开 Task #1' }))
    expect(await b.view.findByRole('heading', { name: 'Task #1' })).toBeTruthy()

    // An in_progress Task with an open Claim offers acceptance behind a
    // confirm dialog that lists exactly what will be completed.
    const acceptButton = await b.view.findByRole('button', { name: '验收' })
    fireEvent.click(acceptButton)
    const dialog = b.view.getByRole('dialog', { name: '提前验收任务' })
    expect(within(dialog).getByText(/将验收本 Task/)).toBeTruthy()
    expect(within(dialog).getByText('@builder · Implement API')).toBeTruthy()

    // Cancel closes without any remote call. Two controls share the label
    // (the dialog X and the footer action); the text-bearing one is ours.
    const cancelButton = within(dialog).getAllByRole('button', { name: '取消' }).find(button => button.textContent === '取消')
    fireEvent.click(cancelButton!)
    await waitFor(() => expect(b.view.queryByRole('dialog', { name: '提前验收任务' })).toBeNull())
    expect(b.changeTask).not.toHaveBeenCalled()

    // Confirm runs exactly one accept.
    fireEvent.click(b.view.getByRole('button', { name: '验收' }))
    fireEvent.click(within(b.view.getByRole('dialog', { name: '提前验收任务' })).getByRole('button', { name: '验收' }))
    await waitFor(() => expect(b.changeTask).toHaveBeenCalledTimes(1))
    expect(b.changeTask).toHaveBeenCalledWith(expect.objectContaining({ action: 'accept' }))
    await b.runtime.dispose()
  })

  it('renders resolved Task refs inline in rich Agent Markdown, styled code spans included', async () => {
    const taskRef = 'task:0f0ad7ce-11d3-4c05-8a9e-6f2b1c9d7e41'
    const unknownRef = 'task:0f0ad7ce-11d3-4c05-8a9e-6f2b1c9d7e43'
    const inlineCodeRef = 'task:0f0ad7ce-11d3-4c05-8a9e-6f2b1c9d7e44'
    const fencedCodeRef = 'task:0f0ad7ce-11d3-4c05-8a9e-6f2b1c9d7e45'
    const linkedRef = 'task:0f0ad7ce-11d3-4c05-8a9e-6f2b1c9d7e46'
    const mixedCodeRef = 'task:0f0ad7ce-11d3-4c05-8a9e-6f2b1c9d7e47'
    const b = await runtimeWithTeam({
      mode: 'team', workspaceId: 'w1', initialChannels: true,
      seedTaskRef: taskRef, seedThreadRef: 'thread:0f0ad7ce-11d3-4c05-8a9e-6f2b1c9d7e42',
      seededMessages: [{
        body: `需求源头：${taskRef} 与 \`${taskRef}\`\n\n- **已核实**\n- 未知任务：${unknownRef}\n- 行内代码：\`${inlineCodeRef}\`\n- 混合代码：\`编号 ${mixedCodeRef}\`\n- [已有链接 ${linkedRef}](https://example.com/source)\n\n\`\`\`text\n${fencedCodeRef}\n\`\`\``,
        occurredAt: '2026-08-21T09:00:00.000Z',
        sender: 'agent',
      }],
    })
    fireEvent.click(await b.view.findByRole('button', { name: '# engineering' }))

    // Prose refs and code spans holding exactly one ref resolve to the
    // human-facing number; fenced blocks, mixed-content code spans, and
    // existing links stay exactly as Markdown rendered them.
    const links = await b.view.findAllByRole('button', { name: 'Task #1' })
    expect(links).toHaveLength(2)
    expect(links.map(link => link.getAttribute('title'))).toEqual([taskRef, taskRef])
    expect(b.view.queryByText(taskRef)).toBeNull()
    expect(b.view.getByText('已核实').tagName).toBe('STRONG')
    expect(b.view.getByText(unknownRef, { exact: false })).toBeTruthy()
    expect(b.view.getByText(inlineCodeRef).tagName).toBe('CODE')
    const mixedCode = [...b.view.container.querySelectorAll('code')].filter(code => code.textContent?.includes(mixedCodeRef))
    expect(mixedCode).toHaveLength(1)
    expect(mixedCode[0]!.closest('pre')).toBeNull()
    expect(b.view.getByText(fencedCodeRef).closest('pre')).not.toBeNull()
    expect(b.view.getByRole('link', { name: `已有链接 ${linkedRef}` }).getAttribute('href')).toBe('https://example.com/source')
    await waitFor(() => expect(b.resolveTaskRefs).toHaveBeenCalledWith(expect.objectContaining({ taskRefs: [taskRef, unknownRef, inlineCodeRef] })))

    fireEvent.click(links[0]!)
    await waitFor(() => expect(b.readThread).toHaveBeenCalledWith(expect.objectContaining({ taskRef })))
    await b.runtime.dispose()
  })

  it('renders a Lead-style dispatch: doubled-colon ref resolves and the spelled mention chipifies inline', async () => {
    const auditRef = 'task:0f0ad7ce-11d3-4c05-8a9e-6f2b1c9d7e61'
    const b = await runtimeWithTeam({
      mode: 'team', workspaceId: 'w1', initialChannels: true,
      seedTaskRef: auditRef, seedThreadRef: 'thread:0f0ad7ce-11d3-4c05-8a9e-6f2b1c9d7e62',
      seededMessages: [{
        body: '@builder 实施 Client 的结构重构，来源于审计 Task `task::0f0ad7ce-11d3-4c05-8a9e-6f2b1c9d7e61`：\n\n1. 先读 audit scratch 与现有 tests\n2. 回复边界后再 Claim\n\n完成后由 Lead 复核。',
        occurredAt: '2026-08-28T11:00:00.000Z',
        sender: 'agent',
        mentions: ['member:builder'],
      }],
    })
    fireEvent.click(await b.view.findByRole('button', { name: '# engineering' }))

    // The message is rich Markdown: the spelled handle chipifies at its
    // prose position and the trailing fallback row stays empty entirely.
    const messageRow = await waitFor(() => {
      const row = [...b.view.container.querySelectorAll('[data-team-channel] article')]
        .find(article => article.textContent?.includes('实施 Client 的结构重构'))
      expect(row).toBeTruthy()
      return row!
    })
    const chips = [...messageRow.querySelectorAll('span')]
      .filter(span => span.textContent === '@builder' && [...span.classList].some(className => className.includes('mention')))
    expect(chips).toHaveLength(1)
    expect([...messageRow.querySelectorAll('div')].some(div => [...div.classList].some(className => className.includes('mentionsRow')))).toBe(false)

    // The model's doubled-colon spelling resolves to the same Task: the
    // chip shows the human-facing number and navigates with the canonical ref.
    const link = await b.view.findByRole('button', { name: 'Task #1' })
    expect(link.getAttribute('title')).toBe(auditRef)
    fireEvent.click(link)
    await waitFor(() => expect(b.readThread).toHaveBeenCalledWith(expect.objectContaining({ taskRef: auditRef })))
    await b.runtime.dispose()
  })

  it('uploads composer attachments as chips, sends their ids, and renders the strip', async () => {
    const b = await runtimeWithTeam({ initialChannels: true })
    fireEvent.click(b.view.getByRole('button', { name: '团队' }))
    // Let the browser's one-time workspace selection settle first; a late
    // selectWorkspace would strip the channel ref mid-test.
    await waitFor(() => { expect(b.view.container.querySelector('[aria-current="page"]')?.textContent).toContain('Alpha') })
    fireEvent.click(await b.view.findByRole('button', { name: '# engineering' }))
    expect(await b.view.findByRole('heading', { name: '# engineering' })).toBeTruthy()
    const composer = b.view.container
    const chipCount = (): number => composer.querySelectorAll('ul[aria-label="添加附件"] > li').length

    // The "+" picker adds chips; the remove button drops one.
    const input = composer.querySelector('input[type="file"]') as HTMLInputElement
    const png = new File(['png'], 'shot.png', { type: 'image/png' })
    const pdf = new File(['pdf'], 'spec.pdf', { type: 'application/pdf' })
    await waitFor(() => { fireEvent.change(input, { target: { files: [png, pdf] } }) })
    await waitFor(() => { expect(chipCount()).toBe(2) })
    // Image drafts render an inline preview card; documents stay text cards.
    const chips = [...composer.querySelectorAll('ul[aria-label="添加附件"] > li')]
    expect(chips.find(chip => chip.textContent?.includes('shot.png'))?.querySelector('img')).toBeTruthy()
    expect(chips.find(chip => chip.textContent?.includes('spec.pdf'))?.querySelector('img')).toBeNull()
    fireEvent.click(composer.querySelector('[class*="fileChipRemove"]') as HTMLButtonElement)
    await waitFor(() => { expect(chipCount()).toBe(1) })
    expect(composer.querySelector('[class*="fileChipName"]')?.textContent).toBe('spec.pdf3 B')
    expect(composer.querySelector('[class*="fileChipSize"]')?.textContent).toBe('3 B')

    // Sending uploads the remaining file and passes its id to sendMessage.
    fireEvent.change(b.view.getByRole('textbox', { name: '消息内容' }), { target: { value: '带附件' } })
    fireEvent.click(b.view.getByRole('button', { name: '作为任务' }))
    fireEvent.click(b.view.getByRole('button', { name: '发送' }))
    await waitFor(() => { expect(b.putAttachment).toHaveBeenCalledWith(expect.objectContaining({ name: 'spec.pdf', mediaType: 'application/pdf' })) })
    await waitFor(() => { expect(b.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ body: '带附件', attachments: ['attachment:1'] })) })
    // Committed send clears the chips along with the draft...
    await waitFor(() => { expect(chipCount()).toBe(0) })
    // ...and the echoed message renders its image as a thumbnail.
    await waitFor(() => { expect(composer.querySelector('img[src^="data:image/png"]')).toBeTruthy() })

    // A second message whose bytes the Host no longer caches (GC'd) degrades
    // to an expiry chip: history stays honest about what was shared.
    await waitFor(() => { fireEvent.change(input, { target: { files: [new File(['gone'], 'expired.png', { type: 'image/png' })] } }) })
    await waitFor(() => { expect(chipCount()).toBe(1) })
    fireEvent.change(b.view.getByRole('textbox', { name: '消息内容' }), { target: { value: '图已过期' } })
    fireEvent.click(b.view.getByRole('button', { name: '发送' }))
    await waitFor(() => {
      const chips = [...b.view.container.querySelectorAll('[class*="attachmentChip"]')]
      return expect(chips.some(chip => chip.textContent?.includes('文件已过期清理'))).toBe(true)
    }, { timeout: 4000 })
    await b.runtime.dispose()
  })

  it('uploads thread reply attachments and passes their ids to reply', async () => {
    const b = await runtimeWithTeam({ initialChannels: true, remainingUnreadCount: 1, seededMessages: [{ body: '开个任务', occurredAt: '2026-08-21T09:00:00.000Z' }] })
    fireEvent.click(b.view.getByRole('button', { name: '团队' }))
    fireEvent.click(await b.view.findByRole('button', { name: '# engineering' }))
    fireEvent.click(await b.view.findByRole('button', { name: '打开 Task #1' }))
    expect(await b.view.findByRole('heading', { name: 'Task #1' })).toBeTruthy()
    const composer = b.view.container
    const chipCount = (): number => composer.querySelectorAll('ul[aria-label="添加附件"] > li').length

    // The reply composer offers the same "+" picker as the Channel composer.
    const input = composer.querySelector('input[type="file"]') as HTMLInputElement
    await waitFor(() => { fireEvent.change(input, { target: { files: [new File(['png'], 'evidence.png', { type: 'image/png' })] } }) })
    await waitFor(() => { expect(chipCount()).toBe(1) })

    fireEvent.change(b.view.getByRole('textbox', { name: '消息内容' }), { target: { value: '带截图的回复' } })
    fireEvent.click(b.view.getByRole('button', { name: '发送' }))
    await waitFor(() => { expect(b.putAttachment).toHaveBeenCalledWith(expect.objectContaining({ name: 'evidence.png', mediaType: 'image/png' })) })
    await waitFor(() => { expect(b.reply).toHaveBeenCalledWith(expect.objectContaining({ body: '带截图的回复', attachments: ['attachment:1'] })) })
    // Committed reply clears the chips along with the draft.
    await waitFor(() => { expect(chipCount()).toBe(0) })
    expect(await b.view.findByText('带截图的回复')).toBeTruthy()
    await b.runtime.dispose()
  })

  it('caches composer drafts across view switches and clears them on committed sends', async () => {
    const b = await runtimeWithTeam({ initialChannels: true })
    fireEvent.click(b.view.getByRole('button', { name: '团队' }))
    // A second Channel gives the draft somewhere to switch away to.
    fireEvent.click(await b.view.findByRole('button', { name: '新建频道' }))
    fireEvent.change(b.view.getByLabelText('名称'), { target: { value: 'backend' } })
    fireEvent.change(b.view.getByLabelText(/说明/), { target: { value: 'API' } })
    fireEvent.click(b.view.getByRole('button', { name: /初始成员/ }))
    fireEvent.click(await within(document.body).findByRole('menuitem', { name: /builder/ }))
    fireEvent.click(b.view.getByRole('button', { name: '创建频道' }))
    fireEvent.click(await b.view.findByRole('button', { name: '# engineering' }))
    expect(await b.view.findByRole('heading', { name: '# engineering' })).toBeTruthy()

    const input = b.view.getByRole('textbox', { name: '消息内容' }) as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: 'engineering draft' } })
    // Writes go straight through to the persisted cache.
    expect(JSON.parse(localStorage.getItem(TEAM_DRAFTS_STORAGE_KEY) ?? '{}')).toMatchObject({
      'channel:channel:engineering': { draft: 'engineering draft', recipientIds: [] },
    })

    // Switching views unmounts the page; returning restores from the cache.
    fireEvent.click(b.view.getByRole('button', { name: '# backend' }))
    expect(await b.view.findByRole('heading', { name: '# backend' })).toBeTruthy()
    expect((b.view.getByRole('textbox', { name: '消息内容' }) as HTMLTextAreaElement).value).toBe('')
    fireEvent.click(b.view.getByRole('button', { name: '# engineering' }))
    await waitFor(() => {
      const restored = b.view.getByRole('textbox', { name: '消息内容' }) as HTMLTextAreaElement
      return expect(restored.value).toBe('engineering draft')
    })

    // Failed sends keep the cached draft...
    b.sendMessage.mockResolvedValueOnce({ ok: false, error: { message: 'send failed' } } as never)
    fireEvent.click(b.view.getByRole('button', { name: '发送' }))
    expect((await b.view.findByRole('alert')).textContent).toContain('send failed')
    expect((b.view.getByRole('textbox', { name: '消息内容' }) as HTMLTextAreaElement).value).toBe('engineering draft')
    // ...and a committed send drops the key entirely.
    fireEvent.click(b.view.getByRole('button', { name: '发送' }))
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(TEAM_DRAFTS_STORAGE_KEY) ?? '{}') as Record<string, unknown>
      expect(stored['channel:channel:engineering']).toBeUndefined()
    })
    expect((b.view.getByRole('textbox', { name: '消息内容' }) as HTMLTextAreaElement).value).toBe('')
    await b.runtime.dispose()
  })

  it('rehydrates drafts from localStorage and prunes stale recipients on restore', async () => {
    const b = await runtimeWithTeam({ initialChannels: true })
    fireEvent.click(b.view.getByRole('button', { name: '团队' }))
    // Open the seeded Channel first so the browser's one-time workspace
    // selection settles before the new Channel row is clicked.
    fireEvent.click(await b.view.findByRole('button', { name: '# engineering' }))
    expect(await b.view.findByRole('heading', { name: '# engineering' })).toBeTruthy()
    fireEvent.click(b.view.getByRole('button', { name: '新建频道' }))
    fireEvent.change(b.view.getByLabelText('名称'), { target: { value: 'backend' } })
    fireEvent.change(b.view.getByLabelText(/说明/), { target: { value: 'API' } })
    fireEvent.click(b.view.getByRole('button', { name: /初始成员/ }))
    fireEvent.click(await within(document.body).findByRole('menuitem', { name: /builder/ }))
    fireEvent.click(b.view.getByRole('button', { name: '创建频道' }))
    fireEvent.click(await b.view.findByRole('button', { name: '# backend' }))
    expect(await b.view.findByRole('heading', { name: '# backend' })).toBeTruthy()

    // Seed the cache under the Channel's REAL ref, then reload — the same
    // content a fresh page load would rehydrate for this view.
    const channelRef = b.runtime.ctx.teamNavigation.getSnapshot().channelRef!
    localStorage.setItem(TEAM_DRAFTS_STORAGE_KEY, JSON.stringify({
      [`channel:${channelRef}`]: {
        draft: 'hello team @builder',
        recipientIds: ['member:builder', 'member:ghost'],
        savedAt: Date.now(),
      },
    }))
    b.runtime.ctx.teamDrafts.reload()

    // The restored text lands in the composer untouched...
    await waitFor(() => {
      const input = b.view.getByRole('textbox', { name: '消息内容' }) as HTMLTextAreaElement
      return expect(input.value).toBe('hello team @builder')
    })
    // ...while the Composer's convergence pass rewrites the cached entry with
    // only the recipients that are known Members still named in the draft.
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(TEAM_DRAFTS_STORAGE_KEY) ?? '{}') as Record<string, { recipientIds: string[] }>
      return expect(stored[`channel:${channelRef}`]?.recipientIds).toEqual(['member:builder'])
    })
    await b.runtime.dispose()
  })

  it('opens a Thread with one parallel request round and no self-triggered second wave', async () => {
    const b = await runtimeWithTeam()
    fireEvent.click(b.view.getByRole('button', { name: '团队' }))
    fireEvent.click(await b.view.findByRole('button', { name: '新建频道' }))
    fireEvent.change(b.view.getByLabelText('名称'), { target: { value: 'backend' } })
    fireEvent.change(b.view.getByLabelText(/说明/), { target: { value: 'API' } })
    fireEvent.click(b.view.getByRole('button', { name: /初始成员/ }))
    fireEvent.click(await within(document.body).findByRole('menuitem', { name: /builder/ }))
    fireEvent.click(b.view.getByRole('button', { name: '创建频道' }))
    fireEvent.click(await b.view.findByRole('button', { name: '# backend' }))
    expect(await b.view.findByRole('heading', { name: '# backend' })).toBeTruthy()
    const messageInput = b.view.getByRole('textbox', { name: '消息内容' }) as HTMLTextAreaElement
    fireEvent.change(messageInput, { target: { value: 'first task' } })
    fireEvent.click(b.view.getByRole('button', { name: '作为任务' }))
    fireEvent.click(b.view.getByRole('button', { name: '发送' }))
    expect(await b.view.findByText('first task')).toBeTruthy()

    b.readThread.mockClear()
    b.loadThreadHistory.mockClear()
    b.members.mockClear()
    b.viewChannels.mockClear()
    b.changes.mockClear()
    fireEvent.click(b.view.getByRole('button', { name: '打开 Task #1' }))
    expect(await b.view.findByRole('heading', { name: 'Task #1' })).toBeTruthy()
    await vi.waitFor(() => expect(b.loadThreadHistory).toHaveBeenCalledWith(expect.objectContaining({ taskRef: 'task:1', limit: 20 })))
    expect(b.readThread).toHaveBeenCalledTimes(1)

    // The durable read no longer wakes any scope, so the first round is the
    // whole load: no second members/view/history wave may follow it.
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(b.readThread).toHaveBeenCalledTimes(1)
    expect(b.loadThreadHistory).toHaveBeenCalledTimes(1)
    expect(b.members).toHaveBeenCalledTimes(1)
    expect(b.viewChannels).toHaveBeenCalledTimes(1)

    // The page waits on its own thread scope. The workspace presence scope
    // rides the shared poll the always-mounted sidebar Agents section holds:
    // opening a Thread must not open a second workspace long-poll.
    const scopedCalls = b.changes.mock.calls.filter(([request]) => request.scope !== undefined)
    const scopes = scopedCalls.map(([request]) => request.scope as { kind: string; threadRef?: string })
    expect(scopes.some(scope => scope.kind === 'thread' && scope.threadRef === 'thread:1')).toBe(true)
    expect(scopes.some(scope => scope.kind === 'workspace')).toBe(false)
    for (const [, signal] of scopedCalls) expect(signal).toBeInstanceOf(AbortSignal)
    await b.runtime.dispose()
  })

  it('restores persisted Team mode, reconciles a stale Workspace, renders the rail, and unloads cleanly', async () => {
    const b = await runtimeWithTeam({ mode: 'team', workspaceId: 'stale' })
    expect(await b.view.findByRole('heading', { name: '频道' })).toBeTruthy()
    await vi.waitFor(() => expect(b.runtime.ctx.teamNavigation.getSnapshot().workspaceId).toBe('w1'))

    fireEvent.click(b.view.getByRole('button', { name: 'Toggle fixture sidebar' }))
    await waitFor(() => { expect(b.view.getByRole('button', { name: '频道' })).toBeTruthy() })
    expect(b.view.getByRole('button', { name: '对话' })).toBeTruthy()
    expect(b.view.getByRole('button', { name: '频道' })).toBeTruthy()
    expect(b.view.queryByRole('button', { name: '新建工作区' })).toBeNull()
    expect(b.view.container).toMatchSnapshot()

    await b.team.dispose()
    expect(await b.view.findByText('普通工作区')).toBeTruthy()
    expect(await b.view.findByText('普通对话')).toBeTruthy()
    expect(await b.view.findByText('设置')).toBeTruthy()
    await b.runtime.dispose()
  })

  it('folds the workspace list behind the same section header as the panels', async () => {
    const b = await runtimeWithTeam({ mode: 'team' })
    expect(await b.view.findByRole('heading', { name: '频道' })).toBeTruthy()
    fireEvent.click(b.view.getByRole('button', { name: 'Toggle fixture sidebar' }))
    await waitFor(() => { expect(b.view.getByRole('button', { name: '频道' })).toBeTruthy() })
    const workspaceToggle = b.view.getByRole('button', { name: '工作区' })
    expect(workspaceToggle.getAttribute('aria-expanded')).toBe('true')
    expect(b.view.getByRole('button', { name: 'Alpha' })).toBeTruthy()
    fireEvent.click(workspaceToggle)
    expect(workspaceToggle.getAttribute('aria-expanded')).toBe('false')
    expect(b.view.queryByRole('button', { name: 'Alpha' })).toBeNull()
    expect(b.view.queryByRole('button', { name: 'Beta' })).toBeNull()
    // Collapsing the list leaves the Workspace content sections in place.
    expect(b.view.getByRole('button', { name: '频道' })).toBeTruthy()
    fireEvent.click(workspaceToggle)
    expect(b.view.getByRole('button', { name: 'Alpha' })).toBeTruthy()
    await b.runtime.dispose()
  })

  it('counts only facts newer than the shown timeline as new updates on change wakes', async () => {
    const b = await runtimeWithTeam()
    fireEvent.click(b.view.getByRole('button', { name: '团队' }))
    fireEvent.click(await b.view.findByRole('button', { name: '新建频道' }))
    fireEvent.change(b.view.getByLabelText('名称'), { target: { value: 'backend' } })
    fireEvent.change(b.view.getByLabelText(/说明/), { target: { value: 'API' } })
    fireEvent.click(b.view.getByRole('button', { name: /初始成员/ }))
    fireEvent.click(await within(document.body).findByRole('menuitem', { name: /builder/ }))
    fireEvent.click(b.view.getByRole('button', { name: '创建频道' }))
    fireEvent.click(await b.view.findByRole('button', { name: '# backend' }))
    expect(await b.view.findByRole('heading', { name: '# backend' })).toBeTruthy()
    const messageInput = b.view.getByRole('textbox', { name: '消息内容' }) as HTMLTextAreaElement
    fireEvent.change(messageInput, { target: { value: 'first task' } })
    fireEvent.click(b.view.getByRole('button', { name: '作为任务' }))
    fireEvent.click(b.view.getByRole('button', { name: '发送' }))
    expect(await b.view.findByText('first task')).toBeTruthy()
    fireEvent.click(b.view.getByRole('button', { name: '打开 Task #1' }))
    expect(await b.view.findByRole('heading', { name: 'Task #1' })).toBeTruthy()
    await vi.waitFor(() => expect(b.loadThreadHistory).toHaveBeenCalledWith(expect.objectContaining({ taskRef: 'task:1', limit: 20 })))

    const anchor = { messageRef: 'message:anchor', channelRef: 'channel:1', threadRef: 'thread:1', taskRef: 'task:1',
      sender: 'member:human', body: 'first task', topLevel: true, sequence: 2, occurredAt: '' }
    const historyWith = (facts: unknown[]) => b.loadThreadHistory.mockImplementation(async () => ({ ok: true as const, value: {
      task: { taskRef: 'task:1', channelRef: 'channel:1', status: 'todo', resolution: 'open' },
      thread: { threadRef: 'thread:1', revision: 2 }, anchor, claims: [], facts, cursor: 0, hasMore: false,
    } } as never))
    const backfillFact = { kind: 'message', sequence: 1, message: { messageRef: 'message:old-1', channelRef: 'channel:1', threadRef: 'thread:1',
      taskRef: 'task:1', sender: 'member:human', body: 'old backfill', topLevel: false, sequence: 1, occurredAt: '' }, mentions: [] }

    // The change stream swallows one wake inside its initial silent probe;
    // flush that probe so later wakes reach the listener.
    b.publishAgentReply()
    await vi.waitFor(() => expect(b.changes.mock.calls.some(([request]) => (request as { afterVersion?: number }).afterVersion === 1)).toBe(true))

    // Backfill from the wider passive window is already-read material, not news.
    historyWith([backfillFact])
    b.publishAgentReply()
    await waitFor(() => expect(b.loadThreadHistory).toHaveBeenLastCalledWith(expect.objectContaining({ taskRef: 'task:1', limit: 100 })))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(b.view.queryByText(/读取 \d+ 条新更新/)).toBeNull()

    // A reader scrolled away from the tail keeps the explicit new-updates action.
    const timelineSection = document.querySelector('section[aria-label="消息时间线"]') as HTMLElement
    Object.defineProperty(timelineSection, 'scrollHeight', { configurable: true, value: 1000 })
    Object.defineProperty(timelineSection, 'clientHeight', { configurable: true, value: 120 })
    fireEvent.scroll(timelineSection)

    // A fact newer than everything shown is genuinely new and countable.
    historyWith([{ ...backfillFact, sequence: 9, message: { ...backfillFact.message, messageRef: 'message:new-9', body: 'genuinely new', sequence: 9 } }])
    b.publishAgentReply()
    expect(await b.view.findByText('读取 1 条新更新')).toBeTruthy()
    fireEvent.click(b.view.getByRole('button', { name: '标记为已读' }))
    await waitFor(() => expect(b.readThread).toHaveBeenCalledTimes(2))
    expect(b.view.queryByText(/读取 \d+ 条新更新/)).toBeNull()
    await b.runtime.dispose()
  })

  it('acknowledges arrivals a bottom-pinned reader is watching instead of prompting a manual read', async () => {
    const b = await runtimeWithTeam()
    fireEvent.click(b.view.getByRole('button', { name: '团队' }))
    fireEvent.click(await b.view.findByRole('button', { name: '新建频道' }))
    fireEvent.change(b.view.getByLabelText('名称'), { target: { value: 'backend' } })
    fireEvent.change(b.view.getByLabelText(/说明/), { target: { value: 'API' } })
    fireEvent.click(b.view.getByRole('button', { name: /初始成员/ }))
    fireEvent.click(await within(document.body).findByRole('menuitem', { name: /builder/ }))
    fireEvent.click(b.view.getByRole('button', { name: '创建频道' }))
    fireEvent.click(await b.view.findByRole('button', { name: '# backend' }))
    expect(await b.view.findByRole('heading', { name: '# backend' })).toBeTruthy()
    const messageInput = b.view.getByRole('textbox', { name: '消息内容' }) as HTMLTextAreaElement
    fireEvent.change(messageInput, { target: { value: 'first task' } })
    fireEvent.click(b.view.getByRole('button', { name: '作为任务' }))
    fireEvent.click(b.view.getByRole('button', { name: '发送' }))
    expect(await b.view.findByText('first task')).toBeTruthy()
    fireEvent.click(b.view.getByRole('button', { name: '打开 Task #1' }))
    expect(await b.view.findByRole('heading', { name: 'Task #1' })).toBeTruthy()
    await vi.waitFor(() => expect(b.loadThreadHistory).toHaveBeenCalledWith(expect.objectContaining({ taskRef: 'task:1', limit: 20 })))
    expect(b.readThread).toHaveBeenCalledTimes(1)

    const anchor = { messageRef: 'message:anchor', channelRef: 'channel:1', threadRef: 'thread:1', taskRef: 'task:1',
      sender: 'member:human', body: 'first task', topLevel: true, sequence: 2, occurredAt: '' }
    const watchedFact = { kind: 'message', sequence: 9, message: { messageRef: 'message:new-9', channelRef: 'channel:1', threadRef: 'thread:1',
      taskRef: 'task:1', sender: 'member:builder', body: 'watched live', topLevel: false, sequence: 9, occurredAt: '' }, mentions: [] }
    b.loadThreadHistory.mockImplementation(async () => ({ ok: true as const, value: {
      task: { taskRef: 'task:1', channelRef: 'channel:1', status: 'todo', resolution: 'open' },
      thread: { threadRef: 'thread:1', revision: 3 }, anchor, claims: [], facts: [watchedFact], cursor: 0, hasMore: false,
    } } as never))

    // The change stream swallows one wake inside its initial silent probe;
    // flush that probe so later wakes reach the listener.
    b.publishChannelUpdate()
    await vi.waitFor(() => expect(b.changes.mock.calls.some(([request]) => (request as { afterVersion?: number }).afterVersion === 1)).toBe(true))

    // jsdom never scrolls the reader away from the bottom, so the arriving
    // fact renders in front of them and must be acknowledged durably rather
    // than counted into the explicit new-updates prompt.
    b.publishChannelUpdate()
    await waitFor(() => expect(b.view.queryByText(/读取 \d+ 条新更新/)).toBeNull())
    expect(await b.view.findByText('watched live')).toBeTruthy()
    await waitFor(() => expect(b.readThread).toHaveBeenCalledTimes(2))
    expect(b.view.queryByRole('button', { name: '标记为已读' })).toBeNull()
    await b.runtime.dispose()
  })
  it('refreshes the sidebar Channel list from one workspace change', async () => {
    const b = await runtimeWithTeam({ mode: 'team', workspaceId: 'w1' })
    await b.view.findByText('还没有频道')
    expect(b.view.queryByRole('button', { name: '# gamma' })).toBeNull()
    b.seedChannel({ channelRef: 'channel:gamma', workspaceId: 'w1', name: 'gamma', description: 'Gamma work', createdAtSequence: 2 })
    // The stream's initial probe samples silently, so the first external bump
    // only arms the parked poll; the second one is what wakes the listener.
    b.publishChannelUpdate()
    await vi.waitFor(() => expect(b.changes.mock.calls.length).toBeGreaterThanOrEqual(2))
    b.publishChannelUpdate()
    await b.view.findByRole('button', { name: '# gamma' })
    expect(b.view.queryByText('还没有频道')).toBeNull()
    await b.runtime.dispose()
  })

  it('anchors timeline days when messages span dates', async () => {
    const b = await runtimeWithTeam({ mode: 'team', workspaceId: 'w1', initialChannels: true, seededMessages: [
      { body: 'day one status', occurredAt: '2026-08-19T09:00:00.000Z' },
      { body: 'day two follow-up', occurredAt: '2026-08-21T04:00:00.000Z' },
    ] })
    fireEvent.click(await b.view.findByRole('button', { name: '# engineering' }))
    expect(await b.view.findByText('day two follow-up')).toBeTruthy()
    // Exactly one quiet anchor for the crossed boundary; the first message of
    // the timeline opens its day without a leading marker.
    const dayAnchors = Array.from(b.view.container.querySelectorAll('p span')).filter(node => /^\d{2}-\d{2}$/.test(node.textContent ?? ''))
    expect(dayAnchors.map(node => node.textContent)).toEqual(['08-21'])
    await b.runtime.dispose()
  })

  it('separates wide same-sender gaps with a turn divider on both timelines', async () => {
    const b = await runtimeWithTeam({ mode: 'team', workspaceId: 'w1', initialChannels: true, seededMessages: [
      { body: 'burst one', occurredAt: '2026-08-21T09:00:00.000Z' },
      { body: 'burst two', occurredAt: '2026-08-21T09:01:00.000Z' },
      { body: 'later publication', occurredAt: '2026-08-21T11:30:00.000Z' },
    ] })
    fireEvent.click(await b.view.findByRole('button', { name: '# engineering' }))
    expect(await b.view.findByText('later publication')).toBeTruthy()
    // Only the two-hour gap earns a divider; the one-minute burst stays a
    // seamless run, and the label carries the later message's instant.
    const channelDividers = b.view.getAllByRole('separator')
    expect(channelDividers).toHaveLength(1)
    expect(channelDividers[0]!.querySelector('time')?.getAttribute('datetime')).toBe('2026-08-21T11:30:00.000Z')

    fireEvent.click(b.view.getAllByRole('button', { name: '打开 Task #1' })[0]!)
    expect(await b.view.findByRole('heading', { name: 'Task #1' })).toBeTruthy()
    const threadDividers = b.view.getAllByRole('separator')
    expect(threadDividers).toHaveLength(1)
    expect(threadDividers[0]!.querySelector('time')?.getAttribute('datetime')).toBe('2026-08-21T11:30:00.000Z')
    await b.runtime.dispose()
  })

  it('linkifies branded refs in plain bodies and navigates on click', async () => {
    const taskRef = 'task:0f0ad7ce-11d3-4c05-8a9e-6f2b1c9d7e21'
    const b = await runtimeWithTeam({
      mode: 'team', workspaceId: 'w1', initialChannels: true,
      seedTaskRef: taskRef, seedThreadRef: 'thread:0f0ad7ce-11d3-4c05-8a9e-6f2b1c9d7e22',
      seededMessages: [{ body: `see ${taskRef} and channel:engineering for prose`, occurredAt: '2026-08-21T09:00:00.000Z' }],
    })
    fireEvent.click(await b.view.findByRole('button', { name: '# engineering' }))
    // Only the fixed-prefix + UUID shape linkifies; `channel:engineering`
    // stays literal prose.
    expect(b.view.queryByText(taskRef)).toBeNull()
    const link = await b.view.findByRole('button', { name: taskRef })
    fireEvent.click(link)
    await waitFor(() => expect(b.readThread).toHaveBeenCalledWith(expect.objectContaining({ taskRef })))
    expect(await b.view.findByRole('heading', { name: 'Task #1' })).toBeTruthy()
    await b.runtime.dispose()
  })

  it('sends a Channel message as a taskless Thread unless As task is pressed', async () => {
    const b = await runtimeWithTeam()
    fireEvent.click(b.view.getByRole('button', { name: '团队' }))
    fireEvent.click(await b.view.findByRole('button', { name: '新建频道' }))
    fireEvent.change(b.view.getByLabelText('名称'), { target: { value: 'backend' } })
    fireEvent.change(b.view.getByLabelText(/说明/), { target: { value: 'API' } })
    fireEvent.click(b.view.getByRole('button', { name: '创建频道' }))
    fireEvent.click(await b.view.findByRole('button', { name: '# backend' }))
    expect(await b.view.findByRole('heading', { name: '# backend' })).toBeTruthy()
    fireEvent.change(b.view.getByRole('textbox', { name: '消息内容' }), { target: { value: 'plain thread' } })
    expect(b.view.getByRole('button', { name: '作为任务' }).getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(b.view.getByRole('button', { name: '发送' }))
    await waitFor(() => expect(b.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ body: 'plain thread', asTask: false })))
    expect(await b.view.findByRole('button', { name: '打开讨论' })).toBeTruthy()
    expect(b.view.queryByRole('button', { name: '打开 Task #1' })).toBeNull()
    fireEvent.click(b.view.getByRole('button', { name: '打开讨论' }))
    expect(await b.view.findByRole('heading', { name: '讨论' })).toBeTruthy()
    expect(b.view.queryByRole('button', { name: /Claims/ })).toBeNull()
    expect(b.view.queryByRole('button', { name: '验收' })).toBeNull()
    expect(b.view.getByRole('button', { name: '转为 Task' })).toBeTruthy()
    fireEvent.click(b.view.getByRole('button', { name: '转为 Task' }))
    await waitFor(() => expect(b.promoteThread).toHaveBeenCalledWith(expect.objectContaining({
      threadRef: 'thread:1',
    })))
    await waitFor(() => expect(b.readThread).toHaveBeenCalledWith(expect.objectContaining({ threadRef: 'thread:1' })))
    expect(await b.view.findByRole('heading', { name: 'Task #1' })).toBeTruthy()
    expect(b.view.queryByRole('button', { name: '转为 Task' })).toBeNull()
    await b.runtime.dispose()
  })

  it('resets As task after a committed Task send and keeps it after a failed send', async () => {
    const b = await runtimeWithTeam()
    fireEvent.click(b.view.getByRole('button', { name: '团队' }))
    fireEvent.click(await b.view.findByRole('button', { name: '新建频道' }))
    fireEvent.change(b.view.getByLabelText('名称'), { target: { value: 'backend' } })
    fireEvent.click(b.view.getByRole('button', { name: '创建频道' }))
    fireEvent.click(await b.view.findByRole('button', { name: '# backend' }))
    expect(await b.view.findByRole('heading', { name: '# backend' })).toBeTruthy()
    const toggle = () => b.view.getByRole('button', { name: '作为任务' })
    fireEvent.click(toggle())
    expect(toggle().getAttribute('aria-pressed')).toBe('true')
    fireEvent.change(b.view.getByRole('textbox', { name: '消息内容' }), { target: { value: 'keep toggle' } })
    b.sendMessage.mockResolvedValueOnce({ ok: false, error: { message: 'send failed' } } as never)
    fireEvent.click(b.view.getByRole('button', { name: '发送' }))
    expect((await b.view.findByRole('alert')).textContent).toContain('send failed')
    expect(toggle().getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(b.view.getByRole('button', { name: '发送' }))
    await waitFor(() => expect(b.sendMessage).toHaveBeenLastCalledWith(expect.objectContaining({ body: 'keep toggle', asTask: true })))
    await waitFor(() => expect(toggle().getAttribute('aria-pressed')).toBe('false'))
    await b.runtime.dispose()
  })
})
