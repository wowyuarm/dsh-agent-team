import { useEffect, useState, useSyncExternalStore } from 'react'
import { IconAgentPresetOutline16, IconPlusOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
import type { AgentTeamAddMemberRequest } from '@deepseek-ai/dsh-agent-team/types'
import type { TeamSidebarProps } from './slots.ts'
import { TeamWorkspaceRow } from './TeamWorkspaceRow.tsx'
import { TeamAgentsPanel } from './TeamAgentsPanel.tsx'
import { TeamChannelsPanel } from './TeamChannelsPanel.tsx'
import css from './team.module.css'

export function TeamWorkspaceBrowser({ wide, navigation, selectWorkspace, selectWorkspaceTab, selectChannel, createWorkspaceFromPath, pickWorkspaceDirectory, t, useWorkspaces, loadMembers, addMember, loadChannels, createChannel, joinChannel, removeChannelMember }: TeamSidebarProps) {
  const navigationState = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot, navigation.getSnapshot)
  const workspaces = useWorkspaces(state => state.items)
  const selected = navigationState.workspaceId
  const selectedExists = selected !== undefined && workspaces.some(workspace => workspace.workspaceId === selected)
  const selectedId = selectedExists ? selected : workspaces[0]?.workspaceId

  useEffect(() => {
    if (navigationState.mode === 'team' && selectedId !== selected) {
      if (selectedId === undefined) return
      selectWorkspace(selectedId)
    }
  }, [navigationState.mode, selected, selectedId, selectWorkspace])

  const [flowBusy, setFlowBusy] = useState(false)
  const [flowError, setFlowError] = useState(false)
  const [creatingAgents, setCreatingAgents] = useState<readonly AgentTeamAddMemberRequest[]>([])

  const createWorkspace = (): void => {
    if (flowBusy) return
    setFlowBusy(true)
    setFlowError(false)
    void pickWorkspaceDirectory().then(path => path === null ? undefined : createWorkspaceFromPath(path)).then(workspace => {
      if (workspace !== undefined) selectWorkspace(workspace.workspaceId)
    }).catch(() => { setFlowError(true) }).finally(() => { setFlowBusy(false) })
  }

  if (!wide) {
    return (
      <div className={css.railWorkspace} aria-label={t('workspaces')}>
        <span className={css.railMark}><IconAgentPresetOutline16 size={16} /></span>
      </div>
    )
  }

  return (
    <section className={css.workspaceBrowser} aria-label={t('workspaces')}>
      <div className={css.workspaceHeader}>
        <span>{t('workspaces')}</span>
        <button type="button" className={css.iconButton} disabled={flowBusy} onClick={createWorkspace} aria-label={t('addWorkspace')} title={t('addWorkspace')}>
            <IconPlusOutline16 size={15} />
          </button>
      </div>
      <div className={css.workspaceList}>
        {workspaces.map(workspace => (
          <TeamWorkspaceRow
            key={workspace.workspaceId}
            workspaceId={workspace.workspaceId}
            title={workspace.title}
            path={workspace.path}
            selected={workspace.workspaceId === selectedId}
            onSelect={selectWorkspace}
            t={t}
          />
        ))}
        {workspaces.length === 0 && <p className={css.emptyWorkspace}>{t('empty')}</p>}
      </div>
      {selectedId !== undefined && (
        <div className={css.workspaceSection}>
          <div className={css.workspaceTabs} role="tablist" aria-label={t('workspaceSections')}>
            <button type="button" role="tab" aria-selected={navigationState.activeTab === 'channels'} onClick={() => { selectWorkspaceTab('channels') }}>{t('channels')}</button>
            <button type="button" role="tab" aria-selected={navigationState.activeTab === 'agents'} onClick={() => { selectWorkspaceTab('agents') }}>{t('agents')}</button>
          </div>
          {navigationState.activeTab === 'agents'
            ? <TeamAgentsPanel workspaceId={selectedId} loadMembers={loadMembers} addMember={addMember} onCreatingChange={(request, creating) => {
                setCreatingAgents(current => creating
                  ? [...current.filter(item => item.requestId !== request.requestId), request]
                  : current.filter(item => item.requestId !== request.requestId))
              }} t={t} />
            : <TeamChannelsPanel key={selectedId} workspaceId={selectedId} loadMembers={loadMembers} loadChannels={loadChannels} createChannel={createChannel} joinChannel={joinChannel} removeChannelMember={removeChannelMember} creatingAgents={creatingAgents.filter(request => request.workspaceId === selectedId)} {...(navigationState.channelRef === undefined ? {} : { selectedChannelRef: navigationState.channelRef })} selectChannel={selectChannel} t={t} />}
        </div>
      )}
      {flowError && <p className={css.error} role="alert">{t('workspaceCreateFailed')}</p>}
    </section>
  )
}

export type TeamWorkspaceBrowserProps = TeamSidebarProps
export type TeamWorkspaceId = WorkspaceId
