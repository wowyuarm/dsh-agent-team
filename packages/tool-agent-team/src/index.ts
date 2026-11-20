import type { Context } from '@deepseek-ai/cordis'
import type AgentTeam from '@contexera/dsh-agent-team/host'
import { AGENT_TEAM_HUMAN_MEMBER_ID, AgentTeamDmDeliveryError, markAgentTeamPreset, reminderRefForCallId } from '@contexera/dsh-agent-team/host'
import { projectRefOf, service, workspaceOf, workspaceParam } from './host-access.ts'
import { memberTarget } from './member-target.ts'
import { recoveryFor } from '@contexera/dsh-agent-team/recovery-hints'
import type {
  AgentTeamAttentionSource,
  AgentTeamClaimRef,
  AgentTeamInboxReminder,
  AgentTeamMemberReminder,
  AgentTeamReminderRef,
  AgentTeamReminderSchedule,
  AgentTeamMemberId,
  AgentTeamModelSelection,
  AgentTeamManagerSessionEvidenceFailureKind,
  AgentTeamManagerSessionEvidenceLocator,
  AgentTeamManagerSessionEvidenceState,
  AgentTeamMemberCapabilities,
  AgentTeamOwnedProject,
  AgentTeamRequestId,
  AgentTeamMessageRef,
  AgentTeamProjectRef,
  AgentTeamTaskRef,
  AgentTeamThreadFact,
  AgentTeamThreadRef,
} from '@contexera/dsh-agent-team/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { mainEntryView, standingView } from './main-stream.ts'
import { budgetReading, readingCapacity } from './reading-budget.ts'
import { teamSubscription } from './subscription.ts'
import { boundedSubject } from './subject.ts'
import { activityFactView, claimView, mainStreamLines, readFactView, taskCardView, teamThreadOutput,
  type ClaimView, type FactView, type ReplyContextView, type TaskCardView } from './thread-output.ts'
import { boardItemView, reminderScheduleText, teamAttentionOutput, teamDmOutput, teamInboxOutput,
  teamMessageOutput, teamReminderOutput, teamTaskOutput, teamViewOutput } from './member-output.ts'
import { memberCreateOutput, memberStateOutput, memberUpdateOutput, memberWorkspaceOutput, projectCreateOutput,
  projectOwnerOutput, projectUpdateOutput, teamModelsOutput, teamOverviewOutput } from './manager-output.ts'
import { teamWorkerOutput } from './worker-output.ts'

export const name = 'contexera-agent-team-tools'

export const inject = ['tools']

function requestId(agentId: string, callId: string): AgentTeamRequestId {
  return `agent-team:tool:${agentId}:${callId}` as AgentTeamRequestId
}

/**
 * Some models fill every optional parameter slot with `""` (or a zero count) instead
 * of omitting it, and every guard below asks `!== undefined`. Normalizing blanks to
 * "not passed" at the entry keeps those guards honest and the address parameters
 * resolvable, without weakening the guards for genuinely malformed values. Only
 * address/selection parameters are normalized — `body` is content, where an empty
 * string is a real error the tool must report, not a missing field. An empty
 * collection names nothing to honor, exactly as an empty address names no target.
 * An empty object is the same statement in object form: it selects nothing, so it
 * reads as "not passed" rather than as a value to forward.
 */
function blankToAbsent<T extends { readonly [key: string]: unknown }>(args: T, keys: readonly string[]): T {
  const copy: Record<string, unknown> = { ...args }
  for (const key of keys) {
    const value = copy[key]
    if (value === '' || value === 0 || value === false || (Array.isArray(value) && value.length === 0)
      || (typeof value === 'object' && value !== null && Object.keys(value).length === 0)) delete copy[key]
  }
  return copy as T
}

/** The address/selection parameters every Team tool treats as optional presence. */
const OPTIONAL_ADDRESS_KEYS = ['workspace', 'projectRef', 'threadRef', 'taskRef', 'messageRef', 'replyToMessageRef',
  'claimRef', 'memberRef', 'accountable', 'target', 'beforeSequence', 'limit', 'cursor', 'mine', 'baseRevision',
  'reminderRef'] as const

/** Optional collection parameters where `[]` names nothing and must not be read as a real argument. */
const OPTIONAL_COLLECTION_KEYS = ['attachments', 'sourceThreadRefs'] as const

/**
 * A reminder's schedule slots, which `create` alone takes. They are normalized
 * like an address so a model that fills every slot on a list or a cancel is not
 * charged a retry for blanks it never meant; a value that is actually there is
 * refused, because a schedule on a cancel names a reminder the caller did not pick.
 */
const OPTIONAL_SCHEDULE_KEYS = ['scheduleKind', 'at', 'minutes', 'expression'] as const

/** Non-create actions tolerate the default selector, but never real schedule content. */
const CREATE_ONLY_REMINDER_CONTENT_KEYS = ['at', 'minutes', 'expression', 'note'] as const

/** Only the first enum value is a neutral fill; other selections remain conflicts. */
function refuseNonDefaultScheduleKind(action: 'cancel' | 'list', scheduleKind: string | undefined): void {
  if (scheduleKind === undefined || scheduleKind === 'once') return
  throw new Error(recoveryFor('action_only_arguments').sentence({ action, parameter: 'scheduleKind', owner: 'create' }))
}

const teamInbox = defineTool({
  name: 'team_inbox',
  description: 'List your bounded Team Inbox across all joined Workspaces for triage: unread Thread summaries and one row per Project Main stream with unread for you, with counts, without message bodies and without marking anything read. Read a selected Thread with team_thread read; the inbox itself authorizes no mutation. This is your own unread queue; to see work in flight (whether or not you have unread on it), use team_task board.',
  parameters: { limit: { type: 'number' }, workspace: workspaceParam },
  output: teamInboxOutput,
  async execute(rawArgs, exec) {
    const args = blankToAbsent(rawArgs, OPTIONAL_ADDRESS_KEYS)
    const agent = exec.agent
    if (agent === undefined) throw new Error('team_inbox requires an Agent session')
    const host = service(agent)
    const inbox = host.inboxForAgent(agent, { ...(args.workspace === undefined ? {} : { workspaceId: workspaceOf(args, agent) }), ...(args.limit === undefined ? {} : { limit: args.limit }) })
    return {
      totalUnreadCount: inbox.totalUnreadCount, totalDirectCount: inbox.totalDirectCount, hasMore: inbox.hasMore,
      main: inbox.main.map(row => ({ workspaceId: row.workspaceId, projectRef: row.projectRef, projectName: row.projectName,
        unreadCount: row.unreadCount, directCount: row.directCount, newestOccurredAt: row.newestOccurredAt })),
      items: inbox.items.map(item => {
        const taskNumber = item.taskNumber
        return { workspaceId: item.workspaceId, threadRef: item.thread.threadRef, projectRef: item.projectRef,
          ...(item.task === undefined ? {} : { taskRef: item.task.taskRef, status: item.task.status, accountable: item.task.accountable }),
          revision: item.thread.revision, unreadCount: item.unreadCount, directCount: item.directCount, newestOccurredAt: item.newestOccurredAt,
          ...(taskNumber === undefined ? {} : { taskNumber }), reminders: [...(item.reminders ?? [])] }
      }),
    }
  },
})

/** Attention (following a Thread) is a different question from reading one. `status`, `follow`, and `unfollow` take one Thread address or the Main stream address, plus the routing Workspace; sharing a parameter pocket with read would put `messageRef`, `beforeSequence`, and `limit` in front of actions that never accept them. */
const teamAttention = defineTool({
  name: 'team_attention',
  description: `Read or change your Attention — whether you are following one Thread or a Project's Main stream. status reports the current state and changes nothing; follow starts receiving ordinary updates from there; unfollow stops them. Attention is not reading: none of these actions render facts, acknowledge unread work, or hand off a write token, and reading never changes whether you follow it. Address one Thread with threadRef or taskRef (when both are given they must identify the same Thread), or address the Main stream with projectRef — never both a Thread and projectRef. Unfollowing stops ordinary updates but leaves every mention, reply and responsibility event reaching you; it does not release a Claim or drop a Task you are accountable for. While you hold an active Claim on this Thread's Task, your unfollow is refused: finish the work or release the Claim first.`,
  parameters: {
    action: { type: 'string', required: true, enum: ['status', 'follow', 'unfollow'] },
    threadRef: { type: 'string', description: "Full branded Thread ref exactly as returned by Team tools, including the 'thread:' prefix. An unambiguous abbreviation of the first 6+ UUID hex characters also resolves." },
    taskRef: { type: 'string', description: "Optional Task ref alias when this Thread has a Task. Prefer threadRef; if both are given they must identify the same Thread." },
    projectRef: { type: 'string', description: "Full branded Project ref: addresses that Project's Main stream instead of a Thread. Never with threadRef or taskRef." },
    workspace: workspaceParam,
  },
  output: teamAttentionOutput,
  async execute(rawArgs, exec) {
    const args = blankToAbsent(rawArgs, OPTIONAL_ADDRESS_KEYS)
    const agent = exec.agent
    if (agent === undefined) throw new Error('team_attention requires an Agent session')
    const host = service(agent)
    const threadAddressed = args.threadRef !== undefined || args.taskRef !== undefined
    if (!threadAddressed && args.projectRef === undefined) {
      throw new Error(`team_attention needs one of threadRef, taskRef, or projectRef (the Main stream) — ${recoveryFor('missing_thread_identity').sentence({})}`)
    }
    if (threadAddressed && args.projectRef !== undefined) {
      throw new Error(`team_attention takes either a Thread or a projectRef for the Main stream, never both — ${recoveryFor('main_stream_addressing').sentence({ refused: 'a Thread ref and projectRef' })}`)
    }
    if (args.projectRef !== undefined) {
      const base = { workspaceId: workspaceOf(args, agent), projectRef: args.projectRef as AgentTeamProjectRef }
      if (args.action === 'status') {
        const status = host.mainAttentionStatusForAgent(agent, base)
        return mainAttentionResult('status', base.workspaceId, status.project.projectRef, status.attention !== undefined, status.attention?.source)
      }
      const result = await host.changeAttentionForAgent(agent, { requestId: requestId(agent.id, exec.callId), ...base, action: args.action })
      if (!('project' in result)) throw new Error('expected a Main stream Attention result')
      return mainAttentionResult(args.action, base.workspaceId, result.project.projectRef, result.attention !== undefined, result.attention?.source)
    }
    const base = { workspaceId: workspaceOf(args, agent), ...(args.threadRef === undefined ? {} : { threadRef: args.threadRef as AgentTeamThreadRef }), ...(args.taskRef === undefined ? {} : { taskRef: args.taskRef as AgentTeamTaskRef }) }
    const taskNumberOf = (task: { taskRef: AgentTeamTaskRef } | undefined): { taskNumber?: number } => {
      if (task === undefined) return {}
      const resolved = host.resolveTaskRefs({ workspaceId: base.workspaceId, taskRefs: [task.taskRef] }).resolved[0]
      return resolved === undefined ? {} : { taskNumber: resolved.taskNumber }
    }
    if (args.action === 'status') {
      const status = host.attentionStatusForAgent(agent, base)
      const snapshot = host.threadHistoryForAgent(agent, { ...base, beforeSequence: 1, limit: 1 })
      return attentionResult('status', base.workspaceId, snapshot, status.attention, taskNumberOf(snapshot.task))
    }
    const result = await host.changeAttentionForAgent(agent, { requestId: requestId(agent.id, exec.callId), ...base, action: args.action })
    const snapshot = host.threadHistoryForAgent(agent, { ...base, beforeSequence: 1, limit: 1 })
    // A Thread request can only answer with the Thread face; the Main stream
    // face is reached through projectRef above.
    if (!('thread' in result)) throw new Error('expected a Thread Attention result')
    return attentionResult(args.action, base.workspaceId, snapshot, result.attention, taskNumberOf(snapshot.task))
  },
})

/** The one result shape a Main stream Attention action returns: address, scope, and the standing itself. */
function mainAttentionResult(kind: 'status' | 'follow' | 'unfollow', workspaceId: string, projectRef: string, following: boolean, source?: AgentTeamAttentionSource) {
  return { workspaceId, projectRef, kind, scope: 'main', following, ...(source === undefined ? {} : { source }) }
}

/** The one result shape every Attention action returns: address, standing, and the state itself. */
function attentionResult(
  kind: 'status' | 'follow' | 'unfollow',
  workspaceId: string,
  snapshot: ReturnType<AgentTeam['threadHistoryForAgent']>,
  attention: Awaited<ReturnType<AgentTeam['readThreadForAgent']>>['attention'],
  task: { taskNumber?: number; accountable?: string },
): { workspaceId: string; projectRef: string; kind: string; threadRef: string; revision: number; following: boolean; source?: AgentTeamAttentionSource; taskRef?: string; status?: string; resolution?: string; taskNumber?: number; accountable?: string } {
  return {
    workspaceId, projectRef: snapshot.anchor.projectRef,
    kind, threadRef: snapshot.thread.threadRef, revision: snapshot.thread.revision,
    ...(snapshot.task === undefined ? {} : { taskRef: snapshot.task.taskRef, status: snapshot.task.status, resolution: snapshot.task.resolution, accountable: snapshot.task.accountable }),
    ...(task.taskNumber === undefined ? {} : { taskNumber: task.taskNumber }),
    following: attention !== undefined,
    // Present only once the Member follows, so a status or an unfollow does not
    // name a cause the standing cannot support.
    ...(attention === undefined ? {} : { source: attention.source }),
  }
}

