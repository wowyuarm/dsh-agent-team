import { useLayoutEffect, useSyncExternalStore } from 'react'
import { IconAgentPresetOutline16, IconChevronLeftOutline14, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TeamFooterProps } from './slots.ts'
import css from './team.module.css'

export function TeamFooterAction({ wide, navigation, enterTeam, leaveTeam, t }: TeamFooterProps) {
  const state = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot, navigation.getSnapshot)
  const inTeam = state.mode === 'team'
  const label = inTeam ? t('backToConversations') : t('team')

  useLayoutEffect(() => {
    if (typeof document === 'undefined') return
    if (inTeam) {
      document.documentElement.dataset.agentTeamMode = 'team'
      return () => { delete document.documentElement.dataset.agentTeamMode }
    }
    delete document.documentElement.dataset.agentTeamMode
  }, [inTeam])
  const keyboardActivate = (event: React.KeyboardEvent<HTMLButtonElement>, action: () => void) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    action()
  }

  return (
    <>
      <div className={wide ? css.footerStack : `${css.footerStack} ${css.railStack}`}>
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
    </>
  )
}
