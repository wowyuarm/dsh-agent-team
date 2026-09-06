import { beforeEach, describe, expect, it } from 'vitest'
import { createToolResultMessage, createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import { SessionLogOffset, SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'

/** Fixed Session identity for every fold in this spec; checkpoint refs key on it. */
const SID = 'agent-team-test-session'
import {
  CONTEXT_CHECKPOINT_TOOL_NAME,
  NEW_CONTEXT_TOOL_NAME,
  agentTeamContextProjectionDefinition,
  checkpointRefFor,
  continuationDelivered,
  foldContextProjection,
  timelineCandidates,
  withScheduledContinuation,
  type AgentTeamContextProjectionState,
} from '../src/context-projection.ts'
import { createCheckpointContinuationMessage, createHandoffMessage } from '../src/context-source.ts'

let eventSeq = 0
function nextSeq(): SessionSeq {
  eventSeq += 1
  return SessionSeq(eventSeq)
}

function turnStart(turn: number): SessionEvent {
  return { type: 'turn/start', seq: nextSeq(), time: 0, data: { turn } } as SessionEvent
}

function turnEnd(turn: number, reason: 'completed' | 'aborted' = 'completed'): SessionEvent {
  return { type: 'turn/end', seq: nextSeq(), time: 0, data: { turn, reason: { kind: reason } } } as SessionEvent
}

function contextToolCall(turn: number, callId: string, name: string, args: object): SessionEvent {
  return { type: 'tool/call', seq: nextSeq(), time: 0,
    data: { turn, step: 1, callId: callId as never, name, arguments: JSON.stringify(args) } } as SessionEvent
}

function toolResult(turn: number, callId: string, options: { isError?: boolean; internalError?: boolean } = {}): SessionEvent {
  const message = createToolResultMessage({
    callId: callId as never,
    content: [{ type: 'text', text: options.isError === true ? 'Error: rejected' : 'ok' }],
    isError: options.isError === true,
  })
  return { type: 'tool/result', seq: nextSeq(), time: 0,
    data: { turn, step: 1, message, ...(options.internalError === true ? { error: { name: 'ToolError', code: 'BOOM' } } : {}) } } as SessionEvent
}

function userMessageEvent(message: UserMessage): SessionEvent {
  return { type: 'user/message', seq: nextSeq(), time: 0, data: message } as SessionEvent
}

function newContextPair(turn: number, callId: string, args: { handoff: string; checkpointRef?: string; relatedFiles?: Array<{ path: string; reason: string }> }): SessionEvent[] {
  return [
    contextToolCall(turn, callId, NEW_CONTEXT_TOOL_NAME, args),
    toolResult(turn, callId),
  ]
}

function checkpointPair(turn: number, callId: string, name: string): SessionEvent[] {
  return [
    contextToolCall(turn, callId, CONTEXT_CHECKPOINT_TOOL_NAME, { name }),
    toolResult(turn, callId),
  ]
}

beforeEach(() => { eventSeq = 0 })

describe('AgentTeam context projection — rollover intent', () => {
  it('a successful new_context call/result pair creates pending intent', () => {
    const events = [
      turnStart(1),
      ...newContextPair(1, 'call-1', { handoff: 'continue from here' }),
      turnEnd(1),
    ]
    const state = foldContextProjection(events, undefined, SID)
    expect(state.pending).toMatchObject({ handoff: 'continue from here', turn: 1, turnEndSeq: events.at(-1)!.seq })
    expect(state.pending?.resultSeq).toBe(events[2]!.seq)
    expect(state.pending?.relatedFiles).toEqual([])
  })

  it('failed, dangling, or malformed results never create intent', () => {
    // Model-visible error result.
    const failed = foldContextProjection([
      turnStart(1),
      contextToolCall(1, 'call-err', NEW_CONTEXT_TOOL_NAME, { handoff: 'x' }),
      toolResult(1, 'call-err', { isError: true }),
      turnEnd(1),
    ], undefined, SID)
    expect(failed.pending).toBeNull()
    // Internal failure identity on the result event.
    const internal = foldContextProjection([
      turnStart(1),
      contextToolCall(1, 'call-int', NEW_CONTEXT_TOOL_NAME, { handoff: 'x' }),
      toolResult(1, 'call-int', { internalError: true }),
      turnEnd(1),
    ], undefined, SID)
    expect(internal.pending).toBeNull()
    // Dangling call: result never landed before the cut.
    const dangling = foldContextProjection([
      turnStart(1),
      contextToolCall(1, 'call-open', NEW_CONTEXT_TOOL_NAME, { handoff: 'x' }),
      turnEnd(1),
    ], undefined, SID)
    expect(dangling.pending).toBeNull()
    // Malformed arguments: empty handoff after trim.
    const malformed = foldContextProjection([
      turnStart(1),
      contextToolCall(1, 'call-bad', NEW_CONTEXT_TOOL_NAME, { handoff: '   ' }),
      toolResult(1, 'call-bad'),
      turnEnd(1),
    ], undefined, SID)
    expect(malformed.pending).toBeNull()
  })

  it('a second successful call before the turn ends does not replace the first intent', () => {
    const events = [
      turnStart(1),
      ...newContextPair(1, 'call-1', { handoff: 'first' }),
      ...newContextPair(1, 'call-2', { handoff: 'second' }),
      turnEnd(1),
    ]
    const state = foldContextProjection(events, undefined, SID)
    expect(state.pending?.handoff).toBe('first')
  })

  it('inherited fork-prefix calls never produce intent in a seeded child', () => {
    const parentEvents = [
      turnStart(1),
      ...newContextPair(1, 'call-parent', { handoff: 'old generation' }),
      turnEnd(1),
    ]
    const childEvents: SessionEvent[] = [...parentEvents, turnStart(2), turnEnd(2)]
    // The child inherited the whole parent prefix: the same events fold to no
    // pending intent once every one of them is inside the inherited cut.
    const state = foldContextProjection(childEvents, SessionLogOffset(parentEvents.length), SID)
    expect(state.pending).toBeNull()
    expect(state.checkpoints).toEqual([])
  })

  it('the live unit folds event-by-event to the same state as the cold fold', () => {
    const events = [
      turnStart(1),
      ...newContextPair(1, 'call-1', { handoff: 'live', relatedFiles: [{ path: 'src/index.ts', reason: 'in progress' }] }),
      turnEnd(1),
    ]
    const definition = agentTeamContextProjectionDefinition(SID)
    let live = definition.init({} as never, 0 as never)
    for (const event of events) live = definition.apply(live, event)
    expect(live).toEqual(foldContextProjection(events, undefined, SID))
  })
})

describe('AgentTeam context projection — checkpoints', () => {
  it('a successful checkpoint pair resolves at its containing turn end', () => {
    const events = [
      turnStart(1),
      ...checkpointPair(1, 'call-cp', 'before-rewrite'),
      turnEnd(1),
    ]
    const state = foldContextProjection(events, undefined, SID)
    expect(state.checkpoints).toHaveLength(1)
    expect(state.checkpoints[0]).toMatchObject({
      checkpointRef: checkpointRefFor(SID, 'call-cp'),
      name: 'before-rewrite',
      turn: 1,
      turnEndSeq: events.at(-1)!.seq,
      resultSeq: events[2]!.seq,
    })
  })

  it('duplicate names stay unambiguous through opaque refs', () => {
    const events = [
      turnStart(1),
      ...checkpointPair(1, 'call-a', 'same-name'),
      turnEnd(1),
      turnStart(2),
      ...checkpointPair(2, 'call-b', 'same-name'),
      turnEnd(2),
    ]
    const state = foldContextProjection(events, undefined, SID)
    expect(state.checkpoints.map(entry => entry.name)).toEqual(['same-name', 'same-name'])
    expect(state.checkpoints[0]!.checkpointRef).not.toBe(state.checkpoints[1]!.checkpointRef)
  })

  it('an unresolved checkpoint stays at turnEndSeq -1 until its turn ends', () => {
    const events = [
      turnStart(1),
      ...checkpointPair(1, 'call-cp', 'open'),
    ]
    const state = foldContextProjection(events, undefined, SID)
    expect(state.checkpoints[0]!.turnEndSeq).toBe(-1)
  })

  it('hostile provider call ids produce bounded delimiter-free refs that still resolve', () => {
    // A 3019-char call id packed with colons, newlines, and unicode — the
    // exact shape a hostile or broken provider can emit.
    const hostile = `${'x:'.repeat(500)}${'x'.repeat(2019)}\n\`\`\`json {"a":1}\u0000`
    const ref = checkpointRefFor(SID, hostile)
    expect(ref).toMatch(/^context-checkpoint-[0-9a-f]{64}$/)
    expect(ref.length).toBe('context-checkpoint-'.length + 64)
    const events = [
      turnStart(1),
      ...checkpointPair(1, hostile, 'hostile-anchor'),
      turnEnd(1),
    ]
    const state = foldContextProjection(events, undefined, SID)
    expect(state.checkpoints[0]!.checkpointRef).toBe(ref)
    // The same pair reproduces the ref; a different call id never collides.
    expect(checkpointRefFor(SID, hostile)).toBe(ref)
    expect(checkpointRefFor(SID, `${hostile}!`)).not.toBe(ref)
  })

  it('the same call id in two different Sessions derives two distinct refs', () => {
    const callId = 'call-repeat'
    const first = checkpointRefFor('agent-team-generation-one', callId)
    const second = checkpointRefFor('agent-team-generation-two', callId)
    expect(first).not.toBe(second)
    // Consecutive generations using one repeated provider call id keep both
    // checkpoints distinct and each resolves in its own Session's fold.
    const firstEvents = [turnStart(1), ...checkpointPair(1, callId, 'gen-one'), turnEnd(1)]
    const secondEvents = [turnStart(1), ...checkpointPair(1, callId, 'gen-two'), turnEnd(1)]
    const firstState = foldContextProjection(firstEvents, undefined, 'agent-team-generation-one')
    const secondState = foldContextProjection(secondEvents, undefined, 'agent-team-generation-two')
    expect(firstState.checkpoints[0]!.checkpointRef).toBe(first)
    expect(secondState.checkpoints[0]!.checkpointRef).toBe(second)
  })
})

describe('AgentTeam context projection — quiet continuation delivery', () => {
  it('a delivered continuation notice marks delivery for its checkpoint', () => {
    const events: SessionEvent[] = [
      turnStart(1),
      ...checkpointPair(1, 'call-cp', 'anchor'),
      turnEnd(1),
    ]
    const checkpointRef = checkpointRefFor(SID, 'call-cp')
    const scheduled = withScheduledContinuation(foldContextProjection(events, undefined, SID), checkpointRef)
    expect(continuationDelivered(scheduled, checkpointRef)).toBe(false)
    const delivered = foldContextProjection([
      ...events,
      userMessageEvent(createCheckpointContinuationMessage(checkpointRef as never)),
    ], undefined, SID)
    expect(continuationDelivered(delivered, checkpointRef)).toBe(true)
  })

  it('scheduling twice is idempotent and delivery records only once', () => {
    const checkpointRef = checkpointRefFor(SID, 'call-x')
    let state: AgentTeamContextProjectionState = { checkpoints: [], pending: null, continuations: [], carriedCandidates: [], lastTurn: 0, openCalls: [], boundaries: [], lastTurnEndSeq: -1 }
    state = withScheduledContinuation(state, checkpointRef)
    state = withScheduledContinuation(state, checkpointRef)
    expect(state.continuations).toHaveLength(1)
    const delivered = foldContextProjection([userMessageEvent(createCheckpointContinuationMessage(checkpointRef as never))], undefined, SID)
    expect(continuationDelivered(delivered, checkpointRef)).toBe(true)
  })
})

describe('AgentTeam context sources', () => {
  it('the handoff message carries the snapshot form, envelope, and prose section', () => {
    const message = createHandoffMessage({
      handoff: 'objective: finish the parser\nnext step: run tests',
      previousSessionId: 'agent-team-old',
      newSessionId: 'agent-team-new',
      trigger: 'model',
      handoffEventSeq: 42,
      relatedFiles: [{ path: 'src/parser.ts', reason: 'rewritten' }],
    })
    expect(message.source).toMatchObject({
      kind: 'agent-team-context-handoff',
      form: 'snapshot',
      version: 1,
      previousSessionId: 'agent-team-old',
      newSessionId: 'agent-team-new',
      trigger: 'model',
      handoffEventSeq: 42,
    })
    const source = message.source as unknown as { sections: Array<{ name: string; text: string }>; relatedFiles?: string[] }
    expect(source.sections[0]).toMatchObject({ name: 'HANDOFF', text: 'objective: finish the parser\nnext step: run tests' })
    expect(source.relatedFiles).toEqual(['src/parser.ts'])
    expect(message.content[0]).toMatchObject({ type: 'text' })
  })

  it('checkpoint continuation notices recognize themselves regardless of body text', () => {
    const checkpointRef = checkpointRefFor(SID, 'call-cp')
    const message = createCheckpointContinuationMessage(checkpointRef as never)
    expect(message.source).toMatchObject({ kind: 'agent-team-context-continuation', form: 'notice', checkpointRef })
    expect((message.source as unknown as { summary: string }).summary).toBeTruthy()
  })
})

describe('AgentTeam context projection — timeline boundaries', () => {
  it('a handoff delivery becomes a handoff boundary resolved by its turn end', () => {
    const events = [
      turnStart(1),
      userMessageEvent(createHandoffMessage({ handoff: 'seed text', previousSessionId: 'session:a' as never, newSessionId: 'session:b' as never, trigger: 'model', handoffEventSeq: 5 as never })),
      turnEnd(1),
    ]
    const state = foldContextProjection(events, undefined, SID)
    expect(state.boundaries).toHaveLength(1)
    expect(state.boundaries[0]).toMatchObject({ source: 'handoff', turnEndSeq: events.at(-1)!.seq })
    const candidates = timelineCandidates(state, 12)
    expect(candidates.some(candidate => candidate.ref === state.boundaries[0]!.key && candidate.source === 'handoff')).toBe(true)
  })

  it('a Team claim mutation result becomes a team boundary; list calls do not', () => {
    const events = [
      turnStart(1),
      contextToolCall(1, 'call-claim', 'team_claim', { action: 'claim', taskRef: 'task:x', baseRevision: 1, direction: 'do it' }),
      toolResult(1, 'call-claim'),
      contextToolCall(1, 'call-list', 'team_claim', { action: 'list', taskRef: 'task:x' }),
      toolResult(1, 'call-list'),
      turnEnd(1),
    ]
    const state = foldContextProjection(events, undefined, SID)
    expect(state.boundaries).toHaveLength(1)
    expect(state.boundaries[0]).toMatchObject({ source: 'team-boundary', label: 'Team claim change' })
  })

  it('a structured Team notice is a team boundary; a relay DM and a checkpoint continuation are not', () => {
    const notice = createUserMessage({ content: [{ type: 'text', text: 'notice' }], source: { kind: 'plugin', plugin: '@wowyuarm/dsh-agent-team', form: 'notice', summary: 'Team Inbox has unread work.' } })
    const relay = createUserMessage({ content: [{ type: 'text', text: 'dm' }], source: { kind: 'plugin', plugin: '@wowyuarm/dsh-agent-team', form: 'relay' } })
    const continuation = createCheckpointContinuationMessage(checkpointRefFor(SID, 'call-cp'))
    const events = [
      turnStart(1),
      userMessageEvent(notice),
      userMessageEvent(relay),
      userMessageEvent(continuation),
      turnEnd(1),
    ]
    const state = foldContextProjection(events, undefined, SID)
    expect(state.boundaries).toHaveLength(1)
    expect(state.boundaries[0]!.source).toBe('team-boundary')
  })

  it('a pre-compaction notice is a compaction boundary', () => {
    const preCompaction = createUserMessage({ content: [{ type: 'text', text: 'persist conclusions' }], source: { kind: 'plugin', plugin: '@wowyuarm/dsh-agent-team', form: 'notice', summary: 'Compaction is imminent; consider persisting key conclusions.' } })
    const events = [turnStart(1), userMessageEvent(preCompaction), turnEnd(1)]
    const state = foldContextProjection(events, undefined, SID)
    expect(state.boundaries).toHaveLength(1)
    expect(state.boundaries[0]).toMatchObject({ source: 'compaction' })
  })

  it('timeline candidates order newest first, include the head, and respect the limit', () => {
    // One checkpoint per completed turn, three turns total.
    const names = ['first', 'second', 'third']
    const events: SessionEvent[] = []
    for (const [index, name] of names.entries()) {
      const turn = index + 1
      events.push(turnStart(turn), ...checkpointPair(turn, `call-${name}`, name), turnEnd(turn))
    }
    const state = foldContextProjection(events, undefined, SID)
    const candidates = timelineCandidates(state, 2)
    expect(candidates).toHaveLength(2)
    // The head (latest completed turn) is newest; the third checkpoint is
    // the next-newest anchor.
    expect(candidates[0]!.ref).toBe(`head:${state.lastTurnEndSeq}`)
    expect(candidates[1]!.ref).toBe(checkpointRefFor(SID, 'call-third'))
    const all = timelineCandidates(state, 12)
    expect(all[1]!.ref).toBe(checkpointRefFor(SID, 'call-third'))
    expect(all[2]!.ref).toBe(checkpointRefFor(SID, 'call-second'))
    expect(all[3]!.ref).toBe(checkpointRefFor(SID, 'call-first'))
  })

  it('inherited boundaries and checkpoints are invisible to a seeded child fold', () => {
    const parentEvents = [
      turnStart(1),
      ...checkpointPair(1, 'call-inherited', 'anchor'),
      turnEnd(1),
      turnStart(2),
      userMessageEvent(createCheckpointContinuationMessage(checkpointRefFor(SID, 'call-inherited'))),
      turnEnd(2),
    ]
    const inherited = parentEvents.length
    const childEvents = [...parentEvents, turnStart(3), turnEnd(3)]
    const state = foldContextProjection(childEvents, inherited as SessionLogOffset, SID)
    expect(state.checkpoints).toHaveLength(0)
    expect(state.boundaries).toHaveLength(0)
    expect(state.continuations).toHaveLength(0)
    expect(timelineCandidates(state, 12).every(candidate => !candidate.ref.includes('call-inherited'))).toBe(true)
  })
})
