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
  refreshRegistrations,
  saveRegistration,
} from './storage'
import {
  PRIMARY_SPORTS,
  SECONDARY_SPORTS,
  genderLabel,
  needsFormat,
  sportCapacity,
  sportLabel,
} from './sports'
import {
  connectRealtime,
  onRealtimeUpdate,
} from './realtime'
import { destroyAdmin, isAdminRoute, renderAdmin } from './admin'
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

const STEP_LABELS = ['Details', 'Sports', 'Format', 'Review'] as const

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
let detailErrors: Partial<Record<'fullName' | 'mobile' | 'location', string>> =
  {}
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

const app = document.querySelector<HTMLDivElement>('#app')!

function selectedSportsList(): SportId[] {
  const list: SportId[] = []
  if (state.primarySport) list.push(state.primarySport)
  for (const id of state.secondarySports) {
    if (!list.includes(id)) list.push(id)
  }
  return list
}

function sportsNeedingFormat(): SportId[] {
  return selectedSportsList().filter(needsFormat)
}

function formatLabel(sport: SelectedSport): string {
  const waitTag = sport.status === 'waiting' ? ' · Waiting list' : ''
  if (sport.sportId === 'football') return `Team sport${waitTag}`
  if (!needsFormat(sport.sportId)) return `Singles only${waitTag}`
  if (sport.format === 'double') {
    if (sport.player1Name && sport.player2Name) {
      const p1 = sport.player1Mobile
        ? `${sport.player1Name} · ${sport.player1Mobile}`
        : sport.player1Name
      const p2 = sport.player2Mobile
        ? `${sport.player2Name} · ${sport.player2Mobile}`
        : sport.player2Name
      return `Doubles — P1: ${p1} | P2: ${p2}${waitTag}`
    }
    return `Doubles${waitTag}`
  }
  if (sport.player1Name) {
    const base = sport.player1Mobile
      ? `Singles — ${sport.player1Name} · ${sport.player1Mobile}`
      : `Singles — ${sport.player1Name}`
    return `${base}${waitTag}`
  }
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
    const players = needsFormat(sportId)
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
  const location = state.location.trim()

  // Step 1 is informational — mobile is collected but not validated here.
  if (!name) detailErrors.fullName = 'Full name is required'
  if (!location) detailErrors.location = 'Location is required'

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
  const category = state.gender === 'male' ? 'Men' : 'Women'
  if (left <= 0) {
    return `<span class="slot-live is-full" data-slot-sport="${sportId}">${category}: Full · Waiting list (${waiting} waiting · ${used}/${total})</span>`
  }
  const cls = left <= 3 ? 'is-low' : ''
  const waitNote = waiting > 0 ? ` · ${waiting} waiting` : ''
  return `<span class="slot-live ${cls}" data-slot-sport="${sportId}">${category}: ${left} slot${left === 1 ? '' : 's'} left (${used}/${total})${waitNote}</span>`
}