const teamThread = defineTool({
  name: 'team_thread',
  description: `Read one Thread's facts, or a Project's Main stream (pass projectRef and omit Thread refs — a call addresses one or the other, never both). read acknowledges one chronological batch of unread facts and is the only read-side source of a next-write token — and only once no unread remains; your own committed public mutations hand off the token as well. Thread/Main read restores missing recent originals plus the Thread anchor, including after compaction with no unread. Complete Message bodies and Activity events already visible in context are acknowledged by identity only; missing facts are supplied. history pages older facts without changing read state. read/message output is capped at 32768 UTF-16 units including framing: a long Message returns ordered parts, and repeating the same request fills the first gap in current context. read confirms only after every part is present; message never confirms. A Message capacity error needs shorter Messages or a larger-context model, not retries. An Activity event cannot be split; a fixed output-limit error needs Human inspection. [attachment] paths are reading locators, not attachment contents. message reads one Message by ref to answer a \`Replies to:\` line; for a Thread it requires threadRef (if taskRef is also given, it must identify the same Thread), while projectRef addresses the Main stream. beforeSequence and limit page history: read ignores them, whose batch is bounded by design and names how much remains; message rejects them — ${recoveryFor('history_only_arguments').sentence({ action: 'message' })} For read/history, prefer threadRef; taskRef is a Task alias when both identify the same Thread. Attention is team_attention and never changes here. On the Main stream, read returns the oldest pending entries and missing recent background; it acknowledges only the delivered prefix — ordinary entries covered by your Main stream Attention and your direct markers — and a backlog is read oldest first, one page per read, until none remains; history pages older entries; Thread cards name the Thread to read.`,
  parameters: {
    action: { type: 'string', required: true, enum: ['read', 'history', 'message'] },
    threadRef: { type: 'string', description: "Full branded Thread ref exactly as returned by Team tools, including the 'thread:' prefix. An unambiguous abbreviation of the first 6+ UUID hex characters also resolves." },
    projectRef: { type: 'string', description: "Full branded Project ref: reads that Project's Main stream instead of a Thread. Never with threadRef or taskRef." },
    taskRef: { type: 'string', description: "Optional Task ref alias for read and history when this Thread has a Task. Prefer threadRef; if both are given they must identify the same Thread. For message on a Thread, pass threadRef; taskRef alone does not address a Message. projectRef addresses the Main stream." },
    messageRef: { type: 'string', description: "For action `message`: the full branded Message ref to read back, exactly as rendered by this tool or by an inbox notice — including the `message:` prefix. An unambiguous abbreviation of the first 6+ UUID hex characters also resolves." },
    beforeSequence: { type: 'number', description: 'history only: the oldest fact sequence to page before (exclusive). message rejects it; read ignores it, since a read batch is bounded by design.' }, limit: { type: 'number', description: 'history only: max older facts to return, 1–100, default 20. message rejects it; read ignores it, since a read batch is bounded by design.' }, workspace: workspaceParam,
  },
  output: teamThreadOutput,
  async execute(rawArgs, exec) {
    const args = blankToAbsent(rawArgs, OPTIONAL_ADDRESS_KEYS)
    const agent = exec.agent
    if (agent === undefined) throw new Error('team_thread requires an Agent session')
    const host = service(agent)
    // Only `read` and `message` need the model's capacity: `history` pages by
    // count under its own bound, so it never resolves model info.
    const capacity = args.action === 'history' ? Number.POSITIVE_INFINITY : await readingCapacity(agent, exec.signal)
    if (args.projectRef !== undefined) return mainStreamOutcome(host, agent, args, requestId(agent.id, exec.callId), capacity)
    if (args.threadRef === undefined && args.taskRef === undefined) throw new Error(`team_thread needs threadRef (or taskRef on a Taskful Thread) — ${recoveryFor('missing_thread_identity').sentence({})}`)
    const base = { workspaceId: workspaceOf(args, agent), ...(args.threadRef === undefined ? {} : { threadRef: args.threadRef as AgentTeamThreadRef }), ...(args.taskRef === undefined ? {} : { taskRef: args.taskRef as AgentTeamTaskRef }) }
    const taskNumberOf = (task: { taskRef: AgentTeamTaskRef } | undefined): { taskNumber?: number } => {
      if (task === undefined) return {}
      const resolved = host.resolveTaskRefs({ workspaceId: base.workspaceId, taskRefs: [task.taskRef] }).resolved[0]
      return resolved === undefined ? {} : { taskNumber: resolved.taskNumber }
    }
        // `messageRef` belongs to the `message` action alone. The parameter schema is implicitly open, so nothing refuses it elsewhere and a silent drop would tell the model nothing. One guard before the branches covers every other action, including future read actions.
    if (args.action !== 'message' && args.messageRef !== undefined) {
      throw new Error(recoveryFor('action_only_arguments').sentence({ action: args.action, parameter: 'messageRef', owner: 'message' }))
    }
    if (args.action === 'history') {
      const history = host.threadHistoryForAgent(agent, { ...base, ...(args.beforeSequence === undefined ? {} : { beforeSequence: args.beforeSequence }), ...(args.limit === undefined ? {} : { limit: args.limit }) })
      const status = host.attentionStatusForAgent(agent, base)
      return threadResult('history', base.workspaceId, history, status.attention, history.facts.map(fact => fact.kind === 'message'
          ? { sequence: fact.sequence, kind: 'message', messageRef: fact.message.messageRef, body: fact.message.body, sender: fact.message.sender, mentions: [...fact.mentions], ...(fact.message.replyToMessageRef === undefined ? {} : { replyToMessageRef: fact.message.replyToMessageRef }), ...(fact.replyTo === undefined ? {} : { replyTo: fact.replyTo }), occurredAt: fact.occurredAt }
          : activityFactView(fact.activity, undefined, fact.occurredAt)), { cursor: history.cursor, hasMore: history.hasMore, taskCards: (history.taskCards ?? []).map(taskCardView), ...taskNumberOf(history.task) })
    }
    if (args.action === 'message') {
      if (args.messageRef === undefined) throw new Error(recoveryFor('missing_message_ref').sentence({ refused: 'for action message' }))
            // Reading one Message requires threadRef; taskRef alone cannot address it. The orientation lookup below still checks that both refs agree.
      if (args.threadRef === undefined) throw new Error(`message needs threadRef — ${recoveryFor('missing_thread_identity').sentence({})}`)
      if (args.beforeSequence !== undefined || args.limit !== undefined) throw new Error(recoveryFor('history_only_arguments').sentence({ action: 'message' }))
      const readBack = host.readMessageForAgent(agent, {
        workspaceId: base.workspaceId,
        threadRef: args.threadRef as AgentTeamThreadRef,
        messageRef: args.messageRef as AgentTeamMessageRef,
      })
            // The ordinary orientation is still returned so every action answers with one shape; the Message read back rides alongside.
      const snapshot = host.threadHistoryForAgent(agent, { ...base, beforeSequence: 1, limit: 1 })
      const status = host.attentionStatusForAgent(agent, base)
      const value = threadResult('message', base.workspaceId, snapshot, status.attention, [], {
        message: { messageRef: readBack.messageRef, sender: readBack.sender, sequence: readBack.sequence, ...(readBack.occurredAt === undefined ? {} : { occurredAt: readBack.occurredAt }), body: readBack.body, bodyOmitted: false },
        ...taskNumberOf(snapshot.task),
      })
      return budgetReading(agent, value, (candidate): string => teamThread.output.render(args, candidate as never).map((part: { type: string; text?: string }) => part.type === 'text' ? part.text : '').join('\n'), capacity).value
    }
        // `read` is the one action that returns a bounded batch by design — its Host request carries neither paging field, so a page size here cannot be honored. Refusing the whole call taught the model nothing: one real session retried the identical arguments twice. The batch it did get names what remains, which is the route to more.
    if (args.action !== 'read' && (args.beforeSequence !== undefined || args.limit !== undefined)) {
      throw new Error(recoveryFor('history_only_arguments').sentence({ action: args.action }))
    }
    const view = (read: Awaited<ReturnType<AgentTeam['readThreadForAgent']>>) => {
      const cards = read.task === undefined
        ? (host.threadHistoryForAgent(agent, { ...base, beforeSequence: 1, limit: 1 }).taskCards ?? []).map(taskCardView) : []
      return threadResult('read', base.workspaceId, read, read.attention, read.facts.map(entry => readFactView(entry,
        entry.fact.kind === 'message' && read.visibleMessageRefs.includes(entry.fact.message.messageRef),
        entry.fact.kind === 'activity' && read.visibleActivityRefs.includes(entry.fact.activity.activityRef))), {
        readThroughSequence: read.readThroughSequence, remainingUnreadCount: read.remainingUnreadCount, reminders: [...read.reminders],
        ...(read.earlierFactCount === undefined ? {} : { earlierFactCount: read.earlierFactCount }), taskCards: cards, ...taskNumberOf(read.task) })
    }
    let selected: ReturnType<typeof view> | undefined
    const read = await host.readThreadForAgent(agent, { requestId: requestId(agent.id, exec.callId), ...base }, preview => {
      const budget = budgetReading(agent, view(preview), value => teamThread.output.render(args, value as never).map(part => part.type === 'text' ? part.text : '').join('\n'), capacity)
      selected = budget.value
      return budget.through
    })
    if (selected === undefined) return budgetReading(agent, view(read),
      (value): string => teamThread.output.render(args, value as never).map((part: { type: string; text?: string }) => part.type === 'text' ? part.text : '').join('\n'), capacity).value
    return { ...selected, readThroughSequence: read.readThroughSequence, remainingUnreadCount: read.remainingUnreadCount }
  },
})

async function mainStreamOutcome(
  host: AgentTeam,
  agent: Parameters<typeof workspaceOf>[1],
  args: { readonly action: string; readonly projectRef?: string | undefined; readonly threadRef?: string | undefined; readonly taskRef?: string | undefined
    readonly messageRef?: string | undefined; readonly beforeSequence?: number | undefined; readonly limit?: number | undefined; readonly workspace?: string | undefined },
  readRequestId: AgentTeamRequestId,
  capacity: number,
) {
  if (args.threadRef !== undefined || args.taskRef !== undefined) throw new Error(recoveryFor('main_stream_addressing').sentence({ refused: 'a Thread ref and projectRef' }))
  const workspaceId = workspaceOf(args, agent)
  const projectRef = projectRefOf(args.projectRef!) as AgentTeamProjectRef
  const base = { workspaceId, scope: 'main' }
  if (args.action !== 'message' && args.messageRef !== undefined) {
    throw new Error(recoveryFor('action_only_arguments').sentence({ action: args.action, parameter: 'messageRef', owner: 'message' }))
  }
  if (args.action === 'message') {
    if (args.messageRef === undefined) throw new Error(recoveryFor('missing_message_ref').sentence({ refused: 'for action message' }))
    if (args.beforeSequence !== undefined || args.limit !== undefined) throw new Error(recoveryFor('history_only_arguments').sentence({ action: 'message' }))
    const read = host.readMessageForAgent(agent, { workspaceId, projectRef, messageRef: args.messageRef as AgentTeamMessageRef })
    const value = { ...base, projectRef: read.projectRef, kind: 'message', message: { messageRef: read.messageRef, sender: read.sender, sequence: read.sequence,
      ...(read.occurredAt === undefined ? {} : { occurredAt: read.occurredAt }), body: read.body, bodyOmitted: false } }
    return budgetReading(agent, value, candidate => mainStreamLines(args.action, candidate).join('\n'), capacity).value
  }
  if (args.action === 'history') {
    const history = host.mainStreamHistoryForAgent(agent, { workspaceId, projectRef,
      ...(args.beforeSequence === undefined ? {} : { beforeSequence: args.beforeSequence }), ...(args.limit === undefined ? {} : { limit: args.limit }) })
    return { ...base, projectRef: history.projectRef, kind: 'history', entries: history.entries.map(mainEntryView), cursor: history.cursor,
      hasMore: history.hasMore, standing: standingView(history.standing) }
  }
  if (args.action !== 'read' && (args.beforeSequence !== undefined || args.limit !== undefined)) throw new Error(recoveryFor('history_only_arguments').sentence({ action: args.action }))
  const view = (read: Awaited<ReturnType<AgentTeam['readMainStreamForAgent']>>) => ({ ...base, projectRef: read.projectRef, kind: 'read',
    entries: read.entries.map(entry => ({ ...mainEntryView(entry),
      ...(entry.kind === 'message' && read.visibleMessageRefs.includes(entry.message.messageRef) ? { bodyOmitted: true } : {}),
      ...(entry.kind === 'activity' && read.visibleActivityRefs.includes(entry.activity.activityRef) ? { activityOmitted: true } : {}) })),
    readThroughSequence: read.readThroughSequence, remainingUnreadCount: read.standing.unreadCount, standing: standingView(read.standing) })
  let selected: ReturnType<typeof view> | undefined
  const read = await host.readMainStreamForAgent(agent, { requestId: readRequestId, workspaceId, projectRef }, preview => {
    const budget = budgetReading(agent, view(preview), candidate => mainStreamLines(args.action, candidate).join('\n'), capacity)
    selected = budget.value
    return preview.entries.some(entry => entry.unread) ? budget.through : preview.readThroughSequence
  })
  return selected === undefined ? budgetReading(agent, view(read), candidate => mainStreamLines(args.action, candidate).join('\n'), capacity).value
    : { ...selected, readThroughSequence: read.readThroughSequence, remainingUnreadCount: read.standing.unreadCount, standing: standingView(read.standing) }
}

function threadResult(
  kind: 'read' | 'history' | 'message',
  workspaceId: string,
  snapshot: Awaited<ReturnType<AgentTeam['readThreadForAgent']>> | ReturnType<AgentTeam['threadHistoryForAgent']>,
  attention: Awaited<ReturnType<AgentTeam['readThreadForAgent']>>['attention'],
  facts: FactView[],
  extra: { cursor?: number; hasMore?: boolean; readThroughSequence?: number; remainingUnreadCount?: number; earlierFactCount?: number; taskNumber?: number; taskCards?: TaskCardView[]; reminders?: AgentTeamInboxReminder[]; message?: { messageRef: string; sender: string; sequence: number; occurredAt?: string; body: string; bodyOmitted?: boolean } } = {},
): { workspaceId: string; projectRef: string; anchor: { messageRef: string; sender: string; body: string; sequence: number; occurredAt?: string; replyToMessageRef?: string; replyTo?: ReplyContextView }; message?: { messageRef: string; sender: string; sequence: number; occurredAt?: string; body: string; bodyOmitted?: boolean }; threadRef: string; revision: number; kind: string; following: boolean; taskRef?: string; status?: string; resolution?: string; taskNumber?: number; accountable?: string; readThroughSequence?: number; remainingUnreadCount?: number; earlierFactCount?: number; cursor?: number; hasMore?: boolean; taskCards?: TaskCardView[]; reminders?: AgentTeamInboxReminder[]; claims: ClaimView[]; facts: FactView[] } {
  return {
    workspaceId, projectRef: snapshot.anchor.projectRef,
    kind, threadRef: snapshot.thread.threadRef, revision: snapshot.thread.revision,
    ...(snapshot.task === undefined ? {} : { taskRef: snapshot.task.taskRef, status: snapshot.task.status, resolution: snapshot.task.resolution, accountable: snapshot.task.accountable }),
    ...(extra.taskNumber === undefined ? {} : { taskNumber: extra.taskNumber }),
    following: attention !== undefined,
    ...extra,
    ...(attention === undefined || extra.readThroughSequence !== undefined ? {} : { readThroughSequence: attention.readThroughSequence }),
    anchor: { messageRef: snapshot.anchor.messageRef, sender: snapshot.anchor.sender, body: snapshot.anchor.body, sequence: snapshot.anchor.sequence, occurredAt: snapshot.anchor.occurredAt, ...(snapshot.anchor.replyToMessageRef === undefined ? {} : { replyToMessageRef: snapshot.anchor.replyToMessageRef }), ...(snapshot.anchor.replyTo === undefined ? {} : { replyTo: snapshot.anchor.replyTo }) },
    claims: snapshot.claims.map(claimView),
    facts,
  }
}

