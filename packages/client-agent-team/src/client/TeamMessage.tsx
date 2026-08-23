import { Fragment, type CSSProperties, type ReactNode } from 'react'
import { MarkdownText, MessageText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AgentTeamMemberId } from '@wowyuarm/dsh-agent-team/types'
import { formatMessageTime, memberHue, splitMentionNames } from './team-formatters.ts'
import css from './conversation.module.css'

export interface TeamMessageProps {
  readonly senderName: string
  readonly memberId: AgentTeamMemberId
  /** Human input stays literal text; Agent output renders as Markdown. */
  readonly human: boolean
  readonly body: string
  readonly occurredAt?: string
  /** Structured mention handles of this Message; the only names that render as chips. */
  readonly mentionNames?: readonly string[]
  readonly senderTitle?: string
  /** Continuation of one same-sender run: suppress repeated identity chrome. */
  readonly grouped?: boolean
  readonly children?: ReactNode
}

/** One chat message row with identity chrome and sender-appropriate rendering. */
export function TeamMessage({ senderName, memberId, human, body, occurredAt, mentionNames, senderTitle, grouped, children }: TeamMessageProps) {
  const avatarStyle = human ? undefined : { '--team-avatar-hue': memberHue(memberId) } as CSSProperties
  // Literal human bodies carry the chips inline; Markdown agent bodies and
  // names missing from the text fall back to the trailing chip row.
  const inline = human && mentionNames !== undefined && mentionNames.length > 0
    ? splitMentionNames(body, mentionNames)
    : undefined
  const fallbackNames = inline === undefined ? (mentionNames ?? []) : inline.unmatched
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
          ? <div className={css.messageText}>
              {inline === undefined
                ? <MessageText text={body} />
                : inline.segments.map((segment, index) => segment.mention
                  ? <span key={index} className={css.mention}>{segment.text}</span>
                  : <Fragment key={index}>{segment.text}</Fragment>)}
            </div>
          : <div className={css.messageMarkdown}><MarkdownText text={body} /></div>}
        {fallbackNames.length > 0 && (
          <div className={css.mentionsRow}>
            {fallbackNames.map(name => <span key={name} className={css.mention}>@{name}</span>)}
          </div>
        )}
        {children}
      </div>
    </article>
  )
}
