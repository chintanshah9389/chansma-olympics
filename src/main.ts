import './style.css'
import {
  availableSlots,
  countSportRegistrations,
  seatWeight,
  countWaitingRegistrations,
  describePlayerMobileConflict,
  describeSportConflict,
  getStorageError,
  mobileFieldError,
  ageFieldError,
  parseAge,
  normalizeMobile,
  sanitizeMobileInput,
  describeCricketConflict,
  refreshAgeLimits,
  refreshCapacities,
  refreshCricketCapacities,
  refreshFees,
  refreshRegistrations,
  getRegistrations,
  saveCheckout,
  setActiveEvent,
} from './storage'
import { eventById, getCricketCapacities } from './events'
import {
  BANK,
  CASH_COLLECTORS,
  QR_LIMIT,
  UPI_ID,
  getFee,
} from './fees'
import {
  PLAYER_AREAS,
  PLAYER_SKILLS,
  ageFromBirthDate,
  emptyCricketPlayer,
  optimizePhoto,
  type CricketField,
  type CricketPlayer,
  type PlayerSkill,
} from './cricketForm'
import { getSportAgeLimit } from './ageLimits'
import {
  PRIMARY_SPORTS,
  SECONDARY_SPORTS,
  genderLabel,
  needsFormat,
  needsPlayerDetails,
  needsPlayerDetailsOnly,
  sportCapacity,
  sportLabel,
} from './sports'
import {
  connectRealtime,
  onRealtimeUpdate,
} from './realtime'
import { destroyAdmin, isAdminRoute, renderAdmin } from './admin'
import { GU, bi, biText, bilingualHtml } from './i18n'
import {
  iconAdmin,
  iconArrowLeft,
  iconArrowRight,
  iconCamera,
  iconCricket,
  iconCheck,
  iconDouble,
  iconFemale,
  iconLive,
  iconMale,
  iconPhone,
  iconSingle,
  iconSpark,
  iconUser,
  sportIcon,
  withIcon,
} from './icons'
import type {
  DoublesPlayer,
  DoublesPlayers,
  FormState,
  Gender,
  PlayFormat,
  Registration,
  SelectedSport,
  SportId,
} from './types'

const STEP_LABELS = [
  { en: 'Details', gu: GU.steps.details },
  { en: 'Sports', gu: GU.steps.sports },
  { en: 'Format', gu: GU.steps.format },
  { en: 'Review', gu: GU.steps.review },
] as const

function sportBi(id: SportId): string {
  return bi(sportLabel(id), GU.sports[id] ?? sportLabel(id))
}

function sportBiText(id: SportId): string {
  return biText(sportLabel(id), GU.sports[id] ?? sportLabel(id))
}

const emptyDoublesPlayer = (): DoublesPlayer => ({
  fullName: '',
  mobile: '',
  age: '',
})

const state: FormState = {
  fullName: '',
  mobile: '',
  location: '',
  gender: null,
  primarySport: null,
  secondarySports: [],
  formats: {},
  doublesPlayers: {},
}

type CricketKind = 'turf' | 'overarm'

type FlowPhase =
  | { id: 'begin' }
  | { id: 'cricket-gender' }
  | { id: 'cricket-choice' }
  | { id: 'cricket-form' }
  | { id: 'indoor'; indoorStep: 1 | 2 | 3 | 4 }
  | { id: 'review' }
  | { id: 'pay' }
  | { id: 'done' }

let phaseIndex = 0
let pickIndoor = false
let pickCricket = false
let pickTurf = false
let pickOverarm = false
let cricketGender: Gender | null = null
let cricketEntry: CricketPlayer = emptyCricketPlayer()
const cricketSkills: Record<CricketKind, PlayerSkill | ''> = {
  turf: '',
  overarm: '',
}
let cricketErrors: Partial<Record<CricketField, string>> = {}
const skillErrors: Partial<Record<CricketKind, string>> = {}
let beginError = ''
let cricketChoiceError = ''
let cricketGenderError = ''
let photoBusy = false
let payMode: 'online' | 'cash' | null = null
let cashCollector = ''
let paymentShot = ''
let paymentShotName = ''
let payError = ''
let receiptNo = ''
let submitBusy = false
let frozenBill: { label: string; amount: number }[] | null = null
let receiptCricketStatus: Partial<Record<'turf' | 'overarm', 'confirmed' | 'waiting'>> = {}
let detailErrors: Partial<Record<'fullName' | 'mobile', string>> = {}
let sportError = ''
let formatError = ''
let doublesErrors: Partial<
  Record<
    SportId,
    {
      player1?: Partial<DoublesPlayer>
      player2?: Partial<DoublesPlayer>
    }
  >
> = {}
let submitError = ''
/** Shown on success screen after a completed registration */
let lastReference = ''
let lastRegisteredSports: SelectedSport[] = []
/** Last step painted — used to skip re-animating when only errors update */
let paintedKey = ''
/** Slide direction for step transitions */
let stepAnimDir: 'forward' | 'back' = 'forward'
/** Avoid blur→re-render stealing the Continue / Submit tap on mobile */
let suppressBlurRenderUntil = 0
/** After render, scroll/focus the first invalid field */
let shouldRevealErrors = false

const app = document.querySelector<HTMLDivElement>('#app')!

function selectedSportsList(): SportId[] {
  const list: SportId[] = []
  if (state.primarySport) list.push(state.primarySport)
  for (const id of state.secondarySports) {
    if (!list.includes(id)) list.push(id)
  }
  return list
}

/** Format-choice sports + football / carrom / chess player details */
function sportsNeedingPlayerDetails(): SportId[] {
  return selectedSportsList().filter(needsPlayerDetails)
}

function bilingualMobileError(raw: string, required = true): string | null {
  const en = mobileFieldError(raw, { required })
  if (!en) return null
  if (en.includes('+91')) {
    return biText(en, GU.errMobileNoCountry)
  }
  if (en.includes('start with 0')) {
    return biText(en, GU.errMobileNoZero)
  }
  if (en.includes('required')) {
    return biText(en, GU.errMobileRequired)
  }
  return biText(en, GU.errMobileValid)
}

function bilingualAgeError(
  raw: string,
  sportId: SportId,
  required = true,
): string | null {
  const en = ageFieldError(raw, { required, sportId })
  if (!en) return null
  if (en.includes('required')) {
    return biText(en, GU.errAgeRequired)
  }
  const { minAge, maxAge } = getSportAgeLimit(sportId)
  return biText(en, GU.errAgeValid(minAge, maxAge))
}

function ensureDoublesPlayers(id: SportId): DoublesPlayers {
  if (!state.doublesPlayers[id]) {
    state.doublesPlayers[id] = {
      player1: emptyDoublesPlayer(),
      player2: emptyDoublesPlayer(),
    }
  }
  return state.doublesPlayers[id]!
}

function buildSelectedSports(): SelectedSport[] {
  return selectedSportsList().map((sportId) => {
    const format = needsFormat(sportId)
      ? (state.formats[sportId] ?? 'single')
      : 'single'
    const players = needsPlayerDetails(sportId)
      ? state.doublesPlayers[sportId]
      : undefined
    const player1Name = players?.player1.fullName.trim()
    const player1Mobile = players
      ? normalizeMobile(players.player1.mobile)
      : undefined
    const player1Age = players
      ? parseAge(players.player1.age, sportId)
      : undefined
    const player2Name =
      format === 'double' ? players?.player2.fullName.trim() : undefined
    const player2Mobile =
      format === 'double' && players
        ? normalizeMobile(players.player2.mobile)
        : undefined
    const player2Age =
      format === 'double' && players
        ? parseAge(players.player2.age, sportId)
        : undefined

    const weight = seatWeight(format)
    const status =
      state.gender && slotsFor(sportId) >= weight ? 'confirmed' : 'waiting'

    return {
      sportId,
      format,
      status,
      ...(player1Name ? { player1Name } : {}),
      ...(player1Mobile ? { player1Mobile } : {}),
      ...(player1Age != null ? { player1Age } : {}),
      ...(player2Name ? { player2Name } : {}),
      ...(player2Mobile ? { player2Mobile } : {}),
      ...(player2Age != null ? { player2Age } : {}),
    }
  })
}

function validateDetails(): boolean {
  detailErrors = {}
  const name = state.fullName.trim()

  if (!name) detailErrors.fullName = biText('Full name is required', GU.errFullName)

  const mobileErr = bilingualMobileError(state.mobile, true)
  if (mobileErr) detailErrors.mobile = mobileErr
  else state.mobile = sanitizeMobileInput(state.mobile)

  return Object.keys(detailErrors).length === 0
}

function slotsFor(sportId: SportId): number {
  if (!state.gender) return 0
  return availableSlots(sportId, state.gender)
}

/** Shared live copy: "Women: 13 left (5/18) / સ્ત્રી: 13 બાકી (5/18)" */
function genderSlotCopy(
  sportId: SportId,
  gender: Gender,
): { en: string; gu: string; left: number } {
  const left = availableSlots(sportId, gender)
  const used = countSportRegistrations(sportId, gender)
  const waiting = countWaitingRegistrations(sportId, gender)
  const total = sportCapacity(sportId, gender)
  const categoryEn = gender === 'male' ? 'Men' : 'Women'
  const categoryGu = gender === 'male' ? GU.men : GU.women
  if (left <= 0) {
    return {
      en: `${categoryEn}: Full · Waiting (${waiting} · ${used}/${total})`,
      gu: `${categoryGu}: ${GU.fullWaiting} (${waiting} · ${used}/${total})`,
      left: 0,
    }
  }
  const waitNoteEn = waiting > 0 ? ` · ${waiting} waiting` : ''
  const waitNoteGu = waiting > 0 ? ` · ${waiting} વેઇટિંગ` : ''
  return {
    en: `${categoryEn}: ${left} left (${used}/${total})${waitNoteEn}`,
    gu: `${categoryGu}: ${left} ${GU.left} (${used}/${total})${waitNoteGu}`,
    left,
  }
}

function countCricketSeats(
  kind: 'turf' | 'overarm',
  gender: Gender,
  status: 'confirmed' | 'waiting',
): number {
  return getRegistrations().reduce((count, reg) => {
    if (reg.event !== kind || reg.gender !== gender) return count
    const seat = reg.sports[0]?.status === 'waiting' ? 'waiting' : 'confirmed'
    return seat === status ? count + 1 : count
  }, 0)
}

function cricketSlotCopy(
  kind: 'turf' | 'overarm',
  gender: Gender,
): { en: string; gu: string; left: number } {
  const caps = getCricketCapacities()
  const total = kind === 'overarm' ? caps.overarm.male : caps.turf[gender]
  const used = countCricketSeats(kind, gender, 'confirmed')
  const waiting = countCricketSeats(kind, gender, 'waiting')
  const left = Math.max(0, total - used)
  const categoryEn = gender === 'male' ? 'Men' : 'Women'
  const categoryGu = gender === 'male' ? GU.men : GU.women
  if (left <= 0) {
    return {
      en: `${categoryEn}: Full · Waiting (${waiting} · ${used}/${total})`,
      gu: `${categoryGu}: ${GU.fullWaiting} (${waiting} · ${used}/${total})`,
      left: 0,
    }
  }
  const waitNoteEn = waiting > 0 ? ` · ${waiting} waiting` : ''
  const waitNoteGu = waiting > 0 ? ` · ${waiting} વેઇટિંગ` : ''
  return {
    en: `${categoryEn}: ${left} left (${used}/${total})${waitNoteEn}`,
    gu: `${categoryGu}: ${left} ${GU.left} (${used}/${total})${waitNoteGu}`,
    left,
  }
}

function namedCricketSlot(kind: 'turf' | 'overarm', gender: Gender): string {
  const name = kind === 'turf' ? bi('Turf', 'ટર્ફ') : bi('Overarm', 'ઓવરઆર્મ')
  return `<div class="slot-named"><span class="slot-name">${name}</span>${cricketSlotHtml(kind, gender)}</div>`
}

function cricketSlotHtml(kind: 'turf' | 'overarm', gender: Gender): string {
  const copy = cricketSlotCopy(kind, gender)
  const cls = copy.left <= 0 ? 'is-full' : copy.left <= 3 ? 'is-low' : ''
  return `<span class="slot-live ${cls}" data-cricket-slot="${kind}-${gender}"><span class="slot-pulse"></span>${iconLive()} ${bi(copy.en, copy.gu)}</span>`
}

function updateCricketSlotBadges(): void {
  app.querySelectorAll<HTMLElement>('[data-cricket-slot]').forEach((el) => {
    const [kind, gender] = (el.dataset.cricketSlot ?? '').split('-')
    if (kind !== 'turf' && kind !== 'overarm') return
    if (gender !== 'male' && gender !== 'female') return
    if (kind === 'overarm' && gender === 'female') return
    const copy = cricketSlotCopy(kind, gender)
    el.classList.toggle('is-full', copy.left <= 0)
    el.classList.toggle('is-low', copy.left > 0 && copy.left <= 3)
    el.innerHTML = `<span class="slot-pulse"></span>${iconLive()} ${bi(copy.en, copy.gu)}`
  })
}

function slotBadgeFor(sportId: SportId, gender: Gender): string {
  const copy = genderSlotCopy(sportId, gender)
  const cls = copy.left <= 0 ? 'is-full' : copy.left <= 3 ? 'is-low' : ''
  return `<span class="slot-live ${cls}" data-slot-sport="${sportId}" data-slot-gender="${gender}"><span class="slot-pulse"></span>${iconLive()} ${bi(copy.en, copy.gu)}</span>`
}

function slotBadgeHtml(sportId: SportId): string {
  if (!state.gender) {
    return `<span class="slot-live" data-slot-sport="${sportId}">—</span>`
  }
  return slotBadgeFor(sportId, state.gender)
}

function updateLiveSlotBadges(): void {
  updateCricketSlotBadges()
  app.querySelectorAll<HTMLElement>('[data-slot-sport]').forEach((el) => {
    const id = el.dataset.slotSport as SportId
    if (!id) return
    const gender = (el.dataset.slotGender as Gender | undefined) || state.gender
    if (!gender) return
    const copy = genderSlotCopy(id, gender)
    if (el.classList.contains('choice-meta') || el.classList.contains('badge')) {
      el.innerHTML = bi(copy.en, copy.gu)
      el.classList.toggle('warn', copy.left <= 0)
      el.classList.toggle('badge-full', copy.left <= 0 && el.classList.contains('badge'))
      el.classList.toggle('badge-ok', copy.left > 0 && el.classList.contains('badge'))
      return
    }
    const next = document.createElement('div')
    next.innerHTML = slotBadgeFor(id, gender)
    const badge = next.firstElementChild as HTMLElement | null
    if (!badge) return
    badge.classList.add('is-updating')
    el.replaceWith(badge)
    window.setTimeout(() => badge.classList.remove('is-updating'), 600)
  })
}

