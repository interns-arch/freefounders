# FreeFounders: Master Plan

> One subscription product. One login. Two apps: **Tasks** (task automation + HR) and **Assets** (asset management).
> Web + Android app (React Native). Sold in India, priced per user per month.
>
> This file is the single source of truth. Update it whenever a decision changes.

---

## 0. Decisions locked in

| Topic | Decision |
|---|---|
| Product name | **FreeFounders** (apps: *FreeFounders Tasks*, *FreeFounders Assets*) |
| Domain | freefounders (TLD to confirm: .com / .in) → `app.`, `api.`, `admin.` subdomains |
| Backends | **Keep both**: Django (Tasks + HR), NestJS (Assets). Add a new Platform layer |
| Originals | **FreeFounders is a completely new application.** Code is *copied* from the two existing apps, which stay standalone and are **never modified** (decided 2026-10-07) |
| Mobile | **React Native (Expo)**, Play Store first, iOS later |
| Market | **India only**: INR, GST invoices, Razorpay, data hosted in AWS Mumbai |
| Launch scope | **Tasks + HR (attendance, leave) + Assets**. Everything else stays in the code but is switched off |
| Team | Claude (builds) + Founder (decides, tests, owns accounts/legal). We work one phase at a time |
| Login | One ID/password for everything → app chooser → app switcher in header |
| Updates | One repo; merge to `main` auto-deploys; web refreshes, mobile updates over-the-air |

### Launch scope detail
| Module | At launch | Notes |
|---|---|---|
| Tasks (delegation, review, change requests, checklists, recurring, templates, reports, team performance) | ✅ ON | Core |
| Notices, Groups | ✅ ON | Small; part of Tasks |
| HR: attendance (geofence, face), leave, holidays, comp-off | ✅ ON | |
| Assets (full asset app incl. QR, onboarding/exit, requests, tickets, maintenance) | ✅ ON | |
| Payroll | ⏸ OFF | Built, but needs PF/PT compliance review before selling |
| Leads CRM, Intake (Gmail), Quotations | ⏸ OFF | Phase 2 product |
| Mistake Register, SOPs | ⏸ OFF | Phase 2 product |
| Web Forms, Links, Ideas | ⏸ OFF | Phase 2 product |
| SIM reconciliation (Airtel / Salary Box) | ⏸ OFF | CarTrends-specific; keep for CarTrends only |

"OFF" means hidden by a module switch. **No code is deleted.**

---

## 1. Starting point (as of 2026-10-07)

| | Assets | Tasks |
|---|---|---|
| Path | `assessets managaeman system/` | `Automation_Task-main/wt-delegated/` (newest) |
| Stack | NestJS 11, React 19, Drizzle, Postgres | Django 6 + DRF, React 18, Postgres |
| Auth | Session cookie, argon2id | JWT (SimpleJWT), stored in localStorage |
| Roles | DB-backed and editable (24 permissions) | **Hard-coded**: 20 roles in `accounts/models.py`; permissions in a dict in `accounts/permissions.py`; role-name checks in about 14 files |
| Tenancy | Single company | Single company |
| Tests | About 45 | About 642 |
| Live users | Unknown / Render | **CarTrends, live on EC2** (Docker, Postgres 18) |

### Known problems to fix
- ~~`wt-delegated`: unpushed commits; worktree link broken~~ → `freefounders/` held stale *copies*; the real repos are still on the Desktop. All 55 local-only commits are now on GitHub as new branches (Tasks: `feature/delegated-dashboard-whatsapp`, `wip/overdue-email`; Assets: `backup/original-history-20261007`, same code as GitHub `main` with the original history). Bundles in `backups/`.
- ~~Main Tasks folder: uncommitted WIP~~ → saved as branch `wip/overdue-email`; it is an older draft of the overdue email already finished in `e17c047`. The original folder was left exactly as it was.
- ~~`CT_EC2_key (1).pem` in the project folder~~ → copied to `~/.ssh/cartrends-ec2.pem` (owner-only), removed from `freefounders/`. The Desktop original stays because `switch-domain-to-automation-task.sh` uses it by relative path.
- ~~`backend/.env.example` broken AI block~~ → fixed in `services/tasks` (duplicate block removed, placeholder `AI_PROVIDER`/`AI_MODEL` values blanked).
- Assets stores passwords reversibly (admin can view them). **Must be removed** before selling.
- Tasks scheduler is a thread inside the web process, which limits it to 1 worker.
- No scheduled backups.

---

## 2. Architecture

