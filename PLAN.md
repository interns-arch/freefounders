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
  (NestJS)     (Django)           (NestJS)          (worker process)
  login,       tasks, HR,         assets,           reminders, WhatsApp,
  companies,   notices            onboarding/exit,  email, push, recurring
  people,                         tickets           duties
  roles,
  settings,
  billing
     └────────────┴──── PostgreSQL (schemas: platform, tasks, assets) ──┘
                         one schema per company in Tasks and Assets (§14)
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
- **One Postgres schema per company** in Tasks and Assets (decided 2026-10-08, replaces the earlier
  `company_id` + Row-Level Security idea). Each request is pinned to its company's schema; a query
  cannot reach another company's tables because they are not on its search path. Details: §14.
- Platform tables are shared and carry `company_id` (they already do).
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
| Attendance: company punch-in locations, **photo saved at every punch-in** and shown in the records (founder, 2026-10-08) | ✅ | |
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
| 2 | **Multi-company + CarTrends migration** | One schema per company, remove single-company code, drop password vault, jobs moved to a worker process, cross-company leak tests. **Migrate live CarTrends data with a dry run first** | L |
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

---

## 13. Phase 1 design: Platform + single login (APPROVED 2026-10-07)

Based on a survey of both apps' login code (2026-10-07). Goal: one login for Tasks and Assets
**without changing any existing behaviour**. All 659 Tasks tests and 44 Assets tests must stay
green, unchanged.

### 13.1 What exists today
| | Tasks (Django) | Assets (NestJS) |
|---|---|---|
| Login with | username or email | email, username or employee code |
| Credential | SimpleJWT HS256, access 8 h, refresh 365 d (rotating), in `localStorage` | `eam_session` httpOnly cookie, 7 d sliding, sessions table |
| Passwords | Django PBKDF2 | argon2id, lockout 5 tries / 15 min |
| Roles | 20 hard-coded roles to a capability dict | DB roles with 24 permissions, one per user |
| "Me" | `/api/auth/me`, gives `capabilities[]` | `/api/auth/me`, gives `permissions[]` |

### 13.2 New pieces
```
services/platform   NestJS 11 + Drizzle + Postgres (same stack/tooling as Assets; auth code ported from it)
apps/portal         small React + Vite app: login page, "Choose your workspace", change password
infra/gateway       one origin for everything (dev: Node proxy; prod: Caddy)
```
**One origin, path-routed.** Avoids CORS and third-party cookies, and both apps' web code already
calls relative `/api/...`:
```
/                  → portal (login, app chooser)
/api/platform/*    → Platform API
/tasks/*           → Tasks web     /tasks/api/*  → Django (prefix stripped)
/assets/*          → Assets web    /assets/api/* → NestJS (prefix stripped)
```

