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
  refreshSportAvailability,
  getRegistrations,
  saveCheckout,
  setActiveEvent,
  verifyPaymentScreenshotApi,
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
  PLAYER_AREA_OTHER,
  PLAYER_AREAS,
  PLAYER_SKILLS,
  cricketAreaLocation,
  emptyCricketPlayer,
  optimizePhoto,
  type CricketField,
  type CricketPlayer,
  type PlayerSkill,
} from './cricketForm'
import { DEFAULT_SPORT_AGE_LIMIT, getSportAgeLimit } from './ageLimits'
import { isSportEnabled, sportAvailabilityRevision } from './sportAvailability'
import {
  ALL_SPORT_IDS,
  PRIMARY_SPORTS,
  SECONDARY_SPORTS,
  genderLabel,
  needsFormat,
  needsPlayerDetails,
  needsPlayerDetailsOnly,
  organizerAssignsPartner,
  singlesOnlySport,
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
  iconAge,
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
  iconReset,
  iconSingle,
  iconDownload,
  iconShare,
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
  SeatSportId,
  SportId,
  ScreenshotVerificationResult,
} from './types'

const STEP_LABELS = [
  { en: 'Details', gu: GU.steps.details },
  { en: 'Sports', gu: GU.steps.sports },
  { en: 'Format', gu: GU.steps.format },
  { en: 'Review', gu: GU.steps.review },
] as const

function readUiLang(): 'en' | 'gu' {
  try {
    const saved = sessionStorage.getItem('chansma-lang')
    if (saved === 'en' || saved === 'gu') return saved
  } catch {
    /* ignore private-mode storage errors */
  }
  return 'en'
}

function ui(en: string, gu: string): string {
  return uiLang === 'gu' ? gu : en
}

function setUiLang(lang: 'en' | 'gu'): void {
  uiLang = lang
  try {
    sessionStorage.setItem('chansma-lang', lang)
  } catch {
    /* ignore private-mode storage errors */
  }
  applyUiLang()
}

function applyUiLang(): void {
  document.body.dataset.lang = uiLang
  document
    .querySelectorAll<HTMLButtonElement>('[data-action="ui-lang"], [data-action="disclaimer-lang"]')
    .forEach((tab) => {
      const on = tab.dataset.lang === uiLang
      tab.classList.toggle('is-selected', on)
      tab.setAttribute('aria-selected', on ? 'true' : 'false')
    })
}

function langTabsHtml(): string {
  return `
      <div class="lang-tabs" role="tablist" aria-label="Language">
        <button type="button" role="tab" class="lang-tab ${uiLang === 'en' ? 'is-selected' : ''}" data-action="ui-lang" data-lang="en" aria-selected="${uiLang === 'en'}">English</button>
        <button type="button" role="tab" class="lang-tab ${uiLang === 'gu' ? 'is-selected' : ''}" data-action="ui-lang" data-lang="gu" aria-selected="${uiLang === 'gu'}">ગુજરાતી</button>
      </div>`
}

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

const MAIN_SPONSOR = 'RAYSON JEWELS LLP'
const MAIN_SPONSOR_LINE = 'MATUSHREE KANTABEN NAROTTAMDAS SHAH PARIVAR'
const SPONSOR_LOGO = '/rayson-jewels.png'
const SPONSOR_MARK = '/rayson-mark.png'

function sponsorStrongHtml(): string {
  return `<strong class="sponsor-name"><span class="sponsor-title">${escapeHtml(MAIN_SPONSOR)}</span><small>(${escapeHtml(MAIN_SPONSOR_LINE)})</small></strong>`
}

function sponsorLogoHtml(): string {
  return `<img class="sponsor-logo" src="${SPONSOR_MARK}" alt="" />`
}

function sponsorBlockHtml(
  labelEn = 'Event partner',
  labelGu = 'ઇવેન્ટ પાર્ટનર',
): string {
  return `<span class="sponsor-kicker">${bi(labelEn, labelGu)}</span><span class="sponsor-lockup"><span class="sponsor-mark">${sponsorLogoHtml()}</span>${sponsorStrongHtml()}</span>`
}

function mastheadSponsorHtml(): string {
  return `
            <span class="sponsor-kicker">${bi('Event partner', 'ઇવેન્ટ પાર્ટનર')}</span>
            <strong class="sponsor-title">
              <span class="sponsor-mark">${sponsorLogoHtml()}</span>
              ${escapeHtml(MAIN_SPONSOR)}
            </strong>
            <small class="sponsor-line">Matushree Kantaben Narottamdas Shah Parivar</small>`
}

function mastheadHtml(): string {
  return `
      <header class="masthead">
        <div class="masthead-brand">
          <div class="masthead-stage">
            <div class="masthead-face masthead-face-brand">
              <img class="masthead-logo" src="/chanasma-logo.png" alt="Chanasma Jain Yuva Youth" />
              <div class="masthead-brand-copy">
                <h1><span class="brand-place">CHANASMA</span><span class="brand-olympic">OLYMPIC</span></h1>
                <div class="olympic-rings" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span></div>
              </div>
            </div>
            <div class="masthead-face masthead-face-sponsor">${mastheadSponsorHtml()}</div>
          </div>
        </div>
        <div class="masthead-tools">
          ${langTabsHtml()}
          <a class="masthead-admin" href="#/admin" aria-label="Admin">${iconAdmin()}</a>
        </div>
      </header>`
}

function receiptSponsorHtml(): string {
  const label = uiLang === 'gu' ? 'ઇવેન્ટ પાર્ટનર' : 'Event partner'
  return `<span class="sponsor-kicker">${escapeHtml(label)}</span><span class="sponsor-lockup"><span class="sponsor-mark">${sponsorLogoHtml()}</span>${sponsorStrongHtml()}</span>`
}

