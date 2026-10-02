import cors from 'cors'
import crypto from 'node:crypto'
import dotenv from 'dotenv'
import express from 'express'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { WebSocketServer } from 'ws'

dotenv.config()

const { Pool } = pg
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const port = Number(process.env.PORT || 3001)

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.DATABASE_SSL === 'true'
      ? { rejectUnauthorized: false }
      : undefined,
})

const DEFAULT_CAPACITIES = {
  football: { male: 22, female: 22 },
  pickleball: { male: 16, female: 16 },
  carrom: { male: 16, female: 16 },
  chess: { male: 16, female: 16 },
  tt: { male: 16, female: 16 },
  badminton: { male: 16, female: 16 },
}

const DEFAULT_AGE_LIMITS = {
  football: { minAge: 5, maxAge: 100 },
  pickleball: { minAge: 5, maxAge: 100 },
  carrom: { minAge: 5, maxAge: 100 },
  chess: { minAge: 5, maxAge: 100 },
  tt: { minAge: 5, maxAge: 100 },
  badminton: { minAge: 5, maxAge: 100 },
  turf: { minAge: 5, maxAge: 100 },
  overarm: { minAge: 5, maxAge: 100 },
}

const DEFAULT_FEES = {
  football: 500,
  pickleball: 500,
  carrom: 250,
  chess: 250,
  tt: 250,
  badminton: 300,
  turf: 700,
  overarm: 700,
}

const DEFAULT_CRICKET_CAPACITIES = {
  turf: { male: 16, female: 12 },
  overarm: { male: 20 },
}

const SPORT_IDS = Object.keys(DEFAULT_CAPACITIES)
const AGE_IDS = Object.keys(DEFAULT_AGE_LIMITS)
const FEE_IDS = Object.keys(DEFAULT_FEES)
const CRICKET_EVENTS = ['turf', 'overarm']

function normalizeCapacities(input) {
  const source = input && typeof input === 'object' ? input : {}
  const out = {}
  for (const id of SPORT_IDS) {
    const pair = source[id] || {}
    const fallback = DEFAULT_CAPACITIES[id]
    const male = Math.max(0, Math.floor(Number(pair.male ?? fallback.male)))
    const female = Math.max(
      0,
      Math.floor(Number(pair.female ?? fallback.female)),
    )
    out[id] = {
      male: Number.isFinite(male) ? male : fallback.male,
      female: Number.isFinite(female) ? female : fallback.female,
    }
  }
  return out
}

function clampAgePair(minRaw, maxRaw, fallback) {
  let minAge = Math.floor(Number(minRaw))
  let maxAge = Math.floor(Number(maxRaw))
  if (!Number.isFinite(minAge)) minAge = fallback.minAge
  if (!Number.isFinite(maxAge)) maxAge = fallback.maxAge
  minAge = Math.max(1, Math.min(120, minAge))
  maxAge = Math.max(1, Math.min(120, maxAge))
  if (minAge > maxAge) {
    const swap = minAge
    minAge = maxAge
    maxAge = swap
  }
  return { minAge, maxAge }
}

function normalizeAgeLimits(input) {
  const source = input && typeof input === 'object' ? input : {}
  const out = {}

  // Legacy global { minAge, maxAge } → apply to every sport
  const looksLegacy =
    !AGE_IDS.some((id) => id in source) &&
    (source.minAge != null || source.maxAge != null)
  if (looksLegacy) {
    const pair = clampAgePair(source.minAge, source.maxAge, {
      minAge: 5,
      maxAge: 100,
    })
    for (const id of AGE_IDS) out[id] = { ...pair }
    return out
  }

  for (const id of AGE_IDS) {
    const pair = source[id] || {}
    const fallback = DEFAULT_AGE_LIMITS[id]
    out[id] = clampAgePair(pair.minAge, pair.maxAge, fallback)
  }
  return out
}

async function readCapacities() {
  const result = await pool.query(
    `SELECT value FROM settings WHERE key = 'capacities' LIMIT 1`,
  )
  if (result.rowCount === 0) return { ...DEFAULT_CAPACITIES }
  return normalizeCapacities(result.rows[0].value)
}

async function readAgeLimits() {
  const result = await pool.query(
    `SELECT value FROM settings WHERE key = 'age_limits' LIMIT 1`,
  )
  if (result.rowCount === 0) return normalizeAgeLimits(DEFAULT_AGE_LIMITS)
  return normalizeAgeLimits(result.rows[0].value)
}

function normalizeFees(input) {
  const source = input && typeof input === 'object' ? input : {}
  const out = {}
  for (const id of FEE_IDS) {
    const value = Math.floor(Number(source[id] ?? DEFAULT_FEES[id]))
    out[id] = Number.isFinite(value) && value >= 0 ? value : DEFAULT_FEES[id]
  }
  return out
}

