import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { AgentTeamChangeScope, AgentTeamChangesRequest, AgentTeamChangesResult } from '@wowyuarm/dsh-agent-team/types'

export type TeamChangeScope = AgentTeamChangeScope

/** One invalidation delivered to every surface subscribed to one scope. */
export type TeamChangeUpdate =
  | { readonly type: 'changed'; readonly version: number }
  | { readonly type: 'failed'; readonly message: string }

export type TeamChangeListener = (update: TeamChangeUpdate) => void

type ChangesFn = (request: AgentTeamChangesRequest, signal?: AbortSignal) => Promise<RemoteResult<AgentTeamChangesResult>>

function scopeKey(scope: TeamChangeScope): string {
  return scope.kind === 'workspace' ? `workspace:${scope.workspaceId}`
    : scope.kind === 'channel' ? `channel:${scope.channelRef}`
    : `thread:${scope.threadRef}`
}

interface ScopePoll {
  readonly controller: AbortController
  readonly listeners: Set<TeamChangeListener>
}

/**
 * One long-poll per change scope, shared by every listening surface: panels
 * and pages never open parallel `changes` requests for the same scope, and
 * the poll is aborted as soon as the last subscriber leaves.
 */
export class TeamChangeStream {
  private readonly polls = new Map<string, ScopePoll>()

  constructor(private readonly changes: ChangesFn) {}

  subscribe(scope: TeamChangeScope, listener: TeamChangeListener): () => void {
    const key = scopeKey(scope)
    let poll = this.polls.get(key)
    if (poll === undefined) {
      poll = { controller: new AbortController(), listeners: new Set() }
      this.polls.set(key, poll)
      void this.run(key, scope, poll)
    }
    poll.listeners.add(listener)
    return () => {
      const current = this.polls.get(key)
      if (current === undefined || !current.listeners.delete(listener)) return
      if (current.listeners.size === 0) {
        this.polls.delete(key)
        current.controller.abort()
      }
    }
  }

  private async run(key: string, scope: TeamChangeScope, poll: ScopePoll): Promise<void> {
    const { signal } = poll.controller
    // Sample the current version silently first: subscribers just fetched
    // their initial projection, and an immediate wake would double-fetch.
    const probe = await this.changes({ afterVersion: 0, scope }, signal)
    if (signal.aborted) return
    if (!probe.ok) {
      this.fail(key, poll, probe.error.message)
      return
    }
    let version = probe.value.version
    while (!signal.aborted) {
      const result = await this.changes({ afterVersion: version, scope }, signal)
      if (signal.aborted) return
      if (!result.ok) {
        this.fail(key, poll, result.error.message)
        return
      }
      if (result.value.version > version) {
        version = result.value.version
        for (const listener of poll.listeners) listener({ type: 'changed', version })
      }
    }
  }

  private fail(key: string, poll: ScopePoll, message: string): void {
    // A dead poll must not stay registered: the next subscriber restarts it.
    if (this.polls.get(key) === poll) this.polls.delete(key)
    for (const listener of poll.listeners) listener({ type: 'failed', message })
  }
}
