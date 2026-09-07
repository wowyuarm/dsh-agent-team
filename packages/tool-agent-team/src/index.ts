import type { Context } from '@deepseek-ai/cordis'
import AgentTeam, { AgentTeamDmDeliveryError, markAgentTeamPreset } from '@wowyuarm/dsh-agent-team/host'
import { registerContextTools } from './context-tools.ts'
import type {
  AgentTeamClaimRef,
  AgentTeamMemberId,
  AgentTeamRequestId,
  AgentTeamTaskRef,
  AgentTeamThreadRef,
} from '@wowyuarm/dsh-agent-team/types'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { AgentTeamContextAdvice } from '@wowyuarm/dsh-agent-team/types'

export const name = 'wowyuarm-agent-team-tools'
export const inject = ['tools']

/** Model-facing view of one structured Thread activity fact, shared by read and history. */
interface ActivityFactView {
  readonly sequence: number
  readonly kind: 'activity'
  readonly activity: string
  readonly actor: string
  readonly taskRef: string
  readonly claimRef?: string
  readonly claimRefs?: string[]
  readonly completedClaimRefs?: string[]
  readonly acceptedClaimRefs?: string[]
  readonly releasedClaimRefs?: string[]
  readonly unread?: boolean
  readonly direct?: boolean
}

/** Model-facing view of one message fact. */
interface MessageFactView {
  readonly sequence: number
  readonly kind: 'message'
  readonly body: string
  readonly sender: string
  readonly mentions: string[]
  readonly unread?: boolean
  readonly direct?: boolean
}

type FactView = MessageFactView | ActivityFactView

/** Model-facing view of read-time context advice; absent fields mean unmeasured. */
interface ContextAdviceView {
  readonly usageTokens?: number
  readonly taskBoundaryThreshold?: number
  readonly handoffAt?: number
  readonly hardLimit?: number
  readonly action: string
  readonly guidance: string
}

function activityFactView(
  sequence: number,
  activity: { readonly kind: string; readonly actor: string; readonly taskRef: AgentTeamTaskRef
    readonly claimRef?: AgentTeamClaimRef | undefined; readonly claimRefs?: readonly AgentTeamClaimRef[] | undefined
    readonly completedClaimRefs?: readonly AgentTeamClaimRef[] | undefined; readonly acceptedClaimRefs?: readonly AgentTeamClaimRef[] | undefined
    readonly releasedClaimRefs?: readonly AgentTeamClaimRef[] | undefined },
  markers?: { readonly unread: boolean; readonly direct: boolean } | undefined,
): ActivityFactView {
  return {
    sequence, kind: 'activity', activity: activity.kind, actor: activity.actor, taskRef: activity.taskRef,
    ...(activity.claimRef === undefined ? {} : { claimRef: activity.claimRef }),
    ...(activity.claimRefs === undefined || activity.claimRefs.length === 0 ? {} : { claimRefs: [...activity.claimRefs] }),
    ...(activity.completedClaimRefs === undefined || activity.completedClaimRefs.length === 0 ? {} : { completedClaimRefs: [...activity.completedClaimRefs] }),
    ...(activity.acceptedClaimRefs === undefined || activity.acceptedClaimRefs.length === 0 ? {} : { acceptedClaimRefs: [...activity.acceptedClaimRefs] }),
    ...(activity.releasedClaimRefs === undefined || activity.releasedClaimRefs.length === 0 ? {} : { releasedClaimRefs: [...activity.releasedClaimRefs] }),
    ...(markers === undefined ? {} : { unread: markers.unread, direct: markers.direct }),
  }
}

function adviceView(advice: AgentTeamContextAdvice): ContextAdviceView {
  return {
    ...(advice.usageTokens === undefined ? {} : { usageTokens: advice.usageTokens }),
    ...(advice.taskBoundaryThreshold === undefined ? {} : { taskBoundaryThreshold: advice.taskBoundaryThreshold }),
    ...(advice.handoffAt === undefined ? {} : { handoffAt: advice.handoffAt }),
    ...(advice.hardLimit === undefined ? {} : { hardLimit: advice.hardLimit }),
    action: advice.action, guidance: advice.guidance,
  }
}

/** Render one structured activity fact as a self-describing decision-surface line. */
function activityLine(fact: ActivityFactView): string {
  const segments = [`${fact.sequence}`, fact.actor, fact.activity]
  segments.push(`Task ${fact.taskRef}`)
  if (fact.claimRef !== undefined) segments.push(`Claim ${fact.claimRef}`)
  if (fact.claimRefs !== undefined) segments.push(`claims released ${fact.claimRefs.join(', ')}`)
  if (fact.completedClaimRefs !== undefined) segments.push(`completed claims ${fact.completedClaimRefs.join(', ')}`)
  if (fact.acceptedClaimRefs !== undefined) segments.push(`accepted claims ${fact.acceptedClaimRefs.join(', ')}`)
  if (fact.releasedClaimRefs !== undefined) segments.push(`released claims ${fact.releasedClaimRefs.join(', ')}`)
  return segments.join(' ')
}

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

