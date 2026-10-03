import type { SeatSportId } from './types'
import { ALL_SPORT_IDS } from './sports'

export type SportAgeLimit = {
  minAge: number
  maxAge: number
}

export type SportAgeLimits = Record<SeatSportId, SportAgeLimit>

export const AGE_LIMIT_IDS: SeatSportId[] = [...ALL_SPORT_IDS, 'turf', 'overarm']

export const DEFAULT_SPORT_AGE_LIMIT: SportAgeLimit = {
  minAge: 5,
  maxAge: 100,
}

export function defaultAgeLimits(): SportAgeLimits {
  return Object.fromEntries(
    AGE_LIMIT_IDS.map((id) => [id, { ...DEFAULT_SPORT_AGE_LIMIT }]),
  ) as SportAgeLimits
}

let liveLimits: SportAgeLimits = defaultAgeLimits()

function clampPair(minRaw: unknown, maxRaw: unknown): SportAgeLimit {
  let minAge = Math.floor(Number(minRaw))
  let maxAge = Math.floor(Number(maxRaw))
  if (!Number.isFinite(minAge)) minAge = DEFAULT_SPORT_AGE_LIMIT.minAge
  if (!Number.isFinite(maxAge)) maxAge = DEFAULT_SPORT_AGE_LIMIT.maxAge
  minAge = Math.max(1, Math.min(120, minAge))
  maxAge = Math.max(1, Math.min(120, maxAge))
  if (minAge > maxAge) {
    const swap = minAge
    minAge = maxAge
    maxAge = swap
  }
  return { minAge, maxAge }
}

export function getAgeLimits(): SportAgeLimits {
  return structuredClone(liveLimits)
}

export function getSportAgeLimit(sportId: SeatSportId): SportAgeLimit {
  return { ...(liveLimits[sportId] ?? DEFAULT_SPORT_AGE_LIMIT) }
}

export function applyAgeLimits(
  input: Partial<SportAgeLimits> | null | undefined,
): SportAgeLimits {
  const next = defaultAgeLimits()
  for (const id of AGE_LIMIT_IDS) {
    const pair = input?.[id]
    if (pair && typeof pair === 'object') {
      next[id] = clampPair(pair.minAge, pair.maxAge)
    } else {
      next[id] = { ...(liveLimits[id] ?? DEFAULT_SPORT_AGE_LIMIT) }
    }
  }
  // If input looks like legacy global { minAge, maxAge }, apply to all sports
  const legacy = input as { minAge?: unknown; maxAge?: unknown } | null | undefined
  if (
    legacy &&
    typeof legacy === 'object' &&
    !ALL_SPORT_IDS.some((id) => id in legacy) &&
    (legacy.minAge != null || legacy.maxAge != null)
  ) {
    const pair = clampPair(legacy.minAge, legacy.maxAge)
    for (const id of ALL_SPORT_IDS) next[id] = { ...pair }
  }
  liveLimits = next
  return getAgeLimits()
}
