import { StateDot, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AgentTeamAgentMemberStatus } from '@deepseek-ai/dsh-agent-team/types'
import type { TeamSidebarProps } from './slots.ts'
import css from './presence.module.css'

export function presenceLabel(status: AgentTeamAgentMemberStatus, t: TeamSidebarProps['t']): string {
  const label = status.presence === 'available' ? t('statusAvailable')
    : status.presence === 'working' ? t('statusWorking')
      : status.presence === 'error' ? t('statusError') : t('statusUnavailable')
  return status.diagnostic === undefined ? label : `${label}: ${status.diagnostic}`
}

export function TeamPresenceDot({ status, t }: {
  readonly status: AgentTeamAgentMemberStatus
  readonly t: TeamSidebarProps['t']
}) {
  const label = presenceLabel(status, t)
  return (
    <Tooltip label={label} delayMs={300}>
      <span className={css.target} role="img" aria-label={label}>
        {status.presence === 'unavailable'
          ? <span className={css.unavailableDot} aria-hidden="true" />
          : <StateDot state={status.presence === 'available' ? 'done' : status.presence === 'working' ? 'ongoing' : 'error'} />}
      </span>
    </Tooltip>
  )
}
