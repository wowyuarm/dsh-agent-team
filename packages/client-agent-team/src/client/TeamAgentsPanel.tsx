import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AgentTeamAddMemberRequest,
  AgentTeamClientMemberStatus,
  AgentTeamModelSelection,
  AgentTeamChannel,
} from '@wowyuarm/dsh-agent-team/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
import { Button, IconEditOutline16, IconNewChatOutline16, IconPlayOutline16, IconPlusOutline16, IconRefreshOutline16, Input, Modal, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TeamSidebarProps } from './slots.ts'
import { TeamMemberAvatar } from './TeamMemberAvatar.tsx'
import { SortableRow, useSidebarRowDrag } from './sidebar-drag.tsx'
import { moveSidebarItem, useSidebarOrder } from './sidebar-order.ts'
import { mintRequestId } from './requests.ts'
import { TeamRowMenu } from './TeamRowMenu.tsx'
import { TeamSidebarSection } from './TeamSidebarSection.tsx'
import { MultiMenuField } from './multi-menu-field.tsx'
import { AgentEditorDialog, ModelPickerField, sameModel } from './TeamMemberEditor.tsx'
import createCss from './create.module.css'
import css from './sidebar.module.css'

interface TeamAgentsPanelProps {
  readonly workspaceId: WorkspaceId
  readonly loadMembers: TeamSidebarProps['loadMembers']
  readonly subscribeChanges: TeamSidebarProps['subscribeChanges']
  readonly loadChannels: TeamSidebarProps['loadChannels']
  readonly addMember: TeamSidebarProps['addMember']
  readonly updateMember: TeamSidebarProps['updateMember']
  readonly recoverMember: TeamSidebarProps['recoverMember']
  readonly clearMemberContext: TeamSidebarProps['clearMemberContext']
  readonly joinChannel: TeamSidebarProps['joinChannel']
  readonly removeChannelMember: TeamSidebarProps['removeChannelMember']
  readonly loadModels: TeamSidebarProps['loadModels']
  /** The Member Session currently embedded in the conversation seat, if any. */
  readonly memberSessionId?: AgentTeamClientMemberStatus['member']['sessionId']
  readonly openMemberSession: TeamSidebarProps['openMemberSession']
  readonly refreshMemberSession: TeamSidebarProps['refreshMemberSession']
  readonly onCreatingChange: (request: AgentTeamAddMemberRequest, creating: boolean) => void
  readonly t: TeamSidebarProps['t']
}

