import {
  getRegistrations,
  getStorageError,
  refreshRegistrations,
} from './storage'
import { SPORTS, genderLabel, sportLabel } from './sports'
import type { Gender, Registration, SelectedSport, SportId, SportSeatStatus } from './types'
import { onRealtimeUpdate } from './realtime'

type FlatRow = {
  registration: Registration
  sport: SelectedSport | null
}

type SportFilter = 'all' | SportId
type GenderFilter = 'all' | Gender
type StatusFilter = 'all' | SportSeatStatus

const ALL_SPORT_IDS = Object.keys(SPORTS) as SportId[]

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

export function destroyAdmin(): void {
  unsubRealtime?.()
  unsubRealtime = null
}

export function renderAdmin(root: HTMLElement): void {
  destroyAdmin()

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

  root.innerHTML = `
    <a class="nav-corner nav-corner-left" href="#/">← Form</a>

    <div class="shell shell-admin">
      <header class="brand brand-admin">
        <div class="brand-mark">
          <div class="brand-ring" aria-hidden="true"></div>
        </div>
        <h1>CHANSMA OLYMPIC</h1>
        <p>Admin dashboard · all registrations</p>
      </header>

      <main class="panel panel-admin">
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
            <button type="button" class="btn btn-ghost" data-admin="refresh">Refresh</button>
            <button type="button" class="btn btn-ghost" data-admin="csv">Export CSV</button>
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
    const again = root.querySelector<HTMLInputElement>('input[name="adminSearch"]')
    if (again) {
      again.focus()
      const len = again.value.length
      again.setSelectionRange(len, len)
    }
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

  root.querySelectorAll<HTMLButtonElement>('[data-admin]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.admin
      if (action === 'refresh') {
        void refreshRegistrations().then(() => renderAdmin(root))
      } else if (action === 'csv') {
        downloadCsv(rows)
      } else if (action === 'clear') {
        searchQuery = ''
        sportFilter = 'all'
        genderFilter = 'all'
        statusFilter = 'all'
        renderAdmin(root)
      }
    })
  })

  unsubRealtime = onRealtimeUpdate(() => {
    renderAdmin(root)
  })
}

export function isAdminRoute(): boolean {
  const hash = location.hash.replace(/^#/, '')
  return hash === '/admin' || hash.startsWith('/admin/')
}
