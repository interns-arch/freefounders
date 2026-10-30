# Kaampilot Assets API (`services/assets`)

The Assets API of Kaampilot: everything a company owns, leases, stores or assigns (laptops, SIM cards, scooties,
keys, licences, buildings), custody and history, exits and new joiners. It is a copy of the original Asset Portal
(`assessets managaeman system`, branch `main` @ `627165f`, see the repo's CLAUDE.md). **This folder is an API only**:
the screens are the Kaampilot web app (`apps/web`, URLs `/assets/…`), which talks to it through `@kaampilot/core`.
The old React app (`apps/web` in the original) was removed here in PLAN.md §19.13.

## Run and test

Requirements: **Node.js 22+** (PostgreSQL is bundled and runs from npm, on port 5433).

```bash
npm ci
npm run dev          # database + API (auto-restart) on http://localhost:3000/api
npm run typecheck
npm test             # unit tests + API integration tests on a throwaway database
npm run db:reset     # wipe the local database and reload demo data
```

The usual way to work is the whole suite from the repo root (`npm run dev`, one address on :8080, single login
through the Platform). On its own, the first run creates a local database in `.data/` and loads demo data
(sign-in `admin@cartrend.test` / `Demo@1234`; the seed does nothing in multi-company mode).

## Features (API)

- **Universal asset system**: categories and asset types, all editable; individual tracking or by quantity;
  auto asset tags (`LAP-000123`) and QR codes.
- **Dynamic types and fields**: per category and per type (text, number, currency, date, yes/no, dropdown,
  multi-select, email, phone, URL; required / unique / min–max). Stored as JSONB, validated by the same rules
  (`packages/shared`) in the web app and the API, searchable and filterable.
- **Custody**: assign to an employee, department, location, company, vendor or inventory; transfer and return with
  condition and handover / return photos. The database prevents double assignment.
- **Exit / notice period**: recovery checklist of every held asset, scan-to-return, completion blocked until cleared
  or an authorised override (with reason). Completing the exit marks the employee Exited and disables their login.
- **Lifecycle**: Purchased → … → Assigned → Maintenance → Returned → Retired → Disposed (plus Lost / Found); only
  valid transitions are allowed.
- **Immutable history**: a database trigger rejects any UPDATE, DELETE or TRUNCATE of history.
- **Requests, tickets, maintenance, SIM register, reconciliation** (Airtel / Salary Box exports, read in the
  browser; only the needed columns are sent), **new joiners and joining kits**, **leadership overview**,
  **priority queue**.
- **Roles & permissions**: permission guard on every route, row scoping in services.

## Layout

```
apps/api          NestJS + Drizzle ORM + PostgreSQL
  src/db          schema, migrations (drizzle/), seed
  src/modules     auth, org, employees, catalog, assets, exit, service, insights, admin, …
packages/shared   zod schemas, lifecycle rules, permissions, custom-field validation (also used by apps/web)
scripts/          dev / test / reset with the bundled PostgreSQL
```

Key design points:

- **Custom fields**: definitions in `field_definitions`; values in `assets.attributes` (JSONB, GIN-indexed, part of
  the full-text search vector). `packages/shared/src/fields.ts` builds the validator from the definitions.
- **Custody** is recorded in `allocations`; a partial unique index allows one active allocation per individually
  tracked asset, and every change locks the asset row inside one transaction.
- **Lifecycle** is one table in `packages/shared/src/lifecycle.ts`, enforced by the API.
- **Security**: httpOnly session cookies (hashed in the DB), argon2id passwords, login lockout, CSRF header check,
  helmet, permission guard on every route.
- `packages/shared/dist` is the built shared package (`@eam/shared` `main`): the API needs it.

## Kaampilot switches

Production runs from `infra/deploy` (Docker Compose on the server), not from this folder.

| Variable        | Default                  | Notes                                            |
| --------------- | ------------------------ | ------------------------------------------------ |
| `DATABASE_URL`  | bundled local PostgreSQL | Any PostgreSQL 16+                               |
| `PORT`          | `3000`                   | API port                                         |
| `PUBLIC_URL`    | Wi-Fi IP in dev          | Address printed into QR codes                    |
| `SEED_DEMO`     | `true`                   | `false`: live setup, no demo data                |
| `COOKIE_SECURE` | `true` in production     | Set `false` only when not behind HTTPS           |
| `UPLOAD_DIR`    | `./.data/uploads`        | Handover / return photos (include in backups)    |
| `PLATFORM_JWKS_URL` | blank (off)          | Single login: the Platform's public keys, e.g. `http://localhost:4000/api/platform/.well-known/jwks.json`; the web app exchanges the Platform token for a 15-minute cookie session (`/api/auth/platform-session`) |
| `TENANCY`       | blank (off)              | `schemas`: multi-company mode, one schema per company (needs `PLATFORM_JWKS_URL`; companies are set up by the Platform; `migrate.js` updates every company) |

How these fit together: PLAN.md §13 (single login) and §14 (multi-company). Seeding only runs on an empty database,
so restarts never touch existing data.