export function TeamAgentsPanel({ workspaceId, loadMembers, subscribeChanges, loadChannels, addMember, updateMember, recoverMember, clearMemberContext, joinChannel, removeChannelMember, loadModels, memberSessionId, openMemberSession, refreshMemberSession, onCreatingChange, t }: TeamAgentsPanelProps) {
  const [members, setMembers] = useState<readonly AgentTeamClientMemberStatus[]>([])
  const [channels, setChannels] = useState<readonly AgentTeamChannel[]>([])
  const [channelRefs, setChannelRefs] = useState<AgentTeamAddMemberRequest['channelRefs']>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [formOpen, setFormOpen] = useState(false)
  const [handle, setHandle] = useState('')
  const [description, setDescription] = useState('')
  const [model, setModel] = useState<AgentTeamModelSelection | undefined>(undefined)
  const [creating, setCreating] = useState(false)
  const [retryRequest, setRetryRequest] = useState<AgentTeamAddMemberRequest>()
  const triggerRef = useRef<HTMLButtonElement>(null)
  // Same presentation-preference ordering as the Channels list; the drag
  // commits through one shared mutation.
  const agentRefs = useMemo(() => members.map(status => status.member.memberId), [members])
  const orderedAgentRefs = useSidebarOrder(workspaceId, 'agents', agentRefs)
  const orderedMembers = useMemo(() => {
    const byId = new Map(members.map(status => [status.member.memberId, status]))
    return orderedAgentRefs.map(memberId => byId.get(memberId)).filter(status => status !== undefined)
  }, [orderedAgentRefs, members])
  const applyMove = (movedRef: typeof agentRefs[number], targetRef: typeof agentRefs[number], marker: 'before' | 'after'): void => {
    void moveSidebarItem(workspaceId, 'agents', orderedAgentRefs, movedRef, targetRef, marker)
  }
  const drag = useSidebarRowDrag({ refs: orderedAgentRefs, onCommit: applyMove })

  const refresh = useCallback(async () => {
    setLoading(true)
    const result = await loadMembers({ workspaceId })
    if (result.ok) {
      setMembers(result.value)
      setError(undefined)
    } else {
      setError(result.error.message)
    }
    setLoading(false)
  }, [loadMembers, workspaceId])

  useEffect(() => { void refresh() }, [refresh])
  const loadWorkspaceChannels = useCallback(async () => {
    const result = await loadChannels({ workspaceId, topLevelOnly: true, includeActivities: false, limit: 1 })
    if (result.ok) setChannels(result.value.channels)
  }, [loadChannels, workspaceId])
  useEffect(() => { void loadWorkspaceChannels() }, [loadWorkspaceChannels])
  useEffect(() => subscribeChanges({ kind: 'workspace', workspaceId }, update => {
    if (update.type === 'failed') {
      setError(update.message)
      return
    }
    // The section stays mounted across Channel creation, so both the Member
    // roster and the Channel list ride every workspace invalidation.
    void refresh()
    void loadWorkspaceChannels()
  }), [subscribeChanges, refresh, loadWorkspaceChannels, workspaceId])

  const closeForm = () => {
    if (creating) return
    setFormOpen(false)
    queueMicrotask(() => { triggerRef.current?.focus() })
  }

  const provision = async (request: AgentTeamAddMemberRequest) => {
    setCreating(true)
    onCreatingChange(request, true)
    setError(undefined)
    setRetryRequest(request)
    try {
      const result = await addMember(request)
      if (result.ok) {
        setMembers(current => {
          const retained = current.filter(status => status.member.memberId !== result.value.status.member.memberId)
          return [...retained, result.value.status]
        })
        setHandle('')
        setDescription('')
        setModel(undefined)
        setChannelRefs([])
        setFormOpen(false)
        if (result.value.status.presence === 'unavailable') {
          setError(result.value.status.diagnostic ?? t('statusUnavailable'))
        } else {
          setRetryRequest(undefined)
        }
        queueMicrotask(() => { triggerRef.current?.focus() })
      } else {
        await refresh()
        setError(result.error.message)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setCreating(false)
      onCreatingChange(request, false)
    }
  }

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const normalizedHandle = handle.trim()
    const normalizedDescription = description.trim()
    if (normalizedHandle.length === 0 || creating) return
    const sameRequest = retryRequest !== undefined && retryRequest.workspaceId === workspaceId
      && retryRequest.handle === normalizedHandle && retryRequest.description === normalizedDescription
      && sameModel(retryRequest.model, model)
      && retryRequest.channelRefs.length === channelRefs.length && retryRequest.channelRefs.every(ref => channelRefs.includes(ref))
    void provision(sameRequest ? retryRequest : {
      requestId: mintRequestId(),
      workspaceId,
      handle: normalizedHandle,
      description: normalizedDescription,
      presetId: 'team-member',
      channelRefs,
      ...(model === undefined ? {} : { model }),
    })
  }

  return (
    <div className={css.panel}>
      <Modal
        open={formOpen}
        onClose={closeForm}
        title={t('addAgent')}
        closeLabel={t('close')}
        contentClassName={createCss.dialogContent!}
        footer={<><Button variant="outline" disabled={creating} onClick={closeForm}>{t('cancel')}</Button><Button type="submit" form="team-agent-create-form" variant="primary" disabled={creating || handle.trim().length === 0}>{creating ? t('creatingAgent') : t('createAgent')}</Button></>}
      >
        <form id="team-agent-create-form" className={createCss.form} onSubmit={submit}>
          <label className={createCss.field}>
            <span>{t('agentName')}</span>
            <Input className={createCss.input!} value={handle} onChange={event => { setHandle(event.target.value); setRetryRequest(undefined) }} disabled={creating} autoFocus />
          </label>
          <label className={createCss.field}>
            <span>{t('agentDescription')}{t('optionalSuffix')}</span>
            <Input className={createCss.input!} value={description} placeholder={t('agentDescriptionPlaceholder')} onChange={event => { setDescription(event.target.value); setRetryRequest(undefined) }} disabled={creating} />
          </label>
          <ModelPickerField model={model} onModelChange={choice => { setModel(choice); setRetryRequest(undefined) }} loadModels={loadModels} disabled={creating} t={t} />
          <MultiMenuField label={`${t('initialChannels')}${t('optionalSuffix')}`} disabled={creating}
            options={channels.map(channel => ({ id: channel.channelRef, label: channel.name }))}
            selected={channelRefs}
            onToggle={ref => {
              setChannelRefs(current => current.includes(ref) ? current.filter(item => item !== ref) : [...current, ref])
              setRetryRequest(undefined)
            }}
            emptyText={t('noChannelsForAgent')}
            triggerEmptyLabel={t('channelsPickerEmpty')}
            formatCount={count => t('channelsPickerCount', { count })} />
          {formOpen && error !== undefined && <p className={createCss.error} role="alert">{error}</p>}
        </form>
      </Modal>
      <TeamSidebarSection
        title={t('agents')}
        actions={(
          <Tooltip label={t('addAgent')} delayMs={500}>
            <button ref={triggerRef} type="button" className={css.iconButton} aria-label={t('addAgent')} onClick={() => { setError(undefined); setFormOpen(true) }}>
              <IconPlusOutline16 size={14} />
            </button>
          </Tooltip>
        )}
      >
        {loading && members.length === 0 && <p className={css.emptyState}>{t('loadingAgents')}</p>}
        {!loading && members.length === 0 && <p className={css.emptyState}>{t('emptyAgents')}</p>}
        <div className={css.agentList}>
          {orderedMembers.map(status => (
            <SortableRow key={status.member.memberId} drag={drag} orderKey={status.member.memberId}>
              <AgentRow status={status} {...(memberSessionId === undefined ? {} : { current: status.member.sessionId === memberSessionId })} channels={channels} loadChannels={loadChannels} updateMember={updateMember} recoverMember={recoverMember} clearMemberContext={clearMemberContext} joinChannel={joinChannel} removeChannelMember={removeChannelMember} loadModels={loadModels} openMemberSession={openMemberSession} refreshMemberSession={refreshMemberSession} onUpdated={() => { void refresh() }} t={t} />
            </SortableRow>
          ))}
        </div>
      </TeamSidebarSection>
      {!formOpen && error !== undefined && (
        <div className={css.retryError} role="alert">
          <span>{error}</span>
          {retryRequest !== undefined && <button type="button" className={css.textButton} disabled={creating} onClick={() => { setFormOpen(true) }}>{t('retry')}</button>}
        </div>
      )}
    </div>
  )
}

