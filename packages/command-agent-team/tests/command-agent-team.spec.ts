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
})