/** A direct message is not a Thread fact: `dm` takes a Member ref and a body only (no Thread, Task, write token, or attachments). Sharing a pocket with `reply` would let a model hand a `threadRef` to a call with no Thread to address. A DM is a private note; shared work belongs in a Thread reply. */
const teamDm = defineTool({
  name: 'team_dm',
  description: 'Send one private direct message to a single enabled Agent Member in your Workspace. It takes a memberRef and a body and nothing else: no Thread, no Task, no write token, and no attachments, because a DM addresses a person rather than a conversation. Use it for quick clarifications and status syncs — never for task work, decisions, or anything that needs team visibility or traceability, which belongs in a Thread reply. If an exchange with the same Member runs past about three messages, move it to a Thread: every DM costs the recipient a full agent turn. A DM is recorded whether or not the recipient session could be woken, and the result says which happened; there is no automatic redelivery, so never blindly send a duplicate. The Human cannot be DMed.',
  parameters: {
    memberRef: { type: 'string', required: true, description: "Full branded Member ref exactly as returned by Team tools, including the 'member:' prefix. An unambiguous abbreviation of the first 6+ UUID hex characters also resolves. The Member must be an enabled Agent in your Workspace (the Human cannot be DMed)." },
    body: { type: 'string', required: true, description: "Markdown body. Lead with the conclusion or state; keep it the shortest useful message for the recipient. Only the named Member receives it: @mentions in the text do not notify the Human or anyone else. Use team_message when a decision or shared work needs their attention." },
    workspace: workspaceParam,
  },
  output: teamDmOutput,
  async execute(rawArgs, exec) {
    const args = blankToAbsent(rawArgs, OPTIONAL_ADDRESS_KEYS)
    const agent = exec.agent
    if (agent === undefined) throw new Error('team_dm requires an Agent session')
        // A stray field is refused rather than ignored: a model reaching for a Thread write's shape meant a Thread reply, and dropping the field would send a private note where shared work was intended. Hand-written because the harness compiles parameter tables to `{type, properties, required}` with no `additionalProperties`, so no schema can refuse an unnamed key. Not redundant.
    const stray = Object.keys(args).filter(key => key !== 'memberRef' && key !== 'body' && key !== 'workspace')
    if (stray.length > 0) throw new Error(`team_dm does not accept ${stray.join(', ')}; it takes memberRef and body only — a DM addresses a person, so shared work belongs in a team_message reply.`)
    if (args.memberRef === undefined) throw new Error(recoveryFor('dm_requires_member').sentence({}))
    if (typeof args.body !== 'string' || args.body.trim() === '') throw new Error(`team_dm needs the message text in its body parameter — a blank or missing body is usually the text landing in the reply channel instead. Put the full message in body and resend.`)
    try {
      const result = await service(agent).dmForAgent(agent, { requestId: requestId(agent.id, exec.callId), workspaceId: workspaceOf(args, agent),
        recipientMemberId: args.memberRef as AgentTeamMemberId, body: args.body })
      return { kind: 'dm-sent', recipientMemberId: result.recipient.memberId, recipientHandle: result.recipient.handle, delivered: true, occurredAt: result.receipt.occurredAt }
    } catch (error) {
      if (error instanceof AgentTeamDmDeliveryError) {
        return { kind: 'dm-sent', recipientMemberId: error.recipientMemberId, recipientHandle: error.recipientHandle, delivered: false, deliveryNote: error.message }
      }
      throw error
    }
  },
})

const teamMessage = markAgentTeamPreset(defineTool({
  name: 'team_message',
  description: 'Post to a Project\'s Main stream, start a Thread, or reply to one. post speaks in the Project\'s Main stream — the conversation outside every Thread — and any enabled Member who participates in the Project\'s Workspace may: pass projectRef and body, mention with `@Handle`, and optionally replyToMessageRef (a Main stream Message of the same Project, whose author is delivered to). Pending Main stream entries must be complete in the current context; use team_thread read with projectRef for missing facts and acknowledgement. post has no write token. start opens a discussion or a Task (kind) and only a Project owner may — a Thread starts from a standing question or piece of work, not from conversation. Understand the Thread before replying; a write needs a current token from a drained read, your own commit, or a complete rejection that provides one. Complete Message and Activity facts in context can satisfy reading, but never acknowledge unread; every write rechecks new facts, revision, permissions and Task state. A mention supplies its Message, not earlier discussion; read missing background first. start takes kind discussion (default) or task. A mention in a start or a reply delivers its Message to that Member once and never makes them follow; `@all` is plain text under version 2 and reaches no one. A private note to one Member is team_dm, not a reply.',
  parameters: {
    action: { type: 'string', required: true, enum: ['start', 'reply', 'post'] },
    projectRef: { type: 'string', description: "Full branded Project ref exactly as returned by Team tools, including the 'project:' prefix. An unambiguous abbreviation of the first 6+ UUID hex characters also resolves. Required by start and post." },
    kind: { type: 'string', enum: ['discussion', 'task'], description: 'start only: discussion (default) opens a Thread to talk something through; task opens a Thread that carries a Task.' },
    accountable: { type: 'string', description: "start with kind task only: who becomes accountable for the new Task — a current Project owner's memberRef or @Handle, or 'human'. Omit it and the Agent owner who starts the Task is accountable, or the Human when the Human starts it. It does not change who may start a Task." },
    sourceThreadRefs: { type: 'array', items: { type: 'string' }, description: 'start with kind task only: the discussion Threads this Task derives from, as full branded threadRefs of the same Project. Each becomes a source of the new Task, which the card renders there instead of in the Main stream; a Task may name several. Task Threads and other Projects are refused, and a source is fixed at creation — promoting a discussion in place records no source.' },
    threadRef: { type: 'string', description: "Full branded Thread ref exactly as returned by Team tools, including the 'thread:' prefix. An unambiguous abbreviation of the first 6+ UUID hex characters also resolves." },
    taskRef: { type: 'string', description: "Optional Task ref alias for reply on a Taskful Thread. Prefer threadRef; an unambiguous abbreviation of the first 6+ UUID hex characters also resolves." },
    replyToMessageRef: { type: 'string', description: "Optional: the full branded Message ref you are answering (for post: a Main stream Message of the same Project) (as rendered by team_thread or an inbox notice). Reply on the Thread you are already replying to; the Message must be one this Thread recorded. The Host links the reply to it, and its author is then delivered to like a mention, so answering a peer reaches them without typing their handle. Use it when the link is the point — the reader needs to know which Message you are answering. A Message that only continues the Thread's conversation needs neither this nor a mention: the Thread already delivers to the Members on it, so the link would announce a delivery that was going to happen anyway." },
    body: { type: 'string', required: true, description: "Markdown body. Lead with the conclusion or state; keep it the shortest useful message for the recipients. Cite Team refs exactly as returned, as bare text with one colon (e.g. task:0f0a…) — never a double colon, never inside backticks or quotes. Unambiguous UUID abbreviations (first 6+ hex chars) also resolve. Mention a Member by writing `@Handle` (`@` required, case-insensitive) in the prose: that is what delivers the Message to them and renders the mention chip; `@all` is plain text under version 2 and delivers to no one — name each Member instead." }, baseRevision: { type: 'number', description: "The next-write token from a fully drained team_thread read, your own last committed mutation, or a complete rejection that explicitly provides one on this Thread. Copy the explicitly rendered value verbatim; never increment, derive, compare, or cite it — it is an opaque concurrency token, not a fact about the Thread." },
    attachments: { type: 'array', items: { type: 'string' }, description: 'Absolute file paths to share, e.g. screenshots or generated artifacts; images render as thumbnails for recipients. The Host validates each path and copies the file into the attachment cache, and members also receive one cached path per attachment; if any path fails validation the whole send is rejected.' },
    workspace: workspaceParam,
  },
  output: teamMessageOutput,
  async execute(rawArgs, exec) {
    const args = blankToAbsent(rawArgs, [...OPTIONAL_ADDRESS_KEYS, ...OPTIONAL_COLLECTION_KEYS])
    const agent = exec.agent
    if (agent === undefined) throw new Error('team_message requires an Agent session')
    const host = service(agent)
    const rawPaths = args.attachments
    const attachmentPaths = Array.isArray(rawPaths) ? rawPaths.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '') : undefined
    const paths = attachmentPaths !== undefined && attachmentPaths.length > 0 ? { attachmentPaths } : {}
    if (typeof args.body !== 'string' || args.body.trim() === '') throw new Error(`team_message needs the message text in its body parameter — a blank or missing body is usually the text landing in the reply channel instead. Put the full message in body and resend.`)
    if (args.action === 'post') {
      // `post` is a plain Main stream message, so `kind`, `sourceThreadRefs`, and `accountable` belong to `start` alone. A model that fills every optional slot declares `kind: 'discussion'` on a post that is a discussion by definition; dropping those here, rather than refusing, is what keeps a post from costing a retry — the same reason a read ignores its page size.
      if (args.projectRef === undefined || args.taskRef !== undefined || args.threadRef !== undefined || args.baseRevision !== undefined) throw new Error(`post requires projectRef and does not accept threadRef, taskRef, or baseRevision — ${recoveryFor('post_requires_project').sentence({})}`)
      if (args.accountable !== undefined) throw new Error(recoveryFor('action_only_arguments').sentence({ action: 'post', parameter: 'accountable', owner: 'start' }))
      // An empty `sourceThreadRefs` names no source, exactly as `attachments: []` names no file: the parameter carries nothing to honor, so it is not a mis-sent `start` argument.
      if (args.sourceThreadRefs !== undefined && args.sourceThreadRefs.length > 0) throw new Error(recoveryFor('action_only_arguments').sentence({ action: 'post', parameter: 'sourceThreadRefs', owner: 'start' }))
      const result = await host.postMainMessageForAgent(agent, { requestId: requestId(agent.id, exec.callId), workspaceId: workspaceOf(args, agent),
        projectRef: projectRefOf(args.projectRef) as never,
        ...(args.replyToMessageRef === undefined ? {} : { replyToMessageRef: args.replyToMessageRef as AgentTeamMessageRef }), body: args.body, ...paths })
      if (result.kind === 'committed') {
        const attention = host.mainAttentionStatusForAgent(agent, { workspaceId: workspaceOf(args, agent), projectRef: result.message.projectRef })
        return { kind: result.kind, action: 'post', projectRef: result.message.projectRef, messageRef: result.message.messageRef, occurredAt: result.receipt.occurredAt,
          following: attention.attention !== undefined }
      }
      return { kind: result.kind, projectRef: result.projectRef, unreadCount: result.unreadCount, directCount: result.directCount, entries: result.entries.map(mainEntryView) }
    }
    if (args.action === 'start') {
      if (args.projectRef === undefined || args.taskRef !== undefined || args.threadRef !== undefined || args.baseRevision !== undefined) throw new Error(`start requires projectRef and does not accept threadRef, taskRef, or baseRevision — ${recoveryFor('start_requires_project').sentence({})}`)
      // The schema is implicitly open, so the removed `asTask` alias would otherwise be dropped silently and the
      // start would commit as a discussion — the model must learn it was not heard.
      if ((args as { readonly asTask?: unknown }).asTask !== undefined) throw new Error(`start does not accept asTask — pass kind: 'task' instead — ${recoveryFor('action_only_arguments').sentence({ action: 'start', parameter: 'asTask', owner: 'start' })}`)
      const kind = args.kind === 'task' ? 'task' : 'discussion'
      if (kind === 'discussion' && args.accountable !== undefined) throw new Error(recoveryFor('action_only_arguments').sentence({ action: 'start (discussion)', parameter: 'accountable', owner: 'start' }))
      if (kind === 'discussion' && args.sourceThreadRefs !== undefined) throw new Error(recoveryFor('action_only_arguments').sentence({ action: 'start (discussion)', parameter: 'sourceThreadRefs', owner: 'start' }))
      const request = { requestId: requestId(agent.id, exec.callId), workspaceId: workspaceOf(args, agent), projectRef: projectRefOf(args.projectRef) as never, body: args.body, ...paths }
      const result = await host.startThreadForAgent(agent, { ...request, kind,
        ...(args.accountable === undefined ? {} : { accountable: memberTarget(host, args.accountable) }),
        ...(args.sourceThreadRefs === undefined ? {} : { sourceThreadRefs: args.sourceThreadRefs.map(ref => ref as AgentTeamThreadRef) }) })
      return messageOutcome(result, 'start')
    }
    const baseRevision = args.baseRevision
    if (args.projectRef !== undefined) throw new Error(`reply does not take projectRef — ${recoveryFor('main_stream_addressing').sentence({ refused: 'projectRef on reply' })}`)
    if (args.threadRef === undefined && args.taskRef === undefined) throw new Error(`reply needs threadRef or taskRef — ${recoveryFor('missing_thread_identity').sentence({})}`)
    if (typeof baseRevision !== 'number' || !Number.isSafeInteger(baseRevision) || baseRevision < 1) {
      throw new Error(`reply requires a positive baseRevision — ${recoveryFor('missing_write_token').sentence({})}`)
    }
    // `kind` belongs to `start`; a model filling every optional slot sends the
    // start default `kind: 'discussion'` on a reply. That value changes nothing
    // about the reply, so it must not be reported as a missing token; a genuine
    // `task` kind still gets named.
    if (args.kind !== undefined && args.kind !== 'discussion') throw new Error(recoveryFor('action_only_arguments').sentence({ action: 'reply', parameter: 'kind', owner: 'start' }))
    if (args.accountable !== undefined) throw new Error(recoveryFor('action_only_arguments').sentence({ action: 'reply', parameter: 'accountable', owner: 'start' }))
    if (args.sourceThreadRefs !== undefined) throw new Error(recoveryFor('action_only_arguments').sentence({ action: 'reply', parameter: 'sourceThreadRefs', owner: 'start' }))
    const result = await host.replyForAgent(agent, { requestId: requestId(agent.id, exec.callId), workspaceId: workspaceOf(args, agent),
      ...(args.threadRef === undefined ? {} : { threadRef: args.threadRef as AgentTeamThreadRef }),
      ...(args.taskRef === undefined ? {} : { taskRef: args.taskRef as AgentTeamTaskRef }),
      ...(args.replyToMessageRef === undefined ? {} : { replyToMessageRef: args.replyToMessageRef as AgentTeamMessageRef }),
      body: args.body, baseRevision, ...paths })
    const outcome = messageOutcome(result, 'reply')
    if (result.kind === 'committed') {
      const status = host.attentionStatusForAgent(agent, { workspaceId: workspaceOf(args, agent), threadRef: result.thread.threadRef })
      return { ...outcome, following: status.attention !== undefined }
    }
    return outcome
  },
}))

function messageOutcome(result: Awaited<ReturnType<AgentTeam['startThreadForAgent']>> | Awaited<ReturnType<AgentTeam['replyForAgent']>>, action: 'start' | 'reply') {
  if (result.kind === 'committed') {
    // Starting a Thread follows its author, so the start result names the
    // Attention the writer just acquired. A reply never starts one.
    const own = action === 'start' ? result.attention.find(attention => attention.memberId === result.message.sender) : undefined
    return { kind: result.kind, action, threadRef: result.thread.threadRef,
      ...(result.task === undefined ? {} : { taskRef: result.task.taskRef, accountable: result.task.accountable }),
      ...(result.task === undefined || result.task.sourceThreadRefs.length === 0 ? {} : { sourceThreadRefs: [...result.task.sourceThreadRefs] }),
      revision: result.thread.revision, messageRef: result.message.messageRef, occurredAt: result.receipt.occurredAt,
      ...(own === undefined ? {} : { source: own.source }) }
  }
  if (result.kind === 'unread_required') return { kind: result.kind, ...(result.taskRef === undefined ? {} : { taskRef: result.taskRef }), threadRef: result.threadRef,
    revision: result.revision, unreadCount: result.unreadCount, directCount: result.directCount,
    ...(result.facts === undefined ? {} : { facts: result.facts.map(entry => readFactView(entry)) }) }
  if (result.kind === 'stale_revision') return { kind: result.kind, ...(result.taskRef === undefined ? {} : { taskRef: result.taskRef }), threadRef: result.threadRef,
    expectedRevision: result.expectedRevision, revision: result.revision,
    ...(result.staleTokenKind === undefined ? {} : { staleTokenKind: result.staleTokenKind }),
    ...(result.facts === undefined ? {} : { facts: result.facts.map(entry => readFactView(entry)) }) }
  throw new Error(`Agents cannot receive a ${result.kind} message outcome`)
}

/** Who a Task refusal should name: the Human by their role, an Agent by its stable ref, so the reader can address a transfer. */
function accountableLabel(host: AgentTeam, memberId: string): string {
  if (memberId === AGENT_TEAM_HUMAN_MEMBER_ID) return 'the Human'
  const handle = host.members().find(status => status.member.memberId === memberId)?.member.handle
  return handle === undefined ? memberId : `@${handle} (${memberId})`
}

/**
 * The ledger names the refusal and its way out, but it cannot say what the Task looks like now: only the caller can read the projection after the refusal. So a Task-authority refusal gains one sentence naming the current state and who holds responsibility.
 */