function normalizeCricketCapacities(input) {
  const source = input && typeof input === 'object' ? input : {}
  const turf = source.turf || {}
  const overarm = source.overarm || {}
  const num = (value, fallback) => {
    const parsed = Math.floor(Number(value ?? fallback))
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
  }
  return {
    turf: {
      male: num(turf.male, DEFAULT_CRICKET_CAPACITIES.turf.male),
      female: num(turf.female, DEFAULT_CRICKET_CAPACITIES.turf.female),
    },
    overarm: {
      male: num(overarm.male, DEFAULT_CRICKET_CAPACITIES.overarm.male),
    },
  }
}

async function readFees() {
  const result = await pool.query(
    `SELECT value FROM settings WHERE key = 'fees' LIMIT 1`,
  )
  if (result.rowCount === 0) return normalizeFees(DEFAULT_FEES)
  return normalizeFees(result.rows[0].value)
}

async function readCricketCapacities() {
  const result = await pool.query(
    `SELECT value FROM settings WHERE key = 'cricket_capacities' LIMIT 1`,
  )
  if (result.rowCount === 0) return normalizeCricketCapacities(DEFAULT_CRICKET_CAPACITIES)
  return normalizeCricketCapacities(result.rows[0].value)
}

async function upsertSetting(key, value) {
  await pool.query(
    `INSERT INTO settings (key, value, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, JSON.stringify(value)],
  )
}

function sportsAgeError(sports, limitsBySport) {
  const list = Array.isArray(sports) ? sports : []
  for (const sport of list) {
    const sportId = sport?.sportId
    const limits = limitsBySport?.[sportId] || { minAge: 5, maxAge: 100 }
    const checks = [
      {
        label: 'Player 1',
        age: sport?.player1Age,
        required: Boolean(sport?.player1Name || sport?.player1Mobile),
      },
      {
        label: 'Player 2',
        age: sport?.player2Age,
        required:
          sport?.format === 'double' &&
          Boolean(sport?.player2Name || sport?.player2Mobile),
      },
    ]
    for (const check of checks) {
      if (check.age == null || check.age === '') {
        if (check.required) {
          return `${check.label} age is required for ${sportId} (allowed ${limits.minAge}–${limits.maxAge})`
        }
        continue
      }
      const age = Math.floor(Number(check.age))
      if (!Number.isFinite(age) || age < limits.minAge || age > limits.maxAge) {
        return `${check.label} age for ${sportId} must be between ${limits.minAge} and ${limits.maxAge}`
      }
    }
  }
  return null
}

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS registrations (
      id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      mobile TEXT NOT NULL,
      location TEXT NOT NULL,
      gender TEXT NOT NULL CHECK (gender IN ('male', 'female')),
      sports JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_registrations_gender
      ON registrations (gender);

    CREATE INDEX IF NOT EXISTS idx_registrations_mobile
      ON registrations (mobile);

    ALTER TABLE registrations
      ADD COLUMN IF NOT EXISTS event TEXT NOT NULL DEFAULT 'indoor';

    ALTER TABLE registrations
      ADD COLUMN IF NOT EXISTS receipt_no TEXT NOT NULL DEFAULT '';

    ALTER TABLE registrations
      ADD COLUMN IF NOT EXISTS pay_mode TEXT NOT NULL DEFAULT '';

    ALTER TABLE registrations
      ADD COLUMN IF NOT EXISTS paid_to TEXT NOT NULL DEFAULT '';

    ALTER TABLE registrations
      ADD COLUMN IF NOT EXISTS amount INTEGER NOT NULL DEFAULT 0;

    ALTER TABLE registrations
      ADD COLUMN IF NOT EXISTS payment_shot_url TEXT NOT NULL DEFAULT '';

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `)

  const existing = await pool.query(
    `SELECT value FROM settings WHERE key = 'capacities' LIMIT 1`,
  )
  if (existing.rowCount === 0) {
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ('capacities', $1::jsonb)`,
      [JSON.stringify(DEFAULT_CAPACITIES)],
    )
  }

  const ageExisting = await pool.query(
    `SELECT value FROM settings WHERE key = 'age_limits' LIMIT 1`,
  )
  if (ageExisting.rowCount === 0) {
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ('age_limits', $1::jsonb)`,
      [JSON.stringify(DEFAULT_AGE_LIMITS)],
    )
  }

  const feeExisting = await pool.query(
    `SELECT value FROM settings WHERE key = 'fees' LIMIT 1`,
  )
  if (feeExisting.rowCount === 0) {
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ('fees', $1::jsonb)`,
      [JSON.stringify(DEFAULT_FEES)],
    )
  }

  const cricketCapExisting = await pool.query(
    `SELECT value FROM settings WHERE key = 'cricket_capacities' LIMIT 1`,
  )
  if (cricketCapExisting.rowCount === 0) {
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ('cricket_capacities', $1::jsonb)`,
      [JSON.stringify(DEFAULT_CRICKET_CAPACITIES)],
    )
  }
}

