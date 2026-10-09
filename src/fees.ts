import type { SeatSportId, SportId } from './types'

export type FeeId = SeatSportId

/** Default entry fee in rupees for each player. Admin can change these live. */
export const DEFAULT_FEES: Record<FeeId, number> = {
  football: 500,
  pickleball: 500,
  carrom: 250,
  chess: 250,
  tt: 250,
  badminton: 300,
  turf: 700,
  overarm: 700,
}

const FEE_IDS = Object.keys(DEFAULT_FEES) as FeeId[]

let liveFees: Record<FeeId, number> = { ...DEFAULT_FEES }

export function getFees(): Record<FeeId, number> {
  return { ...liveFees }
}

export function getFee(id: FeeId): number {
  return liveFees[id] ?? DEFAULT_FEES[id]
}

export function applyFees(
  input: Partial<Record<FeeId, number>> | null | undefined,
): Record<FeeId, number> {
  const next = { ...DEFAULT_FEES }
  for (const id of FEE_IDS) {
    const value = Math.floor(Number(input?.[id]))
    next[id] = Number.isFinite(value) && value >= 0 ? value : DEFAULT_FEES[id]
  }
  liveFees = next
  return getFees()
}

/** @deprecated Use getFee(). Kept so older imports still compile. */
export const SPORT_FEE: Record<SportId, number> = {
  football: DEFAULT_FEES.football,
  pickleball: DEFAULT_FEES.pickleball,
  carrom: DEFAULT_FEES.carrom,
  chess: DEFAULT_FEES.chess,
  tt: DEFAULT_FEES.tt,
  badminton: DEFAULT_FEES.badminton,
}

/** Kotak QR is shown only when the total is under this amount. */
export const QR_LIMIT = 2000

export const UPI_ID = '7977563236@kotakbank'

export const BANK = {
  name: 'NIHAR KETAN SHAH',
  account: '1947523638',
  ifsc: 'KKBK0001398',
  branch: 'MUMBAI - BORIVALI(EAST) - M.G.ROAD',
} as const

export const CASH_COLLECTORS = [
  'SHAILEN BHAI',
  'HARSHIL BHAI',
  'YOGESH BHAI',
  'NIHAR',
  'TUSHAR BHAI',
  'TUSHAR BHAI BC',
  'CHIRAG BHAI - BHAYANDAR',
  'CHIRAG - PRAMOD BHAI',
  'CHIRAG BHAI - DAHISHAR',
  'ANADBHAI',
  'PREMAL BHAI',
  'RIKIN',
  'DAIVESH BHAI',
  'RAHUL BHAI',
  'KETAN BHAI',
  'AMIT BHAI'
] as const
