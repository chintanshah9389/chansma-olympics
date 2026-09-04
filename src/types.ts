export type SportId =
  | 'football'
  | 'pickleball'
  | 'carrom'
  | 'chess'
  | 'tt'
  | 'badminton'

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
}

export interface DoublesPlayers {
  player1: DoublesPlayer
  player2: DoublesPlayer
}

export interface SelectedSport {
  sportId: SportId
  format: PlayFormat
  status: SportSeatStatus
  player1Name?: string
  player1Mobile?: string
  player2Name?: string
  player2Mobile?: string
}

export interface Registration {
  id: string
  fullName: string
  mobile: string
  location: string
  gender: Gender
  sports: SelectedSport[]
  createdAt: string
}

export interface FormState {
  fullName: string
  mobile: string
  location: string
  gender: Gender | null
  primarySport: SportId | null
  secondarySports: SportId[]
  formats: Partial<Record<SportId, PlayFormat>>
  doublesPlayers: Partial<Record<SportId, DoublesPlayers>>
}

/** 1 Details · 2 Sports · 3 Format · 4 Review · 5 Success */
export type WizardStep = 1 | 2 | 3 | 4 | 5
