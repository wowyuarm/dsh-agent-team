/** Package-owned invariant companion for `@deepseek-ai/dsh-agent-team`. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-agent-team'

/** Cordis companion plugin name. */
export const name = 'agent-team-invariant'
/** Services required before the companion can validate Team state. */
export const inject = ['invariants']

const install: InvariantInstaller = Object.assign(
  async (ctx: Context, fail: (message: string) => never) => {
    const validateLedger = (): void => {
      try {
        ctx.agentTeam.validateLedger()
      } catch (error) {
        fail(`durable ledger and Team projection diverged: ${String(error)}`)
      }
    }
    validateLedger()
    try {
      await ctx.agentTeam.validateDeliveryEvidence()
    } catch (error) {
      fail(`Delivery admission evidence is invalid: ${String(error)}`)
    }
    ctx.on('agent-team/committed', validateLedger)
  },
  { inject: ['agentTeam'] },
)

/**
 * Register the Agent Team ledger invariant.
 * @param ctx - Cordis context carrying the invariant registry.
 * @returns the installed registration disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
