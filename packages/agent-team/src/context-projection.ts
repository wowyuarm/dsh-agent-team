/**
 * Host-only Session projection for Agent Team context management.
 *
 * One pure synchronous fold over a Member Session log derives every
 * context-management fact the Host needs: pending rollover intent (a
 * successful `context_rollover` call/result pair — under the legacy
 * `new_context` name for Sessions recorded before the rename), explicit
 * checkpoints (a
 * successful `context_checkpoint` pair resolved by its containing `turn/end`),
 * handoff/compaction boundaries, and quiet-continuation delivery state. The
 * fold is the single authority for these facts — no second store, and callers
 * never re-derive intent from raw events.
 *
 * A seeded child Session folds with `inheritedEventCount` respected: events
 * inherited from the fork prefix are already resolved history, never fresh
 * intent. The cold fold and the registered unit both start past the inherited
 * cut, so an inherited historical rollover call can never schedule
 * another transition in the child.
 * @module @wowyuarm/dsh-agent-team/context-projection
 */

import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { ToolResultMessage, UserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, SessionHeader, SessionLogOffset } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { AgentTeamContextCheckpointRef } from './types.ts'
import { isCheckpointContinuationMessage } from './context-source.ts'

/** Plugin identity of the Agent Team Host, for recognizing own notices. */
const AGENT_TEAM_PLUGIN_ID = '@wowyuarm/dsh-agent-team'

/** Summary marker of the pre-compaction memory hint. */
const PRE_COMPACTION_NOTICE_SUMMARY = 'Compaction is imminent; consider persisting key conclusions.'

/** Team tool whose successful mutations are semantic timeline candidates. */
const TEAM_CLAIM_TOOL_NAME = 'team_claim'

/** Stable tool names the projection recognizes. */
export const CONTEXT_CHECKPOINT_TOOL_NAME = 'context_checkpoint'
export const CONTEXT_ROLLOVER_TOOL_NAME = 'context_rollover'
/**
 * Legacy decoder name: the rollover tool was renamed `new_context` →
 * `context_rollover`, and Sessions recorded before the rename still carry
 * durable `new_context` call/result pairs. The projection keeps folding them
 * — pending rollovers and crash recovery of existing Members depend on old
 * events still resolving intent — but this is a log decoder, not a tool
 * alias: no new call can carry the old name.
 */
export const NEW_CONTEXT_TOOL_NAME = 'new_context'

/** Whether one recorded tool name is a rollover call under the current or the legacy name. */
function isRolloverToolName(name: string): boolean {
  return name === CONTEXT_ROLLOVER_TOOL_NAME || name === NEW_CONTEXT_TOOL_NAME
}

/** One completed-turn checkpoint anchor in this Session lineage. */
export interface ContextCheckpointEntry {
  /** Opaque stable ref; selection authority, never derived from the name. */
  readonly checkpointRef: AgentTeamContextCheckpointRef
  /** Display label supplied by the model. */
  readonly name: string
  /** Seq of the successful tool result that recorded the checkpoint. */
  readonly resultSeq: number
  /** Turn the checkpoint concluded; the completed-turn boundary anchor. */
  readonly turn: number
  /** Seq of the `turn/end` that resolved the checkpoint; -1 until resolved. */
  readonly turnEndSeq: number
}

/** Arguments the model passed to one successful rollover call. */
export interface RolloverToolArguments {
  readonly handoff: string
  readonly checkpointRef?: AgentTeamContextCheckpointRef | undefined
  readonly relatedFiles: readonly { readonly path: string; readonly reason: string }[]
}

/** Rollover intent waiting for the containing turn to finish and the Agent to idle. */
export interface PendingRolloverIntent extends RolloverToolArguments {
  /** The provider-issued call id of the successful rollover call. */
  readonly toolCallId: string
  /** Seq of the successful rollover tool result. */
  readonly resultSeq: number
  /** Turn containing the successful call; the swap waits for its end. */
  readonly turn: number
  /** Seq of the `turn/end` that released the intent for the swap; -1 until observed. */
  readonly turnEndSeq: number
}

