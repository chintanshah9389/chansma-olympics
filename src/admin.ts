import {
  getRegistrations,
  getStorageError,
  refreshRegistrations,
} from './storage'
import { genderLabel, sportLabel } from './sports'
import type { Registration, SelectedSport } from './types'
import { onRealtimeUpdate } from './realtime'

type FlatRow = {
  registration: Registration
  sport: SelectedSport | null
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

function formatLabel(format: SelectedSport['format'], sportId: SelectedSport['sportId']): string {
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

function rowHtml(row: FlatRow, index: number): string {
  const r = row.registration
  const s = row.sport
  const status = s?.status ?? '—'
  const statusClass =
    status === 'waiting' ? 'is-waiting' : status === 'confirmed' ? 'is-confirmed' : ''

  return `
    <tr>
      <td class="col-num">${index + 1}</td>
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

let searchQuery = ''
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
  const rows = allRows.filter((row) => matchesQuery(row, searchQuery.trim().toLowerCase()))

  root.innerHTML = `
    <div class="shell shell-admin">
      <header class="brand brand-admin">
        <div class="brand-mark">
          <div class="brand-ring" aria-hidden="true"></div>
        </div>
        <h1>CHANSMA OLYMPIC</h1>
        <p>Registration Admin</p>
      </header>

      <main class="panel panel-admin">
        <div class="admin-toolbar">
          <div class="admin-stats">
            <span><strong>${regs.length}</strong> registrations</span>
            <span><strong>${allRows.length}</strong> sport entries</span>
            ${searchQuery ? `<span>Showing <strong>${rows.length}</strong></span>` : ''}
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
            <a class="btn btn-primary" href="#/">Registration form</a>
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
                  : `<tr><td colspan="13" class="admin-empty">No registrations yet.</td></tr>`
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

  root.querySelectorAll<HTMLButtonElement>('[data-admin]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.admin
      if (action === 'refresh') {
        void refreshRegistrations().then(() => renderAdmin(root))
      } else if (action === 'csv') {
        downloadCsv(rows)
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
