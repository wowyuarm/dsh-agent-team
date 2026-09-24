/** The one local environment check: how the running DSH compares to the line this bundle declares. */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { evaluatePluginCompatibility, getDshRuntimeVersion } from '@deepseek-ai/dsh-app-boot'

/**
 * Which of the three shapes the settings page renders. There is deliberately no
 * fourth: a fact this Host cannot establish is `undetermined`, never a guess,
 * and the two causes that produce it (an unreadable runtime version, a support
 * range this manifest does not state) are not distinguished to the reader —
 * only recorded in `reason` for diagnostics.
 */
export type EnvironmentVerdict = 'ok' | 'out-of-range' | 'undetermined'

/** The declared DSH support line, rendered in words; never a bare range string. */
export interface EnvironmentSupportRange {
  /** Lower bound of the declared range, which is also the certified baseline. */
  readonly lower: string
  /** Exclusive upper bound of the declared range. */
  readonly upper: string
}

/** What the settings page needs to state the environment; every field is optional by contract. */
export interface EnvironmentReport {
  readonly verdict: EnvironmentVerdict
  /** Host-side diagnostic for an `undetermined` verdict; never rendered as user copy. */
  readonly reason?: string | undefined
  /** Version of the bundle this Host runs from, or `'unknown'` when its manifest is unreadable. */
  readonly bundleVersion: string
  /**
   * The running DSH version — what the page states it is running. Omitted, not
   * guessed, when it could not be read; it is a different fact from
   * `certifiedDshVersion`, which is the line this bundle declares support for.
   */
  readonly dshVersion?: string | undefined
  /** Lower bound of the declared support range: the certified, actually-tested DSH line. */
  readonly certifiedDshVersion?: string | undefined
  readonly supportRange?: EnvironmentSupportRange | undefined
}

/** Prefix of every peer that sits on the DSH version line; the bare scope is not one. */
const DSH_PEER_PREFIX = '@deepseek-ai/dsh-'

/** The `>=lower <upper>` shape every DSH peer carries; a comparator series, not a single version. */
const SUPPORT_RANGE_SHAPE = /^>=(\S+)\s+<(\S+)$/u

/**
 * Read the support line from the installed manifest's DSH peers, or nothing.
 *
 * Every `@deepseek-ai/dsh-*` peer must carry exactly the same range, and it must
 * be a `>=<lower> <upper>` series: the version line is the manifest's own claim
 * and a partially drifted manifest cannot state one. `scripts/check-version-consistency.mjs`
 * holds the same shape to the certified baseline, so a run of this bundle
 * states the same line its README does. Returns `undefined` when the peers
 * disagree or the shape is unreadable.
 */
export function supportRangeOf(manifest: object): EnvironmentSupportRange | undefined {
  const fields = manifest as { readonly peerDependencies?: unknown }
  if (typeof fields.peerDependencies !== 'object' || fields.peerDependencies === null) return undefined
  const ranges = new Set<string>()
  for (const [name, range] of Object.entries(fields.peerDependencies as Record<string, unknown>)) {
    if (!name.startsWith(DSH_PEER_PREFIX)) continue
    if (typeof range !== 'string') return undefined
    ranges.add(range)
  }
  const distinct = [...ranges]
  if (distinct.length !== 1) return undefined
  const shape = SUPPORT_RANGE_SHAPE.exec(distinct[0]!)
  if (shape === null) return undefined
  return Object.freeze({ lower: shape[1]!, upper: shape[2]! })
}

/** Version of the manifest this package installed from, or `'unknown'`. */
function readInstalledBundleVersion(): string {
  const manifest = readInstalledManifest()
  if (typeof manifest?.version === 'string' && manifest.version !== '') return manifest.version
  return 'unknown'
}

/**
 * Parsed manifest of the installed bundle, or `undefined` when it cannot be
 * read. Three levels up: `packages/agent-team/{src,lib}` sits that deep in both
 * a `link:` checkout and a registry tarball.
 */
function readInstalledManifest(): Record<string, unknown> | undefined {
  try {
    const manifestPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../package.json')
    const parsed: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'))
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined
  } catch {
    // An unreadable own manifest is a broken install, not a panel failure: the
    // report says 'unknown' and the page renders `undetermined`.
    return undefined
  }
}

