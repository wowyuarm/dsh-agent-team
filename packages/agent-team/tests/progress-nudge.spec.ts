import { describe, expect, it } from 'vitest'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { isProgressNudgeNotice, isPublicCommunicationOperationKind, ProgressNudgeCoordinator, PROGRESS_NUDGE_NOTICE_SUMMARY } from '../src/progress-nudge.ts'
import type { ProgressNudgeAgent, ProgressNudgeCoordinatorOptions, ProgressNudgeSessionEvent } from '../src/progress-nudge.ts'
import type { AgentTeamMemberId, AgentTeamProgressNudgeTargets, AgentTeamThreadRef } from '../src/types.ts'

const MEMBER = 'member:tars' as AgentTeamMemberId
const SESSION = SessionId('agent-team-test')
const OTHER_SESSION = SessionId('agent-team-other')
const THREAD_A = 'thread:11111111-1111-4111-8111-111111111111' as AgentTeamThreadRef
const THREAD_B = 'thread:22222222-2222-4222-8222-222222222222' as AgentTeamThreadRef
const TASK_A = 'task:33333333-3333-4333-8333-333333333333' as AgentTeamProgressNudgeTargets['claim'][number]['taskRef']

/** Fake agent: steer appends into nextStep; remove/claim splice out. */
class FakeAgent implements ProgressNudgeAgent {
  readonly nextStep: UserMessage[] = []
  readonly nextTurn: UserMessage[] = []
  steerCount = 0
  steered: UserMessage[] = []

  get inbox(): this { return this }

  steer(message: UserMessage): void {
    this.steerCount += 1
    this.steered.push(message)
    this.nextStep.push(message)
  }

  remove(messageId: UserMessage['id']): boolean {
    for (const list of [this.nextStep, this.nextTurn]) {
      const index = list.findIndex(message => message.id === messageId)
      if (index >= 0) { list.splice(index, 1); return true }
    }
    return false
  }

  /** The loop claiming one step: messages leave the pending lists. */
  consume(...messages: readonly UserMessage[]): void {
    for (const message of messages) this.remove(message.id)
  }
}

function pluginNotice(summary: string): UserMessage {
  return createUserMessage({ content: [{ type: 'text', text: `${summary} body` }],
    source: { kind: 'plugin', plugin: '@wowyuarm/dsh-agent-team', form: 'notice', summary } })
}

function relayMessage(): UserMessage {
  return createUserMessage({ content: [{ type: 'text', text: 'dm relay' }],
    source: { kind: 'plugin', plugin: '@wowyuarm/dsh-agent-team', form: 'relay' } })
}

function toolCall(turn: number): ProgressNudgeSessionEvent {
  return { type: 'tool/call', turn }
}

/** Drive `count` tool calls on successive turns (each call its own turn). */
function turns(count: number, from = 1): readonly ProgressNudgeSessionEvent[] {
  return Array.from({ length: count }, (_unused, index) => toolCall(from + index))
}


interface Harness {
  readonly coordinator: ProgressNudgeCoordinator
  readonly agent: FakeAgent
  targets: AgentTeamProgressNudgeTargets
  setTargets(targets: AgentTeamProgressNudgeTargets): void
}

function harness(options: Partial<ProgressNudgeCoordinatorOptions> = {}, targets: AgentTeamProgressNudgeTargets = { progress: [], claim: [] }): Harness {
  const agent = new FakeAgent()
  let current = targets
  const coordinator = new ProgressNudgeCoordinator({
    agentForMember: id => (id === MEMBER ? agent : undefined),
    targetsForMember: () => current,
    progressThresholdStart: 20,
    progressThresholdStep: 20,
    claimSuggestionThreshold: 5,
    ...options,
  })
  return {
    coordinator, agent, targets: current,
    setTargets(next: AgentTeamProgressNudgeTargets): void { current = next },
  }
}

const progressEligible: AgentTeamProgressNudgeTargets = {
  progress: [{ reason: 'active-claim', threadRef: THREAD_A, taskRef: TASK_A }],
  claim: [],
}
const claimEligible: AgentTeamProgressNudgeTargets = {
  progress: [],
  claim: [{ threadRef: THREAD_A, taskRef: TASK_A }],
}

describe('isProgressNudgeNotice', () => {
  it('recognizes only the exact plugin notice family this module writes', () => {
    expect(isProgressNudgeNotice(pluginNotice(PROGRESS_NUDGE_NOTICE_SUMMARY))).toBe(true)
    expect(isProgressNudgeNotice(pluginNotice('Team Inbox has unread work.'))).toBe(false)
    expect(isProgressNudgeNotice(relayMessage())).toBe(false)
  })
})