function requestId(agentId: string, callId: string): AgentTeamRequestId {
  return `agent-team:tool:${agentId}:${callId}` as AgentTeamRequestId
}

const teamInbox = defineTool({
  name: 'team_inbox',
  description: 'List your bounded Team Inbox. It returns Thread summaries without message bodies and does not mark anything read.',
  parameters: { limit: { type: 'number' } },
  output: {
    schema: { type: 'object', additionalProperties: false, properties: {
      totalUnreadCount: { type: 'number', required: true }, totalDirectCount: { type: 'number', required: true },
      items: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
        threadRef: { type: 'string', required: true }, channelRef: { type: 'string', required: true },
        taskRef: { type: 'string' }, status: { type: 'string' }, revision: { type: 'number', required: true }, unreadCount: { type: 'number', required: true }, directCount: { type: 'number', required: true },
        taskNumber: { type: 'number' },
      } } },
    } },
    render: (_args, value) => [{ type: 'text', text: value.items.length === 0 ? `No unread Team work.${value.totalUnreadCount > 0 ? ` (${value.totalUnreadCount} unread on Threads beyond this bounded list — call again with a larger limit.)` : ''}`
      : [`${value.totalUnreadCount} unread update(s) total, ${value.totalDirectCount} direct, across ${value.items.length} Thread(s) shown${value.totalUnreadCount > value.items.reduce((sum, item) => sum + item.unreadCount, 0) ? ' — more exist beyond this bounded list' : ''}`,
        ...value.items.map(item => `${item.threadRef}${item.channelRef === undefined ? '' : ` · ${item.channelRef}`}${item.taskRef === undefined ? '' : ` · ${item.taskRef}`}${item.taskNumber === undefined ? '' : ` (#${item.taskNumber})`}${item.status === undefined ? '' : ` (${item.status})`} · ${item.unreadCount} unread, ${item.directCount} direct, revision ${item.revision}`)].join('\n') }],
  },
  async execute(args, exec) {
    const agent = exec.agent
    if (agent === undefined) throw new Error('team_inbox requires an Agent session')
    const current = member(agent)
    const host = service(agent)
    const inbox = host.inboxForAgent(agent, { workspaceId: current.workspaceId, ...(args.limit === undefined ? {} : { limit: args.limit }) })
    const taskNumbers = new Map(host.viewForAgent(agent, { workspaceId: current.workspaceId, topLevelOnly: true, includeActivities: false })
      .taskNumbers.map(entry => [entry.taskRef, entry.taskNumber] as const))
    return {
      totalUnreadCount: inbox.totalUnreadCount, totalDirectCount: inbox.totalDirectCount,
      items: inbox.items.map(item => {
        const taskNumber = item.task === undefined ? undefined : taskNumbers.get(item.task.taskRef)
        return { threadRef: item.thread.threadRef, channelRef: item.channelRef,
          ...(item.task === undefined ? {} : { taskRef: item.task.taskRef, status: item.task.status }),
          revision: item.thread.revision, unreadCount: item.unreadCount, directCount: item.directCount,
          ...(taskNumber === undefined ? {} : { taskNumber }) }
      }),
    }
  },
})

const teamThread = defineTool({
  name: 'team_thread',
  description: 'Read or manage your Attention on one Thread. read acknowledges one chronological batch; history does not change read state. Prefer threadRef; taskRef is a compatibility alias when the Thread has a Task.',
  parameters: {
    action: { type: 'string', required: true, enum: ['status', 'follow', 'unfollow', 'read', 'history'] },
    threadRef: { type: 'string', description: "Full branded Thread ref exactly as returned by Team tools, including the 'thread:' prefix. An unambiguous abbreviation of the first 6+ UUID hex characters also resolves." },
    taskRef: { type: 'string', description: "Optional Task ref alias for released clients. Prefer threadRef; if both are given they must identify the same Thread." },
    beforeSequence: { type: 'number' }, limit: { type: 'number' },
  },
  output: {
    schema: { type: 'object', additionalProperties: false, properties: {
      kind: { type: 'string', required: true }, threadRef: { type: 'string', required: true }, taskRef: { type: 'string' },
      revision: { type: 'number', required: true }, status: { type: 'string' }, resolution: { type: 'string' },
      following: { type: 'boolean', required: true }, readThroughSequence: { type: 'number' }, remainingUnreadCount: { type: 'number' }, cursor: { type: 'number' }, hasMore: { type: 'boolean' },
      anchor: { type: 'object', required: true, additionalProperties: false, properties: {
        messageRef: { type: 'string', required: true }, sender: { type: 'string', required: true }, body: { type: 'string', required: true }, sequence: { type: 'number', required: true },
      } },
      claims: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
        claimRef: { type: 'string', required: true }, direction: { type: 'string', required: true }, state: { type: 'string', required: true }, owner: { type: 'string', required: true },
      } } },
      facts: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
        sequence: { type: 'number', required: true }, kind: { type: 'string', required: true }, body: { type: 'string' }, sender: { type: 'string' }, mentions: { type: 'array', items: { type: 'string' } }, activity: { type: 'string' }, actor: { type: 'string' }, taskRef: { type: 'string' }, claimRef: { type: 'string' }, claimRefs: { type: 'array', items: { type: 'string' } }, completedClaimRefs: { type: 'array', items: { type: 'string' } }, acceptedClaimRefs: { type: 'array', items: { type: 'string' } }, releasedClaimRefs: { type: 'array', items: { type: 'string' } }, unread: { type: 'boolean' }, direct: { type: 'boolean' },
      } } },
      contextAdvice: { type: 'object', additionalProperties: false, properties: {
        usageTokens: { type: 'number' }, taskBoundaryThreshold: { type: 'number' }, handoffAt: { type: 'number' }, hardLimit: { type: 'number' },
        action: { type: 'string', required: true }, guidance: { type: 'string', required: true },
      } },
    } },
    // Renders are the only channel a tool result reaches the model through:
    // the header states the Thread ref and the Task's standing, each activity
    // line names the actor and every Claim the activity concluded, message
    // facts carry their unread/direct markers so a bounded batch can be
    // re-read discriminately, an acceptance the reader just acknowledged
    // carries one context-guidance section, and read/history footers state
    // what remains or whether older facts exist.
    render: (_args, value) => {
      // The header always identifies the Thread first — the ref the model
      // must echo in its next team_message reply — then the Task's standing
      // when the Thread is taskful. An empty-facts status/follow result
      // still carries the same identifying surface.
      const header = [
        value.threadRef,
        value.taskRef === undefined ? '' : `${value.taskRef} · ${value.status}${value.resolution === undefined ? '' : `/${value.resolution}`}`,
        `revision ${value.revision}, following=${value.following}`,
      ].filter(part => part !== '').join(' · ')
      const lines = [header]
      // The Claims snapshot is the collision surface: another Member's
      // active Claim on this Task is invisible while facts alone render,
      // yet exactly what the model must see before claiming its own angle.
      for (const claim of value.claims) lines.push(`Claim ${claim.claimRef} · ${claim.state} — ${claim.owner}: ${claim.direction}`)
      // The anchor is the Thread's root task statement. Render it whenever
      // it is not already among the facts, so a model reading a Thread for
      // the first time never loses the original ask.
      if (!value.facts.some(fact => fact.sequence === value.anchor.sequence)) lines.push(`Anchor ${value.anchor.sequence} [${value.anchor.sender}] ${value.anchor.body}`)
      for (const fact of value.facts as FactView[]) {
        lines.push(fact.kind === 'message'
          ? `${fact.sequence} [${fact.sender ?? 'unknown sender'}]${fact.unread === undefined ? '' : fact.direct === true ? ' [direct]' : fact.unread === true ? ' [unread]' : ''} ${fact.body}`
          : activityLine(fact))
        if (fact.kind !== 'message' && fact.unread === true) lines.push(`${fact.sequence} … (unread activity)`)
      }
      if (value.kind === 'read') lines.push(`Read through sequence ${value.readThroughSequence}; ${value.remainingUnreadCount ?? 0} unread update(s) remaining — call team_thread read again${(value.remainingUnreadCount ?? 0) > 0 ? '' : ' when new work arrives'}.`)
      if (value.kind === 'history') lines.push(`History cursor ${value.cursor}; hasMore=${value.hasMore ? 'true' : 'false'}${value.hasMore ? ' — older facts exist; page again with beforeSequence set to the cursor.' : ' — no older facts remain.'}`)
      if (value.kind === 'read' && value.contextAdvice !== undefined) lines.push(...adviceLines(value.contextAdvice))
      return [{ type: 'text', text: lines.join('\n') }]
    },
  },
  async execute(args, exec) {
    const agent = exec.agent
    if (agent === undefined) throw new Error('team_thread requires an Agent session')
    const current = member(agent)
    const host = service(agent)
    if (args.threadRef === undefined && args.taskRef === undefined) throw new Error('team_thread requires threadRef')
    const base = { workspaceId: current.workspaceId, ...(args.threadRef === undefined ? {} : { threadRef: args.threadRef as AgentTeamThreadRef }), ...(args.taskRef === undefined ? {} : { taskRef: args.taskRef as AgentTeamTaskRef }) }
    if (args.action === 'status') {
      if (args.beforeSequence !== undefined || args.limit !== undefined) throw new Error('status does not accept history arguments')
      const status = host.attentionStatusForAgent(agent, base)
      const snapshot = host.threadHistoryForAgent(agent, { ...base, beforeSequence: 1, limit: 1 })
      return threadResult('status', snapshot, status.attention, [])
    }
    if (args.action === 'follow' || args.action === 'unfollow') {
      if (args.beforeSequence !== undefined || args.limit !== undefined) throw new Error(`${args.action} does not accept history arguments`)
      const result = await host.changeAttentionForAgent(agent, { requestId: requestId(agent.id, exec.callId), ...base, action: args.action })
      const snapshot = host.threadHistoryForAgent(agent, { ...base, beforeSequence: 1, limit: 1 })
      return threadResult(args.action, snapshot, result.attention, [])
    }
    if (args.action === 'history') {
      const history = host.threadHistoryForAgent(agent, { ...base, ...(args.beforeSequence === undefined ? {} : { beforeSequence: args.beforeSequence }), ...(args.limit === undefined ? {} : { limit: args.limit }) })
      const status = host.attentionStatusForAgent(agent, base)
      return threadResult('history', history, status.attention, history.facts.map(fact => fact.kind === 'message'
          ? { sequence: fact.sequence, kind: 'message', body: fact.message.body, sender: fact.message.sender, mentions: [...fact.mentions] }
          : activityFactView(fact.sequence, fact.activity)), { cursor: history.cursor, hasMore: history.hasMore })
    }
    if (args.beforeSequence !== undefined || args.limit !== undefined) throw new Error('read does not accept history arguments')
    const read = await host.readThreadForAgent(agent, { requestId: requestId(agent.id, exec.callId), ...base })
    return threadResult('read', read, read.attention, read.facts.map(entry => entry.fact.kind === 'message'
        ? { sequence: entry.fact.sequence, kind: 'message', body: entry.fact.message.body, sender: entry.fact.message.sender, mentions: [...entry.fact.mentions], unread: entry.unread, direct: entry.direct }
        : activityFactView(entry.fact.sequence, entry.fact.activity, { unread: entry.unread, direct: entry.direct })), { readThroughSequence: read.readThroughSequence, remainingUnreadCount: read.remainingUnreadCount, ...(read.contextAdvice === undefined ? {} : { contextAdvice: adviceView(read.contextAdvice) }) })
  },
})

