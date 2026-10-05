import type { SeatSportId, SportId } from './types'

const svg = (body: string, className = 'icon'): string =>
  `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`

export const iconUser = (): string =>
  svg(
    `<path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="8" r="4"/>`,
  )

export const iconPhone = (): string =>
  svg(
    `<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.6a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.5-1.1a2 2 0 0 1 2.1-.4c.8.3 1.7.5 2.6.6a2 2 0 0 1 1.7 2z"/>`,
  )

export const iconPin = (): string =>
  svg(
    `<path d="M12 22s7-5.2 7-12a7 7 0 1 0-14 0c0 6.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/>`,
  )

export const iconCamera = (): string =>
  svg(
    `<path d="M4 8h3l1.5-2h7L17 8h3a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z"/><circle cx="12" cy="13" r="3.2"/>`,
  )

function sportImage(file: string): string {
  return `<img class="icon sport-icon" src="/icons/${file}" alt="" />`
}

export const iconCricket = (): string => sportImage('photo-cricket.jpg')

export const iconArrowRight = (): string =>
  svg(`<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>`, 'icon icon-sm')

export const iconArrowLeft = (): string =>
  svg(`<path d="M19 12H5"/><path d="m11 18-6-6 6-6"/>`, 'icon icon-sm')

export const iconCheck = (): string =>
  svg(`<path d="M20 6 9 17l-5-5"/>`, 'icon icon-sm')

export const iconSpark = (): string =>
  svg(
    `<path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>`,
  )

export const iconLive = (): string =>
  svg(
    `<circle cx="12" cy="12" r="3"/><path d="M12 5a7 7 0 0 1 7 7"/><path d="M12 2a10 10 0 0 1 10 10"/>`,
    'icon icon-sm',
  )

export const iconAdmin = (): string =>
  svg(
    `<path d="M12 3 4 7v5c0 5 3.4 8.4 8 9 4.6-.6 8-4 8-9V7l-8-4z"/><path d="m9 12 2 2 4-4"/>`,
    'icon icon-sm',
  )

export const iconRefresh = (): string =>
  svg(
    `<path d="M21 12a9 9 0 1 1-2.6-6.3"/><path d="M21 3v6h-6"/>`,
    'icon icon-sm',
  )

export const iconReset = (): string =>
  svg(
    `<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>`,
    'icon icon-sm',
  )

export const iconDownload = (): string =>
  svg(
    `<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>`,
    'icon icon-sm',
  )

export const iconShare = (): string =>
  svg(
    `<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4"/><path d="m15.4 6.5-6.8 4"/>`,
    'icon icon-sm',
  )

export const iconTrash = (): string =>
  svg(
    `<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6"/><path d="M14 11v6"/>`,
    'icon icon-sm',
  )

export const iconClear = (): string =>
  svg(
    `<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6"/><path d="m15 9-6 6"/>`,
    'icon icon-sm',
  )

export const iconEdit = (): string =>
  svg(
    `<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>`,
    'icon icon-sm',
  )

export const iconCopy = (): string =>
  svg(
    `<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>`,
    'icon icon-sm',
  )

export const iconMale = (): string =>
  svg(
    `<circle cx="10" cy="14" r="5"/><path d="M14.5 9.5 21 3"/><path d="M15 3h6v6"/>`,
  )

export const iconFemale = (): string =>
  svg(
    `<circle cx="12" cy="9" r="5"/><path d="M12 14v7"/><path d="M9 18h6"/>`,
  )

export const iconSingle = (): string =>
  svg(`<circle cx="12" cy="8" r="3.5"/><path d="M6 20a6 6 0 0 1 12 0"/>`)

export const iconDouble = (): string =>
  svg(
    `<circle cx="8" cy="9" r="3"/><circle cx="16" cy="9" r="3"/><path d="M2.5 20a5.5 5.5 0 0 1 11 0"/><path d="M10.5 20a5.5 5.5 0 0 1 11 0"/>`,
  )

const sportFiles: Record<SportId, string> = {
  football: 'photo-football.jpg',
  pickleball: 'photo-pickleball.jpg',
  carrom: 'photo-carrom.jpg',
  chess: 'photo-chess.jpg',
  tt: 'photo-table-tennis.jpg',
  badminton: 'photo-badminton.jpg',
}

export function sportIcon(id: SeatSportId): string {
  if (id === 'turf' || id === 'overarm') return iconCricket()
  return sportImage(sportFiles[id])
}

export function withIcon(iconHtml: string, label: string): string {
  return `<span class="btn-inner">${iconHtml}<span>${label}</span></span>`
}
