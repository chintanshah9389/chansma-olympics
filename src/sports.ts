import type { Gender, SportConfig, SportId } from './types'

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

export function sportLabel(id: SportId): string {
  return SPORTS[id].label
}

export function needsFormat(id: SportId): boolean {
  return SPORTS[id].needsFormat
}

export function sportCapacity(id: SportId, gender: Gender): number {
  return gender === 'male'
    ? SPORTS[id].capacityMale
    : SPORTS[id].capacityFemale
}

export function genderLabel(gender: Gender): string {
  return gender === 'male' ? 'Male' : 'Female'
}
