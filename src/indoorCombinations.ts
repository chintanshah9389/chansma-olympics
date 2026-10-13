import { ALL_SPORT_IDS, sportLabel } from './sports'
import type { Registration, SportId } from './types'

const INDOOR = new Set<string>(ALL_SPORT_IDS)

export type IndoorPlayerGender = 'male' | 'female' | 'mixed'

export type IndoorPlayer = {
  name: string
  mobile: string
  gender: IndoorPlayerGender | ''
  sports: SportId[]
}

export type IndoorComboCounts = {
  players: number
  male: number
  female: number
  mixed: number
}

export type IndoorCombo = {
  label: string
  sports: SportId[]
  players: IndoorPlayer[]
}

export type IndoorComboSize = {
  size: number
  title: string
  word: string
  combos: IndoorCombo[]
}

export type IndoorComboReport = {
  players: IndoorPlayer[]
  sizes: IndoorComboSize[]
}

function digits(value: string | undefined): string {
  const mobile = String(value || '').replace(/\D/g, '')
  return mobile.length === 10 ? mobile : ''
}

function rememberName(names: string[], raw: string | undefined): void {
  const cleaned = String(raw || '').trim().replace(/\s+/g, ' ')
  if (!cleaned) return
  const key = cleaned.toLowerCase()
  const existing = names.findIndex((item) => item.toLowerCase() === key)
  if (existing === -1) names.push(cleaned)
  else if ((cleaned.match(/[A-Z]/g) || []).length > (names[existing].match(/[A-Z]/g) || []).length) {
    names[existing] = cleaned
  }
}

function displayName(names: string[]): string {
  return [...names].sort((a, b) => b.length - a.length || a.localeCompare(b)).join(' / ') || '—'
}

function sizeTitle(size: number): string {
  if (size === 1) return 'One sport only'
  if (size === 2) return 'Two sports only'
  if (size === 3) return 'Three sports only'
  return `${size} sports only`
}

function sizeWord(size: number): string {
  return size === 1 ? '1 sport only' : `${size} sports only`
}

export function indoorGenderLabel(gender: IndoorPlayerGender | ''): string {
  if (gender === 'male') return 'Male'
  if (gender === 'female') return 'Female'
  if (gender === 'mixed') return 'Male and female'
  return '—'
}

export function indoorComboCounts(players: IndoorPlayer[]): IndoorComboCounts {
  return {
    players: players.length,
    male: players.filter((player) => player.gender === 'male').length,
    female: players.filter((player) => player.gender === 'female').length,
    mixed: players.filter((player) => player.gender === 'mixed').length,
  }
}

export function collectIndoorPlayers(registrations: Registration[]): IndoorPlayer[] {
  const people = new Map<string, { names: string[]; genders: Set<string>; sports: Set<SportId> }>()

  const add = (mobile: string, name: string | undefined, gender: string, sportId: string) => {
    if (!mobile || !INDOOR.has(sportId)) return
    let person = people.get(mobile)
    if (!person) {
      person = { names: [], genders: new Set(), sports: new Set() }
      people.set(mobile, person)
    }
    rememberName(person.names, name)
    if (gender === 'male' || gender === 'female') person.genders.add(gender)
    person.sports.add(sportId as SportId)
  }

  for (const registration of registrations) {
    if (registration.event !== 'indoor') continue
    for (const sport of registration.sports || []) {
      add(digits(sport.player1Mobile), sport.player1Name, registration.gender, sport.sportId)
      add(digits(sport.player2Mobile), sport.player2Name, registration.gender, sport.sportId)
    }
  }

  return [...people.entries()].map(([mobile, person]) => {
    const male = person.genders.has('male')
    const female = person.genders.has('female')
    const gender: IndoorPlayer['gender'] = male && female ? 'mixed' : male ? 'male' : female ? 'female' : ''
    return {
      mobile,
      name: displayName(person.names),
      gender,
      sports: ALL_SPORT_IDS.filter((id) => person.sports.has(id)),
    }
  })
}

export function groupIndoorPlayers(players: IndoorPlayer[]): IndoorComboReport {
  const grouped = new Map<string, IndoorCombo>()
  for (const player of players) {
    const key = player.sports.join('+')
    let combo = grouped.get(key)
    if (!combo) {
      combo = {
        sports: player.sports,
        label: player.sports.map((id) => sportLabel(id)).join(' + '),
        players: [],
      }
      grouped.set(key, combo)
    }
    combo.players.push(player)
  }

  for (const combo of grouped.values()) {
    combo.players.sort(
      (a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || a.mobile.localeCompare(b.mobile),
    )
  }

  const bySize = new Map<number, IndoorCombo[]>()
  for (const combo of grouped.values()) {
    const size = combo.sports.length
    const list = bySize.get(size) ?? []
    list.push(combo)
    bySize.set(size, list)
  }

  const sizes = [...bySize.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([size, combos]) => ({
      size,
      title: sizeTitle(size),
      word: sizeWord(size),
      combos: combos.sort(
        (a, b) => b.players.length - a.players.length || a.label.localeCompare(b.label),
      ),
    }))

  return { players, sizes }
}

export function buildIndoorCombinations(registrations: Registration[]): IndoorComboReport {
  return groupIndoorPlayers(collectIndoorPlayers(registrations))
}

export function filterIndoorPlayers(players: IndoorPlayer[], query: string): IndoorPlayer[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return players
  return players.filter((player) => {
    if (player.name.toLowerCase().includes(needle) || player.mobile.includes(needle)) return true
    return player.sports.some((id) => sportLabel(id).toLowerCase().includes(needle))
  })
}
