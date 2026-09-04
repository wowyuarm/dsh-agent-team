import { StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './state-dot.module.css'

/** The Team status dot language: the DSH four-color states plus the two quiet statuses StateDot has no slot for. */
export type TeamStateDotState = StateDotState | 'todo' | 'quiet'

/**
 * Render the one shared Team status indicator. Native StateDot states pass
 * through; the quiet statuses mirror StateDot geometry locally so every
 * surface renders the same shape — todo a hollow ring (not started), quiet a
 * solid tertiary dot with the same 10% halo (closed, unavailable).
 */
export function TeamStateDot({ state, size = 10 }: {
  readonly state: TeamStateDotState
  readonly size?: number | undefined
}) {
  if (state === 'todo' || state === 'quiet') {
    return <span className={css.quiet} data-variant={state} style={{ width: size, height: size }} aria-hidden="true" />
  }
  return <StateDot state={state} size={size} />
}
