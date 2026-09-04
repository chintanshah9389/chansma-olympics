import {
  getRegistrations,
  getStorageError,
  refreshCapacities,
  refreshRegistrations,
  saveCapacities,
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
  iconRefresh,
  sportIcon,
  withIcon,
} from './icons'
import type { Gender, Registration, SelectedSport, SportId, SportSeatStatus } from './types'
import { onRealtimeUpdate } from './realtime'

type FlatRow = {
  registration: Registration
  sport: SelectedSport | null
}

type SportFilter = 'all' | SportId
type GenderFilter = 'all' | Gender
type StatusFilter = 'all' | SportSeatStatus

let capacityDraft: SportCapacities | null = null
let capacityMessage = ''
let capacityError = ''
let capacitySaving = false

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

function flattenRows(regs: Registration[]): FlatRow[] {
  const rows: FlatRow[] = []
  for (const registration of regs) {
    if (!registration.sports.length) {
      rows.push({ registration, sport: null })
      continue
    }
    for (const sport of registration.sports) {
      rows.push({ registration, sport })
    }
  }
  return rows
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
  const status = s?.status ?? '—'
  const statusClass =
    status === 'waiting'
      ? 'is-waiting'
      : status === 'confirmed'
        ? 'is-confirmed'
        : ''

  return `
    <tr>
      <td class="col-num">${index + 1}</td>
      <td class="col-ref"><code>${escapeHtml(r.id)}</code></td>
      <td>${escapeHtml(r.fullName)}</td>
      <td>${escapeHtml(r.mobile)}</td>
      <td>${escapeHtml(r.location)}</td>
      <td>${escapeHtml(genderLabel(r.gender))}</td>
      <td>${s ? escapeHtml(sportLabel(s.sportId)) : '—'}</td>
      <td>${s ? escapeHtml(formatLabel(s.format, s.sportId)) : '—'}</td>
      <td><span class="status-pill ${statusClass}">${escapeHtml(status)}</span></td>
      <td>${escapeHtml(s?.player1Name || '—')}</td>
      <td>${escapeHtml(s?.player1Mobile || '—')}</td>
      <td>${escapeHtml(s?.player2Name || '—')}</td>
      <td>${escapeHtml(s?.player2Mobile || '—')}</td>
      <td class="col-when">${escapeHtml(formatWhen(r.createdAt))}</td>
    </tr>
  `
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replaceAll('"', '""')}"`
  return value
}

function downloadCsv(rows: FlatRow[]): void {
  const headers = [
    '#',
    'Reference',
    'Full Name',
    'Mobile',
    'Location',
    'Gender',
    'Sport',
    'Format',
    'Status',
    'Player 1 Name',
    'Player 1 Mobile',
    'Player 2 Name',
    'Player 2 Mobile',
    'Registered At',
  ]

  const lines = [
    headers.join(','),
    ...rows.map((row, i) => {
      const r = row.registration
      const s = row.sport
      return [
        String(i + 1),
        r.id,
        r.fullName,
        r.mobile,
        r.location,
        genderLabel(r.gender),
        s ? sportLabel(s.sportId) : '',
        s ? formatLabel(s.format, s.sportId) : '',
        s?.status ?? '',
        s?.player1Name ?? '',
        s?.player1Mobile ?? '',
        s?.player2Name ?? '',
        s?.player2Mobile ?? '',
        r.createdAt,
      ]
        .map((cell) => csvEscape(cell))
        .join(',')
    }),
  ]

  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
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
  const regs = [...getRegistrations()].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )
  const allRows = flattenRows(regs)
  const rows = allRows.filter(
    (row) =>
      matchesFilters(row, sportFilter, genderFilter, statusFilter) &&
      matchesQuery(row, searchQuery.trim().toLowerCase()),
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
            <span><strong>${allRows.length}</strong> sport entries</span>
            <span>Showing <strong>${rows.length}</strong></span>
          </div>
          <div class="admin-actions">
            <input
              type="search"
              class="admin-search"
              name="adminSearch"
              placeholder="Search name, mobile, sport…"
              value="${escapeHtml(searchQuery)}"
              autocomplete="off"
            />
            <button type="button" class="btn btn-ghost" data-admin="refresh">${withIcon(iconRefresh(), 'Refresh')}</button>
            <button type="button" class="btn btn-ghost" data-admin="csv">${withIcon(iconDownload(), 'Export CSV')}</button>
            ${
              filtersActive
                ? `<button type="button" class="btn btn-ghost" data-admin="clear">Clear filters</button>`
                : ''
            }
          </div>
        </div>

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
              ${filterChip('All', statusFilter === 'all', 'data-filter-status="all"')}
              ${filterChip('Confirmed', statusFilter === 'confirmed', 'data-filter-status="confirmed"')}
              ${filterChip('Waiting', statusFilter === 'waiting', 'data-filter-status="waiting"')}
            </div>
          </div>
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
                <th>#</th>
                <th>Reference</th>
                <th>Full name</th>
                <th>Mobile</th>
                <th>Location</th>
                <th>Gender</th>
                <th>Sport</th>
                <th>Format</th>
                <th>Status</th>
                <th>Player 1</th>
                <th>P1 mobile</th>
                <th>Player 2</th>
                <th>P2 mobile</th>
                <th>Registered</th>
              </tr>
            </thead>
            <tbody>
              ${
                rows.length
                  ? rows.map((row, i) => rowHtml(row, i)).join('')
                  : `<tr><td colspan="14" class="admin-empty">No rows match these filters.</td></tr>`
              }
            </tbody>
          </table>
        </div>
      </main>
    </div>
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
    btn.addEventListener('click', () => {
      const action = btn.dataset.admin
      if (action === 'refresh') {
        void Promise.all([refreshRegistrations(), refreshCapacities()]).then(
          () => {
            syncCapacityDraftFromLive()
            capacityMessage = ''
            capacityError = ''
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
