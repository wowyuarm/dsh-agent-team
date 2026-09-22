import { useEffect, useRef, useState } from 'react'
import { IconUserOutlineRegular, Modal, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TeamSettingsProps } from './slots.ts'
import { TeamMemberRow } from './TeamMemberRow.tsx'
import membersCss from './members.module.css'
import css from './team.module.css'

type TeamMembersActionProps = Pick<TeamSettingsProps, 'wide' | 'loadMemberGroups' | 't'>

export function TeamMembersAction({ wide, loadMemberGroups, t }: TeamMembersActionProps) {
  const [panelOpen, setPanelOpen] = useState(false)
  const [groups, setGroups] = useState<Awaited<ReturnType<typeof loadMemberGroups>>>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!panelOpen) return
    queueMicrotask(() => { contentRef.current?.focus() })
  }, [panelOpen])

  const openMembers = () => {
    setPanelOpen(true)
    setLoading(true)
    setError(undefined)
    void loadMemberGroups().then(setGroups).catch(cause => {
      setError(cause instanceof Error ? cause.message : String(cause))
    }).finally(() => { setLoading(false) })
  }

  const closeMembers = () => {
    setPanelOpen(false)
    queueMicrotask(() => { triggerRef.current?.focus() })
  }

  return (
    <>
      <Tooltip label={t('members')} delayMs={500} disabled={wide}>
        <button ref={triggerRef} type="button" className={wide ? css.settingsAction : `${css.settingsAction} ${css.rail}`} aria-label={t('members')} aria-haspopup="dialog" onClick={openMembers}>
          <IconUserOutlineRegular size={wide ? 16 : 18} />
          {wide && <span>{t('members')}</span>}
        </button>
      </Tooltip>
      <Modal open={panelOpen} onClose={closeMembers} title={t('members')} closeLabel={t('close')} contentClassName={membersCss.body!}>
        <div ref={contentRef} className={membersCss.content} tabIndex={-1}>
          {loading && <p className={membersCss.state} role="status">{t('loadingAgents')}</p>}
          {!loading && groups.length === 0 && error === undefined && <p className={membersCss.state}>{t('emptyAgents')}</p>}
          {!loading && groups.map(group => (
            <section className={membersCss.group} key={group.workspaceId} aria-labelledby={`team-members-${group.workspaceId}`}>
              <h3 id={`team-members-${group.workspaceId}`}>{group.workspaceTitle}</h3>
              {group.members.map(status => <TeamMemberRow key={status.member.memberId} status={status} className={membersCss.member} t={t} />)}
            </section>
          ))}
          {error !== undefined && <p className={membersCss.error} role="alert">{error}</p>}
        </div>
      </Modal>
    </>
  )
}
