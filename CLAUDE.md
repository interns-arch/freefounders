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
apps/web/           THE web app (Phase 6, PLAN.md §18): sign-in, chooser, Admin, Tasks, HR, Assets screens
packages/core/      shared logic for web + mobile: HTTP client, session, typed APIs + hooks per area (no DOM)
packages/theme/     design tokens (tokens.css for web, src/tokens.ts for mobile; kept identical by a check)
apps/portal/        the old portal (no longer served; replaced by apps/web)
infra/gateway/      dev-gateway.mjs (one address, routed by path) + Caddyfile (prod draft)
scripts/            setup / dev / smoke / check-web-rules      e2e/  Playwright browser tests
```
The repo root is an npm workspace for `apps/web` + `packages/*` (one `npm ci` at the root); the services keep their own installs.
Phase 7 adds `apps/mobile`.

**Web app rules** (checked before every typecheck/build by `scripts/check-web-rules.mjs`): screens under `apps/web/src/app` and
`src/features` get data only from `@freefounders/core` hooks (no fetch, no HTTP client) and use theme colours only (no
hex/rgb/oklch). Each area owns `src/features/<area>/` and `packages/core/src/<area>/`. Same URLs as the old apps
(`/tasks/…`, `/assets/…`). **Every module is in the new app** (PLAN.md §19.10): the old web apps under `services/*/frontend`
and `services/assets/apps/web` are no longer served or started (their APIs are); `/classic/…` is gone.
Attendance is its own workspace at `/attendance/<tab>` (HR screens; `/tasks/hr?tab=` redirects), and `/` is the Workspace
Portal with punch-in (PLAN.md §19). Theme colours only: fixed Tailwind palette classes (blue-700…) are refused too.

## Whole suite with single login (usual way to work)
```
npm run setup        # once: npm ci everywhere + Tasks venv
npm run dev          # everything on http://localhost:8080 — sign in: owner / Demo@1234
npm run smoke        # end-to-end API check against the running suite (10 steps, incl. the cross-company check)
npm run e2e          # browser tests against the running suite (first time: npx --prefix e2e playwright install chromium)
npm run rehearse-import   # CarTrends import rehearsal on demo data, against the running suite
```
Routes on :8080: `/api/platform/*` Platform (:4000) · `/tasks/api/*` Django (:8000) · `/assets/api/*` NestJS (:3000) ·
`/media/*` Django · everything else the new web app (:5176). `/f/<token>?c=<company>` is the public web-form page. Web app alone: `npm run typecheck --workspace @freefounders/web`, `npm run web:build`.
Single login is a build/env switch, off by default so each app still runs standalone:
- old web apps (standalone only now): `VITE_PLATFORM_LOGIN=true` (see `src/platform.js`, `src/lib/platform.ts`)
- APIs: `PLATFORM_JWKS_URL` (Tasks, Assets); Platform: `TASKS_INTERNAL_URL`, `ASSETS_INTERNAL_URL`, `PLATFORM_SECRET`
How it fits: PLAN.md §13. Tasks uses the Platform token directly (Bearer); Assets exchanges it for
a 15-minute cookie session (`/api/auth/platform-session`) so photos/downloads keep working.

**Multi-company mode** (PLAN.md §14): `TENANCY=schemas` in Tasks and Assets, one Postgres schema per company
(`co_<code>`), picked per request from the token's `cid`; without a company the search path is the empty `ff_none`
schema (fail closed). `npm run dev` runs in this mode: Tasks on the local Postgres (:5434, db `ff_tasks`) with a
`run_worker` process, then `company sync`. Off by default, so each app still runs standalone and its tests are unchanged.
- Companies: `npm --prefix services/platform run company -- list | create … | sync`
- Tasks: `manage.py migrate_companies` (deploy), `run_worker` (jobs; web uses `NOTIF_SCHEDULER=false`),
  `company_setting <code> <NAME> <value>` (per-company HR/WhatsApp/Gmail/AI values)
- Assets: `migrate.js` also migrates every company schema; the seed does nothing in this mode
- Import an existing install: `node scripts/import-company.mjs` (dry run by default; see its header)

**What the Platform owns and pushes to the apps** (each push has a version; an app ignores an older one, and the Platform
moves past an app that is ahead and resends): roles + role duties (`PUT /internal/access`, §15/§17.3), company profile =
names/colour/logo/module switches (`PUT /internal/company`, §16), People directory = departments/reports-to/designation/
join date/active (`PUT /internal/people`, §17.1). `npm --prefix services/platform run company -- sync` resends all of it.

**Cross-app rules** (§17.4): each app writes an outbox (`ff_events` in Assets, `tenancy.OutboxEvent` in Tasks) only when
Platform sign-in is on; the Platform reads them with its service token (`GET /internal/events?after=`) every
`EVENT_POLL_SECONDS` (30; dev 5; 0 = off) and acts: ticket → task → ticket resolved, exit completed → person switched off.
"Start exit" (`POST /api/platform/people/:id/exit`) and new-joiner onboarding are started by the Platform.
Per-company settings in Tasks (HR rules, approvals, notification rules, exit checklist) live in `CompanySetting` and are edited
on the apps' own settings screens; `company_env` reads them (standalone installs too).

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
# multi-company tests need Postgres (start one: node services/platform/scripts/pg-up.mjs):
set DATABASE_URL=postgres://postgres:postgres@localhost:5434/ff_tasks & set DB_SSLMODE=disable & .venv\Scripts\python manage.py test tenancy
cd ../frontend && npm ci && npm run dev
```
Assets (Node 22+; embedded Postgres on 5433):
```
cd services/assets && npm ci
npm run dev          # http://localhost:5173
npm run typecheck && npm test
```
Web app: `npm ci` (root) then `npm run web:build` (rules + typecheck + build). Browser tests per area: `e2e/web-*.spec.ts`.

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
- Same for multi-company changes (`TENANCY`). Never query another company's schema from request code; the
  registry tables (`public.ff_companies`, `ff.companies`) are the only shared tables in the apps.
- Import reports (`import-report-*/`, `.data/`) list real people: never commit them.
