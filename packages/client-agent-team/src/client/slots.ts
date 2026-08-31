import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  AgentTeamAddMemberRequest,
  AgentTeamChannelRef,
  AgentTeamClientMemberStatus,
  AgentTeamClearMemberContextRequest,
  AgentTeamClearMemberContextResult,
  AgentTeamCreateChannelRequest,
  AgentTeamCreateChannelResult,
  AgentTeamJoinChannelRequest,
  AgentTeamJoinChannelResult,
  AgentTeamGetAttachmentRequest,
  AgentTeamGetAttachmentResult,
  AgentTeamPutAttachmentRequest,
  AgentTeamPutAttachmentResult,
  AgentTeamMemberResult,
  AgentTeamRecoverMemberRequest,
  AgentTeamRecoverMemberResult,
  AgentTeamMembersRequest,
  AgentTeamRemoveChannelMemberRequest,
  AgentTeamRemoveChannelMemberResult,
  AgentTeamReplyRequest,
  AgentTeamResolveTaskRefsRequest,
  AgentTeamResolveTaskRefsResult,
  AgentTeamReplyResult,
  AgentTeamConfirmationRequired,
  AgentTeamThreadHistory,
  AgentTeamThreadHistoryRequest,
  AgentTeamThreadReadRequest,
  AgentTeamThreadReadResult,
  AgentTeamPromoteThreadRequest,
  AgentTeamPromoteThreadResult,
  AgentTeamTaskRequest,
  AgentTeamTaskResult,
  AgentTeamSendMessageRequest,
  AgentTeamSendMessageResult,
  AgentTeamUpdateChannelRequest,
  AgentTeamUpdateChannelResult,
  AgentTeamUpdateMemberRequest,
  AgentTeamView,
  AgentTeamViewRequest,
} from '@wowyuarm/dsh-agent-team/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { TeamNavigationActions, TeamNavigationSnapshot } from './navigation.ts'
import type { TeamChangeListener, TeamChangeScope } from './team-changes.ts'
import type { TeamDraftStore } from './drafts.ts'

export interface TeamNavigationSource {
  getSnapshot: () => TeamNavigationSnapshot
  subscribe: (listener: () => void) => () => void
}

/** Subscribe to one projection scope's invalidation stream; disposal aborts the shared poll. */
export type SubscribeTeamChanges = (scope: TeamChangeScope, listener: TeamChangeListener) => () => void

/** One adapter-owned selectable reasoning effort of one model route. */
export interface TeamModelEffortOption {
  readonly id: string
  readonly name: string
}

/** One selectable model row inside one provider group of the Host catalog. */
export interface TeamModelOption {
  readonly id: string
  readonly name: string
  /** Selectable reasoning levels when the adapter exposes them. */
  readonly reasoning?: {
    readonly efforts: readonly TeamModelEffortOption[]
  }
}

/** Provider-grouped slice of the Host model catalog the editors render. */
export interface TeamModelProviderGroup {
  readonly id: string
  readonly name: string
  readonly models: readonly TeamModelOption[]
}

/** Host-scoped catalog load result; per-provider listing failures ride `failures`. */
export interface TeamModelCatalog {
  readonly groups: readonly TeamModelProviderGroup[]
  readonly failures: readonly { readonly id: string; readonly name: string; readonly message: string }[]
}

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
    updateChannel: (request: AgentTeamUpdateChannelRequest) => Promise<RemoteResult<AgentTeamUpdateChannelResult>>
    updateMember: (request: AgentTeamUpdateMemberRequest) => Promise<RemoteResult<AgentTeamMemberResult>>
    recoverMember: (request: AgentTeamRecoverMemberRequest) => Promise<RemoteResult<AgentTeamRecoverMemberResult>>
    clearMemberContext: (request: AgentTeamClearMemberContextRequest) => Promise<RemoteResult<AgentTeamClearMemberContextResult>>
    joinChannel: (request: AgentTeamJoinChannelRequest) => Promise<RemoteResult<AgentTeamJoinChannelResult>>
    removeChannelMember: (request: AgentTeamRemoveChannelMemberRequest) => Promise<RemoteResult<AgentTeamRemoveChannelMemberResult>>
    /** Session-independent Host model catalog (`llm.models`); needs no live Member. */
    loadModels: () => Promise<RemoteResult<TeamModelCatalog>>
    /** Embed the Member's Session conversation in the Team conversation seat. */
    openMemberSession: (sessionId: AgentTeamClientMemberStatus['member']['sessionId']) => void
    selectedChannelRef?: AgentTeamChannelRef
  }

export type TeamConversationProps = PropsRuntime<'conversation'> & PropsLocale<'team'> & TeamNavigationActions & {
  navigation: TeamNavigationSource
  /** Keyed composer draft cache; one store per Client context. */
  drafts: TeamDraftStore
  loadChannels: (request: AgentTeamViewRequest) => Promise<RemoteResult<AgentTeamView>>
  readThread: (request: AgentTeamThreadReadRequest) => Promise<RemoteResult<AgentTeamThreadReadResult>>
  loadThreadHistory: (request: AgentTeamThreadHistoryRequest) => Promise<RemoteResult<AgentTeamThreadHistory>>
  subscribeChanges: SubscribeTeamChanges
  putAttachment: (request: AgentTeamPutAttachmentRequest) => Promise<RemoteResult<AgentTeamPutAttachmentResult>>
  getAttachment: (request: AgentTeamGetAttachmentRequest) => Promise<RemoteResult<AgentTeamGetAttachmentResult>>
  sendMessage: (request: AgentTeamSendMessageRequest) => Promise<RemoteResult<AgentTeamSendMessageResult>>
  joinChannel: (request: AgentTeamJoinChannelRequest) => Promise<RemoteResult<AgentTeamJoinChannelResult>>
  removeChannelMember: (request: AgentTeamRemoveChannelMemberRequest) => Promise<RemoteResult<AgentTeamRemoveChannelMemberResult>>
  reply: (request: AgentTeamReplyRequest) => Promise<RemoteResult<AgentTeamReplyResult | AgentTeamConfirmationRequired>>
  changeTask: (request: AgentTeamTaskRequest) => Promise<RemoteResult<AgentTeamTaskResult>>
  promoteThread: (request: AgentTeamPromoteThreadRequest) => Promise<RemoteResult<AgentTeamPromoteThreadResult>>
  resolveTaskRefs: (request: AgentTeamResolveTaskRefsRequest) => Promise<RemoteResult<AgentTeamResolveTaskRefsResult>>
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
