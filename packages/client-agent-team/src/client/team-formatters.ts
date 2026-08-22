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

/**
 * StateDot variant for a Task status, or undefined when the status is quiet
 * by default (todo = not started, closed = archived): only running, review-
 * pending, and finished tasks earn a visual signal.
 */
export function taskStatusDot(status: AgentTeamTask['status']): 'ongoing' | 'warning' | 'done' | undefined {
  return ({ todo: undefined, in_progress: 'ongoing', in_review: 'warning', done: 'done', closed: undefined } as const)[status]
}

/** One-line title snippet derived from the Task's root Message body. */
export function formatTaskTitle(body: string): string {
  const firstLine = body.split('\n', 1)[0]?.trim() ?? ''
  return firstLine.length > 120 ? `${firstLine.slice(0, 119)}…` : firstLine
}

/** Deterministic avatar hue for one Member identity; stable across sessions and themes. */
export function memberHue(memberId: string): number {
  let hash = 0
  for (let index = 0; index < memberId.length; index += 1) hash = (hash * 31 + memberId.charCodeAt(index)) % 360
  return hash
}

export interface MentionSegment {
  readonly text: string
  readonly mention: boolean
}

/**
 * Split literal text into plain and @handle segments; only handles known to
 * the current Channel become chips, and a word character before '@' (email
 * addresses) never counts. Whitespace lives in the plain segments, so the
 * consumer container's pre-wrap keeps the original layout.
 */
export function splitMentions(text: string, handles: ReadonlySet<string>): MentionSegment[] {
  if (handles.size === 0) return [{ text, mention: false }]
  const segments: MentionSegment[] = []
  const pattern = /(^|[^A-Za-z0-9_])@([A-Za-z0-9_-]+)/g
  let cursor = 0
  for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
    const handle = match[2]!.toLowerCase()
    if (!handles.has(handle)) continue
    const start = match.index + (match[1]?.length ?? 0)
    if (start > cursor) segments.push({ text: text.slice(cursor, start), mention: false })
    segments.push({ text: text.slice(start, match.index + match[0].length), mention: true })
    cursor = match.index + match[0].length
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), mention: false })
  return segments
}

const pad = (value: number): string => String(value).padStart(2, '0')

/**
 * Wall-clock label for one Message instant: time within the current day,
 * month-day time within the year, full date otherwise.
 */
export function formatMessageTime(occurredAt: string, now = new Date()): string {
  const at = new Date(occurredAt)
  if (Number.isNaN(at.getTime())) return ''
  const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`
  const sameDay = at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth() && at.getDate() === now.getDate()
  if (sameDay) return time
  const date = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`
  if (at.getFullYear() === now.getFullYear()) return `${date.slice(5)} ${time}`
  return `${date} ${time}`
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
