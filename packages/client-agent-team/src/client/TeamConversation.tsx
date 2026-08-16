import { useSyncExternalStore } from 'react'
import type { TeamConversationProps } from './slots.ts'
import css from './team.module.css'

export function TeamConversation({ t, useWorkspaces, navigation }: TeamConversationProps) {
  const navigationState = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot, navigation.getSnapshot)
  const workspaces = useWorkspaces(state => state.items)
  const current = workspaces.find(workspace => workspace.workspaceId === navigationState.workspaceId)
  return (
    <main className={css.teamConversation} data-team-conversation>
      <div className={css.welcome}>
        <span className={css.welcomeEyebrow}>{t('teamMode')}</span>
        <h1>{t('team')}</h1>
        <p>{current === undefined ? t('empty') : `${t('selectWorkspace')} · ${current.title}`}</p>
      </div>
    </main>
  )
}
