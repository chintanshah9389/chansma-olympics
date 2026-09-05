import {
  bulkDeleteRegistrations,
  deleteRegistration,
  getRegistrations,
  getStorageError,
  normalizeMobile,
  refreshCapacities,
  refreshRegistrations,
  resetRegistrations,
  saveCapacities,
  updateRegistration,
} from './storage'
import {
  ALL_SPORT_IDS,
  getCapacities,
  genderLabel,
  sportLabel,
  type SportCapacities,
} from './sports'
import {
  iconArrowLeft,
  iconDownload,
  iconEdit,
  iconRefresh,
  iconTrash,
  sportIcon,
  withIcon,
} from './icons'
import type {
  Gender,
  PlayFormat,
  Registration,
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

type SportFilter = 'all' | SportId
type GenderFilter = 'all' | Gender
type StatusFilter = 'all' | SportSeatStatus

let capacityDraft: SportCapacities | null = null
let capacityMessage = ''
let capacityError = ''
let capacitySaving = false
let tableMessage = ''
let tableError = ''
let tableBusy = false
let selectedKeys = new Set<string>()
let editTarget: { regId: string; sportId: SportId | null } | null = null

function rowKey(regId: string, sportId: string | null | undefined): string {
  return `${regId}||${sportId ?? ''}`
}

function parseRowKey(key: string): { regId: string; sportId: SportId | null } {
  const [regId, sportId = ''] = key.split('||')
  return {
    regId,
    sportId: (sportId || null) as SportId | null,
  }
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
  if (sportId === 'football') return 'Team'
  if (format === 'double') return 'Doubles'
  return 'Singles'
}

function statusLabel(row: FlatRow): string {
  const status = row.sport?.status
  if (!status) return '—'
  const rank = row.seatNumber
  const word = status === 'confirmed' ? 'Confirmed' : 'Waiting'
  return rank != null ? `${word} ${rank}` : word
}

function createdAtMs(iso: string): number {
  const t = new Date(iso).getTime()
  return Number.isNaN(t) ? 0 : t
}

function sportOrderIndex(id: SportId | undefined): number {
  if (!id) return ALL_SPORT_IDS.length
  const idx = ALL_SPORT_IDS.indexOf(id)
  return idx === -1 ? ALL_SPORT_IDS.length : idx
}

/** Flatten registrations, then number Confirmed 1…N / Waiting 1…N per sport+gender (oldest first). */
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
    const key = `${row.sport.sportId}:${row.registration.gender}:${row.sport.status ?? 'confirmed'}`
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
    list.forEach((row, i) => {
      row.seatNumber = i + 1
    })
  }

  return rows
}

