import { useCallback, useEffect, useState } from 'react'
import type { AgentTeamInboxItem } from '@wowyuarm/dsh-agent-team/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TeamConversationProps } from './slots.ts'
import { formatAbsoluteTime, formatInboxTime } from './team-formatters.ts'
import css from './conversation.module.css'
import inboxCss from './inbox.module.css'

interface TeamInboxRow {
  readonly workspaceId: WorkspaceId
  readonly workspaceTitle: string
  readonly item: AgentTeamInboxItem
}

interface TeamInboxPageProps {
  readonly useWorkspaces: TeamConversationProps['useWorkspaces']
  readonly loadInbox: TeamConversationProps['loadInbox']
  /** Wake source while the page is open: one scope-less subscription, shared with the badge poll. */
  readonly subscribeChanges: TeamConversationProps['subscribeChanges']
  readonly selectWorkspace: TeamConversationProps['selectWorkspace']
  readonly selectThread: TeamConversationProps['selectThread']
  readonly t: TeamConversationProps['t']
}

/**
 * Queue order: newest mention first, one total order across Workspaces. Each
 * Workspace slice arrives in the Host's own order (that order is the Host's
 * truncation policy); the merged display order is decided here, where the
 * merge happens, and the ledger sequence breaks ties so the queue never
 * reshuffles two rows that share an instant.
 */
function compareInboxRows(left: TeamInboxRow, right: TeamInboxRow): number {
  const leftAt = Date.parse(left.item.newestOccurredAt)
  const rightAt = Date.parse(right.item.newestOccurredAt)
  const byTime = (Number.isNaN(rightAt) ? 0 : rightAt) - (Number.isNaN(leftAt) ? 0 : leftAt)
  return byTime !== 0 ? byTime : right.item.newestSequence - left.item.newestSequence
}

/**
 * The Human 「提到我」 queue: one direct-only Inbox call per visible Workspace,
 * merged into a single recency-ordered list — newest mention first across every
 * Workspace, since a queue is read by recency rather than by Workspace.
 * Opening the page never acknowledges anything — only a durable Thread read
 * consumes a mention marker, so rows and the badge drop after the Thread is
 * opened through the existing auto-ack path.
 */
export function TeamInboxPage({ useWorkspaces, loadInbox, subscribeChanges, selectWorkspace, selectThread, t }: TeamInboxPageProps) {
  const workspaces = useWorkspaces(state => state.items)
  const [rows, setRows] = useState<readonly TeamInboxRow[]>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()

  const refresh = useCallback(async () => {
    setLoading(true)
    const results = await Promise.all(workspaces.map(async workspace => {
      const result = await loadInbox({ workspaceId: workspace.workspaceId, directOnly: true, limit: 100 })
      return result.ok
        ? { ok: true as const, workspaceId: workspace.workspaceId, workspaceTitle: workspace.title, items: result.value.items }
        : { ok: false as const, message: result.error.message }
    }))
    const failure = results.find(result => !result.ok)
    setRows(results.flatMap(result => result.ok
      ? result.items.map(item => ({ workspaceId: result.workspaceId, workspaceTitle: result.workspaceTitle, item }))
      : []).sort(compareInboxRows))
    setError(failure?.ok === false ? failure.message : undefined)
    setLoading(false)
  }, [loadInbox, workspaces])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => subscribeChanges(undefined, update => {
    if (update.type === 'failed') {
      setError(update.message)
      return
    }
    void refresh()
  }), [subscribeChanges, refresh])

  const open = (row: TeamInboxRow): void => {
    selectWorkspace(row.workspaceId)
    selectThread(row.item.thread.threadRef, row.item.channelRef, row.item.task?.taskRef, row.item.taskNumber)
  }

  // The page rides the shared conversation seat: the same header band, 880px
  // reading column, responsive gutters, and scrollbar gutter as Channel and
  // Thread, so switching surfaces does not shift the content column.
  return <main className={css.surface} data-team-inbox>
    <div className={css.surfaceHeader}>
      <header className={css.headerRow}>
        <div className={css.headerCopy}>
          <h1>{t('mentionsOfMe')}</h1>
          {rows !== undefined && rows.length > 0 && <p className={inboxCss.headerMeta}>{t('inboxHeaderMeta', { threads: rows.length, mentions: rows.reduce((sum, row) => sum + row.item.directCount, 0) })}</p>}
        </div>
      </header>
    </div>
    <div className={css.timeline}>
      <div className={css.timelineContent}>
        {loading && rows === undefined && error === undefined && <div className={css.emptySurface}><p className={css.loadingState}><span className={css.loadingMark} aria-hidden="true" />{t('loadingInbox')}</p></div>}
        {!loading && rows === undefined && error !== undefined && <div className={css.errorState} role="alert"><span>{error}</span><Button size="sm" variant="outline" onClick={() => { void refresh() }}>{t('retry')}</Button></div>}
        {rows !== undefined && (rows.length === 0
          ? <div className={css.emptySurface}>
              <div className={css.emptyState}>
                <strong>{t('inboxEmptyTitle')}</strong>
                <span>{t('inboxEmptyHint')}</span>
              </div>
            </div>
          : <div className={inboxCss.list}>
              {rows.map(row => (
                <button key={`${row.workspaceId} ${row.item.thread.threadRef}`} type="button"
                  className={inboxCss.row}
                  onClick={() => { open(row) }}>
                  <span className={inboxCss.rowCrumb}>
                    {row.workspaceTitle} / <span className={inboxCss.rowChannel}>#{row.item.channelName}</span>
                    {row.item.taskNumber !== undefined && <span className={inboxCss.rowTask}>{t('taskLabel', { number: row.item.taskNumber })}</span>}
                  </span>
                  <span className={inboxCss.rowPreview}>{row.item.previewText}</span>
                  <time className={inboxCss.rowTime} dateTime={row.item.newestOccurredAt} title={formatAbsoluteTime(row.item.newestOccurredAt)}>{formatInboxTime(row.item.newestOccurredAt, t)}</time>
                </button>
              ))}
            </div>)}
        {rows !== undefined && error !== undefined && <p className={css.error} role="alert">{error}</p>}
      </div>
    </div>
  </main>
}