const EVENT_IDS = ['overarm', 'indoor', 'turf']

function normalizeEvent(value) {
  return EVENT_IDS.includes(value) ? value : 'indoor'
}

const REGISTRATION_COLUMNS = `id, event, full_name, mobile, location, gender, sports, created_at, receipt_no, pay_mode, paid_to, amount, payment_shot_url`

function rowToRegistration(row) {
  const payMode = row.pay_mode === 'cash' || row.pay_mode === 'online' ? row.pay_mode : ''
  return {
    id: row.id,
    event: normalizeEvent(row.event),
    fullName: row.full_name,
    mobile: row.mobile,
    location: row.location,
    gender: row.gender,
    sports: row.sports,
    createdAt: new Date(row.created_at).toISOString(),
    receiptNo: row.receipt_no || '',
    payMode,
    paidTo: row.paid_to || '',
    amount: Number(row.amount) || 0,
    paymentShotUrl: row.payment_shot_url || '',
  }
}

const uploadRoot = resolveUploadRoot()

function resolveUploadRoot() {
  const preferred =
    process.env.UPLOAD_DIR ||
    (process.env.RAILWAY_ENVIRONMENT
      ? '/data/uploads'
      : path.join(rootDir, 'uploads'))
  try {
    fs.mkdirSync(path.join(preferred, 'cricket'), { recursive: true })
    fs.mkdirSync(path.join(preferred, 'payments'), { recursive: true })
    return preferred
  } catch (error) {
    const fallback = path.join(rootDir, 'uploads')
    fs.mkdirSync(path.join(fallback, 'cricket'), { recursive: true })
    fs.mkdirSync(path.join(fallback, 'payments'), { recursive: true })
    console.warn(
      `Upload folder ${preferred} is not writable (${error.message}). Using ${fallback}.`,
    )
    return fallback
  }
}

function saveImageDataUrl(dataUrl, folder) {
  const match = /^data:(image\/(?:jpeg|jpg|png|webp));base64,([a-z0-9+/=\s]+)$/i.exec(
    String(dataUrl || '').replace(/\s/g, ''),
  )
  if (!match) throw new Error('Upload a JPG, PNG, or WebP image.')
  const mime = match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase()
  const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg'
  const buffer = Buffer.from(match[2], 'base64')
  if (!buffer.length || buffer.length > 8 * 1024 * 1024) {
    throw new Error('Image must be under 8 MB.')
  }
  const name = `${crypto.randomBytes(16).toString('hex')}.${ext}`
  fs.writeFileSync(path.join(uploadRoot, folder, name), buffer)
  return `/uploads/${folder}/${name}`
}

function isStoredUpload(url, folder) {
  return new RegExp(`^/uploads/${folder}/[a-f0-9]{32}\\.(jpg|png|webp)$`).test(
    String(url || ''),
  )
}

function localUploadPath(urlPath) {
  if (!isStoredUpload(urlPath, 'cricket') && !isStoredUpload(urlPath, 'payments')) {
    return null
  }
  const rel = String(urlPath).slice('/uploads/'.length)
  const full = path.resolve(uploadRoot, rel)
  if (!full.startsWith(path.resolve(uploadRoot))) return null
  return full
}

function collectUploadUrls(row) {
  const urls = []
  if (row?.payment_shot_url) urls.push(row.payment_shot_url)
  if (row?.paymentShotUrl) urls.push(row.paymentShotUrl)
  const sports = Array.isArray(row?.sports) ? row.sports : []
  for (const sport of sports) {
    if (sport?.photoUrl) urls.push(sport.photoUrl)
  }
  return urls
}

async function releaseUploads(urls) {
  const unique = [...new Set(urls.filter(Boolean))]
  if (unique.length === 0) return
  const still = await pool.query(`SELECT sports, payment_shot_url FROM registrations`)
  const used = new Set()
  for (const row of still.rows) {
    for (const url of collectUploadUrls(row)) used.add(url)
  }
  for (const url of unique) {
    if (used.has(url)) continue
    const file = localUploadPath(url)
    if (file && fs.existsSync(file)) fs.unlinkSync(file)
  }
}

function clearUploadFiles() {
  for (const folder of ['cricket', 'payments']) {
    const dir = path.join(uploadRoot, folder)
    if (!fs.existsSync(dir)) continue
    for (const name of fs.readdirSync(dir)) {
      if (name === '.gitkeep') continue
      fs.unlinkSync(path.join(dir, name))
    }
  }
}

