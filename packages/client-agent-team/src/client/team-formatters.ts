import type { AgentTeamActivity, AgentTeamClaim, AgentTeamMemberId, AgentTeamTask } from '@wowyuarm/dsh-agent-team/types'
import type { TeamConversationProps } from './slots.ts'

export function formatTaskStatus(status: AgentTeamTask['status'], t: TeamConversationProps['t']): string {
  return t(({
    todo: 'taskStatusTodo',
    in_progress: 'taskStatusInProgress',
    in_review: 'taskStatusInReview',
    done: 'taskStatusDone',
    closed: 'taskStatusClosed',
  } as const)[status])
}

export function formatClaimState(state: AgentTeamClaim['state'], t: TeamConversationProps['t']): string {
  return t(({
    active: 'claimStateActive',
    done: 'claimStateDone',
    released: 'claimStateReleased',
  } as const)[state])
}

export function formatActivity(activity: AgentTeamActivity, options: {
  readonly t: TeamConversationProps['t']
  readonly actorName: (memberId: AgentTeamMemberId) => string
  readonly claims: readonly AgentTeamClaim[]
}): string {
  const actor = options.actorName(activity.actor)
  if (activity.kind === 'accept') return options.t('activityAccepted', { actor })
  if (activity.kind === 'close') return options.t('activityClosed', { actor })
  if (activity.kind === 'reopen') return options.t('activityReopened', { actor })
  const direction = 'claimRef' in activity
    ? options.claims.find(claim => claim.claimRef === activity.claimRef)?.direction ?? options.t('claims')
    : options.t('claims')
  if (activity.kind === 'claim') return options.t('activityClaimed', { actor, direction })
  if (activity.kind === 'done') return options.t('activityClaimDone', { actor, direction })
  if (activity.kind === 'release') return options.t('activityClaimReleased', { actor, direction })
  if (activity.kind === 'claims_released') return options.t('activityClaimsReleased', { actor, count: activity.claimRefs.length })
  throw new Error(`unknown Team Activity kind: ${(activity as { kind: string }).kind}`)
}
