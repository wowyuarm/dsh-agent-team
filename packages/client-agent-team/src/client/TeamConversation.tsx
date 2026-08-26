import { useSyncExternalStore } from 'react'
import type { TeamConversationProps } from './slots.ts'
import { TeamChannelPage } from './TeamChannelPage.tsx'
import { TeamThreadPage } from './TeamThreadPage.tsx'
import css from './conversation.module.css'

export function TeamConversation({ t, useWorkspaces, navigation, drafts, putAttachment, getAttachment, loadChannels, readThread, loadThreadHistory, subscribeChanges, loadMembers, sendMessage, joinChannel, removeChannelMember, reply, changeTask, selectThread, selectChannel, backToWorkspace, backToChannels }: TeamConversationProps) {
  const navigationState = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot, navigation.getSnapshot)
  const workspaces = useWorkspaces(state => state.items)
  const current = workspaces.find(workspace => workspace.workspaceId === navigationState.workspaceId)
  if (current !== undefined && navigationState.taskRef !== undefined && navigationState.threadRef !== undefined) {
    return <TeamThreadPage key={navigationState.threadRef} workspaceId={current.workspaceId} taskRef={navigationState.taskRef} threadRef={navigationState.threadRef} backToWorkspace={backToWorkspace} selectChannel={selectChannel} {...(navigationState.channelRef === undefined ? {} : { channelRef: navigationState.channelRef })} {...(navigationState.taskNumber === undefined ? {} : { taskNumber: navigationState.taskNumber })} drafts={drafts} getAttachment={getAttachment} readThread={readThread} loadChannels={loadChannels} loadThreadHistory={loadThreadHistory} subscribeChanges={subscribeChanges} loadMembers={loadMembers} reply={reply} changeTask={changeTask} t={t} />
  }
  if (current !== undefined && navigationState.channelRef !== undefined) {
    return <TeamChannelPage key={navigationState.channelRef} workspaceId={current.workspaceId} channelRef={navigationState.channelRef} drafts={drafts} putAttachment={putAttachment} getAttachment={getAttachment} loadChannels={loadChannels} subscribeChanges={subscribeChanges} loadMembers={loadMembers} sendMessage={sendMessage} joinChannel={joinChannel} removeChannelMember={removeChannelMember} selectThread={selectThread} selectChannel={selectChannel} backToChannels={backToChannels} t={t} />
  }
  const welcome = current === undefined
    ? { eyebrow: t('teamMode'), title: t('team'), body: t('empty') }
    : { eyebrow: current.title, title: t('channels'), body: t('selectChannelHint') }
  return <main className={css.welcomeSurface} data-team-conversation>
    <div className={css.welcome}>
      <span className={css.welcomeEyebrow}>{welcome.eyebrow}</span>
      <h1>{welcome.title}</h1>
      <p>{welcome.body}</p>
    </div>
  </main>
}
