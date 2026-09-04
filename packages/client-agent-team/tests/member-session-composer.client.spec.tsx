// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TeamMemberDock, type TeamMemberDockProps } from '../src/client/TeamMemberDock.tsx'

afterEach(() => { cleanup() })

describe('Team Member session composer surfaces', () => {
  it('renders the vocabulary hint and surfaces the Member turn prompt error through the standard useSession hook', () => {
    const useSession = vi.fn((selector: (state: { promptError?: { error: { message: string } } | null }) => unknown) =>
      selector({ promptError: null }))
    const props = { t: (key: string) => key === 'memberSessionHint' ? '成员会话：/compact 压缩上下文' : key, useSession } as unknown as TeamMemberDockProps
    const view = render(<TeamMemberDock {...props} />)
    expect(view.getByText('成员会话：/compact 压缩上下文')).toBeTruthy()
    expect(view.queryByRole('alert')).toBeNull()

    const failing = { ...props, useSession: (selector: (state: { promptError?: { error: { message: string } } | null }) => unknown) =>
      selector({ promptError: { error: { message: 'network unavailable' } } }) } as unknown as TeamMemberDockProps
    view.rerender(<TeamMemberDock {...failing} />)
    expect(view.getByRole('alert').textContent).toContain('network unavailable')
  })
})