function withTaskAuthorityHint(error: unknown, host: AgentTeam, agent: Parameters<typeof service>[0], base: { readonly workspaceId: Parameters<AgentTeam['listClaimsForAgent']>[1]['workspaceId']; readonly taskRef: AgentTeamTaskRef }): unknown {
  const message = error instanceof Error ? error.message : String(error)
  if (!/\((?:self_acceptance_forbidden|accountable_owner_required)\)/u.test(message)) return error
  let listed: ReturnType<AgentTeam['listClaimsForAgent']>
  try {
    listed = host.listClaimsForAgent(agent, base)
  } catch {
    return error
  }
  return new Error(`${message} Currently ${base.taskRef} is ${listed.task.status}${listed.task.resolution === 'open' ? '' : ` (${listed.task.resolution})`}, accountable to ${accountableLabel(host, listed.task.accountable)}.`)
}

const teamTask = defineTool({
  name: 'team_task',
  description: 'Work with Tasks. board lists the Task board of the Projects you can see — every open Task with its status, who is accountable for it, and the Members on it, plus each Project\'s newest finished Tasks — filtered by projectRef or to your own responsibility with mine; it is current state, not unread, so check it before you claim or when a Workspace change surprises you. promote turns a discussion Thread into a Task (Project owners only) and takes accountable to name the owner responsible for it; a Task started with team_message start takes the same field. list, claim, done and release manage your Direction Claims. Every Task has one accountable: the Human or an Agent Member. accept finishes a Task as verified work; close ends it without acceptance; reopen returns it to open work; transfer hands accountability to another enabled Member of this Workspace or back to the Human, and the new accountable starts following the Thread. Who may do which is the Host\'s call, not yours to reason around: accept belongs to the Human, to a Project owner, or to the Task\'s own accountable, and never to a Member that held any Claim on it (an Agent may accept only an in_review Task); close, reopen and transfer belong to the Human or the current accountable. Finishing your own Claim is not acceptance, and an Agent that executed a Task cannot verify it. transfer moves responsibility only — Claims and their owners stay where they are. Mutations need a current token from a drained read, your own commit, or a complete rejection that provides one. Reconsider the facts first; each attempt rechecks them and Task permissions. list only refreshes active Claims.',
  parameters: {
    action: { type: 'string', required: true, enum: ['board', 'list', 'claim', 'done', 'release', 'promote', 'accept', 'close', 'reopen', 'transfer'] },
    projectRef: { type: 'string', description: 'board only: limit the board to one Project.' },
    mine: { type: 'boolean', description: 'board only: only Tasks you are accountable for or hold a live Claim on.' },
    threadRef: { type: 'string', description: 'promote only: the discussion Thread to turn into a Task.' },
    taskRef: { type: 'string', description: "Full branded Task ref exactly as returned by Team tools, including the 'task:' prefix. An unambiguous abbreviation of the first 6+ UUID hex characters also resolves." },
    baseRevision: { type: 'number', description: "The next-write token from a fully drained team_thread read, your own last committed mutation, or a complete rejection that explicitly provides one on this Task's Thread. Copy the explicitly rendered value verbatim; never increment, derive, compare, or cite it — it is an opaque concurrency token, not a fact about the Task." },
    direction: { type: 'string', description: 'claim only: your one-sentence direction statement on the Task — the angle you are taking, so others can spot collisions and track progress. Put multi-paragraph plans, step order, file lists, and acceptance criteria in Thread messages, not the Claim.' },
    claimRef: { type: 'string', description: "Full branded Claim ref exactly as returned by team_task, including the 'claim:' prefix. An unambiguous abbreviation of the first 6+ UUID hex characters also resolves." },
    accountable: { type: 'string', description: "promote only: the Member who becomes accountable for the new Task — a current Project owner's memberRef or @Handle, or 'human'. Omit it and the promoting owner is accountable, or the Human when the Human promotes." },
    target: { type: 'string', description: "transfer only: the Member who becomes accountable — any enabled member of this Task's Project, as a memberRef, @Handle, or a unique 6+ hex prefix, or 'human' to return responsibility to the Human. Following the Thread is not required." },
    workspace: workspaceParam,
  },
  output: teamTaskOutput,
  async execute(rawArgs, exec) {
    // `direction` is meaningful only for `claim`; a model that fills every slot
    // sends `direction: ""` on board/list/resolution actions too. Treat that empty
    // slot as absent here, while the claim guard still refuses a genuinely missing
    // direction with its own route.
    const args = blankToAbsent(rawArgs, [...OPTIONAL_ADDRESS_KEYS, 'direction'])
    const agent = exec.agent
    if (agent === undefined) throw new Error('team_task requires an Agent session')
    const host = service(agent)
    if (args.action === 'board') {
      if (args.taskRef !== undefined || args.threadRef !== undefined || args.baseRevision !== undefined || args.direction !== undefined || args.claimRef !== undefined) throw new Error(recoveryFor('board_takes_no_task').sentence({}))
      if (args.accountable !== undefined) throw new Error(recoveryFor('action_only_arguments').sentence({ action: 'board', parameter: 'accountable', owner: 'promote' }))
      if (args.target !== undefined) throw new Error(recoveryFor('action_only_arguments').sentence({ action: 'board', parameter: 'target', owner: 'transfer' }))
      const board = host.taskBoardForAgent(agent, { ...(args.workspace === undefined ? {} : { workspaceId: workspaceOf(args, agent) }),
        ...(args.projectRef === undefined ? {} : { projectRef: projectRefOf(args.projectRef) as AgentTeamProjectRef }), ...(args.mine === true ? { mine: true } : {}) })
      return { kind: 'board', open: board.open.map(boardItemView), finished: board.finished.map(boardItemView), finishedTruncated: board.finishedTruncated }
    }
    if (args.action === 'promote') {
      if (args.taskRef !== undefined || args.direction !== undefined || args.claimRef !== undefined) throw new Error(recoveryFor('promote_takes_thread').sentence({}))
      if (args.target !== undefined) throw new Error(recoveryFor('action_only_arguments').sentence({ action: 'promote', parameter: 'target', owner: 'transfer' }))
      if (args.threadRef === undefined) throw new Error(recoveryFor('promote_requires_thread').sentence({}))
      const baseRevision = args.baseRevision
      if (typeof baseRevision !== 'number' || !Number.isSafeInteger(baseRevision) || baseRevision < 1) throw new Error(recoveryFor('missing_write_token').sentence({}))
      const result = await host.promoteThreadForAgent(agent, { requestId: requestId(agent.id, exec.callId), workspaceId: workspaceOf(args, agent),
        threadRef: args.threadRef as AgentTeamThreadRef, baseRevision,
        ...(args.accountable === undefined ? {} : { accountable: memberTarget(host, args.accountable) }) })
      if (result.kind === 'committed') return { kind: result.kind, action: 'promote', taskRef: result.task.taskRef, threadRef: result.thread.threadRef,
        revision: result.thread.revision, status: result.task.status, accountable: result.task.accountable, occurredAt: result.receipt.occurredAt }
      if (result.kind === 'unread_required') return { kind: result.kind, threadRef: result.threadRef, revision: result.revision,
        unreadCount: result.unreadCount, directCount: result.directCount, ...(result.facts === undefined ? {} : { facts: result.facts.map(entry => readFactView(entry)) }) }
      return { kind: result.kind, threadRef: result.threadRef, expectedRevision: result.expectedRevision, revision: result.revision,
        ...(result.staleTokenKind === undefined ? {} : { staleTokenKind: result.staleTokenKind }),
        ...(result.facts === undefined ? {} : { facts: result.facts.map(entry => readFactView(entry)) }) }
    }
    if (args.taskRef === undefined) throw new Error(recoveryFor('task_action_requires_task').sentence({ action: args.action }))
    const base = { workspaceId: workspaceOf(args, agent), taskRef: args.taskRef as AgentTeamTaskRef }
    if (args.action === 'list') {
      if (args.baseRevision !== undefined || args.direction !== undefined || args.claimRef !== undefined || args.threadRef !== undefined) throw new Error(recoveryFor('list_takes_task_only').sentence({}))
      if (args.accountable !== undefined) throw new Error(recoveryFor('action_only_arguments').sentence({ action: 'list', parameter: 'accountable', owner: 'promote' }))
      if (args.target !== undefined) throw new Error(recoveryFor('action_only_arguments').sentence({ action: 'list', parameter: 'target', owner: 'transfer' }))
      const listed = host.listClaimsForAgent(agent, base)
      return { kind: 'listed', taskRef: listed.task.taskRef, threadRef: listed.thread.threadRef, revision: listed.thread.revision, status: listed.task.status,
        accountable: listed.task.accountable, claims: listed.claims.map(claimView) }
    }
    if (args.threadRef !== undefined || args.projectRef !== undefined) throw new Error(recoveryFor('task_action_requires_task').sentence({ action: args.action }))
    if (args.accountable !== undefined) throw new Error(recoveryFor('action_only_arguments').sentence({ action: args.action, parameter: 'accountable', owner: 'promote' }))
    if (args.target !== undefined && args.action !== 'transfer') throw new Error(recoveryFor('action_only_arguments').sentence({ action: args.action, parameter: 'target', owner: 'transfer' }))
    const baseRevision = args.baseRevision
    if (typeof baseRevision !== 'number' || !Number.isSafeInteger(baseRevision) || baseRevision < 1) throw new Error(recoveryFor('missing_write_token').sentence({}))
    if (args.action === 'transfer') {
      if (args.direction !== undefined || args.claimRef !== undefined) throw new Error(recoveryFor('action_only_arguments').sentence({ action: 'transfer', parameter: args.direction === undefined ? 'claimRef' : 'direction', owner: args.direction === undefined ? 'done' : 'claim' }))
      if (args.target === undefined || args.target.trim() === '') throw new Error('transfer needs target — the enabled Member of this Workspace who becomes accountable for this Task, or human.')
      const target = memberTarget(host, args.target)
      let transferred: Awaited<ReturnType<AgentTeam['transferTaskForAgent']>>
      try {
        transferred = await host.transferTaskForAgent(agent, { requestId: requestId(agent.id, exec.callId), ...base, target, baseRevision })
      } catch (error) {
        throw withTaskAuthorityHint(error, host, agent, base)
      }
      const listed = host.listClaimsForAgent(agent, base)
      if (transferred.kind === 'committed') return { kind: transferred.kind, action: 'transfer', taskRef: transferred.task.taskRef,
        threadRef: transferred.thread.threadRef, revision: transferred.thread.revision, status: transferred.task.status,
        resolution: transferred.task.resolution, accountable: transferred.task.accountable,
        ...(transferred.activity.from === undefined ? {} : { from: transferred.activity.from }),
        ...(transferred.activity.to === undefined ? {} : { to: transferred.activity.to }), occurredAt: transferred.receipt.occurredAt }
      return taskRejection(transferred, listed)
    }
    if (args.action === 'accept' || args.action === 'close' || args.action === 'reopen') {
      if (args.direction !== undefined || args.claimRef !== undefined) throw new Error(recoveryFor('action_only_arguments').sentence({ action: args.action, parameter: args.direction === undefined ? 'claimRef' : 'direction', owner: args.direction === undefined ? 'done' : 'claim' }))
      let resolved: Awaited<ReturnType<AgentTeam['changeTaskForAgent']>>
      try {
        resolved = await host.changeTaskForAgent(agent, { requestId: requestId(agent.id, exec.callId), ...base, action: args.action, baseRevision })
      } catch (error) {
        throw withTaskAuthorityHint(error, host, agent, base)
      }
      const listed = host.listClaimsForAgent(agent, base)
      if (resolved.kind === 'committed') return { kind: resolved.kind, action: args.action, taskRef: resolved.task.taskRef,
        threadRef: resolved.thread.threadRef, revision: resolved.thread.revision, status: resolved.task.status,
        resolution: resolved.task.resolution, accountable: resolved.task.accountable,
        ...(resolved.activity.acceptedClaimRefs === undefined ? {} : { acceptedClaimRefs: [...resolved.activity.acceptedClaimRefs] }),
        ...(resolved.activity.releasedClaimRefs === undefined ? {} : { releasedClaimRefs: [...resolved.activity.releasedClaimRefs] }),
        occurredAt: resolved.receipt.occurredAt }
      return taskRejection(resolved, listed)
    }
    if (args.action === 'claim' && (args.direction === undefined || args.claimRef !== undefined)) throw new Error(recoveryFor('claim_requires_direction').sentence({}))
    if ((args.action === 'done' || args.action === 'release') && (args.claimRef === undefined || args.direction !== undefined)) throw new Error(recoveryFor('claim_close_requires_ref').sentence({ action: args.action }))
    const result = await host.changeClaimForAgent(agent, { requestId: requestId(agent.id, exec.callId), ...base, action: args.action,
      baseRevision, ...(args.direction === undefined ? {} : { direction: args.direction }), ...(args.claimRef === undefined ? {} : { claimRef: args.claimRef as AgentTeamClaimRef }) })
        // Every mutation outcome re-reads the real Claim archive and Task status; the render layer omits the archive, never the structured value.
    const listed = host.listClaimsForAgent(agent, base)
    const claims = listed.claims.map(claimView)
    if (result.kind === 'committed') return { kind: result.kind, action: args.action, taskRef: result.task.taskRef, threadRef: result.thread.threadRef,
      revision: result.thread.revision, status: result.task.status, accountable: result.task.accountable, claim: claimView(result.claim), claims,
      // Present when the Claim started the executor's own Attention, which is the
      // one cause this result can state without asking the projection again.
      ...(result.attention === undefined ? {} : { source: result.attention.source }),
      occurredAt: result.receipt.occurredAt }
    return taskRejection(result, listed)
  },
})

/** The two typed Task rejections, in the shared outcome-first form: gating facts, the affected Task's standing, and the current revision as the next write token. */
function taskRejection(
  result: { readonly kind: 'unread_required' | 'stale_revision'; readonly threadRef: AgentTeamThreadRef; readonly revision: number
    readonly unreadCount?: number; readonly directCount?: number; readonly expectedRevision?: number
    readonly staleTokenKind?: 'unknown' | 'unrecognized'
    readonly facts?: readonly { readonly fact: AgentTeamThreadFact; readonly unread: boolean; readonly direct: boolean }[] },
  listed: ReturnType<AgentTeam['listClaimsForAgent']>,
) {
  const claims = listed.claims.map(claimView)
  const facts = result.facts === undefined ? {} : { facts: result.facts.map(entry => readFactView(entry)) }
  if (result.kind === 'unread_required') return { kind: result.kind, taskRef: listed.task.taskRef, threadRef: result.threadRef,
    revision: result.revision, status: listed.task.status, accountable: listed.task.accountable,
    unreadCount: result.unreadCount ?? 0, directCount: result.directCount ?? 0, claims, ...facts }
  return { kind: result.kind, taskRef: listed.task.taskRef, threadRef: result.threadRef,
    ...(result.expectedRevision === undefined ? {} : { expectedRevision: result.expectedRevision }),
    revision: result.revision, status: listed.task.status, accountable: listed.task.accountable, claims,
    ...(result.staleTokenKind === undefined ? {} : { staleTokenKind: result.staleTokenKind }), ...facts }
}

