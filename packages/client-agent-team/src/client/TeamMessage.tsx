import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { MarkdownText, MessageText, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AgentTeamMemberId, AgentTeamMessageAttachment, AgentTeamTaskRef } from '@wowyuarm/dsh-agent-team/types'
import type { TeamConversationProps } from './slots.ts'
import { cachedAttachmentDataUrl, formatByteSize, loadAttachmentDataUrl } from './attachment-preview.ts'
import { cachedResolvedTaskRef, resolveUnknownTaskRefs, useResolvedTaskRefVersion, type ResolvedTaskRef } from './task-refs.ts'
import { formatMessageTime, isPlainTextBody, isSingleBrandedRef, memberHue, splitBrandedRefs, splitMentionNames, stripAttachmentLines } from './team-formatters.ts'
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
  /** Host lookup turning task refs into human-facing numbers; absent keeps raw refs. */
  readonly onResolveTaskRefs?: ((taskRefs: readonly AgentTeamTaskRef[]) => Promise<readonly ResolvedTaskRef[]>) | undefined
  readonly children?: ReactNode
}

/** One chat message row with identity chrome and sender-appropriate rendering. */
export function TeamMessage({ senderName, memberId, human, body, occurredAt, mentionNames, senderTitle, grouped, attachments, loadAttachment, t, onOpenRef, onResolveTaskRefs, children }: TeamMessageProps) {
  const avatarStyle = human ? undefined : { '--team-avatar-hue': memberHue(memberId) } as CSSProperties
  // Literal bodies carry mention chips inline — Human input always, and
  // plain-prose Agent bodies where literal rendering loses nothing. Rich
  // Markdown keeps unmatched structured mentions in the trailing row.
  // The stored body carries machine-facing `[attachment] <path>` prompt lines;
  // humans see the attachment strip rendered from the message metadata instead.
  const displayBody = stripAttachmentLines(body) === '' ? body : stripAttachmentLines(body)
  const inline = (human || isPlainTextBody(displayBody)) && mentionNames !== undefined && mentionNames.length > 0
    ? splitMentionNames(displayBody, mentionNames)
    : undefined
  const richAgentBody = !human && !isPlainTextBody(displayBody)
  // Rich Markdown chipifies body mentions through the post-render pass, so
  // only names absent from the body need the trailing fallback row; surfaces
  // without ref navigation render nothing inline and keep the full row.
  const fallbackNames = inline !== undefined ? inline.unmatched
    : richAgentBody && onOpenRef !== undefined && mentionNames !== undefined
      ? splitMentionNames(displayBody, mentionNames).unmatched
      : mentionNames ?? []
  // Non-Task branded refs retain the legacy fallback row. Task refs instead
  // stay at their authored prose position; unresolved refs remain literal.
  const fallbackRefs = richAgentBody && onOpenRef !== undefined
    ? splitBrandedRefs(displayBody).filter(segment => segment.ref !== undefined && !segment.ref.startsWith('task:')).map(segment => segment.ref!)
    : []
  // Resolved refs re-label once the Host lookup lands; the version token
  // refreshes literal links and rendered Markdown prose.
  const refVersion = useResolvedTaskRefVersion()
  const bodyTaskRefs: readonly AgentTeamTaskRef[] = onOpenRef === undefined || richAgentBody ? [] : splitBrandedRefs(displayBody)
    .filter(segment => segment.ref !== undefined && segment.ref.startsWith('task:'))
    .map(segment => segment.ref as AgentTeamTaskRef)
  const bodyTaskRefKey = bodyTaskRefs.join(',')
  useEffect(() => {
    if (onResolveTaskRefs === undefined || bodyTaskRefKey === '') return
    void resolveUnknownTaskRefs(bodyTaskRefs, onResolveTaskRefs)
  }, [onResolveTaskRefs, bodyTaskRefKey, refVersion])
  const taskLabel = useCallback((taskNumber: number): string => t?.('taskLabel', { number: taskNumber }) ?? `Task #${taskNumber}`, [t])
  const markdownRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const root = markdownRef.current
    if (!richAgentBody || root === null || onOpenRef === undefined) return
    const textNodes = markdownProseTextNodes(root)
    const styledRefCodes = markdownStyledRefCodeElements(root)
    const taskRefs = [...new Set([...textNodes.map(node => node.data), ...styledRefCodes.map(code => code.textContent ?? '')]
      .flatMap(text => splitBrandedRefs(text)
        .filter(segment => segment.ref?.startsWith('task:') === true)
        .map(segment => segment.ref as AgentTeamTaskRef)))]
    if (onResolveTaskRefs !== undefined && taskRefs.length > 0) void resolveUnknownTaskRefs(taskRefs, onResolveTaskRefs)
    for (const code of styledRefCodes) renderResolvedMarkdownCodeRef(code, taskLabel)
    for (const node of textNodes) renderResolvedMarkdownText(node, mentionNames ?? [], taskLabel)
    for (const button of root.querySelectorAll<HTMLButtonElement>('button[data-task-ref]')) {
      const taskRef = button.dataset.taskRef as AgentTeamTaskRef | undefined
      const hit = taskRef === undefined ? undefined : cachedResolvedTaskRef(taskRef)
      if (taskRef !== undefined && hit !== undefined) button.textContent = taskLabel(hit.taskNumber)
    }
  }, [richAgentBody, onOpenRef, onResolveTaskRefs, refVersion, taskLabel, mentionNames])
  useEffect(() => {
    const root = markdownRef.current
    if (!richAgentBody || root === null || onOpenRef === undefined) return
    const openTask = (event: Event): void => {
      const target = event.target
      if (!(target instanceof Element)) return
      const button = target.closest('button[data-task-ref]')
      if (button === null || !root.contains(button)) return
      const taskRef = button instanceof HTMLElement ? button.dataset.taskRef : undefined
      if (taskRef !== undefined) onOpenRef(taskRef)
    }
    root.addEventListener('click', openTask)
    return () => { root.removeEventListener('click', openTask) }
  }, [richAgentBody, onOpenRef])
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
                : <Fragment key={index}>{renderRefs(segment.text, onOpenRef, taskLabel)}</Fragment>)}
            </div>
          : human || (onOpenRef !== undefined && isPlainTextBody(displayBody) && splitBrandedRefs(displayBody).some(segment => segment.ref !== undefined))
            ? <div className={css.messageText}>{onOpenRef === undefined ? <MessageText text={displayBody} /> : renderRefs(displayBody, onOpenRef, taskLabel)}</div>
            : <div ref={markdownRef} className={css.messageMarkdown}><MarkdownText key={`${displayBody}:${onOpenRef === undefined ? 'literal' : 'refs'}`} text={displayBody} /></div>}
        {(fallbackNames.length > 0 || fallbackRefs.length > 0) && (
          <div className={css.mentionsRow}>
            {fallbackNames.map(name => <span key={name} className={css.mention}>@{name}</span>)}
            {fallbackRefs.map(ref => {
              const resolved = cachedResolvedTaskRef(ref as AgentTeamTaskRef)
              const label = resolved !== undefined && ref.startsWith('task:') ? taskLabel(resolved.taskNumber) : ref
              return <button key={ref} type="button" className={css.refLink} title={ref} onClick={() => { onOpenRef!(ref) }}>{label}</button>
            })}
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

/** Text nodes that Markdown rendered as prose rather than code or a link. */
function markdownProseTextNodes(root: HTMLElement): Text[] {
  const nodes: Text[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const parent = node.parentElement
    if (parent === null) continue
    if (parent.closest('code, pre, a, button') !== null) continue
    // Mention chips from an earlier pass stay untouched, or each effect rerun
    // would wrap another chip around the last one.
    if (css.mention !== undefined && parent.closest(`[class~="${css.mention}"]`) !== null) continue
    nodes.push(node as Text)
  }
  return nodes
}

/** Code spans whose entire content is one branded ref: model styling around a ref, not code. */
function markdownStyledRefCodeElements(root: HTMLElement): HTMLElement[] {
  const elements: HTMLElement[] = []
  for (const code of root.querySelectorAll<HTMLElement>('code')) {
    if (code.closest('pre, a, button') !== null) continue
    if (!isSingleBrandedRef(code.textContent ?? '')) continue
    elements.push(code)
  }
  return elements
}

/** One resolved Task-ref chip built outside React, matching the styled ref link. */
function resolvedTaskRefButton(taskRef: AgentTeamTaskRef, label: string): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  if (css.refLink !== undefined) button.className = css.refLink
  button.dataset.taskRef = taskRef
  button.title = taskRef
  button.textContent = label
  return button
}

/** Replace a whole-ref code span with its resolved Task chip once known. */
function renderResolvedMarkdownCodeRef(code: HTMLElement, taskLabel: (taskNumber: number) => string): void {
  const segments = splitBrandedRefs((code.textContent ?? '').trim())
  const segment = segments.length === 1 ? segments[0]! : undefined
  const taskRef = segment?.ref?.startsWith('task:') === true ? segment.ref as AgentTeamTaskRef : undefined
  const resolved = taskRef === undefined ? undefined : cachedResolvedTaskRef(taskRef)
  if (taskRef === undefined || resolved === undefined) return
  code.replaceWith(resolvedTaskRefButton(taskRef, taskLabel(resolved.taskNumber)))
}

/** Replace resolved Task refs and structured mention handles in one prose text node without changing Markdown structure. */
function renderResolvedMarkdownText(node: Text, mentionNames: readonly string[], taskLabel: (taskNumber: number) => string): void {
  let changed = false
  const fragment = document.createDocumentFragment()
  for (const refSegment of splitBrandedRefs(node.data)) {
    if (refSegment.ref === undefined) {
      for (const mentionSegment of splitMentionNames(refSegment.text, mentionNames).segments) {
        if (!mentionSegment.mention) {
          fragment.append(mentionSegment.text)
          continue
        }
        changed = true
        const chip = document.createElement('span')
        if (css.mention !== undefined) chip.className = css.mention
        chip.textContent = mentionSegment.text
        fragment.append(chip)
      }
      continue
    }
    const taskRef = refSegment.ref.startsWith('task:') === true ? refSegment.ref as AgentTeamTaskRef : undefined
    const resolved = taskRef === undefined ? undefined : cachedResolvedTaskRef(taskRef)
    if (resolved === undefined) {
      fragment.append(refSegment.text)
      continue
    }
    changed = true
    fragment.append(resolvedTaskRefButton(taskRef!, taskLabel(resolved.taskNumber)))
  }
  if (changed) node.replaceWith(fragment)
}

/** Render one literal text run, linkifying branded refs when navigation is available. */
function renderRefs(text: string, onOpenRef: ((ref: string) => void) | undefined, taskLabel: (taskNumber: number) => string): ReactNode {
  if (onOpenRef === undefined) return text
  return splitBrandedRefs(text).map((segment, index) => {
    if (segment.ref === undefined) return <Fragment key={index}>{segment.text}</Fragment>
    const resolved = cachedResolvedTaskRef(segment.ref as AgentTeamTaskRef)
    const label = resolved !== undefined && segment.ref.startsWith('task:') ? taskLabel(resolved.taskNumber) : segment.ref
    return <button key={index} type="button" className={css.refLink} title={segment.ref} onClick={() => { onOpenRef(segment.ref!) }}>{label}</button>
  })
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