/**
 * One sidebar Agent row: the select button opens the Member's own Session
 * conversation page, the avatar carries identity plus the presence badge, and
 * the row menu opens the editor.
 */
function AgentRow({ status, current, channels, loadChannels, updateMember, recoverMember, clearMemberContext, joinChannel, removeChannelMember, loadModels, openMemberSession, refreshMemberSession, onUpdated, t }: {
  readonly status: AgentTeamClientMemberStatus
  /** This Member's Session is the one embedded in the conversation seat. */
  readonly current?: boolean
  readonly channels: readonly AgentTeamChannel[]
  readonly loadChannels: TeamSidebarProps['loadChannels']
  readonly updateMember: TeamSidebarProps['updateMember']
  readonly recoverMember: TeamSidebarProps['recoverMember']
  readonly clearMemberContext: TeamSidebarProps['clearMemberContext']
  readonly joinChannel: TeamSidebarProps['joinChannel']
  readonly removeChannelMember: TeamSidebarProps['removeChannelMember']
  readonly loadModels: TeamSidebarProps['loadModels']
  readonly openMemberSession: TeamSidebarProps['openMemberSession']
  readonly refreshMemberSession: TeamSidebarProps['refreshMemberSession']
  readonly onUpdated: () => Promise<void> | void
  readonly t: TeamSidebarProps['t']
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [rowAlert, setRowAlert] = useState<string>()
  // Both row actions ride the same runtime remote: the Host steers a live
  // session, rebuilds an orphaned composition, or re-runs a failed activation.
  const recover = async (): Promise<void> => {
    try {
      const result = await recoverMember({
        requestId: mintRequestId(),
        workspaceId: status.member.workspaceId,
        memberId: status.member.memberId,
      })
      await onUpdated()
      if (!result.ok) {
        setRowAlert(t('restartFailed', { message: result.error.message }))
        return
      }
      if (result.value.status.availability === 'unavailable') {
        setRowAlert(t('restartStillUnavailable', { diagnostic: result.value.status.diagnostic ?? t('statusUnavailable') }))
        return
      }
      setRowAlert(undefined)
      // A page opened while the Member was down predates the live Session;
      // re-selecting is a no-op when already bound and rebinds when stale.
      if (current === true) openMemberSession(status.member.sessionId)
    } catch (cause) {
      setRowAlert(t('restartFailed', { message: cause instanceof Error ? cause.message : String(cause) }))
    }
  }
  const clearContext = async (): Promise<void> => {
    try {
      const result = await clearMemberContext({
        requestId: mintRequestId(),
        workspaceId: status.member.workspaceId,
        memberId: status.member.memberId,
      })
      await onUpdated()
      if (!result.ok) {
        setRowAlert(t('clearContextFailed', { message: result.error.message }))
        return
      }
      setRowAlert(undefined)
      // The Host recreated the same Session id empty. The resident client
      // window still shows the disposed generation (its `removed` bit is
      // permanent), so the runtime rebuilds the seat from host truth when
      // this Member's Session was embedded — the pane falls back to the
      // blank hero immediately instead of showing stale history.
      if (current === true) refreshMemberSession(status.member.sessionId)
    } catch (cause) {
      setRowAlert(t('clearContextFailed', { message: cause instanceof Error ? cause.message : String(cause) }))
    }
  }
  const contextClearable = status.presence === 'available'
  return (
    <>
      <div className={css.agentRow} data-menu-open={menuOpen || undefined}>
        <button type="button" className={css.agentSelect} aria-label={t('openAgentSession', { name: status.member.handle })} aria-current={current ? 'page' : undefined} disabled={status.availability !== 'active'} onClick={() => { openMemberSession(status.member.sessionId) }}>
          <TeamMemberAvatar status={status} t={t} />
          <span className={css.agentCopy}>
            <strong>{status.member.handle}</strong>
            <small>{status.member.description}</small>
          </span>
        </button>
        <span className={css.rowMenu}>
          <TeamRowMenu
            label={t('actionsAgent', { name: status.member.handle })}
            items={[
              { id: 'edit', label: t('editAgent'), icon: <IconEditOutline16 /> },
              ...(status.presence === 'error' ? [{ id: 'resume', label: t('resumeAgent'), icon: <IconPlayOutline16 /> }] : []),
              ...(status.availability === 'unavailable' ? [{ id: 'restart', label: t('restartAgent'), icon: <IconRefreshOutline16 /> }] : []),
              { id: 'clear-context', label: t('clearContextAgent'), icon: <IconNewChatOutline16 />, danger: true, disabled: !contextClearable },
              ...(!contextClearable ? [{ type: 'label' as const, id: 'clear-context-reason', text: status.presence === 'working' ? t('clearContextWorkingReason') : t('clearContextUnavailableReason') }] : []),
            ]}
            onSelect={(id) => {
              if (id === 'edit') setEditing(true)
              else if (id === 'clear-context') setClearing(true)
              else void recover()
            }}
            onOpenChange={setMenuOpen}
          />
        </span>
      </div>
      {rowAlert !== undefined && <div className={css.rowAlert} role="alert">{rowAlert}</div>}
      {clearing && (
        <Modal
          open
          onClose={() => { setClearing(false) }}
          title={t('clearContextTitle', { name: status.member.handle })}
          closeLabel={t('close')}
          contentClassName={createCss.dialogContent!}
          footer={<>
            <Button variant="outline" onClick={() => { setClearing(false) }}>{t('cancel')}</Button>
            <Button variant="primary" onClick={() => { setClearing(false); void clearContext() }}>{t('clearContextConfirm')}</Button>
          </>}
        >
          <p className={createCss.error}>{t('clearContextNotice', { name: status.member.handle })}</p>
        </Modal>
      )}
      {editing && (
        <AgentEditorDialog
          status={status}
          channels={channels}
          loadChannels={loadChannels}
          updateMember={updateMember}
          joinChannel={joinChannel}
          removeChannelMember={removeChannelMember}
          loadModels={loadModels}
          onCommitted={onUpdated}
          onClose={() => { setEditing(false) }}
          t={t}
        />
      )}
    </>
  )
}