function anySeatWaiting(): boolean {
  const indoorWaiting =
    pickIndoor && buildSelectedSports().some((sport) => sport.status === 'waiting')
  const turfWaiting = pickTurf && cricketStatus('turf') === 'waiting'
  const overarmWaiting = pickOverarm && cricketStatus('overarm') === 'waiting'
  return Boolean(indoorWaiting || turfWaiting || overarmWaiting)
}

function seatSnapshot(): string {
  const indoor = pickIndoor
    ? buildSelectedSports()
        .map((sport) => `${sport.sportId}:${sport.status}`)
        .join(',')
    : ''
  const turf = pickTurf ? cricketStatus('turf') : ''
  const overarm = pickOverarm ? cricketStatus('overarm') : ''
  return `${indoor}|${turf}|${overarm}`
}

let lastSeatSnapshot = ''
let seatWatchTimer = 0

function syncLiveSeats(): void {
  if (isAdminRoute()) return
  const phase = currentPhase()
  if (phase.id === 'review' || phase.id === 'pay') {
    const next = seatSnapshot()
    if (next !== lastSeatSnapshot) {
      lastSeatSnapshot = next
      render()
      return
    }
  }
  updateLiveSlotBadges()
}

function watchSeats(): void {
  window.clearInterval(seatWatchTimer)
  seatWatchTimer = 0
  const phase = currentPhase()
  if (phase.id !== 'review' && phase.id !== 'pay') return
  lastSeatSnapshot = seatSnapshot()
  seatWatchTimer = window.setInterval(() => {
    const now = currentPhase()
    if (now.id !== 'review' && now.id !== 'pay') {
      window.clearInterval(seatWatchTimer)
      seatWatchTimer = 0
      return
    }
    void refreshRegistrations().then(() => syncLiveSeats())
  }, 4000)
}

function startLiveSlotUpdates(): void {
  updateLiveSlotBadges()
}

function stopLiveSlotUpdates(): void {
  // badges only shown on format step; websocket stays connected app-wide
}

function validateSports(): boolean {
  sportError = ''
  if (!state.gender) {
    sportError = biText('Select Male or Female first', GU.errSelectGender)
    return false
  }
  if (selectedSportsList().length === 0) {
    sportError = biText(
      'Select at least one sport (main or additional)',
      GU.errMinOneSport,
    )
    return false
  }
  if (state.secondarySports.length > 2) {
    sportError = biText(
      'You can choose a maximum of 2 additional sports',
      GU.errMaxExtra,
    )
    return false
  }
  return true
}

function validatePlayer1(
  players: DoublesPlayers | undefined,
  sportId: SportId,
): Partial<DoublesPlayer> | undefined {
  const p1Name = players?.player1.fullName.trim() ?? ''
  const p1MobileRaw = players?.player1.mobile ?? ''
  const p1AgeRaw = players?.player1.age ?? ''
  const errors: Partial<DoublesPlayer> = {}

  if (!p1Name) errors.fullName = biText('Full name is required', GU.errFullName)

  const mobileErr = bilingualMobileError(p1MobileRaw, true)
  if (mobileErr) errors.mobile = mobileErr

  const ageErr = bilingualAgeError(p1AgeRaw, sportId, true)
  if (ageErr) errors.age = ageErr

  return Object.keys(errors).length > 0 ? errors : undefined
}

function isValidMobileLocal(raw: string): boolean {
  return mobileFieldError(raw, { required: true }) === null
}

function validateFormats(): boolean {
  formatError = ''
  doublesErrors = {}
  let missingFormat = false

  for (const id of sportsNeedingPlayerDetails()) {
    if (needsFormat(id) && !state.formats[id]) {
      missingFormat = true
      continue
    }

    if (needsPlayerDetailsOnly(id)) {
      state.formats[id] = 'single'
    }

    const players = state.doublesPlayers[id]
    const errors: {
      player1?: Partial<DoublesPlayer>
      player2?: Partial<DoublesPlayer>
    } = {}

    const p1Errors = validatePlayer1(players, id)
    if (p1Errors) errors.player1 = p1Errors

    const p1MobileCheck = normalizeMobile(players?.player1.mobile ?? '')
    if (isValidMobileLocal(players?.player1.mobile ?? '')) {
      const conflict = describePlayerMobileConflict(
        p1MobileCheck,
        id,
        sportLabel(id),
      )
      if (conflict) {
        errors.player1 = { ...errors.player1, mobile: conflict }
      }
    }

    if (needsFormat(id) && state.formats[id] === 'double') {
      const p1Name = players?.player1.fullName.trim() ?? ''
      const p1Mobile = normalizeMobile(players?.player1.mobile ?? '')
      const p2Name = players?.player2.fullName.trim() ?? ''
      const p2MobileRaw = players?.player2.mobile ?? ''
      const p2Mobile = normalizeMobile(p2MobileRaw)
      const p2AgeRaw = players?.player2.age ?? ''

      if (!p2Name) {
        errors.player2 = {
          ...errors.player2,
          fullName: biText('Player 2 full name is required', GU.errPlayer2Name),
        }
      }

      const p2MobileErr = bilingualMobileError(p2MobileRaw, true)
      if (p2MobileErr) {
        const mapped = p2MobileErr.includes('required')
          ? biText('Player 2 mobile number is required', GU.errPlayer2Mobile)
          : p2MobileErr.includes('+91')
            ? biText(
                'Do not include +91 — enter a 10-digit mobile number only',
                GU.errMobileNoCountry,
              )
            : p2MobileErr.includes('start with 0')
              ? biText('Mobile number cannot start with 0', GU.errMobileNoZero)
              : biText(
                  'Enter a valid 10-digit mobile for Player 2',
                  GU.errPlayer2MobileValid,
                )
        errors.player2 = { ...errors.player2, mobile: mapped }
      }

      const p2AgeErr = bilingualAgeError(p2AgeRaw, id, true)
      if (p2AgeErr) {
        errors.player2 = {
          ...errors.player2,
          age: p2AgeErr.includes('required')
            ? biText('Player 2 age is required', GU.errPlayer2Age)
            : p2AgeErr,
        }
      }

      if (
        p1Name &&
        p2Name &&
        p1Name.toLowerCase() === p2Name.toLowerCase()
      ) {
        errors.player2 = {
          ...errors.player2,
          fullName: biText(
            'Player 2 name must be different from Player 1',
            GU.errNamesDifferent,
          ),
        }
      }

      if (p1Mobile && p2Mobile && p1Mobile === p2Mobile) {
        errors.player2 = {
          ...errors.player2,
          mobile: biText(
            'Player 2 mobile must be different from Player 1',
            GU.errMobilesDifferent,
          ),
        }
      }

      if (
        isValidMobileLocal(p2MobileRaw) &&
        !(p1Mobile && p1Mobile === p2Mobile)
      ) {
        const conflict = describePlayerMobileConflict(
          p2Mobile,
          id,
          sportLabel(id),
        )
        if (conflict) {
          errors.player2 = { ...errors.player2, mobile: conflict }
        }
      }
    }

    if (errors.player1 || errors.player2) {
      doublesErrors[id] = errors
    }
  }

  if (missingFormat) {
    formatError = biText(
      'Select Single or Double for each racket sport',
      GU.errSelectFormat,
    )
    return false
  }

  if (Object.keys(doublesErrors).length > 0) {
    formatError = biText(
      'Fix player details — full name, mobile and age are required, and a mobile may already be registered for this sport',
      GU.errFixPlayers,
    )
    return false
  }

  return true
}

function canSubmit(): { ok: boolean; message: string } {
  if (!state.gender) {
    return { ok: false, message: biText('Select Male or Female before submitting.', GU.errSelectGenderSubmit) }
  }
  const sports = buildSelectedSports()
  for (const s of sports) {
    const existing = describeSportConflict(
      s,
      sportLabel(s.sportId),
      state.mobile,
    )
    if (existing) {
      return { ok: false, message: existing }
    }
  }
  return { ok: true, message: '' }
}

function phases(): FlowPhase[] {
  const list: FlowPhase[] = [{ id: 'begin' }]
  if (pickIndoor) {
    list.push({ id: 'indoor', indoorStep: 1 })
    list.push({ id: 'indoor', indoorStep: 2 })
    const sportsChosen = selectedSportsList().length > 0
    const needDetails =
      !sportsChosen || sportsNeedingPlayerDetails().length > 0
    if (needDetails) list.push({ id: 'indoor', indoorStep: 3 })
  }
  if (pickCricket) {
    list.push({ id: 'cricket-gender' })
    if (cricketGender) {
      list.push({ id: 'cricket-choice' })
      if (pickTurf || pickOverarm) list.push({ id: 'cricket-form' })
    }
  }
  if (pickIndoor || pickCricket) {
    list.push({ id: 'review' })
    list.push({ id: 'pay' })
  }
  list.push({ id: 'done' })
  return list
}

function phaseKey(phase: FlowPhase): string {
  return phase.id === 'indoor' ? `indoor-${phase.indoorStep}` : phase.id
}

function currentPhase(): FlowPhase {
  const list = phases()
  return list[Math.min(phaseIndex, list.length - 1)] ?? { id: 'begin' }
}

function movePhase(direction: 1 | -1): void {
  const list = phases()
  const key = phaseKey(currentPhase())
  const index = list.findIndex((phase) => phaseKey(phase) === key)
  const next = Math.min(list.length - 1, Math.max(0, index + direction))
  phaseIndex = next
  stepAnimDir = direction === 1 ? 'forward' : 'back'
  render()
}

function validateBegin(): boolean {
  if (!pickIndoor && !pickCricket) {
    beginError = biText(
      'Select Indoor, Cricket, or both.',
      'ઇન્ડોર, ક્રિકેટ, અથવા બંને પસંદ કરો.',
    )
    return false
  }
  beginError = ''
  return true
}

function validateCricketGender(): boolean {
  if (!cricketGender) {
    cricketGenderError = biText('Select Male or Female.', 'પુરુષ અથવા સ્ત્રી પસંદ કરો.')
    return false
  }
  cricketGenderError = ''
  return true
}

function validateCricketChoice(): boolean {
  if (!pickTurf && !pickOverarm) {
    cricketChoiceError = biText(
      'Select Turf, Overarm, or both.',
      'ટર્ફ, ઓવરઆર્મ, અથવા બંને પસંદ કરો.',
    )
    return false
  }
  cricketChoiceError = ''
  return true
}

function cricketAgeBounds(): { minAge: number; maxAge: number } {
  const parts = []
  if (pickTurf) parts.push(getSportAgeLimit('turf'))
  if (pickOverarm) parts.push(getSportAgeLimit('overarm'))
  if (parts.length === 0) return { minAge: 5, maxAge: 100 }
  return {
    minAge: Math.max(...parts.map((part) => part.minAge)),
    maxAge: Math.min(...parts.map((part) => part.maxAge)),
  }
}

function validateCricket(): boolean {
  const player = cricketEntry
  const errors: Partial<Record<CricketField, string>> = {}
  const required = [
    ['firstName', "Player's first name is required", 'ખેલાડીનું પ્રથમ નામ જરૂરી છે'],
    ['fatherName', 'Father/Spouse name is required', 'પિતા/પતિ-પત્નીનું નામ જરૂરી છે'],
    ['grandfatherName', 'Grandfather name is required', 'દાદાનું નામ જરૂરી છે'],
    ['surname', 'Surname is required', 'અટક જરૂરી છે'],
  ] as const
  for (const [field, en, gu] of required) {
    if (!player[field].trim()) errors[field] = biText(en, gu)
  }
  const mobileError = mobileFieldError(player.mobile, { required: true })
  if (mobileError) errors.mobile = mobileError
  const bounds = cricketAgeBounds()
  const ageError =
    bounds.minAge > bounds.maxAge
      ? biText(
          'Turf and overarm age limits do not overlap. Ask the organiser.',
          'ટર્ફ અને ઓવરઆર્મની ઉંમર મર્યાદા મેળ ખાતી નથી. આયોજકને પૂછો.',
        )
      : ageFieldError(player.age, {
          required: true,
          sportId: pickTurf ? 'turf' : 'overarm',
        })
  if (!ageError && bounds.minAge <= bounds.maxAge) {
    const age = Number(String(player.age).trim())
    if (age < bounds.minAge || age > bounds.maxAge) {
      errors.age = biText(
        `Enter an age between ${bounds.minAge} and ${bounds.maxAge}`,
        `ઉંમર ${bounds.minAge} થી ${bounds.maxAge} વચ્ચે હોવી જોઈએ`,
      )
    }
  } else if (ageError) errors.age = ageError
  const skillMessage = biText('Select a player skill', 'ખેલાડીની કુશળતા પસંદ કરો')
  if (pickTurf && !cricketSkills.turf) skillErrors.turf = skillMessage
  else delete skillErrors.turf
  if (pickOverarm && !cricketSkills.overarm) skillErrors.overarm = skillMessage
  else delete skillErrors.overarm
  if (!player.birthDate) {
    errors.birthDate = biText('Birth date is required', 'જન્મ તારીખ જરૂરી છે')
  } else if (ageFromBirthDate(player.birthDate) == null) {
    errors.birthDate = biText('Enter a valid birth date', 'માન્ય જન્મ તારીખ દાખલ કરો')
  }
  if (!player.area) {
    errors.area = biText("Select the player's area", 'ખેલાડીનો વિસ્તાર પસંદ કરો')
  }
  if (pickTurf) {
    const clash = describeCricketConflict('turf', player.mobile)
    if (clash) errors.mobile = clash
  }
  if (!errors.mobile && pickOverarm) {
    const clash = describeCricketConflict('overarm', player.mobile)
    if (clash) errors.mobile = clash
  }
  if (photoBusy) {
    errors.photo = biText('Wait until the photo is ready.', 'ફોટો તૈયાર થાય ત્યાં સુધી રાહ જુઓ.')
  } else if (!player.photoUrl) {
    errors.photo = biText("Player's photo is required", 'ખેલાડીનો ફોટો જરૂરી છે')
  }
  cricketErrors = errors
  return Object.keys(errors).length === 0 && Object.keys(skillErrors).length === 0
}

