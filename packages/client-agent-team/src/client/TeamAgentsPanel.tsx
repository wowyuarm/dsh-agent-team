import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AgentTeamAddMemberRequest,
  AgentTeamChannelRef,
  AgentTeamClientMemberStatus,
  AgentTeamModelSelection,
  AgentTeamChannel,
  AgentTeamChannelMembership,
  AgentTeamRequestId,
  AgentTeamUpdateMemberRequest,
} from '@wowyuarm/dsh-agent-team/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
import { Button, IconChevronDownOutline14, IconChevronUpOutline14, IconEditOutline16, IconPlayOutline16, IconPlusOutline16, Input, Menu, Modal, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TeamModelEffortOption, TeamModelProviderGroup, TeamSidebarProps } from './slots.ts'
import { TeamMemberAvatar } from './TeamMemberAvatar.tsx'
import { SortableRow, useSidebarRowDrag } from './sidebar-drag.tsx'
import { moveSidebarItem, useSidebarOrder } from './sidebar-order.ts'
import { TeamRowMenu } from './TeamRowMenu.tsx'
import { TeamSidebarSection } from './TeamSidebarSection.tsx'
import { MultiMenuField } from './multi-menu-field.tsx'
import { useChannelMembership } from './team-membership.ts'
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
  readonly joinChannel: TeamSidebarProps['joinChannel']
  readonly removeChannelMember: TeamSidebarProps['removeChannelMember']
  readonly loadModels: TeamSidebarProps['loadModels']
  /** The Member Session currently embedded in the conversation seat, if any. */
  readonly memberSessionId?: AgentTeamClientMemberStatus['member']['sessionId']
  readonly openMemberSession: TeamSidebarProps['openMemberSession']
  readonly onCreatingChange: (request: AgentTeamAddMemberRequest, creating: boolean) => void
  readonly t: TeamSidebarProps['t']
}