function storeRegistrationImages(regs, paymentShot) {
  const savedPhotos = new Map()
  let paymentUrl = ''
  const shot = String(paymentShot || '')
  if (shot.startsWith('data:image/')) {
    paymentUrl = saveImageDataUrl(shot, 'payments')
  } else if (isStoredUpload(shot, 'payments')) {
    paymentUrl = shot
  }
  if (regs.some((reg) => reg.payMode === 'online') && !paymentUrl) {
    throw new Error('Payment screenshot is required.')
  }
  for (const reg of regs) {
    reg.paymentShotUrl = paymentUrl
    for (const sport of reg.sports) {
      const photo = String(sport.photoUrl || '')
      if (!photo.startsWith('data:image/')) continue
      if (!savedPhotos.has(photo)) {
        savedPhotos.set(photo, saveImageDataUrl(photo, 'cricket'))
      }
      sport.photoUrl = savedPhotos.get(photo)
    }
  }
}

const app = express()
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || ''
const SUPERADMIN_USERNAME = process.env.SUPERADMIN_USERNAME || 'superadmin'
const SUPERADMIN_PASSWORD = process.env.SUPERADMIN_PASSWORD || ''
const ADMIN_TOKEN_TTL_MS = 12 * 60 * 60 * 1000

function adminTokenSecret() {
  return (
    process.env.ADMIN_SESSION_SECRET ||
    `${ADMIN_PASSWORD}:${SUPERADMIN_PASSWORD}`
  )
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a))
  const right = Buffer.from(String(b))
  if (left.length !== right.length) return false
  return crypto.timingSafeEqual(left, right)
}

function issueAdminToken(username, role) {
  const payload = Buffer.from(
    JSON.stringify({
      u: username,
      role,
      exp: Date.now() + ADMIN_TOKEN_TTL_MS,
    }),
  ).toString('base64url')
  const sig = crypto
    .createHmac('sha256', adminTokenSecret())
    .update(payload)
    .digest('base64url')
  return `${payload}.${sig}`
}

function readAdminToken(req) {
  const header = String(req.headers.authorization || '')
  return header.startsWith('Bearer ') ? header.slice(7).trim() : ''
}

function readAdminSession(token) {
  if (!token || !token.includes('.')) return null
  const [payload, sig] = token.split('.')
  const expected = crypto
    .createHmac('sha256', adminTokenSecret())
    .update(payload)
    .digest('base64url')
  if (!safeEqual(sig, expected)) return null
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (Number(data?.exp) <= Date.now()) return null
    if (data.role === 'admin' && ADMIN_PASSWORD && data.u === ADMIN_USERNAME) {
      return data
    }
    if (
      data.role === 'superadmin' &&
      SUPERADMIN_PASSWORD &&
      data.u === SUPERADMIN_USERNAME
    ) {
      return data
    }
    return null
  } catch {
    return null
  }
}

function requireAdmin(req, res, roles = ['admin', 'superadmin']) {
  const session = readAdminSession(readAdminToken(req))
  if (!session) {
    res.status(401).json({ error: 'Admin login required' })
    return false
  }
  if (!roles.includes(session.role)) {
    res.status(403).json({ error: 'This account cannot do that' })
    return false
  }
  return true
}

app.use(
  cors({
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }),
)
app.use(express.json({ limit: '20mb' }))

const server = http.createServer(app)
const wss = new WebSocketServer({ server, path: '/ws' })

function broadcast(type) {
  const message = JSON.stringify({ type })
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(message)
    }
  }
}

function broadcastRegistrationsUpdated() {
  broadcast('registrations-updated')
}

function broadcastCapacitiesUpdated() {
  broadcast('capacities-updated')
}

function broadcastAgeLimitsUpdated() {
  broadcast('age-limits-updated')
}

function broadcastFeesUpdated() {
  broadcast('fees-updated')
}

function broadcastCricketCapacitiesUpdated() {
  broadcast('cricket-capacities-updated')
}

/** Singles/team = 1 seat; doubles = 2 seats against that gender quota. */
function seatWeight(format) {
  return format === 'double' ? 2 : 1
}

/**
 * Assign confirmed/waiting by registration time (oldest first).
 * Capacity is seat units per sport+gender: doubles consume 2, singles 1.
 * Runs after capacity changes and registration create/delete/update.
 */
