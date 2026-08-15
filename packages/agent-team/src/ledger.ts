import { randomUUID } from 'node:crypto'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type {
  AgentTeamChannel,
  AgentTeamChannelCreatedOperation,
  AgentTeamChannelRef,
  AgentTeamCreateChannelResult,
  AgentTeamFollow,
  AgentTeamHumanActor,
  AgentTeamInitializedOperation,
  AgentTeamMemberId,
  AgentTeamMessage,
  AgentTeamMessageRef,
  AgentTeamMessageSentOperation,
  AgentTeamOperation,
  AgentTeamOperationId,
  AgentTeamOperationReceipt,
  AgentTeamRecipientIntent,
  AgentTeamRecipientIntentRef,
  AgentTeamRequestId,
  AgentTeamSendMessageResult,
  AgentTeamStatus,
  AgentTeamTask,
  AgentTeamTaskRef,
  AgentTeamThread,
  AgentTeamThreadRef,
  AgentTeamView,
  AgentTeamViewRequest,
} from './types.ts'

/** Stable Human Member identity shared by every replay of one dshHome Team. */
export const AGENT_TEAM_HUMAN_MEMBER_ID = 'member:human' as AgentTeamMemberId

/** Idempotency identity of the one Host bootstrap operation. */
export const AGENT_TEAM_INITIALIZE_REQUEST_ID = 'agent-team:initialize:v1' as AgentTeamRequestId

const HUMAN_ACTOR: AgentTeamHumanActor = Object.freeze({
  kind: 'human',
  memberId: AGENT_TEAM_HUMAN_MEMBER_ID,
  handle: 'human',
})

/** Resolve the one Human authority owned by this Team. */
export function agentTeamHumanActor(): AgentTeamHumanActor {
  return HUMAN_ACTOR
}

/** Caller-owned payload of the idempotent Team initialization request. */
export interface AgentTeamInitializeRequest {
  readonly requestId: AgentTeamRequestId
  readonly actor: AgentTeamHumanActor
  readonly humanMemberId: AgentTeamMemberId
}

/** Internal authorized Channel creation request. */
export interface AgentTeamAuthorizedCreateChannelRequest {
  readonly requestId: AgentTeamRequestId
  readonly actor: AgentTeamHumanActor
  readonly workspaceId: WorkspaceId
  readonly name: string
}

/** Internal authorized top-level Message request. */
export interface AgentTeamAuthorizedSendMessageRequest {
  readonly requestId: AgentTeamRequestId
  readonly actor: AgentTeamHumanActor
  readonly workspaceId: WorkspaceId
  readonly channelRef: AgentTeamChannelRef
  readonly body: string
  readonly recipients?: readonly AgentTeamMemberId[]
}

/** Construction hooks used to make durable operation creation deterministic in tests. */
export interface AgentTeamLedgerOptions {
  readonly operationId?: () => AgentTeamOperationId
  readonly occurredAt?: () => string
  readonly ref?: (kind: 'channel' | 'message' | 'task' | 'thread' | 'intent') => string
}

/** Internal append result indicating whether this call committed a new record. */
export interface AgentTeamLedgerResult<T> {
  readonly value: T
  readonly committed: boolean
}

/** Replay and append logic behind the Agent Team service interface. */
export class AgentTeamLedger {
  private readonly byRequest = new Map<AgentTeamRequestId, AgentTeamOperation>()
  private readonly ordered: AgentTeamOperation[] = []
  private readonly channels = new Map<AgentTeamChannelRef, AgentTeamChannel>()
  private readonly messages: AgentTeamMessage[] = []
  private readonly tasks = new Map<AgentTeamTaskRef, AgentTeamTask>()
  private readonly threads = new Map<AgentTeamThreadRef, AgentTeamThread>()
  private readonly createOperationId: () => AgentTeamOperationId
  private readonly createOccurredAt: () => string
  private readonly createRef: (kind: 'channel' | 'message' | 'task' | 'thread' | 'intent') => string
  private operationTail: Promise<void> = Promise.resolve()

