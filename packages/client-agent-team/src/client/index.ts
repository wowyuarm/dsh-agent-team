import type { ClientContext, ISessions } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import type {
  AgentTeamAddMemberRequest,
  AgentTeamClientMemberStatus,
  AgentTeamSendMessageRequest,
  AgentTeamThreadHistoryRequest,
  AgentTeamThreadReadRequest,
  AgentTeamCreateChannelRequest,
  AgentTeamJoinChannelRequest,
  AgentTeamMembersRequest,
  AgentTeamRecoverMemberRequest,
  AgentTeamRemoveChannelMemberRequest,
  AgentTeamReplyRequest,
  AgentTeamTaskRequest,
  AgentTeamUpdateChannelRequest,
  AgentTeamUpdateMemberRequest,
  AgentTeamViewRequest,
} from '@wowyuarm/dsh-agent-team/types'
import agentTeamRemote from '../../../agent-team/lib/typert.remote-client.js'
import type {} from '../../../agent-team/lib/typert.remote-client.d.ts'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-general/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { TeamNavigation } from './navigation.ts'
import { TeamChangeStream, type TeamChangeListener, type TeamChangeScope } from './team-changes.ts'
import { TeamDraftStore } from './drafts.ts'
import { TeamFooterAction } from './TeamFooterAction.tsx'
import { TeamSettings } from './TeamSettings.tsx'
import { TeamConversation } from './TeamConversation.tsx'
import { TeamWorkspaceBrowser } from './TeamWorkspaceBrowser.tsx'
import { en, zh, type TeamKey } from './locales.ts'

export type { TeamMode, TeamNavigationActions, TeamNavigationSnapshot } from './navigation.ts'
export type { TeamKey } from './locales.ts'
export { TeamNavigation } from './navigation.ts'

const NS = 'team'

export const inject = [
  'slots', 'workspaces', 'locale', 'remote', 'sessions', 'connection',
]

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    team: TeamKey
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    teamNavigation: TeamNavigation
    teamDrafts: TeamDraftStore
  }
}

function registerModeShadow<T extends object>(
  ctx: ClientContext,
  navigation: TeamNavigation,
  changes: TeamChangeStream,
  drafts: TeamDraftStore,
  name: 'sidebar.workspaces' | 'conversation' | 'sidebar.settings',
  component: T,
  extraInject?: () => Record<string, unknown>,
): void {
  // Remote bindings shared by every Team slot; surface-specific entries extend it below.
  const sharedRemotes = {
    loadChannels: (request: AgentTeamViewRequest) => ctx.remote.agentTeam.view(request),
    subscribeChanges: (scope: TeamChangeScope, listener: TeamChangeListener) => changes.subscribe(scope, listener),
    drafts,
    loadMembers: (request: AgentTeamMembersRequest) => ctx.remote.agentTeam.members(request),
    joinChannel: (request: AgentTeamJoinChannelRequest) => ctx.remote.agentTeam.joinChannel(request),
    removeChannelMember: (request: AgentTeamRemoveChannelMemberRequest) => ctx.remote.agentTeam.removeChannelMember(request),
    updateChannel: (request: AgentTeamUpdateChannelRequest) => ctx.remote.agentTeam.updateChannel(request),
    updateMember: (request: AgentTeamUpdateMemberRequest) => ctx.remote.agentTeam.updateMember(request),
    recoverMember: (request: AgentTeamRecoverMemberRequest) => ctx.remote.agentTeam.recoverMember(request),
    // The Host-scoped catalog needs no live Member, so suspended ones stay editable too.
    loadModels: async () => {
      const connection = ctx.get('connection') as ConnectionHandle
      const response = await connection.api.llm.models({})
      return response.result
    },
    openMemberSession: (sessionId: AgentTeamClientMemberStatus['member']['sessionId']) => {
      // Stay in Team mode: the conversation shadow stands down for Member
      // Session views (see registerModeShadow), so the shipped conversation
      // root renders the selected Member Session inside the Team shell.
      const sessions = ctx.sessions as unknown as ISessions
      const snapshot = navigation.getSnapshot()
      const current = sessions.list.getSnapshot().current
      // The return target is captured on first entry only — switching between
      // Member Sessions must keep pointing at the Human's original session.
      const returnTo = snapshot.memberSessionId === undefined && current !== undefined && current !== sessionId ? current : undefined
      navigation.actions().enterMemberSession(sessionId, returnTo)
      sessions.open(sessionId)
    },
  }
  ctx.slots.inject(name, () => {
    let dispose: (() => void) | undefined
    const reconcile = (): void => {
      const snapshot = navigation.getSnapshot()
      // The conversation seat yields to the shipped conversation root while a
      // Member Session view is embedded; both sidebar seats stay shadowed so
      // the Team chrome keeps working around the Member conversation.
      const active = snapshot.mode === 'team' && !(name === 'conversation' && snapshot.memberSessionId !== undefined)
      if (active && dispose === undefined) {
        dispose = ctx.slots.register({
          name,
          priority: -100,
          locale: NS,
          inject: () => ({
            navigation,
            ...extraInject?.(),
            ...navigation.actions(),
            ...sharedRemotes,
            ...(name === 'conversation' ? {
              readThread: (request: AgentTeamThreadReadRequest) => ctx.remote.agentTeam.readThread(request),
              loadThreadHistory: (request: AgentTeamThreadHistoryRequest) => ctx.remote.agentTeam.threadHistory(request),
              sendMessage: (request: AgentTeamSendMessageRequest) => ctx.remote.agentTeam.sendMessage(request),
              reply: (request: AgentTeamReplyRequest) => ctx.remote.agentTeam.reply(request),
              changeTask: (request: AgentTeamTaskRequest) => ctx.remote.agentTeam.changeTask(request),
            } : {}),
            ...(name === 'sidebar.workspaces' ? {
              addMember: (request: AgentTeamAddMemberRequest) => ctx.remote.agentTeam.addMember(request),
              createChannel: (request: AgentTeamCreateChannelRequest) => ctx.remote.agentTeam.createChannel(request),
            } : {}),
          }),
        } as never, component as never)
      } else if (!active && dispose !== undefined) {
        dispose()
        dispose = undefined
      }
    }
    const unsubscribe = navigation.subscribe(reconcile)
    reconcile()
    return () => {
      unsubscribe()
      dispose?.()
      dispose = undefined
    }
  })
}

