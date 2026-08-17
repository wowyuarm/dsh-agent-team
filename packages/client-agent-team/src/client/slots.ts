import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  AgentTeamAddMemberRequest,
  AgentTeamChannelRef,
  AgentTeamChangesRequest,
  AgentTeamChangesResult,
  AgentTeamAgentMemberStatus,
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
  AgentTeamClaimRequest,
  AgentTeamClaimResult,
  AgentTeamTaskRequest,
  AgentTeamTaskResult,
  AgentTeamSendMessageRequest,
  AgentTeamSendMessageResult,
  AgentTeamView,
  AgentTeamViewRequest,
} from '@deepseek-ai/dsh-agent-team/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { TeamNavigationActions, TeamNavigationSnapshot } from './navigation.ts'

export interface TeamNavigationSource {
  getSnapshot: () => TeamNavigationSnapshot
  subscribe: (listener: () => void) => () => void
}

export type TeamSidebarProps = PropsRuntime<'sidebar.workspaces'>
  & PropsLocale<'team'>
  & TeamNavigationActions
  & {
    navigation: TeamNavigationSource
    pickWorkspaceDirectory: () => Promise<string | null>
    loadMembers: (request: AgentTeamMembersRequest) => Promise<RemoteResult<readonly AgentTeamAgentMemberStatus[]>>
    addMember: (request: AgentTeamAddMemberRequest) => Promise<RemoteResult<AgentTeamMemberResult>>
    loadChannels: (request: AgentTeamViewRequest) => Promise<RemoteResult<AgentTeamView>>
    createChannel: (request: AgentTeamCreateChannelRequest) => Promise<RemoteResult<AgentTeamCreateChannelResult>>
    joinChannel: (request: AgentTeamJoinChannelRequest) => Promise<RemoteResult<AgentTeamJoinChannelResult>>
    removeChannelMember: (request: AgentTeamRemoveChannelMemberRequest) => Promise<RemoteResult<AgentTeamRemoveChannelMemberResult>>
    selectedChannelRef?: AgentTeamChannelRef
    selectChannel: (channelRef: AgentTeamChannelRef) => void
  }

export type TeamConversationProps = PropsRuntime<'conversation'> & PropsLocale<'team'> & TeamNavigationActions & {
  navigation: TeamNavigationSource
  loadChannels: (request: AgentTeamViewRequest) => Promise<RemoteResult<AgentTeamView>>
  loadChanges: (request: AgentTeamChangesRequest) => Promise<RemoteResult<AgentTeamChangesResult>>
  sendMessage: (request: AgentTeamSendMessageRequest) => Promise<RemoteResult<AgentTeamSendMessageResult>>
  joinChannel: (request: AgentTeamJoinChannelRequest) => Promise<RemoteResult<AgentTeamJoinChannelResult>>
  removeChannelMember: (request: AgentTeamRemoveChannelMemberRequest) => Promise<RemoteResult<AgentTeamRemoveChannelMemberResult>>
  reply: (request: AgentTeamReplyRequest) => Promise<RemoteResult<AgentTeamReplyResult | AgentTeamConfirmationRequired>>
  changeClaim: (request: AgentTeamClaimRequest) => Promise<RemoteResult<AgentTeamClaimResult>>
  changeTask: (request: AgentTeamTaskRequest) => Promise<RemoteResult<AgentTeamTaskResult>>
  loadMembers: (request: AgentTeamMembersRequest) => Promise<RemoteResult<readonly AgentTeamAgentMemberStatus[]>>
}

export type TeamSettingsProps = PropsRuntime<'sidebar.settings'> & PropsLocale<'team'> & {
  navigation: TeamNavigationSource
}

export interface TeamMemberGroup {
  readonly workspaceId: string
  readonly workspaceTitle: string
  readonly members: readonly AgentTeamAgentMemberStatus[]
}

export type TeamFooterProps = PropsRuntime<'sidebar.footer.action'> & PropsLocale<'team'> & TeamNavigationActions & {
  navigation: TeamNavigationSource
  loadMemberGroups: () => Promise<readonly TeamMemberGroup[]>
}
