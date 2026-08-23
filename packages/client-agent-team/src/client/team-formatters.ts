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
 * Status indicator variant for a Task status. Active states map to StateDot
 * variants; every status renders a dot so all Task chips share one shape
 * language — todo is a hollow ring (not started), closed a quiet gray dot
 * (archived).
 */
export function taskStatusDot(status: AgentTeamTask['status']): 'ongoing' | 'warning' | 'done' | 'todo' | 'closed' {
  return ({ todo: 'todo', in_progress: 'ongoing', in_review: 'warning', done: 'done', closed: 'closed' } as const)[status]
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
  /** Canonical handle of the mentioned Member; present only on mention segments. */
  readonly name?: string
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Locate one Message's structured mention names inside its literal body. A
 * name matches case-insensitively with an optional leading '@' on Unicode word
 * boundaries, and longer names win at the same position. Mention segments
 * render the canonical `@Handle`; names absent from the body come back
 * unmatched so the consumer can append them as a fallback chip row.
 */
export function splitMentionNames(text: string, names: readonly string[]): { segments: MentionSegment[]; unmatched: readonly string[] } {
  if (names.length === 0) return { segments: [{ text, mention: false }], unmatched: [] }
  const ordered = [...names].sort((left, right) => right.length - left.length)
  // The lookbehind keeps the optional '@' from consuming the separator of an
  // email-like occurrence: the character before the name (or before its '@')
  // must not be a letter, digit, underscore, or another '@'.
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}_@])@?(?:${ordered.map(name => `(${escapeRegExp(name)})`).join('|')})(?=$|[^\\p{L}\\p{N}_])`,
    'giu',
  )
  const segments: MentionSegment[] = []
  const matched = new Set<string>()
  let cursor = 0
  for (const match of text.matchAll(pattern)) {
    const groupIndex = match.findIndex((group, index) => index >= 1 && group !== undefined)
    if (groupIndex < 1) continue
    if (match.index > cursor) segments.push({ text: text.slice(cursor, match.index), mention: false })
    const name = ordered[groupIndex - 1]!
    segments.push({ text: `@${name}`, mention: true, name })
    matched.add(name.toLowerCase())
    cursor = match.index + match[0].length
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), mention: false })
  return { segments, unmatched: names.filter(name => !matched.has(name.toLowerCase())) }
}

/** Canonical chip handles for one Message's structured mention refs. */
export function mentionNamesOf(mentions: readonly AgentTeamMemberId[], handles: ReadonlyMap<AgentTeamMemberId, string>): string[] {
  return mentions.map(memberId => handles.get(memberId)).filter((name): name is string => name !== undefined)
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
