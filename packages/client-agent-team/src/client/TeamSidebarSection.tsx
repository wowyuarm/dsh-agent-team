import { useState, type ReactNode } from 'react'
import { IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './sidebar.module.css'

/** Collapsible sidebar section header: disclosure toggle plus trailing actions. */
export function TeamSidebarSection({ title, actions, children }: {
  readonly title: string
  /** Trailing header controls (the add button); never part of the toggle. */
  readonly actions?: ReactNode
  readonly children: ReactNode
}) {
  const [open, setOpen] = useState(true)
  return (
    <section className={css.section}>
      <div className={css.sectionHeader}>
        <button type="button" className={css.sectionToggle} aria-expanded={open} onClick={() => { setOpen(value => !value) }}>
          <IconChevronDownOutline14 className={css.sectionChevron} />
          <span className={css.sectionTitle}>{title}</span>
        </button>
        {actions !== undefined && <span className={css.sectionActions}>{actions}</span>}
      </div>
      {open && children}
    </section>
  )
}
