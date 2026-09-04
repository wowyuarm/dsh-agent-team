import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

/** Public composer-dock slot currency for the Member Session strip. */
export type TeamMemberDockProps = PropsRuntime<'conversation.input.dock'> & PropsLocale<'team'>

/**
 * Team-owned strip under the shipped composer while a Member Session is
 * embedded. The shipped InputBar keeps the whole input surface (draft,
 * trigger menus, submit); this dock only carries what the shipped bar cannot
 * know — the Member-Session vocabulary hint and the Member turn's prompt
 * error, read through the standard useSession hook.
 */
export function TeamMemberDock({ t, useSession }: TeamMemberDockProps) {
  const promptError = useSession(state => state.promptError ?? null)
  return <div data-team-member-dock="true">
    <span>{t('memberSessionHint')}</span>
    {promptError !== null && (
      <p role="alert">{promptError.error.message}</p>
    )}
  </div>
}