/** Quiet-continuation delivery state for one checkpoint, keyed by checkpointRef. */
export interface ContinuationDeliveryState {
  /** The checkpoint the continuation follows. */
  readonly checkpointRef: AgentTeamContextCheckpointRef
  /** Seq of the delivered continuation notice in this Session; -1 until delivered. */
  readonly deliveredSeq: number
}

/** One non-Team message queued after the pending intent; a carry candidate. */
export interface CarriedCandidate {
  /** The queued message itself, verbatim. */
  readonly message: UserMessage
  /** The turn that surfaced the message onto the model-visible input, if any. */
  readonly surfacedTurn: number
  /** Whether a completed assistant answer proved the old generation handled it. */
  readonly consumed: boolean
}

/** State of the `agentTeamContext` projection for one Session. */
export interface AgentTeamContextProjectionState {
  /** Checkpoints recorded by a successful call, resolved ones anchored to their turn end. */
  readonly checkpoints: readonly ContextCheckpointEntry[]
  /** Rollover intent awaiting its containing turn end, at most one. */
  readonly pending: PendingRolloverIntent | null
  /** Quiet continuations recorded (with or without delivery), keyed by checkpoint ref. */
  readonly continuations: readonly ContinuationDeliveryState[]
  /**
   * Non-Team messages queued into the inbox after the pending intent's tool
   * result. The durable `agent/inbox/spliced` log is the truth: the
   * transition delivers every candidate the old generation never answered
   * (a claimed-but-rejected or canceled message stays a candidate), deduped
   * by message id. Empty until an intent exists.
   */
  readonly carriedCandidates: readonly CarriedCandidate[]
  /** The most recently opened turn; user/message events carry no turn of their own. */
  readonly lastTurn: number
  /**
   * Context-tool calls whose results have not landed yet. Part of the state so
   * the live unit folds one event at a time and still pairs call to result; a
   * dangling call at any cut simply never becomes intent or a checkpoint.
   */
  readonly openCalls: readonly { readonly callId: string; readonly name: string; readonly arguments: string }[]
  /**
   * Timeline boundaries beyond explicit checkpoints, resolved to their
   * containing completed turn: handoff deliveries (each generation begins
   * with one), compaction notices, and Team semantic facts that entered
   * model context (successful claim-state tool results or structured Team
   * notification delivery). Each is a structural timeline candidate with the
   * same completed-turn anchor contract as a checkpoint.
   */
  readonly boundaries: readonly TimelineBoundary[]
  /** Seq of the latest resolved `turn/end`; the head boundary of the timeline. */
  readonly lastTurnEndSeq: number
}

/** One non-checkpoint timeline candidate resolved at a completed turn. */
export interface TimelineBoundary {
  /** Stable identity for the timeline: kind plus the anchoring event seq. */
  readonly key: string
  /** Which structural source produced this boundary. */
  readonly source: 'team-boundary' | 'handoff' | 'compaction'
  /** Human-facing label derived from the boundary's own data. */
  readonly label: string
  /** Seq of the boundary's own anchoring event (delivery or tool result). */
  readonly seq: number
  /** Turn the boundary landed in. */
  readonly turn: number
  /** Seq of the `turn/end` that resolved it; -1 until resolved. */
  readonly turnEndSeq: number
}

const relatedFileSchema = z.object({ path: z.string().min(1), reason: z.string() }).strict()
const checkpointRefSchema = z.string().regex(/^(context-checkpoint-[0-9a-f]{64}|team-boundary-[0-9a-f]{64})$/).transform(value => value as AgentTeamContextCheckpointRef)
const openCallSchema = z.object({ callId: z.string().min(1), name: z.string(), arguments: z.string() }).strict()

const carriedCandidateSchema = z.object({
  message: z.any(),
  surfacedTurn: z.number().int(),
  consumed: z.boolean(),
})

