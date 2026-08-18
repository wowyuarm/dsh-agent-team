import { cp, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { chromium, type Browser } from 'playwright'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspaceZh } from './support.ts'

const TEAM_ROOT = '__TEAM_ROOT__'
const OVERLAY = '__OVERLAY__'
const HOME = '__HOME__'
const CHROME = '__CHROME__'
const UI01_SHOTS = join(TEAM_ROOT, '.scratch/ui-redesign/validation/ui-01')
const UI02_SHOTS = join(TEAM_ROOT, '.scratch/ui-redesign/validation/ui-02')
const UI03_SHOTS = join(TEAM_ROOT, '.scratch/ui-redesign/validation/ui-03')
const UI04_SHOTS = join(TEAM_ROOT, '.scratch/ui-redesign/validation/ui-04')
const UI05_SHOTS = join(TEAM_ROOT, '.scratch/ui-redesign/validation/ui-05')
const UI06_SHOTS = join(TEAM_ROOT, '.scratch/ui-redesign/validation/ui-06')
let scaffold: WebScaffold | undefined
let browser: Browser | undefined

afterEach(async () => {
  await browser?.close(); browser = undefined
  await scaffold?.close(); scaffold = undefined
})

async function installLocalBundle(): Promise<void> {
  await rm(HOME, { recursive: true, force: true })
  const scope = `${HOME}/profiles/node_modules/@deepseek-ai`
  await mkdir(scope, { recursive: true })
  for (const name of ['agent-team', 'client-agent-team', 'command-agent-team', 'tool-agent-team']) {
    await cp(`${TEAM_ROOT}/packages/${name}`, `${scope}/dsh-${name}`, {
      recursive: true,
      filter: source => !source.includes('/node_modules') && !source.includes('/src'),
    })
  }
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

  expect(scaffold.ctx.clientModules.graph().entries.some(entry => entry.id === '@deepseek-ai/dsh-client-agent-team')).toBe(true)
  await page.getByRole('button', { name: '团队' }).click()
  await page.getByRole('tab', { name: 'Agents' }).click()

  for (const [name, description] of [['builder', '实现功能'], ['reviewer', '检查结果']] as const) {
    await page.getByRole('button', { name: '添加 Agent' }).click()
    const dialog = page.getByRole('dialog', { name: '添加 Agent' })
    await dialog.getByLabel('名称').fill(name)
    await dialog.getByLabel('说明').fill(description)
    if (name === 'builder') await page.screenshot({ path: join(UI03_SHOTS, 'agent-create-modal.png'), fullPage: true })
    await dialog.getByRole('button', { name: '创建 Agent' }).click()
    await page.getByText(name, { exact: true }).waitFor({ timeout: 20_000 })
  }
  await expect.poll(() => page.getByLabel('可用').count(), { timeout: 20_000 }).toBeGreaterThanOrEqual(2)
  await page.screenshot({ path: join(UI02_SHOTS, 'sidebar-agents.png'), fullPage: true })

  await page.getByRole('tab', { name: 'Channels' }).click()
  await page.getByRole('button', { name: '新建 Channel' }).click()
  const channelDialog = page.getByRole('dialog', { name: '新建 Channel' })
  await channelDialog.getByLabel('名称').fill('delivery')
  await channelDialog.getByLabel('说明').fill('M2 完整协作验收')
  await channelDialog.getByLabel(/builder/).check()
  await channelDialog.getByLabel(/reviewer/).check()
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
  await channelDialog.getByRole('button', { name: '创建 Channel' }).click()
  await page.getByRole('button', { name: '# delivery' }).click()
  await page.getByText('还没有消息', { exact: true }).waitFor()
  await page.screenshot({ path: join(UI02_SHOTS, 'sidebar-channels.png'), fullPage: true })
  await page.screenshot({ path: join(UI01_SHOTS, 'empty-channel.png'), fullPage: true })
  const channelComposer = page.getByRole('textbox', { name: '消息内容' })
  await channelComposer.fill('请协作完成验收 @')
  await page.getByRole('option', { name: /@builder/ }).click()
  await channelComposer.press('End')
  await channelComposer.type('@')
  await page.getByRole('option', { name: /@reviewer/ }).click()
  await page.screenshot({ path: join(UI04_SHOTS, 'mention-menu-selected.png'), fullPage: true })
  await page.getByRole('button', { name: '发送' }).click()
  const committedMessage = page.locator('[data-team-channel] article').filter({ hasText: '请协作完成验收' })
  await committedMessage.waitFor()
  await expect.poll(() => page.getByRole('textbox', { name: '消息内容' }).inputValue()).toBe('')
  await page.getByRole('button', { name: '发送', exact: true }).waitFor()
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
  await page.getByRole('dialog', { name: 'Channel 成员' }).waitFor()
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

  const workspace = scaffold.ctx.workspaceRegistry.list()[0]!
  const projection = scaffold.ctx.agentTeam.view({ workspaceId: workspace.id })
  const task = projection.tasks[0]!
  const builder = scaffold.ctx.agentTeam.members({ workspaceId: workspace.id })
    .find((status: { member: { handle: string } }) => status.member.handle === 'builder')!
  const agent = scaffold.ctx.agents.get(builder.member.sessionId)!
  await scaffold.ctx.agentTeam.changeClaimForAgent(agent, {
    requestId: 'm2-06-agent-claim' as never, workspaceId: workspace.id,
    taskRef: task.taskRef, action: 'claim', direction: '实现验收功能',
  })

  await page.getByRole('button', { name: /Task #1/ }).click()
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
  await page.getByRole('button', { name: '标记完成' }).click()
  const acceptTask = page.getByRole('button', { name: '验收' })
  await acceptTask.waitFor()
  await expect.poll(() => page.evaluate(() => {
    const current = [...document.querySelectorAll('button')].find(button => button.textContent === '验收')
    if (current === undefined || current.disabled) return false
    current.click()
    return true
  })).toBe(true)
  await expect.poll(async () => {
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
  await page.getByRole('button', { name: '重新打开' }).click()
  await page.getByRole('button', { name: '关闭任务' }).click()
  const closedComposer = page.getByRole('textbox', { name: '消息内容' })
  await closedComposer.waitFor()
  await closedComposer.fill('关闭后继续讨论')
  await page.getByRole('button', { name: '发送' }).click()
  await page.getByText('关闭后继续讨论', { exact: true }).waitFor()
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

  await page.getByRole('button', { name: '返回 Channel' }).click()
  await page.getByRole('heading', { name: '# delivery' }).waitFor()
  await expect.poll(() => page.getByText('Human 已检查 Thread', { exact: true }).count()).toBe(0)
  await expect.poll(() => page.getByText('验收后继续讨论', { exact: true }).count()).toBe(0)
  await expect.poll(() => page.getByText('关闭后继续讨论', { exact: true }).count()).toBe(0)
  await page.getByRole('button', { name: '成员', exact: true }).click()
  await page.getByRole('dialog', { name: '成员' }).screenshot({ path: join(UI01_SHOTS, 'global-members.png') })
  await page.getByRole('button', { name: '关闭', exact: true }).click()

  await page.reload()
  await page.getByRole('button', { name: '# delivery' }).waitFor({ timeout: 20_000 })
  await expect.poll(() => page.evaluate(() => localStorage.getItem('dsh.agent-team.navigation'))).toContain('"mode":"team"')
  await page.getByRole('button', { name: '# delivery' }).click()
  await page.getByRole('heading', { name: '# delivery' }).waitFor()
  await expect.poll(() => page.getByText('Human 已检查 Thread', { exact: true }).count()).toBe(0)
  await expect.poll(() => page.getByText('验收后继续讨论', { exact: true }).count()).toBe(0)
  await expect.poll(() => page.getByText('关闭后继续讨论', { exact: true }).count()).toBe(0)
  await page.getByRole('button', { name: '对话' }).click()
  await ordinaryComposer.waitFor({ timeout: 20_000 })
  await page.screenshot({ path: join(UI01_SHOTS, 'restored-conversations.png'), fullPage: true })

  const enterTeamKeyboard = page.getByRole('button', { name: '团队' })
  await enterTeamKeyboard.focus()
  await expect.poll(() => enterTeamKeyboard.evaluate(element => element === document.activeElement)).toBe(true)
  await expect.poll(() => page.getByRole('button', { name: '团队' }).getAttribute('data-team-action')).toBe('enter')
  await enterTeamKeyboard.press('Enter')
  await expect.poll(() => page.getByRole('button', { name: '成员', exact: true }).count()).toBe(1)

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
  const backKeyboard = page.getByRole('button', { name: '返回 Channel' })
  await backKeyboard.focus()
  await backKeyboard.press('Space')
  await page.getByRole('heading', { name: '# delivery' }).waitFor()
  const leaveTeamKeyboard = page.getByRole('button', { name: '对话' })
  await leaveTeamKeyboard.focus()
  await leaveTeamKeyboard.press('Space')
  await ordinaryComposer.waitFor({ timeout: 20_000 })

  expect(consoleWatch).toEqual({ warnings: [], pageErrors: [] })
}, 120_000)
