import { cp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { chromium, type Browser } from 'playwright'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspaceZh } from './support.ts'

const TEAM_ROOT = '__TEAM_ROOT__'
const OVERLAY = '__OVERLAY__'
const HOME = '__HOME__'
const CHROME = '__CHROME__'
const BROWSER_ARTIFACTS = join(TEAM_ROOT, 'artifacts/browser')
const UI01_SHOTS = join(BROWSER_ARTIFACTS, 'ui-01')
const UI02_SHOTS = join(BROWSER_ARTIFACTS, 'ui-02')
const UI03_SHOTS = join(BROWSER_ARTIFACTS, 'ui-03')
const UI04_SHOTS = join(BROWSER_ARTIFACTS, 'ui-04')
const UI05_SHOTS = join(BROWSER_ARTIFACTS, 'ui-05')
const UI06_SHOTS = join(BROWSER_ARTIFACTS, 'ui-06')
let scaffold: WebScaffold | undefined
let browser: Browser | undefined

afterEach(async () => {
  await browser?.close(); browser = undefined
  await scaffold?.close(); scaffold = undefined
})

async function installLocalBundle(): Promise<void> {
  await rm(HOME, { recursive: true, force: true })
  await rm(BROWSER_ARTIFACTS, { recursive: true, force: true })
  const scope = `${HOME}/profiles/node_modules/@wowyuarm`
  await mkdir(scope, { recursive: true })
  await cp(TEAM_ROOT, `${scope}/dsh-agent-team`, {
    recursive: true,
    filter: source => !source.includes('/node_modules') && !source.includes('/src') && !source.includes('/artifacts'),
  })
  // The routed ledger backend in its installed position. A real `dsh plugin
  // add` installs this bundle's dependencies under the profile tree; this
  // lane emulates the layout, so the dependency links beside the copied
  // bundle instead of relying on the harness app's own dependency closure.
  const storageSqliteLink = join(HOME, 'profiles/node_modules/@deepseek-ai/dsh-storage-sqlite')
  await mkdir(join(storageSqliteLink, '..'), { recursive: true })
  await symlink(join(process.cwd(), 'packages/storage/storage-sqlite'), storageSqliteLink, 'junction')
  await mkdir(UI01_SHOTS, { recursive: true })
  await mkdir(UI02_SHOTS, { recursive: true })
  await mkdir(UI03_SHOTS, { recursive: true })
  await mkdir(UI04_SHOTS, { recursive: true })
  await mkdir(UI05_SHOTS, { recursive: true })
  await mkdir(UI06_SHOTS, { recursive: true })
}

