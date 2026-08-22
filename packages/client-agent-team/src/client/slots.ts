import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  AgentTeamAddMemberRequest,
  AgentTeamChannelRef,
  AgentTeamClientMemberStatus,
  AgentTeamCreateChannelRequest,
  AgentTeamCreateChannelResult,
  AgentTeamJoinChannelRequest,
  AgentTeamJoinChannelResult,
  AgentTeamMemberResult,
  AgentTeamMembersRequest,
  AgentTeamRemoveChannelMemberRequest,
  AgentTeamRemoveChannelMemberResult,
  AgentTeamReplyRequest,
  AgentTeamReplyResult,
  AgentTeamConfirmationRequired,
  AgentTeamThreadHistory,
  AgentTeamThreadHistoryRequest,
  AgentTeamThreadReadRequest,
  AgentTeamThreadReadResult,
  AgentTeamTaskRequest,
  AgentTeamTaskResult,
  AgentTeamSendMessageRequest,
  AgentTeamSendMessageResult,
  AgentTeamView,
  AgentTeamViewRequest,
} from '@wowyuarm/dsh-agent-team/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { TeamNavigationActions, TeamNavigationSnapshot } from './navigation.ts'
import type { TeamChangeListener, TeamChangeScope } from './team-changes.ts'

export interface TeamNavigationSource {
  getSnapshot: () => TeamNavigationSnapshot
  subscribe: (listener: () => void) => () => void
}

/** Subscribe to one projection scope's invalidation stream; disposal aborts the shared poll. */
export type SubscribeTeamChanges = (scope: TeamChangeScope, listener: TeamChangeListener) => () => void

export type TeamSidebarProps = PropsRuntime<'sidebar.workspaces'>
  & PropsLocale<'team'>
  & TeamNavigationActions
  & {
    navigation: TeamNavigationSource
    loadMembers: (request: AgentTeamMembersRequest) => Promise<RemoteResult<readonly AgentTeamClientMemberStatus[]>>
    subscribeChanges: SubscribeTeamChanges
    addMember: (request: AgentTeamAddMemberRequest) => Promise<RemoteResult<AgentTeamMemberResult>>
    loadChannels: (request: AgentTeamViewRequest) => Promise<RemoteResult<AgentTeamView>>
    createChannel: (request: AgentTeamCreateChannelRequest) => Promise<RemoteResult<AgentTeamCreateChannelResult>>
    joinChannel: (request: AgentTeamJoinChannelRequest) => Promise<RemoteResult<AgentTeamJoinChannelResult>>
    removeChannelMember: (request: AgentTeamRemoveChannelMemberRequest) => Promise<RemoteResult<AgentTeamRemoveChannelMemberResult>>
    selectedChannelRef?: AgentTeamChannelRef
  }

export type TeamConversationProps = PropsRuntime<'conversation'> & PropsLocale<'team'> & TeamNavigationActions & {
  navigation: TeamNavigationSource
  loadChannels: (request: AgentTeamViewRequest) => Promise<RemoteResult<AgentTeamView>>
  readThread: (request: AgentTeamThreadReadRequest) => Promise<RemoteResult<AgentTeamThreadReadResult>>
  loadThreadHistory: (request: AgentTeamThreadHistoryRequest) => Promise<RemoteResult<AgentTeamThreadHistory>>
  subscribeChanges: SubscribeTeamChanges
  sendMessage: (request: AgentTeamSendMessageRequest) => Promise<RemoteResult<AgentTeamSendMessageResult>>
  joinChannel: (request: AgentTeamJoinChannelRequest) => Promise<RemoteResult<AgentTeamJoinChannelResult>>
  removeChannelMember: (request: AgentTeamRemoveChannelMemberRequest) => Promise<RemoteResult<AgentTeamRemoveChannelMemberResult>>
  reply: (request: AgentTeamReplyRequest) => Promise<RemoteResult<AgentTeamReplyResult | AgentTeamConfirmationRequired>>
  changeTask: (request: AgentTeamTaskRequest) => Promise<RemoteResult<AgentTeamTaskResult>>
  loadMembers: (request: AgentTeamMembersRequest) => Promise<RemoteResult<readonly AgentTeamClientMemberStatus[]>>
}

export type TeamSettingsProps = PropsRuntime<'sidebar.settings'> & PropsLocale<'team'> & {
  loadMemberGroups: () => Promise<readonly TeamMemberGroup[]>
}

export interface TeamMemberGroup {
  readonly workspaceId: string
  readonly workspaceTitle: string
  readonly members: readonly AgentTeamClientMemberStatus[]
}

export type TeamFooterProps = PropsRuntime<'sidebar.footer.action'> & PropsLocale<'team'> & TeamNavigationActions & {
  navigation: TeamNavigationSource
  loadMemberGroups: () => Promise<readonly TeamMemberGroup[]>
}
