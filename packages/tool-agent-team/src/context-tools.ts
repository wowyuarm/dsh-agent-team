/**
 * Model-facing context-management tools for Team Members. Thin adapters
 * only: validation runs in the Host adapter, the successful result is the
 * durable intent, and every lifecycle side effect — generation swap, Session
 * creation, inbox handling — happens in the Host coordinator after the
 * result is durably appended. `concludeTurn()` rides the success result, so
 * sibling calls settle in model order before the turn closes.
 * @module @wowyuarm/dsh-agent-team/context-tools
 */

import AgentTeam from '@wowyuarm/dsh-agent-team/host'
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

const newContext = defineTool({
  name: 'new_context',
  description: 'Continue as the same Team Member in a fresh private context seeded by your handoff. Write the handoff as one prose string covering: current objective and every active Thread/Claim; verified facts and evidence; inferences and unresolved conflicts; current external side effects and their verification state; one explicit next step. A context change never rolls back files, git, processes, browser state, Team facts, or remote side effects — describe their current state so the next generation can re-verify. The new context starts empty: record anything worth keeping in your private memory/notes before calling. Collect or stop your background jobs first: a rollover is refused while jobs this Member owns are still running.',
  parameters: {
    handoff: { type: 'string', required: true, description: 'Prose handoff for the next context generation: objective, active Threads/Claims, verified facts, inferences, external side effects, next step.' },
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
    if (agent === undefined) throw new Error('new_context requires an Agent session')
    const current = member(agent)
    const host = service(agent)
    const handoff = typeof args.handoff === 'string' ? args.handoff : ''
    if (handoff.trim() === '') throw new Error('new_context requires a non-empty handoff')
    if (handoff.length > MAX_HANDOFF_CHARS) throw new Error(`new_context handoff exceeds ${MAX_HANDOFF_CHARS} characters`)
    const relatedFilesInput = Array.isArray(args.relatedFiles) ? args.relatedFiles : []
    if (relatedFilesInput.length > MAX_RELATED_FILES) throw new Error(`new_context accepts at most ${MAX_RELATED_FILES} related files`)
    // Tool argument validation is layered: the Harness schema (required and
    // type checks) rejects at the execute boundary, and this body adds the
    // checks the schema cannot express — each related file is validated
    // here, so a blank path/reason rejects instead of seeding the handoff
    // envelope with empty fields.
    const relatedFiles: Array<{ path: string; reason: string }> = []
    for (const [index, entry] of relatedFilesInput.entries()) {
      if (typeof entry !== 'object' || entry === null) throw new Error(`new_context relatedFiles[${index}] must be an object with path and reason`)
      const candidate = entry as { path?: unknown; reason?: unknown }
      if (typeof candidate.path !== 'string' || candidate.path.trim() === '') throw new Error(`new_context relatedFiles[${index}].path must be a non-empty string`)
      if (typeof candidate.reason !== 'string' || candidate.reason.trim() === '') throw new Error(`new_context relatedFiles[${index}].reason must be a non-empty string`)
      relatedFiles.push({ path: candidate.path, reason: candidate.reason })
    }
    // Tool schemas are open at the root (Harness parameter specs set no
    // `additionalProperties: false`), so a model can still supply a
    // checkpointRef this build does not declare. Any supplied value —
    // including non-strings, null, or empty string — signals checkpoint
    // intent this build cannot honor, so fail closed on presence rather than
    // type: silently proceeding fresh would let the model believe it resumed
    // an anchor while the prefix is lost. No lifecycle effect runs inside
    // this tool body.
    const raw = args as { checkpointRef?: unknown }
    if (Object.hasOwn(raw, 'checkpointRef') && raw.checkpointRef !== undefined) {
      throw new Error('checkpoint return is not available in this build; call new_context without checkpointRef to start from a fresh context')
    }
    const outcome = host.requestNewContext(agent, {
      memberId: current.memberId,
      ...(relatedFiles.length === 0 ? {} : { relatedFiles }),
    })
    exec.concludeTurn()
    return { mode: outcome.mode, status: 'scheduled' }
  },
})

export function registerContextTools(ctx: { readonly tools: { register(tool: unknown): void } }): void {
  ctx.tools.register(newContext)
}
