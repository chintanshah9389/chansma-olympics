import type { SeatSportId } from './types'

export const AVAILABILITY_IDS: SeatSportId[] = [
  'football',
  'pickleball',
  'carrom',
  'chess',
  'tt',
  'badminton',
  'turf',
  'overarm',
]

export type SportEnabledMap = Record<SeatSportId, boolean>

function allOn(): SportEnabledMap {
  return Object.fromEntries(AVAILABILITY_IDS.map((id) => [id, true])) as SportEnabledMap
}

let live: SportEnabledMap = allOn()
let revision = 0

export function sportAvailabilityRevision(): number {
  return revision
}

export function getSportEnabled(): SportEnabledMap {
  return { ...live }
}

export function isSportEnabled(id: SeatSportId): boolean {
  return live[id] !== false
}

export function applySportEnabled(
  input: Partial<SportEnabledMap> | null | undefined,
): SportEnabledMap {
  const next = allOn()
  for (const id of AVAILABILITY_IDS) {
    if (input && Object.prototype.hasOwnProperty.call(input, id)) {
      next[id] = input[id] !== false
    }
  }
  const changed = AVAILABILITY_IDS.some((id) => next[id] !== live[id])
  live = next
  if (changed) revision += 1
  return getSportEnabled()
}
