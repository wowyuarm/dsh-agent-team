import type { WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
import css from './sidebar.module.css'

export function TeamWorkspaceRow({ workspaceId, title, path, selected, onSelect }: {
  workspaceId: WorkspaceId
  title: string
  path: string
  selected: boolean
  onSelect: (workspaceId: WorkspaceId) => void
}) {
  return (
    <button
      type="button"
      className={css.workspaceRow}
      data-selected={selected || undefined}
      aria-current={selected ? 'page' : undefined}
      onClick={() => { onSelect(workspaceId) }}
      title={`${title} · ${path}`}
    >
      <span className={css.workspaceGlyph} aria-hidden="true">{title.slice(0, 1).toUpperCase() || 'W'}</span>
      <span className={css.workspaceCopy}><strong>{title}</strong></span>
    </button>
  )
}
