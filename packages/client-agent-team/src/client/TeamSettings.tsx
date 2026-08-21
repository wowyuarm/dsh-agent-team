import type { TeamSettingsProps } from './slots.ts'
import { TeamMembersAction } from './TeamMembersAction.tsx'

export function TeamSettings({ wide, loadMemberGroups, t }: TeamSettingsProps) {
  return <TeamMembersAction wide={wide} loadMemberGroups={loadMemberGroups} t={t} />
}