function threadResult(
  kind: 'status' | 'follow' | 'unfollow' | 'read' | 'history',
  snapshot: Awaited<ReturnType<AgentTeam['readThreadForAgent']>> | ReturnType<AgentTeam['threadHistoryForAgent']>,
  attention: Awaited<ReturnType<AgentTeam['readThreadForAgent']>>['attention'],
  facts: FactView[],
  extra: { cursor?: number; hasMore?: boolean; readThroughSequence?: number; remainingUnreadCount?: number; contextAdvice?: ContextAdviceView } = {},
): { anchor: { messageRef: string; sender: string; body: string; sequence: number }; threadRef: string; revision: number; kind: string; following: boolean; taskRef?: string; status?: string; resolution?: string; readThroughSequence?: number; remainingUnreadCount?: number; cursor?: number; hasMore?: boolean; claims: Array<{ claimRef: string; direction: string; state: string; owner: string }>; facts: FactView[]; contextAdvice?: ContextAdviceView } {
  return {
    kind, threadRef: snapshot.thread.threadRef, revision: snapshot.thread.revision,
    ...(snapshot.task === undefined ? {} : { taskRef: snapshot.task.taskRef, status: snapshot.task.status, resolution: snapshot.task.resolution }),
    following: attention !== undefined,
    ...extra,
    ...(attention === undefined || extra.readThroughSequence !== undefined ? {} : { readThroughSequence: attention.readThroughSequence }),
    anchor: { messageRef: snapshot.anchor.messageRef, sender: snapshot.anchor.sender, body: snapshot.anchor.body, sequence: snapshot.anchor.sequence },
    claims: snapshot.claims.map(claim => ({ claimRef: claim.claimRef, direction: claim.direction, state: claim.state, owner: claim.owner })),
    facts,
  }
}

