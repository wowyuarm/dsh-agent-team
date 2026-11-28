// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { TeamComposer } from '../src/client/TeamComposer.tsx'
import { TeamDraftStore } from '../src/client/drafts.ts'
import { zhTranslator } from './bench/client-fixtures.tsx'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('releases draft image URLs when a send clears the files or the composer closes', () => {
  const createObjectURL = vi.fn()
    .mockReturnValueOnce('blob:original-preview')
    .mockReturnValueOnce('blob:reopened-preview')
  const revokeObjectURL = vi.fn()
  vi.stubGlobal('URL', class extends URL {
    static override createObjectURL = createObjectURL
    static override revokeObjectURL = revokeObjectURL
  })
  const file = new File(['png'], 'shot.png', { type: 'image/png' })
  const props: Parameters<typeof TeamComposer>[0] = {
    members: [], drafts: new TeamDraftStore(), draftKey: 'project:project:one' as never,
    pending: false, onSubmit: vi.fn(), onFilesChange: vi.fn(), t: zhTranslator(),
  }
  const ui = render(<TeamComposer {...props} pendingFiles={[file]} />)
  expect(ui.container.querySelector('img')?.getAttribute('src')).toBe('blob:original-preview')

  ui.rerender(<TeamComposer {...props} pendingFiles={[]} />)
  expect(ui.container.querySelector('img')).toBeNull()
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:original-preview')

  ui.rerender(<TeamComposer {...props} pendingFiles={[file]} />)
  expect(ui.container.querySelector('img')?.getAttribute('src')).toBe('blob:reopened-preview')
  ui.unmount()
  expect(revokeObjectURL.mock.calls).toEqual([['blob:original-preview'], ['blob:reopened-preview']])
})
