import { useEffect, useState, useSyncExternalStore } from 'react'
import { IconAgentPresetOutline16, IconChecklistOutline14, IconListPenOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
import type { AgentTeamAddMemberRequest, AgentTeamInbox } from '@deepseek-ai/dsh-agent-team/types'
import type { TeamSidebarProps } from './slots.ts'
import { TeamWorkspaceRow } from './TeamWorkspaceRow.tsx'
import { TeamAgentsPanel } from './TeamAgentsPanel.tsx'
import { TeamChannelsPanel } from './TeamChannelsPanel.tsx'
import css from './sidebar.module.css'

const INBOX_PANEL_ID = 'team-sidebar-inbox'
const CHANNELS_PANEL_ID = 'team-sidebar-channels'
const AGENTS_PANEL_ID = 'team-sidebar-agents'

export function TeamWorkspaceBrowser({ wide, navigation, selectWorkspace, selectWorkspaceTab, selectChannel, selectInbox, t, useWorkspaces, loadMembers, loadInbox, loadChanges, addMember, loadChannels, createChannel, joinChannel, removeChannelMember }: TeamSidebarProps) {
  const navigationState = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot, navigation.getSnapshot)
  const workspaces = useWorkspaces(state => state.items)
  const selected = navigationState.workspaceId
  const selectedExists = selected !== undefined && workspaces.some(workspace => workspace.workspaceId === selected)
  const selectedId = selectedExists ? selected : workspaces[0]?.workspaceId
  const [inbox, setInbox] = useState<AgentTeamInbox>()
  const [inboxError, setInboxError] = useState<string>()
  const [creatingAgents, setCreatingAgents] = useState<readonly AgentTeamAddMemberRequest[]>([])

  useEffect(() => {
    if (navigationState.mode === 'team' && selectedId !== selected) {
      if (selectedId === undefined) return
      selectWorkspace(selectedId)
    }
  }, [navigationState.mode, selected, selectedId, selectWorkspace])

  useEffect(() => {
    if (selectedId === undefined) return
    let active = true
    let version = 0
    const refresh = async () => {
      try {
        const result = await loadInbox({ workspaceId: selectedId })
        if (!active) return
        if (!result.ok) { setInboxError(result.error.message); return }
        setInbox(result.value)
        setInboxError(undefined)
      } catch (cause) {
        if (active) setInboxError(cause instanceof Error ? cause.message : String(cause))
      }
    }
    void refresh()
    void (async () => {
      while (active) {
        try {
          const changed = await loadChanges({ afterVersion: version })
          if (!active) return
          if (!changed.ok) { setInboxError(changed.error.message); return }
          if (changed.value.version > version) { version = changed.value.version; await refresh() }
        } catch (cause) {
          if (active) setInboxError(cause instanceof Error ? cause.message : String(cause))
          return
        }
      }
    })()
    return () => { active = false }
  }, [selectedId, loadInbox, loadChanges])

  const tabs = [
    { id: INBOX_PANEL_ID, tab: 'inbox' as const, label: t('inbox'), icon: <IconChecklistOutline14 size={16} />, count: inbox?.totalUnreadCount ?? 0 },
    { id: CHANNELS_PANEL_ID, tab: 'channels' as const, label: t('channels'), icon: <IconListPenOutline16 size={16} />, count: 0 },
    { id: AGENTS_PANEL_ID, tab: 'agents' as const, label: t('agents'), icon: <IconAgentPresetOutline16 size={16} />, count: 0 },
  ]
  const currentTab = tabs.find(tab => tab.tab === navigationState.activeTab) ?? tabs[0]!

  if (!wide) {
    return <nav className={css.railWorkspace} aria-label={t('workspaceSections')}>
      {tabs.map(tab => <Tooltip key={tab.tab} label={tab.label} side="right">
        <button type="button" className={css.railButton} data-active={currentTab.tab === tab.tab || undefined} aria-label={tab.label} onClick={() => { selectWorkspaceTab(tab.tab) }}>
          {tab.icon}
          {tab.count > 0 && <span className={css.railCount} aria-label={t('inboxUnreadCount', { count: tab.count })}>{tab.count > 99 ? '99+' : tab.count}</span>}
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
          <span>{tab.label}</span>{tab.count > 0 && <small aria-label={t('inboxUnreadCount', { count: tab.count })}>{tab.count > 99 ? '99+' : tab.count}</small>}
        </button>)}
      </div>
      <div id={panelId} className={css.panel} role="tabpanel" aria-labelledby={`team-tab-${currentTab.tab}`}>
        {currentTab.tab === 'inbox' && <div className={css.inboxSummary}>{inboxError !== undefined ? <p className={css.retryError} role="alert">{inboxError}</p> : <p className={css.inboxSummaryText}>{inbox === undefined ? t('loadingInbox') : inbox.totalUnreadCount === 0 ? t('inboxEmpty') : t('inboxUnreadCount', { count: inbox.totalUnreadCount })}</p>}</div>}
        {currentTab.tab === 'agents' && <TeamAgentsPanel workspaceId={selectedId} loadMembers={loadMembers} loadChanges={loadChanges} loadChannels={loadChannels} addMember={addMember} onCreatingChange={(request, creating) => { setCreatingAgents(current => creating ? [...current.filter(item => item.requestId !== request.requestId), request] : current.filter(item => item.requestId !== request.requestId)) }} t={t} />}
        {currentTab.tab === 'channels' && <TeamChannelsPanel key={selectedId} workspaceId={selectedId} loadMembers={loadMembers} loadChannels={loadChannels} createChannel={createChannel} joinChannel={joinChannel} removeChannelMember={removeChannelMember} creatingAgents={creatingAgents.filter(request => request.workspaceId === selectedId)} {...(navigationState.channelRef === undefined ? {} : { selectedChannelRef: navigationState.channelRef })} selectChannel={selectChannel} t={t} />}
      </div>
    </div>}
  </section>
}

export type TeamWorkspaceBrowserProps = TeamSidebarProps
export type TeamWorkspaceId = WorkspaceId