async function recalculateSeatStatuses() {
  const capacities = await readCapacities()
  const cricketCaps = await readCricketCapacities()
  const result = await pool.query(
    `SELECT id, event, gender, sports, created_at
     FROM registrations
     ORDER BY created_at ASC, id ASC`,
  )

  /** @type {Map<string, { id: string, index: number }[]>} */
  const buckets = new Map()
  /** @type {Map<string, any[]>} */
  const sportsById = new Map()

  for (const row of result.rows) {
    const sports = Array.isArray(row.sports)
      ? row.sports.map((s) => ({ ...s }))
      : []
    sportsById.set(row.id, sports)

    sports.forEach((sport, index) => {
      const event = normalizeEvent(row.event)
      if (CRICKET_EVENTS.includes(event)) {
        const key = `cricket|${event}|${row.gender}`
        if (!buckets.has(key)) buckets.set(key, [])
        buckets.get(key).push({ id: row.id, index })
        return
      }
      const sportId = sport?.sportId
      if (!sportId || !SPORT_IDS.includes(sportId)) return
      const key = `${event}|${sportId}|${row.gender}`
      if (!buckets.has(key)) buckets.set(key, [])
      buckets.get(key).push({ id: row.id, index })
    })
  }

  for (const [key, entries] of buckets.entries()) {
    const parts = key.split('|')
    const cricket = parts[0] === 'cricket'
    const sportId = cricket ? parts[1] : parts[1]
    const gender = cricket ? parts[2] : parts[2]
    const cap = cricket
      ? Number(cricketCaps[sportId]?.[gender] ?? 0)
      : Number(capacities[sportId]?.[gender] ?? 0)
    let used = 0
    for (const entry of entries) {
      const sports = sportsById.get(entry.id)
      if (!sports?.[entry.index]) continue
      const weight = cricket ? 1 : seatWeight(sports[entry.index].format)
      if (used + weight <= cap) {
        sports[entry.index].status = 'confirmed'
        used += weight
      } else {
        sports[entry.index].status = 'waiting'
      }
    }
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    for (const row of result.rows) {
      const nextSports = sportsById.get(row.id)
      const prevSig = (row.sports || [])
        .map((s) => `${s.sportId}:${s.status || ''}`)
        .join('|')
      const nextSig = (nextSports || [])
        .map((s) => `${s.sportId}:${s.status || ''}`)
        .join('|')
      if (prevSig === nextSig) continue
      await client.query(
        `UPDATE registrations SET sports = $1::jsonb WHERE id = $2`,
        [JSON.stringify(nextSports), row.id],
      )
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

function normalizeMobileDigits(value) {
  return String(value || '').replace(/\D/g, '')
}

/** Player mobiles on a sport row only (not step‑1 registration contact). */
function sportEntryMobiles(entry) {
  return [
    ...new Set(
      [
        normalizeMobileDigits(entry?.player1Mobile),
        normalizeMobileDigits(entry?.player2Mobile),
      ].filter(Boolean),
    ),
  ]
}

/**
 * Block if any Player 1 / Player 2 mobile is already in that sport.
 * Step‑1 contact mobile is ignored — it is only who is filling the form.
 * @param {string} _regMobile
 * @param {any[]} sports
 * @param {string | null} [excludeId]
 */
async function findRegistrationMobileConflict(
  _regMobile,
  sports,
  excludeId = null,
  event = 'indoor',
) {
  const result = await pool.query(
    `SELECT id, event, full_name, mobile, sports FROM registrations`,
  )
  const wanted = normalizeEvent(event)

  if (CRICKET_EVENTS.includes(wanted)) {
    const targets = [
      ...new Set(
        [
          normalizeMobileDigits(_regMobile),
          ...sports.flatMap((sport) => sportEntryMobiles(sport)),
        ].filter(Boolean),
      ),
    ]
    if (targets.length === 0) return null
    for (const row of result.rows) {
      if (excludeId && row.id === excludeId) continue
      if (normalizeEvent(row.event) !== wanted) continue
      const existingSports = Array.isArray(row.sports) ? row.sports : []
      const existing = [
        ...new Set(
          [
            normalizeMobileDigits(row.mobile),
            ...existingSports.flatMap((sport) => sportEntryMobiles(sport)),
          ].filter(Boolean),
        ),
      ]
      const matched = targets.find((mobile) => existing.includes(mobile))
      if (matched) {
        const label = wanted === 'turf' ? 'Turf cricket' : 'Overarm cricket'
        return `Already registered: ${row.full_name || matched} for ${label} (mobile ${matched}).`
      }
    }
    return null
  }

  for (const sport of sports) {
    const sportId = sport?.sportId
    if (!sportId || !SPORT_IDS.includes(sportId)) continue

    const targets = sportEntryMobiles(sport)
    if (targets.length === 0) continue

    for (const row of result.rows) {
      if (excludeId && row.id === excludeId) continue
      if (normalizeEvent(row.event) !== wanted) continue
      const existingSports = Array.isArray(row.sports) ? row.sports : []
      const entry = existingSports.find((s) => s?.sportId === sportId)
      if (!entry) continue

      const existing = sportEntryMobiles(entry)
      const matched = targets.find((m) => existing.includes(m))
      if (matched) {
        const who = row.full_name || matched
        return `Already registered: ${who} for ${sportId} (mobile ${matched}).`
      }
    }
  }

  return null
}

wss.on('connection', (socket) => {
  socket.send(JSON.stringify({ type: 'connected' }))
})

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, realtime: 'websocket' })
})