/** Confirmed 1…N then Waiting 1…N within each sport (+ gender when not filtered). */
function sortSeatRows(rows: FlatRow[]): FlatRow[] {
  return [...rows].sort((a, b) => {
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
    genderLabel(r.gender),
    s ? sportLabel(s.sportId) : '',
    s?.format ?? '',
    s?.status ?? '',
    statusLabel(row),
    s?.player1Name ?? '',
    s?.player1Mobile ?? '',
    s?.player2Name ?? '',
    s?.player2Mobile ?? '',
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
      <td class="col-sport">${s ? escapeHtml(sportLabel(s.sportId)) : '—'}</td>
      <td>${escapeHtml(r.fullName)}</td>
      <td>${escapeHtml(genderLabel(r.gender))}</td>
      <td>${s ? escapeHtml(formatLabel(s.format, s.sportId)) : '—'}</td>
      <td>${escapeHtml(r.mobile)}</td>
      <td>${escapeHtml(r.location)}</td>
      <td>${escapeHtml(s?.player1Name || '—')}</td>
      <td>${escapeHtml(s?.player1Mobile || '—')}</td>
      <td>${escapeHtml(s?.player2Name || '—')}</td>
      <td>${escapeHtml(s?.player2Mobile || '—')}</td>
      <td class="col-ref"><code>${escapeHtml(r.id)}</code></td>
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
              <select name="format">
                <option value="single" ${sport.format !== 'double' ? 'selected' : ''}>Singles / Team</option>
                <option value="double" ${sport.format === 'double' ? 'selected' : ''}>Doubles</option>
              </select>
            </label>
            <label>Player 1 name
              <input name="player1Name" type="text" value="${escapeHtml(sport.player1Name ?? '')}" />
            </label>
            <label>Player 1 mobile
              <input name="player1Mobile" type="tel" value="${escapeHtml(sport.player1Mobile ?? '')}" />
            </label>
            <label>Player 2 name
              <input name="player2Name" type="text" value="${escapeHtml(sport.player2Name ?? '')}" />
            </label>
            <label>Player 2 mobile
              <input name="player2Mobile" type="tel" value="${escapeHtml(sport.player2Mobile ?? '')}" />
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
  sportId: SportId | null,
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
  await Promise.all([refreshRegistrations(), refreshCapacities()])
  syncCapacityDraftFromLive()
  tableMessage = message
  tableError = ''
  tableBusy = false
  renderAdmin(root)
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replaceAll('"', '""')}"`
  return value
}

function downloadCsv(rows: FlatRow[]): void {
  const headers = [
    '#',
    'Seat',
    'Sport',
    'Full Name',
    'Gender',
    'Format',
    'Mobile',
    'Location',
    'Player 1 Name',
    'Player 1 Mobile',
    'Player 2 Name',
    'Player 2 Mobile',
    'Reference',
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
        s ? sportLabel(s.sportId) : '',
        r.fullName,
        genderLabel(r.gender),
        s ? formatLabel(s.format, s.sportId) : '',
        r.mobile,
        r.location,
        s?.player1Name ?? '',
        s?.player1Mobile ?? '',
        s?.player2Name ?? '',
        s?.player2Mobile ?? '',
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
    if (!editingCap) syncCapacityDraftFromLive()
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

export function renderAdmin(root: HTMLElement): void {
  ensureAdminRealtime(root)

  const apiError = getStorageError()
  const regs = getRegistrations()
  const allRows = flattenRows(regs)
  const confirmedCount = allRows.filter(
    (r) => r.sport?.status === 'confirmed',
  ).length
  const waitingCount = allRows.filter(
    (r) => r.sport?.status === 'waiting',
  ).length
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
      allRows.filter((row) => row.sport?.sportId === id).length,
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

    <div class="shell shell-admin">
      <header class="brand brand-admin">
        <div class="brand-mark">
          <div class="brand-ring" aria-hidden="true"></div>
        </div>
        <h1>CHANSMA OLYMPIC</h1>
        <p>Admin dashboard · all registrations</p>
      </header>

      <main class="panel panel-admin">
        <section class="capacity-panel">
          <div class="capacity-top">
            <div class="capacity-intro">
              <p class="capacity-kicker">Live settings</p>
              <h2 class="capacity-title">Slot counts</h2>
              <p class="capacity-sub">Men and women capacity per sport. Apply rebalances confirmed vs waiting by registration time and updates live badges.</p>
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
              </tbody>
            </table>
          </div>
        </section>

        <div class="admin-toolbar">
          <div class="admin-stats">
            <span><strong>${regs.length}</strong> registrations</span>
            <span><strong>${allRows.length}</strong> sport seats</span>
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
            <button type="button" class="btn btn-ghost btn-danger" data-admin="bulk-delete" ${tableBusy || !selectedKeys.size ? 'disabled' : ''}>${withIcon(iconTrash(), `Delete selected (${selectedKeys.size})`)}</button>
            <button type="button" class="btn btn-ghost btn-danger" data-admin="reset-db" ${tableBusy ? 'disabled' : ''}>Reset DB</button>
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
          <p class="filter-hint">Rows are ordered Confirmed 1, 2, 3… then Waiting 1, 2, 3… per sport and gender (oldest registration first). Seat counts recalculate after edit, delete, or reset.</p>
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
                <th class="col-sport">Sport</th>
                <th>Full name</th>
                <th>Gender</th>
                <th>Format</th>
                <th>Mobile</th>
                <th>Location</th>
                <th>Player 1</th>
                <th>P1 mobile</th>
                <th>Player 2</th>
                <th>P2 mobile</th>
                <th>Reference</th>
                <th>Registered</th>
                <th class="col-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${
                rows.length
                  ? rows.map((row, i) => rowHtml(row, i)).join('')
                  : `<tr><td colspan="16" class="admin-empty">No rows match these filters.</td></tr>`
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

  root.querySelectorAll<HTMLButtonElement>('[data-admin]').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.stopPropagation()
      const action = btn.dataset.admin
      if (action === 'refresh') {
        void Promise.all([refreshRegistrations(), refreshCapacities()]).then(
          () => {
            syncCapacityDraftFromLive()
            capacityMessage = ''
            capacityError = ''
            tableMessage = ''
            tableError = ''
            renderAdmin(root)
          },
        )
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
      } else if (action === 'apply-capacities') {
        capacitySaving = true
        capacityError = ''
        capacityMessage = ''
        renderAdmin(root)
        void saveCapacities(ensureCapacityDraft())
          .then(() => {
            syncCapacityDraftFromLive()
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
          const format = (String(data.get('format') || s.format) ||
            'single') as PlayFormat
          const updated: SelectedSport = {
            ...s,
            format,
            player1Name: String(data.get('player1Name') || '').trim(),
            player1Mobile: normalizeMobile(
              String(data.get('player1Mobile') || ''),
            ),
            player2Name: String(data.get('player2Name') || '').trim(),
            player2Mobile: normalizeMobile(
              String(data.get('player2Mobile') || ''),
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
