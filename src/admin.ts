import {
  adminSessionOk,
  bulkDeleteRegistrations,
  clearAdminToken,
  deleteRegistration,
  getAdminRole,
  getAdminToken,
  getRegistrations,
  getStorageError,
  loginAdmin,
  normalizeMobile,
  parseAge,
  refreshAgeLimits,
  refreshCapacities,
  refreshCricketCapacities,
  refreshFees,
  refreshRegistrations,
  refreshSportAvailability,
  resetRegistrations,
  sanitizeMobileInput,
  saveAgeLimits,
  saveCapacities,
  saveCricketCapacities,
  saveFees,
  saveSportAvailability,
  seatWeight,
  updateRegistration,
} from './storage'
import { AGE_LIMIT_IDS, applyAgeLimits, getAgeLimits, getSportAgeLimit, type SportAgeLimits } from './ageLimits'
import {
  AVAILABILITY_IDS,
  applySportEnabled,
  getSportEnabled,
  type SportEnabledMap,
} from './sportAvailability'
import {
  ALL_SPORT_IDS,
  getCapacities,
  genderLabel,
  sportLabel,
  type SportCapacities,
} from './sports'
import {
  iconArrowLeft,
  iconCricket,
  iconDownload,
  iconEdit,
  iconRefresh,
  iconTrash,
  sportIcon,
  withIcon,
} from './icons'
import {
  eventById,
  EVENTS,
  getCricketCapacities,
  type CricketCapacities,
} from './events'
import { getFees, type FeeId } from './fees'
import type {
  Gender,
  PlayFormat,
  Registration,
  SeatSportId,
  SelectedSport,
  SportId,
  SportSeatStatus,
} from './types'
import { onRealtimeUpdate } from './realtime'

type FlatRow = {
  registration: Registration
  sport: SelectedSport | null
  /** 1-based rank within confirmed or waiting for that sport + gender */
  seatNumber: number | null
}

type SportFilter = 'all' | SeatSportId
type GenderFilter = 'all' | Gender
type StatusFilter = 'all' | SportSeatStatus

let capacityDraft: SportCapacities | null = null
let capacityMessage = ''
let capacityError = ''
let capacitySaving = false
let cricketDraft: CricketCapacities | null = null
let feeDraft: Record<FeeId, number> | null = null
let feeMessage = ''
let feeError = ''
let feeSaving = false
let ageDraft: SportAgeLimits | null = null
let ageMessage = ''
let ageError = ''
let ageSaving = false
let availabilityDraft: SportEnabledMap | null = null
let availabilityMessage = ''
let availabilityError = ''
let availabilitySaving = false
let tableMessage = ''
let tableError = ''
let tableBusy = false
let selectedKeys = new Set<string>()
let editTarget: { regId: string; sportId: SeatSportId | null } | null = null
let adminAuthed = false
let adminAuthChecked = !getAdminToken()
let loginError = ''
let loginBusy = false
let sessionCheck: Promise<void> | null = null

function isSuperAdmin(): boolean {
  return getAdminRole() === 'superadmin'
}

function rowKey(regId: string, sportId: string | null | undefined): string {
  return `${regId}||${sportId ?? ''}`
}

function parseRowKey(key: string): { regId: string; sportId: SeatSportId | null } {
  const [regId, sportId = ''] = key.split('||')
  return {
    regId,
    sportId: (sportId || null) as SeatSportId | null,
  }
}

const FEE_ROWS: { id: FeeId; label: string }[] = [
  { id: 'football', label: 'Football' },
  { id: 'pickleball', label: 'Pickleball' },
  { id: 'carrom', label: 'Carrom' },
  { id: 'chess', label: 'Chess' },
  { id: 'tt', label: 'Table Tennis' },
  { id: 'badminton', label: 'Badminton' },
  { id: 'turf', label: 'Turf cricket' },
  { id: 'overarm', label: 'Overarm cricket' },
]

function ensureCricketDraft(): CricketCapacities {
  if (!cricketDraft) cricketDraft = getCricketCapacities()
  return cricketDraft
}

function syncCricketDraftFromLive(): void {
  cricketDraft = getCricketCapacities()
}

function ensureFeeDraft(): Record<FeeId, number> {
  if (!feeDraft) feeDraft = getFees()
  return feeDraft
}

function syncFeeDraftFromLive(): void {
  feeDraft = getFees()
}

function ensureAvailabilityDraft(): SportEnabledMap {
  if (!availabilityDraft) availabilityDraft = getSportEnabled()
  return availabilityDraft
}

function syncAvailabilityDraftFromLive(): void {
  availabilityDraft = getSportEnabled()
}

function ensureCapacityDraft(): SportCapacities {
  if (!capacityDraft) {
    capacityDraft = structuredClone(getCapacities())
  }
  return capacityDraft
}

function syncCapacityDraftFromLive(): void {
  capacityDraft = structuredClone(getCapacities())
}

function ensureAgeDraft(): SportAgeLimits {
  if (!ageDraft) ageDraft = structuredClone(getAgeLimits())
  return ageDraft
}

function syncAgeDraftFromLive(): void {
  ageDraft = structuredClone(getAgeLimits())
}