app.post('/api/admin/login', (req, res) => {
  const accounts = [
    ADMIN_PASSWORD
      ? { username: ADMIN_USERNAME, password: ADMIN_PASSWORD, role: 'admin' }
      : null,
    SUPERADMIN_PASSWORD
      ? {
          username: SUPERADMIN_USERNAME,
          password: SUPERADMIN_PASSWORD,
          role: 'superadmin',
        }
      : null,
  ].filter(Boolean)
  if (accounts.length === 0) {
    res.status(503).json({ error: 'Admin login is not configured' })
    return
  }
  const username = String(req.body?.username || '')
  const password = String(req.body?.password || '')
  const account = accounts.find(
    (entry) =>
      safeEqual(username, entry.username) && safeEqual(password, entry.password),
  )
  if (!account) {
    res.status(401).json({ error: 'Incorrect username or password' })
    return
  }
  res.json({
    token: issueAdminToken(account.username, account.role),
    role: account.role,
    username: account.username,
  })
})

app.get('/api/admin/session', (req, res) => {
  const session = readAdminSession(readAdminToken(req))
  if (!session) {
    res.status(401).json({ error: 'Admin login required' })
    return
  }
  res.json({ ok: true, username: session.u, role: session.role })
})

app.get('/api/capacities', async (_req, res) => {
  try {
    res.json(await readCapacities())
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Failed to load capacities' })
  }
})

app.put('/api/capacities', async (req, res) => {
  if (!requireAdmin(req, res, ['superadmin'])) return
  try {
    const capacities = normalizeCapacities(req.body)
    await pool.query(
      `INSERT INTO settings (key, value, updated_at)
       VALUES ('capacities', $1::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE
         SET value = EXCLUDED.value, updated_at = NOW()`,
      [JSON.stringify(capacities)],
    )
    await recalculateSeatStatuses()
    broadcastCapacitiesUpdated()
    broadcastRegistrationsUpdated()
    res.json(capacities)
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Failed to save capacities' })
  }
})

app.get('/api/age-limits', async (_req, res) => {
  try {
    res.json(await readAgeLimits())
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Failed to load age limits' })
  }
})

app.put('/api/age-limits', async (req, res) => {
  if (!requireAdmin(req, res, ['superadmin'])) return
  try {
    const ageLimits = normalizeAgeLimits(req.body)
    await pool.query(
      `INSERT INTO settings (key, value, updated_at)
       VALUES ('age_limits', $1::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE
         SET value = EXCLUDED.value, updated_at = NOW()`,
      [JSON.stringify(ageLimits)],
    )
    broadcastAgeLimitsUpdated()
    res.json(ageLimits)
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Failed to save age limits' })
  }
})

app.get('/api/fees', async (_req, res) => {
  try {
    res.json(await readFees())
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Failed to load fees' })
  }
})

app.put('/api/fees', async (req, res) => {
  if (!requireAdmin(req, res, ['superadmin'])) return
  try {
    const fees = normalizeFees(req.body)
    await upsertSetting('fees', fees)
    broadcastFeesUpdated()
    res.json(fees)
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Failed to save fees' })
  }
})

app.get('/api/cricket-capacities', async (_req, res) => {
  try {
    res.json(await readCricketCapacities())
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Failed to load cricket capacities' })
  }
})

app.put('/api/cricket-capacities', async (req, res) => {
  if (!requireAdmin(req, res, ['superadmin'])) return
  try {
    const capacities = normalizeCricketCapacities(req.body)
    await upsertSetting('cricket_capacities', capacities)
    await recalculateSeatStatuses()
    broadcastCricketCapacitiesUpdated()
    broadcastRegistrationsUpdated()
    res.json(capacities)
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Failed to save cricket capacities' })
  }
})

function prepareRegistration(body) {
  const id = String(body?.id || '').trim()
  const event = normalizeEvent(body?.event)
  const fullName = String(body?.fullName || '').trim()
  const mobile = String(body?.mobile || '').replace(/\D/g, '')
  const location = String(body?.location || '').trim()
  let gender = body?.gender === 'female' ? 'female' : 'male'
  if (event === 'overarm') gender = 'male'
  const sports = Array.isArray(body?.sports)
    ? body.sports.map((sport) => ({ ...sport }))
    : []
  const createdAt = body?.createdAt || new Date().toISOString()
  const receiptNo = String(body?.receiptNo || '').slice(0, 40)
  const payMode =
    body?.payMode === 'cash' || body?.payMode === 'online' ? body.payMode : ''
  const paidTo = String(body?.paidTo || '').slice(0, 80)
  const amount = Math.max(0, Math.floor(Number(body?.amount) || 0))
  return {
    id,
    event,
    fullName,
    mobile,
    location,
    gender,
    sports,
    createdAt,
    receiptNo,
    payMode,
    paidTo,
    amount,
  }
}

