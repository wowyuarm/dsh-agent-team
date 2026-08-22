import { describe, expect, it } from 'vitest'
import { chunkRunsWithDays, daySeparatorLabel } from '../src/client/team-separators.ts'

interface Row {
  readonly sender?: string | undefined
  readonly at?: string | undefined
}

const senderOf = (row: Row): string | undefined => row.sender
const occurredAtOf = (row: Row): string | undefined => row.at

describe('timeline day separators', () => {
  it('keeps one same-sender run within a single day', () => {
    const blocks = chunkRunsWithDays<Row>([
      { sender: 'a', at: '2026-08-21T09:00:00Z' },
      { sender: 'a', at: '2026-08-21T09:05:00Z' },
    ], senderOf, occurredAtOf)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({ kind: 'run', items: { length: 2 } })
  })

  it('breaks the run and injects one marker at a day change', () => {
    const blocks = chunkRunsWithDays<Row>([
      { sender: 'a', at: '2026-08-20T09:00:00Z' },
      { sender: 'a', at: '2026-08-21T04:00:00Z' },
      { sender: 'a', at: '2026-08-21T02:00:00Z' },
    ], senderOf, occurredAtOf)
    expect(blocks.map(block => block.kind)).toEqual(['run', 'day', 'run'])
    const marker = blocks[1]
    if (marker?.kind === 'day') expect(marker.label).toBe('08-21')
    const tail = blocks[2]
    if (tail?.kind === 'run') expect(tail.items).toHaveLength(2)
  })

  it('lets activities inherit the surrounding day without triggering markers', () => {
    const blocks = chunkRunsWithDays<Row>([
      { sender: 'a', at: '2026-08-21T09:00:00Z' },
      { sender: undefined },
      { sender: undefined },
      { sender: 'a', at: '2026-08-21T10:00:00Z' },
    ], senderOf, occurredAtOf)
    expect(blocks.filter(block => block.kind === 'day')).toHaveLength(0)
    expect(blocks).toHaveLength(4)
  })

  it('labels cross-year days with the full date', () => {
    expect(daySeparatorLabel('2027-01-02T00:30:00Z', new Date('2026-12-31T00:00:00Z'))).toBe('2027-01-02')
    expect(daySeparatorLabel('2026-08-21T00:30:00Z', new Date('2026-08-22T00:00:00Z'))).toBe('08-21')
  })

  it('starts a fresh run for a different sender on the same day', () => {
    const blocks = chunkRunsWithDays<Row>([
      { sender: 'a', at: '2026-08-21T09:00:00Z' },
      { sender: 'b', at: '2026-08-21T09:30:00Z' },
    ], senderOf, occurredAtOf)
    expect(blocks).toHaveLength(2)
    expect(blocks.every(block => block.kind === 'run')).toBe(true)
  })
})
