import { rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outputDirs = [
  'packages/agent-team/lib',
  'packages/tool-agent-team/lib',
  'packages/client-agent-team/lib',
]

await Promise.all(outputDirs.map(directory => rm(resolve(root, directory), { recursive: true, force: true })))
