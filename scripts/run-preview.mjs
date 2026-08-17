import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const harness = resolve(root, '../deepseek-harness')
const temporary = await mkdtemp(join(tmpdir(), 'dsh-agent-team-preview-'))
const overlay = join(temporary, 'overlay.yml')
const home = join(temporary, 'home')
const test = join(harness, 'apps/web/tests/__external-agent-team-preview.e2e.ts')
const quote = value => value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")
const overlayText = `- insert:\n    - id: dsh-agent-team-scope\n      name: cordis:group\n      group: true\n      isolate:\n        agentPresets: true\n      config:\n        - id: dsh-agent-team-presets\n          name: '@deepseek-ai/dsh-agent-team/preset-roster'\n        - id: dsh-agent-team\n          name: '@deepseek-ai/dsh-agent-team'\n    - id: dsh-agent-team-invariant\n      name: '@deepseek-ai/dsh-agent-team/invariant'\n    - id: dsh-command-agent-team\n      name: '@deepseek-ai/dsh-command-agent-team'\n    - id: dsh-command-agent-team-invariant\n      name: '@deepseek-ai/dsh-command-agent-team/invariant'\n    - id: dsh-client-agent-team\n      name: '@deepseek-ai/dsh-client-agent-team'\n`

try {
  await access(join(harness, 'apps/web/dist/index.html'), constants.R_OK)
  await writeFile(overlay, overlayText)
  const rendered = (await readFile(join(root, 'scripts/team-ui.preview.ts'), 'utf8'))
    .replace('__TEAM_ROOT__', quote(root)).replace('__OVERLAY__', quote(overlay)).replace('__HOME__', quote(home))
  await writeFile(test, rendered)
  const child = spawn('corepack', ['pnpm', 'exec', 'vitest', 'run', '--config', 'vitest.web.config.ts', 'apps/web/tests/__external-agent-team-preview.e2e.ts', '--reporter=verbose'], {
    cwd: harness, stdio: 'inherit', env: process.env,
  })
  const stop = () => { child.kill('SIGTERM') }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  await new Promise((resolveExit, reject) => {
    child.once('error', reject)
    child.once('exit', code => code === 0 || code === null || code === 143 ? resolveExit() : reject(new Error(`preview exited with ${code}`)))
  })
} finally {
  await rm(test, { force: true })
  await rm(temporary, { recursive: true, force: true })
}