const teamView = defineTool({
  name: 'team_view',
  description: 'Discover your authorized Team addresses: every active Project in the Workspace (with owners, your owner/following/none relation, and subscription counts), a newest-first page of top-level Threads in the Workspace (each with its bounded anchor subject; Task standing inline on taskful rows), and current Workspace Members. This is an address book, not a work queue: unread work lives in team_inbox, work in flight on team_task board, and a Thread is read with team_thread read. The cursor pages Thread rows only.',
  parameters: {
    projectRef: { type: 'string', description: "Full branded Project ref exactly as returned by Team tools, including the 'project:' prefix. An unambiguous abbreviation of the first 6+ UUID hex characters also resolves." },
    limit: { type: 'number' }, cursor: { type: 'number' }, workspace: workspaceParam,
  },
  output: teamViewOutput,
  async execute(rawArgs, exec) {
    const args = blankToAbsent(rawArgs, OPTIONAL_ADDRESS_KEYS)
    const agent = exec.agent
    if (agent === undefined) throw new Error('team_view requires an Agent session')
    const host = service(agent)
    const workspaceId = workspaceOf(args, agent)
        // `includeCatalog` makes this the address book: the radar and Task/Thread catalog of the whole Workspace scope, not just this page's Threads. Other `view` callers keep the bounded page projection.
    const view = host.viewForAgent(agent, { workspaceId, ...(args.projectRef === undefined ? {} : { projectRef: projectRefOf(args.projectRef) as never }), ...(args.limit === undefined ? {} : { limit: args.limit }), ...(args.cursor === undefined ? {} : { cursor: args.cursor }), topLevelOnly: true, includeActivities: false, direction: 'before', includeCatalog: true })
    if (view.directory === undefined) throw new Error('team_view requires the Workspace directory projection')
    const visibleMemberIds = new Set(view.directory.memberIds)
    const self = host.memberForAgent(agent)
    const handles = new Map(host.members().map(status => [status.member.memberId, status.member.handle]))
    const ownership = view.rulesVersion >= 2
    return {
      workspaceId,
      workspaces: view.workspaces.map(participation => ({ workspaceId: participation.workspaceId,
        ...(participation.title === undefined ? {} : { title: participation.title }), default: participation.default })),
      projects: view.directory.projects.map(entry => {
        const { project, ownerIds, participating, followingMain, subscriptions } = entry
        if (!ownership) return { projectRef: project.projectRef, name: project.name, subscriptions,
          role: participating ? 'member' : 'directory only' }
        const projectOwners = view.owners.filter(owner => owner.projectRef === project.projectRef)
        // Rules version 9 keeps only what an owner owns and what a follower
        // follows: the role is the grant, the Main stream Attention, or none.
        const role = view.rulesVersion >= 9
          ? (self !== undefined && ownerIds.includes(self.memberId) ? 'owner' : followingMain === true ? 'following' : 'none')
          : participating ? (self !== undefined && ownerIds.includes(self.memberId) ? 'owner' : 'member') : 'directory only'
        return { projectRef: project.projectRef, name: project.name, subscriptions,
          owners: [host.humanHandle(), ...ownerIds.map(memberId => handles.get(memberId) ?? memberId)],
          // Only when at least one owner recorded text: a Project whose every grant
          // is unspecified adds no field and no token, and a pre-version-8 ledger
          // answers exactly as it did before the field existed. Once it appears, an
          // owner without text reads `unspecified` rather than being left out.
          ...(projectOwners.every(owner => owner.responsibility === undefined) ? {} : { ownerResponsibilities: projectOwners
            .map(owner => ({ handle: handles.get(owner.memberId) ?? owner.memberId, responsibility: owner.responsibility ?? 'unspecified' })) }),
          role }
      }),
      members: [
        { memberId: view.humanMemberId, kind: 'human', handle: host.humanHandle(), description: 'Human Team Member', presence: 'available' },
        ...host.members().filter(status => visibleMemberIds.has(status.member.memberId)).map(status => ({ memberId: status.member.memberId,
          kind: 'agent', handle: status.member.handle, description: status.member.description, presence: status.presence })),
      ],
      threads: view.items.map(item => {
        const thread = item.thread
        const task = item.task
        return { threadRef: thread.threadRef, projectRef: item.message.projectRef, revision: thread.revision, messageCount: item.messageCount,
          subject: boundedSubject(item.message.body), lastActivityAt: item.lastActivityAt,
          ...(task === undefined ? {} : { taskRef: task.taskRef, status: task.status, accountable: task.accountable, ...(item.taskNumber === undefined ? {} : { taskNumber: item.taskNumber }) }) }
      }),
            // A Task's revision is its Thread's; omitted rather than reported as `0` when the Thread is outside this page's scope, since `0` would read as "never written".
      tasks: view.tasks.map(task => {
        const revision = view.threads.find(thread => thread.threadRef === task.threadRef)?.revision
        return { taskRef: task.taskRef, threadRef: task.threadRef, projectRef: task.projectRef, status: task.status,
          ...(revision === undefined ? {} : { revision }) }
      }),
      cursor: view.cursor, hasMore: view.hasMore,
      ...(args.cursor === undefined ? {} : { page: 'threads' as const }),
    }
  },
})

/** One schedule as the model names it, and the ledger stores it. */
function reminderScheduleOf(args: { readonly scheduleKind?: string | undefined; readonly at?: string | undefined; readonly minutes?: number | undefined; readonly expression?: string | undefined }): AgentTeamReminderSchedule {
  if (args.scheduleKind === 'once') {
    if (args.at === undefined) throw new Error(`team_reminder create with scheduleKind 'once' needs \`at\` as an ISO 8601 instant — ${recoveryFor('reminder_schedule_incomplete').sentence({})}`)
    return { kind: 'once', at: args.at }
  }
  if (args.scheduleKind === 'every') {
    if (args.minutes === undefined) throw new Error(`team_reminder create with scheduleKind 'every' needs \`minutes\` as a whole number of minutes, at least 10 — ${recoveryFor('reminder_schedule_incomplete').sentence({})}`)
    return { kind: 'every', minutes: args.minutes }
  }
  if (args.scheduleKind === 'cron') {
    if (args.expression === undefined) throw new Error(`team_reminder create with scheduleKind 'cron' needs \`expression\` as five cron fields (minute hour day-of-month month day-of-week) — ${recoveryFor('reminder_schedule_incomplete').sentence({})}`)
    return { kind: 'cron', expression: args.expression }
  }
  throw new Error(`team_reminder create needs scheduleKind as 'once', 'every' or 'cron' — ${recoveryFor('reminder_schedule_incomplete').sentence({})}`)
}

/**
 * The Team manager's read of the whole Team. It is not `team_view` for the
 * manager: the manager holds no Member identity, so participation, Project
 * membership and message visibility mean nothing here, and no message body or
 * Thread fact belongs in the answer. The refs it returns are the ones a later
 * write addresses, and a Project whose owner recorded no responsibility reads
 * `unspecified` — a fact about the grant, never a defect to repair.
 */
const teamOverview = defineTool({
  name: 'team_overview',
  description: "Read the whole Agent Team as the manager: every Workspace in the Host directory with its checkout path, every Project with its shared goal, its owners and what each answers for, its live subscription counts and board summary, and every Member with its standing, where it participates, which model route it is configured to run, how it runs, what its capability configuration mounted, and what it owns. Read-only: no message bodies, no Thread facts, no credentials, no private file contents. Narrow with workspaceId, projectRef, or memberRef (a memberRef read adds that Member's full standing, its actual private directory, and the locator for its current Session — the Session id, the backend-resolved stored-log location, and the shipped read-only reader that inspects it — and nothing beyond them). The same handle in two Workspaces is two Members, so address one by its memberRef. An owner with no recorded responsibility reads `unspecified`, a Project with only the Human as owner is a fact rather than a fault, and a long-standing Member with no owner relation is reported the same way. A capability warning means the stored configuration named a tool this Member cannot hold: the write succeeded and the stored entry stays, but the runtime ignores it, so the Member runs narrower than the list reads, and the warning names the tools it can hold. Each collection is bounded by `limit` and a cut collection says so through `truncated`, so a large Team is paged by scope instead of silently shortened. An empty answer means the Team is empty; a directory that could not be read refuses instead. Full Thread and Task detail stays team_thread read and team_task board; creating a Member, a Project, or an owner grant rides member_create, project_create and project_owner.",
  parameters: {
    workspaceId: { type: 'string', description: "Narrow to one Workspace id exactly as listed in the overview. An unknown id is refused rather than answered as empty." },
    projectRef: { type: 'string', description: "Full branded Project ref exactly as returned by Team tools, including the 'project:' prefix. An unambiguous abbreviation of the first 6+ UUID hex characters also resolves; an unknown ref is refused rather than answered as empty." },
    memberRef: { type: 'string', description: "Full branded Member ref exactly as returned by Team tools, including the 'member:' prefix. Reading one adds its full standing, its private directory path, its owned Projects, and the locator for its current Session." },
    limit: { type: 'number', description: 'Maximum entries per collection — Workspaces, Projects and Members are each bounded separately — as an integer from 1 to 100; the default is 50. A collection the bound cuts is reported in `truncated`, so raise this or narrow the scope instead of assuming the Team is that small.' },
  },
  output: teamOverviewOutput,
  async execute(rawArgs, exec) {
    const args = blankToAbsent(rawArgs, ['workspaceId', 'projectRef', 'memberRef', 'limit'])
    const agent = exec.agent
    if (agent === undefined) throw new Error('team_overview requires an Agent session')
    const host = service(agent)
    const overview = host.managerOverviewForAgent(agent, {
      ...(args.workspaceId === undefined ? {} : { workspaceId: args.workspaceId as WorkspaceId }),
      ...(args.projectRef === undefined ? {} : { projectRef: projectRefOf(args.projectRef) as AgentTeamProjectRef }),
      ...(args.memberRef === undefined ? {} : { memberRef: args.memberRef as AgentTeamMemberId }),
      ...(args.limit === undefined ? {} : { limit: args.limit }),
    })
    // The locator is a second read because it is a Session fact, not a ledger
    // one: the Host resolves the Member's current Session and asks the backend
    // where its log is. The overview itself stays synchronous and unchanged.
    const detail = overview.member === undefined ? undefined : {
      memberRef: overview.member.memberRef, handle: overview.member.handle, description: overview.member.description,
      privateMemoryPath: overview.member.privateMemoryPath,
      owns: overview.member.owns.map(owned => managerOwnedProject(owned)),
      sessionEvidence: managerSessionEvidence(await host.managerSessionLocatorForAgent(agent, overview.member.memberRef)),
    }
    return {
      workspaces: overview.workspaces.map(workspace => ({ workspaceId: workspace.workspaceId,
        ...(workspace.title === undefined ? {} : { title: workspace.title }),
        path: workspace.path ?? '', projectCount: workspace.projectCount, memberCount: workspace.memberCount })),
      projects: overview.projects.map(project => ({ workspaceId: project.workspaceId, projectRef: project.projectRef,
        name: project.name, description: project.description, state: project.state,
        owners: project.owners.map(owner => ({ memberRef: owner.memberRef, handle: owner.handle,
          ...(owner.responsibility === undefined ? {} : { responsibility: owner.responsibility }) })),
        subscriptions: { active: project.subscriptions.active, paused: project.subscriptions.paused },
        board: { open: project.board.open, inReview: project.board.inReview } })),
      members: overview.members.map(member => ({ memberRef: member.memberRef, handle: member.handle,
        description: member.description, availability: member.availability, presence: member.presence,
        workspaceIds: [...member.workspaceIds],
        ...(member.diagnostic === undefined ? {} : { diagnostic: {
          class: member.diagnostic.class, detail: member.diagnostic.detail,
          ...(member.diagnostic.location === undefined ? {} : { location: { kind: member.diagnostic.location.kind, path: member.diagnostic.location.path } }),
          ...(member.diagnostic.sessionId === undefined ? {} : { sessionId: member.diagnostic.sessionId }),
          ...(member.diagnostic.source === undefined ? {} : { source: member.diagnostic.source }),
          ...(member.diagnostic.occurredAt === undefined ? {} : { occurredAt: member.diagnostic.occurredAt }),
        } }),
        ...(member.model === undefined ? {} : { model: {
          provider: member.model.provider, model: member.model.model,
          ...(member.model.reasoningEffort === undefined ? {} : { reasoningEffort: member.model.reasoningEffort }),
        } }),
        capabilityState: member.capabilityState,
        ...(member.capabilityWarnings === undefined ? {} : { capabilityWarnings: member.capabilityWarnings.map(warning => ({
          name: warning.name, knownNames: [...warning.knownNames],
        })) }),
        owns: member.owns.map(owned => managerOwnedProject(owned)) })),
      switches: { worker: overview.switches.worker },
      truncated: { workspaces: overview.truncated.workspaces, projects: overview.truncated.projects, members: overview.truncated.members },
      ...(detail === undefined ? {} : { member: detail }),
    }
  },
})

/** One owned Project as the overview result carries it: the write-side refs plus the responsibility, if the grant recorded one. */
function managerOwnedProject(owned: AgentTeamOwnedProject): { projectRef: string; name: string; description: string; state: string; responsibility?: string } {
  return {
    projectRef: owned.project.projectRef, name: owned.project.name,
    description: owned.project.description, state: owned.project.state,
    ...(owned.responsibility === undefined ? {} : { responsibility: owned.responsibility }),
  }
}

/** One Member's Session locator as the overview result carries it: the id, the state the backend reported, and the reader that can inspect it. */
function managerSessionEvidence(locator: AgentTeamManagerSessionEvidenceLocator): {
  sessionId: string
  state: AgentTeamManagerSessionEvidenceState
  location?: { kind: string; path: string }
  reader: { script: string; anchor?: string }
  failure?: { kind: AgentTeamManagerSessionEvidenceFailureKind; detail: string; location?: { kind: string; path: string } }
} {
  return {
    sessionId: locator.sessionId, state: locator.state,
    ...(locator.location === undefined ? {} : { location: { kind: locator.location.kind, path: locator.location.path } }),
    reader: { script: locator.reader.script, ...(locator.reader.anchor === undefined ? {} : { anchor: locator.reader.anchor }) },
    ...(locator.failure === undefined ? {} : { failure: {
      kind: locator.failure.kind, detail: locator.failure.detail,
      ...(locator.failure.location === undefined ? {} : { location: { kind: locator.failure.location.kind, path: locator.failure.location.path } }),
    } }),
  }
}

/**
 * The model routes a Member may run. This reads the Session controller's own
 * catalog rather than restating it, so the manager can never offer a route the
 * Web member editor does not, and a provider whose lookup failed is reported as
 * a failure rather than folded into an empty list.
 */
const teamModels = defineTool({
  name: 'team_models',
  description: 'List the model routes a Team Member may run: every provider group with its models, each model\'s own description and reasoning efforts, the deployment default, and the providers whose catalog lookup failed. This is the same catalog the Web member editor offers, so a route named here is selectable there. A failed provider is reported in `failures` and is never read as an empty catalog. `memberPresets` names the one preset a Member may compose; the manager\'s own preset is deliberately not member-selectable and never appears here.',
  parameters: {},
  output: teamModelsOutput,
  async execute(_rawArgs, exec) {
    const agent = exec.agent
    if (agent === undefined) throw new Error('team_models requires an Agent session')
    const host = service(agent)
    const models = await host.managerModelsForAgent(agent)
    const defaultRoute = models.catalog.default
    return {
      default: { provider: defaultRoute.provider, model: defaultRoute.model,
        ...(defaultRoute.reasoningEffort === undefined ? {} : { reasoningEffort: defaultRoute.reasoningEffort }) },
      routableProviders: [...models.catalog.routableProviders],
      groups: models.catalog.groups.map(group => ({
        id: group.id,
        name: group.name,
        models: group.models.map(model => {
          const modelRow: { id: string; name: string; description?: string; reasoning?: { efforts: { id: string; name: string }[] } } = { id: model.id, name: model.name }
          if (model.description !== undefined) modelRow.description = model.description
          if (model.reasoning !== undefined) modelRow.reasoning = { efforts: model.reasoning.efforts.map(effort => ({ id: effort.id, name: effort.name })) }
          return modelRow
        }),
      })),
      failures: models.catalog.failures.map(failure => ({ id: failure.id, name: failure.name, message: failure.message })),
      memberPresets: [...models.memberPresets],
    }
  },
})