const boundarySchema = z.object({
  key: z.string().min(1),
  source: z.enum(['team-boundary', 'handoff', 'compaction']),
  label: z.string(),
  seq: z.number().int().nonnegative(),
  turn: z.number().int().nonnegative(),
  turnEndSeq: z.number().int(),
}).strict()

const stateSchema = z.object({
  checkpoints: z.array(z.object({
    checkpointRef: checkpointRefSchema,
    name: z.string(),
    resultSeq: z.number().int().nonnegative(),
    turn: z.number().int().nonnegative(),
    turnEndSeq: z.number().int(),
  }).strict()),
  pending: z.object({
    toolCallId: z.string().min(1),
    resultSeq: z.number().int().nonnegative(),
    turn: z.number().int().nonnegative(),
    handoff: z.string(),
    checkpointRef: checkpointRefSchema.optional(),
    relatedFiles: z.array(relatedFileSchema),
    turnEndSeq: z.number().int(),
  }).strict().nullable(),
  continuations: z.array(z.object({
    checkpointRef: checkpointRefSchema,
    deliveredSeq: z.number().int(),
  }).strict()),
  carriedCandidates: z.array(carriedCandidateSchema),
  lastTurn: z.number().int().nonnegative(),
  openCalls: z.array(openCallSchema),
  boundaries: z.array(boundarySchema),
  lastTurnEndSeq: z.number().int(),
}).strict()

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    agentTeamContext: AgentTeamContextProjectionState
  }
}

/**
 * Deterministic checkpoint ref from the recording session and tool call
 * identity: a bounded, collision-resistant opaque token. Provider call ids
 * are arbitrary-length free text that may repeat across generations and even
 * collide between Sessions, so the ref derives from the SHA-256 of the exact
 * `(sessionId, callId)` pair — same pair always reproduces the ref, any
 * other pair is overwhelmingly unlikely to collide, and the token can never
 * smuggle delimiters or unbounded content through a ref field.
 */
export function checkpointRefFor(sessionId: string, callId: string): AgentTeamContextCheckpointRef {
  return `context-checkpoint-${createHash('sha256').update(JSON.stringify([sessionId, callId])).digest('hex')}` as AgentTeamContextCheckpointRef
}

/**
 * Deterministic default-boundary ref for one delivered Team boundary: the
 * same session-scoped hash shape as checkpoint refs, keyed on the boundary's
 * anchoring event seq. Consecutive generations routinely repeat event seqs,
 * so the Session identity must be part of the key or two generations'
 * boundaries at the same seq collide — the timeline would silently drop the
 * ancestor item and a `context_rollover` return would resolve the wrong boundary.
 */
export function boundaryRefFor(sessionId: string, seq: number): AgentTeamContextCheckpointRef {
  return `team-boundary-${createHash('sha256').update(JSON.stringify([sessionId, seq])).digest('hex')}` as AgentTeamContextCheckpointRef
}

function emptyState(): AgentTeamContextProjectionState {
  return { checkpoints: [], pending: null, continuations: [], carriedCandidates: [], lastTurn: 0, openCalls: [], boundaries: [], lastTurnEndSeq: -1 }
}

/**
 * Cold-fold one immutable event log into the projection state. Events at or
 * before `inheritedEventCount` belong to the fork prefix and are resolved
 * history in this Session, so they never produce fresh intent. `sessionId` is
 * the log's own Session identity — it keys checkpoint refs, so the same
 * provider call id in two different Sessions produces two distinct refs.
 */
export function foldContextProjection(events: readonly SessionEvent[], inheritedEventCount: SessionLogOffset = 0 as SessionLogOffset, sessionId: string = ''): AgentTeamContextProjectionState {
  let state = emptyState()
  const inherited = Number(inheritedEventCount)
  for (const event of events) {
    if (event.seq < inherited) continue
    state = applyContextEvent(state, event, sessionId)
  }
  return state
}

