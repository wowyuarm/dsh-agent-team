import { describe, expect, it } from 'vitest'
import { contextTools, renderText } from './render-text.ts'
import { AGENT_TEAM_TOOL_NAMES } from '@wowyuarm/dsh-agent-team/host'

/**
 * Render-layer discriminating tests: renders are the only channel a tool
 * result reaches the model through, so every field the model must act on
 * (the checkpoint ref, per-anchor verdicts) has to appear in the rendered
 * text — a schema field the render drops is model-invisible (this exact
 * regression made seeded returns unusable in live dogfooding).
 */

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
    const text = renderText(tools.get('context_checkpoint')!, {}, {
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
    const text = renderText(tools.get('context_timeline')!, {}, TIMELINE_VALUE)
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

  it('context_timeline gives every row a short anchor id that is not a ref, so same-label rows stay distinct', () => {
    const tools = contextTools()
    // Two boundaries that share a label and a price — exactly what two
    // deliveries resolved in the same turn produce — must still be
    // distinguishable in the render, and a row that is not restorable must
    // never print a ref the model could try to cite.
    const anchor = {
      checkpointRef: 'team-boundary-' + '1'.repeat(64),
      name: 'Team message',
      source: 'team-boundary',
      retainedTokens: 4242,
      discardedTokens: 0,
      affectedThreads: ['thread:one'],
      restorable: false,
      reason: 'retained context would not materially shrink the working set',
    }
    const other = { ...anchor, checkpointRef: 'team-boundary-' + '2'.repeat(64) }
    const text = renderText(tools.get('context_timeline')!, {}, { usageTokens: 10, hardLimit: 256000, handoffAt: 200000, items: [anchor, other] })
    const rows = text.split('\n').filter(line => line.startsWith('- Team message'))
    expect(rows).toHaveLength(2)
    const ids = rows.map(row => /anchor ([0-9a-f]{6})\]/.exec(row)?.[1])
    expect(ids[0]).toBeDefined()
    expect(ids[1]).toBeDefined()
    expect(ids[0]).not.toBe(ids[1])
    for (const row of rows) {
      expect(row).toContain('not restorable')
      expect(row).not.toContain('team-boundary-')
    }
    // The id is a digest of the row's own ref: same input, same id, so a
    // repeated read of one anchor stays recognizable.
    const again = renderText(tools.get('context_timeline')!, {}, { usageTokens: 10, hardLimit: 256000, handoffAt: 200000, items: [anchor, other] })
    expect(again).toBe(text)
    // The description states Team's actual selection rule and what the id is
    // (and is not): the rule is the retained prefix, not the boundary's own
    // attribution, and the id is not citable.
    const description = tools.get('context_timeline')!.description
    expect(description).toContain('retained prefix through it stays inside one Thread')
    expect(description).toContain('NOT a ref')
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
    const text = renderText(tools.get('context_timeline')!, {}, { usageTokens: 1, hardLimit: 256000, handoffAt: 200000, items })
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

  it('rollover guidance names what a fresh generation already carries, and asks for the unverified delta', () => {
    const tools = contextTools()
    const description = tools.get('context_rollover')!.description
    // The engine's own sentence "seeded only by your handoff" is true of the
    // conversation history and false of the prompt context: identity, the
    // memory index, the skills catalog and the ledger arrive on their own. Team
    // supplies that counterweight as the engine's `carriedContext`, so the
    // description cannot be read as "restate everything" — our corpus showed
    // exactly that reading (44% restated standing state).
    expect(description).toContain('the same Team Member')
    expect(description).toContain('your @handle and role')
    expect(description).toContain('Team ledger')
    expect(description).toContain('Do not restate any of it')
    // The delta framing is the engine's; the checklist is Team's, and it keeps
    // the one item our own measurement found missing — only 10.5% of handoffs
    // said which facts were unverified, against 70% that named side effects.
    expect(description).toContain('could not reconstruct on its own')
    expect(description).toContain('which items you verified and which you only trusted')
    // The Team keeps its own timeline prose: the engine's render has no switch
    // for "never print a ref-shaped string on a non-restorable row".
    expect(tools.get('context_timeline')!.description).toContain('Every row carries a short `anchor` id')
  })

  it('hardens the checkpointRef copy against fabricated refs (the seq-7709 misuse)', () => {
    const tools = contextTools()
    const rollover = tools.get('context_rollover')!
    // The tool description and the parameter description both instruct the
    // model to omit checkpointRef for ordinary rollovers and to cite only
    // an exact ref a context_timeline result listed as restorable — never
    // a synthesized one. Dogfood showed "optional" alone does not stop a
    // model from inventing `team-boundary-...` refs.
    expect(rollover.description).toContain('never synthesize, guess, or reconstruct one')
    // defineTool compiles parameter specs to JSON Schema: descriptions live
    // under properties.<name>.description.
    const parameter = (rollover.parameters as { properties?: Record<string, { description?: string }> }).properties?.checkpointRef
    expect(parameter?.description).toContain('never synthesize or guess a ref')
    expect(parameter?.description).toContain('Omit for the default fresh rollover')
    // The timeline description keeps fresh rollovers on the direct path:
    // consulting the timeline is for checkpointRef returns, not a
    // prerequisite for the default fresh handoff.
    const timeline = tools.get('context_timeline')!.description
    expect(timeline).toContain('never requires consulting this timeline first')
  })

  it('timeline description states the effect-anchor boundary vocabulary (91c2299 labels)', () => {
    const tools = contextTools()
    const timeline = tools.get('context_timeline')!.description
    // The description is the model's map from timeline item labels to their
    // meaning when picking a checkpointRef. It must enumerate the labels the
    // fold actually renders — the three effect classes and first arrival —
    // and must not promise the retired push-side vocabulary (the live
    // seq-8666 mis-selection showed an unmapped label invites wrong picks).
    expect(timeline).toContain('Team message')
    expect(timeline).toContain('Team task claim change')
    expect(timeline).toContain('Team attention change')
    expect(timeline).toContain('First arrival')
    expect(timeline).toContain('first delivered notice')
    expect(timeline).not.toContain('claim changes and structured Team notifications')
    // The selectable-anchor sentence names the current boundary concept.
    expect(timeline).toContain('A Team boundary is a selectable default checkpoint')
    // The retired "delivery anchor" noun must not survive either: the
    // pre-59ae952 wording lives on in shipped sessions' prompts, so a
    // half-reverted description would still read as plausible prose.
    expect(timeline).not.toContain('delivery anchor')
  })

  it('context_rollover renders the scheduled swap and keeps render text self-describing', () => {
    const tools = contextTools()
    const text = renderText(tools.get('context_rollover')!, {}, { mode: 'fresh', status: 'scheduled' })
    expect(text).toContain('rollover')
    expect(text).toContain('fresh')
    const seeded = renderText(tools.get('context_rollover')!, {}, { mode: 'from-checkpoint', status: 'scheduled' })
    expect(seeded).toContain('from-checkpoint')
  })
})