function goNext(): void {
  const phase = currentPhase()

  if (phase.id === 'begin') {
    if (!validateBegin()) {
      shouldRevealErrors = true
      render()
      return
    }
    movePhase(1)
    return
  }

  if (phase.id === 'cricket-choice') {
    if (!validateCricketChoice()) {
      shouldRevealErrors = true
      render()
      return
    }
    movePhase(1)
    return
  }

  if (phase.id === 'cricket-gender') {
    if (!validateCricketGender()) {
      shouldRevealErrors = true
      render()
      return
    }
    movePhase(1)
    return
  }

  if (phase.id === 'cricket-form') {
    if (!validateCricket()) {
      shouldRevealErrors = true
      render()
      return
    }
    movePhase(1)
    return
  }

  if (phase.id === 'indoor' && phase.indoorStep === 1) {
    if (!validateDetails()) {
      shouldRevealErrors = true
      render()
      return
    }
    movePhase(1)
    return
  }

  if (phase.id === 'indoor' && phase.indoorStep === 2) {
    if (!validateSports()) {
      shouldRevealErrors = true
      render()
      return
    }
    const needing = sportsNeedingPlayerDetails()
    for (const id of Object.keys(state.formats) as SportId[]) {
      if (!needing.includes(id)) {
        delete state.formats[id]
        delete state.doublesPlayers[id]
      }
    }
    for (const id of needing) {
      if (needsPlayerDetailsOnly(id)) {
        state.formats[id] = 'single'
      }
    }
    movePhase(1)
    return
  }

  if (phase.id === 'indoor' && phase.indoorStep === 3) {
    if (!validateFormats()) {
      shouldRevealErrors = true
      render()
      return
    }
    movePhase(1)
    return
  }

  if (phase.id === 'review') {
    if (pickIndoor) {
      const check = canSubmit()
      if (!check.ok) {
        redirectToSubmitError(check.message)
        return
      }
    }
    movePhase(1)
  }
}

function gotoReview(): void {
  const list = phases()
  const index = list.findIndex((phase) => phase.id === 'review')
  if (index >= 0) phaseIndex = index
}

function gotoIndoor(indoorStep: 1 | 2 | 3 | 4): void {
  const list = phases()
  const index = list.findIndex(
    (phase) => phase.id === 'indoor' && phase.indoorStep === indoorStep,
  )
  if (index >= 0) phaseIndex = index
}

function redirectToSubmitError(message: string): void {
  if (!state.gender) {
    stepAnimDir = 'back'
    sportError = message
    submitError = ''
    gotoIndoor(2)
    shouldRevealErrors = true
    render()
    return
  }

  const sports = buildSelectedSports()
  for (const s of sports) {
    if (s.sportId === 'turf' || s.sportId === 'overarm') continue
    const conflict = describeSportConflict(
      s,
      sportLabel(s.sportId),
      state.mobile,
    )
    if (!conflict) continue

    if (sportsNeedingPlayerDetails().includes(s.sportId)) {
      stepAnimDir = 'back'
      gotoIndoor(3)
      doublesErrors[s.sportId] = {
        ...doublesErrors[s.sportId],
        player1: {
          ...doublesErrors[s.sportId]?.player1,
          mobile: conflict,
        },
      }
      formatError = conflict
      submitError = ''
    } else {
      gotoReview()
      submitError = conflict
    }
    shouldRevealErrors = true
    render()
    return
  }

  submitError = message
  shouldRevealErrors = true
  render()
}

function goBack(): void {
  if (phaseKey(currentPhase()) === 'begin') return
  sportError = ''
  formatError = ''
  doublesErrors = {}
  submitError = ''
  beginError = ''
  cricketChoiceError = ''
  cricketGenderError = ''
  movePhase(-1)
}

function primarySportsForGender(): SportId[] {
  if (state.gender === 'female') {
    return PRIMARY_SPORTS.filter((id) => id !== 'football')
  }
  return [...PRIMARY_SPORTS]
}

function setGender(gender: Gender): void {
  state.gender = gender
  if (gender === 'female' && state.primarySport === 'football') {
    state.primarySport = null
  }
  sportError = ''
  render()
}

function setPrimary(id: SportId): void {
  if (!state.gender) {
    sportError = biText('Select Male or Female first', GU.errSelectGender)
    shouldRevealErrors = true
    render()
    return
  }
  if (state.gender === 'female' && id === 'football') {
    sportError = biText('Football is not available for Female', GU.errFootballFemale)
    shouldRevealErrors = true
    render()
    return
  }
  if (state.primarySport === id) {
    state.primarySport = null
    delete state.formats[id]
    delete state.doublesPlayers[id]
  } else {
    const prev = state.primarySport
    if (prev) {
      delete state.formats[prev]
      delete state.doublesPlayers[prev]
    }
    state.primarySport = id
  }
  sportError = ''
  render()
}

function toggleSecondary(id: SportId): void {
  if (!state.gender) {
    sportError = biText('Select Male or Female first', GU.errSelectGender)
    shouldRevealErrors = true
    render()
    return
  }
  const idx = state.secondarySports.indexOf(id)
  if (idx >= 0) {
    state.secondarySports.splice(idx, 1)
    delete state.formats[id]
    delete state.doublesPlayers[id]
  } else {
    if (state.secondarySports.length >= 2) return
    state.secondarySports.push(id)
  }
  sportError = ''
  render()
}

function setFormat(id: SportId, format: PlayFormat): void {
  state.formats[id] = format
  const players = ensureDoublesPlayers(id)
  if (format === 'single') {
    players.player2 = emptyDoublesPlayer()
    if (doublesErrors[id]?.player2) delete doublesErrors[id]!.player2
  }
  formatError = ''
  render()
}

function validatePayment(): boolean {
  payError = ''
  if (pickIndoor) {
    const check = canSubmit()
    if (!check.ok) {
      payError = check.message
      return false
    }
  }
  if (payMode !== 'online' && payMode !== 'cash') {
    payError = biText(
      'Choose online payment or cash.',
      'ઓનલાઇન ચુકવણી અથવા રોકડ પસંદ કરો.',
    )
    return false
  }
  if (payMode === 'online' && !paymentShot) {
    payError = biText(
      'After you pay, upload a screenshot.',
      'ચુકવણી પછી સ્ક્રીનશૉટ અપલોડ કરો.',
    )
    return false
  }
  if (payMode === 'cash' && !cashCollector) {
    payError = biText(
      'Select the person you gave the amount to.',
      'જેને રકમ આપી તે વ્યક્તિ પસંદ કરો.',
    )
    return false
  }
  return true
}

function makeReceiptNo(): string {
  const now = new Date()
  const y = String(now.getFullYear()).slice(2)
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  const n = Math.floor(1000 + Math.random() * 9000)
  return `CHO-${y}${m}${d}-${n}`
}

function cricketRegistration(
  kind: 'turf' | 'overarm',
  id: string,
  createdAt: string,
  receipt: string,
): Registration {
  const player = cricketEntry
  const name = [player.firstName, player.fatherName, player.grandfatherName, player.surname]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ')
  const gender = kind === 'overarm' || cricketGender !== 'female' ? 'male' : 'female'
  return {
    id,
    event: kind,
    fullName: name,
    mobile: normalizeMobile(player.mobile),
    location: player.area.trim(),
    gender,
    createdAt,
    receiptNo: receipt,
    payMode: payMode || '',
    paidTo: payMode === 'cash' ? cashCollector : 'Online',
    amount: getFee(kind),
    sports: [
      {
        sportId: kind,
        format: 'single',
        status: cricketStatus(kind),
        player1Name: name,
        player1Mobile: normalizeMobile(player.mobile),
        player1Age: Number(player.age),
        skill: cricketSkills[kind],
        birthDate: player.birthDate,
        fatherName: player.fatherName.trim(),
        grandfatherName: player.grandfatherName.trim(),
        surname: player.surname.trim(),
        photoUrl: player.photoUrl,
      },
    ],
  }
}

function submit(): void {
  if (submitBusy || currentPhase().id !== 'pay') return
  if (!validatePayment()) {
    shouldRevealErrors = true
    render()
    return
  }
  if ((pickTurf || pickOverarm) && !validateCricket()) {
    payError = biText('Cricket details are incomplete.', 'ક્રિકેટ વિગતો અધૂરી છે.')
    shouldRevealErrors = true
    render()
    return
  }

  const receipt = makeReceiptNo()
  const createdAt = new Date().toISOString()
  const paidTo = payMode === 'cash' ? cashCollector : 'Online'
  const batch: Registration[] = []
  if (pickIndoor && state.gender) {
    const sports = buildSelectedSports()
    const amount = sports.reduce((sum, sport) => {
      if (sport.sportId === 'turf' || sport.sportId === 'overarm') return sum
      return sum + getFee(sport.sportId) * seatWeight(sport.format)
    }, 0)
    batch.push({
      id: `${receipt}-IN`,
      event: 'indoor',
      fullName: state.fullName.trim(),
      mobile: normalizeMobile(state.mobile),
      location: state.location.trim(),
      gender: state.gender,
      sports,
      createdAt,
      receiptNo: receipt,
      payMode: payMode || '',
      paidTo,
      amount,
    })
  }
  if (pickTurf) batch.push(cricketRegistration('turf', `${receipt}-TF`, createdAt, receipt))
  if (pickOverarm) batch.push(cricketRegistration('overarm', `${receipt}-OA`, createdAt, receipt))
  if (batch.length === 0) {
    payError = biText('Nothing to save.', 'સાચવવા માટે કંઈ નથી.')
    render()
    return
  }

  submitBusy = true
  payError = ''
  render()
  void saveCheckout(batch, payMode === 'online' ? paymentShot : '')
    .then((saved) => {
      const indoor = saved.find((row) => row.event === 'indoor')
      lastRegisteredSports = indoor?.sports ?? []
      receiptCricketStatus = {}
      for (const kind of ['turf', 'overarm'] as const) {
        const status = saved.find((row) => row.event === kind)?.sports[0]?.status
        if (status === 'confirmed' || status === 'waiting') {
          receiptCricketStatus[kind] = status
        }
      }
      frozenBill = feeLines(lastRegisteredSports)
      receiptNo = receipt
      const storedPhoto = saved.find((row) => row.event === 'turf' || row.event === 'overarm')
        ?.sports[0]?.photoUrl
      if (storedPhoto) cricketEntry.photoUrl = storedPhoto
      const storedShot = saved.find((row) => row.paymentShotUrl)?.paymentShotUrl
      if (storedShot) paymentShot = storedShot
      const list = phases()
      const done = list.findIndex((phase) => phase.id === 'done')
      phaseIndex = done >= 0 ? done : list.length - 1
      stepAnimDir = 'forward'
    })
    .catch((error: unknown) => {
      payError =
        error instanceof Error
          ? error.message
          : biText('Could not save this registration.', 'આ નોંધણી સાચવી શકાઈ નહીં.')
    })
    .finally(() => {
      submitBusy = false
      render()
    })
}

function clearFormFields(): void {
  state.fullName = ''
  state.mobile = ''
  state.location = ''
  state.gender = null
  state.primarySport = null
  state.secondarySports = []
  state.formats = {}
  state.doublesPlayers = {}
  detailErrors = {}
  sportError = ''
  formatError = ''
  doublesErrors = {}
  submitError = ''
  lastReference = ''
  lastRegisteredSports = []
  phaseIndex = 0
  pickIndoor = false
  pickCricket = false
  pickTurf = false
  pickOverarm = false
  cricketGender = null
  cricketEntry = emptyCricketPlayer()
  cricketSkills.turf = ''
  cricketSkills.overarm = ''
  beginError = ''
  cricketChoiceError = ''
  cricketGenderError = ''
  cricketErrors = {}
  delete skillErrors.turf
  delete skillErrors.overarm
  photoBusy = false
  payMode = null
  cashCollector = ''
  paymentShot = ''
  paymentShotName = ''
  payError = ''
  receiptNo = ''
  submitBusy = false
  frozenBill = null
  receiptCricketStatus = {}
  paintedKey = ''
}

function resetForm(): void {
  clearFormFields()
  stepAnimDir = 'forward'
  render()
}

function brandSubHtml(): string {
  const phase = currentPhase()
  if (phase.id === 'cricket-gender' || phase.id === 'cricket-choice') return 'Cricket sports'
  if (phase.id === 'cricket-form') {
    if (pickTurf && !pickOverarm) {
      const event = eventById('turf')
      return `${bi(event.title, event.titleGu)} · ${bi(event.date, event.dateGu)}`
    }
    if (pickOverarm && !pickTurf) {
      const event = eventById('overarm')
      return `${bi(event.title, event.titleGu)} · ${bi(event.date, event.dateGu)}`
    }
    return 'Cricket sports'
  }
  if (phase.id === 'indoor') {
    if (phase.indoorStep === 1) return ''
    const event = eventById('indoor')
    return `${bi(event.title, event.titleGu)} · ${bi(event.date, event.dateGu)}`
  }
  return bi('Tournament Registration', GU.brandSub)
}

function stepHasErrors(): boolean {
  const phase = currentPhase()
  if (phase.id === 'begin') return Boolean(beginError)
  if (phase.id === 'cricket-gender') return Boolean(cricketGenderError)
  if (phase.id === 'cricket-choice') return Boolean(cricketChoiceError)
  if (phase.id === 'cricket-form') {
    return Object.keys(cricketErrors).length > 0 || Object.keys(skillErrors).length > 0
  }
  if (phase.id === 'indoor' && phase.indoorStep === 1) {
    return Boolean(detailErrors.fullName || detailErrors.mobile)
  }
  if (phase.id === 'indoor' && phase.indoorStep === 2) return Boolean(sportError)
  if (phase.id === 'indoor' && phase.indoorStep === 3) {
    return Boolean(formatError) || Object.keys(doublesErrors).length > 0
  }
  if (phase.id === 'pay') return Boolean(payError)
  if (phase.id === 'review' || (phase.id === 'indoor' && phase.indoorStep === 4)) {
    return Boolean(submitError)
  }
  return false
}

function revealFormErrors(): void {
  requestAnimationFrame(() => {
    const target =
      app.querySelector<HTMLElement>(
        '.field.is-invalid input, input.is-invalid, .format-options.is-invalid, .choice-grid.is-invalid, .format-card.is-invalid, .review-item.is-error, .alert.is-error',
      ) || app.querySelector<HTMLElement>('.error, .alert.is-error')

    if (!target) return

    const flashHost =
      target.closest<HTMLElement>(
        '.field, .format-card, .choice-grid, .format-options, .review-item, .alert',
      ) || target

    flashHost.classList.add('error-flash')
    window.setTimeout(() => flashHost.classList.remove('error-flash'), 1600)

    flashHost.scrollIntoView({ behavior: 'smooth', block: 'center' })

    const input =
      target instanceof HTMLInputElement
        ? target
        : flashHost.querySelector<HTMLInputElement>('input:not([type="hidden"])')
    input?.focus({ preventScroll: true })
  })
}

