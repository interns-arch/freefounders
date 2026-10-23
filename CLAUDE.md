# FreeFounders: notes for Claude

Read `PLAN.md` first. It is the source of truth for decisions and the phase roadmap.

**Brand**: people see **Kaampilot** (kaampilot.com; logo in `apps/web/public/brand/`, `src/components/brand.tsx`); code identifiers stay `freefounders` (`@freefounders/*`, token audience, `window.FreeFoundersApp`, `com.freefounders.app`, `ff-*` keys). Never show "FreeFounders" to a person (PLAN.md §19.35).

## What this repo is
A **new application** built from copies of two existing apps. The originals keep
running standalone and must **never be modified** from here:

| Original (read-only, do not edit) | Copied to | Copied from |
|---|---|---|
| `Desktop/Automation_Task-main/Automation_Task-main` (Django, live for CarTrends on EC2) | `services/tasks/` | branch `feature/delegated-dashboard-whatsapp` @ `bc785fe`; Tasks changes ported up to `2bc1425` on 2026-10-20 (PLAN.md §19.30) |
| `Desktop/assessets managaeman system` (NestJS + React) | `services/assets/` | branch `main` @ `627165f` |

Copies were taken with `git archive` on 2026-10-07; history stays in the original repos.
If later work lands in an original and should come here, copy it over deliberately; never
edit, commit, push or switch branches in the original folders.

## Layout
```
services/platform/  NestJS: companies, people, single login (EdDSA tokens + JWKS), people admin
services/tasks/     Django 6 API (backend/)
services/assets/    NestJS API (apps/api) + shared Zod (packages/shared, also used by apps/web)
apps/web/           THE web app (Phase 6, PLAN.md §18): sign-in, Home, Admin, Tasks, HR, Assets screens
apps/mobile/        Android app = the web app in a native Expo shell (WebView + bridge: punch GPS/selfie, downloads, print, voice, punch-in reminders; PLAN.md §19.17, §19.32)
packages/core/      shared logic for web + mobile: HTTP client, session, typed APIs + hooks per area (no DOM)
packages/theme/     design tokens (tokens.css for web, src/tokens.ts; src/tokens.native.ts = generated hex copy for mobile; all checked)
infra/gateway/      dev-gateway.mjs (one address, routed by path) + Caddyfile (prod draft)
scripts/            setup / dev / smoke / check-web-rules      e2e/  Playwright browser tests
```
The repo root is an npm workspace for `apps/web` + `packages/*` (one `npm ci` at the root); the services keep their own installs.
`apps/mobile` is NOT in the workspace (own `node_modules`: Expo pins another React); it reads only `@freefounders/theme/native`
from source. Its web side is `apps/web/src/lib/native-bridge.ts` (used only inside the app; apps/mobile/README.md). After changing theme tokens run `node packages/theme/scripts/build-native.mjs`.

**Web app rules** (checked before every typecheck/build by `scripts/check-web-rules.mjs`): screens under `apps/web/src/app` and
`src/features` get data only from `@freefounders/core` hooks (no fetch, no HTTP client) and use theme colours only (no
hex/rgb/oklch). Each area owns `src/features/<area>/` and `packages/core/src/<area>/`. Same URLs as the old apps
(`/tasks/…`, `/assets/…`). **Every module is in the new app** (PLAN.md §19.10); the old web apps, the Capacitor shell and
`apps/portal` were deleted in §19.13 (git history has them). The services are APIs only.
Theme (PLAN.md §19.22 layout, §19.25 colours): flat SaaS. Light "indigo + emerald", dark "graphite + lime": `--primary` for
actions/links/active menu, `--cta` (`<Button variant="cta">`) only for the one main action of a screen (Punch in/out, Add
task…), white sidebar (graphite in dark mode), 12 px cards / 8 px controls; text ≥ 4.5:1 on its surface and on its own
tint; no gradients, glows or blur. A company's brand colour (Settings) still replaces `--primary` in both modes.
Phones keep 16 px text; under 640 px `--spacing` is 0.22rem (denser, less scrolling). Lite mode was removed (PLAN.md §19.36):
no `data-lite`; `prefers-reduced-motion` still switches motion off.
Icons: Hugeicons only, imported from `@/components/icons` (never `lucide-react`). No status dots and no capsule
(rounded-full) labels, chips or tabs: `rounded-sm`/`rounded-md`; round only for avatars, switches, radios, counters, icon buttons.
Attendance is its own area at `/attendance/<tab>` (HR screens; `/tasks/hr?tab=` redirects). `/` is **Home** inside the app
frame (attendance card with punch-in first, then Tasks/Assets counts, admin shortcuts; PLAN.md §19.14); on phones `/` lands on
`/attendance` and `/?home=1` opens Home. One menu for everything: sidebar groups Attendance / Tasks / Assets / Admin from
`features/*/nav.ts`, phone bottom bar Attendance · Home · Tasks · Assets · More. Notifications: one bell + `/notifications`,
grouped by area (Tasks `Notification.category`, Assets by type; PLAN.md §19.37); every notification links to its item. Theme colours only: fixed Tailwind palette
classes (blue-700…) are refused too.

## Whole suite with single login (usual way to work)
```
npm run setup        # once: npm ci everywhere + Tasks venv
npm run dev          # everything on http://localhost:8080 — sign in: owner / Demo@1234
npm run smoke        # end-to-end API check against the running suite (10 steps, incl. the cross-company check)
npm run e2e          # browser tests against the running suite (first time: npx --prefix e2e playwright install chromium)
npm run rehearse-import   # CarTrends import rehearsal on demo data, against the running suite
npm run mobile       # phone app: QR for Expo Go (same Wi-Fi; API = EXPO_PUBLIC_API_URL, default http://192.168.2.72:8080)
npm run mobile:check # phone app typecheck + unit tests (also: cd apps/mobile && npx expo export --platform android)
```
Routes on :8080: `/api/platform/*` Platform (:4000) · `/tasks/api/*` Django (:8000) · `/assets/api/*` NestJS (:3000) ·
`/media/*` Django · everything else the new web app (:5176). Web app alone: `npm run typecheck --workspace @freefounders/web`, `npm run web:build`.
Single login is an env switch on the APIs, off by default so each API still runs standalone:
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
```
Assets (Node 22+; embedded Postgres on 5433):
```
cd services/assets && npm ci
npm run dev          # API on http://localhost:3000/api
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
