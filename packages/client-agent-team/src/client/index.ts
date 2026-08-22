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
  }
}

function registerModeShadow<T extends object>(
  ctx: ClientContext,
  navigation: TeamNavigation,
  changes: TeamChangeStream,
  name: 'sidebar.workspaces' | 'conversation' | 'sidebar.settings',
  component: T,
  extraInject?: () => Record<string, unknown>,
): void {
  // Remote bindings shared by every Team slot; surface-specific entries extend it below.
  const sharedRemotes = {
    loadChannels: (request: AgentTeamViewRequest) => ctx.remote.agentTeam.view(request),
    subscribeChanges: (scope: TeamChangeScope, listener: TeamChangeListener) => changes.subscribe(scope, listener),
    loadMembers: (request: AgentTeamMembersRequest) => ctx.remote.agentTeam.members(request),
    joinChannel: (request: AgentTeamJoinChannelRequest) => ctx.remote.agentTeam.joinChannel(request),
    removeChannelMember: (request: AgentTeamRemoveChannelMemberRequest) => ctx.remote.agentTeam.removeChannelMember(request),
    updateChannel: (request: AgentTeamUpdateChannelRequest) => ctx.remote.agentTeam.updateChannel(request),
    updateMember: (request: AgentTeamUpdateMemberRequest) => ctx.remote.agentTeam.updateMember(request),
    // The Host-scoped catalog needs no live Member, so suspended ones stay editable too.
    loadModels: async () => {
      const connection = ctx.get('connection') as ConnectionHandle
      const response = await connection.api.llm.models({})
      return response.result
    },
    openMemberSession: (sessionId: AgentTeamClientMemberStatus['member']['sessionId']) => {
      // Leave Team mode first so every Team shadow deregisters and the
      // ordinary shell actually renders the Member Session selected below.
      navigation.actions().leaveTeam()
      // The Host-side dsh-session Context merge shadows the runtime face under
      // this bundle's combined tsconfig; the outward sessions service is ISessions.
      ;(ctx.sessions as unknown as ISessions).open(sessionId)
    },
  }
  ctx.slots.inject(name, () => {
    let dispose: (() => void) | undefined
    const reconcile = (): void => {
      const active = navigation.getSnapshot().mode === 'team'
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
  ctx.effect(() => () => {
    navigation.dispose()
    void disposeNavigation()
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
    inject: () => ({ navigation, ...navigation.actions(), loadMemberGroups }),
  }, TeamFooterAction as never))

  registerModeShadow(ctx, navigation, changes, 'sidebar.workspaces', TeamWorkspaceBrowser as never)
  registerModeShadow(ctx, navigation, changes, 'conversation', TeamConversation as never)
  registerModeShadow(ctx, navigation, changes, 'sidebar.settings', TeamSettings as never, () => ({ loadMemberGroups }))
}

export async function apply(ctx: ClientContext): Promise<void> {
  const disposeRemote = await ctx.remote.$mount(agentTeamRemote)
  ctx.effect(() => () => { void disposeRemote() }, 'agent-team: remote')
  ctx.inject(['remote.agentTeam'], ready => { applyUi(ready as ClientContext) })
}