function phaseGroup(
  phase: FlowPhase,
): 'outdoor' | 'indoor' | 'review' | 'pay' | 'receipt' {
  if (phase.id === 'done') return 'receipt'
  if (phase.id === 'pay') return 'pay'
  if (phase.id === 'review') return 'review'
  return phase.id === 'indoor' ? 'indoor' : 'outdoor'
}

function phaseLabel(phase: FlowPhase): { en: string; gu: string } {
  if (phase.id === 'begin') return { en: 'Begin', gu: 'શરૂ' }
  if (phase.id === 'cricket-gender') return { en: 'Gender', gu: 'લિંગ' }
  if (phase.id === 'cricket-choice') return { en: 'Cricket', gu: 'ક્રિકેટ' }
  if (phase.id === 'cricket-form') return { en: 'Player', gu: 'ખેલાડી' }
  if (phase.id === 'review') return STEP_LABELS[3]
  if (phase.id === 'pay') return { en: 'Pay', gu: 'ચુકવણી' }
  if (phase.id === 'done') return { en: 'Receipt', gu: 'રસીદ' }
  if (phase.id === 'indoor' && phase.indoorStep === 1) return STEP_LABELS[0]
  if (phase.id === 'indoor' && phase.indoorStep === 2) return STEP_LABELS[1]
  if (phase.id === 'indoor' && phase.indoorStep === 3) return STEP_LABELS[2]
  return STEP_LABELS[3]
}

function renderProgress(): string {
  const track = phases().filter((phase) => phase.id !== 'begin')
  const activeKey = phaseKey(currentPhase())
  const active = Math.max(
    0,
    track.findIndex((phase) => phaseKey(phase) === activeKey),
  )
  const showError = stepHasErrors()
  const wide = track.length >= 6 ? ' is-many' : ''
  const bands: string[] = []
  let bandStart = 1
  for (let i = 0; i < track.length; i++) {
    const group = phaseGroup(track[i])
    const next = i + 1 < track.length ? phaseGroup(track[i + 1]) : null
    if (group === next) continue
    const label =
      group === 'outdoor'
        ? 'Outdoor'
        : group === 'indoor'
          ? 'Indoor'
          :       group === 'pay'
            ? 'Pay'
            : group === 'receipt'
              ? 'Receipt'
              : 'Review'
    const split = bands.length > 0 ? ' is-split' : ''
    bands.push(
      `<li class="progress-band${split}" data-group="${group}" style="grid-column: ${bandStart} / ${i + 2}">${label}</li>`,
    )
    bandStart = i + 2
  }
  return `
    <ol class="progress-track${wide}" style="--steps: ${track.length}; grid-template-columns: repeat(${track.length}, minmax(0, 1fr))">
      ${bands.join('')}
      ${track
        .map((phase, i) => {
          const label = phaseLabel(phase)
          const group = phaseGroup(phase)
          const prev = i > 0 ? phaseGroup(track[i - 1]) : null
          const next = i + 1 < track.length ? phaseGroup(track[i + 1]) : null
          const stateClass =
            i < active ? 'is-done' : i === active ? 'is-active' : 'is-todo'
          const errorClass = i === active && showError ? ' has-error' : ''
          const edge =
            (group !== prev ? ' data-group-start="true"' : '') +
            (group !== next ? ' data-group-end="true"' : '')
          const split = prev && group !== prev ? ' is-split' : ''
          return `
        <li class="progress-item ${stateClass}${errorClass}${split}" data-group="${group}"${edge}>
          <div class="progress-item-top">
            <span class="progress-dot" aria-hidden="true">${i < active ? '✓' : i + 1}</span>
            ${group === next ? '<span class="progress-line" aria-hidden="true"><span></span></span>' : ''}
          </div>
          <span class="progress-label">${bi(label.en, label.gu)}</span>
        </li>
      `
        })
        .join('')}
    </ol>
  `
}

function renderChoice(
  id: SportId,
  selected: boolean,
  disabled: boolean,
  actionAttr: string,
): string {
  const genderSelected = !!state.gender
  const copy = genderSelected ? genderSlotCopy(id, state.gender!) : null
  const meta = copy
    ? bi(copy.en, copy.gu)
    : bi('Select gender first', GU.selectGenderFirst)
  const metaClass =
    copy && copy.left <= 0 ? 'choice-meta warn' : 'choice-meta'

  return `
    <button
      type="button"
      class="choice choice-sport ${selected ? 'is-selected' : ''}"
      ${disabled || !genderSelected ? 'disabled' : ''}
      data-action="${actionAttr}"
      data-sport="${id}"
    >
      <span class="choice-icon-wrap">${sportIcon(id)}</span>
      <span class="choice-check" aria-hidden="true"></span>
      <span class="choice-title">${sportBi(id)}</span>
      <span class="${metaClass}" data-slot-sport="${id}">${meta}</span>
    </button>
  `
}

function renderStep1(): string {
  const apiError = getStorageError()
  return `
    <div class="fade-step">
      <h2 class="step-title"><span class="step-title-icon">${iconUser()}</span> ${bi('Enter your details', GU.detailsTitle)}</h2>
      <p class="step-sub">${bi('Enter your full name and a 10-digit mobile number (no +91 or leading 0).', GU.detailsSub)}</p>
      ${apiError ? `<div class="alert is-error">${bilingualHtml(apiError)}</div>` : ''}

      <div class="field field-icon ${detailErrors.fullName ? 'is-invalid' : ''}">
        <label for="fullName">${bi('Full Name', GU.fullName)}</label>
        <div class="input-wrap">
          ${iconUser()}
          <input id="fullName" name="fullName" type="text" autocomplete="name"
            class="${detailErrors.fullName ? 'is-invalid' : ''}"
            value="${escapeAttr(state.fullName)}" placeholder="${escapeAttr(biText('e.g. Rahul Sharma', GU.placeholderName))}" />
        </div>
        ${detailErrors.fullName ? `<span class="error">${bilingualHtml(detailErrors.fullName)}</span>` : ''}
      </div>

      <div class="field field-icon ${detailErrors.mobile ? 'is-invalid' : ''}">
        <label for="mobile">${bi('Mobile Number', GU.mobile)}</label>
        <div class="input-wrap">
          ${iconPhone()}
          <input id="mobile" name="mobile" type="tel" inputmode="numeric" autocomplete="tel"
            class="${detailErrors.mobile ? 'is-invalid' : ''}"
            value="${escapeAttr(state.mobile)}" placeholder="${escapeAttr(biText('10-digit mobile', GU.placeholderMobile))}"
            maxlength="12" pattern="[1-9][0-9]{9}" />
        </div>
        ${detailErrors.mobile ? `<span class="error">${bilingualHtml(detailErrors.mobile)}</span>` : ''}
      </div>

      <div class="actions">
        <button type="button" class="btn btn-ghost" data-action="back">${withIcon(iconArrowLeft(), bi('Back', GU.back))}</button>
        <button type="button" class="btn btn-primary" data-action="next">${withIcon(iconArrowRight(), bi('Continue', GU.continue))}</button>
      </div>
    </div>
  `
}

function renderStep2(): string {
  const genderInvalid = Boolean(sportError && !state.gender)
  const sportsInvalid = Boolean(
    sportError && state.gender && selectedSportsList().length === 0,
  )
  return `
    <div class="fade-step">
      <h2 class="step-title">${bi('Select sports', GU.sportsTitle)}</h2>
      <p class="step-sub">${bi('Choose Male or Female first — men’s and women’s tournaments have separate slot counts.', GU.sportsSub)}</p>
      ${sportError ? `<div class="alert is-error">${bilingualHtml(sportError)}</div>` : ''}

      <div class="section-label">${bi('Gender — choose one', GU.genderLabel)}</div>
      <p class="section-hint">${bi('Men’s and Women’s tournaments are counted separately', GU.genderHint)}</p>
      <div class="choice-grid ${genderInvalid ? 'is-invalid' : ''}" data-error-section="gender">
        <button type="button"
          class="choice choice-gender ${state.gender === 'male' ? 'is-selected' : ''}"
          data-action="gender" data-gender="male">
          <span class="choice-icon-wrap">${iconMale()}</span>
          <span class="choice-check" aria-hidden="true"></span>
          <span class="choice-title">${bi('Male', GU.male)}</span>
          <span class="choice-meta">${bi('Men’s tournament', GU.maleMeta)}</span>
        </button>
        <button type="button"
          class="choice choice-gender ${state.gender === 'female' ? 'is-selected' : ''}"
          data-action="gender" data-gender="female">
          <span class="choice-icon-wrap">${iconFemale()}</span>
          <span class="choice-check" aria-hidden="true"></span>
          <span class="choice-title">${bi('Female', GU.female)}</span>
          <span class="choice-meta">${bi('Women’s tournament', GU.femaleMeta)}</span>
        </button>
      </div>

      <div class="section-label">${bi('Main sport — optional (choose one)', GU.mainSport)}</div>
      <p class="section-hint">
        ${
          state.gender === 'female'
            ? bi('Optional — Pickleball (Football is Male only)', GU.mainHintFemale)
            : bi('Optional — Football or Pickleball', GU.mainHintMale)
        }
      </p>
      <div class="choice-grid ${sportsInvalid ? 'is-invalid' : ''}" data-error-section="primary">
        ${primarySportsForGender()
          .map((id) =>
            renderChoice(id, state.primarySport === id, false, 'primary'),
          )
          .join('')}
      </div>

      <div class="section-label">${bi('Additional sports — up to 2 (at least 1 sport overall)', GU.extraSports)}</div>
      <p class="section-hint">${bi('Carrom, Chess, Table Tennis, Badminton — pick up to 2. At least one sport total is required.', GU.extraHint)}</p>
      <div class="choice-grid cols-3 ${sportsInvalid ? 'is-invalid' : ''}" data-error-section="secondary">
        ${SECONDARY_SPORTS.map((id) => {
          const atLimit =
            !state.secondarySports.includes(id) &&
            state.secondarySports.length >= 2
          return renderChoice(
            id,
            state.secondarySports.includes(id),
            atLimit,
            'secondary',
          )
        }).join('')}
      </div>

      <div class="actions">
        <button type="button" class="btn btn-ghost" data-action="back">${withIcon(iconArrowLeft(), bi('Back', GU.back))}</button>
        <button type="button" class="btn btn-primary" data-action="next">${withIcon(iconArrowRight(), bi('Continue', GU.continue))}</button>
      </div>
    </div>
  `
}

function renderPlayerFields(
  id: SportId,
  players: DoublesPlayers,
  errors: {
    player1?: Partial<DoublesPlayer>
    player2?: Partial<DoublesPlayer>
  },
  options: { showPlayer2: boolean; showOrganizerNotice: boolean },
): string {
  const ageLimit = getSportAgeLimit(id)
  return `
    <div class="partner-field">
      <div class="player-block">
        <p class="section-label" style="margin:0 0 0.55rem">${bi('Player details', GU.playerDetails)}</p>
        <div class="player-row">
          <div class="field ${errors.player1?.fullName ? 'is-invalid' : ''}">
            <label for="player1-name-${id}">${bi('Full Name', GU.fullName)}</label>
            <input id="player1-name-${id}" type="text"
              class="${errors.player1?.fullName ? 'is-invalid' : ''}"
              data-doubles-sport="${id}" data-doubles-player="player1" data-doubles-field="fullName"
              value="${escapeAttr(players.player1.fullName)}"
              placeholder="${escapeAttr(biText('Full name', GU.placeholderName))}" required />
            ${errors.player1?.fullName ? `<span class="error">${bilingualHtml(errors.player1.fullName)}</span>` : ''}
          </div>
          <div class="field ${errors.player1?.mobile ? 'is-invalid' : ''}">
            <label for="player1-mobile-${id}">${bi('Mobile Number', GU.mobile)}</label>
            <input id="player1-mobile-${id}" type="tel" inputmode="numeric"
              class="${errors.player1?.mobile ? 'is-invalid' : ''}"
              data-doubles-sport="${id}" data-doubles-player="player1" data-doubles-field="mobile"
              value="${escapeAttr(players.player1.mobile)}"
              placeholder="${escapeAttr(biText('10-digit mobile', GU.placeholderMobile))}"
              maxlength="12" pattern="[1-9][0-9]{9}" required />
            ${errors.player1?.mobile ? `<span class="error">${bilingualHtml(errors.player1.mobile)}</span>` : ''}
          </div>
          <div class="field ${errors.player1?.age ? 'is-invalid' : ''}">
            <label for="player1-age-${id}">${bi('Age', GU.age)}</label>
            <input id="player1-age-${id}" type="number" inputmode="numeric" min="${ageLimit.minAge}" max="${ageLimit.maxAge}" step="1"
              class="${errors.player1?.age ? 'is-invalid' : ''}"
              data-doubles-sport="${id}" data-doubles-player="player1" data-doubles-field="age"
              value="${escapeAttr(players.player1.age)}"
              placeholder="${escapeAttr(biText(`${ageLimit.minAge}–${ageLimit.maxAge}`, GU.placeholderAge))}" required />
            ${errors.player1?.age ? `<span class="error">${bilingualHtml(errors.player1.age)}</span>` : ''}
          </div>
        </div>
      </div>

      ${
        options.showOrganizerNotice
          ? `
      <div class="organizer-notice" role="status">
        <strong>${bi('Second player', GU.organizerTitle)}</strong>
        <p>
          ${bi(
            `We will provide you a second player. Please wait for our response. You cannot choose which player you get — you must play with the partner the organizer assigns for ${sportLabel(id)}.`,
            GU.organizerBody(sportBiText(id)),
          )}
        </p>
      </div>
      `
          : ''
      }

      ${
        options.showPlayer2
          ? `
      <div class="player-block">
        <p class="section-label" style="margin:0 0 0.55rem">${bi('Player 2', GU.player2)}</p>
        <div class="player-row">
          <div class="field ${errors.player2?.fullName ? 'is-invalid' : ''}">
            <label for="player2-name-${id}">${bi('Full Name', GU.fullName)}</label>
            <input id="player2-name-${id}" type="text"
              class="${errors.player2?.fullName ? 'is-invalid' : ''}"
              data-doubles-sport="${id}" data-doubles-player="player2" data-doubles-field="fullName"
              value="${escapeAttr(players.player2.fullName)}"
              placeholder="${escapeAttr(biText('Player 2 full name', 'ખેલાડી ૨ પૂરું નામ'))}" />
            ${errors.player2?.fullName ? `<span class="error">${bilingualHtml(errors.player2.fullName)}</span>` : ''}
          </div>
          <div class="field ${errors.player2?.mobile ? 'is-invalid' : ''}">
            <label for="player2-mobile-${id}">${bi('Mobile Number', GU.mobile)}</label>
            <input id="player2-mobile-${id}" type="tel" inputmode="numeric"
              class="${errors.player2?.mobile ? 'is-invalid' : ''}"
              data-doubles-sport="${id}" data-doubles-player="player2" data-doubles-field="mobile"
              value="${escapeAttr(players.player2.mobile)}"
              placeholder="${escapeAttr(biText('10-digit mobile', GU.placeholderMobile))}"
              maxlength="12" pattern="[1-9][0-9]{9}" />
            ${errors.player2?.mobile ? `<span class="error">${bilingualHtml(errors.player2.mobile)}</span>` : ''}
          </div>
          <div class="field ${errors.player2?.age ? 'is-invalid' : ''}">
            <label for="player2-age-${id}">${bi('Age', GU.age)}</label>
            <input id="player2-age-${id}" type="number" inputmode="numeric" min="${ageLimit.minAge}" max="${ageLimit.maxAge}" step="1"
              class="${errors.player2?.age ? 'is-invalid' : ''}"
              data-doubles-sport="${id}" data-doubles-player="player2" data-doubles-field="age"
              value="${escapeAttr(players.player2.age)}"
              placeholder="${escapeAttr(biText(`${ageLimit.minAge}–${ageLimit.maxAge}`, GU.placeholderAge))}" />
            ${errors.player2?.age ? `<span class="error">${bilingualHtml(errors.player2.age)}</span>` : ''}
          </div>
        </div>
      </div>
      `
          : ''
      }
    </div>
  `
}

