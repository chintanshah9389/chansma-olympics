import './style.css'
import {
  availableSlots,
  countSportRegistrations,
  countWaitingRegistrations,
  createId,
  describePlayerMobileConflict,
  describeSportConflict,
  getStorageError,
  normalizeMobile,
  refreshCapacities,
  refreshRegistrations,
  saveRegistration,
} from './storage'
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
  iconCheck,
  iconCopy,
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
  SelectedSport,
  SportId,
  WizardStep,
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

const emptyDoublesPlayer = (): DoublesPlayer => ({ fullName: '', mobile: '' })

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

let step: WizardStep = 1
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
let paintedStep: WizardStep | null = null
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

function playerLine(name?: string, mobile?: string): string {
  if (name && mobile) return `${name} · ${mobile}`
  if (name) return name
  if (mobile) return mobile
  return ''
}

function formatLabel(sport: SelectedSport): string {
  const waitTag = sport.status === 'waiting' ? ' · Waiting list' : ''
  const player = playerLine(sport.player1Name, sport.player1Mobile)

  if (sport.sportId === 'football') {
    return player ? `Team — ${player}${waitTag}` : `Team sport${waitTag}`
  }
  if (!needsFormat(sport.sportId)) {
    return player ? `Singles — ${player}${waitTag}` : `Singles only${waitTag}`
  }
  if (sport.format === 'double') {
    if (sport.player1Name && sport.player2Name) {
      const p1 = playerLine(sport.player1Name, sport.player1Mobile)
      const p2 = playerLine(sport.player2Name, sport.player2Mobile)
      return `Doubles — P1: ${p1} | P2: ${p2}${waitTag}`
    }
    return `Doubles${waitTag}`
  }
  if (player) return `Singles — ${player}${waitTag}`
  return `Singles${waitTag}`
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
    const player2Name =
      format === 'double' ? players?.player2.fullName.trim() : undefined
    const player2Mobile =
      format === 'double' && players
        ? normalizeMobile(players.player2.mobile)
        : undefined

    const status =
      state.gender && slotsFor(sportId) > 0 ? 'confirmed' : 'waiting'

    return {
      sportId,
      format,
      status,
      ...(player1Name ? { player1Name } : {}),
      ...(player1Mobile ? { player1Mobile } : {}),
      ...(player2Name ? { player2Name } : {}),
      ...(player2Mobile ? { player2Mobile } : {}),
    }
  })
}

function validateDetails(): boolean {
  detailErrors = {}
  const name = state.fullName.trim()

  // Step 1 is informational — mobile is collected but not validated here.
  if (!name) detailErrors.fullName = biText('Full name is required', GU.errFullName)

  return Object.keys(detailErrors).length === 0
}

function slotsFor(sportId: SportId): number {
  if (!state.gender) return 0
  return availableSlots(sportId, state.gender)
}

function slotBadgeHtml(sportId: SportId): string {
  if (!state.gender) {
    return `<span class="slot-live" data-slot-sport="${sportId}">—</span>`
  }
  const left = slotsFor(sportId)
  const used = countSportRegistrations(sportId, state.gender)
  const waiting = countWaitingRegistrations(sportId, state.gender)
  const total = sportCapacity(sportId, state.gender)
  const categoryEn = state.gender === 'male' ? 'Men' : 'Women'
  const categoryGu = state.gender === 'male' ? GU.men : GU.women
  if (left <= 0) {
    return `<span class="slot-live is-full" data-slot-sport="${sportId}"><span class="slot-pulse"></span>${iconLive()} ${biText(`${categoryEn}: Full · Waiting (${waiting} · ${used}/${total})`, `${categoryGu}: ${GU.fullWaiting} (${waiting} · ${used}/${total})`)}</span>`
  }
  const cls = left <= 3 ? 'is-low' : ''
  const waitNoteEn = waiting > 0 ? ` · ${waiting} waiting` : ''
  const waitNoteGu = waiting > 0 ? ` · ${waiting} વેઇટિંગ` : ''
  return `<span class="slot-live ${cls}" data-slot-sport="${sportId}"><span class="slot-pulse"></span>${iconLive()} ${biText(`${categoryEn}: ${left} left (${used}/${total})${waitNoteEn}`, `${categoryGu}: ${left} ${GU.left} (${used}/${total})${waitNoteGu}`)}</span>`
}