/**
 * The host-only projection unit; no wire view is published. The definition is
 * a factory: each Session folds with its own identity so checkpoint refs
 * derive from that Session's exact `(sessionId, callId)` pairs.
 */
export const agentTeamContextProjectionDefinition = (sessionId: string): ProjectionDefinition<'agentTeamContext', AgentTeamContextProjectionState> => ({
  key: 'agentTeamContext',
  stateVersion: 2,
  stateSchema,
  init: (_header: SessionHeader, _inheritedEventCount: SessionLogOffset): AgentTeamContextProjectionState => emptyState(),
  apply: (state, event) => applyContextEvent(state, event, sessionId),
})

/**
 * Pure transition: previous state + one committed event → next state. Returns
 * the same reference when the event is not this unit's.
 */
function applyContextEvent(state: AgentTeamContextProjectionState, event: SessionEvent, sessionId: string): AgentTeamContextProjectionState {
  if (event.type === 'tool/call') {
    if (!isRolloverToolName(event.data.name) && event.data.name !== CONTEXT_CHECKPOINT_TOOL_NAME && event.data.name !== TEAM_CLAIM_TOOL_NAME) return state
    // Only Team-claim mutations (not `list`) are semantic timeline candidates.
    if (event.data.name === TEAM_CLAIM_TOOL_NAME && !argumentsAreClaimMutation(event.data.arguments)) return state
    return { ...state, openCalls: [...state.openCalls, { callId: event.data.callId, name: event.data.name, arguments: event.data.arguments }] }
  }
  if (event.type === 'tool/result') {
    return applyToolResult(state, event.seq, event.data.turn, event.data.message, event.data.error !== undefined, sessionId)
  }
  if (event.type === 'turn/end') {
    return applyTurnEnd(state, event.seq, event.data.turn)
  }
  if (event.type === 'user/message') {
    return applyUserMessage(state, event.seq, event.data, sessionId)
  }
  if (event.type === 'agent/inbox/spliced') {
    return applyInboxSpliced(state, event.data)
  }
  if (event.type === 'assistant/message') {
    return applyAssistantMessage(state, event)
  }
  if (event.type === 'turn/start') {
    return event.data.turn === state.lastTurn ? state : { ...state, lastTurn: event.data.turn }
  }
  return state
}

/**
 * Structural timeline boundary from one delivered user message: a rollover
 * handoff starts a generation; a structured Team notification (direct
 * mention, claim/Task activity) delivers semantic Team facts into model
 * context; a compaction notice rewrites the visible surface. All anchor to
 * the containing completed turn. Plain Human/agent prose and quiet
 * checkpoint continuations are not boundaries.
 */
function boundaryFromUserMessage(sessionId: string, seq: number, message: UserMessage): TimelineBoundary | undefined {
  const source = message.source
  if (source.kind === 'agent-team-context-handoff') {
    return { key: `handoff:${seq}`, source: 'handoff', label: 'context handoff', seq, turn: -1, turnEndSeq: -1 }
  }
  if (source.kind !== 'plugin' || source.plugin !== AGENT_TEAM_PLUGIN_ID) return undefined
  if (source.form === 'relay') return undefined
  if (source.form === 'notice' && source.summary === PRE_COMPACTION_NOTICE_SUMMARY) {
    return { key: `compaction:${seq}`, source: 'compaction', label: 'compaction notice', seq, turn: -1, turnEndSeq: -1 }
  }
  // A notice carries its own one-line account; other plugin forms (e.g.
  // identity instructions) have none and keep the generic delivery label.
  const label = source.form === 'notice' && source.summary !== undefined ? source.summary : 'Team delivery'
  return { key: boundaryRefFor(sessionId, seq), source: 'team-boundary', label, seq, turn: -1, turnEndSeq: -1 }
}

/**
 * Fold one durable inbox splice. After a pending intent exists, every
 * non-Team message inserted into the inbox is a carry candidate; the
 * durable log is the truth, so a claim, removal, or cancel can never make
 * the message vanish silently — only surfacing it onto the model-visible
 * `user/message` surface consumes it.
 */
