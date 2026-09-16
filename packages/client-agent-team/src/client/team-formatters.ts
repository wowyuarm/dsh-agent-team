import type { AgentTeamActivity, AgentTeamClaim, AgentTeamClientMemberStatus, AgentTeamMemberId, AgentTeamTask, AgentTeamTaskRef } from '@wowyuarm/dsh-agent-team/types'
import { hasAllMarker, resolveBodyMentions, scanBodyHandles } from '@wowyuarm/dsh-agent-team/mentions'
import type { TeamConversationProps } from './slots.ts'
import type { TeamStateDotState } from './TeamStateDot.tsx'

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
 * Status indicator for a Task status, the dot every Task surface renders.
 * Active states map to StateDot variants; every status renders a dot so they
 * share one shape language — todo is a hollow ring (not started), closed a
 * quiet gray dot (archived).
 */
export function taskStatusDot(status: AgentTeamTask['status']): TeamStateDotState {
  return ({ todo: 'todo', in_progress: 'ongoing', in_review: 'warning', done: 'done', closed: 'quiet' } as const)[status]
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

// Full UUIDs and abbreviated forms (prefix plus the first 6+ hex chars, with
// or without the original hyphens) both match; resolution decides whether an
// abbreviation is real, so unresolvable matches stay plain text.
const BRANDED_REF_PATTERN = /\b(task|channel|thread):{1,2}[0-9a-f]{6,}(?:-[0-9a-f]{1,})*\b/gi

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
 * anchors on the fixed ref prefixes plus a UUID shape (full or abbreviated),
 * so ordinary prose containing a colon never linkifies; a doubled colon from
 * model output is tolerated. Segment refs are always canonical, so resolution
 * and navigation work regardless of how the ref was spelled; text without any
 * ref comes back as one untouched segment.
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

/**
 * Locate one Message's delivered mention names inside its literal body. Matching
 * is the shared Host delivery scan — an authored `@`, case-insensitive on Unicode
 * word boundaries, longest handle first, code quoted rather than called — so a chip
 * never lands where delivery would not reach. Mention segments render the canonical
 * `@Handle`; names absent from the body come back unmatched so the consumer can
 * append them as a fallback chip row.
 */
export function splitMentionNames(text: string, names: readonly string[]): { segments: MentionSegment[]; unmatched: readonly string[] } {
  if (names.length === 0) return { segments: [{ text, mention: false }], unmatched: [] }
  const segments: MentionSegment[] = []
  const matched = new Set<string>()
  let cursor = 0
  for (const match of scanBodyHandles(text, names)) {
    if (match.start > cursor) segments.push({ text: text.slice(cursor, match.start), mention: false })
    segments.push({ text: `@${match.handle}`, mention: true, name: match.handle })
    matched.add(match.handle.toLowerCase())
    cursor = match.end
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), mention: false })
  return { segments, unmatched: names.filter(name => !matched.has(name.toLowerCase())) }
}

/**
 * Whether one draft spells a handle as an authored `@mention`: the shared
 * delivery scan, so the composer's recipient prune and will-notify preview agree
 * with the Host on what the draft actually calls.
 */
export function containsMention(body: string, handle: string): boolean {
  return scanBodyHandles(body, [handle]).length > 0
}

/** Whether one draft carries the `@all` marker the mention menu expands. */
export function containsAllMention(body: string): boolean {
  return hasAllMarker(body)
}

/**
 * Every Member the mention menu's `@all` row stands for: the roster this
 * composer was handed minus Members who cannot take a Message right now — the
 * same filter the per-handle rows apply, so the expansion and the menu agree.
 */
export function allMentionMembers(members: readonly AgentTeamClientMemberStatus[]): readonly AgentTeamClientMemberStatus[] {
  return members.filter(status => status.presence !== 'unavailable' && status.member.state !== 'inactive' && status.member.state !== 'archived')
}

