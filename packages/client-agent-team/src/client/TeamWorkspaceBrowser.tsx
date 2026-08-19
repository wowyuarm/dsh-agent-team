import { useEffect, useState, useSyncExternalStore } from 'react'
import { IconAgentPresetOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
import type { AgentTeamAddMemberRequest } from '@deepseek-ai/dsh-agent-team/types'
import type { TeamSidebarProps } from './slots.ts'
import { TeamWorkspaceRow } from './TeamWorkspaceRow.tsx'
import { TeamAgentsPanel } from './TeamAgentsPanel.tsx'
import { TeamChannelsPanel } from './TeamChannelsPanel.tsx'
import css from './sidebar.module.css'

const CHANNELS_PANEL_ID = 'team-sidebar-channels'
const AGENTS_PANEL_ID = 'team-sidebar-agents'

export function TeamWorkspaceBrowser({ wide, navigation, selectWorkspace, selectWorkspaceTab, selectChannel, t, useWorkspaces, loadMembers, addMember, loadChannels, createChannel, joinChannel, removeChannelMember }: TeamSidebarProps) {
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

  const [creatingAgents, setCreatingAgents] = useState<readonly AgentTeamAddMemberRequest[]>([])

  if (!wide) {
    const tabLabel = navigationState.activeTab === 'channels' ? t('channels') : t('agents')
    return (
      <nav className={css.railWorkspace} aria-label={t('workspaceSections')}>
        <Tooltip label={tabLabel} side="right">
          <button type="button" className={css.railButton} data-active aria-label={tabLabel} onClick={() => { selectWorkspaceTab(navigationState.activeTab === 'channels' ? 'agents' : 'channels') }}>
            <IconAgentPresetOutline16 size={18} />
          </button>
        </Tooltip>
      </nav>
    )
  }

  const panelId = navigationState.activeTab === 'channels' ? CHANNELS_PANEL_ID : AGENTS_PANEL_ID
  return (
    <section className={css.workspaceBrowser} aria-label={t('workspaces')}>
      <div className={css.workspaceHeader}>{t('workspaces')}</div>
      <div className={css.workspaceList}>
        {workspaces.map(workspace => (
          <TeamWorkspaceRow
            key={workspace.workspaceId}
            workspaceId={workspace.workspaceId}
            title={workspace.title}
            path={workspace.path}
            selected={workspace.workspaceId === selectedId}
            onSelect={selectWorkspace}
          />
        ))}
        {workspaces.length === 0 && <p className={css.emptyState}>{t('empty')}</p>}
      </div>
      {selectedId !== undefined && (
        <div className={css.workspaceSection}>
          <div className={css.workspaceTabs} role="tablist" aria-label={t('workspaceSections')}>
            <button id="team-tab-channels" type="button" role="tab" aria-selected={navigationState.activeTab === 'channels'} aria-controls={CHANNELS_PANEL_ID} tabIndex={navigationState.activeTab === 'channels' ? 0 : -1} onClick={() => { selectWorkspaceTab('channels') }}>{t('channels')}</button>
            <button id="team-tab-agents" type="button" role="tab" aria-selected={navigationState.activeTab === 'agents'} aria-controls={AGENTS_PANEL_ID} tabIndex={navigationState.activeTab === 'agents' ? 0 : -1} onClick={() => { selectWorkspaceTab('agents') }}>{t('agents')}</button>
          </div>
          <div id={panelId} className={css.panel} role="tabpanel" aria-labelledby={navigationState.activeTab === 'channels' ? 'team-tab-channels' : 'team-tab-agents'}>
            {navigationState.activeTab === 'agents'
              ? <TeamAgentsPanel workspaceId={selectedId} loadMembers={loadMembers} addMember={addMember} onCreatingChange={(request, creating) => {
                  setCreatingAgents(current => creating
                    ? [...current.filter(item => item.requestId !== request.requestId), request]
                    : current.filter(item => item.requestId !== request.requestId))
                }} t={t} />
              : <TeamChannelsPanel key={selectedId} workspaceId={selectedId} loadMembers={loadMembers} loadChannels={loadChannels} createChannel={createChannel} joinChannel={joinChannel} removeChannelMember={removeChannelMember} creatingAgents={creatingAgents.filter(request => request.workspaceId === selectedId)} {...(navigationState.channelRef === undefined ? {} : { selectedChannelRef: navigationState.channelRef })} selectChannel={selectChannel} t={t} />}
          </div>
        </div>
      )}
    </section>
  )
}

export type TeamWorkspaceBrowserProps = TeamSidebarProps
export type TeamWorkspaceId = WorkspaceId
