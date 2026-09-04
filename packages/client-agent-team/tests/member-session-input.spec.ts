import { describe, expect, it, vi } from 'vitest'
import { admitTeamCompact, createTeamMemberSessionSources, TEAM_COMMAND_SOURCE, TEAM_MEMBER_SOURCE } from '../src/client/member-session-input.ts'

const memberSession = 'session:builder' as never
const ordinarySession = 'session:ordinary' as never
const members = [
  { member: { memberId: 'member:builder', sessionId: memberSession, handle: 'builder', state: 'enabled' }, presence: 'available' },
  { member: { memberId: 'member:reviewer', sessionId: 'session:reviewer', handle: 'reviewer', state: 'enabled' }, presence: 'available' },
  { member: { memberId: 'member:retired', sessionId: 'session:retired', handle: 'retired', state: 'inactive' }, presence: 'unavailable' },
] as never

function sources() {
  const executeCompact = vi.fn(async () => ({ kind: 'success' as const }))
  return {
    executeCompact,
    sources: createTeamMemberSessionSources({
      isEmbeddedMemberSession: id => id === memberSession,
      members: async () => members,
      executeCompact,
    }),
  }
}

const request = (query: string) => ({ query, position: 'leading' as const, drilled: false, signal: new AbortController().signal })

describe('Team Member session trigger sources', () => {
  it('uses the public Session command admission, preserving matched handler errors', async () => {
    const command = vi.fn(async () => ({ ok: true, value: { matched: true } }))
    await expect(admitTeamCompact({ command } as never)).resolves.toEqual({ kind: 'success' })
    expect(command).toHaveBeenCalledWith('/compact')
    await expect(admitTeamCompact({ command: async () => ({ ok: true, value: { matched: false } }) } as never))
      .resolves.toEqual({ kind: 'error', text: 'unknown command: /compact' })
  })

  it('are inert for ordinary sessions and expose only compact for an embedded Member', async () => {
    const { sources: registered } = sources()
    const command = registered.find(source => source.name === TEAM_COMMAND_SOURCE)!
    const member = registered.find(source => source.name === TEAM_MEMBER_SOURCE)!
    expect(await command.candidates({ sessionId: ordinarySession }, request(''))).toEqual([])
    expect(await member.candidates({ sessionId: ordinarySession }, request(''))).toEqual([])
    expect(await command.candidates({ sessionId: memberSession }, request(''))).toEqual([
      expect.objectContaining({ name: '/compact' }),
    ])
    // matchEnter exists only on the command source; the member source never
    // adjudicates Enter.
    expect(member.matchEnter).toBeUndefined()
    expect(command.matchEnter).toBeDefined()
  })

  it('executes /compact through its source claim and refuses unknown leading slash submit', async () => {
    const { executeCompact, sources: registered } = sources()
    const command = registered.find(source => source.name === TEAM_COMMAND_SOURCE)!
    const candidate = (await command.candidates({ sessionId: memberSession }, request('')))[0]!
    const picked = command.onPick({ candidate, session: { sessionId: memberSession }, position: 'leading', via: 'menu', action: 'pick', span: { start: 0, end: 8, draftRev: 3 } })
    expect(picked).toMatchObject({ claim: { token: '/compact' } })
    if (picked === undefined || picked === 'handled' || !('claim' in picked)) throw new Error('compact pick did not produce a claim')
    await picked.claim.submit('', {} as never, [])
    expect(executeCompact).toHaveBeenCalledWith(memberSession)
  })

  it('claims a typed /compact line inside a Member Session and declines everything else', async () => {
    const { executeCompact, sources: registered } = sources()
    const command = registered.find(source => source.name === TEAM_COMMAND_SOURCE)!
    const signal = new AbortController().signal
    const envelope = { images: 0 } as never
    const outcome = await command.matchEnter!({ sessionId: memberSession }, '/compact', signal, envelope)
    expect(outcome).toMatchObject({ claim: { token: '/compact' } })
    if (outcome === undefined || outcome === 'handled' || !('claim' in outcome)) throw new Error('typed /compact did not produce a claim')
    await outcome.claim.submit('', {} as never, [])
    expect(executeCompact).toHaveBeenCalledWith(memberSession)
    // Unknown slash lines and ordinary sessions stay with the shipped vocabulary.
    await expect(command.matchEnter!({ sessionId: memberSession }, '/skill', signal, envelope)).resolves.toBeUndefined()
    await expect(command.matchEnter!({ sessionId: memberSession }, 'plain message', signal, envelope)).resolves.toBeUndefined()
    await expect(command.matchEnter!({ sessionId: ordinarySession }, '/compact', signal, envelope)).resolves.toBeUndefined()
  })

  it('offers only other active workspace Members and serializes a stable structured ref', async () => {
    const { sources: registered } = sources()
    const member = registered.find(source => source.name === TEAM_MEMBER_SOURCE)!
    const candidates = await member.candidates({ sessionId: memberSession }, { ...request('rev'), position: 'inline' })
    expect(candidates).toEqual([expect.objectContaining({ name: '@reviewer', description: '引用成员 · 不会通知', value: 'member:reviewer' })])
    const picked = member.onPick({ candidate: candidates[0]!, session: { sessionId: memberSession }, position: 'inline', via: 'menu', action: 'pick', span: { start: 3, end: 7, draftRev: 4 } })
    expect(picked).toEqual({ insert: expect.objectContaining({ source: TEAM_MEMBER_SOURCE, ref: 'member:reviewer', label: 'reviewer', clipboardText: '@reviewer' }) })
    await expect(member.codec!.serialize('member:reviewer', new AbortController().signal)).resolves.toBe('<team-member ref="member:reviewer">@reviewer</team-member>')
    // If the cache is cold, stable identity remains; it never guesses a handle.
    await expect(member.codec!.serialize('member:missing', new AbortController().signal)).resolves.toBe('<team-member ref="member:missing"></team-member>')
  })
})
