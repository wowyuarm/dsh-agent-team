import { useSyncExternalStore } from 'react'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { AgentTeamEnvironmentResult } from '@wowyuarm/dsh-agent-team/types'

/**
 * The Client's one projection of the local environment check.
 *
 * Deliberately separate from the Human identity projection: this is a fact
 * about the installation, not about the Human, it is read once and never
 * written back, and the settings page is the only surface that renders it.
 * Folding it into the identity store would make every seat that names the
 * Human depend on a version comparison it has no use for.
 *
 * Reads are demand-driven off the first subscriber, so an ordinary conversation
 * never calls the Remote. There is no retry: `undetermined` is a settled
 * verdict about facts the Host could not establish, not a failed request, so a
 * reader has nothing to retry.
 */

/** One read of the environment check, replaced wholesale on every change. */
export interface TeamEnvironmentSnapshot {
  /** `loading` until the first read settles, `ready` once it has. */
  readonly status: 'loading' | 'ready'
  /** The report to render; undefined until the first read settles. */
  readonly report?: AgentTeamEnvironmentResult | undefined
  /** Last failure, kept beside the last accepted report so the page can report it. */
  readonly error?: string | undefined
}

/** Read-side face the settings page binds. */
export interface TeamEnvironmentSource {
  getSnapshot(): TeamEnvironmentSnapshot
  subscribe(listener: () => void): () => void
}

/** Host call the store reads through; one loader per Client context. */
export interface TeamEnvironmentLoader {
  loadEnvironment: () => Promise<RemoteResult<AgentTeamEnvironmentResult>>
}

const INITIAL: TeamEnvironmentSnapshot = { status: 'loading' }

export class TeamEnvironmentCheck implements TeamEnvironmentSource {
  private snapshot: TeamEnvironmentSnapshot = INITIAL
  private readonly listeners = new Set<() => void>()
  private reading: Promise<void> | undefined
  private readonly loader: TeamEnvironmentLoader

  constructor(loader: TeamEnvironmentLoader) {
    this.loader = loader
  }

  readonly getSnapshot = (): TeamEnvironmentSnapshot => this.snapshot

  /**
   * Observe the check, starting the first read when nobody has read yet.
   * @param listener - invoked after every snapshot replacement.
   * @returns the disposer removing this listener.
   */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    if (this.snapshot.status === 'loading' && this.reading === undefined) void this.refresh()
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Read the Host projection. Concurrent callers share one round trip, and a
   * failed read keeps the last accepted report beside the reported error — the
   * block never blanks out over a background read.
   * @returns settlement of this read (or of the read already in flight).
   */
  refresh(): Promise<void> {
    if (this.reading !== undefined) return this.reading
    const reading = this.read().finally(() => {
      if (this.reading === reading) this.reading = undefined
    })
    this.reading = reading
    return reading
  }

  dispose(): void {
    this.listeners.clear()
  }

  private async read(): Promise<void> {
    let report: AgentTeamEnvironmentResult
    try {
      const result = await this.loader.loadEnvironment()
      if (!result.ok) {
        this.fail(result.error.message)
        return
      }
      report = result.value
    } catch (error) {
      // A dropped connection surfaces as a thrown carrier error, not a result:
      // both are read failures and both keep whatever report already stands.
      this.fail(error instanceof Error ? error.message : String(error))
      return
    }
    this.commit({ status: 'ready', report })
  }

  private fail(message: string): void {
    const held = this.snapshot
    this.commit(held.report === undefined
      ? { status: 'ready', error: message }
      : { ...held, error: message })
  }

  private commit(snapshot: TeamEnvironmentSnapshot): void {
    this.snapshot = snapshot
    for (const listener of this.listeners) listener()
  }
}

/** Subscribe one rendered block to the environment check. */
export function useEnvironmentCheck(environment: TeamEnvironmentSource): TeamEnvironmentSnapshot {
  return useSyncExternalStore(environment.subscribe, environment.getSnapshot, environment.getSnapshot)
}