function uploadLink(url: string | undefined, label: string): string {
  if (!url || !url.startsWith('/uploads/')) return ''
  return `<a class="upload-link" href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(label)}</a>`
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function formatWhen(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function formatLabel(
  format: SelectedSport['format'],
  sportId: SelectedSport['sportId'],
): string {
  if (sportId === 'football' || sportId === 'turf' || sportId === 'overarm') return 'Team'
  if (
    (sportId === 'tt' || sportId === 'badminton' || sportId === 'pickleball') &&
    format !== 'double'
  ) {
    return 'Organizer assigns partner'
  }
  if (format === 'double') return 'Doubles'
  return 'Singles'
}

function statusLabel(row: FlatRow): string {
  const status = row.sport?.status
  if (!status) return '—'
  const rank = row.seatNumber
  const word = status === 'confirmed' ? 'Confirmed' : 'Waiting'
  if (rank == null) return word
  const weight = seatWeight(row.sport?.format)
  if (weight > 1) return `${word} ${rank}–${rank + weight - 1}`
  return `${word} ${rank}`
}

function createdAtMs(iso: string): number {
  const t = new Date(iso).getTime()
  return Number.isNaN(t) ? 0 : t
}

function sportOrderIndex(id: string | undefined): number {
  if (!id) return ALL_SPORT_IDS.length
  if (id === 'turf') return ALL_SPORT_IDS.length
  if (id === 'overarm') return ALL_SPORT_IDS.length + 1
  const idx = ALL_SPORT_IDS.indexOf(id as SportId)
  return idx === -1 ? ALL_SPORT_IDS.length + 2 : idx
}

/** Flatten registrations, then number seat units Confirmed/Waiting per sport+gender (oldest first). Doubles occupy 2 units. */
function flattenRows(regs: Registration[]): FlatRow[] {
  const rows: FlatRow[] = []
  for (const registration of regs) {
    if (!registration.sports.length) {
      rows.push({ registration, sport: null, seatNumber: null })
      continue
    }
    for (const sport of registration.sports) {
      rows.push({ registration, sport, seatNumber: null })
    }
  }

  const buckets = new Map<string, FlatRow[]>()
  for (const row of rows) {
    if (!row.sport) continue
    const key = `${row.registration.event || 'indoor'}|${row.sport.sportId}|${row.registration.gender}|${row.sport.status ?? 'confirmed'}`
    const list = buckets.get(key)
    if (list) list.push(row)
    else buckets.set(key, [row])
  }

  for (const list of buckets.values()) {
    list.sort((a, b) => {
      const byTime =
        createdAtMs(a.registration.createdAt) -
        createdAtMs(b.registration.createdAt)
      if (byTime !== 0) return byTime
      return a.registration.id.localeCompare(b.registration.id)
    })
    let cursor = 1
    for (const row of list) {
      row.seatNumber = cursor
      cursor += seatWeight(row.sport?.format)
    }
  }

  return rows
}

/** Confirmed 1…N then Waiting 1…N within each sport (+ gender when not filtered). */
function sortSeatRows(rows: FlatRow[]): FlatRow[] {
  return [...rows].sort((a, b) => {
    const eventOrder = (id: string | undefined) => {
      const idx = EVENTS.findIndex((event) => event.id === id)
      return idx === -1 ? 1 : idx
    }
    const eventDiff =
      eventOrder(a.registration.event) - eventOrder(b.registration.event)
    if (eventDiff !== 0) return eventDiff

    const sportDiff =
      sportOrderIndex(a.sport?.sportId) - sportOrderIndex(b.sport?.sportId)
    if (sportDiff !== 0) return sportDiff

    const genderDiff = a.registration.gender.localeCompare(
      b.registration.gender,
    )
    if (genderDiff !== 0) return genderDiff

    const statusRank = (s: SportSeatStatus | undefined) =>
      s === 'waiting' ? 1 : s === 'confirmed' ? 0 : 2
    const statusDiff =
      statusRank(a.sport?.status) - statusRank(b.sport?.status)
    if (statusDiff !== 0) return statusDiff

    const seatA = a.seatNumber ?? Number.MAX_SAFE_INTEGER
    const seatB = b.seatNumber ?? Number.MAX_SAFE_INTEGER
    if (seatA !== seatB) return seatA - seatB

    return (
      createdAtMs(a.registration.createdAt) -
      createdAtMs(b.registration.createdAt)
    )
  })
}

function matchesQuery(row: FlatRow, q: string): boolean {
  if (!q) return true
  const r = row.registration
  const s = row.sport
  const hay = [
    r.id,
    r.fullName,
    r.mobile,
    r.location,
    r.gender,
    eventById(r.event).title,
    genderLabel(r.gender),
    s ? sportLabel(s.sportId) : '',
    s?.format ?? '',
    s?.status ?? '',
    statusLabel(row),
    s?.skill ?? '',
    s?.birthDate ?? '',
    r.receiptNo ?? '',
    r.paidTo ?? '',
    s?.player1Name ?? '',
    s?.player1Mobile ?? '',
    s?.player1Age != null ? String(s.player1Age) : '',
    s?.player2Name ?? '',
    s?.player2Mobile ?? '',
    s?.player2Age != null ? String(s.player2Age) : '',
  ]
    .join(' ')
    .toLowerCase()
  return hay.includes(q)
}

function matchesFilters(
  row: FlatRow,
  sport: SportFilter,
  gender: GenderFilter,
  status: StatusFilter,
): boolean {
  if (gender !== 'all' && row.registration.gender !== gender) return false
  if (sport !== 'all' && row.sport?.sportId !== sport) return false
  if (status !== 'all' && row.sport?.status !== status) return false
  return true
}

function rowHtml(row: FlatRow, index: number): string {
  const r = row.registration
  const s = row.sport
  const key = rowKey(r.id, s?.sportId)
  const checked = selectedKeys.has(key)
  const status = s?.status ?? ''
  const statusClass =
    status === 'waiting'
      ? 'is-waiting'
      : status === 'confirmed'
        ? 'is-confirmed'
        : ''

  return `
    <tr class="${statusClass ? `row-${status}` : ''}" data-row-key="${escapeHtml(key)}">
      <td class="col-check">
        <input type="checkbox" class="admin-check" data-select-row="${escapeHtml(key)}" ${checked ? 'checked' : ''} aria-label="Select row" />
      </td>
      <td class="col-num">${index + 1}</td>
      <td class="col-seat"><span class="status-pill ${statusClass}">${escapeHtml(statusLabel(row))}</span></td>
      <td class="col-event">${escapeHtml(eventById(r.event).title)}</td>
      <td class="col-sport">${s ? escapeHtml(s.skill ? `${sportLabel(s.sportId)} · ${s.skill}` : sportLabel(s.sportId)) : '—'}</td>
      <td>${escapeHtml(r.fullName)}</td>
      <td>${escapeHtml(genderLabel(r.gender))}</td>
      <td>${s ? escapeHtml(formatLabel(s.format, s.sportId)) : '—'}</td>
      <td>${escapeHtml(r.mobile)}</td>
      <td>${escapeHtml(r.location)}</td>
      <td>${escapeHtml(s?.player1Name || '—')}</td>
      <td>${escapeHtml(s?.player1Mobile || '—')}</td>
      <td>${escapeHtml(s?.player1Age != null ? String(s.player1Age) : '—')}</td>
      <td>${escapeHtml(s?.player2Name || '—')}</td>
      <td>${escapeHtml(s?.player2Mobile || '—')}</td>
      <td>${escapeHtml(s?.player2Age != null ? String(s.player2Age) : '—')}</td>
      <td class="col-ref"><code>${escapeHtml(r.receiptNo || r.id)}</code>${r.payMode ? `<div class="pay-note">${escapeHtml(r.payMode === 'cash' ? `Cash · ${r.paidTo || '—'}` : `Online${r.amount ? ` · ₹${r.amount}` : ''}`)}</div>` : ''}${uploadLink(s?.photoUrl, 'Player photo')}${uploadLink(r.paymentShotUrl, 'Payment screenshot')}</td>
      <td class="col-when">${escapeHtml(formatWhen(r.createdAt))}</td>
      <td class="col-actions">
        <button type="button" class="btn btn-ghost btn-table" data-edit-row="${escapeHtml(key)}" ${tableBusy ? 'disabled' : ''}>${withIcon(iconEdit(), 'Edit')}</button>
        <button type="button" class="btn btn-ghost btn-table btn-danger" data-delete-row="${escapeHtml(key)}" ${tableBusy ? 'disabled' : ''}>${withIcon(iconTrash(), 'Delete')}</button>
      </td>
    </tr>
  `
}

function editModalHtml(): string {
  if (!editTarget) return ''
  const reg = getRegistrations().find((r) => r.id === editTarget!.regId)
  if (!reg) return ''
  const sport =
    editTarget.sportId != null
      ? reg.sports.find((s) => s.sportId === editTarget!.sportId) ?? null
      : null

  return `
    <div class="admin-modal-backdrop" data-close-edit-backdrop>
      <div class="admin-modal" role="dialog" aria-modal="true" aria-labelledby="admin-edit-title">
        <div class="admin-modal-head">
          <h3 id="admin-edit-title">Edit registration</h3>
          <button type="button" class="btn btn-ghost" data-admin="close-edit">Close</button>
        </div>
        <form class="admin-edit-form" data-edit-form>
          <input type="hidden" name="regId" value="${escapeHtml(reg.id)}" />
          <input type="hidden" name="sportId" value="${escapeHtml(sport?.sportId ?? '')}" />
          <div class="admin-edit-grid">
            <label>Full name
              <input name="fullName" type="text" required value="${escapeHtml(reg.fullName)}" />
            </label>
            <label>Contact mobile
              <input name="mobile" type="tel" value="${escapeHtml(reg.mobile)}" />
            </label>
            <label>Location
              <input name="location" type="text" value="${escapeHtml(reg.location)}" />
            </label>
            <label>Gender
              <select name="gender">
                <option value="male" ${reg.gender === 'male' ? 'selected' : ''}>Male</option>
                <option value="female" ${reg.gender === 'female' ? 'selected' : ''}>Female</option>
              </select>
            </label>
            ${
              sport
                ? `
            <label>Sport
              <input type="text" value="${escapeHtml(sportLabel(sport.sportId))}" disabled />
            </label>
            <label>Format
              ${
                sport.sportId === 'turf' || sport.sportId === 'overarm'
                  ? `<input type="text" value="Team" disabled />`
                  : `<select name="format">
                <option value="single" ${sport.format !== 'double' ? 'selected' : ''}>Singles / Team</option>
                <option value="double" ${sport.format === 'double' ? 'selected' : ''}>Doubles</option>
              </select>`
              }
            </label>
            ${
              sport.sportId === 'turf' || sport.sportId === 'overarm'
                ? `<label>Skill
              <select name="skill">
                <option value="batsman" ${sport.skill === 'batsman' ? 'selected' : ''}>Batsman</option>
                <option value="bowler" ${sport.skill === 'bowler' ? 'selected' : ''}>Bowler</option>
                <option value="allrounder" ${sport.skill === 'allrounder' ? 'selected' : ''}>All Rounder</option>
              </select>
            </label>`
                : ''
            }
            <label>Player 1 name
              <input name="player1Name" type="text" value="${escapeHtml(sport.player1Name ?? '')}" />
            </label>
            <label>Player 1 mobile
              <input name="player1Mobile" type="tel" maxlength="10" value="${escapeHtml(sport.player1Mobile ?? '')}" />
            </label>
            <label>Player 1 age
              <input name="player1Age" type="number" min="${getSportAgeLimit(sport.sportId).minAge}" max="${getSportAgeLimit(sport.sportId).maxAge}" value="${escapeHtml(sport.player1Age != null ? String(sport.player1Age) : '')}" />
            </label>
            <label>Player 2 name
              <input name="player2Name" type="text" value="${escapeHtml(sport.player2Name ?? '')}" />
            </label>
            <label>Player 2 mobile
              <input name="player2Mobile" type="tel" maxlength="10" value="${escapeHtml(sport.player2Mobile ?? '')}" />
            </label>
            <label>Player 2 age
              <input name="player2Age" type="number" min="${getSportAgeLimit(sport.sportId).minAge}" max="${getSportAgeLimit(sport.sportId).maxAge}" value="${escapeHtml(sport.player2Age != null ? String(sport.player2Age) : '')}" />
            </label>
            `
                : ''
            }
          </div>
          <div class="admin-modal-actions">
            <button type="button" class="btn btn-ghost" data-admin="close-edit">Cancel</button>
            <button type="submit" class="btn btn-gold" ${tableBusy ? 'disabled' : ''}>Save changes</button>
          </div>
        </form>
      </div>
    </div>
  `
}

async function removeSportOrRegistration(
  regId: string,
  sportId: SeatSportId | null,
): Promise<void> {
  const reg = getRegistrations().find((r) => r.id === regId)
  if (!reg) return

  if (!sportId || reg.sports.length <= 1) {
    await deleteRegistration(regId)
    return
  }

  const nextSports = reg.sports.filter((s) => s.sportId !== sportId)
  if (!nextSports.length) {
    await deleteRegistration(regId)
    return
  }

  await updateRegistration({ ...reg, sports: nextSports })
}

async function afterTableChange(
  root: HTMLElement,
  message: string,
): Promise<void> {
  await Promise.all([
    refreshRegistrations(),
    refreshCapacities(),
    refreshCricketCapacities(),
    refreshAgeLimits(),
    refreshFees(),
    refreshSportAvailability(),
  ])
  syncCapacityDraftFromLive()
  syncCricketDraftFromLive()
  syncAgeDraftFromLive()
  syncFeeDraftFromLive()
  syncAvailabilityDraftFromLive()
  tableMessage = message
  tableError = ''
  tableBusy = false
  renderAdmin(root)
}

function csvEscape(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value
  if (/[",\n\r]/.test(safe)) return `"${safe.replaceAll('"', '""')}"`
  return safe
}

function absoluteUploadUrl(url: string | undefined): string {
  if (!url) return ''
  if (/^https?:\/\//i.test(url)) return url
  if (url.startsWith('/')) return `${window.location.origin}${url}`
  return url
}

function skillLabel(skill: string | undefined): string {
  if (skill === 'batsman') return 'Batsman'
  if (skill === 'bowler') return 'Bowler'
  if (skill === 'allrounder') return 'All Rounder'
  return skill ?? ''
}

function payModeLabel(mode: Registration['payMode']): string {
  if (mode === 'online') return 'Online'
  if (mode === 'cash') return 'Cash'
  return ''
}

function downloadCsv(rows: FlatRow[]): void {
  const headers = [
    '#',
    'Seat',
    'Event',
    'Sport',
    'Skill',
    'Full Name',
    'Father / Spouse',
    'Grandfather',
    'Surname',
    'Gender',
    'Format',
    'Mobile',
    'Location',
    'Birth Date',
    'Player 1 Name',
    'Player 1 Mobile',
    'Player 1 Age',
    'Player 2 Name',
    'Player 2 Mobile',
    'Player 2 Age',
    'Receipt',
    'Payment Mode',
    'Paid To',
    'Amount',
    'Player Photo URL',
    'Payment Screenshot URL',
    'Registration ID',
    'Registered At',
  ]

  const lines = [
    headers.join(','),
    ...rows.map((row, i) => {
      const r = row.registration
      const s = row.sport
      return [
        String(i + 1),
        statusLabel(row),
        eventById(r.event).title,
        s ? sportLabel(s.sportId) : '',
        skillLabel(s?.skill),
        r.fullName,
        s?.fatherName ?? '',
        s?.grandfatherName ?? '',
        s?.surname ?? '',
        genderLabel(r.gender),
        s ? formatLabel(s.format, s.sportId) : '',
        r.mobile,
        r.location,
        s?.birthDate ?? '',
        s?.player1Name ?? '',
        s?.player1Mobile ?? '',
        s?.player1Age != null ? String(s.player1Age) : '',
        s?.player2Name ?? '',
        s?.player2Mobile ?? '',
        s?.player2Age != null ? String(s.player2Age) : '',
        r.receiptNo || r.id,
        payModeLabel(r.payMode),
        r.paidTo ?? '',
        r.amount != null ? String(r.amount) : '',
        absoluteUploadUrl(s?.photoUrl),
        absoluteUploadUrl(r.paymentShotUrl),
        r.id,
        r.createdAt,
      ]
        .map((cell) => csvEscape(cell))
        .join(',')
    }),
  ]

  const blob = new Blob(['\ufeff' + lines.join('\n')], {
    type: 'text/csv;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `chansma-registrations-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function filterChip(
  label: string,
  active: boolean,
  attrs: string,
): string {
  return `<button type="button" class="filter-chip${active ? ' is-active' : ''}" ${attrs}>${escapeHtml(label)}</button>`
}

let searchQuery = ''
let sportFilter: SportFilter = 'all'
let genderFilter: GenderFilter = 'all'
let statusFilter: StatusFilter = 'all'
let unsubRealtime: (() => void) | null = null
let adminRoot: HTMLElement | null = null
let realtimeRefreshTimer: number | null = null

function scheduleAdminRealtimeRefresh(): void {
  if (realtimeRefreshTimer !== null) return
  realtimeRefreshTimer = window.setTimeout(() => {
    realtimeRefreshTimer = null
    if (!adminRoot || !isAdminRoute()) return
    const editingCap = adminRoot.querySelector('[data-cap-sport]:focus')
    const editingAge = adminRoot.querySelector('[data-age-sport]:focus')
    if (!editingCap) syncCapacityDraftFromLive()
    if (!editingAge) syncAgeDraftFromLive()
    renderAdmin(adminRoot)
  }, 100)
}

function ensureAdminRealtime(root: HTMLElement): void {
  adminRoot = root
  if (unsubRealtime) return
  unsubRealtime = onRealtimeUpdate(() => {
    scheduleAdminRealtimeRefresh()
  })
}

export function destroyAdmin(): void {
  if (realtimeRefreshTimer !== null) {
    window.clearTimeout(realtimeRefreshTimer)
    realtimeRefreshTimer = null
  }
  unsubRealtime?.()
  unsubRealtime = null
  adminRoot = null
}

function renderLogin(root: HTMLElement): void {
  root.innerHTML = `
    <a class="nav-corner nav-corner-left" href="#/">${iconArrowLeft()} Form</a>
    <div class="shell">
      <header class="brand">
        <img class="brand-logo" src="/chanasma-logo.png" alt="શ્રી ચાણસ્મા જૈન યુવા યુથ" />
        <h1><span class="brand-place">CHANASMA</span><span class="brand-olympic">OLYMPIC</span></h1>
        <div class="olympic-rings" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span></div>
        <p>Admin sign in</p>
        <div class="brand-sponsor"><span>Main sponsor</span><strong>Jarin Bhai</strong></div>
      </header>
      <main class="panel">
        <div class="panel-body">
          <form class="admin-login" data-admin-login>
            <h2 class="step-title">Admin login</h2>
            <p class="step-sub">Enter the username and password to open the dashboard.</p>
            ${
              !adminAuthChecked
                ? `<p class="step-sub">Checking your session…</p>`
                : ''
            }
            ${
              loginError
                ? `<div class="alert is-error">${escapeHtml(loginError)}</div>`
                : ''
            }
            <div class="field">
              <label for="admin-username">Username</label>
              <input id="admin-username" name="username" type="text" autocomplete="username" required ${loginBusy ? 'disabled' : ''} />
            </div>
            <div class="field">
              <label for="admin-password">Password</label>
              <input id="admin-password" name="password" type="password" autocomplete="current-password" required ${loginBusy ? 'disabled' : ''} />
            </div>
            <div class="actions">
              <button type="submit" class="btn btn-gold" ${loginBusy || !adminAuthChecked ? 'disabled' : ''}>
                ${loginBusy ? 'Signing in…' : 'Sign in'}
              </button>
            </div>
          </form>
        </div>
      </main>
    </div>
  `

  root.querySelector<HTMLFormElement>('[data-admin-login]')?.addEventListener('submit', (event) => {
    event.preventDefault()
    const form = event.currentTarget
    if (!(form instanceof HTMLFormElement)) return
    const data = new FormData(form)
    const username = String(data.get('username') || '').trim()
    const password = String(data.get('password') || '')
    loginBusy = true
    loginError = ''
    renderLogin(root)
    void loginAdmin(username, password)
      .then(async () => {
        adminAuthed = true
        adminAuthChecked = true
        loginBusy = false
        await Promise.all([
          refreshRegistrations(),
          refreshCapacities(),
          refreshAgeLimits(),
          refreshSportAvailability(),
        ])
        syncAvailabilityDraftFromLive()
        renderAdmin(root)
      })
      .catch((error) => {
        adminAuthed = false
        loginBusy = false
        loginError =
          error instanceof Error ? error.message : 'Incorrect username or password'
        renderLogin(root)
      })
  })
}

function ensureAdminSession(root: HTMLElement): void {
  if (adminAuthed || sessionCheck || !getAdminToken()) return
  sessionCheck = adminSessionOk()
    .then((ok) => {
      adminAuthed = ok
      adminAuthChecked = true
      sessionCheck = null
      if (isAdminRoute()) renderAdmin(root)
    })
    .catch(() => {
      adminAuthed = false
      adminAuthChecked = true
      sessionCheck = null
      clearAdminToken()
      if (isAdminRoute()) renderLogin(root)
    })
}

export function renderAdmin(root: HTMLElement): void {
  if (!adminAuthed) {
    ensureAdminSession(root)
    renderLogin(root)
    return
  }

  ensureAdminRealtime(root)

  const apiError = getStorageError()
  const regs = getRegistrations()
  const allRows = flattenRows(regs)
  const confirmedCount = allRows.reduce(
    (n, r) =>
      r.sport?.status === 'confirmed' ? n + seatWeight(r.sport.format) : n,
    0,
  )
  const waitingCount = allRows.reduce(
    (n, r) =>
      r.sport?.status === 'waiting' ? n + seatWeight(r.sport.format) : n,
    0,
  )
  const seatUnitTotal = allRows.reduce(
    (n, r) => (r.sport ? n + seatWeight(r.sport.format) : n),
    0,
  )
  const rows = sortSeatRows(
    allRows.filter(
      (row) =>
        matchesFilters(row, sportFilter, genderFilter, statusFilter) &&
        matchesQuery(row, searchQuery.trim().toLowerCase()),
    ),
  )

  const sportCounts = Object.fromEntries(
    ALL_SPORT_IDS.map((id) => [
      id,
      allRows.reduce(
        (n, row) =>
          row.sport?.sportId === id ? n + seatWeight(row.sport.format) : n,
        0,
      ),
    ]),
  ) as Record<SportId, number>

  const filtersActive =
    sportFilter !== 'all' ||
    genderFilter !== 'all' ||
    statusFilter !== 'all' ||
    Boolean(searchQuery.trim())

  const activeEl = document.activeElement as HTMLElement | null
  const activeName =
    activeEl instanceof HTMLInputElement ? activeEl.name || activeEl.id : ''
  const activePos =
    activeEl instanceof HTMLInputElement ? activeEl.selectionStart : null

  root.innerHTML = `
    <a class="nav-corner nav-corner-left" href="#/">${iconArrowLeft()} Form</a>
    <button type="button" class="nav-corner nav-corner-right" data-admin="logout">Log out</button>

    <div class="shell shell-admin">
      <header class="brand brand-admin">
        <img class="brand-logo" src="/chanasma-logo.png" alt="શ્રી ચાણસ્મા જૈન યુવા યુથ" />
        <h1><span class="brand-place">CHANASMA</span><span class="brand-olympic">OLYMPIC</span></h1>
        <p>${isSuperAdmin() ? 'Super admin · full dashboard' : 'Admin dashboard · registrations'}</p>
        <div class="brand-sponsor"><span>Main sponsor</span><strong>Jarin Bhai</strong></div>
      </header>

      <main class="panel panel-admin">
        ${isSuperAdmin() ? `
        <section class="capacity-panel">
          <div class="capacity-top">
            <div class="capacity-intro">
              <p class="capacity-kicker">Live settings</p>
              <h2 class="capacity-title">Sports on the form</h2>
              <p class="capacity-sub">Turn a sport off to remove it from registration. The name, photo, rules, and price for a closed sport are hidden. Turn it on again to bring it back.</p>
            </div>
            <div class="capacity-toolbar">
              <button type="button" class="btn btn-gold" data-admin="apply-availability" ${availabilitySaving ? 'disabled' : ''}>
                ${availabilitySaving ? 'Saving…' : 'Apply sports'}
              </button>
            </div>
          </div>
          ${availabilityError ? `<div class="alert">${escapeHtml(availabilityError)}</div>` : ''}
          ${availabilityMessage ? `<div class="capacity-ok">${escapeHtml(availabilityMessage)}</div>` : ''}
          <div class="capacity-table-wrap">
            <table class="capacity-table">
              <thead>
                <tr>
                  <th scope="col">Sport</th>
                  <th scope="col">Registration</th>
                </tr>
              </thead>
              <tbody>
                ${AVAILABILITY_IDS.map((id) => {
                  const on = ensureAvailabilityDraft()[id] !== false
                  return `
                  <tr>
                    <th scope="row"><span class="sport-heading">${sportIcon(id)} ${sportLabel(id)}</span></th>
                    <td>
                      <label class="avail-switch">
                        <input type="checkbox" data-availability="${id}" ${on ? 'checked' : ''} aria-label="${sportLabel(id)} on the form" />
                        <span>${on ? 'On' : 'Off'}</span>
                      </label>
                    </td>
                  </tr>`
                }).join('')}
              </tbody>
            </table>
          </div>
        </section>

        <section class="capacity-panel">
          <div class="capacity-top">
            <div class="capacity-intro">
              <p class="capacity-kicker">Live settings</p>
              <h2 class="capacity-title">Slot counts</h2>
              <p class="capacity-sub">Men and women capacity per sport in seat units. Singles use 1 seat; doubles use 2. Apply rebalances confirmed vs waiting by registration time and updates live badges.</p>
            </div>
            <div class="capacity-toolbar">
              <div class="capacity-fill">
                <span class="capacity-fill-label">Fill all</span>
                <input type="number" min="0" step="1" name="fillAllValue" value="16" aria-label="Fill all value" />
                <button type="button" class="btn btn-ghost" data-admin="fill-all">Use for every sport</button>
              </div>
              <button type="button" class="btn btn-gold" data-admin="apply-capacities" ${capacitySaving ? 'disabled' : ''}>
                ${capacitySaving ? 'Applying…' : 'Apply changes'}
              </button>
            </div>
          </div>

          ${
            capacityError
              ? `<div class="alert">${escapeHtml(capacityError)}</div>`
              : ''
          }
          ${
            capacityMessage
              ? `<div class="capacity-ok">${escapeHtml(capacityMessage)}</div>`
              : ''
          }

          <div class="capacity-table-wrap">
            <table class="capacity-table">
              <thead>
                <tr>
                  <th scope="col">Sport</th>
                  <th scope="col">Men</th>
                  <th scope="col">Women</th>
                </tr>
              </thead>
              <tbody>
                ${ALL_SPORT_IDS.map((id) => {
                  const caps = ensureCapacityDraft()[id]
                  return `
                  <tr>
                    <th scope="row"><span class="sport-heading">${sportIcon(id)} ${sportLabel(id)}</span></th>
                    <td>
                      <input type="number" min="0" step="1"
                        id="cap-male-${id}"
                        data-cap-sport="${id}" data-cap-gender="male"
                        value="${caps.male}" aria-label="${sportLabel(id)} men" />
                    </td>
                    <td>
                      <input type="number" min="0" step="1"
                        id="cap-female-${id}"
                        data-cap-sport="${id}" data-cap-gender="female"
                        value="${caps.female}" aria-label="${sportLabel(id)} women" />
                    </td>
                  </tr>
                `
                }).join('')}
                ${(() => {
                  const caps = ensureCricketDraft()
                  return `
                  <tr>
                    <th scope="row"><span class="sport-heading">${iconCricket()} Turf cricket</span></th>
                    <td>
                      <input type="number" min="0" step="1"
                        id="cap-male-turf"
                        data-cricket-cap="turf" data-cap-gender="male"
                        value="${caps.turf.male}" aria-label="Turf cricket men" />
                    </td>
                    <td>
                      <input type="number" min="0" step="1"
                        id="cap-female-turf"
                        data-cricket-cap="turf" data-cap-gender="female"
                        value="${caps.turf.female}" aria-label="Turf cricket women" />
                    </td>
                  </tr>
                  <tr>
                    <th scope="row"><span class="sport-heading">${iconCricket()} Overarm cricket</span></th>
                    <td>
                      <input type="number" min="0" step="1"
                        id="cap-male-overarm"
                        data-cricket-cap="overarm" data-cap-gender="male"
                        value="${caps.overarm.male}" aria-label="Overarm cricket men" />
                    </td>
                    <td class="cap-na">Men only</td>
                  </tr>
                  `
                })()}
              </tbody>
            </table>
          </div>
        </section>

        <section class="capacity-panel age-limits-panel">
          <div class="capacity-top">
            <div class="capacity-intro">
              <p class="capacity-kicker">Live settings</p>
              <h2 class="capacity-title">Age restriction by sport</h2>
              <p class="capacity-sub">Set min and max age for each sport. Registration validates player ages against that sport’s limits.</p>
            </div>
            <div class="capacity-toolbar">
              <div class="capacity-fill">
                <span class="capacity-fill-label">Fill all</span>
                <input type="number" min="1" max="120" step="1" name="fillAgeMin" value="5" aria-label="Fill all min age" />
                <span class="capacity-fill-label">–</span>
                <input type="number" min="1" max="120" step="1" name="fillAgeMax" value="100" aria-label="Fill all max age" />
                <button type="button" class="btn btn-ghost" data-admin="fill-all-ages">Use for every sport</button>
              </div>
              <button type="button" class="btn btn-gold" data-admin="apply-age-limits" ${ageSaving ? 'disabled' : ''}>
                ${ageSaving ? 'Saving…' : 'Apply age limits'}
              </button>
            </div>
          </div>

          ${
            ageError
              ? `<div class="alert">${escapeHtml(ageError)}</div>`
              : ''
          }
          ${
            ageMessage
              ? `<div class="capacity-ok">${escapeHtml(ageMessage)}</div>`
              : ''
          }

          <div class="capacity-table-wrap">
            <table class="capacity-table">
              <thead>
                <tr>
                  <th scope="col">Sport</th>
                  <th scope="col">Min age</th>
                  <th scope="col">Max age</th>
                </tr>
              </thead>
              <tbody>
                ${AGE_LIMIT_IDS.map((id) => {
                  const ages = ensureAgeDraft()[id]
                  return `
                  <tr>
                    <th scope="row"><span class="sport-heading">${sportIcon(id)} ${sportLabel(id)}</span></th>
                    <td>
                      <input type="number" min="1" max="120" step="1"
                        id="age-min-${id}"
                        data-age-sport="${id}" data-age-bound="min"
                        value="${ages.minAge}" aria-label="${sportLabel(id)} min age" />
                    </td>
                    <td>
                      <input type="number" min="1" max="120" step="1"
                        id="age-max-${id}"
                        data-age-sport="${id}" data-age-bound="max"
                        value="${ages.maxAge}" aria-label="${sportLabel(id)} max age" />
                    </td>
                  </tr>
                `
                }).join('')}
              </tbody>
            </table>
          </div>
        </section>

        <section class="capacity-panel">
          <div class="capacity-top">
            <div class="capacity-intro">
              <p class="capacity-kicker">Live settings</p>
              <h2 class="capacity-title">Entry fees</h2>
              <p class="capacity-sub">Price per player in rupees. Doubles charge two players. Turf and overarm are one team fee each. The payment page uses these amounts.</p>
            </div>
            <div class="capacity-toolbar">
              <button type="button" class="btn btn-gold" data-admin="apply-fees" ${feeSaving ? 'disabled' : ''}>
                ${feeSaving ? 'Saving…' : 'Apply prices'}
              </button>
            </div>
          </div>
          ${feeError ? `<div class="alert">${escapeHtml(feeError)}</div>` : ''}
          ${feeMessage ? `<div class="capacity-ok">${escapeHtml(feeMessage)}</div>` : ''}
          <div class="capacity-table-wrap">
            <table class="capacity-table">
              <thead>
                <tr>
                  <th scope="col">Sport</th>
                  <th scope="col">Price per player (₹)</th>
                </tr>
              </thead>
              <tbody>
                ${FEE_ROWS.map((row) => `
                  <tr>
                    <th scope="row"><span class="sport-heading">${sportIcon(row.id)} ${row.label}</span></th>
                    <td>
                      <input type="number" min="0" step="1"
                        id="fee-${row.id}"
                        data-fee-id="${row.id}"
                        value="${ensureFeeDraft()[row.id]}"
                        aria-label="${row.label} price" />
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </section>
        ` : ''}

        <div class="admin-toolbar">
          <div class="admin-stats">
            <span><strong>${regs.length}</strong> registrations</span>
            <span><strong>${seatUnitTotal}</strong> sport seats</span>
            <span class="stat-confirmed"><strong>${confirmedCount}</strong> confirmed</span>
            <span class="stat-waiting"><strong>${waitingCount}</strong> waiting</span>
            <span>Showing <strong>${rows.length}</strong></span>
            ${selectedKeys.size ? `<span class="stat-selected"><strong>${selectedKeys.size}</strong> selected</span>` : ''}
          </div>
          <div class="admin-actions">
            <input
              type="search"
              class="admin-search"
              name="adminSearch"
              placeholder="Search name, mobile, sport, seat…"
              value="${escapeHtml(searchQuery)}"
              autocomplete="off"
            />
            <button type="button" class="btn btn-ghost" data-admin="refresh" ${tableBusy ? 'disabled' : ''}>${withIcon(iconRefresh(), 'Refresh')}</button>
            <button type="button" class="btn btn-gold" data-admin="csv">${withIcon(iconDownload(), 'Export CSV')}</button>
            ${
              isSuperAdmin()
                ? `<button type="button" class="btn btn-ghost btn-danger" data-admin="bulk-delete" ${tableBusy || !selectedKeys.size ? 'disabled' : ''}>${withIcon(iconTrash(), `Delete selected (${selectedKeys.size})`)}</button>
            <button type="button" class="btn btn-ghost btn-danger" data-admin="reset-db" ${tableBusy ? 'disabled' : ''}>Reset DB</button>`
                : ''
            }
            ${
              filtersActive
                ? `<button type="button" class="btn btn-ghost" data-admin="clear">Clear filters</button>`
                : ''
            }
          </div>
        </div>

        ${
          tableError
            ? `<div class="alert">${escapeHtml(tableError)}</div>`
            : ''
        }
        ${
          tableMessage
            ? `<div class="capacity-ok">${escapeHtml(tableMessage)}</div>`
            : ''
        }

        <div class="admin-filters">
          <div class="filter-row">
            <span class="filter-label">Sport</span>
            <div class="filter-chips">
              ${filterChip(`All (${allRows.length})`, sportFilter === 'all', 'data-filter-sport="all"')}
              ${ALL_SPORT_IDS.map((id) =>
                filterChip(
                  `${sportLabel(id)} (${sportCounts[id]})`,
                  sportFilter === id,
                  `data-filter-sport="${id}"`,
                ),
              ).join('')}
              ${(['turf', 'overarm'] as const).map((id) =>
                filterChip(
                  `${sportLabel(id)} (${allRows.reduce((n, row) => (row.sport?.sportId === id ? n + 1 : n), 0)})`,
                  sportFilter === id,
                  `data-filter-sport="${id}"`,
                ),
              ).join('')}
            </div>
          </div>
          <div class="filter-row">
            <span class="filter-label">Gender</span>
            <div class="filter-chips">
              ${filterChip('All', genderFilter === 'all', 'data-filter-gender="all"')}
              ${filterChip('Male', genderFilter === 'male', 'data-filter-gender="male"')}
              ${filterChip('Female', genderFilter === 'female', 'data-filter-gender="female"')}
            </div>
          </div>
          <div class="filter-row">
            <span class="filter-label">Status</span>
            <div class="filter-chips">
              ${filterChip(`All (${allRows.length})`, statusFilter === 'all', 'data-filter-status="all"')}
              ${filterChip(`Confirmed (${confirmedCount})`, statusFilter === 'confirmed', 'data-filter-status="confirmed"')}
              ${filterChip(`Waiting (${waitingCount})`, statusFilter === 'waiting', 'data-filter-status="waiting"')}
            </div>
          </div>
          <p class="filter-hint">Rows are ordered Confirmed then Waiting per sport and gender (oldest first). Doubles occupy 2 seat numbers (e.g. Confirmed 1–2). Seat counts recalculate after edit, delete, or reset.</p>
        </div>

        ${
          apiError
            ? `<div class="alert">Database/API: ${escapeHtml(apiError)}</div>`
            : ''
        }

        <div class="admin-table-wrap">
          <table class="admin-table">
            <thead>
              <tr>
                <th class="col-check">
                  <input type="checkbox" class="admin-check" data-select-all ${rows.length && rows.every((r) => selectedKeys.has(rowKey(r.registration.id, r.sport?.sportId))) ? 'checked' : ''} aria-label="Select all visible" />
                </th>
                <th class="col-num">#</th>
                <th class="col-seat">Seat</th>
                <th class="col-event">Event</th>
                <th class="col-sport">Sport</th>
                <th>Full name</th>
                <th>Gender</th>
                <th>Format</th>
                <th>Mobile</th>
                <th>Location</th>
                <th>Player 1</th>
                <th>P1 mobile</th>
                <th>P1 age</th>
                <th>Player 2</th>
                <th>P2 mobile</th>
                <th>P2 age</th>
                <th>Reference</th>
                <th>Registered</th>
                <th class="col-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${
                rows.length
                  ? rows.map((row, i) => rowHtml(row, i)).join('')
                  : `<tr><td colspan="19" class="admin-empty">No rows match these filters.</td></tr>`
              }
            </tbody>
          </table>
        </div>
      </main>
    </div>
    ${editModalHtml()}
  `

  const search = root.querySelector<HTMLInputElement>('input[name="adminSearch"]')
  search?.addEventListener('input', () => {
    searchQuery = search.value
    renderAdmin(root)
  })

  root.querySelectorAll<HTMLButtonElement>('[data-filter-sport]').forEach((btn) => {
    btn.addEventListener('click', () => {
      sportFilter = (btn.dataset.filterSport || 'all') as SportFilter
      renderAdmin(root)
    })
  })

  root.querySelectorAll<HTMLButtonElement>('[data-filter-gender]').forEach((btn) => {
    btn.addEventListener('click', () => {
      genderFilter = (btn.dataset.filterGender || 'all') as GenderFilter
      renderAdmin(root)
    })
  })

  root.querySelectorAll<HTMLButtonElement>('[data-filter-status]').forEach((btn) => {
    btn.addEventListener('click', () => {
      statusFilter = (btn.dataset.filterStatus || 'all') as StatusFilter
      renderAdmin(root)
    })
  })

  root.querySelectorAll<HTMLInputElement>('[data-cap-sport]').forEach((input) => {
    input.addEventListener('input', () => {
      const sportId = input.dataset.capSport as SportId
      const gender = input.dataset.capGender as 'male' | 'female'
      const draft = ensureCapacityDraft()
      const value = Math.max(0, Math.floor(Number(input.value) || 0))
      draft[sportId][gender] = value
      capacityMessage = ''
      capacityError = ''
    })
  })

  root.querySelectorAll<HTMLInputElement>('[data-cricket-cap]').forEach((input) => {
    input.addEventListener('input', () => {
      const kind = input.dataset.cricketCap === 'overarm' ? 'overarm' : 'turf'
      const gender = input.dataset.capGender === 'female' ? 'female' : 'male'
      const draft = ensureCricketDraft()
      const value = Math.max(0, Math.floor(Number(input.value) || 0))
      if (kind === 'overarm') draft.overarm.male = value
      else if (gender === 'female') draft.turf.female = value
      else draft.turf.male = value
      capacityMessage = ''
      capacityError = ''
    })
  })

  root.querySelectorAll<HTMLInputElement>('[data-availability]').forEach((input) => {
    input.addEventListener('change', () => {
      const id = input.dataset.availability as SeatSportId
      ensureAvailabilityDraft()[id] = input.checked
      availabilityMessage = ''
      availabilityError = ''
      renderAdmin(root)
    })
  })

  root.querySelectorAll<HTMLInputElement>('[data-fee-id]').forEach((input) => {
    input.addEventListener('input', () => {
      const id = input.dataset.feeId as FeeId
      const draft = ensureFeeDraft()
      draft[id] = Math.max(0, Math.floor(Number(input.value) || 0))
      feeMessage = ''
      feeError = ''
    })
  })

  root.querySelectorAll<HTMLInputElement>('[data-age-sport]').forEach((input) => {
    input.addEventListener('input', () => {
      const sportId = input.dataset.ageSport as SeatSportId
      const bound = input.dataset.ageBound as 'min' | 'max'
      const draft = ensureAgeDraft()
      const value = Math.max(
        1,
        Math.min(120, Math.floor(Number(input.value) || (bound === 'min' ? 5 : 100))),
      )
      if (bound === 'min') draft[sportId].minAge = value
      else draft[sportId].maxAge = value
      ageMessage = ''
      ageError = ''
    })
  })

  root.querySelectorAll<HTMLButtonElement>('[data-admin]').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.stopPropagation()
      const action = btn.dataset.admin
      if (action === 'logout') {
        clearAdminToken()
        adminAuthed = false
        adminAuthChecked = true
        loginError = ''
        loginBusy = false
        destroyAdmin()
        renderLogin(root)
        return
      }
      if (action === 'refresh') {
        void Promise.all([
          refreshRegistrations(),
          refreshCapacities(),
          refreshCricketCapacities(),
          refreshAgeLimits(),
          refreshFees(),
          refreshSportAvailability(),
        ]).then(() => {
          syncCapacityDraftFromLive()
          syncCricketDraftFromLive()
          syncAgeDraftFromLive()
          syncFeeDraftFromLive()
          syncAvailabilityDraftFromLive()
          capacityMessage = ''
          capacityError = ''
          ageMessage = ''
          ageError = ''
          tableMessage = ''
          tableError = ''
          renderAdmin(root)
        })
      } else if (action === 'csv') {
        downloadCsv(rows)
      } else if (action === 'clear') {
        searchQuery = ''
        sportFilter = 'all'
        genderFilter = 'all'
        statusFilter = 'all'
        renderAdmin(root)
      } else if (action === 'close-edit') {
        editTarget = null
        renderAdmin(root)
      } else if (action === 'fill-all-ages') {
        const minInput = root.querySelector<HTMLInputElement>(
          'input[name="fillAgeMin"]',
        )
        const maxInput = root.querySelector<HTMLInputElement>(
          'input[name="fillAgeMax"]',
        )
        let minAge = Math.max(1, Math.min(120, Math.floor(Number(minInput?.value) || 5)))
        let maxAge = Math.max(1, Math.min(120, Math.floor(Number(maxInput?.value) || 100)))
        if (minAge > maxAge) {
          const swap = minAge
          minAge = maxAge
          maxAge = swap
        }
        const draft = ensureAgeDraft()
        for (const id of AGE_LIMIT_IDS) {
          draft[id] = { minAge, maxAge }
        }
        ageMessage = `Filled all sports to ${minAge}–${maxAge} — click Apply age limits to save.`
        ageError = ''
        renderAdmin(root)
      } else if (action === 'apply-age-limits') {
        const draft = ensureAgeDraft()
        for (const id of AGE_LIMIT_IDS) {
          if (draft[id].minAge > draft[id].maxAge) {
            ageError = `${sportLabel(id)}: min age cannot be greater than max age`
            ageMessage = ''
            renderAdmin(root)
            return
          }
        }
        ageSaving = true
        ageError = ''
        ageMessage = ''
        renderAdmin(root)
        void saveAgeLimits(draft)
          .then((saved) => {
            applyAgeLimits(saved)
            syncAgeDraftFromLive()
            ageMessage =
              'Age limits saved per sport. Registration form validates ages using each sport’s min/max.'
            ageError = ''
          })
          .catch((error) => {
            ageError =
              error instanceof Error ? error.message : 'Could not save age limits'
            ageMessage = ''
          })
          .finally(() => {
            ageSaving = false
            renderAdmin(root)
          })
      } else if (action === 'bulk-delete') {
        if (!selectedKeys.size || tableBusy) return
        const keys = [...selectedKeys]
        const uniqueRegIds = [
          ...new Set(keys.map((key) => parseRowKey(key).regId)),
        ]
        if (
          !confirm(
            `Delete ${keys.length} selected sport seat(s)?\nThis removes those sports from registrations (or the whole registration if it was the last sport).\nSeat counts will update automatically.`,
          )
        ) {
          return
        }
        tableBusy = true
        tableError = ''
        tableMessage = ''
        renderAdmin(root)
        void (async () => {
          try {
            // Prefer deleting whole registrations when every sport row of that reg is selected
            const regs = getRegistrations()
            const fullySelected: string[] = []
            const partialKeys: string[] = []
            for (const reg of regs) {
              if (!uniqueRegIds.includes(reg.id)) continue
              const sportKeys = reg.sports.length
                ? reg.sports.map((s) => rowKey(reg.id, s.sportId))
                : [rowKey(reg.id, null)]
              if (sportKeys.every((k) => selectedKeys.has(k))) {
                fullySelected.push(reg.id)
              } else {
                for (const k of sportKeys) {
                  if (selectedKeys.has(k)) partialKeys.push(k)
                }
              }
            }
            let deleted = 0
            if (fullySelected.length) {
              deleted += await bulkDeleteRegistrations(fullySelected)
            }
            for (const key of partialKeys) {
              const { regId, sportId } = parseRowKey(key)
              await removeSportOrRegistration(regId, sportId)
              deleted += 1
            }
            for (const key of keys) selectedKeys.delete(key)
            await afterTableChange(
              root,
              `Deleted ${deleted} item(s). Seat counts recalculated.`,
            )
          } catch (error) {
            tableBusy = false
            tableError =
              error instanceof Error ? error.message : 'Bulk delete failed'
            renderAdmin(root)
          }
        })()
      } else if (action === 'reset-db') {
        if (tableBusy) return
        const typed = prompt(
          'This permanently deletes ALL registrations and resets seat counts.\nType RESET to confirm:',
        )
        if (typed !== 'RESET') return
        tableBusy = true
        tableError = ''
        tableMessage = ''
        renderAdmin(root)
        void resetRegistrations()
          .then(async (deleted) => {
            selectedKeys.clear()
            editTarget = null
            await afterTableChange(
              root,
              `Database reset. Removed ${deleted} registration(s). All seats are open again.`,
            )
          })
          .catch((error) => {
            tableBusy = false
            tableError =
              error instanceof Error ? error.message : 'Reset failed'
            renderAdmin(root)
          })
      } else if (action === 'fill-all') {
        const fillInput = root.querySelector<HTMLInputElement>(
          'input[name="fillAllValue"]',
        )
        const value = Math.max(0, Math.floor(Number(fillInput?.value) || 16))
        const draft = ensureCapacityDraft()
        for (const id of ALL_SPORT_IDS) {
          draft[id] = { male: value, female: value }
        }
        capacityMessage = `Filled all sports to ${value} men & ${value} women — click Apply to save.`
        capacityError = ''
        renderAdmin(root)
      } else if (action === 'apply-availability') {
        availabilitySaving = true
        availabilityError = ''
        availabilityMessage = ''
        renderAdmin(root)
        void saveSportAvailability(ensureAvailabilityDraft())
          .then((saved) => {
            applySportEnabled(saved)
            syncAvailabilityDraftFromLive()
            availabilityMessage = 'Saved. Closed sports are hidden on the registration form.'
            availabilityError = ''
          })
          .catch((error) => {
            availabilityError =
              error instanceof Error ? error.message : 'Could not save sports'
            availabilityMessage = ''
          })
          .finally(() => {
            availabilitySaving = false
            renderAdmin(root)
          })
      } else if (action === 'apply-fees') {
        feeSaving = true
        feeError = ''
        feeMessage = ''
        renderAdmin(root)
        void saveFees(ensureFeeDraft())
          .then(() => {
            syncFeeDraftFromLive()
            feeMessage = 'Prices saved. The registration form uses these amounts on the payment page.'
            feeError = ''
          })
          .catch((error) => {
            feeError = error instanceof Error ? error.message : 'Could not save prices'
            feeMessage = ''
          })
          .finally(() => {
            feeSaving = false
            renderAdmin(root)
          })
      } else if (action === 'apply-capacities') {
        capacitySaving = true
        capacityError = ''
        capacityMessage = ''
        renderAdmin(root)
        void Promise.all([
          saveCapacities(ensureCapacityDraft()),
          saveCricketCapacities(ensureCricketDraft()),
        ])
          .then(() => {
            syncCapacityDraftFromLive()
            syncCricketDraftFromLive()
            capacityMessage =
              'Applied. Seats rebalanced by registration time — earlier registrations keep confirmed slots; later ones wait if full. Live badges updated.'
            capacityError = ''
          })
          .catch((error) => {
            capacityError =
              error instanceof Error
                ? error.message
                : 'Could not apply capacities'
            capacityMessage = ''
          })
          .finally(() => {
            capacitySaving = false
            renderAdmin(root)
          })
      }
    })
  })

  root.querySelector<HTMLInputElement>('[data-select-all]')?.addEventListener(
    'change',
    (event) => {
      const checked = (event.target as HTMLInputElement).checked
      for (const row of rows) {
        const key = rowKey(row.registration.id, row.sport?.sportId)
        if (checked) selectedKeys.add(key)
        else selectedKeys.delete(key)
      }
      renderAdmin(root)
    },
  )

  root.querySelectorAll<HTMLInputElement>('[data-select-row]').forEach((input) => {
    input.addEventListener('change', () => {
      const key = input.dataset.selectRow || ''
      if (!key) return
      if (input.checked) selectedKeys.add(key)
      else selectedKeys.delete(key)
      renderAdmin(root)
    })
  })

  root.querySelectorAll<HTMLButtonElement>('[data-edit-row]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.editRow || ''
      if (!key) return
      const parsed = parseRowKey(key)
      editTarget = parsed
      tableError = ''
      renderAdmin(root)
    })
  })

  root.querySelectorAll<HTMLButtonElement>('[data-delete-row]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.deleteRow || ''
      if (!key || tableBusy) return
      const { regId, sportId } = parseRowKey(key)
      const reg = getRegistrations().find((r) => r.id === regId)
      const sportName = sportId ? sportLabel(sportId) : 'entry'
      if (
        !confirm(
          `Delete ${sportName} for ${reg?.fullName || regId}?\nSeat counts will update automatically.`,
        )
      ) {
        return
      }
      tableBusy = true
      tableError = ''
      tableMessage = ''
      renderAdmin(root)
      void removeSportOrRegistration(regId, sportId)
        .then(async () => {
          selectedKeys.delete(key)
          await afterTableChange(
            root,
            `Deleted ${sportName}. Seat counts recalculated.`,
          )
        })
        .catch((error) => {
          tableBusy = false
          tableError =
            error instanceof Error ? error.message : 'Delete failed'
          renderAdmin(root)
        })
    })
  })

  root
    .querySelector('[data-close-edit-backdrop]')
    ?.addEventListener('click', (event) => {
      if (event.target === event.currentTarget) {
        editTarget = null
        renderAdmin(root)
      }
    })

  root.querySelector<HTMLFormElement>('[data-edit-form]')?.addEventListener(
    'submit',
    (event) => {
      event.preventDefault()
      if (tableBusy) return
      const form = event.currentTarget as HTMLFormElement
      const data = new FormData(form)
      const regId = String(data.get('regId') || '')
      const sportIdRaw = String(data.get('sportId') || '')
      const reg = getRegistrations().find((r) => r.id === regId)
      if (!reg) {
        tableError = 'Registration not found'
        renderAdmin(root)
        return
      }

      const next: Registration = {
        ...reg,
        fullName: String(data.get('fullName') || '').trim(),
        mobile: normalizeMobile(String(data.get('mobile') || '')),
        location: String(data.get('location') || '').trim(),
        gender: (String(data.get('gender') || reg.gender) as Gender) || reg.gender,
        sports: reg.sports.map((s) => {
          if (!sportIdRaw || s.sportId !== sportIdRaw) return s
          const cricketSeat = s.sportId === 'turf' || s.sportId === 'overarm'
          const format = cricketSeat
            ? 'single'
            : ((String(data.get('format') || s.format) || 'single') as PlayFormat)
          const skillRaw = String(data.get('skill') || s.skill || '')
          const updated: SelectedSport = {
            ...s,
            format,
            skill: cricketSeat ? skillRaw : s.skill,
            player1Name: String(data.get('player1Name') || '').trim(),
            player1Mobile: sanitizeMobileInput(
              String(data.get('player1Mobile') || ''),
            ),
            player1Age: parseAge(
              String(data.get('player1Age') || ''),
              (sportIdRaw || undefined) as SeatSportId | undefined,
            ),
            player2Name: String(data.get('player2Name') || '').trim(),
            player2Mobile: sanitizeMobileInput(
              String(data.get('player2Mobile') || ''),
            ),
            player2Age: parseAge(
              String(data.get('player2Age') || ''),
              (sportIdRaw || undefined) as SeatSportId | undefined,
            ),
          }
          return updated
        }),
      }

      if (!next.fullName) {
        tableError = 'Full name is required'
        renderAdmin(root)
        return
      }

      next.mobile = sanitizeMobileInput(next.mobile)

      tableBusy = true
      tableError = ''
      tableMessage = ''
      renderAdmin(root)
      void updateRegistration(next)
        .then(async () => {
          editTarget = null
          await afterTableChange(
            root,
            'Registration updated. Seat counts recalculated.',
          )
        })
        .catch((error) => {
          tableBusy = false
          tableError =
            error instanceof Error ? error.message : 'Update failed'
          renderAdmin(root)
        })
    },
  )

  if (activeName) {
    const restore =
      root.querySelector<HTMLInputElement>(`#${CSS.escape(activeName)}`) ||
      root.querySelector<HTMLInputElement>(`[name="${CSS.escape(activeName)}"]`)
    if (restore) {
      restore.focus()
      if (activePos !== null) {
        try {
          restore.setSelectionRange(activePos, activePos)
        } catch {
          // number inputs may not support selection
        }
      }
    }
  }
}

export function isAdminRoute(): boolean {
  const hash = location.hash.replace(/^#/, '')
  return hash === '/admin' || hash.startsWith('/admin/')
}
