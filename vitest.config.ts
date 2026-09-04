import { resolve } from 'node:path'
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'
import { harnessDir } from './scripts/harness-dir.mjs'
import { standardDecoratorPlugin } from './scripts/standard-decorators.ts'

// Root tsconfig.json is the match-all resolution facade (no include) for
// files in THIS repo: its paths map routes every @deepseek-ai/dsh-* import to
// the sibling deepseek-harness checkout source, and our own packages to
// ./packages/*. Files inside the harness tree are matched by harness's own
// tsconfig.base.json (registered as a second project), which routes their
// imports back to harness source. paths must win over package exports so a
// second module-singleton copy can never load.
const pathsPlugin = (): ReturnType<typeof tsconfigPaths> => tsconfigPaths({
  // scripts/harness-dir.mjs owns the checkout pointer for every consumer:
  // env override for certification runs, the daily sibling default otherwise,
  // fail-fast when the resolved checkout is missing.
  projects: ['./tsconfig.json', resolve(harnessDir, 'tsconfig.base.json')],
})

export default defineConfig({
  plugins: [pathsPlugin(), standardDecoratorPlugin()],
  resolve: {
    // Prefer .ts over stray .js build artifacts that linger in the harness
    // checkout's src trees; keeps this repo independent of their cleanup.
    extensions: ['.mts', '.ts', '.mjs', '.js', '.json'],
    // Harness sources live in a sibling workspace; rendered tests must still
    // share one React dispatcher with this repository's Testing Library.
    dedupe: ['react', 'react-dom'],
    alias: [
      { find: /^react$/, replacement: resolve('node_modules/react/index.js') },
      { find: /^react\/jsx-runtime$/, replacement: resolve('node_modules/react/jsx-runtime.js') },
      { find: /^react-dom$/, replacement: resolve('node_modules/react-dom/index.js') },
      { find: /^react-dom\/(.*)$/, replacement: resolve('node_modules/react-dom/$1') },
      { find: /^@testing-library\/react$/, replacement: resolve('node_modules/@testing-library/react/dist/index.js') },
      { find: /^@testing-library\/dom$/, replacement: resolve('node_modules/@testing-library/dom/dist/index.js') },
      { find: /^use-sync-external-store\/(.*)$/, replacement: resolve('node_modules/use-sync-external-store/$1') },
    ],
  },
  test: {
    include: ['packages/*/tests/**/*.spec.ts', 'packages/*/tests/**/*.client.spec.tsx'],
    // Every test file gets a throwaway DSH home so Agent Team boots can never
    // prune the developer's real Member memory directories.
    setupFiles: ['./scripts/isolate-dsh-home.setup.ts'],
  },
})