```
  Web (React)            Android (Expo React Native)
        \                     /
         packages/core  ── API clients, hooks, permissions, validation (NO UI)
         packages/theme ── colours, fonts, spacing tokens
                  │
         https://api.freefounders.*   (gateway / reverse proxy)
     ┌────────────┼─────────────────┬──────────────────┐
  Platform     Tasks API          Assets API        Workers
  (NestJS)     (Django)           (NestJS)          (Celery + BullMQ)
  login,       tasks, HR,         assets,           reminders, WhatsApp,
  companies,   notices            onboarding/exit,  email, push, recurring
  people,                         tickets           duties
  roles,
  settings,
  billing
     └────────────┴──── PostgreSQL (schemas: platform, tasks, assets) ──┘
                         every row has company_id + Row-Level Security
                         Redis · S3 (ap-south-1) · Sentry
```

### Why the Platform service is NestJS
Assets already has the session/role/permission code we need in TypeScript, and shares Zod schemas with the frontend. Platform grows out of that code instead of starting from scratch.

### Single login: how both backends trust it
1. User logs in at Platform → gets a short-lived **access token** (JWT, 15 min) + refresh token (httpOnly cookie on web, secure storage on mobile).
2. Token carries: `user_id`, `company_id`, `apps[]`, `roles[]`, `perm_version`.
3. Django and NestJS both verify the token with Platform's public key (no DB call).
4. Permissions are fetched from Platform once and cached; `perm_version` changes the moment an admin edits a role, so caches refresh.
5. Logout / password change / deactivation revokes refresh tokens everywhere.

### Multi-company (tenancy)
- `company_id` column on every table in all three databases' schemas.
- Postgres **Row-Level Security**: the API sets `app.company_id` per request. Even a buggy query cannot read another company's rows.
- Remove single-company assumptions:
  - Assets: `defaultCompanyId()`, `defaultStoreId()`
  - Tasks: `TaskSettings` singleton, HR env vars
  - Both: WhatsApp/Gmail/AI credentials (become per-company settings, encrypted)
- **CarTrends becomes company #1.** Its live data is migrated, not re-entered (see Phase 2).

---

## 3. One login + app chooser

```
Login (email / username / employee code / mobile OTP*)  →  how many apps can this user open?
   1 app  → open it directly
   2 apps → "Choose your workspace": [Tasks] [Assets]  (☐ remember my choice)
In any app: header switcher [Tasks ⇄ Assets] — no second login.
```
\* Mobile OTP comes after launch (SMS cost).

An app shows in the chooser only if **the company's plan includes it AND the user's role can open it**.

### One People directory
Today: Assets has `users` + `employees`; Tasks has `User`. They become **one `people` table in Platform**:
- Person: name, employee code, email, mobile/WhatsApp, department, location, reports-to, status, joined/exit dates, photo.
- Login (optional per person): username, password hash (argon2id), active, lockout.
- Tasks and Assets keep their own tables but reference `person_id`. Existing IDs are mapped during migration.
- Matching CarTrends people across the two apps: by employee code, then email, then mobile; anything unmatched goes on a review list for the founder.

---

## 4. Access levels, custom roles and responsibilities

### Levels
| Level | Who | Powers |
|---|---|---|
| Platform owner | FreeFounders (us) | All companies, plans, pricing, suspend, support login (logged) |
| Company Super Admin | Customer's owner | Everything in their company incl. billing; cannot be locked out |
| Admin | Customer admins | Users, roles, settings, both apps; no billing |
| Custom roles | Created by admins | Exactly what is ticked |

### Role builder (admin UI)
- Create / edit / duplicate / archive roles: name, description, colour, default department, level (Manager / Lead / Member).
- **Permission matrix with scope.** Each permission is ticked with a scope: *Own · Team I manage · Department · Location · Whole company*.
- **Multiple roles per person**; their permissions are combined.
- Today's 20 CarTrends roles become **starter templates** offered to every new company.
- Locked system roles: Super Admin, Admin.

### Unified permission catalogue (draft)
```
platform.users.manage   platform.roles.manage   platform.settings.manage   platform.billing.manage
tasks.view[scope]  tasks.create  tasks.assign[scope]  tasks.approve_completion[scope]
tasks.delete[scope]  tasks.reports[scope]  tasks.templates.manage  tasks.categories.manage
notices.publish  groups.manage
hr.attendance.view[scope]  hr.attendance.mark  hr.leave.approve[scope]  hr.settings.manage  hr.face.enrol
assets.view[scope]  assets.create  assets.edit  assets.assign  assets.lifecycle  assets.labels
assets.catalog.manage  assets.onboarding  assets.exit[.override]  assets.requests.approve
assets.requests.fulfil  assets.tickets.manage  assets.maintenance  assets.history
dashboard.view[scope]  leadership.view
```
The final list is built by reading every existing check in both codebases. Nothing may be lost.