const state: FormState = {
  fullName: '',
  mobile: '',
  age: '',
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
let showDisclaimer = false
let uiLang: 'en' | 'gu' = readUiLang()
const foldState = new Map<string, boolean>()
let cricketChoiceError = ''
let cricketGenderError = ''
let photoBusy = false
let payMode: 'online' | 'cash' | null = null
let cashCollector = ''
let paymentShot = ''
let paymentShotName = ''
let screenshotVerification: ScreenshotVerificationResult | null = null
let verifyingScreenshot = false
let screenshotVerifySeq = 0
let payError = ''
let receiptNo = ''
let submitBusy = false
let frozenBill: { label: string; amount: number }[] | null = null
let receiptCricketStatus: Partial<Record<'turf' | 'overarm', 'confirmed' | 'waiting'>> = {}
let detailErrors: Partial<Record<'fullName' | 'mobile' | 'age', string>> = {}
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
let pageLoaderBusy = false
let autoDownloadReceipt = false
let receiptPdfBusy = false

type SessionPerson = {
  fullName: string
  mobile: string
  age: string
}
type ReusePrompt =
  | { kind: 'sport'; sportId: SportId }
  | { kind: 'cricket' }

let sessionPeople: SessionPerson[] = []
let reusePrompt: ReusePrompt | null = null
let reuseSelected = new Set<number>()
const reuseSkipped = new Set<string>()
let reuseLocked = false

const app = document.querySelector<HTMLDivElement>('#app')!

function selectedSportsList(): SportId[] {
  const list: SportId[] = []
  if (state.primarySport && isSportEnabled(state.primarySport)) list.push(state.primarySport)
  for (const id of state.secondarySports) {
    if (isSportEnabled(id) && !list.includes(id)) list.push(id)
  }
  return list
}

function indoorOpen(): boolean {
  return ALL_SPORT_IDS.some((id) => isSportEnabled(id))
}

function cricketOpen(): boolean {
  return isSportEnabled('turf') || isSportEnabled('overarm')
}

function secondarySportsOpen(): SportId[] {
  return SECONDARY_SPORTS.filter((id) => isSportEnabled(id))
}

function joinNames(parts: string[], word: string): string {
  if (parts.length <= 1) return parts[0] ?? ''
  if (parts.length === 2) return `${parts[0]} ${word} ${parts[1]}`
  return `${parts.slice(0, -1).join(', ')} ${word} ${parts[parts.length - 1]}`
}

function sportNamePair(ids: SportId[], wordEn: string, wordGu: string): { en: string; gu: string } {
  return {
    en: joinNames(ids.map((id) => sportLabel(id)), wordEn),
    gu: joinNames(ids.map((id) => GU.sports[id] ?? sportLabel(id)), wordGu),
  }
}

function pruneDisabledSelections(): void {
  if (state.primarySport && !isSportEnabled(state.primarySport)) {
    delete state.formats[state.primarySport]
    delete state.doublesPlayers[state.primarySport]
    state.primarySport = null
  }
  state.secondarySports = state.secondarySports.filter((id) => {
    if (isSportEnabled(id)) return true
    delete state.formats[id]
    delete state.doublesPlayers[id]
    return false
  })
  if (!isSportEnabled('turf')) pickTurf = false
  if (!isSportEnabled('overarm')) pickOverarm = false
  if (!indoorOpen()) pickIndoor = false
  if (!cricketOpen()) {
    pickCricket = false
    pickTurf = false
    pickOverarm = false
    cricketGender = null
  } else if (cricketGender === 'female' && !isSportEnabled('turf')) {
    cricketGender = null
    pickTurf = false
  }
  syncSoleCricketKind()
}

function cricketKindsForGender(): CricketKind[] {
  const kinds: CricketKind[] = []
  if (isSportEnabled('turf')) kinds.push('turf')
  if (isSportEnabled('overarm') && cricketGender !== 'female') kinds.push('overarm')
  return kinds
}

function cricketChoiceNeeded(): boolean {
  return cricketKindsForGender().length > 1
}

function syncSoleCricketKind(): void {
  const kinds = cricketKindsForGender()
  if (kinds.length !== 1) return
  pickTurf = kinds[0] === 'turf'
  pickOverarm = kinds[0] === 'overarm'
  cricketChoiceError = ''
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
  sportId?: SeatSportId,
  required = true,
): string | null {
  const en = ageFieldError(raw, { required, sportId })
  if (!en) return null
  if (en.includes('required')) {
    return biText(en, GU.errAgeRequired)
  }
  const { minAge, maxAge } = sportId
    ? getSportAgeLimit(sportId)
    : DEFAULT_SPORT_AGE_LIMIT
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

function sessionPersonKey(person: SessionPerson): string {
  return normalizeMobile(person.mobile) || person.fullName.trim().toLowerCase()
}

function rememberSessionPerson(player: DoublesPlayer, requireAge = true): void {
  if (!player.fullName.trim() || !isValidMobileLocal(player.mobile)) return
  if (requireAge && parseAge(player.age) == null) return
  const person: SessionPerson = {
    fullName: player.fullName.trim(),
    mobile: normalizeMobile(player.mobile),
    age: String(player.age).trim(),
  }
  const key = sessionPersonKey(person)
  if (!key) return
  const existing = sessionPeople.findIndex((item) => sessionPersonKey(item) === key)
  if (existing >= 0) {
    const previous = sessionPeople[existing]
    sessionPeople[existing] = {
      ...person,
      age: person.age || previous.age,
    }
    return
  }
  if (sessionPeople.length < 2) sessionPeople.push(person)
}

function sessionPersonFromPlayer(player: {
  fullName: string
  mobile: string
  age: string
}): SessionPerson | null {
  if (!player.fullName.trim() || !isValidMobileLocal(player.mobile)) return null
  if (parseAge(player.age) == null) return null
  return {
    fullName: player.fullName.trim(),
    mobile: normalizeMobile(player.mobile),
    age: String(player.age).trim(),
  }
}

function collectSessionPeople(options?: {
  preferSportId?: SportId
  skipSportId?: SportId
  skipCricket?: boolean
}): SessionPerson[] {
  if (reuseLocked) return []
  const unique: SessionPerson[] = []
  const take = (player: { fullName: string; mobile: string; age: string }) => {
    const person = sessionPersonFromPlayer(player)
    if (!person) return null
    const key = sessionPersonKey(person)
    if (!key) return null
    const existing = unique.findIndex((item) => sessionPersonKey(item) === key)
    if (existing >= 0) {
      unique[existing] = {
        ...person,
        age: person.age || unique[existing].age,
      }
      return unique[existing]
    }
    unique.push(person)
    return person
  }

  const preferSportId = options?.preferSportId
  if (preferSportId && preferSportId !== options?.skipSportId) {
    const preferred = state.doublesPlayers[preferSportId]
    if (preferred) {
      const first = sessionPersonFromPlayer(preferred.player1)
      const second = sessionPersonFromPlayer(preferred.player2)
      if (
        first &&
        second &&
        sessionPersonKey(first) !== sessionPersonKey(second)
      ) {
        return [first, second]
      }
    }
  }

  let pair: SessionPerson[] | null = null
  for (const id of sportsNeedingPlayerDetails()) {
    if (id === options?.skipSportId) continue
    const players = state.doublesPlayers[id]
    if (!players) continue
    const first = take(players.player1)
    const second = take(players.player2)
    if (
      first &&
      second &&
      sessionPersonKey(first) !== sessionPersonKey(second)
    ) {
      pair = [first, second]
    }
  }
  if (!options?.skipCricket) {
    take({
      fullName: cricketEntry.fullName,
      mobile: cricketEntry.mobile,
      age: cricketEntry.age,
    })
  }
  return pair ?? unique.slice(0, 2)
}

function harvestSessionPeople(preferSportId?: SportId): void {
  sessionPeople = collectSessionPeople({ preferSportId })
}

function canShowAutoFill(id?: SportId): boolean {
  return (
    collectSessionPeople({
      skipSportId: id,
      skipCricket: id == null,
    }).length > 0
  )
}

function clearReusePeople(): void {
  sessionPeople = []
  reusePrompt = null
  reuseSelected = new Set()
  reuseSkipped.clear()
}

function lockReuseAfterPayment(): void {
  reuseLocked = true
  clearReusePeople()
}

function syncAutoFillButtons(): void {
  app.querySelectorAll<HTMLButtonElement>('[data-action="reuse-open"]').forEach((btn) => {
    const sportId = btn.dataset.sport as SportId | undefined
    btn.hidden = btn.dataset.reuse === 'cricket'
      ? !canShowAutoFill()
      : !canShowAutoFill(sportId)
  })
}

function playerSlotEmpty(player: DoublesPlayer): boolean {
  return (
    !player.fullName.trim() &&
    !String(player.mobile).trim() &&
    !String(player.age).trim()
  )
}

function sportShowsPlayer2(id: SportId): boolean {
  return needsFormat(id) && state.formats[id] === 'double'
}

function reuseSkipKey(prompt: ReusePrompt): string {
  return prompt.kind === 'sport' ? `sport:${prompt.sportId}` : 'cricket'
}

function ageFitsSport(age: string, sportId: SeatSportId): string {
  const parsed = parseAge(age, sportId)
  return parsed == null ? '' : String(parsed)
}

function applyPersonToPlayer(
  player: DoublesPlayer,
  person: SessionPerson,
  sportId: SeatSportId,
): void {
  if (!playerSlotEmpty(player)) return
  player.fullName = person.fullName
  player.mobile = person.mobile
  player.age = ageFitsSport(person.age, sportId)
}

function selectedReusePeople(): SessionPerson[] {
  return [...reuseSelected]
    .sort((a, b) => a - b)
    .map((index) => sessionPeople[index])
    .filter((person): person is SessionPerson => Boolean(person))
}

function toggleReuseIndex(index: number): void {
  if (reuseSelected.has(index)) reuseSelected.delete(index)
  else reuseSelected.add(index)
  render()
}

function applyCricketPerson(person: SessionPerson): void {
  if (!cricketEntry.fullName.trim()) cricketEntry.fullName = person.fullName
  if (!cricketEntry.mobile.trim()) cricketEntry.mobile = person.mobile
  if (!String(cricketEntry.age).trim()) {
    cricketEntry.age = ageFitsSport(person.age, pickTurf ? 'turf' : 'overarm')
  }
}

function applyReusePrompt(): void {
  if (!reusePrompt) return
  const chosen = selectedReusePeople()
  if (reusePrompt.kind === 'sport') {
    const id = reusePrompt.sportId
    const players = ensureDoublesPlayers(id)
    const used = new Set(
      [players.player1, players.player2]
        .filter((slot) => !playerSlotEmpty(slot))
        .map((slot) => normalizeMobile(slot.mobile)),
    )
    const slots: DoublesPlayer[] = []
    if (playerSlotEmpty(players.player1)) slots.push(players.player1)
    if (sportShowsPlayer2(id) && playerSlotEmpty(players.player2)) {
      slots.push(players.player2)
    }
    let slotIndex = 0
    for (const person of chosen) {
      if (slotIndex >= slots.length) break
      const mobile = normalizeMobile(person.mobile)
      if (mobile && used.has(mobile)) continue
      applyPersonToPlayer(slots[slotIndex], person, id)
      if (mobile) used.add(mobile)
      slotIndex += 1
    }
    foldState.set(`format:${id}`, true)
  } else if (chosen[0]) {
    applyCricketPerson(chosen[0])
    foldState.set('cricket:name', true)
  }
  reuseSkipped.add(reuseSkipKey(reusePrompt))
  reusePrompt = null
  reuseSelected = new Set()
  render()
}

function skipReusePrompt(): void {
  if (!reusePrompt) return
  reuseSkipped.add(reuseSkipKey(reusePrompt))
  reusePrompt = null
  reuseSelected = new Set()
  render()
}

function openReuseForSport(id: SportId): void {
  if (!canShowAutoFill(id)) return
  reuseSkipped.delete(`sport:${id}`)
  reusePrompt = { kind: 'sport', sportId: id }
  reuseSelected = new Set()
  foldState.set(`format:${id}`, true)
  render()
}

function openReuseForCricket(): void {
  if (!canShowAutoFill()) return
  reuseSkipped.delete('cricket')
  reusePrompt = { kind: 'cricket' }
  reuseSelected = new Set()
  foldState.set('cricket:name', true)
  render()
}

function autoFillButton(id?: SportId): string {
  const sportAttr = id ? `data-sport="${id}"` : 'data-reuse="cricket"'
  const hidden = canShowAutoFill(id) ? '' : ' hidden'
  return `<button type="button" class="btn-autofill" data-action="reuse-open" ${sportAttr}${hidden}>${bi('Auto fill', GU.reuseAutoFill)}</button>`
}

function resetPlayerButton(id?: SportId, slot?: 'player1' | 'player2'): string {
  if (!id) {
    return `<button type="button" class="btn-autofill" data-action="clear-cricket-name">${bi('Reset', GU.resetBtn)}</button>`
  }
  const player = slot ?? 'player1'
  return `<button type="button" class="btn-autofill" data-action="clear-player" data-sport="${id}" data-player="${player}">${bi('Reset', GU.resetBtn)}</button>`
}

function playerHeadActions(id?: SportId, slot?: 'player1' | 'player2'): string {
  return `<div class="player-head-actions">${autoFillButton(id)}${resetPlayerButton(id, slot)}</div>`
}

function reusePopupHtml(): string {
  if (!reusePrompt) return ''
  const people = sessionPeople.slice(0, 2)
  const sportName =
    reusePrompt.kind === 'sport'
      ? sportBi(reusePrompt.sportId)
      : bi('Cricket', 'ક્રિકેટ')
  const emptyNote =
    people.length === 0
      ? `<p class="reuse-empty">${bi('No saved player yet. Fill Player 1 or Player 2 details, then tap Auto fill.', GU.reuseEmpty)}</p>`
      : ''
  const cards = people
    .map((person, index) => {
      const selected = reuseSelected.has(index)
      const ageLabel = person.age
        ? `${escapeHtml(person.age)} ${ui('yrs', 'વર્ષ')}`
        : ''
      return `<button type="button" class="reuse-person ${selected ? 'is-selected' : ''}" data-action="reuse-toggle" data-index="${index}" aria-pressed="${selected}">
        <span class="reuse-check" aria-hidden="true">${selected ? iconCheck() : ''}</span>
        <span class="reuse-person-copy">
          <p class="reuse-slot">${bi(index === 0 ? 'Player 1' : 'Player 2', index === 0 ? GU.reusePlayer1 : GU.reusePlayer2)}</p>
          <strong>${escapeHtml(person.fullName)}</strong>
          <span>${escapeHtml(person.mobile)}${ageLabel ? ` · ${ageLabel}` : ''}</span>
        </span>
      </button>`
    })
    .join('')
  return `
    <div class="reuse-sheet" role="dialog" aria-modal="true" aria-labelledby="reuse-title">
      <div class="reuse-card">
        <div class="reuse-card-head">
          <h3 id="reuse-title">${bi('Reuse these details?', GU.reuseTitle)}</h3>
          <button type="button" class="reuse-close" data-action="reuse-skip">${bi('Close', GU.reuseClose)}</button>
        </div>
        <p class="reuse-sub">${bi('Tick who to fill on', 'આના પર ભરવા માટે ટિક કરો')} ${sportName}. ${bi('These names stay on this form only.', GU.reuseSub)}</p>
        ${emptyNote}
        <div class="reuse-people">${cards}</div>
        ${
          people.length
            ? `<div class="reuse-actions">
          <button type="button" class="btn btn-primary" data-action="reuse-apply" ${reuseSelected.size ? '' : 'disabled'}>${bi('Done', GU.reuseUse)}</button>
        </div>`
            : ''
        }
      </div>
    </div>`
}

function mountReusePopup(): void {
  app.querySelector('.reuse-sheet')?.remove()
  harvestSessionPeople(
    reusePrompt?.kind === 'sport' ? reusePrompt.sportId : undefined,
  )
  const open = Boolean(reusePrompt)
  document.body.classList.toggle('reuse-open', open)
  if (!open) return
  app.insertAdjacentHTML('beforeend', reusePopupHtml())
  const sheet = app.querySelector<HTMLElement>('.reuse-sheet')
  sheet?.addEventListener('click', (event) => {
    if (event.target === sheet) skipReusePrompt()
  })
  app
    .querySelector<HTMLButtonElement>(
      '[data-action="reuse-apply"]:not([disabled]), [data-action="reuse-skip"]',
    )
    ?.focus()
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

  const ageErr = bilingualAgeError(state.age, undefined, true)
  if (ageErr) detailErrors.age = ageErr
  else state.age = String(state.age).replace(/\D/g, '').slice(0, 3)

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
    if (needsPlayerDetailsOnly(id)) {
      state.formats[id] = 'single'
    }

    if (needsFormat(id) && !state.formats[id]) {
      missingFormat = true
      continue
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
      'Fix Player 1 details — full name, mobile and age are required, and a mobile may already be registered for this sport',
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

function cricketConflictLines(): { kind: CricketKind; message: string }[] {
  const lines: { kind: CricketKind; message: string }[] = []
  if (pickTurf) {
    const message = describeCricketConflict('turf', cricketEntry.mobile)
    if (message) lines.push({ kind: 'turf', message })
  }
  if (pickOverarm) {
    const message = describeCricketConflict('overarm', cricketEntry.mobile)
    if (message) lines.push({ kind: 'overarm', message })
  }
  return lines
}

function reviewGate(): { ok: boolean; message: string } {
  if (pickIndoor) {
    const indoor = canSubmit()
    if (!indoor.ok) return indoor
  }
  const cricket = cricketConflictLines()
  if (cricket[0]) return { ok: false, message: cricket[0].message }
  return { ok: true, message: '' }
}

function firstIndoorConflict(): SelectedSport | null {
  if (!pickIndoor) return null
  for (const sport of buildSelectedSports()) {
    if (sport.sportId === 'turf' || sport.sportId === 'overarm') continue
    if (describeSportConflict(sport, sportLabel(sport.sportId), state.mobile)) {
      return sport
    }
  }
  return null
}

function reviewConflictActions(): string {
  const indoor = firstIndoorConflict()
  if (indoor && indoor.sportId !== 'turf' && indoor.sportId !== 'overarm') {
    return indoorConflictActions(indoor.sportId, true)
  }
  const cricket = cricketConflictLines()
  if (cricket.length) return cricketConflictActions(cricket.map((item) => item.kind))
  return ''
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
      if (cricketChoiceNeeded()) list.push({ id: 'cricket-choice' })
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

function pageLoaderHtml(): string {
  return `
    <div class="page-loader" role="status" aria-live="polite">
      <div class="page-loader-card">
        <p class="page-loader-kicker">${bi('Event partner', 'ઇવેન્ટ પાર્ટનર')}</p>
        <div class="page-loader-logo">
          <img src="${SPONSOR_LOGO}" alt="${escapeAttr(MAIN_SPONSOR)}" />
        </div>
        <p class="page-loader-name">${escapeHtml(MAIN_SPONSOR)}</p>
        <p class="page-loader-sub">${escapeHtml(MAIN_SPONSOR_LINE)}</p>
        <div class="page-loader-bar" aria-hidden="true"><i></i></div>
      </div>
    </div>`
}

function withPageLoader(next: () => void): void {
  if (pageLoaderBusy) return
  pageLoaderBusy = true
  document.querySelector('.page-loader')?.remove()
  document.body.insertAdjacentHTML('beforeend', pageLoaderHtml())
  window.setTimeout(() => {
    document.querySelector('.page-loader')?.remove()
    pageLoaderBusy = false
    next()
  }, 400)
}

function advancePhase(): void {
  withPageLoader(() => movePhase(1))
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
    const indoorOn = indoorOpen()
    const cricketOn = cricketOpen()
    beginError =
      indoorOn && cricketOn
        ? biText('Select Olympic games, Cricket, or both.', 'ઓલિમ્પિક રમતો, ક્રિકેટ, અથવા બંને પસંદ કરો.')
        : indoorOn
          ? biText('Select Olympic games.', 'ઓલિમ્પિક રમતો પસંદ કરો.')
          : cricketOn
            ? biText('Select Cricket.', 'ક્રિકેટ પસંદ કરો.')
            : biText('Registration is closed.', 'નોંધણી બંધ છે.')
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
    const turfOn = isSportEnabled('turf')
    const overarmOn = isSportEnabled('overarm') && cricketGender !== 'female'
    cricketChoiceError =
      turfOn && overarmOn
        ? biText('Select Turf, Overarm, or both.', 'ટર્ફ, ઓવરઆર્મ, અથવા બંને પસંદ કરો.')
        : turfOn
          ? biText('Select Turf.', 'ટર્ફ પસંદ કરો.')
          : biText('Select Overarm.', 'ઓવરઆર્મ પસંદ કરો.')
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

function isCricketClashMessage(message: string): boolean {
  return (
    message.includes('Already registered for') ||
    message.includes('માટે પહેલેથી નોંધાયેલ')
  )
}

function isRegisteredConflict(message: string): boolean {
  return (
    message.includes('Already registered') ||
    message.includes('પહેલેથી નોંધાયેલ')
  )
}

/** One line per category the player is entering: Turf, Overarm, or both. */
function cricketMobileClashMessage(mobile: string): string | null {
  const kinds = [
    pickTurf ? 'turf' : null,
    pickOverarm ? 'overarm' : null,
  ].filter((kind): kind is 'turf' | 'overarm' => kind != null)
  const lines = kinds
    .map((kind) => describeCricketConflict(kind, mobile))
    .filter((line): line is string => Boolean(line))
  if (!lines.length) return null
  return lines
    .map((line) => `<span class="error-line">${bilingualHtml(line)}</span>`)
    .join('')
}

function syncCricketMobileClash(): void {
  const current = cricketErrors.mobile ?? ''
  if (!isValidMobileLocal(cricketEntry.mobile)) {
    if (isCricketClashMessage(current)) delete cricketErrors.mobile
    return
  }
  const clash = cricketMobileClashMessage(cricketEntry.mobile)
  if (clash) cricketErrors.mobile = clash
  else if (isCricketClashMessage(current)) delete cricketErrors.mobile
}

function paintCricketMobileClash(input: HTMLInputElement): void {
  if (!isCricketClashMessage(cricketErrors.mobile ?? '')) {
    delete cricketErrors.mobile
  }
  syncCricketMobileClash()
  const field = input.closest('.field')
  if (!field) return
  const message = cricketErrors.mobile ?? ''
  const show = isCricketClashMessage(message)
  field.classList.toggle('is-invalid', show)
  input.classList.toggle('is-invalid', show)
  field.querySelector('.error')?.remove()
  if (!show) return
  const errorEl = document.createElement('span')
  errorEl.className = 'error'
  errorEl.innerHTML = bilingualHtml(message)
  field.appendChild(errorEl)
}

function validateCricket(): boolean {
  const player = cricketEntry
  const errors: Partial<Record<CricketField, string>> = {}
  if (!player.fullName.trim()) {
    errors.fullName = biText('Full name is required', GU.errFullName)
  }
  const mobileError = bilingualMobileError(player.mobile, true)
  if (mobileError) errors.mobile = mobileError
  else {
    const clash = cricketMobileClashMessage(player.mobile)
    if (clash) errors.mobile = clash
  }
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
  if (!player.area) {
    errors.area = biText("Select the player's area", 'ખેલાડીનો વિસ્તાર પસંદ કરો')
  } else if (player.area === PLAYER_AREA_OTHER && !player.areaOther.trim()) {
    errors.areaOther = biText('Enter the place name', 'સ્થળનું નામ લખો')
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
      showDisclaimer = false
      render()
      return
    }
    withPageLoader(() => {
      showDisclaimer = true
      render()
    })
    return
  }

  if (phase.id === 'cricket-choice') {
    if (!validateCricketChoice()) {
      shouldRevealErrors = true
      render()
      return
    }
    advancePhase()
    return
  }

  if (phase.id === 'cricket-gender') {
    if (!validateCricketGender()) {
      shouldRevealErrors = true
      render()
      return
    }
    syncSoleCricketKind()
    advancePhase()
    return
  }

  if (phase.id === 'cricket-form') {
    if (!validateCricket()) {
      shouldRevealErrors = true
      render()
      return
    }
    advancePhase()
    return
  }

  if (phase.id === 'indoor' && phase.indoorStep === 1) {
    if (!validateDetails()) {
      shouldRevealErrors = true
      render()
      return
    }
    advancePhase()
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
    advancePhase()
    return
  }

  if (phase.id === 'indoor' && phase.indoorStep === 3) {
    if (!validateFormats()) {
      shouldRevealErrors = true
      render()
      return
    }
    advancePhase()
    return
  }

  if (phase.id === 'review') {
    const check = reviewGate()
    if (!check.ok) {
      redirectToSubmitError(check.message)
      return
    }
    advancePhase()
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

function gotoPhaseId(id: FlowPhase['id']): void {
  const list = phases()
  const index = list.findIndex((phase) => phase.id === id)
  if (index >= 0) phaseIndex = index
}

function stayOnCurrentPhaseOr(fallback: () => void): void {
  const key = paintedKey || phaseKey(currentPhase())
  const list = phases()
  const index = list.findIndex((phase) => phaseKey(phase) === key)
  if (index >= 0) {
    phaseIndex = index
    return
  }
  fallback()
}

function gotoFixSport(sportId: SportId): void {
  foldState.set(`format:${sportId}`, true)
  stepAnimDir = 'back'
  gotoIndoor(3)
  const sport = buildSelectedSports().find((item) => item.sportId === sportId)
  const conflict = sport
    ? describeSportConflict(sport, sportLabel(sportId), state.mobile)
    : null
  if (conflict && sport) {
    const player1Clash = sport.player1Mobile
      ? describePlayerMobileConflict(sport.player1Mobile, sportId, sportLabel(sportId))
      : null
    const player2Clash =
      sport.format === 'double' && sport.player2Mobile
        ? describePlayerMobileConflict(sport.player2Mobile, sportId, sportLabel(sportId))
        : null
    doublesErrors[sportId] = {
      ...doublesErrors[sportId],
      ...(player1Clash || !player2Clash
        ? {
            player1: {
              ...doublesErrors[sportId]?.player1,
              mobile: player1Clash || conflict,
            },
          }
        : {}),
      ...(player2Clash
        ? {
            player2: {
              ...doublesErrors[sportId]?.player2,
              mobile: player2Clash,
            },
          }
        : {}),
    }
    formatError = conflict
  }
  submitError = ''
  shouldRevealErrors = true
  render()
}

function gotoFixCricket(): void {
  foldState.set('cricket:name', true)
  stepAnimDir = 'back'
  gotoPhaseId('cricket-form')
  syncCricketMobileClash()
  submitError = ''
  shouldRevealErrors = true
  render()
}

function removeIndoorSport(id: SportId): void {
  if (state.primarySport === id) state.primarySport = null
  state.secondarySports = state.secondarySports.filter((sport) => sport !== id)
  delete state.formats[id]
  delete state.doublesPlayers[id]
  delete doublesErrors[id]
  formatError = ''
  submitError = ''
  sportError = ''

  const leftover = selectedSportsList()
  if (leftover.length === 0) {
    if (pickTurf || pickOverarm) {
      pickIndoor = false
      stayOnCurrentPhaseOr(gotoReview)
    } else {
      pickIndoor = true
      sportError = biText(
        'Select at least one sport (main or extra)',
        GU.errMinOneSport,
      )
      gotoIndoor(2)
      shouldRevealErrors = true
    }
  } else {
    stayOnCurrentPhaseOr(() => {
      if (sportsNeedingPlayerDetails().length > 0) gotoIndoor(3)
      else gotoReview()
    })
  }
  render()
}

function removeCricketKind(kind: CricketKind): void {
  if (kind === 'turf') pickTurf = false
  else pickOverarm = false
  if (!pickTurf && !pickOverarm) pickCricket = false
  submitError = ''
  if (isCricketClashMessage(cricketErrors.mobile ?? '')) {
    delete cricketErrors.mobile
  }
  stayOnCurrentPhaseOr(() => {
    if (pickTurf || pickOverarm) gotoPhaseId('cricket-form')
    else if (pickIndoor) gotoReview()
    else phaseIndex = 0
  })
  render()
}

function gotoFixFirstConflict(): boolean {
  const sports = pickIndoor ? buildSelectedSports() : []
  for (const sport of sports) {
    if (sport.sportId === 'turf' || sport.sportId === 'overarm') continue
    const conflict = describeSportConflict(
      sport,
      sportLabel(sport.sportId),
      state.mobile,
    )
    if (!conflict) continue
    if (sportsNeedingPlayerDetails().includes(sport.sportId)) {
      gotoFixSport(sport.sportId)
      return true
    }
    gotoReview()
    submitError = conflict
    shouldRevealErrors = true
    render()
    return true
  }

  if (cricketConflictLines().length > 0) {
    gotoFixCricket()
    return true
  }
  return false
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
  if (gotoFixFirstConflict()) return
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
  withPageLoader(() => movePhase(-1))
}

function primarySportsForGender(): SportId[] {
  const ids =
    state.gender === 'female'
      ? PRIMARY_SPORTS.filter((id) => id !== 'football')
      : [...PRIMARY_SPORTS]
  return ids.filter((id) => isSportEnabled(id))
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
  if (!isSportEnabled(id)) return
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
  if (!isSportEnabled(id)) return
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

function clearPlayerSlot(id: SportId, slot: 'player1' | 'player2'): void {
  const players = ensureDoublesPlayers(id)
  players[slot] = emptyDoublesPlayer()
  if (doublesErrors[id]?.[slot]) delete doublesErrors[id]![slot]
  if (
    doublesErrors[id] &&
    !doublesErrors[id]!.player1 &&
    !doublesErrors[id]!.player2
  ) {
    delete doublesErrors[id]
  }
  formatError = ''
  submitError = ''
  foldState.set(`format:${id}`, true)
  reusePrompt = null
  render()
}

function clearFormatSection(id: SportId): void {
  state.doublesPlayers[id] = {
    player1: emptyDoublesPlayer(),
    player2: emptyDoublesPlayer(),
  }
  delete doublesErrors[id]
  formatError = ''
  submitError = ''
  foldState.set(`format:${id}`, true)
  reuseSkipped.delete(`sport:${id}`)
  reusePrompt = null
  render()
}

function clearCricketNameSection(): void {
  cricketEntry.fullName = ''
  cricketEntry.mobile = ''
  cricketEntry.age = ''
  delete cricketErrors.fullName
  delete cricketErrors.mobile
  delete cricketErrors.age
  foldState.set('cricket:name', true)
  reuseSkipped.delete('cricket')
  reusePrompt = null
  render()
}

function formatClearButton(id: SportId): string {
  const label = ui('Reset this section', GU.clearSection)
  return `<button type="button" class="btn-icon-reset" data-action="clear-section" data-sport="${id}" title="${escapeAttr(label)}" aria-label="${escapeAttr(label)}">${iconReset()}</button>`
}

function validatePayment(): boolean {
  payError = ''
  const check = reviewGate()
  if (!check.ok) {
    payError = check.message
    return false
  }
  if (payMode !== 'online' && payMode !== 'cash') {
    payError = biText(
      'Choose online payment or cash.',
      'ઓનલાઇન ચુકવણી અથવા રોકડ પસંદ કરો.',
    )
    return false
  }
  if (payMode === 'online') {
    if (!paymentShot) {
      payError = biText(
        'After you pay, upload a screenshot.',
        'ચુકવણી પછી સ્ક્રીનશૉટ અપલોડ કરો.',
      )
      return false
    }
    if (verifyingScreenshot) {
      payError = biText(
        'Screenshot is being verified. Please wait a moment.',
        'સ્ક્રીનશૉટ ચકાસણી ચાલુ છે. કૃપા કરીને થોડી રાહ જુઓ.',
      )
      return false
    }
    if (screenshotVerification?.status !== 'ACCEPT') {
      payError = screenshotVerification?.reason
        ? biText(screenshotVerification.reason, screenshotVerification.reason)
        : biText(
            'Please upload a valid payment screenshot.',
            'કૃપા કરીને માન્ય ચુકવણી સ્ક્રીનશૉટ અપલોડ કરો.',
          )
      return false
    }
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
  const name = player.fullName.trim()
  const gender = kind === 'overarm' || cricketGender !== 'female' ? 'male' : 'female'
  return {
    id,
    event: kind,
    fullName: name,
    mobile: normalizeMobile(player.mobile),
    location: cricketAreaLocation(player),
    gender,
    createdAt,
    receiptNo: receipt,
    payMode: payMode || '',
    paidTo: payMode === 'cash' ? cashCollector : 'Online',
    amount: getFee(kind),
    utrNo: screenshotVerification?.data?.utr || '',
    paymentStatus: payMode === 'online' ? 'verified' : 'cash',
    ocrDetails: screenshotVerification?.data || {},
    sports: [
      {
        sportId: kind,
        format: 'single',
        status: cricketStatus(kind),
        player1Name: name,
        player1Mobile: normalizeMobile(player.mobile),
        player1Age: Number(player.age),
        skill: cricketSkills[kind],
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
      utrNo: screenshotVerification?.data?.utr || '',
      paymentStatus: payMode === 'online' ? 'verified' : 'cash',
      ocrDetails: screenshotVerification?.data || {},
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
      submitBusy = false
      autoDownloadReceipt = true
      lockReuseAfterPayment()
      withPageLoader(() => {
        phaseIndex = done >= 0 ? done : list.length - 1
        stepAnimDir = 'forward'
        render()
      })
    })
    .catch((error: unknown) => {
      payError =
        error instanceof Error
          ? error.message
          : biText('Could not save this registration.', 'આ નોંધણી સાચવી શકાઈ નહીં.')
      submitBusy = false
      render()
    })
}

function clearFormFields(): void {
  foldState.clear()
  state.fullName = ''
  state.mobile = ''
  state.age = ''
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
  showDisclaimer = false
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
  screenshotVerification = null
  verifyingScreenshot = false
  payError = ''
  receiptNo = ''
  autoDownloadReceipt = false
  receiptPdfBusy = false
  submitBusy = false
  frozenBill = null
  receiptCricketStatus = {}
  paintedKey = ''
  reuseLocked = false
  clearReusePeople()
}

function resetForm(): void {
  clearFormFields()
  stepAnimDir = 'forward'
  render()
}

function brandSubHtml(): string {
  const phase = currentPhase()
  if (phase.id === 'cricket-gender' || phase.id === 'cricket-choice') return bi('Cricket sports', 'ક્રિકેટ સ્પોર્ટ્સ')
  if (phase.id === 'cricket-form') {
    if (pickTurf && !pickOverarm) {
      const event = eventById('turf')
      return `${bi(event.title, event.titleGu)} · ${bi(event.date, event.dateGu)}`
    }
    if (pickOverarm && !pickTurf) {
      const event = eventById('overarm')
      return `${bi(event.title, event.titleGu)} · ${bi(event.date, event.dateGu)}`
    }
    return bi('Cricket sports', 'ક્રિકેટ સ્પોર્ટ્સ')
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
    return Boolean(detailErrors.fullName || detailErrors.mobile || detailErrors.age)
  }
  if (phase.id === 'indoor' && phase.indoorStep === 2) return Boolean(sportError)
  if (phase.id === 'indoor' && phase.indoorStep === 3) {
    return Boolean(formatError) || Object.keys(doublesErrors).length > 0
  }
  if (phase.id === 'pay') return Boolean(payError)
  if (phase.id === 'review' || (phase.id === 'indoor' && phase.indoorStep === 4)) {
    return Boolean(submitError) || !reviewGate().ok
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
          ? 'Olympic'
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
      <span class="choice-copy">
        <span class="choice-title">${sportBi(id)}</span>
        ${
          singlesOnlySport(id)
            ? `<span class="choice-rule">${bi('Singles only', 'ફક્ત સિંગલ્સ')}</span>`
            : ''
        }
        <span class="${metaClass}" data-slot-sport="${id}">${meta}</span>
      </span>
      <span class="choice-check" aria-hidden="true"></span>
    </button>
  `
}

function renderStep1(): string {
  const apiError = getStorageError()
  return `
    <div class="fade-step">
      <h2 class="step-title"><span class="step-title-icon">${iconUser()}</span> ${bi('Enter your details', GU.detailsTitle)}</h2>
      <p class="step-sub">${bi('Enter your full name, a 10-digit mobile number (no +91 or leading 0), and your age.', GU.detailsSub)}</p>
      ${apiError ? `<div class="alert is-error">${bilingualHtml(apiError)}</div>` : ''}

      <div class="field field-icon ${detailErrors.fullName ? 'is-invalid' : ''}">
        <label for="fullName">${bi('Full Name', GU.fullName)}</label>
        <div class="input-wrap">
          ${iconUser()}
          <input id="fullName" name="fullName" type="text" autocomplete="name"
            class="${detailErrors.fullName ? 'is-invalid' : ''}"
            value="${escapeAttr(state.fullName)}" placeholder="${escapeAttr(ui('e.g. Rahul Sharma', GU.placeholderName))}" />
        </div>
        ${detailErrors.fullName ? `<span class="error">${bilingualHtml(detailErrors.fullName)}</span>` : ''}
      </div>

      <div class="field field-icon ${detailErrors.mobile ? 'is-invalid' : ''}">
        <label for="mobile">${bi('Mobile Number', GU.mobile)}</label>
        <div class="input-wrap">
          ${iconPhone()}
          <input id="mobile" name="mobile" type="tel" inputmode="numeric" autocomplete="tel"
            class="${detailErrors.mobile ? 'is-invalid' : ''}"
            value="${escapeAttr(state.mobile)}" placeholder="${escapeAttr(ui('10-digit mobile', GU.placeholderMobile))}"
            maxlength="12" pattern="[1-9][0-9]{9}" />
        </div>
        ${detailErrors.mobile ? `<span class="error">${bilingualHtml(detailErrors.mobile)}</span>` : ''}
      </div>

      <div class="field field-icon ${detailErrors.age ? 'is-invalid' : ''}">
        <label for="age">${bi('Age', GU.age)}</label>
        <div class="input-wrap">
          ${iconAge()}
          <input id="age" name="age" type="text" inputmode="numeric" autocomplete="off"
            class="${detailErrors.age ? 'is-invalid' : ''}"
            value="${escapeAttr(state.age)}" placeholder="${escapeAttr(ui(`${DEFAULT_SPORT_AGE_LIMIT.minAge}–${DEFAULT_SPORT_AGE_LIMIT.maxAge}`, GU.placeholderAge))}"
            maxlength="3" />
        </div>
        ${detailErrors.age ? `<span class="error">${bilingualHtml(detailErrors.age)}</span>` : ''}
      </div>

    </div>
  `
}

function renderStep2(): string {
  const genderInvalid = Boolean(sportError && !state.gender)
  const sportsInvalid = Boolean(
    sportError && state.gender && selectedSportsList().length === 0,
  )
  const primaryIds = primarySportsForGender()
  const secondaryIds = secondarySportsOpen()
  const primaryNames = sportNamePair(primaryIds, 'or', 'અથવા')
  const secondaryNames = sportNamePair(secondaryIds, 'and', 'અને')
  const primaryHint =
    state.gender === 'female' && isSportEnabled('football')
      ? bi(
          `Optional — ${primaryNames.en} (Football is Male only)`,
          `વૈકલ્પિક — ${primaryNames.gu} (ફૂટબોલ ફક્ત પુરુષો માટે)`,
        )
      : bi(`Optional — ${primaryNames.en}`, `વૈકલ્પિક — ${primaryNames.gu}`)
  const secondaryHint = bi(
    `${secondaryNames.en} — pick up to ${Math.min(2, secondaryIds.length)}. At least one sport total is required.`,
    `${secondaryNames.gu} — વધુમાં વધુ ${Math.min(2, secondaryIds.length)} પસંદ કરો. કુલ ઓછામાં ઓછી એક રમત જરૂરી છે.`,
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
          <span class="choice-copy">
            <span class="choice-title">${bi('Male', GU.male)}</span>
            <span class="choice-meta">${bi('Men’s tournament', GU.maleMeta)}</span>
          </span>
          <span class="choice-check" aria-hidden="true"></span>
        </button>
        <button type="button"
          class="choice choice-gender ${state.gender === 'female' ? 'is-selected' : ''}"
          data-action="gender" data-gender="female">
          <span class="choice-icon-wrap">${iconFemale()}</span>
          <span class="choice-copy">
            <span class="choice-title">${bi('Female', GU.female)}</span>
            <span class="choice-meta">${bi('Women’s tournament', GU.femaleMeta)}</span>
          </span>
          <span class="choice-check" aria-hidden="true"></span>
        </button>
      </div>

      ${
        primaryIds.length
          ? `
      <div class="section-label">${bi('Main sport — optional (choose one)', GU.mainSport)}</div>
      <p class="section-hint">${primaryHint}</p>
      <div class="choice-grid ${sportsInvalid ? 'is-invalid' : ''}" data-error-section="primary">
        ${primaryIds
          .map((id) =>
            renderChoice(id, state.primarySport === id, false, 'primary'),
          )
          .join('')}
      </div>`
          : ''
      }

      ${
        secondaryIds.length
          ? `
      <div class="section-label">${
        secondaryIds.length > 1
          ? bi('Additional sports — up to 2 (at least 1 sport overall)', GU.extraSports)
          : bi('Additional sport', 'વધારાની રમત')
      }</div>
      <p class="section-hint">${secondaryHint}</p>
      <div class="choice-grid cols-3 ${sportsInvalid ? 'is-invalid' : ''}" data-error-section="secondary">
        ${secondaryIds
          .map((id) => {
            const atLimit =
              !state.secondarySports.includes(id) &&
              state.secondarySports.length >= 2
            return renderChoice(
              id,
              state.secondarySports.includes(id),
              atLimit,
              'secondary',
            )
          })
          .join('')}
      </div>`
          : ''
      }

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
        <div class="player-head">
          <p class="section-label player-head-title">${bi('Player 1 details', GU.playerDetails)}</p>
          ${playerHeadActions(id, 'player1')}
        </div>
        <div class="player-row">
          <div class="field ${errors.player1?.fullName ? 'is-invalid' : ''}">
            <label for="player1-name-${id}">${bi('Full Name', GU.fullName)}</label>
            <input id="player1-name-${id}" type="text"
              class="${errors.player1?.fullName ? 'is-invalid' : ''}"
              data-doubles-sport="${id}" data-doubles-player="player1" data-doubles-field="fullName"
              value="${escapeAttr(players.player1.fullName)}"
              placeholder="${escapeAttr(ui('Full name', GU.placeholderName))}" required />
            ${errors.player1?.fullName ? `<span class="error">${bilingualHtml(errors.player1.fullName)}</span>` : ''}
          </div>
          <div class="field ${errors.player1?.mobile ? 'is-invalid' : ''}">
            <label for="player1-mobile-${id}">${bi('Mobile Number', GU.mobile)}</label>
            <input id="player1-mobile-${id}" type="tel" inputmode="numeric"
              class="${errors.player1?.mobile ? 'is-invalid' : ''}"
              data-doubles-sport="${id}" data-doubles-player="player1" data-doubles-field="mobile"
              value="${escapeAttr(players.player1.mobile)}"
              placeholder="${escapeAttr(ui('10-digit mobile', GU.placeholderMobile))}"
              maxlength="12" pattern="[1-9][0-9]{9}" required />
            ${errors.player1?.mobile ? `<span class="error">${bilingualHtml(errors.player1.mobile)}</span>` : ''}
          </div>
          <div class="field ${errors.player1?.age ? 'is-invalid' : ''}">
            <label for="player1-age-${id}">${bi('Age', GU.age)}</label>
            <input id="player1-age-${id}" type="number" inputmode="numeric" min="${ageLimit.minAge}" max="${ageLimit.maxAge}" step="1"
              class="${errors.player1?.age ? 'is-invalid' : ''}"
              data-doubles-sport="${id}" data-doubles-player="player1" data-doubles-field="age"
              value="${escapeAttr(players.player1.age)}"
              placeholder="${escapeAttr(ui(`${ageLimit.minAge}–${ageLimit.maxAge}`, GU.placeholderAge))}" required />
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
        <div class="player-head">
          <p class="section-label player-head-title">${bi('Player 2 details', GU.player2)}</p>
          ${playerHeadActions(id, 'player2')}
        </div>
        <div class="player-row">
          <div class="field ${errors.player2?.fullName ? 'is-invalid' : ''}">
            <label for="player2-name-${id}">${bi('Full Name', GU.fullName)}</label>
            <input id="player2-name-${id}" type="text"
              class="${errors.player2?.fullName ? 'is-invalid' : ''}"
              data-doubles-sport="${id}" data-doubles-player="player2" data-doubles-field="fullName"
              value="${escapeAttr(players.player2.fullName)}"
              placeholder="${escapeAttr(ui('Player 2 full name', 'ખેલાડી ૨ પૂરું નામ'))}" />
            ${errors.player2?.fullName ? `<span class="error">${bilingualHtml(errors.player2.fullName)}</span>` : ''}
          </div>
          <div class="field ${errors.player2?.mobile ? 'is-invalid' : ''}">
            <label for="player2-mobile-${id}">${bi('Mobile Number', GU.mobile)}</label>
            <input id="player2-mobile-${id}" type="tel" inputmode="numeric"
              class="${errors.player2?.mobile ? 'is-invalid' : ''}"
              data-doubles-sport="${id}" data-doubles-player="player2" data-doubles-field="mobile"
              value="${escapeAttr(players.player2.mobile)}"
              placeholder="${escapeAttr(ui('10-digit mobile', GU.placeholderMobile))}"
              maxlength="12" pattern="[1-9][0-9]{9}" />
            ${errors.player2?.mobile ? `<span class="error">${bilingualHtml(errors.player2.mobile)}</span>` : ''}
          </div>
          <div class="field ${errors.player2?.age ? 'is-invalid' : ''}">
            <label for="player2-age-${id}">${bi('Age', GU.age)}</label>
            <input id="player2-age-${id}" type="number" inputmode="numeric" min="${ageLimit.minAge}" max="${ageLimit.maxAge}" step="1"
              class="${errors.player2?.age ? 'is-invalid' : ''}"
              data-doubles-sport="${id}" data-doubles-player="player2" data-doubles-field="age"
              value="${escapeAttr(players.player2.age)}"
              placeholder="${escapeAttr(ui(`${ageLimit.minAge}–${ageLimit.maxAge}`, GU.placeholderAge))}" />
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

function foldOpen(key: string, fallback: boolean, force = false): boolean {
  if (force) {
    foldState.set(key, true)
    return true
  }
  const stored = foldState.get(key)
  return stored === undefined ? fallback : stored
}

function foldPanel(
  key: string,
  summary: string,
  body: string,
  open: boolean,
  className = '',
  sportId = '',
): string {
  const sportAttr = sportId
    ? ` data-sport="${escapeAttr(sportId)}" data-sport-card="${escapeAttr(sportId)}"`
    : ''
  return `
    <details class="fold ${className}" data-fold="${escapeAttr(key)}"${sportAttr} ${open ? 'open' : ''}>
      <summary class="fold-summary">${summary}</summary>
      <div class="fold-body">${body}</div>
    </details>`
}

function renderStep3(): string {
  const needing = sportsNeedingPlayerDetails()
  const category = state.gender ? genderLabel(state.gender) : ''
  const hasFormatSports = needing.some((id) => needsFormat(id))
  return `
    <div class="fade-step">
      <h2 class="step-title">${hasFormatSports ? bi('Format & Player 1 details', GU.formatTitle) : bi('Player 1 details', GU.playerDetailsTitle)}</h2>
      <p class="step-sub">
        ${bi('Full name, mobile and age are required for each sport.', GU.formatSub)}
        ${hasFormatSports ? bi('If you do not have a second player, choose Single — we will assign your partner. If you have a partner, choose Double. ', GU.formatSubRacket) : ''}
        ${category ? `${bi(`Live ${category} slot counts update instantly.`, `લાઇવ ${category === 'Male' ? GU.men : GU.women} સ્લોટ તરત અપડેટ થાય છે.`)}` : ''}
      </p>
      ${formatError ? `<div class="alert is-error">${bilingualHtml(formatError)}</div>` : ''}

      ${needing
        .map((id, index) => {
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
          const alreadyTaken =
            isRegisteredConflict(errors.player1?.mobile ?? '') ||
            isRegisteredConflict(errors.player2?.mobile ?? '')
          const status = singlesOnlySport(id)
            ? bi('Singles only', 'ફક્ત સિંગલ્સ')
            : playerOnly
              ? bi('Team', 'ટીમ')
              : isDouble
                ? bi('Double', GU.double)
                : isSingle
                  ? bi('Single', GU.single)
                  : bi('Choose format', 'ફોર્મેટ પસંદ કરો')
          const body = `
            ${slotBadgeHtml(id)}
            ${
              organizerAssignsPartner(id)
                ? `<p class="format-rule">${racketDoublesNote()}</p>`
                : singlesOnlySport(id)
                  ? `<p class="format-rule">${bi('Singles only.', 'ફક્ત સિંગલ્સ.')}</p>`
                  : ''
            }
            ${
              playerOnly
                ? `<p class="step-sub" style="margin:0 0 0.85rem">${bi(`Enter the player full name, mobile and age for ${sportLabel(id)}.`, GU.playerOnlyHint(sportBiText(id)))}</p>`
                : `
            <div class="format-options ${missingFormat ? 'is-invalid' : ''}">
              <button type="button"
                class="choice choice-format ${isSingle ? 'is-selected' : ''}"
                data-action="format" data-sport="${id}" data-format="single">
                <span class="choice-icon-wrap">${iconSingle()}</span>
                <span class="choice-copy">
                  <span class="choice-title">${bi('Single', GU.single)}</span>
                  <span class="choice-meta">${bi('No second player — we assign one', GU.singleMeta)}</span>
                </span>
                <span class="choice-check" aria-hidden="true"></span>
              </button>
              <button type="button"
                class="choice choice-format ${isDouble ? 'is-selected' : ''}"
                data-action="format" data-sport="${id}" data-format="double">
                <span class="choice-icon-wrap">${iconDouble()}</span>
                <span class="choice-copy">
                  <span class="choice-title">${bi('Double', GU.double)}</span>
                  <span class="choice-meta">${bi('I have a partner', GU.doubleMeta)}</span>
                </span>
                <span class="choice-check" aria-hidden="true"></span>
              </button>
            </div>
            `
            }
            ${
              showPlayers
                ? renderPlayerFields(id, players, errors, {
                    showPlayer2: isDouble && !playerOnly,
                    showOrganizerNotice: isSingle && !playerOnly && organizerAssignsPartner(id),
                  })
                : ''
            }
            ${alreadyTaken ? indoorConflictActions(id, false) : ''}`
          return foldPanel(
            `format:${id}`,
            `<span class="sport-heading">${sportIcon(id)} ${sportBi(id)}</span><span class="fold-tools">${formatClearButton(id)}<span class="fold-status">${status}</span></span>`,
            body,
            foldOpen(`format:${id}`, index === 0, cardInvalid),
            `format-card ${isSingle || playerOnly ? 'is-single-mode' : ''} ${cardInvalid ? 'is-invalid' : ''}`,
            id,
          )
        })
        .join('')}

    </div>
  `
}

function renderStep4(): string {
  const sports = pickIndoor ? buildSelectedSports() : []
  const check = reviewGate()
  const hasWaiting = anySeatWaiting()
  const blocked = Boolean(submitError || !check.ok)
  return `
    <div class="fade-step review-step">
      <h2 class="step-title">${bi('Review & submit', GU.reviewTitle)}</h2>
      <p class="step-sub">${bi('Confirm every sport you selected. Full sports go on the waiting list.', GU.reviewSub)}</p>
      ${hasWaiting ? `<div class="alert" style="background:#fff8e6;border-color:rgba(212,160,23,0.35);color:#8a6a00">${bi('Some sports are full — you will be added to the waiting list for those.', GU.waitingAlert)}</div>` : ''}
      ${
        blocked
          ? `<div class="alert is-error">
              ${bilingualHtml(submitError || check.message)}
              <p class="alert-hint">${bi('Change the Player 1 details or remove that sport below — you do not need to fill the whole form again.', GU.alreadyHint)}</p>
              ${reviewConflictActions()}
            </div>`
          : ''
      }

      <div class="entry-list">
        ${sports.map((sport, index) => indoorEntryCard(sport, true, { key: `review:${sport.sportId}`, open: index === 0 || Boolean(describeSportConflict(sport, sportLabel(sport.sportId), state.mobile)) })).join('')}
        ${cricketReviewCard({ key: 'review:cricket', open: sports.length === 0 || cricketConflictLines().length > 0 })}
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

function racketDoublesNote(): string {
  return bi(
    'Doubles only: only men’s doubles and women’s doubles. No mixed doubles.',
    'ફક્ત ડબલ્સ: ફક્ત પુરુષ ડબલ્સ અને મહિલા ડબલ્સ. મિક્સ ડબલ્સ નથી.',
  )
}

function disclaimerTable(
  rows: { name: string; sportId: Parameters<typeof getSportAgeLimit>[0]; note: string }[],
  lastHead: string,
): string {
  if (!rows.length) return ''
  const body = rows
    .map((row) => {
      const { minAge, maxAge } = getSportAgeLimit(row.sportId)
      return `<tr>
        <th scope="row">${row.name}</th>
        <td>${minAge}–${maxAge}</td>
        <td>${inr(getFee(row.sportId))}</td>
        <td>${row.note}</td>
      </tr>`
    })
    .join('')
  return `
    <div class="sport-table-wrap">
      <table class="sport-table">
        <thead>
          <tr>
            <th scope="col">${bi('Sport', 'રમત')}</th>
            <th scope="col">${bi('Age', 'ઉંમર')}</th>
            <th scope="col">${bi('Per player', 'દર ખેલાડી')}</th>
            <th scope="col">${lastHead}</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>`
}

function disclaimerHtml(): string {
  const indoor = eventById('indoor')
  const turf = eventById('turf')
  const overarm = eventById('overarm')
  const primaryOpen = PRIMARY_SPORTS.filter((id) => isSportEnabled(id))
  const secondaryOpen = secondarySportsOpen()
  const racketOpen = (['pickleball', 'badminton', 'tt'] as SportId[]).filter((id) =>
    isSportEnabled(id),
  )
  const rules: string[] = []
  if (primaryOpen.length > 1) {
    const names = sportNamePair(primaryOpen, 'and', 'અને')
    rules.push(
      bi(
        `From ${names.en}, choose only one sport.`,
        `${names.gu}માંથી કોઈ પણ એક જ રમત પસંદ કરવાની રહેશે.`,
      ),
    )
  } else if (primaryOpen.length === 1) {
    const names = sportNamePair(primaryOpen, 'and', 'અને')
    rules.push(bi(`You can choose ${names.en}.`, `તમે ${names.gu} પસંદ કરી શકો છો.`))
  }
  if (secondaryOpen.length > 1) {
    const names = sportNamePair(secondaryOpen, 'and', 'અને')
    rules.push(
      bi(
        `From ${names.en}, choose any two sports.`,
        `${names.gu}માંથી કોઈ પણ બે રમતો પસંદ કરી શકાશે.`,
      ),
    )
  } else if (secondaryOpen.length === 1) {
    const names = sportNamePair(secondaryOpen, 'and', 'અને')
    rules.push(bi(`You can choose ${names.en}.`, `તમે ${names.gu} પસંદ કરી શકો છો.`))
  }
  if (racketOpen.length) {
    const names = sportNamePair(racketOpen, 'and', 'અને')
    const verb = racketOpen.length === 1 ? 'is' : 'are'
    rules.push(
      bi(
        `${names.en} ${verb} played with doubles only: only men’s doubles and women’s doubles. No mixed doubles.`,
        `${names.gu} ફક્ત ડબલ્સમાં રમાશે: ફક્ત પુરુષ ડબલ્સ અને મહિલા ડબલ્સ. મિક્સ ડબલ્સ નથી.`,
      ),
    )
    rules.push(
      bi(
        `${names.en}: if you do not have a second player, we will provide one. Please fill the form. Please wait for our response. You cannot choose the partner — you play with the partner the organizer assigns.`,
        `${names.gu}: જો બીજો ખેલાડી ન હોય, તો અમે આપીશું. કૃપા કરીને ફોર્મ ભરો. કૃપા કરીને અમારા જવાબની રાહ જુઓ. તમે પાર્ટનર પસંદ કરી શકતા નથી — આયોજક જે પાર્ટનર આપે તેની સાથે રમવું પડશે.`,
      ),
    )
    rules.push(
      bi(
        'If you already have a partner, choose Double and enter their details.',
        'પાર્ટનર હોય તો ડબલ પસંદ કરીને વિગત દાખલ કરો.',
      ),
    )
  }
  const indoorNote = (id: SportId): string => {
    if (id === 'football') return bi('Men only', 'ફક્ત પુરુષો')
    if (id === 'carrom' || id === 'chess') return bi('Singles only', 'ફક્ત સિંગલ્સ')
    return bi('Doubles only', 'ફક્ત ડબલ્સ')
  }
  const indoorTable = disclaimerTable(
    ALL_SPORT_IDS.filter((id) => isSportEnabled(id)).map((id) => ({
      name: sportBi(id),
      sportId: id,
      note: indoorNote(id),
    })),
    bi('Rule', 'નિયમ'),
  )
  return `
    <div class="disclaimer" data-lang="${uiLang}" role="dialog" aria-modal="true" aria-labelledby="disclaimer-title">
      <div class="disclaimer-card">
        <header class="disclaimer-head">
          <div class="disclaimer-brand-row">
            <img class="disclaimer-logo" src="/chanasma-logo.png" alt="શ્રી ચાણસ્મા જૈન યુવા યુથ" />
            <div class="disclaimer-lockup">
              <p class="disclaimer-wordmark" id="disclaimer-title"><span>CHANASMA</span><span>OLYMPIC</span></p>
              <svg class="disclaimer-rings" viewBox="0 0 168 36" width="168" height="36" aria-hidden="true">
                <g fill="none" stroke-width="3.2">
                  <circle cx="16" cy="18" r="12" stroke="#0085c7" />
                  <circle cx="46" cy="18" r="12" stroke="#f4c300" />
                  <circle cx="76" cy="18" r="12" stroke="#111111" />
                  <circle cx="106" cy="18" r="12" stroke="#009f3d" />
                  <circle cx="136" cy="18" r="12" stroke="#df0024" />
                </g>
              </svg>
            </div>
            <p class="disclaimer-sponsor">
              ${sponsorBlockHtml('Event partner', 'ઇવેન્ટ પાર્ટનર')}
            </p>
            <button type="button" class="disclaimer-close" data-action="close-disclaimer" aria-label="Close">${bi('Close', 'બંધ કરો')}</button>
          </div>
          <div class="disclaimer-tabs" role="tablist" aria-label="Language">
            <button type="button" role="tab" class="disclaimer-tab ${uiLang === 'en' ? 'is-selected' : ''}" data-action="disclaimer-lang" data-lang="en" aria-selected="${uiLang === 'en'}">English</button>
            <button type="button" role="tab" class="disclaimer-tab ${uiLang === 'gu' ? 'is-selected' : ''}" data-action="disclaimer-lang" data-lang="gu" aria-selected="${uiLang === 'gu'}">ગુજરાતી</button>
          </div>
        </header>
        <div class="disclaimer-body">
          <ul class="disclaimer-points">
            <li>${bi(
              'Shree Chanasma Jain Yuva Group warmly welcomes you to Chanasma Olympic.',
              'શ્રી ચાણસ્મા જૈન યુવા ગ્રુપ આપનું ચાણસ્મા ઓલિમ્પિકમાં હાર્દિક સ્વાગત કરે છે.',
            )}</li>
            <li>${bi(
              `Heartfelt thanks to our main event partner and main sponsor, ${MAIN_SPONSOR} (${MAIN_SPONSOR_LINE}).`,
              `અમારા મુખ્ય ઇવેન્ટ પાર્ટનર અને મુખ્ય પ્રાયોજક ${MAIN_SPONSOR} (${MAIN_SPONSOR_LINE})નો ખૂબ ખૂબ આભાર.`,
            )}</li>
            <li>${bi(
              'These sports are to be played together, and to bring everyone closer.',
              'આ ઓલિમ્પિકની રમતો સાથે મળીને રમવાની છે અને એકબીજાને જોડવાની છે.',
            )}</li>
          </ul>

          ${
            rules.length
              ? `
          <h3>${bi('Registration rules', 'નોંધણીના નિયમો')}</h3>
          ${
            indoorOpen()
              ? `<p class="disclaimer-when">${bi(
                  `${indoor.date} · ${indoor.weekday} · 4:00 PM to 11:00 PM`,
                  `${indoor.dateGu} · ${indoor.weekdayGu} · સાંજે 4 વાગ્યાથી રાત્રે 11 વાગ્યા સુધી`,
                )}</p>`
              : ''
          }
          <ol class="disclaimer-points is-numbered">
            ${rules.map((rule) => `<li>${rule}</li>`).join('')}
          </ol>`
              : ''
          }

          ${
            indoorOpen()
              ? `<h3>${bi('Olympic games', 'ઓલિમ્પિક રમતો')}</h3>${indoorTable}`
              : ''
          }

          ${
            cricketOpen()
              ? `<h3>${bi('Cricket', 'ક્રિકેટ')}</h3>
          ${disclaimerTable(
            [
              ...(isSportEnabled('turf')
                ? [
                    {
                      name: bi(turf.title, turf.titleGu),
                      sportId: 'turf' as const,
                      note: bi(
                        `${turf.date} · ${turf.weekday}<br>Men and women`,
                        `${turf.dateGu} · ${turf.weekdayGu}<br>પુરુષ અને મહિલા`,
                      ),
                    },
                  ]
                : []),
              ...(isSportEnabled('overarm')
                ? [
                    {
                      name: bi(overarm.title, overarm.titleGu),
                      sportId: 'overarm' as const,
                      note: bi(
                        `${overarm.date} · ${overarm.weekday}<br>Men only`,
                        `${overarm.dateGu} · ${overarm.weekdayGu}<br>ફક્ત પુરુષો`,
                      ),
                    },
                  ]
                : []),
            ],
            bi('When', 'ક્યારે'),
          )}`
              : ''
          }

          <div class="disclaimer-note">
            <p class="disclaimer-note-title">${bi('Please note', 'નોંધ')}</p>
            <ul class="disclaimer-points">
              <li>${bi(
                'No fee is refundable once a seat is confirmed.',
                'સીટ કન્ફર્મ થયા પછી કોઈ પણ રકમ પાછી મળશે નહીં.',
              )}</li>
              <li>${bi(
                'A waiting seat that is not confirmed can be refunded.',
                'વેઇટિંગની સીટ કન્ફર્મ ન થાય તો તે રકમ પાછી મળશે.',
              )}</li>
              <li>${bi(
                'The committee may change a rule if the situation requires it.',
                'સમિતિ પરિસ્થિતિ મુજબ કોઈ પણ નિયમ બદલી શકે છે.',
              )}</li>
            </ul>
          </div>
        </div>
        <footer class="disclaimer-foot">
          <button type="button" class="btn btn-gold" data-action="begin-form">${bi("Let's Begin", 'ચાલો શરૂ કરીએ')}</button>
        </footer>
      </div>
    </div>`
}

function mountDisclaimer(): void {
  app.querySelector('.disclaimer')?.remove()
  const open = showDisclaimer && currentPhase().id === 'begin'
  document.body.classList.toggle('disclaimer-open', open)
  if (!open) return
  app.insertAdjacentHTML('beforeend', disclaimerHtml())
}

function renderBegin(): string {
  const indoor = eventById('indoor')
  const showIndoor = indoorOpen()
  const showCricket = cricketOpen()
  const tiles = indoor.sports.filter((sport) => sport.sportId && isSportEnabled(sport.sportId))
  const indoorCard = showIndoor
    ? `
        <button type="button" class="gate-card ${pickIndoor ? 'is-selected' : ''}" data-action="toggle-indoor" data-tone="olympic">
          <span class="gate-banner">
            <span class="cricket-head">
              <span class="gate-banner-title">${bi('Olympic games', 'ઓલિમ્પિક રમતો')}</span>
              <span class="cricket-dates">
                <span class="cricket-date">${bi(`${Number(indoor.day)} ${indoor.month} ${indoor.year}`, indoor.dateGu)}</span>
              </span>
            </span>
            <span class="gate-tick" aria-hidden="true"></span>
          </span>
          <span class="gate-photo gate-photo-sports" aria-hidden="true">
            ${tiles
              .map(
                (sport) =>
                  `<span class="sport-tile-photo">${sport.sportId ? sportIcon(sport.sportId) : ''}</span>`,
              )
              .join('')}
          </span>
        </button>`
    : ''
  const cricketCard = showCricket
    ? `
        <button type="button" class="gate-card ${pickCricket ? 'is-selected' : ''}" data-action="toggle-cricket" data-tone="cricket">
          <span class="gate-banner">
            <span class="cricket-head">
              <span class="gate-banner-title">${bi('Cricket sports', 'ક્રિકેટ સ્પોર્ટ્સ')}</span>
              <span class="cricket-dates">
                ${isSportEnabled('turf') ? '<span class="cricket-date">Turf 10 Jan 2027</span>' : ''}
                ${isSportEnabled('overarm') ? '<span class="cricket-date">Overarm 13 Dec 2026</span>' : ''}
              </span>
            </span>
            <span class="gate-tick" aria-hidden="true"></span>
          </span>
          <span class="gate-photo" aria-hidden="true"></span>
        </button>`
    : ''
  return `
    <div class="fade-step gate-step">
      <h2 class="step-title">${bi('Choose your registration', 'તમારી નોંધણી પસંદ કરો')}</h2>
      ${beginError ? `<div class="alert is-error">${bilingualHtml(beginError)}</div>` : ''}
      ${
        !showIndoor && !showCricket
          ? `<p class="step-sub">${bi('Registration is closed.', 'નોંધણી બંધ છે.')}</p>`
          : ''
      }
      <div class="gate-grid">
        ${indoorCard}
        ${showIndoor && showCricket ? `<div class="gate-and" aria-hidden="true">${bi('And', 'અને')}</div>` : ''}
        ${cricketCard}
      </div>
    </div>
  `
}

function renderCricketGender(): string {
  const turfOn = isSportEnabled('turf')
  const overarmOn = isSportEnabled('overarm')
  const sub = overarmOn
    ? bi(
        'Choose Male or Female first. Overarm is only for men.',
        'પહેલા પુરુષ અથવા સ્ત્રી પસંદ કરો. ઓવરઆર્મ ફક્ત પુરુષો માટે છે.',
      )
    : bi('Choose Male or Female first.', 'પહેલા પુરુષ અથવા સ્ત્રી પસંદ કરો.')
  return `
    <div class="fade-step">
      <h2 class="step-title">${bi('Cricket sports', 'ક્રિકેટ સ્પોર્ટ્સ')}</h2>
      <p class="step-sub">${sub}</p>
      ${cricketGenderError ? `<div class="alert is-error">${bilingualHtml(cricketGenderError)}</div>` : ''}
      <div class="choice-grid ${cricketGenderError ? 'is-invalid' : ''}">
        <button type="button" class="choice choice-gender ${cricketGender === 'male' ? 'is-selected' : ''}" data-action="cricket-gender" data-gender="male">
          <span class="choice-icon-wrap">${iconMale()}</span>
          <span class="choice-copy">
            <span class="choice-title">${bi('Male', GU.male)}</span>
            ${turfOn ? namedCricketSlot('turf', 'male') : ''}
            ${overarmOn ? namedCricketSlot('overarm', 'male') : ''}
          </span>
          <span class="choice-check" aria-hidden="true"></span>
        </button>
        ${
          turfOn
            ? `<button type="button" class="choice choice-gender ${cricketGender === 'female' ? 'is-selected' : ''}" data-action="cricket-gender" data-gender="female">
          <span class="choice-icon-wrap">${iconFemale()}</span>
          <span class="choice-copy">
            <span class="choice-title">${bi('Female', GU.female)}</span>
            ${namedCricketSlot('turf', 'female')}
          </span>
          <span class="choice-check" aria-hidden="true"></span>
        </button>`
            : ''
        }
      </div>
    </div>
  `
}

function renderCricketChoice(): string {
  const turf = eventById('turf')
  const overarm = eventById('overarm')
  const female = cricketGender === 'female'
  const turfOn = isSportEnabled('turf')
  const overarmOn = isSportEnabled('overarm') && !female
  const sub =
    turfOn && overarmOn
      ? bi(
          'Select Turf, Overarm, or both. The player form is filled once.',
          'ટર્ફ, ઓવરઆર્મ, અથવા બંને પસંદ કરો. ખેલાડીનું ફોર્મ એક જ વાર ભરાશે.',
        )
      : turfOn
        ? bi('Select Turf. The player form is filled once.', 'ટર્ફ પસંદ કરો. ખેલાડીનું ફોર્મ એક જ વાર ભરાશે.')
        : bi('Select Overarm. The player form is filled once.', 'ઓવરઆર્મ પસંદ કરો. ખેલાડીનું ફોર્મ એક જ વાર ભરાશે.')
  return `
    <div class="fade-step">
      <h2 class="step-title">${bi('Cricket sports', 'ક્રિકેટ સ્પોર્ટ્સ')}</h2>
      <p class="step-sub">${sub}</p>
      ${cricketChoiceError ? `<div class="alert is-error">${bilingualHtml(cricketChoiceError)}</div>` : ''}
      <div class="choice-grid ${cricketChoiceError ? 'is-invalid' : ''}">
        ${
          turfOn
            ? `<button type="button" class="choice choice-dated ${pickTurf ? 'is-selected' : ''}" data-action="cricket-kind" data-kind="turf" data-tone="turf">
          <span class="choice-datebar">
            <span class="cricket-date">Turf ${turf.day} ${turf.month} ${turf.year}</span>
            <span class="choice-check" aria-hidden="true"></span>
          </span>
          <span class="choice-title">${bi('Turf', 'ટર્ફ')}</span>
          <span class="choice-slots">
            ${cricketSlotHtml('turf', female ? 'female' : 'male')}
          </span>
        </button>`
            : ''
        }
        ${
          overarmOn
            ? `<button type="button" class="choice choice-dated ${pickOverarm ? 'is-selected' : ''}" data-action="cricket-kind" data-kind="overarm" data-tone="overarm">
          <span class="choice-datebar">
            <span class="cricket-date">Overarm ${overarm.day} ${overarm.month} ${overarm.year}</span>
            <span class="choice-check" aria-hidden="true"></span>
          </span>
          <span class="choice-title">${bi('Overarm', 'ઓવરઆર્મ')}</span>
          <span class="choice-slots">
            ${cricketSlotHtml('overarm', 'male')}
          </span>
        </button>`
            : ''
        }
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
  syncCricketMobileClash()
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
        'Fill Player 1 details once for Turf and Overarm.',
        'ટર્ફ અને ઓવરઆર્મ માટે ખેલાડી ૧ વિગતો એક જ વાર ભરો.',
      )
    : `${who} · ${bi('Fill full name, mobile and age. Skill, area and photo are also required.', 'પૂરું નામ, મોબાઇલ અને ઉંમર ભરો. કુશળતા, વિસ્તાર અને ફોટો પણ જરૂરી છે.')}`
  const ageLimit = cricketAgeBounds()
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
      ${foldPanel(
        'cricket:name',
        `<span class="fold-title">${bi('Player 1 details', GU.playerDetails)}</span>`,
        `
        <div class="player-head">
          <p class="section-label player-head-title">${bi('Player 1 details', GU.playerDetails)}</p>
          ${playerHeadActions()}
        </div>
        <div class="player-row">
          ${cricketField(
            'fullName',
            'Full Name',
            GU.fullName,
            `<input id="cricket-fullName" data-cricket="player" data-field="fullName" type="text" value="${escapeAttr(player.fullName)}" placeholder="${escapeAttr(ui('Full name', GU.placeholderName))}" required />`,
          )}
          ${cricketField(
            'mobile',
            'Mobile Number',
            GU.mobile,
            `<input id="cricket-mobile" data-cricket="player" data-field="mobile" type="tel" inputmode="numeric" maxlength="12" value="${escapeAttr(player.mobile)}" placeholder="${escapeAttr(ui('10-digit mobile', GU.placeholderMobile))}" required />`,
          )}
          ${cricketField(
            'age',
            'Age',
            GU.age,
            `<input id="cricket-age" data-cricket="player" data-field="age" type="number" inputmode="numeric" min="${ageLimit.minAge}" max="${ageLimit.maxAge}" step="1" value="${escapeAttr(player.age)}" placeholder="${escapeAttr(ui(`${ageLimit.minAge}–${ageLimit.maxAge}`, GU.placeholderAge))}" required />`,
          )}
        </div>
        `,
        foldOpen(
          'cricket:name',
          true,
          Boolean(errors.fullName || errors.mobile || errors.age),
        ),
        'form-fold',
      )}
      ${foldPanel(
        'cricket:more',
        `<span class="fold-title">${bi('Skill, area and photo', 'કુશળતા, વિસ્તાર અને ફોટો')}</span>`,
        `
        ${skills}
        ${cricketField(
          'area',
          "Player's area",
          'ખેલાડીનો વિસ્તાર',
          `<select data-cricket="player" data-field="area">
            <option value="">${escapeAttr(ui('Select area', 'વિસ્તાર પસંદ કરો'))}</option>
            ${PLAYER_AREAS.map(
              (area) =>
                `<option value="${escapeAttr(area)}" ${player.area === area ? 'selected' : ''}>${escapeHtml(area)}</option>`,
            ).join('')}
            <option value="${PLAYER_AREA_OTHER}" ${player.area === PLAYER_AREA_OTHER ? 'selected' : ''}>${escapeHtml(ui('Other', 'અન્ય'))}</option>
          </select>`,
        )}
        ${
          player.area === PLAYER_AREA_OTHER
            ? cricketField(
                'areaOther',
                'Place name',
                'સ્થળનું નામ',
                `<input data-cricket="player" data-field="areaOther" type="text" value="${escapeAttr(player.areaOther)}" placeholder="${escapeAttr(ui('Enter place name', 'સ્થળનું નામ લખો'))}" required />`,
              )
            : ''
        }
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
        `,
        foldOpen(
          'cricket:more',
          true,
          Boolean(errors.area || errors.areaOther || errors.photo || skillErrors.turf || skillErrors.overarm),
        ),
        'form-fold',
      )}
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

function indoorConflictActions(sportId: SportId, showChange: boolean): string {
  return `
    <div class="conflict-actions">
      ${
        showChange
          ? `<button type="button" class="btn btn-primary btn-compact" data-action="fix-sport" data-sport="${escapeAttr(sportId)}">${bi('Change Player 1 details', GU.changePlayerDetails)}</button>`
          : ''
      }
      <button type="button" class="btn btn-ghost btn-compact" data-action="remove-sport" data-sport="${escapeAttr(sportId)}">${bi('Remove this sport', GU.removeThisSport)}</button>
    </div>`
}

function cricketConflictActions(kinds: CricketKind[]): string {
  return `
    <div class="conflict-actions">
      <button type="button" class="btn btn-primary btn-compact" data-action="fix-cricket">${bi('Change cricket details', GU.changeCricketDetails)}</button>
      ${kinds
        .map((kind) =>
          kind === 'turf'
            ? `<button type="button" class="btn btn-ghost btn-compact" data-action="remove-cricket" data-kind="turf">${bi('Remove Turf', GU.removeTurf)}</button>`
            : `<button type="button" class="btn btn-ghost btn-compact" data-action="remove-cricket" data-kind="overarm">${bi('Remove Overarm', GU.removeOverarm)}</button>`,
        )
        .join('')}
    </div>`
}

function indoorEntryCard(
  sport: SelectedSport,
  showSlots = false,
  fold?: { key: string; open: boolean },
): string {
  if (sport.sportId === 'turf' || sport.sportId === 'overarm') return ''
  const existing = describeSportConflict(sport, sportLabel(sport.sportId), state.mobile)
  const format =
    sport.sportId === 'football'
      ? bi('Team', 'ટીમ')
      : organizerAssignsPartner(sport.sportId) && sport.format !== 'double'
        ? bi('Partner assigned by organizer', 'પાર્ટનર આયોજક આપશે')
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
  const note = existing
    ? `<p class="existing-detail">${bilingualHtml(existing)}</p>${fold ? indoorConflictActions(sport.sportId, true) : ''}`
    : ''
  const slots = showSlots && state.gender ? slotBadgeFor(sport.sportId, state.gender) : ''
  const summary = `
    <span class="entry-icon">${sportIcon(sport.sportId)}</span>
    <span class="entry-copy">
      <h4>${sportBi(sport.sportId)}</h4>
      <p>${format}</p>
    </span>
    ${seatPill(sport.status)}`
  const body = `${slots}${people}${note}`
  if (fold) {
    const open = foldOpen(fold.key, fold.open, Boolean(existing))
    return foldPanel(
      fold.key,
      summary,
      body,
      open,
      `entry-fold ${existing ? 'is-invalid' : ''} ${sport.status === 'waiting' ? 'is-waiting' : 'is-confirmed'}`,
      sport.sportId,
    )
  }
  return `
    <article class="entry-card ${existing ? 'is-error' : ''} ${sport.status === 'waiting' ? 'is-waiting' : 'is-confirmed'}" data-sport="${sport.sportId}">
      <header class="entry-head">
        ${summary}
      </header>
      ${body}
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

function cricketReviewStatus(): 'confirmed' | 'waiting' {
  if (pickTurf && cricketStatus('turf') === 'waiting') return 'waiting'
  if (pickOverarm && cricketStatus('overarm') === 'waiting') return 'waiting'
  return 'confirmed'
}

function cricketReviewCard(fold?: { key: string; open: boolean }): string {
  if (!pickTurf && !pickOverarm) return ''
  const clashes = cricketConflictLines()
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
  const name = player.fullName.trim()
  const details = [player.mobile.trim(), player.age.trim(), cricketAreaLocation(player)]
    .filter(Boolean)
    .join(' · ')
  const status = cricketReviewStatus()
  const summary = `
    ${
      player.photoUrl
        ? `<img class="entry-photo" src="${player.photoUrl}" alt="" />`
        : `<span class="entry-icon">${iconCricket()}</span>`
    }
    <span class="entry-copy">
      <h4>${bi(heading, headingGu)}</h4>
      <p>${who}</p>
    </span>
    ${seatPill(status)}`
  const clashNote = clashes
    .map((item) => `<p class="existing-detail">${bilingualHtml(item.message)}</p>`)
    .join('')
  const body = `
    <p class="entry-line"><span>${bi('Player', 'ખેલાડી')}</span><strong>${escapeHtml(name || '—')}</strong></p>
    ${details ? `<p class="entry-line"><span>${bi('Details', 'વિગત')}</span><strong>${escapeHtml(details)}</strong></p>` : ''}
    ${pickTurf ? cricketSkillLine('turf') : ''}
    ${pickOverarm ? cricketSkillLine('overarm') : ''}
    ${clashNote}
    ${fold && clashes.length ? cricketConflictActions(clashes.map((item) => item.kind)) : ''}`
  if (fold) {
    return foldPanel(
      fold.key,
      summary,
      body,
      foldOpen(fold.key, fold.open, clashes.length > 0),
      `entry-fold ${clashes.length ? 'is-invalid' : ''} ${status === 'waiting' ? 'is-waiting' : 'is-confirmed'}`,
    )
  }
  return `
    <article class="entry-card ${status === 'waiting' ? 'is-waiting' : 'is-confirmed'}" data-tone="${both ? 'turf' : pickTurf ? 'turf' : 'overarm'}">
      <header class="entry-head">${summary}</header>
      ${body}
    </article>
  `
}

function inr(amount: number): string {
  return `₹${amount.toLocaleString('en-IN')}`
}

function pdfInr(amount: number): string {
  return `Rs ${amount.toLocaleString('en-IN')}`
}

function pdfMoney(text: string): string {
  return text.replaceAll('₹', 'Rs ')
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

function payCopyButton(value: string): string {
  return `<button type="button" class="pay-copy" data-action="copy-text" data-copy="${escapeAttr(value)}"><span class="pay-copy-label">${bi('Copy', 'કૉપી')}</span></button>`
}

function payBankRow(label: string, value: string, copy: boolean): string {
  return `<div><dt>${label}</dt><dd><strong>${escapeHtml(value)}</strong>${copy ? payCopyButton(value) : ''}</dd></div>`
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
        ${sports.map((sport) => indoorEntryCard(sport, true, { key: `pay:${sport.sportId}`, open: false })).join('')}
        ${cricketReviewCard({ key: 'pay:cricket', open: false })}
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
          </figure>`
              : `<p class="pay-note">${bi(`QR is shown only when the amount is below ${inr(QR_LIMIT)}. Use UPI or the bank account.`, `QR ફક્ત ${inr(QR_LIMIT)}થી ઓછી રકમ માટે છે. UPI અથવા બેંક એકાઉન્ટ વાપરો.`)}</p>`
          }
          <section class="pay-card">
            <p class="pay-kicker">${bi('UPI', 'UPI')}</p>
            <div class="pay-copy-row">
              <p class="pay-value">${escapeHtml(UPI_ID)}</p>
              ${payCopyButton(UPI_ID)}
            </div>
          </section>
          <section class="pay-card">
            <p class="pay-kicker">${bi('Bank transfer', 'બેંક ટ્રાન્સફર')}</p>
            <p class="pay-account-name">${escapeHtml(BANK.name)}</p>
            <dl class="pay-bank">
              ${payBankRow(bi('A/c No.', 'ખાતા નં.'), BANK.account, true)}
              ${payBankRow(bi('IFSC Code', 'IFSC કોડ'), BANK.ifsc, true)}
              ${payBankRow(bi('Home Branch', 'બ્રાન્ચ'), BANK.branch, false)}
            </dl>
          </section>
          <label class="pay-upload">
            <input data-payment-shot type="file" accept="image/*" />
            <span class="pay-upload-title">${bi('Upload payment screenshot', 'ચુકવણીનો સ્ક્રીનશૉટ અપલોડ કરો')}</span>
            ${
              paymentShot
                ? `<span class="pay-file">${escapeHtml(paymentShotName || 'Screenshot added')}</span><img class="pay-shot" src="${paymentShot}" alt="" />`
                : `<span class="pay-file">${bi('After payment, add a screenshot and submit.', 'ચુકવણી પછી સ્ક્રીનશૉટ ઉમેરીને સબમિટ કરો.')}</span>`
            }
          </label>
          ${
            verifyingScreenshot
              ? `<div class="ocr-status is-verifying">
                  <span class="ocr-spinner" aria-hidden="true"></span>
                  <span>${bi('🔍 Verifying payment screenshot with OCR…', '🔍 OCR વડે સ્ક્રીનશૉટ ચકાસી રહ્યા છીએ…')}</span>
                </div>`
              : screenshotVerification?.status === 'ACCEPT'
                ? `<div class="ocr-status is-success">
                    <span class="ocr-badge-icon" aria-hidden="true">✓</span>
                    <div class="ocr-badge-content">
                      <strong>${bi('Payment Verified', 'ચકાસાયેલ ચુકવણી')}</strong>
                      <p>${escapeHtml(screenshotVerification.data?.payment_app || 'UPI')} · ${screenshotVerification.data?.amount ? `₹${screenshotVerification.data.amount}` : ''}${screenshotVerification.data?.utr ? ` · UTR: ${escapeHtml(screenshotVerification.data.utr)}` : ''}</p>
                    </div>
                  </div>`
                : screenshotVerification?.status === 'REJECT'
                  ? `<div class="ocr-status is-error">
                      <span class="ocr-badge-icon" aria-hidden="true">✕</span>
                      <div class="ocr-badge-content">
                        <strong>${bi('Verification Failed', 'ચકાસણી નિષ્ફળ')}</strong>
                        <p>${escapeHtml(screenshotVerification.reason)}</p>
                      </div>
                    </div>`
                  : ''
          }
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
          <p class="receipt-sponsor-pill">${receiptSponsorHtml()}</p>
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
    </div>
  `
}

function receiptSportName(id: SelectedSport['sportId']): string {
  return sportLabel(id)
}

function receiptFormatLabel(sport: SelectedSport): string {
  if (sport.sportId === 'football') return 'Team'
  if (
    sport.sportId !== 'turf' &&
    sport.sportId !== 'overarm' &&
    organizerAssignsPartner(sport.sportId) &&
    sport.format !== 'double'
  ) {
    return 'Partner assigned by organizer'
  }
  return sport.format === 'double' ? 'Doubles' : 'Singles'
}

function receiptStatusLabel(status: 'confirmed' | 'waiting'): string {
  return status === 'waiting' ? 'Waiting' : 'Confirmed'
}

function receiptPlayerBits(
  name: string | undefined,
  mobile: string | undefined,
  age: number | string | undefined,
): string {
  const bits = [name?.trim() || '-', mobile?.trim() || '-']
  if (age != null && String(age).trim() !== '') bits.push(String(age))
  return bits.join(' · ')
}

type ReceiptPdf = import('jspdf').jsPDF

async function loadDataUrl(src: string): Promise<string | null> {
  if (!src) return null
  if (src.startsWith('data:')) return src
  try {
    const response = await fetch(src)
    if (!response.ok) return null
    const blob = await response.blob()
    return await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result || ''))
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

function pdfEnsureSpace(pdf: ReceiptPdf, y: number, need: number): number {
  const bottom = pdf.internal.pageSize.getHeight() - 42
  if (y + need <= bottom) return y
  pdf.addPage()
  return 44
}

function drawReceiptCard(
  pdf: ReceiptPdf,
  y: number,
  title: string,
  sub: string,
  rows: [string, string][],
): number {
  const pageW = pdf.internal.pageSize.getWidth()
  const left = 48
  const width = pageW - 96
  const rowH = 16
  const height = 46 + rows.length * rowH + 10
  y = pdfEnsureSpace(pdf, y, height)
  pdf.setDrawColor(215, 222, 231)
  pdf.setFillColor(255, 255, 255)
  pdf.roundedRect(left, y, width, height, 8, 8, 'S')
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(12)
  pdf.setTextColor(11, 31, 58)
  pdf.text(title, left + 12, y + 18)
  pdf.setFontSize(9)
  pdf.setTextColor(90, 107, 127)
  pdf.text(sub, left + 12, y + 32)
  let rowY = y + 48
  for (const [label, value] of rows) {
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(9)
    pdf.setTextColor(90, 107, 127)
    pdf.text(label, left + 12, rowY)
    pdf.setTextColor(11, 31, 58)
    const wrapped = pdf.splitTextToSize(value, width - 140)
    pdf.text(wrapped, left + 118, rowY)
    rowY += Math.max(rowH, wrapped.length * 12)
  }
  return y + height + 12
}

async function waitForReceiptThenDownload(): Promise<void> {
  const deadline = Date.now() + 5000
  while (!document.getElementById('receipt-sheet') && Date.now() < deadline) {
    await new Promise((resolve) => window.setTimeout(resolve, 40))
  }
  if (!document.getElementById('receipt-sheet')) return
  await downloadReceipt()
}

function downloadPdfBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.rel = 'noopener'
  link.target = '_blank'
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 4000)
}

async function makeReceiptPdf(): Promise<{ blob: Blob; filename: string } | null> {
  if (!document.getElementById('receipt-sheet')) return null
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({ unit: 'pt', format: 'a4', compress: true })
  const pageW = pdf.internal.pageSize.getWidth()
  const sports = pickIndoor ? lastRegisteredSports : []
  const lines = frozenBill ?? feeLines(sports)
  const total = lines.reduce((sum, line) => sum + line.amount, 0)
  const when = new Date().toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
  const paidHow =
    payMode === 'cash' ? `Cash · ${cashCollector}` : 'Online · UPI / bank'
  const logo = await loadDataUrl('/chanasma-logo.png')
  const cricketPhoto = pickTurf || pickOverarm ? await loadDataUrl(cricketEntry.photoUrl) : null
  const shot = payMode === 'online' && paymentShot ? await loadDataUrl(paymentShot) : null

  let y = 36
  if (logo) {
    pdf.addImage(logo, 'PNG', (pageW - 52) / 2, y, 52, 52)
    y += 64
  }

  pdf.setFont('helvetica', 'bold')
  pdf.setTextColor(11, 31, 58)
  pdf.setFontSize(22)
  pdf.text('CHANASMA', pageW / 2, y, { align: 'center' })
  y += 18
  pdf.setTextColor(223, 0, 36)
  pdf.setFontSize(11)
  pdf.text('OLYMPIC', pageW / 2, y, { align: 'center' })
  y += 18

  const boxW = 320
  pdf.setFillColor(11, 31, 58)
  pdf.roundedRect((pageW - boxW) / 2, y, boxW, 48, 8, 8, 'F')
  pdf.setTextColor(240, 193, 75)
  pdf.setFontSize(8)
  pdf.text('EVENT PARTNER', pageW / 2, y + 14, { align: 'center' })
  pdf.setFontSize(11)
  pdf.text(MAIN_SPONSOR, pageW / 2, y + 28, { align: 'center' })
  pdf.setFontSize(7)
  pdf.setTextColor(230, 230, 230)
  pdf.text(MAIN_SPONSOR_LINE, pageW / 2, y + 40, { align: 'center' })
  y += 68

  pdf.setTextColor(11, 31, 58)
  pdf.setFontSize(16)
  pdf.text('Payment receipt', pageW / 2, y, { align: 'center' })
  y += 18
  pdf.setTextColor(223, 0, 36)
  pdf.setFontSize(12)
  pdf.text(receiptNo || 'Receipt', pageW / 2, y, { align: 'center' })
  y += 16
  pdf.setTextColor(90, 107, 127)
  pdf.setFontSize(10)
  pdf.text(when, pageW / 2, y, { align: 'center' })
  y += 22

  for (const sport of sports) {
    const rows: [string, string][] =
      sport.format === 'double'
        ? [
            [
              'Player 1',
              receiptPlayerBits(sport.player1Name, sport.player1Mobile, sport.player1Age),
            ],
            [
              'Player 2',
              receiptPlayerBits(sport.player2Name, sport.player2Mobile, sport.player2Age),
            ],
          ]
        : [
            [
              'Player',
              receiptPlayerBits(
                sport.player1Name || state.fullName,
                sport.player1Mobile || normalizeMobile(state.mobile),
                sport.player1Age,
              ),
            ],
          ]
    y = drawReceiptCard(
      pdf,
      y,
      receiptSportName(sport.sportId),
      `${receiptFormatLabel(sport)} · ${receiptStatusLabel(sport.status)}`,
      rows,
    )
  }

  if (pickTurf || pickOverarm) {
    const player = cricketEntry
    const both = pickTurf && pickOverarm
    const heading = both ? 'Cricket' : pickTurf ? 'Turf cricket' : 'Overarm cricket'
    const who = both
      ? 'Turf · Overarm'
      : pickOverarm
        ? 'Men only'
        : cricketGender === 'female'
          ? 'Female'
          : 'Male'
    const name = player.fullName.trim()
    const details = [player.mobile.trim(), player.age.trim(), cricketAreaLocation(player)]
      .filter(Boolean)
      .join(' · ')
    const rows: [string, string][] = [['Player', name || '-']]
    if (details) rows.push(['Details', details])
    for (const kind of ['turf', 'overarm'] as const) {
      if (kind === 'turf' ? !pickTurf : !pickOverarm) continue
      const skill = PLAYER_SKILLS.find((item) => item.id === cricketSkills[kind])
      rows.push([
        kind === 'turf' ? 'Turf' : 'Overarm',
        `${skill ? skill.en : '-'} · ${receiptStatusLabel(cricketStatus(kind))}`,
      ])
    }
    if (cricketPhoto) {
      y = pdfEnsureSpace(pdf, y, 90)
      pdf.addImage(cricketPhoto, 'JPEG', 48, y, 72, 72)
      y += 84
    }
    y = drawReceiptCard(pdf, y, heading, who, rows)
  }

  const billH = 58 + lines.length * 16
  y = pdfEnsureSpace(pdf, y, billH)
  const left = 48
  const width = pageW - 96
  pdf.setDrawColor(215, 222, 231)
  pdf.roundedRect(left, y, width, billH, 8, 8, 'S')
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(9)
  pdf.setTextColor(90, 107, 127)
  pdf.text('AMOUNT DUE', left + 12, y + 16)
  let lineY = y + 34
  for (const line of lines) {
    pdf.setFontSize(10)
    pdf.setTextColor(11, 31, 58)
    pdf.text(pdfMoney(line.label), left + 12, lineY)
    pdf.text(pdfInr(line.amount), left + width - 12, lineY, { align: 'right' })
    lineY += 16
  }
  pdf.setDrawColor(11, 31, 58)
  pdf.line(left + 12, lineY - 6, left + width - 12, lineY - 6)
  pdf.setFontSize(12)
  pdf.text('Total', left + 12, lineY + 12)
  pdf.setTextColor(223, 0, 36)
  pdf.text(pdfInr(total), left + width - 12, lineY + 12, { align: 'right' })
  y += billH + 18

  y = pdfEnsureSpace(pdf, y, 24)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(11)
  pdf.setTextColor(90, 107, 127)
  pdf.text('Paid by', 48, y)
  pdf.setTextColor(11, 31, 58)
  pdf.text(paidHow, pageW - 48, y, { align: 'right' })
  y += 16

  if (shot) {
    y = pdfEnsureSpace(pdf, y, 170)
    pdf.addImage(shot, 'JPEG', 48, y, 140, 140)
  }

  return {
    blob: pdf.output('blob'),
    filename: `${receiptNo || 'chansma-receipt'}.pdf`,
  }
}

function receiptBusyButtons(busy: boolean, message?: string): void {
  for (const action of ['download-receipt', 'share-receipt'] as const) {
    const button = document.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)
    if (!button) continue
    if (busy) {
      if (!button.dataset.labelHtml) button.dataset.labelHtml = button.innerHTML
      button.disabled = true
      if (message) button.textContent = message
    } else {
      button.disabled = false
      if (button.dataset.labelHtml) {
        button.innerHTML = button.dataset.labelHtml
        delete button.dataset.labelHtml
      }
    }
  }
}

async function withReceiptPdf(
  next: (pdf: { blob: Blob; filename: string }) => Promise<void> | void,
): Promise<void> {
  if (receiptPdfBusy) return
  receiptPdfBusy = true
  receiptBusyButtons(true, biText('Preparing…', 'તૈયાર થઈ રહ્યું છે…'))
  const preparing = document.createElement('div')
  preparing.className = 'receipt-offer'
  preparing.innerHTML = `<div class="receipt-offer-card"><p>${bi('Preparing your receipt…', 'રસીદ તૈયાર થઈ રહી છે…')}</p></div>`
  document.body.appendChild(preparing)
  try {
    const pdf = await makeReceiptPdf()
    preparing.remove()
    if (!pdf) throw new Error('Receipt is not ready')
    await next(pdf)
  } catch (error) {
    console.error(error)
    preparing.remove()
    receiptBusyButtons(true, biText('Try again', 'ફરી પ્રયાસ કરો'))
    window.setTimeout(() => receiptBusyButtons(false), 1600)
    receiptPdfBusy = false
    return
  }
  receiptBusyButtons(false)
  receiptPdfBusy = false
}

async function downloadReceipt(): Promise<void> {
  await withReceiptPdf(({ blob, filename }) => {
    downloadPdfBlob(blob, filename)
  })
}

async function shareReceipt(): Promise<void> {
  await withReceiptPdf(async ({ blob, filename }) => {
    const file = new File([blob], filename, { type: 'application/pdf' })
    if (
      typeof navigator.share === 'function' &&
      typeof navigator.canShare === 'function' &&
      navigator.canShare({ files: [file] })
    ) {
      try {
        await navigator.share({
          files: [file],
          title: 'CHANASMA Olympic receipt',
          text: `CHANASMA Olympic receipt ${receiptNo}`,
        })
        return
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return
      }
    }
    downloadPdfBlob(blob, filename)
  })
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

function navBackButton(): string {
  return `<button type="button" class="btn btn-ghost" data-action="back">${withIcon(iconArrowLeft(), bi('Back', GU.back))}</button>`
}

function renderNavFooter(): string {
  const phase = currentPhase()
  let buttons = ''
  let extraClass = ''

  if (phase.id === 'begin') {
    if (!indoorOpen() && !cricketOpen()) return ''
    buttons = `<button type="button" class="btn btn-primary" data-action="next">${withIcon(iconArrowRight(), bi('Next', 'આગળ'))}</button>`
  } else if (phase.id === 'done') {
    extraClass = ' panel-foot-receipt'
    buttons = `
      <button type="button" class="btn btn-ghost" data-action="download-receipt">${withIcon(iconDownload(), bi('Download PDF', 'PDF ડાઉનલોડ'))}</button>
      <button type="button" class="btn btn-ghost" data-action="share-receipt">${withIcon(iconShare(), bi('Share PDF', 'PDF શેર કરો'))}</button>
      <button type="button" class="btn btn-primary" data-action="reset">${withIcon(iconSpark(), bi('Start again', 'ફરી શરૂ કરો'))}</button>`
  } else if (phase.id === 'pay') {
    const canSubmit =
      (payMode === 'cash' || (payMode === 'online' && screenshotVerification?.status === 'ACCEPT')) &&
      !submitBusy &&
      !verifyingScreenshot
    buttons = `
      ${navBackButton()}
      <button type="button" class="btn btn-gold" data-action="submit" ${canSubmit ? '' : 'disabled'}>
        ${withIcon(iconCheck(), submitBusy ? bi('Saving…', 'સાચવી રહ્યા છીએ…') : bi('Submit', 'સબમિટ'))}
      </button>`
  } else if (phase.id === 'review') {
    const check = reviewGate()
    const blocked = Boolean(submitError || !check.ok)
    buttons = `
      ${navBackButton()}
      ${
        blocked
          ? `<button type="button" class="btn btn-gold" data-action="fix-conflict">${withIcon(iconArrowRight(), bi('Change Player 1 details', GU.changePlayerDetails))}</button>`
          : `<button type="button" class="btn btn-gold" data-action="next">${withIcon(iconArrowRight(), bi('Continue to pay', 'ચુકવણી તરફ'))}</button>`
      }`
  } else if (phase.id === 'indoor' && phase.indoorStep === 3) {
    const nextLabel =
      phases()[phaseIndex + 1]?.id === 'review'
        ? bi('Review', GU.review)
        : bi('Continue', GU.continue)
    buttons = `
      ${navBackButton()}
      <button type="button" class="btn btn-primary" data-action="next">${withIcon(iconArrowRight(), nextLabel)}</button>`
  } else {
    buttons = `
      ${navBackButton()}
      <button type="button" class="btn btn-primary" data-action="next">${withIcon(iconArrowRight(), bi('Continue', GU.continue))}</button>`
  }

  return `<footer class="panel-foot${extraClass}">${buttons}</footer>`
}

function render(): void {
  pruneDisabledSelections()
  setActiveEvent(pickIndoor ? 'indoor' : null)

  const phase = currentPhase()
  if (phase.id === 'done') lockReuseAfterPayment()
  else harvestSessionPeople()

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
    const footHtml = renderNavFooter()
    const existingFoot = panel.querySelector('.panel-foot')
    if (footHtml) {
      if (existingFoot) existingFoot.outerHTML = footHtml
      else panel.insertAdjacentHTML('beforeend', footHtml)
    } else {
      existingFoot?.remove()
    }
    if (stepChanged) panelBody.scrollTop = 0
    if (scrollY !== null) {
      window.scrollTo({
        top: scrollY,
        behavior: stepChanged ? 'smooth' : 'auto',
      })
    }
  } else {
    app.innerHTML = `
    <div class="shell${phase.id === 'begin' ? ' shell-gate' : ''}">
      ${mastheadHtml()}

      <main class="panel" data-group="${phase.id === 'begin' ? '' : phaseGroup(phase)}">
        ${phase.id !== 'begin' ? renderProgress() : ''}
        <div class="panel-body">
          ${body}
        </div>
        ${renderNavFooter()}
      </main>
    </div>
  `
  }

  paintedKey = key
  applyUiLang()
  mountDisclaimer()
  mountReusePopup()
  bindEvents()
  centerActiveStep()
  if (showDisclaimer) {
    app.querySelector<HTMLButtonElement>('[data-action="begin-form"]')?.focus()
  }

  if (phase.id === 'indoor' && phase.indoorStep >= 2) startLiveSlotUpdates()
  else stopLiveSlotUpdates()
  watchSeats()

  if (shouldRevealErrors) {
    shouldRevealErrors = false
    // Skip preserving scroll when we need to jump to the error
    revealFormErrors()
  }

  if (phase.id === 'done' && autoDownloadReceipt) {
    autoDownloadReceipt = false
    void waitForReceiptThenDownload()
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
    delete cricketErrors.photo
  } catch (error) {
    cricketEntry.photoUrl = ''
    cricketEntry.photoName = ''
    cricketErrors.photo =
      error instanceof Error
        ? error.message
        : biText('Could not use this photo.', 'આ ફોટો વાપરી શકાયો નહીં.')
  } finally {
    photoBusy = false
    render()
  }
}

async function applyPaymentShot(file: File): Promise<void> {
  if (!file.type.startsWith('image/')) {
    payError = biText('Upload a photo of the payment.', 'ચુકવણીનો ફોટો અપલોડ કરો.')
    paymentShot = ''
    paymentShotName = ''
    screenshotVerification = null
    verifyingScreenshot = false
    render()
    return
  }
  if (file.size > 20 * 1024 * 1024) {
    payError = biText('Screenshot must be under 20 MB.', 'સ્ક્રીનશૉટ 20 MBથી નાનો હોવો જોઈએ.')
    paymentShot = ''
    paymentShotName = ''
    screenshotVerification = null
    verifyingScreenshot = false
    render()
    return
  }

  paymentShotName = file.name
  payError = ''
  verifyingScreenshot = true
  screenshotVerification = null
  render()

  const currentSeq = ++screenshotVerifySeq
  try {
    const optimized = await optimizePhoto(file)
    if (currentSeq !== screenshotVerifySeq) return
    paymentShot = optimized.dataUrl
    render()

    const res = await verifyPaymentScreenshotApi(paymentShot, amountDue())
    if (currentSeq !== screenshotVerifySeq) return
    screenshotVerification = res
    verifyingScreenshot = false
    if (res.status === 'REJECT') {
      payError = res.reason
    } else {
      payError = ''
    }
  } catch (error) {
    if (currentSeq !== screenshotVerifySeq) return
    verifyingScreenshot = false
    screenshotVerification = {
      status: 'REJECT',
      reason: error instanceof Error ? error.message : 'Verification request failed',
    }
    payError = screenshotVerification.reason
  } finally {
    if (currentSeq === screenshotVerifySeq) {
      render()
    }
  }
}

function bindEvents(): void {
  app.querySelectorAll<HTMLDetailsElement>('details.fold').forEach((panel) => {
    if (panel.dataset.bound === '1') return
    panel.dataset.bound = '1'
    panel.addEventListener('toggle', () => {
      const key = panel.dataset.fold
      if (key) foldState.set(key, panel.open)
    })
  })

  app.querySelectorAll<HTMLSelectElement>('select[data-cash-collector]').forEach((select) => {
    select.addEventListener('change', () => {
      cashCollector = select.value
      payError = ''
    })
  })

  app.querySelectorAll<HTMLSelectElement>('select[data-cricket]').forEach((select) => {
    select.addEventListener('change', () => {
      if (select.dataset.field !== 'area') return
      cricketEntry.area = select.value
      if (select.value !== PLAYER_AREA_OTHER) cricketEntry.areaOther = ''
      delete cricketErrors.area
      delete cricketErrors.areaOther
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

  app.querySelectorAll<HTMLInputElement>('input[data-payment-shot]').forEach((input) => {
    input.addEventListener('change', () => {
      const file = input.files?.[0]
      if (!file) return
      void applyPaymentShot(file)
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
        rememberSessionPerson(players[doublesPlayer])
        harvestSessionPeople()
        syncAutoFillButtons()
        return
      }

      const cricketWhich = input.dataset.cricket
      const cricketFieldName = input.dataset.field as CricketField | undefined
      if (cricketWhich && cricketFieldName) {
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
          cricketFieldName === 'fullName' ||
          cricketFieldName === 'mobile' ||
          cricketFieldName === 'age' ||
          cricketFieldName === 'areaOther'
        ) {
          player[cricketFieldName] = nextValue
        }
        harvestSessionPeople()
        syncAutoFillButtons()
        if (cricketFieldName === 'mobile') {
          paintCricketMobileClash(input)
          return
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

      const key = input.name as 'fullName' | 'mobile' | 'age'
      if (key === 'fullName' || key === 'mobile' || key === 'age') {
        if (key === 'mobile') {
          const next = sanitizeMobileInput(input.value)
          if (input.value !== next) input.value = next
          state.mobile = next
        } else if (key === 'age') {
          const next = input.value.replace(/\D/g, '').slice(0, 3)
          if (input.value !== next) input.value = next
          state.age = next
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
    if (btn.dataset.bound === '1') return
    btn.dataset.bound = '1'
    // Keep focus on the button so input blur does not wipe the DOM before click (mobile).
    btn.addEventListener('pointerdown', (event) => {
      suppressBlurRenderUntil = Date.now() + 400
      event.preventDefault()
      if (btn.dataset.action === 'clear-section') event.stopPropagation()
    })

    btn.addEventListener('click', (event) => {
      const action = btn.dataset.action
      if (action === 'clear-section') {
        event.preventDefault()
        event.stopPropagation()
      }
      if (action === 'toggle-indoor') {
        if (!indoorOpen()) return
        pickIndoor = !pickIndoor
        beginError = ''
        render()
      } else if (action === 'toggle-cricket') {
        if (!cricketOpen()) return
        pickCricket = !pickCricket
        if (!pickCricket) {
          pickTurf = false
          pickOverarm = false
          cricketGender = null
        }
        beginError = ''
        render()
      } else if (action === 'cricket-kind' && (btn.dataset.kind === 'turf' || btn.dataset.kind === 'overarm')) {
        if (!isSportEnabled(btn.dataset.kind)) return
        if (btn.dataset.kind === 'overarm' && cricketGender === 'female') return
        if (btn.dataset.kind === 'turf') pickTurf = !pickTurf
        else pickOverarm = !pickOverarm
        cricketChoiceError = ''
        render()
      } else if (action === 'cricket-gender' && btn.dataset.gender) {
        cricketGender = btn.dataset.gender as Gender
        if (cricketGender === 'female') pickOverarm = false
        cricketGenderError = ''
        syncSoleCricketKind()
        render()
      } else if (action === 'skill' && btn.dataset.cricket && btn.dataset.skill) {
        const kind = btn.dataset.cricket
        const skill = btn.dataset.skill
        if (
          (kind === 'turf' || kind === 'overarm') &&
          (skill === 'batsman' || skill === 'bowler' || skill === 'allrounder')
        ) {
          cricketSkills[kind] = skill
          delete skillErrors[kind]
          render()
        }
      } else if (action === 'pay-mode' && (btn.dataset.mode === 'online' || btn.dataset.mode === 'cash')) {
        payMode = btn.dataset.mode
        payError = ''
        if (payMode === 'cash') {
          screenshotVerification = null
          verifyingScreenshot = false
        }
        render()
      } else if (action === 'copy-text' && btn.dataset.copy) {
        const copied = btn.dataset.copy
        const label = btn.querySelector('.pay-copy-label')
        void navigator.clipboard.writeText(copied).then(() => {
          if (!label) return
          const previous = label.textContent
          label.textContent = uiLang === 'gu' ? 'થઈ ગયું' : 'Copied'
          window.setTimeout(() => {
            if (label.isConnected) label.textContent = previous
          }, 1400)
        })
      } else if (action === 'download-receipt') {
        void downloadReceipt()
      } else if (action === 'share-receipt') {
        void shareReceipt()
      } else if (action === 'print') {
        window.print()
      } else if (
        (action === 'disclaimer-lang' || action === 'ui-lang') &&
        (btn.dataset.lang === 'en' || btn.dataset.lang === 'gu')
      ) {
        setUiLang(btn.dataset.lang)
        const sheet = app.querySelector<HTMLElement>('.disclaimer')
        if (sheet) sheet.dataset.lang = uiLang
        if (action === 'ui-lang') render()
      } else if (action === 'close-disclaimer') {
        showDisclaimer = false
        render()
      } else if (action === 'begin-form') {
        showDisclaimer = false
        advancePhase()
      } else if (action === 'next') goNext()
      else if (action === 'back') goBack()
      else if (action === 'submit' && !submitBusy) submit()
      else if (action === 'reset') withPageLoader(() => resetForm())
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
      } else if (action === 'fix-conflict') {
        gotoFixFirstConflict()
      } else if (action === 'fix-sport' && btn.dataset.sport) {
        gotoFixSport(btn.dataset.sport as SportId)
      } else if (action === 'remove-sport' && btn.dataset.sport) {
        removeIndoorSport(btn.dataset.sport as SportId)
      } else if (action === 'clear-section' && btn.dataset.sport) {
        clearFormatSection(btn.dataset.sport as SportId)
      } else if (
        action === 'clear-player' &&
        btn.dataset.sport &&
        (btn.dataset.player === 'player1' || btn.dataset.player === 'player2')
      ) {
        clearPlayerSlot(
          btn.dataset.sport as SportId,
          btn.dataset.player,
        )
      } else if (action === 'clear-cricket-name') {
        clearCricketNameSection()
      } else if (action === 'reuse-open' && btn.dataset.sport) {
        openReuseForSport(btn.dataset.sport as SportId)
      } else if (action === 'reuse-open' && btn.dataset.reuse === 'cricket') {
        openReuseForCricket()
      } else if (action === 'reuse-apply') {
        if (reuseSelected.size) applyReusePrompt()
      } else if (action === 'reuse-skip') {
        skipReusePrompt()
      } else if (action === 'reuse-toggle' && btn.dataset.index) {
        toggleReuseIndex(btn.dataset.index === '1' ? 1 : 0)
      } else if (action === 'fix-cricket') {
        gotoFixCricket()
      } else if (
        action === 'remove-cricket' &&
        (btn.dataset.kind === 'turf' || btn.dataset.kind === 'overarm')
      ) {
        removeCricketKind(btn.dataset.kind)
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
    refreshSportAvailability(),
  ])
  let seenAvailability = sportAvailabilityRevision()
  connectRealtime()
  onRealtimeUpdate(() => {
    const next = sportAvailabilityRevision()
    if (!isAdminRoute() && next !== seenAvailability) {
      seenAvailability = next
      pruneDisabledSelections()
      render()
      return
    }
    seenAvailability = next
    syncLiveSeats()
  })
  window.addEventListener('pageshow', (event) => {
    const nav = performance.getEntriesByType(
      'navigation',
    )[0] as PerformanceNavigationTiming | undefined
    if (!event.persisted && nav?.type !== 'reload') return
    reuseLocked = currentPhase().id === 'done'
    clearReusePeople()
    if (!reuseLocked) harvestSessionPeople()
    syncAutoFillButtons()
  })
  window.addEventListener('hashchange', () => {
    route()
  })
  route()
}

void boot()
