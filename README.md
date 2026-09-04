# CHANSMA Olympic Registration

Wizard registration form with **PostgreSQL** (Railway Hobby ready).

## Local setup

1. Create a Postgres database (local or Railway).
2. Copy env file:

```bash
cp .env.example .env
```

3. Set `DATABASE_URL` in `.env`.
4. Install and run:

```bash
npm install
npm run dev
```

- Frontend: http://localhost:5173 (proxies `/api` → API)
- API: http://localhost:3001

## Railway Hobby deploy

1. Create a new Railway project.
2. **Add PostgreSQL** plugin → copy `DATABASE_URL`.
3. Deploy this repo as a service.
4. Set variables on the service:
   - `DATABASE_URL` = Railway Postgres URL (usually auto-linked)
   - `DATABASE_SSL=true`
   - `PORT` = provided by Railway (optional; Railway sets this)
5. Build / start:
   - **Build command:** `npm install && npm run build`
   - **Start command:** `npm start`
6. Open the Railway public URL — API + frontend are served together.

The server creates the `registrations` table automatically on boot.

Live slot counts use **WebSocket** (`/ws`): when anyone saves/deletes a registration, all connected browsers update immediately (no 2-second polling).

## API

- `GET /api/health`
- `GET /api/registrations`
- `POST /api/registrations`
- `DELETE /api/registrations/:id`
- `WS /ws` — realtime updates