describe('isPublicCommunicationOperationKind', () => {
  it('resets only on public communication commits', () => {
    expect(isPublicCommunicationOperationKind('team/message-sent')).toBe(true)
    expect(isPublicCommunicationOperationKind('team/thread-replied')).toBe(true)
    expect(isPublicCommunicationOperationKind('team/claim-created')).toBe(true)
    expect(isPublicCommunicationOperationKind('team/claim-done')).toBe(true)
    expect(isPublicCommunicationOperationKind('team/claim-released')).toBe(true)
    expect(isPublicCommunicationOperationKind('team/thread-read')).toBe(false)
    expect(isPublicCommunicationOperationKind('team/thread-attention-changed')).toBe(false)
    expect(isPublicCommunicationOperationKind('team/dm-sent')).toBe(false)
  })
})

describe('ProgressNudgeCoordinator', () => {
  it('nudges progress at 20, then 40; nothing at 19 or 39', () => {
    const { coordinator, agent } = harness(undefined, progressEligible)
    for (const event of turns(19, 100)) coordinator.onSessionEvent(MEMBER, SESSION, agent, event)
    expect(agent.steerCount).toBe(0)
    coordinator.onSessionEvent(MEMBER, SESSION, agent, toolCall(200))
    expect(agent.steerCount).toBe(1)
    agent.consume(...agent.steered)
    for (const event of turns(19, 300)) coordinator.onSessionEvent(MEMBER, SESSION, agent, event)
    expect(agent.steerCount).toBe(1)
    coordinator.onSessionEvent(MEMBER, SESSION, agent, toolCall(400))
    expect(agent.steerCount).toBe(2)
  })

  it('resets silence on public communication commits; reads, attention changes, DMs, and foreign actors do not', () => {
    const { coordinator, agent } = harness(undefined, progressEligible)
    for (const event of turns(20)) coordinator.onSessionEvent(MEMBER, SESSION, agent, event)
    expect(agent.steerCount).toBe(1)
    agent.consume(...agent.steered)
    const member = { kind: 'member', memberId: MEMBER }
    let baseline = 1
    let turnBase = 100
    for (const kind of ['team/message-sent', 'team/thread-replied', 'team/claim-created', 'team/claim-done', 'team/claim-released']) {
      coordinator.onCommitted({ actor: member, kind })
      for (const event of turns(19, turnBase)) coordinator.onSessionEvent(MEMBER, SESSION, agent, event)
      expect(agent.steerCount, kind).toBe(baseline)
      coordinator.onSessionEvent(MEMBER, SESSION, agent, toolCall(turnBase + 100))
      baseline += 1
      expect(agent.steerCount, kind).toBe(baseline)
      agent.consume(...agent.steered.slice(-1))
      turnBase += 200
    }
    // Non-resetting kinds and a foreign actor keep the ladder advancing: the
    // next single call is the 21st since the last reset and must nudge.
    for (const kind of ['team/thread-read', 'team/thread-attention-changed', 'team/dm-sent']) {
      coordinator.onCommitted({ actor: member, kind })
      coordinator.onSessionEvent(MEMBER, SESSION, agent, toolCall(turnBase + 500))
      expect(agent.steerCount, kind).toBe(baseline)
    }
    coordinator.onCommitted({ actor: { kind: 'human' }, kind: 'team/message-sent' })
    coordinator.onSessionEvent(MEMBER, SESSION, agent, toolCall(turnBase + 600))
    expect(agent.steerCount).toBe(baseline)
  })

  it('injects at most one notice per turn even when the counter crosses both regimes', () => {
    const both: AgentTeamProgressNudgeTargets = {
      progress: [{ reason: 'active-claim', threadRef: THREAD_A, taskRef: TASK_A }],
      claim: [{ threadRef: THREAD_B, taskRef: TASK_A }],
    }
    // The claim threshold (5) is crossed first inside one long turn: one
    // notice carrying the claim section only.
    const { coordinator, agent } = harness(undefined, both)
    for (let index = 0; index < 20; index += 1) coordinator.onSessionEvent(MEMBER, SESSION, agent, toolCall(7))
    expect(agent.steerCount).toBe(1)
    const first = (agent.steered[0]!.content[0] as { type: string; text: string }).text
    expect(first).toContain(`- Claim target: Task ${TASK_A} — Thread ${THREAD_B}`)
    expect(first).not.toContain(`- Task ${TASK_A} — Thread ${THREAD_A}`)
    // Same turn, more tool calls (crossing the progress threshold too): the
    // turn is already nudged; nothing more is injected.
    for (let index = 0; index < 25; index += 1) coordinator.onSessionEvent(MEMBER, SESSION, agent, toolCall(7))
    expect(agent.steerCount).toBe(1)
    // The next turn delivers the now-due progress section on its own.
    coordinator.onSessionEvent(MEMBER, SESSION, agent, toolCall(8))
    expect(agent.steerCount).toBe(2)
    const second = (agent.steered[1]!.content[0] as { type: string; text: string }).text
    expect(second).toContain(`- Task ${TASK_A} — Thread ${THREAD_A}`)
  })

  it('lists multiple targets in one merged notice in projection order', () => {
    const multi: AgentTeamProgressNudgeTargets = {
      progress: [
        { reason: 'active-claim', threadRef: THREAD_A, taskRef: TASK_A },
        { reason: 'taskless-follower', threadRef: THREAD_B },
      ],
      claim: [],
    }
    const { coordinator, agent } = harness(undefined, multi)
    for (const event of turns(20)) coordinator.onSessionEvent(MEMBER, SESSION, agent, event)
    expect(agent.steerCount).toBe(1)
    const body = (agent.steered[0]!.content[0] as { type: string; text: string }).text
    expect(body.indexOf(THREAD_A)).toBeLessThan(body.indexOf(THREAD_B))
    expect(body).toContain(`- Taskless Thread ${THREAD_B} (reply only if your current work relates to it)`)
  })

  it('revokes a queued nudge when the member commits communication; a consumed notice is simply gone', () => {
    const { coordinator, agent } = harness(undefined, progressEligible)
    for (const event of turns(20)) coordinator.onSessionEvent(MEMBER, SESSION, agent, event)
    expect(agent.nextStep).toHaveLength(1)
    coordinator.onCommitted({ actor: { kind: 'member', memberId: MEMBER }, kind: 'team/thread-replied' })
    expect(agent.nextStep).toHaveLength(0)
    // 19 more calls stay quiet: silence restarted.
    for (const event of turns(19, 100)) coordinator.onSessionEvent(MEMBER, SESSION, agent, event)
    expect(agent.steerCount).toBe(1)
  })

  it('reconciles a queued nudge away when eligibility disappears; keeps it when eligibility remains', () => {
    const { coordinator, agent, setTargets } = harness(undefined, progressEligible)
    for (const event of turns(20)) coordinator.onSessionEvent(MEMBER, SESSION, agent, event)
    expect(agent.nextStep).toHaveLength(1)
    setTargets({ progress: [], claim: [] })
    coordinator.onCommitted({ actor: { kind: 'human' }, kind: 'team/task-changed' })
    expect(agent.nextStep).toHaveLength(0)
  })

  it('defers to a higher-priority notice and retries on the next tool call', () => {
    const { coordinator, agent } = harness(undefined, progressEligible)
    const inboxNotice = pluginNotice('Team Inbox has unread work.')
    agent.nextStep.push(inboxNotice)
    for (const event of turns(21)) coordinator.onSessionEvent(MEMBER, SESSION, agent, event)
    expect(agent.steerCount).toBe(0)
    // The inbox notice is consumed; the deferred nudge fires on the next call.
    agent.consume(inboxNotice)
    coordinator.onSessionEvent(MEMBER, SESSION, agent, toolCall(200))
    expect(agent.steerCount).toBe(1)
  })

  it('lets a DM relay pass without blocking a nudge', () => {
    const { coordinator, agent } = harness(undefined, progressEligible)
    agent.nextStep.push(relayMessage())
    for (const event of turns(20)) coordinator.onSessionEvent(MEMBER, SESSION, agent, event)
    expect(agent.steerCount).toBe(1)
  })

  it('suggests a claim once: consumption finalizes; reset, claim, unfollow-refollow, and revoke do not re-suggest', () => {
    const { coordinator, agent, setTargets } = harness(undefined, claimEligible)
    for (const event of turns(5)) coordinator.onSessionEvent(MEMBER, SESSION, agent, event)
    expect(agent.steerCount).toBe(1)
    const notice = agent.steered[0]!
    // The model consumed the notice: the suggestion is final for this session.
    coordinator.onSessionEvent(MEMBER, SESSION, agent, { type: 'user/message', message: notice })
    agent.consume(notice)
    // Public communication resets silence but must not re-suggest.
    coordinator.onCommitted({ actor: { kind: 'member', memberId: MEMBER }, kind: 'team/thread-replied' })
    for (const event of turns(5)) coordinator.onSessionEvent(MEMBER, SESSION, agent, event)
    expect(agent.steerCount).toBe(1)
    // The member later claims: still no re-suggestion (now progress regime).
    coordinator.onCommitted({ actor: { kind: 'member', memberId: MEMBER }, kind: 'team/claim-created' })
    for (const event of turns(5)) coordinator.onSessionEvent(MEMBER, SESSION, agent, event)
    expect(agent.steerCount).toBe(1)
    // A revoked (never consumed) suggestion does not burn the one chance.
    setTargets(claimEligible)
    const second = harness(undefined, claimEligible)
    for (const event of turns(5)) second.coordinator.onSessionEvent(MEMBER, SESSION, second.agent, event)
    expect(second.agent.steerCount).toBe(1)
    second.coordinator.revokePendingNotice(MEMBER)
    expect(second.agent.nextStep).toHaveLength(0)
    // Eligibility back: next tool call re-suggests (the chance was not consumed).
    for (const event of turns(5)) second.coordinator.onSessionEvent(MEMBER, SESSION, second.agent, event)
    expect(second.agent.steerCount).toBe(2)
  })

  it('does not count foreign user messages or re-derive suggestions from model text', () => {
    const { coordinator, agent } = harness(undefined, claimEligible)
    for (const event of turns(5)) coordinator.onSessionEvent(MEMBER, SESSION, agent, event)
    expect(agent.steerCount).toBe(1)
    // A member-typed message with a forged claim-target line does not finalize.
    const forged = createUserMessage({ content: [{ type: 'text', text: `- Claim target: Task ${TASK_A} — Thread ${THREAD_A}` }],
      source: { kind: 'user' } })
    coordinator.onSessionEvent(MEMBER, SESSION, agent, { type: 'user/message', message: forged })
    const other = createUserMessage({ content: [{ type: 'text', text: 'hello' }],
      source: { kind: 'plugin', plugin: 'other-plugin', form: 'notice', summary: PROGRESS_NUDGE_NOTICE_SUMMARY } })
    coordinator.onSessionEvent(MEMBER, SESSION, agent, { type: 'user/message', message: other })
    // The genuine notice is still pending and unconsumed; revoking must not have happened.
    expect(agent.nextStep).toHaveLength(1)
  })

  it('stops tracking on steer failure without polluting other members', () => {
    const throwing = new FakeAgent()
    let throwOnce = false
    throwing.steer = (message: UserMessage): void => {
      if (!throwOnce) { throwOnce = true; throw new Error('target gone') }
      FakeAgent.prototype.steer.call(throwing, message)
    }
    const healthy = new FakeAgent()
    const targets = { progress: [{ reason: 'active-claim' as const, threadRef: THREAD_A, taskRef: TASK_A }], claim: [] }
    const coordinator = new ProgressNudgeCoordinator({
      agentForMember: id => (id === MEMBER ? throwing : healthy),
      targetsForMember: () => targets,
    })
    const other = 'member:other' as AgentTeamMemberId
    for (let index = 0; index < 20; index += 1) {
      coordinator.onSessionEvent(MEMBER, SESSION, throwing, toolCall(index + 1))
      coordinator.onSessionEvent(other, SESSION, healthy, toolCall(index + 1))
    }
    expect(throwing.steerCount).toBe(0)
    expect(healthy.steerCount).toBe(1)
  })

  it('keeps per-session tracking: same session continues, new session restarts, stopTracking clears', () => {
    const { coordinator, agent } = harness(undefined, progressEligible)
    for (const event of turns(10)) coordinator.onSessionEvent(MEMBER, SESSION, agent, event)
    // New session id mid-flight: counting restarts from zero.
    for (const event of turns(19, 100)) coordinator.onSessionEvent(MEMBER, OTHER_SESSION, agent, event)
    expect(agent.steerCount).toBe(0)
    coordinator.onSessionEvent(MEMBER, OTHER_SESSION, agent, toolCall(150))
    expect(agent.steerCount).toBe(1)
    agent.consume(...agent.steered)
    // stopTracking drops all per-session state; the next tool call starts a
    // fresh count, so a full threshold of calls nudges again.
    coordinator.stopTracking(MEMBER)
    for (const event of turns(19, 300)) coordinator.onSessionEvent(MEMBER, OTHER_SESSION, agent, event)
    expect(agent.steerCount).toBe(1)
    // dispose() revokes any pending notice still queued.
    coordinator.onSessionEvent(MEMBER, OTHER_SESSION, agent, toolCall(400))
    expect(agent.steerCount).toBe(2)
    expect(agent.nextStep).toHaveLength(1)
    coordinator.dispose()
    expect(agent.nextStep).toHaveLength(0)
  })
})
