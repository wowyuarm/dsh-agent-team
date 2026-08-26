import { Fragment, useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { MarkdownText, MessageText, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AgentTeamGetAttachmentResult, AgentTeamMemberId, AgentTeamMessageAttachment } from '@wowyuarm/dsh-agent-team/types'
import type { TeamConversationProps } from './slots.ts'
import { cachedAttachmentDataUrl, formatByteSize, loadAttachmentDataUrl } from './attachment-preview.ts'
import { formatMessageTime, isPlainTextBody, memberHue, splitBrandedRefs, splitMentionNames, stripAttachmentLines } from './team-formatters.ts'
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
  readonly attachments?: readonly AgentTeamMessageAttachment[] | undefined
  /** Cache readback for thumbnails; absent on surfaces without the remotes. */
  readonly loadAttachment?: TeamConversationProps['getAttachment'] | undefined
  readonly t?: TeamConversationProps['t'] | undefined
  /** Resolve a branded ref found in the body; absent surfaces render refs as plain text. */
  readonly onOpenRef?: ((ref: string) => void) | undefined
  readonly children?: ReactNode
}

/** One chat message row with identity chrome and sender-appropriate rendering. */
export function TeamMessage({ senderName, memberId, human, body, occurredAt, mentionNames, senderTitle, grouped, attachments, loadAttachment, t, onOpenRef, children }: TeamMessageProps) {
  const avatarStyle = human ? undefined : { '--team-avatar-hue': memberHue(memberId) } as CSSProperties
  // Literal bodies carry the chips inline — Human input always, and plain-
  // prose Agent bodies where literal rendering loses nothing. Rich Markdown
  // Agent bodies fall back to the trailing chip row: the Markdown primitive
  // renders block-level documents, so chips cannot interleave mid-paragraph.
  // The stored body carries machine-facing `[attachment] <path>` prompt lines;
  // humans see the attachment strip rendered from the message metadata instead.
  const displayBody = stripAttachmentLines(body) === '' ? body : stripAttachmentLines(body)
  const inline = (human || isPlainTextBody(displayBody)) && mentionNames !== undefined && mentionNames.length > 0
    ? splitMentionNames(displayBody, mentionNames)
    : undefined
  const fallbackNames = inline === undefined ? (mentionNames ?? []) : inline.unmatched
  // Rich Markdown bodies cannot interleave inline links, so refs found there
  // fall back to a chip row under the message — the mention fallback precedent.
  const fallbackRefs = !human && inline === undefined && onOpenRef !== undefined && !isPlainTextBody(displayBody)
    ? splitBrandedRefs(displayBody).filter(segment => segment.ref !== undefined).map(segment => segment.ref!)
    : []
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
        {inline !== undefined
          ? <div className={css.messageText}>
              {inline.segments.map((segment, index) => segment.mention
                ? <span key={index} className={css.mention}>{segment.text}</span>
                : <Fragment key={index}>{renderRefs(segment.text, onOpenRef)}</Fragment>)}
            </div>
          : human || (onOpenRef !== undefined && isPlainTextBody(displayBody) && splitBrandedRefs(displayBody).some(segment => segment.ref !== undefined))
            ? <div className={css.messageText}>{onOpenRef === undefined ? <MessageText text={displayBody} /> : renderRefs(displayBody, onOpenRef)}</div>
            : <div className={css.messageMarkdown}><MarkdownText text={displayBody} /></div>}
        {fallbackNames.length > 0 && (
          <div className={css.mentionsRow}>
            {fallbackNames.map(name => <span key={name} className={css.mention}>@{name}</span>)}
          </div>
        )}
        {fallbackRefs.length > 0 && (
          <div className={css.mentionsRow}>
            {fallbackRefs.map(ref => <button key={ref} type="button" className={css.refLink} onClick={() => { onOpenRef!(ref) }}>{ref}</button>)}
          </div>
        )}
        {attachments !== undefined && attachments.length > 0 && <TeamAttachmentStrip
          attachments={attachments}
          {...(loadAttachment === undefined ? {} : { loadAttachment })}
          {...(t === undefined ? {} : { t })}
        />}
        {children}
      </div>
    </article>
  )
}

/** Render one literal text run, linkifying branded refs when navigation is available. */
function renderRefs(text: string, onOpenRef: ((ref: string) => void) | undefined): ReactNode {
  if (onOpenRef === undefined) return text
  return splitBrandedRefs(text).map((segment, index) => segment.ref === undefined
    ? <Fragment key={index}>{segment.text}</Fragment>
    : <button key={index} type="button" className={css.refLink} onClick={() => { onOpenRef(segment.ref!) }}>{segment.text}</button>)
}

/** One message's attachment strip: image thumbnails with a large view, or name chips when bytes are gone. */
function TeamAttachmentStrip({ attachments, loadAttachment, t }: {
  readonly attachments: readonly AgentTeamMessageAttachment[]
  readonly loadAttachment?: TeamConversationProps['getAttachment'] | undefined
  readonly t?: TeamConversationProps['t'] | undefined
}) {
  const [zoomed, setZoomed] = useState<AgentTeamMessageAttachment>()
  return <div className={css.attachmentStrip}>
    {attachments.map(attachment => <TeamAttachment
      key={attachment.attachmentId}
      attachment={attachment}
      {...(loadAttachment === undefined ? {} : { loadAttachment })}
      {...(t === undefined ? {} : { t })}
      onZoom={setZoomed}
    />)}
    {zoomed !== undefined && <Modal open {...(css.attachmentModal === undefined ? {} : { className: css.attachmentModal })} title={zoomed.name} onClose={() => { setZoomed(undefined) }}>
      <img className={css.attachmentZoom} src={cachedAttachmentDataUrl(zoomed.attachmentId) ?? undefined} alt={zoomed.name} />
    </Modal>}
  </div>
}

function TeamAttachment({ attachment, loadAttachment, t, onZoom }: {
  readonly attachment: AgentTeamMessageAttachment
  readonly loadAttachment?: TeamConversationProps['getAttachment'] | undefined
  readonly t?: TeamConversationProps['t'] | undefined
  readonly onZoom: (attachment: AgentTeamMessageAttachment) => void
}) {
  const wantsPreview = loadAttachment !== undefined && attachment.mediaType.startsWith('image/')
  const [dataUrl, setDataUrl] = useState<string | null | undefined>(wantsPreview ? cachedAttachmentDataUrl(attachment.attachmentId) : null)
  useEffect(() => {
    if (!wantsPreview || dataUrl !== undefined) return
    let mounted = true
    void loadAttachmentDataUrl(loadAttachment, attachment).then(url => { if (mounted) setDataUrl(url) })
    return () => { mounted = false }
  }, [wantsPreview, dataUrl, loadAttachment, attachment])
  const expired = t?.('attachmentExpired') ?? 'File no longer cached'
  if (wantsPreview && dataUrl !== null) {
    return <button type="button" className={css.attachmentThumb} aria-label={t?.('viewImage', { name: attachment.name }) ?? attachment.name} title={attachment.name} onClick={() => { onZoom(attachment) }}>
      <img src={dataUrl} alt={attachment.name} />
    </button>
  }
  return <span className={css.attachmentChip} title={wantsPreview ? expired : `${attachment.name} · ${formatByteSize(attachment.byteSize)}`}>
    <span className={css.attachmentChipName}>{attachment.name}</span>
    <span className={css.attachmentChipSize}>{wantsPreview ? expired : formatByteSize(attachment.byteSize)}</span>
  </span>
}
