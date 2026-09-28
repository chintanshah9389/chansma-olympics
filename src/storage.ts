import type {
  Gender,
  Registration,
  SelectedSport,
  SportId,
} from './types'
import { applyAgeLimits, getAgeLimits, getSportAgeLimit, type SportAgeLimits } from './ageLimits'
import { applyCapacities, getCapacities, sportCapacity, type SportCapacities } from './sports'
import { GU, biText } from './i18n'

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
    loadError = biText(
      error instanceof Error
        ? error.message
        : 'Could not connect to registration API',
      GU.errApiLoad,
    )
    console.error(loadError)
    return cache
  }
}

export async function refreshCapacities(): Promise<SportCapacities> {
  try {
    const response = await fetch(apiUrl('/api/capacities'))
    if (!response.ok) {
      throw new Error(`Capacity load failed (${response.status})`)
    }
    const data = (await response.json()) as SportCapacities
    applyCapacities(data)
    return getCapacities()
  } catch (error) {
    console.error('Could not load capacities', error)
    return getCapacities()
  }
}

export async function refreshAgeLimits(): Promise<SportAgeLimits> {
  try {
    const response = await fetch(apiUrl('/api/age-limits'))
    if (!response.ok) {
      throw new Error(`Age limits load failed (${response.status})`)
    }
    const data = (await response.json()) as SportAgeLimits
    return applyAgeLimits(data)
  } catch (error) {
    console.error('Could not load age limits', error)
    return getAgeLimits()
  }
}

export async function saveCapacities(
  capacities: SportCapacities,
): Promise<SportCapacities> {
  const response = await fetch(apiUrl('/api/capacities'), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(capacities),
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string
    } | null
    throw new Error(body?.error || `Save capacities failed (${response.status})`)
  }
  const data = (await response.json()) as SportCapacities
  applyCapacities(data)
  return getCapacities()
}

export async function saveAgeLimits(limits: SportAgeLimits): Promise<SportAgeLimits> {
  const response = await fetch(apiUrl('/api/age-limits'), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(limits),
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string
    } | null
    throw new Error(body?.error || `Save age limits failed (${response.status})`)
  }
  const data = (await response.json()) as SportAgeLimits
  return applyAgeLimits(data)
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
    throw new Error(
      biText(
        body?.error || `Save failed (${response.status})`,
        GU.errSaveFailed,
      ),
    )
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

export async function updateRegistration(
  registration: Registration,
): Promise<Registration> {
  const response = await fetch(
    apiUrl(`/api/registrations/${encodeURIComponent(registration.id)}`),
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(registration),
    },
  )
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string
    } | null
    throw new Error(body?.error || `Update failed (${response.status})`)
  }
  const data = (await response.json()) as Registration
  await refreshRegistrations()
  return data
}

export async function bulkDeleteRegistrations(ids: string[]): Promise<number> {
  const response = await fetch(apiUrl('/api/registrations/bulk-delete'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string
    } | null
    throw new Error(body?.error || `Bulk delete failed (${response.status})`)
  }
  const data = (await response.json()) as { deleted?: number }
  await refreshRegistrations()
  return data.deleted ?? ids.length
}

export async function resetRegistrations(): Promise<number> {
  const response = await fetch(apiUrl('/api/registrations/reset'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirm: 'RESET' }),
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string
    } | null
    throw new Error(body?.error || `Reset failed (${response.status})`)
  }
  const data = (await response.json()) as { deleted?: number }
  await refreshRegistrations()
  return data.deleted ?? 0
}

export function normalizeMobile(mobile: string): string {
  return mobile.replace(/\D/g, '')
}

/** Digits only while typing. Keeps +91 / leading-0 pastes long enough for validation errors. */
export function sanitizeMobileInput(raw: string): string {
  const trimmed = raw.trim()
  const digits = normalizeMobile(trimmed)
  if (!digits) return ''

  // Pasted +91XXXXXXXXXX (with +) → keep 12 digits so validation can reject country code
  if (/\+91/.test(trimmed.replace(/[\s-]/g, ''))) {
    return digits.slice(0, 12)
  }

  // Pasted 0XXXXXXXXXX → keep so validation can reject leading 0
  if (digits.startsWith('0')) {
    return digits.slice(0, 11)
  }

  // Normal 10-digit numbers may start with 91 (e.g. 9175366700) — that is valid
  return digits.slice(0, 10)
}

/**
 * Valid mobile: exactly 10 digits, not starting with 0.
 * Rejects only the +91 country-code prefix — a 10-digit number starting with 91 is allowed.
 */
export function mobileFieldError(
  raw: string,
  options: { required?: boolean } = {},
): string | null {
  const required = options.required !== false
  const trimmed = raw.trim()
  if (!trimmed) {
    return required ? 'Mobile number is required' : null
  }

  const compact = trimmed.replace(/[\s-]/g, '')
  const digits = normalizeMobile(trimmed)

  // Only the explicit +91 country code is blocked (not numbers that merely start with 91)
  if (/\+91/.test(compact) || (digits.startsWith('91') && digits.length >= 12)) {
    return 'Do not include +91 — enter a 10-digit mobile number only'
  }
  if (digits.startsWith('0')) {
    return 'Mobile number cannot start with 0'
  }
  if (digits.length !== 10 || !/^\d{10}$/.test(digits)) {
    return 'Enter exactly 10 digits (no spaces or country code)'
  }
  return null
}

export function isValidMobile(raw: string): boolean {
  return mobileFieldError(raw, { required: true }) === null
}