  /**
   * Build the in-memory projection from already validated durable records.
   * @param table - Agent Team operation table owned by the open Domain.
   * @param options - Deterministic id and clock hooks.
   */
  constructor(
    private readonly table: KvTable<AgentTeamOperationId, AgentTeamOperation>,
    options: AgentTeamLedgerOptions = {},
  ) {
    this.createOperationId = options.operationId
      ?? (() => `operation:${randomUUID()}` as AgentTeamOperationId)
    this.createOccurredAt = options.occurredAt ?? (() => new Date().toISOString())
    this.createRef = options.ref ?? (kind => `${kind}:${randomUUID()}`)
    this.replay()
  }

  /**
   * Initialize a new ledger or return the original receipt for an identical retry.
   * @param request - Authorized initialization request.
   * @returns The receipt and whether a new durable record was committed.
   */
  initialize(request: AgentTeamInitializeRequest = {
    requestId: AGENT_TEAM_INITIALIZE_REQUEST_ID,
    actor: HUMAN_ACTOR,
    humanMemberId: AGENT_TEAM_HUMAN_MEMBER_ID,
  }): Promise<AgentTeamLedgerResult<AgentTeamOperationReceipt>> {
    return this.enqueue(async () => {
      const existing = this.byRequest.get(request.requestId)
      if (existing !== undefined) {
        this.assertSameInitialization(existing, request)
        return this.resolved(this.receipt(existing))
      }
      if (this.ordered.length !== 0) {
        throw new Error('agent-team ledger has operations but no initialization request')
      }
      const operation: AgentTeamInitializedOperation = Object.freeze({
        sequence: 1,
        operationId: this.createOperationId(),
        requestId: request.requestId,
        occurredAt: this.createOccurredAt(),
        actor: Object.freeze({ ...request.actor }),
        previousOperationId: null,
        kind: 'team/initialized',
        data: Object.freeze({ humanMemberId: request.humanMemberId }),
      })
      await this.table.put(operation.operationId, operation)
      this.commit(operation)
      return this.committed(this.receipt(operation))
    })
  }

  /**
   * Create one Channel after the service resolves Human and Workspace authority.
   * @param request - Authorized creation intent.
   * @returns The stable Channel and operation receipt.
   */
  createChannel(
    request: AgentTeamAuthorizedCreateChannelRequest,
  ): Promise<AgentTeamLedgerResult<AgentTeamCreateChannelResult>> {
    return this.enqueue(async () => {
      const existing = this.byRequest.get(request.requestId)
      if (existing !== undefined) {
        this.assertSameChannelCreation(existing, request)
        return this.resolved(this.channelResult(existing))
      }
      this.assertHumanActor(request.actor)
      const name = request.name.trim()
      if (name === '') throw new Error('channel name must not be empty')
      const sequence = this.nextSequence()
      const channel: AgentTeamChannel = Object.freeze({
        channelRef: this.ref('channel'),
        workspaceId: request.workspaceId,
        name,
        createdAtSequence: sequence,
      })
      const operation: AgentTeamChannelCreatedOperation = Object.freeze({
        ...this.operationBase(request, sequence),
        kind: 'team/channel-created',
        data: Object.freeze({ workspaceId: request.workspaceId, channel }),
      })
      await this.table.put(operation.operationId, operation)
      this.commit(operation)
      this.channels.set(channel.channelRef, channel)
      return this.committed(this.channelResult(operation))
    })
  }

