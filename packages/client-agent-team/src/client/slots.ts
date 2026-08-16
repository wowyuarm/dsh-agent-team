import type { PropsLocale, PropsRenderSlots, PropsRuntime, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { TeamNavigationActions, TeamNavigationSnapshot } from './navigation.ts'

export interface TeamNavigationSource {
  getSnapshot: () => TeamNavigationSnapshot
  subscribe: (listener: () => void) => () => void
}

export type TeamSidebarProps = PropsRuntime<'sidebar.workspaces'>
  & PropsRenderSlots<'sidebar.workspaces.directoryFlow'>
  & PropsLocale<'team'>
  & TeamNavigationActions
  & { navigation: TeamNavigationSource; useDirectoryFlow: SnapshotSelectorHook<boolean> }

export type TeamConversationProps = PropsRuntime<'conversation'> & PropsLocale<'team'> & {
  navigation: TeamNavigationSource
}

export type TeamSettingsProps = PropsRuntime<'sidebar.settings'> & PropsLocale<'team'> & {
  navigation: TeamNavigationSource
}

export type TeamFooterProps = PropsRuntime<'sidebar.footer.action'> & PropsLocale<'team'> & TeamNavigationActions & {
  navigation: TeamNavigationSource
}