/**
 * One Member's live standing as every manager write answers it. The projection
 * is shared so a write can never answer a narrower standing than its sibling:
 * the diagnostic and the capability warnings are the two facts a manager acts
 * on, and dropping either turns a divergence into a clean-looking success.
 */
function managerStatusView(status: {
  readonly availability: string
  readonly presence: string
  readonly capabilityState: string
  readonly diagnostic?: { readonly class: string; readonly detail: string } | undefined
  readonly capabilityWarnings?: readonly { readonly name: string; readonly knownNames?: readonly string[] | undefined }[] | undefined
}): {
  availability: string; presence: string; capabilityState: string
  diagnostic?: { class: string; detail: string }
  capabilityWarnings?: { name: string; knownNames?: string[] }[]
} {
  return {
    availability: status.availability, presence: status.presence, capabilityState: status.capabilityState,
    ...(status.diagnostic === undefined ? {} : { diagnostic: { class: status.diagnostic.class, detail: status.diagnostic.detail } }),
    ...(status.capabilityWarnings === undefined ? {} : { capabilityWarnings: status.capabilityWarnings.map(warning => ({
      name: warning.name,
      ...(warning.knownNames === undefined ? {} : { knownNames: [...warning.knownNames] }),
    })) }),
  }
}

/**
 * Create one Member as the manager. The write rides the Host's own addition
 * path — the same queue, activation and receipt the Web Client uses — so the
 * record it answers with is the record every other surface reads. The
 * description of the tool is the operational contract: the refs it returns are
 * the ones every later write addresses, and the receipt plus requestId are
 * what makes a retry a replay instead of a second Member.
 */
const memberCreate = defineTool({
  name: 'member_create',
  description: "Create one Agent Member in one Workspace as the Team manager. The Member is a durable Team record: it appears in the Web Client, answers in its own Session, and is addressed from now on by its memberRef — never by its handle, because the same handle in two Workspaces is two different Members. Requires the handle (free in that Workspace), a description of the Member's global standing, and an explicit model route exactly as team_models listed it; the Member preset is fixed and is not a choice. Capabilities are optional; absent means the full standard surface. Every write carries a requestId: pass your own when the write matters enough to retry — the same id with the same parameters answers with the original receipt instead of writing twice, while a changed parameter under a reused id is refused as a collision. A refusal names its reason and wrote nothing. A committed Member whose activation failed is still committed: the answer keeps its receipt, ref and activation diagnostic, so continue from there instead of creating it again. Only the live Team manager Session holds this tool.",
  parameters: {
    workspaceId: { type: 'string', required: true, description: "Target Workspace id exactly as team_overview listed it. The Member is created in this Workspace and its Session runs in that Workspace's checkout." },
    handle: { type: 'string', required: true, description: 'The Member handle, unique within the target Workspace. It names the Member to the Human; it is never an address for a later write.' },
    description: { type: 'string', required: true, description: "The Member's global standing — what it is for across every Project. Required here; an empty standing is refused." },
    model: { type: 'object', additionalProperties: false, required: true, properties: {
      provider: { type: 'string', required: true, description: 'Provider id exactly as team_models listed it.' },
      model: { type: 'string', required: true, description: 'Model id exactly as team_models listed it under that provider.' },
      reasoningEffort: { type: 'string', description: 'Reasoning effort id exactly as team_models listed it for that model; absent uses the provider default.' },
    } },
    capabilities: { type: 'object', additionalProperties: false, properties: {
      tools: { type: 'object', additionalProperties: false, properties: { allow: { type: 'array', items: { type: 'string' } } } },
      skills: { type: 'object', additionalProperties: false, properties: { allow: { type: 'array', items: { type: 'string' } } } },
    }, description: 'Optional durable capability intent; absent means the full standard surface. Unknown names drop with a warning rather than failing the write.' },
    requestId: { type: 'string', description: 'Your own idempotency key for this write. Omit it and the Host derives one per call — but then a lost answer cannot be retried by id, so read back with team_overview instead.' },
  },
  output: memberCreateOutput,
  async execute(rawArgs, exec) {
    const agent = exec.agent
    if (agent === undefined) throw new Error('member_create requires an Agent session')
    const host = service(agent)
    // A blank capability intent names no intent, exactly as a blank requestId
    // names no retry key: both drop rather than reach the Host as a value.
    const args = blankToAbsent(rawArgs, ['requestId', 'capabilities'])
    const result = await host.managerCreateMemberForAgent(agent, {
      requestId: (args.requestId as AgentTeamRequestId | undefined) ?? requestId(agent.id, exec.callId),
      workspaceId: args.workspaceId as WorkspaceId,
      handle: args.handle,
      description: args.description,
      model: args.model as AgentTeamModelSelection,
      ...(args.capabilities === undefined ? {} : { capabilities: args.capabilities as AgentTeamMemberCapabilities }),
    })
    return {
      requestId: result.requestId, outcome: result.outcome,
      receipt: { operationId: result.receipt.operationId, requestId: result.receipt.requestId, sequence: result.receipt.sequence, occurredAt: result.receipt.occurredAt },
      memberRef: result.memberRef, workspaceIds: [...result.workspaceIds],
      status: managerStatusView(result.status),
    }
  },
})

/**
 * Record one Project's shared goal for the manager. Creation brings no Members
 * in — Project membership gates nothing, and ownership is granted separately
 * through project_owner.
 */
const projectCreate = defineTool({
  name: 'project_create',
  description: "Create one Project in an existing Workspace as the Team manager, recording its shared goal as the description. A Project is a durable Team record addressed from now on by its projectRef; any Member that participates in the Workspace can already read and write in it, so owners are granted afterwards with project_owner. An empty shared goal is refused: a Project exists for a continuing result someone answers for. Every write carries a requestId with the same replay rule as member_create — the same id and parameters answer with the original receipt, a changed parameter under a reused id is a collision. A refusal names its reason and wrote nothing. Only the live Team manager Session holds this tool.",
  parameters: {
    workspaceId: { type: 'string', required: true, description: "Target Workspace id exactly as team_overview listed it. The Project is created in this Workspace." },
    name: { type: 'string', required: true, description: 'Short display name for the Project.' },
    description: { type: 'string', required: true, description: "The Project's shared goal — the continuing result its owners answer for. Required here; an empty goal is refused." },
    requestId: { type: 'string', description: 'Your own idempotency key for this write, with the same replay rule as member_create.' },
  },
  output: projectCreateOutput,
  async execute(rawArgs, exec) {
    const agent = exec.agent
    if (agent === undefined) throw new Error('project_create requires an Agent session')
    const host = service(agent)
    const args = blankToAbsent(rawArgs, ['requestId'])
    const result = await host.managerCreateProjectForAgent(agent, {
      requestId: (args.requestId as AgentTeamRequestId | undefined) ?? requestId(agent.id, exec.callId),
      workspaceId: args.workspaceId as WorkspaceId,
      name: args.name,
      description: args.description,
    })
    return {
      requestId: result.requestId, outcome: result.outcome,
      receipt: { operationId: result.receipt.operationId, requestId: result.receipt.requestId, sequence: result.receipt.sequence, occurredAt: result.receipt.occurredAt },
      projectRef: result.projectRef,
    }
  },
})

/**
 * Grant, re-describe, or withdraw one Agent Member's ownership of one Project.
 * Eligibility is the ledger's own rule and the grant itself is the Member's
 * Project participation, so every action reuses the Host's own ownership path
 * rather than restating either rule here.
 */
const projectOwner = defineTool({
  name: 'project_owner',
  description: "Change one Agent Member's ownership of one Project as the Team manager. `add` grants it and records what the owner answers for there; `update` replaces that responsibility without withdrawing and re-granting, so the Member keeps its grant, its Main stream following and its history; `remove` withdraws the ownership. The grantee must already participate in the Project's Workspace and be enabled or suspended — an archived Member is refused with its reason — and a grant itself is that Member's Project participation. The responsibility is what this owner answers for in this Project: a bounded statement, distinct from the Member's global description and the Project's shared goal. `add` refuses an empty one; `update` accepts an explicit empty one and records that the responsibility is unspecified, exactly as the Web entry does; `remove` takes none. Withdrawing an owner keeps the Task responsibility of a Member that still participates in the Project in another way, and returns open Tasks to the Human only when the ownership was its last participation. Every write carries a requestId with the same replay rule as member_create — the same id and parameters answer with the original receipt, a changed parameter under a reused id is a collision. A refusal names its reason and wrote nothing. Only the live Team manager Session holds this tool.",
  parameters: {
    action: { type: 'string', required: true, enum: ['add', 'update', 'remove'], description: "The ownership change to make: 'add' grants it, 'update' replaces its responsibility, 'remove' withdraws it." },
    workspaceId: { type: 'string', required: true, description: "The Project's Workspace id exactly as team_overview listed it." },
    projectRef: { type: 'string', required: true, description: "Full branded Project ref exactly as team_overview returned it, including the 'project:' prefix." },
    memberRef: { type: 'string', required: true, description: "Full branded Member ref exactly as team_overview returned it, including the 'member:' prefix. Never a handle: the same handle in two Workspaces is two Members." },
    responsibility: { type: 'string', description: "add and update only: what this owner answers for in this Project, at most 2,000 characters. 'add' refuses an empty one; on 'update' an empty one is the same as clearResponsibility. Refused on 'remove', which describes nothing." },
    clearResponsibility: { type: 'boolean', description: "update only: record that this owner's responsibility is unspecified, exactly as the Web entry does when it is left empty. Refused together with a non-empty responsibility, and refused on add or remove." },
    requestId: { type: 'string', description: 'Your own idempotency key for this write, with the same replay rule as member_create.' },
  },
  output: projectOwnerOutput,
  async execute(rawArgs, exec) {
    const agent = exec.agent
    if (agent === undefined) throw new Error('project_owner requires an Agent session')
    const host = service(agent)
    // A blank requestId names no retry key and `false` names no clearing. A
    // blank responsibility is different on `update`: the documented empty value
    // is how a model records "unspecified", so it survives here and only the
    // actions that describe nothing drop it.
    const args = blankToAbsent(rawArgs, ['clearResponsibility', 'requestId'])
    const action = args.action as 'add' | 'update' | 'remove'
    if (action !== 'update' && typeof args.responsibility === 'string' && args.responsibility.trim() === '') {
      delete (args as { responsibility?: unknown }).responsibility
    }
    if (action === 'remove' && (args.responsibility !== undefined || args.clearResponsibility === true)) {
      throw new Error("project_owner takes responsibility only with add or update; a withdrawn ownership describes nothing.")
    }
    if (action === 'add' && args.clearResponsibility === true) {
      throw new Error('project_owner add needs the responsibility the owner answers for; there is nothing to clear on a new grant.')
    }
    if (args.clearResponsibility === true && typeof args.responsibility === 'string' && args.responsibility.trim() !== '') {
      throw new Error('project_owner takes either responsibility or clearResponsibility, not both: clearing records that it is unspecified.')
    }
    const responsibility = args.clearResponsibility === true ? '' : args.responsibility as string | undefined
    const result = await host.managerChangeProjectOwnerForAgent(agent, {
      requestId: (args.requestId as AgentTeamRequestId | undefined) ?? requestId(agent.id, exec.callId),
      workspaceId: args.workspaceId as WorkspaceId,
      projectRef: projectRefOf(args.projectRef) as AgentTeamProjectRef,
      memberRef: args.memberRef as AgentTeamMemberId,
      action,
      ...(responsibility === undefined ? {} : { responsibility }),
    })
    return {
      requestId: result.requestId, action: result.action, outcome: result.outcome,
      receipt: { operationId: result.receipt.operationId, requestId: result.receipt.requestId, sequence: result.receipt.sequence, occurredAt: result.receipt.occurredAt },
      projectRef: result.projectRef, memberRef: result.memberRef,
      ...(result.responsibility === undefined ? {} : { responsibility: result.responsibility }),
    }
  },
})

/**
 * Edit one Project's display facts or archive it. The update is a patch: a
 * field the call leaves out keeps the value stored when the ledger's serialized
 * section runs, so a rename never writes back a goal the Human changed while it
 * was queued. Archival is the lifecycle decision, not a deletion.
 */
const projectUpdate = defineTool({
  name: 'project_update',
  description: "Edit one Project as the Team manager: rename it, restate its shared goal, or archive it. `update` is a partial patch — every field you leave out keeps the value stored at the moment the write runs, so a rename cannot overwrite a goal that landed while it was queued — and it needs at least one of `name` or `description`. `archive` takes the refs alone: the Project disappears from every Team surface with its history kept, its active Claims release, the related Attention clears, and every subscription it owns stops with its private state cleared; open Tasks return to the Human under the ledger's own rules. Archiving is the end state this version offers — there is no permanent-removal tool, and the Project's facts stay readable. A refusal names its reason and wrote nothing, including a repeated archive and an archived Project ref. A cleanup that fails after the archival committed is named in the answer as a cleanup warning, and the receipt still stands. Only the live Team manager Session holds this tool.",
  parameters: {
    action: { type: 'string', required: true, enum: ['update', 'archive'], description: "The change to make: 'update' patches the display facts, 'archive' ends the Project's life without deleting it." },
    workspaceId: { type: 'string', required: true, description: "The Project's Workspace id exactly as team_overview listed it." },
    projectRef: { type: 'string', required: true, description: "Full branded Project ref exactly as team_overview returned it, including the 'project:' prefix." },
    name: { type: 'string', description: "update only: the Project's new name, non-empty. Omit to keep the stored one; refused on archive." },
    description: { type: 'string', description: "update only: the shared goal, which may be an explicit empty string. Omit to keep the stored one; refused on archive." },
    requestId: { type: 'string', description: 'Your own idempotency key for this write, with the same replay rule as member_create.' },
  },
  output: projectUpdateOutput,
  async execute(rawArgs, exec) {
    const agent = exec.agent
    if (agent === undefined) throw new Error('project_update requires an Agent session')
    const host = service(agent)
    // A blank name names no rename. A description is different: an explicit
    // empty one clears the shared goal, so it is only meaningless on archive.
    const args = blankToAbsent(rawArgs, ['name', 'requestId'])
    const action = args.action as 'update' | 'archive'
    const description = typeof rawArgs.description === 'string' ? rawArgs.description : undefined
    if (action === 'archive' && (args.name !== undefined || (description !== undefined && description !== ''))) {
      throw new Error('project_update archives a Project by ref alone; a name or shared goal belongs to the update action.')
    }
    // A blank goal on archive names nothing; on update it is an explicit clear.
    const statedDescription = action === 'archive' ? undefined : description
    const result = await host.managerUpdateProjectForAgent(agent, {
      requestId: (args.requestId as AgentTeamRequestId | undefined) ?? requestId(agent.id, exec.callId),
      workspaceId: args.workspaceId as WorkspaceId,
      projectRef: projectRefOf(args.projectRef) as AgentTeamProjectRef,
      action,
      ...(args.name === undefined ? {} : { name: args.name as string }),
      ...(statedDescription === undefined ? {} : { description: statedDescription }),
    })
    return {
      requestId: result.requestId, action: result.action, outcome: result.outcome,
      receipt: { operationId: result.receipt.operationId, requestId: result.receipt.requestId, sequence: result.receipt.sequence, occurredAt: result.receipt.occurredAt },
      projectRef: result.projectRef, name: result.name, description: result.description, state: result.state,
      ...(result.releasedClaims === undefined ? {} : { releasedClaims: result.releasedClaims }),
      ...(result.subscriptionsCleared === undefined ? {} : { subscriptionsCleared: result.subscriptionsCleared }),
      ...(result.cleanupWarning === undefined ? {} : { cleanupWarning: result.cleanupWarning }),
    }
  },
})

