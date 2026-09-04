/** Bilingual EN / Gujarati helpers for the public registration form only. */

export function bi(en: string, gu: string): string {
  return `<span class="i18n-line"><span class="i18n-en">${en}</span><span class="i18n-sep" aria-hidden="true">/</span><span class="i18n-gu">${gu}</span></span>`
}

export function biText(en: string, gu: string): string {
  return `${en} / ${gu}`
}

/** Turn a bi() HTML string or biText plain "EN / GU" into stacked bilingual markup. */
export function bilingualHtml(message: string): string {
  if (message.includes('i18n-line')) return message
  const sep = ' / '
  const idx = message.indexOf(sep)
  if (idx === -1) return escapePlain(message)
  return bi(escapePlain(message.slice(0, idx)), escapePlain(message.slice(idx + sep.length)))
}

function escapePlain(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

export const GU = {
  brandSub: 'ટુર્નામેન્ટ રજિસ્ટ્રેશન',
  steps: {
    details: 'વિગતો',
    sports: 'રમતો',
    format: 'ફોર્મેટ',
    review: 'સમીક્ષા',
  },
  detailsTitle: 'તમારી વિગતો દાખલ કરો',
  detailsSub: 'માત્ર મૂળભૂત માહિતી — આ સ્ટેપમાં મોબાઇલ ચકાસાતો નથી.',
  fullName: 'પૂરું નામ',
  mobile: 'મોબાઇલ નંબર',
  location: 'સ્થાન',
  placeholderName: 'દા.ત. રાહુલ શર્મા',
  placeholderMobile: 'મોબાઇલ નંબર',
  placeholderLocation: 'શહેર / વિસ્તાર',
  continue: 'આગળ વધો',
  back: 'પાછળ',
  review: 'સમીક્ષા',
  submit: 'રજિસ્ટ્રેશન સબમિટ કરો',
  registerAnother: 'બીજા ખેલાડીની નોંધણી કરો',

  sportsTitle: 'રમતો પસંદ કરો',
  sportsSub:
    'પહેલા પુરુષ અથવા સ્ત્રી પસંદ કરો — પુરુષ અને સ્ત્રી ટુર્નામેન્ટના સ્લોટ અલગ છે.',
  genderLabel: 'લિંગ — એક પસંદ કરો',
  genderHint: 'પુરુષ અને સ્ત્રી ટુર્નામેન્ટ અલગ ગણાય છે',
  male: 'પુરુષ',
  maleMeta: 'પુરુષ ટુર્નામેન્ટ',
  female: 'સ્ત્રી',
  femaleMeta: 'સ્ત્રી ટુર્નામેન્ટ',
  mainSport: 'મુખ્ય રમત — એક પસંદ કરો',
  mainHintMale: 'ફૂટબોલ અથવા પિકલબોલ',
  mainHintFemale: 'પિકલબોલ (ફૂટબોલ ફક્ત પુરુષો માટે)',
  extraSports: 'વધારાની રમતો — વૈકલ્પિક (મહત્તમ ૨)',
  extraHint: 'કેરમ, ચેસ, ટેબલ ટેનિસ, બેડમિન્ટન — છોડી શકો અથવા ૨ સુધી પસંદ કરો',

  formatTitle: 'ફોર્મેટ અને ખેલાડી વિગતો',
  playerDetailsTitle: 'ખેલાડી વિગતો',
  formatSub:
    'દરેક રમત માટે પૂરું નામ અને મોબાઇલ જરૂરી છે.',
  formatSubRacket: 'રેકેટ રમતો માટે સિંગલ અથવા ડબલ પણ પસંદ કરો. ',
  playerOnlyHint: (sport: string) =>
    `${sport} માટે ખેલાડીનું પૂરું નામ અને મોબાઇલ દાખલ કરો.`,
  playerDetails: 'ખેલાડી વિગતો',
  player2: 'ખેલાડી ૨',
  single: 'સિંગલ',
  singleMeta: 'આયોજક પાર્ટનર આપશે',
  double: 'ડબલ',
  doubleMeta: 'તમારો પાર્ટનર પસંદ કરો',
  organizerTitle: 'બીજો ખેલાડી',
  organizerBody: (sport: string) =>
    `અમે તમને બીજો ખેલાડી આપીશું. કૃપા કરીને અમારા જવાબની રાહ જુઓ. તમે પાર્ટનર પસંદ કરી શકતા નથી — ${sport} માટે આયોજક જે પાર્ટનર આપે તેની સાથે રમવું પડશે.`,

  reviewTitle: 'સમીક્ષા અને સબમિટ',
  reviewSub: 'તમારી વિગતો અને રમતો ચકાસો. ભરાયેલી રમતો વેઇટિંગ લિસ્ટમાં જશે.',
  waitingAlert:
    'કેટલીક રમતો ભરાઈ ગઈ છે — તે રમતો માટે તમને વેઇટિંગ લિસ્ટમાં મૂકવામાં આવશે.',
  waitingDetail: 'ખુલ્લા સ્લોટ નથી — આ રમત માટે વેઇટિંગ તરીકે નોંધાયા છો.',
  alreadyRegistered: 'પહેલેથી નોંધાયેલ',
  waitingList: 'વેઇટિંગ લિસ્ટ',
  confirmed: 'કન્ફર્મ્ડ',
  availableConfirmed: (n: number) => `${n} ઉપલબ્ધ · કન્ફર્મ્ડ`,
  tournament: 'ટુર્નામેન્ટ',

  successTitle: 'તમે રજિસ્ટર થઈ ગયા!',
  successSaved: 'માટે રજિસ્ટ્રેશન સેવ થયું',
  referenceLabel: 'તમારો રેફરન્સ નંબર',
  referenceHint:
    'આ નંબર સાચવી રાખો — રજિસ્ટ્રેશન અંગે આયોજકોને સંપર્ક કરો તો તેનો ઉપયોગ કરો.',
  copyReference: 'રેફરન્સ કૉપી કરો',
  waiting: 'વેઇટિંગ',

  men: 'પુરુષ',
  women: 'સ્ત્રી',
  fullWaiting: 'ભરાયું · વેઇટિંગ',
  left: 'બાકી',
  slotsLeft: 'સ્લોટ બાકી',
  selectGenderFirst: 'પહેલા લિંગ પસંદ કરો',
  joinWaiting: 'ભરાયું — વેઇટિંગમાં જોડાઓ',

  errFullName: 'પૂરું નામ જરૂરી છે',
  errLocation: 'સ્થાન જરૂરી છે',
  errSelectGender: 'પહેલા પુરુષ અથવા સ્ત્રી પસંદ કરો',
  errPickleballFemale: 'મુખ્ય રમત તરીકે પિકલબોલ પસંદ કરો',
  errFootballOrPickle: 'ફૂટબોલ અથવા પિકલબોલ પસંદ કરો',
  errMaxExtra: 'વધુમાં વધુ ૨ વધારાની રમતો પસંદ કરી શકો',
  errMobileRequired: 'મોબાઇલ નંબર જરૂરી છે',
  errMobileValid: 'માન્ય ૧૦ અંકનો મોબાઇલ નંબર દાખલ કરો',
  errSelectFormat: 'દરેક રેકેટ રમત માટે સિંગલ અથવા ડબલ પસંદ કરો',
  errPlayer2Name: 'ખેલાડી ૨ નું પૂરું નામ જરૂરી છે',
  errPlayer2Mobile: 'ખેલાડી ૨ નો મોબાઇલ નંબર જરૂરી છે',
  errPlayer2MobileValid: 'ખેલાડી ૨ માટે માન્ય ૧૦ અંકનો મોબાઇલ દાખલ કરો',
  errNamesDifferent: 'ખેલાડી ૨ નું નામ ખેલાડી ૧ થી અલગ હોવું જોઈએ',
  errMobilesDifferent: 'ખેલાડી ૨ નો મોબાઇલ ખેલાડી ૧ થી અલગ હોવો જોઈએ',
  errFixPlayers:
    'ખેલાડી વિગતો સુધારો — પૂરું નામ અને મોબાઇલ જરૂરી છે, અને મોબાઇલ આ રમત માટે પહેલેથી નોંધાયેલ હોઈ શકે',
  errSelectGenderSubmit: 'સબમિટ કરતા પહેલા પુરુષ અથવા સ્ત્રી પસંદ કરો.',
  errFootballFemale: 'ફૂટબોલ સ્ત્રી માટે ઉપલબ્ધ નથી',
  errSaveFailed: 'રજિસ્ટ્રેશન સેવ થઈ શક્યું નહીં. API / ડેટાબેઝ કનેક્શન તપાસો.',
  errApiLoad: 'રજિસ્ટ્રેશન API સાથે કનેક્ટ થઈ શક્યું નહીં',
  errApiLoadFailed: (status: number) => `લોડ નિષ્ફળ (${status})`,
  errApiSaveFailed: (status: number) => `સેવ નિષ્ફળ (${status})`,

  conflictDoublesPartner: (
    user: string,
    sport: string,
    partner: string,
    gender: string,
  ) =>
    `પહેલેથી નોંધાયેલ: ${user} — ${sport} ડબલ્સ, પાર્ટનર ${partner}${gender}.`,
  conflictDoubles: (user: string, sport: string, gender: string) =>
    `પહેલેથી નોંધાયેલ: ${user} — ${sport} ડબલ્સ${gender}.`,
  conflictFootball: (user: string, sport: string, gender: string) =>
    `પહેલેથી નોંધાયેલ: ${user} — ${sport}${gender}.`,
  conflictSingles: (user: string, sport: string, gender: string) =>
    `પહેલેથી નોંધાયેલ: ${user} — ${sport} સિંગલ્સ${gender}.`,
  genderMaleTag: ' (પુરુષ)',
  genderFemaleTag: ' (સ્ત્રી)',

  sports: {
    football: 'ફૂટબોલ',
    pickleball: 'પિકલબોલ',
    carrom: 'કેરમ',
    chess: 'ચેસ',
    tt: 'ટેબલ ટેનિસ',
    badminton: 'બેડમિન્ટન',
  } as Record<string, string>,
} as const