function applyInboxSpliced(state: AgentTeamContextProjectionState, data: { inserted: readonly UserMessage[] }): AgentTeamContextProjectionState {
  if (state.pending === null || data.inserted.length === 0) return state
  const fresh = data.inserted
    .filter(message => !isTeamNotice(message))
    .filter(message => !state.carriedCandidates.some(candidate => candidate.message.id === message.id))
    .map(message => ({ message, surfacedTurn: -1, consumed: false }))
  if (fresh.length === 0) return state
  return { ...state, carriedCandidates: [...state.carriedCandidates, ...fresh] }
}

function applyToolResult(
  state: AgentTeamContextProjectionState,
  seq: number,
  turn: number,
  message: ToolResultMessage,
  internalFailure: boolean,
  sessionId: string,
): AgentTeamContextProjectionState {
  const block = message.content[0]
  if (block === undefined || block.type !== 'tool-result') return state
  // A successful pair only: model-visible errors and internal failures carry
  // neither checkpoint nor rollover intent.
  if (block.isError === true || internalFailure) return state
  const index = state.openCalls.findIndex(call => call.callId === block.toolCallId)
  if (index === -1) return state
  const recorded = state.openCalls[index]!
  const openCalls = state.openCalls.filter(call => call.callId !== block.toolCallId)
  if (isRolloverToolName(recorded.name)) {
    const parsed = parseRolloverArguments(recorded.arguments)
    if (parsed === undefined) return { ...state, openCalls }
    // One pending intent at a time: a second successful call before the turn
    // ends replaces nothing — the first owns the swap.
    if (state.pending !== null) return { ...state, openCalls }
    return { ...state, openCalls, pending: { ...parsed, toolCallId: recorded.callId, resultSeq: seq, turn, turnEndSeq: -1 } }
  }
  if (recorded.name === CONTEXT_CHECKPOINT_TOOL_NAME) {
    const parsed = parseCheckpointArguments(recorded.arguments)
    if (parsed === undefined) return { ...state, openCalls }
    const checkpointRef = checkpointRefFor(sessionId, block.toolCallId)
    return {
      ...state,
      openCalls,
      checkpoints: [...state.checkpoints, { checkpointRef, name: parsed.name, resultSeq: seq, turn, turnEndSeq: -1 }],
    }
  }
  // The only remaining open call name is the Team-claim mutation: a
  // successful claim/done/release result entered model context, so it is a
  // semantic Team boundary anchored to the containing turn.
  return {
    ...state,
    openCalls,
    boundaries: [...state.boundaries, { key: boundaryRefFor(sessionId, seq), source: 'team-boundary', label: 'Team claim change', seq, turn, turnEndSeq: -1 }],
  }
}

function applyTurnEnd(state: AgentTeamContextProjectionState, seq: number, _turn: number): AgentTeamContextProjectionState {
  let changed = false
  const checkpoints = state.checkpoints.map(entry => {
    if (entry.turnEndSeq !== -1) return entry
    changed = true
    return { ...entry, turnEndSeq: seq }
  })
  let pending = state.pending
  if (pending !== null && pending.turnEndSeq === -1) {
    pending = { ...pending, turnEndSeq: seq }
    changed = true
  }
  const boundaries = state.boundaries.map(entry => {
    if (entry.turnEndSeq !== -1) return entry
    changed = true
    return { ...entry, turnEndSeq: seq, turn: entry.turn === -1 ? _turn : entry.turn }
  })
  if (state.lastTurnEndSeq !== seq) changed = true
  return changed ? { ...state, checkpoints, pending, boundaries, lastTurnEndSeq: seq } : state
}

