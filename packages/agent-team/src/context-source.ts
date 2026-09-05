/**
 * Merge-extended message sources for Agent Team context management.
 *
 * The sources ride ordinary `UserMessage`s and never add a Harness
 * `ContextForm`: the handoff snapshot reuses the shipped `snapshot` form, the
 * quieter notices reuse `notice`. Predicates here are the single place that
 * recognizes these notices, so callers never match on localized body text.
 * @module @wowyuarm/dsh-agent-team/context-source
 */

import type { ContextSnapshotSection, UserMessage } from '@deepseek-ai/dsh-llm'
import { createUserMessage } from '@deepseek-ai/dsh-llm'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** First model-facing context of one rollover generation: the model-authored handoff plus a verifiable Host envelope. */
    'agent-team-context-handoff': AgentTeamContextHandoffSource
    /** Host-generated quiet continuation after an explicit checkpoint concluded a turn. */
    'agent-team-context-continuation': AgentTeamContextContinuationSource
  }
}

/** Envelope anchor fields the Host adds around the model's own handoff prose. */
export interface AgentTeamContextHandoffSource {
  readonly kind: 'agent-team-context-handoff'
  /** Existing semantic form: named contributions rendered by any snapshot-aware surface. */
  readonly form: 'snapshot'
  /** Envelope version; bumps when the envelope fields change meaning. */
  readonly version: 1
  /** The Member's Session before this rollover. */
  readonly previousSessionId: string
  /** The rollover generation this handoff opened. */
  readonly newSessionId: string
  /** Why the rollover happened. */
  readonly trigger: 'model' | 'pressure'
  /** Seq of the successful `new_context` tool result in the previous Session log. */
  readonly handoffEventSeq: number
  /** The checkpoint a return was seeded from; absent on a fresh rollover. */
  readonly checkpointRef?: string
  /** Workspace paths the handoff called out as relevant. */
  readonly relatedFiles?: readonly string[]
  /** Named contributions, starting with the model-authored handoff prose. */
  readonly sections: readonly ContextSnapshotSection[]
}

/** Quiet wake that continues work in the turn after an explicit checkpoint. */
export interface AgentTeamContextContinuationSource {
  readonly kind: 'agent-team-context-continuation'
  readonly form: 'notice'
  /** Stable summary identifying this notice family. */
  readonly summary: string
  /** The checkpoint this continuation follows; ties the wake to its anchor. */
  readonly checkpointRef: string
  /** Envelope version. */
  readonly version: 1
}

/** Stable one-line account for checkpoint continuation notices. */
export const CONTEXT_CONTINUATION_NOTICE_SUMMARY = 'Context checkpoint recorded; work continues in the next turn'

/** Handoff snapshot section name carrying the model-authored prose. */
export const HANDOFF_SECTION_NAME = 'HANDOFF'

/**
 * Build the first model-facing context of one rollover generation. The Host
 * owns only the verifiable envelope; the prose is the Member's own handoff.
 */
export function createHandoffMessage(input: {
  readonly handoff: string
  readonly previousSessionId: string
  readonly newSessionId: string
  readonly trigger: 'model' | 'pressure'
  readonly handoffEventSeq: number
  readonly checkpointRef?: string
  readonly relatedFiles?: readonly { readonly path: string; readonly reason?: string }[]
}): UserMessage {
  return createUserMessage({
    content: [{ type: 'text', text: handoffBody(input) }],
    source: {
      kind: 'agent-team-context-handoff',
      form: 'snapshot',
      version: 1,
      previousSessionId: input.previousSessionId,
      newSessionId: input.newSessionId,
      trigger: input.trigger,
      handoffEventSeq: input.handoffEventSeq,
      ...(input.checkpointRef === undefined ? {} : { checkpointRef: input.checkpointRef }),
      ...(input.relatedFiles === undefined || input.relatedFiles.length === 0 ? {} : { relatedFiles: input.relatedFiles.map(file => file.path) }),
      sections: [{ name: HANDOFF_SECTION_NAME, text: input.handoff }],
    },
  })
}

/**
 * Build the quiet follow-up that continues work after an explicit checkpoint
 * concluded its turn. Delivery is scheduled only after the checkpoint's
 * successful tool result is durable, so a result-render failure can never
 * leave a ghost continuation behind.
 */
export function createCheckpointContinuationMessage(checkpointRef: string): UserMessage {
  return createUserMessage({
    content: [{ type: 'text', text: 'A context checkpoint was recorded at the end of the previous turn. Continue the work you were doing.' }],
    source: { kind: 'agent-team-context-continuation', form: 'notice', summary: CONTEXT_CONTINUATION_NOTICE_SUMMARY, checkpointRef, version: 1 },
  })
}

/** Whether one user message is a rollover handoff snapshot. */
export function isHandoffMessage(message: UserMessage): boolean {
  return message.source.kind === 'agent-team-context-handoff'
}

/** Whether one user message is a checkpoint continuation notice, optionally for one checkpoint. */
export function isCheckpointContinuationMessage(message: UserMessage, checkpointRef?: string): boolean {
  const source = message.source
  return source.kind === 'agent-team-context-continuation'
    && (checkpointRef === undefined || source.checkpointRef === checkpointRef)
}

function handoffBody(input: {
  readonly handoff: string
  readonly previousSessionId: string
  readonly newSessionId: string
  readonly trigger: 'model' | 'pressure'
  readonly handoffEventSeq: number
  readonly checkpointRef?: string
  readonly relatedFiles?: readonly { readonly path: string; readonly reason?: string }[]
}): string {
  const lines = [
    'Context handoff: you are continuing as the same Team Member in a fresh private context.',
    `Previous session: ${input.previousSessionId}`,
    `New session: ${input.newSessionId}`,
    `Trigger: ${input.trigger}`,
    ...(input.checkpointRef === undefined ? [] : [`Continued from checkpoint: ${input.checkpointRef}`]),
    ...(input.relatedFiles === undefined || input.relatedFiles.length === 0 ? [] : [`Related files: ${input.relatedFiles.map(file => file.path).join(', ')}`]),
    '',
    'Your handoff from the previous context follows. Verify external state before relying on it; a context change never rolls back files, processes, Team facts, or remote side effects.',
    '',
    input.handoff,
  ]
  return lines.join('\n')
}
