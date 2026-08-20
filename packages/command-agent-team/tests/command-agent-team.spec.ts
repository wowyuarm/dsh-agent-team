import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type AgentTeam from '@deepseek-ai/dsh-agent-team'
import { USAGE } from '../src/index.ts'
import * as commandAgentTeam from '../src/index.ts'

const agent = { ctx: new Context() } as Agent

describe('@deepseek-ai/dsh-command-agent-team', () => {
  it('registers a disposable /team status command without a default export', async () => {
    const ctx = new Context()
    await ctx.plugin(CommandRuntime)
    ctx.provide('agentTeam', {
      status: () => ({
        initialized: true,
        sequence: 1,
        operationCount: 1,
        channelCount: 0,
        agentMemberCount: 0,
        humanMemberId: 'member:human',
      }),
    } as AgentTeam)
    const fiber = await ctx.plugin(commandAgentTeam)

    expect(commandAgentTeam.name).toBe('command-agent-team')
    expect(commandAgentTeam.inject).toEqual(['agentTeam', 'commands'])
    expect('default' in commandAgentTeam).toBe(false)
    const definition = ctx.commands.find(agent, 'team')
    expect(definition).toBeDefined()
    expect(await definition!.handler({ rawInput: ' status ' } as never)).toEqual({
      kind: 'success',
      text: [
        'Agent Team',
        'Status: ready',
        'Ledger sequence: 1',
        'Operations: 1',
        'Channels: 0',
        'Agent members: 0',
      ].join('\n'),
    })
    expect(await definition!.handler({ rawInput: 'unknown' } as never)).toEqual({
      kind: 'error',
      text: USAGE,
    })

    await fiber.dispose()
    expect(ctx.commands.find(agent, 'team')).toBeUndefined()
  })

  it('routes Channel membership and structured mentions without parsing body handles', async () => {
    const ctx = new Context()
    await ctx.plugin(CommandRuntime)
    const calls: unknown[] = []
    ctx.provide('agentTeam', {
      joinChannel: async (request: unknown) => {
        calls.push(['join', request])
        return { memberId: 'member:builder', channelRef: 'channel:work', receipt: { sequence: 1 } }
      },
      sendMessage: async (request: unknown) => {
        calls.push(['send', request])
        return {
          message: { messageRef: 'message:one' },
          task: { taskRef: 'task:one' },
          thread: { threadRef: 'thread:one', revision: 2 },
        }
      },
    } as unknown as AgentTeam)
    await ctx.plugin(commandAgentTeam)
    const definition = ctx.commands.find(agent, 'team')!

    await definition.handler({
      rawInput: 'channel join workspace:alpha channel:work member:builder', commandId: 'command:join',
    } as never)
    await definition.handler({
      rawInput: 'send workspace:alpha channel:work --mention member:builder,member:reviewer -- inspect @nobody',
      commandId: 'command:mention',
    } as never)
    expect(calls).toEqual([
      ['join', expect.objectContaining({
        workspaceId: 'workspace:alpha', channelRef: 'channel:work', memberId: 'member:builder',
      })],
      ['send', expect.objectContaining({
        body: 'inspect @nobody', recipients: ['member:builder', 'member:reviewer'],
      })],
    ])
  })

  it('routes Human Member lifecycle commands through the Agent Team service', async () => {
    const ctx = new Context()
    await ctx.plugin(CommandRuntime)
    const calls: unknown[] = []
    const member = {
      memberId: 'member:builder',
      sessionId: 'session:builder',
      workspaceId: 'workspace:alpha',
      handle: 'builder',
      description: 'Builds features',
      presetId: 'team-member',
      privateMemoryPath: '/tmp/member-builder',
      state: 'enabled',
    } as const
    ctx.provide('agentTeam', {
      addMember: async (request: unknown) => {
        calls.push(['add', request])
        return { receipt: { sequence: 2 }, status: { member, availability: 'active' } }
      },
      suspendMember: async (request: unknown) => {
        calls.push(['suspend', request])
        return { receipt: { sequence: 3 }, status: { member: { ...member, state: 'suspended' }, availability: 'suspended' } }
      },
      resumeMember: async (request: unknown) => {
        calls.push(['resume', request])
        return { receipt: { sequence: 4 }, status: { member, availability: 'active' } }
      },
    } as unknown as AgentTeam)
    await ctx.plugin(commandAgentTeam)
    const definition = ctx.commands.find(agent, 'team')!

    await expect(definition.handler({
      rawInput: 'member add workspace:alpha channel:work builder team-member Builds features',
      commandId: 'command:add',
    } as never)).resolves.toMatchObject({ kind: 'success', text: 'Agent Member member:builder is active' })
    await definition.handler({ rawInput: 'member suspend member:builder', commandId: 'command:suspend' } as never)
    await definition.handler({ rawInput: 'member resume member:builder', commandId: 'command:resume' } as never)
    expect(calls).toEqual([
      ['add', expect.objectContaining({ channelRefs: ['channel:work'], handle: 'builder', presetId: 'team-member', description: 'Builds features' })],
      ['suspend', expect.objectContaining({ memberId: 'member:builder' })],
      ['resume', expect.objectContaining({ memberId: 'member:builder' })],
    ])
  })
})