function renderStep3(): string {
  const needing = sportsNeedingPlayerDetails()
  const category = state.gender ? genderLabel(state.gender) : ''
  const hasFormatSports = needing.some(needsFormat)
  return `
    <div class="fade-step">
      <h2 class="step-title">${hasFormatSports ? bi('Format & player details', GU.formatTitle) : bi('Player details', GU.playerDetailsTitle)}</h2>
      <p class="step-sub">
        ${bi('Full name, mobile and age are required for each sport.', GU.formatSub)}
        ${hasFormatSports ? bi('For racket sports, also choose Single or Doubles. ', GU.formatSubRacket) : ''}
        ${category ? `${bi(`Live ${category} slot counts update instantly.`, `લાઇવ ${category === 'Male' ? GU.men : GU.women} સ્લોટ તરત અપડેટ થાય છે.`)}` : ''}
      </p>
      ${formatError ? `<div class="alert is-error">${bilingualHtml(formatError)}</div>` : ''}

      ${needing
        .map((id) => {
          const playerOnly = needsPlayerDetailsOnly(id)
          const format = playerOnly ? 'single' : state.formats[id]
          const isSingle = format === 'single'
          const isDouble = format === 'double'
          const showPlayers = playerOnly || isSingle || isDouble
          const players = state.doublesPlayers[id] ?? {
            player1: emptyDoublesPlayer(),
            player2: emptyDoublesPlayer(),
          }
          const errors = doublesErrors[id] ?? {}
          const missingFormat = needsFormat(id) && !format && Boolean(formatError)
          const cardInvalid =
            Boolean(errors.player1 || errors.player2) || missingFormat
          return `
        <div class="format-card ${isSingle || playerOnly ? 'is-single-mode' : ''} ${cardInvalid ? 'is-invalid' : ''}" data-sport-card="${id}">
          <div class="format-card-header">
            <h3><span class="sport-heading">${sportIcon(id)} ${sportBi(id)}</span></h3>
            ${slotBadgeHtml(id)}
          </div>
          ${
            playerOnly
              ? `<p class="step-sub" style="margin:0 0 0.85rem">${bi(`Enter the player full name, mobile and age for ${sportLabel(id)}.`, GU.playerOnlyHint(sportBiText(id)))}</p>`
              : `
          <div class="format-options ${missingFormat ? 'is-invalid' : ''}">
            <button type="button"
              class="choice choice-format ${isSingle ? 'is-selected' : ''}"
              data-action="format" data-sport="${id}" data-format="single">
              <span class="choice-icon-wrap">${iconSingle()}</span>
              <span class="choice-check" aria-hidden="true"></span>
              <span class="choice-title">${bi('Single', GU.single)}</span>
              <span class="choice-meta">${bi('Organizer assigns partner', GU.singleMeta)}</span>
            </button>
            <button type="button"
              class="choice choice-format ${isDouble ? 'is-selected' : ''}"
              data-action="format" data-sport="${id}" data-format="double">
              <span class="choice-icon-wrap">${iconDouble()}</span>
              <span class="choice-check" aria-hidden="true"></span>
              <span class="choice-title">${bi('Double', GU.double)}</span>
              <span class="choice-meta">${bi('Choose your partner', GU.doubleMeta)}</span>
            </button>
          </div>
          `
          }
          ${
            showPlayers
              ? renderPlayerFields(id, players, errors, {
                  showPlayer2: isDouble && !playerOnly,
                  showOrganizerNotice: isSingle && !playerOnly,
                })
              : ''
          }
        </div>
      `
        })
        .join('')}

      <div class="actions">
        <button type="button" class="btn btn-ghost" data-action="back">${withIcon(iconArrowLeft(), bi('Back', GU.back))}</button>
        <button type="button" class="btn btn-primary" data-action="next">${withIcon(iconArrowRight(), phases()[phaseIndex + 1]?.id === 'review' ? bi('Review', GU.review) : bi('Continue', GU.continue))}</button>
      </div>
    </div>
  `
}

function renderStep4(): string {
  const sports = pickIndoor ? buildSelectedSports() : []
  const check = pickIndoor ? canSubmit() : { ok: true, message: '' }
  const hasWaiting = anySeatWaiting()
  return `
    <div class="fade-step review-step">
      <h2 class="step-title">${bi('Review & submit', GU.reviewTitle)}</h2>
      <p class="step-sub">${bi('Confirm every sport you selected. Full sports go on the waiting list.', GU.reviewSub)}</p>
      ${hasWaiting ? `<div class="alert" style="background:#fff8e6;border-color:rgba(212,160,23,0.35);color:#8a6a00">${bi('Some sports are full — you will be added to the waiting list for those.', GU.waitingAlert)}</div>` : ''}
      ${submitError || !check.ok ? `<div class="alert is-error">${bilingualHtml(submitError || check.message)}</div>` : ''}

      <div class="entry-list">
        ${sports.map((sport) => indoorEntryCard(sport, true)).join('')}
        ${cricketReviewCard()}
      </div>

      <div class="actions">
        <button type="button" class="btn btn-ghost" data-action="back">${withIcon(iconArrowLeft(), bi('Back', GU.back))}</button>
        <button type="button" class="btn btn-gold" data-action="next" ${!check.ok ? 'disabled' : ''}>
          ${withIcon(iconArrowRight(), bi('Continue to pay', 'ચુકવણી તરફ'))}
        </button>
      </div>
    </div>
  `
}

function req(): string {
  return '<span class="req" aria-hidden="true">*</span>'
}

function cricketField(
  field: CricketField,
  labelEn: string,
  labelGu: string,
  control: string,
): string {
  const errors = cricketErrors
  const invalid = errors[field] ? ' is-invalid' : ''
  return `
    <div class="field${invalid}">
      <label>${bi(labelEn, labelGu)} ${req()}</label>
      ${control}
      ${errors[field] ? `<span class="error">${bilingualHtml(errors[field]!)}</span>` : ''}
    </div>
  `
}

function renderBegin(): string {
  const indoor = eventById('indoor')
  return `
    <div class="fade-step gate-step">
      <h2 class="step-title">Choose your registration</h2>
      ${beginError ? `<div class="alert is-error">${bilingualHtml(beginError)}</div>` : ''}
      <div class="gate-grid">
        <button type="button" class="gate-card ${pickIndoor ? 'is-selected' : ''}" data-action="toggle-indoor">
          <span class="gate-banner">
            <span>
              <span class="gate-day">${indoor.day}</span>
              <span class="gate-when">${indoor.month} ${indoor.year}</span>
            </span>
            <span class="gate-tick" aria-hidden="true"></span>
          </span>
          <span class="gate-body">
            <span class="gate-kicker">${bi(indoor.date, indoor.dateGu)}</span>
            <span class="gate-title">Indoor</span>
            <span class="gate-label">${bi('Sports on this day', 'આ દિવસની રમતો')}</span>
            <span class="sport-tiles">
              ${indoor.sports
                .map(
                  (sport) => `
                <span class="sport-tile">
                  <span class="sport-tile-photo">${sport.sportId ? sportIcon(sport.sportId) : ''}</span>
                  <span class="sport-tile-name">${sport.en}</span>
                </span>`,
                )
                .join('')}
            </span>
          </span>
        </button>

        <div class="gate-and" aria-hidden="true">And</div>

        <button type="button" class="gate-card ${pickCricket ? 'is-selected' : ''}" data-action="toggle-cricket" data-tone="cricket">
          <span class="gate-banner">
            <span class="cricket-head">
              <span class="gate-banner-title">Cricket sports</span>
              <span class="cricket-dates">
                <span class="cricket-date">Turf 10 Jan 2027</span>
                <span class="cricket-date">Overarm 13 Dec 2026</span>
              </span>
            </span>
            <span class="gate-tick" aria-hidden="true"></span>
          </span>
          <span class="gate-photo" aria-hidden="true"></span>
        </button>
      </div>
      <div class="actions">
        <button type="button" class="btn btn-primary" data-action="next">${withIcon(iconArrowRight(), bi('Next', 'આગળ'))}</button>
      </div>
    </div>
  `
}

function renderCricketGender(): string {
  return `
    <div class="fade-step">
      <h2 class="step-title">${bi('Cricket sports', 'ક્રિકેટ સ્પોર્ટ્સ')}</h2>
      <p class="step-sub">${bi('Choose Male or Female first. Overarm is only for men.', 'પહેલા પુરુષ અથવા સ્ત્રી પસંદ કરો. ઓવરઆર્મ ફક્ત પુરુષો માટે છે.')}</p>
      ${cricketGenderError ? `<div class="alert is-error">${bilingualHtml(cricketGenderError)}</div>` : ''}
      <div class="choice-grid ${cricketGenderError ? 'is-invalid' : ''}">
        <button type="button" class="choice choice-gender ${cricketGender === 'male' ? 'is-selected' : ''}" data-action="cricket-gender" data-gender="male">
          <span class="choice-icon-wrap">${iconMale()}</span>
          <span class="choice-check" aria-hidden="true"></span>
          <span class="choice-title">${bi('Male', GU.male)}</span>
          ${namedCricketSlot('turf', 'male')}
          ${namedCricketSlot('overarm', 'male')}
        </button>
        <button type="button" class="choice choice-gender ${cricketGender === 'female' ? 'is-selected' : ''}" data-action="cricket-gender" data-gender="female">
          <span class="choice-icon-wrap">${iconFemale()}</span>
          <span class="choice-check" aria-hidden="true"></span>
          <span class="choice-title">${bi('Female', GU.female)}</span>
          ${namedCricketSlot('turf', 'female')}
        </button>
      </div>
      <div class="actions">
        <button type="button" class="btn btn-ghost" data-action="back">${withIcon(iconArrowLeft(), bi('Back', GU.back))}</button>
        <button type="button" class="btn btn-primary" data-action="next">${withIcon(iconArrowRight(), bi('Continue', GU.continue))}</button>
      </div>
    </div>
  `
}

function renderCricketChoice(): string {
  const turf = eventById('turf')
  const overarm = eventById('overarm')
  const female = cricketGender === 'female'
  const sub = female
    ? bi('Overarm is only for men. Select Turf.', 'ઓવરઆર્મ ફક્ત પુરુષો માટે છે. ટર્ફ પસંદ કરો.')
    : bi(
        'Select Turf, Overarm, or both. The player form is filled once.',
        'ટર્ફ, ઓવરઆર્મ, અથવા બંને પસંદ કરો. ખેલાડીનું ફોર્મ એક જ વાર ભરાશે.',
      )
  return `
    <div class="fade-step">
      <h2 class="step-title">${bi('Cricket sports', 'ક્રિકેટ સ્પોર્ટ્સ')}</h2>
      <p class="step-sub">${sub}</p>
      ${cricketChoiceError ? `<div class="alert is-error">${bilingualHtml(cricketChoiceError)}</div>` : ''}
      <div class="choice-grid ${cricketChoiceError ? 'is-invalid' : ''}">
        <button type="button" class="choice choice-dated ${pickTurf ? 'is-selected' : ''}" data-action="cricket-kind" data-kind="turf" data-tone="turf">
          <span class="choice-datebar">
            <span class="cricket-date">Turf ${turf.day} ${turf.month} ${turf.year}</span>
            <span class="choice-check" aria-hidden="true"></span>
          </span>
          <span class="choice-title">${bi('Turf', 'ટર્ફ')}</span>
          <span class="choice-slots">
            ${cricketSlotHtml('turf', female ? 'female' : 'male')}
          </span>
        </button>
        ${
          female
            ? ''
            : `<button type="button" class="choice choice-dated ${pickOverarm ? 'is-selected' : ''}" data-action="cricket-kind" data-kind="overarm" data-tone="overarm">
          <span class="choice-datebar">
            <span class="cricket-date">Overarm ${overarm.day} ${overarm.month} ${overarm.year}</span>
            <span class="choice-check" aria-hidden="true"></span>
          </span>
          <span class="choice-title">${bi('Overarm', 'ઓવરઆર્મ')}</span>
          <span class="choice-slots">
            ${cricketSlotHtml('overarm', 'male')}
          </span>
        </button>`
        }
      </div>
      <div class="actions">
        <button type="button" class="btn btn-ghost" data-action="back">${withIcon(iconArrowLeft(), bi('Back', GU.back))}</button>
        <button type="button" class="btn btn-primary" data-action="next">${withIcon(iconArrowRight(), bi('Continue', GU.continue))}</button>
      </div>
    </div>
  `
}