### Responsibilities (per role)
- **Recurring duties**: "Warehouse Manager: stock check, daily 10:00" → auto-created as tasks for everyone holding the role.
- **Onboarding checklist + SOPs** attached to the role → new joiner gets them on day 1 (and the asset onboarding kit).
- **KPIs** shown on Team Performance: on-time %, tasks closed, overdue, attendance %.
- **Approval chain**: e.g. Member → Manager → Admin, per request type (leave, task change, asset request, completion).

### Safe migration of Tasks roles (no behaviour change)
1. Create `roles` + `role_permissions` tables; seed them with **exactly** today's `ROLE_CAPABILITIES`.
2. `has_capability()` reads from the DB (cached) instead of the dict.
3. Replace each `role == ...` / `TOP_ADMIN_ROLES` / `ROLE_DEFAULT_DEPARTMENT` / `ROLE_LEVEL` use in about 14 files with permission or setting checks.
4. **All 642 tests must pass unchanged.** Then add the role-builder UI.

---

## 5. Settings Center (admins add features themselves)

| Setting | Launch | Later |
|---|---|---|
| Module switches (within plan) | ✅ | |
| Departments, locations, designations | ✅ | |
| Roles & permissions, responsibilities | ✅ | |
| Task categories, priorities, completion evidence rules | ✅ | Custom statuses |
| Custom fields on Assets (exists) | ✅ | On Tasks, People |
| HR rules: hours, grace, week-offs, holidays, geofence, face check | ✅ | |
| Approval chains | ✅ | |
| Notification rules (in-app / email / WhatsApp / push per event) | ✅ | |
| Branding: logo, colours, name on labels/PDFs | ✅ | Custom domain |
| Integrations: own WhatsApp number, email sender | | ✅ |
| Automation rules ("when X → do Y") | 3 built-in rules | ✅ Rule builder |

Built-in cross-app rules at launch:
1. Employee exit started (HR) → asset return case opened (Assets) + exit tasks created (Tasks).
2. New joiner added → onboarding kit (Assets) + role checklist tasks (Tasks).
3. Asset ticket raised → task assigned to the IT owner, linked both ways.

---

## 6. UI that can be fully redesigned without breaking features

Rules (enforced in code review):
1. Screens do **no** data fetching or business logic. They call hooks from `packages/core` only.
2. All colours, fonts, radius and spacing come from `packages/theme` tokens. No hard-coded colours in screens.
3. API clients are **generated** from OpenAPI (NestJS Swagger, drf-spectacular). A backend change that breaks a screen fails the build.
4. Enum lists (priorities, statuses) come from the API/shared package, never typed into screens.
5. **Behaviour tests** find elements by role/label/text, not CSS:
   - Web: Playwright, one suite per module.
   - Mobile: Maestro flows.
   - A redesign ships only when every suite passes.

---

## 7. Mobile app (Expo React Native)

