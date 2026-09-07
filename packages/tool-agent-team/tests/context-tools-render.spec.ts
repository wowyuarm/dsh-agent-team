import { describe, expect, it } from 'vitest'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { registerContextTools } from '../src/context-tools.ts'
import { AGENT_TEAM_TOOL_NAMES } from '@wowyuarm/dsh-agent-team/host'

/**
 * Render-layer discriminating tests: renders are the only channel a tool
 * result reaches the model through, so every field the model must act on
 * (the checkpoint ref, per-anchor verdicts) has to appear in the rendered
 * text — a schema field the render drops is model-invisible (this exact
 * regression made seeded returns unusable in live dogfooding).
 */
function contextTools(): Map<string, ToolDefinition> {
  const registered = new Map<string, ToolDefinition>()
  registerContextTools({ tools: { register: (tool: unknown) => {
    const definition = tool as ToolDefinition
    registered.set(definition.name, definition)
  } } })
  return registered
}

function renderText(tool: ToolDefinition, value: unknown): string {
  const blocks = tool.output.render({}, value as never)
  return blocks.map(block => block.type === 'text' ? block.text : '').join('\n')
}

const TIMELINE_VALUE = {
  usageTokens: 55577,
  hardLimit: 256000,
  handoffAt: 200000,
  items: [
    {
      checkpointRef: 'context-checkpoint-' + 'a'.repeat(64),
      name: 'live smoke before context rollover',
      source: 'agent',
      retainedTokens: 84971,
      discardedTokens: 0,
      affectedThreads: ['thread:bce6b8c6-f781-47e6-8e87-4e99c7f446d1'],
      restorable: true,
    },
    {
      checkpointRef: 'team-boundary-' + 'b'.repeat(64),
      name: 'team delivery',
      source: 'team-boundary',
      retainedTokens: 12000,
      discardedTokens: 8000,
      affectedThreads: ['thread:one', 'thread:two'],
      restorable: false,
      reason: 'multiple Threads entered the context through this boundary; write a fresh handoff instead',
      sourceSessionId: 'session-ancestor',
    },
    {
      checkpointRef: 'context-checkpoint-' + 'c'.repeat(64),
      name: 'current head',
      source: 'head',
      retainedTokens: 55577,
      discardedTokens: 0,
      affectedThreads: [],
      restorable: false,
      reason: 'the head is the current working set; returning to it discards nothing',
    },
  ],
} as const

describe('context tools render the model-facing decision surface', () => {
  it('context_checkpoint renders the full opaque ref the model must cite', () => {
    const tools = contextTools()
    expect(tools.has('context_checkpoint')).toBe(true)
    const text = renderText(tools.get('context_checkpoint')!, {
      checkpointRef: 'context-checkpoint-' + 'd'.repeat(64),
      name: 'post-rollover smoke anchor',
    })
    // The ref is the context_rollover selection surface: without it in the text
    // the model has no legitimate way to reference the anchor it recorded.
    expect(text).toContain('context-checkpoint-' + 'd'.repeat(64))
    expect(text).toContain('post-rollover smoke anchor')
  })

  it('context_timeline renders every item with name, source, token estimates, Threads, and verdict', () => {
    const tools = contextTools()
    expect(tools.has('context_timeline')).toBe(true)
    const text = renderText(tools.get('context_timeline')!, TIMELINE_VALUE)
    // Budget summary line stays.
    expect(text).toContain('55577')
    expect(text).toContain('200000')
    expect(text).toContain('256000')
    // Each item renders its label, source, and size estimates.
    for (const item of TIMELINE_VALUE.items) {
      expect(text).toContain(item.name)
      expect(text).toContain(`source: ${item.source}`)
      expect(text).toContain(`retained ~${item.retainedTokens}`)
      expect(text).toContain(`discarded ~${item.discardedTokens}`)
      if (item.affectedThreads.length === 0) {
        expect(text).toContain('no Threads')
      } else {
        for (const thread of item.affectedThreads) expect(text).toContain(thread)
      }
      if (item.restorable) {
        // A restorable anchor must carry its full ref for context_rollover.
        expect(text).toContain(item.checkpointRef)
        expect(text).toContain('restorable')
      } else {
        // A non-restorable anchor must state why, so the model writes a
        // fresh handoff instead of retrying the anchor.
        expect(text).toContain('not restorable')
        expect(text).toContain(item.reason)
      }
    }
  })

  it('context_timeline keeps the output bounded by the Host-supplied item list', () => {
    const tools = contextTools()
    // The Host bounds items (default 12, at most 24); the render mirrors
    // that list one line per item and nothing beyond it.
    const items = Array.from({ length: 24 }, (_, index) => ({
      checkpointRef: `context-checkpoint-${index.toString(16).padStart(64, '0')}`,
      name: `anchor-${index}`,
      source: 'agent',
      retainedTokens: index * 100,
      discardedTokens: 0,
      affectedThreads: [],
      restorable: true,
    }))
    const text = renderText(tools.get('context_timeline')!, { usageTokens: 1, hardLimit: 256000, handoffAt: 200000, items })
    for (const item of items) expect(text).toContain(item.checkpointRef)
    expect(text).toContain('anchor-23')
  })

  it('registers the rollover tool under its lifecycle name and not the legacy one', () => {
    const tools = contextTools()
    // Hard rename: the model-facing surface is `context_rollover` only. The
    // legacy `new_context` name must not survive as a second registration —
    // two synonyms would let stale sessions call a tool nobody documents.
    expect(tools.has('context_rollover')).toBe(true)
    expect(tools.has('new_context')).toBe(false)
    // The Host's capability roster agrees: preset validation would fail on
    // a roster/tool split.
    expect([...AGENT_TEAM_TOOL_NAMES]).toContain('context_rollover')
    expect([...AGENT_TEAM_TOOL_NAMES]).not.toContain('new_context')
    // The description states both modes of the same generation swap.
    const description = tools.get('context_rollover')!.description
    expect(description).toContain('context_rollover')
    expect(description.toLowerCase()).toContain('checkpointref')
  })

  it('context_rollover renders the scheduled swap and keeps render text self-describing', () => {
    const tools = contextTools()
    const text = renderText(tools.get('context_rollover')!, { mode: 'fresh', status: 'scheduled' })
    expect(text).toContain('rollover')
    expect(text).toContain('fresh')
    const seeded = renderText(tools.get('context_rollover')!, { mode: 'from-checkpoint', status: 'scheduled' })
    expect(seeded).toContain('from-checkpoint')
  })
})
