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
  // rc.1: the web server gates the browser surface behind a process-token
  // exchange; the scaffold's authenticatedUrl establishes the session cookie.
  await page.goto(scaffold.authenticatedUrl)
  await connectFreshWorkspaceZh(page, scaffold.workspaceCwd, 'team-workspace')
  const ordinaryComposer = page.locator('[data-composer-input][contenteditable="true"][data-placeholder="描述你想要构建的内容… / 调用指令 @ 文件或对话"]')
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
    // Creation has no Channel page anymore: membership is Channel-side.
    expect(await dialog.getByRole('button', { name: '初始频道' }).count()).toBe(0)
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
  // Membership is managed from the Channel side now: add both Members to
  // engineering through the Channel editor before any membership-dependent
  // flow runs.
  await page.getByRole('button', { name: '# engineering' }).hover()
  await page.getByRole('button', { name: 'engineering 的操作' }).click()
  await page.getByRole('menuitem', { name: '编辑频道' }).click()
  const joinEditor = page.getByRole('dialog', { name: '编辑频道' })
  await joinEditor.waitFor()
  for (const handle of ['builder', 'reviewer']) {
    const row = joinEditor.locator('[class*="editMemberRow"]').filter({ hasText: `@${handle}` })
    await row.getByRole('button', { name: '添加' }).click()
  }
  await expect.poll(async () => await joinEditor.getByRole('button', { name: '移除', exact: true }).count()).toBe(2)
  await joinEditor.getByRole('button', { name: '关闭', exact: true }).click()
  // Narrow-viewport create form with every field optional. The 390
  // breakpoint collapses the frame to the rail and unmounts the sidebar
  // panels (dialog state included), so the dialog opens from the
  // narrow-expanded sidebar once the collapse has settled.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.locator('[data-sidebar-collapsed="true"]').waitFor()
  await page.getByRole('button', { name: '打开侧边栏' }).click()
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
  await channelDialog.getByRole('button', { name: '创建频道' }).click()
  // The same form at 390: the breakpoint unmounts sidebar panels (dialog
  // state included), so the check re-opens it from the narrow-expanded
  // sidebar after the collapse has settled.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.locator('[data-sidebar-collapsed="true"]').waitFor()
  await page.getByRole('button', { name: '打开侧边栏' }).click()
  await page.getByRole('button', { name: '新建频道' }).click()
  const narrowChannelDialog = page.getByRole('dialog', { name: '新建频道' })
  await narrowChannelDialog.getByLabel('名称').waitFor()
  const dialogBox = await narrowChannelDialog.boundingBox()
  expect(dialogBox).not.toBeNull()
  expect(dialogBox!.x).toBeGreaterThanOrEqual(0)
  expect(dialogBox!.y).toBeGreaterThanOrEqual(0)
  expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(390)
  expect(dialogBox!.y + dialogBox!.height).toBeLessThanOrEqual(844)
  await page.screenshot({ path: join(UI03_SHOTS, 'channel-create-modal-narrow.png'), fullPage: true })
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 1440, height: 960 })
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
  // Collapse is a browser-local presentation preference, not a Team fact: it
  // survives a full reload like the row order does, then still expands again.
  // The section header itself stays reachable while collapsed, so no channel
  // row is needed to prove the persisted state.
  await page.reload()
  await channelsToggle.waitFor({ timeout: 20_000 })
  await expect.poll(() => page.getByRole('button', { name: '# engineering' }).count()).toBe(0)
  await channelsToggle.click()
  await page.getByRole('button', { name: '# engineering' }).waitFor()

  // The workspace list folds behind the same quiet section header as the
  // panels: rows vanish on collapse and return on the second toggle.
  const workspacesToggle = page.getByRole('button', { name: '工作区', exact: true })
  await workspacesToggle.click()
  await expect.poll(() => page.getByRole('button', { name: 'team-workspace' }).count()).toBe(0)
  await workspacesToggle.click()
  await page.getByRole('button', { name: 'team-workspace' }).waitFor()

  const builderRow = page.locator('[class*="agentRow"]').filter({ hasText: 'builder' }).first()
  await builderRow.hover()
  await builderRow.getByRole('button', { name: 'builder 的操作' }).click()
  await page.getByRole('menuitem', { name: '编辑 Agent' }).click()
  const agentEditor = page.getByRole('dialog', { name: '编辑 Agent' })
  await agentEditor.waitFor()
  // The Agent editor carries no Channel section anymore: handle,
  // description, and model only (membership lives on the Channel side).
  await expect.poll(() => agentEditor.getByRole('button', { name: '移除' }).count()).toBe(0)
  await expect.poll(() => agentEditor.getByRole('button', { name: '添加' }).count()).toBe(0)
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

  // 「从全新上下文开始」rides the same row menu: idle Members get an enabled
  // destructive entry whose confirm names the Member; cancelling routes nothing.
  await builderRow.hover()
  await builderRow.getByRole('button', { name: 'builder 的操作' }).click()
  await page.getByRole('menuitem', { name: '从全新上下文开始' }).waitFor()
  const clearEntry = page.getByRole('menuitem', { name: '从全新上下文开始' })
  expect(await clearEntry.isDisabled()).toBe(false)
  await page.screenshot({ path: join(UI04_SHOTS, 'agent-clear-context-menu.png'), fullPage: true })
  await clearEntry.click()
  const clearDialog = page.getByRole('dialog', { name: '从全新上下文开始：builder' })
  await clearDialog.waitFor()
  expect(await clearDialog.textContent()).toContain('归档保留')
  await clearDialog.getByRole('button', { name: '取消' }).click()
  await expect.poll(() => page.getByRole('dialog', { name: '从全新上下文开始：builder' }).count()).toBe(0)

  const memberWorkspace = scaffold.ctx.workspaceRegistry.list()[0]!
  const memberStatuses = scaffold.ctx.agentTeam.members({ workspaceId: memberWorkspace.id })
  const builderMember = memberStatuses.find((status: { member: { handle: string } }) => status.member.handle === 'builder')!
  const builderAgent = scaffold.ctx.agents.get(builderMember.member.sessionId)!

  // Clicking the Agent card keeps Team mode mounted and swaps only the right
  // pane: the conversation shadow stands down so the shipped root renders the
  // Member Session between the Team sidebars. A Member session has no human
  // turns yet, so DSH renders its blank-session view — the hero composer
  // carrying the Member's workspace + `team-member` preset chips.
  // The Human's own session is staged first on purpose: the embedded view then
  // carries a return target, so leaving Team later restores an ordinary
  // conversation instead of stranding the Member Session.
  await brandButton.click()
  // The two Member Sessions exist already; the brand click adds the Human's.
  await expect.poll(() => scaffold.ctx.sessions.list().length).toBeGreaterThanOrEqual(3)
  await builderRow.getByRole('button', { name: '打开 builder 的会话' }).click()
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.agentTeamMode ?? null)).toBe('team')
  await expect.poll(() => page.locator('[data-team-channel]').count()).toBe(0)
  // rc.1: the shipped InputBar owns the composer entirely — the Team manages
  // no member-session input surface, so the journey only asserts the shipped
  // composer renders for the embedded Member Session.
  const memberInput = page.locator('[data-composer-input][contenteditable="true"]')
  await expect.poll(() => memberInput.count()).toBe(1)
  await page.screenshot({ path: join(UI04_SHOTS, 'agent-session-composer.png'), fullPage: true })

  // 「从全新上下文开始」executes for real while the Member Session is embedded:
  // the Host moves the Member onto a fresh Session id, and the right pane
  // navigates onto it — blank hero, no stale transcript, composer enabled for
  // the fresh context. This runs before any prompt send: the scenario mounts no
  // replay fixture, so a stray model call would push the Member to error
  // presence and lock the available-only gate.
  await builderRow.hover()
  await builderRow.getByRole('button', { name: 'builder 的操作' }).click()
  const executeClearEntry = page.getByRole('menuitem', { name: '从全新上下文开始' })
  await executeClearEntry.waitFor()
  await expect.poll(async () => await executeClearEntry.isDisabled()).toBe(false)
  await executeClearEntry.click()
  const executeClearDialog = page.getByRole('dialog', { name: '从全新上下文开始：builder' })
  await executeClearDialog.waitFor()
  await executeClearDialog.getByRole('button', { name: '开始全新上下文' }).click()
  await expect.poll(() => page.getByRole('dialog', { name: '从全新上下文开始：builder' }).count()).toBe(0)
  // The embedded pane navigates onto the renewed Session (hero composer, no
  // rows): the shipped composer stays live for the fresh context.
  await expect.poll(() => page.evaluate(() => ({
    channel: document.querySelectorAll('[data-team-channel]').length,
    mode: document.documentElement.dataset.agentTeamMode ?? null,
  })), { timeout: 10_000 }).toEqual({ channel: 0, mode: 'team' })
  await expect.poll(() => memberInput.isEnabled()).toBe(true)
  await page.screenshot({ path: join(UI04_SHOTS, 'agent-session-cleared.png'), fullPage: true })
  // Host side: the Member moved onto a fresh Session id; the previous log
  // stays on disk but is archived from every grouping surface, and the new
  // Session records the previous id as fork lineage.
  const clearedStatuses = scaffold.ctx.agentTeam.members({ workspaceId: memberWorkspace.id })
  const clearedBuilder = clearedStatuses.find((status: { member: { handle: string } }) => status.member.handle === 'builder')!
  expect(clearedBuilder.member.sessionId).not.toBe(builderMember.member.sessionId)
  const freshBuilderAgent = scaffold.ctx.agents.get(clearedBuilder.member.sessionId)!
  expect(freshBuilderAgent).not.toBe(builderAgent)
  expect(freshBuilderAgent.session.header.parentSession).toBe(builderMember.member.sessionId)
  expect(freshBuilderAgent.session.snapshotEvents().filter(event => event.type === 'user/message' || event.type === 'command/run' || event.type === 'turn/start')).toHaveLength(0)
  expect(scaffold.ctx.workspaceRegistry.archivedSessionIds).toContain(builderMember.member.sessionId)

  // The fresh session is immediately usable through the shipped composer: a
  // plain prompt lands on the recreated Session (the Team manages no
  // member-session input surface, so no structured mention flow remains).
  await memberInput.fill('fresh context hello')
  await memberInput.press('Enter')
  const isPlainFreshPrompt = (event: ReturnType<typeof freshBuilderAgent.session.snapshotEvents>[number]): boolean => event.type === 'user/message'
    && event.data.source.kind === 'user'
    && event.data.content.some(block => block.type === 'text' && block.text === 'fresh context hello')
  await expect.poll(() => freshBuilderAgent.session.snapshotEvents().some(isPlainFreshPrompt)).toBe(true)
  await freshBuilderAgent.whenIdle()
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
  // The pressed state must be visible on its own: primary fill, unchanged by hover.
  const pressedFill = await asTaskToggle.evaluate(element => getComputedStyle(element).backgroundColor)
  await asTaskToggle.hover()
  expect(await asTaskToggle.evaluate(element => getComputedStyle(element).backgroundColor)).toBe(pressedFill)
  await page.screenshot({ path: join(UI04_SHOTS, 'as-task-pressed.png'), fullPage: true })
  await page.getByRole('button', { name: '发送' }).click()
  const committedMessage = page.locator('[data-team-channel] article').filter({ hasText: '请协作完成验收' })
  await committedMessage.waitFor()
  await expect.poll(() => asTaskToggle.getAttribute('aria-pressed')).toBe('false')
  await expect.poll(() => page.getByRole('textbox', { name: '消息内容' }).inputValue()).toBe('')
  await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe('消息内容')
  await page.getByRole('button', { name: '发送', exact: true }).waitFor()

  // @all expansion: typing a prefix of "all" surfaces the fixed row on top of
  // the matching members; keyboard navigation highlights it and Tab accepts.
  // The expansion snapshot covers every eligible delivery member (builder,
  // reviewer) at pick time, and later text edits must not prune it away.
  await channelComposer.fill('全员同步 @a')
  const allOption = page.getByRole('option', { name: /@all/ })
  await allOption.waitFor()
  // 'a' prefixes "all" but no handle in this channel, so the fixed row is
  // the only candidate; it is highlighted by default.
  expect(await page.getByRole('option').count()).toBe(1)
  await expect.poll(() => allOption.getAttribute('aria-selected')).toBe('true')
  await page.screenshot({ path: join(UI04_SHOTS, 'all-mention-menu.png'), fullPage: true })
  await page.keyboard.press('Tab')
  await expect.poll(() => channelComposer.inputValue()).toBe('全员同步 @all ')
  const notifyRow = page.getByText(/将通知/)
  await expect.poll(() => notifyRow.textContent()).toContain('@builder')
  expect(await notifyRow.textContent()).toContain('@reviewer')
  await channelComposer.fill('全员同步 @all，今天截止')
  await expect.poll(() => notifyRow.textContent()).toContain('@reviewer')
  await page.getByRole('button', { name: '发送' }).click()
  const allMessage = page.locator('[data-team-channel] article').filter({ hasText: '全员同步' })
  await allMessage.waitFor()
  expect((await allMessage.textContent())?.includes('@all，今天截止')).toBe(true)
  // The expansion delivered a direct mention to every eligible member: both
  // agents read the taskless Thread so the later inbox assertions keep
  // counting only the original @builder invitation flow. The @all message is
  // the newest taskless Thread in the workspace; the Members are re-fetched
  // because builder's session was renewed by the clear-context flow above.
  const allWorkspace = scaffold.ctx.workspaceRegistry.list()[0]!
  const allProjection = scaffold.ctx.agentTeam.view({ workspaceId: allWorkspace.id })
  const allThread = allProjection.threads
    .filter((thread: { taskRef?: string }) => thread.taskRef === undefined)
    .reduce((latest: { revision: number } | undefined, thread: { revision: number }) => latest === undefined || thread.revision > latest.revision ? thread : latest, undefined)!
  for (const handle of ['builder', 'reviewer']) {
    const status = scaffold.ctx.agentTeam.members({ workspaceId: allWorkspace.id }).find((entry: { member: { handle: string } }) => entry.member.handle === handle)!
    const reader = scaffold.ctx.agents.get(status.member.sessionId)!
    await scaffold.ctx.agentTeam.readThreadForAgent(reader, {
      requestId: `m2-all-read-${handle}` as never, workspaceId: allWorkspace.id, threadRef: allThread.threadRef,
    })
  }

  // Branded-ref linkify: only refs the Host resolves become link controls.
  // An unknown UUID-shaped task ref and non-UUID `channel:` prose both stay
  // literal in the plain body; click-to-navigate is component-tested against
  // the resolved selectThread call.
  await channelComposer.fill('请复核 task:c0ffee00-1234-4c05-8a9e-6f2b1c9d7e21 与 channel:engineering 的口径')
  await page.getByRole('button', { name: '发送' }).click()
  const refMessage = page.locator('[data-team-channel] article').filter({ hasText: '请复核' })
  await refMessage.waitFor()
  expect(await refMessage.getByRole('button', { name: /task:c0ffee00|channel:engineering/ }).count()).toBe(0)
  await expect.poll(() => refMessage.textContent()).toContain('task:c0ffee00-1234-4c05-8a9e-6f2b1c9d7e21')
  expect(await refMessage.textContent()).toContain('channel:engineering')
  await page.screenshot({ path: join(UI04_SHOTS, 'message-ref-linkify.png'), fullPage: true })

  // Long-body clamp: a body past the deterministic character threshold starts
  // clamped behind 展开全文 — the preview keeps the full text mounted under an
  // alpha fade, expands in place, and collapses back through the same control.
  const longBody = '这是一条超长验收消息。'.repeat(60)
  await channelComposer.fill(longBody)
  await page.getByRole('button', { name: '发送' }).click()
  const longMessage = page.locator('[data-team-channel] article').filter({ hasText: '这是一条超长验收消息' })
  await longMessage.waitFor()
  const expandControl = longMessage.getByRole('button', { name: '展开全文' })
  await expandControl.waitFor()
  expect(await expandControl.getAttribute('aria-expanded')).toBe('false')
  await page.screenshot({ path: join(UI04_SHOTS, 'message-clamp-preview.png'), fullPage: true })
  // Keyboard path: the focused control expands with Enter and flips to 收起.
  await expandControl.focus()
  await page.keyboard.press('Enter')
  const collapseControl = longMessage.getByRole('button', { name: '收起' })
  await collapseControl.waitFor()
  expect(await collapseControl.getAttribute('aria-expanded')).toBe('true')
  expect(await longMessage.locator('[class*="messageClamp"]').count()).toBe(0)
  await page.screenshot({ path: join(UI04_SHOTS, 'message-clamp-expanded.png'), fullPage: true })
  await collapseControl.click()
  await expect.poll(() => longMessage.locator('[class*="messageClamp"]').count()).toBe(1)
  await expect.poll(async () => await longMessage.getByRole('button', { name: '展开全文' }).getAttribute('aria-expanded')).toBe('false')
  // Narrow viewport: the clamped preview stays inside the viewport width.
  // Geometry polls until the fold settles — the collapsed attribute flips
  // before the conversation pane reaches its narrow width.
  await page.setViewportSize({ width: 390, height: 844 })
  const narrowClamp = longMessage.locator('[class*="messageClamp"]')
  await page.locator('[data-sidebar-collapsed="true"]').waitFor()
  await expect.poll(async () => (await narrowClamp.boundingBox())?.x ?? 999).toBeGreaterThanOrEqual(0)
  await expect.poll(async () => {
    const box = await narrowClamp.boundingBox()
    return box === null ? 999 : box.x + box.width
  }).toBeLessThanOrEqual(390)
  await page.screenshot({ path: join(UI04_SHOTS, 'message-clamp-narrow.png'), fullPage: true })
  await page.setViewportSize({ width: 1440, height: 960 })

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

  // Paste intake: a real Chromium paste carrying an image file is intercepted
  // before the textarea's native handling and joins the same chip flow, then
  // uploads through the same ledger path as the "+" picker above.
  await channelComposer.focus()
  await channelComposer.evaluate((el, bytes) => {
    const file = new File([new Uint8Array(bytes)], 'image.png', { type: 'image/png' })
    const data = new DataTransfer()
    data.items.add(file)
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  }, [...pngBytes])
  await page.getByText('image.png').first().waitFor()
  await channelComposer.fill('这是粘贴上传的截图')
  await page.getByRole('button', { name: '发送' }).click()
  const pastedMessage = page.locator('[data-team-channel] article').filter({ hasText: '这是粘贴上传的截图' })
  await pastedMessage.waitFor()
  await expect.poll(() => pastedMessage.locator('img[src^="data:image/png"]').count()).toBeGreaterThanOrEqual(1)

  // Narrow-viewport literal ref row: the unresolvable refs stay plain text
  // and the row keeps its width without horizontal overflow.
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await refMessage.getByRole('button', { name: /task:c0ffee00|channel:engineering/ }).count()).toBe(0)
  expect((await refMessage.textContent())?.includes('task:c0ffee00-1234-4c05-8a9e-6f2b1c9d7e21')).toBe(true)
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
  await page.getByText('Human 为此讨论创建了 Task').waitFor()
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

  // Long Agent Markdown under the clamp: publish an over-threshold reply and
  // compare the rendered root's computed font across the fold. The preview
  // keeps the whole body mounted, so a typography reset broken by the clamp
  // wrapper would render the preview text larger than the expanded body —
  // the exact regression this parity check pins.
  const longRead = await scaffold.ctx.agentTeam.readThreadForAgent(reviewerAgent, {
    requestId: 'm2-07-long-read' as never, workspaceId: workspace.id, taskRef: task.taskRef,
  })
  const longReply = await scaffold.ctx.agentTeam.replyForAgent(reviewerAgent, {
    requestId: 'm2-07-long-markdown-reply' as never,
    workspaceId: workspace.id,
    taskRef: task.taskRef,
    body: `## 长文折叠回归验收\n\n这一条 Agent Markdown 回复用于验证限高预览与展开态共用同一文字网格。${'折叠回归验证段落。'.repeat(60)}\n\n- 第一条:预览态按共享文字网格渲染，底部渐隐；\n- 第二条:展开态与预览态字号一致；\n- 第三条:收起后回到限高预览。\n\n\`task::${task.taskRef.slice('task:'.length)}\` 与 **加粗片段** 穿插在长正文里。`,
    baseRevision: longRead.thread.revision,
    recipients: [scaffold.ctx.agentTeam.status().humanMemberId],
  })
  expect(longReply.kind).toBe('committed')
  const longMarkdownRow = page.locator('[data-team-thread] article').filter({ hasText: '长文折叠回归验收' })
  await longMarkdownRow.waitFor()
  const markdownClamp = longMarkdownRow.locator('[class*="messageClamp"]')
  await markdownClamp.waitFor()
  const markdownRootFont = async (): Promise<string> =>
    await longMarkdownRow.locator('[class*="messageMarkdown"] > div').first().evaluate(node => getComputedStyle(node).fontSize)
  await expect.poll(markdownRootFont).toBe('14px')
  await longMarkdownRow.getByRole('button', { name: '展开全文' }).click()
  await expect.poll(async () => await longMarkdownRow.locator('[class*="messageClamp"]').count()).toBe(0)
  await expect.poll(markdownRootFont).toBe('14px')
  // The doubled-colon ref inside the long body still resolves to its chip
  // while the row is expanded — clamping must not break the post-render pass.
  await expect.poll(async () => await longMarkdownRow.getByRole('button', { name: /Task #\d+/ }).count()).toBeGreaterThanOrEqual(1)
  await page.screenshot({ path: join(UI04_SHOTS, 'message-clamp-markdown-expanded.png'), fullPage: true })
  await longMarkdownRow.getByRole('button', { name: '收起' }).click()
  await expect.poll(async () => await longMarkdownRow.locator('[class*="messageClamp"]').count()).toBe(1)

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
  // The structured Human mention renders as the canonical @human chip (the
  // stored body keeps the bare word; only the rendering chipifies it).
  await page.getByText('reviewer 已读取邀请并回复 @human，关联', { exact: false }).waitFor()

  // Open-onto-unread acceptance: while the Human is away from the Thread,
  // agents publish a multi-batch backlog, then the Human reopens it. The
  // Thread must land at the latest fact, drain every bounded batch
  // automatically (no continue-reading control), keep the unread boundary
  // rendered as information, and leave no unread remainder in the ledger.
  await page.getByRole('button', { name: '返回频道' }).click()
  await page.getByRole('heading', { name: '# delivery' }).waitFor()
  const backlogBatch = async (label: string): Promise<void> => {
    const backlogRead = await scaffold.ctx.agentTeam.readThreadForAgent(reviewerAgent, {
      requestId: `m2-open-unread-${label}-read` as never, workspaceId: workspace.id, taskRef: task.taskRef,
    })
    const backlogReply = await scaffold.ctx.agentTeam.replyForAgent(reviewerAgent, {
      requestId: `m2-open-unread-${label}-reply` as never,
      workspaceId: workspace.id, taskRef: task.taskRef,
      body: `离线期间的批量更新 ${label}`,
      baseRevision: backlogRead.thread.revision,
    })
    if (backlogReply.kind !== 'committed') throw new Error(`backlog reply rejected: ${backlogReply.kind}`)
  }
  for (const label of ['一', '二', '三']) await backlogBatch(label)
  const preOpenInbox = scaffold.ctx.agentTeam.inbox({ workspaceId: workspace.id })
  const preOpenThread = preOpenInbox.items.find(item => item.task?.taskRef === task.taskRef)
  expect(preOpenThread?.unreadCount ?? 0).toBeGreaterThanOrEqual(3)
  await page.getByRole('button', { name: /Task #1/ }).click()
  await page.getByRole('heading', { name: /Task #1/ }).waitFor()
  await page.getByText('离线期间的批量更新 三', { exact: true }).waitFor()
  // The boundary stays as an informational separator even though reading is
  // fully automatic now.
  await page.getByText('以下是本次打开收到的更新').waitFor()
  await expect.poll(() => page.getByRole('button', { name: '继续阅读' }).count()).toBe(0)
  await expect.poll(() => page.getByRole('button', { name: '标记为已读' }).count()).toBe(0)
  const humanThreadScroller = page.locator('section[aria-label="消息时间线"]')
  await expect.poll(async () => {
    const box = await humanThreadScroller.boundingBox()
    if (box === null) return -1
    const atBottom = await humanThreadScroller.evaluate(element =>
      element.scrollHeight - element.scrollTop - element.clientHeight < 48)
    return atBottom ? 1 : 0
  }, { timeout: 10_000 }).toBe(1)
  await expect.poll(() => {
    const openInbox = scaffold.ctx.agentTeam.inbox({ workspaceId: workspace.id })
    const openThread = openInbox.items.find(item => item.task?.taskRef === task.taskRef)
    return openThread?.unreadCount ?? 0
  }, { timeout: 10_000 }).toBe(0)
  await page.screenshot({ path: join(UI05_SHOTS, 'open-onto-unread-drained.png'), fullPage: true })

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
  const restoredComposer = page.locator('[data-composer-input][contenteditable="true"]').first()
  await restoredComposer.waitFor({ timeout: 20_000 })
  await expect.poll(() => page.locator('[data-team-channel]').count()).toBe(0)
  // Team's globally registered sources return no ordinary candidates; shipped
  // command/skill discovery takes the restored ordinary Session back over.
  await restoredComposer.fill('/')
  await expect.poll(() => page.getByRole('option').count()).toBeGreaterThan(0)
  expect(await page.getByRole('option', { name: '@reviewer' }).count()).toBe(0)
  await restoredComposer.fill('')
  await page.screenshot({ path: join(UI01_SHOTS, 'restored-conversations.png'), fullPage: true })

  // Archival beats: both danger entries hide their entity behind a
  // destructive confirm that states the no-restore contract. The archived
  // Channel leaves the sidebar; the archived Member leaves the agents panel,
  // and the Host side disposes its session and archives it from grouping
  // surfaces while the private memory stays on disk.
  await page.getByRole('button', { name: '团队' }).click()
  // Restoration returns to the last open surface; the sidebar row is the
  // stable entry back onto the Channel page regardless of the restored route.
  await page.getByRole('button', { name: '# delivery' }).waitFor({ timeout: 20_000 })
  await page.getByRole('button', { name: '# delivery' }).click()
  await page.getByRole('heading', { name: '# delivery' }).waitFor({ timeout: 20_000 })
  const rampRow = page.getByRole('button', { name: '# ramp' })
  await rampRow.hover()
  await page.getByRole('button', { name: 'ramp 的操作' }).click()
  await page.getByRole('menuitem', { name: '归档频道' }).click()
  const rampArchiveDialog = page.getByRole('dialog', { name: '归档频道：ramp' })
  await rampArchiveDialog.waitFor()
  expect(await rampArchiveDialog.textContent()).toContain('暂无恢复入口')
  await page.screenshot({ path: join(UI06_SHOTS, 'channel-archive-modal.png'), fullPage: true })
  await rampArchiveDialog.getByRole('button', { name: '归档频道', exact: true }).click()
  await expect.poll(() => page.getByRole('button', { name: '# ramp' }).count()).toBe(0)
  const archiveWorkspace = scaffold.ctx.workspaceRegistry.list()[0]!
  const archivedChannel = scaffold.ctx.agentTeam.view({ workspaceId: archiveWorkspace.id }).channels.find((channel: { name: string }) => channel.name === 'ramp')
  expect(archivedChannel).toBeUndefined()

  const archiveableRow = page.locator('[class*="agentRow"]').filter({ hasText: 'builder' }).first()
  await archiveableRow.hover()
  await page.getByRole('button', { name: 'builder 的操作' }).click()
  await page.getByRole('menuitem', { name: '归档', exact: true }).click()
  const builderArchiveDialog = page.getByRole('dialog', { name: '归档 Agent：builder' })
  await builderArchiveDialog.waitFor()
  expect(await builderArchiveDialog.textContent()).toContain('暂无恢复入口')
  await page.screenshot({ path: join(UI06_SHOTS, 'agent-archive-modal.png'), fullPage: true })
  await builderArchiveDialog.getByRole('button', { name: '归档', exact: true }).click()
  await expect.poll(() => page.locator('[class*="agentRow"]').filter({ hasText: 'builder' }).count()).toBe(0)
  const archivedStatuses = scaffold.ctx.agentTeam.members({ workspaceId: archiveWorkspace.id })
  const archivedBuilder = archivedStatuses.find((status: { member: { handle: string } }) => status.member.handle === 'builder')!
  expect(archivedBuilder.availability).toBe('archived')
  expect(archivedBuilder.member.state).toBe('archived')
  // The Session archival settles behind the Client wake; poll the registry.
  await expect.poll(() => scaffold.ctx.workspaceRegistry.archivedSessionIds.includes(archivedBuilder.member.sessionId)).toBe(true)
  // The archived Member's row menu and mention candidates are gone, and the
  // members modal roster no longer lists it.
  await page.getByRole('button', { name: '成员', exact: true }).click()
  const archiveMembersDialog = page.getByRole('dialog', { name: '成员' })
  await archiveMembersDialog.waitFor()
  expect(await archiveMembersDialog.getByText('@builder').count()).toBe(0)
  await archiveMembersDialog.getByRole('button', { name: '关闭', exact: true }).click()
  await page.getByRole('button', { name: '对话' }).click()
  await expect.poll(() => page.locator('[data-team-channel]').count()).toBe(0)

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
  await page.keyboard.press('Escape')
  await expect.poll(() => membersKeyboard.evaluate(element => element === document.activeElement)).toBe(true)
  // Narrow viewport: the breakpoint unmounts sidebar panels (dialog state
  // included), so the check re-opens the dialog from the narrow-expanded
  // sidebar after the collapse has settled.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.locator('[data-sidebar-collapsed="true"]').waitFor()
  await page.getByRole('button', { name: '打开侧边栏' }).click()
  const narrowMembersKeyboard = page.getByRole('button', { name: '成员', exact: true })
  await narrowMembersKeyboard.focus()
  await narrowMembersKeyboard.press('Space')
  const narrowMembersDialog = page.getByRole('dialog', { name: '成员' })
  await narrowMembersDialog.waitFor()
  const membersBox = await narrowMembersDialog.boundingBox()
  expect(membersBox).not.toBeNull()
  expect(membersBox!.x).toBeGreaterThanOrEqual(0)
  expect(membersBox!.y).toBeGreaterThanOrEqual(0)
  expect(membersBox!.x + membersBox!.width).toBeLessThanOrEqual(390)
  expect(membersBox!.y + membersBox!.height).toBeLessThanOrEqual(844)
  await page.screenshot({ path: join(UI06_SHOTS, 'members-modal-narrow.png'), fullPage: true })
  await page.keyboard.press('Escape')
  await expect.poll(() => narrowMembersKeyboard.evaluate(element => element === document.activeElement)).toBe(true)
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
  // The restored ordinary shell may hold an inert composer (blank session),
  // so the wait is on the composer surface, not its editable state.
  await page.locator('[data-composer-input]').first().waitFor({ timeout: 20_000 })
  await expect.poll(() => page.locator('[data-team-channel]').count()).toBe(0)

  expect(consoleWatch).toEqual({ warnings: [], pageErrors: [] })
}, 120_000)