function updateLiveSlotBadges(): void {
  if (step !== 3 || !state.gender) return
  app.querySelectorAll<HTMLElement>('[data-slot-sport]').forEach((el) => {
    const id = el.dataset.slotSport as SportId
    if (!id) return
    const left = slotsFor(id)
    const used = countSportRegistrations(id, state.gender!)
    const waiting = countWaitingRegistrations(id, state.gender!)
    const total = sportCapacity(id, state.gender!)
    const category = state.gender === 'male' ? 'Men' : 'Women'
    el.classList.toggle('is-full', left <= 0)
    el.classList.toggle('is-low', left > 0 && left <= 3)
    el.textContent =
      left <= 0
        ? `${category}: Full · Waiting list (${waiting} waiting · ${used}/${total})`
        : `${category}: ${left} slot${left === 1 ? '' : 's'} left (${used}/${total})${waiting > 0 ? ` · ${waiting} waiting` : ''}`
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
    sportError = 'Select Male or Female first'
    return false
  }
  if (!state.primarySport) {
    sportError =
      state.gender === 'female'
        ? 'Choose Pickleball as the main sport'
        : 'Choose Football or Pickleball'
    return false
  }
  if (state.secondarySports.length > 2) {
    sportError = 'You can choose a maximum of 2 additional sports'
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

  if (!p1Name) errors.fullName = 'Player 1 full name is required'
  if (!p1Mobile) errors.mobile = 'Player 1 mobile number is required'
  else if (p1Mobile.length < 10) {
    errors.mobile = 'Enter a valid 10-digit mobile for Player 1'
  }

  return Object.keys(errors).length > 0 ? errors : undefined
}

function validateFormats(): boolean {
  formatError = ''
  doublesErrors = {}

  for (const id of sportsNeedingFormat()) {
    if (!state.formats[id]) {
      formatError = 'Select Single or Double for each racket sport'
      return false
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
        state.gender,
      )
      if (conflict) {
        errors.player1 = { ...errors.player1, mobile: conflict }
      }
    }

    if (state.formats[id] === 'double') {
      const p1Name = players?.player1.fullName.trim() ?? ''
      const p1Mobile = normalizeMobile(players?.player1.mobile ?? '')
      const p2Name = players?.player2.fullName.trim() ?? ''
      const p2Mobile = normalizeMobile(players?.player2.mobile ?? '')

      if (!p2Name) {
        errors.player2 = { ...errors.player2, fullName: 'Player 2 full name is required' }
      }
      if (!p2Mobile) {
        errors.player2 = {
          ...errors.player2,
          mobile: 'Player 2 mobile number is required',
        }
      } else if (p2Mobile.length < 10) {
        errors.player2 = {
          ...errors.player2,
          mobile: 'Enter a valid 10-digit mobile for Player 2',
        }
      }

      if (
        p1Name &&
        p2Name &&
        p1Name.toLowerCase() === p2Name.toLowerCase()
      ) {
        errors.player2 = {
          ...errors.player2,
          fullName: 'Player 2 name must be different from Player 1',
        }
      }

      if (p1Mobile && p2Mobile && p1Mobile === p2Mobile) {
        errors.player2 = {
          ...errors.player2,
          mobile: 'Player 2 mobile must be different from Player 1',
        }
      }

      if (p2Mobile.length >= 10 && !(p1Mobile && p1Mobile === p2Mobile)) {
        const conflict = describePlayerMobileConflict(
          p2Mobile,
          id,
          sportLabel(id),
          state.gender,
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

  if (Object.keys(doublesErrors).length > 0) {
    formatError =
      'Fix player details — a mobile may already be registered for this sport'
    return false
  }

  return true
}

function canSubmit(): { ok: boolean; message: string } {
  if (!state.gender) {
    return { ok: false, message: 'Select Male or Female before submitting.' }
  }
  const sports = buildSelectedSports()
  for (const s of sports) {
    const existing = describeSportConflict(
      s,
      sportLabel(s.sportId),
      state.gender,
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
      render()
      return
    }
    step = 2
    render()
    return
  }

  if (step === 2) {
    if (!validateSports()) {
      render()
      return
    }
    const needing = sportsNeedingFormat()
    for (const id of Object.keys(state.formats) as SportId[]) {
      if (!needing.includes(id)) {
        delete state.formats[id]
        delete state.doublesPlayers[id]
      }
    }
    step = needing.length > 0 ? 3 : 4
    render()
    return
  }

  if (step === 3) {
    if (!validateFormats()) {
      render()
      return
    }
    step = 4
    render()
  }
}

function goBack(): void {
  if (step === 2) step = 1
  else if (step === 3) step = 2
  else if (step === 4) step = sportsNeedingFormat().length > 0 ? 3 : 2

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
    sportError = 'Select Male or Female first'
    render()
    return
  }
  if (state.gender === 'female' && id === 'football') {
    sportError = 'Football is not available for Female'
    render()
    return
  }
  state.primarySport = id
  sportError = ''
  render()
}

function toggleSecondary(id: SportId): void {
  if (!state.gender) {
    sportError = 'Select Male or Female first'
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
    submitError = check.message
    render()
    return
  }

  try {
    await saveRegistration({
      id: createId(),
      fullName: state.fullName.trim(),
      mobile: normalizeMobile(state.mobile),
      location: state.location.trim(),
      gender: state.gender!,
      sports: buildSelectedSports(),
      createdAt: new Date().toISOString(),
    })
    step = 5
    render()
  } catch (error) {
    submitError =
      error instanceof Error
        ? error.message
        : 'Could not save registration. Check API / database connection.'
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
  step = 1
  render()
}

function progressIndex(): number {
  if (step === 5) return 4
  if (step === 4) return 3
  if (step === 3) return 2
  return step - 1
}

function renderProgress(): string {
  const active = progressIndex()
  return `
    <div class="progress" aria-hidden="true">
      ${STEP_LABELS.map((_, i) => `
        <div class="progress-step ${i < active ? 'is-done' : ''} ${i === active ? 'is-active' : ''}">
          <span></span>
        </div>
      `).join('')}
    </div>
    <div class="progress-labels">
      ${STEP_LABELS.map((label, i) => `
        <span class="${i === active ? 'is-active' : ''}">${label}</span>
      `).join('')}
    </div>
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
      ? `${slots} ${state.gender === 'male' ? 'men' : 'women'} slot${slots === 1 ? '' : 's'} left`
      : `Full — join waiting${waiting ? ` (${waiting})` : ''}`
    : 'Select gender first'
  let metaClass = 'choice-meta'

  if (genderSelected && slots !== null && slots <= 0) {
    metaClass = 'choice-meta warn'
  }

  return `
    <button
      type="button"
      class="choice ${selected ? 'is-selected' : ''}"
      ${disabled || !genderSelected ? 'disabled' : ''}
      data-action="${actionAttr}"
      data-sport="${id}"
    >
      <span class="choice-check" aria-hidden="true"></span>
      <span class="choice-title">${sportLabel(id)}</span>
      <span class="${metaClass}">${meta}</span>
    </button>
  `
}

function renderStep1(): string {
  const apiError = getStorageError()
  return `
    <div class="fade-step">
      <h2 class="step-title">Enter your details</h2>
      <p class="step-sub">Basic information only — mobile is not validated on this step.</p>

      ${apiError ? `<div class="alert">Database/API: ${escapeHtml(apiError)}. Start the API with DATABASE_URL set.</div>` : ''}

      <div class="field">
        <label for="fullName">Full Name</label>
        <input id="fullName" name="fullName" type="text" autocomplete="name"
          value="${escapeAttr(state.fullName)}" placeholder="e.g. Rahul Sharma" />
        ${detailErrors.fullName ? `<span class="error">${detailErrors.fullName}</span>` : ''}
      </div>

      <div class="field">
        <label for="mobile">Mobile Number</label>
        <input id="mobile" name="mobile" type="tel" inputmode="numeric" autocomplete="tel"
          value="${escapeAttr(state.mobile)}" placeholder="Mobile number" maxlength="15" />
      </div>

      <div class="field">
        <label for="location">Location</label>
        <input id="location" name="location" type="text" autocomplete="address-level2"
          value="${escapeAttr(state.location)}" placeholder="City / Area" />
        ${detailErrors.location ? `<span class="error">${detailErrors.location}</span>` : ''}
      </div>

      <div class="actions">
        <button type="button" class="btn btn-primary" data-action="next">Continue</button>
      </div>
    </div>
  `
}

function renderStep2(): string {
  return `
    <div class="fade-step">
      <h2 class="step-title">Select sports</h2>
      <p class="step-sub">Choose Male or Female first — men’s and women’s tournaments have separate slot counts.</p>

      ${sportError ? `<div class="alert">${sportError}</div>` : ''}

      <div class="section-label">Gender — choose one</div>
      <p class="section-hint">Men’s and Women’s tournaments are counted separately</p>
      <div class="choice-grid">
        <button type="button"
          class="choice ${state.gender === 'male' ? 'is-selected' : ''}"
          data-action="gender" data-gender="male">
          <span class="choice-check" aria-hidden="true"></span>
          <span class="choice-title">Male</span>
          <span class="choice-meta">Men’s tournament</span>
        </button>
        <button type="button"
          class="choice ${state.gender === 'female' ? 'is-selected' : ''}"
          data-action="gender" data-gender="female">
          <span class="choice-check" aria-hidden="true"></span>
          <span class="choice-title">Female</span>
          <span class="choice-meta">Women’s tournament</span>
        </button>
      </div>

      <div class="section-label">Main sport — choose one</div>
      <p class="section-hint">
        ${
          state.gender === 'female'
            ? 'Pickleball (Football is Male only)'
            : 'Football or Pickleball'
        }
      </p>
      <div class="choice-grid">
        ${primarySportsForGender()
          .map((id) =>
            renderChoice(id, state.primarySport === id, false, 'primary'),
          )
          .join('')}
      </div>

      <div class="section-label">Additional sports — optional (max 2)</div>
      <p class="section-hint">Carrom, Chess, Table Tennis, Badminton — skip or pick up to 2</p>
      <div class="choice-grid cols-3">
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
        <button type="button" class="btn btn-ghost" data-action="back">Back</button>
        <button type="button" class="btn btn-primary" data-action="next">Continue</button>
      </div>
    </div>
  `
}

function renderStep3(): string {
  const needing = sportsNeedingFormat()
  const category = state.gender ? genderLabel(state.gender) : ''
  return `
    <div class="fade-step">
      <h2 class="step-title">Singles or Doubles</h2>
      <p class="step-sub">
        Choose Single or Doubles for each sport below.
        ${category ? `Live ${escapeHtml(category)} slot counts update instantly over WebSocket.` : ''}
      </p>

      ${formatError ? `<div class="alert">${formatError}</div>` : ''}

      ${needing
        .map((id) => {
          const format = state.formats[id]
          const isSingle = format === 'single'
          const isDouble = format === 'double'
          const showPlayers = isSingle || isDouble
          const players = state.doublesPlayers[id] ?? {
            player1: emptyDoublesPlayer(),
            player2: emptyDoublesPlayer(),
          }
          const errors = doublesErrors[id] ?? {}
          return `
        <div class="format-card ${isSingle ? 'is-single-mode' : ''}">
          <div class="format-card-header">
            <h3>${sportLabel(id)}</h3>
            ${slotBadgeHtml(id)}
          </div>
          <div class="format-options">
            <button type="button"
              class="choice ${isSingle ? 'is-selected' : ''}"
              data-action="format" data-sport="${id}" data-format="single">
              <span class="choice-check" aria-hidden="true"></span>
              <span class="choice-title">Single</span>
              <span class="choice-meta">Organizer assigns partner</span>
            </button>
            <button type="button"
              class="choice ${isDouble ? 'is-selected' : ''}"
              data-action="format" data-sport="${id}" data-format="double">
              <span class="choice-check" aria-hidden="true"></span>
              <span class="choice-title">Double</span>
              <span class="choice-meta">Choose your partner</span>
            </button>
          </div>
          ${
            showPlayers
              ? `
            <div class="partner-field">
              <div class="player-block">
                <p class="section-label" style="margin:0 0 0.55rem">Player 1</p>
                <div class="player-row">
                  <div class="field">
                    <label for="player1-name-${id}">Full Name</label>
                    <input id="player1-name-${id}" type="text"
                      data-doubles-sport="${id}" data-doubles-player="player1" data-doubles-field="fullName"
                      value="${escapeAttr(players.player1.fullName)}"
                      placeholder="Player 1 full name" />
                    ${errors.player1?.fullName ? `<span class="error">${errors.player1.fullName}</span>` : ''}
                  </div>
                  <div class="field">
                    <label for="player1-mobile-${id}">Mobile Number</label>
                    <input id="player1-mobile-${id}" type="tel" inputmode="numeric"
                      data-doubles-sport="${id}" data-doubles-player="player1" data-doubles-field="mobile"
                      value="${escapeAttr(players.player1.mobile)}"
                      placeholder="Player 1 mobile number" maxlength="15" />
                    ${errors.player1?.mobile ? `<span class="error">${errors.player1.mobile}</span>` : ''}
                  </div>
                </div>
              </div>

              ${
                isSingle
                  ? `
              <div class="organizer-notice" role="status">
                <strong>Second player</strong>
                <p>
                  We will provide you a second player. Please wait for our response.
                  You cannot choose which player you get — you must play with the partner
                  the organizer assigns for ${sportLabel(id)}.
                </p>
              </div>
              `
                  : ''
              }

              ${
                isDouble
                  ? `
              <div class="player-block">
                <p class="section-label" style="margin:0 0 0.55rem">Player 2</p>
                <div class="player-row">
                  <div class="field">
                    <label for="player2-name-${id}">Full Name</label>
                    <input id="player2-name-${id}" type="text"
                      data-doubles-sport="${id}" data-doubles-player="player2" data-doubles-field="fullName"
                      value="${escapeAttr(players.player2.fullName)}"
                      placeholder="Player 2 full name" />
                    ${errors.player2?.fullName ? `<span class="error">${errors.player2.fullName}</span>` : ''}
                  </div>
                  <div class="field">
                    <label for="player2-mobile-${id}">Mobile Number</label>
                    <input id="player2-mobile-${id}" type="tel" inputmode="numeric"
                      data-doubles-sport="${id}" data-doubles-player="player2" data-doubles-field="mobile"
                      value="${escapeAttr(players.player2.mobile)}"
                      placeholder="Player 2 mobile number" maxlength="15" />
                    ${errors.player2?.mobile ? `<span class="error">${errors.player2.mobile}</span>` : ''}
                  </div>
                </div>
              </div>
              `
                  : ''
              }
            </div>
          `
              : ''
          }
        </div>
      `
        })
        .join('')}

      <div class="actions">
        <button type="button" class="btn btn-ghost" data-action="back">Back</button>
        <button type="button" class="btn btn-primary" data-action="next">Review</button>
      </div>
    </div>
  `
}

function reviewBadge(sport: SelectedSport): string {
  const existing = describeSportConflict(
    sport,
    sportLabel(sport.sportId),
    state.gender,
    state.mobile,
  )
  if (existing) {
    return `<span class="badge badge-warn">Already registered</span>`
  }
  if (sport.status === 'waiting') {
    return `<span class="badge badge-full">Waiting list</span>`
  }
  const slots = slotsFor(sport.sportId)
  return `<span class="badge badge-ok">${slots} available · Confirmed</span>`
}

function renderStep4(): string {
  const sports = buildSelectedSports()
  const check = canSubmit()
  const category = state.gender ? genderLabel(state.gender) : '—'
  const hasWaiting = sports.some((s) => s.status === 'waiting')

  return `
    <div class="fade-step">
      <h2 class="step-title">Review & submit</h2>
      <p class="step-sub">Confirm your details and sports. Full sports go on the waiting list.</p>

      <div class="summary-box">
        <p><strong>${escapeHtml(state.fullName.trim())}</strong></p>
        <p>${escapeHtml(normalizeMobile(state.mobile))} · ${escapeHtml(state.location.trim())}</p>
        <p style="margin-top:0.55rem;opacity:0.85">${escapeHtml(category)} tournament</p>
      </div>

      ${hasWaiting ? `<div class="alert" style="background:#fff8e6;border-color:rgba(212,160,23,0.35);color:#8a6a00">Some sports are full — you will be added to the waiting list for those.</div>` : ''}
      ${submitError || !check.ok ? `<div class="alert">${submitError || check.message}</div>` : ''}

      <div class="review-list">
        ${sports
          .map((s) => {
            const existing = describeSportConflict(
              s,
              sportLabel(s.sportId),
              state.gender,
              state.mobile,
            )
            const blocked = !!existing
            const formatText = formatLabel(s)
            return `
              <div class="review-item ${blocked ? 'blocked' : ''} ${s.status === 'waiting' && !blocked ? 'is-waiting' : ''}">
                <div>
                  <h4>${sportLabel(s.sportId)}</h4>
                  <p class="meta">${escapeHtml(formatText)}</p>
                  ${
                    existing
                      ? `<p class="existing-detail">${escapeHtml(existing)}</p>`
                      : s.status === 'waiting'
                        ? `<p class="existing-detail" style="color:#8a6a00">No open slots — registered as waiting for this sport.</p>`
                        : ''
                  }
                </div>
                ${reviewBadge(s)}
              </div>
            `
          })
          .join('')}
      </div>

      <div class="actions">
        <button type="button" class="btn btn-ghost" data-action="back">Back</button>
        <button type="button" class="btn btn-gold" data-action="submit" ${!check.ok ? 'disabled' : ''}>
          Submit Registration
        </button>
      </div>
    </div>
  `
}

function renderStep5(): string {
  const sports = buildSelectedSports()
  const category = state.gender ? genderLabel(state.gender) : ''
  return `
    <div class="fade-step success-screen">
      <div class="success-icon">✓</div>
      <h2>You're in!</h2>
      <p>Registration saved for ${escapeHtml(state.fullName.trim())}${category ? ` (${escapeHtml(category)})` : ''}.</p>
      <div class="review-list" style="text-align:left;margin-bottom:1.25rem">
        ${sports
          .map((s) => {
            const formatText = formatLabel(s)
            const badge =
              s.status === 'waiting'
                ? `<span class="badge badge-full">Waiting</span>`
                : `<span class="badge badge-ok">Confirmed</span>`
            return `
              <div class="review-item">
                <div>
                  <h4>${sportLabel(s.sportId)}</h4>
                  <p class="meta">${escapeHtml(formatText)}</p>
                </div>
                ${badge}
              </div>
            `
          })
          .join('')}
      </div>
      <button type="button" class="btn btn-primary" data-action="reset" style="margin:0 auto;display:inline-flex">
        Register another player
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
  const body =
    step === 1
      ? renderStep1()
      : step === 2
        ? renderStep2()
        : step === 3
          ? renderStep3()
          : step === 4
            ? renderStep4()
            : renderStep5()

  app.innerHTML = `
    <a class="nav-corner nav-corner-left" href="#/admin">Admin</a>

    <div class="shell">
      <header class="brand">
        <div class="brand-mark">
          <div class="brand-ring" aria-hidden="true"></div>
        </div>
        <h1>CHANSMA OLYMPIC</h1>
        <p>Tournament Registration</p>
      </header>

      <main class="panel">
        ${step !== 5 ? renderProgress() : ''}
        <div class="panel-body">
          ${body}
        </div>
      </main>
    </div>
  `

  bindEvents()

  if (step === 3) startLiveSlotUpdates()
  else stopLiveSlotUpdates()
}

function checkPlayerMobileConflict(
  sportId: SportId,
  playerKey: 'player1' | 'player2',
): void {
  const players = state.doublesPlayers[sportId]
  const mobile = players?.[playerKey].mobile ?? ''
  const normalized = normalizeMobile(mobile)

  // Clear previous "registered" error for this field first
  if (doublesErrors[sportId]?.[playerKey]?.mobile?.includes('registered')) {
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
    state.gender,
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
  for (const sportId of sportsNeedingFormat()) {
    checkPlayerMobileConflict(sportId, 'player1')
    if (state.formats[sportId] === 'double') {
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
          input.parentElement?.querySelector('.error')?.remove()
        }
        return
      }

      const key = input.name as 'fullName' | 'mobile' | 'location'
      if (key === 'fullName' || key === 'mobile' || key === 'location') {
        state[key] = input.value
        if (detailErrors[key]) {
          delete detailErrors[key]
          input.parentElement?.querySelector('.error')?.remove()
        }
      }
    })

    input.addEventListener('blur', () => {
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
      // Re-check Player 1 & Player 2 for every sport on this page
      checkAllPlayerMobileConflictsOnPage()
      render()
    })
  })

  app.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action
      if (action === 'next') goNext()
      else if (action === 'back') goBack()
      else if (action === 'submit') submit()
      else if (action === 'reset') resetForm()
      else if (action === 'gender' && btn.dataset.gender) {
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
  await refreshRegistrations()
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
