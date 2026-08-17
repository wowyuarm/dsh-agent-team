import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { IconAgentPresetOutline16, IconChevronLeftOutline14, IconUserOutline16, Modal, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TeamFooterProps } from './slots.ts'
import { TeamPresenceDot } from './TeamPresenceDot.tsx'
import membersCss from './members.module.css'
import css from './team.module.css'

export function TeamFooterAction({ wide, navigation, enterTeam, leaveTeam, loadMemberGroups, t }: TeamFooterProps) {
  const state = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot, navigation.getSnapshot)
  const inTeam = state.mode === 'team'
  const label = inTeam ? t('backToConversations') : t('team')
  const [panelOpen, setPanelOpen] = useState(false)
  const [groups, setGroups] = useState<Awaited<ReturnType<typeof loadMemberGroups>>>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!inTeam) setPanelOpen(false)
  }, [inTeam])

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
  const keyboardActivate = (event: React.KeyboardEvent<HTMLButtonElement>, action: () => void) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    action()
  }

  return (
    <>
      <div className={wide ? css.footerStack : `${css.footerStack} ${css.railStack}`}>
        {inTeam && (
          <Tooltip label={t('members')} delayMs={500} disabled={wide}>
            <button ref={triggerRef} type="button" className={wide ? css.footerAction : `${css.footerAction} ${css.rail}`} aria-label={t('members')} aria-haspopup="dialog" onClick={openMembers} onKeyDown={event => { keyboardActivate(event, openMembers) }}>
              <IconUserOutline16 size={wide ? 16 : 18} />
              {wide && <span>{t('members')}</span>}
            </button>
          </Tooltip>
        )}
        <Tooltip label={label} delayMs={500} disabled={wide}>
          <button
            type="button"
            className={wide ? css.footerAction : `${css.footerAction} ${css.rail}`}
            aria-label={label}
            data-team-action={inTeam ? 'leave' : 'enter'}
            onClick={inTeam ? leaveTeam : enterTeam}
            onKeyDown={event => { keyboardActivate(event, inTeam ? leaveTeam : enterTeam) }}
          >
            {inTeam ? <IconChevronLeftOutline14 size={wide ? 16 : 18} /> : <IconAgentPresetOutline16 size={wide ? 16 : 18} />}
            {wide && <span>{label}</span>}
          </button>
        </Tooltip>
      </div>
      <Modal open={panelOpen && inTeam} onClose={closeMembers} title={t('members')} closeLabel={t('close')} contentClassName={membersCss.body!}>
        <div ref={contentRef} className={membersCss.content} tabIndex={-1}>
          {loading && <p className={membersCss.state} role="status">{t('loadingAgents')}</p>}
          {!loading && groups.length === 0 && error === undefined && <p className={membersCss.state}>{t('emptyAgents')}</p>}
          {!loading && groups.map(group => (
            <section className={membersCss.group} key={group.workspaceId} aria-labelledby={`team-members-${group.workspaceId}`}>
              <h3 id={`team-members-${group.workspaceId}`}>{group.workspaceTitle}</h3>
              {group.members.map(status => (
                <div className={membersCss.member} key={status.member.memberId}>
                  <TeamPresenceDot status={status} t={t} />
                  <span className={membersCss.copy}><strong>@{status.member.handle}</strong><small>{status.member.description}</small></span>
                </div>
              ))}
            </section>
          ))}
          {error !== undefined && <p className={membersCss.error} role="alert">{error}</p>}
        </div>
      </Modal>
    </>
  )
}
