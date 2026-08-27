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
  /** Performs a delayed recovery wakeup; throwing means the Member is gone and tracking stops. */
  readonly wake: (memberId: AgentTeamMemberId) => void
  /** Called once when an episode reaches its failure limit and tracking stands down. */
  readonly onStandDown?: (memberId: AgentTeamMemberId, consecutiveFailures: number) => void
  /** Delay between a recoverable error and its automatic recovery wakeup. */
  readonly delayMs?: number
  /** Consecutive recoverable errors allowed before automatic recovery stands down. */
  readonly maxConsecutiveErrors?: number
}

interface EpisodeState {
  consecutiveFailures: number
  timers: Set<ReturnType<typeof setTimeout>>
  stoodDown?: boolean | undefined
}

export const RECOVERY_DELAY_MS = 120_000
export const RECOVERY_MAX_CONSECUTIVE_ERRORS = 3

/**
 * Per-member automatic recovery episodes. An episode is every recoverable
 * `agent/error` occurrence until a clean turn end, regardless of error text
 * or family. Each of the first two occurrences schedules its own wakeup.
 */
export class RecoveryCoordinator {
  private readonly episodes = new Map<AgentTeamMemberId, EpisodeState>()
  private readonly wake: RecoveryCoordinatorOptions['wake']
  private readonly onStandDown: RecoveryCoordinatorOptions['onStandDown']
  private readonly delayMs: number
  private readonly maxConsecutiveErrors: number

  constructor(options: RecoveryCoordinatorOptions) {
    this.wake = options.wake
    this.onStandDown = options.onStandDown
    this.delayMs = options.delayMs ?? RECOVERY_DELAY_MS
    this.maxConsecutiveErrors = options.maxConsecutiveErrors ?? RECOVERY_MAX_CONSECUTIVE_ERRORS
  }

  /** Observe one `agent/error` occurrence for a Member. */
  onError(memberId: AgentTeamMemberId, errorMessage: string): void {
    if (classifyRecoverableError(errorMessage) === undefined) {
      // A non-recoverable failure cancels anything pending: retrying cannot help.
      this.stopTracking(memberId)
      return
    }

    let episode = this.episodes.get(memberId)
    if (episode === undefined) {
      episode = { consecutiveFailures: 0, timers: new Set() }
      this.episodes.set(memberId, episode)
    }
    if (episode.stoodDown === true) return

    episode.consecutiveFailures += 1
    if (episode.consecutiveFailures >= this.maxConsecutiveErrors) {
      this.cancelTimers(episode)
      episode.stoodDown = true
      this.onStandDown?.(memberId, episode.consecutiveFailures)
      return
    }

    const timer = setTimeout(() => {
      episode!.timers.delete(timer)
      try {
        this.wake(memberId)
      } catch {
        this.stopTracking(memberId)
      }
    }, this.delayMs)
    episode.timers.add(timer)
  }

  /** A turn ended cleanly (running→idle without an error): the episode is over. */
  onCleanTurnEnd(memberId: AgentTeamMemberId): void {
    this.stopTracking(memberId)
  }

  stopTracking(memberId: AgentTeamMemberId): void {
    const episode = this.episodes.get(memberId)
    if (episode === undefined) return
    this.cancelTimers(episode)
    this.episodes.delete(memberId)
  }

  dispose(): void {
    for (const episode of this.episodes.values()) this.cancelTimers(episode)
    this.episodes.clear()
  }

  private cancelTimers(episode: EpisodeState): void {
    for (const timer of episode.timers) clearTimeout(timer)
    episode.timers.clear()
  }
}