function cricketEntryError(reg) {
  if (!CRICKET_EVENTS.includes(reg.event)) return null
  if (!reg.fullName) return 'Player name is required'
  if (!/^\d{10}$/.test(reg.mobile)) return 'A 10-digit mobile is required'
  if (!reg.location) return "Player's area is required"
  if (reg.sports.length !== 1 || reg.sports[0]?.sportId !== reg.event) {
    return 'Cricket registration must include that cricket sport only'
  }
  const sport = reg.sports[0]
  if (!['batsman', 'bowler', 'allrounder'].includes(sport.skill)) {
    return 'Player skill is required'
  }
  if (!sport.birthDate) return 'Birth date is required'
  const photo = String(sport.photoUrl || '')
  if (!isStoredUpload(photo, 'cricket')) return "Player's photo is required"
  return null
}

async function registrationError(reg, excludeId = null) {
  if (!reg.id || !reg.fullName || reg.sports.length === 0) {
    return 'Missing required registration fields'
  }
  const cricketError = cricketEntryError(reg)
  if (cricketError) return cricketError
  const ageLimits = await readAgeLimits()
  const ageError = sportsAgeError(reg.sports, ageLimits)
  if (ageError) return ageError
  return findRegistrationMobileConflict(
    reg.mobile,
    reg.sports,
    excludeId,
    reg.event,
  )
}

async function insertRegistration(client, reg) {
  await client.query(
    `INSERT INTO registrations
      (id, event, full_name, mobile, location, gender, sports, created_at, receipt_no, pay_mode, paid_to, amount, payment_shot_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::timestamptz, $9, $10, $11, $12, $13)`,
    [
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
    ],
  )
}

