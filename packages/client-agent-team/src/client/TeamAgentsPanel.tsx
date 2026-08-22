import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  AgentTeamAddMemberRequest,
  AgentTeamClientMemberStatus,
  AgentTeamChannel,
  AgentTeamChannelMembership,
  AgentTeamRequestId,
} from '@wowyuarm/dsh-agent-team/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
import { Button, IconEditOutline16, IconPlusOutline16, Input, Modal, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TeamSidebarProps } from './slots.ts'
import { TeamMemberAvatar } from './TeamMemberAvatar.tsx'
import { TeamRowMenu } from './TeamRowMenu.tsx'
import { TeamSidebarSection } from './TeamSidebarSection.tsx'
import { useChannelMembership } from './team-membership.ts'
import createCss from './create.module.css'
import css from './sidebar.module.css'

interface TeamAgentsPanelProps {
  readonly workspaceId: WorkspaceId
  readonly loadMembers: TeamSidebarProps['loadMembers']
  readonly subscribeChanges: TeamSidebarProps['subscribeChanges']
  readonly loadChannels: TeamSidebarProps['loadChannels']
  readonly addMember: TeamSidebarProps['addMember']
  readonly joinChannel: TeamSidebarProps['joinChannel']
  readonly removeChannelMember: TeamSidebarProps['removeChannelMember']
  readonly onCreatingChange: (request: AgentTeamAddMemberRequest, creating: boolean) => void
  readonly t: TeamSidebarProps['t']
}

