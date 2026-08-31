// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TeamMemberSessionComposer, type TeamMemberSessionComposerProps } from '../src/client/TeamMemberSessionComposer.tsx'

function renderComposer(state: { draft: string; draftRev: number; phase: 'plain' | 'adjudicating' | 'claimed' | 'submitting'; claim?: { token: string } }, session: { running: boolean; promptError?: { error: { message: string } } | null } = { running: false }) {
  const setDraft = vi.fn()
  const submit = vi.fn()
  const submitInput = vi.fn()
  const stop = vi.fn()
  const controller = { dismiss: vi.fn(), toggleSource: vi.fn(), arbitrate: vi.fn(() => 'pass') }
  const props = { controller, useInput: (selector: (input: never) => unknown) => selector(state as never), useSession: (selector: (current: never) => unknown) => selector(session as never), inputActions: { setDraft, submit }, stop, submitInput } as unknown as TeamMemberSessionComposerProps
  const view = render(<TeamMemberSessionComposer {...props} />)
  return { ...view, controller, setDraft, stop, submit, submitInput }
}

afterEach(() => { cleanup() })

describe('Team Member session composer', () => {
  it('keeps unknown leading slash draft intact but submits ordinary Enter and allows Shift+Enter', () => {
    const unknown = renderComposer({ draft: '/skill', draftRev: 1, phase: 'plain' })
    const input = unknown.getByRole('textbox')
    expect(unknown.queryByText('/compact · @成员')).toBeNull()
    expect(unknown.container.querySelector('[data-composer-card="true"]')).not.toBeNull()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(unknown.submit).not.toHaveBeenCalled()
    expect(unknown.getByRole('alert').textContent).toContain('仅支持 /compact')

    const ordinary = { controller: unknown.controller, useInput: (selector: (input: never) => unknown) => selector({ draft: 'hello', draftRev: 2, phase: 'plain' } as never), useSession: (selector: (current: never) => unknown) => selector({ running: false } as never), inputActions: { setDraft: unknown.setDraft, submit: unknown.submit }, stop: unknown.stop, submitInput: unknown.submitInput } as unknown as TeamMemberSessionComposerProps
    unknown.rerender(<TeamMemberSessionComposer {...ordinary} />)
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    expect(unknown.submit).not.toHaveBeenCalled()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(unknown.submitInput).toHaveBeenCalledWith('queue')
  })

  it('submits running Member input as steer rather than queue', () => {
    const running = renderComposer({ draft: 'continue now', draftRev: 3, phase: 'plain' }, { running: true })
    fireEvent.keyDown(running.getByRole('textbox'), { key: 'Enter' })
    expect(running.submitInput).toHaveBeenCalledWith('steer')
  })

  it('refreshes menus on consecutive DOM edits but not a pick-driven draft update', async () => {
    const controller = { dismiss: vi.fn(), toggleSource: vi.fn(), arbitrate: vi.fn(() => 'pass') }
    function Harness() {
      const [draft, setDraft] = useState('')
      const [draftRev, setDraftRev] = useState(0)
      const props = {
        controller,
        useInput: (selector: (input: never) => unknown) => selector({ draft, draftRev, phase: 'plain' } as never),
        useSession: (selector: (current: never) => unknown) => selector({ running: false } as never),
        inputActions: { setDraft: (next: string) => { setDraft(next); setDraftRev(current => current + 1) }, submit: vi.fn() },
      } as unknown as TeamMemberSessionComposerProps
      return <TeamMemberSessionComposer {...props} />
    }
    const tested = render(<Harness />)
    const input = tested.getByRole('textbox')
    fireEvent.change(input, { target: { value: '/' } })
    await waitFor(() => expect(controller.toggleSource).toHaveBeenCalledTimes(1))
    fireEvent.change(input, { target: { value: '/co' } })
    await waitFor(() => expect(controller.toggleSource).toHaveBeenCalledTimes(2))
    expect(controller.dismiss).toHaveBeenCalledTimes(2)
    fireEvent.change(input, { target: { value: '@rev' } })
    await waitFor(() => expect(controller.toggleSource).toHaveBeenCalledTimes(3))
    // Simulated controller pick changes the draft through the input machine,
    // without a DOM change event; it must not re-open the @ menu.
    tested.rerender(<TeamMemberSessionComposer {...({
      controller,
      useInput: (selector: (state: never) => unknown) => selector({ draft: '@reviewer ', draftRev: 9, phase: 'plain' } as never),
      useSession: (selector: (current: never) => unknown) => selector({ running: false } as never),
      inputActions: { setDraft: vi.fn(), submit: vi.fn() },
    } as unknown as TeamMemberSessionComposerProps)} />)
    await Promise.resolve()
    expect(controller.toggleSource).toHaveBeenCalledTimes(3)
  })

  it('clears the retry notice once a compact retry succeeds and the phase settles to plain', () => {
    const controller = { dismiss: vi.fn(), toggleSource: vi.fn(), arbitrate: vi.fn(() => 'pass') }
    const props = (phase: 'plain' | 'claimed' | 'submitting') => ({
      controller,
      useInput: (selector: (state: never) => unknown) => selector({ draft: phase === 'plain' ? '' : '/compact', draftRev: 1, phase, claim: phase === 'plain' ? undefined : { token: '/compact' } } as never),
      useSession: (selector: (current: never) => unknown) => selector({ running: false } as never),
      inputActions: { setDraft: vi.fn(), submit: vi.fn() },
    } as unknown as TeamMemberSessionComposerProps)
    const tested = render(<TeamMemberSessionComposer {...props('submitting')} />)
    // First flight fails: submitting → claimed keeps the draft and shows the
    // retry notice.
    tested.rerender(<TeamMemberSessionComposer {...props('claimed')} />)
    expect(tested.getByRole('alert').textContent).toContain('Compact 未执行')
    // The retry succeeds: submitting → plain is the InputMachine's clear-on-
    // success settlement; a stale failure notice must not outlive it.
    tested.rerender(<TeamMemberSessionComposer {...props('submitting')} />)
    tested.rerender(<TeamMemberSessionComposer {...props('plain')} />)
    expect(tested.queryByRole('alert')).toBeNull()
    expect((tested.getByRole('textbox') as HTMLTextAreaElement).value).toBe('')
  })

  it('shows a retry alert after a compact claim returns from submitting to claimed', () => {
    const controller = { dismiss: vi.fn(), toggleSource: vi.fn(), arbitrate: vi.fn(() => 'pass') }
    const props = (phase: 'claimed' | 'submitting') => ({
      controller,
      useInput: (selector: (state: never) => unknown) => selector({ draft: '/compact', draftRev: 1, phase, claim: { token: '/compact' } } as never),
      useSession: (selector: (current: never) => unknown) => selector({ running: false } as never),
      inputActions: { setDraft: vi.fn(), submit: vi.fn() },
    } as unknown as TeamMemberSessionComposerProps)
    const tested = render(<TeamMemberSessionComposer {...props('submitting')} />)
    tested.rerender(<TeamMemberSessionComposer {...props('claimed')} />)
    expect(tested.getByRole('alert').textContent).toContain('Compact 未执行')
  })

  it('renders prompt failures while retaining the draft', () => {
    const tested = renderComposer({ draft: 'keep this', draftRev: 1, phase: 'plain' }, { running: false, promptError: { error: { message: 'network unavailable' } } })
    expect(tested.getByRole('alert').textContent).toContain('network unavailable')
    expect((tested.getByRole('textbox') as HTMLTextAreaElement).value).toBe('keep this')
  })

  it('keeps Shift+Enter as a newline and blocks repeated or legacy-IME Enter', () => {
    const tested = renderComposer({ draft: '@rev', draftRev: 3, phase: 'plain' })
    const input = tested.getByRole('textbox')
    tested.controller.arbitrate.mockReturnValue('consumed')
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    fireEvent.keyDown(input, { key: 'Enter', repeat: true })
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })
    expect(tested.controller.arbitrate).not.toHaveBeenCalled()
    expect(tested.submit).not.toHaveBeenCalled()
  })

  it('accepts the highlighted candidate with Tab and keeps Shift+Tab native', () => {
    const highlight = { source: 'team-member', index: 1 }
    const controller = {
      dismiss: vi.fn(),
      toggleSource: vi.fn(),
      arbitrate: vi.fn(() => 'pass'),
      menu: { getSnapshot: vi.fn(() => ({ highlight })) },
      pick: vi.fn(),
    }
    const tested = render(<TeamMemberSessionComposer {...({
      controller,
      useInput: (selector: (state: never) => unknown) => selector({ draft: '@rev', draftRev: 3, phase: 'plain' } as never),
      useSession: (selector: (current: never) => unknown) => selector({ running: false } as never),
      inputActions: { setDraft: vi.fn(), submit: vi.fn() },
    } as unknown as TeamMemberSessionComposerProps)} />)
    const input = tested.getByRole('textbox')
    fireEvent.keyDown(input, { key: 'Tab' })
    expect(controller.pick).toHaveBeenCalledWith(highlight.source, highlight.index)
    expect(controller.arbitrate).not.toHaveBeenCalled()
    // Shift+Tab is a native focus move, never a pick.
    fireEvent.keyDown(input, { key: 'Tab', shiftKey: true })
    expect(controller.pick).toHaveBeenCalledTimes(1)
  })

  it('leaves plain Tab to the browser when no candidate is highlighted', () => {
    const controller = {
      dismiss: vi.fn(),
      toggleSource: vi.fn(),
      arbitrate: vi.fn(() => 'pass'),
      menu: { getSnapshot: vi.fn(() => ({ highlight: null })) },
      pick: vi.fn(),
    }
    const tested = render(<TeamMemberSessionComposer {...({
      controller,
      useInput: (selector: (state: never) => unknown) => selector({ draft: 'plain text', draftRev: 1, phase: 'plain' } as never),
      useSession: (selector: (current: never) => unknown) => selector({ running: false } as never),
      inputActions: { setDraft: vi.fn(), submit: vi.fn() },
    } as unknown as TeamMemberSessionComposerProps)} />)
    fireEvent.keyDown(tested.getByRole('textbox'), { key: 'Tab' })
    expect(controller.pick).not.toHaveBeenCalled()
    expect(controller.arbitrate).not.toHaveBeenCalled()
  })

  it('passes keyboard menu handling unless IME is composing, then stops a running turn', () => {
    const tested = renderComposer({ draft: '@rev', draftRev: 3, phase: 'plain' }, { running: true })
    const input = tested.getByRole('textbox')
    tested.controller.arbitrate.mockReturnValue('consumed')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(tested.controller.arbitrate).toHaveBeenCalledWith('down', false)
    fireEvent.compositionStart(input)
    fireEvent.keyDown(input, { key: 'ArrowDown', isComposing: true })
    expect(tested.controller.arbitrate).toHaveBeenCalledTimes(1)
    const stopButton = tested.getByRole('button', { name: '停止生成' })
    expect(stopButton.querySelector('svg path')?.getAttribute('d')).toContain('M2 4.88')
    fireEvent.click(stopButton)
    expect(tested.stop).toHaveBeenCalledOnce()
  })
})