function applyUserMessage(state: AgentTeamContextProjectionState, seq: number, message: UserMessage, sessionId: string): AgentTeamContextProjectionState {
  let next = state
  // A surfaced candidate is NOT consumed yet: the loop appends user/message
  // before the step runs, so cancellation can still land between them. Only
  // a completed, uninterrupted assistant answer for the same turn proves the
  // old generation handled it; anything else stays carried, so an aborted
  // partial request re-delivers the input instead of silently dropping it.
  const surfaced = next.carriedCandidates.some(candidate => !candidate.consumed && candidate.message.id === message.id)
  if (surfaced) {
    // The user/message event carries no turn field, but the projection folds
    // in log order: the containing step/start preceded this message, and
    // the fold tracks the current turn from turn/start. Candidates surface
    // inside the turn the inbox claimed them for.
    next = { ...next, carriedCandidates: next.carriedCandidates.map(candidate =>
      candidate.message.id === message.id && !candidate.consumed ? { ...candidate, surfacedTurn: next.lastTurn } : candidate) }
  }
  // A structural boundary delivery (handoff start, Team semantic notice,
  // compaction notice) becomes a timeline candidate anchored to the
  // containing turn; it resolves when that turn ends.
  const boundary = boundaryFromUserMessage(sessionId, seq, message)
  if (boundary !== undefined) next = { ...next, boundaries: [...next.boundaries, boundary] }
  // The quiet continuation notice delivered for one checkpoint completes its
  // delivery state; replay repair reads this to avoid re-scheduling it.
  if (message.source.kind !== 'agent-team-context-continuation') return next
  const checkpointRef = message.source.checkpointRef as AgentTeamContextCheckpointRef
  const existing = next.continuations.find(entry => entry.checkpointRef === checkpointRef)
  if (existing !== undefined) {
    if (existing.deliveredSeq !== -1) return next
    return { ...next, continuations: next.continuations.map(entry => entry === existing ? { ...entry, deliveredSeq: seq } : entry) }
  }
  return { ...next, continuations: [...next.continuations, { checkpointRef, deliveredSeq: seq }] }
}

/** A completed, uninterrupted assistant turn answers every candidate surfaced into it. */
function applyAssistantMessage(state: AgentTeamContextProjectionState, event: SessionEvent & { type: 'assistant/message' }): AgentTeamContextProjectionState {
  if (state.carriedCandidates.length === 0 || event.data.interrupted === true) return state
  let changed = false
  const carriedCandidates = state.carriedCandidates.map(candidate => {
    if (candidate.consumed || candidate.surfacedTurn !== event.data.turn) return candidate
    changed = true
    return { ...candidate, consumed: true }
  })
  return changed ? { ...state, carriedCandidates } : state
}

/** The carried input one transition must deliver: unconsumed post-intent candidates, in queue order. */
export function carriedInputOf(state: AgentTeamContextProjectionState): readonly UserMessage[] {
  return state.carriedCandidates.filter(candidate => !candidate.consumed).map(candidate => candidate.message)
}

/** Whether one queued message is a Team-owned notice the rederived Inbox replaces. */
function isTeamNotice(message: UserMessage): boolean {
  const source = message.source
  return source.kind === 'plugin' && source.plugin === AGENT_TEAM_PLUGIN_ID
}

/** Whether a quiet continuation for one checkpoint was already delivered in this Session. */
export function continuationDelivered(state: AgentTeamContextProjectionState, checkpointRef: AgentTeamContextCheckpointRef): boolean {
  return state.continuations.some(entry => entry.checkpointRef === checkpointRef && entry.deliveredSeq !== -1)
}

/** Record that a continuation for one checkpoint is scheduled (delivery not yet seen). */
export function withScheduledContinuation(state: AgentTeamContextProjectionState, checkpointRef: AgentTeamContextCheckpointRef): AgentTeamContextProjectionState {
  if (state.continuations.some(entry => entry.checkpointRef === checkpointRef)) return state
  return { ...state, continuations: [...state.continuations, { checkpointRef, deliveredSeq: -1 }] }
}

