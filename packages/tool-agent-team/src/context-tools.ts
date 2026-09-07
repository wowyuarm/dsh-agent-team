/**
 * Model-facing context-management tools for Team Members. Thin adapters
 * only: validation runs in the Host adapter, the successful result is the
 * durable intent, and every lifecycle side effect — generation swap, Session
 * creation, inbox handling — happens in the Host coordinator after the
 * result is durably appended. `concludeTurn()` rides the success result of
 * `context_rollover` and `context_checkpoint`, so sibling calls settle in model
 * order before the turn closes.
 * @module @wowyuarm/dsh-agent-team/context-tools
 */

import AgentTeam from '@wowyuarm/dsh-agent-team/host'
import type { AgentTeamContextCheckpointRef } from '@wowyuarm/dsh-agent-team/types'
import { defineTool } from '@deepseek-ai/dsh-tools'

function service(agent: NonNullable<Parameters<AgentTeam['memberForAgent']>[0]>): AgentTeam {
  const host = agent.ctx.get('agentTeam') as AgentTeam | undefined
  if (host === undefined) throw new Error('Agent Team Host is unavailable')
  return host
}

function member(agent: NonNullable<Parameters<AgentTeam['memberForAgent']>[0]>) {
  const current = service(agent).memberForAgent(agent)
  if (current === undefined) throw new Error('team tool requires an active Team Member')
  return current
}

const MAX_HANDOFF_CHARS = 32 * 1024
const MAX_RELATED_FILES = 32

const contextRollover = defineTool({
  name: 'context_rollover',
  description: 'context_rollover: end this context generation and continue as the same Team Member in a new one. Without checkpointRef the context starts fresh and empty, seeded only by your handoff — this is the default, cheapest path at context pressure. With a context_timeline checkpointRef the new context resumes from that completed-turn anchor plus your handoff; use it to discard a failed later branch while keeping the earlier working set. Write the handoff as one prose string covering: current objective and every active Thread/Claim; verified facts and evidence; inferences and unresolved conflicts; current external side effects and their verification state (files, git, jobs, browser state, remote calls); one explicit next step. A context change never rolls back any external effect — describe current state so the next generation can re-verify. Record anything worth keeping in your private memory/notes first. Collect or stop your background jobs before calling: a rollover is refused while jobs this Member owns are still running.',
  parameters: {
    handoff: { type: 'string', required: true, description: 'Prose handoff for the next context generation: objective, active Threads/Claims, verified facts, inferences, external side effects and their verification state, next step.' },
    checkpointRef: { type: 'string', description: 'Opaque checkpoint ref exactly as returned by context_timeline; resumes from that completed-turn anchor instead of an empty context.' },
    relatedFiles: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { path: { type: 'string', required: true }, reason: { type: 'string', required: true } } }, description: 'Workspace paths the next generation should look at first, each with one reason.' },
  },
  output: {
    schema: { type: 'object', additionalProperties: false, properties: {
      mode: { type: 'string', required: true }, status: { type: 'string', required: true },
    } },
    render: (_args, value) => [{ type: 'text', text: `Context rollover scheduled (${value.mode}). Finish this turn; the Host switches you to the next context generation afterward.` }],
  },
  async execute(args, exec) {
    const agent = exec.agent
    if (agent === undefined) throw new Error('context_rollover requires an Agent session')
    const current = member(agent)
    const host = service(agent)
    const handoff = typeof args.handoff === 'string' ? args.handoff : ''
    if (handoff.trim() === '') throw new Error('context_rollover requires a non-empty handoff')
    if (handoff.length > MAX_HANDOFF_CHARS) throw new Error(`context_rollover handoff exceeds ${MAX_HANDOFF_CHARS} characters`)
    const relatedFilesInput = Array.isArray(args.relatedFiles) ? args.relatedFiles : []
    if (relatedFilesInput.length > MAX_RELATED_FILES) throw new Error(`context_rollover accepts at most ${MAX_RELATED_FILES} related files`)
    // Tool argument validation is layered: the Harness schema (required and
    // type checks) rejects at the execute boundary, and this body adds the
    // checks the schema cannot express — each related file is validated
    // here, so a blank path/reason rejects instead of seeding the handoff
    // envelope with empty fields.
    const relatedFiles: Array<{ path: string; reason: string }> = []
    for (const [index, entry] of relatedFilesInput.entries()) {
      if (typeof entry !== 'object' || entry === null) throw new Error(`context_rollover relatedFiles[${index}] must be an object with path and reason`)
      const candidate = entry as { path?: unknown; reason?: unknown }
      if (typeof candidate.path !== 'string' || candidate.path.trim() === '') throw new Error(`context_rollover relatedFiles[${index}].path must be a non-empty string`)
      if (typeof candidate.reason !== 'string' || candidate.reason.trim() === '') throw new Error(`context_rollover relatedFiles[${index}].reason must be a non-empty string`)
      relatedFiles.push({ path: candidate.path, reason: candidate.reason })
    }
    // Tool schemas are open at the root (Harness parameter specs set no
    // `additionalProperties: false`), so an undeclared shape can still reach
    // the body. Any supplied value that is not a non-empty string rejects
    // here rather than being treated as absent — an absent ref means fresh,
    // which is not what the model asked for.
    const raw = args as { checkpointRef?: unknown }
    const suppliedRef = Object.hasOwn(raw, 'checkpointRef') ? raw.checkpointRef : undefined
    if (suppliedRef !== undefined && (typeof suppliedRef !== 'string' || suppliedRef.trim() === '')) {
      throw new Error('context_rollover checkpointRef must be a non-empty string when supplied')
    }
    const checkpointRef = typeof suppliedRef === 'string' ? suppliedRef.trim() : undefined
    const outcome = await host.requestNewContext(agent, {
      memberId: current.memberId,
      ...(checkpointRef === undefined || checkpointRef === '' ? {} : { checkpointRef: checkpointRef as AgentTeamContextCheckpointRef }),
      ...(relatedFiles.length === 0 ? {} : { relatedFiles }),
    })
    exec.concludeTurn()
    return { mode: outcome.mode, status: 'scheduled' }
  },
})

