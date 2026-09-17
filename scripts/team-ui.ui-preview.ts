import { cp, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, it } from 'vitest'
import { launchWebScaffold, type WebScaffold } from './scaffold.ts'

const TEAM_ROOT = '__TEAM_ROOT__'
const OVERLAY = '__OVERLAY__'
const HOME = '__HOME__'
// Where this lane stages the bundle, and the profile layer anchor derived from
// it. The scaffold resolves plugin imports from a computed generation built out
// of `profile.layers`, so a staged bundle it does not name resolves neither its
// own rows nor its dependency closure; this fixture then fails on the first
// `ctx.agentTeam` call rather than on a module-resolution error.
const TEAM_STAGED_ROOT = join(HOME, 'profiles/node_modules/@wowyuarm/dsh-agent-team')
const TEAM_INSTALL_ANCHOR = join(TEAM_STAGED_ROOT, 'package.json')
let scaffold: WebScaffold

beforeAll(async () => {
  await rm(HOME, { recursive: true, force: true })
  await mkdir(join(TEAM_STAGED_ROOT, '..'), { recursive: true })
  await cp(TEAM_ROOT, TEAM_STAGED_ROOT, {
    recursive: true,
    filter: source => !source.includes('/node_modules') && !source.includes('/src') && !source.includes('/artifacts') && !source.includes('/.hoplite'),
  })
  scaffold = await launchWebScaffold({ extraOverlayPath: OVERLAY, harnessHome: HOME, extraInstallAnchors: [TEAM_INSTALL_ANCHOR] })
  const workspacePath = join(scaffold.workspaceCwd, 'team-ui-preview')
  await mkdir(workspacePath, { recursive: true })
  const workspace = await scaffold.ctx.workspaceRegistry.create(workspacePath, 'Team UI Preview')
  const channel = await scaffold.ctx.agentTeam.createChannel({
    requestId: 'ui-preview-channel' as never,
    workspaceId: workspace.id,
    name: 'delivery',
    description: 'Model-free fixture state',
  })
  await scaffold.ctx.agentTeam.sendMessage({
    requestId: 'ui-preview-task' as never,
    workspaceId: workspace.id,
    channelRef: channel.channel.channelRef,
    body: '检查无模型 UI 预览的频道和 Thread 布局',
  })
  process.stdout.write(`AGENT_TEAM_UI_PREVIEW_URL=${scaffold.baseUrl}\n`)
  process.stdout.write('UI-only preview: fixture state is loaded; model calls are disabled and fail explicitly if triggered.\n')
})

afterAll(async () => { await scaffold.close() })

it('serves the model-free Agent Team UI preview until stopped', async () => {
  await new Promise<void>(() => {})
}, 2_147_000_000)
