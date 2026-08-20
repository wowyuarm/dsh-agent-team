import { useEffect, useMemo, useRef, useState } from 'react'
import type { AgentTeamInbox, AgentTeamView } from '@deepseek-ai/dsh-agent-team/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TeamConversationProps } from './slots.ts'
import { formatTaskStatus } from './team-formatters.ts'
import css from './inbox.module.css'

interface TeamInboxPanelProps {
  readonly workspaceId: WorkspaceId
  readonly loadInbox: TeamConversationProps['loadInbox']
  readonly loadChannels: TeamConversationProps['loadChannels']
  readonly loadChanges: TeamConversationProps['loadChanges']
  readonly selectThread: TeamConversationProps['selectThread']
  readonly t: TeamConversationProps['t']
}

export function TeamInboxPanel({ workspaceId, loadInbox, loadChannels, loadChanges, selectThread, t }: TeamInboxPanelProps) {
  const [inbox, setInbox] = useState<AgentTeamInbox>()
  const [view, setView] = useState<AgentTeamView>()
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(true)
  const active = useRef(false)
  const refreshSequence = useRef(0)

  const refresh = async (clearError = false): Promise<void> => {
    const sequence = refreshSequence.current + 1
    refreshSequence.current = sequence
    if (clearError) setError(undefined)
    try {
      const [nextInbox, nextView] = await Promise.all([
        loadInbox({ workspaceId }),
        loadChannels({ workspaceId, topLevelOnly: true, includeActivities: false, limit: 100 }),
      ])
      if (!active.current || sequence !== refreshSequence.current) return
      if (!nextInbox.ok) { setError(nextInbox.error.message); return }
      if (!nextView.ok) { setError(nextView.error.message); return }
      setInbox(nextInbox.value)
      setView(nextView.value)
      setError(undefined)
    } catch (cause) {
      if (active.current && sequence === refreshSequence.current) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (active.current && sequence === refreshSequence.current) setLoading(false)
    }
  }

  useEffect(() => {
    let listening = true
    active.current = true
    setInbox(undefined)
    setView(undefined)
    setError(undefined)
    setLoading(true)
    void refresh()
    void (async () => {
      let version = 0
      while (listening) {
        try {
          const changed = await loadChanges({ afterVersion: version })
          if (!listening) return
          if (!changed.ok) { setError(changed.error.message); return }
          if (changed.value.version > version) {
            version = changed.value.version
            await refresh()
          }
        } catch (cause) {
          if (listening) setError(cause instanceof Error ? cause.message : String(cause))
          return
        }
      }
    })()
    return () => {
      listening = false
      active.current = false
      refreshSequence.current += 1
    }
  }, [workspaceId])

  const channels = useMemo(() => new Map(view?.channels.map(channel => [channel.channelRef, channel]) ?? []), [view])
  const taskNumbers = useMemo(() => new Map(view?.taskNumbers.map(item => [item.taskRef, item.taskNumber]) ?? []), [view])

  return <main className={css.surface} data-team-inbox>
    <header className={css.header}>
      <div>
        <h1>{t('inbox')}</h1>
        {inbox !== undefined && <p>{inbox.totalUnreadCount === 0 ? t('inboxEmpty') : t('inboxUnreadCount', { count: inbox.totalUnreadCount })}</p>}
      </div>
      {inbox !== undefined && inbox.totalDirectCount > 0 && <span className={css.directTotal}>{t('inboxDirectCount', { count: inbox.totalDirectCount })}</span>}
    </header>
    <section className={css.list} aria-label={t('inbox')}>
      {loading && inbox === undefined && error === undefined && <p className={css.state}>{t('loadingInbox')}</p>}
      {!loading && inbox?.items.length === 0 && error === undefined && <p className={css.state}>{t('inboxEmpty')}</p>}
      {error !== undefined && <div className={css.error} role="alert"><span>{error}</span><Button size="sm" variant="outline" onClick={() => { void refresh(true) }}>{t('retry')}</Button></div>}
      {inbox?.items.map(item => {
        const channel = channels.get(item.channelRef)
        const taskNumber = taskNumbers.get(item.task.taskRef)
        return <button
          key={item.thread.threadRef}
          type="button"
          className={css.item}
          onClick={() => { selectThread(item.task.taskRef, item.thread.threadRef, item.channelRef, taskNumber) }}
        >
          <span className={css.priority} data-direct={item.directCount > 0} aria-hidden="true" />
          <span className={css.copy}>
            <strong>{taskNumber === undefined ? t('task') : `Task #${taskNumber}`}</strong>
            <small>{channel === undefined ? t('channelUnknown') : `# ${channel.name}`} · {formatTaskStatus(item.task.status, t)}</small>
          </span>
          <span className={css.count} aria-label={`${t('inboxUnreadCount', { count: item.unreadCount })}${item.directCount > 0 ? `, ${t('inboxDirectCount', { count: item.directCount })}` : ''}`}>
            {t('inboxUnreadCount', { count: item.unreadCount })}{item.directCount > 0 && <> · {t('inboxDirectCount', { count: item.directCount })}</>}
          </span>
        </button>
      })}
    </section>
  </main>
}
