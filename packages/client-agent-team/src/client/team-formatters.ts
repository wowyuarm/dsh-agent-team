import type { AgentTeamActivity, AgentTeamClaim, AgentTeamMemberId, AgentTeamTask, AgentTeamTaskRef } from '@wowyuarm/dsh-agent-team/types'
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

/** One branded-ref occurrence inside a literal body segment. */
export interface RefSegment {
  readonly text: string
  /** The full `task:`/`channel:`/`thread:` ref when this segment is a link. */
  readonly ref?: string
}

const BRANDED_REF_PATTERN = /\b(task|channel|thread):{1,2}[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi

/**
 * Canonical form of one matched ref: models occasionally double the colon or
 * uppercase the UUID when citing a ref in prose, while Host lookups and
 * navigation only accept the lowercase single-colon ref the ledger mints.
 */
function canonicalBrandedRef(match: string): string {
  return match.replace('::', ':').toLowerCase()
}

/**
 * Split a literal text run into plain and branded-ref segments. The pattern
 * anchors on the fixed ref prefixes plus the UUID shape, so ordinary prose
 * containing a colon never linkifies; a doubled colon from model output is
 * tolerated. Segment refs are always canonical, so resolution and navigation
 * work regardless of how the ref was spelled; text without any ref comes
 * back as one untouched segment.
 */
export function splitBrandedRefs(text: string): readonly RefSegment[] {
  const segments: RefSegment[] = []
  let cursor = 0
  for (const match of text.matchAll(BRANDED_REF_PATTERN)) {
    const start = match.index ?? 0
    if (start > cursor) segments.push({ text: text.slice(cursor, start) })
    segments.push({ text: match[0], ref: canonicalBrandedRef(match[0]) })
    cursor = start + match[0].length
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor) })
  return segments
}

/**
 * Whether one string's whole content is exactly one branded ref. A code span
 * like this is the model styling a ref as an identifier, not publishing code,
 * so the Markdown pass may linkify it; anything larger stays literal.
 */
export function isSingleBrandedRef(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed === '') return false
  const matches = [...trimmed.matchAll(BRANDED_REF_PATTERN)]
  return matches.length === 1 && matches[0]![0] === trimmed
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

const MARKDOWN_BLOCK_CONSTRUCT = /(^|\n)[ \t]{0,3}(?:#{1,6}[ \t]|>[ \t]|[-*+][ \t]|\d+[.)][ \t])|^[ \t]*\|.+\|/m
const MARKDOWN_INLINE_CONSTRUCT = /[`*_[\]!]|~~~|```/

/**
 * Whether an Agent body survives literal rendering unchanged: no fences,
 * inline code, emphasis markers, links, images, tables, or block constructs.
 * Only such plain-prose bodies may reuse the Human inline mention flow —
 * anything richer keeps the trailing chip row because the Markdown primitive
 * renders block-level documents that cannot interleave inline chips.
 */
export function isPlainTextBody(text: string): boolean {
  return !(MARKDOWN_BLOCK_CONSTRUCT.test(text) || MARKDOWN_INLINE_CONSTRUCT.test(text))
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
  if (activity.kind === 'accept') {
    return activity.completedClaimRefs !== undefined && activity.completedClaimRefs.length > 0
      ? options.t('activityAcceptedWithClaims', { actor, count: activity.completedClaimRefs.length })
      : options.t('activityAccepted', { actor })
  }
  if (activity.kind === 'promote') return options.t('activityPromoted', { actor })
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

/** Remove the machine-facing `[attachment] <path>` prompt lines from a body before display. */
export function stripAttachmentLines(body: string): string {
  return body.replaceAll(/^\[attachment\] .*$(\n)?/gm, '').replace(/\n+$/, '')
}

/**
 * Displayed bodies past this character count render clamped behind an expand
 * control. The rule is deterministic from the body alone, so every surface
 * derives the same default for the same Message and no client has to remember
 * a fold state.
 */
export const MESSAGE_COLLAPSE_CHARS = 600

/** Whether one displayed Message body starts clamped behind the expand control. */
export function shouldClampMessage(displayBody: string): boolean {
  return displayBody.length > MESSAGE_COLLAPSE_CHARS
}

/** How one Message body renders: mention-chip segments, literal text, or Markdown. */
export type MessageBodyRender = 'inline' | 'literal' | 'markdown'

/** Rendering decision for one Message body, resolved once from its stored form. */
export interface PlannedMessageBody {
  /** Stored body without machine-facing attachment prompt lines; the raw body when stripping would empty it. */
  readonly displayBody: string
  /** Rich Agent Markdown: only such bodies get the post-render chipify pass. */
  readonly richAgentBody: boolean
  /** Which rendering branch the body takes. */
  readonly render: MessageBodyRender
  /** Mention-chip segments for literal bodies; absent on the Markdown branch. */
  readonly inline?: ReturnType<typeof splitMentionNames>
  /** Mention handles that did not render as chips; the trailing row shows them. */
  readonly fallbackNames: readonly string[]
  /** Non-Task branded refs for the trailing fallback row; rich Agent bodies keep the legacy row. */
  readonly fallbackRefs: readonly string[]
  /** Task refs authored in a literal body; resolved labels replace them in place. */
  readonly taskRefs: readonly AgentTeamTaskRef[]
}

/**
 * Decide how one Message body renders. Human input and plain-prose Agent
 * bodies stay literal, with structured mention chips inline where possible;
 * rich Agent Markdown keeps unmatched mentions and non-Task refs in the
 * trailing fallback row while the post-render pass handles Task refs at their
 * authored position. Surfaces without ref navigation render everything
 * literally and keep the full fallback row.
 */
export function planMessageBody(body: string, options: {
  readonly human: boolean
  readonly mentionNames?: readonly string[]
  readonly canOpenRefs: boolean
}): PlannedMessageBody {
  const stripped = stripAttachmentLines(body)
  const displayBody = stripped === '' ? body : stripped
  const richAgentBody = !options.human && !isPlainTextBody(displayBody)
  const inline = (options.human || isPlainTextBody(displayBody)) && options.mentionNames !== undefined && options.mentionNames.length > 0
    ? splitMentionNames(displayBody, options.mentionNames)
    : undefined
  const fallbackNames = inline !== undefined ? inline.unmatched
    : richAgentBody && options.canOpenRefs && options.mentionNames !== undefined
      ? splitMentionNames(displayBody, options.mentionNames).unmatched
      : options.mentionNames ?? []
  const refs = splitBrandedRefs(displayBody).flatMap(segment => segment.ref === undefined ? [] : [segment.ref])
  const render: MessageBodyRender = inline !== undefined ? 'inline'
    : options.human || (options.canOpenRefs && !richAgentBody && refs.length > 0) ? 'literal'
    : 'markdown'
  return {
    displayBody,
    richAgentBody,
    render,
    ...(inline === undefined ? {} : { inline }),
    fallbackNames,
    // Rich Markdown refs are painted at their authored position after the
    // Markdown primitive has built its DOM; do not duplicate them in the
    // trailing chip row when navigation is available.
    fallbackRefs: richAgentBody && !options.canOpenRefs ? refs : [],
    taskRefs: options.canOpenRefs && !richAgentBody
      ? refs.filter(ref => ref.startsWith('task:')).map(ref => ref as AgentTeamTaskRef)
      : [],
  }
}