/** Render one read-time acceptance advice; unavailable never prints a fabricated number. */
function adviceLines(advice: ContextAdviceView): string[] {
  const measured = advice.usageTokens !== undefined && advice.taskBoundaryThreshold !== undefined && advice.handoffAt !== undefined && advice.hardLimit !== undefined
  const summary = measured
    ? `${advice.usageTokens!.toLocaleString('en-US')} tokens used; Task-boundary threshold ${advice.taskBoundaryThreshold!.toLocaleString('en-US')}; normal handoff at ${advice.handoffAt!.toLocaleString('en-US')}; hard limit ${advice.hardLimit!.toLocaleString('en-US')}.`
    : 'Context usage could not be measured for this acceptance.'
  return [`Context guidance — ${summary}`, `Action: ${advice.action}. ${advice.guidance}`]
}

const teamMessage = markAgentTeamPreset(defineTool({
  name: 'team_message',
  description: 'Start a top-level Thread, reply to an existing Thread, or send a direct message (DM). start defaults to a taskless Thread; pass asTask true to create a Task in the same send. Read the Thread first; replies require its current revision (an internal concurrency token carried by baseRevision, never quoted in bodies). A top-level start may mention related Agents directly; in replies, only a Human can invite an unfollowed Agent. Pass Member refs in mentions and spell their handles inside the body; only mentioned Members render as mention chips. dm sends a private direct message to one enabled Agent Member in your Workspace: use it for quick clarifications and status syncs — never for task work, decisions, or anything that needs team visibility or traceability (use a Thread); if a DM exchange with the same Member exceeds about 3 exchanges, move it to a Thread, because every DM costs the recipient a full agent turn.',
  parameters: {
    action: { type: 'string', required: true, enum: ['start', 'reply', 'dm'] },
    channelRef: { type: 'string', description: "Full branded Channel ref exactly as returned by Team tools, including the 'channel:' prefix. An unambiguous abbreviation of the first 6+ UUID hex characters also resolves." },
    threadRef: { type: 'string', description: "Full branded Thread ref exactly as returned by Team tools, including the 'thread:' prefix. An unambiguous abbreviation of the first 6+ UUID hex characters also resolves." },
    taskRef: { type: 'string', description: "Optional Task ref alias for reply on a Taskful Thread. Prefer threadRef; an unambiguous abbreviation of the first 6+ UUID hex characters also resolves." },
    memberRef: { type: 'string', description: "Full branded Member ref exactly as returned by Team tools, including the 'member:' prefix. An unambiguous abbreviation of the first 6+ UUID hex characters also resolves. Required for dm; the Member must be an enabled Agent in your Workspace (the Human cannot be DMed)." },
    asTask: { type: 'boolean', description: 'When true, start creates a Task with the Thread. Default false creates a taskless Thread.' },
    body: { type: 'string', required: true, description: "Markdown body. Cite Team refs exactly as returned, as bare text with one colon (e.g. task:0f0a…) — never a double colon, never inside backticks or quotes. Unambiguous UUID abbreviations (first 6+ hex chars) also resolve. Spell each mentioned Member's handle in the prose so the mention renders inline." }, baseRevision: { type: 'number', description: "Positive integer; use the current Thread revision as shown by the latest team_inbox or team_thread result for this Thread. The revision is an internal concurrency token, not a citable fact." },
    mentions: { type: 'array', items: { type: 'string' }, description: 'Member refs to mention. Mentioned Agents receive the Message directly; write their handles in the body (any casing, optional @) so the mention renders inline.' },
    attachments: { type: 'array', items: { type: 'string' }, description: 'Absolute file paths to share, e.g. screenshots or generated artifacts; images render as thumbnails for recipients. The Host validates each path and copies the file into the attachment cache, and members also receive one cached path per attachment; if any path fails validation the whole send is rejected.' },
  },
  output: {
    schema: { type: 'object', additionalProperties: false, properties: {
      kind: { type: 'string', required: true }, taskRef: { type: 'string' }, threadRef: { type: 'string' }, revision: { type: 'number' },
      expectedRevision: { type: 'number' }, messageRef: { type: 'string' }, memberIds: { type: 'array', items: { type: 'string' } }, unreadCount: { type: 'number' }, directCount: { type: 'number' },
      recipientMemberId: { type: 'string' }, recipientHandle: { type: 'string' }, delivered: { type: 'boolean' }, deliveryNote: { type: 'string' },
    } },
    render: (_args, value) => [{ type: 'text', text: value.kind === 'dm-sent' ? `DM ${value.delivered === false ? 'recorded but not delivered' : 'delivered'} to @${value.recipientHandle} (${value.recipientMemberId})${value.deliveryNote === undefined ? '' : `: ${value.deliveryNote}`}`
      : value.kind === 'committed' ? `Message ${value.messageRef} committed at revision ${value.revision} on ${value.threadRef}${value.taskRef === undefined ? '' : ` (${value.taskRef})`}.`
      : value.kind === 'unread_required' ? `unread_required: ${value.threadRef}${value.taskRef === undefined ? '' : ` (${value.taskRef})`} has ${value.unreadCount} unread update(s), ${value.directCount} direct at revision ${value.revision}. Read the pending updates (team_thread read) before retrying this send.`
      : value.kind === 'stale_revision' ? `stale_revision: your baseRevision ${value.expectedRevision} is obsolete; ${value.threadRef}${value.taskRef === undefined ? '' : ` (${value.taskRef})`} is now at revision ${value.revision}. Read the Thread, then retry with baseRevision ${value.revision}.`
      : value.kind === 'member_not_following' ? `member_not_following: ${(value.memberIds ?? []).join(', ')} not following; the message was not committed. Only a Human can invite an unfollowed Agent — retry without mentioning them, or ask the Human.`
      : `${value.kind}: ${value.memberIds?.join(', ') ?? `${value.threadRef ?? ''}${value.taskRef === undefined ? '' : ` · Task ${value.taskRef}`} revision ${value.revision ?? ''}`}` }],
    // Minimal durable projection for the Host's context timeline: the
    // structured outcome identity (never the render text). The effect-anchor
    // fold reads `kind === 'committed'` + threadRef from the persisted
    // tool/result meta — a start's Thread is born here, in the result.
    presentationMeta: (_args, value): Record<string, string> => value.kind === 'committed' && value.threadRef !== undefined
      ? { kind: value.kind, threadRef: value.threadRef, ...(value.taskRef === undefined ? {} : { taskRef: value.taskRef }) }
      : { kind: value.kind },
  },
  async execute(args, exec) {
    const agent = exec.agent
    if (agent === undefined) throw new Error('team_message requires an Agent session')
    const current = member(agent)
    const host = service(agent)
    const mentions = args.mentions as AgentTeamMemberId[] | undefined
    const rawPaths = args.attachments
    const attachmentPaths = Array.isArray(rawPaths) ? rawPaths.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '') : undefined
    const paths = attachmentPaths !== undefined && attachmentPaths.length > 0 ? { attachmentPaths } : {}
    if (args.action === 'start') {
      if (args.channelRef === undefined || args.taskRef !== undefined || args.threadRef !== undefined || args.baseRevision !== undefined) throw new Error('start requires channelRef and does not accept threadRef, taskRef, or baseRevision')
      const result = await host.sendMessageForAgent(agent, { requestId: requestId(agent.id, exec.callId), workspaceId: current.workspaceId,
        channelRef: args.channelRef as never, body: args.body, asTask: args.asTask === true, ...(mentions === undefined ? {} : { recipients: mentions }), ...paths })
      return messageOutcome(result)
    }
    if (args.action === 'dm') {
      if (args.memberRef === undefined || args.channelRef !== undefined || args.threadRef !== undefined || args.taskRef !== undefined
        || args.baseRevision !== undefined || args.asTask !== undefined || mentions !== undefined || attachmentPaths !== undefined) {
        throw new Error('dm requires memberRef and body only; it does not accept channelRef, threadRef, taskRef, baseRevision, asTask, mentions, or attachments')
      }
      try {
        const result = await host.dmForAgent(agent, { requestId: requestId(agent.id, exec.callId), workspaceId: current.workspaceId,
          recipientMemberId: args.memberRef as AgentTeamMemberId, body: args.body })
        return { kind: 'dm-sent', recipientMemberId: result.recipient.memberId, recipientHandle: result.recipient.handle, delivered: true }
      } catch (error) {
        if (error instanceof AgentTeamDmDeliveryError) {
          return { kind: 'dm-sent', recipientMemberId: error.recipientMemberId, recipientHandle: error.recipientHandle, delivered: false, deliveryNote: error.message }
        }
        throw error
      }
    }
    const baseRevision = args.baseRevision
    if ((args.threadRef === undefined && args.taskRef === undefined) || args.channelRef !== undefined || args.asTask !== undefined || typeof baseRevision !== 'number' || !Number.isSafeInteger(baseRevision) || baseRevision < 1) {
      throw new Error("reply requires threadRef and a positive baseRevision, and does not accept channelRef; use the current Thread 'revision' returned by team_inbox or team_thread")
    }
    const result = await host.replyForAgent(agent, { requestId: requestId(agent.id, exec.callId), workspaceId: current.workspaceId,
      ...(args.threadRef === undefined ? {} : { threadRef: args.threadRef as AgentTeamThreadRef }),
      ...(args.taskRef === undefined ? {} : { taskRef: args.taskRef as AgentTeamTaskRef }),
      body: args.body, baseRevision,
      ...(mentions === undefined ? {} : { recipients: mentions }), ...paths })
    return messageOutcome(result)
  },
}))

