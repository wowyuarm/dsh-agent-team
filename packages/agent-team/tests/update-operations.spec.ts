import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { MemoryMediaPool, MemoryStorageBackend } from './helpers/memory-backend.ts'
import AgentTeam from '../src/index.ts'
import { AgentTeamLedger } from '../src/ledger.ts'
import * as agentTeamInvariant from '../src/invariant.ts'
import type { AgentTeamChannelRef, AgentTeamOperation, AgentTeamOperationId, AgentTeamRequestId } from '../src/types.ts'

const cleanups: Array<() => Promise<void>> = []
const alpha = WorkspaceId('workspace:alpha')
const requestId = (value: string): AgentTeamRequestId => value as AgentTeamRequestId

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(cleanup => cleanup()))
})

async function harness(): Promise<{ readonly ctx: Context; readonly facility: DomainFacility }> {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  ctx.provide('workspaceRegistry', {
    get: (id: WorkspaceId) => id === alpha ? { id, path: process.cwd(), attachSession: async () => {}, archiveSession: async () => {} } : undefined,
    list: () => [{ id: alpha, path: process.cwd() }],
    archiveSession: async () => {},
  })
  ctx.provide('agents', { create: async () => { throw new Error('unused') }, resume: async () => { throw new Error('unused') } })
  ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'mock', model: 'mock' }) })
  ctx.provide('agentPresets', { mount: async () => { throw new Error('unused') } })
  ctx.provide('tools', { schemas: () => [] })
  ctx.provide('sessionPersistence', { list: async () => [] })
  await ctx.plugin(InvariantRegistry)
  await ctx.plugin(agentTeamInvariant)
  const fiber = await ctx.plugin(AgentTeam)
  cleanups.push(async () => { await fiber.dispose(); await facility.closeAll() })
  return { ctx, facility }
}

/** A cold ledger over the same table: sequential-replay validation must accept the update records. */
function replayLedger(facility: DomainFacility): AgentTeamLedger {
  return new AgentTeamLedger(facility.get('agent_team')!.table('operations') as unknown as KvTable<AgentTeamOperationId, AgentTeamOperation>)
}

async function seedMember(ctx: Context, channelRef: AgentTeamChannelRef, label: string) {
  return ctx.agentTeam.addMember({
    requestId: requestId(`${label}-add`), workspaceId: alpha,
    handle: label, description: `${label} member`, presetId: 'team-member',
    channelRefs: [channelRef],
  })
}

