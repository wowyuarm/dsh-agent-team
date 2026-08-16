import type { TeamSettingsProps } from './slots.ts'

/** Team mode deliberately has no Settings occupant. The null seat preserves the shell's layout contract. */
export function TeamSettings(_props: TeamSettingsProps) {
  return null
}
