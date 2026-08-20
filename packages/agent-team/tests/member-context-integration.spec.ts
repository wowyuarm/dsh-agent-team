import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { agentEvents, type Agent, type PreStepDecision } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { apply } from '../src/member-context.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

function fakeAgent(ctx: Context): Agent {
  return {
    id: SessionId('session:memory-test'), ctx, status: 'idle', options: { provider: 'mock', model: 'mock' },
    session: { surface: { nodes: [] }, events: [] } as never,
    inbox: {} as never,
    cancel() {}, whenIdle: async () => {}, runMaintenance: async task => task(new AbortController().signal),
    send() {}, followup() {}, steer() {}, inject() {},
  } as Agent
}

async function preStep(ctx: Context, agent: Agent): Promise<PreStepDecision> {
  return agentEvents(ctx, agent).waterfall('agent/pre-step', {
    messages: [], turn: 1, step: 1, signal: new AbortController().signal,
  }, async () => ({ kind: 'enter', messages: [] }))
}

describe('Team Member private memory composition', () => {
  it('injects only the bound Member index and replaces changed or removed content', async () => {
    const root = await mkdtemp(join(tmpdir(), 'team-member-memory-'))
    roots.push(root)
    const own = join(root, 'memory.md')
    await writeFile(own, 'own index')
    const ctx = new Context()
    const agent = fakeAgent(ctx)
    ctx.provide('agentTeam', { memberForAgent: (subject: Agent) => subject === agent ? { privateMemoryPath: root } : undefined } as never)
    apply(ctx)

    const first = await preStep(ctx, agent)
    expect(first.kind === 'enter' && first.messages.at(-1)?.content[0]).toEqual(expect.objectContaining({ text: expect.stringContaining('own index') }))

    await writeFile(own, 'replacement index')
    const second = await preStep(ctx, agent)
    expect(second.kind === 'enter' && second.messages.at(-1)?.content[0]).toEqual(expect.objectContaining({ text: expect.stringContaining('replacement index') }))

    await rm(own)
    const removed = await preStep(ctx, agent)
    expect(removed.kind === 'enter' && removed.messages.at(-1)?.content[0]).toEqual(expect.objectContaining({ text: expect.stringContaining('index is empty') }))
    await ctx.fiber.dispose()
  })

  it('does nothing for an ordinary unbound Agent', async () => {
    const ctx = new Context()
    const agent = fakeAgent(ctx)
    ctx.provide('agentTeam', { memberForAgent: () => undefined } as never)
    apply(ctx)
    expect(await preStep(ctx, agent)).toEqual({ kind: 'enter', messages: [] })
    await ctx.fiber.dispose()
  })
})
