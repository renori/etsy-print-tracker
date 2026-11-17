# Etsy Print Tracker

A self-hosted replacement for the Etsy 3D-print-shop Google Sheet: parts catalog,
print queue scheduler (plate packing, printer timelines, blackout windows),
active/completed orders, replacements, expenses, mileage, and Etsy order/ledger sync.

## Architecture

- **server/** — Fastify + Prisma + SQLite API, plus the print-queue scheduler
  (`server/src/scheduler/`) and Etsy Open API v3 integration (`server/src/etsy/`).
- **web/** — React (Vite) frontend.
- Single Docker image: the server serves the built frontend's static files
  under `/` and its own API under `/api`, so the NAS only needs one container
  and one exposed port.

## Running on your NAS

The image is built by GitHub Actions on every push to `main` and published to
`ghcr.io/renori/etsy-print-tracker:latest`. The NAS never builds anything.

1. In TOS Docker Manager, create a project from `docker-compose.yml` with your
   Etsy values filled in (or put them in a `.env` beside it — see `.env.example`).
2. Start it and open `http://<nas-ip>:9999`.

**Updating:** push to `main`. GitHub builds the image (~5 min), then the
`watchtower` container on the NAS notices within 5 minutes, pulls it and
restarts `print-tracker`. Your data volume is untouched. To update right away,
run the "Build image" workflow then restart the project in Docker Manager.

The GHCR package must be **public** (it holds no secrets; credentials only
come from the compose environment) or the NAS needs `docker login ghcr.io`
plus `REPO_USER`/`REPO_PASS` on watchtower.

To build locally instead, replace the `image:` line with `build: .`.

Your data lives entirely in the `tracker-data` Docker volume (one SQLite
file). Back it up by copying that file — e.g.
`docker run --rm -v etsy-tracker_tracker-data:/data -v $PWD:/backup alpine cp /data/tracker.db /backup/`.

## Connecting Etsy

1. Create an app at <https://www.etsy.com/developers/your-apps> and note its
   keystring (API key) and shop ID.
2. Set `ETSY_API_KEYSTRING`, `ETSY_SHOP_ID`, and `ETSY_REDIRECT_URI` in `.env`.
   `ETSY_REDIRECT_URI` must be reachable from your browser and match exactly
   what you register on the Etsy app — e.g. `http://<nas-ip>:9999/api/etsy/callback`.
3. Restart the container, then open the "Etsy Connection" page in the app and
   click **Connect Etsy Shop**.
4. Once connected, open orders and ledger entries sync automatically every
   15 minutes (or click **Sync now**).

**Note on the Etsy sync code**: it's written against the Open API v3 shape
documented at the time this was built. Etsy does occasionally revise field
names — if a sync run logs errors or orders come through with blank fields,
check `server/src/etsy/sync.ts` against a live API response and adjust the
field mapping there.

## What's a faithful port vs. a judgment call

The original sheet's scheduler logic (plate packing via Plate Recipes, the
blackout-window system, morning/home-time start windows) was reconstructed
from the detailed help text embedded in those tabs, not from the sheet's
actual Apps Script — the scheduler in `server/src/scheduler/` implements the
*documented* behavior, verified against the real example rows from the
sheet (see `server/src/scheduler/__tests__/scheduler.test.ts`). If real usage
turns up an edge case where this differs from the old sheet's behavior,
that's the file to adjust.

Everything else (data model, CRUD, order/stock lifecycle, replacement
expense logging) is a direct implementation of each tab's own stated rules.

## Local development

```bash
npm install            # from the repo root (installs both workspaces)
cd server && npx prisma migrate dev   # first time only, creates server/data/tracker.db
cd server && npm run dev   # API on :9999
cd web && npm run dev      # frontend on :5173, proxies /api to :9999
```

## Project layout

```
server/
  prisma/schema.prisma   # all 15 tabs' data model
  src/scheduler/         # pure-function plate packing + printer scheduling
  src/etsy/               # OAuth + order/ledger sync
  src/routes/             # REST API, one file per resource
web/
  src/pages/              # one page per sheet tab
  src/components/         # DataTable / FieldForm / PartsPicker — generic CRUD building blocks
```
