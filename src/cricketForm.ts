export const PLAYER_AREAS = [
  'Malad - East',
  'Malad - West',
  'Kandivali - East',
  'Kandivali - West',
  'Borivali - East',
  'Borivali - West',
  'Bhayandar',
  'Vile Parle',
  'Dahisar - East',
  'Dahisar - West',
] as const

export const PLAYER_SKILLS = [
  { id: 'batsman', en: 'Batsman', gu: 'બેટ્સમેન' },
  { id: 'bowler', en: 'Bowler', gu: 'બોલર' },
  { id: 'allrounder', en: 'All Rounder', gu: 'ઓલરાઉન્ડર' },
] as const

export type PlayerSkill = (typeof PLAYER_SKILLS)[number]['id']

export type CricketField =
  | 'firstName'
  | 'fatherName'
  | 'grandfatherName'
  | 'surname'
  | 'mobile'
  | 'age'
  | 'skill'
  | 'birthDate'
  | 'area'
  | 'photo'

export interface CricketPlayer {
  firstName: string
  fatherName: string
  grandfatherName: string
  surname: string
  mobile: string
  age: string
  skill: PlayerSkill | ''
  birthDate: string
  area: string
  photoName: string
  photoUrl: string
}

const MAX_PHOTO_BYTES = 3 * 1024 * 1024

export function emptyCricketPlayer(): CricketPlayer {
  return {
    firstName: '',
    fatherName: '',
    grandfatherName: '',
    surname: '',
    mobile: '',
    age: '',
    skill: '',
    birthDate: '',
    area: '',
    photoName: '',
    photoUrl: '',
  }
}

export function ageFromBirthDate(iso: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null
  const born = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(born.getTime())) return null
  const today = new Date()
  let age = today.getFullYear() - born.getFullYear()
  const month = today.getMonth() - born.getMonth()
  if (month < 0 || (month === 0 && today.getDate() < born.getDate())) age -= 1
  if (age < 0 || age > 120) return null
  return age
}

export function playerDisplayName(player: CricketPlayer): string {
  return [player.firstName, player.surname].filter(Boolean).join(' ').trim()
}

/** Shrink a photo in the browser so the preview stays at or under 3 MB. */
export async function optimizePhoto(
  file: File,
): Promise<{ dataUrl: string; bytes: number }> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Choose a photo — JPG or PNG.')
  }
  if (file.size > 20 * 1024 * 1024) {
    throw new Error('That photo is too large to open. Choose one under 20 MB.')
  }

  const bitmap = await createImageBitmap(file)
  const maxEdge = 1400
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close()
    throw new Error('Could not read this photo.')
  }
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  let quality = 0.82
  let blob: Blob | null = null
  for (let attempt = 0; attempt < 7; attempt += 1) {
    blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((next) => resolve(next), 'image/jpeg', quality)
    })
    if (blob && blob.size <= MAX_PHOTO_BYTES) break
    quality = Math.max(0.4, quality - 0.1)
    if (quality <= 0.4 && blob && blob.size > MAX_PHOTO_BYTES) break
  }

  if (!blob || blob.size > MAX_PHOTO_BYTES) {
    throw new Error(
      'This photo is still over 3 MB after optimizing. Choose a smaller one.',
    )
  }

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('Could not prepare the photo.'))
    reader.readAsDataURL(blob)
  })

  return { dataUrl, bytes: blob.size }
}