- **Launch screens:** login → app chooser → Home (my tasks, today's attendance, notices).
  - **Tasks:** list, detail, create, complete with proof photo, accept/send back, change requests.
  - **HR:** check-in/out (GPS + face), leave apply/approve, holidays.
  - **Assets:** scan QR/barcode, asset detail, my assets, assign/return, raise request/ticket, photos.
  - Notifications + push. Profile + app switcher.
- **Libraries:** Expo Router, NativeWind, expo-camera (scan), expo-location, expo-notifications, expo-secure-store, on-device face matching (to be chosen in Phase 7).
- **Updates:** **EAS Update** for over-the-air JS updates; force-update screen when the app version is too old.
- **Play Store:**
  - Create an **Organization** developer account. It needs a D-U-N-S number, and organization accounts skip the 12-tester closed-test rule that applies to new personal accounts.
  - Privacy policy URL and data-safety form (location, camera, biometrics).
- **No in-app purchase.** Companies subscribe on the website; the app only signs in. Re-check the Play payments policy before submission.

---

## 8. One codebase, everyone always on the latest code

```
freefounders/                     (one GitHub repo, pnpm + Turborepo)
  apps/web          React 19 + Vite
  apps/mobile       Expo
  apps/admin        Platform-owner console
  services/platform NestJS
  services/assets   NestJS   (copied from the original; originals untouched)
  services/tasks    Django   (copied from the original; originals untouched)
  packages/core     shared logic + generated API clients
  packages/theme    design tokens
  packages/shared   Zod schemas / enums
  infra/            docker-compose, deploy scripts, backups
  PLAN.md  CLAUDE.md
```
- `main` is protected. All work goes through a branch → PR → CI (all tests) → merge.
- Merge → auto-deploy to **staging**; promote to **production** with one click.
- Web: "New version available, refresh" banner. Mobile: OTA update on next open.
- `CLAUDE.md` holds how to run, test and deploy, so every Claude session starts with the same knowledge.

---

## 9. Subscriptions (India)

**Proposed pricing** (validate with 3–5 prospects before launch):
| Plan | Price / active user / month | Includes |
|---|---|---|
| Tasks | ₹99 | Tasks + HR (attendance, leave) |
| Assets | ₹79 | Assets |
| Suite | ₹149 | Both + cross-app automation |
- 14-day free trial, no card required. Minimum 5 users. Annual = 2 months free.
- Billing: Razorpay Subscriptions (UPI Autopay, cards, NetBanking); quantity = active users; changes prorated.
- GST: 18% on SaaS, GSTIN captured at signup, tax invoice PDF per cycle.
- Failed payment → 7-day grace → read-only → suspended (data kept 90 days).
- **Platform owner console:** companies, MRR, trials, failed payments, plan overrides, support login (audited).

---

## 10. Compliance & operations
- **DPDP Act 2023:** consent screens for location and face data, purpose stated, retention + deletion, data export per company, grievance contact.
- Face data: store descriptors only (already the case); add liveness check before scaling.
- Hosting: AWS Mumbai. Nightly encrypted Postgres backups + monthly restore test.
- Sentry (web, mobile, all 3 services), uptime monitor, status page.
- Terms of Service, Privacy Policy, Refund Policy (Razorpay needs these live).
- Secrets live in AWS Secrets Manager / env, never in the repo or project folder.

---

## 11. Roadmap

Each phase ends with: all tests green, deployed to staging, founder sign-off.

| # | Phase | Main deliverables | Size |
|---|---|---|---|
| 0 | **Clean-up & new repo** | Push commits, save WIP, remove `.pem`, fix `.env.example`. New repo with copied code, CI, `CLAUDE.md`, staging environment | S |
| 1 | **Platform core** | Platform service, companies, People directory, single login (web), app chooser + switcher, both backends accept the platform token | L |
| 2 | **Multi-company + CarTrends migration** | `company_id` + RLS everywhere, remove single-company code, drop password vault, jobs moved to Celery/BullMQ, cross-company leak tests. **Migrate live CarTrends data with a dry run first** | L |
| 3 | **Dynamic roles** | DB roles (642 tests unchanged), unified permission catalogue with scopes, multiple roles per user, role builder UI | M |
| 4 | **Settings Center + module switches** | Section 5 launch items; launch-scope modules switched off | M |
| 5 | **Responsibilities & cross-app rules** | Recurring duties, role checklists, KPIs, approval chains, 3 built-in rules | M |
| 6 | **New web app** | `packages/core` + `theme`, new design, port modules one by one with Playwright parity tests | L |
| 7 | **Mobile app** | Expo app (section 7), Maestro tests, internal → closed → production track | L |
| 8 | **Subscriptions** | Plans, Razorpay, trials, GST invoices, signup flow, owner console | M |
| 9 | **Launch** | Legal pages, DPDP consent, backups, monitoring, marketing site on the domain | S |

### Founder's checklist (things only you can do)
- [ ] Confirm the domain TLD and DNS access
- [ ] GitHub organization `freefounders` (or similar); add the existing repos
- [ ] AWS account in company name (Mumbai region)
- [ ] Razorpay business account + KYC (needs company PAN, GST, bank, website with policies)
- [ ] Google Play **Organization** developer account (D-U-N-S number, ₹ one-time fee)
- [ ] Meta WhatsApp Business verification for the FreeFounders sender number
- [ ] Decide what CarTrends pays (free as launch partner?)
- [ ] Logo + brand colours (or ask Claude to propose)

---

## 12. Open questions
1. Domain: `freefounders.com` or `.in`? Already owned?
2. Does CarTrends keep using the current EC2 app until Phase 2 is done? (Recommended: yes, no disruption.)
3. Where is Assets used live today, and by whom? (Render? same CarTrends staff?)
4. Payroll: switched on for CarTrends only, or hidden for everyone at launch?