function skillPicker(kind: CricketKind, labelEn: string, labelGu: string): string {
  const selected = cricketSkills[kind]
  const error = skillErrors[kind]
  return `
    <div class="field ${error ? 'is-invalid' : ''}">
      <label>${bi(labelEn, labelGu)} ${req()}</label>
      <div class="skill-row ${error ? 'is-invalid' : ''}">
        ${PLAYER_SKILLS.map(
          (skill) => `
          <button type="button" class="choice skill-choice ${selected === skill.id ? 'is-selected' : ''}" data-action="skill" data-cricket="${kind}" data-skill="${skill.id}">
            <span class="choice-title">${bi(skill.en, skill.gu)}</span>
          </button>`,
        ).join('')}
      </div>
      ${error ? `<span class="error">${bilingualHtml(error)}</span>` : ''}
    </div>
  `
}

function renderCricketForm(): string {
  const player = cricketEntry
  const errors = cricketErrors
  const female = cricketGender === 'female'
  const both = pickTurf && pickOverarm
  const title = both
    ? bi('Cricket player', 'ક્રિકેટ ખેલાડી')
    : pickOverarm
      ? bi('Overarm cricket', 'ઓવરઆર્મ ક્રિકેટ')
      : bi('Turf cricket', 'ટર્ફ ક્રિકેટ')
  const who = female ? bi('Female', GU.female) : bi('Male', GU.male)
  const sub = both
    ? bi(
        'Fill this form once. Choose a skill for Turf and a skill for Overarm.',
        'આ ફોર્મ એક જ વાર ભરો. ટર્ફ અને ઓવરઆર્મ બંને માટે કુશળતા પસંદ કરો.',
      )
    : bi(
        `${who}. Fill the player form once.`,
        `${female ? GU.female : GU.male}. ખેલાડીનું ફોર્મ એક જ વાર ભરો.`,
      )
  const text = (
    field: 'firstName' | 'fatherName' | 'grandfatherName' | 'surname' | 'mobile' | 'age',
    labelEn: string,
    labelGu: string,
    type = 'text',
  ) =>
    cricketField(
      field,
      labelEn,
      labelGu,
      `<input data-cricket="player" data-field="${field}" type="${type}" value="${escapeAttr(player[field])}" ${field === 'mobile' ? 'inputmode="numeric" maxlength="12"' : ''} />`,
    )
  const skills = both
    ? `${skillPicker('turf', 'Turf · Player skills', 'ટર્ફ · ખેલાડીની કુશળતા')}${skillPicker('overarm', 'Overarm · Player skills', 'ઓવરઆર્મ · ખેલાડીની કુશળતા')}`
    : skillPicker(
        pickOverarm ? 'overarm' : 'turf',
        'Player skills',
        'ખેલાડીની કુશળતા',
      )

  return `
    <div class="fade-step">
      <h2 class="step-title">${title}</h2>
      <p class="step-sub">${sub}</p>
      <div class="cricket-slots">
        ${pickTurf ? namedCricketSlot('turf', female ? 'female' : 'male') : ''}
        ${pickOverarm ? namedCricketSlot('overarm', 'male') : ''}
      </div>
      ${text('firstName', "Player's first name", 'ખેલાડીનું પ્રથમ નામ')}
      ${text('fatherName', 'Father/Spouse name', 'પિતા / પતિ-પત્નીનું નામ')}
      ${text('grandfatherName', 'Grandfather name', 'દાદાનું નામ')}
      ${text('surname', 'Surname', 'અટક')}
      ${text('mobile', 'Mobile number', GU.mobile, 'tel')}
      ${text('age', 'Age', GU.age, 'text')}
      ${skills}
      ${cricketField(
        'birthDate',
        'Birth date',
        'જન્મ તારીખ',
        `<input data-cricket="player" data-field="birthDate" type="date" value="${escapeAttr(player.birthDate)}" />`,
      )}
      ${cricketField(
        'area',
        "Player's area",
        'ખેલાડીનો વિસ્તાર',
        `<select data-cricket="player" data-field="area">
          <option value="">${escapeAttr(biText('Select area', 'વિસ્તાર પસંદ કરો'))}</option>
          ${PLAYER_AREAS.map(
            (area) =>
              `<option value="${escapeAttr(area)}" ${player.area === area ? 'selected' : ''}>${escapeHtml(area)}</option>`,
          ).join('')}
        </select>`,
      )}
      <div class="field${errors.photo ? ' is-invalid' : ''}">
        <label>${bi("Player's photo", 'ખેલાડીનો ફોટો')} ${req()}</label>
        <p class="section-hint">${bi('JPG or PNG. We optimize it to stay within 3 MB.', 'JPG અથવા PNG. અમે તેને ૩ MBની અંદર લાવીએ છીએ.')}</p>
        <label class="btn btn-ghost photo-pick">
          ${withIcon(iconCamera(), photoBusy ? bi('Optimizing…', 'ઓપ્ટિમાઇઝ થઈ રહ્યું છે…') : bi('Upload photo', 'ફોટો અપલોડ કરો'))}
          <input type="file" accept="image/*" data-cricket-photo="player" ${photoBusy ? 'disabled' : ''} />
        </label>
        ${
          player.photoUrl
            ? `<div class="photo-preview"><img src="${player.photoUrl}" alt="" /><span>${escapeHtml(player.photoName)}</span></div>`
            : ''
        }
        ${errors.photo ? `<span class="error">${bilingualHtml(errors.photo)}</span>` : ''}
      </div>
      <div class="actions">
        <button type="button" class="btn btn-ghost" data-action="back">${withIcon(iconArrowLeft(), bi('Back', GU.back))}</button>
        <button type="button" class="btn btn-primary" data-action="next">${withIcon(iconArrowRight(), bi('Continue', GU.continue))}</button>
      </div>
    </div>
  `
}

function seatPill(status: 'confirmed' | 'waiting'): string {
  const waiting = status === 'waiting'
  return `<span class="seat-pill ${waiting ? 'is-waiting' : 'is-confirmed'}">${waiting ? bi('Waiting', 'વેઇટિંગ') : bi('Confirmed', 'કન્ફર્મ')}</span>`
}

function playerLine(
  labelEn: string,
  labelGu: string,
  name: string | undefined,
  mobile: string | undefined,
  age: number | string | undefined,
): string {
  const bits = [name?.trim() || '—', mobile?.trim() || '—']
  if (age != null && String(age).trim() !== '') bits.push(String(age))
  return `<p class="entry-line"><span>${bi(labelEn, labelGu)}</span><strong>${escapeHtml(bits.join(' · '))}</strong></p>`
}

function indoorEntryCard(sport: SelectedSport, showSlots = false): string {
  if (sport.sportId === 'turf' || sport.sportId === 'overarm') return ''
  const existing = describeSportConflict(sport, sportLabel(sport.sportId), state.mobile)
  const format =
    sport.sportId === 'football'
      ? bi('Team', 'ટીમ')
      : sport.format === 'double'
        ? bi('Doubles', 'ડબલ્સ')
        : bi('Singles', 'સિંગલ્સ')
  const people =
    sport.format === 'double'
      ? `${playerLine('Player 1', 'ખેલાડી ૧', sport.player1Name, sport.player1Mobile, sport.player1Age)}${playerLine('Player 2', 'ખેલાડી ૨', sport.player2Name, sport.player2Mobile, sport.player2Age)}`
      : playerLine(
          'Player',
          'ખેલાડી',
          sport.player1Name || state.fullName,
          sport.player1Mobile || normalizeMobile(state.mobile),
          sport.player1Age,
        )
  const note = existing ? `<p class="existing-detail">${bilingualHtml(existing)}</p>` : ''
  const slots = showSlots && state.gender ? slotBadgeFor(sport.sportId, state.gender) : ''
  return `
    <article class="entry-card ${existing ? 'is-error' : ''} ${sport.status === 'waiting' ? 'is-waiting' : 'is-confirmed'}" data-sport="${sport.sportId}">
      <header class="entry-head">
        <span class="entry-icon">${sportIcon(sport.sportId)}</span>
        <div class="entry-copy">
          <h4>${sportBi(sport.sportId)}</h4>
          <p>${format}</p>
          ${slots}
        </div>
        ${seatPill(sport.status)}
      </header>
      ${people}
      ${note}
    </article>
  `
}

function cricketStatus(which: CricketKind): 'confirmed' | 'waiting' {
  const saved = receiptCricketStatus[which]
  if (currentPhase().id === 'done' && saved) return saved
  const gender = which === 'overarm' || cricketGender !== 'female' ? 'male' : 'female'
  return cricketSlotCopy(which, gender).left > 0 ? 'confirmed' : 'waiting'
}

function cricketSkillLine(which: CricketKind): string {
  const skill = PLAYER_SKILLS.find((item) => item.id === cricketSkills[which])
  const label = which === 'turf' ? bi('Turf', 'ટર્ફ') : bi('Overarm', 'ઓવરઆર્મ')
  const text = skill ? bi(skill.en, skill.gu) : '—'
  return `<p class="entry-line"><span>${label}</span><strong>${text}</strong>${seatPill(cricketStatus(which))}</p>`
}

function cricketReviewCard(): string {
  if (!pickTurf && !pickOverarm) return ''
  const player = cricketEntry
  const both = pickTurf && pickOverarm
  const heading = both ? 'Cricket' : pickTurf ? 'Turf cricket' : 'Overarm cricket'
  const headingGu = both ? 'ક્રિકેટ' : pickTurf ? 'ટર્ફ ક્રિકેટ' : 'ઓવરઆર્મ ક્રિકેટ'
  const who = both
    ? `${bi('Turf', 'ટર્ફ')} · ${bi('Overarm', 'ઓવરઆર્મ')}`
    : pickOverarm
      ? bi('Men only', 'ફક્ત પુરુષ')
      : bi(
          cricketGender === 'female' ? 'Female' : 'Male',
          cricketGender === 'female' ? GU.female : GU.male,
        )
  const name = [player.firstName, player.fatherName, player.grandfatherName, player.surname]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ')
  const details = [player.mobile.trim(), player.age.trim(), player.birthDate.trim(), player.area.trim()]
    .filter(Boolean)
    .join(' · ')
  return `
    <article class="entry-card" data-tone="${both ? 'turf' : pickTurf ? 'turf' : 'overarm'}">
      <header class="entry-head">
        ${
          player.photoUrl
            ? `<img class="entry-photo" src="${player.photoUrl}" alt="" />`
            : `<span class="entry-icon">${iconCricket()}</span>`
        }
        <div class="entry-copy">
          <h4>${bi(heading, headingGu)}</h4>
          <p>${who}</p>
        </div>
      </header>
      <p class="entry-line"><span>${bi('Player', 'ખેલાડી')}</span><strong>${escapeHtml(name || '—')}</strong></p>
      ${details ? `<p class="entry-line"><span>${bi('Details', 'વિગત')}</span><strong>${escapeHtml(details)}</strong></p>` : ''}
      ${pickTurf ? cricketSkillLine('turf') : ''}
      ${pickOverarm ? cricketSkillLine('overarm') : ''}
    </article>
  `
}

function inr(amount: number): string {
  return `₹${amount.toLocaleString('en-IN')}`
}

function feeLines(
  sports = pickIndoor ? buildSelectedSports() : [],
): { label: string; amount: number }[] {
  const lines: { label: string; amount: number }[] = []
  if (pickIndoor) {
    for (const sport of sports) {
      const each = getFee(sport.sportId)
      const players = seatWeight(sport.format)
      lines.push({
        label: `${sportLabel(sport.sportId)} · ${players} × ${inr(each)}`,
        amount: each * players,
      })
    }
  }
  if (pickTurf) {
    lines.push({
      label: `Turf cricket · 1 × ${inr(getFee('turf'))}`,
      amount: getFee('turf'),
    })
  }
  if (pickOverarm) {
    lines.push({
      label: `Overarm cricket · 1 × ${inr(getFee('overarm'))}`,
      amount: getFee('overarm'),
    })
  }
  return lines
}

function amountDue(): number {
  return feeLines().reduce((sum, line) => sum + line.amount, 0)
}

function billHtml(lines: { label: string; amount: number }[], total: number): string {
  return `
    <section class="bill">
      <p class="bill-kicker">${bi('Amount due', 'ચૂકવવાની રકમ')}</p>
      <ul class="bill-lines">
        ${lines
          .map(
            (line) =>
              `<li><span>${escapeHtml(line.label)}</span><strong>${inr(line.amount)}</strong></li>`,
          )
          .join('')}
      </ul>
      <p class="bill-total"><span>${bi('Total', 'કુલ')}</span><strong>${inr(total)}</strong></p>
    </section>
  `
}

function registrationCards(sports: ReturnType<typeof buildSelectedSports>): string {
  return `
    <div class="entry-list">
      ${sports.map((sport) => indoorEntryCard(sport)).join('')}
      ${cricketReviewCard()}
    </div>
  `
}

