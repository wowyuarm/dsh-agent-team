/**
 * Plugin-attributed message sources for Agent Team context management.
 *
 * Both sources ride ordinary `UserMessage`s under the shipped `plugin` kind
 * with the `snapshot` context form — the same shape the Harness's own
 * system-prompt producer writes. This module declares no `MessageSourceMap`
 * member of its own, and carries no bespoke source members: Session format
 * migration validates a `plugin` source against a closed member list
 * (`kind`, `plugin`, `form`, `sections`, `summary`), and refuses every logged
 * Session that carries anything else. A plugin-declared kind is type-legal yet
 * refused the same way. See `docs/dsh-release-compatibility.md`
 * § "Session message sources".
 *
 * Everything the Host needs to read back therefore rides the admitted payload
 * slots: the handoff envelope and the checkpoint correlation both travel as
 * named {@link ContextSnapshotSection} contributions, distinguished by their
 * stable section names. Sections are the format's designed slot for structured
 * producer payload, and they render as named contributions on any
 * snapshot-aware surface.
 *
 * The validators below are the single place that recognizes these messages, so
 * callers never match on localized body text.
 * @module @wowyuarm/dsh-agent-team/context-source
 */

import type { ContextSnapshotSection, UserMessage } from '@deepseek-ai/dsh-llm'
import { createUserMessage } from '@deepseek-ai/dsh-llm'

/** Plugin identity attributing every Agent Team message source. */
export const AGENT_TEAM_PLUGIN_ID = '@wowyuarm/dsh-agent-team'

/** Handoff snapshot section name carrying the model-authored prose. */
export const HANDOFF_SECTION_NAME = 'HANDOFF'

/** Stable section name marking a checkpoint continuation and carrying its ref. */
export const CHECKPOINT_SECTION_NAME = 'Checkpoint'

/** Fixed text of the quiet checkpoint continuation delivered on the next turn. */
export const CHECKPOINT_CONTINUATION_TEXT = 'A context checkpoint was recorded at the end of the previous turn. Continue the work you were doing.'

/**
 * The rollover handoff envelope: the model-authored prose plus the verifiable
 * Host facts, all as named snapshot contributions.
 */
export interface AgentTeamContextHandoff {
  /** The Member's Session before this rollover. */
  readonly previousSessionId: string
  /** The rollover generation this handoff opened. */
  readonly newSessionId: string
  /** Why the rollover happened. */
  readonly trigger: 'model' | 'pressure'
  /** Seq of the successful `context_rollover` tool result in the previous Session log. */
  readonly handoffEventSeq: number
  /** The checkpoint a return was seeded from; absent on a fresh rollover. */
  readonly checkpointRef?: string
  /** Workspace paths the handoff called out as relevant. */
  readonly relatedFiles?: readonly string[]
  /** Named contributions, starting with the model-authored handoff prose. */
  readonly sections: readonly ContextSnapshotSection[]
}

/**
 * Build the first model-facing context of one rollover generation. The Host
 * owns only the verifiable envelope; the prose is the Member's own handoff.
 *
 * The envelope sections are additive structure, not the only carrier of these
 * facts: {@link handoffBody} already states them in the model-facing text, so a
 * surface that renders only the body loses nothing.
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
      kind: 'plugin',
      plugin: AGENT_TEAM_PLUGIN_ID,
      form: 'snapshot',
      sections: handoffSections(input),
    },
  })
}

/**
 * Build the quiet follow-up that continues work after an explicit checkpoint
 * concluded its turn. Delivery is scheduled only after the checkpoint's
 * successful tool result is durable, so a result-render failure can never
 * leave a ghost continuation behind.
 *
 * This is a `snapshot` rather than a `notice` for one reason: the projection
 * must read the checkpoint ref back out of the durable log to record delivery,
 * and `sections` is the only admitted payload slot that carries structure. A
 * notice would have forced the ref into its human-readable one-line summary.
 */
export function createCheckpointContinuationMessage(checkpointRef: string): UserMessage {
  return createUserMessage({
    content: [{ type: 'text', text: CHECKPOINT_CONTINUATION_TEXT }],
    source: {
      kind: 'plugin',
      plugin: AGENT_TEAM_PLUGIN_ID,
      form: 'snapshot',
      sections: [{ name: CHECKPOINT_SECTION_NAME, text: checkpointRef }],
    },
  })
}

/**
 * Read one message's snapshot sections when it is this plugin's own snapshot.
 * @param message - candidate user message.
 * @returns the sections, or `undefined` when another producer owns the message.
 */
function ownSections(message: UserMessage): readonly ContextSnapshotSection[] | undefined {
  const source = message.source
  if (source.kind !== 'plugin' || source.plugin !== AGENT_TEAM_PLUGIN_ID) return undefined
  if (source.form !== 'snapshot') return undefined
  return source.sections
}

/** The text of one named section, or undefined when it is absent. */
function sectionText(sections: readonly ContextSnapshotSection[], name: string): string | undefined {
  return sections.find(section => section.name === name)?.text
}

