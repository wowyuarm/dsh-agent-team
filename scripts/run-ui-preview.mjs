import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const harness = resolve(root, `../${process.env.DSH_HARNESS_DIR ?? 'deepseek-harness'}`)
const temporary = await mkdtemp(join(tmpdir(), 'dsh-agent-team-ui-preview-'))
const overlay = join(temporary, 'overlay.yml')
const home = join(temporary, 'home')
const test = join(harness, 'apps/web/tests/__external-agent-team-ui-preview.e2e.ts')
const quote = value => value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")
const overlayText = `- insert:\n    - id: wowyuarm-agent-team-scope\n      name: cordis:group\n      group: true\n      isolate:\n        agentPresets: true\n      config:\n        - id: wowyuarm-agent-team-presets\n          name: '@wowyuarm/dsh-agent-team/preset-roster'\n        - id: wowyuarm-agent-team-host\n          name: '@wowyuarm/dsh-agent-team/host'\n    - id: wowyuarm-agent-team-client\n      name: '@wowyuarm/dsh-agent-team'\n    - id: wowyuarm-agent-team-invariant\n      name: '@wowyuarm/dsh-agent-team/invariant'\n`

try {
  await access(join(harness, 'apps/web/dist/index.html'), constants.R_OK)
  await writeFile(overlay, overlayText)
  const rendered = (await readFile(join(root, 'scripts/team-ui.ui-preview.ts'), 'utf8'))
    .replace('__TEAM_ROOT__', quote(root)).replace('__OVERLAY__', quote(overlay)).replace('__HOME__', quote(home))
  await writeFile(test, rendered)
  const child = spawn('corepack', ['pnpm', 'exec', 'vitest', 'run', '--config', 'vitest.web.config.ts', 'apps/web/tests/__external-agent-team-ui-preview.e2e.ts', '--reporter=verbose'], {
    cwd: harness,
    stdio: 'inherit',
    env: { ...process.env, DSH_SNAPSHOT: 'replay' },
  })
  const stop = () => { child.kill('SIGTERM') }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  await new Promise((resolveExit, reject) => {
    child.once('error', reject)
    child.once('exit', code => code === 0 || code === null || code === 143 ? resolveExit() : reject(new Error(`UI preview exited with ${code}`)))
  })
} finally {
  await rm(test, { force: true })
  await rm(temporary, { recursive: true, force: true })
}
