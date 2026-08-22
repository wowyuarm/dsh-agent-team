import { StateDot, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AgentTeamClientMemberStatus } from '@wowyuarm/dsh-agent-team/types'
import type { TeamSidebarProps } from './slots.ts'
import css from './presence.module.css'

export function presenceLabel(status: AgentTeamClientMemberStatus, t: TeamSidebarProps['t']): string {
  const label = status.presence === 'available' ? t('statusAvailable')
    : status.presence === 'working' ? t('statusWorking')
      : status.presence === 'error' ? t('statusError') : t('statusUnavailable')
  return status.diagnostic === undefined ? label : `${label}: ${status.diagnostic}`
}

/** Shared presence → indicator mapping for dots and avatar badges. */
export function presenceDotState(presence: AgentTeamClientMemberStatus['presence']): StateDotState | 'gray' {
  return presence === 'available' ? 'done' : presence === 'working' ? 'ongoing' : presence === 'error' ? 'error' : 'gray'
}

export function TeamPresenceDot({ status, t }: {
  readonly status: AgentTeamClientMemberStatus
  readonly t: TeamSidebarProps['t']
}) {
  const label = presenceLabel(status, t)
  const state = presenceDotState(status.presence)
  return (
    <Tooltip label={label} delayMs={300}>
      <span className={css.target} role="img" aria-label={label}>
        {state === 'gray'
          ? <span className={css.unavailableDot} aria-hidden="true" />
          : <StateDot state={state} />}
      </span>
    </Tooltip>
  )
}
