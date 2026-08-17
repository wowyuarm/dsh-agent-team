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
const SHOTS = join(TEAM_ROOT, '.scratch/m2-ui/validation/m2-06')
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
  await mkdir(SHOTS, { recursive: true })
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
    const form = page.locator('form').filter({ has: page.getByRole('button', { name: '创建 Agent' }) })
    await form.getByLabel('名称').fill(name)
    await form.getByLabel('说明').fill(description)
    await form.getByRole('button', { name: '创建 Agent' }).click()
    await page.getByText(name, { exact: true }).waitFor({ timeout: 20_000 })
  }
  await expect.poll(() => page.getByLabel('可用').count(), { timeout: 20_000 }).toBeGreaterThanOrEqual(2)

  await page.getByRole('tab', { name: 'Channels' }).click()
  await page.getByRole('button', { name: '新建 Channel' }).click()
  const channelForm = page.locator('form').filter({ has: page.getByRole('button', { name: '创建 Channel' }) })
  await channelForm.getByLabel('名称').fill('delivery')
  await channelForm.getByLabel('说明').fill('M2 完整协作验收')
  await channelForm.getByLabel(/builder/).check()
  await channelForm.getByLabel(/reviewer/).check()
  await channelForm.getByRole('button', { name: '创建 Channel' }).click()
  await page.getByRole('button', { name: '# delivery' }).click()
  await page.getByRole('textbox', { name: '消息内容' }).fill('请协作完成验收')
  await page.getByLabel('@builder').check()
  await page.getByLabel('@reviewer').check()
  await page.getByRole('button', { name: '发送' }).click()
  await page.getByText('请协作完成验收', { exact: true }).waitFor()
  await page.screenshot({ path: join(SHOTS, 'desktop-channel.png'), fullPage: true })

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
  await page.getByRole('textbox', { name: '消息内容' }).fill('Human 已检查 Thread')
  await page.getByRole('button', { name: '发送' }).click()
  await page.getByText('Human 已检查 Thread', { exact: true }).waitFor()
  await page.getByRole('button', { name: '标记完成' }).click()
  await page.getByRole('button', { name: '验收' }).waitFor()
  await page.getByRole('button', { name: '验收' }).click()
  await page.getByRole('button', { name: '重新打开' }).waitFor()
  await page.screenshot({ path: join(SHOTS, 'desktop-thread.png'), fullPage: true })

  await page.setViewportSize({ width: 390, height: 844 })
  const collapsedFrame = page.locator('[data-sidebar-collapsed="true"]')
  await collapsedFrame.waitFor()
  await expect.poll(async () => (await collapsedFrame.locator(':scope > div').first().boundingBox())?.width ?? 999).toBeLessThanOrEqual(56)
  await page.screenshot({ path: join(SHOTS, 'narrow-thread.png'), fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.setViewportSize({ width: 1440, height: 960 })

  await page.getByRole('button', { name: '← 返回 Channel' }).click()
  await page.getByRole('heading', { name: '# delivery' }).waitFor()
  await page.getByRole('button', { name: '成员', exact: true }).click()
  await page.getByRole('dialog', { name: '成员' }).screenshot({ path: join(SHOTS, 'global-members.png') })
  await page.getByRole('button', { name: '关闭', exact: true }).click()

  await page.reload()
  await page.getByRole('button', { name: '# delivery' }).waitFor({ timeout: 20_000 })
  await expect.poll(() => page.evaluate(() => localStorage.getItem('dsh.agent-team.navigation'))).toContain('"mode":"team"')
  await page.getByRole('button', { name: '# delivery' }).click()
  await page.getByRole('heading', { name: '# delivery' }).waitFor()
  await page.getByRole('button', { name: '← 对话' }).click()
  await ordinaryComposer.waitFor({ timeout: 20_000 })
  await page.screenshot({ path: join(SHOTS, 'restored-conversations.png'), fullPage: true })
  expect(consoleWatch).toEqual({ warnings: [], pageErrors: [] })
}, 120_000)
