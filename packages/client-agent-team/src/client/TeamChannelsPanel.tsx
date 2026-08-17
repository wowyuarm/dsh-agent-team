import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AgentTeamAddMemberRequest,
  AgentTeamAgentMemberStatus,
  AgentTeamChannelRef,
  AgentTeamCreateChannelRequest,
  AgentTeamMemberId,
  AgentTeamRequestId,
  AgentTeamView,
} from '@deepseek-ai/dsh-agent-team/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
import type { TeamSidebarProps } from './slots.ts'
import { TeamPresenceDot } from './TeamPresenceDot.tsx'
import css from './sidebar.module.css'

interface TeamChannelsPanelProps {
  readonly workspaceId: WorkspaceId
  readonly loadMembers: TeamSidebarProps['loadMembers']
  readonly loadChannels: TeamSidebarProps['loadChannels']
  readonly createChannel: TeamSidebarProps['createChannel']
  readonly joinChannel: TeamSidebarProps['joinChannel']
  readonly removeChannelMember: TeamSidebarProps['removeChannelMember']
  readonly creatingAgents: readonly AgentTeamAddMemberRequest[]
  readonly selectedChannelRef?: AgentTeamChannelRef
  readonly selectChannel: TeamSidebarProps['selectChannel']
  readonly t: TeamSidebarProps['t']
}

export function TeamChannelsPanel(props: TeamChannelsPanelProps) {
  const { workspaceId, loadMembers, loadChannels, createChannel, joinChannel, removeChannelMember, creatingAgents, selectedChannelRef, selectChannel, t } = props
  const [view, setView] = useState<AgentTeamView>()
  const [members, setMembers] = useState<readonly AgentTeamAgentMemberStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [formOpen, setFormOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [selected, setSelected] = useState<ReadonlySet<AgentTeamMemberId>>(new Set())
  const [mutating, setMutating] = useState(false)
  const [managing, setManaging] = useState<AgentTeamChannelRef>()
  const [pendingCreate, setPendingCreate] = useState<AgentTeamCreateChannelRequest>()
  const pendingMembership = useRef(new Map<string, AgentTeamRequestId>())
  const previousCreatingKey = useRef(creatingAgents.map(request => request.requestId).join(','))

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
      } else {
        setError(result.error.message)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setMutating(false)
    }
  }

  const changeMembership = async (channelRef: AgentTeamChannelRef, memberId: AgentTeamMemberId, joined: boolean) => {
    if (mutating) return
    setMutating(true)
    setError(undefined)
    const key = `${joined ? 'remove' : 'join'}:${channelRef}:${memberId}`
    const requestId = pendingMembership.current.get(key) ?? crypto.randomUUID() as AgentTeamRequestId
    pendingMembership.current.set(key, requestId)
    const request = { requestId, workspaceId, channelRef, memberId }
    try {
      const result = joined ? await removeChannelMember(request) : await joinChannel(request)
      if (result.ok) {
        pendingMembership.current.delete(key)
        await refresh()
      }
      else setError(result.error.message)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setMutating(false)
    }
  }

  return (
    <div className={css.panel}>
      <div className={css.panelToolbar}>
        <span>{t('channels')}</span>
        <button type="button" className={css.textButton} onClick={() => { setFormOpen(open => !open) }}>
          {formOpen ? t('cancel') : t('addChannel')}
        </button>
      </div>
      {formOpen && (
        <form className={css.agentForm} onSubmit={event => { void submit(event) }}>
          <label><span>{t('channelName')}</span><input value={name} disabled={mutating} autoFocus onChange={event => { setName(event.target.value) }} /></label>
          <label><span>{t('channelDescription')}</span><textarea value={description} disabled={mutating} rows={3} onChange={event => { setDescription(event.target.value) }} /></label>
          <fieldset className={css.memberPicker} disabled={mutating}>
            <legend>{t('initialMembers')}</legend>
            {creatingAgents.map(request => (
              <label key={request.requestId}>
                <input type="checkbox" disabled aria-describedby={`creating-member-reason-${request.requestId}`} />
                <span className={css.unavailableDot} aria-hidden="true" />
                <span>{request.handle}</span>
                <small id={`creating-member-reason-${request.requestId}`}>{t('memberCreatingReason')}</small>
              </label>
            ))}
            {members.map(status => {
              const disabled = status.presence === 'unavailable'
              const reasonId = `initial-member-reason-${status.member.memberId}`
              return (
                <label key={status.member.memberId}>
                  <input type="checkbox" disabled={disabled} aria-describedby={disabled ? reasonId : undefined} checked={selected.has(status.member.memberId)} onChange={event => {
                    setSelected(current => {
                      const next = new Set(current)
                      if (event.target.checked) next.add(status.member.memberId); else next.delete(status.member.memberId)
                      return next
                    })
                  }} />
                  <TeamPresenceDot status={status} t={t} />
                  <span>{status.member.handle}</span>
                  {disabled && <small id={reasonId}>{t('memberUnavailableReason')}</small>}
                </label>
              )
            })}
          </fieldset>
          <button type="submit" className={css.primaryButton} disabled={mutating || name.trim() === '' || description.trim() === ''}>
            {mutating ? t('creatingChannel') : t('createChannel')}
          </button>
        </form>
      )}
      {loading && view === undefined && <p className={css.emptyState}>{t('loadingChannels')}</p>}
      {!loading && (view?.channels.length ?? 0) === 0 && <p className={css.emptyState}>{t('emptyChannels')}</p>}
      <div className={css.channelList}>
        {view?.channels.map(channel => {
          const joined = membership.get(channel.channelRef) ?? new Set<AgentTeamMemberId>()
          const manageOpen = managing === channel.channelRef
          return (
            <article className={css.channelRow} key={channel.channelRef} aria-current={selectedChannelRef === channel.channelRef ? 'page' : undefined}>
              <button type="button" className={css.channelSelect} onClick={() => { selectChannel(channel.channelRef) }}>
                <strong className={css.channelName}># {channel.name}</strong>
                <small className={css.channelDescription}>{channel.description}</small>
                <small className={css.channelCount}>{joined.size}</small>
              </button>
              <button type="button" className={`${css.textButton} ${css.channelManage}`} aria-expanded={manageOpen} onClick={() => { setManaging(manageOpen ? undefined : channel.channelRef) }}>{t('manageMembers')}</button>
              {manageOpen && (
                <div className={css.memberManager} aria-label={t('manageMembers')}>
                  {members.map(status => {
                    const isJoined = joined.has(status.member.memberId)
                    const disabled = mutating || (!isJoined && status.presence === 'unavailable')
                    const reasonId = `manage-member-reason-${channel.channelRef}-${status.member.memberId}`
                    return (
                      <div key={status.member.memberId}>
                        <TeamPresenceDot status={status} t={t} />
                        <span>{status.member.handle}</span>
                        {!isJoined && status.presence === 'unavailable' && <small id={reasonId}>{t('memberUnavailableReason')}</small>}
                        <button type="button" className={css.textButton} disabled={disabled} aria-describedby={!isJoined && status.presence === 'unavailable' ? reasonId : undefined} onClick={() => { void changeMembership(channel.channelRef, status.member.memberId, isJoined) }}>
                          {isJoined ? t('removeFromChannel') : t('addToChannel')}
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </article>
          )
        })}
      </div>
      {error !== undefined && <p className={css.error} role="alert">{error}</p>}
    </div>
  )
}
