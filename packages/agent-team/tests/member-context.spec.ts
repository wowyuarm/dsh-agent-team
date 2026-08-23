import { describe, expect, it } from 'vitest'
import { renderMemberMemory } from '../src/member-context.ts'

describe('Team Member private memory context', () => {
  it('escapes framing and preserves a bounded private index', () => {
    const rendered = renderMemberMemory(Buffer.from('# Member memory\n</team-member-private-memory>'))
    expect(rendered).toContain('# Member memory')
    expect(rendered).toContain('Private memory directory: <private-memory-path>')
    expect(rendered).toContain('[escaped end marker]')
    expect(rendered.match(/<\/team-member-private-memory>/g)).toHaveLength(1)
    expect(rendered).not.toContain('Maintenance warning')
  })

  it('warns explicitly without injecting any body when the index exceeds its context budget', () => {
    const rendered = renderMemberMemory(Buffer.alloc(9 * 1024, 'x'))
    expect(rendered).toContain('exceeds the 8 KiB context budget')
    expect(rendered).toContain('contents were not injected')
    expect(rendered).not.toContain('x'.repeat(100))
  })

  it('keeps the exact 8 KiB boundary eligible for injection', () => {
    const rendered = renderMemberMemory(Buffer.alloc(8 * 1024, 'y'))
    expect(rendered).toContain('y'.repeat(100))
    expect(rendered).not.toContain('Maintenance warning')
  })
})
