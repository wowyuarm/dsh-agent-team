import { useEffect, useRef, useState } from 'react'
import type { AgentTeamChannel, AgentTeamChannelMembership, AgentTeamClientMemberStatus, AgentTeamModelSelection, AgentTeamRequestId, AgentTeamUpdateMemberRequest } from '@wowyuarm/dsh-agent-team/types'
import type { TeamModelEffortOption, TeamModelProviderGroup, TeamSidebarProps } from './slots.ts'
import { Button, IconChevronDownOutline14, Input, Menu, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import { useChannelMembership } from './team-membership.ts'
import createCss from './create.module.css'
import css from './sidebar.module.css'

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
export function ModelPickerField({ model, onModelChange, loadModels, disabled, t }: {
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
export function AgentEditorDialog({ status, channels, loadChannels, updateMember, joinChannel, removeChannelMember, loadModels, onCommitted, onClose, t }: {
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

export function sameModel(left: AgentTeamModelSelection | undefined, right: AgentTeamModelSelection | undefined): boolean {
  if (left === undefined && right === undefined) return true
  if (left === undefined || right === undefined) return false
  return left.provider === right.provider && left.model === right.model && left.reasoningEffort === right.reasoningEffort
}