function renderPay(): string {
  const total = amountDue()
  const showQr = total < QR_LIMIT
  const lines = feeLines()
  const sports = pickIndoor ? buildSelectedSports() : []
  const hasWaiting = anySeatWaiting()
  return `
    <div class="fade-step pay-step">
      <h2 class="step-title">${bi('Pay', 'ચુકવણી')}</h2>
      <p class="step-sub">${bi('Pay the entry fee online, or hand the cash to one of the organisers.', 'એન્ટ્રી ફી ઓનલાઇન ચૂકવો, અથવા રોકડ આયોજકને આપો.')}</p>
      ${hasWaiting ? `<div class="alert" style="background:#fff8e6;border-color:rgba(212,160,23,0.35);color:#8a6a00">${bi('Some sports are full — you will be added to the waiting list for those.', GU.waitingAlert)}</div>` : ''}
      ${payError ? `<div class="alert is-error">${bilingualHtml(payError)}</div>` : ''}
      <div class="entry-list">
        ${sports.map((sport) => indoorEntryCard(sport, true)).join('')}
        ${cricketReviewCard()}
      </div>
      ${billHtml(lines, total)}

      <div class="choice-grid">
        <button type="button" class="choice ${payMode === 'online' ? 'is-selected' : ''}" data-action="pay-mode" data-mode="online">
          <span class="choice-check" aria-hidden="true"></span>
          <span class="choice-title">${bi('Pay online', 'ઓનલાઇન ચૂકવો')}</span>
          <span class="choice-meta">${bi('QR, UPI, or bank transfer', 'QR, UPI, અથવા બેંક')}</span>
        </button>
        <button type="button" class="choice ${payMode === 'cash' ? 'is-selected' : ''}" data-action="pay-mode" data-mode="cash">
          <span class="choice-check" aria-hidden="true"></span>
          <span class="choice-title">${bi('Cash', 'રોકડ')}</span>
          <span class="choice-meta">${bi('Select who you paid', 'જેને આપ્યું તે પસંદ કરો')}</span>
        </button>
      </div>

      ${
        payMode === 'online'
          ? `
        <div class="pay-online">
          ${
            showQr
              ? `<figure class="pay-qr">
            <img src="/upi-qr.png" alt="Scan to pay ${escapeAttr(BANK.name)}" />
            <figcaption>${bi('Scan to pay with any UPI app', 'કોઈ પણ UPI એપથી સ્કેન કરીને ચૂકવો')}</figcaption>
          </figure>`
              : `<p class="pay-note">${bi(`QR is shown only when the amount is below ${inr(QR_LIMIT)}. Use UPI or the bank account.`, `QR ફક્ત ${inr(QR_LIMIT)}થી ઓછી રકમ માટે છે. UPI અથવા બેંક એકાઉન્ટ વાપરો.`)}</p>`
          }
          <div class="pay-block">
            <p class="pay-kicker">${bi('Or UPI', 'અથવા UPI')}</p>
            <p class="pay-value">${escapeHtml(UPI_ID)}</p>
            <button type="button" class="btn btn-ghost btn-small" data-action="copy-text" data-copy="${escapeAttr(UPI_ID)}">${bi('Copy UPI', 'UPI કૉપી')}</button>
          </div>
          <div class="pay-block">
            <p class="pay-kicker">${bi('Or bank transfer', 'અથવા બેંક ટ્રાન્સફર')}</p>
            <ol class="pay-bank">
              <li><span>A/c No.</span><strong>${BANK.account}</strong></li>
              <li><span>IFSC Code</span><strong>${BANK.ifsc}</strong></li>
              <li><span>Home Branch</span><strong>${escapeHtml(BANK.branch)}</strong></li>
              <li><span>UPI ID</span><strong>${escapeHtml(UPI_ID)}</strong></li>
            </ol>
            <p class="pay-account-name">${escapeHtml(BANK.name)}</p>
          </div>
          <div class="field">
            <label>${bi('Upload payment screenshot', 'ચુકવણીનો સ્ક્રીનશૉટ અપલોડ કરો')}</label>
            <input data-payment-shot type="file" accept="image/*" />
            ${
              paymentShot
                ? `<p class="pay-file">${escapeHtml(paymentShotName || 'Screenshot added')}</p><img class="pay-shot" src="${paymentShot}" alt="" />`
                : `<p class="pay-file">${bi('After payment, add a screenshot and submit.', 'ચુકવણી પછી સ્ક્રીનશૉટ ઉમેરીને સબમિટ કરો.')}</p>`
            }
          </div>
        </div>`
          : ''
      }

      ${
        payMode === 'cash'
          ? `
        <div class="field">
          <label for="cashCollector">${bi('Person you gave the amount to', 'જેને રકમ આપી તે વ્યક્તિ')}</label>
          <select id="cashCollector" data-cash-collector>
            <option value="">${bi('Select a name', 'નામ પસંદ કરો')}</option>
            ${CASH_COLLECTORS.map(
              (name) =>
                `<option value="${escapeAttr(name)}" ${cashCollector === name ? 'selected' : ''}>${escapeHtml(name)}</option>`,
            ).join('')}
          </select>
        </div>`
          : ''
      }

      <div class="actions">
        <button type="button" class="btn btn-ghost" data-action="back">${withIcon(iconArrowLeft(), bi('Back', GU.back))}</button>
        <button type="button" class="btn btn-gold" data-action="submit" ${payMode && !submitBusy ? '' : 'disabled'}>
          ${withIcon(iconCheck(), submitBusy ? bi('Saving…', 'સાચવી રહ્યા છીએ…') : bi('Submit', 'સબમિટ'))}
        </button>
      </div>
    </div>
  `
}

function renderDone(): string {
  const sports = pickIndoor ? lastRegisteredSports : []
  const lines = frozenBill ?? feeLines(sports)
  const total = lines.reduce((sum, line) => sum + line.amount, 0)
  const when = new Date().toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
  const paidHow =
    payMode === 'cash'
      ? `Cash · ${cashCollector}`
      : 'Online · UPI / bank'
  return `
    <div class="fade-step success-screen">
      <article class="receipt" id="receipt-sheet">
        <header class="receipt-brand">
          <img class="receipt-logo" src="/chanasma-logo.png" alt="શ્રી ચાણસ્મા જૈન યુવા યુથ" />
          <p class="receipt-wordmark"><span>CHANASMA</span><span>OLYMPIC</span></p>
          <svg class="receipt-rings" viewBox="0 0 168 36" width="168" height="36" aria-hidden="true">
            <g fill="none" stroke-width="3.2">
              <circle cx="16" cy="18" r="12" stroke="#0085c7" />
              <circle cx="46" cy="18" r="12" stroke="#f4c300" />
              <circle cx="76" cy="18" r="12" stroke="#111111" />
              <circle cx="106" cy="18" r="12" stroke="#009f3d" />
              <circle cx="136" cy="18" r="12" stroke="#df0024" />
            </g>
          </svg>
          <p class="receipt-sponsor-pill"><span>Main sponsor</span><strong>Jarin Bhai</strong></p>
        </header>
        <h2>${bi('Payment receipt', 'ચુકવણીની રસીદ')}</h2>
        <p class="receipt-no">${escapeHtml(receiptNo)}</p>
        <p class="receipt-when">${escapeHtml(when)}</p>
        <div id="receipt-body">
          ${registrationCards(sports)}
          ${billHtml(lines, total)}
          <p class="receipt-paid"><span>${bi('Paid by', 'ચુકવણી')}</span><strong>${escapeHtml(paidHow)}</strong></p>
          ${
            payMode === 'online' && paymentShot
              ? `<img class="pay-shot" src="${paymentShot}" alt="${escapeAttr(bi('Payment screenshot', 'ચુકવણીનો સ્ક્રીનશૉટ'))}" />`
              : ''
          }
        </div>
      </article>
      <div class="actions">
        <button type="button" class="btn btn-ghost" data-action="download-receipt">${bi('Download PDF', 'PDF ડાઉનલોડ')}</button>
        <button type="button" class="btn btn-ghost" data-action="print">${bi('Print receipt', 'રસીદ છાપો')}</button>
        <button type="button" class="btn btn-primary" data-action="reset">
          ${withIcon(iconSpark(), bi('Start again', 'ફરી શરૂ કરો'))}
        </button>
      </div>
    </div>
  `
}

function isMobileDevice(): boolean {
  return (
    window.matchMedia('(max-width: 720px)').matches ||
    /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
  )
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve())
  })
}

async function captureReceiptCanvas(
  sheet: HTMLElement,
): Promise<HTMLCanvasElement> {
  const { default: html2canvas } = await import('html2canvas-pro')
  const meta = document.querySelector('meta[name="viewport"]')
  const previousViewport = meta?.getAttribute('content') ?? ''
  const previousScroll = window.scrollY
  const previousWidth = sheet.style.width
  const previousMaxWidth = sheet.style.maxWidth
  const mobile = isMobileDevice()
  if (mobile) {
    meta?.setAttribute('content', 'width=800, initial-scale=1, maximum-scale=1')
    await nextFrame()
    await nextFrame()
  }
  sheet.style.width = '640px'
  sheet.style.maxWidth = '640px'
  window.scrollTo(0, 0)
  await nextFrame()
  try {
    if (document.fonts?.ready) await document.fonts.ready
    await Promise.all(
      [...sheet.querySelectorAll('img')].map((img) =>
        img.decode?.().catch(() => undefined) ?? Promise.resolve(),
      ),
    )
    const canvas = await html2canvas(sheet, {
      backgroundColor: '#ffffff',
      scale: 2,
      useCORS: true,
      scrollX: 0,
      scrollY: 0,
      windowWidth: 800,
      onclone: (_doc, copy) => {
        copy.style.width = '640px'
        copy.style.maxWidth = '640px'
        copy.style.background = '#ffffff'
        copy.style.overflow = 'visible'
        copy.querySelectorAll('img').forEach((img) => {
          img.style.maxWidth = '100%'
          if (
            img.classList.contains('pay-shot') ||
            img.classList.contains('entry-photo')
          ) {
            img.style.width = '180px'
            img.style.height = '180px'
            img.style.objectFit = 'cover'
          }
        })
      },
    })
    if (canvas.width < 10 || canvas.height < 10) {
      throw new Error('Receipt capture was empty')
    }
    return canvas
  } finally {
    sheet.style.width = previousWidth
    sheet.style.maxWidth = previousMaxWidth
    if (mobile && meta) meta.setAttribute('content', previousViewport)
    window.scrollTo(0, previousScroll)
  }
}

function addCanvasPages(
  pdf: import('jspdf').jsPDF,
  canvas: HTMLCanvasElement,
): void {
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  const margin = 28
  const usableWidth = pageWidth - margin * 2
  const usableHeight = pageHeight - margin * 2
  const sliceHeight = Math.max(
    1,
    Math.floor((usableHeight * canvas.width) / usableWidth),
  )
  let offset = 0
  let page = 0
  while (offset < canvas.height && page < 12) {
    const height = Math.min(sliceHeight, canvas.height - offset)
    const slice = document.createElement('canvas')
    slice.width = canvas.width
    slice.height = height
    const context = slice.getContext('2d')
    if (!context) throw new Error('Could not draw the receipt')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, slice.width, slice.height)
    context.drawImage(
      canvas,
      0,
      offset,
      canvas.width,
      height,
      0,
      0,
      canvas.width,
      height,
    )
    if (page > 0) pdf.addPage()
    const drawHeight = (height * usableWidth) / canvas.width
    pdf.addImage(
      slice.toDataURL('image/jpeg', 0.92),
      'JPEG',
      margin,
      margin,
      usableWidth,
      drawHeight,
    )
    offset += height
    page += 1
  }
}

async function savePdfFile(blob: Blob, filename: string): Promise<void> {
  const file = new File([blob], filename, { type: 'application/pdf' })
  if (
    isMobileDevice() &&
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [file] })
  ) {
    try {
      await navigator.share({
        files: [file],
        title: 'CHANASMA Olympic receipt',
      })
      return
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
    }
  }

  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 4000)
}

function showReceiptOffer(blob: Blob, filename: string): void {
  document.querySelector('.receipt-offer')?.remove()
  const file = new File([blob], filename, { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const wrap = document.createElement('div')
  wrap.className = 'receipt-offer'
  wrap.innerHTML = `
    <div class="receipt-offer-card" role="dialog" aria-modal="true">
      <h3>${bi('Save receipt', 'રસીદ સાચવો')}</h3>
      <p>${bi('Tap Save, then choose Files, Drive, or WhatsApp.', 'Save દબાવો, પછી Files, Drive અથવા WhatsApp પસંદ કરો.')}</p>
      <div class="receipt-offer-actions">
        <button type="button" class="btn btn-gold" data-offer="save">${bi('Save PDF', 'PDF સાચવો')}</button>
        <button type="button" class="btn btn-ghost" data-offer="close">${bi('Close', 'બંધ કરો')}</button>
      </div>
    </div>`
  const close = () => {
    wrap.remove()
    URL.revokeObjectURL(url)
  }
  wrap.querySelector<HTMLButtonElement>('[data-offer="close"]')?.addEventListener('click', close)
  wrap.querySelector<HTMLButtonElement>('[data-offer="save"]')?.addEventListener('click', () => {
    void (async () => {
      if (
        typeof navigator.share === 'function' &&
        typeof navigator.canShare === 'function' &&
        navigator.canShare({ files: [file] })
      ) {
        try {
          await navigator.share({ files: [file], title: 'CHANASMA Olympic receipt' })
          return
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') return
        }
      }
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      document.body.appendChild(link)
      link.click()
      link.remove()
    })()
  })
  document.body.appendChild(wrap)
}

async function downloadReceipt(): Promise<void> {
  const button = document.querySelector<HTMLButtonElement>(
    '[data-action="download-receipt"]',
  )
  const sheet = document.getElementById('receipt-sheet')
  const label = button?.innerHTML || ''
  if (!sheet) return
  if (button) {
    button.disabled = true
    button.textContent = 'Preparing…'
  }
  const preparing = document.createElement('div')
  preparing.className = 'receipt-offer'
  preparing.innerHTML = `<div class="receipt-offer-card"><p>${bi('Preparing your receipt…', 'રસીદ તૈયાર થઈ રહી છે…')}</p></div>`
  document.body.appendChild(preparing)
  try {
    const { jsPDF } = await import('jspdf')
    const canvas = await captureReceiptCanvas(sheet)
    const pdf = new jsPDF({ unit: 'pt', format: 'a4', compress: true })
    addCanvasPages(pdf, canvas)
    const filename = `${receiptNo || 'chansma-receipt'}.pdf`
    const blob = pdf.output('blob')
    preparing.remove()
    if (isMobileDevice()) {
      showReceiptOffer(blob, filename)
    } else {
      await savePdfFile(blob, filename)
    }
  } catch (error) {
    console.error(error)
    preparing.remove()
    if (button) {
      button.disabled = false
      button.textContent = 'Download failed. Try again.'
      return
    }
  }
  if (button) {
    button.disabled = false
    button.innerHTML = label
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replaceAll("'", '&#39;')
}

function renderBody(): string {
  const phase = currentPhase()
  if (phase.id === 'begin') return renderBegin()
  if (phase.id === 'cricket-gender') return renderCricketGender()
  if (phase.id === 'cricket-choice') return renderCricketChoice()
  if (phase.id === 'cricket-form') return renderCricketForm()
  if (phase.id === 'review') return renderStep4()
  if (phase.id === 'pay') return renderPay()
  if (phase.id === 'done') return renderDone()
  if (phase.id !== 'indoor') return renderBegin()
  if (phase.indoorStep === 1) return renderStep1()
  if (phase.indoorStep === 2) return renderStep2()
  if (phase.indoorStep === 3) return renderStep3()
  return renderStep4()
}

function render(): void {
  setActiveEvent(pickIndoor ? 'indoor' : null)

  const phase = currentPhase()
  const key = phaseKey(phase)
  const shell = app.querySelector<HTMLElement>('.shell:not(.shell-admin)')
  const panel = shell?.querySelector<HTMLElement>('.panel')
  const panelBody = panel?.querySelector<HTMLElement>('.panel-body')
  const canPatch = Boolean(shell && panel && panelBody)
  const stepChanged = !canPatch || paintedKey !== key

  let body = renderBody()

  if (!stepChanged) {
    body = body.replace(
      /class="fade-step([^"]*)"/,
      'class="fade-step is-static$1"',
    )
  } else {
    const dirClass =
      stepAnimDir === 'back' ? 'fade-back' : 'fade-forward'
    body = body.replace(
      /class="fade-step([^"]*)"/,
      `class="fade-step ${dirClass}$1"`,
    )
  }

  if (canPatch && shell && panel && panelBody) {
    const brandSub = shell.querySelector<HTMLElement>('.brand p')
    if (brandSub) {
      const subtitle = brandSubHtml()
      brandSub.innerHTML = subtitle
      brandSub.hidden = subtitle.trim() === ''
    }
    const scrollY = shouldRevealErrors
      ? null
      : stepChanged
        ? 0
        : window.scrollY
    shell.classList.toggle('shell-gate', phase.id === 'begin')
    panel.dataset.group = phase.id === 'begin' ? '' : phaseGroup(phase)
    const progress = panel.querySelector('.progress-track')
    const showWizard = phase.id !== 'begin'
    if (!showWizard) {
      progress?.remove()
    } else if (progress) {
      progress.outerHTML = renderProgress()
    } else {
      panel.insertAdjacentHTML('afterbegin', renderProgress())
    }
    // Remount body so CSS animations always restart on step change
    panelBody.replaceChildren()
    panelBody.innerHTML = body
    if (scrollY !== null) {
      window.scrollTo({
        top: scrollY,
        behavior: stepChanged ? 'smooth' : 'auto',
      })
    }
  } else {
    app.innerHTML = `
    <a class="nav-corner nav-corner-left" href="#/admin">${iconAdmin()} Admin</a>

    <div class="shell${phase.id === 'begin' ? ' shell-gate' : ''}">
      <header class="brand">
        <img class="brand-logo" src="/chanasma-logo.png" alt="શ્રી ચાણસ્મા જૈન યુવા યુથ" />
        <h1><span class="brand-place">CHANASMA</span><span class="brand-olympic">OLYMPIC</span></h1>
        <div class="olympic-rings" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span></div>
        <p${brandSubHtml() ? '' : ' hidden'}>${brandSubHtml()}</p>
        <div class="brand-sponsor"><span>Main sponsor</span><strong>Jarin Bhai</strong></div>
      </header>

      <main class="panel" data-group="${phase.id === 'begin' ? '' : phaseGroup(phase)}">
        ${phase.id !== 'begin' ? renderProgress() : ''}
        <div class="panel-body">
          ${body}
        </div>
      </main>
    </div>
  `
  }

  paintedKey = key
  bindEvents()
  centerActiveStep()

  if (phase.id === 'indoor' && phase.indoorStep >= 2) startLiveSlotUpdates()
  else stopLiveSlotUpdates()
  watchSeats()

  if (shouldRevealErrors) {
    shouldRevealErrors = false
    // Skip preserving scroll when we need to jump to the error
    revealFormErrors()
  }
}

