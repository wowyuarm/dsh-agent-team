import type { WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
import type { AgentTeamChannelRef, AgentTeamTaskRef, AgentTeamThreadRef } from '@wowyuarm/dsh-agent-team/types'

export type TeamMode = 'conversation' | 'team'

export interface TeamNavigationSnapshot {
  mode: TeamMode
  workspaceId?: WorkspaceId
  channelRef?: AgentTeamChannelRef
  taskRef?: AgentTeamTaskRef
  threadRef?: AgentTeamThreadRef
  taskNumber?: number
}

const STORAGE_KEY = 'dsh.agent-team.navigation'

function readSnapshot(): TeamNavigationSnapshot {
  if (typeof localStorage === 'undefined') return { mode: 'conversation' }
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '') as Partial<TeamNavigationSnapshot>
    return {
      mode: parsed.mode === 'team' ? 'team' : 'conversation',
      ...(typeof parsed.workspaceId === 'string' ? { workspaceId: parsed.workspaceId as WorkspaceId } : {}),
    }
  } catch {
    return { mode: 'conversation' }
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
  selectChannel: (channelRef: AgentTeamChannelRef) => void
  selectThread: (taskRef: AgentTeamTaskRef, threadRef: AgentTeamThreadRef, channelRef?: AgentTeamChannelRef, taskNumber?: number) => void
  backToWorkspace: () => void
  /** Leave the selected Channel for the workspace Channel list; keeps mode and Workspace. */
  backToChannels: () => void
}

/** Root-scoped Team mode state. Slot lifetimes subscribe to this source. */
export class TeamNavigation {
  private snapshot = readSnapshot()
  private readonly listeners = new Set<() => void>()

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
      selectChannel: channelRef => { this.setChannel(channelRef) },
      selectThread: (taskRef, threadRef, channelRef, taskNumber) => { this.setThread(taskRef, threadRef, channelRef, taskNumber) },
      backToWorkspace: () => { this.setThread(undefined) },
      backToChannels: () => { this.clearChannel() },
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
    const { channelRef: _channelRef, taskRef: _taskRef, threadRef: _threadRef, taskNumber: _taskNumber, ...base } = this.snapshot
    this.snapshot = { ...base, workspaceId }
    this.commit()
  }

  private setChannel(channelRef: AgentTeamChannelRef): void {
    if (this.snapshot.channelRef === channelRef && this.snapshot.threadRef === undefined) return
    const { taskRef: _taskRef, threadRef: _threadRef, taskNumber: _taskNumber, ...base } = this.snapshot
    this.snapshot = { ...base, channelRef }
    this.commit()
  }

  private clearChannel(): void {
    const { channelRef: _channelRef, ...base } = this.snapshot
    if (this.snapshot.channelRef === undefined) return
    this.snapshot = base
    this.commit()
  }

  private setThread(taskRef: AgentTeamTaskRef | undefined, threadRef?: AgentTeamThreadRef, channelRef?: AgentTeamChannelRef, taskNumber?: number): void {
    if (this.snapshot.threadRef === threadRef && this.snapshot.taskRef === taskRef && this.snapshot.channelRef === channelRef && this.snapshot.taskNumber === taskNumber) return
    if (threadRef === undefined || taskRef === undefined) {
      const { taskRef: _taskRef, threadRef: _threadRef, taskNumber: _taskNumber, ...base } = this.snapshot
      this.snapshot = base
    } else {
      const { channelRef: _channelRef, taskRef: _taskRef, threadRef: _threadRef, taskNumber: _taskNumber, ...base } = this.snapshot
      this.snapshot = { ...base, taskRef, threadRef, ...(channelRef === undefined ? {} : { channelRef }), ...(taskNumber === undefined ? {} : { taskNumber }) }
    }
    this.commit()
  }

  private commit(): void {
    persistSnapshot(this.snapshot)
    for (const listener of this.listeners) listener()
  }

}

export { STORAGE_KEY }
