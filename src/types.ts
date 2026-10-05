export type SportId =
  | 'football'
  | 'pickleball'
  | 'carrom'
  | 'chess'
  | 'tt'
  | 'badminton'

/** Olympic games plus the two cricket events stored on a registration row. */
export type SeatSportId = SportId | 'turf' | 'overarm'

export type Gender = 'male' | 'female'

export type PlayFormat = 'single' | 'double'

/** Confirmed fills a slot; waiting is waitlisted when full */
export type SportSeatStatus = 'confirmed' | 'waiting'

export interface SportConfig {
  id: SportId
  label: string
  /** Separate men's / women's tournament capacity */
  capacityMale: number
  capacityFemale: number
  needsFormat: boolean
}

export interface DoublesPlayer {
  fullName: string
  mobile: string
  age: string
}

export interface DoublesPlayers {
  player1: DoublesPlayer
  player2: DoublesPlayer
}

export interface SelectedSport {
  sportId: SeatSportId
  format: PlayFormat
  status: SportSeatStatus
  player1Name?: string
  player1Mobile?: string
  player1Age?: number
  player2Name?: string
  player2Mobile?: string
  player2Age?: number
  skill?: string
  birthDate?: string
  fatherName?: string
  grandfatherName?: string
  surname?: string
  photoUrl?: string
}

export interface Registration {
  id: string
  /** Which introduction section this entry belongs to */
  event: 'overarm' | 'indoor' | 'turf'
  fullName: string
  mobile: string
  location: string
  gender: Gender
  sports: SelectedSport[]
  createdAt: string
  receiptNo?: string
  payMode?: '' | 'online' | 'cash'
  paidTo?: string
  amount?: number
  /** Site path such as /uploads/payments/….jpg */
  paymentShotUrl?: string
}

export interface FormState {
  fullName: string
  mobile: string
  age: string
  location: string
  gender: Gender | null
  primarySport: SportId | null
  secondarySports: SportId[]
  formats: Partial<Record<SportId, PlayFormat>>
  doublesPlayers: Partial<Record<SportId, DoublesPlayers>>
}

/** 1 Details · 2 Sports · 3 Format · 4 Review · 5 Success */
export type WizardStep = 1 | 2 | 3 | 4 | 5
