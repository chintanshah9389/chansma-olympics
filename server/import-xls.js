import dotenv from 'dotenv'
import pg from 'pg'
import XLSX from 'xlsx'

dotenv.config()

const SPORT_IDS = {
  Football: 'football',
  Pickleball: 'pickleball',
  Carrom: 'carrom',
  Chess: 'chess',
  'Table Tennis': 'tt',
  Badminton: 'badminton',
  'Turf cricket': 'turf',
  'Overarm cricket': 'overarm',
}

const EVENT_IDS = {
  'Olympic games': 'indoor',
  'Turf cricket': 'turf',
  'Overarm cricket': 'overarm',
}

function cellAt(sheet, row, col) {
  return sheet[XLSX.utils.encode_cell({ r: row, c: col })]
}

function cellText(sheet, row, col) {
  const cell = cellAt(sheet, row, col)
  if (!cell || cell.v == null || cell.v === '') return ''
  if (typeof cell.v === 'number' && Number.isFinite(cell.v)) {
    return Number.isInteger(cell.v) ? String(cell.v) : String(cell.v)
  }
  return String(cell.v).trim()
}

function cellLink(sheet, row, col) {
  const cell = cellAt(sheet, row, col)
  const target = cell?.l?.Target ? String(cell.l.Target).trim() : ''
  return target || cellText(sheet, row, col)
}

function sheetRecords(sheet) {
  if (!sheet?.['!ref']) return []
  const range = XLSX.utils.decode_range(sheet['!ref'])
  const headers = []
  for (let col = range.s.c; col <= range.e.c; col += 1) {
    headers.push(cellText(sheet, range.s.r, col))
  }
  const rows = []
  for (let row = range.s.r + 1; row <= range.e.r; row += 1) {
    const record = {}
    let empty = true
    headers.forEach((header, index) => {
      if (!header) return
      const col = range.s.c + index
      const text = cellText(sheet, row, col)
      const link = cellLink(sheet, row, col)
      record[header] = text
      if (link && link !== text) record[`${header}__link`] = link
      if (text || link) empty = false
    })
    if (!empty) rows.push(record)
  }
  return rows
}

function uploadPath(raw) {
  const value = String(raw || '').trim()
  if (!value) return ''
  try {
    const url = new URL(value)
    if (url.pathname.startsWith('/uploads/')) return url.pathname
  } catch {
    // Keep site-relative upload paths as stored.
  }
  return value.startsWith('/uploads/') ? value : ''
}

function parseRegistered(value) {
  const text = String(value || '').trim()
  const parsed = new Date(text)
  if (!text || Number.isNaN(parsed.getTime())) return new Date().toISOString()
  return parsed.toISOString()
}

function skillId(label) {
  const key = String(label || '').trim().toLowerCase()
  if (key === 'batsman') return 'batsman'
  if (key === 'bowler') return 'bowler'
  if (key === 'all rounder' || key === 'allrounder') return 'allrounder'
  return ''
}

function wholeNumber(value) {
  if (value == null || value === '') return null
  const parsed = Math.floor(Number(value))
  return Number.isFinite(parsed) ? parsed : null
}

function buildSport(rows) {
  const first = rows[0]
  const sportId = SPORT_IDS[first.Sport]
  if (!sportId) throw new Error(`Unknown sport "${first.Sport}"`)
  const format = first.Format === 'Doubles' ? 'double' : 'single'
  const status = first.Status === 'Waiting' ? 'waiting' : 'confirmed'
  const partner = rows.find((row, index) => index > 0 && row.Player && row.Player !== first.Player)
  const sport = {
    sportId,
    format,
    status,
    player1Name: first.Player || '',
    player1Mobile: first.Mobile || '',
  }
  const age = wholeNumber(first.Age)
  if (age != null) sport.player1Age = age
  if (format === 'double') {
    sport.player2Name = partner?.Player || first.Partner || ''
    sport.player2Mobile = partner?.Mobile || ''
    const partnerAge = wholeNumber(partner?.Age)
    if (partnerAge != null) sport.player2Age = partnerAge
  }
  const skill = skillId(first.Skill || partner?.Skill)
  if (skill) sport.skill = skill
  if (first['Birth date']) sport.birthDate = first['Birth date']
  if (first['Father / Spouse']) sport.fatherName = first['Father / Spouse']
  if (first.Grandfather) sport.grandfatherName = first.Grandfather
  if (first.Surname) sport.surname = first.Surname
  const photo = uploadPath(first['Player photo__link'] || first['Player photo'] || partner?.['Player photo__link'] || partner?.['Player photo'])
  if (photo) sport.photoUrl = photo
  return sport
}

function sportsFor(playerRows) {
  const order = []
  const buckets = new Map()
  for (const row of playerRows) {
    if (!buckets.has(row.Sport)) {
      buckets.set(row.Sport, [])
      order.push(row.Sport)
    }
    buckets.get(row.Sport).push(row)
  }
  return order.map((sport) => buildSport(buckets.get(sport)))
}

