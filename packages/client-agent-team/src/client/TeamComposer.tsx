import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ChangeEvent, KeyboardEvent } from 'react'
import type { AgentTeamClientMemberStatus, AgentTeamMemberId } from '@wowyuarm/dsh-agent-team/types'
import { IconPlusOutline16, IconSendOutline16, useAnchoredMaxHeight, useDismissOnOutsidePointer } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TeamConversationProps } from './slots.ts'
import { TeamPresenceDot } from './TeamPresenceDot.tsx'
import css from './composer.module.css'
import { formatByteSize } from './attachment-preview.ts'

interface MentionMatch {
  readonly start: number
  readonly end: number
  readonly query: string
}

function findMention(draft: string, caret: number): MentionMatch | undefined {
  const beforeCaret = draft.slice(0, caret)
  if (beforeCaret.length === 0 || /\s/u.test(beforeCaret.at(-1) ?? '')) return undefined
  let tokenStart = beforeCaret.length
  while (tokenStart > 0 && !/\s/u.test(beforeCaret[tokenStart - 1]!)) tokenStart -= 1
  const at = beforeCaret.lastIndexOf('@')
  if (at < tokenStart) return undefined
  if (at > 0 && /[\p{L}\p{N}_]/u.test(beforeCaret[at - 1]!)) return undefined
  return { start: at, end: caret, query: beforeCaret.slice(at + 1) }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function containsMention(draft: string, handle: string): boolean {
  return new RegExp(`(?:^|[^\\p{L}\\p{N}_])@${escapeRegExp(handle)}(?=$|[^\\p{L}\\p{N}_])`, 'u').test(draft)
}

function mentionCandidates(members: readonly AgentTeamClientMemberStatus[], query: string): readonly AgentTeamClientMemberStatus[] {
  const normalized = query.toLocaleLowerCase()
  return members.filter(status => status.presence !== 'unavailable'
    && status.member.state !== 'inactive'
    && status.member.handle.toLocaleLowerCase().startsWith(normalized))
}

/** One object URL per draft file; revoked when the draft is removed. */
const draftPreviewUrls = new WeakMap<File, string>()

function draftPreviewUrl(file: File): string | undefined {
  if (!file.type.startsWith('image/')) return undefined
  let url = draftPreviewUrls.get(file)
  if (url === undefined) {
    url = URL.createObjectURL(file)
    draftPreviewUrls.set(file, url)
  }
  return url
}

export function TeamComposer({ members, recipients, draft, pending, confirmation, error, onDraftChange, onRecipientsChange, onSubmit, pendingFiles, onFilesChange, t }: {
  readonly members: readonly AgentTeamClientMemberStatus[]
  readonly recipients: ReadonlySet<AgentTeamMemberId>
  readonly draft: string
  readonly pending: boolean
  readonly confirmation?: string
  readonly error?: string
  readonly onDraftChange: (draft: string) => void
  readonly onRecipientsChange: (recipients: ReadonlySet<AgentTeamMemberId>) => void
  readonly onSubmit: () => void
  /** Upload-capable surfaces pass this to enable the "+" file picker; the reply path omits it. */
  readonly pendingFiles?: readonly File[]
  readonly onFilesChange?: (files: readonly File[]) => void
  readonly t: TeamConversationProps['t']
}) {
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLFormElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const composingRef = useRef(false)
  const [mention, setMention] = useState<MentionMatch>()
  const [highlight, setHighlight] = useState(0)
  const candidates = mention === undefined ? [] : mentionCandidates(members, mention.query)
  const menuOpen = mention !== undefined && candidates.length > 0
  const activeCandidate = candidates[highlight]
  const listId = 'team-mention-suggestions'
  const menuMaxHeight = useAnchoredMaxHeight(menuRef, 320, menuOpen ? draft : null)

  useDismissOnOutsidePointer(rootRef, menuOpen, open => { if (!open) setMention(undefined) })

  useLayoutEffect(() => {
    const input = inputRef.current
    if (input === null) return
    input.style.height = 'auto'
    input.style.height = `${Math.min(input.scrollHeight, 180)}px`
  }, [draft])

  useEffect(() => {
    if (mention === undefined || candidates.length === 0) {
      setHighlight(0)
      return
    }
    setHighlight(current => Math.min(current, candidates.length - 1))
  }, [mention, candidates.length])

  // Match the resident DSH composer without stealing a later user choice: Team
  // data can load after navigation, so a dialog or another control may already
  // own focus by the time this composer appears.
  useEffect(() => {
    const active = document.activeElement
    if (active !== document.body && active?.closest('[aria-current="page"]') === null) return
    inputRef.current?.focus({ preventScroll: true })
  }, [])

  // Confirmation settles after a read-only submission span. Restore focus in
  // case the browser moved it so the second Enter can confirm immediately.
  useEffect(() => {
    if (confirmation === undefined || pending) return
    inputRef.current?.focus({ preventScroll: true })
  }, [confirmation, pending])

  const pruneRecipients = (nextDraft: string): void => {
    const knownMembers = new Map(members.map(status => [status.member.memberId, status.member]))
    const next = new Set([...recipients].filter(memberId => {
      const member = knownMembers.get(memberId)
      return member !== undefined && containsMention(nextDraft, member.handle)
    }))
    if (next.size !== recipients.size) onRecipientsChange(next)
  }

  // Restored drafts may carry recipients that no longer match the text (or
  // unknown Members); converge on mount and on every state change so the
  // cached entry never stays stale — the same rule user edits already apply.
  // An unloaded roster must never judge recipients unknown.
  useEffect(() => {
    if (members.length === 0) return
    pruneRecipients(draft)
  }, [draft, recipients, members])

  const updateMention = (nextDraft: string, caret: number): void => {
    const match = findMention(nextDraft, caret)
    setMention(match)
    if (match === undefined) setHighlight(0)
  }

  const onChange = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    const nextDraft = event.target.value
    onDraftChange(nextDraft)
    pruneRecipients(nextDraft)
    updateMention(nextDraft, event.target.selectionStart ?? nextDraft.length)
  }

  const selectMention = (member: AgentTeamClientMemberStatus): void => {
    if (mention === undefined) return
    const inserted = `@${member.member.handle} `
    const nextDraft = `${draft.slice(0, mention.start)}${inserted}${draft.slice(mention.end)}`
    const nextCaret = mention.start + inserted.length
    const nextRecipients = new Set(recipients).add(member.member.memberId)
    onDraftChange(nextDraft)
    onRecipientsChange(nextRecipients)
    setMention(undefined)
    setHighlight(0)
    requestAnimationFrame(() => {
      const input = inputRef.current
      if (input === null) return
      input.focus({ preventScroll: true })
      input.setSelectionRange(nextCaret, nextCaret)
    })
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    const composing = composingRef.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229
    if (menuOpen && event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlight(current => (current + 1) % candidates.length)
      return
    }
    if (menuOpen && event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlight(current => (current - 1 + candidates.length) % candidates.length)
      return
    }
    if (event.key === 'Escape' && menuOpen) {
      event.preventDefault()
      setMention(undefined)
      return
    }
    // Tab accepts the highlighted candidate; Shift+Tab keeps default focus reversal.
    if (menuOpen && event.key === 'Tab' && !event.shiftKey) {
      event.preventDefault()
      if (activeCandidate !== undefined) selectMention(activeCandidate)
      return
    }
    if (event.key !== 'Enter' || event.shiftKey || composing || event.repeat) return
    if (menuOpen && activeCandidate !== undefined) {
      event.preventDefault()
      selectMention(activeCandidate)
      return
    }
    event.preventDefault()
    if (!pending && draft.trim() !== '') onSubmit()
  }

  return <form ref={rootRef} className={css.root} onSubmit={event => {
    event.preventDefault()
    if (!pending && draft.trim() !== '') onSubmit()
  }}>
    <div className={css.card} data-team-composer>
      {confirmation !== undefined && <p className={css.confirmation} role="status">{confirmation}</p>}
      <div className={css.inputArea}>
        {menuOpen && <div id={listId} ref={menuRef} className={css.mentionMenu} role="listbox" aria-label={t('mentionSuggestions')} style={{ maxHeight: menuMaxHeight }}>
          {candidates.map((status, index) => {
            const optionId = `${listId}-${status.member.memberId}`
            const selected = index === highlight
            return <button
              key={status.member.memberId}
              id={optionId}
              type="button"
              role="option"
              aria-selected={selected}
              className={css.mentionOption}
              onMouseDown={event => { event.preventDefault() }}
              onClick={() => { selectMention(status) }}
            >
              <TeamPresenceDot status={status} t={t} />
              <span className={css.mentionName}>@{status.member.handle}</span>
              <span className={css.mentionDescription}>{status.member.description}</span>
            </button>
          })}
        </div>}
        <textarea
          ref={inputRef}
          aria-label={t('messageDraft')}
          aria-autocomplete="list"
          aria-controls={menuOpen ? listId : undefined}
          aria-activedescendant={menuOpen && activeCandidate !== undefined ? `${listId}-${activeCandidate.member.memberId}` : undefined}
          aria-expanded={menuOpen}
          value={draft}
          readOnly={pending}
          placeholder={t('messagePlaceholder')}
          rows={1}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onSelect={event => { updateMention(event.currentTarget.value, event.currentTarget.selectionStart ?? event.currentTarget.value.length) }}
          onCompositionStart={() => { composingRef.current = true }}
          onCompositionEnd={() => { setTimeout(() => { composingRef.current = false }, 10) }}
        />
      </div>
      {recipients.size > 0 && <p className={css.notifyRow} data-team-notify>{t('composerNotify', { ids: [...recipients].sort().map(memberId => `@${members.find(candidate => candidate.member.memberId === memberId)?.member.handle ?? memberId}`).join(', ') })}</p>}
      {onFilesChange !== undefined && pendingFiles !== undefined && pendingFiles.length > 0 && (
        <ul className={css.fileChips} aria-label={t('attachFiles')}>
          {pendingFiles.map((file, index) => {
            const previewUrl = draftPreviewUrl(file)
            return <li key={`${file.name}-${index}`} className={`${css.fileChip} ${previewUrl !== undefined ? css.imageChip! : ''}`}>
              {previewUrl !== undefined && <img src={previewUrl} alt="" className={css.imageChipPreview} />}
              <span className={css.fileChipName} title={file.name}>{file.name}<span className={css.fileChipSize}>{formatByteSize(file.size)}</span></span>
              <button type="button" className={css.fileChipRemove} aria-label={t('removeFile', { name: file.name })} disabled={pending}
                onClick={() => {
                  const url = draftPreviewUrls.get(file)
                  if (url !== undefined) URL.revokeObjectURL(url)
                  onFilesChange(pendingFiles.filter((_, candidate) => candidate !== index))
                }}>×</button>
            </li>
          })}
        </ul>
      )}
      <div className={css.toolbar}>
        {onFilesChange !== undefined && (
          <>
            <input ref={fileInputRef} type="file" multiple className={css.fileInput} aria-hidden="true" tabIndex={-1}
              onChange={event => {
                const chosen = [...event.target.files ?? []]
                if (chosen.length > 0 && pendingFiles !== undefined) onFilesChange([...pendingFiles, ...chosen])
                event.target.value = ''
              }} />
            <button type="button" className={css.attachButton} aria-label={t('attachFiles')} title={t('attachFiles')}
              disabled={pending} onClick={() => { fileInputRef.current?.click() }}>
              <IconPlusOutline16 size={14} />
            </button>
          </>
        )}
        <button
          type="submit"
          className={css.sendButton}
          aria-label={pending ? t('sendingMessage') : t('sendMessage')}
          disabled={pending || draft.trim() === ''}
          onMouseDown={event => {
            // Keep the composer focused when the send control is clicked.
            event.preventDefault()
            inputRef.current?.focus({ preventScroll: true })
          }}
        >
          <IconSendOutline16 size={16} />
        </button>
      </div>
    </div>
    {error !== undefined && <p className={css.error} role="alert">{error}</p>}
  </form>
}
