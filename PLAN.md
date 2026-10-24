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
| Tasks | Leads (+ quotations, assignment rules), AI inbox, Payroll, Mistake register, Links (Forms and Idea board removed 2026-10-13, §19.23) | **off** |
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
| ~~Web forms~~ (removed 2026-10-13, §19.23) | `/tasks/forms`, builder, submissions, fill; public `/f/:token?c=<company>` (no sign-in, no shell) | `core/tasks/extras-forms.ts` |
| Links | `/tasks/links` | `core/tasks/extras-links.ts` |
| ~~Idea board~~ (removed 2026-10-13, §19.23) | `/tasks/ideas` | `core/tasks/extras-ideas.ts` |
| Payroll, My salary | `/attendance/payroll`, `/attendance/salary` (tabs of the Attendance workspace) | `core/hr/payroll.ts` |
| SIM cards | `/assets/sims` (the register filtered to the SIM type) | existing asset hooks |
| Reconciliation | `/assets/reconciliation`, `/assets/reconciliation/:id` | `core/assets/reconciliation.ts` |

Removed: `ClassicRedirect`, the `classic` menu flag and markers, the `/classic/*` gateway routes (dev gateway and Caddyfile),
and the two old Vite servers from `npm run dev` (`EAM_API_ONLY=1` makes the Assets dev script start its API only). An unknown
`/tasks/…` or `/assets/…` path now shows "Page not found" inside the shell. The old web apps stay in the repo (standalone
installs, CarTrends until it moves) and are not served by FreeFounders.
Backend: in multi-company mode the public form page names its company (`/f/<token>?c=<id>`; `tenancy/middleware.py` accepts
`?company=`/`X-FF-Company` for `/api/public/*` only). (Removed with Web forms on 2026-10-13, §19.23.)

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

### 19.13 Clean-up: the old screens are deleted (2026-10-10)
Founder: "delete all the unnecessary things … make it lightweight and fast … without losing" anything. After a read-only
inventory the founder approved deleting the code nothing uses any more since §19.10 (recoverable from git history):

| Deleted | Why it was safe |
|---|---|
| `services/tasks/frontend` (old Tasks web, React 18) | every screen is in `apps/web`; not started by `npm run dev` since §19.10 |
| `services/tasks/mobile` (Capacitor shell of the old Tasks web) | wrapped the deleted web app; Phase 7 builds the real phone app |
| `services/assets/apps/web` (old Assets web, React 19) | every screen is in `apps/web`; `@eam/shared` stays (apps/web uses it) |
| `apps/portal` (Phase 1 portal) | replaced by `apps/web` in Phase 6 |

