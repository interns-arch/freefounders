# FreeFounders: notes for Claude

Read `PLAN.md` first. It is the source of truth for decisions and the phase roadmap.

## What this repo is
A **new application** built from copies of two existing apps. The originals keep
running standalone and must **never be modified** from here:

| Original (read-only, do not edit) | Copied to | Copied from |
|---|---|---|
| `Desktop/Automation_Task-main/Automation_Task-main` (Django, live for CarTrends on EC2) | `services/tasks/` | branch `feature/delegated-dashboard-whatsapp` @ `bc785fe` |
| `Desktop/assessets managaeman system` (NestJS + React) | `services/assets/` | branch `main` @ `627165f` |

Copies were taken with `git archive` on 2026-10-07; history stays in the original repos.
If later work lands in an original and should come here, copy it over deliberately; never
edit, commit, push or switch branches in the original folders.

## Layout
```
services/platform/  NestJS: companies, people, single login (EdDSA tokens + JWKS), people admin
services/tasks/     Django 6 API (backend/) + React 18 web (frontend/) + Capacitor shell (mobile/)
services/assets/    NestJS API (apps/api) + React 19 web (apps/web) + shared Zod (packages/shared)
apps/portal/        React: sign in, choose workspace, change password, People & access
infra/gateway/      dev-gateway.mjs (one address, routed by path) + Caddyfile (prod draft)
scripts/            setup / dev / smoke for the whole suite      e2e/  Playwright browser tests
```
Later phases add `apps/web`, `apps/mobile`, `packages/*` (see PLAN.md §8).

## Whole suite with single login (usual way to work)
```
npm run setup        # once: npm ci everywhere + Tasks venv
npm run dev          # everything on http://localhost:8080 — sign in: owner / Demo@1234
npm run smoke        # end-to-end API check against the running suite (9 steps)
npm run e2e          # browser tests against the running suite (first time: npx --prefix e2e playwright install chromium)
```
Routes on :8080: `/` portal · `/api/platform/*` Platform (:4000) · `/tasks/` web (:5174) and
`/tasks/api/*` Django (:8000) · `/assets/` web (:5173) and `/assets/api/*` NestJS (:3000) · `/media/*` Django.
Single login is a build/env switch, off by default so each app still runs standalone:
- web: `VITE_PLATFORM_LOGIN=true` + `VITE_BASE=/tasks/` or `/assets/` (see `src/platform.js`, `src/lib/platform.ts`)
- APIs: `PLATFORM_JWKS_URL` (Tasks, Assets); Platform: `TASKS_INTERNAL_URL`, `ASSETS_INTERNAL_URL`, `PLATFORM_SECRET`
How it fits: PLAN.md §13. Tasks uses the Platform token directly (Bearer); Assets exchanges it for
a 15-minute cookie session (`/api/auth/platform-session`) so photos/downloads keep working.

## Run and test each part
Platform (Node 22+; embedded Postgres on 5434):
```
cd services/platform && npm ci
npm run dev          # http://localhost:4000/api/platform
npm run typecheck && npm test
```
Tasks (Python 3.12+; Docker image uses 3.13):
```
cd services/tasks/backend
python -m venv .venv && .venv\Scripts\pip install -r requirements.txt
.venv\Scripts\python manage.py migrate && .venv\Scripts\python manage.py runserver 8000
# tests (SQLite, no scheduler thread; ~15 s):
set DATABASE_URL= & set NOTIF_SCHEDULER=false & .venv\Scripts\python manage.py test
cd ../frontend && npm ci && npm run dev
```
Assets (Node 22+; embedded Postgres on 5433):
```
cd services/assets && npm ci
npm run dev          # http://localhost:5173
npm run typecheck && npm test
```
Portal: `cd apps/portal && npm ci && npm run build` (typecheck + build).

Git Bash note: prefix env values that start with `/` with `MSYS_NO_PATHCONV=1`, or `VITE_BASE=/tasks/`
becomes a Windows path.

## Rules
- Every phase ends with all tests green. Do not change existing behaviour unless the plan says so.
- Secrets never go in the repo: no `.env`, `.pem`, keys. Use `.env.example` for documentation.
- Screens get data via hooks/API clients only; colours/spacing from theme tokens (PLAN.md §6).
- Do not touch the live CarTrends EC2 server from this repo.
- Platform passwords are hashed only; never add a reversible copy. Provision never takes over a
  login already linked to another person.
- Keep single-login changes behind the flags above: with them off, each app must behave as before.