export function TeamAgentsPanel({ workspaceId, loadMembers, subscribeChanges, loadChannels, addMember, updateMember, recoverMember, joinChannel, removeChannelMember, loadModels, memberSessionId, openMemberSession, onCreatingChange, t }: TeamAgentsPanelProps) {
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
  // Same presentation-preference ordering as the Channels list; both the drag
  // and the row-menu steps funnel through one shared mutation.
  const [announcement, setAnnouncement] = useState<string>()
  const agentRefs = useMemo(() => members.map(status => status.member.memberId), [members])
  const orderedAgentRefs = useSidebarOrder(workspaceId, 'agents', agentRefs)
  const orderedMembers = useMemo(() => {
    const byId = new Map(members.map(status => [status.member.memberId, status]))
    return orderedAgentRefs.map(memberId => byId.get(memberId)).filter(status => status !== undefined)
  }, [orderedAgentRefs, members])
  const applyMove = (movedRef: typeof agentRefs[number], targetRef: typeof agentRefs[number], marker: 'before' | 'after'): void => {
    const next = moveSidebarItem(workspaceId, 'agents', orderedAgentRefs, movedRef, targetRef, marker)
    if (next !== undefined) setAnnouncement(t('movedToPosition', { position: (next.indexOf(movedRef) ?? 0) + 1 }))
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
      requestId: crypto.randomUUID() as AgentTeamRequestId,
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
          {orderedMembers.map((status, index) => (
            <SortableRow key={status.member.memberId} drag={drag} orderKey={status.member.memberId}>
              <AgentRow status={status} {...(memberSessionId === undefined ? {} : { current: status.member.sessionId === memberSessionId })} channels={channels} loadChannels={loadChannels} updateMember={updateMember} recoverMember={recoverMember} joinChannel={joinChannel} removeChannelMember={removeChannelMember} loadModels={loadModels} openMemberSession={openMemberSession} onUpdated={() => { void refresh() }} index={index} count={orderedMembers.length}
                onMoveStep={(marker): void => {
                  const position = orderedAgentRefs.indexOf(status.member.memberId)
                  const neighbor = marker === 'before' ? orderedAgentRefs[position - 1] : orderedAgentRefs[position + 1]
                  if (neighbor !== undefined) applyMove(status.member.memberId, neighbor, marker)
                }} t={t} />
            </SortableRow>
          ))}
        </div>
      </TeamSidebarSection>
      {announcement !== undefined && <p className={css.statusLine} role="status">{announcement}</p>}
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
function AgentRow({ status, current, channels, loadChannels, updateMember, recoverMember, joinChannel, removeChannelMember, loadModels, openMemberSession, onUpdated, index, count, onMoveStep, t }: {
  readonly status: AgentTeamClientMemberStatus
  /** This Member's Session is the one embedded in the conversation seat. */
  readonly current?: boolean
  readonly channels: readonly AgentTeamChannel[]
  readonly loadChannels: TeamSidebarProps['loadChannels']
  readonly updateMember: TeamSidebarProps['updateMember']
  readonly recoverMember: TeamSidebarProps['recoverMember']
  readonly joinChannel: TeamSidebarProps['joinChannel']
  readonly removeChannelMember: TeamSidebarProps['removeChannelMember']
  readonly loadModels: TeamSidebarProps['loadModels']
  readonly openMemberSession: TeamSidebarProps['openMemberSession']
  readonly onUpdated: () => Promise<void> | void
  /** Position inside the current personal order; drives keyboard reordering. */
  readonly index: number
  readonly count: number
  readonly onMoveStep: (marker: 'before' | 'after') => void
  readonly t: TeamSidebarProps['t']
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const resume = async (): Promise<void> => {
    await recoverMember({
      requestId: crypto.randomUUID() as AgentTeamRequestId,
      workspaceId: status.member.workspaceId,
      memberId: status.member.memberId,
    })
    await onUpdated()
  }
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
              { id: 'up', label: t('moveUp'), icon: <IconChevronUpOutline14 />, disabled: index === 0 },
              { id: 'down', label: t('moveDown'), icon: <IconChevronDownOutline14 />, disabled: index === count - 1 },
              { id: 'edit', label: t('editAgent'), icon: <IconEditOutline16 /> },
              ...(status.presence === 'error' ? [{ id: 'resume', label: t('resumeAgent'), icon: <IconPlayOutline16 /> }] : []),
            ]}
            onSelect={(id) => {
              if (id === 'up') return onMoveStep('before')
              if (id === 'down') return onMoveStep('after')
              if (id === 'resume') void resume()
              else setEditing(true)
            }}
            onOpenChange={setMenuOpen}
          />
        </span>
      </div>
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

/** Model option key inside one editor; opaque and resolved against the loaded groups. */
function modelKey(provider: string, model: string): string {
  return `${provider}\u0000${model}`
}

/**
 * Shared provider/model dropdown for the create and edit forms. The option
 * list rides the shared Menu primitive (one leading "follow Host default"
 * row, then non-selectable provider headings) with a capped, internally
 * scrolling card so growing model catalogs cannot stretch the dialog.
 */
function ModelPickerField({ model, onModelChange, loadModels, disabled, t }: {
  readonly model: AgentTeamModelSelection | undefined
  readonly onModelChange: (choice: AgentTeamModelSelection | undefined) => void
  readonly loadModels: TeamSidebarProps['loadModels']
  readonly disabled: boolean
  readonly t: TeamSidebarProps['t']
}) {
  const [groups, setGroups] = useState<readonly TeamModelProviderGroup[]>()
  const [modelsError, setModelsError] = useState<string>()
  const [open, setModelOpen] = useState(false)
  const [effortOpen, setEffortOpen] = useState(false)
  useEffect(() => {
    let mounted = true
    void loadModels().then(result => {
      if (!mounted) return
      if (result.ok) {
        setGroups(result.value.groups)
        setModelsError(undefined)
      } else {
        setModelsError(result.error.message)
      }
    })
    return () => { mounted = false }
  }, [loadModels])

  const items: MenuEntry[] = [{ id: '', label: t('modelFollowDefault') }]
  const byKey = new Map<string, { provider: string; id: string; name: string; efforts: readonly TeamModelEffortOption[] }>()
  for (const group of groups ?? []) {
    items.push({ type: 'label', id: `model-group:${group.id}`, text: group.name })
    for (const entry of group.models) {
      const key = modelKey(group.id, entry.id)
      byKey.set(key, { provider: group.id, id: entry.id, name: entry.name, efforts: entry.reasoning?.efforts ?? [] })
      items.push({ id: key, label: entry.name })
    }
  }
  const selectedModelKey = model === undefined ? '' : modelKey(model.provider, model.model)
  const triggerLabel = model === undefined
    ? t('modelFollowDefault')
    : byKey.get(selectedModelKey)?.name ?? `${model.provider} / ${model.model}`
  // The effort sub-row only makes sense for a pinned model with adapter-exposed
  // efforts; following the Host default inherits the operator's whole selection.
  const efforts = model === undefined ? [] : byKey.get(selectedModelKey)?.efforts ?? []
  const effortItems: MenuEntry[] = [{ id: '', label: t('effortFollowDefault') }, ...efforts.map(effort => ({ id: effort.id, label: effort.name }))]
  const selectedEffort = model?.reasoningEffort ?? ''
  const effortTriggerLabel = model === undefined || selectedEffort === ''
    ? t('effortFollowDefault')
    : efforts.find(effort => effort.id === selectedEffort)?.name ?? selectedEffort

  return <div className={createCss.field}>
    <span>{t('memberModel')}</span>
    {groups === undefined && modelsError === undefined && <small className={css.editHint}>{t('modelsLoading')}</small>}
    {modelsError !== undefined && <small className={css.editHint}>{t('modelsLoadFailed', { message: modelsError })}</small>}
    {groups !== undefined && (
      <Menu
        open={open}
        portal
        className={createCss.menuCap!}
        items={items}
        selectedId={selectedModelKey}
        onSelect={key => {
          setModelOpen(false)
          const choice = byKey.get(key)
          onModelChange(choice === undefined ? undefined : { provider: choice.provider, model: choice.id })
        }}
        onClose={() => { setModelOpen(false) }}
        anchor={
          <button
            type="button"
            className={createCss.selectTrigger!}
            aria-label={t('memberModel')}
            aria-haspopup="listbox"
            aria-expanded={open}
            disabled={disabled}
            onClick={() => { setModelOpen(value => !value) }}
          >
            <span className={createCss.selectValue}>{triggerLabel}</span>
            <span className={`${createCss.chevron!} ${open ? createCss.chevronOpen! : ''}`} aria-hidden><IconChevronDownOutline14 /></span>
          </button>
        }
      />
    )}
    {model !== undefined && efforts.length > 0 && (
      <Menu
        open={effortOpen}
        portal
        className={createCss.menuCap!}
        items={effortItems}
        selectedId={selectedEffort}
        onSelect={key => {
          setEffortOpen(false)
          onModelChange(key === ''
            ? { provider: model.provider, model: model.model }
            : { provider: model.provider, model: model.model, reasoningEffort: key as NonNullable<AgentTeamModelSelection['reasoningEffort']> })
        }}
        onClose={() => { setEffortOpen(false) }}
        anchor={
          <button
            type="button"
            className={createCss.selectTrigger!}
            aria-label={t('reasoningEffort')}
            aria-haspopup="listbox"
            aria-expanded={effortOpen}
            disabled={disabled}
            onClick={() => { setEffortOpen(value => !value) }}
          >
            <span className={createCss.selectValue}>{`${t('reasoningEffort')} · ${effortTriggerLabel}`}</span>
            <span className={`${createCss.chevron!} ${effortOpen ? createCss.chevronOpen! : ''}`} aria-hidden><IconChevronDownOutline14 /></span>
          </button>
        }
      />
    )}
  </div>
}

/**
 * Agent editor: handle, description, and per-Member model selection commit
 * through one durable update; Channel membership below keeps its own
 * immediate add/remove flow.
 */
function AgentEditorDialog({ status, channels, loadChannels, updateMember, joinChannel, removeChannelMember, loadModels, onCommitted, onClose, t }: {
  readonly status: AgentTeamClientMemberStatus
  readonly channels: readonly AgentTeamChannel[]
  readonly loadChannels: TeamSidebarProps['loadChannels']
  readonly updateMember: TeamSidebarProps['updateMember']
  readonly joinChannel: TeamSidebarProps['joinChannel']
  readonly removeChannelMember: TeamSidebarProps['removeChannelMember']
  readonly loadModels: TeamSidebarProps['loadModels']
  readonly onCommitted: () => Promise<void> | void
  readonly onClose: () => void
  readonly t: TeamSidebarProps['t']
}) {
  const memberId = status.member.memberId
  const [handle, setHandle] = useState(status.member.handle)
  const [description, setDescription] = useState(status.member.description)
  const [model, setModel] = useState<AgentTeamModelSelection | undefined>(status.member.model)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const pendingRequest = useRef<AgentTeamUpdateMemberRequest>()
  // Membership comes from a fresh projection at open time so stale checkbox
  // state never flips a committed fact backwards.
  const [memberships, setMemberships] = useState<readonly AgentTeamChannelMembership[]>()
  const [loadError, setLoadError] = useState<string>()

  useEffect(() => {
    let mounted = true
    void loadChannels({ workspaceId: status.member.workspaceId, topLevelOnly: true, includeActivities: false, limit: 1 }).then(result => {
      if (!mounted) return
      if (result.ok) {
        setMemberships(result.value.members)
        setLoadError(undefined)
      } else {
        setLoadError(result.error.message)
      }
    })
    return () => { mounted = false }
  }, [loadChannels, status.member.workspaceId])

  const membership = useChannelMembership(
    { joinChannel, removeChannelMember },
    change => change.channelRef,
    change => {
      setMemberships(current => {
        const base = current ?? []
        return change.joined
          ? base.filter(item => !(item.channelRef === change.channelRef && item.memberId === change.memberId))
          : [...base, { channelRef: change.channelRef, memberId: change.memberId }]
      })
    },
  )

  // A successful join appends the durable fact; removal filters it out above.
  const joinedChannels = new Set((memberships ?? []).filter(item => item.memberId === memberId).map(item => item.channelRef))

  const dirty = handle.trim() !== status.member.handle || description.trim() !== status.member.description
    || !sameModel(model, status.member.model)
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const normalizedHandle = handle.trim()
    const normalizedDescription = description.trim()
    if (saving || !dirty || normalizedHandle.length === 0) return
    const payload = {
      memberId,
      handle: normalizedHandle,
      description: normalizedDescription,
      ...(model === undefined ? {} : { model }),
    }
    const samePending = pendingRequest.current !== undefined && pendingRequest.current.memberId === payload.memberId
      && pendingRequest.current.handle === payload.handle && pendingRequest.current.description === payload.description
      && sameModel(pendingRequest.current.model, model)
    const request: AgentTeamUpdateMemberRequest = samePending ? pendingRequest.current! : {
      requestId: crypto.randomUUID() as AgentTeamRequestId,
      ...payload,
    }
    pendingRequest.current = request
    setSaving(true)
    setError(undefined)
    try {
      const result = await updateMember(request)
      if (result.ok) {
        pendingRequest.current = undefined
        await onCommitted()
        onClose()
      } else {
        setError(result.error.message)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t('editAgent')}
      description={`@${status.member.handle}`}
      closeLabel={t('close')}
      contentClassName={createCss.dialogContent!}
      footer={<><Button variant="outline" disabled={saving} onClick={onClose}>{t('cancel')}</Button><Button type="submit" form="team-agent-edit-form" variant="primary" disabled={saving || !dirty || handle.trim().length === 0}>{saving ? t('editSaving') : t('editSave')}</Button></>}
    >
      <form id="team-agent-edit-form" className={createCss.form} onSubmit={event => { void submit(event) }}>
        <label className={createCss.field}>
          <span>{t('agentName')}</span>
          <Input className={createCss.input!} value={handle} onChange={event => { setHandle(event.target.value); pendingRequest.current = undefined }} disabled={saving} autoFocus />
        </label>
        <label className={createCss.field}>
          <span>{t('agentDescription')}{t('optionalSuffix')}</span>
          <Input className={createCss.input!} value={description} placeholder={t('agentDescriptionPlaceholder')} onChange={event => { setDescription(event.target.value); pendingRequest.current = undefined }} disabled={saving} />
        </label>
        <ModelPickerField model={model} onModelChange={choice => { pendingRequest.current = undefined; setModel(choice) }} loadModels={loadModels} disabled={saving} t={t} />
        <fieldset className={createCss.memberPicker} disabled={saving}>
          <legend>{t('channelMembersSection')}</legend>
          {channels.map(channel => {
            const joined = joinedChannels.has(channel.channelRef)
            const rowPending = membership.pending.has(channel.channelRef)
            const disabled = rowPending || (!joined && status.presence === 'unavailable')
            const rowError = membership.errors.get(channel.channelRef)
            return <div className={`${css.editMemberRow} ${css.editMemberRowChannels}`} key={channel.channelRef}>
              <strong className={css.editChannelName}># {channel.name}</strong>
              <Button size="sm" variant="outline" disabled={disabled} onClick={() => { void membership.change({ workspaceId: status.member.workspaceId, channelRef: channel.channelRef, memberId, joined }) }}>{rowPending ? t('membershipUpdating') : joined ? t('removeFromChannel') : t('addToChannel')}</Button>
              {rowError !== undefined && <p className={css.rowError} role="alert">{rowError}</p>}
            </div>
          })}
          {channels.length === 0 && <small>{t('noChannelsForAgent')}</small>}
          {loadError !== undefined && <p className={css.rowError} role="alert">{loadError}</p>}
        </fieldset>
        {error !== undefined && <p className={createCss.error} role="alert">{error}</p>}
      </form>
    </Modal>
  )
}

function sameModel(left: AgentTeamModelSelection | undefined, right: AgentTeamModelSelection | undefined): boolean {
  if (left === undefined && right === undefined) return true
  if (left === undefined || right === undefined) return false
  return left.provider === right.provider && left.model === right.model && left.reasoningEffort === right.reasoningEffort
}
