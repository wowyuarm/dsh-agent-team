import type { AgentTeamClientMemberStatus, AgentTeamMemberId } from '@wowyuarm/dsh-agent-team/types'
import type { ISession } from '@deepseek-ai/dsh-api-session-controller/client'
import type {
  ClientSessionContext, CommandClaim, InputTriggerSource, ReferenceInsert, SubmitOutcome,
} from '@deepseek-ai/dsh-client-ui-input-trigger/client'

export const TEAM_COMMAND_SOURCE = 'agent-team-command'
export const TEAM_MEMBER_SOURCE = 'agent-team-member'

export interface TeamMemberSessionInputOptions {
  readonly isEmbeddedMemberSession: (sessionId: ClientSessionContext['sessionId']) => boolean
  readonly members: () => Promise<readonly AgentTeamClientMemberStatus[]>
  readonly executeCompact: (sessionId: ClientSessionContext['sessionId']) => Promise<SubmitOutcome>
}

/** Preserve the public Session command admission contract, not handler outcome. */
export async function admitTeamCompact(session: Pick<ISession, 'command'>): Promise<SubmitOutcome> {
  const result = await session.command('/compact')
  if (!result.ok) throw new Error(`session.command failed: ${result.error.message}`)
  return result.value.matched ? { kind: 'success' } : { kind: 'error', text: 'unknown command: /compact' }
}

/**
 * The two Team-only sources live in the shared public registry, but their
 * candidate plane is inert for every ordinary Session. The member source owns
 * its stable ref→label cache so serialization never falls back to guessing a
 * handle from plain text.
 */
export function createTeamMemberSessionSources(options: TeamMemberSessionInputOptions): readonly InputTriggerSource[] {
  const labels = new Map<AgentTeamMemberId, string>()
  const command: InputTriggerSource = {
    trigger: '/',
    name: TEAM_COMMAND_SOURCE,
    showGroupTitle: false,
    async candidates(session, { query }) {
      if (!options.isEmbeddedMemberSession(session.sessionId) || !'compact'.startsWith(query.toLocaleLowerCase())) return []
      return [{ name: '/compact', description: '压缩当前 Session 上下文', value: 'compact' }]
    },
    onPick({ candidate, session }) {
      if (candidate.value !== 'compact' || !options.isEmbeddedMemberSession(session.sessionId)) return undefined
      const claim: CommandClaim = {
        token: '/compact',
        submit: async () => options.executeCompact(session.sessionId),
      }
      return { claim }
    },
  }
  const member: InputTriggerSource = {
    trigger: '@',
    name: TEAM_MEMBER_SOURCE,
    showGroupTitle: false,
    async candidates(session, { query, signal }) {
      if (!options.isEmbeddedMemberSession(session.sessionId)) return []
      const normalized = query.toLocaleLowerCase()
      const members = await options.members()
      if (signal.aborted) return []
      return members
        .filter(status => status.member.sessionId !== session.sessionId && status.member.state !== 'inactive' && status.member.state !== 'archived')
        .filter(status => status.member.handle.toLocaleLowerCase().startsWith(normalized))
        .map(status => {
          labels.set(status.member.memberId, `@${status.member.handle}`)
          return {
            name: `@${status.member.handle}`,
            description: '引用成员 · 不会通知',
            value: String(status.member.memberId),
          }
        })
    },
    onPick({ candidate, session }) {
      if (!options.isEmbeddedMemberSession(session.sessionId) || candidate.value === undefined) return undefined
      const ref = candidate.value as AgentTeamMemberId
      const label = labels.get(ref)
      if (label === undefined) return undefined
      const insert: ReferenceInsert = {
        source: TEAM_MEMBER_SOURCE,
        // The input machine retains the typed trigger; label must therefore
        // omit `@` or the draft would become `@@handle` after insertion.
        label: label.slice(1),
        ref,
        clipboardText: label,
      }
      return { insert }
    },
    codec: {
      clipboardText: ref => labels.get(ref as AgentTeamMemberId) ?? `@${String(ref)}`,
      serialize: async ref => {
        const stable = String(ref)
        const label = labels.get(ref as AgentTeamMemberId) ?? ''
        return `<team-member ref="${escapeAttribute(stable)}">${escapeText(label)}</team-member>`
      },
    },
  }
  return [command, member]
}

/** Unknown leading slash must never fall into the shipped global palette. */
export function allowsMemberSessionSubmit(draft: string, claimToken: string | undefined): boolean {
  const trimmed = draft.trimStart()
  return !trimmed.startsWith('/') || claimToken === '/compact'
}

function escapeText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function escapeAttribute(value: string): string {
  return escapeText(value).replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}