function messageOutcome(result: Awaited<ReturnType<AgentTeam['sendMessageForAgent']>> | Awaited<ReturnType<AgentTeam['replyForAgent']>>) {
  if (result.kind === 'committed') return { kind: result.kind, threadRef: result.thread.threadRef,
    ...(result.task === undefined ? {} : { taskRef: result.task.taskRef }),
    revision: result.thread.revision, messageRef: result.message.messageRef }
  if (result.kind === 'member_not_following') return { kind: result.kind, memberIds: [...result.memberIds],
    ...(result.taskRef === undefined ? {} : { taskRef: result.taskRef }), ...(result.threadRef === undefined ? {} : { threadRef: result.threadRef, revision: result.revision }) }
  if (result.kind === 'unread_required') return { kind: result.kind, ...(result.taskRef === undefined ? {} : { taskRef: result.taskRef }), threadRef: result.threadRef,
    revision: result.revision, unreadCount: result.unreadCount, directCount: result.directCount }
  if (result.kind === 'stale_revision') return { kind: result.kind, ...(result.taskRef === undefined ? {} : { taskRef: result.taskRef }), threadRef: result.threadRef,
    expectedRevision: result.expectedRevision, revision: result.revision }
  throw new Error('Agents cannot receive invitation confirmations')
}

