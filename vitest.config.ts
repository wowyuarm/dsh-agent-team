import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'
import { standardDecoratorPlugin } from './scripts/standard-decorators.ts'

// Root tsconfig.json is the match-all resolution facade (no include) for
// files in THIS repo: its paths map routes every @deepseek-ai/dsh-* import to
// the sibling deepseek-harness checkout source, and our own packages to
// ./packages/*. Files inside the harness tree are matched by harness's own
// tsconfig.base.json (registered as a second project), which routes their
// imports back to harness source. paths must win over package exports so a
// second module-singleton copy can never load.
const pathsPlugin = (): ReturnType<typeof tsconfigPaths> => tsconfigPaths({
  projects: ['./tsconfig.json', '../deepseek-harness/tsconfig.base.json'],
})

export default defineConfig({
  plugins: [pathsPlugin(), standardDecoratorPlugin()],
  resolve: {
    // Prefer .ts over stray .js build artifacts that linger in the harness
    // checkout's src trees; keeps this repo independent of their cleanup.
    extensions: ['.mts', '.ts', '.mjs', '.js', '.json'],
  },
  test: {
    include: ['packages/*/tests/**/*.spec.ts'],
  },
})
