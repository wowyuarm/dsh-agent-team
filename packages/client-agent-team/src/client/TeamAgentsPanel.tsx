import { useCallback, useEffect, useState } from 'react'
import type {
  AgentTeamAddMemberRequest,
  AgentTeamAgentMemberStatus,
  AgentTeamRequestId,
} from '@deepseek-ai/dsh-agent-team/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
import type { TeamSidebarProps } from './slots.ts'
import { TeamPresenceDot } from './TeamPresenceDot.tsx'
import css from './team.module.css'

interface TeamAgentsPanelProps {
  readonly workspaceId: WorkspaceId
  readonly loadMembers: TeamSidebarProps['loadMembers']
  readonly addMember: TeamSidebarProps['addMember']
  readonly t: TeamSidebarProps['t']
}

export function TeamAgentsPanel({ workspaceId, loadMembers, addMember, t }: TeamAgentsPanelProps) {
  const [members, setMembers] = useState<readonly AgentTeamAgentMemberStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [formOpen, setFormOpen] = useState(false)
  const [handle, setHandle] = useState('')
  const [description, setDescription] = useState('')
  const [creating, setCreating] = useState(false)
  const [retryRequest, setRetryRequest] = useState<AgentTeamAddMemberRequest>()

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

  const provision = async (request: AgentTeamAddMemberRequest) => {
    setCreating(true)
    setError(undefined)
    const result = await addMember(request)
    if (result.ok) {
      setMembers(current => {
        const retained = current.filter(status => status.member.memberId !== result.value.status.member.memberId)
        return [...retained, result.value.status]
      })
      setHandle('')
      setDescription('')
      setFormOpen(false)
      if (result.value.status.presence === 'unavailable') {
        setRetryRequest(request)
        setError(result.value.status.diagnostic ?? t('statusUnavailable'))
      } else {
        setRetryRequest(undefined)
      }
    } else {
      setError(result.error.message)
      await refresh()
    }
    setCreating(false)
  }

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const normalizedHandle = handle.trim()
    const normalizedDescription = description.trim()
    if (normalizedHandle.length === 0 || normalizedDescription.length === 0 || creating) return
    void provision({
      requestId: crypto.randomUUID() as AgentTeamRequestId,
      workspaceId,
      handle: normalizedHandle,
      description: normalizedDescription,
      presetId: 'team-member',
    })
  }

  return (
    <div className={css.agentsPanel}>
      <div className={css.agentToolbar}>
        <span>{t('agents')}</span>
        <button type="button" className={css.textButton} onClick={() => { setFormOpen(open => !open) }}>
          {formOpen ? t('cancel') : t('addAgent')}
        </button>
      </div>
      {formOpen && (
        <form className={css.agentForm} onSubmit={submit}>
          <label>
            <span>{t('agentName')}</span>
            <input value={handle} onChange={event => { setHandle(event.target.value) }} disabled={creating} autoFocus />
          </label>
          <label>
            <span>{t('agentDescription')}</span>
            <textarea value={description} onChange={event => { setDescription(event.target.value) }} disabled={creating} rows={3} />
          </label>
          <button type="submit" className={css.primaryButton} disabled={creating || handle.trim().length === 0 || description.trim().length === 0}>
            {creating ? t('creatingAgent') : t('createAgent')}
          </button>
        </form>
      )}
      {loading && members.length === 0 && <p className={css.emptyWorkspace}>{t('loadingAgents')}</p>}
      {!loading && members.length === 0 && <p className={css.emptyWorkspace}>{t('emptyAgents')}</p>}
      <div className={css.agentList}>
        {members.map(status => {
          return (
            <div className={css.agentRow} key={status.member.memberId}>
              <TeamPresenceDot status={status} t={t} />
              <span className={css.agentCopy}>
                <strong>{status.member.handle}</strong>
                <small>{status.member.description}</small>
              </span>
            </div>
          )
        })}
      </div>
      {error !== undefined && (
        <div className={css.retryError} role="alert">
          <span>{error}</span>
          {retryRequest !== undefined && <button type="button" className={css.textButton} disabled={creating} onClick={() => { void provision(retryRequest) }}>{t('retry')}</button>}
        </div>
      )}
    </div>
  )
}