/**
 * Edit one Member's mutable facts as the manager. The write is a patch: every
 * field the call leaves out keeps the value stored when the ledger's serialized
 * section runs, so a concurrent rename or description edit is never written
 * back over. A capability override is cleared only by `clearCapabilities`,
 * which is why "unchanged" and "cleared" stay different calls.
 */
const memberUpdate = defineTool({
  name: 'member_update',
  description: "Edit one Agent Member's mutable facts as the Team manager: its description, its model route, and its capability configuration. The handle and the Member preset are not editable here. This is a partial update — every field you leave out keeps the value stored at the moment the write runs, so an edit cannot overwrite a rename or description change that landed while it was queued. An omitted `capabilities` keeps the stored override; pass `clearCapabilities: true` to restore the full standard surface (the two are refused together, because clearing is not the same as setting an empty list). A replacement model is checked against the same catalog team_models lists, and only while the request is new: the same requestId with the same patch replays to its original receipt even if the catalog or the Member's other fields changed since, while a changed patch under a reused id is refused as a collision. The answer keeps the durable receipt and reports how far the stored configuration reached the live runtime; a committed write whose live apply failed answers `effect: failed:model-apply` or `failed:capability-apply` with the Member's own diagnostic instead of pretending it took effect, and replaying the same requestId retries the effect the stored route still owes. Only the live Team manager Session holds this tool.",
  parameters: {
    memberRef: { type: 'string', required: true, description: "Full branded Member ref exactly as team_overview returned it, including the 'member:' prefix. Never a handle: the same handle in two Workspaces is two Members." },
    description: { type: 'string', description: "The Member's new global standing. Omit to keep the current one; an explicit blank is refused, because a Member is addressed by what it is for." },
    model: { type: 'object', additionalProperties: false, properties: {
      provider: { type: 'string', required: true, description: 'Provider id exactly as team_models listed it.' },
      model: { type: 'string', required: true, description: 'Model id exactly as team_models listed it under that provider.' },
      reasoningEffort: { type: 'string', description: 'Reasoning effort id exactly as team_models listed it for that model; absent uses the provider default.' },
    }, description: 'A replacement model route. Omit to keep the stored route; a Member always runs an explicit route, so a route cannot be cleared.' },
    capabilities: { type: 'object', additionalProperties: false, properties: {
      tools: { type: 'object', additionalProperties: false, properties: { allow: { type: 'array', items: { type: 'string' } } } },
      skills: { type: 'object', additionalProperties: false, properties: { allow: { type: 'array', items: { type: 'string' } } } },
    }, description: 'A replacement capability intent. Omit to keep the stored override; unknown names drop with a warning rather than failing the write.' },
    clearCapabilities: { type: 'boolean', description: 'Explicitly restore the full standard surface by clearing the stored capability override. Refused together with capabilities; omit (or false) to keep the override.' },
    requestId: { type: 'string', description: 'Your own idempotency key for this write. Omit it and the Host derives one per call — but then a lost answer cannot be retried by id, so read back with team_overview instead.' },
  },
  output: memberUpdateOutput,
  async execute(rawArgs, exec) {
    const agent = exec.agent
    if (agent === undefined) throw new Error('member_update requires an Agent session')
    const host = service(agent)
    // A blank field names no intent, exactly as a blank requestId names no retry key.
    const args = blankToAbsent(rawArgs, ['description', 'model', 'capabilities', 'clearCapabilities', 'requestId'])
    if (args.clearCapabilities === true && args.capabilities !== undefined) {
      throw new Error('member_update takes either capabilities or clearCapabilities, not both: clearing restores the full standard surface, while an empty capability list would mount nothing.')
    }
    const capabilities = args.clearCapabilities === true ? null : args.capabilities as AgentTeamMemberCapabilities | undefined
    const result = await host.managerUpdateMemberForAgent(agent, {
      requestId: (args.requestId as AgentTeamRequestId | undefined) ?? requestId(agent.id, exec.callId),
      memberRef: args.memberRef as AgentTeamMemberId,
      ...(args.description === undefined ? {} : { description: args.description }),
      ...(args.model === undefined ? {} : { model: args.model as AgentTeamModelSelection }),
      ...(capabilities === undefined ? {} : { capabilities }),
    })
    return {
      requestId: result.requestId, outcome: result.outcome,
      receipt: { operationId: result.receipt.operationId, requestId: result.receipt.requestId, sequence: result.receipt.sequence, occurredAt: result.receipt.occurredAt },
      memberRef: result.memberRef, effect: result.effect,
      status: managerStatusView(result.status),
    }
  },
})

/**
 * Move one Member through its lifecycle as the manager. The three durable
 * actions ride the Host's own ledger operations; `recover` is the runtime
 * nudge with no ledger record, which is why it alone names a Workspace.
 */
const memberState = defineTool({
  name: 'member_state',
  description: "Change one Agent Member's lifecycle as the Team manager. `suspend` and `resume` are the Host's existing durable operations (a suspended Member keeps its Session and private data, and resume activates it again); `archive` hides the Member everywhere, releases its active Claims, clears its Attention, and keeps its private memory and Session log on disk — this version has no permanent-removal tool, and archived is the end state it offers. `recover` is a runtime-only repair with no ledger record: it finishes an interrupted generation swap or suspend cleanup, rebuilds a Member whose preset composition was orphaned by a reload, or restarts one whose activation failed; it needs the Workspace id whose participation the Host verifies, and it refuses a Member that is not enabled when a restart is the only path. A refusal names its reason and writes nothing; a committed write answers its receipt and the Member's standing after it. Only the live Team manager Session holds this tool.",
  parameters: {
    action: { type: 'string', required: true, enum: ['suspend', 'resume', 'archive', 'recover'], description: "The lifecycle change to make. 'recover' is runtime-only and takes workspaceId; the other three are ledger writes that take only memberRef." },
    memberRef: { type: 'string', required: true, description: "Full branded Member ref exactly as team_overview returned it, including the 'member:' prefix." },
    workspaceId: { type: 'string', description: "recover only: the Workspace id the Member must participate in, exactly as team_overview listed it. Refused on the other actions, which address the Member alone." },
    requestId: { type: 'string', description: 'Your own idempotency key for a durable action, with the same replay rule as member_create. Ignored by recover, which writes no ledger record.' },
  },
  output: memberStateOutput,
  async execute(rawArgs, exec) {
    const agent = exec.agent
    if (agent === undefined) throw new Error('member_state requires an Agent session')
    const host = service(agent)
    const args = blankToAbsent(rawArgs, ['workspaceId', 'requestId'])
    const action = args.action as 'suspend' | 'resume' | 'archive' | 'recover'
    if (action === 'recover' && args.workspaceId === undefined) {
      throw new Error('member_state recover needs workspaceId: the Host verifies the Member participates in that Workspace before it repairs the runtime.')
    }
    if (action !== 'recover' && args.workspaceId !== undefined) {
      throw new Error("member_state takes workspaceId only with recover; suspend, resume and archive address the Member alone.")
    }
    const result = await host.managerSetMemberStateForAgent(agent, {
      requestId: (args.requestId as AgentTeamRequestId | undefined) ?? requestId(agent.id, exec.callId),
      memberRef: args.memberRef as AgentTeamMemberId,
      action,
      ...(args.workspaceId === undefined ? {} : { workspaceId: args.workspaceId as WorkspaceId }),
    })
    return {
      requestId: result.requestId, action: result.action, outcome: result.outcome,
      ...(result.receipt === undefined ? {} : { receipt: { operationId: result.receipt.operationId, requestId: result.receipt.requestId, sequence: result.receipt.sequence, occurredAt: result.receipt.occurredAt } }),
      memberRef: result.memberRef,
      status: managerStatusView(result.status),
      ...(result.releasedClaims === undefined ? {} : { releasedClaims: result.releasedClaims }),
      ...(result.removedAttention === undefined ? {} : { removedAttention: result.removedAttention }),
    }
  },
})

/**
 * Change one Member's Workspace participation as the manager. Joining is the
 * same pure relation the Web Client grants — no Session is created or moved —
 * and leaving the creation Workspace is the ledger's own refusal, which points
 * at archival instead.
 */
const memberWorkspace = defineTool({
  name: 'member_workspace',
  description: "Change one Agent Member's Workspace participation as the Team manager. 'join' grants participation in another Workspace as a pure relation — the Member's Session is not created, copied, or moved, and it keeps working from its original checkout; the grant itself is what lets the Member be addressed there. 'leave' withdraws one non-default Workspace: its active Claims there release, its Attention and markers on those Threads clear, while identity, Session, and remaining participations stay. The creation Workspace cannot be left — archive the Member instead — and a Member that is inactive or archived is refused with its reason. Every write carries a requestId with the same replay rule as member_create. Only the live Team manager Session holds this tool.",
  parameters: {
    action: { type: 'string', required: true, enum: ['join', 'leave'], description: "The participation change to make: 'join' adds a Workspace, 'leave' withdraws one." },
    workspaceId: { type: 'string', required: true, description: "The Workspace id to join or leave, exactly as team_overview listed it. Leaving the Member's creation Workspace is refused." },
    memberRef: { type: 'string', required: true, description: "Full branded Member ref exactly as team_overview returned it, including the 'member:' prefix." },
    requestId: { type: 'string', description: 'Your own idempotency key for this write, with the same replay rule as member_create.' },
  },
  output: memberWorkspaceOutput,
  async execute(rawArgs, exec) {
    const agent = exec.agent
    if (agent === undefined) throw new Error('member_workspace requires an Agent session')
    const host = service(agent)
    const args = blankToAbsent(rawArgs, ['requestId'])
    const result = await host.managerChangeMemberWorkspaceForAgent(agent, {
      requestId: (args.requestId as AgentTeamRequestId | undefined) ?? requestId(agent.id, exec.callId),
      action: args.action as 'join' | 'leave',
      memberRef: args.memberRef as AgentTeamMemberId,
      workspaceId: args.workspaceId as WorkspaceId,
    })
    return {
      requestId: result.requestId, outcome: result.outcome,
      receipt: { operationId: result.receipt.operationId, requestId: result.receipt.requestId, sequence: result.receipt.sequence, occurredAt: result.receipt.occurredAt },
      memberRef: result.memberRef, workspaceId: result.workspaceId, workspaceIds: [...result.workspaceIds],
      ...(result.releasedClaims === undefined ? {} : { releasedClaims: result.releasedClaims }),
      ...(result.removedAttention === undefined ? {} : { removedAttention: result.removedAttention }),
    }
  },
})

/**
 * A Member reminder is a time promise the Member makes to itself. It is the one
 * Team surface with no other audience: creation is self-only by construction, and
 * the occurrence reaches the same private Inbox notice every other unread fact
 * travels on, so a reminder never needs a Thread, a Project, or a write token.
 */
const teamReminder = defineTool({
  name: 'team_reminder',
  description: `Create, list, or cancel a reminder for yourself. A reminder is a time promise bound to you as a Member, not to a Session: when it comes due it reaches your Team Inbox as a private notice and wakes you, and the Host records it consumed once it enters one of your turns. create takes scheduleKind with that kind's own fields: 'once' with \`at\` (an ISO 8601 instant), 'every' with \`minutes\` (a whole number, at least 10), or 'cron' with \`expression\` (five fields: minute hour day-of-month month day-of-week) read in the fixed Team zone UTC+8, which has no daylight-saving component. Every create also takes \`note\`: what the reminder is for, at most 2000 characters. At most 50 reminders may be active for you at once, and a recurring reminder never fires closer than 10 minutes. list reports every reminder you own with its state and occurrence facts; cancel withdraws one by reminderRef. You can only create reminders for yourself and only cancel your own. While your Member is suspended your reminders keep timing and deliver when it resumes; when it is archived or removed they are all cancelled. An occurrence missed while the Host was down is made up exactly once after recovery, and an unread occurrence of the same recurring reminder is replaced by the next one instead of stacking.`,
  parameters: {
    action: { type: 'string', required: true, enum: ['create', 'list', 'cancel'] },
    scheduleKind: { type: 'string', enum: ['once', 'every', 'cron'], description: "create only: 'once' for a single instant, 'every' for a fixed interval, or 'cron' for a five-field expression." },
    at: { type: 'string', description: "create with scheduleKind 'once' only: the instant to fire at, as ISO 8601 (for example 2026-11-04T02:00:00.000Z)." },
    minutes: { type: 'number', description: 'create with scheduleKind \'every\' only: the whole number of minutes between two fires, at least 10.' },
    expression: { type: 'string', description: "create with scheduleKind 'cron' only: five whitespace-separated fields (minute hour day-of-month month day-of-week), read in the fixed Team zone UTC+8." },
    note: { type: 'string', description: 'create only: what this reminder is for, at most 2000 characters. It is handed back to you when the occurrence fires.' },
    reminderRef: { type: 'string', description: "cancel only: the full branded ref of one of your own reminders, exactly as list or a create returned it (for example reminder:0f0a…)." },
    workspace: workspaceParam,
  },
  output: teamReminderOutput,
  async execute(rawArgs, exec) {
    // `note` is content, but an empty one names nothing: on create it must reach the
    // "needs note" refusal, and on list or cancel it must not read as a create's note.
    const args = blankToAbsent(rawArgs, [...OPTIONAL_ADDRESS_KEYS, ...OPTIONAL_SCHEDULE_KEYS, 'note'])
    const agent = exec.agent
    if (agent === undefined) throw new Error('team_reminder requires an Agent session')
    const host = service(agent)
    const workspaceId = workspaceOf(args, agent)
    if (args.action === 'create') {
      // `reminderRef` is the Host's identity for a reminder that already exists; a create
      // carrying one would be a cancel wearing a create's clothes, so it is refused rather
      // than dropped into a request whose ref the tool derives itself.
      if (args.reminderRef !== undefined) throw new Error(recoveryFor('action_only_arguments').sentence({ action: 'create', parameter: 'reminderRef', owner: 'cancel' }))
      if (args.note === undefined) throw new Error(`team_reminder create needs \`note\`, what this reminder is for — ${recoveryFor('reminder_note_required').sentence({})}`)
      const result = await host.createMemberReminderForAgent(agent, { requestId: requestId(agent.id, exec.callId), workspaceId,
        reminderRef: reminderRefForCallId(exec.callId), schedule: reminderScheduleOf(args), note: args.note })
      return reminderResult('create', workspaceId, [{ reminder: result.reminder }], result.activeCount)
    }
    if (args.action === 'cancel') {
      if (args.reminderRef === undefined) throw new Error(`team_reminder cancel needs reminderRef, one of your own reminders — ${recoveryFor('reminder_ref_required').sentence({})}`)
      // Real schedule content must never disappear just because the default selector is tolerated.
      refuseNonDefaultScheduleKind('cancel', args.scheduleKind)
      for (const parameter of CREATE_ONLY_REMINDER_CONTENT_KEYS) {
        if (args[parameter] !== undefined) throw new Error(recoveryFor('action_only_arguments').sentence({ action: 'cancel', parameter, owner: 'create' }))
      }
      const result = await host.cancelMemberReminderForAgent(agent, { requestId: requestId(agent.id, exec.callId), workspaceId,
        reminderRef: args.reminderRef as AgentTeamReminderRef })
      const activeCount = host.memberRemindersForAgent(agent, { workspaceId }).filter(view => view.reminder.state === 'active').length
      return reminderResult('cancel', workspaceId, [{ reminder: result.reminder }], activeCount)
    }
    // A list reads; it writes nothing, so every write-only slot is a mis-send rather than a default.
    if (args.reminderRef !== undefined) throw new Error(recoveryFor('action_only_arguments').sentence({ action: 'list', parameter: 'reminderRef', owner: 'cancel' }))
    refuseNonDefaultScheduleKind('list', args.scheduleKind)
    for (const parameter of CREATE_ONLY_REMINDER_CONTENT_KEYS) {
      if (args[parameter] !== undefined) throw new Error(recoveryFor('action_only_arguments').sentence({ action: 'list', parameter, owner: 'create' }))
    }
    const reminders = host.memberRemindersForAgent(agent, { workspaceId })
    return reminderResult('list', workspaceId, reminders, reminders.filter(view => view.reminder.state === 'active').length)
  },
})