### 13.3 Platform data (schema `platform`)
- **companies**: id, name, code, enabled_apps[] (`tasks`, `assets`), status. Billing columns come in Phase 8.
- **people**: id, company_id, full_name, employee_code, email, mobile, status (active/inactive), timestamps.
- **logins**: person_id (1:1, optional), username, password_hash (argon2id), failed_logins, locked_until, last_login_at, must_change_password. **No reversible password copy, ever.**
- **person_apps**: person_id, app, local_user_id (the user's id inside Tasks/Assets), granted_at. "Can this person open this app?"
- **refresh_sessions**: sha256(token), person_id, expires_at, last_seen_at, ip, user_agent, client (web/mobile), revoked_at.
- **signing_keys**: Ed25519 key pairs (`kid`, public key, encrypted private key, active), for rotation.

### 13.4 Tokens
- **Access token**: JWT, **EdDSA (Ed25519)**, 15 min. Claims: `sub` = person_id, `cid` = company_id,
  `apps` = {tasks: local_user_id, assets: local_user_id}, `kid`, `iss` = freefounders-platform,
  `aud` = freefounders.
- **Refresh token**: random 32 bytes; only its hash is stored. Rotated on each use. Reusing an old one
  revokes the whole session. Web: httpOnly `ff_refresh` cookie (path `/api/platform/auth`, SameSite=Lax,
  Secure). Mobile (Phase 7): returned in the body, kept in secure storage.
- **Stay signed in**: refresh session slides; it expires after **1 year unused** (same as Tasks today; founder decision).
- Public keys are published at `/api/platform/.well-known/jwks.json`. Tasks and Assets fetch and cache them,
  with no DB call per request.
- **Logout** revokes the session. Password change, deactivation or removing app access revokes all
  of that person's sessions; access tokens die within 15 min.

### 13.5 Platform API
```
POST /auth/login            {login, password}       login = email | username | employee code
POST /auth/refresh                                  cookie → new access token (+ rotated cookie)
POST /auth/logout
GET  /auth/me                                       person, company, apps the person can open
POST /auth/change-password
GET  /.well-known/jwks.json
Admin (company admin, Phase-1 permission: platform.users.manage):
GET/POST/PATCH /people      list/create/edit/deactivate people, set/reset login
PUT  /people/:id/apps       grant/revoke Tasks/Assets → calls that app's provision endpoint
```
Lockout 5 / 15 min, timing-safe unknown-user check, `X-Requested-With` CSRF header (same rules as Assets).

### 13.6 How Tasks accepts it (Django)
1. `accounts.User` gets `platform_person_id` (UUID, nullable, unique). This is an additive migration.
2. New `accounts/platform_auth.py`: `PlatformJWTAuthentication` verifies EdDSA against cached JWKS,
   reads `apps.tasks`, loads that local User, and **still rejects `is_active=False`**. It is listed *before*
   SimpleJWT in `DEFAULT_AUTHENTICATION_CLASSES`; SimpleJWT stays, so all existing tests and the
   legacy login keep working.
3. Roles and capabilities stay local and unchanged in Phase 1 (dynamic roles = Phase 3).
4. `POST /api/internal/provision` (service token signed by Platform, `aud=tasks-internal`): find by
   platform_person_id, then email, then username; otherwise create a user (default role chosen by admin).
   Returns the local user id.
5. Web (`frontend/src/api.js`): when `PLATFORM_LOGIN` is on, the access token comes from
   `/api/platform/auth/refresh` (kept in memory, not localStorage), and the 401 retry calls the Platform. The login page
   redirects to the portal. With the flag off, behaviour is exactly as today.

### 13.7 How Assets accepts it (NestJS)
1. `users.platform_person_id` (uuid, unique, nullable): new Drizzle migration.
2. `AuthService.resolve()` also accepts `Authorization: Bearer <platform JWT>`: verify, then load
   `apps.assets` user, then build the same `Actor` from its role permissions. Cookie sessions keep working.
3. `POST /api/internal/provision` (same scheme): match by platform_person_id, employee code, email, username;
   otherwise create a user (and, as today, a staff employee when needed).
4. Web (`lib/api.ts`): same in-memory access-token + refresh pattern behind `PLATFORM_LOGIN`.

### 13.8 Portal + app chooser + switcher
- Login, then `GET /auth/me`. One app opens it directly. Two apps show "Choose your workspace"
  (☐ remember my choice, per device).
- Header switcher `[Tasks ⇄ Assets]`: a small component added to both apps' headers, shown when
  the token lists both apps. Switching is a plain link; no second login.
- Branding: "FreeFounders" placeholder until logo/colours are chosen.

### 13.9 Tests (Phase 1 is done when all are green in CI)
- Platform: integration tests for login (all 3 identifiers), lockout, refresh rotation + reuse
  detection, logout/revocation, change password, JWKS, people + app grant/provision.
- Tasks: new tests for `PlatformJWTAuthentication` (valid, expired, wrong key, wrong audience,
  inactive user, unlinked person) + provision. **Existing 659 untouched.**
- Assets: same set for the Bearer path + provision. **Existing 44 untouched.**
- End-to-end smoke (through the gateway): log in once, open Tasks, open Assets, switch back,
  log out (both apps now refuse), deactivate (refused within 15 min).

### 13.10 Out of scope for Phase 1 (later phases)
Multi-company isolation/RLS and CarTrends data migration (Phase 2) · unified roles (Phase 3) ·
removing the Assets password vault (Phase 2) · mobile OTP · billing · new UI design (Phase 6).

### 13.11 Build order
1. Platform service scaffold + data + auth API + tests + CI job
2. Tasks: person link, auth class, provision, tests
3. Assets: person link, Bearer path, provision, tests
4. Gateway + portal (login, chooser) + both web apps behind `PLATFORM_LOGIN` + switcher
5. End-to-end smoke test, `CLAUDE.md` updated, founder demo + sign-off

### 13.12 Status (2026-10-07): built, tested, awaiting founder demo + sign-off
| Check | Result |
|---|---|
| Platform integration tests | 26 pass |
| Tasks tests | 672 pass (659 original, unchanged, plus 13 new) |
| Assets tests | 58 pass (44 original, unchanged, plus 14 new) |
| End-to-end API smoke (`npm run smoke`) | 9 / 9 against the running suite |
| Browser tests (`npm run e2e`) | 3 / 3: sign in once, chooser, Tasks ⇄ Assets, sign out, return-to-app, People & access |

Differences from the design above (deliberate):
- **Assets exchanges the token for a cookie.** Its pages load photos with plain `<img>` tags, which cannot
  send a token. So `POST /api/auth/platform-session` turns a Platform token into an ordinary Assets session
  that ends with the token (15 min) and is never extended. Tasks uses the token directly.
- **Role lists come from each app.** `GET /api/internal/roles` in Tasks and Assets, relayed by the Platform's
  `GET /apps/:app/roles`, so the portal never hard-codes another app's roles (rule §6.4).
- **People & access lives in the portal** for now (the new web app in Phase 6 takes it over).
- **Production gateway is a draft** (`infra/gateway/Caddyfile`). It gets verified when staging exists (needs AWS).

Follow-ups noted for later phases: expired Assets session rows are not cleaned up yet; the CarTrends
rollout (linking existing people to Platform people) belongs to Phase 2's migration; mobile (Phase 7) will use
the `client: mobile` login, which already returns the refresh token in the body.

---

## 14. Phase 2 design: many companies + CarTrends migration (decided 2026-10-08)

Founder decisions (2026-10-08): **one Postgres schema per company** (not `company_id` + RLS), and
**a separate worker process without Redis** (not Celery/BullMQ). Based on a survey of both apps:
Tasks has 49 models, 271 query sites, 2 singletons and about 15 global unique rules; Assets has 28 tables
and about 20 global unique rules. With a schema per company all of these stay correct as they are.

### 14.1 How a request finds its company
```
Platform token (cid = company id)  →  app looks up cid in its registry  →  search_path = co_<code>
```
- Each app keeps a **registry** outside the company schemas: `public.ff_companies` (Tasks) and
  `ff.companies` (Assets): company_id, schema, name, created_at.
- Schema name = `co_` + the Platform company code (lower-case, `[a-z0-9_]`, checked before any SQL use).
- **Fails closed.** In multi-company mode the default search path is an empty `ff_none` schema, so any
  query without a company errors instead of reading someone's data.
- The search path holds **only** the company schema (not `public`), so Django/Drizzle cannot see another
  schema's tables.
- Multi-company mode is a switch, `TENANCY=schemas` (needs Postgres). Off by default, so each app runs
  standalone exactly as before and the existing tests (SQLite for Tasks) are untouched.

### 14.2 Tasks (Django)
- Middleware reads the Platform token (or the internal service token), sets the schema for the whole
  request and resets it afterwards (connections are reused).
- In multi-company mode the legacy username/password login and SimpleJWT are refused: there is no
  company to pick. Public endpoints with no company (web forms, WhatsApp webhook) belong to modules
  that are OFF at launch; they get company-specific URLs when switched on.
- Commands: `company_create` (create schema + migrate + register), `migrate_companies` (deploy step:
  migrate every company), `run_worker` (see 14.4).
- Uploaded files go under `c/<schema>/…` so two companies' files never share a path.
- Company-specific settings that are env vars today (HR hours/geofence/face, WhatsApp, Gmail, AI keys)
  move to a per-company settings table, falling back to the env var. Secrets are encrypted with
  `SETTINGS_KEY`. The admin screen for them is Phase 4.

### 14.3 Assets (NestJS)
- Express middleware picks the company (Platform Bearer token, internal service token, or the company
  prefix of the platform-session cookie), takes one pool connection, sets its search path, and binds it
  to the request (AsyncLocalStorage, which `DbService.db` already uses). The connection is reset on release.
- Own migrator for company schemas: the existing Drizzle SQL files, with `"public".` rewritten to the
  company schema, and history kept per schema. Standalone mode keeps the Drizzle migrator.
- `defaultCompanyId()` / `defaultStoreId()` stay; inside a company schema they mean "this company".
- **Password vault removed**: `GET /users/:id/password`, the 3 `password_saved*` columns, the
  `credential_key` row, the vault service and the Password column on the Users screen. The one-time
  password shown on creation stays.

### 14.4 Worker (Tasks)
- `manage.py run_worker`: every 5 minutes, takes a Postgres advisory lock (only one worker runs), then for
  each company runs the same reminder/digest routine the thread runs today, plus the Gmail poll where
  enabled. A failure in one company is logged and the next company still runs.
- The in-process thread stays for standalone mode (`NOTIF_SCHEDULER`), so the web server can run many
  workers in FreeFounders mode.
- Assets has no background jobs today, so nothing to move.

### 14.5 Platform
- `POST /companies` (platform owner only, plus a CLI `npm run company -- create`): creates the
  company, and for each enabled app calls `POST /api/internal/companies` so the app creates its schema.
- Service tokens to the apps carry `cid`, so provision and roles act inside the right company.
- **Passwords from Tasks keep working**: imported Django PBKDF2 hashes are accepted once, then re-hashed
  to argon2id on the next successful sign-in. No password is ever stored reversibly.

### 14.6 CarTrends migration (dry run first)
1. Founder takes a `pg_dump` of the live Tasks DB (and Assets DB, if in use). Claude never touches EC2.
2. `scripts/import-company`: restores each dump into a scratch DB, renames `public` → `co_cartrends`,
   copies it into FreeFounders' Postgres, registers it and runs the newer migrations.
3. People matching across Tasks and Assets: by employee code, then email, then mobile. Creates Platform
   people + logins (Tasks password hash kept) + app links. Anything unclear goes on a review list (CSV) for the founder.
4. `--dry-run` (default) changes nothing and prints counts, matches and the review list. `--apply` does it.
5. Rehearsed on a copy of demo data in CI-like conditions before the real run. CarTrends stays on EC2 until
   the founder signs off on the result (answers open question 2).

### 14.7 Tests
- Tasks and Assets: new tenancy tests on Postgres (two companies, same usernames/codes in both, no data
  visible across, fail-closed without a company, worker runs per company). Existing tests unchanged,
  except Assets' saved-password test, which goes with the vault.
- Smoke + browser: two companies through the gateway; company B cannot see company A's tasks or assets.
- Migration dry run on demo data.

### 14.8 Build order
1. Tasks: tenancy switch, registry, middleware, commands, worker, file paths, per-company settings, tests
2. Assets: tenancy switch, middleware, migrator, internal endpoints, vault removal, tests
3. Platform: companies endpoint + CLI, `cid` in service tokens, PBKDF2 import, tests
4. Dev suite on Postgres with two demo companies; smoke + e2e leak tests; CI Postgres jobs
5. Import tool + dry run on demo data; docs

### 14.9 Status (2026-10-08): built, tested, rehearsed; awaiting founder sign-off + the real CarTrends dump
| Check | Result |
|---|---|
| Tasks tests (SQLite) | 688 pass: 672 original unchanged, 16 new (13 need Postgres and skip here) |
| Tasks multi-company tests (Postgres, CI job `tasks-tenancy`) | 29 pass (tenancy + Platform sign-in) |
| Assets tests | 67 pass: 58 before (the saved-password test now checks passwords cannot be read back), 9 new |
| Platform tests | 29 pass (26 + 3) |
| Smoke (`npm run smoke`) | 10 / 10, incl. a second company seeing none of the first one's tasks or people |
| Browser (`npm run e2e`) | 4 / 4, incl. the same check in the browser |
| Import rehearsal (`npm run rehearse-import`) | passes: 15 people matched, old Tasks and Assets passwords work, tasks/assets/photo bytes identical, ids continue |

Differences from the design above (deliberate):
- **The importer reads restored copies, not dump files.** No `pg_restore` is available locally, and reading a
  database copy works the same on staging. The founder (or the staging box) restores the dump into a scratch
  database; `scripts/import-company.mjs --tasks-source <url> --assets-source <url>` does the rest.
- **The Platform sends each person's Platform role when giving app access.** With no app role chosen, owners
  and admins become the app's own admins (Tasks Super Admin, Assets Admin); role names stay inside each app.
- **Company creation is a CLI for now** (`npm --prefix services/platform run company -- create|sync|list`); the owner
  console with a screen for it is Phase 8.

For the founder (the real CarTrends move):
1. Take `pg_dump -Fc` of the live Tasks database (and Assets, if it holds real data: open question 3), on the server.
2. Restore each into a scratch database next to FreeFounders (staging), then run the importer **without** `--apply`
   and go through `review.csv` together.
3. Run with `--apply`; CarTrends keeps using EC2 until you have checked the result and signed off.

Follow-ups for later phases: the Tasks web app still shows "Automation Task / CarTrends" in its sidebar
(per-company branding is a Settings Center item, Phase 4); per-company settings have no screen yet (Phase 4;
`manage.py company_setting` until then); expired Assets session rows are still not cleaned up.

---

## 15. Phase 3 design: one role builder (APPROVED 2026-10-08)

Founder decisions (2026-10-08): **one role builder for the whole product** (not one per app), and permission
scopes **Own · Team · Department · Company**. No "Location" scope. Attendance stays ON; saving a photo at every
punch-in is added to Phase 4 (§5).

Based on a survey of both apps (2026-10-08):
| | Tasks | Assets |
|---|---|---|
| Roles | 20 hard-coded (`Role` choices), 1 per user (`User.role`) | DB table, 6 system roles, 1 per user (`users.role_id`) |
| Permissions | 21 capabilities in a dict (`ROLE_CAPABILITIES`) | 24 strings, editable per role |
| Scope today | built into names: `tasks.view_all / view_department / view_own`, same for leads | none: "only my own" when a permission is missing |
| Checks by role **name** | ~33 places (top admin, `ROLE_LEVEL`, sales manager, approver lists…) | 7 places ('Admin', 'Employee', 'Leadership') |
| Role screen | none (only a read-only list) | Roles page (Admin only) |

### 15.1 Where roles live
```
Portal: Roles + People  →  Platform (source of truth)  →  pushes a copy to each app  →  app checks locally
```
- **Platform** stores, per company: `roles` (name, description, colour, level, system/archived),
  `role_permissions` (role, app, permission, scope) and `person_roles` (person, role); **a person can have several roles**.
- **Each app keeps a synced copy** in the company's schema (`ff_roles`, `ff_role_permissions`, `ff_user_roles`), so every
  check stays local and fast, and background jobs (reminders, approver lists) can still ask "who may approve?" in SQL.
- Sync: on any change the Platform calls `PUT /api/internal/access` on the app with the company's full role set and the
  role list of each person. A version number (`pv`) in the access token lets an app notice it is behind and re-fetch.
- Each app **publishes its own permission catalogue** (`GET /api/internal/permissions`: key, label, group, allowed scopes),
  just as it publishes its roles today, so the Platform never hard-codes another app's permissions (§6 rule 4).

### 15.2 Scopes
| Scope | Means | Tasks today |
|---|---|---|
| Own | my records | `view_own` |
| Team | mine + people who report to me (reporting manager chain, one level) | part of `view_department` |
| Department | everyone in my department, plus my team | `view_department` |
| Company | everyone | `view_all` |
Permissions that are simply yes/no (e.g. *Manage users*) have no scope. Several roles: permissions add up and the
**widest** scope wins.

### 15.3 Permission catalogue (from the two apps; nothing lost)
- **Tasks**: `tasks.view`(scoped) · `tasks.assign` · `tasks.delete_admin_work` · `leads.view`(scoped) · `leads.view_won` ·
  `leads.edit`(scoped) · `leads.assign` · `quotations.manage` · `dashboard.view` · `notifications.view` · `intake.view` ·
  `hr.approve` · `hr.manage` · `users.manage` · `settings.manage`, plus the role **level** (1 Member · 2 Manager ·
  3 Admin; replaces `ROLE_LEVEL` and the "top admin" name checks: a level-3 role is an admin everywhere).
- **Assets**: the 24 existing permissions, as yes/no. In Assets everyone always sees their own assets, requests and
  employee record, so "See all assets" ticked = Company, unticked = Own (exactly today's behaviour). Team/Department
  for Assets follow when Assets employees are linked to People (Phase 4).
- **Platform**: `platform.users.manage`, `platform.roles.manage`, `platform.settings.manage` (billing later).

### 15.4 Tasks: no behaviour change (all 688 tests unchanged)
1. New tables + a data migration that seeds **exactly** today's 20 roles from `ROLE_CAPABILITIES` (codes = today's role values,
   levels from `ROLE_LEVEL`). The dicts stay as the starter-template source (tests pin them).
2. `has_capability()` / `capabilities_for()` read the DB (cached per request): union of `User.role` (kept as the primary role)
   and any extra roles. `/api/auth/me` still returns the same capability strings (`tasks.view` at Company → `tasks.view_all`),
   so the web app needs no change.
3. Replace the ~33 role-name checks with permission / level checks, file by file, tests run after each.
4. `crm/scoping.py`, HR, mistakes, workspace read the scope instead of three capability names; same results.
5. Assets: `user_roles` table next to `users.role_id` (kept as primary); permissions = union; 7 name checks → permissions.

### 15.5 Role builder (portal)
- **Roles** page: list, create, edit, duplicate, archive. One screen per role with a matrix grouped by app
  (Tasks · Leads · HR · Assets · Administration), a scope picker per permission, colour and level.
- **People** page: a person gets one or more roles (replaces the per-app "role on first access" dropdown); the role's apps
  decide which apps they can open, still within the company's plan.
- **Locked system roles**: Super Admin (= today's owner) and Admin: everything, cannot be edited or deleted. A company always
  keeps an active Super Admin (today's owner rules).
- **Starter templates** for every new company: today's 20 Tasks roles and 6 Assets roles, merged where they are the same job.
- **CarTrends / existing companies**: each person's current Tasks role and Assets role become roles in the builder, so nobody's
  access changes; the admin can merge them later.

### 15.6 Tests
- Tasks + Assets: **existing suites unchanged**, plus: seeded roles equal the old dicts permission for permission; every scope gives
  the same visible rows as before; several roles add up; sync endpoint (auth, idempotent, version).
- Platform: role CRUD, locked roles, at least one Super Admin, sync calls with the company id, `pv` in tokens.
- Smoke + browser: admin creates a role in the portal, gives it to a person, the person's access changes in both apps.

### 15.7 Build order
1. Tasks: DB roles seeded from the dicts, `has_capability` from the DB, scopes; tests unchanged
2. Tasks: replace the ~33 name checks; internal permissions + access endpoints
3. Assets: multiple roles, scopes, name checks, internal endpoints
4. Platform: roles, person_roles, catalogue, sync, `pv`
5. Portal: Roles page + roles on People; smoke + e2e; docs

### 15.8 Out of scope
Responsibilities, recurring duties, approval chains (Phase 5) · Location scope (dropped) · punch-in photo (Phase 4) ·
custom statuses/fields (Phase 4).

### 15.9 Status (2026-10-08): built and tested
| Check | Result |
|---|---|
| Tasks tests | 704 pass (all earlier tests unchanged; 13 Postgres-only skip on SQLite) |
| Assets tests | 70 pass |
| Platform tests | 36 pass (incl. role builder, locked roles, Super Admin rules, an app ahead of the Platform) |
| Smoke (`npm run smoke`) | 10 / 10 |
| Browser (`npm run e2e`) | 5 / 5: admin builds a role in the portal, gives it to a person, and Tasks reports exactly that permission |

Found and fixed while testing:
- **Role changes could stop reaching an app.** Each app ignores a role push older than the last one it applied. If the
  Platform's counter ends up behind (e.g. the Platform database restored from a backup), every later change was ignored.
  Now the Platform moves past the app's version and resends once.
- Role pushes write only what changed (dozens of roles stay fast).

---

## 16. Phase 4 design: Settings Center + module switches (2026-10-08)

The founder asked to build all phases without stopping, so this design was made by Claude from a survey of both apps
(2026-10-08). The founder can change any of it.

### 16.1 Where each setting lives
| Setting | Owner | Edited in |
|---|---|---|
| Company name, short name, logo, brand colour | **Platform** (pushed to the apps) | Portal → Settings |
| Module switches (which parts of each app are on) | **Platform** (pushed to the apps) | Portal → Settings |
| Task completion evidence, departments, task categories | Tasks (exists) | Tasks → Automation settings |
| HR rules: hours, grace, half/full day, week-offs, geofence, face check | Tasks (today `.env` only) | Tasks → HR → Settings (**made editable**) |
| Punch-in locations | Tasks (`OfficeLocation`, exists) | Tasks → HR → Settings |
| **Punch-in photo** (founder) + how long photos are kept | Tasks (new) | Tasks → HR → Settings |
| Leave types, holidays | Tasks (exist) | Tasks → HR |
| Notification rules (email / WhatsApp per kind of event) | Tasks (new) | Tasks → Automation settings |
| Asset catalogue, custom fields, departments, vendors | Assets (exist) | Assets → Settings |

The portal's Settings page shows the company-wide part and links to each app's settings pages.

### 16.2 Module switches
| App | Module | Launch default (new companies) |
|---|---|---|
| Tasks | Tasks, Template directory, Groups, Notices, Attendance & leave | always on |
| Tasks | Leads (+ quotations, assignment rules), AI inbox, Payroll, Mistake register, Forms, Links, Idea board | **off** |
| Assets | Assets, people, onboarding/exit, requests, tickets, maintenance | always on |
| Assets | SIM register + reconciliation | **off** |
- **Enforced on the server**: a switched-off module's API answers `404 {"detail":"This module is switched off"}`; its pages leave the
  menus; its reminders/digests do not run.
- `/api/auth/me` (Tasks) and `/api/config` (Assets) tell the web app which modules are on.
- **Standalone apps and existing companies are unchanged**: no switch values = everything on. CarTrends is imported with
  everything on (it uses Leads, Payroll, Mistakes; answers open question 4: payroll stays on for CarTrends).

### 16.3 Branding
- Platform: `companies.short_name`, `brand_colour` (#rrggbb), `logo` (PNG/JPEG/WebP ≤ 512 KB, checked by magic bytes, stored in the DB),
  `profile_version`. Logo served at `GET /api/platform/brand/:companyId/logo?v=N` (public, cached).
- Push: `PUT /api/internal/company` on each app with `{version, name, shortName, colour, logoUrl, modules}`; same stale-version rule
  and recovery as roles (§15.9).
- Tasks: sidebar, login fallback, page title, email subject prefix and the "Open in…" link use the company's names; the brand colour
  overrides the `--primary` colour. Assets: `companyName`, title and the ID cards use the name; colour overrides its primary token.
- With no profile (standalone), both apps look exactly as today.

### 16.4 Attendance photo (founder, 2026-10-08)
- Setting `ATTENDANCE_PHOTO` = off · optional · **required** (FreeFounders default: required; standalone default: off).
- Check-in and check-out send a JPEG (resized in the browser to ≤ 640 px, ≤ 300 KB); stored under the company's file path
  (`c/<schema>/attendance/…`), linked from `Attendance.check_in_photo` / `check_out_photo`.
- Shown in "Team today", the monthly view and the corrections review, to the person themself, `hr.approve` (their department) and
  `hr.manage`. Served through an authenticated endpoint, never a public URL.
- `ATTENDANCE_PHOTO_RETENTION_DAYS` (default 90): the worker deletes older photos (DPDP: keep only as long as needed).
- When the face check is on, the same camera frame is used for both, so the person is photographed once.

### 16.5 Notification rules
- One setting per **kind of event** (≈12 groups: task given, task done/review, change requests, comments & progress,
  due & overdue reminders, daily/day-end digests, leave & attendance, notices, mistakes, leads, …), each with Email on/off
  and WhatsApp on/off. In-app notifications are always on.
- `notify()` looks up the rule for its type; anything not listed keeps today's behaviour. Push (mobile) joins in Phase 7.

### 16.6 Moved to Phase 5
Approval chains (they need departments and reports-to in the Platform's People directory) and one shared department list.

### 16.7 Tests
- Platform: profile + logo validation, module switches only within the plan, push + version recovery, admin-only.
- Tasks: module gate (each switched-off route group answers 404; standalone unaffected), worker skips switched-off modules,
  HR settings API, photo required/optional/off, photo access rules, retention purge, notification rules; **all existing tests unchanged**.
- Assets: SIM/reconciliation gate, profile applied to `/config`; existing tests unchanged.
- Browser: admin switches Leads on/off in the portal and the Tasks menu follows; brand name shows in Tasks; check-in with a photo.

### 16.8 Build order
1. Platform: profile, logo, modules, push; portal Settings page
2. Tasks: receive profile; module gate + menus; branding; worker
3. Assets: receive profile; SIM/reconciliation gate; branding
4. Tasks: editable HR settings, attendance photo, retention; notification rules
5. Smoke + browser tests; docs

### 16.9 Status (2026-10-08): built and tested
| Check | Result |
|---|---|
| Platform tests | 42 pass (6 new: profile, logo checked by content, module switches within the plan, launch defaults, version recovery) |
| Tasks tests | 727 pass (23 new; all earlier tests unchanged) + 40 multi-company tests on Postgres |
| Assets tests | 73 pass (3 new) |
| Smoke (`npm run smoke`) | 10 / 10 |
| Browser (`npm run e2e`) | 7 / 7, incl. brand + module switch followed by the Tasks menu and API, and check-in with a photo (Chromium's fake camera) seen by HR |

Notes and differences from the design above:
- **Punch photos are private**: stored under `private/`, which the `/media/` route refuses; served only by
  `GET /api/attendance/<id>/photo/in|out/` to the person, their managers (same rule as their attendance) and HR.
- New FreeFounders companies get `ATTENDANCE_PHOTO=required`; standalone and imported companies keep it off until HR turns it on.
- Per-company settings (`company_env`) now also work in a standalone install, so the HR settings screen works there too;
  with nothing saved it reads the environment exactly as before.
- `/api/leads/assignees/` stays available with Leads off: Groups, templates and settings use it as the team list.
- Found while testing: the Tasks menu checked Leads permissions directly, so the Leads link ignored the switch (fixed).

---

## 17. Phase 5 design: one People directory, approvals, role duties, cross-app rules (2026-10-08)

Made by Claude from a survey of all three services (founder asked to build every phase without stopping; any of it can be changed).
What the survey found:
- **Approvers are chosen three different ways.** Leave and attendance corrections go to anyone with `hr.approve` in the same department;
  task changes and completions go to the task giver, then the reporting manager, then admins; Assets asset requests go to anyone with
  `request:approve`. Leave requests and corrections notify nobody when submitted. Nothing reminds or escalates a pending approval
  (`admin_alerted_at` exists but is unused).
- **"Reports to" and departments live in each app separately** (Tasks `reporting_manager` + department codes; Assets `manager_id` +
  department ids, display only), and **not in the Platform**.
- **Deactivating someone in the Platform does not reach the apps**: their app users stay active (only sign-in is refused).
- **No per-role duties or checklists.** Recurring tasks are created when the previous one is completed; no job creates them.
- **Apps cannot tell the Platform anything** (only Platform → app calls exist).

### 17.1 One People directory (Platform)
- `people` gets **department, designation, reports_to (a person), join_date**. `departments` table per company (name, code, active).
- People screen: these fields in the add/edit form; a Departments list on the Settings page.
- **Pushed to the apps** (`PUT /api/internal/people`, same version/recovery rule as roles): Tasks sets `department`, `reporting_manager`,
  and its department list; Assets sets `department_id` (created by code if missing), `manager_id`, `designation`, `join_date`.
- **Deactivation reaches the apps**: Tasks user `is_active=false`; Assets login deactivated and its sessions ended (the Assets
  *employee* record is only closed by the exit process, which also checks the assets came back).
- Existing companies (CarTrends): the first sync **imports** departments and "reports to" from Tasks, so nothing changes for anyone.
- Team and Department scopes (Phase 3) now follow the directory everywhere.

### 17.2 Approvals
One rule per kind of request, chosen on the Settings page (Tasks → Automation settings → Approvals):
| Request | Who approves (default = today) | Option |
|---|---|---|
| Leave, attendance correction | `hr.approve` holders in the department | **Reports-to manager first**, then department approvers |
| Task change request / completion | giver → reports-to → admins (unchanged) | — |
| Asset request (Assets) | `request:approve` holders | **Requester's manager may approve** (and is notified) |
- **The approver is notified when a leave or correction is submitted** (today: nobody).
- **Reminders and escalation** (worker): a request still pending after the company's limit (default 24 working hours) reminds the
  approver once; after twice the limit it goes to the admins / HR managers (`admin_alerted_at` now used). Applies to leave, corrections,
  task change requests and completion reviews.

### 17.3 Role duties (responsibilities)
- In the role editor (portal): **duties** = title, optional description and checklist steps, and when: **daily, weekly (day),
  monthly (date), or once when someone gets the role** (joining checklist).
- Pushed with the roles. The Tasks worker creates each period's task for every active holder (one per person per period, never twice;
  not on week-offs/holidays for daily duties), with the role's checklist; "once" duties are created when the role is first given.
- Team Performance shows duties done on time like any task.

### 17.4 Cross-app rules
- **Events, pulled by the Platform**: each app keeps an outbox (`ff_events`: id, type, payload, created_at). The Platform polls every app
  with its service token (`GET /api/internal/events?after=<id>`) every 30 s and runs the rules. No new kind of credential is needed, and
  an app being down only delays rules.
- **Exit**: portal People → "Start exit" (last working day, reason) → Assets opens the exit case (the employee goes on notice; the
  assets they hold are listed) and Tasks creates the exit checklist tasks (company's exit checklist, assigned to the person's manager,
  else HR). When Assets completes the exit, the Platform deactivates the person everywhere.
- **New joiner**: adding a person with a join date (and roles) → Assets opens an onboarding case for that employee with the role's kit
  (if the role has one) and Tasks creates the role's "once" duties.
- **Asset ticket → task**: a new Assets ticket creates a Tasks task for the IT owner (the company setting "IT owner", else Assets
  `ticket:manage` holders' first linked person), with a link to the ticket; the ticket shows the task. Completing the task resolves the
  ticket (with the completion remarks).

### 17.5 KPIs
Team Performance adds **attendance %** (present + late + half-day ÷ working days) and **leave days** for the period, next to on-time %.

### 17.6 Tests
Platform: directory fields, departments, push + deactivation, import, events relay and each rule (fake apps).
Tasks: people push, approval routing options, reminders/escalation, duties generation (no duplicates, week-offs), exit/joiner/ticket
endpoints, KPIs; all earlier tests unchanged. Assets: people push, manager approval, exit/onboarding/ticket internal endpoints, outbox.
Browser: start an exit in the portal → exit case in Assets + checklist task in Tasks.

### 17.7 Build order
1. Directory: Platform fields + departments + push + deactivation + import; apps' `/internal/people`; portal forms
2. Approvals: Tasks routing option, notify on submit, reminders/escalation; Assets manager approval
3. Role duties: Platform + portal editor; Tasks generation
4. Events + rules: outboxes, Platform relay, exit / joiner / ticket flows, portal "Start exit"
5. KPIs, smoke + browser, docs

### 17.8 Status (2026-10-08): built and tested
| Check | Result |
|---|---|
| Platform tests | 51 pass (directory, departments, loops refused, push + deactivation, import, role duties, events relay and every rule) |
| Tasks tests | 754 pass (all earlier tests unchanged) + 40 multi-company tests on Postgres |
| Assets tests | 79 pass |
| Smoke (`npm run smoke`) | 10 / 10 |
| Browser (`npm run e2e`) | 9 / 9, incl. Start exit in the portal → Assets exit case + Tasks checklist, and an Assets ticket → linked Tasks task |

Notes and differences from the design above:
- **Duties are stored on the role** (a list with lasting ids) rather than a separate table; Tasks remembers each person's task per
  period (`DutyRun`), so nothing is ever created twice. A role's joining checklist goes only to people who get the role after
  the duty was added (`UserAccessRole.created_at`).
- **A ticket's task counts as finished when its work is accepted** (or at once when nobody reviews it), so a ticket is never
  resolved by work that is later sent back.
- **Exit checklist** = one task with the company's checklist as steps (`EXIT_CHECKLIST` setting, five sensible defaults), for the
  leaver's manager, else the first HR administrator.
- **New joiner**: a person with a join date today or later who is given Assets gets an onboarding case; the Assets onboarding kit
  whose name matches one of their roles is used.
- **IT owner** for tickets = the first person (by when their Assets user was made) who can manage tickets and has Tasks.
- Leave approvals: default unchanged (department approvers); "manager first" is a setting. Reminders default to 24 h (0 = off).
- Found and fixed while testing: giving someone Assets through a role-builder role failed once the role sync had renamed the
  built-in Assets roles ("The Employee role is missing").

Not done in Phase 5 (noted for later): Tasks' own "My Team" screen still lets an admin edit department / reports-to locally; the
next directory push overwrites it, so in FreeFounders mode those fields should be edited in the portal (to be locked in Phase 6).

---

## 18. Phase 6 design: one web app with a redesign-proof structure (2026-10-08)

Founder: "go ahead and complete phase 6". Designed by Claude from a survey of the three web apps (Tasks web ≈ 11.5k lines
of JSX + one CSS file; Assets web ≈ 13.8k lines of TSX on React 19 / Tailwind 4 / Radix / TanStack Query; portal ≈ 2k).

### 18.1 What gets built
```
apps/web/            the one FreeFounders web app (React 19, Vite, TypeScript, Tailwind 4, Radix, TanStack Query, React Router 7)
  src/app/           shell: sign-in, workspace chooser, sidebar, top bar, routing, notifications bell
  src/ui/            presentational kit only (buttons, inputs, dialogs, tables, badges…): no data, no API
  src/features/      screens per area: admin/ tasks/ hr/ assets/ (screens call hooks from @core, never fetch)
packages/theme/      design tokens: tokens.css (light + dark CSS variables) and tokens.ts (same values for mobile, Phase 7)
packages/core/       platform-neutral logic, no DOM: HTTP client, Platform session, typed API functions for the
                     Platform / Tasks / Assets, TanStack Query hooks, permission + module helpers, enums and labels
```
- `apps/web` takes over the portal (sign-in, chooser, People, Roles, Settings, account) **and** both apps' screens.
- **Same URLs as today**: `/tasks/…` and `/assets/…` keep their current sub-paths (e.g. `/tasks/tasks/42`, `/tasks/hr`,
  `/assets/requests?open=…`), so every link already sent in emails, WhatsApp and notifications keeps working.
- Built on the Assets web stack because it already follows most of §6: its screens move across (data calls lifted into
  `@core` hooks); Tasks screens are rebuilt in TypeScript on the same kit.

### 18.2 The §6 rules, concretely
1. Screens import data only through `@core` hooks (`useTasks`, `useCompleteTask`, `useAssets`…). A lint check fails the build if a
   file under `src/features` or `src/ui` imports `fetch`, the HTTP client or an API module directly.
2. Colours, radius, spacing and fonts come only from `packages/theme` tokens (Tailwind theme reads the CSS variables).
   The company brand colour from the Settings Center overrides `--primary` at run time.
3. **API types**: `@core` has typed functions for every endpoint the screens use. They are written by hand, not generated:
   the Django API's custom actions and the NestJS API's handlers do not describe their responses, so generated types would be
   mostly `any`. Instead, the parity tests call every screen against the real APIs. (Generated clients stay a Phase 9 option.)
4. Enums, labels and permission lists come from `@core` (Assets' shared package, and the Tasks catalogues the API returns).
5. **Parity tests** (Playwright, by role/label/text): one suite per area, `e2e/web-*.spec.ts`.

### 18.3 Which screens move in Phase 6
| Area | Screens |
|---|---|
| Admin (portal) | sign-in, chooser, change password, People & access, Roles (with duties), Settings (company, modules, departments) |
| Tasks | home dashboard, all task lists and tabs, task detail (steps, comments, day log, files, change requests), to accept, requests inbox, templates + directory, groups, notices, notifications, team performance + reports, my team, task settings |
| HR (in Tasks) | today (check-in with photo/face), my attendance, my leave, holidays, team, approvals, HR settings |
| Assets | dashboard, leadership, priority queue, assets list/detail/labels/scan, employees + ID cards, joiners, exits, requests, tickets, maintenance, activity, settings (catalogue, departments, vendors, users, roles) |
**Not moved in Phase 6** (switched off for new companies, §16.2): Leads, AI inbox, Payroll, Mistake register, Forms, Links, Ideas,
SIM register, Reconciliation. They keep their current screens under **`/classic/tasks/…`** and **`/classic/assets/…`**, opened from the
new menu ("opens the classic screen"), so CarTrends keeps every feature. They move in a later step.

### 18.4 Serving it
- Gateway: `/` and every non-API path under `/tasks/` and `/assets/` → the new web app; `/classic/tasks/*`, `/classic/assets/*` →
  the old web apps (built with those bases). APIs unchanged.
- The old Tasks web registered a service worker at `/tasks/`; the new app serves a `/tasks/sw.js` that unregisters itself, so
  phones do not keep showing the old cached app.
- Standalone installs are untouched: the old apps still build and run on their own.

### 18.5 Build order
1. Foundation: `packages/theme`, `packages/core` (client, session, platform/tasks/assets basics, permissions), `apps/web` shell, UI kit,
   gateway + dev script, the import rule check, first parity test (sign in → chooser → shell).
2. Areas, in parallel, each with its own parity suite: Admin · Tasks lists · Task detail · Tasks reports/home/groups/notices/settings ·
   HR · Assets (inventory side) · Assets (people side).
3. Switch the gateway to the new app; old e2e suites updated to the new screens; docs.

### 18.6 Status (2026-10-08): built and tested
| Check | Result |
|---|---|
| Web app | rules check (no fetching or colour literals in screens; theme CSS = theme TS) + typecheck + production build pass; first download 461 KB (screens load on demand) |
| Browser tests (`npm run e2e`) | **33 / 33**: the 9 earlier tests now drive the new app, plus new suites per area: Admin 4, Task workspace 3, Tasks general 7, HR 4, Assets 6 |
| Smoke (`npm run smoke`) | 10 / 10 |
| Platform / Tasks / Assets tests | 51 / 754 / 79 pass |

What is in the new app (`apps/web`): sign-in, workspace chooser, change password; Admin (People & access, Roles with duties,
Settings); every Tasks screen of the launch scope (home, task workspace with all tabs and task detail, team performance,
groups, notices, notifications, my team, task settings); HR (check-in with photo/face, attendance, leave, holidays, team,
approvals, HR settings); every Assets screen except SIM cards and Reconciliation. Leads, AI inbox, Mistakes, Forms, Links,
Ideas, Payroll, SIM cards and Reconciliation open the classic screens (`/classic/…`, same sign-in), as planned in §18.3.

How it was built: the foundation (core, theme, shell, gateway) first, then four areas in parallel, each owning its own
folders and its own core file(s), then the earlier tests moved to the new screens.

Notes and differences:
- The Assets cache keys all start with `assets` now (one shared cache for every app).
- Assets got `GET /api/requests/:id` (same visibility as the list), so `/assets/requests?open=<id>` links open directly.
- Fixed while porting: the Assets picker never showed its "Request / Add '<typed text>'" option.
- My team: department and reports-to are read-only there, with a link to People & access (the Platform owns them, §17.1);
  this closes the gap noted in §17.8.
- Task settings: departments are shown read-only with a link to Settings (Platform-owned since §17.1).
- Not ported (small): the AI proofreading box on notices (the task form keeps it).
- `apps/portal` is no longer served (the new app replaced it); it stays in the repo until Phase 9 clean-up.

---

## 19. Phase 6b design: the new look, the Workspace Portal and a separate Attendance app (2026-10-08, draft for approval)

The founder sent two mockups (web and phone) of a **Workspace Portal**: the first screen after sign-in, with one card per
workspace (Attendance & Shifts, Tasks & Automations, Assets & Inventory) and an admin row (People & access, Roles & duties,
Settings). Asked for:
1. that portal on web and on phones;
2. **punch in straight from the portal**, so marking attendance is one tap after signing in;
3. Attendance as its **own workspace** (today it is the HR page inside Tasks);
4. Tasks and Assets keep every function (docs/UI-FUNCTIONALITY.md) but use the **same look and colours** as the portal.

### 19.1 The look (from the mockups)
- Light grey-blue page, white cards with a thin border and soft radius, a faint tint in the corner of each workspace card.
- Deep indigo for primary buttons; a company's own brand colour still replaces it (§0.3 of the UI document).
- Accents per workspace: Attendance violet, Tasks blue, Assets green. Admin stays neutral.
- Inter for text; a monospace font for times, codes, counts and the small uppercase labels ("SHIFT WINDOW").
- Status pills ("Not checked in", "Recurring active", "Synchronized") and small count boxes (Active / Overdue / To accept).
- Dark mode to match.
- All of this lives in `packages/theme` (tokens.css + tokens.ts), so the web app and the Phase 7 phone app change together.
- Screens keep reading colours only from the tokens, as §18.2 requires.

### 19.2 Workspace Portal (replaces the chooser at `/`)
Each block below lists what it shows and where the data comes from (all already in `packages/core`).

- **Header**
  - Company logo and short name, with a "Workspace Portal" tag.
  - Links: Workspaces · Directory · Audit logs (see 19.6).
  - Light/dark switch, the notifications bell, your name and access level, and Exit (sign out).
- **Greeting**
  - "Good morning/afternoon/evening, {first name}" and "Choose where you want to work today."
  - A **shift window** box with the company's work hours (`work_start`–`work_end` from the HR config).
  - An attendance chip: checked in at 09:31 / not checked in / on leave / holiday / week off.
- **Status strip**
  - Nearest office and whether you are inside its radius. Your browser or phone compares your location with the office
    list; every person can already read the office list.
  - Face check: ready / not set up (when the company uses it).
  - Selfie at punch: required / optional / off.
- **Attendance & Shifts card**
  - Live clock, office proximity, face state, and the top two leave balances.
  - One main button that changes with the day: "Punch in" → "Punch out" → "Done for today · 8h 05m".
  - "Open Attendance & Leave", with "{n} approvals pending" for approvers.
- **Tasks & Automations card**
  - Counts: Active, Overdue (shown as an alert when above 0), To accept.
  - "Enter Task Workspace" and "Open dashboard".
- **Assets & Inventory card**
  - Counts: In custody, Exit hold, Open tickets, plus your first asset (e.g. "MacBook Pro M3 Max #AST-0994").
  - "Open Assets" and "Scan QR / Barcode", which opens `/assets/scan`.
- **Admin row** (owners/admins only)
  - People & access, with the number of people.
  - Roles & duties, with the number of roles.
  - Settings, with the number of modules switched on.
- **What each person sees**
  - A person sees only the cards for apps they have.
  - A switched-off module hides its parts.
  - The page works while one service is down: that card shows "Unavailable" and the others keep working.
- **Phones (up to 640 px)**
  - Cards stack in this order: Attendance first, then Tasks, Assets and Admin.
  - A bottom bar: Home · Tasks · Workspaces · People (People only for admins).
  - "Remember my choice on this device" opens that workspace straight after the next sign-in. The portal stays one tap away.

### 19.3 Punch in from the portal
- The portal uses the **same check-in flow** as the Today screen; it is moved into one shared component.
  - The location check, the face check and the punch photo (the camera dialog) all run only when the company turned them on.
  - The server decides every rule. Nothing about the rules changes; only where the button lives.
- On success the card switches to "Checked in at 09:31".
- On failure the server's reason is shown on the card, e.g. "You are 240 m from the office".
- A link to request a correction is shown alongside that reason.
- On phones, location and camera prompts come up at the moment you tap the button, not when the page opens.

### 19.4 Attendance as its own workspace
- New area `/attendance` with Today · My attendance · Leave · Holidays · Team · Approvals · Settings.
  These are the existing HR screens, moved and restyled; no function changes.
- Old links keep working: `/tasks/hr?tab=x` redirects to the matching `/attendance/…` page.
- Backend unchanged: the Django `hr` app keeps all data, rules and approvals. No data moves.
- **Who can open it (decision needed, 19.7):**
  - **A (recommended now):** Attendance is a separate workspace on screen; access follows Tasks access. No backend change.
  - **B (with subscriptions, Phase 8):** Attendance becomes its own app in the Platform, so a company can buy Attendance
    without Tasks. Needs a Platform app key, plans, and HR endpoints that accept people who don't use Tasks. Build it then.

### 19.5 Tasks, Assets and Admin in the new look
- They get the same header as the portal, a menu per workspace in that workspace's accent colour, and the new tokens.
- Cards, tables, pills and count boxes are restyled to match.
- Every function, URL and visible name in docs/UI-FUNCTIONALITY.md stays. Renamed names are updated in the e2e tests in the
  same change.
- The classic screens (`/classic/…`) are not restyled.

### 19.6 Things in the mockups that are not real data today (founder to confirm)
| Mockup | Proposal |
|---|---|
| Mesh SSID, gateway latency, "SOC2 Type II", "Global v4.12" | leave out (we have no such data; showing made-up values would mislead) |
| "Token expires 14m 58s" | leave out: sign-in lasts a year and the short token renews itself silently |
| "Directory" link | a read-only people directory (name, department, designation, manager), from the Platform People list |
| "Audit logs" link | owners/admins: Assets already has an activity log; a Platform-wide audit log (who changed roles, people, settings) is new work: build later or hide for now |
| Marketing lines on cards ("Linear-style workflow engine…") | short plain descriptions of what the workspace does |

### 19.7 Decisions for the founder (first thing tomorrow)
1. Attendance access: A now (recommended), B later?
2. Directory: build it now? Audit logs: hide for now, or build the Platform audit log?
3. "Remember my choice": open that workspace automatically, or only highlight it?
4. Exact colours: use the mockup's colours as read from the image, or will you send hex codes?
5. Phone bottom bar: confirm the four tabs (the mockup says Cockpit · Tasks · Workspaces · Personnel).

### 19.8 Work plan for 2026-10-09
1. Go through the 19.7 decisions with the founder.
2. **Theme**: new tokens (light + dark), fonts, per-workspace accents; check that the brand colour override still works.
3. **Shared check-in component**: lift the check-in flow out of the Today screen; add an office-distance helper in
   `packages/core`.
4. **Workspace Portal** at `/` (desktop + phone), with the punch-in card and the counts from the existing hooks.
5. **Attendance workspace** `/attendance/*` plus redirects from `/tasks/hr?tab=…`; Attendance menu.
6. **Restyle** the shell and shared parts for Tasks, Assets and Admin.
7. **Tests**:
   - e2e: punch in from the portal, the old HR links redirect, one test per card with the right access, and a phone-width run.
   - Then all suites: rules + typecheck + build, e2e, smoke, Platform/Tasks/Assets.
8. Update docs/UI-FUNCTIONALITY.md (portal, attendance URLs) and screenshots (desktop + 360 px) for the founder's review.

**The web app is finalized first** (founder, 2026-10-08): a very good, user-friendly UI in this theme and colour scheme on every
screen, reviewed and signed off by the founder. Only then does Phase 7 (the phone app) start; it reuses this portal as its home screen.

### 19.9 Status (2026-10-09): first slice built and tested
Founder: "start with the web, make it perfect, same as the old application but in the same theme and colour scheme".
Defaults taken for §19.7 (founder can change them): Attendance access follows Tasks (A); Directory and Audit logs not
shown yet; "Remember my choice" keeps working as before (opens that workspace next time); colours read from the mockups.

| Built | Notes |
|---|---|
| Theme | indigo primary, grey-blue page, white cards, 12 px radius, JetBrains Mono for labels/numbers, accents per workspace (`--app-attendance` new); light + dark; choice remembered per device |
| Fixed colours removed | every Tailwind palette colour in screens (copied from the old Assets app) now uses theme colours; `check-web-rules` refuses new ones (category colours people pick are kept) |
| Workspace Portal at `/` | greeting, shift window + live clock, attendance checks strip, cards for Attendance / Tasks / Assets with live counts, admin row with counts, phone bottom bar |
| Punch in from the portal | shared `usePunch` (same flow as Today); one-app Tasks people now land on the portal instead of going straight to Tasks (behaviour change, on purpose) |
| Attendance workspace | `/attendance`, `/attendance/<tab>`; `/tasks/hr?tab=x` redirects; Tasks menu keeps "Attendance & leave" |
| Frame | same sidebar layout as the old apps, header with "Workspace portal" back link, light/dark switch, bell; phone bottom bar (first 4 menu entries + More) |

Checks: rules + typecheck + build pass; e2e **34 / 34** (new: punch in/out from the portal + old HR link redirect); smoke 10/10.
Next: screen-by-screen polish against the old apps (Tasks workspace, HR tabs, Assets detail pages), founder review.

### 19.10 One application: the classic screens are gone (2026-10-09)
Founder: clicking Leads opened the old Tasks screens: "make it consistent, one single application". So the nine modules left on
the old screens in §18.3 are now screens of the new app, in the new look, with every function of the old pages (plus small
fixes, listed in each module's e2e spec header):

| Module | New screens | Data layer |
|---|---|---|
| Leads & quotations | `/tasks/leads` (pipeline board, drawer with timeline/documents/quotations, `?lead=` deep link) | `core/tasks/extras-leads.ts` |
| AI inbox | `/tasks/intake` | `core/tasks/extras-intake.ts` |
| Mistake register & SOPs | `/tasks/mistakes` (`?tab=sops`, `?open=`) | `core/tasks/extras-mistakes.ts` |
| Web forms | `/tasks/forms`, builder, submissions, fill; public `/f/:token?c=<company>` (no sign-in, no shell) | `core/tasks/extras-forms.ts` |
| Links | `/tasks/links` | `core/tasks/extras-links.ts` |
| Idea board | `/tasks/ideas` | `core/tasks/extras-ideas.ts` |
| Payroll, My salary | `/attendance/payroll`, `/attendance/salary` (tabs of the Attendance workspace) | `core/hr/payroll.ts` |
| SIM cards | `/assets/sims` (the register filtered to the SIM type) | existing asset hooks |
| Reconciliation | `/assets/reconciliation`, `/assets/reconciliation/:id` | `core/assets/reconciliation.ts` |

Removed: `ClassicRedirect`, the `classic` menu flag and markers, the `/classic/*` gateway routes (dev gateway and Caddyfile),
and the two old Vite servers from `npm run dev` (`EAM_API_ONLY=1` makes the Assets dev script start its API only). An unknown
`/tasks/…` or `/assets/…` path now shows "Page not found" inside the shell. The old web apps stay in the repo (standalone
installs, CarTrends until it moves) and are not served by FreeFounders.
Backend: in multi-company mode the public form page names its company (`/f/<token>?c=<id>`; `tenancy/middleware.py` accepts
`?company=`/`X-FF-Company` for `/api/public/*` only).

Checks: rules + typecheck + build; e2e **44 / 44** (10 new tests across 4 specs); smoke 10/10; Tasks backend 755 + tenancy
27 (+1 new) pass. `apps/portal` and the old frontends are Phase 9 clean-up candidates.

### 19.12 People: reset with a chosen password, permanent delete (2026-10-09)
Founder asked for two things on Admin → People & access: set a password of the admin's choice, and delete a person with
everything about them ("delete everything").

**Reset with a chosen password**
- `PUT /api/platform/people/:id/login` takes `{ username?, password?, mustChangePassword? }`. No password: one is generated
  and returned once (as before). `mustChangePassword` defaults to true. Sessions are ended either way.
- **Platform passwords need at least 6 characters** (founder's choice; was 8), everywhere one is set: add person, reset /
  create login, `/auth/change-password` (incl. the first-sign-in change), the `company create --owner-password` CLI and the seed.
  Passwords of the Assets app's own users (standalone) are unchanged.
- Screen: "⋯ → Reset password" (or "Create login", which also asks for a username) opens "Reset password — {name}": "Type a
  password" (with show/hide and a live "At least 6 characters" hint) or "Generate one", and "Ask them to change it at next
  sign-in" (on by default). After saving, the password is shown once with Copy and "Share on WhatsApp" (`wa.me` link); it is
  never stored readable. "Login ready" after Add person is unchanged.

**Delete permanently** — `DELETE /api/platform/people/:id`, body `{ confirm: "<full name>", options? }` (name trimmed,
case-insensitive; `options` below).

| Caller \ target | member | admin | owner | themselves |
|---|---|---|---|---|
| owner | yes | yes | — | no (400) |
| admin | yes | no (403) | no (403) | no (400) |
| member | no (403) | no (403) | no (403) | no |

**Choices (founder's decision 2026-10-09: the default is "keep and hand over", not "erase everything").** `options`:

| Key | Values | Goes to | Screen default |
|---|---|---|---|
| `tasks` (open tasks) | `{mode:"hand_over", to:<person id>}` / `{mode:"delete"}` | Tasks | hand over to their manager (reports-to) if active with Tasks, else the admin picks |
| `leads` (assigned or created; only if the Leads module is on) | same; delete takes the leads' tasks too | Tasks | hand over to their manager |
| `history` (finished tasks, attendance, leave, payslips, comments…) | `{mode:"keep"}` / `{mode:"delete"}` | Tasks + Assets | keep, shown as "Deleted user" (photos and login data are still erased) |
| `assets` (held assets) | `{mode:"stock"}` / `{mode:"hand_over", to}` | Assets | return to stock |

No `options` (the API without a body) = erase everything, as first built. Each app gets only its keys as the JSON body of its
`DELETE …/people/<id>` (none = no body). The Platform checks first that every `to` is an **active** person of the same company,
not the person, and has **Tasks** (tasks/leads) or **Assets** (assets): 400 otherwise, before anything changes. An app that
refuses a choice answers 400 before changing anything: the Platform answers 400 "<App>: …" and switches the person back on;
if an earlier app had already deleted, they stay switched off and the message says so. The answer adds the apps' results:
`handedOver: { tasks: {tasks, leads, assets}, assets: {…} }`, `anonymised: { tasks: bool, assets: bool }`.

Order: (a) the person is switched off and every session ended; (b) each app in the company's plan deletes its records
(`DELETE {APP}_INTERNAL_URL/people/<personId>`, service token, company from `cid`; `{deleted:false}` = never had them); the
first app that is unreachable or answers anything but 200 stops it with **502 "<App> could not delete their data: …"**:
nothing is deleted in the Platform, the person stays switched off, the admin can try again (the apps' deletes are repeatable);
(c) the Platform deletes their login, sessions, roles, app links and the person, and clears other people's "reports to" that
pointed at them (exit/onboarding state lives on the person row and in the apps); (d) the People directory is pushed again.
Answer: `{ deleted: true, apps: { tasks: counts, assets: counts }, handedOver, anonymised, sync }`.
Screen: "⋯ → Delete permanently" (after a separator; hidden for yourself, the owner, and admins unless you are the owner):
"Delete {name} permanently?" with numbered steps, each shown only when the company has that app (Leads: only with the Leads
module on): **Their open tasks** (Hand over to + searchable person picker / Delete them), **Their leads** (same), **Their
history** (Keep it, shown as 'Deleted user' / Delete it all), **Assets they hold** (Return to stock / Hand over to + picker).
Pickers list active people of the company with that app, except the person. With the defaults the note reads "Their sign-in
and personal details are erased; their work is kept or handed over."; with any "delete" choice it lists what goes and warns
"This cannot be undone. Reports for past months will change." Then "Type their full name to confirm" and "Delete permanently"
(enabled when the name matches and every hand-over has a person).

**Not built: viewing saved passwords.** The founder also asked for admins to be able to see people's passwords. That needs a
readable copy of every password, which the project's rule forbids ("Platform passwords are hashed only; never add a reversible
copy"); passwords stay argon2id hashes only. Pending the founder's explicit confirmation. Today's answer: set a new one
(shown once, with Copy / WhatsApp).

Checks: Platform 56 tests (5 new: chosen password + 6-character minimum + mustChangePassword, who may delete whom, name
confirm, fake apps called then rows removed, 502 leaves the person switched off, apps outside the plan not called); web
rules + typecheck; e2e `web-admin` + `single-login` 11 / 11 (2 new: reset with a typed password → they sign in in a fresh
browser → delete permanently → row gone, sign-in refused; owner/self cannot be deleted), against the real Tasks and Assets.
Choices added the same day: Platform **59** tests (+3: each app gets only its choices and the answer carries handedOver /
anonymised; wrong hand-over people refused before any app is called and the person stays active; an app's 400 passed on, the
person switched back on, or kept off when an earlier app already deleted); e2e 12 / 12 (+1: a person with a manager and an
open task, deleted with the defaults → the task now belongs to the manager, row gone, sign-in refused).