function centerActiveStep(): void {
  const track = document.querySelector<HTMLElement>('.progress-track')
  const active = track?.querySelector<HTMLElement>('.progress-item.is-active')
  if (!track || !active) return
  if (track.scrollWidth <= track.clientWidth + 1) return
  const trackBox = track.getBoundingClientRect()
  const activeBox = active.getBoundingClientRect()
  const delta =
    activeBox.left - trackBox.left - (track.clientWidth - activeBox.width) / 2
  track.scrollLeft = Math.max(0, track.scrollLeft + delta)
}

function doublesErrorSignature(): string {
  return JSON.stringify(doublesErrors)
}

function checkPlayerMobileConflict(
  sportId: SportId,
  playerKey: 'player1' | 'player2',
): void {
  const players = state.doublesPlayers[sportId]
  const mobile = players?.[playerKey].mobile ?? ''
  const normalized = normalizeMobile(mobile)

  // Clear previous "already registered" conflict for this field first
  const prevMobileErr = doublesErrors[sportId]?.[playerKey]?.mobile ?? ''
  if (
    prevMobileErr.includes('registered') ||
    prevMobileErr.includes('નોંધાયેલ')
  ) {
    delete doublesErrors[sportId]![playerKey]!.mobile
    if (
      doublesErrors[sportId]?.[playerKey] &&
      Object.keys(doublesErrors[sportId]![playerKey]!).length === 0
    ) {
      delete doublesErrors[sportId]![playerKey]
    }
  }

  if (!normalized || !isValidMobileLocal(mobile)) return

  const conflict = describePlayerMobileConflict(
    normalized,
    sportId,
    sportLabel(sportId),
  )

  if (conflict) {
    doublesErrors[sportId] = {
      ...doublesErrors[sportId],
      [playerKey]: {
        ...doublesErrors[sportId]?.[playerKey],
        mobile: conflict,
      },
    }
  }
}

/** On focus-out, re-check every player mobile on every sport card */
function checkAllPlayerMobileConflictsOnPage(): void {
  for (const sportId of sportsNeedingPlayerDetails()) {
    checkPlayerMobileConflict(sportId, 'player1')
    if (needsFormat(sportId) && state.formats[sportId] === 'double') {
      checkPlayerMobileConflict(sportId, 'player2')
    }
  }
}

async function applyPhoto(file: File): Promise<void> {
  photoBusy = true
  delete cricketErrors.photo
  render()
  try {
    const optimized = await optimizePhoto(file)
    cricketEntry.photoUrl = optimized.dataUrl
    cricketEntry.photoName = file.name
  } catch (error) {
    cricketErrors.photo =
      error instanceof Error ? error.message : 'Could not use this photo.'
  }
  photoBusy = false
  render()
}

function bindEvents(): void {
  app.querySelectorAll<HTMLSelectElement>('select[data-cash-collector]').forEach((select) => {
    select.addEventListener('change', () => {
      cashCollector = select.value
      payError = ''
    })
  })

  app.querySelectorAll<HTMLInputElement>('input[data-payment-shot]').forEach((input) => {
    input.addEventListener('change', () => {
      const file = input.files?.[0]
      if (!file) return
      if (!file.type.startsWith('image/')) {
        payError = biText('Upload a photo of the payment.', 'ચુકવણીનો ફોટો અપલોડ કરો.')
        render()
        return
      }
      if (file.size > 8 * 1024 * 1024) {
        payError = biText('Screenshot must be under 8 MB.', 'સ્ક્રીનશૉટ 8 MBથી નાનો હોવો જોઈએ.')
        render()
        return
      }
      const reader = new FileReader()
      reader.onload = () => {
        paymentShot = String(reader.result || '')
        paymentShotName = file.name
        payError = ''
        render()
      }
      reader.readAsDataURL(file)
    })
  })

  app.querySelectorAll<HTMLSelectElement>('select[data-cricket]').forEach((select) => {
    select.addEventListener('change', () => {
      cricketEntry.area = select.value
      delete cricketErrors.area
      render()
    })
  })

  app.querySelectorAll<HTMLInputElement>('input[data-cricket-photo]').forEach((input) => {
    input.addEventListener('change', () => {
      const file = input.files?.[0]
      if (!file) return
      void applyPhoto(file)
    })
  })

  app.querySelectorAll<HTMLInputElement>('input[data-field="birthDate"]').forEach((input) => {
    input.addEventListener('change', () => {
      cricketEntry.birthDate = input.value
      const age = ageFromBirthDate(input.value)
      if (age != null) cricketEntry.age = String(age)
      render()
    })
  })

  app.querySelectorAll<HTMLInputElement>('input').forEach((input) => {
    input.addEventListener('input', () => {
      const doublesSport = input.dataset.doublesSport as SportId | undefined
      const doublesPlayer = input.dataset.doublesPlayer as
        | 'player1'
        | 'player2'
        | undefined
      const doublesField = input.dataset.doublesField as
        | keyof DoublesPlayer
        | undefined

      if (doublesSport && doublesPlayer && doublesField) {
        const players = ensureDoublesPlayers(doublesSport)
        let nextValue = input.value
        if (doublesField === 'mobile') {
          nextValue = sanitizeMobileInput(input.value)
          if (input.value !== nextValue) input.value = nextValue
        } else if (doublesField === 'age') {
          nextValue = input.value.replace(/\D/g, '').slice(0, 3)
          if (input.value !== nextValue) input.value = nextValue
        }
        players[doublesPlayer][doublesField] = nextValue
        if (doublesErrors[doublesSport]?.[doublesPlayer]?.[doublesField]) {
          delete doublesErrors[doublesSport]![doublesPlayer]![doublesField]
          const field = input.closest('.field')
          field?.classList.remove('is-invalid')
          input.classList.remove('is-invalid')
          field?.querySelector('.error')?.remove()
        }
        return
      }

      const cricketWhich = input.dataset.cricket
      const cricketFieldName = input.dataset.field as CricketField | undefined
      if (cricketWhich && cricketFieldName && cricketFieldName !== 'skill' && cricketFieldName !== 'area' && cricketFieldName !== 'photo') {
        const player = cricketEntry
        let nextValue = input.value
        if (cricketFieldName === 'mobile') {
          nextValue = sanitizeMobileInput(input.value)
          if (input.value !== nextValue) input.value = nextValue
        } else if (cricketFieldName === 'age') {
          nextValue = input.value.replace(/\D/g, '').slice(0, 3)
          if (input.value !== nextValue) input.value = nextValue
        }
        if (
          cricketFieldName === 'firstName' ||
          cricketFieldName === 'fatherName' ||
          cricketFieldName === 'grandfatherName' ||
          cricketFieldName === 'surname' ||
          cricketFieldName === 'mobile' ||
          cricketFieldName === 'age' ||
          cricketFieldName === 'birthDate'
        ) {
          player[cricketFieldName] = nextValue
        }
        const bag = cricketErrors
        if (bag[cricketFieldName]) {
          delete bag[cricketFieldName]
          const field = input.closest('.field')
          field?.classList.remove('is-invalid')
          input.classList.remove('is-invalid')
          field?.querySelector('.error')?.remove()
        }
        return
      }

      const key = input.name as 'fullName' | 'mobile'
      if (key === 'fullName' || key === 'mobile') {
        if (key === 'mobile') {
          const next = sanitizeMobileInput(input.value)
          if (input.value !== next) input.value = next
          state.mobile = next
        } else {
          state.fullName = input.value
        }
        if (detailErrors[key]) {
          delete detailErrors[key]
          const field = input.closest('.field')
          field?.classList.remove('is-invalid')
          input.classList.remove('is-invalid')
          field?.querySelector('.error')?.remove()
        }
      }
    })

    input.addEventListener('blur', () => {
      if (Date.now() < suppressBlurRenderUntil) return

      const doublesSport = input.dataset.doublesSport as SportId | undefined
      const doublesPlayer = input.dataset.doublesPlayer as
        | 'player1'
        | 'player2'
        | undefined
      const doublesField = input.dataset.doublesField as
        | keyof DoublesPlayer
        | undefined

      if (!doublesSport || !doublesPlayer || !doublesField) return
      if (doublesField !== 'mobile' && doublesField !== 'fullName') return

      const players = ensureDoublesPlayers(doublesSport)
      players[doublesPlayer][doublesField] = input.value
      const before = doublesErrorSignature()
      checkAllPlayerMobileConflictsOnPage()
      if (doublesErrorSignature() !== before) {
        render()
      }
    })
  })

  app.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((btn) => {
    // Keep focus on the button so input blur does not wipe the DOM before click (mobile).
    btn.addEventListener('pointerdown', (event) => {
      suppressBlurRenderUntil = Date.now() + 400
      event.preventDefault()
    })

    btn.addEventListener('click', () => {
      const action = btn.dataset.action
      if (action === 'toggle-indoor') {
        pickIndoor = !pickIndoor
        beginError = ''
        render()
      } else if (action === 'toggle-cricket') {
        pickCricket = !pickCricket
        if (!pickCricket) {
          pickTurf = false
          pickOverarm = false
          cricketGender = null
        }
        beginError = ''
        render()
      } else if (action === 'cricket-kind' && (btn.dataset.kind === 'turf' || btn.dataset.kind === 'overarm')) {
        if (btn.dataset.kind === 'overarm' && cricketGender === 'female') return
        if (btn.dataset.kind === 'turf') pickTurf = !pickTurf
        else pickOverarm = !pickOverarm
        cricketChoiceError = ''
        render()
      } else if (action === 'cricket-gender' && btn.dataset.gender) {
        cricketGender = btn.dataset.gender as Gender
        if (cricketGender === 'female') pickOverarm = false
        cricketGenderError = ''
        render()
      } else if (action === 'skill' && btn.dataset.cricket && btn.dataset.skill) {
        const which = btn.dataset.cricket === 'overarm' ? 'overarm' : 'turf'
        cricketSkills[which] = btn.dataset.skill as PlayerSkill
        delete skillErrors[which]
        render()
      } else if (action === 'pay-mode' && (btn.dataset.mode === 'online' || btn.dataset.mode === 'cash')) {
        payMode = btn.dataset.mode
        payError = ''
        render()
      } else if (action === 'copy-text' && btn.dataset.copy) {
        const copied = btn.dataset.copy
        void navigator.clipboard.writeText(copied).then(() => {
          btn.textContent = 'Copied!'
        })
      } else if (action === 'download-receipt') {
        downloadReceipt()
      } else if (action === 'print') {
        window.print()
      } else if (action === 'next') goNext()
      else if (action === 'back') goBack()
      else if (action === 'submit' && !submitBusy) submit()
      else if (action === 'reset') resetForm()
      else if (action === 'copy-ref' && lastReference) {
        void navigator.clipboard.writeText(lastReference).then(() => {
          btn.textContent = 'Copied!'
          window.setTimeout(() => {
            btn.textContent = 'Copy reference'
          }, 1600)
        })
      } else if (action === 'gender' && btn.dataset.gender) {
        setGender(btn.dataset.gender as Gender)
      } else if (action === 'primary' && btn.dataset.sport) {
        setPrimary(btn.dataset.sport as SportId)
      } else if (action === 'secondary' && btn.dataset.sport) {
        toggleSecondary(btn.dataset.sport as SportId)
      } else if (
        action === 'format' &&
        btn.dataset.sport &&
        btn.dataset.format
      ) {
        setFormat(
          btn.dataset.sport as SportId,
          btn.dataset.format as PlayFormat,
        )
      }
    })
  })
}

function route(): void {
  if (isAdminRoute()) {
    renderAdmin(app)
    return
  }
  destroyAdmin()
  render()
}

async function boot(): Promise<void> {
  await Promise.all([
    refreshRegistrations(),
    refreshCapacities(),
    refreshCricketCapacities(),
    refreshAgeLimits(),
    refreshFees(),
  ])
  connectRealtime()
  onRealtimeUpdate(() => {
    syncLiveSeats()
  })
  window.addEventListener('hashchange', () => {
    route()
  })
  route()
}

void boot()
