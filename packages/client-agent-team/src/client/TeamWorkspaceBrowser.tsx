import { useEffect, useState, useSyncExternalStore } from 'react'
import { IconAgentPresetOutline16, IconListPenOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
import type { AgentTeamAddMemberRequest } from '@wowyuarm/dsh-agent-team/types'
import type { TeamSidebarProps } from './slots.ts'
import { TeamWorkspaceRow } from './TeamWorkspaceRow.tsx'
import { TeamAgentsPanel } from './TeamAgentsPanel.tsx'
import { TeamChannelsPanel } from './TeamChannelsPanel.tsx'
import css from './sidebar.module.css'

const CHANNELS_PANEL_ID = 'team-sidebar-channels'
const AGENTS_PANEL_ID = 'team-sidebar-agents'

export function TeamWorkspaceBrowser({ wide, navigation, selectWorkspace, selectWorkspaceTab, selectChannel, t, useWorkspaces, loadMembers, subscribeChanges, addMember, loadChannels, createChannel, joinChannel, removeChannelMember }: TeamSidebarProps) {
  const navigationState = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot, navigation.getSnapshot)
  const workspaces = useWorkspaces(state => state.items)
  const selected = navigationState.workspaceId
  const selectedExists = selected !== undefined && workspaces.some(workspace => workspace.workspaceId === selected)
  const selectedId = selectedExists ? selected : workspaces[0]?.workspaceId
  const [creatingAgents, setCreatingAgents] = useState<readonly AgentTeamAddMemberRequest[]>([])

  useEffect(() => {
    if (navigationState.mode === 'team' && selectedId !== selected) {
      if (selectedId === undefined) return
      selectWorkspace(selectedId)
    }
  }, [navigationState.mode, selected, selectedId, selectWorkspace])

  const tabs = [
    { id: CHANNELS_PANEL_ID, tab: 'channels' as const, label: t('channels'), icon: <IconListPenOutline16 size={16} /> },
    { id: AGENTS_PANEL_ID, tab: 'agents' as const, label: t('agents'), icon: <IconAgentPresetOutline16 size={16} /> },
  ]
  const currentTab = tabs.find(tab => tab.tab === navigationState.activeTab) ?? tabs[0]!

  if (!wide) {
    return <nav className={css.railWorkspace} aria-label={t('workspaceSections')}>
      {tabs.map(tab => <Tooltip key={tab.tab} label={tab.label} side="right">
        <button type="button" className={css.railButton} data-active={currentTab.tab === tab.tab || undefined} aria-label={tab.label} onClick={() => { selectWorkspaceTab(tab.tab) }}>
          {tab.icon}
        </button>
      </Tooltip>)}
    </nav>
  }

  const panelId = currentTab.id
  return <section className={css.workspaceBrowser} aria-label={t('workspaces')}>
    <div className={css.workspaceHeader}>{t('workspaces')}</div>
    <div className={css.workspaceList}>
      {workspaces.map(workspace => <TeamWorkspaceRow key={workspace.workspaceId} workspaceId={workspace.workspaceId} title={workspace.title} path={workspace.path} selected={workspace.workspaceId === selectedId} onSelect={selectWorkspace} />)}
      {workspaces.length === 0 && <p className={css.emptyState}>{t('empty')}</p>}
    </div>
    {selectedId !== undefined && <div className={css.workspaceSection}>
      <div className={css.workspaceTabs} role="tablist" aria-label={t('workspaceSections')}>
        {tabs.map(tab => <button key={tab.tab} id={`team-tab-${tab.tab}`} type="button" role="tab" aria-selected={navigationState.activeTab === tab.tab} aria-controls={tab.id} tabIndex={navigationState.activeTab === tab.tab ? 0 : -1} onClick={() => { selectWorkspaceTab(tab.tab) }}>
          <span>{tab.label}</span>
        </button>)}
      </div>
      <div id={panelId} className={css.panel} role="tabpanel" aria-labelledby={`team-tab-${currentTab.tab}`}>
        {currentTab.tab === 'agents' && <TeamAgentsPanel workspaceId={selectedId} loadMembers={loadMembers} subscribeChanges={subscribeChanges} loadChannels={loadChannels} addMember={addMember} onCreatingChange={(request, creating) => { setCreatingAgents(current => creating ? [...current.filter(item => item.requestId !== request.requestId), request] : current.filter(item => item.requestId !== request.requestId)) }} t={t} />}
        {currentTab.tab === 'channels' && <TeamChannelsPanel key={selectedId} workspaceId={selectedId} loadMembers={loadMembers} loadChannels={loadChannels} createChannel={createChannel} joinChannel={joinChannel} removeChannelMember={removeChannelMember} creatingAgents={creatingAgents.filter(request => request.workspaceId === selectedId)} {...(navigationState.channelRef === undefined ? {} : { selectedChannelRef: navigationState.channelRef })} selectChannel={selectChannel} t={t} />}
      </div>
    </div>}
  </section>
}

export type TeamWorkspaceBrowserProps = TeamSidebarProps
export type TeamWorkspaceId = WorkspaceId