describe('Agent Team display-fact updates', () => {
  it('renames a Channel durably, resolves retries by request id, and replays cleanly', async () => {
    const { ctx, facility } = await harness()
    const created = await ctx.agentTeam.createChannel({ requestId: requestId('channel'), workspaceId: alpha, name: 'engineering', description: 'Engineering work' })

    // The rename keeps the Channel's immutable identity facts intact.
    const renamed = await ctx.agentTeam.updateChannel({ requestId: requestId('rename'), workspaceId: alpha, channelRef: created.channel.channelRef, name: 'platform', description: 'Infrastructure work' })
    expect(renamed.channel.name).toBe('platform')
    expect(renamed.channel.description).toBe('Infrastructure work')
    expect(renamed.channel.channelRef).toBe(created.channel.channelRef)
    expect(renamed.channel.createdAtSequence).toBe(created.channel.createdAtSequence)

    // Same request id with the same payload resolves without a second record;
    // reusing it with different content collides loudly instead.
    const retried = await ctx.agentTeam.updateChannel({ requestId: requestId('rename'), workspaceId: alpha, channelRef: created.channel.channelRef, name: 'platform', description: 'Infrastructure work' })
    expect(retried.channel.name).toBe('platform')
    await expect(ctx.agentTeam.updateChannel({ requestId: requestId('rename'), workspaceId: alpha, channelRef: created.channel.channelRef, name: 'other', description: 'Infrastructure work' })).rejects.toThrow(/was reused with a different operation or payload/)

    const view = await ctx.agentTeam.view({ workspaceId: alpha, topLevelOnly: true, limit: 10 })
    expect(view.channels.find(channel => channel.channelRef === created.channel.channelRef)?.name).toBe('platform')

    // A cold replay accepts the update record and reproduces the projection.
    const replayed = replayLedger(facility)
    expect(() => replayed.validate()).not.toThrow()
    const replayView = replayed.view({ workspaceId: alpha, topLevelOnly: true })
    expect(replayView.channels.find(channel => channel.channelRef === created.channel.channelRef)).toMatchObject({ name: 'platform', description: 'Infrastructure work' })

    // Blank display facts and unknown refs are rejected before any record lands.
    await expect(ctx.agentTeam.updateChannel({ requestId: requestId('blank-name'), workspaceId: alpha, channelRef: created.channel.channelRef, name: '   ', description: 'x' })).rejects.toThrow(/name must not be empty/)
    await expect(ctx.agentTeam.updateChannel({ requestId: requestId('blank-description'), workspaceId: alpha, channelRef: created.channel.channelRef, name: 'x', description: '  ' })).rejects.toThrow(/description must not be empty/)
    await expect(ctx.agentTeam.updateChannel({ requestId: requestId('unknown-ref'), workspaceId: alpha, channelRef: 'channel:missing' as AgentTeamChannelRef, name: 'x', description: 'y' })).rejects.toThrow(/unknown Channel ref/)
  })

  it('edits Member facts with handle uniqueness, model pinning, and replay validation', async () => {
    const { ctx, facility } = await harness()
    const created = await ctx.agentTeam.createChannel({ requestId: requestId('channel'), workspaceId: alpha, name: 'engineering', description: 'Engineering work' })
    const builder = await seedMember(ctx, created.channel.channelRef, 'builder')
    const reviewer = await seedMember(ctx, created.channel.channelRef, 'reviewer')

    // One durable edit renames the handle, updates the description, and pins
    // a per-Member model while identity and memory paths stay untouched.
    const edited = await ctx.agentTeam.updateMember({ requestId: requestId('edit-builder'), memberId: builder.status.member.memberId, handle: 'architect', description: 'System design owner', model: { provider: 'mock', model: 'pinned' } })
    expect(edited.status.member.handle).toBe('architect')
    expect(edited.status.member.model).toEqual({ provider: 'mock', model: 'pinned' })
    expect(edited.status.member.presetId).toBe(builder.status.member.presetId)
    expect(edited.status.member.sessionId).toBe(builder.status.member.sessionId)
    expect(edited.status.member.privateMemoryPath).toBe(builder.status.member.privateMemoryPath)

    // Handle uniqueness covers every other live Member, case-insensitively;
    // keeping one's own handle is not a collision.
    await expect(ctx.agentTeam.updateMember({ requestId: requestId('collide'), memberId: reviewer.status.member.memberId, handle: 'ARCHITECT', description: 'x' })).rejects.toThrow(/is already active in Workspace/)
    const kept = await ctx.agentTeam.updateMember({ requestId: requestId('keep-handle'), memberId: builder.status.member.memberId, handle: 'architect', description: 'Designs systems' })
    expect(kept.status.member.description).toBe('Designs systems')

    // An absent model clears any override back to Host-default inheritance.
    const cleared = await ctx.agentTeam.updateMember({ requestId: requestId('clear-model'), memberId: builder.status.member.memberId, handle: 'architect', description: 'Designs systems' })
    expect(cleared.status.member.model).toBeUndefined()

    // Retry semantics mirror every other op: same payload replays, drift collides.
    const retried = await ctx.agentTeam.updateMember({ requestId: requestId('clear-model'), memberId: builder.status.member.memberId, handle: 'architect', description: 'Designs systems' })
    expect(retried.status.member.model).toBeUndefined()
    await expect(ctx.agentTeam.updateMember({ requestId: requestId('clear-model'), memberId: builder.status.member.memberId, handle: 'architect', description: 'Changed after commit' })).rejects.toThrow(/was reused with a different operation or payload/)

    // A removed Member freezes against further edits, including its old handle.
    await ctx.agentTeam.removeMember({ requestId: requestId('remove-reviewer'), memberId: reviewer.status.member.memberId })
    await expect(ctx.agentTeam.updateMember({ requestId: requestId('edit-inactive'), memberId: reviewer.status.member.memberId, handle: 'reviewer2', description: 'x' })).rejects.toThrow(/is inactive and can no longer be edited/)

    const replayed = replayLedger(facility)
    expect(() => replayed.validate()).not.toThrow()
    const stored = replayed.listMembers().find(member => member.memberId === builder.status.member.memberId)
    expect(stored).toMatchObject({ handle: 'architect', description: 'Designs systems' })
    expect(stored?.model).toBeUndefined()
    expect(replayed.listMembers().find(member => member.memberId === reviewer.status.member.memberId)?.state).toBe('inactive')
  })
})
