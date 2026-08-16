import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { AgentTeamAddMemberRequest, AgentTeamMembersRequest } from '@deepseek-ai/dsh-agent-team/types'
import agentTeamRemote from '@deepseek-ai/dsh-agent-team/remote'
import type {} from '@deepseek-ai/dsh-agent-team/remote'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-general/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { TeamNavigation } from './navigation.ts'
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
  'slots', 'workspaces', 'locale', 'remote',
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
  name: 'sidebar.workspaces' | 'conversation' | 'sidebar.settings',
  component: T,
  options: Record<string, unknown> = {},
): void {
  ctx.slots.inject(name, () => {
    let dispose: (() => void) | undefined
    const reconcile = (): void => {
      const active = navigation.getSnapshot().mode === 'team'
      if (active && dispose === undefined) {
        dispose = ctx.slots.register({
          name,
          priority: -100,
          locale: NS,
          ...options,
          inject: () => ({
            navigation,
            ...navigation.actions(),
            ...(name === 'sidebar.workspaces' ? {
              loadMembers: (request: AgentTeamMembersRequest) => ctx.remote.agentTeam.members(request),
              addMember: (request: AgentTeamAddMemberRequest) => ctx.remote.agentTeam.addMember(request),
              hooks: {
                directoryFlow: {
                  getSnapshot: () => ctx.slots.entries('sidebar.workspaces.directoryFlow').length > 0,
                  subscribe: (listener: () => void) => ctx.slots.subscribe('sidebar.workspaces.directoryFlow', listener),
                },
              },
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

export async function apply(ctx: ClientContext): Promise<void> {
  const disposeRemote = await ctx.remote.$mount(agentTeamRemote)
  ctx.effect(() => () => { void disposeRemote() }, 'agent-team: remote')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'agent-team: dictionaries')

  const navigation = new TeamNavigation(ctx)
  const disposeNavigation = ctx.reflect.provide('teamNavigation', navigation)
  ctx.effect(() => () => {
    navigation.dispose()
    void disposeNavigation()
  }, 'agent-team: navigation service')

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'agent-team',
    order: 100,
    locale: NS,
    inject: () => ({
      navigation,
      ...navigation.actions(),
      loadMemberGroups: async () => {
        const workspaces = ctx.workspaces.list.getSnapshot().items
        const groups = await Promise.all(workspaces.map(async workspace => {
          const result = await ctx.remote.agentTeam.members({ workspaceId: workspace.workspaceId })
          if (!result.ok) throw new Error(result.error.message)
          return { workspaceId: workspace.workspaceId, workspaceTitle: workspace.title, members: result.value }
        }))
        return groups.filter(group => group.members.length > 0)
      },
    }),
  }, TeamFooterAction as never))

  registerModeShadow(ctx, navigation, 'sidebar.workspaces', TeamWorkspaceBrowser as never, {
    children: { 'sidebar.workspaces.directoryFlow': { kind: 'single', scope: 'root' } },
  })
  registerModeShadow(ctx, navigation, 'conversation', TeamConversation as never)
  registerModeShadow(ctx, navigation, 'sidebar.settings', TeamSettings as never)
}
