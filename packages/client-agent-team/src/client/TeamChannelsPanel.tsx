import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AgentTeamAddMemberRequest,
  AgentTeamChannel,
  AgentTeamChannelRef,
  AgentTeamClientMemberStatus,
  AgentTeamCreateChannelRequest,
  AgentTeamJoinChannelRequest,
  AgentTeamMemberId,
  AgentTeamRequestId,
  AgentTeamView,
} from '@wowyuarm/dsh-agent-team/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
import { Button, IconEditOutline16, IconPlusOutline16, Input, Modal, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TeamSidebarProps } from './slots.ts'
import { TeamPresenceDot } from './TeamPresenceDot.tsx'
import { TeamRowMenu } from './TeamRowMenu.tsx'
import { TeamSidebarSection } from './TeamSidebarSection.tsx'
import createCss from './create.module.css'
import css from './sidebar.module.css'

interface TeamChannelsPanelProps {
  readonly workspaceId: WorkspaceId
  readonly loadMembers: TeamSidebarProps['loadMembers']
  readonly loadChannels: TeamSidebarProps['loadChannels']
  /** Membership and channel facts change outside this panel; the workspace scope keeps the list fresh. */
  readonly subscribeChanges: TeamSidebarProps['subscribeChanges']
  readonly createChannel: TeamSidebarProps['createChannel']
  readonly joinChannel: TeamSidebarProps['joinChannel']
  readonly removeChannelMember: TeamSidebarProps['removeChannelMember']
  readonly creatingAgents: readonly AgentTeamAddMemberRequest[]
  readonly selectedChannelRef?: AgentTeamChannelRef
  readonly selectChannel: TeamSidebarProps['selectChannel']
  readonly t: TeamSidebarProps['t']
}

