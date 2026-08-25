import type { AgentTeamMemberId } from './types.ts'

/**
 * Error families the automatic recovery may act on, matched by conservative
 * string signatures. Anything unclassifiable — including context-overflow and
 * auth failures, where retrying is pointless or harmful — stays manual.
 */
export type RecoverableErrorKind = 'transient network' | 'rate limiting'

const TRANSIENT_NETWORK_PATTERNS = [/fetch failed/i, /econnreset/i, /etimedout/i, /socket hang up/i]
const RATE_LIMIT_PATTERNS = [/\b429\b/, /rate limit/i, /\b503\b/, /overloaded/i]

export function classifyRecoverableError(message: string): RecoverableErrorKind | undefined {
  if (RATE_LIMIT_PATTERNS.some(pattern => pattern.test(message))) return 'rate limiting'
  if (TRANSIENT_NETWORK_PATTERNS.some(pattern => pattern.test(message))) return 'transient network'
  return undefined
}

export interface RecoveryCoordinatorOptions {
  /** Performs the injection; throwing means the Member is gone and tracking stops. */
  readonly inject: (memberId: AgentTeamMemberId, attempt: number, kind: RecoverableErrorKind) => void
  /** Delay between an error and its automatic recovery injection. */
  readonly delayMs?: number
  /** Automatic attempts per episode before standing down for the operator. */
  readonly maxAttempts?: number
}

interface EpisodeState {
  kind: RecoverableErrorKind
  lastError: string
  attempts: number
  timer?: ReturnType<typeof setTimeout> | undefined
}

export const RECOVERY_DELAY_MS = 120_000
export const RECOVERY_MAX_ATTEMPTS = 3

/**
 * Per-member automatic recovery episodes. One episode covers a run of
 * identical errors; a changed error string starts a fresh one, and any clean
 * turn end clears the slate. After `maxAttempts` injections of the same error
 * the coordinator stands down and leaves the Member in error for the operator.
 */
export class RecoveryCoordinator {
  private readonly episodes = new Map<AgentTeamMemberId, EpisodeState>()
  private readonly inject: RecoveryCoordinatorOptions['inject']
  private readonly delayMs: number
  private readonly maxAttempts: number

  constructor(options: RecoveryCoordinatorOptions) {
    this.inject = options.inject
    this.delayMs = options.delayMs ?? RECOVERY_DELAY_MS
    this.maxAttempts = options.maxAttempts ?? RECOVERY_MAX_ATTEMPTS
  }

  /** Observe one error occurrence for a Member. */
  onError(memberId: AgentTeamMemberId, errorMessage: string): void {
    const kind = classifyRecoverableError(errorMessage)
    if (kind === undefined) {
      // A non-retryable failure cancels anything pending: retrying cannot help.
      this.stopTracking(memberId)
      return
    }
    let episode = this.episodes.get(memberId)
    if (episode === undefined || episode.lastError !== errorMessage) {
      this.cancelTimer(episode)
      episode = { kind, lastError: errorMessage, attempts: 0 }
      this.episodes.set(memberId, episode)
    } else if (episode.attempts >= this.maxAttempts) {
      // The same error survived every allowed injection — stand down.
      return
    }
    if (episode.timer !== undefined) return
    episode.timer = setTimeout(() => {
      episode!.timer = undefined
      episode!.attempts += 1
      try {
        this.inject(memberId, episode!.attempts, kind)
      } catch {
        this.stopTracking(memberId)
      }
    }, this.delayMs)
  }

  /** A turn ended cleanly (running→idle without an error): the episode is over. */
  onCleanTurnEnd(memberId: AgentTeamMemberId): void {
    this.stopTracking(memberId)
  }

  stopTracking(memberId: AgentTeamMemberId): void {
    const episode = this.episodes.get(memberId)
    if (episode === undefined) return
    this.cancelTimer(episode)
    this.episodes.delete(memberId)
  }

  dispose(): void {
    for (const episode of this.episodes.values()) this.cancelTimer(episode)
    this.episodes.clear()
  }

  private cancelTimer(episode: EpisodeState | undefined): void {
    if (episode?.timer === undefined) return
    clearTimeout(episode.timer)
    episode.timer = undefined
  }
}