const contextCheckpoint = defineTool({
  name: 'context_checkpoint',
  description: 'Record a named checkpoint at the end of the current turn: an opaque, private, restorable anchor for this Member\'s context lineage. Use it before a noisy or risky phase — a broad refactor, an experiment whose value is unproven — when returning to the current completed state may later be useful. The checkpoint resolves only when this turn completes; the Host continues work in the next turn automatically. A checkpoint never snapshots files, git, jobs, or any external state: returning to one (via context_rollover with its checkpointRef) resumes the conversation prefix and nothing else. Checkpoints are private context structure, not Team facts, and are never visible to other Members.',
  parameters: {
    name: { type: 'string', required: true, description: 'Short semantic label for this checkpoint, shown in context_timeline.' },
  },
  output: {
    schema: { type: 'object', additionalProperties: false, properties: {
      checkpointRef: { type: 'string', required: true }, name: { type: 'string', required: true },
    } },
    // The ref is the selection surface for `context_rollover`: rendering only the
    // name left the model with no legitimate way to cite the anchor it just
    // recorded. Renders are the only channel results reach the model through.
    render: (_args, value) => [{ type: 'text', text: `Checkpoint recorded: ${value.name} (ref: ${value.checkpointRef}). Work continues in the next turn; the Host will continue automatically.` }],
  },
  async execute(args, exec) {
    const agent = exec.agent
    if (agent === undefined) throw new Error('context_checkpoint requires an Agent session')
    const current = member(agent)
    const host = service(agent)
    const name = typeof args.name === 'string' ? args.name : ''
    // The Host validates binding, running-turn fencing, and the name budget;
    // the durable checkpoint is the successful call/result pair the Session
    // projection folds, and the ref derives from the tool call id.
    const outcome = host.recordCheckpointForAgent(agent, { memberId: current.memberId, callId: exec.callId, name })
    exec.concludeTurn()
    return { checkpointRef: outcome.checkpointRef, name: outcome.name }
  },
})

