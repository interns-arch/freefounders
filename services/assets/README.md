# Asset Portal — Enterprise Asset Management

Track everything the company owns, leases, stores, assigns or uses — laptops, SIM cards, scooties,
helmets, keys, forklifts, software licences, buildings — in one system. Admins define new
categories, asset types and custom fields from the UI; no code changes are needed.

## Quick start

Requirements: **Node.js 22+** (nothing else — PostgreSQL is bundled and runs from npm).

```bash
npm install
npm run dev
```

Open **http://localhost:5173** and sign in. The first run creates a local database in `.data/`
and loads demo data.

| Demo account        | Role                | Password    |
| ------------------- | ------------------- | ----------- |
| admin@cartrend.test     | Admin               | `Demo@1234` |
| it@cartrend.test        | IT / Asset Manager  | `Demo@1234` |
| hr@cartrend.test        | HR                  | `Demo@1234` |
| manager@cartrend.test   | Manager             | `Demo@1234` |
| rahul@cartrend.test     | Employee (view only)| `Demo@1234` |
| CT000099             | Employee, no email — signs in with employee ID | `Demo@1234` |

Try the exit flow: sign in as **HR**, open *Employees → Rahul Sharma → Change status → Notice
period*. His 7 assets (laptop, charger, SIM, access card, scooty, helmet, keys) land on a recovery
checklist and IT is notified. Sign in as **IT** to scan them back; the exit stays blocked until
every item is cleared or HR records an override with a reason.

**One QR per person.** Every employee's QR is a link built from their employee ID, e.g.
`http://192.168.1.20:5173/id/CT000099`. Scan it with **any phone camera** or the app's **Scan**
screen and it opens that person with their details and everything assigned to them (sign in once
on that phone first). IT can then assign, return, or tap **Mark checked** (your register's
"last checked on"). Print ID cards from *Employees → select → Print ID cards*, or the employee
shows *My QR* on their own phone.

**Using it from phones.** `npm run dev` / `npm start` print a phone address such as
`http://192.168.1.20:5173` — phones on the same Wi-Fi open that, and QR codes use it. When Windows
asks whether Node.js may use the network, click **Allow** (private networks). Print ID cards after
starting this way; if the app shows a "can't open on a phone" warning, the QR points to localhost.
For a real server set `PUBLIC_URL` (e.g. `https://assets.yourcompany.com`); with HTTPS the in-app
camera also works on phones.

**Logins.** On a person's page IT taps **Give login (view only)**; a password is generated to
copy or share. The person signs in with their **employee ID** (or email if they have one) and
only sees their own assets and QR. The IT role has full access.

## Scripts

| Command            | What it does                                                            |
| ------------------ | ----------------------------------------------------------------------- |
| `npm run dev`      | Database + API (auto-restart) + web app (hot reload)                    |
| `npm test`         | Unit tests + API integration tests on a throwaway database             |
| `npm run build`    | Production build of the API and web app                                 |
| `npm start`        | Production mode on http://localhost:3000 (API serves the web app)       |
| `npm run db:reset` | Wipe the local database and reload demo data                            |

## Features

- **Universal asset system** — 9 starter categories and 55 asset types from IT to Facilities,
  all editable. Individual tracking (a laptop) or by quantity (gloves, licence seats).
  Auto asset tags (`LAP-000123`) and QR codes.
- **Dynamic types and fields** — per category (shared, e.g. Registration No. for all vehicles)
  and per type (e.g. RAM for laptops). Text, number, currency, date, yes/no, dropdown,
  multi-select, email, phone, URL; required / unique / min–max; drag to reorder; live form
  preview. Stored as JSONB, validated by the *same* rules in the browser and the API, searchable
  and filterable.
- **Custody** — assign to an employee, department, location, company, vendor or inventory;
  transfer and return with condition. Full assignment and ownership history. The database
  itself prevents double assignment. Handover and return photos (camera or gallery, shrunk to
  ~1600px in the browser) are saved with each assignment as proof of condition.
- **Exit / notice period** — automatic recovery checklist of every held asset, IT/Admin
  notification, last working day countdown, returned / pending / damaged / missing tracking,
  scan-to-return, and completion blocked until cleared or an authorised override (with reason)
  is recorded. Completing the exit marks the employee Exited and disables their login.
- **Lifecycle** — Purchased → Received → Inventory → Available → Assigned → Transferred →
  Maintenance → Returned → Available → Retired → Disposed (plus Lost / Found). Only valid
  transitions are allowed; the UI shows only valid next actions.
- **Immutable history** — every important action is recorded (who, what, when, before/after).
  A database trigger rejects any UPDATE, DELETE or TRUNCATE of history.
- **Fast UI** — dashboard, Ctrl+K search across everything, instant filters kept in the URL,
  server-side pagination, table / card views, status badges, slide-over forms, bulk actions
  (assign, change status, move, print labels), QR / barcode labels, camera and USB-scanner
  scanning, keyboard shortcuts (`?` lists them), toasts, empty / loading / error states,
  responsive with dark mode.
- **Universal quick add** — `+ Add` (or `N`) for Employee, Asset, Asset type, Category,
  Department, Location, Vendor, Request, Ticket, Maintenance.
- **Requests, tickets, maintenance** — request → approve → fulfil (assigns the asset);
  tickets against assets; maintenance moves an asset into and back out of service.
- **SIM register** — sidebar *SIM cards*: Connection Number, Billable Account, Circle, Plan and
  SIM Number for every SIM, with who holds it. *Employees → Phones & emails* lists official and
  personal phones and emails plus each person's company SIM; search finds people by SIM number.