export function TeamChannelsPanel(props: TeamChannelsPanelProps) {
  const { workspaceId, loadMembers, loadChannels, subscribeChanges, createChannel, creatingAgents, selectedChannelRef, selectChannel, t } = props
  const [view, setView] = useState<AgentTeamView>()
  const [members, setMembers] = useState<readonly AgentTeamClientMemberStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [formOpen, setFormOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [selected, setSelected] = useState<ReadonlySet<AgentTeamMemberId>>(new Set())
  const [mutating, setMutating] = useState(false)
  const [pendingCreate, setPendingCreate] = useState<AgentTeamCreateChannelRequest>()
  const previousCreatingKey = useRef(creatingAgents.map(request => request.requestId).join(','))
  const triggerRef = useRef<HTMLButtonElement>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    const [channelResult, memberResult] = await Promise.all([
      loadChannels({ workspaceId, limit: 1 }),
      loadMembers({ workspaceId }),
    ])
    if (channelResult.ok && memberResult.ok) {
      setView(channelResult.value)
      const visibleMembers = memberResult.value.filter(status => status.member.state !== 'inactive')
      setMembers(visibleMembers)
      const selectable = new Set(visibleMembers.filter(status => status.presence !== 'unavailable')
        .map(status => status.member.memberId))
      setSelected(current => new Set([...current].filter(memberId => selectable.has(memberId))))
      setError(undefined)
    } else if (!channelResult.ok) {
      setError(channelResult.error.message)
    } else if (!memberResult.ok) {
      setError(memberResult.error.message)
    }
    setLoading(false)
  }, [loadChannels, loadMembers, workspaceId])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => subscribeChanges({ kind: 'workspace', workspaceId }, update => {
    if (update.type === 'failed') {
      setError(update.message)
      return
    }
    void refresh()
  }), [subscribeChanges, refresh, workspaceId])
  const creatingKey = creatingAgents.map(request => request.requestId).join(',')
  useEffect(() => {
    if (previousCreatingKey.current === creatingKey) return
    previousCreatingKey.current = creatingKey
    void refresh()
  }, [creatingKey, refresh])

  const membership = useMemo(() => {
    const byChannel = new Map<AgentTeamChannelRef, Set<AgentTeamMemberId>>()
    for (const item of view?.members ?? []) {
      const ids = byChannel.get(item.channelRef) ?? new Set<AgentTeamMemberId>()
      ids.add(item.memberId)
      byChannel.set(item.channelRef, ids)
    }
    return byChannel
  }, [view])

  const closeForm = () => {
    if (mutating) return
    setFormOpen(false)
    queueMicrotask(() => { triggerRef.current?.focus() })
  }

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (mutating || name.trim() === '' || description.trim() === '') return
    const payload = { workspaceId, name: name.trim(), description: description.trim(), memberIds: [...selected] }
    const samePending = pendingCreate !== undefined && pendingCreate.workspaceId === payload.workspaceId
      && pendingCreate.name === payload.name && pendingCreate.description === payload.description
      && JSON.stringify(pendingCreate.memberIds) === JSON.stringify(payload.memberIds)
    const request: AgentTeamCreateChannelRequest = samePending ? pendingCreate : {
      requestId: crypto.randomUUID() as AgentTeamRequestId, ...payload,
    }
    setPendingCreate(request)
    setMutating(true)
    setError(undefined)
    try {
      const result = await createChannel(request)
      if (result.ok) {
        setPendingCreate(undefined)
        setName('')
        setDescription('')
        setSelected(new Set())
        setFormOpen(false)
        await refresh()
        queueMicrotask(() => { triggerRef.current?.focus() })
      } else {
        setError(result.error.message)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setMutating(false)
    }
  }

  return (
    <div className={css.panel}>
      <Modal
        open={formOpen}
        onClose={closeForm}
        title={t('addChannel')}
        closeLabel={t('close')}
        contentClassName={createCss.dialogContent!}
        footer={<><Button variant="outline" disabled={mutating} onClick={closeForm}>{t('cancel')}</Button><Button type="submit" form="team-channel-create-form" variant="primary" disabled={mutating || name.trim() === '' || description.trim() === ''}>{mutating ? t('creatingChannel') : t('createChannel')}</Button></>}
      >
        <form id="team-channel-create-form" className={createCss.form} onSubmit={event => { void submit(event) }}>
          <label className={createCss.field}><span>{t('channelName')}</span><Input className={createCss.input!} value={name} disabled={mutating} autoFocus onChange={event => { setName(event.target.value); setPendingCreate(undefined) }} /></label>
          <label className={createCss.field}><span>{t('channelDescription')}</span><Input className={createCss.input!} value={description} disabled={mutating} onChange={event => { setDescription(event.target.value); setPendingCreate(undefined) }} /></label>
          <fieldset className={createCss.memberPicker} disabled={mutating}>
            <legend>{t('initialMembers')}</legend>
            {creatingAgents.map(request => (
              <label className={createCss.memberOption} key={request.requestId}>
                <input type="checkbox" disabled aria-describedby={`creating-member-reason-${request.requestId}`} />
                <span className={createCss.unavailableDot} aria-hidden="true" />
                <span>{request.handle}</span>
                <small id={`creating-member-reason-${request.requestId}`}>{t('memberCreatingReason')}</small>
              </label>
            ))}
            {members.map(status => {
              const disabled = status.presence === 'unavailable'
              const reasonId = `initial-member-reason-${status.member.memberId}`
              return (
                <label className={createCss.memberOption} key={status.member.memberId}>
                  <input type="checkbox" disabled={disabled} aria-describedby={disabled ? reasonId : undefined} checked={selected.has(status.member.memberId)} onChange={event => {
                    setSelected(current => {
                      const next = new Set(current)
                      if (event.target.checked) next.add(status.member.memberId); else next.delete(status.member.memberId)
                      return next
                    })
                    setPendingCreate(undefined)
                  }} />
                  <TeamPresenceDot status={status} t={t} />
                  <span>{status.member.handle}</span>
                  {disabled && <small id={reasonId}>{t('memberUnavailableReason')}</small>}
                </label>
              )
            })}
          </fieldset>
          {error !== undefined && <p className={createCss.error} role="alert">{error}</p>}
        </form>
      </Modal>
      <TeamSidebarSection
        title={t('channels')}
        actions={(
          <Tooltip label={t('addChannel')} delayMs={500}>
            <button ref={triggerRef} type="button" className={css.iconButton} aria-label={t('addChannel')} onClick={() => { setError(undefined); setFormOpen(true) }}>
              <IconPlusOutline16 size={14} />
            </button>
          </Tooltip>
        )}
      >
        {loading && view === undefined && <p className={css.emptyState}>{t('loadingChannels')}</p>}
        {!loading && (view?.channels.length ?? 0) === 0 && <p className={css.emptyState}>{t('emptyChannels')}</p>}
        <div className={css.channelList}>
          {view?.channels.map(channel => {
            const joined = membership.get(channel.channelRef) ?? new Set<AgentTeamMemberId>()
            return (
              <ChannelRow
                key={channel.channelRef}
                channel={channel}
                members={members}
                joinedIds={joined}
                selected={selectedChannelRef === channel.channelRef}
                joinChannel={props.joinChannel}
                removeChannelMember={props.removeChannelMember}
                onCommitted={() => { void refresh() }}
                selectChannel={selectChannel}
                t={t}
              />
            )
          })}
        </div>
      </TeamSidebarSection>
      {!formOpen && error !== undefined && <p className={css.error} role="alert">{error}</p>}
    </div>
  )
}

/**
 * One sidebar Channel row: the select button keeps the `#` identity while the
 * row menu carries the entry point; M1 editing covers membership only.
 */