const contextTimeline = defineTool({
  name: 'context_timeline',
  description: 'Inspect the bounded structural timeline of this Member\'s context lineage: named checkpoints you recorded, Team delivery boundaries (claim changes and structured Team notifications that entered your context), handoff and compaction boundaries, and the current head — across the current generation and its archived ancestors. Returns approximate retained/discarded token estimates, current usage against the pressure budget, the Threads whose facts entered your context by each anchor, and which anchors are restorable. A Team delivery anchor is a selectable default checkpoint exactly when it resolved at a completed turn and exactly one Thread is attributable to it; unattributable or multi-Thread boundaries state their reason. Structural only: no transcript content. Use it to pick the smallest sufficient `checkpointRef` for a return, or to confirm that a fresh handoff is the better path when every anchor is marked non-restorable.',
  parameters: {
    limit: { type: 'number', description: 'Maximum number of items to return (default 12, at most 24).' },
  },
  output: {
    schema: { type: 'object', additionalProperties: false, properties: {
      usageTokens: { type: 'number', required: true },
      hardLimit: { type: 'number', required: true },
      handoffAt: { type: 'number', required: true },
      items: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
        checkpointRef: { type: 'string', required: true },
        name: { type: 'string', required: true },
        source: { type: 'string', required: true },
        retainedTokens: { type: 'number', required: true },
        discardedTokens: { type: 'number', required: true },
        affectedThreads: { type: 'array', required: true, items: { type: 'string' } },
        restorable: { type: 'boolean', required: true },
        reason: { type: 'string' },
        sourceSessionId: { type: 'string' },
      } } },
    } },
    // The item list is the whole decision surface: without each anchor's
    // ref, label, source, size estimates, affected Threads, and
    // restorable/reason verdict, the model cannot pick a `checkpointRef` for
    // `context_rollover` — the summary line alone left the tool unusable for
    // seeded returns. The Host bounds items (default 12, at most 24), so this
    // list cannot grow unbounded.
    render: (_args, value) => {
      const lines = [`Context timeline: ${value.usageTokens} tokens used (handoff at ${value.handoffAt}, hard limit ${value.hardLimit}). ${value.items.length} item(s):`]
      for (const item of value.items) {
        const threads = item.affectedThreads.length === 0 ? 'no Threads' : `Threads ${item.affectedThreads.join(', ')}`
        const size = `retained ~${item.retainedTokens}, discarded ~${item.discardedTokens}`
        const restorable = item.restorable
          ? `restorable — ref: ${item.checkpointRef}`
          : `not restorable — ${item.reason ?? 'no reason given'}`
        lines.push(`- ${item.name} [source: ${item.source}] (${size}; ${threads}) — ${restorable}`)
      }
      return [{ type: 'text', text: lines.join('\n') }]
    },
  },
  async execute(args, exec) {
    const agent = exec.agent
    if (agent === undefined) throw new Error('context_timeline requires an Agent session')
    const current = member(agent)
    const host = service(agent)
    const limit = typeof args.limit === 'number' ? args.limit : undefined
    const result = await host.contextTimelineForAgent(agent, { memberId: current.memberId, ...(limit === undefined ? {} : { limit }) })
    // The Host result is deeply immutable; the tool output contract carries
    // plain arrays, so re-shape without any semantic change.
    return { usageTokens: result.usageTokens, hardLimit: result.hardLimit, handoffAt: result.handoffAt, items: result.items.map(item => ({ ...item, affectedThreads: [...item.affectedThreads] })) }
  },
})

export function registerContextTools(ctx: { readonly tools: { register(tool: unknown): void } }): void {
  ctx.tools.register(contextRollover)
  ctx.tools.register(contextCheckpoint)
  ctx.tools.register(contextTimeline)
}
