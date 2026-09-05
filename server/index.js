import cors from 'cors'
import dotenv from 'dotenv'
import express from 'express'
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

const SPORT_IDS = Object.keys(DEFAULT_CAPACITIES)

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

async function readCapacities() {
  const result = await pool.query(
    `SELECT value FROM settings WHERE key = 'capacities' LIMIT 1`,
  )
  if (result.rowCount === 0) return { ...DEFAULT_CAPACITIES }
  return normalizeCapacities(result.rows[0].value)
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
}

function rowToRegistration(row) {
  return {
    id: row.id,
    fullName: row.full_name,
    mobile: row.mobile,
    location: row.location,
    gender: row.gender,
    sports: row.sports,
    createdAt: new Date(row.created_at).toISOString(),
  }
}

const app = express()
app.use(
  cors({
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
  }),
)
app.use(express.json({ limit: '1mb' }))

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

/**
 * Assign confirmed/waiting by registration time (oldest first).
 * First `capacity` seats per sport+gender are confirmed; the rest wait.
 * Runs after capacity changes and registration create/delete.
 */
async function recalculateSeatStatuses() {
  const capacities = await readCapacities()
  const result = await pool.query(
    `SELECT id, gender, sports, created_at
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
      const sportId = sport?.sportId
      if (!sportId || !SPORT_IDS.includes(sportId)) return
      const key = `${sportId}:${row.gender}`
      if (!buckets.has(key)) buckets.set(key, [])
      buckets.get(key).push({ id: row.id, index })
    })
  }

  for (const [key, entries] of buckets.entries()) {
    const [sportId, gender] = key.split(':')
    const cap = Number(capacities[sportId]?.[gender] ?? 0)
    entries.forEach((entry, position) => {
      const sports = sportsById.get(entry.id)
      if (!sports?.[entry.index]) return
      sports[entry.index].status = position < cap ? 'confirmed' : 'waiting'
    })
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
async function findRegistrationMobileConflict(_regMobile, sports, excludeId = null) {
  const result = await pool.query(
    `SELECT id, full_name, mobile, sports FROM registrations`,
  )

  for (const sport of sports) {
    const sportId = sport?.sportId
    if (!sportId || !SPORT_IDS.includes(sportId)) continue

    const targets = sportEntryMobiles(sport)
    if (targets.length === 0) continue

    for (const row of result.rows) {
      if (excludeId && row.id === excludeId) continue
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

app.get('/api/capacities', async (_req, res) => {
  try {
    res.json(await readCapacities())
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Failed to load capacities' })
  }
})

app.put('/api/capacities', async (req, res) => {
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

app.get('/api/registrations', async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, full_name, mobile, location, gender, sports, created_at
       FROM registrations
       ORDER BY created_at ASC`,
    )
    res.json(result.rows.map(rowToRegistration))
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Failed to load registrations' })
  }
})

app.post('/api/registrations', async (req, res) => {
  try {
    const body = req.body ?? {}
    const id = String(body.id || '')
    const fullName = String(body.fullName || '').trim()
    const mobile = String(body.mobile || '').replace(/\D/g, '')
    const location = String(body.location || '').trim()
    const gender = body.gender === 'female' ? 'female' : 'male'
    const sports = Array.isArray(body.sports) ? body.sports : []
    const createdAt = body.createdAt || new Date().toISOString()

    if (!id || !fullName || sports.length === 0) {
      res.status(400).json({ error: 'Missing required registration fields' })
      return
    }

    const conflict = await findRegistrationMobileConflict(mobile, sports)
    if (conflict) {
      res.status(409).json({ error: conflict })
      return
    }

    const result = await pool.query(
      `INSERT INTO registrations
        (id, full_name, mobile, location, gender, sports, created_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::timestamptz)
       RETURNING id`,
      [id, fullName, mobile, location, gender, JSON.stringify(sports), createdAt],
    )

    await recalculateSeatStatuses()

    const updated = await pool.query(
      `SELECT id, full_name, mobile, location, gender, sports, created_at
       FROM registrations WHERE id = $1`,
      [result.rows[0].id],
    )

    broadcastRegistrationsUpdated()
    res.status(201).json(rowToRegistration(updated.rows[0]))
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Failed to save registration' })
  }
})

app.delete('/api/registrations/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM registrations WHERE id = $1 RETURNING id`,
      [req.params.id],
    )
    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Registration not found' })
      return
    }
    await recalculateSeatStatuses()
    broadcastRegistrationsUpdated()
    res.json({ ok: true, id: req.params.id })
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Failed to delete registration' })
  }
})

app.put('/api/registrations/:id', async (req, res) => {
  try {
    const id = String(req.params.id || '')
    const body = req.body ?? {}
    const fullName = String(body.fullName || '').trim()
    const mobile = String(body.mobile || '').replace(/\D/g, '')
    const location = String(body.location || '').trim()
    const gender = body.gender === 'female' ? 'female' : 'male'
    const sports = Array.isArray(body.sports) ? body.sports : []

    if (!id || !fullName || sports.length === 0) {
      res.status(400).json({ error: 'Missing required registration fields' })
      return
    }

    const existing = await pool.query(
      `SELECT id FROM registrations WHERE id = $1`,
      [id],
    )
    if (existing.rowCount === 0) {
      res.status(404).json({ error: 'Registration not found' })
      return
    }

    const conflict = await findRegistrationMobileConflict(mobile, sports, id)
    if (conflict) {
      res.status(409).json({ error: conflict })
      return
    }

    await pool.query(
      `UPDATE registrations
       SET full_name = $1, mobile = $2, location = $3, gender = $4, sports = $5::jsonb
       WHERE id = $6`,
      [fullName, mobile, location, gender, JSON.stringify(sports), id],
    )

    await recalculateSeatStatuses()

    const updated = await pool.query(
      `SELECT id, full_name, mobile, location, gender, sports, created_at
       FROM registrations WHERE id = $1`,
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
  try {
    const ids = Array.isArray(req.body?.ids)
      ? [...new Set(req.body.ids.map((id) => String(id || '').trim()).filter(Boolean))]
      : []
    if (ids.length === 0) {
      res.status(400).json({ error: 'No registration ids provided' })
      return
    }

    const result = await pool.query(
      `DELETE FROM registrations WHERE id = ANY($1::text[]) RETURNING id`,
      [ids],
    )
    await recalculateSeatStatuses()
    broadcastRegistrationsUpdated()
    res.json({ ok: true, deleted: result.rowCount, ids: result.rows.map((r) => r.id) })
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Failed to bulk delete registrations' })
  }
})

app.post('/api/registrations/reset', async (req, res) => {
  try {
    const confirm = String(req.body?.confirm || '')
    if (confirm !== 'RESET') {
      res.status(400).json({ error: 'Send { "confirm": "RESET" } to wipe all registrations' })
      return
    }
    const result = await pool.query(`DELETE FROM registrations RETURNING id`)
    await recalculateSeatStatuses()
    broadcastRegistrationsUpdated()
    res.json({ ok: true, deleted: result.rowCount })
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Failed to reset registrations' })
  }
})

const distDir = path.join(rootDir, 'dist')
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
  })
}

start().catch((error) => {
  console.error('Failed to start server', error)
  process.exit(1)
})
