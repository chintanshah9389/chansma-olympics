import type { Gender, SportConfig, SportId } from './types'

export type SportCapacityPair = { male: number; female: number }
export type SportCapacities = Record<SportId, SportCapacityPair>

export const SPORTS: Record<SportId, SportConfig> = {
  football: {
    id: 'football',
    label: 'Football',
    capacityMale: 22,
    capacityFemale: 22,
    needsFormat: false,
  },
  pickleball: {
    id: 'pickleball',
    label: 'Pickleball',
    capacityMale: 16,
    capacityFemale: 16,
    needsFormat: true,
  },
  carrom: {
    id: 'carrom',
    label: 'Carrom',
    capacityMale: 16,
    capacityFemale: 16,
    needsFormat: false,
  },
  chess: {
    id: 'chess',
    label: 'Chess',
    capacityMale: 16,
    capacityFemale: 16,
    needsFormat: false,
  },
  tt: {
    id: 'tt',
    label: 'Table Tennis',
    capacityMale: 16,
    capacityFemale: 16,
    needsFormat: true,
  },
  badminton: {
    id: 'badminton',
    label: 'Badminton',
    capacityMale: 16,
    capacityFemale: 16,
    needsFormat: true,
  },
}

/** Pick exactly one */
export const PRIMARY_SPORTS: SportId[] = ['football', 'pickleball']

/** Choose up to 2 from these 4 (optional) */
export const SECONDARY_SPORTS: SportId[] = [
  'carrom',
  'chess',
  'tt',
  'badminton',
]

export const ALL_SPORT_IDS = Object.keys(SPORTS) as SportId[]

export function defaultCapacities(): SportCapacities {
  return Object.fromEntries(
    ALL_SPORT_IDS.map((id) => [
      id,
      {
        male: SPORTS[id].capacityMale,
        female: SPORTS[id].capacityFemale,
      },
    ]),
  ) as SportCapacities
}

export function getCapacities(): SportCapacities {
  return Object.fromEntries(
    ALL_SPORT_IDS.map((id) => [
      id,
      {
        male: SPORTS[id].capacityMale,
        female: SPORTS[id].capacityFemale,
      },
    ]),
  ) as SportCapacities
}

/** Apply live capacities from API / admin (updates slot math everywhere). */
export function applyCapacities(capacities: Partial<SportCapacities>): void {
  for (const id of ALL_SPORT_IDS) {
    const pair = capacities[id]
    if (!pair) continue
    const male = Math.max(0, Math.floor(Number(pair.male)))
    const female = Math.max(0, Math.floor(Number(pair.female)))
    if (Number.isFinite(male)) SPORTS[id].capacityMale = male
    if (Number.isFinite(female)) SPORTS[id].capacityFemale = female
  }
}

export function sportLabel(id: SportId): string {
  return SPORTS[id].label
}

export function needsFormat(id: SportId): boolean {
  return SPORTS[id].needsFormat
}

/** Singles/team sports that still require player name + mobile (no Single/Double UI) */
export function needsPlayerDetailsOnly(id: SportId): boolean {
  return id === 'football' || id === 'carrom' || id === 'chess'
}

/** Any sport that shows on the format / player-details step */
export function needsPlayerDetails(id: SportId): boolean {
  return needsFormat(id) || needsPlayerDetailsOnly(id)
}

export function sportCapacity(id: SportId, gender: Gender): number {
  return gender === 'male'
    ? SPORTS[id].capacityMale
    : SPORTS[id].capacityFemale
}

export function genderLabel(gender: Gender): string {
  return gender === 'male' ? 'Male' : 'Female'
}
