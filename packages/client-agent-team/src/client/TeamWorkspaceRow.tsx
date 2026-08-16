import type { WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
import type { TeamKey } from './locales.ts'
import css from './team.module.css'

export function TeamWorkspaceRow({ workspaceId, title, path, selected, onSelect, t }: {
  workspaceId: WorkspaceId
  title: string
  path: string
  selected: boolean
  onSelect: (workspaceId: WorkspaceId) => void
  t: (key: TeamKey) => string
}) {
  return (
    <button
      type="button"
      className={css.workspaceRow}
      data-selected={selected || undefined}
      aria-current={selected ? 'true' : undefined}
      onClick={() => { onSelect(workspaceId) }}
      title={`${title} · ${path}`}
    >
      <span className={css.workspaceGlyph} aria-hidden="true">{title.slice(0, 1).toUpperCase() || 'W'}</span>
      <span className={css.workspaceCopy}>
        <strong>{title}</strong>
        <small>{t('channels')} · {t('agents')}</small>
      </span>
    </button>
  )
}
