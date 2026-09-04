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
  `)
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

function broadcastRegistrationsUpdated() {
  const message = JSON.stringify({ type: 'registrations-updated' })
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(message)
    }
  }
}

wss.on('connection', (socket) => {
  socket.send(JSON.stringify({ type: 'connected' }))
})

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, realtime: 'websocket' })
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

    if (!id || !fullName || !location || sports.length === 0) {
      res.status(400).json({ error: 'Missing required registration fields' })
      return
    }

    const result = await pool.query(
      `INSERT INTO registrations
        (id, full_name, mobile, location, gender, sports, created_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::timestamptz)
       RETURNING id, full_name, mobile, location, gender, sports, created_at`,
      [id, fullName, mobile, location, gender, JSON.stringify(sports), createdAt],
    )

    const saved = rowToRegistration(result.rows[0])
    broadcastRegistrationsUpdated()
    res.status(201).json(saved)
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
    broadcastRegistrationsUpdated()
    res.json({ ok: true, id: req.params.id })
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Failed to delete registration' })
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
  server.listen(port, () => {
    console.log(`CHANSMA API + WebSocket on http://localhost:${port}`)
  })
}

start().catch((error) => {
  console.error('Failed to start server', error)
  process.exit(1)
})
