import { resolve } from 'node:path'
import { clientBundle } from '../../../deepseek-harness/packages/client/tsdown.client.ts'

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
