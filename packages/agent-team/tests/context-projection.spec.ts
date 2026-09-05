import { beforeEach, describe, expect, it } from 'vitest'
import { createToolResultMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import { SessionLogOffset, SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import {
  CONTEXT_CHECKPOINT_TOOL_NAME,
  NEW_CONTEXT_TOOL_NAME,
  agentTeamContextProjectionDefinition,
  checkpointRefFor,
  continuationDelivered,
  foldContextProjection,
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
    const state = foldContextProjection(events)
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
    ])
    expect(failed.pending).toBeNull()
    // Internal failure identity on the result event.
    const internal = foldContextProjection([
      turnStart(1),
      contextToolCall(1, 'call-int', NEW_CONTEXT_TOOL_NAME, { handoff: 'x' }),
      toolResult(1, 'call-int', { internalError: true }),
      turnEnd(1),
    ])
    expect(internal.pending).toBeNull()
    // Dangling call: result never landed before the cut.
    const dangling = foldContextProjection([
      turnStart(1),
      contextToolCall(1, 'call-open', NEW_CONTEXT_TOOL_NAME, { handoff: 'x' }),
      turnEnd(1),
    ])
    expect(dangling.pending).toBeNull()
    // Malformed arguments: empty handoff after trim.
    const malformed = foldContextProjection([
      turnStart(1),
      contextToolCall(1, 'call-bad', NEW_CONTEXT_TOOL_NAME, { handoff: '   ' }),
      toolResult(1, 'call-bad'),
      turnEnd(1),
    ])
    expect(malformed.pending).toBeNull()
  })

  it('a second successful call before the turn ends does not replace the first intent', () => {
    const events = [
      turnStart(1),
      ...newContextPair(1, 'call-1', { handoff: 'first' }),
      ...newContextPair(1, 'call-2', { handoff: 'second' }),
      turnEnd(1),
    ]
    const state = foldContextProjection(events)
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
    const state = foldContextProjection(childEvents, SessionLogOffset(parentEvents.length))
    expect(state.pending).toBeNull()
    expect(state.checkpoints).toEqual([])
  })

  it('the live unit folds event-by-event to the same state as the cold fold', () => {
    const events = [
      turnStart(1),
      ...newContextPair(1, 'call-1', { handoff: 'live', relatedFiles: [{ path: 'src/index.ts', reason: 'in progress' }] }),
      turnEnd(1),
    ]
    let live = agentTeamContextProjectionDefinition.init({} as never, 0 as never)
    for (const event of events) live = agentTeamContextProjectionDefinition.apply(live, event)
    expect(live).toEqual(foldContextProjection(events))
  })
})

describe('AgentTeam context projection — checkpoints', () => {
  it('a successful checkpoint pair resolves at its containing turn end', () => {
    const events = [
      turnStart(1),
      ...checkpointPair(1, 'call-cp', 'before-rewrite'),
      turnEnd(1),
    ]
    const state = foldContextProjection(events)
    expect(state.checkpoints).toHaveLength(1)
    expect(state.checkpoints[0]).toMatchObject({
      checkpointRef: checkpointRefFor('call-cp'),
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
    const state = foldContextProjection(events)
    expect(state.checkpoints.map(entry => entry.name)).toEqual(['same-name', 'same-name'])
    expect(state.checkpoints[0]!.checkpointRef).not.toBe(state.checkpoints[1]!.checkpointRef)
  })

  it('an unresolved checkpoint stays at turnEndSeq -1 until its turn ends', () => {
    const events = [
      turnStart(1),
      ...checkpointPair(1, 'call-cp', 'open'),
    ]
    const state = foldContextProjection(events)
    expect(state.checkpoints[0]!.turnEndSeq).toBe(-1)
  })
})

describe('AgentTeam context projection — quiet continuation delivery', () => {
  it('a delivered continuation notice marks delivery for its checkpoint', () => {
    const events: SessionEvent[] = [
      turnStart(1),
      ...checkpointPair(1, 'call-cp', 'anchor'),
      turnEnd(1),
    ]
    const checkpointRef = checkpointRefFor('call-cp')
    const scheduled = withScheduledContinuation(foldContextProjection(events), checkpointRef)
    expect(continuationDelivered(scheduled, checkpointRef)).toBe(false)
    const delivered = foldContextProjection([
      ...events,
      userMessageEvent(createCheckpointContinuationMessage(checkpointRef as never)),
    ])
    expect(continuationDelivered(delivered, checkpointRef)).toBe(true)
  })

  it('scheduling twice is idempotent and delivery records only once', () => {
    const checkpointRef = checkpointRefFor('call-x')
    let state: AgentTeamContextProjectionState = { checkpoints: [], pending: null, continuations: [], carriedCandidates: [], lastTurn: 0, openCalls: [] }
    state = withScheduledContinuation(state, checkpointRef)
    state = withScheduledContinuation(state, checkpointRef)
    expect(state.continuations).toHaveLength(1)
    const delivered = foldContextProjection([userMessageEvent(createCheckpointContinuationMessage(checkpointRef as never))])
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
    const checkpointRef = checkpointRefFor('call-cp')
    const message = createCheckpointContinuationMessage(checkpointRef as never)
    expect(message.source).toMatchObject({ kind: 'agent-team-context-continuation', form: 'notice', checkpointRef })
    expect((message.source as unknown as { summary: string }).summary).toBeTruthy()
  })
})