function applyUi(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'agent-team: dictionaries')

  const navigation = new TeamNavigation()
  const disposeNavigation = ctx.reflect.provide('teamNavigation', navigation)
  const drafts = new TeamDraftStore()
  const disposeDrafts = ctx.reflect.provide('teamDrafts', drafts)
  ctx.effect(() => () => {
    navigation.dispose()
    drafts.dispose()
    void disposeNavigation()
    void disposeDrafts()
  }, 'agent-team: navigation service')

  const changes = new TeamChangeStream((request, signal) => ctx.remote.agentTeam.changes(request, signal))

  const loadMemberGroups = async () => {
    const workspaces = ctx.workspaces.list.getSnapshot().items
    const groups = await Promise.all(workspaces.map(async workspace => {
      const result = await ctx.remote.agentTeam.members({ workspaceId: workspace.workspaceId })
      if (!result.ok) throw new Error(result.error.message)
      return { workspaceId: workspace.workspaceId, workspaceTitle: workspace.title, members: result.value }
    }))
    return groups.filter(group => group.members.length > 0)
  }

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'agent-team',
    order: 100,
    locale: NS,
    inject: () => ({
      navigation,
      ...navigation.actions(),
      // The footer is the only surface that leaves Team mode; it also closes
      // an embedded Member Session view, restoring the session the Human came
      // from so the ordinary shell never strands them inside a Member Session.
      leaveTeam: () => {
        const snapshot = navigation.getSnapshot()
        if (snapshot.memberSessionId === undefined) {
          navigation.actions().leaveTeam()
          return
        }
        const returnTo = snapshot.returnToSessionId
        navigation.actions().exitMemberSession()
        if (returnTo !== undefined) (ctx.sessions as unknown as ISessions).open(returnTo)
        navigation.actions().leaveTeam()
      },
      loadMemberGroups,
    }),
  }, TeamFooterAction as never))

  registerModeShadow(ctx, navigation, changes, drafts, 'sidebar.workspaces', TeamWorkspaceBrowser as never)
  registerModeShadow(ctx, navigation, changes, drafts, 'conversation', TeamConversation as never)
  registerModeShadow(ctx, navigation, changes, drafts, 'sidebar.settings', TeamSettings as never, () => ({ loadMemberGroups }))
}

export async function apply(ctx: ClientContext): Promise<void> {
  const disposeRemote = await ctx.remote.$mount(agentTeamRemote)
  ctx.effect(() => () => { void disposeRemote() }, 'agent-team: remote')
  ctx.inject(['remote.agentTeam'], ready => { applyUi(ready as ClientContext) })
}
