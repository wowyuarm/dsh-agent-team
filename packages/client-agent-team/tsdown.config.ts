import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
// One pointer for every consumer: scripts/harness-dir.mjs owns the checkout
// (the certification env override, the marker sync-paths wrote, then the daily
// sibling default), so a certification run can never build the client against
// a different checkout than the type and test layer. Both imports stay
// dynamic: a static template-literal module path breaks tsdown's config loader.
const { harnessDir } = await import('../../scripts/harness-dir.mjs')
const { clientBundle } = await import(pathToFileURL(resolve(harnessDir, 'packages/client/tsdown.client.ts')).href)

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
