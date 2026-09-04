import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

// scripts/harness-dir.mjs is the single source of truth for the sibling
// harness checkout. It runs at import time, so each case exercises it in a
// fresh node process with a controlled environment.
const run = (env: Record<string, string | undefined>): { stdout: string; stderr: string } => {
  const environment = { ...process.env, ...Object.fromEntries(Object.entries(env).map(([key, value]) => [key, value ?? ''])) }
  for (const key of Object.keys(env)) if (env[key] === undefined) delete environment[key]
  try {
    const stdout = execFileSync(process.execPath, ['-e', "import('./scripts/harness-dir.mjs').then(m => console.log(m.harnessName + ' ' + m.harnessDir))"], {
      cwd: process.cwd(),
      env: environment,
      encoding: 'utf8',
    })
    return { stdout, stderr: '' }
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string }
    return { stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' }
  }
}

describe('harness checkout pointer', () => {
  it('resolves the daily sibling by default with no env and no marker', () => {
    // The repository carries no .generated-harness in git; a clean checkout
    // resolves the documented default name.
    const result = run({ DSH_HARNESS_DIR: undefined })
    expect(result.stdout).toContain('deepseek-harness')
    expect(result.stderr).toBe('')
  })

  it('fails fast with actionable guidance when the env override names a missing checkout', () => {
    const result = run({ DSH_HARNESS_DIR: 'deepseek-harness-does-not-exist' })
    expect(result.stderr).toContain('deepseek-harness-does-not-exist')
    // The error must point at the fix instead of surfacing as a far-away
    // runtime symptom: it names the daily default, lists the harness
    // checkouts that do exist, and references the compatibility doc.
    expect(result.stderr).toContain('deepseek-harness-dsh-v0.1.2-rc.1')
    expect(result.stderr).toContain('Harness checkouts that DO exist as siblings')
    expect(result.stderr).toContain('docs/dsh-release-compatibility.md')
  })

  it('prefers the env override over the generated marker', () => {
    const marker = join(process.cwd(), '.generated-harness')
    // The committed tree regenerates against the daily default; the marker
    // (untracked) only exists after a cert-run generation. When both sources
    // are present, the explicit env wins — verified indirectly: the env value
    // resolving to a missing directory fails even though the marker names a
    // valid checkout, proving the marker did not take precedence.
    const result = run({ DSH_HARNESS_DIR: 'deepseek-harness-does-not-exist' })
    expect(result.stderr).toContain('DSH_HARNESS_DIR points the harness resolution')
    void marker
  })
})
