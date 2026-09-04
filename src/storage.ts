import type {
  Gender,
  Registration,
  SelectedSport,
  SportId,
} from './types'
import { sportCapacity } from './sports'

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || ''

let cache: Registration[] = []
let loadError: string | null = null

function apiUrl(path: string): string {
  return `${API_BASE}${path}`
}

export function getRegistrations(): Registration[] {
  return cache
}

export function getStorageError(): string | null {
  return loadError
}

export async function refreshRegistrations(): Promise<Registration[]> {
  try {
    const response = await fetch(apiUrl('/api/registrations'))
    if (!response.ok) {
      throw new Error(`Load failed (${response.status})`)
    }
    const data = (await response.json()) as Registration[]
    cache = Array.isArray(data) ? data : []
    loadError = null
    return cache
  } catch (error) {
    loadError =
      error instanceof Error
        ? error.message
        : 'Could not connect to registration API'
    console.error(loadError)
    return cache
  }
}

export async function saveRegistration(
  registration: Registration,
): Promise<void> {
  const response = await fetch(apiUrl('/api/registrations'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(registration),
  })

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string
    } | null
    throw new Error(body?.error || `Save failed (${response.status})`)
  }

  await refreshRegistrations()
}

export async function deleteRegistration(id: string): Promise<void> {
  const response = await fetch(apiUrl(`/api/registrations/${encodeURIComponent(id)}`), {
    method: 'DELETE',
  })
  if (!response.ok) {
    throw new Error(`Delete failed (${response.status})`)
  }
  await refreshRegistrations()
}

export function normalizeMobile(mobile: string): string {
  return mobile.replace(/\D/g, '')
}

/** Count confirmed seats only (waiting list does not fill capacity) */
export function countSportRegistrations(
  sportId: SportId,
  gender: Gender,
): number {
  return getRegistrations().reduce((count, reg) => {
    if (reg.gender !== gender) return count
    const hasConfirmed = reg.sports.some(
      (s) =>
        s.sportId === sportId &&
        (s.status ?? 'confirmed') === 'confirmed',
    )
    return hasConfirmed ? count + 1 : count
  }, 0)
}

export function countWaitingRegistrations(
  sportId: SportId,
  gender: Gender,
): number {
  return getRegistrations().reduce((count, reg) => {
    if (reg.gender !== gender) return count
    const hasWaiting = reg.sports.some(
      (s) => s.sportId === sportId && s.status === 'waiting',
    )
    return hasWaiting ? count + 1 : count
  }, 0)
}

export function availableSlots(sportId: SportId, gender: Gender): number {
  return Math.max(
    0,
    sportCapacity(sportId, gender) - countSportRegistrations(sportId, gender),
  )
}

/** Mobiles that count as "already in this sport entry" */
function entryPlayerMobiles(entry: SelectedSport, regMobile: string): string[] {
  return [
    ...new Set(
      [
        normalizeMobile(entry.player1Mobile ?? ''),
        normalizeMobile(entry.player2Mobile ?? ''),
        normalizeMobile(regMobile),
      ].filter(Boolean),
    ),
  ]
}

/**
 * If any player mobile is already registered for this sport
 * (same gender), return that existing entry.
 */
export function findExistingSportEntryByPlayers(
  playerMobiles: string[],
  sportId: SportId,
  gender?: Gender | null,
): { registration: Registration; entry: SelectedSport; matchedMobile: string } | null {
  const targets = [
    ...new Set(playerMobiles.map(normalizeMobile).filter(Boolean)),
  ]
  if (targets.length === 0) return null

  for (const reg of getRegistrations()) {
    if (gender && reg.gender !== gender) continue
    const entry = reg.sports.find((s) => s.sportId === sportId)
    if (!entry) continue

    const existing = entryPlayerMobiles(entry, reg.mobile)
    const matchedMobile = targets.find((m) => existing.includes(m))
    if (matchedMobile) {
      return { registration: reg, entry, matchedMobile }
    }
  }
  return null
}

function playerLabel(name?: string, mobile?: string): string {
  if (name && mobile) return `${name} (${mobile})`
  if (name) return name
  if (mobile) return mobile
  return 'This user'
}

/**
 * Clear message when a player is already registered for a sport,
 * including their partner for doubles.
 */
export function describeSportConflict(
  sport: SelectedSport,
  sportName: string,
  gender?: Gender | null,
  contactMobile?: string,
): string | null {
  const mobiles: string[] = []
  if (sport.player1Mobile) mobiles.push(sport.player1Mobile)
  if (sport.format === 'double' && sport.player2Mobile) {
    mobiles.push(sport.player2Mobile)
  }
  if (mobiles.length === 0 && contactMobile) {
    mobiles.push(contactMobile)
  }

  const found = findExistingSportEntryByPlayers(mobiles, sport.sportId, gender)
  if (!found) return null

  return formatConflictMessage(found.entry, found.matchedMobile, sportName, found.registration)
}

/** Message for a single mobile checked on blur (Player 1 / Player 2). */
export function describePlayerMobileConflict(
  mobile: string,
  sportId: SportId,
  sportName: string,
  gender?: Gender | null,
): string | null {
  const found = findExistingSportEntryByPlayers([mobile], sportId, gender)
  if (!found) return null
  return formatConflictMessage(
    found.entry,
    found.matchedMobile,
    sportName,
    found.registration,
  )
}

function formatConflictMessage(
  entry: SelectedSport,
  matchedMobile: string,
  sportName: string,
  registration: Registration,
): string {
  const p1Mobile = normalizeMobile(entry.player1Mobile ?? '')
  const p2Mobile = normalizeMobile(entry.player2Mobile ?? '')

  let userName = playerLabel(entry.player1Name, entry.player1Mobile)
  let partnerName = entry.player2Name
    ? playerLabel(entry.player2Name, entry.player2Mobile)
    : ''

  if (p2Mobile && matchedMobile === p2Mobile) {
    userName = playerLabel(entry.player2Name, entry.player2Mobile)
    partnerName = entry.player1Name
      ? playerLabel(entry.player1Name, entry.player1Mobile)
      : ''
  } else if (p1Mobile && matchedMobile === p1Mobile) {
    userName = playerLabel(entry.player1Name, entry.player1Mobile)
    partnerName = entry.player2Name
      ? playerLabel(entry.player2Name, entry.player2Mobile)
      : ''
  } else {
    userName = playerLabel(registration.fullName, registration.mobile)
    partnerName =
      entry.format === 'double' && entry.player1Name && entry.player2Name
        ? `${playerLabel(entry.player1Name, entry.player1Mobile)} & ${playerLabel(entry.player2Name, entry.player2Mobile)}`
        : entry.player1Name
          ? playerLabel(entry.player1Name, entry.player1Mobile)
          : ''
  }

  if (entry.format === 'double' && partnerName) {
    return `This mobile number is registered as ${userName} for ${sportName} as Doubles with partner ${partnerName}.`
  }

  if (entry.format === 'double') {
    return `This mobile number is registered as ${userName} for ${sportName} as Doubles.`
  }

  return `This mobile number is registered as ${userName} for ${sportName} as Singles.`
}

export function createId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}
