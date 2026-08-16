import { useState, useSyncExternalStore } from 'react'
import { IconAgentPresetOutline16, IconChevronLeftOutline14, IconUserOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TeamFooterProps } from './slots.ts'
import { TeamPresenceDot } from './TeamPresenceDot.tsx'
import css from './team.module.css'

export function TeamFooterAction({ wide, navigation, enterTeam, leaveTeam, loadMemberGroups, t }: TeamFooterProps) {
  const state = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot, navigation.getSnapshot)
  const inTeam = state.mode === 'team'
  const label = inTeam ? t('backToConversations') : t('team')
  const [panelOpen, setPanelOpen] = useState(false)
  const [groups, setGroups] = useState<Awaited<ReturnType<typeof loadMemberGroups>>>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const openMembers = () => {
    setPanelOpen(true)
    setLoading(true)
    setError(undefined)
    void loadMemberGroups().then(setGroups).catch(cause => {
      setError(cause instanceof Error ? cause.message : String(cause))
    }).finally(() => { setLoading(false) })
  }
  return (
    <>
      {inTeam && (
        <Tooltip label={t('members')} delayMs={500} disabled={wide}>
          <button type="button" className={css.footerAction} aria-label={t('members')} onClick={openMembers}>
            <IconUserOutline16 size={wide ? 16 : 18} />
            {wide && <span>{t('members')}</span>}
          </button>
        </Tooltip>
      )}
      {panelOpen && (
        <section className={css.membersPanel} role="dialog" aria-modal="true" aria-label={t('members')}>
          <div className={css.membersHeader}>
            <strong>{t('members')}</strong>
            <button type="button" className={css.textButton} onClick={() => { setPanelOpen(false) }}>{t('close')}</button>
          </div>
          {loading && <p className={css.emptyWorkspace}>{t('loadingAgents')}</p>}
          {!loading && groups.length === 0 && error === undefined && <p className={css.emptyWorkspace}>{t('emptyAgents')}</p>}
          {groups.map(group => (
            <div className={css.memberGroup} key={group.workspaceId}>
              <h3>{group.workspaceTitle}</h3>
              {group.members.map(status => (
                <div className={css.agentRow} key={status.member.memberId}>
                  <TeamPresenceDot status={status} t={t} />
                  <span className={css.agentCopy}><strong>{status.member.handle}</strong><small>{status.member.description}</small></span>
                </div>
              ))}
            </div>
          ))}
          {error !== undefined && <p className={css.error} role="alert">{error}</p>}
        </section>
      )}
      <Tooltip label={label} delayMs={500} disabled={wide}>
        <button
          type="button"
          className={css.footerAction}
          aria-label={label}
          data-team-action={inTeam ? 'leave' : 'enter'}
          onClick={inTeam ? leaveTeam : enterTeam}
        >
          {inTeam ? <IconChevronLeftOutline14 size={wide ? 16 : 18} /> : <IconAgentPresetOutline16 size={wide ? 16 : 18} />}
          {wide && <span>{label}</span>}
        </button>
      </Tooltip>
    </>
  )
}