function updateLiveSlotBadges(): void {
  if (step !== 3 || !state.gender) return
  app.querySelectorAll<HTMLElement>('[data-slot-sport]').forEach((el) => {
    const id = el.dataset.slotSport as SportId
    if (!id) return
    const next = document.createElement('div')
    next.innerHTML = slotBadgeHtml(id)
    const badge = next.firstElementChild as HTMLElement | null
    if (!badge) return
    badge.classList.add('is-updating')
    el.replaceWith(badge)
    window.setTimeout(() => badge.classList.remove('is-updating'), 600)
  })
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
): Partial<DoublesPlayer> | undefined {
  const p1Name = players?.player1.fullName.trim() ?? ''
  const p1Mobile = normalizeMobile(players?.player1.mobile ?? '')
  const errors: Partial<DoublesPlayer> = {}

  if (!p1Name) errors.fullName = biText('Full name is required', GU.errFullName)
  if (!p1Mobile) errors.mobile = biText('Mobile number is required', GU.errMobileRequired)
  else if (p1Mobile.length < 10) {
    errors.mobile = biText('Enter a valid 10-digit mobile number', GU.errMobileValid)
  }

  return Object.keys(errors).length > 0 ? errors : undefined
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

    const p1Errors = validatePlayer1(players)
    if (p1Errors) errors.player1 = p1Errors

    const p1MobileCheck = normalizeMobile(players?.player1.mobile ?? '')
    if (p1MobileCheck.length >= 10) {
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
      const p2Mobile = normalizeMobile(players?.player2.mobile ?? '')

      if (!p2Name) {
        errors.player2 = { ...errors.player2, fullName: biText('Player 2 full name is required', GU.errPlayer2Name) }
      }
      if (!p2Mobile) {
        errors.player2 = {
          ...errors.player2,
          mobile: biText('Player 2 mobile number is required', GU.errPlayer2Mobile),
        }
      } else if (p2Mobile.length < 10) {
        errors.player2 = {
          ...errors.player2,
          mobile: biText('Enter a valid 10-digit mobile for Player 2', GU.errPlayer2MobileValid),
        }
      }

      if (
        p1Name &&
        p2Name &&
        p1Name.toLowerCase() === p2Name.toLowerCase()
      ) {
        errors.player2 = {
          ...errors.player2,
          fullName: biText('Player 2 name must be different from Player 1', GU.errNamesDifferent),
        }
      }

      if (p1Mobile && p2Mobile && p1Mobile === p2Mobile) {
        errors.player2 = {
          ...errors.player2,
          mobile: biText('Player 2 mobile must be different from Player 1', GU.errMobilesDifferent),
        }
      }

      if (p2Mobile.length >= 10 && !(p1Mobile && p1Mobile === p2Mobile)) {
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
      'Fix player details — full name and mobile are required, and a mobile may already be registered for this sport',
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

function goNext(): void {
  if (step === 1) {
    if (!validateDetails()) {
      shouldRevealErrors = true
      render()
      return
    }
    stepAnimDir = 'forward'
    step = 2
    render()
    return
  }

  if (step === 2) {
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
    stepAnimDir = 'forward'
    step = needing.length > 0 ? 3 : 4
    render()
    return
  }

  if (step === 3) {
    if (!validateFormats()) {
      shouldRevealErrors = true
      render()
      return
    }
    stepAnimDir = 'forward'
    step = 4
    render()
  }
}

function redirectToSubmitError(message: string): void {
  if (!state.gender) {
    stepAnimDir = 'back'
    step = 2
    sportError = message
    submitError = ''
    shouldRevealErrors = true
    render()
    return
  }

  const sports = buildSelectedSports()
  for (const s of sports) {
    const conflict = describeSportConflict(
      s,
      sportLabel(s.sportId),
      state.mobile,
    )
    if (!conflict) continue

    if (sportsNeedingPlayerDetails().includes(s.sportId)) {
      stepAnimDir = 'back'
      step = 3
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
      step = 4
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
  if (step === 2) step = 1
  else if (step === 3) step = 2
  else if (step === 4) step = sportsNeedingPlayerDetails().length > 0 ? 3 : 2

  stepAnimDir = 'back'
  sportError = ''
  formatError = ''
  doublesErrors = {}
  submitError = ''
  render()
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

async function submit(): Promise<void> {
  const check = canSubmit()
  if (!check.ok) {
    redirectToSubmitError(check.message)
    return
  }

  try {
    const reference = createId()
    const sports = buildSelectedSports()
    await saveRegistration({
      id: reference,
      fullName: state.fullName.trim(),
      mobile: normalizeMobile(state.mobile),
      location: state.location.trim(),
      gender: state.gender!,
      sports,
      createdAt: new Date().toISOString(),
    })
    lastReference = reference
    lastRegisteredSports = sports
    stepAnimDir = 'forward'
    step = 5
    render()
  } catch (error) {
    submitError =
      error instanceof Error
        ? error.message.includes(' / ')
          ? error.message
          : biText(error.message, GU.errSaveFailed)
        : biText(
            'Could not save registration. Check API / database connection.',
            GU.errSaveFailed,
          )
    shouldRevealErrors = true
    render()
  }
}

function resetForm(): void {
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
  stepAnimDir = 'forward'
  step = 1
  render()
}

function stepHasErrors(): boolean {
  if (step === 1) return Boolean(detailErrors.fullName || detailErrors.mobile)
  if (step === 2) return Boolean(sportError)
  if (step === 3) {
    return Boolean(formatError) || Object.keys(doublesErrors).length > 0
  }
  if (step === 4) return Boolean(submitError)
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

function progressIndex(): number {
  if (step === 5) return 4
  if (step === 4) return 3
  if (step === 3) return 2
  return step - 1
}

function renderProgress(): string {
  const active = progressIndex()
  const showError = stepHasErrors()
  return `
    <ol class="progress-track">
      ${STEP_LABELS.map((label, i) => {
        const stateClass =
          i < active ? 'is-done' : i === active ? 'is-active' : 'is-todo'
        const errorClass = i === active && showError ? ' has-error' : ''
        return `
        <li class="progress-item ${stateClass}${errorClass}">
          <div class="progress-item-top">
            <span class="progress-dot" aria-hidden="true">${i < active ? '✓' : i + 1}</span>
            ${i < STEP_LABELS.length - 1 ? '<span class="progress-line" aria-hidden="true"><span></span></span>' : ''}
          </div>
          <span class="progress-label">${bi(label.en, label.gu)}</span>
        </li>
      `
      }).join('')}
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
  const slots = genderSelected ? slotsFor(id) : null
  const waiting =
    genderSelected && state.gender
      ? countWaitingRegistrations(id, state.gender)
      : 0
  let meta = genderSelected
    ? slots !== null && slots > 0
      ? biText(
          `${slots} ${state.gender === 'male' ? 'men' : 'women'} slot${slots === 1 ? '' : 's'} left`,
          `${slots} ${state.gender === 'male' ? GU.men : GU.women} ${GU.slotsLeft}`,
        )
      : biText(
          `Full — join waiting${waiting ? ` (${waiting})` : ''}`,
          `${GU.joinWaiting}${waiting ? ` (${waiting})` : ''}`,
        )
    : biText('Select gender first', GU.selectGenderFirst)
  let metaClass = 'choice-meta'

  if (genderSelected && slots !== null && slots <= 0) {
    metaClass = 'choice-meta warn'
  }

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
      <span class="${metaClass}">${meta}</span>
    </button>
  `
}

function renderStep1(): string {
  const apiError = getStorageError()
  return `
    <div class="fade-step">
      <h2 class="step-title"><span class="step-title-icon">${iconUser()}</span> ${bi('Enter your details', GU.detailsTitle)}</h2>
      <p class="step-sub">${bi('Basic information only — mobile is not validated on this step.', GU.detailsSub)}</p>

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
            value="${escapeAttr(state.mobile)}" placeholder="${escapeAttr(biText('Mobile number', GU.placeholderMobile))}" maxlength="15" />
        </div>
        ${detailErrors.mobile ? `<span class="error">${bilingualHtml(detailErrors.mobile)}</span>` : ''}
      </div>

      <div class="actions">
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
              placeholder="${escapeAttr(biText('Mobile number', GU.placeholderMobile))}" maxlength="15" required />
            ${errors.player1?.mobile ? `<span class="error">${bilingualHtml(errors.player1.mobile)}</span>` : ''}
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
              placeholder="${escapeAttr(biText('Player 2 mobile number', 'ખેલાડી ૨ મોબાઇલ નંબર'))}" maxlength="15" />
            ${errors.player2?.mobile ? `<span class="error">${bilingualHtml(errors.player2.mobile)}</span>` : ''}
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
        ${bi('Full name and mobile are required for each sport.', GU.formatSub)}
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
              ? `<p class="step-sub" style="margin:0 0 0.85rem">${bi(`Enter the player full name and mobile for ${sportLabel(id)}.`, GU.playerOnlyHint(sportBiText(id)))}</p>`
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
        <button type="button" class="btn btn-primary" data-action="next">${withIcon(iconArrowRight(), bi('Review', GU.review))}</button>
      </div>
    </div>
  `
}

function reviewBadge(sport: SelectedSport): string {
  const existing = describeSportConflict(
    sport,
    sportLabel(sport.sportId),
    state.mobile,
  )
  if (existing) {
    return `<span class="badge badge-warn">${bi('Already registered', GU.alreadyRegistered)}</span>`
  }
  if (sport.status === 'waiting') {
    return `<span class="badge badge-full">${bi('Waiting list', GU.waitingList)}</span>`
  }
  const slots = slotsFor(sport.sportId)
  return `<span class="badge badge-ok">${bi(`${slots} available · Confirmed`, GU.availableConfirmed(slots))}</span>`
}

function renderStep4(): string {
  const sports = buildSelectedSports()
  const check = canSubmit()
  const category = state.gender ? genderLabel(state.gender) : '—'
  const hasWaiting = sports.some((s) => s.status === 'waiting')

  return `
    <div class="fade-step review-step">
      <h2 class="step-title">${bi('Review & submit', GU.reviewTitle)}</h2>
      <p class="step-sub">${bi('Confirm your details and sports. Full sports go on the waiting list.', GU.reviewSub)}</p>

      <div class="summary-box">
        <p><strong>${escapeHtml(state.fullName.trim())}</strong></p>
        <p>${escapeHtml(normalizeMobile(state.mobile))}</p>
        <p style="margin-top:0.55rem;opacity:0.85">${bi(`${category} tournament`, `${category === 'Male' ? GU.male : category === 'Female' ? GU.female : category} ${GU.tournament}`)}</p>
      </div>

      ${hasWaiting ? `<div class="alert" style="background:#fff8e6;border-color:rgba(212,160,23,0.35);color:#8a6a00">${bi('Some sports are full — you will be added to the waiting list for those.', GU.waitingAlert)}</div>` : ''}
      ${submitError || !check.ok ? `<div class="alert is-error">${bilingualHtml(submitError || check.message)}</div>` : ''}

      <div class="review-list">
        ${sports
          .map((s) => {
            const existing = describeSportConflict(
              s,
              sportLabel(s.sportId),
              state.mobile,
            )
            const blocked = !!existing
            const formatText = formatLabel(s)
            return `
              <div class="review-item ${blocked ? 'blocked is-error' : ''} ${s.status === 'waiting' && !blocked ? 'is-waiting' : ''}">
                <div class="review-sport">
                  <span class="review-sport-icon">${sportIcon(s.sportId)}</span>
                  <div>
                    <h4>${sportBi(s.sportId)}</h4>
                    <p class="meta">${escapeHtml(formatText)}</p>
                    ${
                      existing
                        ? `<p class="existing-detail">${bilingualHtml(existing)}</p>`
                        : s.status === 'waiting'
                          ? `<p class="existing-detail" style="color:#8a6a00">${bi('No open slots — registered as waiting for this sport.', GU.waitingDetail)}</p>`
                          : ''
                    }
                  </div>
                </div>
                ${reviewBadge(s)}
              </div>
            `
          })
          .join('')}
      </div>

      <div class="actions">
        <button type="button" class="btn btn-ghost" data-action="back">${withIcon(iconArrowLeft(), bi('Back', GU.back))}</button>
        <button type="button" class="btn btn-gold" data-action="submit" ${!check.ok ? 'disabled' : ''}>
          ${withIcon(iconCheck(), bi('Submit Registration', GU.submit))}
        </button>
      </div>
    </div>
  `
}

function renderStep5(): string {
  const sports = lastRegisteredSports.length
    ? lastRegisteredSports
    : buildSelectedSports()
  const category = state.gender ? genderLabel(state.gender) : ''
  return `
    <div class="fade-step success-screen">
      <div class="success-burst" aria-hidden="true"></div>
      <div class="success-icon">${iconCheck()}</div>
      <h2>${bi("You're registered!", GU.successTitle)}</h2>
      <p>${bi(`Registration saved for ${escapeHtml(state.fullName.trim())}${category ? ` (${escapeHtml(category)})` : ''}.`, `${escapeHtml(state.fullName.trim())}${category ? ` (${category === 'Male' ? GU.male : GU.female})` : ''} ${GU.successSaved}.`)}</p>

      <div class="reference-box" role="status">
        <span class="reference-label">${iconSpark()} ${bi('Your reference number', GU.referenceLabel)}</span>
        <strong class="reference-code" id="registration-reference">${escapeHtml(lastReference)}</strong>
        <p class="reference-hint">${bi('Save this number — use it if you contact the organizers about your registration.', GU.referenceHint)}</p>
        <button type="button" class="btn btn-ghost reference-copy" data-action="copy-ref">
          ${withIcon(iconCopy(), bi('Copy reference', GU.copyReference))}
        </button>
      </div>

      <div class="review-list" style="text-align:left;margin-bottom:1.25rem">
        ${sports
          .map((s) => {
            const formatText = formatLabel(s)
            const badge =
              s.status === 'waiting'
                ? `<span class="badge badge-full">${bi('Waiting', GU.waiting)}</span>`
                : `<span class="badge badge-ok">${bi('Confirmed', GU.confirmed)}</span>`
            return `
              <div class="review-item">
                <div class="review-sport">
                  <span class="review-sport-icon">${sportIcon(s.sportId)}</span>
                  <div>
                    <h4>${sportBi(s.sportId)}</h4>
                    <p class="meta">${escapeHtml(formatText)}</p>
                  </div>
                </div>
                ${badge}
              </div>
            `
          })
          .join('')}
      </div>
      <button type="button" class="btn btn-primary" data-action="reset" style="margin:0 auto;display:inline-flex">
        ${withIcon(iconSpark(), bi('Register another player', GU.registerAnother))}
      </button>
    </div>
  `
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

function render(): void {
  const shell = app.querySelector<HTMLElement>('.shell:not(.shell-admin)')
  const panel = shell?.querySelector<HTMLElement>('.panel')
  const panelBody = panel?.querySelector<HTMLElement>('.panel-body')
  const canPatch = Boolean(shell && panel && panelBody)
  const stepChanged = !canPatch || paintedStep !== step

  let body =
    step === 1
      ? renderStep1()
      : step === 2
        ? renderStep2()
        : step === 3
          ? renderStep3()
          : step === 4
            ? renderStep4()
            : renderStep5()

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
    const scrollY = shouldRevealErrors
      ? null
      : stepChanged
        ? 0
        : window.scrollY
    const progress = panel.querySelector('.progress-track')
    if (step === 5) {
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

    <div class="shell">
      <header class="brand">
        <div class="brand-mark">
          <div class="brand-ring" aria-hidden="true"></div>
        </div>
        <h1>CHANSMA OLYMPIC</h1>
        <p>${bi('Tournament Registration', GU.brandSub)}</p>
      </header>

      <main class="panel">
        ${step !== 5 ? renderProgress() : ''}
        <div class="panel-body">
          ${body}
        </div>
      </main>
    </div>
  `
  }

  paintedStep = step
  bindEvents()

  if (step === 3) startLiveSlotUpdates()
  else stopLiveSlotUpdates()

  if (shouldRevealErrors) {
    shouldRevealErrors = false
    // Skip preserving scroll when we need to jump to the error
    revealFormErrors()
  }
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

  if (!normalized || normalized.length < 10) return

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

function bindEvents(): void {
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
        players[doublesPlayer][doublesField] = input.value
        if (doublesErrors[doublesSport]?.[doublesPlayer]?.[doublesField]) {
          delete doublesErrors[doublesSport]![doublesPlayer]![doublesField]
          const field = input.closest('.field')
          field?.classList.remove('is-invalid')
          input.classList.remove('is-invalid')
          field?.querySelector('.error')?.remove()
        }
        return
      }

      const key = input.name as 'fullName' | 'mobile'
      if (key === 'fullName' || key === 'mobile') {
        state[key] = input.value
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
      if (action === 'next') goNext()
      else if (action === 'back') goBack()
      else if (action === 'submit') submit()
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
  await Promise.all([refreshRegistrations(), refreshCapacities()])
  connectRealtime()
  onRealtimeUpdate(() => {
    if (isAdminRoute()) return
    updateLiveSlotBadges()
  })
  window.addEventListener('hashchange', () => {
    route()
  })
  route()
}

void boot()