Follow-ups in the same change: CI drops the "Tasks web" and "Portal" jobs; `scripts/setup.mjs` no longer installs the old
Tasks web; the Assets dev script and package scripts are API-only (`EAM_API_ONLY` gone); the Assets API no longer serves a
web build; the Tasks Dockerfile and `render-build.sh` build the API only (Django still answers 404 for non-API paths when no
build exists). Unused web dependencies removed (Inter, JetBrains Mono fonts, replaced in §19.11). `@eam/shared` is marked
side-effect free, so its zod schemas only load with the Assets screens that use them: the app's first download went from
528 KB to 425 KB (gzip 158 KB to 128 KB).
Kept on purpose (founder's choice): the old worktree `.claude/worktrees/prod-readiness-plan` and the test data in the demo
database. Disk: about 210 MB of installed packages and builds went with the deleted folders; local test screenshots
(34 MB) were cleared. CarTrends' live server is not affected: it runs from the original folders, which were not touched.

### 19.14 One frame, no workspace page: Home first, attendance first (2026-10-10)
Founder: "I don't like the first login page then second workspace page; reduce the efforts; make it easily accessible; more
user friendly and accessible; keep in mind we are going to make it a mobile application." Later the same day: "anyone can
see the attendance page first; marking attendance is the priority on mobile; it should be the FIRST page" and "make
attendance the default page on mobile."

**What changed**
- **No separate workspace page.** Sign-in goes straight to **Home** at `/` (or `?next=`), a page inside the normal app
  frame: "Good morning, {first}", then the **mark-attendance card** (live clock, state pill, one big Punch in / Punch out /
  "Done for today" button, the checks that matter at the punch, today's in/out/worked, leave balances, "Open Attendance &
  Leave" with the "{n} approvals pending" pill), then the Tasks and Assets cards with their live counts, then the admin
  shortcuts. Same `usePunch` flow as Today (camera/location when the company turned them on). A person without an HR
  record sees a quiet note instead of the card; a person with only Assets sees the Assets card first. `/?choose` is a
  plain alias of `/`. "Remember my choice on this device" is gone (nothing to choose); the `ff-workspace` key is unused.
- **Phones (under 640 px): Attendance is the first page.** Opening `/` lands on `/attendance` (the full Today page);
  `/?home=1` opens Home (the bottom bar's Home tab uses it). Desktop lands on Home.
- **One menu for the whole product** instead of "workspace switcher + per-workspace menu". Desktop sidebar: Home, then a
  collapsible group per area (Attendance, Tasks, Assets, Admin; only the ones the person has) with that area's menu
  (`features/*/nav.ts`; the Tasks menu's "Attendance & leave" entry is gone, Attendance is its own group). The group of the
  current page is open and the others show just their header (a link to the area + a chevron to peek inside); on Home the
  groups remembered on this device are open, Attendance on the first visit (`ff-nav-open`). Phone bottom bar:
  Attendance · Home · Tasks · Assets · More (More = the full menu in a drawer; Admin lives there; tabs the person lacks
  are hidden). The header keeps the menu button (phones), the area pill, light/dark, the bell, and now the **account menu**
  (one place on every screen: light/dark, Keyboard shortcuts, Change password, Sign out). The brand/logo opens Home; the
  "← Workspace portal" link is gone.
- **Sign-in**: fewer words, the login field focused, a Show / Hide button on the password, the same labels and button; the
  marketing panel only on desktop; fits a 360 px phone without scrolling. The locked-account message comes from the API as-is.
- **Accessibility in the frame**: "Skip to content" first in the DOM, `<main id="content">`, header/nav/main landmarks,
  `aria-current="page"` on the current entry, focus moves to the page's `h1` after each route change (screen readers
  announce the page), visible focus rings, tap targets of at least 44 px on phones, `prefers-reduced-motion` respected
  (no transitions or hover lifts), base font 15 px from 1024 px up. **Keyboard**: Alt+1..4 jump to Home / Attendance /
  Tasks / Assets; `?` opens "Keyboard shortcuts" (Assets keeps its own `?` list with its G-then-letter jumps).
- `/account` (change / first password) stays as it was.

**Tests**: e2e names updated (Home h1 `/^Good (morning|afternoon|evening), /`, "Main menu" with the group headers,
"Attendance & Shifts" region kept, "Open Tasks" / "Open Assets" / "People & access" buttons kept); new test: a 390 px
context lands on `/attendance` and its bottom bar's Home tab opens `/?home=1`, a desktop lands on `/`.
Not in this change (owned by the HR screens): on phones the Today page shows its four tiles before the mark-attendance
card; moving the card first would put the punch buttons higher.


### 19.15 Attendance for managers: live, daily, dashboard, reports, import (2026-10-10)
Founder showed the SalaryBox screens CarTrends uses today (Live / Daily attendance, Attendance Dashboard, Download Reports) as
ideas for our Attendance section. Everything that existed stays; four sections and an import were added.

**Who sees what.** Approvers (hr.approve, or a reports-to manager under the "manager approves" rule) see their team: their
department (hr.approve) and/or their direct reports (manager rule). hr.manage and tasks.view_all see the whole company. Anyone
else gets 403. Import and the template are hr.manage only. All of it runs in the request's company schema (`TENANCY=schemas`).

**Screens** (`apps/web/src/features/hr/`: `live.tsx`, `daily.tsx`, `dashboard.tsx`, `reports.tsx`, `import-dialog.tsx`; data
from `packages/core/src/hr/team.ts`)
- **Live team** `/attendance/team` (menu "Live attendance"; replaces the old Team tab, same URL): tiles Present · Late · Not
  checked in · On leave · Off / holiday · Checked out (each filters the list), search (name, phone, employee ID), department,
  rows with avatar, employee ID / designation, status + Late / Left early / No check-out flags, in/out with punch photos, hours,
  "History", and "Mark" for HR (present / half day / absent + reason, any date up to today). Refreshes every 60 s.
- **Daily attendance** `/attendance/daily?date=YYYY-MM-DD`: the same list for any day, ← / → / Today; past working days with no
  punch show Absent, plus holiday / week-off / leave; future days "Upcoming".
- **Attendance dashboard** `/attendance/dashboard`: month picker, department, search, "Show inactive staff", "Showing N staff";
  sortable columns Present (late days included), Absent, Half day, Late (late check-ins), Leave, Off / holiday, Hours; a row
  opens that person's month calendar (`/attendance/history?user=<id>&name=&from=dashboard`, the existing MonthView); "Download
  report" (monthly summary XLSX) and "Import attendance" (HR).
- **Reports** `/attendance/reports`: report type, period, department, XLSX or CSV, "Download" (made on the spot, no queue).
  "Recent downloads" is kept on this device only (localStorage `ff-attendance-reports`, last 10) with "Download again".

**API** (Tasks, `hr/team.py` + actions on the attendance viewset)
- `GET /attendance/team_day/?date=&department=&q=&inactive=0|1` → `{date, is_today, holiday, week_off, rows, departments}`;
  a stored row wins, else holiday → week-off → future: null → today: `not_checked_in` → past: `absent` (the
  `monthly_report` rule). Three queries whatever the team size.
- `GET /attendance/team_month/?year=&month=&department=&q=&inactive=` → per person `totals` (same shape and numbers as
  `monthly_report`), `present_days`, `late_marks`, `working_minutes`, `total_hours`. One query for the month's rows, one for
  holidays (approved leave is already stored as leave rows).
- `GET /attendance/report/?type=…&format=xlsx|csv` → attachment. Types: `daily` (`date`; ID, name, department, designation,
  phone, status, in, out, hours, late, early out, note), `monthly_summary` (`year`,`month`), `monthly_register` (`year`,`month`;
  muster roll, one column per day with P / A / H / L / WO / HO, late = P, then the counts), `late` (`from`,`to`; date, person,
  check in, minutes late against the work start, check out, hours), `leave` (`from`,`to`; leave requests touching the range, any
  status). At most 366 days. XLSX via openpyxl (pinned 3.1.5): bold, frozen header, column widths, dates as text dd-mm-yyyy;
  CSV in UTF-8 with a BOM (Excel). Names like `attendance-daily-2026-10-10.xlsx`, `attendance-register-2026-10.csv`.
- `GET /attendance/import_template/?format=xlsx|csv` and `POST /attendance/import/` (multipart `file`, `dry_run=true|false`) →
  `{rows:[{line, employee_id, name, date, status, check_in, check_out, note, ok, error}], created, updated, skipped, skipped_rows}`.
- `manual_mark` already took an optional `date` (today or earlier); the screen now sends it with present / half day / absent.
- The file endpoints read `?format=` themselves (DRF would treat it as a renderer); errors stay JSON.

**Import format.** Columns (header row required, names matched loosely): Employee ID, Date (YYYY-MM-DD; dd-mm-yyyy and Excel
dates accepted), Check in (HH:MM), Check out (HH:MM), Status (present / half_day / absent / leave; blank = worked out from the
times), Note. People are matched by employee ID, then username, inactive people included (old history). Row errors: missing or
unknown employee, bad / future date, bad time, check-out without check-in or before it, unknown status, times on an absent /
leave day, the same person and date twice. Applying writes every good row in one transaction, computed like a punch (late
against work start + grace, early out against work end, working minutes; "present" becomes "late" when late; a blank status
with too few hours becomes a half day), note "Imported by {name} on {dd-mm-yyyy}[: note]". An existing day is overwritten
(re-importing updates, never duplicates). At most 2 MB / 5,000 rows per file.

**Employee ID and designation in Tasks.** Tasks had neither, so `accounts.User` got `employee_code` and `designation` (migration
0020). Provision stores the employee code; the People push (§17.1) now also carries `employeeCode` (Platform
`directory.service.ts`) and Tasks stores both when present. Assets ignores the extra field.

**Removed:** the old Team tab (`TeamTab`) and its `useTeamToday` hook (the `team_today` endpoint stays for the API tests).

**Tests.** Tasks `hr/tests_team_views.py` (22: scope, classification, month totals = `monthly_report`, no query per person,
XLSX/CSV contents, import validation, apply, re-import, XLSX cells, manual mark date) + 1 people-sync test; Platform integration
test updated for `employeeCode`. e2e `web-attendance-team.spec.ts` (3: Live/Daily/Dashboard, Reports XLSX+CSV, Import → Daily).


### 19.16 Phase 7 started: Android app, steps 1–2 (2026-10-12)
**Founder's decisions (2026-10-12)**
- **Android first**; iPhone later (the code is cross-platform; only Android is tested).
- **No face matching in the app.** App attendance = **GPS geofence + a selfie stored with the punch** (the existing `photo`
  field of check-in/out, JPEG data URL; HR already sees the thumbnails). If the company has face check on, the app does not
  compute a descriptor: it shows "Face check is on for your company; the app punches with a selfie only — ask your admin to
  switch face check off in Attendance → HR settings" and does not send the punch (the server would refuse it anyway).
- **Local only for now**: the founder tests on their own Android phone with **Expo Go** on the same Wi-Fi as the PC
  (`http://192.168.2.72:8080`). No cloud server yet. The API address is `EXPO_PUBLIC_API_URL` (default in `.env.example`
  and `app.json` `extra.apiUrl`; no `.env` is committed).

**Choices**
- **Expo SDK 57** (the SDK of the current Expo Go), Expo Router, TypeScript; `com.freefounders.app`, "FreeFounders".
  Routes in `apps/mobile/src/app` (Expo's default layout).
- **Monorepo:** `apps/mobile` is **outside** the root npm workspace with its own `node_modules`/lockfile, because Expo pins
  React 19.2.3 and the web uses React 19.3 (a shared workspace would give two Reacts). Metro reads `packages/core` and
  `packages/theme` from source (`watchFolders`; `@freefounders/*` mapped through their `exports`) and resolves every bare
  import made inside `packages/*` from the app's `node_modules` → one React, one React Query (verified on the export's
  source map: 0 files from the root `node_modules`). TypeScript does the same with `paths`; Expo's tsconfig-paths in Metro
  is off (`experiments.tsconfigPaths: false`) and Metro resolves `@/` itself. The root `npm ci` and the web are unchanged;
  `npm run setup` also installs `apps/mobile`.
- **Core on React Native:** `configureCore({ origin, refreshStore })` was enough (no storage/DOM injection needed). Two small
  core changes, no web behaviour change: the JWT payload is decoded without the legacy `escape()` (same result, verified
  with non-ASCII names), and sign-out sends the stored refresh token when there is a `refreshStore` (mobile), so the
  Platform revokes that phone's session (the web still uses the cookie). The refresh token lives in `expo-secure-store`
  (`src/lib/refresh-store.ts`); at start the app renews it; offline with a stored token → "Cannot reach FreeFounders" + Try
  again (stays signed in).
- **Theme:** `packages/theme/src/tokens.native.ts` = hex copy of `tokens.ts`, generated by
  `packages/theme/scripts/build-native.mjs` (OKLab → sRGB, no dependency); `scripts/check-web-rules.mjs` fails when it is
  stale. Styling = plain `StyleSheet` + `useTheme()` (tokens + phone light/dark + company brand colour as primary, text on it
  picked for contrast). NativeWind not used (not needed for this size). Plus Jakarta Sans via `@expo-google-fonts`.
- **Dev suite on the LAN:** the gateway already listens on every interface; `scripts/dev.mjs` adds this PC's LAN IPv4
  addresses to Django's `ALLOWED_HOSTS` (before: `DisallowedHost` for `192.168.2.72`) and prints the phone address.
  Platform and Assets accepted the LAN host as they were. Windows Firewall may ask to allow Node.js on private networks.

**Built (steps 1–2)**
- Sign-in (email / username / employee ID, Show/Hide password, server errors as-is incl. lockout), stays signed in,
  "Set a new password" notice when the admin gave a temporary one (opens `/account` on the web), sign-out with confirm.
- Bottom tabs **Attendance · Leave · Holidays · More**; Attendance is the first screen.
- **Attendance:** greeting, live clock, today's status pill, In / Out / Worked, Late / Left early, one big Punch in / Punch
  out / Done for today button. Punch: face check on → message, no punch; geofence on → location permission + high-accuracy
  fix (10 s, then a recent last-known fix), clear help when GPS is off or permission is blocked (Open settings); photo
  optional/required → front camera with preview, Retake / Use photo (and "Punch without a photo" when optional), JPEG 0.6,
  longer side ≤ 720 px → `check_in`/`check_out` with lat/lng/photo; server refusals shown as-is. My month: coloured
  calendar (Monday first), legend with counts, hours, tap a day for in/out/worked, previous/next month.
- **Leave:** balances (bar, pending), Apply for leave (type, from, to with the Android date picker, reason), my requests
  with status and remarks, Cancel (confirm). There is **no half-day leave** in the API (`LeaveRequest` counts whole days),
  so no half-day switch; leave types that need a document say "apply on the web for now".
- **Holidays:** upcoming (with "in N days") and past. **More:** profile, company, change password / open the web, server
  address, app version, sign out.
- Everywhere: pull to refresh, skeletons while loading, error card with Retry, 48 dp+ targets, labels and roles for TalkBack.
- People without Tasks access see "Attendance is not set up for you" (the Tasks API is not called).

**Tests / checks:** `npm run mobile:check` (tsc + 15 node:test unit tests: oklch→hex, secure-store adapter, punch plan +
payload, dates, colours); `npx expo export --platform android` builds; `npx expo-doctor` 21/21; Metro in LAN mode served
the manifest and bundle on `http://192.168.2.72:8081`; the web build and the e2e `single-login` + `web-hr` specs pass
unchanged.

**Next steps:** Home card (Tasks/Assets counts) → Tasks (list, detail, complete with proof photo) → Assets (scan, my assets;
needs the Assets cookie session from the phone) → approvals for managers → push notifications (expo-notifications; needs a
development build) → leave documents (document picker + multipart) → a staging server with HTTPS → EAS builds (APK for
testers, then Play Store; `usesCleartextTraffic` only for local http) → iPhone.

### 19.17 Phone app = the web app in a native shell (2026-10-12)
**Founder's decision** (after trying §19.16 on the phone): "it appears to be a completely different product, I want the
previous one as it is." → The Android app shows **the FreeFounders web app itself** (same screens, look and features:
Home with attendance first, Attendance / Tasks / Assets / Admin, the phone bottom bar) in a full-screen
`react-native-webview`. One product, one code base for screens; every web change reaches the phone at once. The decisions
of §19.16 stand: Android first, **no face matching in the app** (selfie stored + GPS geofence only), local testing over the
laptop's hotspot (`http://192.168.137.1:8080`) or the office Wi-Fi.

**What is native** (`apps/mobile`, Expo SDK 57, runs in Expo Go):
- **Punch location + selfie** through a small bridge (`postMessage` both ways, request ids; protocol in
  `apps/mobile/README.md`). Needed because Android's WebView allows the browser camera and GPS only on https/localhost,
  and the native camera/GPS are better anyway. Web side: `apps/web/src/lib/native-bridge.ts`; `features/hr/face.ts`
  `currentPosition()` and `features/hr/punch.tsx` use it only when `window.FreeFoundersApp` is set. In the app: face check
  on → the message "Face check is on for your company; the app punches with a selfie only — ask your admin to switch face
  check off in Attendance → HR settings", no punch (face enrolment also refuses in the app); photo optional/required →
  native front camera (Retake / Use photo, "Punch without a photo" when optional); location only with a geofence, with the
  app's own reason when it fails. Outside the app nothing changed (e2e).
- **Downloads**: `downloadCSV`/`downloadBlob` (reports, payroll, templates, team reports, form submissions — the last one
  now uses `downloadBlob` too) and `<a download>` links (Assets photos) go to the app → saved in its cache → Android share
  sheet. **Print** (ID cards, labels) → Android print dialog via expo-print.
- Back button (web history, else leave), pull-to-refresh (only when the page is at the top), splash until the first page,
  "Can't reach FreeFounders" with Try again and a **server address field** (kept on the phone), status bar light/dark from
  the phone, other sites / `tel:` / `mailto:` / WhatsApp open outside, photo pickers offer the camera (permission asked on
  first use), `navigator.geolocation` answered by the app (HR settings "use my location").
- Removed (git history keeps them): the separate RN sign-in, tabs (attendance, leave, holidays, more), leave-apply, UI kit,
  fonts, core wiring and their tests. Kept: selfie camera, location helper, `tokens.native.ts` + its check, the two core
  fixes in `packages/core/src/session.ts`.

**Tests:** `npm run mobile:check` (tsc + 17 node:test: bridge protocol, link rules, server address, injected script in a
fake page, file names/base64, selfie size, oklch); `npx expo-doctor` 21/21; `npx expo export --platform android` builds;
e2e `web-app-shell.spec.ts` simulates the shell (fake `ReactNativeWebView`): punch with the app camera stores the photo,
face check on shows the message and sends nothing, a report download goes to the app.

**Known limits:** Assets QR scanner and Tasks voice notes use the browser camera/microphone → need https (staging). QR codes
point at `PUBLIC_URL` (dev default `http://localhost:8080`; start `npm run dev` with `PUBLIC_URL=http://192.168.137.1:8080`
to print codes a phone can open). Django accepts the PC's network addresses present when `npm run dev` starts: switch the
hotspot on first, or restart.

**Next:** push notifications through the shell (expo-notifications in a development build; the web asks the bridge for a
push token and the Platform stores it per person) → a staging server with HTTPS → EAS builds (APK for testers, then Play
Store) → iPhone.

### 19.18 Light on low-end phones (2026-10-12)
Goal: the web app (and so the Android app, §19.17) fast on 1–2 GB phones on slow 4G. Five items approved by the founder.

**1. Face matching removed completely** (founder: no face matching anywhere; punch = GPS geofence + selfie photo).
- Web: `@vladmandic/face-api` uninstalled and `apps/web/public/models/*` deleted (6.8 MB); `features/hr/face.ts` →
  `device.ts` (camera check, photo grab, location only), `face-capture.tsx` → `selfie-capture.tsx` (`SelfieCapture`: a plain
  selfie dialog, same "Check in" / "Check out" names and photo note). Gone: the Face attendance panel and the two face
  checkboxes in HR settings, the "Face verification is ON…" notes on Today, "Face not enrolled" on Home, the in-app
  face-check refusal message, `useFaceProfile`, the face fields in the core types.
- Tasks API (`hr`): face check is permanently off. `cfg()["face_enabled"]` is always false; `today` and `hr/config`
  report `face_enabled: false` (kept for older clients; `face_enrolled` / `face_self_enroll` are gone); check-in/out never
  need a descriptor and ignore `face_descriptor` from an older client (`face_verified` false, no confidence). HR settings
  no longer list `face_enabled` / `face_threshold` / `face_self_enroll`; an older screen sending "off" still saves, switching
  it on is refused (400 "Face check was removed…"). `POST /hr/face/<user>/` answers 410; `DELETE` still removes an old
  profile. Kept readable: `FaceProfile`, `Attendance.face_verified` / `face_confidence`, the stored setting.
- **Data step:** migration `hr 0006_face_check_off` sets `FACE_RECOGNITION_ENABLED` to `false` in the company settings
  table; `migrate_companies` runs it in every company schema (applied to the dev database on 2026-10-12: 4 companies).
  `.env.example` and the Tasks README say the FACE_* variables are no longer read.
- Tests: `hr/tests.py` FaceTests → FaceCheckRemovedTests (6: a punch with the old setting on needs no face, a descriptor is
  ignored and the old profile untouched, today/config report off, enrol 410 / delete works, settings refuse "on", the
  migration's data step). e2e: `face_enabled` dropped from the settings the specs save and restore; `web-app-shell` now
  proves face check cannot be switched on and the check-out goes through with the app camera. Punch-photo tests unchanged.
- Attendance → Today shows the mark-attendance card only with the punch-in permission (`attendance.punch`, §19.19, the
  same check as the Home card); without it: "Your role doesn't include punching in."

**2. Lite mode for weak phones** (`src/lib/lite.ts`, CSS in `src/index.css`).
- **Removed 2026-10-23 (founder; §19.36)**: Lite mode is gone (menu, `lib/lite.ts`, `data-lite`, its CSS). What follows
  is kept as history; the minute clocks stay (`lib/clock.ts`).
- `<html data-lite>` is set before the first render when the account menu's **Lite mode** is On, or on Auto (default)
  when `navigator.deviceMemory <= 2`, or a phone-size screen with `hardwareConcurrency <= 4`, or `prefers-reduced-motion`.
  The choice (Auto / On / Off, radio items in the account menu; the label shows what Auto decided) is kept per device in
  localStorage `ff-lite`.
- Under `[data-lite]`: no backdrop blur (the header and bottom bar become solid `--card`), the decorative blurred glows
  (`.absolute` with `blur-*`) are hidden, big shadows fall back to the small card shadow, soft gradient surfaces become the
  flat card and the solid hero gradient the flat `--primary`, no transitions or animations (spinners keep turning).
- Clocks: the punch clock (Today) and Home's clock tick **on the minute** (they show minutes only; Today used to re-render
  every second) and stop while the page is hidden, catching up when shown (`useMinuteClock`). Query polling already
  pauses while hidden (TanStack's default).

**3. The app's files stay on the phone** (service worker; `vite-plugin-pwa` injectManifest, source `apps/web/sw/sw.js`).
- Precaches `index.html`, `theme.js`, the favicon, every `/static/*.js|css` and the Latin font files (149 files, 2.7 MB
  raw, about 0.8 MB gzip, fetched once per deploy in the background; a later deploy fetches only the files that changed).
- Page loads are **network first** (4 s, then the cached `index.html`, also when offline), so a new deploy shows on the
  next load; `/` is not served cache-first. `/api/*`, `/tasks/api/*`, `/assets/api/*`, `/media/*` are never answered by
  the worker (no API data in any cache), nor `/tasks/sw.js`.
- `skipWaiting` + `clientsClaim`; the open app then shows **"A new version is ready"** with **Reload**
  (`src/lib/sw-register.ts`). Registered only in production builds (`import.meta.env.PROD`), 5 s after load when the
  phone is idle, and only where service workers are allowed (https or localhost; Android's WebView on the https server).
  On the LAN address `http://192.168.x.x` the app works as before, without the offline copy. The app also looks for a
  new version when it comes back to the front.
- The old Tasks kill-switch `public/tasks/sw.js` stays at its path (old phones still clean up); it now deletes only the
  old app's caches and keeps the new worker's `workbox-*` cache. Caddy draft: `sw.js` is `no-cache`.
- Build check `scripts/check-sw.mjs` (part of `npm run web:build`): `sw.js` emitted as a classic script, the shell and
  everything `index.html` loads precached, no API / upload / kill-switch path precached, the four API prefixes in the
  page route's denylist, the kill-switch present.

**4. The last data shows instantly** (`src/app/query-persist.ts`, `@tanstack/query-persist-client-core` 5.104.1).
- Kept in localStorage `ff-query-cache` (written at most once a second and when the page is hidden): who I am
  (`platform` / `tasks` / `assets` me, Assets config), today's attendance, HR config, leave balances, pending leave and
  corrections, my task tiles, the Tasks home summary, waiting counts, the Assets dashboard, notifications. Nothing else,
  never mutations.
- One copy for one `sub|cid`: restored only after that person's session is renewed (before the first screen draws),
  dropped on sign-out and when someone else signs in (the in-memory cache is emptied too), after 24 h, and with every
  build (buster = build id, `__FF_BUILD_ID__`). Fresh data is fetched in the background as usual.

**5. Long lists in pages** (`components/common/show-more.tsx`: `useShowMore` + `<ShowMore>`, "Showing 50 of 312 ·
Load 50 more", a polite live region; focus moves to the count when the last rows arrive; back to the first page on any
filter, search or date change). Applied where the API returns the whole list: task lists My / All / Delegated /
Subscribed (counts still use every row), Activities, To accept / Change requests / Deleted bin, People & access, Live
team / Daily, Attendance dashboard (after sorting), My Team (Tasks), the Assets queue (most urgent first), the Leads board
(30 cards per column, each with its own Load more; drag and drop unchanged). Already paged by the server, unchanged:
Assets list, Assets employees, Requests, Tickets; Notifications fetches at most 50. e2e: the two "HR sees the thumbnail"
checks search the new person first (Live team draws 50 staff at a time).

**Numbers** (production build behind a gzip server like the Caddy draft, APIs through the dev gateway, Playwright at
390 px; this PC was busy with other work, so throttled timings vary by about ±20 %)

| | Before | After |
|---|---|---|
| Build output (`dist`) | 176 files, 11.0 MB (5.7 MB gzip) incl. 6.8 MB face models | 171 files, 2.9 MB (1.0 MB gzip) |
| JavaScript in total | 3,753 KB (1,080 KB gzip); largest chunk face-api 1,314 KB | 2,510 KB (773 KB gzip) |
| Main chunk `index-*.js` | 436.7 KB (132.3 KB gzip) | 442.2 KB (134.0 KB gzip): + persistence, lite mode, worker registration |
| First visit of `/attendance`: bytes | 383 KB (337 static + 46 API), 52 requests | 383–387 KB, 53 requests (this page never loaded the face code) |
| Second launch of `/attendance`: bytes from the network | 25 KB (HTTP cache) | 2.7 KB (42 files from the worker) |
| Second launch: page heading visible | about 1,050 ms | about 550 ms |
| First visit, slow 4G + 4× CPU: heading / TBT | 4.1–4.8 s / 0.8–1.1 s | 4.6–4.9 s / 1.0–1.2 s (within this PC's noise) |
| Lighthouse mobile, `/login` (cold) | 78, 81 (LCP 3.5 s, TBT 220–310 ms) | 77, 78 (LCP 3.5 s, TBT 290–320 ms) |
| Lighthouse mobile, `/attendance` signed in (second visit) | 76, 87 (LCP 2.3–2.5 s, 57 KiB) | 87, 86 (LCP 1.4–1.5 s, 3 KiB) |

Disk: the face models (6.8 MB) leave the repo; `node_modules/@vladmandic` (24 MB) is gone; `vite-plugin-pwa` + Workbox
(5.6 MB, build time only) were added.

### 19.20 Smaller photos (2026-10-12)

Photos now take a fraction of the space and go up quickly on slow phones. Every image is shrunk twice over: in the
browser before it is uploaded (the web app, and so the Android app, which is the web app in a WebView), and again on the
server as a safety net for any other client (an older app, the API, a big upload).

**Presets** (longest side, quality):

| Preset | Size | Used for |
|---|---|---|
| `selfie` | ≤ 720 px, 0.65, always JPEG | punch photos (stored and served as `image/jpeg`) |
| `photo` | ≤ 1600 px, 0.72 | asset, handover and return photos |
| `document` | ≤ 2000 px, 0.80 | images attached as documents: task files and completion proof, leave and lead documents, form file fields, notice attachments (text stays readable) |

**In the browser** — `apps/web/src/lib/compress-image.ts`, `compressImage(file | blob | dataURL, preset)`: decodes with
`createImageBitmap` (`imageOrientation: 'from-image'`, `<img>` fallback), scales on a canvas (OffscreenCanvas when there
is one), encodes WebP where the browser can (else JPEG on white) and returns whichever is smaller, the original or the
copy. Non-images, GIF, SVG and a HEIC the browser cannot read come back untouched. Re-encoding drops all metadata, the
photo's GPS position included. Used by the Assets photo picker (`features/assets/components/photos.tsx`: photos are
shrunk as soon as they are picked, the strip shows "8.4 MB → 620 KB"; `uploadPhotos` shrinks anything not yet shrunk),
the Tasks file button (`FilePick`, so task attachments, completion proof and lead documents; the list shows
"1.2 MB → 180 KB"), the leave document and form file inputs, and the punch selfie (`selfie-capture.tsx`). The phone
app's native selfie already sends ≤ 720 px JPEG.

**On the servers** (an image that is already smaller, or that does not shrink by at least 10% while it already fits, is
kept as sent; non-images are never touched):
- Tasks (Django, `Pillow==11.3.0`): `config/images.py` — `compress_image(raw, max_side, quality)` (EXIF transpose, RGB on
  white, LANCZOS, progressive optimised JPEG, no EXIF) and `compress_upload(file, preset)`. Punch photos (`_attach_photo`,
  selfie preset, a PNG/WebP is always converted to JPEG), task attachments and proof, lead documents, form uploads,
  leave documents and notice attachments (document preset; the file name becomes `.jpg`). The punch photo limit stays
  400 KB and the retention setting is unchanged.
- Assets (NestJS, `sharp@0.34.5`): `modules/assets/photo-shrink.ts` — `.rotate()`, inside 1600×1600 without enlarging,
  mozjpeg JPEG 72 on white (a WebP stays WebP, quality 72), metadata dropped. The row's `mime_type`, `file_name`
  extension and `size_bytes` follow the stored format; photos keep being served with their own type, old rows unchanged.
  Photos now list `mimeType` (the download gets the right extension). The per-photo upload limit went from 8 MB to
  15 MB raw, since the server shrinks everything anyway.

**Existing files** — one-off maintenance commands, dry run by default (print the space they would save):
- Tasks: `manage.py compress_media [--apply]` (every company in multi-company mode; the smaller copy is saved first, the
  row is pointed at it, then the old file is deleted).
- Assets: `node scripts/compress-uploads.mjs [--apply]` (shared tables and every company schema; rows keep their id).
Dry runs on the demo data (2026-10-12): Tasks 59 files, 0 to shrink (the demo punch photos are already ~6 KB);
Assets 25 photos, 18 would shrink, 112 KB → 101 KB. Not applied.

**Measured** on a 3840×2400 photo (1.53 MB JPEG): selfie 24 KB, photo 86 KB (Pillow) / 74 KB (sharp mozjpeg),
document 142 KB. In the browser test a 3000×2000 photo (PNG or JPEG) comes out as a 1600×1067 WebP under a quarter of
its size.

Tests: `hr/tests_images.py` (Tasks: shrink per preset, EXIF orientation + GPS dropped, non-images and GIF untouched,
never bigger, transparent PNG on white, a large punch photo stored as a 720 px JPEG, `compress_media` dry run/apply),
Assets integration test (a 3000×2000 photo with EXIF orientation is stored upright at 1067×1600 without metadata),
`e2e/web-compress-image.spec.ts` (compressImage in a real canvas) and the asset photo test in `e2e/web-assets.spec.ts`
(the stored photo is 1600 px and a fraction of the 3000×2000 upload).

### 19.19 Roles: every feature is a permission (2026-10-12)
Founder (2026-10-12, with a screenshot of "New role"): the Level hint said "Admin level…" while "Member" was chosen, "Save
role" was greyed out with no reason, and he wants "an option for each and every specific feature" so any role can be built,
with no predefined restrictions.

**What changed**
- **Every feature is its own permission** (catalogue version 2). Tasks went from 15 to 52 permissions (47 since Web forms and the Idea board were removed, §19.23), grouped like the
  menus; each has a label, a one-line description (shown under it in the editor) and scopes where they make sense. Assets
  keeps its 24 permissions and now sends a description for each. The **Admin workspace** is a third "app" in the editor,
  **Admin**, with 6 permissions (the Platform's own catalogue).
- **Enforced in the API and in the web app**: every check that rode on a broad permission (`hr.manage` for payroll,
  `hr.approve` for all manager attendance pages, `tasks.assign` for groups/templates/forms/links/ideas/SOPs,
  `settings.manage` for notices/holidays, the Admin level for deleting leads…) now asks for its own permission; menus
  (`features/*/nav.ts` `show`), page tabs and buttons follow the same rules. Viewing notices, links, ideas, forms,
  mistakes, the template directory, notifications, punching in, my attendance/leave/salary and holidays are permissions too
  (every existing role keeps them).
- **Only the Owner role is locked.** "Super Admin" (`ff_super_admin`, the Owner role) always has every permission of every
  app, new ones included (recomputed from the catalogues), and cannot be edited or archived. "Admin" (`ff_admin`) and every
  other role are ordinary roles: edit, duplicate, archive. A company can never lock itself out: an owner has every Admin
  permission whatever their roles.
- **Role editor** (`features/admin/role-editor.tsx`): "Start from" (Blank / "Copy from {role}": its permissions and level);
  "Search permissions"; per app a collapsible section with "{n} / {m} on", "Select all", "Clear"; per group "{n} / {m}",
  "All", "None"; the description under each permission; scope picker next to scoped ones; footer stays at the bottom;
  44 px rows and scope buttons on phones. "Save role" is always enabled: without a name it shows "Give the role a name"
  under the field (and in the footer) and focuses it. The Level hint describes the selected level, as it really works:

| Level | Hint (what the code does) |
|---|---|
| Member | "Uses the apps with exactly the permissions ticked below." |
| Manager | "Same as Member: the ticked permissions decide what they can do. Tasks also lists them as a manager people can report to." (Tasks' own user screen offers manager-level roles as "Reports to"; nothing else uses level 2; Assets ignores levels.) |
| Admin | "Also an administrator in Tasks: sees everyone's delegated work on Tasks Home and manages other admins' Tasks accounts; work given to them is protected from deletion (only the Owner can delete it)." (`accounts.access.is_admin`: delegation board, admin accounts in Tasks' user screen, protected work, no reporting manager needed, no WhatsApp ping for change requests.) Deleting leads and lead rules are now permissions of their own. |

Tasks `/api/auth/me` now also returns `level`, so Tasks Home treats any Admin-level role (not only the built-in role names)
as an administrator, as the API already did.

**Catalogue: Tasks** (`services/tasks/backend/accounts/access.py`, `CATALOGUE`; scoped capability strings are
`<key>_team / _department / _all`, except `tasks.view` and `leads.*` as before and `hr.approve` whose Department scope keeps
the old string `hr.approve`)

| Group | Key | Label | Scopes | Who gets it in the upgrade (= who had it before) |
|---|---|---|---|---|
| Tasks | `tasks.view` | See tasks | Own · Team · Department · Company | existing key, unchanged |
| Tasks | `tasks.assign` | Give tasks to others | yes/no | existing key, unchanged |
| Tasks | `groups.create` | Create groups | yes/no | `tasks.assign` |
| Tasks | `templates.manage` | Task templates | yes/no | `tasks.assign` |
| Tasks | `directory.view` | Template directory | yes/no | every role |
| Tasks | `tasks.reports` | Reports | yes/no | `tasks.view` at Department/Company |
| Tasks | `tasks.team_performance` | Team performance | yes/no | `tasks.view` at Company |
| Tasks | `tasks.bin` | Deleted tasks | yes/no | `tasks.view` at Company |
| Tasks | `tasks.delete_admin_work` | Delete work assigned to an admin (Owner only by default) | yes/no | existing key, unchanged |
| Tasks | `dashboard.view` | Team dashboard | yes/no | existing key, unchanged |
| Tasks | `notifications.view` | Notifications | yes/no | existing key; + every role |
| Tasks | `tasks.settings` | Task settings | yes/no | `settings.manage` |
| Leads | `leads.view` | See leads | Own · Team · Department · Company | existing key, unchanged |
| Leads | `leads.view_won` | See won leads (accounts) | yes/no | existing key, unchanged |
| Leads | `leads.edit` | Edit leads | Own · Team · Department · Company | existing key, unchanged |
| Leads | `leads.assign` | Assign leads | yes/no | existing key, unchanged |
| Leads | `quotations.manage` | Quotations | yes/no | existing key, unchanged |
| Leads | `leads.delete` | Delete leads | yes/no | Admin-level roles |
| Leads | `leads.rules` | Lead assignment rules | yes/no | Admin-level roles |
| Leads | `intake.view` | AI inbox | yes/no | existing key, unchanged |
| Notices | `notices.view` | See notices | yes/no | every role |
| Notices | `notices.publish` | Publish notices | yes/no | `settings.manage` |
| Mistakes & SOPs | `mistakes.view` | Mistakes and SOPs | yes/no | every role |
| Mistakes & SOPs | `mistakes.log` | Log mistakes for others | yes/no | `tasks.assign` |
| Mistakes & SOPs | `mistakes.review` | Review mistakes | Department · Company | `tasks.view` at Department → Department; `tasks.view` at Company → Company |
| Mistakes & SOPs | `sops.manage` | Write SOPs | yes/no | `tasks.assign` |
| Mistakes & SOPs | `mistakes.settings` | Mistake categories and rules | yes/no | `settings.manage` |
| Web forms | `forms.view` | Fill in forms | yes/no | every role (removed 2026-10-13, §19.23) |
| Web forms | `forms.build` | Build forms | yes/no | `tasks.assign` (removed 2026-10-13, §19.23) |
| Web forms | `forms.all` | All forms and answers | yes/no | `tasks.view` at Company (removed 2026-10-13, §19.23) |
| Links & ideas | `links.view` | Links | yes/no | every role |
| Links & ideas | `links.manage` | Manage links | yes/no | `tasks.assign` |
| Links & ideas | `ideas.view` | Idea board | yes/no | every role (removed 2026-10-13, §19.23) |
| Links & ideas | `ideas.review` | Review ideas | yes/no | `tasks.assign` (removed 2026-10-13, §19.23) |
| My attendance | `attendance.punch` | Punch in and out | yes/no | every role |
| My attendance | `attendance.self` | My attendance | yes/no | every role |
| My attendance | `leave.self` | My leave | yes/no | every role |
| My attendance | `holidays.view` | Holidays | yes/no | every role |
| My attendance | `payroll.self` | My salary | yes/no | every role |
| Team attendance | `hr.approve` | Approve leave and corrections | Team · Department · Company | existing key; + `hr.manage` → Company |
| Team attendance | `hr.live` | Live attendance | Team · Department · Company | `hr.manage` → Company; `tasks.view` at Company → Company; `hr.approve` → Department |
| Team attendance | `hr.daily` | Daily attendance | Team · Department · Company | `hr.manage` → Company; `tasks.view` at Company → Company; `hr.approve` → Department |
| Team attendance | `hr.dashboard` | Attendance dashboard | Team · Department · Company | `hr.manage` → Company; `tasks.view` at Company → Company; `hr.approve` → Department |
| Team attendance | `hr.reports` | Attendance reports | Team · Department · Company | `hr.manage` → Company; `tasks.view` at Company → Company; `hr.approve` → Department |
| Team attendance | `hr.import` | Import attendance | yes/no | `hr.manage` |
| Team attendance | `hr.mark` | Mark attendance by hand | yes/no | `hr.manage` |
| HR administration | `holidays.manage` | Manage holidays | yes/no | `settings.manage` |
| HR administration | `hr.settings` | HR settings | yes/no | `hr.manage` |
| HR administration | `payroll.run` | Run payroll | yes/no | `hr.manage` |
| HR administration | `payroll.salaries` | Salaries and advances | yes/no | `hr.manage` |
| Administration | `users.manage` | Manage users | yes/no | existing key, unchanged |
| Administration | `settings.manage` | Company settings | yes/no | existing key, unchanged |

Retired: `hr.manage` (HR administrator). It is no longer offered; an old grant of it still works (read as everything it
covered: approve at Company, the four attendance screens at Company, import, manual marking, HR settings, payroll, salaries)
and the upgrade replaces it by those permissions.

**Catalogue: Assets** (unchanged keys and groups, `@eam/shared` `PERMISSION_GROUPS`; descriptions in
`apps/api/src/modules/auth/permission-hints.ts`): Assets — `asset:view`, `asset:create`, `asset:edit`, `asset:assign`,
`asset:lifecycle`, `catalog:manage`; People & organisation — `employee:view`, `employee:manage`, `employee:status`,
`onboarding:manage`, `org:manage`; Employee exit — `exit:view`, `exit:manage`, `exit:override`; Service —
`request:create`, `request:approve`, `request:fulfil`, `ticket:create`, `ticket:manage`, `maintenance:manage`;
Administration — `dashboard:view`, `insights:leadership` (Owner only by default), `history:view`, `user:manage`. Checked:
every Assets action already asks its permission in the service (`assertCan`), and the Assets menu follows them.

**Catalogue: Admin** (`services/platform/src/roles/platform-permissions.ts`, app key `platform`)

| Group | Key | Label | Opens | Who has it |
|---|---|---|---|---|
| People | `people.manage` | Manage people | People & access: add, edit, switch off/on, app access | owner, admin (access level) |
| People | `people.passwords` | Reset passwords | reset / create / remove a login | owner, admin |
| People | `people.exit` | Start exits | "Start exit" | owner, admin |
| People | `people.delete` | Delete people permanently | "Delete permanently" | owner, admin |
| Roles & company | `roles.manage` | Manage roles | Roles; "Change roles" on People | owner, admin |
| Roles & company | `company.settings` | Company settings | Settings (name, colour, logo, modules, departments) | owner, admin |

Platform guards: `@Needs(...)` on every Admin route (any of the listed permissions; re-read from the database on every call,
so taking a role away counts at once). Owner and the `admin` access level have all six (so existing companies are
unchanged); a member gets exactly what their roles grant. Any people permission or Manage roles opens People & access (the
list and role names); each button follows its own permission. A member with Admin permissions acts on **members only**
(cannot create, edit, reset, exit, delete or promote an owner/admin). `GET /auth/me` returns `permissions`; the web app's
`useAccess().admin.can(...)` / `.any` drive the Admin menu, Home's Admin row and the per-screen guards (a page you may not
open sends you to the first Admin page you may, else `/`). Note: Manage roles can give any permission, these included.

**Upgrade of existing roles (nobody loses anything)** — the rules travel with the catalogue
(`GET /internal/permissions` now returns `version: 2`, `retired`, and per permission `upgrade` rules: `everyone`, `from`
(+ `fromScopes`), `minLevel`, with the scope to give; the widest wins):
- Tasks: data migration `accounts/0021_fine_grained_permissions` runs `upgrade_grants` on every role in every company
  schema (`migrate_companies`). A role with no Tasks permission (a role for another app) stays empty.
- Platform: migration `0006_fine_grained_roles` (column `companies.access_upgrades`; "Admin" role unlocked; Owner role
  description). `RolesService.ensureUpgraded` (on the roles list, every push and `company sync`) applies each app's rules
  once per company when its catalogue version is newer than the one recorded (generic: the Platform knows no Tasks
  permission), and keeps the Owner role equal to the full catalogue. Pushes carry `catalogueVersions`; Tasks upgrades a
  push written in an older catalogue itself, so the order of deploying the two does not matter. Once only: a permission an
  admin later takes away stays away.
- Rules in words: everyone keeps punch in, my attendance, my leave, holidays, my salary, notifications, notices, links,
  ideas, forms, the mistake register and the template directory; `tasks.assign` → groups, templates, log mistakes, SOPs,
  build forms, manage links, review ideas; `settings.manage` → task settings, notices, holidays, mistake settings;
  `tasks.view` Company → deleted tasks, team performance, reports, all forms, review mistakes (Company), the four attendance
  screens (Company); `tasks.view` Department → reports, review mistakes (Department); `hr.approve` → Department scope and the
  four attendance screens (Department); `hr.manage` → approve (Company), the four screens (Company), import, manual mark,
  HR settings, payroll, salaries; Admin level → delete leads, lead rules.
- Scopes on other people's attendance: Team = me + my direct reports; Department = my department + my team; Company =
  everyone. Under the "manager approves" HR rule a reports-to manager still approves for, and sees on the four screens,
  their own team (as before); `/hr/config/` returns `screens` so the page tabs follow it.
- Found and fixed: `PATCH /roles/:id` with a partial body reset the level to Member and removed every permission (the zod
  schema's defaults survived `.partial()`); PATCH now changes only what is sent (`roleUpdateSchema`).
- Small widening, by design: a Department scope also covers one's direct reports outside the department (PLAN §15.2), and
  someone who sees a screen at Company can open anyone's month from it.

**Applied to the dev suite on 2026-10-12** (no restart needed): Platform `node dist/db/migrate.js`, Tasks
`manage.py migrate_companies` (4 companies), then `company -- sync` (every company upgraded to Tasks v2 and pushed).

**Checks**
| Check | Result |
|---|---|
| Tasks tests (SQLite) | 813 pass, 16 skipped (whole suite incl. other work of the day; 18 new in `accounts/tests_permissions_v2.py`: catalogue, upgrade keeps every old power, data migration, an older Platform's push, 403 without / allowed with the permission across Tasks, Leads, Notices, Links, Ideas, Forms, Mistakes, Notifications, My attendance, attendance screens with scopes, HR administration, approving by scope) |
| Tasks tenancy (Postgres) | 28 pass |
| Platform tests | 63 pass (4 new: member with Manage people lists/adds people but not roles/settings/admins; each Admin permission opens exactly its action and is checked live; owner never locked out, Owner role not editable; a new catalogue version upgrades roles once, Owner role follows, pushes carry the version) |
| Assets tests | 85 pass; typecheck clean |
| Web | rules + typecheck clean |
| e2e | `web-admin`, `single-login`, `settings`, `web-hr`, `web-tasks-general`: 29 / 29 (2 new: a role from blank with only Live attendance + See notices — level hints, "Give the role a name", Copy from, search, the person sees exactly those menus and the API refuses HR settings / leave / punch / People; a member with only Manage people gets People & access only); also `flows`, `web-attendance-team`, `web-leads`, `web-links-ideas-payroll`, `web-mistakes-forms`, `web-tasks`: 17 / 17 |

### 19.21 Security pass + UI/UX pass (2026-10-12)
Founder: "make this very secure for data-leak risks, authentication and authorization, very scalable"; then "use the
ui-ux-pro-max skill to improve UI/UX as much as possible without changing the structure much".
- **Security** (three reviews; details, fixes with test names and remaining risks in `docs/security/{platform,tasks-api,assets-web-mobile-infra}.md`):
  High fixed: uploaded files were readable by anyone with the URL (now signed, expiring `/media` links, only alongside a
  record the caller may see); HTML/SVG uploads could run as the app (now forced downloads, sandboxed); login lockout
  bypassable with parallel requests (atomic claim); "Manage people" could grant an app's Super Admin role (now needs
  Manage roles; members act on members only); Assets' own password login reachable in multi-company mode (refused).
  Plus ~35 medium/low fixes (per-IP sign-in limit, immediate session end on sign-out/reset/deactivate, sign-out-everywhere
  API, refresh/session clean-up, multi-process safe poller and JWKS refresh, CSV formula injection, public-form rate
  limits, unsigned webhook refused, `javascript:` links blocked, Android shell only answers its own server, https-only
  server address outside the office network, CSP/HSTS/headers in the Caddyfile (CSP report-only), CI audit + secret scan).
  Libraries: sharp 0.35.5, Pillow 12.3.0. No secrets found in the tree or history.
- **UI/UX** (`docs/ui-ux-review.md`): brand colour auto-adjusted to 4.5:1 for text/buttons, status colours darkened for
  contrast, visible focus outlines, 40–44 px phone targets, select chevrons restored, safe-area/toast fixes, text never
  under 12 px (bottom-bar labels 11 px), chart value labels + text summaries, Sign in always pressable with field errors
  and a Caps Lock note. Structure, URLs and names unchanged.
- Checks: web build, e2e 60/60, smoke 10/10, Platform 77, Tasks 855 + tenancy 34, Assets 90, mobile 21.
- Founder decisions pending: see the "For the founder" lists at the end of each security doc.

### 19.22 New theme: trust blue + orange, full visual refresh (2026-10-12)
Founder: "Trust blue + orange" (palette from the ui-ux-pro-max skill for "B2B SaaS HR attendance workforce dashboard",
Plus Jakarta Sans), "Full refresh, same screens". Style: **flat, clean, data-dense SaaS** with soft low shadows; the
skill's glassmorphism suggestion was rejected (blur is slow on low-end phones). Nothing moved: same menus, screens,
order, features, URLs and every visible name/label/role the e2e tests use.

**Tokens** (`packages/theme/tokens.css` = `src/tokens.ts`; `src/tokens.native.ts` regenerated). Contrast measured
(WCAG ratio; "tint" = the colour as text on its own faint tint, as in badges, pills and the active menu item).

| Token | Light | Contrast (light) | Dark | Contrast (dark) |
|---|---|---|---|---|
| page / card | `#f8fafc` / `#ffffff` | | `#0b1220` / `#131c31` | |
| text | `#0f172a` | 17.9 card, 17.1 page | `#f1f5f9` | 15.5 card, 17.1 page |
| muted text | `#475569` | 7.6 card, 6.9 on muted `#f1f5f9` | `#94a3b8` | 6.6 card, 5.9 on muted |
| primary (buttons, links, active menu, focus) | `#2361e9` (= #2563EB, a hair deeper) | white label 5.3, 4.7 on 8 % tint | `#60a5fa` | navy label 7.4, 6.7 card, 5.5 on 12 % tint |
| secondary blue (`--brand-2`) | `#3b82f6` | decoration only | `#3b82f6` | decoration only |
| **CTA orange** (`--cta`) | `#d14400` + white | white label 4.6 (the skill's #EA580C is 3.6 with white) | `#f97316` + navy | navy label 6.7 |
| danger | `#cb1e20` | 5.6 card, 4.8 tint | `#f87171` | 6.1, 5.4 tint |
| success | `#047857` | 5.5, 4.8 tint (#059669 was 3.8) | `#34d399` | 8.8, 7.3 tint |
| warning (amber) | `#975d00` | 5.4, 4.7 tint | `#fbbf24` | 10.2, 8.4 tint |
| info (sky) | `#0469a1` | 5.9, 5.1 tint | `#38bdf8` | 7.9, 6.6 tint |
| Attendance accent (violet) | `#7c3aed` | 5.7, 4.9 tint | `#a78bfa` | 6.2, 5.3 tint |
| Tasks accent (blue) | `#2361e9` | 5.3, 4.6 tint | `#60a5fa` | 6.7, 5.6 tint |
| Assets accent (teal) | `#0f766e` | 5.5, 4.8 tint | `#2dd4bf` | 9.1, 7.5 tint |
| Admin accent (slate) | `#475569` | 7.6, 6.5 tint | `#94a3b8` | 6.6, 5.6 tint |
| sidebar | white, text `#334155` (10.4), active = primary on 8 % tint (4.7) | | deep navy `#080d19`, text `#cbd5e1` (13.1), active 6.5 | |
| border / field border / ring | `#e2e8f0` / `#cbd5e1` / primary | | `#243049` / `#334155` / primary | |

New token pair `--cta` / `--cta-foreground` (Tailwind `bg-cta text-cta-foreground`, button `variant="cta"`). Radius
`--radius` 12 px: 6 px tiny things, 8 px controls (buttons, fields, menus), 12 px every card/dialog (`rounded-lg` =
`rounded-xl` = `rounded-2xl`). Shadows: soft slate, three levels (`shadow-card`, `shadow-card-lg`, `shadow-pop`).

**Brand colour** (Settings) still replaces `--primary`; `lib/brand-colour.ts` now aims at the same contrast as the
default blues (5.3:1 on white, 6:1 on the dark cards) so brand text also stays readable on its own tint; `--brand-2` and
`--ring` keep the exact colour. The orange CTA stays orange with any brand colour. Checked with #29b7db (the demo
company's), #0f7b5f, #e11d48, #f59e0b, #7c3aed: no text under 4.5:1.

**What changed**
- Building blocks: buttons (primary flat blue, `cta` orange, outline/secondary/ghost hover to a blue tint, destructive,
  success; no gradients), fields 8 px with a blue focus border, labels medium weight, table headers on a muted band with
  muted uppercase text and a stronger row hover, badges/pills/chips with the tint levels above, tabs/segmented controls
  with one weight (no width jump), dialogs/sheets without backdrop blur, toasts (sonner) in theme colours light/dark,
  empty/error states as a round tinted icon + one line + next action, flat progress bars and loading lines.
- Frame: white sidebar with a blue active item (navy in dark mode), workspace groups with tinted icon chips; solid
  header and phone bottom bar (no blur), active tab = blue pill; logo mark flat blue; favicon and `theme-color` metas.
- Sign-in: the forest-green panel with glows became a flat blue panel (navy card in dark mode) (the small punch-card preview was taken off
  on 2026-10-13 at the founder's request); same form, labels and button.
- Home: flat cards without colour bars, tinted workspace chips, **Punch in / Punch out is the orange CTA**.
  Attendance → Today: flat header band; whichever punch is due (Check in or Check out) is orange, the other outlined.
- The single main action per screen is orange: Add person, Add task (My Tasks), Add lead, Apply for leave, New idea,
  Add link, New role, Add asset (header), Add employee, Raise ticket, New request, Add location/department/vendor.
- Sweep: every decorative glow, gradient fill, `brand-2` gradient, custom black shadow and hover lift in the screens is
  gone (flat tints instead); asset category colour names remapped to the new tokens (orange = CTA orange, teal = Assets
  teal…); faded text that was under 4.5:1 (calendar weekends, picker placeholders, zero counts, inactive people rows)
  fixed.
- Android shell: splash and adaptive-icon background colours in `apps/mobile/app.json` follow the tokens (`#f8fafc`,
  `#2563eb`, dark `#0b1220`); `palette.ts` already reads `tokens.native.ts`.

**What stayed**: Plus Jakarta Sans + IBM Plex Mono, 15 px desktop / 16 px phone base (16 px fields on phones), every
layout, menu, URL, name and label; lite mode (`[data-lite]` still strips shadows, blur, gradients, motion) and reduced
motion; the brand-colour override.

**Checked**: computed contrast of every visible text node (composited backgrounds) on 16 screens + account menu,
notifications, phone drawer and sign-in, 1440 and 375 px, light and dark: 0 under AA (70 page audits); 375/768/1024/1440
screenshots. Web build (rules + typecheck + build + SW check) green; mobile 21/21 + typecheck; smoke 10/10; e2e 60/60 (2026-10-13); Tasks 855.
Found on the way: staff search (Live/Daily/Dashboard/Reports) matched *any* typed word, so "E2E Import x" listed
every test person; now every word must be in the name (`hr/team.py`, test in `tests_team_views.py`).

### 19.23 Idea board and Web forms removed (2026-10-13)

The founder: "in task remove idea board and forms completely from every where". Both Tasks features are gone; **Intake**
(the AI inbox, `/tasks/intake`) is a different feature and stays, as do Groups, Notices and Links (they share the
`workspace` app with the old Idea board) and the lead source "Web".

**Removed**
- Web app: the screens `/tasks/ideas`, `/tasks/forms` (builder, fill, submissions) and the public share page `/f/:token`
  (`/tasks/f/:token`); the "Forms" and "Idea board" menu items; the group's "Ideas" tab. `packages/core`:
  `tasks/extras-ideas.ts`, `tasks/extras-forms.ts`; `access.ts` no longer maps `forms.`/`ideas.` to a module.
- Tasks API: the `webforms` app (out of `INSTALLED_APPS` and `config/urls.py`; the `public_form`/`public_submit`
  throttles), the Idea models/API in `workspace` (`/api/ideas/…`), the module switches `forms` and `ideas`
  (`tenancy/profile.py`), the anonymous `/api/public/*` company hint in `tenancy/middleware.py` (only the form page used it),
  and their entries in people delete, `reset_data`, `compress_media` and `move_files_to_s3`.
- Permissions: `forms.view`, `forms.build`, `forms.all`, `ideas.view`, `ideas.review`: **Tasks 52 → 47 permissions**; the
  group "Links & ideas" is now "Links". `CATALOGUE_VERSION` stays 2 (a new version would re-run the upgrade rules).
- Data: `workspace/0002_remove_idea_board` drops `workspace_idea`, `workspace_idea_votes`, `workspace_ideacomment`;
  `accounts/0022_remove_forms_and_ideas` drops the four `webforms_*` tables (an app taken out of `INSTALLED_APPS` keeps its
  tables otherwise), its `django_migrations` rows and content types, and roles' grants of the five permissions. Both run in
  `public` and every company schema (`migrate_companies`). Not reversible, on purpose.
- Import (`scripts/import-company.mjs`): the seven tables are skipped, so old ideas and forms are not carried over.
- Tests: the idea, form, public-form throttle and share-link tests; `e2e/web-links-ideas-payroll.spec.ts` →
  `web-links-payroll.spec.ts`, `e2e/web-mistakes-forms.spec.ts` → `web-mistakes.spec.ts`.

Kept on purpose: the delegation/workload counts still leave out old tasks whose description starts "Auto-created from
form" (history in existing databases).

**Checked**: Tasks 848 pass, 21 skipped (SQLite); tenancy on Postgres 32/32; `makemigrations --check` clean; applied to the
dev database (public + 4 company schemas: no `webforms_*` / `workspace_idea*` table left); Platform `company sync`
(Tasks catalogue 47, modules leads/intake/payroll/mistakes/links); web build green; e2e `web-links-payroll`,
`web-mistakes`, `web-tasks`, `web-tasks-general` 14/14.

### 19.24 Security decisions (2026-10-13)
Founder answers to the open items of §19.21 (details, rules and test names in `docs/security/{platform,tasks-api}.md`):
- **Give tasks to others** (`tasks.assign`) is enforced: without it a person gives tasks only to themselves (create,
  admin edit, approving a reassignment, directory templates, corrective tasks); assignee lists follow. Managers, HR
  Manager, Admin and Super Admin hold it by default.
- **Nobody changes their own attendance, salary or advances**, except the Owner (`accounts/access.py::is_owner` = holds
  `tasks.delete_admin_work`). Own rows in an attendance import are skipped with a message. Self-service (punch, request a
  correction, apply for leave) unchanged.
- **Manage roles gives only what you hold** (permissions, scopes, level); never Admin-level or Super Admin; nobody but the
  Owner raises their own access. Role editor disables what you lack ("You don't have this yourself").
- **Weak passwords: warned, never blocked** (founder: "weak passwords can also be set"); still 6 characters minimum.
  Checker `packages/core/src/admin/password-strength.ts` (common list, sequences, name/username/email/company).
- **No forced password change** at first sign-in (founder); Platform migration 0007 clears the old flag.
- **Payroll**: partly recovered advances are tracked (`Advance.recovered_amount`, payroll 0002); each payslip deducts
  only the remaining balance; finalised runs cannot be reopened.
- Not chosen now: one-time setup link, authenticator OTP, "sign out everywhere" screen. Live-server checklist (S3,
  enforced CSP, fixed app server address) comes with the AWS phase.
- Platform migration 0008 removes the old forms/ideas grants (§19.23).
- No sign-in lockout (founder, 2026-10-19): unlimited tries; only a per-network bot guard (1000 / 15 min); `LOGIN_MAX_FAILED` turns the lock back on.

### 19.25 Colours: indigo + emerald (light), graphite + lime (dark); phone layout (2026-10-13)
Founder: "use graphite and lime for dark mode and [indigo + emerald] for light mode"; "every company can set its colour of
choice also in these themes" (the brand colour keeps replacing `--primary` in both modes, `lib/brand-colour.ts`).
- Light: page `#f6f7fb`, cards/sidebar white, text `#1e1b4b`, muted `#4b5068` (7.9 card), primary indigo `#4f46e5` (white
  label 6.3, 5.6 on its tint), CTA emerald `#047857` (white 5.5), border `#e4e6f0`.
- Dark: page `#09090b`, cards `#18181b`, sidebar `#0f0f11`, text `#fafafa`, muted `#a1a1aa` (6.9 card), primary lime `#a3e635`
  (11.8 on card, near-black label 13.1), CTA green `#22c55e` + `#052e16` label (6.5), border `#27272a`.
- Workspace accents, status colours unchanged; every pair ≥ 4.5:1 (also on its own tint). `tokens.native.ts`, favicon,
  `theme-color` metas and the Android splash/icon colours follow.
- Phones (founder: "not smaller text, but more on screen with less scrolling"): text stays 16 px; under 640 px
  Tailwind `--spacing` is 0.22rem instead of 0.25rem (~12 % denser padding/gaps/heights). Duplicates removed on phones:
  the header ☰ (the bottom bar's More opens the same menu), the header light/dark button (in the account menu),
  "Keyboard shortcuts". Phone app: Android font-size setting enlarges text up to 130 % (WebView `textZoom`), so layouts
  never break. Checked 320/360/393 px light and dark on 9 screens: no sideways scrolling.

### 19.26 Hugeicons, no dots, no capsules (2026-10-13)
Founder: "use hugeicons for icon libraries, and everywhere I do not want these dots and these capsules".
- Icons: `@hugeicons/react` 1.1.10 + `@hugeicons/core-free-icons` 4.3.5 (the current packages behind the linked
  `hugeicons-react` repo); `apps/web/src/components/icons.tsx` exports the 213 icon names the screens used (208 Hugeicons,
  stroke 1.75, mapping table in the file); `lucide-react` removed. JS +111 KB raw / +24 KB gzip in total; the shared chunk
  carries all icons (per-icon files would let pages load only their own: optional follow-up).
- Status labels, badges, chips, counters: no leading dot; `rounded-sm` (6 px). Chips, tab groups, header page label, phone
  bottom-bar highlight: `rounded-md` (8 px). Where a dot was the only signal it became text, a small tag or an icon
  (calendar legend, late marker, Live, unread = "New"). Round stays for avatars, switches, radios, the bell count,
  icon buttons, progress bars, score rings; two chart legends keep small colour squares.
- Checked: web build; e2e 59/59; 28 screenshots desktop/phone, light/dark.

### 19.27 Uniform check at punch-in (2026-10-19)
Founder: "at the time of punch in should give a pop up notification that wear the company shirt or company jersey, and
the admin should have the option that at the time of punch-in it should ask for the company jersey".
- Two per-company HR settings (`CompanySetting`, edited on HR settings → "Uniform at punch-in", `hr.settings`):
  `UNIFORM_CHECK` = `off` (default, standalone too) | `remind` | `ask`, and `UNIFORM_MESSAGE` (≤ 200 chars; blank =
  "Are you wearing the company shirt / jersey today?"). Both are in `/api/hr/config/` and `/api/attendance/today/`.
- Before a check-in (Today and the Home card, also inside the phone app) a dialog with a shirt icon shows the message:
  `remind` → "OK, punch in" / "Cancel"; `ask` → "Yes, I'm wearing it" / "No" / "Cancel". It closes before location and
  the camera start. Check-out never asks. The punch is never blocked by "No". **Changed 2026-10-23 (§19.36): in `ask`
  ("Must confirm") No blocks the punch, and every check-in reads the rule fresh.**
- `ask`: check-in needs `uniform: true|false` (400 "Answer whether you are wearing the company shirt / jersey to punch
  in." without it); stored as `Attendance.uniform_ok` (nullable, migration hr 0007). Otherwise the field is ignored and
  stays empty. Shown on Daily attendance (a "Uniform" column Yes / No when the company asks or anyone answered), My
  attendance day detail, and the daily report (a "Uniform" column under the same rule).

### 19.28 Two built-in roles (Admin, Member) + per-person access (2026-10-19)
Founder: "there should be predefined only 2 roles, Member and Admin … in a specific role we can modify their access, so if I
want to make any member an admin in future I can do that; I can manually assign the access, roles and responsibilities
that I want to give to any user." And: "by default the roles and people list should be empty except the owner, so anyone
can create roles and responsibilities on their own" (the demo company is cleared too).

**Roles (Platform, the only role builder)**
- Every company has exactly two built-in roles, **Admin** (`ff_admin`, level 3) and **Member** (`ff_member`, level 1):
  permissions, scopes and duties are edited like any role (R1: Admin-level, so only the owner edits Admin); they keep their
  name and level and cannot be archived; Duplicate makes an ordinary copy. Roles made in the role builder work as before.
- Removed everywhere: Super Admin as a role, Tasks' 20 template roles (Sales, Purchase, Accounts, IT, Developer,
  Warehouse, Rider, Housekeeping, Security, Legal, HR Manager/Executive, the managers…), the Assets starter roles brought into
  the role builder (Admin/IT / Asset Manager/HR/Leadership/Manager/Employee "(Assets)"), and the "Copy from" entries for them.
  A new company (sign-up, `company -- create`, an import) gets Admin + Member only (`RolesService.importFromApps`), and
  only the owner in People.
- Starting permissions (real catalogue keys; a key the company's apps lack is skipped):
  - **Admin** = every permission of every app at its widest scope (Company where scoped) except the Owner-only ones
    (`tasks.delete_admin_work`, `insights:leadership`) and `billing.manage`: Tasks 46 + Assets 23 + Admin workspace 6.
  - **Member** = Tasks `tasks.view` @Own, `notifications.view`, `attendance.punch`, `attendance.self`, `leave.self`,
    `holidays.view`, `payroll.self`, `notices.view`, `links.view`; Assets `request:create`, `ticket:create` (everyone
    always sees their own assets/requests in Assets, §15.3). No `tasks.assign`: a Member gives tasks only to themselves.
- **Owner** is a mark on the person (`platform_role = owner`, company creator), not a role in the list: full access,
  cannot be removed, demoted or switched off by others (unchanged rules). The apps get it as a hidden role
  `ff_owner` "Owner (all access)" (`roles.kind = 'owner'`): every permission of every app, new ones included, held by
  exactly the owners (re-synced on every push). So Tasks' `is_owner` (= holds `tasks.delete_admin_work`), Assets'
  leadership page and R1 "the owner may give everything" work unchanged. Owners also hold Admin (sign-up gives Admin +
  the Owner mark); taking Admin away from an owner changes nothing (the Owner role stays). The old Super Admin row became
  the Owner role (migration `0010_two_roles`), so Tasks/Assets keep their link to it.
- **Access level follows the Admin role**: for non-owners `platform_role` is `admin` exactly when they hold Admin
  (`RolesService.syncLevels`). "Make Admin" / "Make Member" (`PUT /people/:id/level {level}`) swap Admin and Member and keep
  other roles; the Role / access level field on People does the same. Admin workspace permissions now come from roles only
  (owner: all); a company not yet in the role builder gives its admins everything but billing. Billing stays with the
  owner unless a role is given `billing.manage`.

**Per-person access (People → person → Change roles)**
- (a) roles as before, plus **Make Admin / Make Member**; (b) **Extra access**: individual permissions with scope on top
  of the roles, edited with the role editor's picker (shows "From their roles" next to what they already have); (c)
  **Responsibilities**: duties (same model and editor as role duties, §17.3) for this person only. (b)+(c) live in a
  hidden personal role (`roles.kind = 'personal'`, `person_id`, code `ff_person_<id>`): never listed, never given to
  anyone else, created on first use, deleted when emptied; pushed and checked by Tasks/Assets like any role (Tasks says
  "New responsibility: …" for its once-duties). R1: only what the caller holds; members (with Manage roles) act on members
  only; only an owner changes an owner; nobody but the owner gives themselves extra access. The dialog shows "From roles:
  Tasks n · Assets n · Admin n · Extra: …"; People shows "+ extra access".
- API: `GET /people/:id/access` → `{roleIds, owner, fromRoles, extra: {grants, duties}, adds}`;
  `PUT /people/:id/access/personal {grants, duties}`; `PUT /people/:id/level`. New people added on People get Member;
  invite links default to Member (Admin selectable); an invite without a role gives Member.

**Apps**
- Tasks: the neutral `Role.MEMBER` ("member", migration `accounts 0023`) is the role field of every Platform user
  (provision, and every push); behaviour comes only from the pushed roles' permissions. A full push archives this
  schema's own built-in roles (`platform_role_id` null), so a user without Platform roles gets nothing from a role name.
  The role list (`/api/roles/`) and `role`/`role_display` show the Platform roles (hidden ones excluded); "My team" no
  longer edits a role and decides "manager" by level, not by the Sales Manager name. Standalone installs (flags off) keep
  their 20 roles exactly as before (CLAUDE.md rule).
- Assets: a full push archives its own starter roles; the separate Assets "Roles & permissions" page is gone
  (`/assets/settings/roles` → Admin → Roles).

**Existing companies (dev data, 2026-10-19)**: `companies.roles_model` (1 = old) — converted once by
`RolesService.ensureUpgraded` (run by `company -- sync`): template roles archived; holders of an Admin-level template (or
Super Admin, or access level admin) → Admin, other holders → Member; roles made in the role builder kept. Result: 11
companies, 20–26 template roles archived each; DEMO 57 → Member, 1 → Admin (before its reset); REHEARSAL 2 → Admin,
13 → Member; the others 1–2 → Admin. Then **DEMO reset to the owner only**: `npm --prefix services/platform run company
-- reset --code DEMO --keep-owner` (local databases only; refused elsewhere): 596 people deleted with all their records
through the apps' "delete everything" path, 34 unlinked Tasks users (old "Deleted user" rows) deleted
(`DELETE /api/internal/unlinked-people`), 7 other roles archived, Admin/Member back to defaults, invites removed; the dev
staff account keeps its DEMO membership without roles or apps (owner console). Smoke and e2e add people to DEMO again: rerun the reset afterwards (done once more after the test runs: 27 people). Company settings, departments, the asset
catalogue, assets (back in stock), leave types, locations and HR rules stay.

**CarTrends import**: `scripts/import-company.mjs` marks only Tasks Super Admin / Admin as admins (an Assets-only
"Admin" no longer becomes a company admin); the next `company -- sync [--code X]` gives Admin to admins/owner and Member
to everyone else **plus a personal role with exactly what their old app roles gave beyond Member** (nobody loses access).
Rehearsal (`npm run rehearse-import`, now also runs that sync and checks it): 2 Admin, 13 Member, 11 with extra access.
Note: Member includes Assets requests/tickets, so Tasks-only people also open Assets after the sync (seats count them).

**Checks**
| Check | Result |
|---|---|
| Platform | 106 pass (new/changed: Admin + Member only with their defaults, built-ins not deletable/renamable, Make Admin / Make Member and the access level, personal extra access + duty pushed and R1-limited, Owner role hidden and never locked out, conversion of the Owner role) |
| Tasks (SQLite) | 858 pass, 21 skipped (new `TwoBuiltInRolesTests`: local roles archived and role names mean nothing, Member + personal extra access, owner through the Owner role, a personal duty becomes that person's task) |
| Tasks tenancy (Postgres) | 32 pass |
| Assets | 91 pass (push archives its own starter roles) |
| Web | rules + typecheck + build clean |
| Smoke | 10 / 10 (member now gets a role made in the role builder) |
| e2e | 63 / 63: full run 60 pass; the 2 web-hr failures (test helpers picked "any level-1 Tasks role", now the built-in Member; same fix in 4 other specs) and 1 Settings module-switch flake pass when rerun (15 / 15 for the touched specs). New: `web-admin` "People: Make Admin / Make Member, and extra access + a responsibility for one person" |


### 19.29 UI alignment + mobile pass (2026-10-20)
Founder: "make the overall UI aligned across the complete project and make it best for the mobile application" (the
Android app = this web app in a WebView, §19.17, so phones 320–412 px are the target).
- **One set of "pick one" controls** (`components/common/controls.tsx`): `TabBar` (page sections: underline tabs, links
  or buttons, scrolls sideways and keeps the open one in view), `Segmented` (2–5 views of one list; the two copies in
  Tasks now re-export it) and filter chips (`ChipRow`/`FilterChip`, `chipClass`). Attendance's section bar became the
  same underline tabs as Tasks; Assets' status chips (assets, employees, exits, joiners, requests, tickets, maintenance,
  reconciliation), Tasks reports, Leadership periods, Priority queue kinds, the employees "Details / Phones & emails"
  switch, the requests switcher and the billing period now share these looks (8 px radius, no capsules).
- **Page structure**: `PAGE_TITLE` / `DETAIL_TITLE` (26/28 px bold; 22/26 px for a person's or asset's name; wraps
  instead of truncating) for every in-app title incl. Home, Tasks home, Assets dashboard and the detail pages (the
  joiner page got its missing h1); `BACK_LINK` for "← Assets / Employees / Exits / All checks / New joiners" above
  detail pages. Each screen's one main create action is the CTA (Add user, Asset type, New joiner, Log maintenance,
  New group, New notice, Log mistake, Write a process, New template).
- **Phones**: tap targets in rem, not spacing steps (under 640 px `--spacing` is 0.22rem, which made `h-10` 35 px):
  buttons/fields/selects 44 px, small buttons and chips 40 px, tabs 44 px, menu rows 44 px; leftovers fixed (catalog
  tree, dashboard links, filter-chip Clear, picker Clear, colour field). Dialogs are **bottom sheets** on phones (full
  width, never taller than the screen, body scrolls, `DialogFooter` sticks to the bottom above the safe area with
  full-width buttons); slide-over sheets keep room for the close button and stretch their footer buttons. Mobile
  numbers are `type="tel"`. Results (temporary Playwright pass, every route + detail pages, light and dark): sideways
  scroll 0 at 320/360/390/412 (also 0 before), touch targets under 40 px on 390 px 531 → 57 (left: inline text links,
  checkboxes/switches whose tap area is widened by a pseudo-element), no console errors; 24 dialogs/sheets opened at
  390 px all fit. Desktop unchanged apart from the shared looks.

| Check | Result |
|---|---|
| Web | rules + typecheck + build clean |
| Smoke | 10 / 10 |
| e2e | 74 / 74: full run 62 pass; 11 failures came from the running suite (a Tasks migration added by parallel backend work was not yet applied, then API restarts → 502) and pass when rerun; `settings.spec` "photo at check-in" now answers the uniform question (§19.27) |

### 19.30 Tasks updates ported from the original app (2026-10-20)
Founder: bring the original app's changes since the copy (`bc785fe`, branch `feature/delegated-dashboard-whatsapp`, up
to `2bc1425`) into FreeFounders, adapted to its design, and "remove the previous features that are being replaced by
them". The original stays read-only. "Super Admin" there = the **Owner** here (`accounts.access.is_owner`, i.e. holds
`tasks.delete_admin_work`, the hidden Owner role §19.28); "admin" = `tasks.view_all` at company scope. **No new
permission keys** (CATALOGUE_VERSION stays 2).

| Original | Here |
|---|---|
| `9d3050b` + `52ba930` Notices on WhatsApp (not in the copy) | `send_whatsapp`: GET also lists `missing` (people it can reach who never got it: joined, reactivated, skipped); POST `{only_missing: true}` sends only to them; sends record `/notices?n=<id>`; one person's failure is recorded for them and the rest still go; default template **`notice_posted`** (Utility, {{1}} name, {{2}} title; `company_notice` still works when named in `NOTICE_WHATSAPP_TEMPLATE`). Notices → "Send on WhatsApp" offers "Send to the N who missed it" (or "Send again to everyone"). |
| `3fbf6e7` Only a Super Admin gives a task to a Super Admin | **Only the Owner gives a task to the Owner** (themselves included), on top of §19.24 `tasks.assign`: create, admin edit, a change request proposing the Owner (400), approving such a request, directory templates, corrective tasks. The Assign-to pickers (`/tasks/assignees/`) hide Owners from everyone but Owners. Message "Only the Owner can give a task to the Owner." |
| `13fbf98` Delegated: a picked agent shows only that agent | Delegated tab: with an agent picked, the per-agent panel shows only their row ("Show all" hidden); Clear brings everyone back. |
| `3903b4b` Lists: open, then overdue, then done | My Tasks / All / Delegated / Subscribed: open work first, then overdue, then done (server order kept inside each group). |
| `6ec1bc6` Deleting a task you were given needs the giver's approval | `can_delete_task`: the Owner deletes anything; the **giver** may take back what they gave (an admin's work too); the **receiver never** deletes directly, admins included; a third admin still cannot touch work given to an admin. A cancel request goes to the giver (the Owners when the giver has left or is the one asking); only they or an Owner decide it (other admins no longer see it in their inbox). Approved → Deleted bin, and every **Owner** is told (`task_deleted_on_request`, in-app + email). Web: the edit/request dialog sends "Send delete request" with a reason instead of deleting. **Removed**: the old route of admins' cancels on admin work to the Super Admin inbox, and the dialog's direct delete for a task someone gave you. |
| `88484c3` (reverted by `442fe3e`) | Skipped. |
| `d40034c` WhatsApp 10 AM–7 PM, remind givers, no self-accept | WhatsApp only inside the **company's hours** (`WHATSAPP_HOURS`, CompanySetting, default `10-19`; env default; `0-24` under tests): outside them in-app + email go at once, the WhatsApp is **held** (`Notification.wa_deferred`, migration `notifications 0003`) and sent by the worker at the opening (dropped after 3 days); the 2-hourly overdue pings are **skipped** instead. Morning digest waits for the opening, day-end digest at 6 PM (`DAY_END_DIGEST_HOUR` default 18). Task settings → **WhatsApp hours** (From / Until; `GET/PUT /api/whatsapp-hours/`, `tasks.settings`). Finished work waiting: **one grouped reminder per giver** ("N finished tasks are waiting for you to accept", `task_completion_reminder`, WhatsApp template `task_completion_review` for non-admins) after `APPROVAL_REMIND_HOURS` (§17.2), then **daily** while it waits; this **replaces** the one-off per-completion `approval_reminder` (the 2× escalation to admins stays). **Nobody accepts or sends back their own work** (admins too; bulk accept skips it). To accept → My submissions: "Sent for approval · waiting for <giver>" (`approver_detail`), no Accept/Send back on own rows. |
| `3ff22ba` A task someone gave you is changed through them | `edits_need_giver` (on every task): a task someone else (still active) gave me → any change but the status is a request to the giver, admins and Owners included (direct PATCH 403 with the giver's name; `request_change` allowed for admins then). Web: "Request change" / "Change" instead of "Edit" on such tasks; the dialog says "given to you by …". Tasks an admin gave out still edit directly. |
| `d0a1bdf` Voice draft replaces AI draft; red tab counts | **Voice draft**: `voice_draft` takes `{transcript}` (words from the browser/phone; no AI key) or an audio clip (Gemini key); without AI, `speech_rules` reads the person, deadline ("kal 5 baje", "in 2 hours", weekdays, Hindi/Hinglish), effort ("30 minute") and tidies the title. Web `voice-note.tsx`: language English/हिंदी, browser speech recognition on https/localhost, else the keyboard-mic box. **Removed**: the "AI draft" button/box, `POST /tasks/ai_draft/`, `useAiTaskDraft`, the browser audio recording (MediaRecorder) path of the old "Speak the task" (the server still accepts audio). Red round counts (1–9, 9+, 99+) on **My Tasks** (open + in progress), **To accept**, **Requests** (and "More" on phones); `countLabel` in core. |
| `ed023cf` Voice draft asks for the microphone | Browser: asks for the microphone first; blocked → steps for this browser (Chrome on Android, Safari on iPhone, desktop), "Try again", "Use the keyboard mic instead"; keyboard-mic help. The partsexpressonline link was not ported (a note says the http:// address never gets the microphone). |
| `ba5c94e` App v3: native voice with the mic pop-up | Phone app **1.1.0** (versionCode 2): bridge request **`voice` {lang}** → `{text}` and **`voice-stop`** (Done), `apps/mobile/src/lib/voice.ts` with **expo-speech-recognition** 57.1 (the phone's speech recogniser; Android's "Allow FreeFounders to record audio?" pop-up; blocked twice → `code: permission, permission: microphone, settings: true` → web shows "Open settings" + "Try again"; no speech service / Expo Go → `code: unavailable` → keyboard-mic box). `app.json`: `RECORD_AUDIO` moved from `blockedPermissions` to `permissions`, plugin config (Google speech service package visibility), iOS usage texts. Nothing is recorded or kept. **Needs a new APK build** (`eas build -p android --profile preview`). |
| `0980b4d` Startup prompt to update older apps | Platform `GET /api/platform/app-version` (public) → `{minVersion, apkUrl}` from `MOBILE_MIN_VERSION` (default `1.1.0`; empty = off) and `MOBILE_APK_URL` (default `/download/kaampilot.apk` = `apps/web/public/download/kaampilot.apk`, git-ignored; or a full https:// address). Inside the app, an older version gets "Update the app — one time" (Later = this session); "Update now" opens the APK in a new window, which the shell always hands to the phone's browser (works in 1.0.0 too). The Voice draft in an old app offers the same link. |
| `748b527` Remove a wrong or outdated file | `POST /tasks/{id}/remove_file/ {id}`: the uploader while the task is open, the giver, or an admin (after Done only the giver/admin); logged "Removed file: …". Web: an × on each attachment in the task panel (with a confirmation). |
| `2bc1425` Team Performance: who asks most to change a due date | `GET /tasks/change_request_leaders/?range=` (Team performance permission, same audience as `team_report`): people ranked by requests that move a due date (counted on the day raised), approved / rejected / waiting, tasks, approval rate, latest 20 requests each. Web: a panel on Team performance under the ranking; open a person for their requests. |
| `13fd6e2` WIP weekly overdue email | Skipped (FreeFounders already has the Monday overdue email, `send_weekly_overdue_email`). |
| Older ones (before the copy) | Checked in the new web app, all present: proof files in To accept (`2387ca3`), bulk accept (`009f6f0`), "Tasks I've delegated" on Home + WhatsApp reminders for requests (`8a7b0cb`), Tasks given & received (admins everyone, others their own, click a person; `f6d9cf4`/`287e5b2`/`06b659c`), Delegated per-agent counts (`cb8ffd6`), My team Delete confirmation (`6d7d102`), dashboard insights (`f63f1e0`). Not ported: anything about the old frontend serving / APK hosting on the old server. |

Docs: `docs/UI-FUNCTIONALITY.md` (Voice draft), `services/tasks/README.md` (endpoints), `.env.example` (Tasks
`WHATSAPP_HOURS`, `NOTICE_WHATSAPP_TEMPLATE`; Platform `MOBILE_MIN_VERSION`, `MOBILE_APK_URL`), CLAUDE.md (ported up to
`2bc1425`), `apps/mobile/README.md` (voice bridge).

**For the founder**: (1) build and install the new APK (1.1.0) and put it at `apps/web/public/download/kaampilot.apk`
(or set `MOBILE_APK_URL`) so 1.0.0 phones get the update prompt; (2) Meta templates `notice_posted` (Utility) and
`task_completion_review` must be approved for the company's WhatsApp number; (3) the first "please accept" reminder now
follows `APPROVAL_REMIND_HOURS` (24 h by default; the original used 3 h) and repeats daily.

| Check | Result |
|---|---|
| Tasks (SQLite) | 900 pass, 21 skipped (new `crm/tests_ported_2026_10.py`: Owner-only assigning, delete by request, WhatsApp hours + held/skipped/dropped + settings endpoint, grouped daily accept reminders, no self-accept, changes through the giver, voice transcript rules, remove file, due-date change leaders; notice WhatsApp only-missing + one failure; `DeleteRulesTests` updated as in the original) |
| Tasks tenancy (Postgres) | 32 pass; dev DB migrated (`migrate_companies`, 36 companies) |
| Platform | 113 pass (new: app-version) |
| Core | 11 pass (new: app version compare) |
| Mobile | typecheck + 22 tests (new: voice / voice-stop protocol), `expo export` android OK, expo-doctor 21/21 |
| Web | rules + typecheck + build clean |
| Smoke | 10 / 10 |
| e2e | 78 / 78 in one full run (new `web-tasks-ported` 2: an admin receiver changes and deletes only through the giver, red tab counts, Owner-only assigning, Team performance panels + WhatsApp hours; `web-app-shell` +2: Voice draft through the app bridge, the update prompt for an older app). Then DEMO reset to the owner (`company -- reset --code DEMO --keep-owner`) |

### 19.31 Downloads everywhere (2026-10-22)
Founder: "I want all the payslips and everything downloadable in each and every section according to their given filters."
- **One control**: `components/common/download-menu.tsx` — `DownloadMenu` (outline button, Download icon + "Download" + chevron;
  menu "Download as" Excel (.xlsx) / CSV / PDF / ZIP plus extra entries) in the page header actions or the section's own
  header; disabled with the tooltip "Nothing to download for these filters" when 0 rows match; still works in a read-only
  company (it is not a CTA); 40–44 px on phones. `DownloadButton` = one file (a payslip / invoice PDF). In the phone app
  the file goes through the native bridge (`saveFile`).
- **All matching rows, not the page**: the screen passes an `ExportTarget` (`@freefounders/core/export`: API, list path,
  the screen's own filters/search/sort/tab/date range; page size dropped). The API answers `?export=xlsx|csv` with every
  matching row (≤ 50 000) from the list's own query and permission checks:
  Tasks `config/exports.py` `ExportMixin` (DRF lists; `export_columns`), `export_file` for function views;
  Assets `@Exportable({name, columns})` + global `ExportInterceptor`, `listParams` gives page 1 / 50 000 rows when exporting;
  Platform `common/export.ts`. Client-side files (`toXlsx`/`toCsv`, no library) only where the screen already holds every
  row (reports computed in the browser, catalogue, roles matrix…). Area targets: `tasksExports`, `hrExports`,
  `payrollExports`, `assetsExports`, `adminExports`, `billingExports`.
- **Formula injection** neutralised in every writer (cell starting with = + - @ tab CR → leading apostrophe). The minimal
  xlsx/zip writer is `packages/core/src/export/sheet.ts`, copied byte-for-byte to `services/assets/.../common/sheet.ts`
  and `services/platform/src/common/sheet.ts` (keep the three the same).
- **File names**: `<area>-<screen>-<filters>-<YYYY-MM-DD>.<ext>` (e.g. `assets-assets-sim-card-available-2026-10-22.xlsx`,
  `admin-people-a-2026-10-22.csv`, `payslip-2026-09-rahul-verma.pdf`, `payslips-2026-09.zip`, `invoice-<number>.pdf`).
- **Payslip PDF** (Tasks, `payroll/pdf.py`, reportlab 4.4.4 — the only new library, pure Python): A4, company name + logo
  (the Platform's public brand logo, fetched once per 10 min, skipped if unreachable), employee name / ID / username /
  designation / department / reports-to, pay period, status (DRAFT marked), attendance strip (working, paid, present,
  half, paid leave, LWP), earnings (monthly gross, per-day rate, earned) and deductions (PF, professional tax, advance
  recovery, other) with totals, net pay in figures and words (Indian: lakh/crore, "Rupees … and … Paise Only"), ₹ drawn
  as a vector glyph (not in Helvetica), advance still outstanding. Endpoints: `GET /payslips/:id/pdf/` (same queryset as
  viewing: own finalised payslips with `payroll.self`, everyone's with `payroll.run`; own-records rule unchanged) and
  `GET /payroll-runs/:id/payslips_pdf/?bundle=zip|pdf` (`payroll.run`). Invoice PDF (Platform): a small hand-written PDF
  writer (`services/platform/src/common/pdf.ts`, Helvetica, ₹ as a glyph), same check as viewing the invoice.

| Screen | Formats | Built |
|---|---|---|
| Attendance: My attendance (month, also a person's month) | xlsx, csv | server `/attendance/monthly/` |
| Attendance: My leave | xlsx, csv | server `/leaves/` |
| Attendance: Holidays | xlsx, csv | client (whole list loaded) |
| Attendance: Live / Daily (date, department, tile, search) | xlsx, csv | server `/attendance/team_day/` |
| Attendance: Dashboard (month, department, search, sort) | xlsx, csv + monthly summary report | server `/attendance/team_month/`, `/attendance/report/` |
| Attendance: Reports | xlsx, csv | server (unchanged form) |
| Attendance: Approvals (pending leave, pending corrections) | xlsx, csv | server `/leaves/`, `/attendance-corrections/` |
| Attendance: My salary (payslips list; each payslip) | xlsx, csv; pdf | server `/payslips/?status=finalised`; `/payslips/:id/pdf/` |
| Attendance: Payroll runs; a run (sheet, each payslip, all payslips) | xlsx, csv; pdf; zip / one pdf | server `/payroll-runs/`, `/:id/export/`, `/payslips/:id/pdf/`, `/:id/payslips_pdf/` |
| Attendance: Salaries, Advances | xlsx, csv | server `/salary-structures/`, `/advances/` |
| Tasks: My Tasks, Delegated, Subscribed, All tasks, Deleted | xlsx, csv | server `/tasks/` (same `workListQuery` as the list) |
| Tasks: To accept, Requests | xlsx, csv | server `/task-completions/`, `/task-change-requests/` |
| Tasks: Disputes, Reports (8), Time report, Team performance, SOPs | xlsx, csv | client (all rows loaded) |
| Tasks: Activities, Templates, Groups, Notices, Notifications, Leads, AI inbox, Mistakes, Links | xlsx, csv | server (each list endpoint) |
| Assets: assets / my assets / SIMs, employees, exits, new joiners, requests, tickets, maintenance, activity log, users, companies/departments/locations/vendors | xlsx, csv | server (`@Exportable` list routes) |
| Assets: catalogue, reconciliation checks + one check, priority queue | xlsx, csv | client (all rows loaded) |
| Admin: People (search) | xlsx, csv | server `/people?export=` |
| Admin: Roles (permission matrix) | xlsx, csv | client |
| Billing: invoices list; each invoice | xlsx, csv; pdf | server `/billing/invoices`, `/billing/invoices/:id/pdf` |
| Owner console: companies | xlsx, csv | client (loaded list, search applied) |

Not covered: Tasks Dashboard tab and Template Directory, Assets Dashboard / Leadership (no tables; small summaries),
lists inside detail pages (an asset's / employee's history), Owner console audit (no screen). Task files keep the server's
order (newest first) rather than the screen's open → overdue → done grouping (same rows).

| Check | Result |
|---|---|
| Tasks | full suite 938 run: all new tests pass (payroll `tests_pdf` 9, `crm/tests_exports` 12, `hr/tests_exports` 7); 1 failure `accounts.tests_security…test_stretching_a_pending_leave_recounts_its_days` comes from the parallel leave-balance work in `hr/services.py`, not from downloads |
| Assets | typecheck + 95 / 95 (new "downloads" block) |
| Platform | typecheck + 150 / 150 (People / invoices exports, invoice PDF) |
| Web | rules + typecheck + build clean |
| Smoke | 10 / 10 |
| e2e | new `web-downloads` 4 / 4 (People search → xlsx + csv row count = API, Assets search → csv rows = header count, Groups csv = API, 390 px menu); `web-links-payroll` 2 / 2 (run row "Download <month>" → CSV, disabled for a run without payslips), `web-tasks-general` (Download enabled on Team performance) pass. The other touched-screen specs failed only on timeouts / page skeletons while parallel work restarted the suite and reloaded Vite; the ones retried alone pass (Assets request + ticket, Live team, HR settings). DEMO reset afterwards (`company -- reset --code DEMO --keep-owner`) |

### 19.32 Punch-in reminder (2026-10-22)
Founder: "add an alert module so every person can set an alert for punch-in, so that if they forget, the phone vibrates
or rings — on phones only." Built as **local notifications scheduled on the phone** (no server push, no server change):
they ring or vibrate even when the app is closed.

| Part | What |
|---|---|
| Native module | **expo-notifications** 57.0.23 (`npx expo install`, SDK 57). Plugin: notification icon `assets/images/notification-icon.png` (white, from the monochrome icon), colour `#4f46e5`. Lazy-loaded like voice. |
| Android channels | `punch-reminders` "Punch-in reminders" (sound + vibration), `punch-reminders-ring` (sound only), `punch-reminders-vibrate` (vibration only): high importance (heads-up), shown on the lock screen, vibration pattern 0-600-300-600-300-900. A channel's sound/vibration cannot change after creation, so each alert type has its own. |
| Permissions | `POST_NOTIFICATIONS` (Android 13+; Android's pop-up when the person switches the reminder on or sends a test; blocked → `code: permission, permission: notifications, settings: true` → web "Open settings"), `RECEIVE_BOOT_COMPLETED` (added by the library), `SCHEDULE_EXACT_ALARM` declared (no pop-up; see accuracy). Not `USE_EXACT_ALARM`. |
| Bridge (`protocol.ts`) | `reminder-set {settings: {enabled, time 'HH:MM', days [1–7, 1 = Mon], mode 'vibrate' \| 'ring' \| 'ring-vibrate', followUpMinutes (default 10, 0 = off, max 120)}}`, `reminder-get`, `reminder-skip-today`, `reminder-off` → `{settings, permission, next, skipped}`; `reminder-test {mode}` → one reminder in 5 s. The shell reports `capabilities` (`…, 'reminders'`) in `window.FreeFoundersApp`; the web shows the reminder only when listed. |
| Plan (`reminder-plan.ts`, pure, tested) | One **weekly** notification per chosen day at the time, plus the follow-up (a follow-up past midnight rings the next weekday). **Skip today** (a weekly repeat cannot skip one week): the reminders of the skipped day — and a follow-up of the day before that rings after midnight on it — become one-off notifications for the next 4 weeks; the plan is rebuilt at every app start, so after that day it is weekly again. A skip whose reminders already rang changes nothing. |
| Storage | Settings + skipped date on the phone (expo-secure-store `ff.punchReminder`), per person per phone. **Not saved on the server** (a new phone starts from the company defaults): the defaults already come from the server, and a per-user setting in Platform/Tasks plus sync was not worth it now. |
| Tap | Opens the app on `/attendance` (Today): cold start via `getLastNotificationResponse`, running app via the response listener. A reminder that arrives while the app is open still pops up and rings. |
| Web | `features/hr/reminder.tsx`: a "Punch-in reminder" card on **Attendance → Today** (people who may punch) and on **`/attendance/reminder`** (account menu → "Punch-in reminder", in the app only). Switch (on = saved at once, Android's pop-up), time (default **10 min before the company's office start**), weekday buttons (default the company's **working days** = not HR week-offs), Alert: Vibrate / Ring / Ring + vibrate, "Remind again after 10 min if I haven't punched in", **Save reminder**, **Send a test reminder now**, "Next reminder: …". Browser: nothing on Today, a note on the page; an app from before 1.2.0: "need the latest app". A successful check-in in the app sends `reminder-skip-today` (`punch.tsx`), and so does opening Today/Home when today's check-in already exists (checked in on a computer); turning the reminder on after checking in skips today too. The update prompt now mentions reminders. |

**Accuracy and limits** (checked in expo-notifications 57.0.23 source, `ExpoSchedulingDelegate.kt`): it uses
`setExactAndAllowWhileIdle` when Android allows exact alarms for the app, else `setAndAllowWhileIdle`. With
`SCHEDULE_EXACT_ALARM` declared that is **exact on Android 12–13** (granted at install) and on Android 14+ **only if the
person allows "Alarms & reminders"** in the app's settings (off by default); otherwise Android may ring **a few minutes
late** (Doze, battery saver; Android only promises inexact alarms within its batching window). **Ringing = the
notification sound** (and Do Not Disturb silences it), not a full-screen alarm clock. **Reboot**: scheduled reminders are
kept by expo-notifications (stored in the app's preferences and re-registered on `BOOT_COMPLETED` / `REBOOT` /
`QUICKBOOT_POWERON` / `MY_PACKAGE_REPLACED`), so they survive a restart and an app update; a **force stop** (or some
phone makers' "deep sleep" battery modes) cancels them until the app is opened again. The person can mute a channel in
Android's settings. Expo Go (testing): local notifications work there too.

**Needs a new APK**: app **1.2.0**, versionCode **3** (new native module). Build it (`eas build -p android --profile
preview`), put it at `apps/web/public/download/kaampilot.apk` (or `MOBILE_APK_URL`), then set
`MOBILE_MIN_VERSION=1.2.0` so older apps get the update prompt (not changed here: the default stays 1.1.0 until the APK
exists).

| Check | Result |
|---|---|
| Mobile | typecheck + 32 tests (new `test/reminder-plan.test.ts`: settings, weekday numbering, weekly plan + follow-up, skip today, skip across midnight, next reminder, bridge requests); `expo export --platform android` OK; expo-doctor 21/21 (expo 57.0.31, expo-location, expo-router, expo-sharing patch-updated by `expo install --fix`) |
| Web | `npm run web:build` (rules + typecheck + build) |
| e2e | `web-app-shell` 6 / 6 (new: card only in an app with `reminders`, note in a browser and in an old app, defaults, saving sends `reminder-set`, test reminder, account menu page, check-in sends `reminder-skip-today`) |

### 19.33 Leave balance enforced; "Selfie optional" really optional in the browser (2026-10-23)

- **Leave balance** (Tasks `hr/services.py` `leave_allowance / leave_taken / leave_balance_check`): a type has a balance when
  it is paid with a quota > 0 (the year of the start date) or comp-off (the CompOff days banked, all time); unpaid (LWP) and
  quota-0 types stay unlimited. Pending + approved count, rejected / cancelled do not, a **half day** (new
  `LeaveRequest.half_day`, one date only) counts 0.5. Applying or editing beyond it → 400 "You have N day(s) of <type> left;
  this request needs M." HR with **Approve leave** for that person can mark leave for someone (`POST /leaves/ {user, …}`,
  approved at once, attendance updated) and approve a pending request beyond the balance only with `beyond_balance: true`,
  logged on the request (`beyond_balance`, `_by`, `_at`; migration `hr 0008`). `GET /leaves/balances/` adds `limited` and
  `available`; pending requests carry `balance_check`. Web: the apply form shows "N days left" next to each type, a Half
  day box for one date and the error inline; Approvals shows a warning and **Approve beyond balance** instead of Approve.
  Not done: a web screen for HR to mark leave for someone (API only); payroll still counts a half-day leave day from the
  attendance row (no extra 0.5 paid).
- **Selfie optional**: with the HR setting "optional" the browser camera step has **Skip photo** (also when the camera
  cannot start) and the punch goes without a photo; "required" has no skip (the phone app already allowed skipping).
- Tests: Tasks 938 (new `hr/tests_leave_balance.py` 9 + optional-photo punch; `tests_security` leave type given a quota for
  its 30-day stretch); e2e `settings.spec.ts` optional → Skip photo checks in, required → no Skip; `web-hr` leave test reads
  "(10 days left)".

---

### 19.34 Asset photos (2026-10-23)
Founder: "after adding the asset, an option to add photos of that asset too."
- **Storage**: the asset's own photos are the `allocation_photos` rows with `kind = 'ASSET'` and no allocation (as
  §19.20 already stored them: bytea in the company schema, shrunk by `photo-shrink.ts`, EXIF dropped; S3 later per §20).
  Migration `0022_asset_photo_captions` (every company schema via `migrate.js`) adds `caption text` and
  `sort_order integer not null default 0`. No second table: existing photos stay where they are.
- **API** (Assets, all under the asset's own view check, company-scoped by the schema):
  `POST /api/assets/:id/photos` (multipart `kind=ASSET`, `photos[]`, optional `caption` for the first one) now caps the
  asset at **6 photos in total** (400 "at most 6 photos: n more can be added"); `GET /api/assets/:id/photos` (in order);
  `PATCH /api/assets/:id/photos/:photoId` `{caption?, sortOrder?}` (position 0 = first = the thumbnail; others shift);
  `DELETE /api/assets/:id/photos/:photoId` (history `ASSET_PHOTO_REMOVED`; an old on-disk file is unlinked).
  Add / change / delete need `asset:create` or `asset:edit`; viewing = whoever may view the asset. Handover and return
  photos are part of the assignment record: PATCH / DELETE on them is 403. Captions: one line, control characters
  dropped, ≤ 120 chars, rendered as text (the sheet export already neutralises a leading `= + - @`). The list payload
  carries `photoId` (first photo) for thumbnails; the detail payload's `photos` is ordered by `sortOrder`.
  Person delete and the Platform reset leave asset photos with the asset (`uploaded_by` → null, name copy as before).
- **Web** (`features/assets/components/photos.tsx`; hooks `useAssetPhotos`, `useAddAssetPhoto`, `useDeleteAssetPhoto`,
  `useUpdateAssetPhoto` in `packages/core/src/assets/photos.ts`, invalidating the asset queries):
  - After **Add asset** succeeds with no photos picked in the form, the dialog **"Add photos of this asset"** opens over
    the sheet: **Take photo** · **Choose from gallery** · **Skip**; thumbnails with remove; a caption for the first photo;
    "Save n photos" uploads them, then the asset page opens. Take photo = the phone's **back camera through the bridge**
    in the app (`photo` request gained `facing: 'back'`; older apps open the front camera), `capture="environment"` in a
    browser. Photos are shrunk in the browser first (`compress-image.ts`, preset `photo`).
  - **Asset page**: a "Photos (n)" card with larger thumbnails, the full-size viewer (caption as title, previous / next,
    Download, **Delete** with confirmation for `asset:edit`), "Add photo" and "n of 6" (disabled at 6).
  - **Edit asset**: the same gallery (delete, Add photo) plus the picker for more photos uploaded on Save.
  - **Assets list**: the first photo replaces the type icon in the table row and the card (36 / 48 px).
- **Tests**: Assets integration (caption cleaning, cap of 6 counting saved photos, order, PATCH, DELETE by permission,
  404 for someone who cannot see the asset, handover photos untouchable, history), tenancy (a photo and its ids mean
  nothing in another company), mobile protocol (`facing`), e2e `web-assets.spec.ts` (add from the asset page, see it,
  delete it).

### 19.35 Brand: Kaampilot (2026-10-23)
Founder: "make the name everywhere of the application Kaampilot.com, and make the front page more interesting with a
logo — design it yourself", then "remove the FreeFounders everywhere". (Asked for as §19.33; that number was taken.)
- **Name**: everything a person sees or receives says **Kaampilot** (the address **kaampilot.com** in the logo lockup on
  the public pages). Changed: page titles (`Kaampilot · <page>`), `index.html` title/description, the new
  `manifest.webmanifest` (name, short_name, icons; `display: browser`, so "Add to Home screen" behaves as before), the
  sidebar/header logo, sign-in / sign-up / forgot / join / new-company pages, FakePay ("Kaampilot · Secure payment",
  "Back to Kaampilot"), invoices (seller default **"Kaampilot (test)"**, `SELLER_NAME` still overrides; PDF producer),
  Razorpay plan names, owner console ("Kaampilot staff"), update prompt, reminders, checklist, invite/WhatsApp texts,
  API messages (Platform "no Kaampilot account", "contact Kaampilot support"; Tasks/Assets "Sign in through Kaampilot"),
  Assets audit actor "Kaampilot Platform"/"Kaampilot automation", role clash suffix "(Kaampilot)", payslip PDF creator,
  dev staff "Kaampilot Staff", the APK default `/download/kaampilot.apk` (`MOBILE_APK_URL` still overrides; put the
  APK under that name), docs/READMEs and code comments. `kaampilot*` is a reserved username and a weak password word.
  Phone app: `name` "Kaampilot" (Android label), permission texts, "Can't reach Kaampilot", "Opening Kaampilot…",
  reminder/voice/location messages. Word documents: `docs/Kaampilot_Feature_List.docx`, `docs/Momentum_OS_vs_Kaampilot.docx`.
- **Internal only, not visible, unchanged on purpose** (renaming any of them breaks running installs or phones):
  npm names `@freefounders/*` and the root `freefounders` package; token issuer/audience `freefounders-platform` /
  `freefounders` (every signed-in session and every app's verifier); cookie and `localStorage` keys (`ff-*`); env vars
  (`FF_*`, `PLATFORM_*`); database / schema names (`ff_tasks`, `ff_none`, `co_<code>`, `ff.companies`); Docker compose
  project `freefounders`, image names, `/opt/freefounders` on the server; the bridge object `window.FreeFoundersApp`
  (old installed apps set it); Expo `slug`/`scheme` `freefounders`; Android/iOS id **`com.freefounders.app`**; test and
  demo e-mail addresses (`@freefounders.test`, `owner@freefounders.demo`, `staff@freefounders.test`).
- **Android package — later decision**: changing `com.freefounders.app` makes it a different app for Android: phones
  would need to uninstall the old one and install the new one, keeping two apps side by side meanwhile, and Play Store
  listings cannot change their id. Keep it until the first Play Store release; rename then if wanted.
- **Logo** (`apps/web/public/brand/`: `mark.svg`, `mark-mono.svg`, `wordmark.svg`, `lockup.svg`; web component
  `src/components/brand.tsx`: `BrandMark`, `BrandWordmark`, `BrandLockup`, colours from theme tokens): a rounded tile
  with a **K** whose arm rises at 45° and leaves the tile as a notched arrowhead (paper plane / compass needle): *kaam*
  that takes off, the *pilot* steering it. Light: indigo tile, white K, emerald arrowhead and i-dot; dark: lime tile,
  graphite K, lime arrowhead. Wordmark: monoline lowercase "kaampilot" drawn as strokes (no font file), ".com" in
  the muted colour. The files carry their own dark-mode colours. Generated from one geometry script: favicon.svg
  (dark-tab aware), favicon-32, apple-touch-icon, icon-192/512; phone: `icon.png` (indigo, white K, lime arrowhead),
  adaptive foreground (inside the 66 dp safe circle) / background (indigo) / monochrome, `splash-icon.png` +
  `splash-icon-dark.png`, `notification-icon.png` (white silhouette).
- **Front page** (`/login`, `app/pages/login-brand.tsx`): desktop left panel = lockup, "For Indian SMEs · 5 to 500
  people", headline "Your team's kaam, on autopilot.", one-line value proposition, **Start free** (cta) under it, a small
  preview drawn in HTML (today's punch card with selfie/GPS, a task list with approval and asset tags; it rises in once,
  `motion-safe`), four benefits with Hugeicons, trust line (Made in India · Data stays in India ·
  Works on low-end Android). Phones: lockup + one line above the form (form above the fold), "New to Kaampilot? Start
  free" and the benefits + trust line under it. The sign-up / forgot / join / new-company header uses the lockup.
  Form labels and button names unchanged (e2e).

### 19.36 Punch fixes: uniform rule always applied, "No" blocks, "not at the office" message; Lite mode removed (2026-10-23)
Founder, from testing the web app and the Android app: the uniform pop-up did not show although the setting was on; in
"Ask" mode No must block the punch; a clear message when someone punches away from the office; remove Lite mode.

**1. Uniform pop-up not showing: the cause.** Reproduced on dev (Playwright, owner and a Member): the screen decided
whether to ask from the copy of `/attendance/today/` it had loaded **when the screen opened** (Today and the Home card
alike, browser and app). The server always answered with the current rule (checked: `today` and `hr/config` change at once
after a save; the 30 s settings cache is cleared on save, one gunicorn worker), but a screen left open — on phones the
WebView stays open for days, and the §19.18 saved copy is drawn before the network answers — kept the old "off" until
something refetched it. Switching HR settings to Ask / Reminder and tapping Punch in on an already open screen therefore
punched without a question; in Reminder mode the server cannot tell (nothing to check), in Ask mode the server refused
with "Answer whether…" instead of a question. Nothing was wrong with the setting key, the save, the two buttons or the
in-app path.
- **Fix** (`features/hr/punch.tsx`): every **check-in** first reads today's rules from the server (`refetch`, the button
  shows busy) and decides the uniform dialog, location and camera from that fresh answer; offline, the last copy is used
  and the server still decides. If the server still answers `code: uniform_required`, the dialog opens (Must confirm).
  Saving HR settings already invalidates the `['hr', …]` queries on the saving device (unchanged).
- **Must confirm** (setting value `ask`, renamed on screen): the dialog's **No** shows "Please wear the company shirt /
  jersey, then punch in." inside the dialog and leaves "Yes, I'm wearing it" and "Close"; nothing is sent. **Yes** punches
  in. Server (`hr/services.py`): `uniform: false` → 400 with the same text, `code: uniform_not_worn`; missing → 400
  `uniform_required` (as before); `uniform_ok` is stored **true** on a successful check-in in this mode (older rows keep
  their stored No). Reminder only / Off unchanged.
- HR settings → "Uniform at punch-in": **Off** (No question) / **Reminder only** (OK, punch in) / **Must confirm** (Yes
  punches in, No blocks); stored values unchanged (`off|remind|ask`), no migration.

**2. Not at the office.** The server already refused a punch outside every office radius ("You are 1201 m from HQ
(allowed 200 m). Move closer…") and named the nearest office. Now:
- Message: "You are not at the office location. You are about **1.2 km** away from **<office>**; punch in when you reach
  the office." (metres under 1 km, km with one decimal from 1 km; nearest active office; check-out says "punch out").
- The phone's **GPS accuracy** goes with the punch (browser `coords.accuracy`, app bridge `accuracy`; optional field
  `accuracy` on check-in/out). When the person is outside but the accuracy circle reaches the office (`distance −
  accuracy ≤ radius`), the answer is "Your location isn't accurate enough yet (±250 m). Move outdoors or near a window
  and try again." instead (they may well be inside). Inside the fence a rough fix is accepted as before.
- The 400 answer carries the reason and numbers next to `detail`: `code` (`outside_office`, `location_inaccurate`,
  `location_required`, `no_office`, `uniform_required`, `uniform_not_worn`), `office`, `distance_m`, `radius_m`,
  `accuracy_m`. The web shows `detail` on Today and on the Home card; the Home card's hint line uses the same m / km wording.

**3. Lite mode removed** (founder: "remove Lite mode", meaning the account menu's "Lite mode: Auto / On / Off — for weak
devices"; the light/dark theme is unchanged: first visit follows the device, the switch stays and is remembered).
Removed: the account-menu section, `src/lib/lite.ts` (auto-detection, `useLite`, `installLite`), the `data-lite`
attribute and every `[data-lite]` rule in `index.css`, the unused Feather icon; an old saved `ff-lite` value is deleted at
start. `useMinuteClock` moved to `src/lib/clock.ts`. `prefers-reduced-motion` handling (device accessibility setting) stays.
The feature list Word file no longer lists Lite mode.

| Check | Result |
|---|---|
| Tasks | full suite; new: Must confirm No → 400 / Yes stored true, setting change applies at once, distance wording (m / km), nearest office, rough-fix message, check-out wording |
| e2e | `web-uniform` rewritten (rule switched on while Today is open still asks; Cancel; No blocks + API refuses; Yes; Daily shows Yes; Home card in the app with Reminder only), new `web-punch-location` (1.2 km message on Today and the Home card, ±250 m message, API numbers, punch at the office) |
| Web | `npm run web:build` |

Goes live with a website + Tasks API update (migration none for this part). No new APK needed.

### 19.37 Notifications by area, and every notification opens its item (2026-10-23)
Founder: "notifications separated" (tabs per area with unread counts, mark read per item and per tab, unread clearly
visible) and "clicking a notification opens the right page".
- **Areas**: All · Attendance · Tasks · Assets · Approvals · Company. Tasks rows get a stored **`category`**
  (`attendance|tasks|approvals|company`; migration **notifications 0004**: the column + index `(user, category, read_at)`,
  existing rows filled from their type) set by `Notification.save()` from the type (`notifications/categories.py`), or by
  the caller (`notify(..., category=)`: the approver's copy of a category request is an approval). Approvals = leave /
  correction requests, their reminders and escalations, task change requests, finished work to accept and its reminder.
  Attendance = leave decisions (and payslip/payroll/attendance types). Company = notices (billing/system types). Tasks =
  the rest (tasks, leads, mistakes). Assets rows get `category` from the type in the API (`assets`, or `approvals` for
  `REQUEST_CREATED` and `ONBOARDING_SUBMITTED`); no Assets migration.
- **API**: Tasks `GET /notifications/?category=a,b`, `GET /notifications/unread_count/` → `{count, by_category}`,
  `POST /notifications/read_all/?category=` (one area). Assets `GET /notifications?category=` → items with `category`,
  `unread`, `unreadByCategory`; `POST /notifications/read {ids}` or `{category}`.
- **Web**: core `useNotifications(tab, limit)`, `useNotificationCounts()`, `useMarkNotificationRead()`,
  `useMarkNotificationsRead(tab)`; shared UI `components/common/notifications.tsx`. The **bell** has the area tabs with
  counts, "Mark all read" for the open tab, a tap marks read and opens the item; footer "All notifications" →
  **`/notifications`** (new route; `/tasks/notifications` shows the same screen). The **Notifications screen** has the
  same tabs (`?tab=`), "Mark read" per item, "Mark all read" per tab, Tasks delivery chips, delete and Clear (Tasks rows).
  Unread = bold title on a light tint with a left bar in the theme colour (no dots, no capsules).
- **Links** (audit of every notification in Tasks, Assets and Platform; Platform creates none, and nothing creates
  payslip or billing notifications today — their areas are ready for when it does). Tasks links stay relative to Tasks
  (emails use them with `APP_BASE_URL`). Changed: leave / correction to approve (+ reminders, escalations) →
  `/hr?tab=approvals&leave=<id>` (web: `/attendance/approvals?leave=<id>`, that request outlined and scrolled to;
  `/tasks/hr?tab=` now keeps the other parameters); leave decision → `/hr?tab=leave&leave=<id>`; due-task reminder →
  the task; daily / day-end / weekly digests and "accepted N tasks" → `/tasks?tab=my`; tasks from a directory template →
  the task (one) or My tasks; corrective task → the task; mistakes → `/mistakes?open=<id>` (digests stay on the register);
  leads and customer messages → `/leads?lead=<id>`; category approved → My tasks. Notices (`/notices?n=<id>`) now open that
  notice and mark it read. Assets links were already specific. Old rows: `/hr` approvals → `?tab=approvals`, leave decisions →
  `?tab=leave`, digests → `?tab=my` (migration 0004; ids are not stored on old rows, so they open the list).
- Phone app: the same web screens; the punch reminder still opens `/attendance`.

| Check | Result |
|---|---|
| Tasks | `NotificationAreaTests` (type → area, stored on rows made without `notify`, counts / filter / mark read per area, approval links, migration backfill) |
| Assets | integration test: a new joiner is `approvals`, per-area counts, filter, mark one area read |
| e2e | new `web-notifications` (owner: Approvals tab opens the leave on Approvals and marks it read; member on a phone: bell counts per tab, task opens the task, leave decision opens My leave, Mark all read on one tab); `web-tasks-general` updated |

Goes live with a website + Tasks API (migration notifications 0004 via `migrate_companies`) + Assets API update. No new APK.

### 19.38 Attendance regularization (2026-10-24)
Founder: "add an attendance regularization feature" (as Keka / greytHR / SalaryBox). Requirements: a monthly limit the
company types (any number, 0 = unlimited, default 3); approval by the employee's **reporting manager** (else the people
with the approve-attendance permission); **every request needs approval** (no auto-approve, nothing changes until then);
on approval the day is corrected automatically (payroll uses it); a permanent record visible to the employee, the manager
and HR, downloadable.
- **Built on the corrections** (kept and grown, not replaced): same table `hr.AttendanceCorrection`, same endpoint
  `/attendance-corrections/`, same reminders / escalation. Old clients that send `requested_check_in/out` date-times still
  work (kept exactly). Migration **hr 0009**: `reason_type` (forgot_in, forgot_out, late_work, on_duty, wfh, technical,
  other), `reason` now optional (the note; required for Other), `attachment` (`regularization_docs/`, served only by signed
  links, photos compressed, ≤ 10 MB), `batch` (days asked together), `reviewed_at`, `original_check_in/out`,
  `original_status`, `applied_status` (the from → to), index (user, date); `Attendance.regularization` (FK: the "Regularized"
  tag); approved corrections made before are linked to their days. **hr 0010** drops the short-lived `auto_approved`.
- **Policy** (HR settings → "Regularization", own save; `CompanySetting`): `reg_enabled` (REGULARIZATION_ENABLED, on),
  `reg_reasons` (REGULARIZATION_REASONS, all; new setting kind "codes"), `reg_monthly_limit` (REGULARIZATION_MONTHLY_LIMIT,
  3; 0–1000, 0 = unlimited; counts pending + approved days in the calendar month), `reg_days_back`
  (REGULARIZATION_DAYS_BACK, 7; 0–90), `reg_mark` (REGULARIZATION_MARK: `times` = Present / Late / Half day from the times
  with the HR rules, or `present` = always Present). On duty / WFH reasons tag the day "On duty" / "WFH" (counted present);
  without times they use the shift. Refused: future days, today before the shift ends, older than the limit, a second pending
  request for a day, an approved full-day leave day, check-out without any check-in, out ≤ in, over the monthly limit
  ("Monthly limit reached: … used {u} … ({left} left)").
- **Approvals**: `hr/regularization.py` — `approvers_for` = the reporting manager, else department approvers, else the
  company-wide ones; `may_review` = the manager (no permission needed) or an approver whose scope covers the person; never
  one's own request except the Owner (§19.24). `hr/config` → `can_approve_regularization` (anyone people report to), so
  managers see Approvals → Regularization. Approve rewrites the day (`apply`: times, hours, late / early, status, note
  "Regularized by {name}: {reason}", tag) and keeps the from → to; payroll reads the corrected day.
- **API**: `GET /attendance-corrections/policy/` (rules + used / left this month), `POST /attendance-corrections/` (JSON or
  multipart; `date`, `end_date`, `reason_type`, `check_in_time`, `check_out_time`, `reason`, `attachment`; a range answers
  `{results, count}`), `POST /:id/review/`, `POST /bulk_review/ {ids, decision, remarks}` → `{done, failed}`,
  `GET /:id/attachment/` (fresh signed link; the person and their approvers), list filters `scope=team`, `status`, `from`,
  `to`, `user`. Monthly / Daily / Live rows carry `regularized`, `regularization_reason`, `work_mode` (+ the day's `request`
  in My attendance).
- **Notifications**: approvers get `correction_request` ("Attendance regularization from {name}", Approvals area, link
  `/hr?tab=approvals&correction=<id>`); the person gets `correction_reviewed` (Attendance area, link
  `/hr?tab=history&date=<day>&regularization=<id>` → My attendance on that day). WhatsApp / email follow the existing
  "Leave and attendance" rule group (now also covering `correction_reviewed`).
- **Web**: My attendance — day panel with the Regularized tag, the day's request, "Regularize this day"; calendar tag
  ("R" on phones); "My regularization requests" (the permanent record, Download). Today — "Regularize a day". Form
  `features/hr/regularize.tsx`: reason in one tap (guessed from the record), times pre-filled, several days, note,
  attachment: tap the day → Regularize → Send on a phone. Approvals — tabs Leave / Regularization with counts, recorded vs
  requested, distance of the check-in, requests that month, attachment, bulk approve / reject. Daily / Live — the tag.
  Downloads — My attendance and Daily files get a "Regularized" column when a day of the file is regularized; the request
  list file has reason, note, was / new times and status, reviewer, reviewed at; Reports → "Regularization requests" (person,
  month, reason, times, status, before / after, who decided). Home's refused-punch link reads "Regularize a day".
- HR import and "Mark" clear the tag (they decide the day afterwards).

| Check | Result |
|---|---|
| Tasks | new `hr/tests_regularization.py` (26: within policy, monthly limit + 0 = unlimited, rejected not counted, too far back, future, today before shift end, off / reasons, needs a time / note, one pending per day, date range, settings, approve rewrites + recompute + from → to + tag, half day, always-present mark, reject, own request (Owner may), scope, reporting manager without permission, no manager → approvers, bulk, every request waits, payroll, import / mark clear the tag, report + downloads, attachment privacy, size); `tests.py` / `tests_approvals.py` updated for late recompute and the manager rule |
| Web | `npm run web:build` |
| e2e | new `web-regularization` (phone: employee requests from My attendance, reporting manager approves in Approvals, day corrected + tag + record, limit message); `web-hr` (Approvals tabs), `web-attendance-team` green |

Goes live with a website + Tasks API update (migrations hr 0009–0010 via `migrate_companies`). No new APK.

#### 19.38 addendum: Flexible limits + HR adds (2026-10-24)
Founder: "Any organization can set regularization by itself, there is no restriction; I can adjust the number of
regularizations."

| Part | What |
|---|---|
| No caps | `reg_monthly_limit` and `reg_days_back` take any whole number ≥ 0 (only a sanity maximum, `REG_MAX` = 100000); 0 = unlimited / only today after the shift. |
| Limit period | new `reg_limit_period` (REGULARIZATION_LIMIT_PERIOD): `month` (default) / `week` (Monday–Sunday) / `year`. The key `reg_monthly_limit` keeps its name and is "requests per period". Refusal "Monthly / Weekly / Yearly limit reached: … {n} … a month / a week / a year … used {u} in {Month YYYY} / the week of {Monday} / {YYYY} ({left} left)" (code stays `monthly_limit`). |
| Per-person limits | new `reg_person_limits` (REGULARIZATION_PERSON_LIMITS, `CompanySetting` JSON `{"<user id>": limit}`, setting kind "limits"; PUT `[{user, limit}]`, GET answers `[{user, name, limit}]`). The person's own limit replaces the company's (0 = unlimited). Same card: "Different limit for some people" (pick a person → their number). `GET /attendance-corrections/policy/` adds `limit`, `period`, `personal_limit`, `used`, `left` (the old `monthly_limit` / `used_this_month` / `left_this_month` carry the same numbers); the employee's form shows "{left} of {limit} requests left this week[ (your own limit)]". |
| HR adds | `POST /attendance-corrections/add_for/` {user, date, end_date, reason_type, check_in_time, check_out_time, reason, attachment} (`regularization.add_for`): applied at once (status approved, `reviewed_by` = `added_by` = the actor, `apply` exactly like an approval, from → to kept), **not counted** in the person's limit (`used_in_period` skips `added_by`), ignores the days-back window, the company's on/off switch and the allowed-reasons list (never a future day; a day with a pending request or approved full-day leave is refused), tells the person (`correction_reviewed` "Attendance regularized: {date}", "{reason}: added by {name}"). Who: `check_adder` = whoever may decide the person's requests (`may_review`: reporting manager, or an approver whose scope covers them); nobody for themselves except the Owner (§19.24, `SELF_EDIT_MESSAGE`). `GET /attendance-corrections/people/` = the picker (`?scope=all` = everyone, HR settings people only, for the per-person limits). Migration **hr 0012** `AttendanceCorrection.added_by` (SET_NULL; `people_delete` NULL). |
| Record + downloads | serializer `added_by_detail`, `source` (`hr` / `request`); list download "Source" ("Added by HR" / "Requested") + "Added by"; Reports → Regularization "Source" ("Added by {name}" / "Requested"). My regularization requests: chip "Added by {name}". |
| Web | Settings card (period, helper line "Each person can ask 3 times a month, up to 7 days back. Unlimited = 0.", per-person list); `RegularizeForSomeoneButton` (`features/hr/regularize.tsx`) on Approvals → Regularization, Daily (date bar + "Regularize" per row), Live / My team, a person's month ("Regularize this day"); shown when `can_approve_regularization`. |

| Check | Result |
|---|---|
| Tasks | new `hr/tests_regularization_flex.py` (7: no cap 5000 / 365 + sanity max, weekly and yearly counting, per-person higher + unlimited + unknown person + clear, HR add applied / not counted / any past day / told / downloads, scope + own-record + Owner, future + pending refused); `npm run quick-check -- --tests tasks` |
| Web | `npm run web:build` |
| e2e | `web-regularization` + step 5: the reporting manager regularizes the earlier day from Approvals → approved, `source` hr, not counted |

Goes live with a website + Tasks API update (migration hr 0012 via `migrate_companies`). No new APK.

### 19.39 Punch-in reminders from the server (2026-10-24)
Founder: "Attendance reminder every 3 times after every 30 min from reporting time if not marked, leave." A person who
has not punched in by the reporting time (= the company's **Work starts**; there is no per-person shift) gets reminder
1 at reporting + 30 min, 2 at + 60, 3 at + 90, and none once they punch in.

| Part | What |
|---|---|
| Rule | `hr/punch_reminders.py`, run by the ticker (`send_followup_reminders`: `run_worker` every 5 min per company schema, or the in-process ticker standalone). Reminder *n* is due when its slot (reporting + first + (n − 1) × gap) has passed **and** `gap` minutes have passed since reminder n − 1, so a worker that was down sends **one catch-up**, then the next a gap later (no burst). Nothing before the first slot, nothing after **Work ends**, never more than the count. |
| Who is skipped | holiday, weekly off (company), approved leave (a LEAVE day or an approved request covering today, half days too), a day row without check-in that HR already decided (absent, half day, leave…), inactive (exited) people, people without `attendance.punch` (attendance not tracked). |
| Record | **`AttendanceReminderLog`** (user, date, n, sent_at, channels) unique `(user, date, n)`, migration **hr 0011** (after the regularization 0009–0010). The row is written before sending, so restarts, a second worker or a re-run never repeat a reminder (at most once). Deleted with the person (`people_delete` RELATIONS + PERSONAL). |
| Channels | In-app notification type `punch_reminder` → area **Attendance** (§19.37), link `/hr?tab=today` (web: `/attendance`, Punch in). Text: "Reminder 1 of 3: you have not punched in yet today (reporting time 09:30). Open Kaampilot to punch in." (standalone install: its own app name). WhatsApp through the existing sender (company's WhatsApp set-up, generic template if configured; `outside_hours="skip"`), new notification-rule group **"Punch-in reminders to people who have not punched in"**: WhatsApp on, **email off by default** (`rules.DEFAULT_OFF`), both switchable. |
| Settings | HR settings → **"Punch-in reminders"** card (own save): `punch_reminders` (PUNCH_REMINDERS_ENABLED, default on), `punch_reminder_count` (PUNCH_REMINDER_COUNT, 3, 1–10), `punch_reminder_gap` (PUNCH_REMINDER_GAP_MINUTES, 30, 5–240), `punch_reminder_first` (PUNCH_REMINDER_FIRST_MINUTES, 30, 0–240); per company in `CompanySetting` like the other HR rules, preview of the times. |
| API | `GET /attendance/today/` + `punch_reminders` {enabled, count, gap_minutes, first_after_minutes, reporting_time}, `day_off` (holiday / week_off / leave / null), `reminders_sent`; `GET /hr/config/` + `punch_reminders`; `team_day` rows + `reminders_sent` → Daily / Live show **"Reminded 2×"** next to people not checked in. |
| Phone | No server push yet, so the phone's **local** reminders (§19.32) follow the same rule: the card's defaults are time = reporting + first delay, "Remind me again every 30 min until I punch in (3 reminders in all)" (`followUpMinutes` = gap, new `count`); the person still switches it on (no automatic Android pop-up). A check-in, or opening Today/Home on leave / a holiday / the weekly off (`day_off`), sends `reminder-skip-today` (cancels the rest of today). **Works with the current APK 1.2.1**, which ignores `count` and rings the first reminder + one follow-up (2 of 3; the card says "This app version rings the first 2 reminders"). The shell code for all *n* (`count` 1–10, gap up to 240, "Reminder 2 of 3" texts, capability `reminder-count`) is in `apps/mobile` (app.json 1.2.2 / versionCode 5) and needs a **new APK** to take effect. Limits: the phone only knows a leave/holiday when the app is opened that day; the server reminder covers it. |

| Check | Result |
|---|---|
| Tasks | new `hr/tests_punch_reminders.py` (13: due times +30/+60/+90 and no 4th, punch-in stops, leave / HR-marked / holiday / week off / inactive / not tracked skipped, after work end, settings count / gap / first / off / clamped, idempotent + unique row, catch-up without burst, rules email off / WhatsApp on, ticker calls it, today / config / team_day fields, settings validation); `tenancy` per-company test (one company off, the other reminded, nothing across schemas); `tests_settings` rules default updated; full suite green |
| Mobile | `npm run mobile:check` (33 tests; new: several reminders a day, skip cancels the rest, count parsing / old settings) |
| Web | `npm run web:build`; e2e `web-hr` (Punch-in reminders card) and `web-app-shell` (card defaults from the rule, old-app note, `count` sent) |
| Manual | dev `co_demo` at 11:22: one pass sent reminder 1 to the 10 not-punched-in people (second pass: 0); owner's bell shows it in Attendance, `today.reminders_sent` = 1, Daily shows "Reminded 1×". |

Goes live with a website + Tasks API update (migration hr 0011 via `migrate_companies`; the worker must be restarted to pick up the job). No new APK needed; APK 1.2.2 gives all 3 phone reminders.

### 19.40 Open items closed (2026-10-24)
The items left open in the feature-list review, each small and tested.

- **Half-day leave in payroll** (Tasks `payroll/services.py::count_days`): a day with an approved half-day leave is half
  leave + half work: 0.5 paid (paid type) or 0.5 loss of pay (unpaid type) for the leave half, plus 0.5 when the person
  punched in for the other half (never more than one day; a full "present" punch still counts 0.5 that day). A half-day
  leave with no attendance row still pays its 0.5. Payslip breakdown `paid_leave` / `unpaid_leave` can be x.5; `half_day`
  counts the worked halves. A half-day leave no longer blocks the punch (`hr/services.py::check_in`; a full-day leave
  still does). The balance already counted 0.5 (§19.33).
- **HR marks leave for someone** (web for the API of §19.33): **Mark leave** button on My leave and in Approvals → Leave
  (people with Approve leave only): Employee (only whom they approve leave for, `GET /leaves/markable/`; themself only as
  the Owner, §19.24), type with that person's "N days left", From / To, Half day (one date), Reason. Approved at once,
  attendance updated, the employee notified ("Leave marked: …", links to the leave); beyond the balance only after
  ticking "Beyond balance", logged on the leave (`beyond_balance`, `_by`, `_at`; the list shows "beyond balance"). Audit:
  the leave records who marked it (`reviewed_by`, `reviewed_at`, remark "Marked by <name>"). A non-Owner sending
  themself as `user` just applies (pending), as before; the Owner's own mark is approved.
- **Bulk import of people** (Admin → People & access → **Import**, Manage people): template download (XLSX / CSV: Name,
  Email, Mobile, Employee ID, Department, Designation, Reports to (employee ID or email), Join date, Role Admin/Member),
  upload a CSV or XLSX (≤ 500 rows, ≈ 700 KB; read by the Platform without a library: `people/people-import.ts`), preview
  with errors per row, then **Import N people**. Platform `GET /people/import/template?format=`, `POST
  /people/import/preview {fileName, content(base64)}` (nothing saved), `POST /people/import {rows}` (checked again).
  Checks: name, email / mobile / employee ID formats, duplicates in the file, already in People (email or employee ID),
  an email that signs in an admin-made person of another company or belongs to a Kaampilot account ("invite them with a
  link instead"), an employee ID that is someone's username — **never taken over**; department must exist (name or
  code); reports-to = an existing person or a row of the file (no loops); join date as 2026-10-01 / 01-10-2026 / an
  Excel date; only an owner or admin adds Admins; **seats**: rows past the plan's free seats get "The Free plan is for up
  to 3 users…" and are not added. Each row is added like "Add person": the person, a login with a generated password
  when they have an email or employee ID (hashed; shown once — the result offers a **Sign-in sheet (CSV)** to download),
  the Admin or Member role (opens their apps, takes the seat; if that fails the person is removed again), then managers
  from the file and one directory push.
- **Integrations** (Admin → Settings → **Integrations**, Owner / Admin = Tasks admin level): the company's WhatsApp
  (on/off, phone number ID, access token, app secret, webhook verify token, template name / language), Gmail (on/off,
  sender, client ID / secret, refresh token, read leads + inbox search) and AI (on/off, provider, model, API address, API
  key, Anthropic key, NVIDIA key) values that `company_setting` set before (`CompanySetting`, secrets encrypted with
  SETTINGS_KEY). Tasks `GET/PUT /api/integrations/` (`tenancy/integrations.py`): a secret is never returned — only
  "••••" + its last 4 characters (12+ long), or "Set on the server" when only the environment has it; **Replace** /
  **Remove** (removing falls back to the environment value). Every change is recorded in `tenancy.SettingChange` (key,
  set / removed, who, when — never the value; migration tenancy 0003) and shown under the field ("Changed by …").
- **Old phone apps prompted to update**: `MOBILE_MIN_VERSION` on the Platform is now **off unless set** (was 1.1.0);
  `GET /api/platform/app-version` → `{minVersion, apkUrl}`. Inside an app older than it, the web app shows a
  **non-blocking banner** under the header, "A new version of Kaampilot is available (you have x)" + "Download the
  update" (https://kaampilot.com/download/kaampilot.apk, opened in the phone's browser), hidden for the session with ×
  (the old one-time dialog is gone). The web app reads the shell version from `window.FreeFoundersApp.version`
  (native-bridge `appInfo()`). Voice keeps its own 1.1.0 check. The e2e answers `/app-version` itself (on / off). Docs:
  infra/deploy/README.md (Settings), docker-compose (`MOBILE_MIN_VERSION`, `MOBILE_APK_URL`), services/platform/.env.example.
- **Backups**: `infra/deploy/backup.sh` — `pg_dumpall` of the stack's Postgres container (every database and company
  schema, roles) to `FF_HOME/backups/db-<stamp>.sql.gz` and the uploaded files (`data/tasks-media`,
  `data/assets-uploads`) to `media-<stamp>.tar.gz`; checked (`gzip -t`, "dump complete"), written via `.part` files,
  14-day rotation, non-zero exit on failure. Cron line and restore steps in infra/deploy/README.md "Backups". Not run on
  the server yet (deploy time).

| Check | Result |
|---|---|
| Tasks | payroll `tests.py` +2 (half-day leave paid / unpaid / worked / no row), new `hr/tests_mark_leave.py` (4: people list, half-day mark notified, own-records rule, half-day punch), new `tenancy/tests_integrations.py` (4: admins only, write-only + masked + encrypted + audited, remove → server value, bad input) |
| Platform | new `people-import.test.ts` (4: CSV / XLSX reading + dates, template, preview errors + in-file manager + Free seats + import + login works, no token); `integration.test.ts` app-version off by default |
| Web | `npm run web:build` |
| e2e | new `web-open-items` (import 2 of 3 rows → manager set → Mark half-day leave for the new person; Integrations key masked, Replace / Remove); `web-app-shell` banner tests |

Goes live with website + Platform + Tasks updates (migration tenancy 0003 via `migrate_companies`). No new APK needed
(the banner is in the web app); set `MOBILE_MIN_VERSION` when a newer APK is on the site.

### 19.41 Task chains, person Excel report, change-request ranking (2026-10-24)
Founder: give a part of a task to someone (chains, 5 levels), a per-person Excel report, and a ranking of who asks most
to move a date. All three were built in the original app after the copy (branch `feature/delegated-dashboard-whatsapp`,
read-only): **ported** `5fde3aa` (person Excel report), `1dabd35` (sub-tasks and Task chain); `2bc1425` (ranking) was
already ported in §19.30 and is extended here. `5206167` (notice WhatsApp title in bold) is not part of this. As in
§19.30, the original's "admin / Super Admin" = `tasks.view_all` (company-wide task view: Admin role and the Owner).
**No new permission keys.**

**1. Task chains** (`crm/chain.py`, rules in one place; no new table — `Task.parent` already existed)
- The holder of a task (or an admin) gives parts with **Sub-tasks → "Give a part to someone"** (one or more people in
  one go). A part: due no later than its task, its effort comes **out of** what that task has left, never repeats, never
  to the holder, not of a finished task; parts of parts up to **5 levels** below the main task ("A chain can go 5 levels
  deep…"). The old rule "sub-tasks are one level deep" is replaced.
- **Who may give parts** (FreeFounders decision, not in the original, which had no assign permission): with Assign tasks
  as for any task; **without it (a Member) only for a task someone else gave them** — any active colleague, the Owner
  only from an Owner (3fbf6e7). A task you made yourself is split only with Assign tasks, so it is no way around it
  (`TaskViewSet._may_pass_part_on`; `GET /tasks/assignees/?part_of=` lists who may get a part).
- A part's completion goes to **the person who gave it** to accept (the normal giver rule). The task above **can't be
  completed** (complete and status PATCH) while a part is open or done-but-not-accepted (400 `needs: subtasks` with the
  codes); a sent-back part blocks again. Accepting the last part (one or bulk) tells the holder "All sub-tasks done".
- **Effort split**: what was given to parts is earned by those people; the holder keeps the rest (`own_effort_map`) in
  the score (`_task_buckets` → Reports, Team performance, profile, Excel), Time report, workload and Team performance load.
- **Cancel cascade**: deleting a task, or approving a cancel request, sends its unfinished parts (all levels) to the
  Deleted bin, and their people are told; restoring the task brings back the parts cancelled with it.
- **Due date moved earlier** (admin edit or approved request): each open part now due after it is flagged to whoever
  gave it ("Check the date: …"; nothing moves by itself).
- Notifications `subtasks_all_done`, `task_cancelled`, `subtask_due_after_parent`: link `/tasks/{id}` (§19.37), area
  "tasks", in the notification rules groups task_done / task_changes / task_due; no WhatsApp.
- API: `GET /tasks/{id}/` adds `subtasks` (result, approval, parts below…) and `chain` (parent, root, level,
  can_give_part, effort left, blocked, can_view_chain); `GET /tasks/{id}/chain/` (tree + summary) and
  `GET /tasks/chains/?status=open|done|all` for `tasks.view_all`.
- Web (`features/tasks/work/task-chain.tsx`, core `tasks/chain.ts`): Sub-tasks block, "Sub-task of … held by …" note,
  Complete disabled with the reason, "Give parts of T-…" dialog (bottom sheet on phones), **Task chain** dialog (tree,
  indented per level, fits 320 px), **Tasks → Chains** tab (admins / Owner; table, cards on phones; Download). New icon
  `Network` (Hugeicons HierarchyIcon).

**2. Person Excel report** (`crm/person_export.py`, openpyxl already installed): `GET /tasks/person_export/?user=&range=`
(+custom start/end), `tasks.view_all`. 8 sheets, every one with filter arrows and a frozen header: Summary and score,
Month by month, Tasks received (+ "Sub-task of", "Main task", "Given to sub-tasks (h)"), Given by whom, Tasks delegated,
Delegated to whom, Change requests (+ Old due / New due), Completion reviews. Numbers come from the same helpers as the
screen (`_person_rows` = `/tasks/employees_report/?user=`); text written formula-safe; header colour = brand indigo.
Web: Team performance → a name → "Open full profile" → **Excel report** (admins / Owner) — the shared `DownloadButton`
(`tasksExports.personReport`), so in the Android app it is saved through the native bridge (§19.31). The original's
"downloads do not work inside the app" message is not ported.

**3. Change-request ranking** (Team performance, `tasks.team_performance` as in §19.30): `TaskChangeRequest.old_due_at`
(migration `crm 0023`, filled on create; pending requests back-filled) so each request shows **old → new** due date even
after approval; the API adds `old_due_at`, `new_due_at`, `status_display`, `reviewed_by/at`, `remarks`. Web: "Last asked"
column, each request "Due {old} → {new}", reason, outcome (by whom, when, remarks), Download (Excel / CSV).

| Check | Result |
|---|---|
| Tasks (SQLite) | 1031 run, OK (22 skipped). New `crm/tests_task_chain.py` (original 15 + 10: Member passes on a part / self-made task needs Assign, who can get a part, cancel request cascades, approved earlier date flags, notification link + area, approver at each level, effort split in Team performance + Time report, Chains permission + status filter, old → new survives approval in ranking + Excel, ranking counts + permission), `crm/tests_person_export.py` (original 8 + 3: every sheet filtered, Summary = employees_report field by field for two ranges, Owner + formula-safe), `tests_detail` sub-task test as in the original |
| Tasks tenancy (Postgres) | 37 pass; dev migrated (`migrate_companies`, 89 companies, `crm 0023`) |
| Web | `npm run web:build` (rules + typecheck + build) clean |
| e2e | new `web-task-chains` 3 / 3 (a Member gives a part on a 390 px phone, main task blocked until the part is done and accepted, effort left, Owner: Chains tab + tree + "Task chain" button, Member 403; person Excel 8 sheet names + autofilter on all + Summary = API, Member 403; in the app shell the report goes through the bridge, ranking shows old → new); `web-tasks`, `web-tasks-general`, `web-tasks-ported`, `web-downloads` 16 / 16; `web-admin` "delete with the defaults…" passes (it failed only while `crm 0023` was not yet applied to the running suite) |

Goes live with Tasks + website updates (`migrate_companies` for `crm 0023`). No new APK needed.

### 19.42 Count badges (2026-10-24)
Founder (screenshot of the Tasks tab bar "My Tasks (5)" with a small red round counter): "like this I want notification
count badges in the complete application." A red counter means **something waits for you** there; the bell keeps its own
unread count.
- **What is counted** (same rows as the screen it sits on, never another person's work, never your own request):
  - Tasks: **My Tasks** = open + in progress assigned to me (overdue included; same as before); **To accept** = finished
    work waiting for my review (sub-task parts use the same review, so they are in it; there is no separate "parts" list);
    **Requests** = change / cancel requests I decide (`change_request_inbox()`, the Requests tab's own filter, moved out of
    the viewset). Not counted: Delegated (the original counts nothing there), Disputes (a report of estimate gaps with no
    "done" state, so a count would never drop).
  - Attendance: **Approvals** = pending leave of the people I may approve (`approvals.reviewable_users`) + pending
    regularizations (§19.38) of the people I review (`regularization.reviewable_users`: my direct reports plus my
    approving scope, so a reporting manager without the approve permission sees them too), excluding my own.
  - Assets: **Requests** = pending requests I may decide (approvers: all; a manager: their team's) + approved requests to
    hand out (fulfillers); **Tickets** = open / in-progress tickets assigned to me + open unassigned ones (ticket managers);
    **Exits** = open exit cases with assets still to collect (exit managers).
  - Admin: nothing waits for an admin today (invites are accepted by the invitee; no join approvals), so no counter.
- **API**: Tasks `GET /api/badges/` → `{tasks: {my_tasks, to_accept, requests, total}, hr: {leave, corrections,
  approvals}}` (`crm/badges.py`); Assets `GET /api/badges` → `{approve, fulfil, requests, tickets, exits, total}`
  (`modules/service/badges.service.ts`). A handful of COUNT queries each, in the request's company schema.
- **Web**: core `useBadges()` (one request per app, every 60 s and on window focus; any successful change anywhere refreshes
  it through the query client's mutation cache, so a count drops right after approving); pure helpers `toBadges()` and
  `countLabel()` (hidden at 0, 1–99, "99+"). One component **`<CountBadge n>`** (`components/common/count-badge.tsx`): round
  counter (allowed: counters), `--destructive` with the new **`--destructive-foreground`** token, screen readers hear
  ", 5 pending", never shrinks (tab rows keep scrolling). Used on: Tasks tabs (My Tasks, To accept, Requests; the phone
  "More" menu shows the sum of the hidden tabs), Attendance → Approvals tab, sidebar items (`NavItem.badge`: Tasks,
  Approvals, Requests / My requests, Tickets, Exits), sidebar group headers and the phone bottom bar (Attendance, Tasks,
  Assets show their area total), and the bell (unread). Replaces the old `useTaskInboxCounts()` (three list calls) and
  `TabCount` (capped at "9+").

| Check | Result |
|---|---|
| Tasks | `crm.tests_badges` (zero case, sign-in needed, My Tasks open/in progress only, To accept only mine, Requests = the inbox tab, Approvals in scope and never my own, a reporting manager without approve permission counts their report's regularization but not leave) |
| Assets | integration test "count badges": employee zero / own request not counted, approve → fulfil → handed out, ticket counted for the support team and dropped when resolved |
| core | `badge-count.test.mjs` (totals, bad values = 0, "99+") |
| e2e | new `web-badges` (member: My Tasks 1 on tab, sidebar and phone bottom bar at 360 px without sideways scroll; owner: Approvals count drops right after approving in the screen) |

Goes live with a website + Tasks API + Assets API update (no migrations). No new APK.

## 20. Scale plan: self-serve sign-up, payments, 100 000 companies / millions of users (draft 2026-10-13, for approval)

Founder: "use Notion's architecture for making and giving new users; plan how we share this with millions of users and
hundreds of thousands of companies; how we take payments; suggest the plan and the step before it." Nothing here is
built yet. It extends §9 (pricing), §10 (operations) and §11 (Phase 8 Subscriptions, Phase 9 Launch).

### 20.1 Targets and the load they mean
| | Launch | Target |
|---|---|---|
| Companies | 1–2 000 | 100 000+ |
| Users | up to 50 000 | 2 000 000+ (average 20 per company) |
| Punches | 100 000 / day | 4 000 000 / day; ~40 % between 9:00 and 10:00 → ~220 / s on average, **~1 000 / s at 9:30** |
| Punch selfies (~40 KB) | 4 GB / day | 160 GB / day → ~14 TB kept with 90-day retention |
| Cross-app events, notifications | small | millions / day (reminders at shift start for everyone at once) |

Two things in today's design do not survive this and must change before growth (not before launch):
1. **100 000 Postgres schemas in one database** (one per company, §14) means ~7 million tables: slow migrations, backups
   and catalogue. → spread companies over many databases (cells, 20.3).
2. **The Platform polls every app for every company** for cross-app events (`GET /internal/events`, every 5–30 s). At
   100 000 companies that is 200 000 requests per round. → apps push events to a queue (SQS) instead (20.7).
Also: photos in Postgres (`bytea` in Assets) and per-process throttles (docs/security) must move to S3 and a shared
cache.

### 20.2 What Notion does, and what we take
Notion runs on PostgreSQL **sharded by workspace**: every row carries its workspace ID; 480 *logical* shards (schemas)
were spread over 32 physical databases (2021), later re-spread over 96 without touching the application, because the app
only asks "which shard holds workspace X?". Around it: one global identity (one account, many workspaces, a workspace
switcher), sign-up in seconds with templates, invite links and email-domain auto-join, a free plan that spreads inside
companies, per-seat billing, and a separate data lake for analytics so reports never load the main databases.

What we take, fitted to what we already have (one schema per company):
- **Company → cell routing** (Notion's workspace → shard): the Platform's company registry also says which *cell* holds
  the company. A cell is a full copy of the app stack (Tasks API, Assets API, workers, one Aurora Postgres cluster)
  holding up to ~2 000 companies (each still its own schema, so isolation and all current code stay). 100 000 companies
  = ~50 cells. A company can be moved to another cell (dump/restore its schema) without the app changing.
- **One account, many companies**, company switcher, invite links, domain auto-join, templates on day one.
- **Free plan to spread**, paid per active user.
- **Reports and analytics off the main databases** (read replicas, later a data lake).

### 20.3 Architecture (AWS Mumbai `ap-south-1`, backups to Hyderabad `ap-south-2`)
```
 Phones (FreeFounders app)   Browsers                      Payment: Razorpay  ─webhooks─┐
            │                    │                                                          │
     Route 53 → CloudFront + AWS WAF (rate limits, bot rules) ── web app (S3, cached)       │
            │                                                                               │
     ┌──────┴──────────────── GLOBAL ─────────────────────────────────┐                     │
     │ Platform API (ECS Fargate, autoscaled): sign-up, sign-in,      │◄────────────────────┘
     │ accounts + memberships, companies → cell, roles, BILLING,      │
     │ owner console. Aurora "global" (+ reader). Valkey/Redis.       │
     └──────┬─────────────────────────────────────────────────────────┘
            │ token carries cid + cell; router sends /tasks/api, /assets/api to the company's cell
   ┌────────┴────────┐   ┌─────────────────┐        ┌─────────────────┐
   │ CELL 1          │   │ CELL 2          │  …     │ CELL 50         │   each cell ≤ ~2 000 companies
   │ Tasks API ×N    │   │ (same)          │        │ (same)          │   (one schema per company)
   │ Assets API ×N   │   └─────────────────┘        └─────────────────┘
   │ workers (jobs)  │
   │ Aurora writer + │   S3: photos, files, exports (private, signed links, lifecycle → cheaper storage → delete)
   │  reader replica │   SQS / EventBridge: outbox events, jobs, notification fan-out (no polling)
   │ Valkey (cache,  │   SES email · WhatsApp Cloud API · FCM push (Expo) · Sentry · CloudWatch/OpenTelemetry
   │  rate limits)   │   Secrets Manager + KMS · GitHub Actions → ECR → ECS (canary cell first)
   └─────────────────┘
```
- Launch = **one cell** + global (no router needed yet: every company is in cell 1). Same code; adding cells later is
  configuration plus the router.
- Connection pooling: today the company is chosen with `SET search_path` per request (session state), which blocks
  transaction pooling (PgBouncer/RDS Proxy pin every session). Change to `SET LOCAL search_path` inside each
  transaction, then use PgBouncer transaction pooling (thousands of requests on ~100 DB connections per cell).
- Every cell has a writer + a reader: lists and reports read from the reader; punches and edits go to the writer.

### 20.4 Identity: one account, many companies (Notion model)
- `accounts` (global: the person's mobile number and/or email, password or Google sign-in, OTP) and `memberships`
  (account × company × person record × roles). A person who works for two companies, or a consultant, uses one login
  and a **company switcher**. Today's employee-ID sign-in stays, but only with a company code (IDs are per company).
- **Mobile number + OTP first** (field staff often have no work email), email + password and "Sign in with Google" too.
  OTP by SMS (DLT-registered template) or WhatsApp. Admins can turn on authenticator codes (§19.24 left it optional).

### 20.5 New company in seconds (self-serve sign-up)
1. Website → **Start free** → mobile or work email → OTP → name, password (or Google).
2. **Create your company**: name, team size, industry, state (needed for GST), choose Attendance / Tasks / Assets.
3. Instant: the Platform takes a **pre-made empty company schema from a pool** in the least-loaded cell (a background
   job keeps ~100 ready per cell, migrated and seeded), so nothing waits for migrations. Default content: shift
   9:30–18:30, leave types, holidays of the chosen state, one sample task, roles Owner/Admin/Manager/Member.
4. **Invite the team**: link with the role pre-chosen (expires, can be switched off), WhatsApp invite, Excel/CSV import
   with employee IDs, "anyone with @company.com can join" (domain auto-join, owner approves). Joiners sign in with
   mobile OTP.
5. **Getting started checklist**: set the office location (geofence), add 3 people, first punch, install the Android
   app, connect WhatsApp. A trial banner shows days left and seats used.
6. Abuse guards: OTP rate limits per number/IP, disposable-email block, CAPTCHA only after suspicious attempts, a limit
   on new companies per account per day.

### 20.6 Payments and subscriptions (Phase 8)
- **Provider: Razorpay** (India: UPI Autopay, cards, net banking, e-mandates). Big customers: annual invoice paid by
  bank transfer (Razorpay payment link / NEFT), marked paid in the owner console.
- **Plans** (from §9, prices to confirm): Free (decision 1), Tasks ₹99, Assets ₹79, Suite ₹149 per active user per month;
  annual = 2 months free; 14-day trial of any plan without a card.
- **Seats** = people with access to at least one app (not switched off). A daily seat snapshot is stored. Adding people
  mid-month: charged pro-rata on the next invoice (Razorpay subscription add-on); removing: takes effect next cycle.
  Over the paid seats → the owner is asked to add seats (or seats are added automatically, a company setting).
- **Life of a subscription** (one state machine in the Platform):
  `trialing → active → past_due (payment failed: 7 days, banners + WhatsApp/email reminders, Razorpay retries) →
  read_only (can see and export, cannot add) → suspended (sign-in shows "renew") → deleted after 90 days (export
  first, DPDP)`. Upgrades are immediate; downgrades and cancellations at the end of the paid period.
- **Webhooks** (`subscription.activated/charged/pending/halted/cancelled`, `payment.failed`, `invoice.paid`): signature
  checked, stored once by event ID (`billing_events`, idempotent), applied by a worker; a nightly job compares with
  Razorpay to catch anything missed.
- **What a plan unlocks** (entitlements: apps, modules, seat limit, later features such as SSO) is pushed to the apps
  through the module switches that already exist (`PUT /internal/company`, §16). The apps never deal with money.
- **GST**: 18 %; CGST + SGST when the customer is in FreeFounders' own state, IGST otherwise; the customer's GSTIN
  (optional, for input credit) on the invoice; one invoice number series per financial year; PDF emailed and kept in
  **Billing** (owner only: plan, seats, next charge, payment method, invoices, cancel). Monthly accounting export
  (Tally / Zoho Books).
- **New Platform tables**: `plans`, `prices`, `subscriptions`, `seat_snapshots`, `invoices`, `invoice_lines`,
  `payments`, `billing_events`, `coupons`, `tax_profiles`. **Owner console** (FreeFounders staff only): companies, MRR,
  trials, failed payments, plan overrides, coupons, support access to a company only with the owner's consent, logged.

### 20.7 Data, files and background work at scale
- **Files**: punch selfies, attachments and asset photos in S3 (private; links signed for minutes, as §19.21 already
  does for `/media`); punch photos move to cheaper storage after 30 days and are deleted after the company's retention.
- **Events between apps**: each app's outbox (already there) is published to SQS/EventBridge by the app's worker; the
  Platform consumes the queue. This replaces polling every company.
- **Jobs and reminders**: per-cell workers; mass jobs (shift-start reminders, payroll runs, monthly reports) are split
  into small batches through the queue and spread over minutes, never one loop over all companies.
- **Cache and rate limits**: Valkey/Redis per cell (shared throttles, permission cache). §14's "no Redis" holds for
  launch; this is where it changes (decision 4).
- **Reports and analytics**: heavy reports on the reader; product-wide statistics and the owner console from a data
  lake later (change data capture → S3 → Athena), as Notion did.
- **Noisy neighbours**: per-company request limits and job quotas, so one big import cannot slow a whole cell.

### 20.8 Security and law at scale
DPDP Act 2023 (consent for location and photos, purpose, retention, export and deletion per company and per person,
breach notice, grievance officer), data stays in India, encryption at rest (KMS) and in transit, WAF, the §19.21 live
checklist (enforced CSP, locked app server address, DEBUG off, trusted proxy settings), a yearly penetration test,
later SOC 2 / ISO 27001 for big customers, enterprise SSO (SAML) and audit-log export.

### 20.9 Operations
- Deploys: GitHub Actions → images → canary cell → all cells in waves; database changes "expand, then contract" so old
  and new code both work during a rollout; the company schemas of a cell are migrated in parallel batches, with a
  dashboard.
- Monitoring: Sentry (web, app, APIs), CloudWatch + OpenTelemetry traces, per-cell dashboards (latency, errors, punches
  per minute, queue depth), alerts to a phone, a public status page.
- Backups: Aurora point-in-time restore (35 days), daily copies to Hyderabad, a monthly restore drill; one company can
  be restored by its schema.
- Load test before launch and before each new cell size: 1 000 punches / s with selfies (k6).

### 20.10 Rough monthly cost (AWS, before discounts; to refine with real usage)
- Launch (global + 1 cell, up to 50 000 users): about ₹60 000 – ₹1 20 000 / month.
- Each further cell (~2 000 companies): about ₹1.5 – 2.5 lakh / month, plus S3 and messaging by volume. At the target,
  infrastructure should stay around 3–6 % of revenue (2 000 000 users × ₹99 ≈ ₹19.8 crore / month).
- Outside AWS: Razorpay ~2 % per payment (UPI Autopay less), WhatsApp per conversation, SMS OTP per message.

### 20.11 The steps, in order
| Step | Name | What | Done when |
|---|---|---|---|
| **0** | **Before strangers can sign up** (the step before) | §19.21 live checklist; photos to S3; staging + production on AWS Mumbai (one cell); https domain; Play Store app with a locked server address; Sentry, backups, status page; legal pages + DPDP consent; load test; the founder checklist in §11 (domain, AWS, Razorpay KYC, Play organisation account, WhatsApp) | CarTrends runs on it as company #1 |
| 1 | **Self-serve + payments** (Phase 8) | Accounts + memberships, mobile OTP, sign-up, schema pool, invite links, templates, Billing screen, Razorpay, GST invoices, trial/dunning state machine, entitlements, owner console | A stranger signs up, invites 10 people and pays without our help |
| 2 | **Ready for many companies** | `SET LOCAL` + PgBouncer, Redis, outbox → SQS (no polling), batched reminders, per-company limits, cell router + a second cell, moving a company between cells, canary deploys | Load test with 10 000 companies over 2 cells |
| 3 | **Millions** | Cells added by automation, readers for reports, data lake, enterprise (SSO, audit export, dedicated cell, custom domain), DR drill, SOC 2 | 50 cells, 99.9 % uptime |

### 20.12 Founder decisions
1. **Free plan?** Notion grew with one. Proposal: free for up to 5 users, Attendance only; or trial only.
2. **One account in many companies** (switcher): recommended yes. It changes sign-in (mobile/email are global; an
   employee ID needs the company code). **Approved by the founder on 2026-10-19** ("proceed with this login id and
   multiple user plan").
3. **Sign-in for new users**: mobile OTP + password (recommended), plus Google sign-in and email. **Approved by the
   founder on 2026-10-19** (mobile/email + code, as built in §21). Free plan: up to 3 users (§21).
4. **Redis/Valkey** from step 2 (replacing §14's "no Redis" for scale).
5. **Invoices**: our own GST invoices from the Platform (recommended: full control) or Razorpay's invoices.
6. **Prices** (§9), minimum seats, annual discount, and the legal entity + GST state that sells.

---

## 21. Step 1 built for testing: Notion-style sign-up, onboarding and billing with a fake payment gateway (2026-10-14)

Founder: "implement the whole Notion login and onboarding type architecture so I can test with a fake payment gateway and
the complete process; after I test it we can make changes or execute it." This builds §20 step 1 locally. The §20.12
decisions are not taken yet, so the recommended answers are used and everything that is a business choice is data
(plans table, env), easy to change after testing:

| §20.12 decision | Used for testing |
|---|---|
| 1 Free plan | Yes: **Free**, up to 3 users (founder, 2026-10-14), Tasks app (Tasks + Attendance); no Assets |
| 2 One account, many companies | Yes: `accounts` + a company switcher |
| 3 Sign-in for new users | Mobile number or email + one-time code (OTP) + password; OTP sender is **fake** (code shown on screen and in the Platform log in dev) |
| 4 Redis | Not needed yet |
| 5 Invoices | Our own GST invoices (CGST+SGST in the seller's state, else IGST), numbered per financial year |
| 6 Prices | §9: Tasks ₹99, Assets ₹79, Suite ₹149 per user per month; yearly = 10 × monthly (2 months free); paid plans min 5 seats; trial 14 days of Suite, no card; seller state `SELLER_STATE` (default Maharashtra), GSTIN `SELLER_GSTIN` |

### 21.1 What exists after this step
- **Accounts** (global person: email and/or mobile, password, staff flag) and **memberships** (= a `people` row with
  `account_id` in each company). Admin-made logins (username / employee ID, §13) keep working unchanged.
- **Sign-up** `/signup`: email or mobile → code → name + password → company (name, team size, industry, state, apps) →
  "Setting up your company…" (company + owner + apps provisioned) → Home with a **Getting started** checklist.
- **Sign-in**: an account with several companies chooses one; **company switcher** in the account menu; **New company**.
- **Invites**: links per company (role(s) and apps chosen, expiry, max uses, revocable) from Admin → People;
  `/join/<token>` signs in or signs up, then joins. Forgot password by code.
- **Billing** (owner, or "Manage billing"): plans, monthly/yearly, seats, GST details, checkout through the **gateway
  interface** (`FakeGateway` now; `RazorpayGateway` later, same webhooks and states), invoices (printable, GST),
  change seats (increase pro-rated onto the next invoice), cancel at period end / resume.
- **Fake gateway** `/billing/pay/<session>` ("FakePay · test mode"): amount with GST, UPI/Card/NetBanking look,
  **Pay**, **Fail**, **Cancel**. Its result reaches the Platform as a signed webhook, exactly as Razorpay's would.
- **Subscription states** `trialing → active → past_due (7 days) → read_only → suspended`, plus `cancelled` (until the
  period ends, then Free if it fits, else read_only). Read-only: everyone can look and export, nobody can change
  anything (Platform, Tasks and Assets refuse writes with 402 from a token claim). Suspended: only the owner can sign
  in, straight to Billing. Banners show trial days left, failed payment, read-only.
- **Dev tools** (only with `BILLING_DEV_TOOLS=1`, on in `npm run dev`): on the Billing page, *advance the billing clock*
  N days (per company) and *simulate the next renewal* succeeding or failing, so a month or a failed payment can be
  tested in a minute.
- **Owner console** `/console` (FreeFounders staff accounts only): totals (MRR, trials, past due, companies), companies
  with plan, state, seats, MRR; extend a trial, change plan/seats (complimentary), suspend/reactivate.
- Existing companies (demo/CarTrends, test companies) get the plan **Complimentary** (active, no billing) so nothing
  changes for them.

### 21.2 API (Platform, under `/api/platform`; the web uses only these)
Public:
- `POST signup/start {identifier}` → `{otpId, channel: 'email'|'sms', devCode?}` (devCode only when `OTP_DEV_ECHO=1`)
- `POST signup/verify {otpId, code}` → `{signupToken, accountExists}` (token proves the identifier for 30 min)
- `POST signup/complete {signupToken, fullName, password, company: {name, teamSize, industry, state, apps}}` → the
  sign-in response (tokens) + `companyId`. An existing account must give its password.
- `POST auth/login` also accepts an account's email/mobile; several companies → `{chooseCompany: [{companyId, name,
  code, role}], ticket}`, then `POST auth/login {ticket, companyId}` → tokens.
- `POST auth/forgot {identifier}` → `{otpId, channel, devCode?}`; `POST auth/reset/verify {otpId, code}` → `{ok}` (checks
  the code without using it up; a wrong one counts as a try); `POST auth/reset {otpId, code, newPassword}`
- A code asked for too soon: 429 `{message, retryAfterSeconds}` (sign-up and forgot share the per-identifier limits)
- `GET invites/:token` → `{companyName, roles, apps, expiresAt, valid}`; `POST billing/webhook/:gateway`
Signed in:
- `GET auth/companies` → `[{companyId, name, code, role, current}]`; `POST auth/switch {companyId}` → tokens;
  `POST companies {name, teamSize, industry, state, apps}` → tokens for the new company
- `POST invites/:token/accept` (signed-in account) or `POST invites/:token/accept {signupToken, fullName, password}`
  (new account) → tokens for that company
- Manage people: `GET invites`, `POST invites {roleIds, apps, expiresInDays, maxUses}` → `{id, token, url}`,
  `DELETE invites/:id`
- Billing (owner / `platform.billing.manage`): `GET billing` → `{plan, interval, state, trialEndsAt,
  currentPeriodEnd, cancelAtPeriodEnd, seats: {used, paid, limit}, nextCharge: {date, lines, subtotal, tax, total} |
  null, profile, devTools, now}`; `GET billing/plans`; `PUT billing/profile {legalName, gstin, state, address,
  email}`; `POST billing/checkout {plan, interval, seats}` → `{sessionId, checkoutUrl}`; `GET billing/checkout/:id`
  → `{plan, interval, seats, lines, subtotal, cgst, sgst, igst, total, companyName, status}`;
  `POST billing/fake/:id/complete {outcome: 'success'|'failure'|'cancel'}`; `POST billing/seats {seats}`;
  `POST billing/cancel`; `POST billing/resume`; `GET billing/invoices`; `GET billing/invoices/:id` (all fields of a
  GST tax invoice); dev: `POST billing/dev/advance {days}`, `POST billing/dev/renew {outcome}`
- Staff: `GET console/summary`, `GET console/companies`, `POST console/companies/:id/trial {days}`,
  `POST console/companies/:id/plan {plan, seats}`, `POST console/companies/:id/status {status}`
- `GET auth/me` adds `account: {id, email, mobile, isStaff} | null` and `billing: {plan, state, trialEndsAt,
  readOnly, daysLeft} | null`. Access tokens carry `ro: true` while read-only.
Amounts are integers in paise. Errors: 402 for plan/seat/read-only limits with a message for the person.

### 21.3 Tables (Platform, migration 0009+)
`accounts`, `otp_codes` (hash, target, purpose, expiry, attempts), `people.account_id`, `invites`, `plans`,
`subscriptions` (company, plan, interval, state, seats, trial_ends_at, current_period_start/end, cancel_at_period_end,
clock_offset_days for dev), `checkout_sessions`, `invoices` + `invoice_lines` (number per financial year, seller and
buyer GST details, CGST/SGST/IGST), `payments`, `billing_events` (gateway event id unique: idempotent),
`billing_profiles`, `seat_changes` (pro-rata add-ons for the next invoice).

**Status 2026-10-14:** built and tested locally. Platform 105, Tasks 849, Assets 91, core 9, smoke 10/10, e2e 61/61 (new
`e2e/web-signup-billing.spec.ts`: sign up → checklist → invite + join → Suite via FakePay → GST invoice → past due →
read-only 402 → pay again). Free = 3 users; new-account password minimum 6 (same as admin-made logins). Sign-up
provisioning takes ~12 s locally (Tasks schema ~10 s): the §20 schema pool will remove that wait. Not yet: real OTP
(SMS/WhatsApp/email), Razorpay, CAPTCHA, invoice email/PDF file, daily seat snapshots.

**Status / fixes 2026-10-19 (quality pass after the founder's failed reset):** the founder's reset code was never
created (the resend throttle answered "Wait a few seconds…", easy to miss), and step 2 moved on without checking the code.
- Forgot password: the code is checked on its own step (`POST auth/reset/verify`; the server's message on a wrong or
  expired code, "Ask for a new code" when it is used up); after "Password changed" the person is signed in at once with the
  new password (choose-company step for several companies; a plain "Sign in" button if that fails). A username / employee
  ID is told its admin resets it; the email of an admin-made login is told (after the code) to ask its admin; an unknown
  email gets the same answer until the code, then "no FreeFounders account… sign up instead".
- Resend: the server returns `retryAfterSeconds` with every "too soon / too many" 429 and says the time in its message;
  sign-up, forgot and join show a live "You can ask for a new code in 24 s" instead of the vague line, and the resend
  link counts down from what the server said. Going Back and Continue with the same email / mobile reuses the code
  already sent (no needless 429). A resend error on the code step was invisible on /forgot: now shown.
- Sign-up with an existing account (password only) failed with "Enter your name" after the company step: the name is only
  required for a new account now (sign-up and invites).
- Billing → GST details could not be saved by an account made with a mobile number (its billing email was null and Save
  crashed silently): fixed.
- Invite links say why they do not work (expired / switched off / used up, `GET invites/:token` → `reason`, `message`;
  410 with the same text); a mistyped link says so; the "not in your plan" message names the app.
- Seat limit messages by plan: Free ("The Free plan is for up to 3 users… upgrade in Billing"), trial, paid seats.
- Sign-in: the field says "Email, mobile, username or employee ID"; wrong password: "The email, mobile number, username
  or password is not right. Check them and try again." The choose-company step is one shared component (sign-in and
  reset) and says when its 5-minute choice has timed out.
- "Setting up…" lists only the chosen apps and Admin + Member (not the old Owner/Manager roles), and after 20 s says it
  can take up to a minute. If an app cannot be set up the person is still signed in with a warning
  (`setupIncomplete: true`) and the Platform retries the set-up after 30 s, 2 min and 10 min (`company -- sync` remains
  the fallback).
- The account menu shows "Owner" for the owner (not the Admin role they also hold); /billing shows "Admin" in the header.
- Dev only: with `OTP_DEV_ECHO=1` codes asked for from this machine's loopback address are not counted per network (all
  browser tests come through the dev gateway from one address); production keeps `OTP_IP_LIMIT`.
- Tests: Platform +4 (reset/verify, retryAfterSeconds, admin-made / unknown / username forgot, existing account without a
  name) and invite reasons; new `e2e/web-account-flows.spec.ts` (11: mobile sign-up with wrong code / Back / countdown /
  Tasks only, the same mobile → 2nd company, sign-in by mobile → choose → switch and back → reload → sign out, forgot →
  signed in, unknown email + live wait, admin-made email 409 path, switched-off / used-up invites, billing FakePay
  fail / cancel / yearly / seats / cancel→resume / GST with IGST, owner console suspend → reactivate, 390 + 320 px).
- `company -- reset` deleted the Platform people but left their records in Tasks / Assets when run without the apps'
  addresses (the documented `npm --prefix services/platform run company -- reset …` sets none): it now uses the
  `npm run dev` addresses by default and refuses to run if an app of the company has no address. The 28 Tasks users and
  19 Assets users left behind by such a run were removed.
- The punch-in e2e tests answer the uniform question when the company asks it (DEMO has "Ask and record" on).
- Results: Platform 112 pass, core 9, web rules + typecheck + build clean, smoke 10/10, e2e 74: full run 69 pass + the 5
  punch tests (uniform dialog) pass after that fix (8/8 for web-app-shell + web-hr); DEMO reset to the owner afterwards.

### 21.4 Razorpay ready (2026-10-21)

> **Replaced by Cashfree on 2026-10-24 (§21.10).** Razorpay was removed from the code, the env, the deploy scripts and
> the screens; this section is kept as history. A server `.env` that still says `BILLING_GATEWAY=razorpay` only
> switches payments off (logged, 503 on pay), it never crashes.

Founder: "Razorpay I want to add in this; I will give you the access token later; make it ready for that." Razorpay is
now a complete gateway behind the same interface as FakePay (`services/platform/src/billing/`), switched on by env.
**Adding the keys is the only step left** (infra/deploy/README.md "Switching on Razorpay": `set-razorpay.sh`).

**Switch (Platform env, checked at start-up, `gateway.ts → gatewayConfig`)**: `BILLING_GATEWAY=fake|razorpay`,
`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`. Default `fake` in dev and on the open demo
(`DEMO_MODE=1`); a production build without `DEMO_MODE` accepts only `razorpay`. A missing / malformed value → one clear
error line in the log (`Payments are OFF (checkout answers 503): …`, names of the missing variables, never a value),
`POST billing/checkout` answers **503 "Payments are not set up yet"**, the Billing page says so and disables
*Continue to payment*; sign-in, the apps and the rest of Billing keep working.

**How our billing maps onto Razorpay Subscriptions** (plain HTTPS + Basic auth, no SDK; `razorpay.gateway.ts`):
- **Plans**: one Razorpay plan per (our plan, monthly/yearly, price per user **with GST**), created on first use and cached
  in the new `gateway_plans` table (unique on gateway + plan + interval + unit price + amount), so a price change makes a
  new Razorpay plan and running subscriptions keep theirs. Tasks ₹99 → ₹116.82 per user per month at Razorpay.
- **Checkout** (`POST billing/checkout` → `{sessionId, checkoutUrl: /billing/pay/<id>, gateway}`): a Razorpay
  subscription with `quantity` = seats, `total_count` 120 months / 10 years, `start_at` = end of the first paid period,
  `expire_by` = the checkout's 1 h, and **one upfront add-on = our checkout total** (GST included; upgrade credit and
  pending pro-rata seat lines already in it). Razorpay's rule "future start + upfront amount → only the upfront amount
  is charged at authorisation" makes the first charge exactly our total; every renewal is plan amount × quantity.
  `notes {companyId, sessionId}` on the subscription and the payment. A total under ₹1 (a credit covers it) is refused.
- **Pay step** (`/billing/pay/<id>`, `GET billing/checkout/:id` adds `razorpay: {keyId, subscriptionId, amount, name,
  description, prefill {name, email, contact} from the billing profile / the person, notes, callbackPath}`): *Pay* loads
  `checkout.razorpay.com/v1/checkout.js` (only on this page) and opens Checkout. Success → `POST billing/razorpay/verify`
  `{sessionId, razorpay_payment_id, razorpay_subscription_id, razorpay_signature}`: HMAC_SHA256(payment_id + "|" + **our**
  subscription id, key secret), constant-time compare, then the same store-once/apply handler as webhooks (event id
  `checkout_<payment id>`): checkout paid, plan active, our GST invoice. Failure: Razorpay's reason + "You can try again"
  (the checkout stays open); closing the window: "Nothing was charged".
- **Phone app**: Checkout runs in redirect mode (`callback_url`): Razorpay posts the handler fields to the public
  `POST billing/razorpay/callback?session=` (signature is the proof; CSRF header exempt like webhooks), which answers 303
  to `/billing/pay/<id>?result=paid|failed`. The shell keeps `https://*.razorpay.com` pages inside (frames too), keeps the
  bank's 3-D Secure pages inside while a payment is on (until back on the server), and opens UPI apps for `upi://…` and
  Android `intent://…#Intent;scheme=upi;…` links (converted to `upi://`, also from Razorpay's frame) — `protocol.ts`
  `isPaymentPage`, `paymentStep`, `upiAppUrl`, with tests.
- **Webhooks** (`POST billing/webhook/razorpay`, X-Razorpay-Signature = HMAC_SHA256(raw body, webhook secret),
  constant-time; event id from X-Razorpay-Event-Id, stored once in `billing_events`), the source of truth:
  `payment.captured`, `subscription.authenticated/activated` with the upfront payment, or `subscription.charged` while the
  checkout is open → that checkout is paid (no-op when verify got there first); `subscription.charged` / `invoice.paid`
  later → **renewal**: new period from Razorpay's `current_start/current_end` (or the invoice's billing dates), our GST
  invoice with the pro-rata seat lines, payment (counted once per Razorpay payment id); `subscription.pending/halted` →
  **past_due** (then read_only after 7 days, suspended after 30, as before), a later charge → active again;
  `subscription.cancelled/completed` → cancelled at the period end; `payment.failed` on an open checkout → recorded, the
  checkout stays open. Anything else is stored and ignored. Without its keys the endpoint answers 503 (Razorpay retries).
- **Without webhooks** (the http demo: Razorpay sends webhooks only to public https on port 443) the billing clock looks a
  renewal up after the period end (`GET subscriptions/:id`, `GET invoices?subscription_id=`): paid → recorded like the
  webhook; pending/halted → past_due; nothing yet → waits up to 2 days, then past_due.
- **Seats**: more → `PATCH subscriptions/:id {quantity, schedule_change_at: cycle_end}` + an add-on with the pro-rata
  amount incl. GST on the next Razorpay invoice (= our pro-rata line on the next GST invoice); fewer → quantity from the
  next cycle. Razorpay cannot update UPI AutoPay / e-mandate subscriptions: then nothing changes and the owner is told to
  choose the plan again with the new number (unused time is credited); the paid new subscription cancels the old one.
- **Cancel** → Razorpay subscription cancelled at once (no more charges), our plan runs to the period end, then Free /
  read-only as before. **Resume** is not possible at Razorpay (a cancelled subscription cannot restart): the Billing page
  says "choose it again under Plans: the unused days are credited" instead of the Resume button (`canResume: false`).
  Dev tools' simulated renewals are refused for Razorpay plans.
- **GST**: amounts sent to Razorpay are the tax-inclusive totals from our GST logic (`gst.ts`); **our GST invoice stays the
  tax invoice**; Razorpay's subscription invoices/receipts are payment records only. A renewal whose charged amount differs
  from our invoice (paise rounding, or a change Razorpay was not told about) is logged.
- **Gateway / server**: CSP (Report-Only) in `infra/deploy/Caddyfile` and `infra/gateway/Caddyfile` allows
  `script-src https://checkout.razorpay.com`, `frame-src`/`connect-src https://api.razorpay.com https://*.razorpay.com`,
  `form-action https://api.razorpay.com`; `Permissions-Policy payment=(self api/checkout.razorpay.com)`; COOP
  `same-origin-allow-popups` (bank popups). docker-compose: the platform alone joins a new `egress` network to reach
  `api.razorpay.com`; the env passes `BILLING_GATEWAY` + the three keys from `FF_HOME/.env`.

**Tables** (migration `0012_razorpay`): `gateway_plans`; `checkout_sessions.gateway_ref` (sub_…) + `gateway_data`
(plan id, `start_at`); `subscriptions.gateway` + `gateway_subscription_id`.

**Tests**: Platform 125 (113 + 12 in `src/razorpay.test.ts` against a local Razorpay stand-in, no network: config and
missing keys → 503 with the app running; plan creation + caching; checkout body; verify good / bad / another
subscription; webhook signature good / bad / tampered; duplicate event ids; webhook-only payment; failed attempt keeps
the checkout; redirect callback; renewal → period + invoice, `invoice.paid` duplicate ignored; pending / halted → past_due
→ active; cancelled; seats with add-on + UPI refusal; cancel / resume / buy again cancels the old one; billing clock
look-up paid / waiting / halted); web rules + typecheck + build; phone app typecheck + 24 unit tests (2 new). No e2e or
smoke against a real gateway.

**When the keys arrive (founder)**: Razorpay Dashboard (Test mode) → API Keys → Key ID + Key Secret; on the server
`bash /opt/freefounders/app/infra/deploy/set-razorpay.sh` (Key ID, then the secret hidden, webhook secret empty for now);
check the platform log; pay once with a Razorpay test card / UPI ID. With a domain + https: add the webhook
`https://<domain>/api/platform/billing/webhook/razorpay` with the events listed in the README and the stored secret.
Live keys only after KYC, with `DEMO_MODE=0` and https.

### 21.5 Usernames for accounts (2026-10-21)

Founder: a self-signed-up person typed their display name "test" at sign-in and got "not right"; "can you say that username
already exists, like that?" Accounts now have a **username** next to their email / mobile.

- **Table** (migration `0013_account_usernames`): `accounts.username` text, nullable, stored lower-case, unique index
  `accounts_username_uq` on `lower(username)`. Existing accounts get none (they add one on /account); nothing else changed.
- **Rules** (`services/platform/src/accounts/username.ts`): 3–30 characters, letters / digits / `.` / `_` / `-`, starts
  with a letter (never all digits, no `@`); reserved words refused (admin, owner, support, staff, root, system,
  freefounders, api, …; the existing admin-made login `owner` keeps working). **One namespace**: free only if no account,
  no admin-made login (`logins.username`) and no employee ID uses it (case-insensitive), checked in the transaction under
  an advisory lock per name + the unique index. Admin-made login creation / rename refuses an account's username (409, same
  message); an employee ID equal to one is refused (400).
- **API**: `GET auth/username-available?u=` (public, 60 per minute per IP) → `{available, reason?: taken|invalid|reserved,
  message}` ("This username is already taken. Try another." / "Use 3–30 letters, numbers, dots, - or _, starting with a
  letter." / "This username is reserved."); `signup/complete` and invite accept take `username` (required for a new
  account) → 409 `{field: 'username', message}` when taken at submit (the sign-up token is not used up); `PUT
  auth/username {username}` for a signed-in account; `auth/me` → `account.username`.
- **Sign-in**: not an email / mobile → `accounts.username` first, then admin-made username → employee ID; same 401 text and
  timing on failure; several companies → choose company as before.
- **Web**: sign-up "About you" and join for new people have a **Username** field (suggested from the name: "test" → test,
  "Asha Rao" → asha.rao, digits added when taken; live check after 400 ms: "Available" or the message; Continue disabled
  until it is free); /account has a Username card (add / change); a failed sign-in adds "Signed up yourself? Use the
  email, mobile number or username you chose."
- Docs: `docs/LLD-registration-login.md` §4.7, `docs/LLD-signin-flow.md`, `docs/security/platform.md` §7.

**Status 2026-10-21:** Platform 135 pass (10 new: availability valid / taken across both tables + employee ID / reserved /
invalid, sign-up with username, 409 incl. case variants and a `logins.username` clash, the unique index, sign-in by
username incl. choose company, change username, admin login create / rename and employee ID refusing an account's name,
invite join with a username, the per-IP limit); core 14 (3 new); web rules + typecheck + build; smoke 10/10; e2e
web-account-flows 12/12 (1 new: suggestion, "already taken", reserved, invalid, sign up, sign in by username with the
hint, /account change refused), web-signup-billing + single-login + web-admin 19/19; DEMO reset to the owner afterwards.
On the server the migration runs with the next deploy; the founder's existing accounts get no username until they add one.

### 21.6 Company names are unique (2026-10-21)

Founder reported as a bug: a second sign-up (another account) also created "testcomp" (code TESTCOMP2). Decision:
company names are unique across the product.

- **Rule** (`services/platform/src/company/company-name.ts`): compared trimmed, inner whitespace collapsed, lower-case;
  2–80 characters; every company counts. Checked in the transaction under an advisory lock per normalised name in
  `signup/complete`, `POST companies`, `PATCH company` (only when the name really changes) and the CLI `company --
  create` → 409 `{field:'companyName', message: 'A company called "<name>" already exists. If you work there, ask its
  owner for an invite link.'}`. No unique index and no migration: the existing duplicates (two "testcomp" on the server)
  stay untouched and keep working.
- **API:** `GET companies/name-available?n=` (public, 60 / min per IP) → `{available, reason?: taken|invalid, message}`;
  `rename=1` with a sign-in counts the caller's own company as free (Settings).
- **Web:** live check (400 ms) under Company name on the sign-up company step, /new-company and Admin → Settings;
  Create / Save disabled while taken / invalid / checking; a 409 at submit returns to the field with the message.
- Docs: `docs/LLD-registration-login.md` §4.8.

**Status 2026-10-21:** Platform 142 pass (7 new: availability incl. case / spacing variants and length, sign-up 409 with
nothing used up, New company 409 incl. the caller's own name, rename 409 + own name allowed, concurrent sign-ups → one
wins, existing duplicates still sign in and save Settings, per-IP limit); core 17 (3 new); web rules + typecheck + build;
smoke 10/10; e2e web-account-flows + web-signup-billing + settings 16/16 (web-account-flows: a second sign-up typing an
existing company's name in another case / spacing sees the message, Create disabled, then a free name continues); DEMO
reset to the owner afterwards.

### 21.7 Switch to Free from Billing; owner console actions logged (2026-10-23)

**Free without payment** (`POST billing/free`, owner / Manage billing; `BillingService.switchToFree`). Same rule as trial
end / cancel → Free (`freeFit`): at most the Free plan's 3 users in use and no active person holding an app Free lacks.
- trialing, past_due, read_only → **Free now** (read-only ends; a Razorpay subscription behind a past-due plan is cancelled
  there, like Cancel); an active paid plan → **cancelled at the end of the paid period**, then Free by the billing clock
  (Razorpay cancelled at once, as Cancel does); already cancelled → nothing more; Free / Complimentary / suspended → 400.
  The answer is the Billing view + `freeFrom: 'now' | 'period_end'`. Free switches Assets off for the company
  (`applyEntitlements`, nothing deleted).
- Does not fit → 400 "The Free plan is for up to 3 users using Attendance and Tasks. Switch off N people [and the Assets
  app] first (Admin → People: take Assets away from the K people who have it)." The company has no switch of its own for
  an app, so the hint says where. **For the founder:** the owner of a trial that chose Assets holds Assets, so they must take
  it away from themselves first; if an explicit "Switch to Free" should simply switch Assets off (the dialog already says
  so), that is a one-line change in `switchToFree`.
- Web Billing: the Free card's button is **Switch to Free** with a confirm dialog saying what happens (now / on the period
  end date, 3 users, Assets off, nothing charged); no FakePay / Razorpay step; the server's message shows under the card.

**Staff audit log** (migration `0014_staff_audit`: `staff_audit` id, at, staff_account_id + staff_email, action,
company_id + company_code, details jsonb `{input, before, after}` with plan / state / seats / trial end, ip). Every
mutating console endpoint writes one row after it succeeded (`ConsoleController` → `consoleAction`): `trial.extend`,
`plan.set`, `company.suspend`, `company.reactivate`; a failed one writes nothing. `GET console/audit?company=<id or
code>&action=&page=&pageSize=` (staff only, newest first, 25 a page; `&export=xlsx|csv` = every matching action as a file).
/console has **Recent actions** (filters by company and action, pager, Download).

**Status 2026-10-23:** Platform 150 pass (new: Free now from a trial with Assets switched off and again refused; the
doesn't-fit messages (people / Assets / both, then fits once Assets is off); active paid → period end → Free; past due and
read-only → Free now, new tokens not read-only; Razorpay active → cancelled there + period end, Razorpay past due → Free now
+ cancelled there; every console action writes one row with input / before / after / staff / ip, failed actions none,
non-staff 403, filters by id / code / action, pages, bad action 400, CSV download staff only); web rules + typecheck +
build; e2e web-account-flows checks Recent actions after suspend / reactivate. The Word feature list was not rebuilt (it
was renamed to `docs/Kaampilot_Feature_List.docx` meanwhile); its four "To check" rows (Switch to Free, Action log,
Selfie optional, leave balance) are now live.

### 21.8 MSG91 codes + sign in with a code (2026-10-23)

**Delivery by MSG91** (founder: "read the MSG91 API doc and implement the OTP authenticator"). Our server still makes and
checks every code (6 digits, sha256 stored, 10 minutes, 5 tries, 30 s gap, 5 per identifier and `OTP_IP_LIMIT` per IP
per 15 minutes); MSG91 only delivers it. `OTP_SENDER=fake|msg91` (default fake), env read on every send
(`accounts/otp-senders.ts`), one startup line like payments: `One-time codes: MSG91 (…)` or `One-time codes are OFF
(sending answers 503): OTP_SENDER=msg91 but MSG91_AUTHKEY … not set`; the server never fails to start.
- **SMS** = MSG91 **SendOTP** (docs.msg91.com/otp/sendotp): `POST https://control.msg91.com/api/v5/otp?template_id=
  <MSG91_SMS_TEMPLATE_ID>&mobile=91XXXXXXXXXX&otp=<our code>&otp_length=6&otp_expiry=10`, header `authkey`, JSON body
  `{app: "Kaampilot", minutes: "10"}` (extra template variables). Chosen over the Flow API (`POST /api/v5/flow`,
  `recipients[].mobiles` + `VAR1…`) because SendOTP takes our own code as a documented field (`otp`), uses MSG91's OTP
  route and needs no sender ID in the request (the OTP template carries the sender ID and DLT template ID). MSG91's
  Verify / Retry endpoints are never called. Success `{request_id, type:"success"}`; errors are HTTP 200 with
  `type:"error"` (checked), 401 without / with a bad authkey.
- **Email** = MSG91 **Email API** (docs.msg91.com/email/send-email): `POST /api/v5/email/send` with `{recipients:[{to:
  [{email}], variables:{otp, minutes, app, purpose}}], from:{name: MSG91_EMAIL_FROM_NAME or "Kaampilot", email:
  MSG91_EMAIL_FROM}, domain: MSG91_EMAIL_DOMAIN or the From domain, template_id: MSG91_EMAIL_TEMPLATE_ID}`; template
  variables `{{otp}}` `{{minutes}}` `{{app}}` `{{purpose}}` (sign in / finish signing up / reset your password). Without
  the email template + From: email codes stay on the fake sender on a dev machine or with `DEMO_MODE=1`, and answer 503
  "Codes by email aren't set up yet. Use your mobile number instead." in production (SMS likewise since 2026-10-24, below).
- **WhatsApp**: not built (MSG91 needs an integrated WhatsApp number and a Meta-approved authentication template; not
  trivial). **Voice / MSG91 retry**: not used (our resend sends a new code).
- **Failures**: 10 s timeout. A refused send (HTTP 4xx or `type:"error"`) → 400 "We couldn't send the code. Check the
  number and try again." (email: "…Check the email address…"); no answer / 5xx / 429 → 503 "We couldn't send the code
  right now. Try again in a minute."; 401/403 (bad authkey, IP not whitelisted) → 503 "Codes can't be sent right now…"
  and the log says to check `MSG91_AUTHKEY` and the IP whitelist. The `otp_codes` row gets `failed_at` (migration
  `0015_otp_send_failed`): never usable, **not counted** against the person's 30 s gap / 5 per 15 minutes (they never
  got it), still counted per IP (abuse guard).
- **Logs**: MSG91's request id, the channel, purpose and a masked target (`******3210`, `as***@domain`); never the
  code, the authkey or the request URL (the code is in SendOTP's query string). Provider messages are cut to 200
  characters with digit runs removed.
- **Echo**: unchanged rule: the code comes back (`devCode`, "Test mode" note) only with `OTP_DEV_ECHO=1` outside
  production, or with `DEMO_MODE=1`. Production with `DEMO_MODE=0` never echoes. On the server `DEMO_MODE` stays 1 until
  the founder decides (codes then go by MSG91 and are still shown on screen).

**Sign in with a code** (the "OTP authenticator" for people): /login → **Sign in with a code instead** (a link, so
"Sign in" stays the only button of that name; opens `/login?code=1`, keeps `?next`) → email or mobile of an account →
**Send code** → `POST auth/login/code/start {identifier}` (purpose `login`; the same answer whether or not an account
exists: a real code is sent, like forgot password) → "Enter your code" (code field, test-mode note, live resend
countdown) → **Sign in** → `POST auth/login/code/verify {otpId, code, client}` → the same result as a password sign-in
(tokens + refresh cookie, or `{chooseCompany, ticket}` then `auth/login {ticket, companyId}`; suspended companies:
owners only). The per-IP sign-in guard applies and a wrong code counts like a wrong password; 5 tries per code. A
username / employee ID → 400 "Codes go to the email or mobile number of a Kaampilot account. With a username or employee
ID, sign in with your password." (also checked on the screen). After the code: no account → "There is no Kaampilot
account…"; the email of an admin-made login → "This email signs in with a login your company admin made. Sign in with
your password instead." "Use your password instead" goes back.

**Server switch**: `infra/deploy/set-msg91.sh` (authkey with `read -s`, OTP template ID, optional email template / From /
domain → `/opt/freefounders/.env`, `OTP_SENDER=msg91`, recreates only the platform container; `--off` = fake again);
`docker-compose.yml` passes `OTP_SENDER` + `MSG91_*`; `infra/deploy/README.md` "Switching on MSG91 codes" lists what to get
from MSG91 (authkey; DLT entity + sender ID + DLT-approved template `Your Kaampilot code is {#var#}. It is valid for 10
minutes. Do not share it with anyone.`, entered in MSG91 as an OTP template with `##OTP##`; email domain + template; the
server IP 52.66.83.8 if IP whitelisting is on).

**Files**: `services/platform/src/accounts/msg91.sender.ts`, `otp-senders.ts`, `otp.service.ts` (`OtpSendError`,
`canSend`, `failed_at`), `accounts.service.ts` / `accounts.controller.ts` (`auth/login/code/*`), `auth/auth.service.ts`
(`loginVerifiedAccount`, `assertIpOpen`, `ipFailed`); `packages/core` (`session.loginWithCode`, `useLoginCodeStart`,
`useLoginWithCode`); `apps/web/src/features/account/code-sign-in.tsx`, `app/pages/login.tsx`. Tests:
`services/platform/src/otp-msg91.test.ts` (a local MSG91 stand-in, no network), `e2e/web-code-signin.spec.ts`.

**Status 2026-10-24:** Platform typecheck + 162 tests pass (new `otp-msg91.test.ts`, 12 tests against a local MSG91
stand-in: SendOTP request shape (authkey header, `mobile=91…`, template id, our code in `otp`, `otp_length` 6,
`otp_expiry` 10, body variables); refused (200 `type:error`, 400) → the plain message, row `failed_at`, asking again works
at once; 500 / no answer within the timeout → 503, five failed sends leave the quota untouched; 401 → 503 + log hint;
missing authkey / template → 503 with nothing stored; email: dev fallback, production 503, then the exact Email API
payload once set up; production never echoes; no code / authkey / full number in the logs; code sign-in: one company →
tokens + cookie, used once; wrong codes count down to "tried too many times"; two companies → choice + ticket;
unknown identifier same start answer then "no account"; username → password guidance; admin-made email → "use your
password"; 30 s gap and the per-IP guard). Web rules + typecheck + build; `npm run smoke` 10 / 10; e2e
`web-code-signin.spec.ts` (new), `single-login.spec.ts`, `web-signup-billing.spec.ts` pass; `web-account-flows.spec.ts`
passes up to its billing test, which times out on FakePay's "Payment successful" (the Pay request was still running
after 5 s while another agent ran the suite; the test does not touch codes; to recheck on a quiet machine).

**Email-only codes (2026-10-24)** (founder: "use email otp for now"; SMS waits for DLT). `OTP_SENDER=msg91` no longer
needs `MSG91_SMS_TEMPLATE_ID`: codes are OFF (503 "Codes can't be sent right now…") only without `MSG91_AUTHKEY` or with
neither the SMS template nor the email template + From. Each channel that is not set up behaves the same way: the fake
sender on a dev machine or with `DEMO_MODE=1`, and in production 503 "Codes by SMS aren't set up yet. Use your email
address instead." (email twin: "Codes by email aren't set up yet. Use your mobile number instead."), with nothing stored.
The three code flows (sign-up, forgot password, code sign-in; also invite links) each take the one identifier the person
types, and all accept an email address, so an email-only setup blocks nobody; nothing requires a mobile code. The web
screens show the channel message on the email / mobile field itself (`channelOff()` in `features/account/parts.tsx`;
red field, announced, cleared on typing) instead of the general error. Startup line names both channels, e.g.
`One-time codes: MSG91 (SMS: OFF (MSG91 SMS not set up); email: MSG91 Email)`. `set-msg91.sh`: the OTP template prompt
is optional ("Enter = skip SMS"), at least one of SMS / email is required, From defaults to `no-reply@mail.kaampilot.com`.
`infra/deploy/README.md` "Switching on MSG91 codes" has the email-only path (MSG91 Email domain `mail.kaampilot.com`
verified through GoDaddy DNS records, template using `{{otp}}` `{{minutes}}`). Tests: `otp-msg91.test.ts` (email-only:
email by MSG91, SMS fake on dev / `DEMO_MODE=1`, 503 with the message in production on all three flows, startup line;
config rules), e2e `web-code-signin.spec.ts` (the message on the field of /signup, /forgot, /login?code=1). Status: Platform typecheck + 180 tests, Tasks 1046, Assets 105, web build,
mobile check, smoke 10 / 10, e2e console-dashboard / account-flows / code-signin / single-login / signup-billing / badges /
app-shell pass (single-login now accepts the ", N pending" badge on the Tasks / Assets links; account-flows waits for the
console's "Done" instead of any "trial" text, which matched the hidden filter option).

### 21.9 Kaampilot console dashboard + production log (2026-10-24)

Founder: "production log, and I want a dashboard for my admin page where we can see the complete users of this
application — I have all the access of the application, I can see the billing and all the things." The owner console
(`/console`, §21.1 / §21.7) became the **Kaampilot console**, for Kaampilot staff (the application owner) only: same
guard (`BillingService.assertStaff`: `accounts.is_staff`, checked in the database on every call, 403 for everyone else,
company owners and admins included); the web screens send anyone else Home and the menu item ("Kaampilot console" in
the account menu) shows only for staff. Read-only: the only changes are the existing ones (extend trial, set plan,
suspend / reactivate), unchanged.

**Screens** (`apps/web/src/features/billing/console*.tsx`, tabs in the URL):
- `/console` **Overview**: Health strip (Platform, Tasks, Tasks worker, Assets: up / down, version, errors in 24 h,
  the worker's last pass); companies (all, paid active, trial, Free + complimentary, past due / read-only, suspended);
  people (in companies, accounts + admin-made logins, active today / 7 / 30 days from sign-ins and session refreshes,
  punch-ins today from the Tasks worker); money and codes (MRR, revenue this month, paid users, failed payments,
  codes sent / failed today, server errors today); sign-ups per day for 30 days (accounts and companies).
- `/console/companies`: every company (name, code, owner, plan, state, users used / paid, MRR, apps + modules off,
  last activity, created), search, plan / state filters, sortable columns, Download; the row menu keeps the staff
  actions; **Recent actions** (staff audit log) below. A row opens `/console/companies/:id`: people (name, sign-in name
  or masked email / mobile, role, active, apps, last sign-in), subscription, GST details, invoices, payments, plan
  changes (checkouts + user changes), staff actions and views, errors in 7 days.
- `/console/users`: every account and admin-made login across companies (name, username, email / mobile partly hidden
  `as***@domain` / `+91******3210`, companies, last sign-in, created, verified account or admin-made, staff), server
  search, pages of 50, Download (masked too); a row opens `/console/users/:kind/:id` (companies with role / apps / last
  session; the last 20 sign-ins with client, IP, device).
- `/console/billing`: revenue by month (12), subscriptions, payments (FakePay and Razorpay, paid / failed, reason),
  invoices; each with Download (xlsx / csv). Refunds happen in the gateway's dashboard (no refund flow yet).
- `/console/logs`: the **production log**: Health strip, filters (service, level, time window, company code), search,
  auto-refresh every 15 s (switch), pages of 50, a detail drawer (request, status, company, user id in that service,
  count, version, redacted stack), Download.
- Phone: every tab fits 320 px (tables become cards); desktop first.

**API** (Platform, `/api/platform`, staff only; `src/console/console.controller.ts`, `console.service.ts`,
`logs.service.ts`): `GET console/overview`, `GET console/health`, `GET console/dashboard/companies`,
`GET console/dashboard/companies/:id`, `GET console/users?q=&page=&pageSize=` (+ `&export=xlsx|csv`),
`GET console/users/:kind/:id` (kind `account` | `login`), `GET console/billing` (+ `?export=xlsx|csv&sheet=subscriptions|
invoices|payments|months`), `GET console/logs?service=&level=&company=&from=&to=&q=&page=&pageSize=` (+ `&export=`).
The older `console/summary`, `console/companies`, `console/audit` and the three actions are unchanged.

**Audit** (privacy): every view of a company's or a person's data writes a `staff_audit` row: `view.company`,
`view.user`, `view.users` (downloads), `view.billing`, `view.logs`, `details.view = true`, at most one row per staff +
action + subject every 10 minutes (auto-refresh does not flood it), never failing the view. Recent actions filters them
too ("Viewed company"…). No password, hash, token or code is ever read by these endpoints.

**Production log** (`platform.service_logs` + `platform.service_heartbeats`, migration `0016_console_logs`):
- **Platform** writes its own entries in-process (`src/console/log-sink.ts`): the exception filter records every 500
  with method, path (no query), company id + code, person id; `ReportingLogger` (the Nest logger) records every other
  `error()` line (events poller, billing clock, provisioning…); key events: `signin.failed_burst` (20 / 100 / 500 / 1000
  failed sign-ins from one address in 15 minutes), `otp.send_failed` (channel, purpose, kind; never the code or target),
  `billing.webhook` (gateway + event type, duplicate or not; never the payload) and `billing.webhook_rejected`.
- **Tasks, its worker and Assets** post to **`POST /internal/logs`** on the Platform (`{service, version, entries[],
  heartbeat?}`), chosen as the cheapest robust way: no new table in the apps, no cross-company query, works for
  errors without a company. The route is outside `/api/platform` (main.ts excludes it from the prefix), so the public
  gateway (which only forwards `/api/platform/*`) never reaches it; anything that arrives through a proxy
  (`X-Forwarded-For`) is refused, and with `LOG_SINK_TOKEN` set the `x-log-sink-token` header must match too. Apps:
  `PLATFORM_LOG_URL` (unset = off, so standalone installs and tests are unchanged). Tasks: `tenancy/log_sink.py` (a root
  `logging.Handler` at ERROR: `django.request` 500s with method / path / company id / user id if already loaded, worker
  `log.exception` as `worker.failed`; daemon thread + bounded queue); the worker sends a heartbeat after each pass
  (results ok / failed / skipped, punch-ins today per company counted inside its existing per-company loop). Assets:
  `src/common/log-sink.ts` (exception filter 500s with method / path / company / actor; `ReportingLogger` for other
  errors).
- **Never blocks or fails a request**: in-memory buffers flushed by timers (apps: 20 entries or 2 s, 3 s timeout, all
  errors swallowed; Platform: inserted on the root pool outside any request transaction, a failed insert is dropped).
  **Rate limits**: apps 60 entries / minute per process, identical entries within 60 s folded into one with `count`;
  Platform 300 / minute per service (`LOG_RATE_PER_MINUTE`).
- **Redaction** (apps before sending, Platform again before storing): `Bearer …`, JWTs, `password= / token= / secret= /
  otp= / code= / authkey= / api_key= / signature= / cookie=` values, SQL `params:`, emails (`a***@domain`), runs of 6+
  digits (codes, mobiles); paths without query strings; messages 500 characters (first line), stacks the last 4000.
  Request bodies, headers and cookies are never read.
- **Retention**: 30 days (`LOG_RETENTION_DAYS`), purged a minute after start and every 6 hours.
- **Health**: `GET console/health` probes Tasks `/health` and Assets `/api/health` (3 s; both now return `version`), the
  Platform's own `APP_VERSION`, the worker's last heartbeat (down after 15 minutes without one) and errors in 24 h.
  `APP_VERSION` is the deployed commit (`ff.sh` sets it from the app folder's current commit; `dev` in `npm run dev`).

**Dev staff login**: `staff@freefounders.test` / `Demo@1234`, shown as "Kaampilot Staff (dev)" (an older dev database
that still says "FreeFounders Staff (dev)" is renamed by the seed on the next start). On a server the staff account
comes from `FF_STAFF_EMAIL` / `FF_STAFF_PASSWORD` (`bootstrap.sh`) or `company -- staff --email` (infra/deploy/README.md
"Kaampilot console").

**Status 2026-10-24:** Platform typecheck + tests (new `src/console-dashboard.test.ts`, 12: non-staff 403 on every
endpoint with nothing audited; overview counts equal the database; punch-ins and Health from the heartbeat, Tasks down;
company list / detail and one deduplicated `view.company` row; users masked incl. the download, detail audited; FakePay
purchase in payments / invoices / months / overview + the four downloads + the webhook in the log; redaction; Tasks
entries stored redacted with the company code, filters, CSV; ingest refused through a proxy / without the token, 404
under `/api/platform`; rate limit; a Platform 500 recorded with its request and the same answer, a failing writer never
throws; 30-day retention). Tasks `tenancy.tests_log_sink` 8 + full suite 1046 OK; Assets `log-sink.test.ts` 6 + full
suite 105; root `npm run web:build` (rules + typecheck + build). New `e2e/web-console-dashboard.spec.ts` (owner 403 and
sent Home; staff Overview + Health, Companies → detail with the audited view, Users masked → detail, Billing, Logs with
the drawer; 390 / 320 px) and `web-account-flows.spec.ts` updated (`/console/companies`, "Kaampilot console"); both
still to run on a dev suite started from this branch (the shared :8080 suite was busy with another agent's e2e run).

### 21.10 Cashfree payments (2026-10-24)

Founder: "use Cashfree" (Kaampilot has a Cashfree merchant account; production keys = App ID + Secret Key), then
"remove Razorpay completely". Cashfree is the only real gateway now, behind the same `PaymentGateway` interface as
FakePay (`services/platform/src/billing/cashfree.gateway.ts`); Razorpay's gateway, tests, `set-razorpay.sh`, env vars,
UI texts, the `gateway_plans` table and `subscriptions.gateway_subscription_id` (migration `0017_cashfree`) are gone.
FakePay stays for dev, tests and the open demo.

**Switch** (`gateway.ts → gatewayConfig`, checked at start-up): `PAYMENT_GATEWAY=fake|cashfree` (`BILLING_GATEWAY`, the
older name, is read only when `PAYMENT_GATEWAY` is empty), `CASHFREE_APP_ID`, `CASHFREE_SECRET_KEY`,
`CASHFREE_ENV=production|sandbox` (default sandbox), optional `CASHFREE_API_VERSION` (default `2026-01-01`, the current
documented `x-api-version`). Missing keys, an unknown value or a leftover `razorpay` → one log line
(`Payments are OFF (checkout answers 503): …`, never a value), checkout and the Cashfree webhook answer **503 "Payments
are not set up yet"**, everything else runs. Keys live only in the server's `.env` (`infra/deploy/set-cashfree.sh`:
App ID, Secret Key with `read -s`, production / sandbox; `--off` back to fake); tests use a local stand-in.

**Why one-time orders, not Cashfree Subscriptions**: Razorpay was used with subscriptions (a mandate charged each
period). Cashfree Subscriptions needs a separately activated product, plan objects and an authorised mandate (UPI
AutoPay / eNACH / card) per customer, with its own states and webhooks; with no Cashfree subscription product on the
account yet, the simplest robust choice is **one Cashfree order per checkout** (purchase, upgrade, renewal). Nothing is
charged by itself: at the end of a paid period the plan becomes `past_due` (the billing clock; no invoice and no fake
"failed charge"), the banner says "The paid period has ended. Pay for the next period in Billing", and paying a new
checkout makes it active again from now (7 days past due, then read-only, as before). An upgrade still credits unused
time; seats added mid-period are charged on the next checkout. A subscription mandate can be added later behind the
same interface without changing the states.

**Flow** (docs: https://www.cashfree.com/docs/api-reference/payments/latest/orders/create, …/orders/get,
…/payments/get-payments-for-order, https://www.cashfree.com/docs/payments/online/web/redirect,
https://www.cashfree.com/docs/api-reference/payments/latest/payments/webhooks,
https://www.cashfree.com/docs/payments/online/webhooks/signature-verification):
1. `POST billing/checkout` prices it (GST included) and calls **Create Order** `POST https://api.cashfree.com/pg/orders`
   (sandbox `https://sandbox.cashfree.com/pg/orders`; headers `x-client-id`, `x-client-secret`, `x-api-version`,
   `x-idempotency-key` = our checkout id): `order_id` `kp_<checkout uuid>` (unique per attempt), `order_amount` =
   paise / 100 in rupees, `INR`, `customer_details` (`customer_id` = the account id without dashes, `customer_phone` =
   the account's mobile as 10 digits, else the placeholder `9999999999` because Cashfree requires a phone and email-only
   accounts have none; email + name when known), `order_meta.return_url` =
   `${PUBLIC_WEB_URL}/billing/pay/<checkout>?order_id=kp_…`, `notify_url` =
   `${PUBLIC_WEB_URL}/api/platform/billing/webhooks/cashfree` (https only), `order_expiry_time` = the checkout's 1 h,
   `order_tags` {sessionId, companyId}. `payment_session_id` is kept on the checkout (`gateway_data`), never logged.
2. `/billing/pay/:id` loads **Cashfree.js v3** (`https://sdk.cashfree.com/js/v3/cashfree.js`, only on this page) and
   calls `Cashfree({mode}).checkout({paymentSessionId, redirectTarget: "_self"})`: same window in browsers and in the
   Android WebView (whose `isPaymentPage` now keeps `https://*.cashfree.com` inside the app; UPI app links still open
   the UPI app). CSP (Report-Only in both Caddyfiles) allows `script-src https://sdk.cashfree.com`,
   `connect-src / frame-src / form-action https://*.cashfree.com`, Payment Request for Cashfree.
3. Back on the return URL the page shows "Checking your payment with Cashfree…" and calls `POST billing/cashfree/check`:
   the server does **Get Order** + **Get Payments for an Order** and applies what Cashfree says (paid → plan active, GST
   invoice, payment row; failed / dropped → a failed payment row, the checkout stays open for another try until it
   expires; expired / terminated → checkout cancelled; still pending → the page asks again every 3 s, 10 times). The
   redirect itself proves nothing.
4. **Webhook** `POST /api/platform/billing/webhooks/cashfree` (also `…/webhook/cashfree`): `x-webhook-signature` =
   base64 HMAC-SHA256(`x-webhook-timestamp` + raw body, Secret Key), constant-time compare, else 400. Types handled:
   `PAYMENT_SUCCESS_WEBHOOK` / `payment.success`, `PAYMENT_FAILED_WEBHOOK` / `payment.failed`,
   `PAYMENT_USER_DROPPED_WEBHOOK`; payload `data.order.order_id`, `data.payment.{cf_payment_id, payment_status,
   payment_amount}`. A success / failure we cannot read in full makes the server look the order up instead. Test
   events, `PAYMENT_CHARGES_WEBHOOK` and unknown types are stored and answered 200.
5. **Idempotent**: the event id is per payment and outcome (`cf_paid_<cf_payment_id>`, `cf_failed_<…>`) for both the
   webhook and the look-up, stored once in `billing_events`; a paid checkout is never applied twice. The amount must
   equal the checkout total (else nothing is applied; `billing.amount_mismatch` in the production log). A payment that
   Cashfree took after we closed the checkout still counts.
6. **Nobody came back** (tab closed, no webhook for a dropped payment): the billing clock (`runAll`, every 5 min) looks up
   open Cashfree checkouts 5 minutes after they expire (up to 3 days back): paid → applied; otherwise the checkout closes
   (failed / cancelled), so nothing stays "paying" forever.

**Logs** (§21.9 production log): `billing.checkout` (order id, amount), `billing.payment` (captured / failed with the
reason, look-ups), `billing.webhook` (type, source, duplicate), `billing.webhook_rejected`, `billing.gateway_error`
(Cashfree status / code / message), `billing.amount_mismatch`; never the Secret Key, `payment_session_id`, payloads or
card / UPI / bank details (never read). The start-up log line shows only the first 6 characters of the App ID.

**Founder's Cashfree dashboard steps** (infra/deploy/README.md "Switching on Cashfree payments"): API keys
(Developers → API Keys); webhook `https://kaampilot.com/api/platform/billing/webhooks/cashfree`, standard HTTP POST,
events Payment success + Payment failed (Developers → Webhooks); whitelist `https://kaampilot.com` (Developers →
Whitelisting → Website URL; needs Contact Us + Terms pages; production only); then `set-cashfree.sh` on the server.

**Status 2026-10-24:** Platform typecheck + full tests (new `src/cashfree.test.ts`, 12, against a local Cashfree
stand-in: env switch incl. a leftover razorpay, rupee / phone conversion; 503 without keys (checkout + webhook); Create
Order request shape + headers + return / notify URLs; paid by look-up then webhook duplicate; paid by webhook (both
type names) then look-up; bad signature / changed body / unsigned → 400, test and unknown events → 200, old route;
failed and dropped keep the checkout open and the clock closes it; nobody came back → found paid by the clock; expired
order → cancelled; amount mismatch refused; another company 404, no secret / session id stored; renewal → past due →
new order → active); `razorpay.test.ts` removed. Mobile protocol tests 12 OK; root `npm run web:build` OK. e2e not
re-run here (the shared :8080 suite belonged to another checkout); `web-signup-billing` (FakePay) is unchanged in
behaviour.

### 21.11 Public policy pages (2026-10-24)

Cashfree whitelists a production website only when it has reachable Contact Us and Terms pages; card networks and
gateways also expect Privacy and Refund / Cancellation policies. The web app now has four public static pages (no
sign-in, no data: `apps/web/src/features/account/legal.tsx`), linked in one line under the sign-in form on every screen
size (`legal-links.tsx`) and at the foot of each page: `/contact`, `/terms`, `/privacy`, `/refunds`. They say
"Kaampilot, operated by CarTrends" and state only what the product does (selfie + GPS punch, data in India, passwords
hashed only, Cashfree for payments with no card / UPI / bank details seen, MSG91 for codes, nothing charged by itself,
cancel at period end).

**Founder to confirm** (written as placeholders until then): the address `support@kaampilot.com` (no support address
existed in the repo; it must receive mail), "Registered office: available on request at support@kaampilot.com" (replace
with the registered address when ready), the "aim to reply within 2 working days" line, and the refund rules: prepaid
per period, cancel any time to stop the next period, no partial refunds; duplicate charges or payments taken but failed
on our side refunded in full, started within 7 working days. Constants `SUPPORT_EMAIL`, `OPERATOR`, `UPDATED` sit at the
top of `legal.tsx`.