/** Age must be a whole number within that sport's admin-configured min/max. */
export function ageFieldError(
  raw: string,
  options: { required?: boolean; sportId?: SportId } = {},
): string | null {
  const required = options.required !== false
  const trimmed = String(raw ?? '').trim()
  if (!trimmed) {
    return required ? 'Age is required' : null
  }
  if (!/^\d{1,3}$/.test(trimmed)) {
    return 'Enter age as a whole number'
  }
  const age = Number(trimmed)
  const { minAge, maxAge } = options.sportId
    ? getSportAgeLimit(options.sportId)
    : { minAge: 5, maxAge: 100 }
  if (!Number.isInteger(age) || age < minAge || age > maxAge) {
    return `Enter an age between ${minAge} and ${maxAge}`
  }
  return null
}

export function parseAge(
  raw: string,
  sportId?: SportId,
): number | undefined {
  if (ageFieldError(raw, { required: true, sportId })) return undefined
  return Number(String(raw).trim())
}

/** Singles/team = 1 seat; doubles = 2 seats against that gender quota. */
export function seatWeight(format?: string | null): number {
  return format === 'double' ? 2 : 1
}

/** Count confirmed seat units only (waiting does not fill capacity). Doubles = 2. */
export function countSportRegistrations(
  sportId: SportId,
  gender: Gender,
): number {
  return getRegistrations().reduce((count, reg) => {
    if (reg.gender !== gender) return count
    for (const s of reg.sports) {
      if (
        s.sportId === sportId &&
        (s.status ?? 'confirmed') === 'confirmed'
      ) {
        count += seatWeight(s.format)
      }
    }
    return count
  }, 0)
}

/** Waiting list size in seat units (doubles count as 2). */
export function countWaitingRegistrations(
  sportId: SportId,
  gender: Gender,
): number {
  return getRegistrations().reduce((count, reg) => {
    if (reg.gender !== gender) return count
    for (const s of reg.sports) {
      if (s.sportId === sportId && s.status === 'waiting') {
        count += seatWeight(s.format)
      }
    }
    return count
  }, 0)
}

export function availableSlots(sportId: SportId, gender: Gender): number {
  return Math.max(
    0,
    sportCapacity(sportId, gender) - countSportRegistrations(sportId, gender),
  )
}

/** Player mobiles that count for sport duplicate checks (not step‑1 contact). */
function entryPlayerMobiles(entry: SelectedSport): string[] {
  return [
    ...new Set(
      [
        normalizeMobile(entry.player1Mobile ?? ''),
        normalizeMobile(entry.player2Mobile ?? ''),
      ].filter(Boolean),
    ),
  ]
}

/**
 * If any player mobile is already registered for this sport
 * (any gender — same player number cannot enter the same sport twice),
 * return that existing entry.
 */
export function findExistingSportEntryByPlayers(
  playerMobiles: string[],
  sportId: SportId,
): { registration: Registration; entry: SelectedSport; matchedMobile: string } | null {
  const targets = [
    ...new Set(playerMobiles.map(normalizeMobile).filter(Boolean)),
  ]
  if (targets.length === 0) return null

  for (const reg of getRegistrations()) {
    const entry = reg.sports.find((s) => s.sportId === sportId)
    if (!entry) continue

    const existing = entryPlayerMobiles(entry)
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
 * Conflict when Player 1 / Player 2 mobile is already on this sport.
 * Step‑1 contact mobile is info only and is never checked here.
 */
export function describeSportConflict(
  sport: SelectedSport,
  sportName: string,
  _contactMobile?: string,
): string | null {
  const mobiles: string[] = []
  if (sport.player1Mobile) mobiles.push(sport.player1Mobile)
  if (sport.format === 'double' && sport.player2Mobile) {
    mobiles.push(sport.player2Mobile)
  }

  const found = findExistingSportEntryByPlayers(mobiles, sport.sportId)
  if (!found) return null

  return formatConflictMessage(found.entry, found.matchedMobile, sportName, found.registration)
}

/** Message for a single mobile checked on blur (Player 1 / Player 2). */
export function describePlayerMobileConflict(
  mobile: string,
  sportId: SportId,
  sportName: string,
): string | null {
  const found = findExistingSportEntryByPlayers([mobile], sportId)
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

  const genderTagEn =
    registration.gender === 'female' ? ' (Female)' : ' (Male)'
  const genderTagGu =
    registration.gender === 'female' ? GU.genderFemaleTag : GU.genderMaleTag
  const sportGu = GU.sports[entry.sportId] ?? sportName

  if (entry.format === 'double' && partnerName) {
    return biText(
      `Already registered: ${userName} for ${sportName} as Doubles with partner ${partnerName}${genderTagEn}.`,
      GU.conflictDoublesPartner(userName, sportGu, partnerName, genderTagGu),
    )
  }

  if (entry.format === 'double') {
    return biText(
      `Already registered: ${userName} for ${sportName} as Doubles${genderTagEn}.`,
      GU.conflictDoubles(userName, sportGu, genderTagGu),
    )
  }

  if (entry.sportId === 'football') {
    return biText(
      `Already registered: ${userName} for ${sportName}${genderTagEn}.`,
      GU.conflictFootball(userName, sportGu, genderTagGu),
    )
  }

  return biText(
    `Already registered: ${userName} for ${sportName} as Singles${genderTagEn}.`,
    GU.conflictSingles(userName, sportGu, genderTagGu),
  )
}

export function createId(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  for (const b of bytes) code += alphabet[b % alphabet.length]
  return `CHN-${code}`
}
