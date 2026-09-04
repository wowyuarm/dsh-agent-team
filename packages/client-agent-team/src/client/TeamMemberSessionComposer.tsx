import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ChangeEvent, KeyboardEvent } from 'react'
import { IconSendOutline16, IconStopFill16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { InputTriggerController, TriggerHit } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { allowsMemberSessionSubmit, TEAM_COMMAND_SOURCE, TEAM_MEMBER_SOURCE } from './member-session-input.ts'
import css from './composer.module.css'

/** Public composer-bar slot currency plus Team's scoped trigger controller. */
export type TeamMemberSessionComposerProps = PropsRuntime<'conversation.composer.bar'> & {
  readonly controller: InputTriggerController
  /** Team inject provides public Session.cancel as the running stop action. */
  readonly stop?: (() => void) | undefined
  /** Team inject keeps delivery inside the public InputMachine facade. */
  readonly submitInput: (mode: 'queue' | 'steer') => void
}

/**
 * Narrow, Team-owned member-session composer. It deliberately uses the public
 * input state/actions and trigger controller rather than the shipped InputBar;
 * owner-provided accessory remains inside the card so the shared menu renders.
 */
export function TeamMemberSessionComposer({ controller, inputActions, accessory, placeholder, disabled, blocked, stop, submitInput, useInput, useSession }: TeamMemberSessionComposerProps) {
  const input = useInput(state => state)
  const session = useSession(state => state)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const editedByHuman = useRef<{ readonly draft: string; readonly caret: number } | undefined>(undefined)
  const compactWasSubmitting = useRef(false)
  const composing = useRef(false)
  const [submissionNotice, setSubmissionNotice] = useState<string>()
  const draft = input?.draft ?? ''
  const isLocked = disabled === true || blocked !== undefined || inputActions === undefined || input === undefined

  useEffect(() => {
    if (isLocked) return
    const active = document.activeElement
    if (active !== document.body && active?.closest('[aria-current="page"]') === null) return
    textarea.current?.focus({ preventScroll: true })
  }, [isLocked])

  useLayoutEffect(() => {
    const element = textarea.current
    if (element === null) return
    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight, 336)}px`
  }, [draft])

  useEffect(() => {
    if (input === undefined) return
    if (input.phase === 'submitting' && input.claim?.token === '/compact') {
      compactWasSubmitting.current = true
      return
    }
    if (input.phase === 'claimed' && input.claim?.token === '/compact' && compactWasSubmitting.current) {
      compactWasSubmitting.current = false
      setSubmissionNotice('Compact 未执行，请重试。')
      return
    }
    if (input.phase === 'plain') {
      // Reaching plain after a compact flight means the InputMachine adopted
      // the clear-on-success draft; a stale retry notice must not outlive it.
      if (compactWasSubmitting.current) setSubmissionNotice(undefined)
      compactWasSubmitting.current = false
    }
  }, [input?.claim?.token, input?.phase])

  useEffect(() => {
    if (input === undefined) return
    const edit = editedByHuman.current
    if (edit === undefined || edit.draft !== input.draft) return
    editedByHuman.current = undefined
    const hit = triggerHit(input.draft, edit.caret, input.draftRev)
    // toggleSource intentionally closes its own already-open launcher; reset
    // first so consecutive real DOM edits always refresh candidates, while a
    // pick-driven machine draft update never reopens a menu.
    controller.dismiss()
    if (hit !== undefined) controller.toggleSource(hit.trigger === '/' ? TEAM_COMMAND_SOURCE : TEAM_MEMBER_SOURCE, hit)
  }, [controller, input?.draft, input?.draftRev])

  const onChange = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    const caret = event.currentTarget.selectionStart
    editedByHuman.current = { draft: event.currentTarget.value, caret }
    setSubmissionNotice(undefined)
    inputActions?.setDraft(event.currentTarget.value)
  }

  const submit = (): void => {
    if (input === undefined || inputActions === undefined) return
    if (!allowsMemberSessionSubmit(input.draft, input.claim?.token)) {
      setSubmissionNotice('此 Member Session 仅支持 /compact 命令。')
      return
    }
    setSubmissionNotice(undefined)
    submitInput(running ? 'steer' : 'queue')
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    // Shift+Enter is always a native newline, even while a candidate menu is
    // open. Keep this ahead of IME/menu handling to match the resident bar.
    if (event.key === 'Enter' && event.shiftKey) return
    if (event.repeat || composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
    // Tab accepts the highlighted candidate, mirroring the team-mode composer
    // and the Channel/Thread bars; Shift+Tab keeps native focus reversal.
    if (event.key === 'Tab' && !event.shiftKey) {
      const highlight = controller.menu.getSnapshot().highlight
      if (highlight !== null) {
        event.preventDefault()
        controller.pick(highlight.source, highlight.index)
      }
      return
    }
    const key = event.key === 'ArrowUp' ? 'up' : event.key === 'ArrowDown' ? 'down' : event.key === 'Escape' ? 'escape' : event.key === 'Enter' ? 'enter' : undefined
    if (key !== undefined) {
      const outcome = controller.arbitrate(key, false)
      if (outcome !== 'pass') {
        event.preventDefault()
        return
      }
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      submit()
    }
  }

  const running = session?.running ?? false
  const promptError = session?.promptError
  return <div className={`${css.root} ${css.memberSessionRoot}`} data-team-member-composer="true">
    {(submissionNotice !== undefined || promptError !== null && promptError !== undefined) && (
      <p className={css.memberSessionStatus} role="alert">{submissionNotice ?? promptError?.error.message}</p>
    )}
    <div className={`${css.card} ${css.memberSessionCard}`} data-composer-card="true">
      <div className={`${css.inputArea} ${css.memberSessionInputArea}`}>
        <textarea ref={textarea} value={draft} disabled={isLocked} placeholder={blocked?.reason ?? placeholder ?? '给成员发送直接消息'}
          onChange={onChange} onKeyDown={onKeyDown}
          onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false }} />
        {accessory}
      </div>
      <div className={`${css.toolbar} ${css.memberSessionToolbar}`}>
        <button className={`${css.sendButton} ${css.memberSessionPrimary}`} type="button" aria-label={running ? '停止生成' : '发送消息'} disabled={isLocked || (!running && draft.trim() === '')}
          onClick={() => { if (running) stop?.(); else submit() }}>
          {running ? <IconStopFill16 size={16} /> : <IconSendOutline16 size={16} />}
        </button>
      </div>
    </div>
  </div>
}

function triggerHit(draft: string, caret: number, draftRev: number): TriggerHit | undefined {
  const before = draft.slice(0, caret)
  const leading = before.match(/^\s*\/([^\s]*)$/u)
  if (leading !== null) {
    const start = before.indexOf('/')
    return { trigger: '/', query: leading[1]!, quoted: false, position: 'leading', span: { start, end: caret, draftRev } }
  }
  const at = before.lastIndexOf('@')
  if (at < 0 || /[\p{L}\p{N}_]/u.test(before[at - 1] ?? '') || /\s/u.test(before.slice(at + 1))) return undefined
  return { trigger: '@', query: before.slice(at + 1), quoted: false, position: 'inline', span: { start: at, end: caret, draftRev } }
}