/**
 * Member ids one draft asks to notify by text alone: the Client's preview of
 * the Host's own body mention resolution, so a hand-typed `@Handle` reports
 * exactly like a pick from the mention menu. `@all` stands for the menu's
 * expansion; a written handle counts whenever its Member can still take a
 * Message — state decides, not presence, because an offline Member is notified
 * and reads it later.
 *
 * The result is preview-only. Only picked recipients travel as explicit
 * recipients, where a name the Channel cannot reach would be a rejected target
 * rather than the prose the Host reads.
 */
export function mentionedMemberIds(body: string, members: readonly AgentTeamClientMemberStatus[]): readonly AgentTeamMemberId[] {
  if (hasAllMarker(body)) return allMentionMembers(members).map(status => status.member.memberId)
  const candidates = members
    .filter(status => status.member.state !== 'inactive' && status.member.state !== 'archived')
    .map(status => ({ memberId: status.member.memberId, handle: status.member.handle }))
  // The draft's author is the Human reader, and a Message never mentions its
  // own author: resolving with that sender drops a self-call exactly where
  // delivery would.
  return resolveBodyMentions(body, candidates, 'member:human' as AgentTeamMemberId).memberIds
}

/** Canonical chip handles for one Message's structured mention refs. */
export function mentionNamesOf(mentions: readonly AgentTeamMemberId[], handles: ReadonlyMap<AgentTeamMemberId, string>): string[] {
  return mentions
    // The Human is Team authority, not an Agent projection, so `members()` does
    // not include it. Keep its stable public handle available for rendering.
    .map(memberId => memberId === 'member:human' ? 'human' : handles.get(memberId))
    .filter((name): name is string => name !== undefined)
}

/** Accessible label for one "who is on this work" stack: its owners' handles, comma-separated. */
export function claimersLabel(owners: ReadonlyArray<{ readonly name: string }>, t: TeamConversationProps['t']): string {
  return t('claimers', { names: owners.map(owner => `@${owner.name}`).join(', ') })
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

/** Absolute local `YYYY-MM-DD HH:mm` label: the precise instant behind every shorter form. */
export function formatAbsoluteTime(occurredAt: string): string {
  const at = new Date(occurredAt)
  if (Number.isNaN(at.getTime())) return ''
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`
}

/**
 * Wall-clock label for one Message instant: time within the current day,
 * month-day time within the year, full date otherwise.
 */
export function formatMessageTime(occurredAt: string, now = new Date()): string {
  const at = new Date(occurredAt)
  if (Number.isNaN(at.getTime())) return ''
  const sameDay = at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth() && at.getDate() === now.getDate()
  if (sameDay) return `${pad(at.getHours())}:${pad(at.getMinutes())}`
  const absolute = formatAbsoluteTime(occurredAt)
  return at.getFullYear() === now.getFullYear() ? absolute.slice(5) : absolute
}

/**
 * Calendar days between two instants in the viewer's own zone, so "yesterday"
 * means yesterday locally rather than 24 hours earlier.
 */
function calendarDayDelta(at: Date, now: Date): number {
  const midnight = (date: Date): number => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  return Math.round((midnight(now) - midnight(at)) / 86_400_000)
}

/**
 * Recency label for one Inbox row's newest fact, shared with the Channel feed's
 * entry line so the two agree about the same instant. Today is a bare clock time
 * — the reader is in today, and 「今天」 printed down every row spends the label's
 * first word on the one segment that never varies, while `HH:mm` alone still
 * reads as a clock because it is exactly one. The first day that is not today is
 * the fact the reader has to be told, so it keeps its word; everything older
 * keeps the Message date form, so the row and the Thread it opens agree.
 */
export function formatInboxTime(occurredAt: string, t: TeamConversationProps['t'], now = new Date()): string {
  const at = new Date(occurredAt)
  if (Number.isNaN(at.getTime())) return ''
  const days = calendarDayDelta(at, now)
  if (days === 0) return `${pad(at.getHours())}:${pad(at.getMinutes())}`
  if (days === 1) return `${t('inboxTimeYesterday')} ${pad(at.getHours())}:${pad(at.getMinutes())}`
  return formatMessageTime(occurredAt, now)
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
