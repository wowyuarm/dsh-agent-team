import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { SessionId } from '@deepseek-ai/dsh-session'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { MemoryMediaPool, MemoryStorageBackend } from './helpers/memory-backend.ts'
import { AGENT_TEAM_HUMAN_MEMBER_ID, AgentTeamLedger, agentTeamHumanActor } from '../src/ledger.ts'
import { agentTeamDomainSpec } from '../src/spec.ts'
import type { AgentTeamChannelRef, AgentTeamMemberActor, AgentTeamMemberId, AgentTeamOperation, AgentTeamOperationId, AgentTeamRequestId, AgentTeamTaskRef, AgentTeamThreadRef } from '../src/types.ts'

/**
 * Issue #21: the read projections must keep byte-identical semantics while
 * the Host replaces full-table scans with replay-derived indexes. This suite
 * builds one large ledger (100+ Threads/facts), pins the projection values,
 * and cross-checks every read against an independent replay of the same
 * operation table — the replay rebuilds the indexes through `applyTo` alone,
 * so any drift between the live indexes and the replay-derived ones fails.
 */

const cleanups: Array<() => Promise<void>> = []
const alpha = WorkspaceId('workspace:alpha')
const beta = WorkspaceId('workspace:beta')
const requestId = (value: string): AgentTeamRequestId => value as AgentTeamRequestId
const human = agentTeamHumanActor()

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(cleanup => cleanup()))
})

async function openLedger(): Promise<{ readonly ledger: AgentTeamLedger; readonly table: KvTable<AgentTeamOperationId, AgentTeamOperation> }> {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  cleanups.push(async () => { await facility.closeAll() })
  const domain = await ctx.storageDomain.open(agentTeamDomainSpec)
  const table = domain.table('operations') as unknown as KvTable<AgentTeamOperationId, AgentTeamOperation>
  return { ledger: new AgentTeamLedger(table), table }
}

function memberActor(memberId: string, handle: string): AgentTeamMemberActor {
  return { kind: 'member', memberId: memberId as AgentTeamMemberId, handle }
}

