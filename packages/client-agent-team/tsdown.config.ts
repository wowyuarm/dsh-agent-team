import { resolve } from 'node:path'
// Certification runs point the bundle helper at an isolated checkout at the
// candidate tag (see docs/dsh-release-compatibility.md).
const harnessDir = process.env.DSH_HARNESS_DIR ?? 'deepseek-harness'
const { clientBundle } = await import(`../../../${harnessDir}/packages/client/tsdown.client.ts`)

const bundle = clientBundle('@wowyuarm/dsh-agent-team', [
  'lib/types/index.js',
])

export default async (options: Parameters<typeof bundle>[0]) => (await bundle(options)).map(entry => ({
  ...entry,
  resolve: {
    ...entry.resolve,
    alias: {
      ...entry.resolve?.alias,
      '@wowyuarm/dsh-agent-team/remote': resolve('../../../packages/agent-team/lib/typert.remote-client.js'),
    },
  },
}))