const teamClaim = defineTool({
  name: 'team_claim',
  description: 'List or mutate your Direction Claims. Read the Thread first; every mutation uses the current Thread revision. A Claim is your one-sentence direction statement on a Task — "the angle I am taking" — so others can spot collisions and track progress: Tasks define scope (owned by Humans), Claims declare the angle (owned by you). Good direction: "Unify the four form dialogs on shared field components before wiring submits." Bad direction: a multi-paragraph plan with step order, file lists, or acceptance criteria — those belong in Thread messages, not the Claim.',
  parameters: {
    action: { type: 'string', required: true, enum: ['list', 'claim', 'done', 'release'] },
    taskRef: { type: 'string', required: true, description: "Full branded Task ref exactly as returned by Team tools, including the 'task:' prefix. An unambiguous abbreviation of the first 6+ UUID hex characters also resolves." },
    baseRevision: { type: 'number', description: "Positive integer; use the current Thread revision as shown by the latest team_inbox or team_thread result for this Task. The revision is an internal concurrency token, not a citable fact." }, direction: { type: 'string' },
    claimRef: { type: 'string', description: "Full branded Claim ref exactly as returned by team_claim, including the 'claim:' prefix. An unambiguous abbreviation of the first 6+ UUID hex characters also resolves." },
  },
  output: {
    schema: { type: 'object', additionalProperties: false, properties: {
      kind: { type: 'string', required: true }, taskRef: { type: 'string', required: true }, threadRef: { type: 'string', required: true },
      revision: { type: 'number', required: true }, expectedRevision: { type: 'number' }, status: { type: 'string', required: true },
      unreadCount: { type: 'number' }, directCount: { type: 'number' },
      claims: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { claimRef: { type: 'string', required: true }, direction: { type: 'string', required: true }, state: { type: 'string', required: true }, owner: { type: 'string', required: true } } } },
    } },
    render: (_args, value) => [{ type: 'text', text: [
      value.kind === 'unread_required'
        ? `unread_required: ${value.taskRef} (${value.threadRef}) has ${value.unreadCount} unread update(s), ${value.directCount} direct at revision ${value.revision}. Read the pending updates (team_thread read) before retrying this Claim mutation.`
        : value.kind === 'stale_revision'
          ? `stale_revision: your baseRevision ${value.expectedRevision} is obsolete; ${value.taskRef} (${value.threadRef}) is now at revision ${value.revision}. Read the Thread, then retry with baseRevision ${value.revision}.`
          : `${value.kind}: ${value.taskRef} (${value.threadRef}) · ${value.status}, revision ${value.revision}`,
      ...value.claims.map(claim => `${claim.claimRef} · ${claim.state} — ${claim.owner}: ${claim.direction}`)].join('\n') }],
  },
  async execute(args, exec) {
    const agent = exec.agent
    if (agent === undefined) throw new Error('team_claim requires an Agent session')
    const current = member(agent)
    const host = service(agent)
    const base = { workspaceId: current.workspaceId, taskRef: args.taskRef as AgentTeamTaskRef }
    if (args.action === 'list') {
      if (args.baseRevision !== undefined || args.direction !== undefined || args.claimRef !== undefined) throw new Error('list accepts only taskRef')
      const listed = host.listClaimsForAgent(agent, base)
      return { kind: 'listed', taskRef: listed.task.taskRef, threadRef: listed.thread.threadRef, revision: listed.thread.revision, status: listed.task.status,
        claims: listed.claims.map(claim => ({ claimRef: claim.claimRef, owner: claim.owner, direction: claim.direction, state: claim.state })) }
    }
    const baseRevision = args.baseRevision
    if (typeof baseRevision !== 'number' || !Number.isSafeInteger(baseRevision) || baseRevision < 1) throw new Error("claim mutation requires a positive baseRevision; use the current Thread 'revision' returned by team_inbox or team_thread for this Task")
    if (args.action === 'claim' && (args.direction === undefined || args.claimRef !== undefined)) throw new Error('claim requires direction and does not accept claimRef')
    if ((args.action === 'done' || args.action === 'release') && (args.claimRef === undefined || args.direction !== undefined)) throw new Error(`${args.action} requires claimRef and does not accept direction`)
    const result = await host.changeClaimForAgent(agent, { requestId: requestId(agent.id, exec.callId), ...base, action: args.action,
      baseRevision, ...(args.direction === undefined ? {} : { direction: args.direction }), ...(args.claimRef === undefined ? {} : { claimRef: args.claimRef as AgentTeamClaimRef }) })
    const listed = host.listClaimsForAgent(agent, base)
    const claims = listed.claims.map(claim => ({ claimRef: claim.claimRef, owner: claim.owner, direction: claim.direction, state: claim.state }))
    if (result.kind === 'committed') return { kind: result.kind, taskRef: result.task.taskRef, threadRef: result.thread.threadRef,
      revision: result.thread.revision, status: result.task.status, claims }
    if (result.kind === 'unread_required') return { kind: result.kind, taskRef: listed.task.taskRef, threadRef: result.threadRef,
      revision: result.revision, status: listed.task.status, unreadCount: result.unreadCount, directCount: result.directCount, claims }
    return { kind: result.kind, taskRef: listed.task.taskRef, threadRef: result.threadRef, expectedRevision: result.expectedRevision,
      revision: result.revision, status: listed.task.status, claims }
  },
})