/**
 * Decode the `Related files` section. The Host writes the exact path array as
 * JSON, which round-trips every path a file system admits — including one
 * containing a comma, which the `', '`-joined form this replaced could not.
 * Sections written before that encoding are still read; the legacy split is a
 * read-side accommodation for old generations, never a write path.
 */
function parseRelatedFiles(text: string): readonly string[] {
  try {
    const parsed: unknown = JSON.parse(text)
    if (Array.isArray(parsed) && parsed.every(path => typeof path === 'string' && path.length > 0)) {
      return parsed as readonly string[]
    }
  } catch {
    // Not JSON: the section predates the JSON encoding.
  }
  return text.split(', ').filter(path => path.length > 0)
}

/**
 * The rollover handoff one message carries, when it is one.
 * @param message - candidate user message.
 * @returns the envelope, or `undefined` when the message is not a handoff.
 */
export function handoffOf(message: UserMessage): AgentTeamContextHandoff | undefined {
  const sections = ownSections(message)
  if (sections === undefined) return undefined
  const handoff = sectionText(sections, HANDOFF_SECTION_NAME)
  if (handoff === undefined) return undefined
  const previousSessionId = sectionText(sections, HANDOFF_PREVIOUS_SESSION)
  const newSessionId = sectionText(sections, HANDOFF_NEW_SESSION)
  const trigger = sectionText(sections, HANDOFF_TRIGGER)
  const handoffEventSeq = sectionText(sections, HANDOFF_EVENT_SEQ)
  if (previousSessionId === undefined || newSessionId === undefined) return undefined
  if (trigger !== 'model' && trigger !== 'pressure') return undefined
  const seq = Number(handoffEventSeq)
  if (handoffEventSeq === undefined || !Number.isSafeInteger(seq)) return undefined
  const checkpointRef = sectionText(sections, HANDOFF_CHECKPOINT)
  const relatedFiles = sectionText(sections, HANDOFF_RELATED_FILES)
  return {
    previousSessionId,
    newSessionId,
    trigger,
    handoffEventSeq: seq,
    ...(checkpointRef === undefined ? {} : { checkpointRef }),
    ...(relatedFiles === undefined ? {} : { relatedFiles: parseRelatedFiles(relatedFiles) }),
    sections,
  }
}

/**
 * The checkpoint ref one continuation notice carries, when the message is one.
 * @param message - candidate user message.
 * @returns the checkpoint ref, or `undefined` when the message is not a continuation.
 */
export function continuationCheckpointRefOf(message: UserMessage): string | undefined {
  const sections = ownSections(message)
  if (sections === undefined || sections.length !== 1) return undefined
  const ref = sectionText(sections, CHECKPOINT_SECTION_NAME)
  return ref === undefined || ref.length === 0 ? undefined : ref
}

/** Whether one user message is a rollover handoff snapshot. */
export function isHandoffMessage(message: UserMessage): boolean {
  return handoffOf(message) !== undefined
}

/** Whether one user message is a checkpoint continuation, optionally for one checkpoint. */
export function isCheckpointContinuationMessage(message: UserMessage, checkpointRef?: string): boolean {
  const ref = continuationCheckpointRefOf(message)
  return ref !== undefined && (checkpointRef === undefined || ref === checkpointRef)
}

/**
 * Whether one message carries a rollover-handoff or checkpoint-continuation
 * envelope. Ordinary Team notices share this plugin's attribution, so callers
 * that replace rederived notices must exclude these two families explicitly.
 */
export function isAgentTeamContextSource(message: UserMessage): boolean {
  return isHandoffMessage(message) || isCheckpointContinuationMessage(message)
}

/** Envelope section names; stable, because they are read back from the log. */
const HANDOFF_PREVIOUS_SESSION = 'Previous session'
const HANDOFF_NEW_SESSION = 'New session'
const HANDOFF_TRIGGER = 'Trigger'
const HANDOFF_EVENT_SEQ = 'Handoff event seq'
const HANDOFF_CHECKPOINT = 'Continued from checkpoint'
const HANDOFF_RELATED_FILES = 'Related files'

/** The envelope contributions of one handoff, prose first. */
function handoffSections(input: {
  readonly handoff: string
  readonly previousSessionId: string
  readonly newSessionId: string
  readonly trigger: 'model' | 'pressure'
  readonly handoffEventSeq: number
  readonly checkpointRef?: string
  readonly relatedFiles?: readonly { readonly path: string; readonly reason?: string }[]
}): readonly ContextSnapshotSection[] {
  return [
    { name: HANDOFF_SECTION_NAME, text: input.handoff },
    { name: HANDOFF_PREVIOUS_SESSION, text: input.previousSessionId },
    { name: HANDOFF_NEW_SESSION, text: input.newSessionId },
    { name: HANDOFF_TRIGGER, text: input.trigger },
    { name: HANDOFF_EVENT_SEQ, text: String(input.handoffEventSeq) },
    ...(input.checkpointRef === undefined ? [] : [{ name: HANDOFF_CHECKPOINT, text: input.checkpointRef }]),
    ...(input.relatedFiles === undefined || input.relatedFiles.length === 0
      ? []
      : [{ name: HANDOFF_RELATED_FILES, text: JSON.stringify(input.relatedFiles.map(file => file.path)) }]),
  ]
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
