import { IconFolderClose16, IconFolderOpen16 } from '@deepseek-ai/dsh-client-ui-primitives'
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
      <span className={css.workspaceIcon} aria-hidden="true">
        {selected ? <IconFolderOpen16 size={16} /> : <IconFolderClose16 size={16} />}
      </span>
      <span className={css.workspaceCopy}><strong>{title}</strong></span>
    </button>
  )
}
