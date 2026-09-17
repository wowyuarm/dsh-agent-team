import type { ClientRemote, RemoteStream } from '@deepseek-ai/dsh-api-gateway/client'
import type {} from '@wowyuarm/dsh-agent-team/remote'
import type { AgentTeamChangeScope, AgentTeamChangesResult } from '@wowyuarm/dsh-agent-team/types'

export type TeamChangeScope = AgentTeamChangeScope | undefined

export type TeamChangeUpdate =
  | { readonly type: 'changed'; readonly version: number }
  | { readonly type: 'failed'; readonly message: string }

export type TeamChangeListener = (update: TeamChangeUpdate) => void

function scopeKey(scope: TeamChangeScope): string {
  return scope === undefined ? 'all'
    : scope.kind === 'workspace' ? `workspace:${scope.workspaceId}`
    : scope.kind === 'channel' ? `channel:${scope.channelRef}`
    : scope.kind === 'presence' ? `presence:${scope.workspaceId}`
    : `thread:${scope.threadRef}`
}

interface ScopeSubscription {
  readonly stream: RemoteStream<AgentTeamChangesResult>
  readonly listeners: Set<TeamChangeListener>
  failure: string | undefined
}

/** One logical stream per scope per page; Harness owns the shared transport and recovery. */
export class TeamChangeStream {
  private readonly subscriptions = new Map<string, ScopeSubscription>()

  constructor(private readonly remote: Pick<ClientRemote, '$stream' | 'agentTeam'>) {}

  subscribe(scope: TeamChangeScope, listener: TeamChangeListener): () => void {
    const key = scopeKey(scope)
    let subscription = this.subscriptions.get(key)
    if (subscription === undefined) {
      const stream = this.remote.$stream({
        name: `Team changes ${key}`,
        open: signal => this.remote.agentTeam.changes(scope === undefined ? {} : { scope }, signal),
        ended: () => new Error('Team change subscription ended'),
        carrierFailed: error => this.fail(key, error.message),
      })
      subscription = { stream, listeners: new Set([listener]), failure: undefined }
      this.subscriptions.set(key, subscription)
      void this.run(key, subscription)
    } else {
      subscription.listeners.add(listener)
      if (subscription.failure !== undefined) listener({ type: 'failed', message: subscription.failure })
    }
    const owned = subscription
    return () => {
      if (!owned.listeners.delete(listener) || owned.listeners.size !== 0) return
      if (this.subscriptions.get(key) === owned) this.subscriptions.delete(key)
      void owned.stream.dispose()
    }
  }

  async dispose(): Promise<void> {
    const subscriptions = [...this.subscriptions.values()]
    this.subscriptions.clear()
    await Promise.all(subscriptions.map(subscription => subscription.stream.dispose()))
  }

  private fail(key: string, message: string): void {
    const subscription = this.subscriptions.get(key)
    if (subscription === undefined || subscription.failure !== undefined) return
    subscription.failure = message
    for (const listener of subscription.listeners) listener({ type: 'failed', message })
  }

  private async run(key: string, subscription: ScopeSubscription): Promise<void> {
    try {
      for await (const item of subscription.stream) {
        if (this.subscriptions.get(key) !== subscription) return
        item.accept()
        subscription.failure = undefined
        // Every opening baseline invalidates too: this closes the initial-read
        // race and recovers failed reads even when nothing changed while offline.
        for (const listener of subscription.listeners) listener({ type: 'changed', version: item.value.version })
      }
    } catch (error) {
      if (this.subscriptions.get(key) === subscription) this.fail(key, error instanceof Error ? error.message : String(error))
    }
  }
}

/**
 * The Host's `changes` stream never wakes on a Thread read — a read advances
 * only the reader's private watermark, so no shared projection changes. A
 * durable read does consume the reader's own mention markers, so the Human's
 * badge and Inbox page refresh from the completed read itself instead of
 * waiting for the next unrelated commit.
 */
export class TeamReadStream {
  private version = 0
  private readonly listeners = new Set<() => void>()

  bump(): void {
    this.version += 1
    for (const listener of this.listeners) listener()
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
}
