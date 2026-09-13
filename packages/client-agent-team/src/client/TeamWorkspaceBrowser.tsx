import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { IconAgentPresetOutline16, IconListPenOutline16, IconQueueOutline14, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AgentTeamAddMemberRequest } from '@wowyuarm/dsh-agent-team/types'
import type { TeamSidebarProps } from './slots.ts'
import { TeamWorkspaceRow } from './TeamWorkspaceRow.tsx'
import { TeamSidebarSection } from './TeamSidebarSection.tsx'
import { useSidebarSectionOpen, setSidebarSectionOpen } from './sidebar-sections.ts'
import { TeamAgentsPanel } from './TeamAgentsPanel.tsx'
import { TeamChannelsPanel } from './TeamChannelsPanel.tsx'
import css from './sidebar.module.css'

type SidebarSection = 'channels' | 'agents'

export function TeamWorkspaceBrowser({ wide, expandSidebar, navigation, selectWorkspace, selectChannel, selectInbox, t, useWorkspaces, loadMembers, loadInbox, subscribeChanges, subscribeReads, addMember, loadChannels, createChannel, updateChannel, archiveChannel, updateMember, recoverMember, archiveMember, joinChannel, removeChannelMember, loadModels, openMemberSession }: TeamSidebarProps) {
  const navigationState = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot, navigation.getSnapshot)
  const workspaces = useWorkspaces(state => state.items)
  const selected = navigationState.workspaceId
  const selectedExists = selected !== undefined && workspaces.some(workspace => workspace.workspaceId === selected)
  const selectedId = selectedExists ? selected : workspaces[0]?.workspaceId
  // Exactly one sidebar row carries aria-current='page': the open Channel while
  // one is set, the selected Agent card while a Member Session view is open,
  // otherwise the browsed Workspace's overview. The selected row keeps its
  // quiet folder tint (data-selected) in every case. The mention-Inbox card
  // takes the marker while the Inbox page stands.
  const overviewIsCurrent = navigationState.channelRef === undefined && navigationState.memberSessionId === undefined && navigationState.inbox !== true
  const inboxIsCurrent = navigationState.inbox === true
  const [creatingAgents, setCreatingAgents] = useState<readonly AgentTeamAddMemberRequest[]>([])
  // Rail icons request expansion and name the section to reveal once wide.
  const [pendingSection, setPendingSection] = useState<SidebarSection>()
  const channelsRef = useRef<HTMLDivElement>(null)
  const agentsRef = useRef<HTMLDivElement>(null)
  const workspacesOpen = useSidebarSectionOpen(undefined, 'workspaces')
  // The cross-Workspace mention badge: one scope-less subscription while the
  // Team sidebar stands; every wake re-pulls each Workspace's direct-only
  // total (limit 1 — totals cover every row, never the list).
  const [inboxTotal, setInboxTotal] = useState(0)
  useEffect(() => {
    let disposed = false
    const refresh = async (): Promise<void> => {
      const results = await Promise.all(workspaces.map(workspace => loadInbox({ workspaceId: workspace.workspaceId, directOnly: true, limit: 1 })))
      if (disposed) return
      setInboxTotal(results.reduce((sum, result) => result.ok ? sum + result.value.totalUnreadCount : sum, 0))
    }
    void refresh()
    const unsubscribe = subscribeChanges(undefined, update => {
      if (update.type === 'changed') void refresh()
    })
    // A durable Thread read consumes this reader's mention markers without a
    // changes wake (reads change no shared projection), so the badge also
    // refreshes from every completed read.
    const unsubscribeReads = subscribeReads(() => { void refresh() })
    return () => {
      disposed = true
      unsubscribe()
      unsubscribeReads()
    }
  }, [loadInbox, subscribeChanges, subscribeReads, workspaces])

  useEffect(() => {
    // The Inbox page is global and needs no selected Workspace, so the
    // auto-select must not yank the seat back to a Workspace overview.
    if (navigationState.inbox === true) return
    if (navigationState.mode === 'team' && selectedId !== undefined && selectedId !== selected) {
      selectWorkspace(selectedId)
    }
  }, [navigationState.inbox, navigationState.mode, selected, selectedId, selectWorkspace])

  useEffect(() => {
    if (!wide || pendingSection === undefined) return
    const node = pendingSection === 'agents' ? agentsRef.current : channelsRef.current
    setPendingSection(undefined)
    queueMicrotask(() => { node?.querySelector<HTMLButtonElement>('button')?.focus() })
  }, [wide, pendingSection])

  if (!wide) {
    return <nav className={css.railWorkspace} aria-label={t('workspaceSections')}>
      <Tooltip label={t('mentionsOfMe')} side="right">
        <button type="button" className={css.railButton} aria-label={inboxTotal > 0 ? t('mentionsOfMeWithCount', { count: inboxTotal }) : t('mentionsOfMe')} aria-current={inboxIsCurrent ? 'page' : undefined} onClick={() => { selectInbox(); expandSidebar() }}>
          <IconQueueOutline14 size={16} />
          {inboxTotal > 0 && <span className={css.inboxBadge} aria-hidden="true">{inboxTotal > 99 ? '99+' : inboxTotal}</span>}
        </button>
      </Tooltip>
      <Tooltip label={t('channels')} side="right">
        <button type="button" className={css.railButton} aria-label={t('channels')} onClick={() => { setPendingSection('channels'); expandSidebar() }}>
          <IconListPenOutline16 size={16} />
        </button>
      </Tooltip>
      <Tooltip label={t('agents')} side="right">
        <button type="button" className={css.railButton} aria-label={t('agents')} onClick={() => { setPendingSection('agents'); expandSidebar() }}>
          <IconAgentPresetOutline16 size={16} />
        </button>
      </Tooltip>
    </nav>
  }

  return <section className={css.workspaceBrowser} aria-label={t('workspaces')}>
    <button type="button" className={css.inboxCard} aria-current={inboxIsCurrent ? 'page' : undefined} onClick={selectInbox}>
      <IconQueueOutline14 size={16} />
      <span className={css.inboxCardLabel}>{t('mentionsOfMe')}</span>
      {inboxTotal > 0 && <span className={css.inboxBadge} aria-hidden="true">{inboxTotal > 99 ? '99+' : inboxTotal}</span>}
    </button>
    <TeamSidebarSection title={t('workspaces')} open={workspacesOpen} onToggle={open => { setSidebarSectionOpen(undefined, 'workspaces', open) }}>
      <div className={css.workspaceList}>
        {workspaces.map(workspace => <TeamWorkspaceRow key={workspace.workspaceId} workspaceId={workspace.workspaceId} title={workspace.title} path={workspace.path} selected={workspace.workspaceId === selectedId} current={workspace.workspaceId === selectedId && overviewIsCurrent} onSelect={selectWorkspace} />)}
        {workspaces.length === 0 && <p className={css.emptyState}>{t('empty')}</p>}
      </div>
    </TeamSidebarSection>
    {selectedId !== undefined && <div className={css.workspaceSection}>
      <div ref={channelsRef}>
        <TeamChannelsPanel key={selectedId} workspaceId={selectedId} loadMembers={loadMembers} loadChannels={loadChannels} subscribeChanges={subscribeChanges} createChannel={createChannel} updateChannel={updateChannel} archiveChannel={archiveChannel} joinChannel={joinChannel} removeChannelMember={removeChannelMember} creatingAgents={creatingAgents.filter(request => request.workspaceId === selectedId)} {...(navigationState.memberSessionId !== undefined || navigationState.channelRef === undefined ? {} : { selectedChannelRef: navigationState.channelRef })} selectChannel={selectChannel} t={t} />
      </div>
      <div ref={agentsRef}>
        <TeamAgentsPanel key={selectedId} workspaceId={selectedId} loadMembers={loadMembers} subscribeChanges={subscribeChanges} addMember={addMember} updateMember={updateMember} recoverMember={recoverMember} archiveMember={archiveMember} loadModels={loadModels} {...(navigationState.memberSessionId === undefined ? {} : { memberSessionId: navigationState.memberSessionId })} openMemberSession={openMemberSession} onCreatingChange={(request, creating) => { setCreatingAgents(current => creating ? [...current.filter(item => item.requestId !== request.requestId), request] : current.filter(item => item.requestId !== request.requestId)) }} t={t} />
      </div>
    </div>}
  </section>
}