- **Reconciliation** — upload the Airtel connections export or the Salary Box employee export
  (.xlsx). Each upload is checked against the SIM register / employees and the assets people hold,
  saved as a report (matched, mismatched, not in system, not in file) and notified to the team.
  The file is read in the browser and only the needed columns are sent; Aadhaar, PAN, bank details
  and addresses never leave the computer, and card numbers are masked.
- **New joiners** — HR adds the joiner (status *Joining*) with what they need (or a saved kit) and
  sends it to IT. IT approves it — or sends it back with a note — under *Requests → New joiners*,
  then assigns everything in one go (or item by item with photos). *Mark joined* makes them Active;
  anything not yet given stays as an approved request.
- **Joining kit & one-time items** — asset types can be *one-time (no return)*: joining kits,
  stationery. *Give* takes one from stock for good; it shows under *Given, no return* on the
  person and never in an exit checklist. New joiners get the joining kit ticked by default.
- **Sidebar by designation** — IT/Admin see the operational pages; HR sees Employees, New joiners
  and Exits; managers see Dashboard, Employees and Requests; the CEO sees Leadership; employees
  see only their own assets, requests, tickets and QR.
- **One company, one branch** — no company or location fields; anything "in store" goes to the
  single company store automatically.
- **Leadership overview** — for the new *Leadership* role (CEO): headcount, joiners/leavers,
  assets in use, IT service health and what each IT team member handled, by 7/30/90 days or a year.
- **Priority queue** — one worklist (`G Q`) of open tickets and requests to approve or fulfil,
  ordered Urgent → High → Medium → Low, then overdue, then oldest; also on the dashboard.
- **Logins** — IT chooses the login ID, email and password (or generates a password) from the
  person's page or Settings → Users. People sign in with the login ID, employee ID or email
  (any letter case). The role and login can also be set while adding the employee.
- **Roles & permissions** — Admin and IT / Asset Manager (full access), HR, Manager, and
  Employee (view only: their own assets and QR, plus requests and tickets). All editable.

## Architecture

```
apps/api          NestJS + Drizzle ORM + PostgreSQL
  src/db          schema, migrations (drizzle/), seed
  src/modules     auth, org, employees, catalog, assets, exit, service, insights, admin
apps/web          React 19 + Vite + Tailwind CSS + Radix (shadcn-style) + TanStack Query
packages/shared   zod schemas, lifecycle rules, permissions, custom-field validation
scripts/          one-command dev / test / start / reset (bundled PostgreSQL)
```

Key design points:

- **Custom fields**: definitions live in `field_definitions`; values in `assets.attributes`
  (JSONB, GIN-indexed, part of the full-text search vector). `packages/shared/src/fields.ts`
  builds the validator from definitions — used by forms and by every API write.
- **Custody** is recorded in `allocations` (one row per assignment). A partial unique index
  allows only one active allocation per individually-tracked asset; every change locks the
  asset row (`SELECT … FOR UPDATE`) inside one transaction.
- **Lifecycle** is one table in `packages/shared/src/lifecycle.ts`, enforced by the API and
  used by the UI to show allowed actions.
- **Security**: httpOnly session cookies (hashed in the DB), argon2id passwords, login lockout,
  CSRF header check, helmet + CSP, permission guard on every route, row scoping in services.
- **AI-ready**: all reads and writes go through permission-checked services behind a REST API
  (`/api/...`), so an AI assistant can be added later that acts as the signed-in user and can
  never bypass security.

## Production

```bash
npm run build
DATABASE_URL=postgres://user:pass@host:5432/eam SEED_DEMO=false ADMIN_LOGIN=admin npm start
```

On a **fresh database** with `SEED_DEMO=false` the first start creates the live setup: roles,
the company, departments, one store and the full asset catalog — no demo people or assets —
plus the first admin. Without `ADMIN_PASSWORD`, a one-time password is printed once in the
server log; sign in and change it (top-right menu → Change password).

### Render (free) from GitHub

- **Build:** `npm ci --include=dev && npm run build` · **Start:** `npm start` · Node 22 (`.node-version`)
- **Env:** `DATABASE_URL` (Render Postgres internal URL), `SEED_DEMO=false`, `ADMIN_LOGIN=admin`
- QR codes use Render's public address automatically; TLS to the database is on for remote hosts.
- Free tier: sleeps when idle, free Postgres expires after ~30 days, uploaded photos are lost on
  restart — fine for trials, use paid plans for real use.

| Variable        | Default                  | Notes                                            |
| --------------- | ------------------------ | ------------------------------------------------ |
| `DATABASE_URL`  | bundled local PostgreSQL | Any PostgreSQL 16+                               |
| `PORT`          | `3000`                   | API + web app port                               |
| `PUBLIC_URL`    | Render URL / Wi-Fi IP    | Address printed into QR codes                    |
| `SEED_DEMO`     | `true`                   | `false`: live setup, no demo data                |
| `ADMIN_LOGIN`   | `admin`                  | First admin's login ID (or use `ADMIN_EMAIL`)    |
| `ADMIN_PASSWORD`| generated                | Optional; otherwise printed once in the log      |
| `COOKIE_SECURE` | `true` in production     | Set `false` only when not behind HTTPS           |
| `UPLOAD_DIR`    | `./.data/uploads`        | Handover / return photos — include in backups    |

Seeding only runs on an empty database, so restarts never touch existing data.
