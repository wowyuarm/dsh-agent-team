import { useEffect, useState, useSyncExternalStore } from 'react'
import { IconAgentPresetOutline16, IconPlusOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DirectoryFlowOwnerProps } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
import type { TeamSidebarProps } from './slots.ts'
import { TeamWorkspaceRow } from './TeamWorkspaceRow.tsx'
import css from './team.module.css'

export function TeamWorkspaceBrowser({ wide, navigation, selectWorkspace, createWorkspaceFromPath, renderSlot, t, useWorkspaces }: TeamSidebarProps) {
  const navigationState = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot, navigation.getSnapshot)
  const workspaces = useWorkspaces(state => state.items)
  const selected = navigationState.workspaceId
  const selectedExists = selected !== undefined && workspaces.some(workspace => workspace.workspaceId === selected)
  const selectedId = selectedExists ? selected : workspaces[0]?.workspaceId

  useEffect(() => {
    if (navigationState.mode === 'team' && selectedId !== selected) {
      if (selectedId === undefined) return
      selectWorkspace(selectedId)
    }
  }, [navigationState.mode, selected, selectedId, selectWorkspace])

  const [flowOpen, setFlowOpen] = useState(false)
  const [flowBusy, setFlowBusy] = useState(false)
  const [flowError, setFlowError] = useState(false)
  const directoryFlow = (owner: DirectoryFlowOwnerProps) => renderSlot('sidebar.workspaces.directoryFlow', owner)
  const flowOwner: DirectoryFlowOwnerProps = {
    open: flowOpen,
    busy: flowBusy,
    onPicked: path => {
      setFlowBusy(true)
      setFlowError(false)
      void createWorkspaceFromPath(path).then(workspace => {
        selectWorkspace(workspace.workspaceId)
        setFlowOpen(false)
      }).catch(() => { setFlowError(true) }).finally(() => { setFlowBusy(false) })
    },
    onCancel: () => { setFlowOpen(false) },
    onError: () => { setFlowOpen(false); setFlowError(true) },
  }

  if (!wide) {
    return (
      <div className={css.railWorkspace} aria-label={t('workspaces')}>
        <span className={css.railMark}><IconAgentPresetOutline16 size={16} /></span>
      </div>
    )
  }

  return (
    <section className={css.workspaceBrowser} aria-label={t('workspaces')}>
      <div className={css.workspaceHeader}>
        <span>{t('workspaces')}</span>
        <button type="button" className={css.iconButton} onClick={() => { setFlowOpen(true) }} aria-label={t('addWorkspace')} title={t('addWorkspace')}>
          <IconPlusOutline16 size={15} />
        </button>
      </div>
      <div className={css.workspaceList}>
        {workspaces.map(workspace => (
          <TeamWorkspaceRow
            key={workspace.workspaceId}
            workspaceId={workspace.workspaceId}
            title={workspace.title}
            path={workspace.path}
            selected={workspace.workspaceId === selectedId}
            onSelect={selectWorkspace}
            t={t}
          />
        ))}
        {workspaces.length === 0 && <p className={css.emptyWorkspace}>{t('empty')}</p>}
      </div>
      {directoryFlow(flowOwner)}
      {flowError && <p className={css.error} role="alert">{t('workspaceCreateFailed')}</p>}
    </section>
  )
}

export type TeamWorkspaceBrowserProps = TeamSidebarProps
export type TeamWorkspaceId = WorkspaceId
