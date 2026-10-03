import type { SportId } from './types'

export type EventId = 'overarm' | 'indoor' | 'turf'

export interface EventSport {
  en: string
  gu: string
  sportId?: SportId
}

export interface TournamentEvent {
  id: EventId
  title: string
  titleGu: string
  date: string
  dateGu: string
  day: string
  month: string
  year: string
  weekday: string
  weekdayGu: string
  sports: EventSport[]
}

export const EVENTS: TournamentEvent[] = [
  {
    id: 'overarm',
    title: 'Overarm cricket',
    titleGu: 'ઓવરઆર્મ ક્રિકેટ',
    date: '13 December 2026',
    dateGu: '૧૩ ડિસેમ્બર ૨૦૨૬',
    day: '13',
    month: 'Dec',
    year: '2026',
    weekday: 'Sunday',
    weekdayGu: 'રવિવાર',
    sports: [{ en: 'Overarm cricket', gu: 'ઓવરઆર્મ ક્રિકેટ' }],
  },
  {
    id: 'indoor',
    title: 'Indoor sports',
    titleGu: 'ઇન્ડોર સ્પોર્ટ્સ',
    date: '9 January 2027',
    dateGu: '૯ જાન્યુઆરી ૨૦૨૭',
    day: '09',
    month: 'Jan',
    year: '2027',
    weekday: 'Saturday',
    weekdayGu: 'શનિવાર',
    sports: [
      { en: 'Football', gu: 'ફૂટબોલ', sportId: 'football' },
      { en: 'Pickleball', gu: 'પિકલબોલ', sportId: 'pickleball' },
      { en: 'Carrom', gu: 'કેરમ', sportId: 'carrom' },
      { en: 'Chess', gu: 'ચેસ', sportId: 'chess' },
      { en: 'Table Tennis', gu: 'ટેબલ ટેનિસ', sportId: 'tt' },
      { en: 'Badminton', gu: 'બેડમિન્ટન', sportId: 'badminton' },
    ],
  },
  {
    id: 'turf',
    title: 'Turf cricket',
    titleGu: 'ટર્ફ ક્રિકેટ',
    date: '10 January 2027',
    dateGu: '૧૦ જાન્યુઆરી ૨૦૨૭',
    day: '10',
    month: 'Jan',
    year: '2027',
    weekday: 'Sunday',
    weekdayGu: 'રવિવાર',
    sports: [{ en: 'Turf cricket', gu: 'ટર્ફ ક્રિકેટ' }],
  },
]

/** Seat totals. Turf men and women are separate. Overarm is men only. */
export type CricketCapacities = {
  turf: { male: number; female: number }
  overarm: { male: number }
}

export const DEFAULT_CRICKET_CAPACITY: CricketCapacities = {
  turf: { male: 16, female: 12 },
  overarm: { male: 20 },
}

let liveCricketCapacity: CricketCapacities = {
  turf: { ...DEFAULT_CRICKET_CAPACITY.turf },
  overarm: { ...DEFAULT_CRICKET_CAPACITY.overarm },
}

export function getCricketCapacities(): CricketCapacities {
  return {
    turf: { ...liveCricketCapacity.turf },
    overarm: { ...liveCricketCapacity.overarm },
  }
}

export function applyCricketCapacities(
  input: Partial<CricketCapacities> | null | undefined,
): CricketCapacities {
  const turf = input?.turf
  const overarm = input?.overarm
  const maleTurf = Math.floor(Number(turf?.male))
  const femaleTurf = Math.floor(Number(turf?.female))
  const maleOverarm = Math.floor(Number(overarm?.male))
  liveCricketCapacity = {
    turf: {
      male:
        Number.isFinite(maleTurf) && maleTurf >= 0
          ? maleTurf
          : DEFAULT_CRICKET_CAPACITY.turf.male,
      female:
        Number.isFinite(femaleTurf) && femaleTurf >= 0
          ? femaleTurf
          : DEFAULT_CRICKET_CAPACITY.turf.female,
    },
    overarm: {
      male:
        Number.isFinite(maleOverarm) && maleOverarm >= 0
          ? maleOverarm
          : DEFAULT_CRICKET_CAPACITY.overarm.male,
    },
  }
  return getCricketCapacities()
}

export function isEventId(value: string | null | undefined): value is EventId {
  return value === 'overarm' || value === 'indoor' || value === 'turf'
}

export function eventById(id: string | null | undefined): TournamentEvent {
  return EVENTS.find((event) => event.id === id) ?? EVENTS[1]
}
