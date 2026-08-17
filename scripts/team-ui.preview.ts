import { cp, mkdir, rm } from 'node:fs/promises'
import { afterAll, beforeAll, it } from 'vitest'
import { launchWebScaffold, type WebScaffold } from './scaffold.ts'

const TEAM_ROOT = '__TEAM_ROOT__'
const OVERLAY = '__OVERLAY__'
const HOME = '__HOME__'
let scaffold: WebScaffold

beforeAll(async () => {
  await rm(HOME, { recursive: true, force: true })
  const scope = `${HOME}/profiles/node_modules/@deepseek-ai`
  await mkdir(scope, { recursive: true })
  for (const name of ['agent-team', 'client-agent-team', 'command-agent-team', 'tool-agent-team']) {
    await cp(`${TEAM_ROOT}/packages/${name}`, `${scope}/dsh-${name}`, {
      recursive: true,
      filter: source => !source.includes('/node_modules') && !source.includes('/src'),
    })
  }
  scaffold = await launchWebScaffold({ extraOverlayPath: OVERLAY, harnessHome: HOME })
  process.stdout.write(`AGENT_TEAM_PREVIEW_URL=${scaffold.baseUrl}\n`)
})

afterAll(async () => { await scaffold.close() })

it('serves the Agent Team preview until stopped', async () => {
  await new Promise<void>(() => {})
}, 2_147_000_000)