it('drives the complete opt-in Agent Team journey in real Web', async () => {
  await installLocalBundle()
  scaffold = await launchWebScaffold({ extraOverlayPath: OVERLAY, harnessHome: HOME })
  browser = await chromium.launch({ headless: true, executablePath: CHROME })
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, locale: 'zh-CN' })
  const consoleWatch = watchConsole(page)
  await page.goto(scaffold.baseUrl)
  await connectFreshWorkspaceZh(page, scaffold.workspaceCwd, 'team-workspace')
  const ordinaryComposer = page.locator('textarea:enabled[placeholder="描述你想要构建的内容"]')
  await expect.poll(() => ordinaryComposer.count()).toBe(1)

  expect(scaffold.ctx.clientModules.graph().entries.some(entry => entry.id === '@wowyuarm/dsh-agent-team')).toBe(true)
  const teamTrigger = page.getByRole('button', { name: '团队' })
  const settingsTrigger = page.getByRole('button', { name: '设置' })
  const [teamBox, settingsBox] = await Promise.all([teamTrigger.boundingBox(), settingsTrigger.boundingBox()])
  expect(teamBox).not.toBeNull()
  expect(settingsBox).not.toBeNull()
  await teamTrigger.click()
  const conversationTrigger = page.getByRole('button', { name: '对话' })
  const membersTrigger = page.getByRole('button', { name: '成员' })
  const [conversationBox, membersTriggerBox] = await Promise.all([conversationTrigger.boundingBox(), membersTrigger.boundingBox()])
  expect(conversationBox).not.toBeNull()
  expect(membersTriggerBox).not.toBeNull()
  expect(conversationBox!.y).toBeCloseTo(teamBox!.y, 0)
  expect(conversationBox!.height).toBeCloseTo(teamBox!.height, 0)
  expect(membersTriggerBox!.y).toBeCloseTo(settingsBox!.y, 0)
  expect(membersTriggerBox!.height).toBeCloseTo(settingsBox!.height, 0)
  const newSessionButtons = page.locator('button[aria-label="新建会话"]')
  const newSessionButton = page.locator('button[class*="newSession"][aria-label="新建会话"]')
  const brandButton = page.locator('button[class*="brand"][aria-label="新建会话"]')
  await expect.poll(() => newSessionButtons.count()).toBe(2)
  await expect.poll(() => newSessionButton.count()).toBe(1)
  await expect.poll(() => newSessionButton.isVisible()).toBe(false)
  await expect.poll(() => brandButton.count()).toBe(1)
  await expect.poll(() => brandButton.isVisible()).toBe(true)
  await page.getByRole('button', { name: '新建频道' }).click()
  const initialChannelDialog = page.getByRole('dialog', { name: '新建频道' })
  await initialChannelDialog.getByLabel('名称').fill('engineering')
  await initialChannelDialog.getByLabel('说明').fill('Agent membership')
  await initialChannelDialog.getByRole('button', { name: '创建频道' }).click()

  for (const [name, description] of [['builder', '实现功能'], ['reviewer', '检查结果']] as const) {
    await page.getByRole('button', { name: '添加 Agent' }).click()
    const dialog = page.getByRole('dialog', { name: '添加 Agent' })
    await dialog.getByLabel('名称').fill(name)
    await dialog.getByLabel('说明').fill(description)
    // Initial Channels ride the shared multi-select Menu now.
    await dialog.getByRole('button', { name: '初始频道' }).click()
    await page.getByRole('menuitem', { name: 'engineering' }).click()
    if (name === 'builder') {
      await page.screenshot({ path: join(UI03_SHOTS, 'agent-create-modal.png'), fullPage: true })
      // The model picker caps its card and scrolls internally.
      await dialog.getByRole('button', { name: '模型' }).click()
      await page.getByRole('menuitem', { name: '跟随全局默认' }).waitFor()
      await page.screenshot({ path: join(UI03_SHOTS, 'agent-create-model-menu.png'), fullPage: true })
      // Selecting the default row closes the menu and keeps the model unset
      // (Escape would bubble to the Modal and close the whole dialog).
      await page.getByRole('menuitem', { name: '跟随全局默认' }).click()
      // The Input atoms sit evenly inside the dialog card (the lopsided
      // right gutter regression this guard pins).
      const inputBox = await dialog.getByLabel('名称').boundingBox()
      const cardBox = await dialog.boundingBox()
      expect(inputBox).not.toBeNull()
      expect(cardBox).not.toBeNull()
      const leftGap = inputBox!.x - cardBox!.x
      const rightGap = cardBox!.x + cardBox!.width - (inputBox!.x + inputBox!.width)
      expect(Math.abs(leftGap - rightGap)).toBeLessThanOrEqual(2)
    }
    await dialog.getByRole('button', { name: '创建 Agent' }).click()
    await page.getByText(name, { exact: true }).waitFor({ timeout: 20_000 })
  }
  // Narrow-viewport create form with every field optional.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: '添加 Agent' }).click()
  const narrowDialog = page.getByRole('dialog', { name: '添加 Agent' })
  await narrowDialog.getByLabel('名称').waitFor()
  const narrowBox = await narrowDialog.boundingBox()
  expect(narrowBox).not.toBeNull()
  expect(narrowBox!.x).toBeGreaterThanOrEqual(0)
  expect(narrowBox!.x + narrowBox!.width).toBeLessThanOrEqual(390)
  await page.screenshot({ path: join(UI03_SHOTS, 'agent-create-modal-narrow.png'), fullPage: true })
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 1440, height: 960 })
  await expect.poll(() => page.getByLabel('可用').count(), { timeout: 20_000 }).toBeGreaterThanOrEqual(2)
  await page.screenshot({ path: join(UI02_SHOTS, 'sidebar-agents.png'), fullPage: true })

  await page.getByRole('button', { name: '新建频道' }).click()
  const channelDialog = page.getByRole('dialog', { name: '新建频道' })
  await channelDialog.getByLabel('名称').fill('delivery')
  await channelDialog.getByLabel('说明').fill('M2 完整协作验收')
  // Initial members ride the shared multi-select Menu now.
  await channelDialog.getByRole('button', { name: '初始成员' }).click()
  await page.getByRole('menuitem', { name: /builder/ }).click()
  await page.getByRole('menuitem', { name: /reviewer/ }).click()
  await expect.poll(async () => (await channelDialog.getByRole('button', { name: /初始成员/ }).textContent())?.trim() ?? '').toContain('已选 2 个成员')
  await page.screenshot({ path: join(UI03_SHOTS, 'channel-create-modal.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  const dialogBox = await channelDialog.boundingBox()
  expect(dialogBox).not.toBeNull()
  expect(dialogBox!.x).toBeGreaterThanOrEqual(0)
  expect(dialogBox!.y).toBeGreaterThanOrEqual(0)
  expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(390)
  expect(dialogBox!.y + dialogBox!.height).toBeLessThanOrEqual(844)
  await page.screenshot({ path: join(UI03_SHOTS, 'channel-create-modal-narrow.png'), fullPage: true })
  await page.setViewportSize({ width: 1440, height: 960 })
  await channelDialog.getByRole('button', { name: '创建频道' }).click()
  await page.getByRole('button', { name: '# delivery' }).click()
  await page.getByText('还没有消息', { exact: true }).waitFor()
  await page.screenshot({ path: join(UI02_SHOTS, 'sidebar-channels.png'), fullPage: true })

  // Sidebar ordering: whole-row native drag reuses the Harness list model —
  // a before/after insertion marker, one commit per gesture — and the personal
  // order lives in this browser only, folded over the Remote default on load.
  const channelOrder = (): Promise<string[]> => page.evaluate(() =>
    [...document.querySelectorAll('[class*="channelSelect"] strong')].map(node => node.textContent?.trim().replace(/^#\s*/, '') ?? ''))
  await expect.poll(channelOrder).toEqual(['engineering', 'delivery'])
  const deliveryRow = page.getByRole('button', { name: '# delivery' })
  const dropBelowTopHalfOf = async (locator: ReturnType<typeof page.getByRole>): Promise<void> => {
    const box = await locator.boundingBox()
    if (box === null) throw new Error('drop target vanished')
    const dataTransfer = await page.evaluateHandle(() => new DataTransfer())
    const draggingRow = page.getByRole('button', { name: '# engineering' })
    await draggingRow.dispatchEvent('dragstart', { dataTransfer })
    await locator.dispatchEvent('dragover', { dataTransfer, clientY: box.y + box.height * 0.75 })
    // The insertion marker is part of the contract: the lower half of the
    // target row must paint the drop-after line before anything commits.
    const deliveryWrapper = locator.locator('xpath=ancestor::div[1]')
    await expect.poll(async () =>
      await deliveryWrapper.evaluate(element => element.className.includes('sidebarRowDropAfter'))).toBe(true)
    await page.screenshot({ path: join(UI02_SHOTS, 'channel-drop-marker.png'), fullPage: true })
    await locator.dispatchEvent('drop', { dataTransfer, clientY: box.y + box.height * 0.75 })
    await draggingRow.dispatchEvent('dragend', { dataTransfer })
  }
  await dropBelowTopHalfOf(deliveryRow)
  await expect.poll(channelOrder).toEqual(['delivery', 'engineering'])
  // The committed order survives a full reload: boot restore folds the saved
  // preference over the freshly loaded Remote default order.
  await page.reload()
  // Boot restore lands on the persisted Thread route; the channel list is one
  // explicit step back.
  await page.getByRole('heading', { name: '# delivery' }).waitFor({ timeout: 20_000 })
  await page.getByRole('button', { name: '返回频道列表' }).click()
  await expect.poll(channelOrder, { timeout: 20_000 }).toEqual(['delivery', 'engineering'])
  // A brand-new channel appends after the user's saved entries.
  await page.getByRole('button', { name: '新建频道' }).click()
  const rampDialog = page.getByRole('dialog', { name: '新建频道' })
  await rampDialog.getByLabel('名称').fill('ramp')
  await rampDialog.getByRole('button', { name: '创建频道' }).click()
  await expect.poll(channelOrder).toEqual(['delivery', 'engineering', 'ramp'])

  // Sidebar row menus: the ⋯ entry opens the M2 editors — display facts plus
  // membership. 保存 stays disabled until a field actually changes, and the
  // committed rename reaches the row through the refreshed projection.
  await page.getByRole('button', { name: '# engineering' }).hover()
  await page.getByRole('button', { name: 'engineering 的操作' }).click()
  await page.getByRole('menuitem', { name: '编辑频道' }).click()
  const channelEditor = page.getByRole('dialog', { name: '编辑频道' })
  await channelEditor.waitFor()
  expect(await channelEditor.getByText('@builder').count()).toBe(1)
  const channelSave = channelEditor.getByRole('button', { name: '保存' })
  await expect.poll(async () => await channelSave.isDisabled()).toBe(true)
  await channelEditor.getByLabel('说明').fill('Platform delivery work')
  await expect.poll(async () => await channelSave.isDisabled()).toBe(false)
  await page.screenshot({ path: join(UI04_SHOTS, 'channel-edit-modal.png'), fullPage: true })
  await channelSave.click()
  await expect.poll(() => page.getByRole('dialog', { name: '编辑频道' }).count()).toBe(0)
  await page.getByRole('button', { name: '# engineering' }).hover()
  await page.getByRole('button', { name: 'engineering 的操作' }).click()
  await page.getByRole('menuitem', { name: '编辑频道' }).click()
  const channelRecheck = page.getByRole('dialog', { name: '编辑频道' })
  await channelRecheck.waitFor()
  await expect.poll(async () => channelRecheck.getByLabel('说明').inputValue()).toBe('Platform delivery work')
  await channelRecheck.getByRole('button', { name: '关闭', exact: true }).click()
  await expect.poll(() => page.getByRole('dialog', { name: '编辑频道' }).count()).toBe(0)
  // Collapsed sections hide their rows until expanded again.
  const channelsToggle = page.getByRole('button', { name: '频道', exact: true })
  await channelsToggle.click()
  await expect.poll(() => page.getByRole('button', { name: '# engineering' }).count()).toBe(0)
  await channelsToggle.click()
  await page.getByRole('button', { name: '# engineering' }).waitFor()

  const builderRow = page.locator('[class*="agentRow"]').filter({ hasText: 'builder' }).first()
  await builderRow.hover()
  await builderRow.getByRole('button', { name: 'builder 的操作' }).click()
  await page.getByRole('menuitem', { name: '编辑 Agent' }).click()
  const agentEditor = page.getByRole('dialog', { name: '编辑 Agent' })
  await agentEditor.waitFor()
  // builder joined engineering at provision time and delivery as an initial
  // member, so exactly those two Channel rows offer Remove once loaded.
  await expect.poll(() => agentEditor.getByRole('button', { name: '移除' }).count()).toBe(2)
  // The per-Member model picker rides the shared Menu primitive: the trigger
  // echoes the current selection and opening lists the Host catalog grouped
  // by provider without any live Session round-trip. Re-selecting the
  // default row closes it without dirtying the form.
  const modelTrigger = agentEditor.getByRole('button', { name: '模型', exact: true })
  await modelTrigger.waitFor()
  await expect.poll(() => modelTrigger.textContent()).toBe('跟随全局默认')
  await modelTrigger.click()
  const modelMenu = page.locator('[role="menu"]').filter({ hasText: '跟随全局默认' })
  await modelMenu.waitFor()
  expect(await modelMenu.getByRole('menuitem').count()).toBeGreaterThanOrEqual(2)
  await page.screenshot({ path: join(UI04_SHOTS, 'agent-model-menu.png'), fullPage: true })
  await modelMenu.getByRole('menuitem', { name: '跟随全局默认' }).click()
  await expect.poll(() => page.locator('[role="menu"]').count()).toBe(0)
  await page.screenshot({ path: join(UI04_SHOTS, 'agent-edit-modal.png'), fullPage: true })
  await agentEditor.getByRole('button', { name: '关闭', exact: true }).click()

  const memberWorkspace = scaffold.ctx.workspaceRegistry.list()[0]!
  const memberStatuses = scaffold.ctx.agentTeam.members({ workspaceId: memberWorkspace.id })
  const builderMember = memberStatuses.find((status: { member: { handle: string } }) => status.member.handle === 'builder')!
  const reviewerMember = memberStatuses.find((status: { member: { handle: string } }) => status.member.handle === 'reviewer')!
  const builderAgent = scaffold.ctx.agents.get(builderMember.member.sessionId)!

  // Clicking the Agent card keeps Team mode mounted and swaps only the right
  // pane: the conversation shadow stands down so the shipped root renders the
  // Member Session between the Team sidebars. A Member session has no human
  // turns yet, so DSH renders its blank-session view — the hero composer
  // carrying the Member's workspace + `team-member` preset chips.
  await builderRow.getByRole('button', { name: '打开 builder 的会话' }).click()
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.agentTeamMode ?? null)).toBe('team')
  await expect.poll(() => page.locator('[data-team-channel]').count()).toBe(0)
  const memberComposer = page.locator('[data-team-member-composer="true"]')
  await expect.poll(() => memberComposer.count()).toBe(1)
  const memberInput = memberComposer.getByRole('textbox')
  await expect.poll(() => memberInput.isEnabled()).toBe(true)
  // This restricted Member composer intentionally has no attachment seam or
  // fake "+" control; Channel/Thread attachment flows stay separate.
  await expect.poll(() => memberComposer.getByRole('button', { name: '添加附件' }).count()).toBe(0)
  const compactEventsBefore = builderAgent.session.events.filter(event => event.type === 'command/run' || event.type === 'command/done').length
  await memberInput.fill('/co')
  await page.getByRole('option', { name: '/compact' }).waitFor()
  await page.screenshot({ path: join(UI04_SHOTS, 'agent-session-compact-menu.png'), fullPage: true })
  await page.getByRole('option', { name: '/compact' }).click()
  await memberInput.press('Enter')
  await expect.poll(() => builderAgent.session.events.filter(event => event.type === 'command/run' || event.type === 'command/done').length).toBe(compactEventsBefore + 2)
  const compactLifecycle = builderAgent.session.events.filter(event => event.type === 'command/run' || event.type === 'command/done').slice(-2)
  expect(compactLifecycle[0]).toMatchObject({ type: 'command/run', data: { name: 'compact', source: { kind: 'user' } } })
  expect(compactLifecycle[1]).toMatchObject({ type: 'command/done', data: { commandId: (compactLifecycle[0] as { data: { commandId: string } }).data.commandId } })
  // The Host lifecycle acknowledgment and Client InputMachine settlement arrive
  // independently. Do not begin the next DOM edit until the compact claim has
  // consumed its own draft, or its late success could clear that next draft.
  await expect.poll(() => memberInput.inputValue()).toBe('')

  await memberInput.fill('@rev')
  await page.getByRole('option', { name: '@reviewer' }).waitFor()
  await page.getByRole('option', { name: '@reviewer' }).click()
  await expect.poll(() => memberInput.inputValue()).toBe('@reviewer ')
  await memberInput.press('Enter')
  const isStructuredReviewerPrompt = (event: (typeof builderAgent.session.events)[number]): boolean => event.type === 'user/message'
    && event.data.source.kind === 'user'
    && event.data.content.some(block => block.type === 'text' && block.text === `<team-member ref="${reviewerMember.member.memberId}">@reviewer</team-member>`)
  await expect.poll(() => builderAgent.session.events.some(isStructuredReviewerPrompt)).toBe(true)
  await builderAgent.whenIdle()
  const mentionPrompt = builderAgent.session.events.findLast(isStructuredReviewerPrompt)
  expect(mentionPrompt).toBeDefined()
  await memberInput.fill('newline')
  await memberInput.press('Shift+Enter')
  expect(await memberInput.inputValue()).toBe('newline\n')
  await expect.poll(() => page.getByText('team-member', { exact: true }).count()).toBe(1)
  await expect.poll(() => page.locator('[class*="agentRow"]').count()).toBeGreaterThan(0)
  // The single positioning highlight sits on the selected Agent card; the
  // workspace overview row stays quiet while the Member view is open.
  await expect.poll(() => page.locator('[aria-current="page"]').count()).toBe(1)
  await expect.poll(() => page.locator('[aria-current="page"]').getAttribute('aria-label')).toBe('打开 builder 的会话')
  await expect.poll(() => page.getByRole('button', { name: '# delivery' }).count()).toBe(1)
  await page.screenshot({ path: join(UI04_SHOTS, 'agent-session-dm.png'), fullPage: true })
  // Opening the row menu on the selected card must show ONE seamless full-row
  // fill: the leaf's resident fill is suppressed while the row paints its own.
  await builderRow.hover()
  await builderRow.getByRole('button', { name: 'builder 的操作' }).click()
  await page.getByRole('menuitem', { name: '编辑 Agent' }).waitFor()
  await expect.poll(() => page.evaluate(() => {
    const el = document.querySelector('[aria-current="page"]')
    return el === null ? 'missing' : getComputedStyle(el).backgroundColor
  })).toBe('rgba(0, 0, 0, 0)')
  await page.screenshot({ path: join(UI04_SHOTS, 'agent-session-dm-row-menu.png'), fullPage: true })
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.screenshot({ path: join(UI04_SHOTS, 'agent-session-dm-narrow.png'), fullPage: true })
  await page.setViewportSize({ width: 1440, height: 960 })
  // Explicit Team navigation closes the embedded Member view again.
  await page.getByRole('button', { name: '# delivery' }).click()
  await page.getByRole('heading', { name: '# delivery' }).waitFor()
  await expect.poll(() => page.locator('[data-team-channel]').count()).toBe(1)
  await page.getByText('还没有消息', { exact: true }).waitFor()
  await page.screenshot({ path: join(UI02_SHOTS, 'sidebar-channels.png'), fullPage: true })
  await page.screenshot({ path: join(UI01_SHOTS, 'empty-channel.png'), fullPage: true })
  const channelComposer = page.getByRole('textbox', { name: '消息内容' })
  await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe('消息内容')
  await page.getByRole('button', { name: '返回频道列表' }).focus()
  const idleComposerBorder = await page.locator('[data-team-composer]').evaluate(element => getComputedStyle(element).borderColor)
  await channelComposer.click()
  expect(await page.locator('[data-team-composer]').evaluate(element => getComputedStyle(element).borderColor)).toBe(idleComposerBorder)
  await channelComposer.fill('请协作完成验收 @')
  await page.getByRole('option', { name: /@builder/ }).click()
  await page.screenshot({ path: join(UI04_SHOTS, 'mention-menu-selected.png'), fullPage: true })
  const asTaskToggle = page.getByRole('button', { name: '作为任务' })
  await expect.poll(() => asTaskToggle.getAttribute('aria-pressed')).toBe('false')
  await asTaskToggle.focus()
  await page.keyboard.press('Space')
  await expect.poll(() => asTaskToggle.getAttribute('aria-pressed')).toBe('true')
  await page.getByRole('button', { name: '发送' }).click()
  const committedMessage = page.locator('[data-team-channel] article').filter({ hasText: '请协作完成验收' })
  await committedMessage.waitFor()
  await expect.poll(() => asTaskToggle.getAttribute('aria-pressed')).toBe('false')
  await expect.poll(() => page.getByRole('textbox', { name: '消息内容' }).inputValue()).toBe('')
  await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe('消息内容')
  await page.getByRole('button', { name: '发送', exact: true }).waitFor()

  // Branded-ref linkify: a UUID-shaped task ref in a plain body renders as a
  // real link control (click-to-navigate is component-tested against the
  // resolved selectThread call); non-UUID `channel:` prose stays literal.
  await channelComposer.fill('请复核 task:c0ffee00-1234-4c05-8a9e-6f2b1c9d7e21 与 channel:engineering 的口径')
  await page.getByRole('button', { name: '发送' }).click()
  const refMessage = page.locator('[data-team-channel] article').filter({ hasText: '请复核' })
  await refMessage.waitFor()
  const refLink = refMessage.getByRole('button', { name: /task:c0ffee00/ })
  await refLink.waitFor()
  expect(await refMessage.getByRole('button', { name: /channel:engineering/ }).count()).toBe(0)
  expect((await refMessage.textContent())?.includes('channel:engineering')).toBe(true)
  expect(await refLink.evaluate(element => getComputedStyle(element).cursor)).toBe('pointer')
  await page.screenshot({ path: join(UI04_SHOTS, 'message-ref-linkify.png'), fullPage: true })

  // Attachment upload: the "+" picker takes real files, chips confirm the
  // selection, and the committed message renders the image thumbnail from the
  // Host cache — the full upload → ledger → display loop on the real app.
  // Upload a real screenshot-sized PNG so thumbnails and the zoom preview
  // demonstrate actual scaling, not a tiny fixture.
  const pngBytes = await readFile(join(UI02_SHOTS, 'sidebar-channels.png'))
  const uploadPath = join(BROWSER_ARTIFACTS, 'upload-fixture.png')
  await writeFile(uploadPath, pngBytes)
  // The "+" control must open the real file picker (not a command menu).
  const pickerPromise = page.waitForEvent('filechooser', { timeout: 5000 })
  await page.getByRole('button', { name: '添加附件' }).click()
  await pickerPromise
  await page.locator('[data-team-composer] input[type="file"]').setInputFiles([{ name: '验收截图.png', mimeType: 'image/png', buffer: pngBytes }])
  await page.getByText('验收截图.png').waitFor()
  await channelComposer.fill('这是带附件的验收消息')
  await page.screenshot({ path: join(UI04_SHOTS, 'composer-attachment-chip.png'), fullPage: true })
  await page.getByRole('button', { name: '发送' }).click()
  const attachmentMessage = page.locator('[data-team-channel] article').filter({ hasText: '这是带附件的验收消息' })
  await attachmentMessage.waitFor()
  await expect.poll(() => page.locator('[data-team-channel] article img[src^="data:image/png"]').count()).toBeGreaterThanOrEqual(1)
  await expect.poll(() => page.getByText('验收截图.png', { exact: true }).count()).toBe(0)
  await page.screenshot({ path: join(UI04_SHOTS, 'message-attachment-thumbnail.png'), fullPage: true })
  // Zoom: clicking the thumbnail opens a wide preview card over the mask.
  await page.locator('[data-team-channel] article img[src^="data:image/png"]').first().click()
  await page.getByRole('dialog').waitFor()
  await expect.poll(() => page.getByRole('dialog').locator('img').count()).toBe(1)
  await page.screenshot({ path: join(UI04_SHOTS, 'message-attachment-zoom.png'), fullPage: true })
  await page.keyboard.press('Escape')
  await expect.poll(() => page.getByRole('dialog').count()).toBe(0)

  // Narrow-viewport linkify row.
  await page.setViewportSize({ width: 390, height: 844 })
  await refMessage.getByRole('button', { name: /task:c0ffee00/ }).waitFor()
  await page.screenshot({ path: join(UI04_SHOTS, 'message-ref-linkify-narrow.png'), fullPage: true })
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.screenshot({ path: join(UI04_SHOTS, 'message-attachment-thumbnail-narrow.png'), fullPage: true })
  await page.setViewportSize({ width: 1440, height: 960 })
  const channelGeometry = await page.locator('[data-team-channel]').evaluate(element => {
    const children = [...element.children].map(child => child.getBoundingClientRect())
    return children.map(rect => ({ top: rect.top, bottom: rect.bottom, height: rect.height }))
  })
  expect(channelGeometry).toHaveLength(3)
  expect(channelGeometry[0]!.bottom).toBeLessThanOrEqual(channelGeometry[1]!.top + 1)
  expect(channelGeometry[1]!.bottom).toBeLessThanOrEqual(channelGeometry[2]!.top + 1)
  expect(channelGeometry[1]!.height).toBeGreaterThan(200)
  await page.screenshot({ path: join(UI01_SHOTS, 'desktop-channel.png'), fullPage: true })
  await page.getByRole('button', { name: '管理成员' }).click()
  await page.getByRole('dialog', { name: '频道成员' }).waitFor()
  await page.screenshot({ path: join(UI04_SHOTS, 'channel-members-modal.png'), fullPage: true })
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  const narrowChannelFrame = page.locator('[data-sidebar-collapsed="true"]')
  await narrowChannelFrame.waitFor()
  await expect.poll(async () => (await narrowChannelFrame.locator(':scope > div').first().boundingBox())?.width ?? 999).toBeLessThanOrEqual(56)
  await expect.poll(async () => (await page.locator('[data-team-channel]').boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(330)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.screenshot({ path: join(UI04_SHOTS, 'narrow-channel.png'), fullPage: true })
  await page.setViewportSize({ width: 1440, height: 960 })

  await channelComposer.fill('这是一条不作为任务的讨论')
  await expect.poll(() => asTaskToggle.getAttribute('aria-pressed')).toBe('false')
  await page.getByRole('button', { name: '发送' }).click()
  const tasklessMessage = page.locator('[data-team-channel] article').filter({ hasText: '这是一条不作为任务的讨论' })
  await tasklessMessage.waitFor()
  await page.setViewportSize({ width: 390, height: 844 })
  const tasklessChannelFrame = page.locator('[data-sidebar-collapsed="true"]')
  await tasklessChannelFrame.waitFor()
  await expect.poll(async () => (await tasklessChannelFrame.locator(':scope > div').first().boundingBox())?.width ?? 999).toBeLessThanOrEqual(56)
  await expect.poll(async () => (await page.locator('[data-team-channel]').boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(330)
  await tasklessMessage.getByRole('button', { name: '打开讨论' }).click()
  await page.getByRole('heading', { name: '讨论' }).waitFor()
  expect(await page.getByRole('button', { name: /Claims/ }).count()).toBe(0)
  expect(await page.getByRole('button', { name: '验收' }).count()).toBe(0)
  const promote = page.getByRole('button', { name: '转为 Task' })
  await promote.waitFor()
  const tasklessThreadFrame = page.locator('[data-sidebar-collapsed="true"]')
  await expect.poll(async () => (await tasklessThreadFrame.locator(':scope > div').first().boundingBox())?.width ?? 999).toBeLessThanOrEqual(56)
  await expect.poll(async () => (await page.locator('[data-team-thread]').boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(330)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.screenshot({ path: join(UI04_SHOTS, 'taskless-thread-narrow.png'), fullPage: true })
  await page.setViewportSize({ width: 1440, height: 960 })
  await promote.focus()
  await page.keyboard.press('Enter')
  await page.getByRole('heading', { name: 'Task #2' }).waitFor()
  await page.getByText('该 Thread 已创建 Task，现在可以合理 claim').waitFor()
  expect(await page.getByRole('button', { name: '转为 Task' }).count()).toBe(0)
  await page.getByRole('button', { name: '返回频道' }).click()
  await page.getByRole('heading', { name: '# delivery' }).waitFor()

  const workspace = scaffold.ctx.workspaceRegistry.list()[0]!
  const projection = scaffold.ctx.agentTeam.view({ workspaceId: workspace.id })
  const task = projection.tasks[0]!
  const statuses = scaffold.ctx.agentTeam.members({ workspaceId: workspace.id })
  const builder = statuses.find((status: { member: { handle: string } }) => status.member.handle === 'builder')!
  const reviewer = statuses.find((status: { member: { handle: string } }) => status.member.handle === 'reviewer')!
  const agent = scaffold.ctx.agents.get(builder.member.sessionId)!
  const reviewerAgent = scaffold.ctx.agents.get(reviewer.member.sessionId)!
  expect(scaffold.ctx.agentTeam.inboxForAgent(agent, { workspaceId: workspace.id })).toMatchObject({
    totalUnreadCount: 1,
    totalDirectCount: 1,
    items: [expect.objectContaining({ task: expect.objectContaining({ taskRef: task.taskRef }), directCount: 1 })],
  })

  await page.getByRole('button', { name: /Task #1/ }).click()
  const invitationComposer = page.getByRole('textbox', { name: '消息内容' })
  await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe('消息内容')
  await invitationComposer.fill('请 reviewer 加入这个已有 Thread 并回复 Human @re')
  await page.getByRole('option', { name: /@reviewer/ }).click()
  await invitationComposer.press('Enter')
  await page.getByRole('status').filter({ hasText: '再次发送' }).waitFor()
  await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe('消息内容')
  await invitationComposer.press('Enter')
  await page.locator('[data-team-thread] article').filter({ hasText: '请 @reviewer 加入这个已有 Thread 并回复 Human @reviewer' }).waitFor()
  const reviewerInbox = scaffold.ctx.agentTeam.inboxForAgent(reviewerAgent, { workspaceId: workspace.id })
  expect(reviewerInbox).toMatchObject({ totalDirectCount: 1, items: [expect.objectContaining({
    task: expect.objectContaining({ taskRef: task.taskRef }), directCount: 1,
  })] })
  const reviewerRead = await scaffold.ctx.agentTeam.readThreadForAgent(reviewerAgent, {
    requestId: 'm2-06-reviewer-read' as never, workspaceId: workspace.id, taskRef: task.taskRef,
  })
  const reviewerReply = await scaffold.ctx.agentTeam.replyForAgent(reviewerAgent, {
    requestId: 'm2-06-reviewer-reply' as never,
    workspaceId: workspace.id,
    taskRef: task.taskRef,
    body: `reviewer 已读取邀请并回复 Human，关联 **${task.taskRef}**；风格记录 \`task::${task.taskRef.slice('task:'.length)}\`\n\n- 已核实邀请`,
    baseRevision: reviewerRead.thread.revision,
    recipients: [scaffold.ctx.agentTeam.status().humanMemberId],
  })
  expect(reviewerReply.kind).toBe('committed')

  // Rich Agent Markdown keeps its structure while branded refs become inline
  // Task links: the bold prose ref and the model-style backticked doubled
  // colon both relabel to the human-facing number with the canonical full ref
  // on hover, and no doubled colon survives into the rendered DOM.
  const agentRefLinks = page.locator('[data-team-thread] article').filter({ hasText: 'reviewer 已读取邀请' }).getByRole('button', { name: /Task #\d+/ })
  await agentRefLinks.first().waitFor()
  expect(await agentRefLinks.count()).toBe(2)
  // The Host lookup relabels the raw UUID into the human-facing number; the
  // full ref stays on hover.
  await expect.poll(() => agentRefLinks.first().textContent()).toBe('Task #1')
  await expect.poll(() => agentRefLinks.nth(1).textContent()).toBe('Task #1')
  expect(await agentRefLinks.first().getAttribute('title')).toBe(task.taskRef)
  expect(await agentRefLinks.nth(1).getAttribute('title')).toBe(task.taskRef)
  expect(await page.getByText(`task::${task.taskRef.slice('task:'.length)}`).count()).toBe(0)
  expect(await agentRefLinks.first().locator('xpath=ancestor::strong').count()).toBe(1)
  expect(await page.getByText('已核实邀请', { exact: true }).count()).toBe(1)
  await agentRefLinks.first().click()
  await page.getByRole('heading', { name: /Task #1/ }).waitFor()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.locator('[data-sidebar-collapsed="true"]').waitFor()
  await agentRefLinks.first().scrollIntoViewIfNeeded()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.screenshot({ path: join(UI04_SHOTS, 'message-ref-inline-markdown-narrow.png'), fullPage: true })
  await page.setViewportSize({ width: 1440, height: 960 })

  // Human reply with attachment inside the Task Thread: the reply composer
  // offers the same "+" upload chain as the Channel composer.
  const replyPicker = page.waitForEvent('filechooser', { timeout: 5000 })
  await page.getByRole('button', { name: '添加附件' }).click()
  await replyPicker
  await page.locator('[data-team-composer] input[type="file"]').setInputFiles([{ name: 'thread-evidence.png', mimeType: 'image/png', buffer: pngBytes }])
  await page.getByText('thread-evidence.png').waitFor()
  await page.getByRole('textbox', { name: '消息内容' }).fill('这是带附件的 Thread 回复')
  await page.getByRole('button', { name: '发送' }).click()
  const replyWithFile = page.locator('article').filter({ hasText: '这是带附件的 Thread 回复' })
  await replyWithFile.waitFor()
  await expect.poll(() => replyWithFile.locator('img[src^="data:image/png"]').count()).toBeGreaterThanOrEqual(1)
  await expect.poll(() => page.getByText('thread-evidence.png', { exact: true }).count()).toBe(0)
  await page.screenshot({ path: join(UI04_SHOTS, 'thread-reply-attachment.png'), fullPage: true })

  await page.getByRole('button', { name: '返回频道' }).click()
  await page.getByRole('button', { name: /Task #1/ }).waitFor()
  await page.reload()
  await page.getByRole('button', { name: '# delivery' }).click()
  await page.getByRole('button', { name: /Task #1/ }).click()
  await page.getByText('reviewer 已读取邀请并回复 Human，关联', { exact: false }).waitFor()

  const replayedThread = scaffold.ctx.agentTeam.threadHistory({ workspaceId: workspace.id, taskRef: task.taskRef, limit: 100 })
  expect(JSON.stringify(replayedThread)).toContain('请 reviewer 加入这个已有 Thread 并回复 Human @reviewer')
  expect(JSON.stringify(replayedThread)).toContain('reviewer 已读取邀请并回复 Human')

  await page.getByRole('button', { name: '返回频道' }).click()
  await page.getByRole('button', { name: '# delivery' }).click()
  await page.getByRole('button', { name: /Task #1/ }).click()
  const agentRead = await scaffold.ctx.agentTeam.readThreadForAgent(agent, {
    requestId: 'm2-06-agent-read' as never, workspaceId: workspace.id, taskRef: task.taskRef,
  })
  const agentClaim = await scaffold.ctx.agentTeam.changeClaimForAgent(agent, {
    requestId: 'm2-06-agent-claim' as never, workspaceId: workspace.id,
    taskRef: task.taskRef, action: 'claim', direction: '实现验收功能', baseRevision: agentRead.thread.revision,
  })
  if (agentClaim.kind !== 'committed') throw new Error(`Agent Claim was rejected: ${agentClaim.kind}`)

  await page.getByRole('button', { name: /Claims · 1/ }).click()
  await page.getByText('实现验收功能', { exact: true }).waitFor()
  await page.getByText(/认领了「实现验收功能」/).waitFor()
  await page.screenshot({ path: join(UI05_SHOTS, 'active-thread.png'), fullPage: true })

  const threadComposer = page.getByRole('textbox', { name: '消息内容' })
  await threadComposer.fill('@re')
  await page.getByRole('option', { name: /@reviewer/ }).click()
  await page.screenshot({ path: join(UI05_SHOTS, 'thread-mention-menu.png'), fullPage: true })
  await threadComposer.fill('Human 已检查 Thread')
  await page.getByRole('button', { name: '发送' }).click()
  await page.getByText('Human 已检查 Thread', { exact: true }).waitFor()
  const agentReviewRead = await scaffold.ctx.agentTeam.readThreadForAgent(agent, {
    requestId: 'm2-06-agent-review-read' as never, workspaceId: workspace.id, taskRef: task.taskRef,
  })
  await scaffold.ctx.agentTeam.changeClaimForAgent(agent, {
    requestId: 'm2-06-agent-done' as never, workspaceId: workspace.id, taskRef: task.taskRef,
    claimRef: agentClaim.claim.claimRef, action: 'done', baseRevision: agentReviewRead.thread.revision,
  })
  await scaffold.ctx.agentTeam.readThread({
    requestId: 'm2-06-human-review-read' as never, workspaceId: workspace.id, taskRef: task.taskRef,
  })
  // One self-healing loop: press the live 验收 control whenever the Task is
  // still open, then wait for the ledger to show the committed acceptance.
  const acceptButtonsState = (): Promise<readonly { readonly text: string | null; readonly disabled: boolean }[]> =>
    page.evaluate(() => [...document.querySelectorAll('button')]
      .map(button => ({ text: button.textContent?.trim(), disabled: button.disabled }))
      .filter(entry => entry.text === '验收'))
  await acceptButtonsState().then(buttons => expect(buttons.length).toBeGreaterThan(0))
  await expect.poll(async () => {
    for (const state of await acceptButtonsState()) {
      if (!state.disabled) await page.locator(`button:text-is("${state.text}")`).first().click()
    }
    const currentProjection = scaffold!.ctx.agentTeam.view({ workspaceId: workspace.id })
    const currentTask = currentProjection.tasks.find(candidate => candidate.taskRef === task.taskRef)
    const currentClaims = currentProjection.claims.filter(candidate => candidate.taskRef === task.taskRef)
    const alert = await page.getByRole('alert').allTextContents()
    return JSON.stringify({ task: currentTask, claims: currentClaims, alert })
  }).toContain('"resolution":"accepted"')
  await page.getByRole('button', { name: '重新打开' }).waitFor()
  const acceptedComposer = page.getByRole('textbox', { name: '消息内容' })
  await acceptedComposer.waitFor()
  await acceptedComposer.fill('验收后继续讨论')
  await page.getByRole('button', { name: '发送' }).click()
  await page.getByText('验收后继续讨论', { exact: true }).waitFor()
  await page.screenshot({ path: join(UI01_SHOTS, 'desktop-thread.png'), fullPage: true })
  await page.screenshot({ path: join(UI05_SHOTS, 'accepted-thread.png'), fullPage: true })
  // Early acceptance drill: reopen puts the Task back to in_progress; a fresh
  // Agent Claim re-creates the exact precondition for accepting over open work.
  await page.getByRole('button', { name: '重新打开' }).click()
  // Direct Host calls below must observe the committed open state, not the
  // optimistic-free UI in flight.
  await expect.poll(async () =>
    JSON.stringify(scaffold!.ctx.agentTeam.view({ workspaceId: workspace.id }).tasks.find(candidate => candidate.taskRef === task.taskRef)))
    .toContain('"resolution":"open"')
  const reopenRead = await scaffold.ctx.agentTeam.readThreadForAgent(agent, {
    requestId: 'm2-06-agent-reopen-read' as never, workspaceId: workspace.id, taskRef: task.taskRef,
  })
  const reclaim = await scaffold.ctx.agentTeam.changeClaimForAgent(agent, {
    requestId: 'm2-06-agent-reclaim' as never, workspaceId: workspace.id,
    taskRef: task.taskRef, action: 'claim', direction: '补齐回归清单', baseRevision: reopenRead.thread.revision,
  })
  if (reclaim.kind !== 'committed') throw new Error(`Agent re-Claim was rejected: ${reclaim.kind}`)
  await page.getByRole('button', { name: '验收', exact: true }).click()
  const acceptDialog = page.getByRole('dialog', { name: '提前验收任务' })
  await expect.poll(() => acceptDialog.count()).toBe(1)
  await expect.poll(() => acceptDialog.getByText(/将验收本 Task，并把以下 1 个未完成的 Claim 一并标记为完成/).count()).toBe(1)
  await expect.poll(() => acceptDialog.getByText('@builder · 补齐回归清单').count()).toBe(1)
  await page.screenshot({ path: join(UI05_SHOTS, 'accept-confirm-dialog.png'), fullPage: true })
  // Snapshot before any interaction; compared after the Escape cancels below.
  const tasksBeforeCancel = JSON.stringify(scaffold.ctx.agentTeam.view({ workspaceId: workspace.id }).tasks.find(candidate => candidate.taskRef === task.taskRef))

  // Same confirm beat at phone size for the narrow layout.
  const escapeDialog = async (): Promise<void> => {
    await page.keyboard.press('Escape')
    await expect.poll(() => page.getByRole('dialog', { name: '提前验收任务' }).count()).toBe(0)
  }
  await escapeDialog()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: '验收', exact: true }).click()
  await expect.poll(() => acceptDialog.count()).toBe(1)
  await page.screenshot({ path: join(UI05_SHOTS, 'narrow-accept-confirm-dialog.png'), fullPage: true })
  await escapeDialog()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.setViewportSize({ width: 1440, height: 960 })

  // The ledger stayed untouched through both Escape cancels.
  expect(JSON.stringify(scaffold.ctx.agentTeam.view({ workspaceId: workspace.id }).tasks.find(candidate => candidate.taskRef === task.taskRef))).toBe(tasksBeforeCancel)

  // Confirm completes the open Claim inside the same accept operation.
  await page.getByRole('button', { name: '验收', exact: true }).click()
  await expect.poll(() => acceptDialog.count()).toBe(1)
  await acceptDialog.locator('button').filter({ hasText: '验收' }).last().click()
  await expect.poll(async () =>
    JSON.stringify(scaffold.ctx.agentTeam.view({ workspaceId: workspace.id }).claims.filter(candidate => candidate.taskRef === task.taskRef && candidate.direction === '补齐回归清单')))
    .toContain('"state":"done"')
  await expect.poll(async () =>
    JSON.stringify(scaffold.ctx.agentTeam.view({ workspaceId: workspace.id }).tasks.find(candidate => candidate.taskRef === task.taskRef)))
    .toContain('"resolution":"accepted"')
  await page.screenshot({ path: join(UI05_SHOTS, 'early-accepted-thread.png'), fullPage: true })
  // Restore the pre-drill state so the following closed-thread beats run as before.
  await page.getByRole('button', { name: '重新打开' }).waitFor()

  // The header offers exactly one of 打开/关闭 actions per resolution, so the
  // restored open state comes from this reopen before the close beat.
  await page.getByRole('button', { name: '重新打开' }).click()
  await page.getByRole('button', { name: '关闭任务' }).waitFor()
  await page.getByRole('button', { name: '关闭任务' }).click()
  // The closed Thread swaps the composer for the explanatory notice with its reopen action.
  await page.getByText('任务已关闭，重新打开后可继续讨论').waitFor()
  await expect.poll(() => page.getByRole('textbox', { name: '消息内容' }).count()).toBe(0)
  await page.screenshot({ path: join(UI05_SHOTS, 'closed-thread.png'), fullPage: true })

  await page.setViewportSize({ width: 390, height: 844 })
  const collapsedFrame = page.locator('[data-sidebar-collapsed="true"]')
  await collapsedFrame.waitFor()
  await expect.poll(async () => (await collapsedFrame.locator(':scope > div').first().boundingBox())?.width ?? 999).toBeLessThanOrEqual(56)
  await page.screenshot({ path: join(UI01_SHOTS, 'narrow-thread.png'), fullPage: true })
  await page.screenshot({ path: join(UI02_SHOTS, 'narrow-team-rail.png'), fullPage: true })
  await page.screenshot({ path: join(UI05_SHOTS, 'narrow-closed-thread.png'), fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.setViewportSize({ width: 1440, height: 960 })

  await page.getByRole('button', { name: '返回频道' }).click()
  await page.getByRole('heading', { name: '# delivery' }).waitFor()
  await expect.poll(() => page.getByText('Human 已检查 Thread', { exact: true }).count()).toBe(0)
  await expect.poll(() => page.getByText('验收后继续讨论', { exact: true }).count()).toBe(0)
  await page.getByRole('button', { name: '成员', exact: true }).click()
  await page.getByRole('dialog', { name: '成员' }).screenshot({ path: join(UI01_SHOTS, 'global-members.png') })
  await page.getByRole('button', { name: '关闭', exact: true }).click()

  await page.reload()
  await page.getByRole('button', { name: '# delivery' }).waitFor({ timeout: 20_000 })
  await expect.poll(() => page.evaluate(() => localStorage.getItem('dsh.agent-team.navigation'))).toContain('"mode":"team"')
  // Browser restoration returns to the last selected Channel instead of the
  // empty Team welcome surface.
  await page.getByRole('heading', { name: '# delivery' }).waitFor()
  await expect.poll(() => page.getByText('Human 已检查 Thread', { exact: true }).count()).toBe(0)
  await expect.poll(() => page.getByText('验收后继续讨论', { exact: true }).count()).toBe(0)
  await expect.poll(() => page.getByText('关闭后继续讨论', { exact: true }).count()).toBe(0)
  await page.getByRole('button', { name: '对话' }).click()
  await expect.poll(() => newSessionButton.isVisible()).toBe(true)
  await expect.poll(() => brandButton.isVisible()).toBe(true)
  // Leaving Team closes any embedded Member Session view and restores the
  // session the Human came from, so the ordinary shell shows an ordinary
  // conversation composer rather than a stranded Member Session.
  const restoredComposer = page.locator('textarea:enabled').first()
  await restoredComposer.waitFor({ timeout: 20_000 })
  await expect.poll(() => page.locator('[data-team-channel]').count()).toBe(0)
  await expect.poll(() => page.locator('[data-team-member-composer="true"]').count()).toBe(0)
  // Team's globally registered sources return no ordinary candidates; shipped
  // command/skill discovery takes the restored ordinary Session back over.
  await restoredComposer.fill('/')
  await expect.poll(() => page.getByRole('option').count()).toBeGreaterThan(0)
  expect(await page.getByRole('option', { name: '@reviewer' }).count()).toBe(0)
  await restoredComposer.fill('')
  await page.screenshot({ path: join(UI01_SHOTS, 'restored-conversations.png'), fullPage: true })

  const enterTeamKeyboard = page.getByRole('button', { name: '团队' })
  await enterTeamKeyboard.focus()
  await expect.poll(() => enterTeamKeyboard.evaluate(element => element === document.activeElement)).toBe(true)
  await expect.poll(() => page.getByRole('button', { name: '团队' }).getAttribute('data-team-action')).toBe('enter')
  await enterTeamKeyboard.press('Enter')
  await expect.poll(() => page.getByRole('button', { name: '成员', exact: true }).count()).toBe(1)
  await page.getByRole('heading', { name: '# delivery' }).waitFor()

  const membersKeyboard = page.getByRole('button', { name: '成员', exact: true })
  await membersKeyboard.focus()
  await membersKeyboard.press('Space')
  const membersDialog = page.getByRole('dialog', { name: '成员' })
  await membersDialog.waitFor()
  await expect.poll(() => membersDialog.locator('[tabindex="-1"]').evaluate(element => element === document.activeElement)).toBe(true)
  await page.screenshot({ path: join(UI06_SHOTS, 'members-modal-desktop.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.locator('[data-sidebar-collapsed="true"]').waitFor()
  const membersBox = await membersDialog.boundingBox()
  expect(membersBox).not.toBeNull()
  expect(membersBox!.x).toBeGreaterThanOrEqual(0)
  expect(membersBox!.y).toBeGreaterThanOrEqual(0)
  expect(membersBox!.x + membersBox!.width).toBeLessThanOrEqual(390)
  expect(membersBox!.y + membersBox!.height).toBeLessThanOrEqual(844)
  await page.screenshot({ path: join(UI06_SHOTS, 'members-modal-narrow.png'), fullPage: true })
  await page.keyboard.press('Escape')
  await expect.poll(() => membersKeyboard.evaluate(element => element === document.activeElement)).toBe(true)
  await page.setViewportSize({ width: 1440, height: 960 })

  const channelKeyboard = page.getByRole('button', { name: '# delivery' })
  await channelKeyboard.focus()
  await channelKeyboard.press('Space')
  await page.getByRole('heading', { name: '# delivery' }).waitFor()
  const taskKeyboard = page.getByRole('button', { name: '打开 Task #1' })
  await taskKeyboard.focus()
  await taskKeyboard.press('Space')
  await page.getByRole('heading', { name: 'Task #1' }).waitFor()
  const backKeyboard = page.getByRole('button', { name: '返回频道' })
  await backKeyboard.focus()
  await backKeyboard.press('Space')
  await page.getByRole('heading', { name: '# delivery' }).waitFor()
  const leaveTeamKeyboard = page.getByRole('button', { name: '对话' })
  await leaveTeamKeyboard.focus()
  await leaveTeamKeyboard.press('Space')
  // Leaving Team restores the Human's original session (see the Member view
  // above), so the ordinary shell renders a conversation composer.
  await page.locator('textarea:enabled').first().waitFor({ timeout: 20_000 })
  await expect.poll(() => page.locator('[data-team-channel]').count()).toBe(0)

  expect(consoleWatch).toEqual({ warnings: [], pageErrors: [] })
}, 120_000)
