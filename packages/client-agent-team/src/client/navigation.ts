import type { ClientContext, WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
import type { AgentTeamChannelRef, AgentTeamThreadRef } from '@deepseek-ai/dsh-agent-team/types'

export type TeamMode = 'conversation' | 'team'

export type TeamWorkspaceTab = 'channels' | 'agents'

export interface TeamNavigationSnapshot {
  mode: TeamMode
  workspaceId?: WorkspaceId
  activeTab: TeamWorkspaceTab
  channelRef?: AgentTeamChannelRef
  threadRef?: AgentTeamThreadRef
}

const STORAGE_KEY = 'dsh.agent-team.navigation'

function readSnapshot(): TeamNavigationSnapshot {
  if (typeof localStorage === 'undefined') return { mode: 'conversation', activeTab: 'channels' }
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '') as Partial<TeamNavigationSnapshot>
    return {
      mode: parsed.mode === 'team' ? 'team' : 'conversation',
      activeTab: 'channels',
      ...(typeof parsed.workspaceId === 'string' ? { workspaceId: parsed.workspaceId as WorkspaceId } : {}),
    }
  } catch {
    return { mode: 'conversation', activeTab: 'channels' }
  }
}

function persistSnapshot(snapshot: TeamNavigationSnapshot): void {
  if (typeof localStorage === 'undefined') return
  try {
    const { mode, workspaceId } = snapshot
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode, ...(workspaceId === undefined ? {} : { workspaceId }) }))
  } catch {
    // Local persistence is a convenience; private mode and quota failures do not block navigation.
  }
}

export interface TeamNavigationActions {
  enterTeam: () => void
  leaveTeam: () => void
  selectWorkspace: (workspaceId: WorkspaceId) => void
  selectWorkspaceTab: (tab: TeamWorkspaceTab) => void
  selectChannel: (channelRef: AgentTeamChannelRef) => void
  selectThread: (threadRef: AgentTeamThreadRef) => void
  backToChannel: () => void
  createWorkspaceFromPath: (path: string) => Promise<{ workspaceId: WorkspaceId }>
}

/** Root-scoped Team mode state. Slot lifetimes subscribe to this source. */
export class TeamNavigation {
  private snapshot = readSnapshot()
  private readonly listeners = new Set<() => void>()

  constructor(private readonly ctx: ClientContext) {}

  readonly getSnapshot = (): TeamNavigationSnapshot => this.snapshot

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  actions(): TeamNavigationActions {
    return {
      enterTeam: () => { this.setMode('team') },
      leaveTeam: () => { this.setMode('conversation') },
      selectWorkspace: workspaceId => { this.setWorkspace(workspaceId) },
      selectWorkspaceTab: tab => { this.setTab(tab) },
      selectChannel: channelRef => { this.setChannel(channelRef) },
      selectThread: threadRef => { this.setThread(threadRef) },
      backToChannel: () => { this.setThread(undefined) },
      createWorkspaceFromPath: path => this.ctx.workspaces.create({ path }),
    }
  }

  dispose(): void {
    this.listeners.clear()
  }

  private setMode(mode: TeamMode): void {
    if (this.snapshot.mode === mode) return
    this.snapshot = { ...this.snapshot, mode }
    this.commit()
  }

  private setWorkspace(workspaceId: WorkspaceId): void {
    if (this.snapshot.workspaceId === workspaceId) return
    const { channelRef: _channelRef, threadRef: _threadRef, ...base } = this.snapshot
    this.snapshot = { ...base, workspaceId, activeTab: 'channels' }
    this.commit()
  }

  private setChannel(channelRef: AgentTeamChannelRef): void {
    if (this.snapshot.channelRef === channelRef && this.snapshot.threadRef === undefined) return
    const { threadRef: _threadRef, ...base } = this.snapshot
    this.snapshot = { ...base, channelRef, activeTab: 'channels' }
    this.commit()
  }

  private setThread(threadRef: AgentTeamThreadRef | undefined): void {
    if (this.snapshot.threadRef === threadRef) return
    if (threadRef === undefined) {
      const { threadRef: _threadRef, ...base } = this.snapshot
      this.snapshot = base
    } else {
      this.snapshot = { ...this.snapshot, threadRef }
    }
    this.commit()
  }

  private setTab(activeTab: TeamWorkspaceTab): void {
    if (this.snapshot.activeTab === activeTab) return
    this.snapshot = { ...this.snapshot, activeTab }
    this.commit()
  }

  private commit(): void {
    persistSnapshot(this.snapshot)
    for (const listener of this.listeners) listener()
  }

}

export { STORAGE_KEY }
