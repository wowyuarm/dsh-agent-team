/**
 * Released-format migration fence for Agent Team message sources.
 *
 * The Harness validates every durable message source against a closed member
 * list when it migrates a logged Session forward, and refuses the whole
 * Session when a plugin source carries anything outside that list. Nothing
 * else in this repository exercises that contract: the host specs build
 * Sessions natively at the current format version and never migrate one, so an
 * incompatible source is invisible until a real user upgrades with existing
 * history — exactly how the v0.1.5 custom-kind break reached a live install.
 *
 * This spec drives the real migration stage over the messages this package
 * actually writes, with the retired shapes kept as negative controls so the
 * assertions cannot silently stop testing anything.
 *
 * The migration packages resolve through the sibling Harness checkout that
 * `scripts/link-harness-packages.mjs` links, like the other Harness imports in
 * this suite — they are the contract under test, not a build dependency.
 */
import { describe, expect, it } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionFormatEventCollector } from '@deepseek-ai/dsh-session-format'
import { restoreReleasedV3Artifact, sessionFormatV2ToV3 } from '@deepseek-ai/dsh-session-format-v2-to-v3'
import {
  AGENT_TEAM_PLUGIN_ID,
  CHECKPOINT_SECTION_NAME,
  HANDOFF_SECTION_NAME,
  continuationCheckpointRefOf,
  createCheckpointContinuationMessage,
  createHandoffMessage,
  handoffOf,
  isCheckpointContinuationMessage,
  isHandoffMessage,
} from '../src/context-source.ts'

const header = { version: 2, id: 'context-source-migration', createdAt: 1, isSeeded: false, delegationDepth: 0 }

/** Migrate one v2 user message through the released v2→v3 stage and admit the artifact. */
function migrateUserMessage(source: unknown): void {
  const target = sessionFormatV2ToV3.migrateHeader(header)
  const stage = sessionFormatV2ToV3.createStage({
    sourceHeader: header,
    targetHeader: target,
    sourceInheritedEventCount: 0,
    sourceKind: 'decoded',
  })
  const collector = new SessionFormatEventCollector()
  const events = [
    { type: 'turn/start', time: 1, data: { turn: 1 } },
    { type: 'step/start', time: 1, data: { turn: 1, step: 1 } },
    {
      type: 'user/message',
      time: 1,
      surfaceOp: 'append',
      data: { id: 'message', role: 'user', content: [{ type: 'text', text: 'body' }], source },
    },
  ] as const
  for (const [seq, event] of events.entries()) {
    stage.transformEvent({ ...event, seq } as never, collector)
  }
  restoreReleasedV3Artifact(
    { header: target, inheritedEventCount: stage.finish(collector), events: collector.values },
    new Set(),
  )
}

const handoffInput = {
  handoff: 'objective: finish the parser\nnext step: run tests',
  previousSessionId: 'agent-team-previous',
  newSessionId: 'agent-team-next',
  trigger: 'model' as const,
  handoffEventSeq: 42,
  checkpointRef: 'context-checkpoint-abc',
  relatedFiles: [{ path: 'src/parser.ts', reason: 'rewritten' }],
}

describe('Agent Team message sources survive released-format migration', () => {
  it('migrates the rollover handoff this package writes', () => {
    expect(() => migrateUserMessage(createHandoffMessage(handoffInput).source)).not.toThrow()
  })

  it('migrates the checkpoint continuation this package writes', () => {
    expect(() => migrateUserMessage(createCheckpointContinuationMessage('context-checkpoint-abc').source)).not.toThrow()
  })

  it('refuses the retired custom kinds, so this fence still has teeth', () => {
    // The shapes this package wrote before the v0.1.5 cut: a plugin-declared
    // MessageSourceMap kind, and the same payload reopened under the admitted
    // `plugin` kind while still carrying bespoke envelope members.
    expect(() => migrateUserMessage({
      kind: 'agent-team-context-handoff',
      form: 'snapshot',
      version: 1,
      previousSessionId: 'a',
      newSessionId: 'b',
      trigger: 'model',
      handoffEventSeq: 1,
      sections: [{ name: HANDOFF_SECTION_NAME, text: 'prose' }],
    })).toThrow(/unclassified message source/)
    expect(() => migrateUserMessage({
      kind: 'plugin',
      plugin: AGENT_TEAM_PLUGIN_ID,
      form: 'snapshot',
      version: 1,
      sections: [{ name: HANDOFF_SECTION_NAME, text: 'prose' }],
    })).toThrow(/unexpected member/)
  })
})

describe('Agent Team message sources read back through the admitted slots', () => {
  it('recovers the whole handoff envelope from its named sections', () => {
    const message = createHandoffMessage(handoffInput)
    expect(isHandoffMessage(message)).toBe(true)
    expect(handoffOf(message)).toMatchObject({
      previousSessionId: 'agent-team-previous',
      newSessionId: 'agent-team-next',
      trigger: 'model',
      handoffEventSeq: 42,
      checkpointRef: 'context-checkpoint-abc',
      relatedFiles: ['src/parser.ts'],
    })
    expect(handoffOf(message)?.sections[0]).toEqual({ name: HANDOFF_SECTION_NAME, text: handoffInput.handoff })
  })

  it('omits absent optional envelope facts instead of inventing them', () => {
    const { checkpointRef: _checkpointRef, relatedFiles: _relatedFiles, ...bare } = handoffInput
    const message = createHandoffMessage(bare)
    const handoff = handoffOf(message)
    expect(handoff).toBeDefined()
    expect(handoff?.checkpointRef).toBeUndefined()
    expect(handoff?.relatedFiles).toBeUndefined()
  })

  it('recovers the checkpoint ref from a continuation, exactly and by identity', () => {
    const ref = 'context-checkpoint-0123456789abcdef'
    const message = createCheckpointContinuationMessage(ref)
    expect(continuationCheckpointRefOf(message)).toBe(ref)
    expect(isCheckpointContinuationMessage(message)).toBe(true)
    expect(isCheckpointContinuationMessage(message, ref)).toBe(true)
    expect(isCheckpointContinuationMessage(message, 'context-checkpoint-other')).toBe(false)
    expect(message.source).toMatchObject({
      kind: 'plugin',
      plugin: AGENT_TEAM_PLUGIN_ID,
      form: 'snapshot',
      sections: [{ name: CHECKPOINT_SECTION_NAME, text: ref }],
    })
  })

  it('does not claim another producer’s snapshot or a foreign plugin message', () => {
    // The shipped system prompt writes the same plugin+snapshot shape.
    const foreign = {
      kind: 'plugin' as const,
      plugin: '@deepseek-ai/dsh-system-prompt',
      form: 'snapshot' as const,
      sections: [{ name: 'runtime', text: 'context' }],
    }
    const message = createUserMessage({ content: [{ type: 'text', text: 'body' }], source: foreign })
    expect(isHandoffMessage(message)).toBe(false)
    expect(continuationCheckpointRefOf(message)).toBeUndefined()
    // Our own snapshot without the handoff marker is not a handoff either.
    expect(isHandoffMessage(createUserMessage({
      content: [{ type: 'text', text: 'body' }],
      source: { kind: 'plugin', plugin: AGENT_TEAM_PLUGIN_ID, form: 'snapshot', sections: [{ name: 'other', text: 'x' }] },
    }))).toBe(false)
  })
})
