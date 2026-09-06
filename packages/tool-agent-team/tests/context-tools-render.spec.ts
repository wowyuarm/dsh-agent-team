import { describe, expect, it } from 'vitest'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { registerContextTools } from '../src/context-tools.ts'

/**
 * Render-layer discriminating tests: renders are the only channel a tool
 * result reaches the model through, so every field the model must act on
 * (the checkpoint ref, per-anchor verdicts) has to appear in the rendered
 * text — a schema field the render drops is model-invisible (this exact
 * regression made seeded new_context unusable in live dogfooding).
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
    // The ref is the new_context selection surface: without it in the text
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
        // A restorable anchor must carry its full ref for new_context.
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
})