describe('large-ledger projection equivalence (issue #21)', () => {
  it('keeps inbox, view, taskNumbers and observations identical on a 100+ fact ledger and across replay', async () => {
    const { ledger, table } = await openLedger()
    await ledger.initialize()

    const channelA = (await ledger.createChannel({ requestId: requestId('channel-a'), workspaceId: alpha, name: 'alpha-one', description: 'Alpha one', memberIds: [], actor: human })).value.channel
    const channelB = (await ledger.createChannel({ requestId: requestId('channel-b'), workspaceId: alpha, name: 'alpha-two', description: 'Alpha two', memberIds: [], actor: human })).value.channel
    const channelC = (await ledger.createChannel({ requestId: requestId('channel-c'), workspaceId: beta, name: 'beta-one', description: 'Beta one', memberIds: [], actor: human })).value.channel

    const agentA = 'member:agent-a' as AgentTeamMemberId
    const agentB = 'member:agent-b' as AgentTeamMemberId
    const agentC = 'member:agent-c' as AgentTeamMemberId
    const agentMember = (memberId: string, handle: string, workspaceId: typeof alpha | typeof beta) => ({
      memberId: memberId as AgentTeamMemberId, sessionId: SessionId(`session:${memberId}`), workspaceId, handle,
      description: `${handle} description`, presetId: 'team-member', privateMemoryPath: `/tmp/${handle}`, state: 'enabled' as const,
    })
    await ledger.addMember({ requestId: requestId('member-a'), workspaceId: alpha, handle: 'scout', description: 'Scout work', presetId: 'team-member', channelRefs: [channelA.channelRef], actor: human, member: agentMember(agentA, 'scout', alpha) })
    await ledger.addMember({ requestId: requestId('member-b'), workspaceId: alpha, handle: 'planner', description: 'Planner work', presetId: 'team-member', channelRefs: [channelA.channelRef, channelB.channelRef], actor: human, member: agentMember(agentB, 'planner', alpha) })
    await ledger.addMember({ requestId: requestId('member-c'), workspaceId: beta, handle: 'builder', description: 'Builder work', presetId: 'team-member', channelRefs: [channelC.channelRef], actor: human, member: agentMember(agentC, 'builder', beta) })

    interface StartedThread {
      readonly label: string
      readonly channelRef: AgentTeamChannelRef
      readonly workspaceId: typeof alpha | typeof beta
      readonly taskRef: AgentTeamTaskRef
      readonly threadRef: AgentTeamThreadRef
      revision: number
      /** Display ordinal inside its home Channel, in creation order. */
      readonly taskNumber: number
      /** Message refs in ledger order, anchors and replies alike. */
      readonly messageRefs: string[]
      /** Sequence of every fact of the Thread, anchors and replies alike. */
      readonly factSequences: number[]
    }
    const threads: StartedThread[] = []
    const byLabel = new Map<string, StartedThread>()
    /** Every Message fact in true ledger order — anchors first, replies later. */
    const factOrder: { readonly channelRef: AgentTeamChannelRef; readonly messageRef: string }[] = []

    const startThread = async (label: string, channel: AgentTeamChannelRef, workspaceId: typeof alpha | typeof beta): Promise<StartedThread> => {
      const started = await ledger.sendMessage({ asTask: true, requestId: requestId(`start-${label}`), workspaceId, channelRef: channel, body: `Task ${label}\nsecond line`, actor: human })
      if (started.value.kind !== 'committed') throw new Error(`expected committed start for ${label}`)
      const entry: StartedThread = {
        label, channelRef: channel, workspaceId, taskRef: started.value.task!.taskRef, threadRef: started.value.thread.threadRef,
        revision: started.value.thread.revision, taskNumber: threads.filter(thread => thread.channelRef === channel).length + 1,
        messageRefs: [started.value.message.messageRef], factSequences: [started.value.message.sequence],
      }
      threads.push(entry)
      byLabel.set(label, entry)
      factOrder.push({ channelRef: channel, messageRef: started.value.message.messageRef })
      return entry
    }
    const reply = async (label: string, body: string, actor: typeof human | AgentTeamMemberActor, recipients?: readonly AgentTeamMemberId[]): Promise<void> => {
      const thread = byLabel.get(label)!
      const replied = await ledger.reply({ requestId: requestId(`reply-${label}-${body}`), workspaceId: thread.workspaceId, taskRef: thread.taskRef, body, baseRevision: thread.revision, actor, ...(recipients === undefined ? {} : { recipients }) })
      if (replied.value.kind !== 'committed') throw new Error(`expected committed reply on ${label}: ${replied.value.kind}`)
      thread.revision = replied.value.thread.revision
      thread.messageRefs.push(replied.value.message.messageRef)
      thread.factSequences.push(replied.value.message.sequence)
      factOrder.push({ channelRef: thread.channelRef, messageRef: replied.value.message.messageRef })
    }
    const follow = async (label: string, actor: typeof human | AgentTeamMemberActor, action: 'follow' | 'unfollow'): Promise<void> => {
      const thread = byLabel.get(label)!
      const changed = await ledger.changeAttention({ requestId: requestId(`${action}-${label}-${actor.memberId}`), workspaceId: thread.workspaceId, taskRef: thread.taskRef, action, actor })
      if (changed.committed !== true) throw new Error(`expected committed ${action} on ${label}`)
    }

    for (let index = 0; index < 30; index += 1) await startThread(`a${index}`, channelA.channelRef, alpha)
    for (let index = 0; index < 25; index += 1) await startThread(`b${index}`, channelB.channelRef, alpha)
    for (let index = 0; index < 20; index += 1) await startThread(`c${index}`, channelC.channelRef, beta)

    // Follows first, so later replies and mentions ride them.
    await follow('a0', memberActor(agentA, 'scout'), 'follow')
    await follow('a0', memberActor(agentB, 'planner'), 'follow')
    for (const label of ['a1', 'a2', 'a3', 'a4']) await follow(label, memberActor(agentB, 'planner'), 'follow')
    for (const label of ['a5', 'a6', 'a7', 'a8', 'a9']) await follow(label, memberActor(agentA, 'scout'), 'follow')

    // Replies: 3 per leading alpha Thread, plus the beta tail. agentB sends
    // the a-Thread replies, so its own followed Threads (a0..a4) stay
    // unread-free while agentA's follow on a0 accumulates unread.
    for (let index = 0; index < 10; index += 1) for (let round = 0; round < 3; round += 1) await reply(`a${index}`, `agent progress ${round}`, memberActor(agentB, 'planner'))
    for (let index = 0; index < 8; index += 1) for (let round = 0; round < 2; round += 1) await reply(`b${index}`, `human progress ${round}`, human)
    for (let index = 0; index < 5; index += 1) await reply(`c${index}`, 'beta progress', memberActor(agentC, 'builder'))
    // Thread starters follow their own Thread: the Human must catch up on a2
    // before the deferred-write gate lets them reply again.
    await ledger.readThread({ requestId: requestId('read-a2'), workspaceId: alpha, taskRef: byLabel.get('a2')!.taskRef, actor: human })
    await reply('a2', 'plain human update', human)

    // Mentions: the Human mentions the following scout (direct markers for
    // agentA), and planner mentions the Human on the b-Threads (direct
    // markers for the Human — the cross-member mention path). The Human
    // catches up on each mentioned Thread first: the deferred-write gate
    // refuses replies while the sender still holds unread.
    for (const label of ['a5', 'a6', 'a7', 'a8', 'a9']) await ledger.readThread({ requestId: requestId(`read-${label}`), workspaceId: alpha, taskRef: byLabel.get(label)!.taskRef, actor: human })
    for (const label of ['a5', 'a6', 'a7', 'a8', 'a9']) await reply(label, 'scout, please look', human, [agentA])
    for (const label of ['b0', 'b1', 'b2', 'b3', 'b4']) await reply(label, 'noting the operator', memberActor(agentB, 'planner'), [AGENT_TEAM_HUMAN_MEMBER_ID])

    // A durable read consumes the Human's own markers on b0/b1 only.
    await ledger.readThread({ requestId: requestId('read-b0'), workspaceId: alpha, taskRef: byLabel.get('b0')!.taskRef, actor: human })
    await ledger.readThread({ requestId: requestId('read-b1'), workspaceId: alpha, taskRef: byLabel.get('b1')!.taskRef, actor: human })

    // One departure exercises Attention removal on a mentioned Thread: the
    // direct marker survives, the ordinary unread stops growing.
    await follow('a5', memberActor(agentA, 'scout'), 'unfollow')

    expect(threads).toHaveLength(75)
    expect(threads.reduce((sum, thread) => sum + thread.factSequences.length, 0)).toBeGreaterThanOrEqual(100)

    // ---- taskNumbers: per-Channel creation ordinals, workspace-filtered. ----
    const viewA = ledger.view({ workspaceId: alpha, channelRef: channelA.channelRef, limit: 1 })
    expect(viewA.taskNumbers).toEqual(threads.filter(thread => thread.channelRef === channelA.channelRef).map(thread => ({ taskRef: thread.taskRef, taskNumber: thread.taskNumber })))
    const viewB = ledger.view({ workspaceId: alpha, channelRef: channelB.channelRef, limit: 1 })
    expect(viewB.taskNumbers).toEqual(threads.filter(thread => thread.channelRef === channelB.channelRef).map(thread => ({ taskRef: thread.taskRef, taskNumber: thread.taskNumber })))
    const viewWhole = ledger.view({ workspaceId: alpha, limit: 1 })
    expect(viewWhole.taskNumbers).toHaveLength(55)
    // limit bounds only items; the catalog slices stay complete.
    expect(viewWhole.channels).toHaveLength(2)
    expect(viewWhole.threads).toHaveLength(55)

    // ---- view(): the walk from the matching end with an early hasMore. ----
    const channelAFacts = factOrder.filter(fact => fact.channelRef === channelA.channelRef).map(fact => fact.messageRef)
    // 30 anchors + 30 agent replies + 5 Human mention replies + 1 catch-up update.
    expect(channelAFacts).toHaveLength(66)
    const first = ledger.view({ workspaceId: alpha, channelRef: channelA.channelRef, limit: 1 })
    expect(first.items.map(item => item.message.messageRef)).toEqual([channelAFacts[0]])
    expect(first.hasMore).toBe(true)

    // The first fact already came back in `first`; the cursor pages continue
    // strictly after it and must rebuild the whole Channel timeline.
    const paged: string[] = first.items.map(item => item.message.messageRef)
    let cursor = first.cursor
    let hasMore = true
    let guard = 0
    while (hasMore && guard < 100) {
      guard += 1
      const page = ledger.view({ workspaceId: alpha, channelRef: channelA.channelRef, limit: 7, cursor })
      paged.push(...page.items.map(item => item.message.messageRef))
      hasMore = page.hasMore
      cursor = page.cursor
    }
    for (let index = 0; index < Math.max(paged.length, channelAFacts.length); index += 1) {
      if (paged[index] !== channelAFacts[index]) console.log('DIFF at', index, paged[index], channelAFacts[index])
    }
    expect(paged).toEqual(channelAFacts)
    expect(ledger.view({ workspaceId: alpha, channelRef: channelA.channelRef, limit: 66 }).hasMore).toBe(false)
    expect(ledger.view({ workspaceId: alpha, channelRef: channelA.channelRef, limit: 65 }).hasMore).toBe(true)
    // Reading backwards from the live tail returns the newest window, then
    // walks to the empty head where hasMore finally falls.
    const latest = ledger.view({ workspaceId: alpha, channelRef: channelA.channelRef, direction: 'before', limit: 20 })
    expect(latest.items.map(item => item.message.messageRef)).toEqual(channelAFacts.slice(-20))
    expect(latest.hasMore).toBe(true)
    const backwards: string[] = latest.items.map(item => item.message.messageRef)
    cursor = latest.cursor
    hasMore = true
    guard = 0
    while (hasMore && guard < 100) {
      guard += 1
      const page = ledger.view({ workspaceId: alpha, channelRef: channelA.channelRef, direction: 'before', limit: 7, cursor })
      backwards.unshift(...page.items.map(item => item.message.messageRef))
      hasMore = page.hasMore
      cursor = page.cursor
    }
    expect(backwards).toEqual(channelAFacts)
    // topLevelOnly keeps exactly the Thread anchors.
    const topLevel = ledger.view({ workspaceId: alpha, channelRef: channelA.channelRef, topLevelOnly: true, limit: 100 })
    expect(topLevel.items.map(item => item.message.messageRef)).toEqual(threads.filter(thread => thread.channelRef === channelA.channelRef).map(thread => thread.messageRefs[0]))

    // ---- inbox(): direct-only slice equals the remaining mention markers. ----
    const humanInbox = ledger.inbox(human, { workspaceId: alpha, directOnly: true, limit: 100 })
    const humanRows = ['b4', 'b3', 'b2']
    expect(humanInbox.items.map(item => item.thread.threadRef)).toEqual(humanRows.map(label => byLabel.get(label)!.threadRef))
    expect(humanInbox.totalUnreadCount).toBe(3)
    expect(humanInbox.totalDirectCount).toBe(3)
    for (const item of humanInbox.items) {
      expect(item.channelName).toBe('alpha-two')
      expect(item.directCount).toBe(1)
      expect(item.unreadCount).toBe(1)
      expect(item.previewText).toBe(`Task ${threads.find(thread => thread.threadRef === item.thread.threadRef)!.label}`)
      expect(item.taskNumber).toBe(threads.find(thread => thread.threadRef === item.thread.threadRef)!.taskNumber)
    }
    // limit still bounds only items; the total collapses the whole slice.
    const humanBadge = ledger.inbox(human, { workspaceId: alpha, directOnly: true, limit: 1 })
    expect(humanBadge.items).toHaveLength(1)
    expect(humanBadge.totalUnreadCount).toBe(3)
    // The beta Workspace has no Human mention at all.
    const betaInbox = ledger.inbox(human, { workspaceId: beta, directOnly: true, limit: 100 })
    expect(betaInbox.items).toEqual([])
    expect(betaInbox.totalUnreadCount).toBe(0)
    // Pure follow unread stays out of the direct-only slice. The a5 unfollow
    // consumed that Thread's marker with the Attention, so four remain.
    const agentADirect = ledger.inbox(memberActor(agentA, 'scout'), { workspaceId: alpha, directOnly: true, limit: 100 })
    expect(agentADirect.items.map(item => item.thread.threadRef).sort()).toEqual(['a6', 'a7', 'a8', 'a9'].map(label => byLabel.get(label)!.threadRef).sort())

    // ---- inbox(): the agent-facing slice. ----
    const agentAInbox = ledger.inbox(memberActor(agentA, 'scout'), { workspaceId: alpha, limit: 100 })
    const unreadA = Object.fromEntries(agentAInbox.items.map(item => [item.thread.threadRef, { unreadCount: item.unreadCount, directCount: item.directCount }]))
    // a0: followed before three agent replies; a6..a9: the mention plus the
    // same three replies; a5 dropped out entirely — the unfollow consumed
    // its marker and ended the ordinary watermark.
    expect(unreadA[byLabel.get('a0')!.threadRef]).toEqual({ unreadCount: 3, directCount: 0 })
    for (const label of ['a6', 'a7', 'a8', 'a9']) expect(unreadA[byLabel.get(label)!.threadRef]).toEqual({ unreadCount: 4, directCount: 1 })
    expect(Object.keys(unreadA)).toHaveLength(5)
    const agentBInbox = ledger.inbox(memberActor(agentB, 'planner'), { workspaceId: alpha, limit: 100 })
    // planner's own replies never count; the plain Human update on a2 does.
    expect(agentBInbox.items.map(item => item.thread.threadRef)).toEqual([byLabel.get('a2')!.threadRef])
    expect(agentBInbox.totalUnreadCount).toBe(1)
    // The beta Channel never leaks into an alpha Member's slice.
    expect(ledger.inbox(memberActor(agentC, 'builder'), { workspaceId: beta, limit: 100 }).items).toEqual([])

    // ---- threadObservations(): replay-order history plus live followers. ----
    const a0Observations = ledger.threadObservations(human, { workspaceId: alpha, taskRef: byLabel.get('a0')!.taskRef })
    // The Thread starter's Attention rides the message-sent anchor (no
    // observation event); the explicit follow ops after it do.
    expect(a0Observations.followers).toEqual([AGENT_TEAM_HUMAN_MEMBER_ID, agentA, agentB])
    expect(a0Observations.items.map(item => [item.memberId, item.action])).toEqual([[agentA, 'follow'], [agentB, 'follow']])
    for (const item of a0Observations.items) expect(item.taskRef).toBe(byLabel.get('a0')!.taskRef)
    const a5Observations = ledger.threadObservations(human, { workspaceId: alpha, taskRef: byLabel.get('a5')!.taskRef })
    expect(a5Observations.followers).toEqual([AGENT_TEAM_HUMAN_MEMBER_ID])
    expect(a5Observations.items.map(item => [item.memberId, item.action])).toEqual([[agentA, 'follow'], [agentA, 'unfollow']])
    // limit bounds the history window, not the follower set.
    const a0Limited = ledger.threadObservations(human, { workspaceId: alpha, taskRef: byLabel.get('a0')!.taskRef, limit: 1 })
    expect(a0Limited.followers).toEqual([AGENT_TEAM_HUMAN_MEMBER_ID, agentA, agentB])
    expect(a0Limited.items.map(item => [item.memberId, item.action])).toEqual([[agentB, 'follow']])

    // ---- Independent replay: the derived indexes rebuild identically. ----
    expect(() => ledger.validate()).not.toThrow()
    const fresh = new AgentTeamLedger(table)
    expect(projectionSnapshot(fresh, channelA.channelRef)).toEqual(projectionSnapshot(ledger, channelA.channelRef))
  })

  function projectionSnapshot(source: AgentTeamLedger, channelRef: AgentTeamChannelRef): Record<string, unknown> {
    const thread = source.view({ workspaceId: alpha, channelRef, limit: 1 }).threads[0]!
    return {
      inboxA: source.inbox(memberActor('member:agent-a', 'scout'), { workspaceId: alpha, limit: 100 }),
      inboxHuman: source.inbox(human, { workspaceId: alpha, directOnly: true, limit: 100 }),
      viewA: source.view({ workspaceId: alpha, channelRef, limit: 7 }),
      viewTail: source.view({ workspaceId: alpha, channelRef, direction: 'before', limit: 5 }),
      observationsA0: source.threadObservations(human, { workspaceId: alpha, taskRef: thread.taskRef! }),
      observationsA5: source.threadObservations(human, { workspaceId: alpha, threadRef: thread.threadRef }),
      taskNumbers: source.view({ workspaceId: alpha, limit: 1 }).taskNumbers,
    }
  }
})
