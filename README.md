# Chatterbox

Team chat with text channels, threads, voice/video calls, and a review-first shared file editor.

## Layout

```
api/                 Vercel function entry (exports the HTTP server)
src/server/          Express app, Socket.IO handlers, auth, database, storage
public/              Static client (index.html, app.js, styles.css, vendor/)
scripts/             Maintenance and documentation utilities (not deployed)
data/                Local runtime state: uploads/ and legacy SQLite files
deliverables/, shots/ Generated documentation assets
```

`src/server/config.js` resolves project paths and the data directory; `src/server/storage.js` switches between local disk and Vercel Blob.

## Run locally

Requires Node 22.9+ and PostgreSQL.

```bash
cp .env.example .env          # set DATABASE_URL
npm install
npm start                     # http://localhost:4599
```

Useful commands:

```bash
npm run dev                   # restart on file changes
npm run seed                  # reset with demo users (password: cord1234)
npm run db:import             # import data/cord.db into PostgreSQL
```

## Deploy to Vercel

1. Create a PostgreSQL database (Neon, Supabase, or any managed Postgres) and copy its connection string.
2. Optionally create a Vercel Blob store for uploads (Storage → Blob) so files survive instance restarts.
3. Import this repository in Vercel. No build step is needed; `api/index.js` is detected automatically.
4. Set environment variables in the project settings:

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | Include `sslmode=require` for managed Postgres |
| `PGSSL` | no | `require`, `no-verify`, or empty for the default |
| `BLOB_READ_WRITE_TOKEN` | for uploads | Enables Vercel Blob storage |
| `STUN_URL`, `TURN_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL` | no | WebRTC connectivity |
| `NODE_ENV` | no | `production` enables HSTS |

`vercel.json` routes `/api/*`, `/healthz`, and `/socket.io/*` to the single function while leaving `public/` static.

### Vercel behavior to know

- WebSocket connections are pinned to one function instance and close at the function's maximum duration (300s on Hobby). The Socket.IO client reconnects automatically.
- The app attaches the Postgres Socket.IO adapter on Vercel, so chat, thread, and document broadcasts cross instances. Use a direct (non-pooled) connection string for `DATABASE_URL` so `LISTEN/NOTIFY` works.
- Presence, typing indicators, and voice rooms are in-memory; with several concurrent instances, occupancy can be partial. Use a single instance or add Redis-backed presence for heavier use.
- Without `BLOB_READ_WRITE_TOKEN`, uploads land in `/tmp` and disappear when the instance recycles.
- Uploads are capped at 4 MB on Vercel (10 MB locally) because of the function request body limit.
- `scripts/` and `data/` are excluded from Vercel deployments; seed the hosted database from your machine with `DATABASE_URL` pointed at it.

## Docker

```bash
docker compose up --build
```

The image runs `src/server/index.js` and stores uploads under `/app/data`.
