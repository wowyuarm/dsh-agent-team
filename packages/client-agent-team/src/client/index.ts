import type { ClientContext, ISessions } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import type { InputTriggerServiceContract } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type {
  AgentTeamAddMemberRequest,
  AgentTeamClientMemberStatus,
  AgentTeamSendMessageRequest,
  AgentTeamThreadHistoryRequest,
  AgentTeamThreadReadRequest,
  AgentTeamCreateChannelRequest,
  AgentTeamGetAttachmentRequest,
  AgentTeamJoinChannelRequest,
  AgentTeamMembersRequest,
  AgentTeamPromoteThreadRequest,
  AgentTeamPutAttachmentRequest,
  AgentTeamRecoverMemberRequest,
  AgentTeamClearMemberContextRequest,
  AgentTeamRemoveChannelMemberRequest,
  AgentTeamReplyRequest,
  AgentTeamResolveTaskRefsRequest,
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
import { TeamMemberSessionComposer } from './TeamMemberSessionComposer.tsx'
import { admitTeamCompact, createTeamMemberSessionSources } from './member-session-input.ts'
import { en, zh, type TeamKey } from './locales.ts'

export type { TeamMode, TeamNavigationActions, TeamNavigationSnapshot } from './navigation.ts'
export type { TeamKey } from './locales.ts'
export { TeamNavigation } from './navigation.ts'

const NS = 'team'

export const inject = [
  'slots', 'workspaces', 'locale', 'remote', 'sessions', 'connection', 'conversation', 'inputTriggers',
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
  // Stay in Team mode: the conversation shadow stands down for Member Session
  // views (see registerModeShadow), so the shipped conversation root renders
  // the selected Member Session inside the Team shell.
  const openMemberSessionImpl = (sessionId: AgentTeamClientMemberStatus['member']['sessionId']): void => {
    const sessions = ctx.sessions as unknown as ISessions
    const snapshot = navigation.getSnapshot()
    const current = sessions.list.getSnapshot().current
    // The return target is captured on first entry only — switching between
    // Member Sessions must keep pointing at the Human's original session.
    const returnTo = snapshot.memberSessionId === undefined && current !== undefined && current !== sessionId ? current : undefined
    navigation.actions().enterMemberSession(sessionId, returnTo)
    sessions.open(sessionId)
  }
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
    clearMemberContext: (request: AgentTeamClearMemberContextRequest) => ctx.remote.agentTeam.clearMemberContext(request),
    // The Host-scoped catalog needs no live Member, so suspended ones stay editable too.
    loadModels: async () => {
      const connection = ctx.get('connection') as ConnectionHandle
      const response = await connection.api.llm.models({})
      return response.result
    },
    openMemberSession: openMemberSessionImpl,
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
              putAttachment: (request: AgentTeamPutAttachmentRequest) => ctx.remote.agentTeam.putAttachment(request),
              getAttachment: (request: AgentTeamGetAttachmentRequest) => ctx.remote.agentTeam.getAttachment(request),
              reply: (request: AgentTeamReplyRequest) => ctx.remote.agentTeam.reply(request),
              changeTask: (request: AgentTeamTaskRequest) => ctx.remote.agentTeam.changeTask(request),
              promoteThread: (request: AgentTeamPromoteThreadRequest) => ctx.remote.agentTeam.promoteThread(request),
              resolveTaskRefs: (request: AgentTeamResolveTaskRefsRequest) => ctx.remote.agentTeam.resolveTaskRefs(request),
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

function registerMemberSessionComposer(ctx: ClientContext, navigation: TeamNavigation): void {
  ctx.slots.inject('conversation.composer.bar', () => {
    let dispose: (() => void) | undefined
    let registeredSessionId: AgentTeamClientMemberStatus['member']['sessionId'] | undefined
    const reconcile = (): void => {
      const memberSessionId = navigation.getSnapshot().memberSessionId
      const active = navigation.getSnapshot().mode === 'team' && memberSessionId !== undefined
      if (dispose !== undefined && (!active || registeredSessionId !== memberSessionId)) {
        dispose()
        dispose = undefined
        registeredSessionId = undefined
      }
      if (active && dispose === undefined) {
        registeredSessionId = memberSessionId
        dispose = ctx.slots.register({
          name: 'conversation.composer.bar',
          priority: -100,
          // The registration may remain live during a session transition, but
          // it elects only when the shell's current Session is the embedded
          // Member. This avoids taking an ordinary Session if selection races.
          select: () => (ctx.sessions as unknown as ISessions).list.getSnapshot().current === memberSessionId ? {} : null,
          inject: (sessionId: AgentTeamClientMemberStatus['member']['sessionId']) => {
            const actx = (ctx.sessions as unknown as ISessions).scope(sessionId)
            if (actx === undefined) throw new Error(`agent-team: Member session ${String(sessionId)} has no client scope`)
            const sessions = ctx.sessions as unknown as ISessions
            return {
              controller: (ctx.get('inputTriggers') as InputTriggerServiceContract).sessionOf(actx),
              stop: () => { void sessions.sessionOf(actx)?.cancel() },
              submitInput: (mode: 'queue' | 'steer') => ctx.conversation.input.for(actx).submit(mode),
            }
          },
        } as never, TeamMemberSessionComposer as never)
      }
    }
    const offNavigation = navigation.subscribe(reconcile)
    reconcile()
    return () => {
      offNavigation()
      dispose?.()
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

  const triggerSources = createTeamMemberSessionSources({
    isEmbeddedMemberSession: sessionId => {
      const snapshot = navigation.getSnapshot()
      return snapshot.mode === 'team' && snapshot.memberSessionId === sessionId && snapshot.workspaceId !== undefined
    },
    members: async () => {
      const workspaceId = navigation.getSnapshot().workspaceId
      if (workspaceId === undefined) return []
      const result = await ctx.remote.agentTeam.members({ workspaceId })
      return result.ok ? result.value : []
    },
    executeCompact: async sessionId => {
      const actx = (ctx.sessions as unknown as ISessions).scope(sessionId)
      const session = actx === undefined ? undefined : (ctx.sessions as unknown as ISessions).sessionOf(actx)
      return session === undefined ? { kind: 'error', text: 'current Member Session is unavailable' } : admitTeamCompact(session)
    },
  })
  const inputTriggers = ctx.get('inputTriggers') as InputTriggerServiceContract
  ctx.effect(() => {
    const disposers = triggerSources.map(source => inputTriggers.registerSource(source))
    return () => { for (const dispose of disposers) dispose() }
  }, 'agent-team: Member session trigger sources')

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
  registerMemberSessionComposer(ctx, navigation)
  registerModeShadow(ctx, navigation, changes, drafts, 'sidebar.settings', TeamSettings as never, () => ({ loadMemberGroups }))
}

export async function apply(ctx: ClientContext): Promise<void> {
  const disposeRemote = await ctx.remote.$mount(agentTeamRemote)
  ctx.effect(() => () => { void disposeRemote() }, 'agent-team: remote')
  ctx.inject(['remote.agentTeam'], ready => { applyUi(ready as ClientContext) })
}
