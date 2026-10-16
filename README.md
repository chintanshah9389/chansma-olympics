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

## Render

`render.yaml` defines a free web service and a free Postgres database in Singapore.

1. Push this repo to GitHub.
2. In Render, choose **New → Blueprint** and select this repository.
3. After the first deploy, copy the generated `ADMIN_PASSWORD` and `SUPERADMIN_PASSWORD` from the service environment.
4. Load the registration workbook into that database from this machine (the workbook stays local; it is not committed):

```bash
DATABASE_URL="postgres://..." DATABASE_SSL=true npm run import:xls -- "C:\Users\9389c\Downloads\chansma-registrations-2026-10-13-v1.xls"
```

Use Render’s **external** database URL for that command, and `DATABASE_SSL=true`. The service itself uses the internal URL with `DATABASE_SSL=false`.

Free Render Postgres expires 30 days after it is created. Player photos and receipt files are not inside the spreadsheet; only their old Railway paths are imported.

Live slot counts use **WebSocket** (`/ws`): when anyone saves/deletes a registration, all connected browsers update immediately (no 2-second polling).

## API

- `GET /api/health`
- `GET /api/registrations`
- `POST /api/registrations`
- `DELETE /api/registrations/:id`
- `WS /ws` — realtime updates