/**
 * Ask the Harness's own evaluator whether one range admits one version.
 *
 * The range is passed as a single-peer manifest, so the answer is about that
 * range alone — exactly the reason `evaluateEnvironment` judges against the
 * range it prints instead of against one representative peer. Prerelease
 * ordering is the evaluator's (`0.1.7-alpha.1` is below `0.1.7-rc.1`; a
 * prerelease of the upper bound like `0.1.8-rc.1` is below `0.1.8` and inside
 * the range), which is what the page's "from X, before Y" states in words.
 *
 * @param range - one `>=lower <upper` series.
 * @param version - the running DSH version.
 * @returns whether the range admits the version; `false` on anything malformed.
 */
export function rangeAdmits(range: string, version: string): boolean {
  try {
    return evaluatePluginCompatibility({
      name: '@wowyuarm/dsh-agent-team',
      version: '0.0.0',
      peerDependencies: { '@deepseek-ai/dsh-runtime': range },
    }, {}, version) === undefined
  } catch {
    // The evaluator throws on a malformed range or a non-semver version, and a
    // question it refuses to answer is not an admission.
    return false
  }
}

/**
 * Judge one already-resolved triple, so every branch is testable without an
 * environment. The verdict comes from the Harness's own
 * `evaluatePluginCompatibility` — the plugin manager decides installability with
 * that same function, and prerelease ordering is exactly what a hand-written
 * comparison gets wrong.
 *
 * @param manifest - the installed bundle's parsed manifest, the source of the declared support line.
 * @param runtimeVersion - the running DSH version, or `'unknown'` when it could not be read.
 * @param bundleVersion - the installed bundle version, or `'unknown'`.
 * @param unavailable - why the running version is not known, recorded when it is `'unknown'`.
 * @returns the report the settings page renders.
 */
export function evaluateEnvironment(
  manifest: object,
  runtimeVersion: string,
  bundleVersion: string,
  unavailable?: string,
): EnvironmentReport {
  const range = supportRangeOf(manifest)
  const base = {
    bundleVersion,
    ...(range === undefined ? {} : { certifiedDshVersion: range.lower, supportRange: range }),
  }
  if (runtimeVersion === 'unknown') {
    return Object.freeze({ ...base, verdict: 'undetermined', reason: unavailable ?? 'the running dsh version is unavailable' })
  }
  const running = { ...base, dshVersion: runtimeVersion }
  // A real violation is answered first, and it is never downgraded to
  // `undetermined`: a peer that drifted to a range of its own is a genuine
  // "not satisfied" even though no single range can then be stated for the
  // page. Only when nothing is violated does the question become whether the
  // declared line can be stated at all.
  const declared = range === undefined ? undefined : `>=${range.lower} <${range.upper}`
  const satisfied = evaluatePluginCompatibility(manifest, {}, runtimeVersion) === undefined
    && (declared === undefined || rangeAdmits(declared, runtimeVersion))
  if (!satisfied) return Object.freeze({ ...running, verdict: 'out-of-range' })
  // Nothing is violated but there is no line to state: the page withholds the
  // range rather than inventing one.
  if (range === undefined) {
    return Object.freeze({ ...base, verdict: 'undetermined', reason: 'the declared dsh support range is unreadable or drifted' })
  }
  return Object.freeze({ ...running, verdict: 'ok' })
}

/**
 * Read this Host's own environment: the installed bundle version, the declared
 * support line, and how the running DSH compares to it.
 *
 * The certified DSH version is the range's lower bound, never the newest cut
 * tested against it: `docs/dsh-release-compatibility.md` §4 records a baseline
 * inside the declared range without moving the peers, so every version spot
 * keeps naming the bound. Reading it from anywhere else would reintroduce the
 * hand-maintained constant this check exists to remove.
 *
 * @returns the report, with `verdict: 'undetermined'` for any fact not established.
 */
export function reportEnvironment(): EnvironmentReport {
  const manifest = readInstalledManifest() ?? {}
  const bundleVersion = readInstalledBundleVersion()
  let runtime: string
  try {
    runtime = getDshRuntimeVersion()
  } catch (error) {
    return evaluateEnvironment(manifest, 'unknown', bundleVersion, error instanceof Error ? error.message : String(error))
  }
  return evaluateEnvironment(manifest, runtime, bundleVersion)
}