  /**
   * Atomically append one top-level Message and every fact derived from it.
   * @param request - Authorized send intent.
   * @returns The immutable Message, Task, Thread, Follow, intents, and receipt.
   */
  sendMessage(
    request: AgentTeamAuthorizedSendMessageRequest,
  ): Promise<AgentTeamLedgerResult<AgentTeamSendMessageResult>> {
    return this.enqueue(async () => {
      const recipients = this.normalizeRecipients(request.actor, request.recipients)
      const existing = this.byRequest.get(request.requestId)
      if (existing !== undefined) {
        this.assertSameMessage(existing, request, recipients)
        return this.resolved(this.messageResult(existing))
      }
      this.assertHumanActor(request.actor)
      const channel = this.requireChannel(request.workspaceId, request.channelRef)
      if (request.body.trim() === '') throw new Error('message body must not be empty')
      const sequence = this.nextSequence()
      const taskRef = this.ref('task')
      const threadRef = this.ref('thread')
      const task: AgentTeamTask = Object.freeze({
        taskRef,
        channelRef: channel.channelRef,
        threadRef,
        status: 'todo',
      })
      const thread: AgentTeamThread = Object.freeze({ threadRef, taskRef, revision: sequence })
      const message: AgentTeamMessage = Object.freeze({
        messageRef: this.ref('message'),
        channelRef: channel.channelRef,
        threadRef,
        taskRef,
        sender: request.actor.memberId,
        body: request.body,
        topLevel: true,
        sequence,
      })
      const follows: readonly AgentTeamFollow[] = Object.freeze([
        Object.freeze({ memberId: request.actor.memberId, threadRef, following: true }),
      ])
      const recipientIntents: readonly AgentTeamRecipientIntent[] = Object.freeze(
        recipients.map(recipient => Object.freeze({
          intentRef: this.ref('intent'),
          threadRef,
          recipient,
          state: 'queued' as const,
        })),
      )
      const operation: AgentTeamMessageSentOperation = Object.freeze({
        ...this.operationBase(request, sequence),
        kind: 'team/message-sent',
        data: Object.freeze({
          workspaceId: request.workspaceId,
          message,
          task,
          thread,
          follows,
          recipientIntents,
        }),
      })
      await this.table.put(operation.operationId, operation)
      this.commit(operation)
      this.projectMessage(operation)
      return this.committed(this.messageResult(operation))
    })
  }

