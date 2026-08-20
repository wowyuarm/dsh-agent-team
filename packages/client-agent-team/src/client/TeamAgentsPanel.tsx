import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  AgentTeamAddMemberRequest,
  AgentTeamClientMemberStatus,
  AgentTeamChannel,
  AgentTeamRequestId,
} from '@deepseek-ai/dsh-agent-team/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
import { Button, IconPlusOutline16, Input, Modal, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TeamSidebarProps } from './slots.ts'
import { presenceLabel, TeamPresenceDot } from './TeamPresenceDot.tsx'
import createCss from './create.module.css'
import css from './sidebar.module.css'

interface TeamAgentsPanelProps {
  readonly workspaceId: WorkspaceId
  readonly loadMembers: TeamSidebarProps['loadMembers']
  readonly loadChannels: TeamSidebarProps['loadChannels']
  readonly addMember: TeamSidebarProps['addMember']
  readonly onCreatingChange: (request: AgentTeamAddMemberRequest, creating: boolean) => void
  readonly t: TeamSidebarProps['t']
}

export function TeamAgentsPanel({ workspaceId, loadMembers, loadChannels, addMember, onCreatingChange, t }: TeamAgentsPanelProps) {
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
  useEffect(() => {
    let active = true
    void loadChannels({ workspaceId, topLevelOnly: true, includeActivities: false, limit: 1 }).then(result => {
      if (!active || !result.ok) return
      setChannels(result.value.channels)
    })
    return () => { active = false }
  }, [loadChannels, workspaceId])

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
          setRetryRequest(request)
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
      <div className={css.panelToolbar}>
        <span>{t('agents')}</span>
        <Tooltip label={t('addAgent')} delayMs={500}>
          <button ref={triggerRef} type="button" className={css.iconButton} aria-label={t('addAgent')} onClick={() => { setError(undefined); setFormOpen(true) }}>
            <IconPlusOutline16 size={14} />
          </button>
        </Tooltip>
      </div>
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
      {loading && members.length === 0 && <p className={css.emptyState}>{t('loadingAgents')}</p>}
      {!loading && members.length === 0 && <p className={css.emptyState}>{t('emptyAgents')}</p>}
      <div className={css.agentList}>
        {members.map(status => (
          <div className={css.agentRow} key={status.member.memberId}>
            <TeamPresenceDot status={status} t={t} />
            <span className={css.agentCopy}>
              <strong>{status.member.handle}</strong>
              <small>{status.member.description}</small>
            </span>
            <span className={css.presenceText}>{presenceLabel(status, t).split(':')[0]}</span>
          </div>
        ))}
      </div>
      {!formOpen && error !== undefined && (
        <div className={css.retryError} role="alert">
          <span>{error}</span>
          {retryRequest !== undefined && <button type="button" className={css.textButton} disabled={creating} onClick={() => { setFormOpen(true) }}>{t('retry')}</button>}
        </div>
      )}
    </div>
  )
}