export function TeamAgentsPanel({ workspaceId, loadMembers, subscribeChanges, loadChannels, addMember, joinChannel, removeChannelMember, onCreatingChange, t }: TeamAgentsPanelProps) {
  const [members, setMembers] = useState<readonly AgentTeamClientMemberStatus[]>([])
  const [channels, setChannels] = useState<readonly AgentTeamChannel[]>([])
  const [channelRefs, setChannelRefs] = useState<AgentTeamAddMemberRequest['channelRefs']>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [formOpen, setFormOpen] = useState(false)
  const [handle, setHandle] = useState('')
  const [description, setDescription] = useState('')
  const [creating, setCreating] = useState(false)
  const [retryRequest, setRetryRequest] = useState<AgentTeamAddMemberRequest>()
  const triggerRef = useRef<HTMLButtonElement>(null)

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
    if (normalizedHandle.length === 0 || normalizedDescription.length === 0 || creating) return
    if (channelRefs.length === 0) return
    const sameRequest = retryRequest !== undefined && retryRequest.workspaceId === workspaceId
      && retryRequest.handle === normalizedHandle && retryRequest.description === normalizedDescription
      && retryRequest.channelRefs.length === channelRefs.length && retryRequest.channelRefs.every(ref => channelRefs.includes(ref))
    void provision(sameRequest ? retryRequest : {
      requestId: crypto.randomUUID() as AgentTeamRequestId,
      workspaceId,
      handle: normalizedHandle,
      description: normalizedDescription,
      presetId: 'team-member',
      channelRefs,
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
        footer={<><Button variant="outline" disabled={creating} onClick={closeForm}>{t('cancel')}</Button><Button type="submit" form="team-agent-create-form" variant="primary" disabled={creating || handle.trim().length === 0 || description.trim().length === 0 || channelRefs.length === 0}>{creating ? t('creatingAgent') : t('createAgent')}</Button></>}
      >
        <form id="team-agent-create-form" className={createCss.form} onSubmit={submit}>
          <label className={createCss.field}>
            <span>{t('agentName')}</span>
            <Input className={createCss.input!} value={handle} onChange={event => { setHandle(event.target.value); setRetryRequest(undefined) }} disabled={creating} autoFocus />
          </label>
          <label className={createCss.field}>
            <span>{t('agentDescription')}</span>
            <Input className={createCss.input!} value={description} onChange={event => { setDescription(event.target.value); setRetryRequest(undefined) }} disabled={creating} />
          </label>
          <fieldset className={createCss.field}>
            <legend>{t('initialChannels')}</legend>
            {channels.length === 0 ? <span>{t('noChannelsForAgent')}</span> : channels.map(channel => <label key={channel.channelRef}>
              <input type="checkbox" checked={channelRefs.includes(channel.channelRef)} disabled={creating} onChange={event => {
                setChannelRefs(current => event.target.checked ? [...current, channel.channelRef] : current.filter(ref => ref !== channel.channelRef))
                setRetryRequest(undefined)
              }} /> {channel.name}
            </label>)}
          </fieldset>
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
          {members.map(status => (
            <AgentRow key={status.member.memberId} status={status} channels={channels} loadChannels={loadChannels} joinChannel={joinChannel} removeChannelMember={removeChannelMember} t={t} />
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
 * One sidebar Agent row: avatar carries identity plus the presence badge, the
 * copy keeps handle and description snippet, and the row menu opens the editor.
 */
function AgentRow({ status, channels, loadChannels, joinChannel, removeChannelMember, t }: {
  readonly status: AgentTeamClientMemberStatus
  readonly channels: readonly AgentTeamChannel[]
  readonly loadChannels: TeamSidebarProps['loadChannels']
  readonly joinChannel: TeamSidebarProps['joinChannel']
  readonly removeChannelMember: TeamSidebarProps['removeChannelMember']
  readonly t: TeamSidebarProps['t']
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  return (
    <>
      <div className={css.agentRow} data-menu-open={menuOpen || undefined}>
        <TeamMemberAvatar status={status} t={t} />
        <span className={css.agentCopy}>
          <strong>{status.member.handle}</strong>
          <small>{status.member.description}</small>
        </span>
        <span className={css.rowMenu}>
          <TeamRowMenu
            label={t('actionsAgent', { name: status.member.handle })}
            items={[{ id: 'edit', label: t('editAgent'), icon: <IconEditOutline16 /> }]}
            onSelect={() => { setEditing(true) }}
            onOpenChange={setMenuOpen}
          />
        </span>
      </div>
      {editing && (
        <AgentMembershipDialog
          status={status}
          channels={channels}
          loadChannels={loadChannels}
          joinChannel={joinChannel}
          removeChannelMember={removeChannelMember}
          onClose={() => { setEditing(false) }}
          t={t}
        />
      )}
    </>
  )
}

/** M1 Agent editor: identity fields stay read-only facts; Channel membership commits through the Host. */
function AgentMembershipDialog({ status, channels, loadChannels, joinChannel, removeChannelMember, onClose, t }: {
  readonly status: AgentTeamClientMemberStatus
  readonly channels: readonly AgentTeamChannel[]
  readonly loadChannels: TeamSidebarProps['loadChannels']
  readonly joinChannel: TeamSidebarProps['joinChannel']
  readonly removeChannelMember: TeamSidebarProps['removeChannelMember']
  readonly onClose: () => void
  readonly t: TeamSidebarProps['t']
}) {
  const memberId = status.member.memberId
  // Membership comes from a fresh projection at open time so stale checkbox
  // state never flips a committed fact backwards.
  const [memberships, setMemberships] = useState<readonly AgentTeamChannelMembership[]>()
  const [loadError, setLoadError] = useState<string>()
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    void loadChannels({ workspaceId: status.member.workspaceId, topLevelOnly: true, includeActivities: false, limit: 1 }).then(result => {
      if (!mounted.current) return
      if (result.ok) {
        setMemberships(result.value.members)
        setLoadError(undefined)
      } else {
        setLoadError(result.error.message)
      }
    })
    return () => { mounted.current = false }
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

  return (
    <Modal open onClose={onClose} title={t('editAgent')} description={`@${status.member.handle}`} closeLabel={t('close')} contentClassName={createCss.dialogContent!}>
      <p className={css.editDescription}>{status.member.description}</p>
      <div className={css.editMemberList}>
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
      </div>
      {(loadError ?? undefined) !== undefined && <p className={css.rowError} role="alert">{loadError}</p>}
    </Modal>
  )
}