const teamView = defineTool({
  name: 'team_view',
  description: 'Discover authorized Team Channels, top-level Threads, Tasks, and Members. It is not a substitute for team_thread reading.',
  parameters: {
    channelRef: { type: 'string', description: "Full branded Channel ref exactly as returned by Team tools, including the 'channel:' prefix. An unambiguous abbreviation of the first 6+ UUID hex characters also resolves." },
    limit: { type: 'number' }, cursor: { type: 'number' },
  },
  output: {
    schema: { type: 'object', additionalProperties: false, properties: {
      channels: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { channelRef: { type: 'string', required: true }, name: { type: 'string', required: true } } } },
      members: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
        memberId: { type: 'string', required: true }, kind: { type: 'string', required: true }, handle: { type: 'string', required: true }, description: { type: 'string', required: true }, presence: { type: 'string', required: true },
      } } },
      threads: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
        threadRef: { type: 'string', required: true }, channelRef: { type: 'string', required: true }, revision: { type: 'number', required: true }, messageCount: { type: 'number', required: true },
        taskRef: { type: 'string' }, status: { type: 'string' }, taskNumber: { type: 'number' },
      } } },
      tasks: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { taskRef: { type: 'string', required: true }, threadRef: { type: 'string', required: true }, channelRef: { type: 'string', required: true }, status: { type: 'string', required: true }, revision: { type: 'number', required: true } } } },
      cursor: { type: 'number', required: true }, hasMore: { type: 'boolean', required: true },
    } },
    render: (_args, value) => [{ type: 'text', text: [
      ...value.channels.map(channel => `${channel.channelRef} · ${channel.name}`),
      ...value.members.map(m => `${m.memberId} · ${m.handle} (${m.kind}, ${m.presence})${m.description === '' ? '' : ` — ${m.description}`}`),
      ...(value.threads.length > 0
        ? value.threads.map(thread => `${thread.threadRef} · ${thread.channelRef}${thread.taskRef === undefined ? '' : ` · ${thread.taskRef}${thread.taskNumber === undefined ? '' : ` (#${thread.taskNumber})`} (${thread.status})`} · ${thread.messageCount} message(s), revision ${thread.revision}`)
        : ['No Team Threads.']),
      ...(value.tasks.length > 0
        ? value.tasks.map(task => `${task.taskRef} · ${task.threadRef} · ${task.channelRef} · ${task.status}, revision ${task.revision}`)
        : ['No Team Tasks.']),
      `cursor ${value.cursor}, hasMore=${value.hasMore ? 'true' : 'false'}${value.hasMore ? ' — more items exist; call team_view again with cursor set to this value.' : ' — no further pages.'}`,
    ].join('\n') }],
  },
  async execute(args, exec) {
    const agent = exec.agent
    if (agent === undefined) throw new Error('team_view requires an Agent session')
    const current = member(agent)
    const host = service(agent)
    const view = host.viewForAgent(agent, { workspaceId: current.workspaceId, ...(args.channelRef === undefined ? {} : { channelRef: args.channelRef as never }), ...(args.limit === undefined ? {} : { limit: args.limit }), ...(args.cursor === undefined ? {} : { cursor: args.cursor }), topLevelOnly: true, includeActivities: false })
    const visibleMemberIds = new Set(view.members.map(membership => membership.memberId))
    return {
      channels: view.channels.map(channel => ({ channelRef: channel.channelRef, name: channel.name })),
      members: [
        { memberId: view.humanMemberId, kind: 'human', handle: 'human', description: 'Human Team Member', presence: 'available' },
        ...host.members().filter(status => visibleMemberIds.has(status.member.memberId)).map(status => ({ memberId: status.member.memberId,
          kind: 'agent', handle: status.member.handle, description: status.member.description, presence: status.presence })),
      ],
      threads: view.items.map(item => {
        const thread = item.thread
        const task = item.task
        return { threadRef: thread.threadRef, channelRef: item.message.channelRef, revision: thread.revision, messageCount: item.messageCount,
          ...(task === undefined ? {} : { taskRef: task.taskRef, status: task.status, ...(item.taskNumber === undefined ? {} : { taskNumber: item.taskNumber }) }) }
      }),
      tasks: view.tasks.map(task => ({ taskRef: task.taskRef, threadRef: task.threadRef, channelRef: task.channelRef,
        status: task.status, revision: view.threads.find(thread => thread.threadRef === task.threadRef)?.revision ?? 0 })),
      cursor: view.cursor, hasMore: view.hasMore,
    }
  },
})

export function apply(ctx: Context): void {
  ctx.tools.register(teamInbox)
  ctx.tools.register(teamThread)
  ctx.tools.register(teamMessage)
  ctx.tools.register(teamClaim)
  ctx.tools.register(teamView)
  registerContextTools(ctx)
}