  /**
   * Read bounded facts visible to the Human across one Workspace.
   * @param request - Workspace scope, optional Channel filter, and continuation.
   * @returns Channels and Message-derived facts after the supplied sequence.
   */
  view(request: AgentTeamViewRequest): AgentTeamView {
    const limit = request.limit ?? 20
    const cursor = request.cursor ?? 0
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('limit must be an integer between 1 and 100')
    }
    if (!Number.isInteger(cursor) || cursor < 0) {
      throw new Error('cursor must be a non-negative integer sequence')
    }
    const channels = [...this.channels.values()]
      .filter(channel => channel.workspaceId === request.workspaceId)
    if (request.channelRef !== undefined) {
      this.requireChannel(request.workspaceId, request.channelRef)
    }
    const candidates = this.messages.filter(message => {
      if (message.sequence <= cursor) return false
      const channel = this.channels.get(message.channelRef)
      if (channel?.workspaceId !== request.workspaceId) return false
      return request.channelRef === undefined || message.channelRef === request.channelRef
    })
    const selected = candidates.slice(0, limit)
    const items = selected.map((message) => {
      const task = this.tasks.get(message.taskRef)
      const thread = this.threads.get(message.threadRef)
      if (task === undefined || thread === undefined) {
        throw new Error(`agent-team projection is incomplete for message '${message.messageRef}'`)
      }
      return Object.freeze({ message, task, thread })
    })
    return Object.freeze({
      channels: Object.freeze(channels),
      items: Object.freeze(items),
      cursor: selected.at(-1)?.sequence ?? cursor,
      hasMore: candidates.length > selected.length,
    })
  }

  /**
   * Return the current projection after initialization has committed.
   * @returns The immutable Human-facing Team status.
   */
  status(): AgentTeamStatus {
    const initialization = this.ordered[0]
    if (initialization === undefined) {
      throw new Error('agent-team ledger is not initialized')
    }
    this.assertInitializationRecord(initialization)
    return Object.freeze({
      initialized: true,
      sequence: this.ordered.length,
      operationCount: this.ordered.length,
      channelCount: this.channels.size,
      agentMemberCount: 0,
      humanMemberId: initialization.data.humanMemberId,
    })
  }

  /** Validate all ledger relationships against the current durable table. */
  validate(): void {
    const records = this.sortedRecords()
    if (records.length !== this.ordered.length) {
      throw new Error('agent-team ledger projection length differs from the durable table')
    }
    this.validateRecords(records)
  }

  private replay(): void {
    const records = this.sortedRecords()
    this.validateRecords(records)
    for (const [, operation] of records) {
      this.commit(operation)
      if (operation.kind === 'team/channel-created') {
        this.channels.set(operation.data.channel.channelRef, operation.data.channel)
      } else if (operation.kind === 'team/message-sent') {
        this.projectMessage(operation)
      }
    }
  }

  private validateRecords(records: readonly [AgentTeamOperationId, AgentTeamOperation][]): void {
    const operationIds = new Set<AgentTeamOperationId>()
    const requestIds = new Set<AgentTeamRequestId>()
    const refs = new Set<string>()
    const channels = new Map<AgentTeamChannelRef, AgentTeamChannel>()
    let previousOperationId: AgentTeamOperationId | null = null
    let humanMemberId: AgentTeamMemberId | undefined
    for (const [index, [key, operation]] of records.entries()) {
      const expectedSequence = index + 1
      if (key !== operation.operationId) {
        throw new Error(`agent-team operation key '${key}' differs from record id '${operation.operationId}'`)
      }
      if (operation.sequence !== expectedSequence) {
        throw new Error(`agent-team ledger expected sequence ${expectedSequence}, found ${operation.sequence}`)
      }
      if (operation.previousOperationId !== previousOperationId) {
        throw new Error(`agent-team operation ${operation.sequence} has a broken previous-operation link`)
      }
      if (operationIds.has(operation.operationId)) {
        throw new Error(`agent-team ledger repeats operation id '${operation.operationId}'`)
      }
      if (requestIds.has(operation.requestId)) {
        throw new Error(`agent-team ledger repeats request id '${operation.requestId}'`)
      }
      if (expectedSequence === 1) {
        this.assertInitializationRecord(operation)
        humanMemberId = operation.data.humanMemberId
      } else {
        if (humanMemberId === undefined) throw new Error('agent-team ledger has no Human Member')
        this.assertHumanOperation(operation, humanMemberId, channels, refs)
      }
      operationIds.add(operation.operationId)
      requestIds.add(operation.requestId)
      previousOperationId = operation.operationId
    }
  }

  private assertHumanOperation(
    operation: AgentTeamOperation,
    humanMemberId: AgentTeamMemberId,
    channels: Map<AgentTeamChannelRef, AgentTeamChannel>,
    refs: Set<string>,
  ): void {
    if (operation.kind === 'team/initialized') {
      throw new Error('agent-team initialization must be the first and only initialization operation')
    }
    if (operation.actor.kind !== 'human' || operation.actor.memberId !== humanMemberId) {
      throw new Error(`agent-team operation ${operation.sequence} has invalid Human authority`)
    }
    if (operation.kind === 'team/channel-created') {
      const { channel } = operation.data
      if (operation.data.workspaceId !== channel.workspaceId
        || channel.createdAtSequence !== operation.sequence) {
        throw new Error(`agent-team Channel operation ${operation.sequence} has inconsistent data`)
      }
      this.addRef(refs, channel.channelRef)
      channels.set(channel.channelRef, channel)
      return
    }
    const { message, task, thread, follows, recipientIntents } = operation.data
    const channel = channels.get(message.channelRef)
    if (channel === undefined || channel.workspaceId !== operation.data.workspaceId) {
      throw new Error(`agent-team Message operation ${operation.sequence} references an invalid Channel`)
    }
    if (message.sequence !== operation.sequence
      || message.sender !== operation.actor.memberId
      || task.channelRef !== message.channelRef
      || task.taskRef !== message.taskRef
      || task.threadRef !== message.threadRef
      || thread.taskRef !== task.taskRef
      || thread.threadRef !== task.threadRef
      || thread.revision !== operation.sequence) {
      throw new Error(`agent-team Message operation ${operation.sequence} has inconsistent derived facts`)
    }
    this.addRef(refs, message.messageRef)
    this.addRef(refs, task.taskRef)
    this.addRef(refs, thread.threadRef)
    if (follows.length !== 1
      || follows[0]?.memberId !== operation.actor.memberId
      || follows[0].threadRef !== thread.threadRef) {
      throw new Error(`agent-team Message operation ${operation.sequence} has invalid Follow state`)
    }
    const recipients = new Set<AgentTeamMemberId>()
    for (const intent of recipientIntents) {
      this.addRef(refs, intent.intentRef)
      if (intent.threadRef !== thread.threadRef
        || intent.recipient === operation.actor.memberId
        || recipients.has(intent.recipient)) {
        throw new Error(`agent-team Message operation ${operation.sequence} has invalid recipient intents`)
      }
      recipients.add(intent.recipient)
    }
  }

  private assertInitializationRecord(
    operation: AgentTeamOperation,
  ): asserts operation is AgentTeamInitializedOperation {
    if (operation.kind !== 'team/initialized'
      || operation.sequence !== 1
      || operation.previousOperationId !== null
      || operation.actor.kind !== 'human'
      || operation.actor.memberId !== operation.data.humanMemberId) {
      throw new Error('agent-team initialization operation has an invalid payload')
    }
  }

  private assertSameInitialization(
    operation: AgentTeamOperation,
    request: AgentTeamInitializeRequest,
  ): asserts operation is AgentTeamInitializedOperation {
    if (operation.kind !== 'team/initialized'
      || !this.sameActor(operation.actor, request.actor)
      || operation.data.humanMemberId !== request.humanMemberId) {
      this.throwRequestCollision(request.requestId)
    }
  }

  private assertSameChannelCreation(
    operation: AgentTeamOperation,
    request: AgentTeamAuthorizedCreateChannelRequest,
  ): asserts operation is AgentTeamChannelCreatedOperation {
    if (operation.kind !== 'team/channel-created'
      || !this.sameActor(operation.actor, request.actor)
      || operation.data.workspaceId !== request.workspaceId
      || operation.data.channel.name !== request.name.trim()) {
      this.throwRequestCollision(request.requestId)
    }
  }

  private assertSameMessage(
    operation: AgentTeamOperation,
    request: AgentTeamAuthorizedSendMessageRequest,
    recipients: readonly AgentTeamMemberId[],
  ): asserts operation is AgentTeamMessageSentOperation {
    const storedRecipients = operation.kind === 'team/message-sent'
      ? operation.data.recipientIntents.map(intent => intent.recipient)
      : []
    if (operation.kind !== 'team/message-sent'
      || !this.sameActor(operation.actor, request.actor)
      || operation.data.workspaceId !== request.workspaceId
      || operation.data.message.channelRef !== request.channelRef
      || operation.data.message.body !== request.body
      || !this.sameList(storedRecipients, recipients)) {
      this.throwRequestCollision(request.requestId)
    }
  }

  private assertHumanActor(actor: AgentTeamHumanActor): void {
    const initialization = this.ordered[0]
    if (initialization === undefined) throw new Error('agent-team ledger is not initialized')
    this.assertInitializationRecord(initialization)
    if (actor.kind !== 'human' || actor.memberId !== initialization.data.humanMemberId) {
      throw new Error('agent-team operation lacks Human authority')
    }
  }

  private normalizeRecipients(
    actor: AgentTeamHumanActor,
    recipients: readonly AgentTeamMemberId[] | undefined,
  ): readonly AgentTeamMemberId[] {
    const unique = new Set(recipients ?? [])
    if (unique.size !== (recipients?.length ?? 0)) {
      throw new Error('recipient set contains duplicate Member refs')
    }
    if (unique.has(actor.memberId)) {
      throw new Error('sender cannot be a recipient intent')
    }
    return Object.freeze([...unique].sort())
  }

  private requireChannel(workspaceId: WorkspaceId, channelRef: AgentTeamChannelRef): AgentTeamChannel {
    const channel = this.channels.get(channelRef)
    if (channel === undefined) throw new Error(`unknown Channel ref '${channelRef}'`)
    if (channel.workspaceId !== workspaceId) {
      throw new Error(`Channel '${channelRef}' does not belong to Workspace '${workspaceId}'`)
    }
    return channel
  }

  private projectMessage(operation: AgentTeamMessageSentOperation): void {
    this.messages.push(operation.data.message)
    this.tasks.set(operation.data.task.taskRef, operation.data.task)
    this.threads.set(operation.data.thread.threadRef, operation.data.thread)
  }

  private channelResult(operation: AgentTeamChannelCreatedOperation): AgentTeamCreateChannelResult {
    return Object.freeze({ receipt: this.receipt(operation), channel: operation.data.channel })
  }

  private messageResult(operation: AgentTeamMessageSentOperation): AgentTeamSendMessageResult {
    return Object.freeze({
      receipt: this.receipt(operation),
      message: operation.data.message,
      task: operation.data.task,
      thread: operation.data.thread,
      follows: operation.data.follows,
      recipientIntents: operation.data.recipientIntents,
    })
  }

  private operationBase(
    request: { readonly requestId: AgentTeamRequestId; readonly actor: AgentTeamHumanActor },
    sequence: number,
  ) {
    return {
      sequence,
      operationId: this.createOperationId(),
      requestId: request.requestId,
      occurredAt: this.createOccurredAt(),
      actor: Object.freeze({ ...request.actor }),
      previousOperationId: this.ordered.at(-1)?.operationId ?? null,
    }
  }

  private commit(operation: AgentTeamOperation): void {
    this.ordered.push(operation)
    this.byRequest.set(operation.requestId, operation)
  }

  private nextSequence(): number {
    if (this.ordered.length === 0) throw new Error('agent-team ledger is not initialized')
    return this.ordered.length + 1
  }

  private ref(kind: 'channel'): AgentTeamChannelRef
  private ref(kind: 'message'): AgentTeamMessageRef
  private ref(kind: 'task'): AgentTeamTaskRef
  private ref(kind: 'thread'): AgentTeamThreadRef
  private ref(kind: 'intent'): AgentTeamRecipientIntentRef
  private ref(kind: 'channel' | 'message' | 'task' | 'thread' | 'intent') {
    return this.createRef(kind)
  }

  private addRef(refs: Set<string>, ref: string): void {
    if (refs.has(ref)) throw new Error(`agent-team ledger repeats entity ref '${ref}'`)
    refs.add(ref)
  }

  private sameActor(left: AgentTeamHumanActor, right: AgentTeamHumanActor): boolean {
    return left.kind === right.kind
      && left.memberId === right.memberId
      && left.handle === right.handle
  }

  private sameList<T>(left: readonly T[], right: readonly T[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index])
  }

  private throwRequestCollision(requestId: AgentTeamRequestId): never {
    throw new Error(`agent-team request id '${requestId}' was reused with a different operation or payload`)
  }

  private receipt(operation: AgentTeamOperation): AgentTeamOperationReceipt {
    return Object.freeze({
      operationId: operation.operationId,
      requestId: operation.requestId,
      sequence: operation.sequence,
    })
  }

  private committed<T>(value: T): AgentTeamLedgerResult<T> {
    return Object.freeze({ value, committed: true })
  }

  private resolved<T>(value: T): AgentTeamLedgerResult<T> {
    return Object.freeze({ value, committed: false })
  }

  private sortedRecords(): Array<[AgentTeamOperationId, AgentTeamOperation]> {
    return [...this.table.entries()].sort((left, right) => left[1].sequence - right[1].sequence)
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationTail.then(operation)
    this.operationTail = result.then(() => {}, () => {})
    return result
  }
}
