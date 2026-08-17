import { useSyncExternalStore } from 'react'
import type { TeamConversationProps } from './slots.ts'
import { TeamChannelPage } from './TeamChannelPage.tsx'
import { TeamThreadPage } from './TeamThreadPage.tsx'
import css from './team.module.css'

export function TeamConversation({ t, useWorkspaces, navigation, loadChannels, loadChanges, loadMembers, sendMessage, joinChannel, removeChannelMember, reply, changeClaim, changeTask, selectThread, backToChannel }: TeamConversationProps) {
  const navigationState = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot, navigation.getSnapshot)
  const workspaces = useWorkspaces(state => state.items)
  const current = workspaces.find(workspace => workspace.workspaceId === navigationState.workspaceId)
  if (current !== undefined && navigationState.channelRef !== undefined && navigationState.threadRef !== undefined) {
    return <TeamThreadPage key={navigationState.threadRef} workspaceId={current.workspaceId} channelRef={navigationState.channelRef} threadRef={navigationState.threadRef} backToChannel={backToChannel} loadChannels={loadChannels} loadChanges={loadChanges} loadMembers={loadMembers} reply={reply} changeClaim={changeClaim} changeTask={changeTask} t={t} />
  }
  if (current !== undefined && navigationState.channelRef !== undefined) {
    return <TeamChannelPage key={navigationState.channelRef} workspaceId={current.workspaceId} channelRef={navigationState.channelRef} loadChannels={loadChannels} loadChanges={loadChanges} loadMembers={loadMembers} sendMessage={sendMessage} joinChannel={joinChannel} removeChannelMember={removeChannelMember} selectThread={selectThread} t={t} />
  }
  return <main className={css.teamConversation} data-team-conversation>
    <div className={css.welcome}>
      <span className={css.welcomeEyebrow}>{t('teamMode')}</span>
      <h1>{t('team')}</h1>
      <p>{current === undefined ? t('empty') : `${t('selectWorkspace')} · ${current.title}`}</p>
    </div>
  </main>
}
