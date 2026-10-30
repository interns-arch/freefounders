# Kaampilot Tasks API (`services/tasks`)

The Tasks API of Kaampilot (Django 6 + Django REST Framework): tasks, leads, groups, notices, links, attendance and
leave, payroll, visitors, mistakes, notifications and the WhatsApp/Gmail/AI intake. It is a copy of the CarTrends
Automation app (`Automation_Task-main`, see the repo's CLAUDE.md for the copied commits), which keeps running on its
own and is never edited from here. **This folder is an API only**: the screens are the Kaampilot web app
(`apps/web`, URLs `/tasks/…`, `/attendance/…`, `/visitors/…`) and the old React frontend was removed in PLAN.md §19.13.

Sections 4–7 and 9 describe the API as it was copied; PLAN.md is the source of truth for what changed since
(single login §13, multi-company §14, roles from the Platform §15/§19.28, Idea board and Web forms removed §19.23,
face attendance replaced by geofence + selfie §19.18, roster §28).

---

## Contents

1. [Features (API)](#1-features-api)
2. [Tech stack](#2-tech-stack)
3. [Run and test](#3-run-and-test)
4. [Roles & permissions](#4-roles--permissions)
5. [Data model](#5-data-model)
6. [API endpoints](#6-api-endpoints)
7. [File-by-file reference](#7-file-by-file-reference)
8. [Environment variables (.env)](#8-environment-variables-env)
9. [How the automations work](#9-how-the-automations-work)

---


## 1. Features (API)

| Area | What it does |
|---|---|
| **Authentication** | JWT login/logout/refresh with token blacklist; change password; sessions survive page reload; deactivated users cannot log in. |
| **Team management** | 7 roles (incl. a dedicated HR Manager), per-role capability matrix, `users.manage` user CRUD (Admin + HR Manager; only an Admin may grant the Admin role) , deactivate — never delete, reporting-manager hierarchy. **My Team** directory visible to every employee (Mobile / Reports To / role badges). |
| **Lead CRM** | Kanban pipeline New → Contacted → Quotation Sent → Negotiation → Won/Lost. Full lead profile (name, phone, email, company, requirement, source, department, priority, follow-up, value). Notes, document uploads, auto-numbered quotations, unified activity timeline. Role-scoped visibility. |
| **Auto-assignment** | Per-department rules: round-robin (Lead 1→Rahul, 2→Amit, 3→Priya, 4→Rahul) or fixed. Skips deactivated users; rotation resets when members change. Admin UI under **Automation**. |
| **Notifications** | One `notify()` entry point fans out to: in-app feed (always) + Gmail + WhatsApp (once credentials exist). Every channel attempt (sent/skipped/error) is recorded per notification. Unread badge, mark-read/read-all. |
| **Follow-up & task reminders** | Background ticker (every 5 min) + `manage.py send_reminders`. One ping per follow-up/due date; re-fires when the date is rescheduled. |
| **AI intake** | WhatsApp Cloud API webhook + Gmail inbox poller → Claude classification (keyword fallback when no key) → match existing lead by phone/email or create new → auto-assign → notify. Admin simulator to test the real pipeline without live credentials. |
| **Task Engine v2 (A+B)** | **Assignment hierarchy** — level-based, not department-based: Admin→anyone, Managers→managers+employees, Employees→fellow employees (cross-department fine, never upward); the assignee picker only offers allowed people. **Effort values** — the assigner sets effort (min/hr, optional); the assignee can record a one-time counter-estimate that never overwrites it (both logged for reviews). Task IDs (`T-00042`), relative due times ("6 hours from now"), recurrence end-dates. **Soft delete** — admin-only deletion moves tasks to a restorable Deleted bin. **Edit lockdown** — assignee: status only; creator: no direct edits; admin: full (logged). **Modification Requests** — in-system: assignee's request → creator approves; creator's own request → admin approves; every request/decision notified + logged to admin; approvable changes: due date, effort, priority, title, stop-recurrence, reassign, cancel. **Completion evidence** — admin toggles (Automation page) forcing remarks and/or a proof file on completion, collected by a modal and enforced server-side on every path. |
| **Tasks** | 7-tab area: Dashboard (6 tiles, date ranges, My/Delegated/Group scopes, category table, bar chart), My Tasks, Delegated, Subscribed (follow via 🔔), Templates, Activities audit feed, Holidays calendar. Category + frequency; recurring tasks auto-create the next occurrence on completion. Lead-linked tasks write into the lead timeline. |
| **Dashboard** | Tiles (total/new/active/won/lost/pipeline ₹/conversion %/pending follow-ups/overdue/assigned tasks/overdue tasks), leads-per-day chart, pipeline-by-stage bars, employee performance, lead-source performance, recent WhatsApp/Gmail feed, recent lead activity. Admin sees all; managers see their department automatically. |
| **Groups** | Team mini-workspaces: owner + members, category, archive (never hard-delete). Each group has Dashboard (task tiles + recent activity), Tasks, Links and Members tabs. Tasks carry an optional group; **group members see the group's tasks** even when not assignee. Managers/admin create; owner/admin manage members. |
| **Notices** | Company notice board (separate from per-user Notifications): draft → publish (schedulable) → expire/archive, priority, category, attachment, and audience targeting — everyone / role / department / group / specific users. Per-user read tracking with All/Read/Unread filters + search. Admin manages. |
| **Links** | Shared bookmark manager: named collections ("Important Tools"), per-link description, group-scoped visibility, ★ favorites, search + filters. http/https-only URL validation. Anyone adds; edit/delete own (managers/admin any); managers manage collections. |
| **Leave & Attendance** | **Attendance**: check-in/out with server-computed status (Present / Late / Half Day / Absent / Leave / Holiday / Week Off), working hours, late & early-checkout flags, missing-checkout detection, month view with per-status totals, correction requests with manager review that rewrites the day. **Leave**: types with annual quotas & document rules, apply with date range (working days only — skips holidays/week-offs), overlap guard, balances (quota/used/pending), cancel, manager approve/reject with remarks + notification; **approved leave writes LEAVE days into attendance** and blocks check-in. **Geo-fencing**: admin-defined office locations (lat/lng/radius); when `GEOFENCE_ENABLED=true` the server haversine-validates the GPS sent at check-in and rejects anything outside every fence. **Face recognition** (`FACE_RECOGNITION_ENABLED`): admin-only enrolment storing a numeric descriptor (never an image), euclidean matching against `FACE_MATCH_THRESHOLD`, and attendance is **never** marked on a below-threshold or unenrolled scan. |
| **Face attendance** | Removed in Kaampilot (PLAN.md §19.18): a punch is the office geofence + a selfie stored with it. Old face profiles and the `face_verified` / `face_confidence` columns are kept readable; `FACE_RECOGNITION_ENABLED` is switched off for every company (migration `hr 0006`) and no longer read. |
| **Payroll** | Salary structures with history (monthly gross, optional basic, PF %, professional tax, other deduction, effective-from — a new entry never overwrites the old, so old payslips stay explainable). Monthly payroll runs computed **from the recorded attendance**: working days = calendar − week-offs − holidays; payable = present + late + half-days(×0.5) + *paid* leave; the rest is LWP. Advances are recovered automatically and settled on finalise. Draft runs can be recalculated freely; finalising locks the month. Per-employee payslip breakdown, CSV export, and a **My Salary** tab where every employee sees their own finalised payslips only. Guardrails: PF is charged on *earned* basic, and a payslip can never go below zero. |
| **Industry Template Directory** | A browsable library of ready-made task templates, kept **separate** from the company's own private Task Templates. Browse by industry (13 seeded: E-commerce, Distributor, Automotive & Spare Parts, Garment Manufacturing, Construction, Education, Financial Services, CA Firm, Travel, Photography, Health & Wellness, Service Provider, Hiring Agency) → category → template → preview its steps → **Create tasks** (steps become real tasks, spaced by `offset_days`, optionally assigned to a teammate or a group) or **Add to my Task Templates**. Content lives in JSON/CSV and loads via `manage.py load_directory` — never hand-written in code. |

## 2. Tech stack

| Layer | Tech |
|---|---|
| API | Django 6 + Django REST Framework + SimpleJWT (Python 3.12+; the Docker image uses 3.13) |
| Screens | none here: the Kaampilot web app (`apps/web`) |
| Database | SQLite when `DATABASE_URL` is blank (standalone dev, tests); Postgres otherwise (`npm run dev` uses the local Postgres on :5434, db `ff_tasks`) |
| WhatsApp | Meta WhatsApp Cloud API, direct Graph v23 (no BSP) |
| Email | Gmail API over REST (OAuth refresh-token flow, no Google SDK) |
| AI | Claude API (Anthropic Messages API over REST) with deterministic fallback |

## 3. Run and test

The usual way is the whole suite from the repo root: `npm run dev` (everything on http://localhost:8080, single
login through the Platform, multi-company mode with a `run_worker` process). On its own (Windows):

```powershell
cd services	asksackend
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
.venv\Scripts\python manage.py migrate
.venv\Scripts\python manage.py runserver 8000     # API on http://localhost:8000/api/
```

`manage.py seed_users` creates an admin (pass `--admin-password`; the default is only for throwaway local data) and
`--demo-team` one demo user per role, for standalone dev only. Tests (SQLite, no scheduler thread):

```powershell
set DATABASE_URL= & set NOTIF_SCHEDULER=false & .venv\Scripts\python manage.py test
```

Multi-company tests need Postgres (`node services/platform/scripts/pg-up.mjs`, then
`set DATABASE_URL=postgres://postgres:postgres@localhost:5434/ff_tasks & set DB_SSLMODE=disable` and
`manage.py test tenancy`). Run the command for the current test count. Production runs from `infra/deploy`.

## 4. Roles & permissions

One auditable matrix in `backend/accounts/permissions.py`:

| Capability | Admin | Sales Manager | Sales Executive | Purchase | Accounts | Support |
|---|---|---|---|---|---|---|
| Leads visible | all | own department | own leads only | department | **won** leads only | department |
| Edit leads | all | department | own | — (read-only) | — (read-only) | department |
| Assign / reassign leads | ✔ | ✔ | — | — | — | — |
| Tasks visible | all | department | own/created/followed | own | own | own |
| Assign tasks to others | ✔ | ✔ | — | — | — | — |
| Dashboard | all depts | own dept | — | — | — | — |
| AI Inbox | ✔ | ✔ | — | — | — | — |
| Team directory (read) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| User management, Automation rules, Holidays, Simulator | ✔ | — | — | — | — | — |

## 5. Data model

```
User            username, email, password, first/last name, role, department,
                whatsapp_phone, reporting_manager -> User, is_active
Lead            customer_name, phone, email, company, requirement, source,
                department, status, priority, assigned_to, follow_up_at,
                reminded_at, estimated_value, ai_meta JSON, created_by
LeadEvent       lead, type (note|status_change|assignment|follow_up|document|
                quotation|call|email_in|email_out|wa_in|wa_out|created),
                body, actor, payload JSON            <- the communication history
LeadDocument    lead, file, filename, uploaded_by
Quotation       lead, number (QT-YYYY-NNNN), amount, status
                (draft|sent|accepted|rejected), notes, created_by
AssignmentRule  department (unique), strategy (round_robin|fixed),
                member_ids ordered JSON, rr_index, active
Task            title, description, category, frequency (one_time|daily|weekly|
                monthly), lead?, assigned_to, created_by, subscribers M2M,
                status (open|in_progress|done), priority, due_at, reminded_at,
                completed_at
TaskActivity    task, actor, text                     <- Activities feed
TaskTemplate    name, category, title, description, priority, frequency
Holiday         name, date
Notification    user, type, title, body, link, channels JSON
                (per-channel sent/skipped/error record), read_at
InboundMessage  channel (whatsapp|gmail), external_id (idempotency), sender,
                sender_name, subject, body, media JSON, ai_result JSON,
                lead?, status (pending|processed|ignored|failed), error
Group           name, description, category, owner, members M2M, active
Notice          title, content, author, category, priority, status (draft|
                published|archived), publish_at, expire_at, attachment,
                audience_type (everyone|role|department|group|users) +
                audience_value JSON
NoticeRead      notice, user, read_at (unique together)
LinkCollection  name, created_by
Link            collection, title, url, description, group?, added_by,
                favorites M2M
Task (EXTENDED) + group? -> workspace.Group (group members see group tasks)
OfficeLocation  name, latitude, longitude, radius_m, active (geo-fence)
Attendance      user+date (unique), check_in/out (+lat/lng each), location,
                status (present|absent|half_day|late|leave|holiday|week_off),
                working_minutes, is_late, is_early_checkout, face_verified,
                face_confidence, leave_request?, note
AttendanceCorrection  user, date, requested_check_in/out, reason,
                status (pending|approved|rejected), reviewed_by, remarks
LeaveType       name, annual_quota, paid, requires_document, active
LeaveRequest    user, leave_type, start_date, end_date, days, reason,
                document?, status (pending|approved|rejected|cancelled),
                reviewed_by, remarks, reviewed_at
FaceProfile     user (1:1), descriptor JSON (numeric only), enrolled_by
SalaryStructure user, monthly_gross, basic?, pf_percent, professional_tax,
                other_deduction, effective_from  (unique per user+date)
Advance         user, amount, given_on, reason, recovered, recovered_in
PayrollRun      year+month (unique), status (draft|finalised), working_days,
                total_net, finalised_at
Payslip         run+user (unique), monthly_gross, working/payable/lwp days,
                earned_gross, pf, professional_tax, advance_deduction,
                other_deduction, net_payable, breakdown JSON
Industry        name, slug, icon, description, order, active
DirectoryTemplate industry, category, name, description, priority,
                frequency, tags JSON, steps JSON [{title, description,
                offset_days}], active   (unique per industry+name)
```

## 6. API endpoints

All under `/api/`, JWT `Authorization: Bearer <token>` unless noted.

| Endpoint | Methods | Who | Purpose |
|---|---|---|---|
| `auth/login` | POST | public | username+password → access+refresh tokens |
| `auth/refresh` | POST | public | rotate refresh token |
| `auth/logout` | POST | any | blacklist refresh token |
| `auth/me` | GET | any | current user + capabilities |
| `auth/change-password` | POST | any | verify current, set new |
| `team/` | GET | any | read-only company directory |
| `users/` + `/{id}/` | CRUD | admin | user management (DELETE blocked) |
| `users/{id}/deactivate\|activate/` | POST | admin | soft on/off (self-deactivation blocked) |
| `leads/` + `/{id}/` | CRUD | scoped | filters: status, priority, source, assigned_to, department, overdue, search |
| `leads/{id}/events/` | GET | scoped | timeline |
| `leads/{id}/notes/` | POST | edit-scoped | add note |
| `leads/{id}/documents/` | GET/POST | scoped/edit | list / upload (10 MB cap) |
| `leads/{id}/quotations/` | GET/POST | scoped/edit | list / create (auto number) |
| `leads/summary/` | GET | scoped | per-status counts + overdue |
| `leads/assignees/` | GET | any | active users for dropdowns |
| `quotations/{id}/` | PATCH | edit-scoped | status/notes change (logged) |
| `assignment-rules/` + `/{id}/` | CRUD | admin | auto-assignment rules |
| `tasks/` + `/{id}/` | CRUD | scoped | filters: scope (my/delegated/subscribed), status, assigned_to, lead, category, frequency, overdue, search |
| `tasks/{id}/subscribe\|unsubscribe/` | POST | scoped | follow / unfollow |
| `tasks/categories/` | GET | scoped | distinct categories |
| `tasks/dashboard/` | GET | scoped | tiles + per-category table; params range, scope, category, search |
| `task-templates/` | CRUD | read: any · write: admin/manager | reusable blueprints |
| `task-activities/` | GET | scoped | audit feed; filters actor, days |
| `holidays/` | CRUD | read: any · write: admin | company calendar |
| `notifications/` | GET | own only | own feed |
| `notifications/unread_count/` · `{id}/read/` · `read_all/` | GET/POST | own only | badge + mark read |
| `dashboard/` | GET | admin/manager | all dashboard aggregates |
| `groups/` + `/{id}/` | CRUD | member-scoped · create: admin/manager · DELETE archives | team workspaces |
| `groups/{id}/add_member\|remove_member/` | POST | owner/admin | membership management |
| `groups/{id}/dashboard/` | GET | member-scoped | group task tiles + members + recent activity |
| `notices/` + `/{id}/` | list: targeted feed (`?manage=true` = admin all) · write: admin | company notice board |
| `notices/{id}/publish\|archive\|read/` | POST | admin / admin / targeted user | lifecycle + read tracking |
| `link-collections/` | CRUD | read: any · write: admin/manager | bookmark collections |
| `links/` + `/{id}/` + `/{id}/favorite/` | CRUD + POST | visible-scoped; edit own | shared bookmarks (http/https only) |
| `attendance/` | GET | own · `?scope=team` for approvers | attendance history (date/status filters) |
| `attendance/today/` | GET | any | today's record + can-check-in/out + feature flags |
| `attendance/check_in\|check_out/` | POST | any | mark attendance (GPS + optional face descriptor) |
| `attendance/monthly/` | GET | own · `?user=` scope-checked | day-by-day month report + totals |
| `attendance/team_today/` | GET | `hr.approve` | today's team roster + counts |
| `attendance-corrections/` + `/{id}/review/` | CRUD + POST | own · review `hr.approve` | correction requests (approval rewrites the day) |
| `leaves/` + `/{id}/cancel\|review/` | CRUD + POST | own · `?scope=team` + review `hr.approve` | leave workflow |
| `leaves/balances/` | GET | own · `?user=` scope-checked | quota / used / pending / balance |
| `leave-types/` · `office-locations/` | CRUD | read: any · write: `hr.manage` | HR configuration |
| `hr/face/{user_id}/` | POST/DELETE | `hr.manage` | face enrolment / removal (descriptor only) |
| `hr/config/` | GET | any | policy + feature flags + own capabilities |
| `salary-structures/` · `advances/` | CRUD | read own · write `hr.manage` | salary history, advances |
| `payroll-runs/` + `/{id}/generate\|finalise/` | CRUD + POST | `hr.manage` | monthly run; recalculate; lock + settle advances |
| `payroll-runs/{id}/payslips\|export/` | GET | `hr.manage` | month's payslips · CSV download |
| `payslips/` | GET | own **finalised** only · `hr.manage` sees all | employee payslip history |
| `tasks/assignees/` | GET | any | assignee list (all active users — no hierarchy) |
| `tasks/workload/?user=<id>` | GET | can-assign-to target · reporting manager · dept/all viewers | C1/C2 pipeline panel: open count, priority breakdown, pending effort, overdue, soft `overloaded` flag (≥8h or ≥10 open) — informs, never blocks |
| `tasks/{id}/estimate/` | POST | assignee, once | counter-estimate in minutes |
| `tasks/{id}/progress/` | POST | assignee | repeatable status update: % done, effort spent so far, comment — logs to activity, notifies creator |
| `tasks/{id}/activity\|comment\|add_check\|check/{item}/` | GET/POST | visible · assignee/creator/admin for checklist | per-task feed, comments (notify assignee+creator), checklist add/toggle/delete |
| `tasks/voice_draft/` · `tasks/{id}/summarize/` | POST | any | Voice draft ({transcript} from the browser/phone, or an audio clip with the Gemini key) → the task form's values (`ai_draft` removed 2026-10-20, PLAN.md §19.30) · per-task summary (AI behind AI_ENABLED, rule-based fallback) |
| `tasks/{id}/remove_file/` · `tasks/change_request_leaders/` · `whatsapp-hours/` | POST · GET · GET/PUT | uploader (open task) / giver / admin · Team performance · Task settings | take a file off a task · who asks most to move a due date · the company's WhatsApp sending hours (PLAN.md §19.30) |
| `tasks/` with `parent` · `tasks/assignees/?part_of={id}` · `tasks/{id}/chain/` · `tasks/chains/?status=open\|done\|all` | POST · GET · GET · GET | the task's holder (or an admin) · any · `tasks.view_all` · `tasks.view_all` | Task chain (PLAN.md §19.41): give a part (5 levels, due ≤ the parent, effort out of what is left; passing on a part of a task someone gave you needs no Assign permission) · who may get a part · the whole tree · every chain |
| `tasks/person_export/?user=&range=(&start&end)` | GET | `tasks.view_all` | one person's performance workbook, 8 sheets with filters (PLAN.md §19.41) |
| `tasks/{id}/complete/` | POST | assignee | complete: description + actual effort spent MANDATORY, proof file per settings |
| `tasks/time_report/?range=` | GET | self · dept (manager) · all (admin) | Time Earned (assigned effort) vs Time Spent (actual) per person |
| `tasks/employees_report/?range=&grain=` | GET | self · dept (manager) · all (admin) | per-person counts+%, transparent score (60/40 formula), multitasker index; `grain=daily` = completion-day crediting; `range=custom&start&end` |
| `tasks/effort_disputes/?range=` | GET | self · dept (manager) · all (admin) | effort vs estimate vs actual, sorted by disagreement |
| `mistakes/` + `/{id}/` | CRUD | own · dept (manager) · all (admin) · `?important=true` founder filter | Mistake Register: category, severity (SLA), classification, SOP linking, financial loss |
| `mistakes/{id}/explain\|confirm_repeat\|review\|create_task\|events/` | POST/GET | employee · manager · manager · manager · visible | 3-level accountability: structured root cause; "Same/Different error"; review (can't just close); corrective task; audit trail |
| `mistakes/{id}/ai_suggest/` | POST | reviewer | M3: suggested classification + CAPA (Claude behind AI_ENABLED, rules otherwise) — human saves |
| `mistakes/patterns/?days=` · `mistakes/founder_summary/` · `mistakes/department_scores/?range=` | GET | managers/admin · admin · managers/admin | cross-employee process smells + repeat offenders · Action-Required card · M4 department accountability score |
| `mistakes/send_digests/` | POST | admin | fire the daily manager summary + weekly founder digest now (ticker sends them automatically) |
| `mistake-categories/` | GET · CUD | read any · write `settings.manage` | 29 seeded configurable categories |
| `mistake-settings/` | GET · POST | any · `settings.manage` | SLA hours per severity (72/48/24/4 defaults) |
| `tasks/{id}/request_change/` | GET/POST | assignee/creator/admin | raise a Modification Request |
| `tasks/{id}/restore/` · `?scope=deleted` | POST · GET | admin | Deleted-bin restore · listing |
| `tasks/{id}/files/` | GET | visible | task attachments |
| `task-change-requests/` + `/{id}/review/` | GET + POST | inbox/mine/all scopes · approver rules | Modification Request workflow; review decisions: approved / rejected / **escalated** (creator hands the call to admin) |
| `task-categories/` | GET · CUD | read any (`?department=` filter) · write `tasks.assign` | managed category dropdown; DELETE deactivates, re-add reactivates |
| `task-settings/` | GET · POST | any · `settings.manage` | completion-evidence policy |
| `directory/industries/` | GET | any | industries + template counts + categories |
| `directory/templates/` | GET · CUD | read any · write `settings.manage` | library (filters: industry, slug, category, tag, search) |
| `directory/templates/{id}/create_tasks/` | POST | any (assigning to others needs `tasks.assign`) | steps → real tasks with due-date offsets |
| `directory/templates/{id}/add_to_my_templates/` | POST | `tasks.assign` | copy steps into private Task Templates |
| `intake/` | GET | admin/manager | AI inbox listing |
| `intake/simulate/` | POST | admin | run any text through the real pipeline |
| `webhooks/whatsapp` | GET/POST | Meta (signature) | webhook verify handshake + message delivery |
| `/health` | GET | public | liveness check |

## 7. File-by-file reference

### `backend/manage.py`
Standard Django entry point: `runserver`, `migrate`, `test`, and the custom
commands below all run through it.

### `backend/requirements.txt`
Python dependencies (Django, DRF, SimpleJWT, cors-headers, dotenv, requests).
`psycopg[binary]` is listed commented — install it when switching to Neon.

### `backend/.env.example`
Fully documented template for every environment variable, with step-by-step
instructions for obtaining each credential (Meta, Google OAuth, Anthropic,
Neon). Copy to `.env` and fill in what you have; blanks stay safely off.

### `backend/config/` — project wiring
| File | What it does |
|---|---|
| `settings.py` | All Django settings, env-driven. `env()` helper treats blank `.env` values as unset. `_database_from_env()` = SQLite fallback / Postgres when `DATABASE_URL` is set (parses the URL, forces SSL). JWT lifetimes (8h access / 7d refresh, rotation + blacklist), CORS origins, IST timezone, media root, custom pagination class. |
| `urls.py` | Root router: `/health`, `/admin/`, and mounts the four app URL files under `/api/`. Serves uploaded media in DEBUG. |
| `pagination.py` | `DefaultPagination` — page size 25, client can raise via `?page_size=` up to 300. |
| `asgi.py` / `wsgi.py` | Standard deployment entry points (Render will use wsgi/gunicorn). |

### `backend/accounts/` — users, auth, RBAC
| File | What it does |
|---|---|
| `models.py` | Custom `User` (extends AbstractUser): `role` (6-role enum), `department`, `whatsapp_phone`, `reporting_manager` (self-FK → "Reports To"). Admin role auto-sets `is_staff`. `ROLE_DEFAULT_DEPARTMENT` map used by seeding. |
| `permissions.py` | **The heart of RBAC.** `ROLE_CAPABILITIES` — one dict mapping each role to its capability strings (`leads.view_own`, `tasks.assign`, `dashboard.view`, …). Helpers `capabilities_for()` / `has_capability()`; DRF permission classes `IsAdmin` and `HasCapability.of("x")` used by every guarded view. The web app receives the same strings via `/auth/me` and shows/hides screens from them. |
| `serializers.py` | `UserSerializer` (read; includes capabilities + reporting-manager name), `UserWriteSerializer` (admin create/update; password required on create, optional on update, Django password validation), `ChangePasswordSerializer`. |
| `views.py` | `me` (profile + capabilities), `change_password`, `logout` (blacklists the refresh token), `team_directory` (read-only company directory for every role), `UserViewSet` (admin CRUD; DELETE returns 405 — deactivate instead; `deactivate` blocks self). |
| `urls.py` | Routes: `auth/*`, `team/`, `users/` router. |
| `admin.py` | Django-admin registration of the custom user with CRM fields. |
| `management/commands/seed_users.py` | `python manage.py seed_users [--demo-team]` — idempotent seeding of the admin account and one demo user per role. |
| `tests.py` | 13 tests: login, wrong password, inactive-user block, me, refresh rotation + logout blacklist, admin-only user list, create with role, password rules, deactivate/activate, self-deactivation guard, delete blocked, role update keeps password. |
| `migrations/` | 0001 initial user schema; 0002 adds `reporting_manager`. |

### `backend/crm/` — leads, tasks, assignment, dashboard
| File | What it does |
|---|---|
| `models.py` | `Lead` (all CRM fields + `ai_meta` JSON + `reminded_at` + indexes), `LeadStatus`/`LeadSource`/`LeadPriority` enums, `OPEN_STATUSES`, `is_overdue` property; `AssignmentRule` (per-department, ordered `member_ids`, `rr_index` rotation pointer); `Task` (+ category, frequency, subscribers M2M, due/reminded/completed timestamps); `TaskActivity`; `TaskTemplate`; `Holiday`; `LeadEvent` (the unified timeline — every note/status/assignment/document/quotation/WhatsApp/email event); `LeadDocument` (files under `media/lead_docs/<lead>/`); `Quotation` (auto number `QT-YYYY-NNNN` on save). |
| `scoping.py` | **Who sees/edits what.** `visible_leads(user)` — all / department / won-only / own by capability. `can_edit_lead`, `can_assign`. `visible_tasks(user)` — all / department / own+created+subscribed. `can_edit_task`, `can_assign_tasks`. Every list view and object guard calls these. |
| `serializers.py` | `LeadSerializer` (display labels, assigned/creator briefs, `is_overdue`, per-request `can_edit`), `LeadEventSerializer`, `LeadDocumentSerializer` (download URL), `QuotationSerializer`, `NoteSerializer`, `TaskSerializer` (+ `subscribed` for current user), `TaskActivitySerializer`, `TaskTemplateSerializer`, `HolidaySerializer`, `AssignmentRuleSerializer` (validates member ids, resolves member details), `UserBriefSerializer`. |
| `views.py` | `LeadViewSet` — role-scoped queryset with all filters; `perform_create` (exec self-assign default, assign-permission check, created/assignment events, **auto-assign when unassigned**, notifications); `perform_update` (edit guard, reassign guard, auto events + notifications for status/assignee/follow-up changes); admin-only delete; sub-routes `events`, `notes`, `documents` (multipart upload, 10 MB cap), `quotations`, `summary`, `assignees`. `AssignmentRuleViewSet` (admin; member change resets rotation). `QuotationViewSet` (PATCH status/notes with lead-access guard + timeline log). |
| `task_views.py` | `TaskViewSet` — scope filters (my/delegated/subscribed), assign/edit/lead-visibility guards, activity logging, completion timestamps, lead-timeline writes, **`_spawn_next_occurrence`** (recurring tasks re-create themselves on completion: daily +1d, weekly +7d, monthly next month), `subscribe`/`unsubscribe`, `categories`, **`dashboard`** action (range chips → tile + per-category tallies: overdue/pending/in-progress/completed/in-time/delayed; group scope capability-gated). `TaskTemplateViewSet` (read: all, write: assigners). `TaskActivityViewSet` (scoped feed). `HolidayViewSet` (read: all, write: admin). |
| `assignment.py` | `auto_assign(lead)` — looks up the department's active rule, walks the ordered member list (round-robin advances `rr_index`, fixed takes first), skips deactivated users, saves, logs "Auto-assigned to …", notifies the assignee. Called from manual lead creation *and* the AI intake pipeline. |
| `reminders.py` | `send_followup_reminders()` — open leads with a passed `follow_up_at` get ONE notification per follow-up (`reminded_at` dedupe; rescheduling re-arms it), then chains `send_task_reminders()` which does the same for task due dates. |
| `dashboard.py` | `GET /api/dashboard/` — computes everything off `visible_leads`/`visible_tasks`: tiles, per-status distribution, leads-per-day (14 local dates), employee performance (+ open-task counts), source performance with conversion %, recent inbound WhatsApp/Gmail, recent lead events. |
| `urls.py` | Routers: leads, quotations, assignment-rules, tasks, task-templates, task-activities, holidays + `dashboard/`. |
| `admin.py` | Django-admin registrations for lead models. |
| `management/commands/send_reminders.py` | Manual/cron trigger for the reminder run. |
| `tests.py` | 19 tests — lead scoping per role, lifecycle events, permission denials, filters/summary, notes/documents/quotations. |
| `tests_assignment.py` | 12 tests — the exact round-robin sequence, skip-inactive, fixed, rotation reset, notifications, reminder dedupe + reschedule re-fire. |
| `tests_dashboard.py` | 5 tests — tile math, manager scoping, breakdowns, 14-day series, 403 for executives. |
| `tests_tasks.py` | 11 tests — task scoping, assign guards, completion, lead events, reminders, dashboard tile. |
| `tests_tasks_area.py` | 16 tests — my/delegated/subscribed scopes, auto-subscribe, dashboard tiles/categories/ranges, group-scope guard, recurrence, templates/holidays permissions, activities scoping, team directory. |
| `migrations/` | 0001 lead schema · 0002 assignment rule + `reminded_at` · 0003 task · 0004 holiday/template/activity + task category/frequency/subscribers. |

### `backend/workspace/` — Groups, Notices, Links
| File | What it does |
|---|---|
| `models.py` | `Group` (+members M2M, owner, active), `Notice`/`NoticeRead` (audience-targeted announcements with lifecycle + read tracking), `LinkCollection`/`Link` (bookmarks, group-scoped visibility, favorites). |
| `access.py` | Workspace visibility/permission helpers (mirrors `crm/scoping.py`): `visible_groups`, `can_create_group` (managers+), `can_manage_group` (owner/admin), `notice_targets` + `notices_for` (audience resolution), `visible_links`, `can_edit_link`. |
| `serializers.py` | All workspace serializers, including notice audience validation (role/department/group/user-id checks) and http/https-only URL validation on links. |
| `views.py` | `GroupViewSet` (create=manager+, archive-on-delete, `add_member`/`remove_member`, `dashboard` action with task tiles + recent activity), `NoticeViewSet` (targeted feed vs `?manage=true` admin listing, `publish`/`archive`/`read` actions, read/unread/search filters), `LinkCollectionViewSet`, `LinkViewSet` (+`favorite` toggle). |
| `urls.py` / `admin.py` | Routers `groups`, `notices`, `link-collections`, `links`; Django-admin registrations. |
| `tests.py` | 21 tests — group create permission, membership visibility, member management guards, archive-not-delete, group-task visibility + foreign-group guard, group dashboard math, notice targeting (all 5 audience types), draft/scheduled/expired hiding, read flow, admin-only manage + publish/archive, audience validation, link URL-scheme rejection, group-link scoping, edit-own + favorites. |
| `migrations/` | 0001 all workspace models, 0002 removes the Idea board. (Plus `crm/0005_task_group` for the Task→Group link.) |

### `backend/hr/` — Leave & Attendance
| File | What it does |
|---|---|
| `models.py` | `OfficeLocation` (geo-fence), `Attendance` (one row per user/day, unique-constrained, with GPS + face metadata and a `missing_checkout` property), `AttendanceCorrection`, `LeaveType`, `LeaveRequest`, `FaceProfile` (descriptor only — never an image). |
| `services.py` | All the rules, server-side: `cfg()` reads the HR_* / GEOFENCE_ env vars (face check is permanently off, §19.18); `haversine_m` + `validate_location` (rejects outside every active fence, refuses missing GPS when enforced); `check_in` / `check_out` (late-grace, working minutes, half-day/early-checkout classification); `leave_working_days` (skips week-offs + `crm.Holiday`), `apply_leave_to_attendance` / `revoke_leave_attendance`, `leave_balances`, `monthly_report` (classifies un-recorded days as holiday/week-off/absent and never marks future days absent), `today_summary`. |
| `views.py` | `AttendanceViewSet` (history scoping, `today`, `check_in`, `check_out`, `monthly`, `team_today`), `CorrectionViewSet` (+`review` that rewrites the attendance day; self-review blocked), `LeaveRequestViewSet` (apply with overlap/working-day validation, `cancel`, `review` + notification, `balances`), `LeaveTypeViewSet`, `OfficeLocationViewSet`, `face_enrolment` (admin-only, validated descriptor), `hr_config`. Scope helper `managed_users()`: admin = everyone, `hr.approve` = own department, else self. |
| `serializers.py` | Attendance/correction/leave/type/office serializers; `MarkSerializer` accepts only raw GPS + descriptor (never a client-computed status); coordinate and date-range validation, document requirement enforcement. |
| `tests.py` | 28 tests — haversine accuracy, fence on/off/missing-GPS, office CRUD permissions, face enrolment permissions + validation, unenrolled/mismatch never marks, matching records confidence, check-in/out duplicates, half-day, `today` flags, history scoping across 3 roles, cross-employee month blocked, month classification (present/holiday/week-off/absent), `team_today` capability, correction request→review→attendance rewrite + self-review block, leave working-day counting, invalid range/overlap/document guards, approval writes LEAVE + notifies, rejection doesn't, cancel + revoke, balances, scoping, leave-type admin-only, check-in blocked on approved leave, config flags. |
| `migrations/` | 0001 all HR models. |

### `backend/payroll/` — salary & payroll
| File | What it does |
|---|---|
| `models.py` | `SalaryStructure` (dated history so old payslips stay explainable), `Advance` (recovered from a payslip), `PayrollRun` (one per month, draft → finalised), `Payslip` (full figures + a `breakdown` JSON that explains every number). |
| `services.py` | The whole calculation: `working_days_in()` (calendar − week-offs − `crm.Holiday`), `structure_for()` (latest effective salary), `paid_leave_dates()`, `count_days()` (attendance → present / half / paid leave / unpaid), `build_payslip()` (earned gross, PF on *earned* basic, PT, advances, **never negative**), `generate_run()` (rebuild a draft), `finalise()` (lock + settle advances). |
| `views.py` | `SalaryStructureViewSet` and `AdvanceViewSet` (employees read their own, `hr.manage` writes), `PayrollRunViewSet` (create/regenerate/finalise/payslips/CSV export), `PayslipViewSet` (employees see only their own **finalised** slips). |
| `tests.py` | 19 tests — working-day maths incl. holidays, full/absent/half-day/paid-vs-unpaid-leave pay, PF + PT + other deductions, PF pro-rating, **zero-attendance never goes negative**, latest-structure-wins, employees without salary skipped (not zeroed), advance recovery + cap + no double recovery, HR-only run creation, duplicate/invalid month, finalise locking, employee sees only own finalised slip, salary/advance write permissions, CSV export. |

### `backend/directory/` — Industry Task Template Directory
| File | What it does |
|---|---|
| `models.py` | `Industry` (name/slug/icon/order) and `DirectoryTemplate` (category, priority, frequency, tags, `steps` JSON, unique per industry+name). |
| `views.py` | `IndustryViewSet` (annotated template counts + category list), `DirectoryTemplateViewSet` — browse/filter/search, admin-only content writes, and the two "use" actions: `add_to_my_templates` (copies each step into `crm.TaskTemplate`, auto-deduping names) and `create_tasks` (steps → `crm.Task`, due dates from `offset_days`, optional assignee/group with the same permission rules as the Tasks module, logs a `TaskActivity`, notifies the assignee). |
| `management/commands/load_directory.py` | The seed/import mechanism: reads **JSON or CSV**, upserts by (industry, name) so re-running is idempotent, validates enums (bad priority/frequency fall back to defaults), skips step-less rows with a count, `--replace` to wipe first. Defaults to the bundled starter pack. |
| `seeds/starter_pack.json` | 13 industries × 26 templates of real checklist content — data, not code, so the library grows by adding files. |
| `tests.py` | 14 tests — JSON idempotent load + enum fallback + skip rules, CSV load with grouping and tag splitting, `--replace`, bundled pack sanity, auth required, industry counts/categories, all filters, admin-only content writes, `add_to_my_templates` capability + name dedupe, `create_tasks` offsets/self/others/notification, foreign-group block, unknown assignee. |

### `backend/notifications/` — the notification center
| File | What it does |
|---|---|
| `models.py` | `Notification` — user, type, title, body, link, `channels` JSON (audit of every delivery attempt), `read_at`. |
| `service.py` | **The one entry point**: `notify(user, type, title, body, link)` — creates the in-app row and fans out to Gmail + WhatsApp, recording each result. Helpers `notify_lead_assigned` (skips self-assignment), `notify_status_change` (only when someone else changes your lead), `notify_follow_up_due`. |
| `channels/whatsapp.py` | Meta WhatsApp Cloud API sender over Graph v23 REST: `send_text` (24h-session messages) and `send_template` (approved-template messages for business-initiated pings). Fully written; returns `skipped` until `WHATSAPP_ENABLED` + token + phone-number id are set. |
| `channels/gmail.py` | Gmail API `users.messages.send` over REST with OAuth **refresh-token flow** (`_access_token()` caches the access token). MIME-builds the mail. Returns `skipped` until `GMAIL_ENABLED` + client id/secret/refresh token/sender are set. |
| `views.py` + `urls.py` | `NotificationViewSet` — own-feed only, `unread_count`, `read`, `read_all`. |
| `apps.py` | Starts the **5-minute reminder ticker thread** when the server runs (disable with `NOTIF_SCHEDULER=false`; never runs during migrate/test). |
| `tests.py` | 6 tests — in-app creation + skipped-channel audit, no-phone skip reason, own-feed isolation, unread/read/read-all, cross-user 404. |

### `backend/intake/` — WhatsApp/Gmail/AI intake
| File | What it does |
|---|---|
| `models.py` | `InboundMessage` — channel, `external_id` (unique per channel → idempotent against Meta/Gmail redelivery), sender, body, media metadata, `ai_result`, linked lead, status, error. |
| `ai.py` | `classify(text, sender_name)` → fixed-shape dict `{intent, customer_name, vehicle, items[{name,quantity}], priority, department, summary, provider}`. Claude path: Anthropic Messages API over REST with a strict-JSON system prompt, 20s timeout. Fallback path: deterministic keyword classifier (intent words, Indian commercial-vehicle list, item + quantity extraction, urgency detection). Any Claude failure silently falls back — the pipeline never blocks on AI. |
| `pipeline.py` | `process_message(msg)` — classify → spam ⇒ ignored; else find the most recent **open** lead by phone (WhatsApp) or email (Gmail): found ⇒ append `wa_in`/`email_in` timeline event + update `ai_meta` + notify assignee; not found ⇒ create a lead (name/requirement/department/priority from AI, source = channel) and run `auto_assign`. Poison messages are caught and marked `failed`, never crash the webhook. |
| `webhook.py` | `/api/webhooks/whatsapp` — GET: Meta's verify-token handshake; POST: `X-Hub-Signature-256` HMAC check against `WHATSAPP_APP_SECRET`, parses entries/contacts/messages (text + media captions), dedupes by message id, runs the pipeline, always answers 200 fast (Meta retries otherwise). |
| `gmail_poll.py` | `poll_inbox()` — Gmail REST: list unread by `GMAIL_POLL_QUERY`, fetch full message, decode headers + text body, create `InboundMessage`, run pipeline, mark read. Inert until Gmail is configured. |
| `views.py` | `IntakeViewSet` — AI-inbox listing (admin + sales managers) with channel/status filters; `simulate` action (admin) — runs any text through the **real** pipeline for testing/demos. |
| `apps.py` | Starts the Gmail poll thread (interval `GMAIL_POLL_SECONDS`) only when `GMAIL_ENABLED=true`. |
| `management/commands/poll_gmail.py` | One-shot poll for cron use. |
| `urls.py` / `admin.py` | Webhook path + intake router; admin registration. |
| `tests.py` | 18 tests — the spec's exact "brake pad and oil filter for Tata 407" extraction, urgency/support/accounts/spam classification, quantity parsing, Claude success + failure-fallback (mocked), lead create/append/dedupe by phone & email, webhook handshake, bad-signature rejection, redelivery idempotency, simulator permissions. |

## 8. Environment variables (.env)

Copy `backend/.env.example` → `backend/.env`. Everything blank = feature off,
app still fully works. Full instructions for obtaining each credential are in
the file itself.

| Block | Keys | Turns on |
|---|---|---|
| Core | `SECRET_KEY`, `DEBUG`, `ALLOWED_HOSTS`, `CORS_ORIGINS` | — |
| Database | `DATABASE_URL` (+ `pip install "psycopg[binary]"`) | Neon Postgres instead of SQLite |
| WhatsApp | `WHATSAPP_ENABLED`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | outbound WhatsApp notifications + webhook signature verification. Webhook URL for Meta: `https://<host>/api/webhooks/whatsapp` |
| Gmail | `GMAIL_ENABLED`, `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `GMAIL_SENDER`, `GMAIL_POLL_SECONDS`, `GMAIL_POLL_QUERY` | email notifications + inbox polling |
| Claude | `AI_ENABLED`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `AI_TIMEOUT_SECONDS` | AI classification (falls back to keyword rules otherwise) |
| Jobs | `NOTIF_SCHEDULER` | the in-process 5-min reminder ticker |

## 9. How the automations work

**New lead (any source) →**
`auto_assign()` picks the employee from the department's rule (round-robin or
fixed) → `LeadEvent` logged → `notify()` → in-app + Gmail + WhatsApp.

**Customer WhatsApp message →**
Meta webhook → signature check → dedupe by message id → `classify()` (Claude
or rules) → existing open lead by phone? append to timeline + notify assignee
: create lead → auto-assign → notify. Spam is ignored.

**Customer email →**
Gmail poller (thread or cron) → same pipeline, matching by email address.

**Follow-up/task reminders →**
Every 5 minutes (`notifications/apps.py` ticker) or `manage.py send_reminders`:
open leads past `follow_up_at` and unfinished tasks past `due_at` each get one
notification per date; rescheduling re-arms them.

**Recurring tasks →**
Marking a daily/weekly/monthly task done auto-creates the next occurrence with
the advanced due date, same assignee/subscribers.
