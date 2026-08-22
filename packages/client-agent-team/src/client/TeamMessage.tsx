import type { CSSProperties, ReactNode } from 'react'
import { MarkdownText, MessageText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AgentTeamMemberId } from '@wowyuarm/dsh-agent-team/types'
import { formatMessageTime, memberHue } from './team-formatters.ts'
import css from './conversation.module.css'

export interface TeamMessageProps {
  readonly senderName: string
  readonly memberId: AgentTeamMemberId
  /** Human input stays literal text; Agent output renders as Markdown. */
  readonly human: boolean
  readonly body: string
  readonly occurredAt?: string
  readonly senderTitle?: string
  /** Continuation of one same-sender run: suppress repeated identity chrome. */
  readonly grouped?: boolean
  readonly children?: ReactNode
}

/** One chat message row with identity chrome and sender-appropriate rendering. */
export function TeamMessage({ senderName, memberId, human, body, occurredAt, senderTitle, grouped, children }: TeamMessageProps) {
  const avatarStyle = human ? undefined : { '--team-avatar-hue': memberHue(memberId) } as CSSProperties
  return (
    <article className={css.messageRow} data-human={human || undefined} data-grouped={grouped || undefined}>
      <div className={css.messageIdentity} style={avatarStyle} aria-hidden="true">{senderName.replace('@', '').slice(0, 1).toUpperCase()}</div>
      <div className={css.messageBody}>
        {!grouped && (
          <div className={css.nameRow}>
            <strong {...(senderTitle === undefined ? {} : { title: senderTitle })}>{senderName}</strong>
            {occurredAt !== undefined && <span className={css.messageTime}>{formatMessageTime(occurredAt)}</span>}
          </div>
        )}
        {human
          ? <div className={css.messageText}><MessageText text={body} /></div>
          : <div className={css.messageMarkdown}><MarkdownText text={body} /></div>}
        {children}
      </div>
    </article>
  )
}

/** One run-continuation flag: this entry directly follows the same sender's message.
 *  A undefined sender (non-message fact) breaks the run. */
export function isGroupedRun<F, S>(facts: readonly F[], index: number, senderOf: (fact: F) => S | undefined): boolean {
  if (index <= 0) return false
  const sender = senderOf(facts[index]!)
  return sender !== undefined && sender === senderOf(facts[index - 1]!)
}