app.get('/api/registrations', async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT ${REGISTRATION_COLUMNS}
       FROM registrations
       ORDER BY created_at ASC`,
    )
    res.json(result.rows.map(rowToRegistration))
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Failed to load registrations' })
  }
})

app.post('/api/registrations/checkout', async (req, res) => {
  const list = Array.isArray(req.body?.registrations) ? req.body.registrations : []
  if (list.length === 0) {
    res.status(400).json({ error: 'Nothing to save' })
    return
  }
  const prepared = list.map((item) => prepareRegistration(item))
  try {
    try {
      storeRegistrationImages(prepared, req.body?.paymentShot)
    } catch (error) {
      res.status(400).json({ error: error.message || 'Could not store the upload' })
      return
    }
    for (const reg of prepared) {
      const error = await registrationError(reg)
      if (error) {
        await releaseUploads(prepared.flatMap((item) => collectUploadUrls(item)))
        res.status(error.startsWith('Already registered') ? 409 : 400).json({ error })
        return
      }
    }
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      for (const reg of prepared) await insertRegistration(client, reg)
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      await releaseUploads(prepared.flatMap((item) => collectUploadUrls(item)))
      throw error
    } finally {
      client.release()
    }
    await recalculateSeatStatuses()
    const saved = await pool.query(
      `SELECT ${REGISTRATION_COLUMNS}
       FROM registrations
       WHERE id = ANY($1::text[])
       ORDER BY created_at ASC`,
      [prepared.map((reg) => reg.id)],
    )
    broadcastRegistrationsUpdated()
    res.status(201).json(saved.rows.map(rowToRegistration))
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Failed to save registration' })
  }
})

app.post('/api/registrations', async (req, res) => {
  try {
    const reg = prepareRegistration(req.body ?? {})
    try {
      storeRegistrationImages([reg], req.body?.paymentShot)
    } catch (error) {
      res.status(400).json({ error: error.message || 'Could not store the upload' })
      return
    }
    const error = await registrationError(reg)
    if (error) {
      res.status(error.startsWith('Already registered') ? 409 : 400).json({ error })
      return
    }
    const client = await pool.connect()
    try {
      await insertRegistration(client, reg)
    } finally {
      client.release()
    }
    await recalculateSeatStatuses()
    const updated = await pool.query(
      `SELECT ${REGISTRATION_COLUMNS} FROM registrations WHERE id = $1`,
      [reg.id],
    )
    broadcastRegistrationsUpdated()
    res.status(201).json(rowToRegistration(updated.rows[0]))
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Failed to save registration' })
  }
})

app.delete('/api/registrations/:id', async (req, res) => {
  if (!requireAdmin(req, res)) return
  try {
    const existing = await pool.query(
      `SELECT sports, payment_shot_url FROM registrations WHERE id = $1`,
      [req.params.id],
    )
    const result = await pool.query(
      `DELETE FROM registrations WHERE id = $1 RETURNING id`,
      [req.params.id],
    )
    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Registration not found' })
      return
    }
    await releaseUploads(collectUploadUrls(existing.rows[0]))
    await recalculateSeatStatuses()
    broadcastRegistrationsUpdated()
    res.json({ ok: true, id: req.params.id })
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Failed to delete registration' })
  }
})

app.put('/api/registrations/:id', async (req, res) => {
  if (!requireAdmin(req, res)) return
  try {
    const id = String(req.params.id || '')
    const body = req.body ?? {}
    const fullName = String(body.fullName || '').trim()
    const mobile = String(body.mobile || '').replace(/\D/g, '')
    const location = String(body.location || '').trim()
    let gender = body.gender === 'female' ? 'female' : 'male'
    const sports = Array.isArray(body.sports) ? body.sports : []

    if (!id || !fullName || sports.length === 0) {
      res.status(400).json({ error: 'Missing required registration fields' })
      return
    }

    const existing = await pool.query(
      `SELECT id, event FROM registrations WHERE id = $1`,
      [id],
    )
    if (existing.rowCount === 0) {
      res.status(404).json({ error: 'Registration not found' })
      return
    }

    const ageLimits = await readAgeLimits()
    const ageError = sportsAgeError(sports, ageLimits)
    if (ageError) {
      res.status(400).json({ error: ageError })
      return
    }

    const event = normalizeEvent(body.event || existing.rows[0].event)
    if (event === 'overarm') gender = 'male'
    for (const sport of sports) {
      const photo = String(sport?.photoUrl || '')
      if (photo.startsWith('data:image/')) {
        sport.photoUrl = saveImageDataUrl(photo, 'cricket')
      }
    }
    const cricketError = cricketEntryError({
      event,
      fullName,
      mobile,
      location,
      sports,
    })
    if (cricketError) {
      res.status(400).json({ error: cricketError })
      return
    }
    const conflict = await findRegistrationMobileConflict(mobile, sports, id, event)
    if (conflict) {
      res.status(409).json({ error: conflict })
      return
    }

    await pool.query(
      `UPDATE registrations
       SET event = $1, full_name = $2, mobile = $3, location = $4, gender = $5, sports = $6::jsonb
       WHERE id = $7`,
      [event, fullName, mobile, location, gender, JSON.stringify(sports), id],
    )

    await recalculateSeatStatuses()

    const updated = await pool.query(
      `SELECT ${REGISTRATION_COLUMNS} FROM registrations WHERE id = $1`,
      [id],
    )

    broadcastRegistrationsUpdated()
    res.json(rowToRegistration(updated.rows[0]))
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Failed to update registration' })
  }
})

app.post('/api/registrations/bulk-delete', async (req, res) => {
  if (!requireAdmin(req, res, ['superadmin'])) return
  try {
    const ids = Array.isArray(req.body?.ids)
      ? [...new Set(req.body.ids.map((id) => String(id || '').trim()).filter(Boolean))]
      : []
    if (ids.length === 0) {
      res.status(400).json({ error: 'No registration ids provided' })
      return
    }

    const existing = await pool.query(
      `SELECT sports, payment_shot_url FROM registrations WHERE id = ANY($1::text[])`,
      [ids],
    )
    const result = await pool.query(
      `DELETE FROM registrations WHERE id = ANY($1::text[]) RETURNING id`,
      [ids],
    )
    await releaseUploads(existing.rows.flatMap((row) => collectUploadUrls(row)))
    await recalculateSeatStatuses()
    broadcastRegistrationsUpdated()
    res.json({ ok: true, deleted: result.rowCount, ids: result.rows.map((r) => r.id) })
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Failed to bulk delete registrations' })
  }
})

app.post('/api/registrations/reset', async (req, res) => {
  if (!requireAdmin(req, res, ['superadmin'])) return
  try {
    const confirm = String(req.body?.confirm || '')
    if (confirm !== 'RESET') {
      res.status(400).json({ error: 'Send { "confirm": "RESET" } to wipe all registrations' })
      return
    }
    const result = await pool.query(`DELETE FROM registrations RETURNING id`)
    clearUploadFiles()
    await recalculateSeatStatuses()
    broadcastRegistrationsUpdated()
    res.json({ ok: true, deleted: result.rowCount })
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Failed to reset registrations' })
  }
})

const distDir = path.join(rootDir, 'dist')
app.use(
  '/uploads',
  express.static(uploadRoot, {
    fallthrough: false,
    index: false,
    maxAge: '7d',
  }),
)
app.use(express.static(distDir))
app.get(/^(?!\/api).*/, (_req, res) => {
  res.sendFile(path.join(distDir, 'index.html'), (err) => {
    if (err) res.status(404).send('Frontend not built. Run npm run build.')
  })
})

async function start() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required')
    process.exit(1)
  }

  await ensureSchema()
  await recalculateSeatStatuses()
  server.listen(port, () => {
    console.log(`CHANSMA API + WebSocket on http://localhost:${port}`)
    console.log(`Uploads folder: ${uploadRoot}`)
  })
}

start().catch((error) => {
  console.error('Failed to start server', error)
  process.exit(1)
})
