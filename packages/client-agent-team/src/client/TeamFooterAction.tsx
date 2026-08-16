import { useSyncExternalStore } from 'react'
import { IconAgentPresetOutline16, IconChevronLeftOutline14, IconUserOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TeamFooterProps } from './slots.ts'
import css from './team.module.css'

export function TeamFooterAction({ wide, navigation, enterTeam, leaveTeam, t }: TeamFooterProps) {
  const state = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot, navigation.getSnapshot)
  const inTeam = state.mode === 'team'
  const label = inTeam ? t('backToConversations') : t('team')
  return (
    <>
      {inTeam && (
        <Tooltip label={t('members')} delayMs={500} disabled={wide}>
          <button type="button" className={css.footerAction} aria-label={t('members')} disabled>
            <IconUserOutline16 size={wide ? 16 : 18} />
            {wide && <span>{t('members')}</span>}
          </button>
        </Tooltip>
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
