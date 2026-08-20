import { useSyncExternalStore } from 'react'
import type { TeamConversationProps } from './slots.ts'
import { TeamChannelPage } from './TeamChannelPage.tsx'
import { TeamInboxPanel } from './TeamInboxPanel.tsx'
import { TeamThreadPage } from './TeamThreadPage.tsx'
import css from './conversation.module.css'

export function TeamConversation({ t, useWorkspaces, navigation, loadChannels, loadInbox, readThread, loadThreadHistory, loadThreadObservations, changeAttention, loadChanges, loadMembers, sendMessage, joinChannel, removeChannelMember, reply, changeTask, selectThread, backToWorkspace }: TeamConversationProps) {
  const navigationState = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot, navigation.getSnapshot)
  const workspaces = useWorkspaces(state => state.items)
  const current = workspaces.find(workspace => workspace.workspaceId === navigationState.workspaceId)
  if (current !== undefined && navigationState.taskRef !== undefined && navigationState.threadRef !== undefined) {
    return <TeamThreadPage key={navigationState.threadRef} workspaceId={current.workspaceId} taskRef={navigationState.taskRef} threadRef={navigationState.threadRef} originTab={navigationState.activeTab} backToWorkspace={backToWorkspace} {...(navigationState.channelRef === undefined ? {} : { channelRef: navigationState.channelRef })} {...(navigationState.taskNumber === undefined ? {} : { taskNumber: navigationState.taskNumber })} readThread={readThread} loadChannels={loadChannels} loadThreadHistory={loadThreadHistory} loadThreadObservations={loadThreadObservations} changeAttention={changeAttention} loadChanges={loadChanges} loadMembers={loadMembers} reply={reply} changeTask={changeTask} t={t} />
  }
  if (current !== undefined && navigationState.activeTab === 'inbox') {
    return <TeamInboxPanel workspaceId={current.workspaceId} loadInbox={loadInbox} loadChannels={loadChannels} loadChanges={loadChanges} selectThread={selectThread} t={t} />
  }
  if (current !== undefined && navigationState.channelRef !== undefined) {
    return <TeamChannelPage key={navigationState.channelRef} workspaceId={current.workspaceId} channelRef={navigationState.channelRef} loadChannels={loadChannels} loadChanges={loadChanges} loadMembers={loadMembers} sendMessage={sendMessage} joinChannel={joinChannel} removeChannelMember={removeChannelMember} selectThread={selectThread} t={t} />
  }
  const welcome = current === undefined
    ? { eyebrow: t('teamMode'), title: t('team'), body: t('empty') }
    : navigationState.activeTab === 'agents'
      ? { eyebrow: current.title, title: t('agents'), body: t('selectAgent') }
      : navigationState.activeTab === 'channels'
        ? { eyebrow: current.title, title: t('channels'), body: `${t('selectWorkspace')} · ${current.title}` }
        : { eyebrow: current.title, title: t('inbox'), body: t('inboxEmpty') }
  return <main className={css.welcomeSurface} data-team-conversation>
    <div className={css.welcome}>
      <span className={css.welcomeEyebrow}>{welcome.eyebrow}</span>
      <h1>{welcome.title}</h1>
      <p>{welcome.body}</p>
    </div>
  </main>
}
