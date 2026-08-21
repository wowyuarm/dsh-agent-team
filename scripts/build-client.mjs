import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { join, resolve } from 'node:path'

const projectRoot = resolve(import.meta.dirname, '..')
const harnessRoot = resolve(projectRoot, '../deepseek-harness')
const clientRoot = join(projectRoot, 'packages/client-agent-team')
const temporaryPackage = await mkdtemp(join(harnessRoot, 'packages/external-agent-team-'))
const manifestDirectory = join(temporaryPackage, 'bundle')

const run = () => new Promise((resolveRun, reject) => {
  const child = spawn(join(harnessRoot, 'node_modules/.bin/tsdown'), [], {
    cwd: clientRoot,
    stdio: 'inherit',
    env: { ...process.env, DSH_AGENT_TEAM_BUILD_RUNTIME: '1' },
  })
  child.once('error', reject)
  child.once('exit', code => code === 0 ? resolveRun() : reject(new Error(`tsdown exited with ${String(code)}`)))
})

try {
  await mkdir(manifestDirectory)
  const manifest = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8'))
  await writeFile(join(manifestDirectory, 'package.json'), JSON.stringify({ name: manifest.name, dsh: manifest.dsh }))
  await run()
} finally {
  await rm(temporaryPackage, { recursive: true, force: true })
}