/** Whether one raw Team-claim arguments string is a mutation (not `list`). */
function argumentsAreClaimMutation(raw: string): boolean {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return false
  }
  if (typeof parsed !== 'object' || parsed === null) return false
  const { action } = parsed as Record<string, unknown>
  return action === 'claim' || action === 'done' || action === 'release'
}

function parseRolloverArguments(raw: string): RolloverToolArguments | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const { handoff, checkpointRef, relatedFiles } = parsed as Record<string, unknown>
  if (typeof handoff !== 'string' || handoff.trim() === '') return undefined
  if (checkpointRef !== undefined && typeof checkpointRef !== 'string') return undefined
  if (relatedFiles !== undefined && !isRelatedFiles(relatedFiles)) return undefined
  return {
    handoff,
    ...(checkpointRef === undefined ? {} : { checkpointRef: checkpointRef as AgentTeamContextCheckpointRef }),
    relatedFiles: relatedFiles === undefined ? [] : relatedFiles,
  }
}

function parseCheckpointArguments(raw: string): { readonly name: string } | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const { name } = parsed as Record<string, unknown>
  if (typeof name !== 'string' || name.trim() === '') return undefined
  return { name }
}

function isRelatedFiles(value: unknown): value is Array<{ path: string; reason: string }> {
  return Array.isArray(value) && value.every(file => typeof file === 'object' && file !== null
    && typeof (file as Record<string, unknown>).path === 'string' && typeof (file as Record<string, unknown>).reason === 'string')
}

// Re-exported for callers that only want the predicate view of continuation
// delivery without importing the source module's message constructors.
export { isCheckpointContinuationMessage }

/** One structural timeline candidate, projection view: anchor plus identity. */
export interface TimelineCandidate {
  /** Stable selection ref (checkpoint refs for agent checkpoints; the boundary key otherwise). */
  readonly ref: string
  /** Semantic label: the model-supplied checkpoint name or the boundary label. */
  readonly label: string
  /** Which structural source produced this candidate. */
  readonly source: 'agent' | 'team-boundary' | 'handoff' | 'compaction' | 'head'
  /** Seq of the anchoring event (the tool result or delivery message). */
  readonly seq: number
  /** Seq of the completed `turn/end` that resolved the candidate; -1 while unresolved. */
  readonly turnEndSeq: number
}

/**
 * Bounded structural timeline candidates, newest first: explicit checkpoints
 * (resolved only), structural boundaries, then the current head. The Host
 * prices retained/discarded tokens and applies restorability guards on top;
 * this view is the single source of candidate anchors and labels.
 */
export function timelineCandidates(state: AgentTeamContextProjectionState, limit: number): readonly TimelineCandidate[] {
  const candidates: TimelineCandidate[] = []
  for (const checkpoint of state.checkpoints) {
    if (checkpoint.turnEndSeq === -1) continue
    candidates.push({ ref: checkpoint.checkpointRef, label: checkpoint.name, source: 'agent', seq: checkpoint.resultSeq, turnEndSeq: checkpoint.turnEndSeq })
  }
  for (const boundary of state.boundaries) {
    if (boundary.turnEndSeq === -1) continue
    candidates.push({ ref: boundary.key, label: boundary.label, source: boundary.source, seq: boundary.seq, turnEndSeq: boundary.turnEndSeq })
  }
  if (state.lastTurnEndSeq !== -1) {
    candidates.push({ ref: `head:${state.lastTurnEndSeq}`, label: 'current head', source: 'head', seq: state.lastTurnEndSeq, turnEndSeq: state.lastTurnEndSeq })
  }
  return candidates
    .sort((a, b) => b.turnEndSeq - a.turnEndSeq || b.seq - a.seq)
    .slice(0, Math.max(1, Math.trunc(limit)))
}

/** Find one resolved checkpoint entry by its stable ref, if it exists. */
export function checkpointByRef(state: AgentTeamContextProjectionState, checkpointRef: string): ContextCheckpointEntry | undefined {
  return state.checkpoints.find(entry => entry.checkpointRef === checkpointRef && entry.turnEndSeq !== -1)
}