/** What a reminder action reports about each reminder it touched: the entity plus the occurrence facts a view carries. */
interface ReminderReport {
  readonly reminder: AgentTeamMemberReminder
  readonly lastOccurrenceAt?: string | undefined
  readonly pendingOccurrenceAt?: string | undefined
  readonly nextOccurrenceAt?: string | undefined
}

function reminderResult(action: 'create' | 'list' | 'cancel', workspaceId: string, reminders: readonly ReminderReport[], activeCount: number) {
  return {
    action, workspaceId, created: action === 'create', cancelled: action === 'cancel', activeCount,
    reminders: reminders.map(view => ({
      reminderRef: view.reminder.reminderRef, state: view.reminder.state, schedule: reminderScheduleText(view.reminder.schedule),
      note: view.reminder.note, createdAt: view.reminder.createdAt,
      ...(view.lastOccurrenceAt === undefined ? {} : { lastOccurrenceAt: view.lastOccurrenceAt }),
      ...(view.pendingOccurrenceAt === undefined ? {} : { pendingOccurrenceAt: view.pendingOccurrenceAt }),
      ...(view.nextOccurrenceAt === undefined ? {} : { nextOccurrenceAt: view.nextOccurrenceAt }),
    })),
  }
}

/** Empty selectors must disappear before choosing a Worker action; real values still conflict. */
const WORKER_BLANK_KEYS = [...OPTIONAL_ADDRESS_KEYS, 'task', 'stop', 'inspect', 'steer', 'instruction', 'cwd', 'requestId'] as const

/** A control call may carry the first enum value as a neutral fill, but no other engine. */
function namesAnotherEngine(args: { readonly engine?: string | undefined }): boolean {
  return args.engine !== undefined && args.engine !== 'codex'
}

/**
 * The one delegation entry. A run bound to a Thread reports into it and wakes
 * this Member through the Inbox; an unbound Project delegation keeps the direct
 * result in this session. Neither creates a Task or a Main stream post, and the
 * Worker holds no Team identity of its own.
 */
const teamWorker = defineTool({
  name: 'team_worker',
  description: `Delegate one self-contained piece of work to a local Worker engine (Codex or Claude Code) that runs with its own tools, login, and settings, or steer, stop, or inspect a Worker this session delegated. Use it for work you can hand over completely: investigation, a scoped change in a prepared working directory, or a check that needs another engine. The Worker does not see this conversation, holds no Team identity, and cannot claim, accept, or answer for you, so the task text must carry the goal, the background, the scope, and what evidence to bring back. Name the Thread or Task the work belongs to and everything about the run is published there: the Thread shows when it started and how it ended, and its answer arrives in your Inbox — the other participants never see the raw output. Name only a Project and the result comes back to this session alone, published nowhere. The call returns as soon as the execution is accepted; keep working and do not poll. A Worker affects Project responsibility in no way: if you delegate work on a Task, the Claim stays yours and you still verify the result yourself, and a finished run never accepts a Task. Delegation needs the Team setting "allow Project owners to delegate Workers", your ownership of the Project the target belongs to, and an enabled engine; a refusal names which condition failed. To add one instruction, pass the original worker ref as steer with the instruction. A running Codex or Claude execution takes it into the same native session, possibly in its current turn or its next turn. If that execution has ended cleanly, steer resumes the same native conversation as one new linked execution; the receipt returns its new worker ref and says that a continuation started. A stopping execution, an unconfirmed ending, an archived or no-longer-owned Project, a disabled Member or engine setting, or a missing native record is refused instead of being revived. The receipt says submitted or continuation started, never that the model has read the instruction. To stop one execution, pass only its worker ref as stop; the call returns once the engine confirmed its cleanup, and a run that ended first answers with the state it really ended in. Another Member's run cannot be stopped this way. To read one execution's diagnostic, pass only its worker ref as inspect: the call answers with the same summary the Thread carries, the native identities the Host recorded, and whatever the engine's own record still answers after its process exited. The native record itself is never copied into the Team, and only the Member who delegated the run or the Human may read it.`,
  parameters: {
    threadRef: { type: 'string', description: 'The Thread this work reports into, as a thread: ref. The run\'s start, ending, and Inbox wake all point at it. Its Project authorizes the delegation.' },
    taskRef: { type: 'string', description: 'The Task this work is for, as a task: ref. It fixes the Thread as well; naming a Thread and a Task together is accepted only when the Task is in that Thread.' },
    projectRef: { type: 'string', description: 'The Project to delegate into, as a project: ref from team_view. Omit whenever threadRef or taskRef already names it; with none of the three there is no target to authorize.' },
    task: { type: 'string', description: 'The complete task for the Worker: goal, background it needs, working scope, and the evidence to return. It cannot ask you follow-up questions. Required unless stop names a run to end.' },
    stop: { type: 'string', description: 'A worker: ref this session delegated. With this the call stops that execution instead of starting one: pass it alone, with no task, target, engine, directory, or request id.' },
    inspect: { type: 'string', description: 'A worker: ref this session delegated. With this the call reads that execution\'s diagnostic instead of starting or stopping one: pass it alone, with no task, target, engine, directory, or request id. A run that has not ended answers with the summary alone.' },
    steer: { type: 'string', description: 'A worker: ref this session delegated. With this the call adds one instruction in that Worker\'s same native session: pass it with instruction, and with no task, target, engine, directory, stop, or inspect. A running execution may take it in the current turn or its next turn. An ended execution that ended cleanly is resumed as a new linked execution and the receipt returns its new worker ref.' },
    instruction: { type: 'string', description: 'The one instruction to submit with steer. It is deduplicated per execution while it is pending, submitted, or has an unknown delivery outcome. An explicit native refusal did not deliver it, so the same text may be retried under a fresh request id, and a later linked execution may receive it under a fresh id.' },
    engine: { type: 'string', enum: ['codex', 'claude'], description: 'Engine to run. Omit for the Project default the Host settings name.' },
    cwd: { type: 'string', description: 'Absolute working directory the Worker runs in. Omit to use this session\'s own directory.' },
    requestId: { type: 'string', description: 'Optional idempotency key for a start or steer: resending the same value with the same request returns the execution or receipt the first call produced, even when both calls arrive at once. A changed instruction, or a resend from another Member, is refused rather than applied to a run it did not ask for.' },
    workspace: workspaceParam,
  },
  output: teamWorkerOutput,
  async execute(rawArgs, exec) {
    const args = blankToAbsent(rawArgs, WORKER_BLANK_KEYS)
    const agent = exec.agent
    if (agent === undefined) throw new Error('team_worker requires an Agent session')
    const host = service(agent)
    if (args.stop !== undefined && args.inspect !== undefined) {
      throw new Error('team_worker takes one worker ref at a time: pass stop or inspect, not both.')
    }
    if (args.steer !== undefined && (args.stop !== undefined || args.inspect !== undefined)) {
      throw new Error('team_worker takes one worker ref at a time: pass steer, stop, or inspect — never two of them.')
    }
    if (args.inspect !== undefined) {
      // Reading a diagnostic is its own call: it names one run and nothing else,
      // so a half-filled start can never be read as a look-up.
      if (args.task !== undefined || args.threadRef !== undefined || args.taskRef !== undefined
        || args.projectRef !== undefined || namesAnotherEngine(args) || args.cwd !== undefined
        || args.requestId !== undefined || args.steer !== undefined || args.instruction !== undefined) {
        throw new Error('team_worker takes either a task to start or an inspect ref, not both: pass inspect alone.')
      }
      const inspection = await host.workerInspectForAgent(agent, { workerRef: args.inspect as Parameters<typeof host.workerInspectForAgent>[1]['workerRef'] })
      return {
        mode: 'inspect', workerRef: inspection.workerRef, state: inspection.state, engine: inspection.engine,
        projectRef: inspection.projectRef,
        ...(inspection.threadRef === undefined ? {} : { threadRef: inspection.threadRef }),
        ...(inspection.startedAt === undefined ? {} : { startedAt: inspection.startedAt }),
        ...(inspection.settledAt === undefined ? {} : { settledAt: inspection.settledAt }),
        summary: inspection.summary,
        ...(inspection.stage === undefined ? {} : { stage: inspection.stage }),
        ...(inspection.native.threadId === undefined ? {} : { nativeThreadId: inspection.native.threadId }),
        ...(inspection.native.turnId === undefined ? {} : { nativeTurnId: inspection.native.turnId }),
        ...(inspection.native.turnIds === undefined ? {} : { nativeTurnIds: [...inspection.native.turnIds] }),
        ...(inspection.native.inputIds === undefined ? {} : { nativeInputIds: [...inspection.native.inputIds] }),
        ...(inspection.native.storage === undefined ? {} : { nativeStorage: inspection.native.storage }),
        nativeRecord: inspection.history.kind,
        ...inspection.history.kind !== 'read' ? { nativeReason: inspection.history.reason } : {
          ...(inspection.history.fragments.length === 0 ? {} : {
            nativeFragments: inspection.history.fragments.map(fragment => ({ kind: fragment.kind, text: fragment.text })) }),
          ...(inspection.history.withheld === 0 ? {} : { nativeWithheld: inspection.history.withheld }),
          ...(inspection.history.truncated ? { nativeTruncated: true } : {}),
        },
      }
    }
    if (args.steer !== undefined) {
      // A steer names one run and one instruction, and nothing else: a
      // half-filled start must never be read as a steer to a live native session.
      if (args.task !== undefined || args.threadRef !== undefined || args.taskRef !== undefined
        || args.projectRef !== undefined || namesAnotherEngine(args) || args.cwd !== undefined
        || args.stop !== undefined || args.inspect !== undefined) {
        throw new Error('team_worker takes either a task to start, a stop ref, an inspect ref, or a steer ref with its instruction: pass steer alone with instruction.')
      }
      if (args.instruction === undefined || args.instruction.trim() === '') {
        throw new Error('team_worker needs the instruction to add when steer names a run: pass steer with instruction.')
      }
      const steered = await host.workerSteerForAgent(agent, {
        workerRef: args.steer as Parameters<typeof host.workerSteerForAgent>[1]['workerRef'],
        instruction: args.instruction,
        requestId: (args.requestId ?? requestId(agent.id, exec.callId)) as Parameters<typeof host.workerSteerForAgent>[1]['requestId'],
      })
      return {
        mode: 'steer', workerRef: steered.workerRef, state: steered.state, engine: steered.engine,
        ...(steered.continuedFrom === undefined ? {} : { continuedFrom: steered.continuedFrom }),
        ...(steered.landed === undefined ? {} : { landed: steered.landed }),
        ...(steered.turnId === undefined ? {} : { turnId: steered.turnId }),
        runState: steered.runState,
      }
    }
    if (args.instruction !== undefined && args.steer === undefined) {
      throw new Error('team_worker takes instruction only with steer: name the Worker execution whose native session should take it.')
    }
    if (args.stop !== undefined) {
      // Starting and stopping are different calls: a stop names one run and
      // nothing else, so a half-filled start can never be read as a stop.
      if (args.task !== undefined || args.threadRef !== undefined || args.taskRef !== undefined
        || args.projectRef !== undefined || namesAnotherEngine(args) || args.cwd !== undefined
        || args.requestId !== undefined || args.steer !== undefined || args.instruction !== undefined) {
        throw new Error('team_worker takes either a task to start or a stop ref, not both: pass stop alone.')
      }
      const stopped = await host.workerStopForAgent(agent, { workerRef: args.stop as Parameters<typeof host.workerStopForAgent>[1]['workerRef'] })
      return {
        workerRef: stopped.workerRef, state: stopped.state, engine: stopped.engine,
        ...(stopped.settledAt === undefined ? {} : { settledAt: stopped.settledAt }),
        // The Host's own sentence about a failure rides the receipt: a state
        // alone would drop the cleanup warning the model has to act on.
        ...(stopped.diagnostic === undefined ? {} : { diagnostic: stopped.diagnostic }),
      }
    }
    if (args.task === undefined || args.task.trim() === '') {
      throw new Error('team_worker needs a task to start a Worker, or a stop ref to end one.')
    }
    const request = {
      requestId: (args.requestId ?? requestId(agent.id, exec.callId)) as Parameters<typeof host.workerStartForAgent>[1]['requestId'],
      task: args.task,
      ...(args.projectRef === undefined ? {} : { projectRef: projectRefOf(args.projectRef) as Parameters<typeof host.workerStartForAgent>[1]['projectRef'] }),
      ...(args.threadRef === undefined ? {} : { threadRef: args.threadRef as NonNullable<Parameters<typeof host.workerStartForAgent>[1]['threadRef']> }),
      ...(args.taskRef === undefined ? {} : { taskRef: args.taskRef as NonNullable<Parameters<typeof host.workerStartForAgent>[1]['taskRef']> }),
      ...(args.engine === undefined ? {} : { engine: args.engine as 'codex' | 'claude' }),
      ...(args.cwd === undefined ? {} : { cwd: args.cwd }),
    }
    const run = await host.workerStartForAgent(agent, request)
    return {
      workerRef: run.workerRef, projectRef: run.projectRef, engine: run.engine,
      state: run.state, cwd: run.cwd, startedAt: run.startedAt,
      ...(run.threadRef === undefined ? {} : { threadRef: run.threadRef }),
    }
  },
})

/**
 * Plugin configuration: which model-facing Team tools this preset scope mounts.
 *
 * The model's visible tool list is read from the registering scope's own schemas, so a narrower surface is only real when the narrower set is what gets declared: a tool registered here and hidden later is still listed to the model, and a tool refused in its handler is still spent on before it fails. Declaring the exact subset is therefore the only narrowing that holds.
 */
export interface Config {
  /**
   * Restrict registration to these tool names, matched exactly. Omitted registers all 19 Team tools; the `team-member` and `team-manager` presets each provide their own explicit whitelist. An unknown name is refused rather than skipped: a typo would otherwise mount an empty surface and surface only as a Session that cannot act.
   */
  only?: readonly string[]
}

export function apply(ctx: Context, config: Config = {}): void {
  const tools = [
    teamInbox, teamReminder, teamThread, teamAttention, teamMessage, teamDm,
    teamTask, teamView, teamOverview, teamModels, teamSubscription, teamWorker,
    memberCreate, projectCreate, projectOwner, projectUpdate, memberUpdate, memberState, memberWorkspace,
  ]
  if (config.only === undefined) {
    for (const tool of tools) ctx.tools.register(tool)
    return
  }
  const selected = new Set(config.only)
  for (const name of selected) {
    if (!tools.some(tool => tool.name === name)) {
      throw new Error(`team-tools config names an unknown Team tool: ${name}`)
    }
  }
  for (const tool of tools) {
    if (selected.has(tool.name)) ctx.tools.register(tool)
  }
}
