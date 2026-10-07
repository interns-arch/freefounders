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
services/tasks/    Django 6 API (backend/) + React 18 web (frontend/) + Capacitor shell (mobile/)
services/assets/   NestJS API (apps/api) + React 19 web (apps/web) + shared Zod (packages/shared)
PLAN.md            master plan        .github/workflows/ci.yml   CI for both
```
Later phases add `services/platform`, `apps/web`, `apps/mobile`, `packages/*` (see PLAN.md §8).

## Run and test
Tasks (Python 3.12+; Docker image uses 3.13):
```
cd services/tasks/backend
python -m venv .venv && .venv\Scripts\pip install -r requirements.txt
.venv\Scripts\python manage.py migrate && .venv\Scripts\python manage.py runserver 8000
# tests (SQLite, no scheduler thread):
set DATABASE_URL= & set NOTIF_SCHEDULER=false & .venv\Scripts\python manage.py test
cd ../frontend && npm ci && npm run dev        # http://localhost:5174
```
Assets (Node 22+; starts its own embedded Postgres):
```
cd services/assets && npm ci
npm run dev          # http://localhost:5173
npm run typecheck && npm test
```

## Rules
- Every phase ends with all tests green. Do not change existing behaviour unless the plan says so.
- Secrets never go in the repo: no `.env`, `.pem`, keys. Use `.env.example` for documentation.
- Screens get data via hooks/API clients only; colours/spacing from theme tokens (PLAN.md §6).
- Do not touch the live CarTrends EC2 server from this repo.