function ChannelRow({ channel, members, joinedIds, selected, joinChannel, removeChannelMember, onCommitted, selectChannel, t }: {
  readonly channel: AgentTeamChannel
  readonly members: readonly AgentTeamClientMemberStatus[]
  readonly joinedIds: ReadonlySet<AgentTeamMemberId>
  readonly selected: boolean
  readonly joinChannel: TeamSidebarProps['joinChannel']
  readonly removeChannelMember: TeamSidebarProps['removeChannelMember']
  readonly onCommitted: () => Promise<void> | void
  readonly selectChannel: TeamSidebarProps['selectChannel']
  readonly t: TeamSidebarProps['t']
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  return (
    <>
      <article className={css.channelRow} data-menu-open={menuOpen || undefined} aria-current={selected ? 'page' : undefined}>
        <button type="button" className={css.channelSelect} aria-label={`# ${channel.name}`} onClick={() => { selectChannel(channel.channelRef) }}>
          <strong className={css.channelName}># {channel.name}</strong>
        </button>
        <span className={css.rowMenu}>
          <TeamRowMenu
            label={t('actionsChannel', { name: channel.name })}
            items={[{ id: 'edit', label: t('editChannel'), icon: <IconEditOutline16 /> }]}
            onSelect={() => { setEditing(true) }}
            onOpenChange={setMenuOpen}
          />
        </span>
      </article>
      {editing && (
        <ChannelMembershipDialog
          channel={channel}
          members={members}
          joinedIds={joinedIds}
          joinChannel={joinChannel}
          removeChannelMember={removeChannelMember}
          onCommitted={onCommitted}
          onClose={() => { setEditing(false) }}
          t={t}
        />
      )}
    </>
  )
}

/** M1 Channel editor: name and description stay read-only facts; membership commits through the Host. */
function ChannelMembershipDialog({ channel, members, joinedIds, joinChannel, removeChannelMember, onCommitted, onClose, t }: {
  readonly channel: AgentTeamChannel
  readonly members: readonly AgentTeamClientMemberStatus[]
  readonly joinedIds: ReadonlySet<AgentTeamMemberId>
  readonly joinChannel: TeamSidebarProps['joinChannel']
  readonly removeChannelMember: TeamSidebarProps['removeChannelMember']
  readonly onCommitted: () => Promise<void> | void
  readonly onClose: () => void
  readonly t: TeamSidebarProps['t']
}) {
  const [pending, setPending] = useState<ReadonlySet<AgentTeamMemberId>>(new Set())
  const [errors, setErrors] = useState<ReadonlyMap<AgentTeamMemberId, string>>(new Map())
  // Idempotency mirrors the Channel page manager: one stable request per direction+member until it commits.
  const requestIds = useRef(new Map<string, AgentTeamRequestId>())

  const changeMembership = async (memberId: AgentTeamMemberId, joined: boolean): Promise<void> => {
    if (pending.has(memberId)) return
    setPending(current => new Set(current).add(memberId))
    setErrors(current => { const next = new Map(current); next.delete(memberId); return next })
    const key = `${joined ? 'remove' : 'join'}:${memberId}:${channel.channelRef}`
    const requestId = requestIds.current.get(key) ?? crypto.randomUUID() as AgentTeamRequestId
    requestIds.current.set(key, requestId)
    const request: AgentTeamJoinChannelRequest = { requestId, workspaceId: channel.workspaceId, channelRef: channel.channelRef, memberId }
    try {
      const result = joined ? await removeChannelMember(request) : await joinChannel(request)
      if (result.ok) {
        requestIds.current.delete(key)
        await onCommitted()
      } else {
        setErrors(current => new Map(current).set(memberId, result.error.message))
      }
    } catch (cause) {
      setErrors(current => new Map(current).set(memberId, cause instanceof Error ? cause.message : String(cause)))
    } finally {
      setPending(current => { const next = new Set(current); next.delete(memberId); return next })
    }
  }

  return (
    <Modal open onClose={onClose} title={t('editChannel')} description={`# ${channel.name}`} closeLabel={t('close')} contentClassName={createCss.dialogContent!}>
      <p className={css.editDescription}>{channel.description}</p>
      <div className={css.editMemberList}>
        {members.map(status => {
          const joined = joinedIds.has(status.member.memberId)
          const rowPending = pending.has(status.member.memberId)
          const disabled = rowPending || (!joined && status.presence === 'unavailable')
          const rowError = errors.get(status.member.memberId)
          return <div className={css.editMemberRow} key={status.member.memberId}>
            <TeamPresenceDot status={status} t={t} />
            <span className={css.editMemberCopy}><strong>@{status.member.handle}</strong><small>{status.member.description}</small></span>
            <Button size="sm" variant="outline" disabled={disabled} onClick={() => { void changeMembership(status.member.memberId, joined) }}>{rowPending ? t('membershipUpdating') : joined ? t('removeFromChannel') : t('addToChannel')}</Button>
            {rowError !== undefined && <p className={css.rowError} role="alert">{rowError}</p>}
          </div>
        })}
      </div>
    </Modal>
  )
}