export function registrationsFromWorkbook(workbook) {
  const players = sheetRecords(workbook.Sheets.Players)
  const payments = sheetRecords(workbook.Sheets.Payments)
  const playersById = new Map()
  for (const row of players) {
    const id = String(row['Registration ID'] || '').trim()
    if (!id) continue
    if (!playersById.has(id)) playersById.set(id, [])
    playersById.get(id).push(row)
  }
  const paymentsById = new Map()
  for (const row of payments) {
    const id = String(row['Registration ID'] || '').trim()
    if (id) paymentsById.set(id, row)
  }

  const ids = [...playersById.keys()]
  const registrations = []
  for (const id of ids) {
    const playerRows = playersById.get(id)
    const payment = paymentsById.get(id)
    const head = playerRows[0]
    const gender = String(payment?.Gender || head.Gender || '').trim().toLowerCase()
    if (gender !== 'male' && gender !== 'female') {
      throw new Error(`Registration ${id} has no gender`)
    }
    const event = EVENT_IDS[head.Event] || 'indoor'
    const payModeRaw = String(payment?.Payment || head.Payment || '').trim().toLowerCase()
    const payMode = payModeRaw === 'cash' || payModeRaw === 'online' ? payModeRaw : ''
    const amount = wholeNumber(payment?.Amount) ?? wholeNumber(head['Receipt amount']) ?? 0
    registrations.push({
      id,
      event,
      fullName: String(payment?.Name || head['Contact name'] || head.Player || '').trim(),
      mobile: String(payment?.Mobile || head['Contact mobile'] || head.Mobile || '').trim(),
      location: String(payment?.Location || head.Location || '').trim(),
      gender,
      sports: sportsFor(playerRows),
      createdAt: parseRegistered(payment?.Registered || head.Registered),
      receiptNo: String(payment?.Receipt || head.Receipt || '').trim(),
      payMode,
      paidTo: payMode === 'cash' ? String(payment?.['Collected by'] || head['Collected by'] || '').trim() : '',
      amount,
      paymentShotUrl: uploadPath(payment?.['Payment screenshot__link'] || payment?.['Payment screenshot'] || head['Payment screenshot__link'] || head['Payment screenshot']),
      receiptPdfUrl: uploadPath(payment?.['Receipt PDF__link'] || payment?.['Receipt PDF'] || head['Receipt PDF__link'] || head['Receipt PDF']),
    })
  }
  return registrations
}

const INSERT_SQL = `
  INSERT INTO registrations
    (id, event, full_name, mobile, location, gender, sports, created_at, receipt_no, pay_mode, paid_to, amount, payment_shot_url, receipt_pdf_url)
  VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::timestamptz, $9, $10, $11, $12, $13, $14)
  ON CONFLICT (id) DO UPDATE SET
    event = EXCLUDED.event,
    full_name = EXCLUDED.full_name,
    mobile = EXCLUDED.mobile,
    location = EXCLUDED.location,
    gender = EXCLUDED.gender,
    sports = EXCLUDED.sports,
    created_at = EXCLUDED.created_at,
    receipt_no = EXCLUDED.receipt_no,
    pay_mode = EXCLUDED.pay_mode,
    paid_to = EXCLUDED.paid_to,
    amount = EXCLUDED.amount,
    payment_shot_url = EXCLUDED.payment_shot_url,
    receipt_pdf_url = EXCLUDED.receipt_pdf_url
`

export async function importRegistrations(pool, registrations) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    for (const reg of registrations) {
      await client.query(INSERT_SQL, [
        reg.id,
        reg.event,
        reg.fullName,
        reg.mobile,
        reg.location,
        reg.gender,
        JSON.stringify(reg.sports),
        reg.createdAt,
        reg.receiptNo,
        reg.payMode,
        reg.paidTo,
        reg.amount,
        reg.paymentShotUrl || '',
        reg.receiptPdfUrl || '',
      ])
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

function summarize(registrations) {
  const sports = {}
  let photos = 0
  let shots = 0
  let pdfs = 0
  for (const reg of registrations) {
    if (reg.paymentShotUrl) shots += 1
    if (reg.receiptPdfUrl) pdfs += 1
    for (const sport of reg.sports) {
      sports[sport.sportId] = (sports[sport.sportId] || 0) + 1
      if (sport.photoUrl) photos += 1
    }
  }
  return {
    registrations: registrations.length,
    sports,
    photos,
    paymentScreenshots: shots,
    receiptPdfs: pdfs,
  }
}

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const file = args.find((arg) => !arg.startsWith('--'))
  if (!file) {
    console.error('Usage: node server/import-xls.js <workbook.xls> [--dry-run]')
    process.exit(1)
  }
  const workbook = XLSX.readFile(file)
  const registrations = registrationsFromWorkbook(workbook)
  console.log(JSON.stringify(summarize(registrations), null, 2))
  if (dryRun) return
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required to import. Re-run with --dry-run to only check the file.')
    process.exit(1)
  }
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  })
  try {
    await importRegistrations(pool, registrations)
    console.log(`Imported ${registrations.length} registrations`)
  } finally {
    await pool.end()
  }
}

const isDirectRun = process.argv[1] && process.argv[1].endsWith('import-xls.js')
if (isDirectRun) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
