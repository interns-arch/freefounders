# Kaampilot: UI functionality specification

**What this is.** Every screen of the Kaampilot web app as it works today (Phase 6, `apps/web`): who can open it, what it
shows, every action, every form field and every rule. It describes **what the UI must do, not how it should look**. Use it to
design a completely new UI; when the new design is built, this document is the checklist that nothing was lost.

**What it does not cover.** The modules that still run on the old ("classic") screens (Leads, AI inbox, Mistakes,
Links, Payroll, SIM cards, Reconciliation; see §0.6), and the mobile app (Phase 7, which will reuse the same data
layer and should follow the same design).

Generated from the code on 2026-10-08. Source of truth if anything here disagrees with the app: the app.

> **Update 2026-10-13 (PLAN.md §19.23): Web forms and the Idea board are removed** at the founder's request: no Forms or
> Idea board screens, menu items, module switches or permissions, no public form page (`/f/…`), and no Ideas tab in a group.


> **Update 2026-10-09 (PLAN.md §19):** the "Workspace chooser" is now the **Workspace Portal** (same URL `/`, heading
> "Choose your workspace" kept) with an Attendance card that punches in/out directly ("Punch in" / "Punch out"), and the
> HR screens moved to their own **Attendance** workspace: `/attendance` (Today) and `/attendance/history|leave|holidays|
> team|approvals|settings`. Old `/tasks/hr?tab=x` links redirect there. Portal buttons: "Open Tasks", "Open Assets",
> "Open Attendance & Leave". A Tasks-only person now lands on the portal instead of going straight into Tasks.

> **Update 2026-10-10 (PLAN.md §19.14): no workspace page.** Sign-in opens **Home** at `/` inside the app frame: h1 "Good
> morning, {first}", the "Attendance & Shifts" card first (clock, "Punch in" / "Punch out" / "Done for today · …", checks,
> today's times, "Open Attendance & Leave" + "{n} approvals pending"), then "Tasks & Automations" ("Open Tasks", "My task
> list", counts) and "Assets & Inventory" ("Open Assets", "Scan QR / barcode" or "Request an item"), then Admin ("People &
> access", "Roles", "Settings"). Keys 1 / 2 / 3 open the cards. "Remember my choice on this device" is gone; `/?choose` = `/`.
> On phones (< 640 px) `/` lands on `/attendance`; `/?home=1` opens Home. One menu: sidebar "Main menu" = Home + groups
> Attendance / Tasks / Assets / Admin (each a `<nav>` "… menu"); phone bottom bar "Quick menu" = Attendance · Home · Tasks ·
> Assets · More. Header: area pill, light/dark, bell, "Your account" (light/dark, Keyboard shortcuts, Change password, Sign
> out). Sign-in: "Show" / "Hide" on the password. Keyboard: Alt+1..4 = Home / Attendance / Tasks / Assets, `?` = shortcuts.
> The "Workspace chooser" section below describes the old page.

> **Update 2026-10-10, later (PLAN.md §19.15): attendance for managers.** Attendance section bar: "Team" became **"Live team"**
> (`/attendance/team`), plus **"Daily"** (`/attendance/daily?date=`), **"Dashboard"** (`/attendance/dashboard`) and **"Reports"**
> (`/attendance/reports`), for approvers, HR and view-all; menu (Manage): "Live attendance", "Daily attendance", "Dashboard",
> "Reports". Live/Daily: tiles that filter (group "Filter by status": Present, Late, Not checked in / Absent, On leave, Off /
> holiday, Checked out), "Search staff", "Department", "Showing N of M staff", per row "History of {name}" and (HR) "Mark {name}"
> (dialog: Mark as present / half day / absent + Reason); Live says "Live · {day}", refreshes every minute ("Refresh");
> Daily has "Previous day" / "Date" / "Next day" / "Today". Dashboard: "Previous month" / "Next month", search, department,
> "Show inactive staff", sortable table (Employee, Employee ID, Phone, Present, Absent, Half day, Late, Leave, Off / hol.,
> Hours; phones: one "Month" line of chips), a row opens `/attendance/history?user=&name=&from=` with "Back to …",
> "Download report" (monthly summary XLSX), "Import attendance" (HR). Reports: "Report type", Date / Month / From–To,
> "Department", "Format" (Excel (XLSX) / CSV), "Download", "Import attendance" (HR); "Recent downloads" (this device, last 10,
> "Download again"). Import dialog: template "XLSX" / "CSV", "Attendance file (.xlsx or .csv)", "Check file", preview table
> (OK / Error + reason), "Import N rows", then "Created · Updated · Skipped" and "Done".

> **Update 2026-10-09, later (PLAN.md §19.10): no more classic screens.** §0.6 is void: Leads (`/tasks/leads`, `?lead=`), AI inbox
> (`/tasks/intake`), Mistakes & SOPs (`/tasks/mistakes`, `?tab=sops`, `?open=`), Links (`/tasks/links`), Payroll & My
> salary (`/attendance/payroll`, `/attendance/salary`), SIM cards (`/assets/sims`) and Reconciliation (`/assets/reconciliation`,
> `/assets/reconciliation/:id`) are all screens of the new app; an unknown `/tasks/…` or `/assets/…` path shows "Page not found".

## Contents
0. Ground rules for the new design (what can change, what must stay, theme, permission model, journeys, classic screens, test names)
1. App frame: sign in, workspace chooser, account, shell, notifications, errors
2. Admin: People & access, Roles, Settings
3. Tasks: the task workspace (14 tabs, task lifecycle, add task, task detail, dialogs, reviews, requests, templates, reports)
4. Tasks: general screens (home, team performance, groups, notices, notifications, my team, task settings) and HR (check in/out, attendance, leave, holidays, team, approvals, HR settings)
5. Assets: dashboard, assets, scan, labels, employees, ID cards, joiners, exits, requests, tickets, maintenance, activity, catalogue, departments & vendors, users & roles

---

## 0. Ground rules for the new design

### 0.1 What can change freely
Layout, navigation style, colours, fonts, spacing, icons, illustrations, card/table/list styles, how many screens a feature
is split into (or merged into), modal vs side panel vs page, animations, empty-state art, the dashboard composition.

### 0.2 What must stay
1. **Every function in this document** (each action, field, filter, rule, permission gate, confirmation).
2. **The URLs** in this document, including their query parameters. Emails, WhatsApp messages, notifications, QR codes and
   printed ID cards already contain them (e.g. `/tasks/tasks/42?review=accept`, `/assets/requests?open=<id>`,
   `/assets/scan/<code>`). A new design may add URLs; it must keep these working.
3. **Who can see what**: permission rules are listed per screen. Hiding something a person may use is a bug; showing
   something they may not use is a bigger one (the server refuses it anyway).
4. **Data comes from the shared layer** (`packages/core`): screens never call the server themselves. Colours, fonts, radius
   come only from the theme (`packages/theme`). A build check enforces both (PLAN.md §18.2).
5. **Accessibility**: every input has a visible label, every icon-only button has a name, dialogs have titles, status is not
   shown by colour alone. The automated browser tests find things by these names (see §0.7).
6. **Phones**: the same app runs on phones (attendance check-in, scanning, approvals are phone tasks). Every screen must
   work at 360 px wide.

### 0.3 The theme you design within
All colours are design tokens in `packages/theme/tokens.css` (light and dark): `background, foreground, card, popover,
primary, secondary, muted, accent, destructive, success, warning, info, border, input, ring, sidebar*`, and the three app
accents `app-tasks`, `app-assets`, `app-admin`. Radius `--radius`; font Inter. A company's **brand colour** (set in
Settings) replaces `primary` at run time, so a design must look right with any primary colour (blue, green, red, orange…),
in light and dark mode. Change the tokens to change the whole product; the mobile app reads the same tokens.

### 0.4 People, apps and permissions (the model behind every "who can see it")
- **Company** → **people**. One login per person (email, username or employee ID + password).
- **Platform access level**: `owner` (company Super Admin), `admin`, `member`. Owners and admins see the **Admin**
  workspace (People & access, Roles, Settings).
- **Apps**: a person may open **Tasks** (tasks + HR) and/or **Assets**, depending on their roles and the company's plan.
- **Roles** (built in the Admin → Roles screen) grant permissions per app. A person can hold several roles; permissions add up.
  - **Tasks permissions** (with a scope where shown: Own · Team · Department · Company):
    see tasks (scoped) · give tasks to others · delete work assigned to an admin (Super Admin only) · team dashboard ·
    notifications · see/edit leads (scoped) · see won leads · assign leads · quotations · AI inbox · approve leave &
    attendance corrections (department) · HR administrator · manage users · company settings. Plus a role **level**
    (Member / Manager / Admin). In the code these appear as capabilities such as `tasks.view_all`, `tasks.view_department`,
    `tasks.assign`, `hr.approve`, `hr.manage`, `users.manage`, `settings.manage`.
  - **Assets permissions** (yes/no): view the organisation dashboard (`dashboard:view`) · view all assets (`asset:view`) ·
    add assets (`asset:create`) · edit asset details (`asset:edit`) · assign, transfer and return (`asset:assign`) ·
    receive, retire, dispose, lost/found (`asset:lifecycle`) · manage catalogue & custom fields (`catalog:manage`) · manage
    departments & vendors (`org:manage`) · view employees (`employee:view`) · add & edit employees (`employee:manage`) ·
    change employee status (`employee:status`) · view exit cases (`exit:view`) · recover assets from leavers
    (`exit:manage`) · override an exit (`exit:override`) · raise requests (`request:create`) · approve requests
    (`request:approve`) · fulfil requests (`request:fulfil`) · raise tickets (`ticket:create`) · manage tickets
    (`ticket:manage`) · maintenance (`maintenance:manage`) · organisation activity log (`history:view`) · users & roles
    (`user:manage`) · plan onboarding (`onboarding:manage`) · leadership overview (`insights:leadership`).
    Two shorthand rules used throughout Assets: **"IT"** = has `asset:assign`; **"employee-only"** = does not have
    `employee:view` (a plain employee: sees only their own assets, requests, tickets, QR).
- **Module switches** (Admin → Settings → Modules): a company can switch parts off; switched-off parts disappear from menus,
  their screens refuse to open, and their reminders stop. Switchable: Leads & quotations, AI inbox, Payroll, Mistake register,
  Links (Tasks); SIM register & reconciliation (Assets).
- **People directory** (Admin → People): department, designation, reports-to (manager), joining date, active/inactive.
  It drives approvals ("manager first"), the Team/Department scopes, exits and joiners in every app.

### 0.5 Journeys that cross screens and apps (design them end to end)
1. **Sign in → choose workspace → work → switch app → sign out** (one login for everything).
2. **A task's life**: someone gives a task (with steps, files, due date, effort) → the assignee updates progress / daily log /
   comments → completes it with remarks, minutes spent and proof → the giver (or the assignee's manager) **accepts** or
   **sends it back** → reports and scores update. Changes to someone else's task go through a **change request**
   (approve / reject / escalate to admins). Unreviewed items remind the approver, then escalate.
3. **Attendance**: check in on the phone (location check, face check and/or photo, as the company configured) → check out
   → corrections and leave requests → manager/HR approval → monthly calendar and team view.
4. **New joiner**: admin adds a person with a joining date and roles → they get their role's joining-checklist tasks and
   an Assets onboarding case (with the kit named like their role) → HR plans the kit → IT prepares and issues the items →
   joined.
5. **Exit**: admin clicks "Start exit" with a last working day → Assets opens an exit case listing everything they hold,
   Tasks gives their manager an exit checklist → assets are scanned back (or the exit is overridden) → completing the case
   switches the person off in every app.
6. **Asset ticket → task**: someone raises a ticket in Assets → it becomes a task for the IT owner in Tasks, linked both
   ways → when that task's work is accepted, the ticket is resolved automatically.
7. **Asset request**: employee asks for an item → their manager or an approver approves → IT fulfils by assigning an asset
   (with a photo) → it shows under the employee's assets.
8. **Role duties**: an admin adds duties to a role (daily / weekly / monthly / on joining) → everyone holding the role gets
   those tasks automatically, once per period.

### 0.6 Classic screens (not part of this redesign yet)
These open the old screens at `/classic/tasks/…` or `/classic/assets/…` with the same sign-in. Menu items for them carry a
"opens the classic screen" marker. They are switched off for new companies; CarTrends uses some of them.
Leads · AI inbox · Mistake register & SOPs · Links · Payroll & My salary (HR tabs link out) ·
SIM cards · SIM reconciliation. Any `/tasks/…` or `/assets/…` URL the new app does not have also falls back to the classic
screen, so nothing is ever a dead end.

### 0.7 Names the automated tests rely on
The browser tests (`e2e/*.spec.ts`) click through every screen by **visible name**: headings ("Choose your workspace",
"People & access", "Settings"), button and link names ("Sign in", "Add person", "New role", "Save role", "Change roles",
"Start exit", "Check in", "Save company"), field labels ("Email, username or employee ID", "Password", "Last working day",
"Short name (menus and titles)", "Brand colour code"), switch names ("Tasks: Leads & quotations"), and navigation names
("Workspaces", "Tasks menu", "Assets menu", "Admin menu", "Your account"). Renaming is fine: tell Claude, and the tests are
updated in the same change. Removing a function is not.

---

## 1. App frame (every screen)

**Behaviour that applies everywhere**
- Success and errors are shown inline: an error note (role=alert), a status text, or a dialog closing. A toast area exists
  (bottom right) for screens that use it.
- Lists refresh themselves after a change; data refetches when the window regains focus (stale after 20 s); dropdown lists
  are cached for 5 min. Failed loads retry up to 2 times (not for 4xx).
- **Standard blocks**: load error ("Couldn't load this", the message, "Try again") · empty (icon, title, optional
  description and action) · page loader (skeleton) · confirm dialog (title, optional description, "Cancel", a confirm
  button labelled per use, default "Confirm"; can be destructive).
- **Download** (PLAN.md §19.31): every list / report screen has one "Download" menu in its header (or its section's
  header): Excel (.xlsx) / CSV, plus PDF / ZIP where offered (payslips, invoices). The file has ALL rows matching the
  current filters, search, sort, tab and date range (up to 50 000), not just the visible page; disabled with "Nothing to
  download for these filters" when nothing matches; allowed in read-only mode. Each payslip (My salary, Payroll → a run)
  and each invoice has its own "PDF" button; a payroll run also offers "All payslips (ZIP of PDFs)" and "(one PDF)".
  File names `<area>-<screen>-<filters>-<date>.<ext>`; in the phone app the file goes to the app's share/save sheet.

### 1.1 Sign-in model
- One sign-in for all apps. The access token lasts 15 minutes and lives in memory only; it is renewed from an httpOnly
  refresh cookie, one renewal at a time. Any call that gets 401 renews once and retries; if that fails the person is signed
  out and sent to `/login?next=<current path>`.
- Token claims: person id, company, name, level (`owner` | `admin` | `member`), and the apps they may open (`tasks`, `assets`).
- **Admin** = level owner or admin.

### 1.2 Access, module switches, brand
- Sources: Platform "me" (person, company name/short name/colour/logo, apps, must-change-password); Tasks "me" (role
  name, capabilities, module switches) if the person has Tasks; Assets "me" + config (role, permissions, module switches)
  if they have Assets. Pages wait until these have loaded.
- Module switch: on unless the server says off. A Tasks capability counts only if its module is on (`leads.*`,
  `quotations.*` need Leads; `intake.*` needs AI inbox). An Assets permission check passes if the person has ANY of the
  listed permissions.
- Brand: `{name, short name (falls back to name), colour, logo}`; without it, Kaampilot defaults.

### 1.3 Route map
| URL | Screen | Guard |
|---|---|---|
| `/login` | Sign in | public |
| `/` | Workspace chooser | signed in |
| `/account` | Change password | signed in (no menus) |
| `/people`, `/roles`, `/settings` | Admin screens | signed in + owner/admin |
| `/tasks/…` | Tasks workspace | signed in + Tasks |
| `/assets/…` | Assets workspace | signed in + Assets |
| anything else | "Page not found" | signed in |

### 1.4 Session guard (every page except `/login`)
- A fresh page first renews silently from the refresh cookie (loader meanwhile).
- Not signed in → `/login?next=<path+query>` (no `next` for `/`).
- Must change password (set by an admin) → `/account?first=1&next=<path+query>` from any other page.
- A `next` value is honoured only if it starts with `/`, not `//`, and not `/login`.

### Sign in
- **URL** `/login` (`?next=<in-app path>`). **Who** anyone.
- **Auto sign-in**: on open it tries to renew silently (another tab, or a still-valid cookie); if that works it goes to
  `next` (or `/`).
- **Shows** (PLAN.md §19.35): the Kaampilot lockup "kaampilot.com" (the company is not known yet). Large screens: a side
  panel with "For Indian SMEs · 5 to 500 people", the headline "Your team's kaam, on autopilot.", the value line, a
  **Start free** button, a small drawn preview (punch card + task list), four benefits (Selfie + GPS punch, Tasks with
  approvals, Assets/joiners/exits, Payroll from attendance) and the trust line (Made in India · Data stays in India ·
  Works on low-end Android). Phones: lockup + one line above the form; "New to Kaampilot? Start free", the benefits
  and the trust line under it. Form title "Sign in".
- **Fields**: "Email, username or employee ID" (text, required, autofocus, trimmed) · "Password" (password, required).
- **Actions**: "Sign in" (disabled while either field is empty or while signing in; spinner) → `next` or `/`. Help text:
  "Forgot your password? Ask your company admin to reset it." (no reset flow: admins reset passwords).
- **Errors**: the server message in an alert (fallback "Sign-in failed").
- **Mobile**: the side panel is hidden; the logo sits above the form.

### Workspace chooser
- **URL** `/`; `?choose` = always show it, never auto-open; `?next=<path>` = go there once loaded.
- **Who** any signed-in person. **Purpose** "Choose your workspace" after sign-in.
- **Auto-open** (only without `?choose` / `?next`): 1) a remembered workspace (this device) they still have → open it;
  2) else exactly one app and not an admin → open it; 3) else show the chooser.
- **Shows**: header with company logo/short name, the person's name (hidden on phones), "Change password" (→ `/account`),
  "Sign out" (→ `/login`). Title "Choose your workspace", "Hi {first name}. Where would you like to go?".
  No apps: "You don't have access to any app yet." + (admins) "Give yourself a role under People & access." /
  (others) "Ask your company admin for access.".
  **App tiles** (one per app they have): "Tasks" — "Tasks, checklists, attendance and leave" (→ `/tasks`); "Assets" —
  "Assets, joiners, exits, requests and tickets" (→ `/assets`).
  "Remember my choice on this device" checkbox (only with more than one app; ticked if a choice is remembered; clicking a
  tile saves or clears the choice).
  **Admin section** (owners/admins): "People & access" — "Add people, give them roles, reset passwords" (→ `/people`);
  "Roles" — "What each role can do, and its duties" (→ `/roles`); "Settings" — "Company, modules and departments"
  (→ `/settings`). Admin tiles never change the remembered choice.

### Change password / first-time password
- **URL** `/account`; `?first=1` forced mode (also when the server says the password must change); `?next=<path>` where to
  go after a forced change. Outside the menus; Kaampilot logo.
- **Texts**: forced — "Choose a new password", "Your password was set by an admin. Pick your own before you continue.";
  normal — "Change password", "Your other devices will be signed out; this one stays signed in.".
- **Fields** (all required): "Current password", "New password", "New password again".
- **Checks**: at least 8 characters ("Use at least 8 characters."); the two match ("The new passwords do not match.").
  Server errors: the first field error or the general message.
- **Actions**: "Save password" (spinner); "Back" (normal mode only). After success: normal — fields clear, "Password
  changed."; forced — go to `next` or `/`.

### App shell (around `/people`, `/roles`, `/settings`, `/tasks/…`, `/assets/…`)
- **Current workspace** from the path: `/tasks…` Tasks, `/assets…` Assets, `/people` `/roles` `/settings` `/account` Admin.
- **Workspaces offered**: each app the person has, plus Admin for owners/admins. Opening a workspace they may not use →
  `/?choose`.
- **Page title**: "{company short name} · {Tasks | Assets | Admin}" (or "Kaampilot · …").
- **Brand**: the company colour replaces the primary colour; the logo (or the first letter of the short name, or "FF").
- **Assets photos**: when the person has Assets, the shell also obtains the Assets photo cookie.
- **Sidebar**, in order:
  1. Logo — link to `/?choose` ("Choose workspace").
  2. **Workspace switcher** (navigation "Workspaces"; only with more than one workspace): one entry per workspace, current
     one marked; links to `/tasks`, `/assets`, `/people`.
  3. **Workspace menu** (navigation "{Workspace} menu"): the workspace's items filtered by their show-rules, with group
     headings; the current item highlighted. **Classic items** do a full page load to `/classic/…`, show an "opens the
     classic screen" marker and are never highlighted.
  4. **Account menu** (button "Your account"): avatar (initials), name, role line (Tasks role → Assets role → "Admin" →
     "Member"). Menu: company name; "Dark mode" / "Light mode"; "Change password"; "Sign out".
- **Theme**: toggles immediately and is remembered on the device; first visit follows the device setting.
- **Top bar**: menu button and compact logo (phones/tablets), then the notifications bell.
- **Content**: a loader until access is ready; lazily loaded screens show a loader while loading.
- **Phones**: the sidebar becomes a left drawer opened by "Menu"; it closes after any navigation.

### Notifications bell (PLAN.md §19.37)
- One bell for every app: the Tasks and Assets notifications, merged newest first, refreshed every 30 s. If one app fails
  it counts as empty.
- **Badge**: unread count of all areas ("99+" above 99); none at 0. Button name "Notifications, N unread" / "Notifications".
- **Panel**: "Notifications" + "Mark all read" (marks the open tab only; disabled with nothing unread there). Tabs
  (ARIA tabs, arrow keys move): **All · Attendance · Tasks · Assets · Approvals · Company**, each with its unread count
  (tab name "Tasks, 2 unread"). List "Latest notifications" (max 30 of the tab): title (bold when unread, on a light tint
  with a bar in the theme colour on the left; screen readers hear "Unread:"), body (2 lines), "Area · relative time".
  Click → marks it read, closes the panel and opens the item inside the app (relative links are prefixed with `/tasks` or
  `/assets`). Empty: "You're all caught up.". Footer "All notifications" → `/notifications?tab=<the open tab>`.
- **Areas**: Attendance = leave decisions, attendance, payslips; Approvals = leave / correction requests, task change
  requests, finished work to accept, category requests, Assets requests and new joiners waiting for a decision, and their
  reminders / escalations; Company = notices, billing, system; Tasks = tasks, leads, mistakes; Assets = the rest of Assets.
- **Where a notification opens**: a task → `/tasks/tasks/<id>`; a leave / correction to approve →
  `/attendance/approvals?leave=<id>` (or `?correction=`; that request is outlined and scrolled into view); a leave decision →
  `/attendance/leave?leave=<id>`; task digests → `/tasks/tasks?tab=my`; a mistake → `/tasks/mistakes?open=<id>`; a lead →
  `/tasks/leads?lead=<id>`; a notice → `/tasks/notices?n=<id>` (opened and marked read); an asset → `/assets/assets/<id>`;
  a request / ticket → `/assets/requests?open=<id>` / `/assets/tickets?open=<id>`; exits, onboarding, reconciliation → their
  detail page.

### Classic screens
- Any path under `/tasks` or `/assets` the new app does not have → full page load to `/classic<path><query>` (homes get a
  trailing slash). Same sign-in. Old links therefore always open something.
- Menu items that open classic screens: Tasks › More: "Leads" (Leads on + any leads view capability), "AI inbox"
  (`intake.view`), "Mistakes", "Links" (each: its module on). Assets › More: "SIM cards",
  "Reconciliation" (IT + SIM module on).

### Errors
- **Page not found** (unknown path): "Page not found", "This page does not exist or was moved.", "Go to the start" (→ `/`).
- **Crash / new version** (full page): when the app was updated while open — "A new version is available", "Reload to get the
  latest Kaampilot."; otherwise "Something went wrong" + the message. Button "Reload".

### Admin workspace menu
| Label | URL | Show-rule |
|---|---|---|
| "People & access" | `/people` | always (the Admin workspace is only offered to owners/admins) |
| "Roles" | `/roles` | always |
| "Settings" | `/settings` | always |
Home of the Admin workspace: `/people`.

---

## 2. Admin

**All admin screens**: owners and admins only; anyone else is sent to `/`.

### People & access
- **URL** `/people` (no query params). **Purpose**: everyone at the company: their login, level, roles and the apps those
  roles open.
- **Header**: "People & access"; "Everyone at {company}: their login and their roles. Roles decide which apps they can
  open."; primary action "Add person".
- **Search** "Search people" (placeholder "Search name, email, employee ID or username"), searched on the server 250 ms after
  typing. No filters, sorting or paging: every match is shown.
- **Columns**:
  1. "Person": full name; email · employee ID (or "—"). Inactive people dimmed.
  2. "Level": "Owner" / "Admin" / "Member"; "Inactive" badge; "Leaving {last working day}" badge when an exit was started.
  3. "Sign-in" (hidden on phones): username, or "email / ID"; "Locked" badge; or "No login".
  4. "Roles": a badge per role (system roles marked); "No role"; button "Change roles" (disabled for inactive people).
  5. "Apps" (hidden on phones): "Tasks" / "Assets" chips, or "—".
  6. Actions: "Edit" (opens the person sheet) and the menu "More actions for {name}":
     - "Reset password" (has a login) / "Create login" (no login) — confirm "Reset password?" / "Create login?", "Set a new
       password for {name}? They will be signed out everywhere." → **Login ready** dialog.
     - "Start exit" (or "Exit started" when a date is set) — active people other than yourself → **Exit** dialog.
     - "Deactivate" (destructive; active, not yourself) — confirm "Deactivate {name}?", "They will be signed out of every app.".
     - "Activate" (inactive, not yourself) — no confirmation.
- **States**: skeleton rows; refresh bar; load error with "Try again"; empty "No one found." (+ "Try another name, email or ID."
  when searching).

#### Add person / Edit {name} (side panel)
- Title "Add person" / "Edit {full name}"; add: "They can sign in with their email, employee ID or username.".
- Footer: "Ctrl Enter to save" hint, "Cancel", "Save" (Ctrl/⌘+Enter saves).
- **Fields**: "Full name"* (required; "Enter their full name") · "Email" · "Employee ID" · "Mobile" (phone keypad) ·
  "Access level" ("Member", "Admin", and "Owner" only for owners; locked when editing yourself, or an owner when you are not
  one; default Member) · "Department" ("—" + active departments) · "Designation" (max 80, "e.g. Sales Executive") ·
  "Reports to" ("— nobody (approvals go to admins) —" + active people except this one) · "Joining date".
  Add only: "Create a login now" (ticked by default) → "Username (optional)", "Password (blank = generate one)" (visible).
- Server field errors under their fields; general error at the bottom.
- After save: edit → closes; add with a generated password → **Login ready**; otherwise closes.
- Rules behind the fields: a person cannot report to themselves or create a loop; a department/manager must be from this
  company; only an owner makes owners; a company keeps at least one active owner.

#### Login ready (dialog)
"Login ready" · "Give these to {name}. They will choose their own password the first time they sign in." · "Sign in with"
(username, else email, else employee ID) · "Password" (the generated one, or "(the one you entered)") · "This password is shown
only once and is never stored where anyone can read it." · "Done".

#### Roles of {name} (dialog)
"Pick one or more roles. Their permissions add up; the widest scope wins." · every role as a checkbox (current ones ticked),
"Built in" badge on Admin and Member, app chips; "Make Admin" / "Make Member" buttons; "Extra access and responsibilities" (the role editor's picker for this person only, PLAN.md §19.28) with "From roles … · Extra …". Live summary:
"{First name} will be able to open: Tasks, Assets." / "… will not be able to open any app." + "Losing an app signs them
out." · "Cancel", "Save roles".

#### Exit: {name} (dialog)
- Form: "Assets opens an exit case listing what they hold; Tasks gives their manager the exit checklist." · "Last working
  day"* (date; prefilled when an exit was started) · "Reason (optional)" (max 300) · "Cancel", "Start exit".
- Result: "Exit started. Last working day {date}. They stay active until the exit is complete." · Assets: "exit case
  {number}" + "open it" link + "Completing it (all assets back) switches them off everywhere." (or the error) · Tasks:
  "exit checklist {code} for their manager." (or the error) · neither app: "They have neither Tasks nor Assets: deactivate them
  on their last day." · "Done".

> **Update 2026-10-12 (PLAN.md §19.19): every feature is a permission.** The role editor lists every feature of Tasks
> (incl. Attendance, Leads, Notices, Mistakes & SOPs, Links, HR administration), Assets and the **Admin**
> workspace (a third "app": "Manage people", "Reset passwords", "Start exits", "Delete people permanently", "Manage roles",
> "Company settings"), each with a one-line description. Admin and Member are built in (edited, never archived or renamed; PLAN.md §19.28); the Owner is a mark on the person
> (everything), not a role; every other role can be edited and archived. Menus and buttons follow the permissions: e.g. a role with only "Live attendance"
> and "See notices" shows Attendance → Today + Live attendance and Tasks → Home, Tasks, Groups, Notices, My team. Admin →
> People & access / Roles / Settings each need their own Admin permission (owners and admins have all); a page you may not
> open sends you to the Admin page you may open, or `/`.

### Roles
- **URL** `/roles`. **Purpose**: what each role can do in every app; a person can hold several roles.
- **Header**: "Roles"; "What each role can do in every app, the Admin workspace included. A person can have several roles;
  their permissions add up. … Admin and Member are built in …"; action "New role".
- **Columns**: "Role" (name, "Built in" badge on Admin and Member, description or "{n} permission(s)") · "Level" ("Member" / "Manager" / "Admin") ·
  "Apps" (hidden on phones; chips or "None") · "People" (holders) · actions: "Edit" (or "View" for locked roles) ·
  "Duplicate" (no confirmation) · "Archive" (not locked; confirm `Archive "{name}"?`, "{n} people lose it (and any app only it
  gave them).").
- **States**: skeleton, load error, "No roles yet".

#### Role editor (wide side panel)
- Title "New role" / "Edit {name}" / "{name}" (locked). Description: "Tick what this role may do, and how far each
  permission reaches. Nothing is ticked until you choose." (locked: "{description} Duplicate it to make an editable copy." —
  everything read-only, footer only "Close").
- **Start from** (new roles only): "Blank: nothing ticked" or "Copy from {role}" (copies its permissions and level; hint
  "Copies that role's permissions and level; change anything before saving.").
- **Fields**: "Name" (required, max 80; saving without one shows "Give the role a name" under the field and in the footer,
  and focuses it) · "Level" ("Member", "Manager", "Admin"; the hint describes the selected level — Member: "Uses the apps
  with exactly the permissions ticked below."; Manager: "Same as Member: the ticked permissions decide what they can do.
  Tasks also lists them as a manager people can report to."; Admin: "Also an administrator in Tasks: sees everyone's
  delegated work on Tasks Home and manages other admins' Tasks accounts; work given to them is protected from deletion
  (only the Owner can delete it).") · "Description (optional)" (max 300).
- **Permission matrix**: "Permissions" with "{n} on" and a "Search permissions" box (matches label, description, group).
  A collapsible section per app ("Tasks", "Assets", "Admin"; button "Show/Hide", "{n} / {m} on", "Select all" and "Clear"),
  then a collapsible group (with "{n} / {m}", "All", "None"). Each permission is a checkbox ("{App}: {label}") with its
  one-line description under it; when ticked and the permission has scopes, a scope choice "Scope for {label}" with the
  scopes it supports ("Own", "Team", "Department", "Company"); a newly ticked permission starts at the narrowest. Phones:
  44 px rows and scope buttons. Legend: "Own = only my records · Team = mine and my direct reports · Department = everyone
  in my department · Company = everyone." The list comes from the apps and the Platform (see §0.4; PLAN.md §19.19).
- **Duties** (editable roles only): "Duties" — "Each duty becomes a task in Tasks for everyone with this role, at the time you
  choose. Steps become its checklist." Per duty: "Duty" (required, max 150) · "When" ("Every working day", "Every week",
  "Every month", "Once, when someone gets this role") · "Day" (weekly; Monday–Sunday) · "Date" (monthly; 1–28) · "Steps (one
  per line, optional)" · "Remove duty". "Add duty".
- Footer (stays at the bottom): "Cancel", "Save role" (always enabled; without a name it says why).

### Settings (Settings Center)
- **URL** `/settings`. **Purpose**: the company's name and look, module switches, departments, links to each app's settings.
- **Header**: "Settings"; "Your company's name and look, and which parts of each app are switched on.".

#### Company
"The name and look people see in every app." · "Company name" (required, 2–120) · "Short name (menus and titles)" (max 40;
blank = company name) · "Brand colour": colour picker + "Brand colour code" (`#RRGGBB`, placeholder "Default") + "Default"
(clears it) · "Logo": preview or "No logo"; "Upload"/"Change" (PNG, JPEG or WebP up to 512 KB; uploads at once; "The logo
must be at most 512 KB"); "Remove" (at once). · "Save company" → "Saved". If an app could not be updated: "Saved, but {app}
could not be updated yet. It is sent again automatically on the next change."

#### Modules
"Switch off what your company does not use: it leaves the menus and its reminders stop. Nothing is deleted." · per connected
app, one row per module (label, description, on/off switch "{App}: {module label}"); saves at once. Empty: "No app is
connected.". The module list comes from the apps (§0.4).

#### Departments
"Used by People, approvals and the Department scope of roles, in every app." · rows: name, "Inactive" badge, "{n} people",
"Rename" (inline: "New name for {name}", "Save", "Cancel"), "Deactivate"/"Activate" (at once). Add: "New department" (max 60)
+ "Add department". Empty: "No departments yet.". Codes never change, so renaming is safe.

#### App settings
"Each app keeps its own detailed settings. These open in the app." · link cards (only for apps in the plan): Tasks — "Task
rules" (`/tasks/settings`: "Completion evidence, departments, task categories, notifications"), "HR settings"
(`/tasks/hr?tab=settings`: "Working hours, week-offs, punch-in locations and photo, face check, leave types"); Assets —
"Asset catalogue" (`/assets/settings/catalog`: "Categories, asset types and custom fields"), "Departments & vendors"
(`/assets/settings/departments`: "Lists used by assets and people").

---

## 3. Tasks: the task workspace

**Shorthands**: **Admin** = `tasks.view_all` · **Manager** = Admin or `tasks.view_department` · **Assigner** = `tasks.assign`
(manages templates, adds categories directly, assigns directory templates to others) · **Assignee** = the task is assigned to
me · **Creator** = I gave the task. A capability counts as missing when its module is switched off.

**Everywhere in the workspace**: after any change (status, complete, comment, step, review, request, follow, delete, restore,
template…) every task list, count, dashboard, group and notification reloads. Errors and successes appear as toasts (texts
given per action). Dates read "8 Oct, 05:30 pm"; relative due dates "6 hours from now" / "2 days overdue"; effort "45m",
"1h 30m", "2h".

### 3.1 Workspace overview
- **URLs**: `/tasks/tasks` (the workspace) and `/tasks/tasks/:taskId` (the same workspace with the task detail open over it;
  the list and its filters stay underneath). Page title "Tasks"; a tab bar "Task views"; each tab is `?tab=<key>`
  (Dashboard has none).

| # | Key | Label | Who sees it |
|---|---|---|---|
| 1 | (none) | "Dashboard" | everyone |
| 2 | `my` | "My Tasks" | everyone |
| 3 | `all` | "All Tasks" | Managers, or anyone who can see more than one person ("has a team") |
| 4 | `delegated` | "Delegated" | everyone |
| 5 | `subscribed` | "Subscribed" | everyone |
| 6 | `reviews` | "To accept" / "To accept (n)" | everyone (n = my review inbox) |
| 7 | `requests` | "Requests" / "Requests (n)" | everyone (n = my change-request inbox) |
| 8 | `templates` | "Templates" | everyone |
| 9 | `directory` | "Template Directory" | everyone |
| 10 | `activities` | "Activities" | everyone |
| 11 | `employees` | "Reports" | Managers |
| 12 | `time` | "Time Report" | everyone |
| 13 | `disputes` | "Disputes" | Managers |
| 14 | `deleted` | "Deleted" | Admins |

- **Design note**: today an unknown tab, or one the person may not see, shows an empty area. A new design should show the
  default tab (or a friendly "not available" message) instead.
- **Other URL parameters**: `?user=<id>` opens a **Person Profile** over any tab (closing removes it). `/tasks/tasks/:taskId`
  opens **Task Detail**; `?review=accept|reject` comes from the completion email's buttons. Closing the detail returns to the
  same list URL. Opening a task from a link outside the app (email, notification) focuses the comment box.
- **Overlays**: Add Task form · Person Profile · Task Detail.
- **Phones**: only the first 4 tabs stay visible; the rest are in a "More" menu (its trigger shows the active tab's name when
  that tab is hidden).

### 3.2 Task lifecycle (as the UI exposes it)
- **A task has**: code ("T-00042"), title, description, category, department, group, lead, a link to what it is about in
  another app (e.g. an Assets ticket), parent (sub-tasks), assignee, creator, status, priority, frequency + repeat-until,
  due date, overdue flag, completed date, created/updated/deleted dates, effort (set by the assigner), the assignee's own
  estimate, actual time (self-reported), progress %, completion note, followed-by-me, pending change requests, can-delete.
  In detail also: checklist steps, sub-tasks, day log, activity feed, files.
- **Statuses**: "Open", "In progress", "Done". **Priorities**: "Low", "Normal", "High", "Urgent" (Normal is never badged).
  **Frequency**: "One time", "Daily", "Weekly", "Monthly".
- **Open → In progress**: the assignee posts a **Status update** (% done, time spent so far, comment), shown as "N%" and
  "Xh spent".
- **→ Done**: only the assignee completes, always through the **Complete** dialog: remarks (required), total time spent
  (required, ≥ 1 min), proof files (required only if the company requires them). "Complete" is blocked while any step is open
  ("Finish the N open step(s) first"). Completing sends the work for **review** by whoever gave the task.
- **Done → Open**: the assignee unticks the done checkbox (if evidence is needed the Complete dialog opens instead).
- **Review ("To accept")**: the reviewer **Accepts** (one click) or **Sends back** with a reason (≥ 10 characters; the task
  reopens and shows "Sent back" + the remarks). Bulk accept in the inbox (confirmation; the server reports accepted and
  skipped counts).
- **Change requests**: non-admins (assignee, creator) propose changes + a required reason; the approver is the task creator
  (or an admin if I created it). Possible changes: new due date, priority, effort, reassign, new title, stop recurrence, cancel
  the task. **Admins** use the same dialog as "Edit task": applied at once and logged ("Cancel this task" moves it to Deleted).
  The approver (Requests → "To approve") can **Approve**, **Reject**, or (non-admins) **Escalate** to an admin, each with
  optional remarks. Rows with pending requests show a pencil badge with the count. Unanswered requests remind, then escalate.
- **Steps (checklist)**: added at creation (max 30, ordered, optional due time) or in the detail. Ticking a step requires a
  note "What did you do?" (≥ 5 characters) and shows "✓ note — name, date"; unticking reopens it at once; removing an open step
  asks "Remove this step?" (done steps cannot be removed). The task completes only when every step is ticked ("N step(s) left
  — the task can only be completed once every step is ticked.").
- **Daily progress log**: one entry per task per day (posting again replaces it), readable by everyone who sees the task:
  "What I did today" (required, ≥ 5 characters), "Plan for tomorrow", "% done at end of day", "Time spent today" ("This one day
  only, not the running total."). The server says which days can be written (not future, within the allowed back-fill days).
  Shown only when the log spans more than one day; the assignee also gets "Today's log".
- **Recurrence**: chosen at creation; the due date is the first occurrence; optional "Repeat until" (blank = forever). Rows show
  "Daily till 8 Oct". Stopped via a change request / admin edit. Filter "Recurring only".
- **Effort & estimates**: the assigner sets effort (required). The assignee may record their own estimate once while the task is
  open ("Disagree with the effort? Record your own estimate."). Actual time comes from status updates (running) and completion
  (final). The Disputes report compares the three.
- **Follow**: every row has "Follow"/"Following". "Loop" people chosen at creation follow automatically. The Subscribed tab
  lists followed tasks.
- **Delete / restore**: "Delete" in the detail when the server allows ("Delete {code}?" / "… moves to the Deleted bin and can
  be restored by an admin." → toast "{code} moved to Deleted"). Admins restore from the Deleted tab ("Deleted tasks are never
  destroyed").
- **Role duties** (from Admin → Roles) and **automation** (an Assets ticket, an exit checklist) also create tasks; they look
  like any other task, with a link to what they are about.

### 3.3 Dashboard tab
- **URL** `/tasks/tasks`; its filters are not in the URL. **Purpose**: headline counts and a per-category breakdown for a
  period; each tile opens the matching list.
- **Filters**: date range (default "This Week"; Today, Yesterday, This Week, Last Week, This Month, Last Month, This Year, All
  Time, "Custom range…" with "From date" / "To date"; once loaded it shows the counted dates, e.g. "01 – 07 Oct 2026 · counted
  by due date") · "Whose tasks": "My Report" / "Delegated" / "Group" (Managers) · category ("All categories" + used categories)
  · "Search tasks…" · "View": "Table" / "Bar chart".
- **Tiles** (with "X of Y tasks" / "X of Y completed"): "Overdue" (alert), "Pending", "In Progress", "Completed", "Finished on
  time", "Finished late" (alert). Clicking ("Open the matching task list") → My Tasks (or Delegated) with the matching filter
  (Overdue → open + overdue; Pending, In Progress → open; Completed → done; on time / late → done + on_time / late). Not clickable
  in Group scope.
- **Table**: Category, Total, Overdue, Pending, In progress, Completed, In time, Delayed. **Chart**: a bar per category (Total),
  tooltip with the breakdown.
- **States**: 6 tile placeholders; error + Retry; "No tasks in this range."; a custom range waits for both dates.

### 3.4 Task lists: My Tasks · All Tasks · Delegated · Subscribed
- **URL** `?tab=my|all|delegated|subscribed`; every filter lives in the URL: `status` = `open` (default; open + in progress) |
  `in_progress` | `done` | `all` · `overdue=1` · `recurring=1` · `done=on_time|late` (with status done) · All Tasks: `range`,
  `start`, `end`, `person`, `dept`, `q` · Delegated: `person`.
- **Purpose**: assigned to me · everything I can see · what I gave others · what I follow.
- **Toolbar**: "Status" ("Open", "Done", "All"; in-progress-only shows "Showing in progress only") · "Overdue only" · "Recurring
  only" ("Only the tasks that repeat — daily, weekly or monthly") · a "Finished on time/late" tag with × · "Add task" (not on
  All Tasks).
- **All Tasks extras**: date range (default All Time; "counted by due date / completion date / completion date (done) or due date
  (open)") · Department ("All departments") · Person ("All people" / "Everyone in this department"; "Name — Role") · "Search
  task, code or person…" · "Clear" · "Profile" (opens the chosen person's profile) · summary "N tasks · X pending · Y in progress ·
  Z completed · W overdue".
- **Delegated extras — "Agents I've delegated to (n)"**: "Filter by agent", "Search agent…"; totals "N open · N overdue · N done
  on time · N done late · N given in all"; table Agent (role; "(inactive)"), Open, Overdue, Done on time, Done late, Total —
  every number is a button that filters the list to that person and state; first 8 agents then "Show all N agents"; a strip
  "Showing Name — {open tasks | overdue tasks | …}" with "× Clear".
- **A task row shows**: a done checkbox (assignee only; "Only the assignee can complete this task"); code; title (opens the
  detail; done tasks struck through); chips: category, group, repeat ("Daily till …"), priority, effort "⏱ 1h", "N%",
  "Xh spent"/"took Xh", "est. Xh", pending-change pencil + count; description (2 lines); completion note; meta: assignee (a
  profile link on All Tasks), "by {creator}" (not on My Tasks), "lead: {lead}", relative due (open only), "done {date}".
- **Row actions**: "est." (assignee, open, no estimate yet) · "Change" (non-admin) / "Edit" (admin) when I am assignee,
  creator or admin and it is open · "Follow"/"Following" · "+ update" (assignee, in progress) · status select (assignee, open):
  "Open", "In progress — status update", "Done".
- **States**: row placeholders · "Pick both dates" · error + Retry · empty: "No tasks assigned to you here." / "No tasks match
  these filters." / "No tasks you delegated to others here." / "You are not following any tasks. Use Follow on a task to follow
  it.". Up to 200 rows; order from the server; no search on My/Delegated/Subscribed.
- **Phones**: row actions stack under the content; filters wrap.

### 3.5 Add Task form (side panel)
- **Opened by** "Add task", or "Use" on a template (pre-filled). Title "Add task" / "New task from "{template}"";
  "Each person you pick gets their own copy of the task.". People offered are those I may give tasks to.
- **Helpers**:
  - **"Voice draft"** (replaced "Speak the task" and the "AI draft" box, 2026-10-20, PLAN.md §19.30) with a language picker
    (English / हिंदी, remembered): in the phone app (1.1.0+) the phone's own speech recogniser after Android's "Allow
    microphone?" pop-up ("Done · mm:ss" stops it; blocked → "Open settings" + "Try again"); in Chrome / Edge / Safari on https
    or localhost the browser's speech recognition (asks for the microphone first; blocked → the steps to allow it for this
    browser/phone, "Try again", "Use the keyboard mic instead"); otherwise (older app, the http:// address, Firefox) a box to
    speak into with the keyboard's mic → "Fill in the form". The server reads person, deadline and effort from the words (no AI
    key needed) and tidies the title. Shows "Heard: …" with warnings ("Could not place the name "X" — pick the person below.",
    "The time it heard has already passed — set the due date below.", "Check every field before creating — this was filled in
    from speech."). Never creates by itself.
- **Fields**:

| Label | Type | Required | Rules / help |
|---|---|---|---|
| Title | text | ✔ | "e.g. Call Ravi with revised quote" |
| Description | multi-line + "Check spelling" | ✔ | "What exactly has to be done? Press Enter for a new line — write as many points as you need." |
| Assign to | searchable multi-select (name or department) | ✔ (≥ 1) | "Anyone in the company. Each person gets their own copy."; "Assign to myself"; "— pick people —" / "N selected" |
| Due (or "Due (first occurrence)") | date-time | ✔ | not in the past ("That time has already passed — check AM/PM.") |
| Effort | number + "min"/"hours" | ✔ | "How long should this take?"; ≥ 1 min / 0.1 h |
| Category | select | ✔ | general + the department's categories ("(general)"); inline "New" (Assigner: added at once) / "Request" (others: "Your manager gets this and approves it — pick an existing category for now.") |
| (workload) | info per assignee | — | see below |
| Department | select | — | "General (no department)" + departments; default mine |
| Frequency | select | — | One time / Daily / Weekly / Monthly |
| Repeat until | date | — | recurring only; "Optional — leave blank to repeat forever." |
| Priority | select | — | default Normal |
| Group | select | — | "None" + groups "Name (N members)"; "Picking one fills Assign to with its members." |
| Loop | multi-select | — | "Colleagues who follow this task, but are not doing it." |

- **"Steps to finish this task"** (optional): "e.g. Collect the invoice copy from accounts" + optional due time → "Add step"
  (max 30); each step: move up/down, drag, edit, remove.
- **"Attachments"** (optional): "Add photo or file"; up to 5 files, 10 MB each; duplicates dropped; "Everyone on the task can open
  them."
- **Footer**: "Ctrl Enter to create" · "Cancel" · "Create task" / "Create N tasks" (enabled when every required field is filled).
  Errors: "Pick who this task is for — nobody is selected by default.", "Fill in every field marked *.", server errors, partial
  "Created X/Y, then failed: …". Result: one task per assignee (with steps, loop and files); toast "{code} created" / "N tasks
  created".
- **Workload panel** (per assignee): "Name's pipeline: no open tasks — free right now" or "N open (x urgent, y high) · N overdue ·
  Xh of effort pending (+N tasks with no effort value)"; when overloaded "Heavy pipeline — you can still assign; this warning never
  blocks." Informational only.

### 3.6 Task Detail (side panel)
- **URL** `/tasks/tasks/:taskId` (+ list filters, + `review=accept|reject`). Not readable → "Task not available" + Retry.
- **Header**: code, status, priority, title; "Assigned to X by Y · due {date} ({relative}) · completed {date} · lead: {name}";
  chips: category, effort, "Xh spent", "N% done", "sub-task of {code}", frequency, group. Description (links clickable);
  "Open what this task is about ↗" when linked to another app.
- **Actions**: assignee, not done: "Status update", "Today's log", "Complete" (blocked while steps are open) · anyone, not done:
  "Request change" (non-admin) / "Edit" (admin) · "Delete" (when allowed) · everyone: "Summarize" (AI summary; "works without
  AI too").
- **"Waiting for you to accept"** (a completion waiting for me): "Name marked this done · took Xh against Yh" + note; "Accept"
  (toast "Accepted"); "Send back" → "What is wrong?" (≥ 10 characters) → "Send it back". `?review=accept` scrolls here (does not
  auto-accept); `?review=reject` opens the send-back box.
- **"Checklist"** (done/total): warning while steps are open; each step: checkbox, text, due, done note; tick → Step done
  dialog; untick → reopens; remove (open steps; confirm). "Add a step…" + due time → "Add step".
- **"Sub-tasks"** (if any): code, title, assignee, status.
- **"Daily progress log"** (logged/total days): "N days with nothing written."; "Logged day by day: Xh · recorded total on the
  task: Yh"; one row per day ("today" marked) with the entry ("→ Next: …", "N% · Xh · author") or "Nothing written" / "Not yet";
  "Add"/"Edit" on writable days.
- **"Attachments"** (count): files (open in a new tab · uploader) or "No files yet."; "Add photo or file" uploads at once (toast
  "Uploaded"). Anyone viewing can upload.
- **"Comments & updates"**: "Write a comment…" + "Send"; a feed of comments and system updates (name or "System" · date · text).
- **Phones**: full-height panel; action buttons wrap.

### 3.7 Dialogs
All have "Cancel" and a submit that stays disabled until the form is valid.
- **Complete {code}**: "What was done?" (required, spell check) · "Assigned task time" (read-only) · "Total effort you spent"
  (required, ≥ 1 min; pre-filled) · "Proof files / photos" (required when the company says so; max 5, 10 MB each) · "Complete
  task" → "{code} completed".
- **Status update — {code}**: "every field is optional, add what you know. All updates stay in the task history." · "% work done"
  (0–100) · "Total effort spent so far" · "Comments" · "Post update" (disabled when all empty) → "Status update posted".
- **Add / Edit day log — {day}**: "one entry per day, so posting again replaces this one. Everybody who can see the task can read
  it." · "What I did today" (required, ≥ 5) · "Plan for tomorrow" · "% done at end of day" · "Time spent today" · "Save day log" /
  "Save this day" → "Day log saved".
- **Request a change — {code}** (non-admin) / **Edit task — {code}** (admin): "approved by the task creator / an admin, logged
  for admin" or "admin edit: applies immediately and is logged in the task activity." · optional: "New due date" (not past),
  "New priority" ("— keep —"…), "New effort (minutes)", "Reassign to", "New title", "Stop the recurrence" (recurring only), "Cancel
  this task entirely" (disables the rest) · "Reason" (non-admin, required) · "Send request" / "Apply changes"; nothing picked →
  "Pick at least one change."; results "Change request sent" / "Task updated" / "{code} moved to Deleted".
- **Step done**: "What did you do?" (required, ≥ 5) · "Mark done".
- **Your estimate — {code}**: "the assigner said Xh. Disagree with the effort? Record your own." · "Your estimate (minutes)" (> 0)
  · "Save estimate" → "Estimate saved".
- **"Check spelling"** (every multi-line field): replaces the text and shows "Spelling and grammar fixed." + "Undo"; or "Looks good,
  nothing to fix." / "Spell check is unavailable right now — right-click a red word instead." / "Could not check right now —
  right-click a red word instead.". Icon only on phones.
- **Effort input**: number + "min"/"hours" (hours may be decimal, ≥ 0.1; minutes whole, ≥ 1); stored as minutes.

### 3.8 To accept (reviews)
- **URL** `?tab=reviews`. **Who** everyone; "All (log)" for Admins. **Purpose**: accept or send back submitted work.
- "Which reviews": "To accept" (default), "My submissions", "All (log)".
- **Inbox toolbar**: "Submitted by" ("All people (n)", "Name (n)") · "Select all shown" · "Accept selected (n)" · "Accept all (n)" /
  "Accept all from {Name} (n)" — both confirm ("Accept N task(s) …?", "Each person gets one notification listing what you
  accepted.") → "Accepted N" or "Accepted N. M were already decided and were left as they were.". More than 300: "Showing the latest
  300 of N. Accept these and the rest will load."
- **Row**: checkbox (pending, inbox) · code, title · status for decided rows · "finished late" · "{submitter} · submitted {date} ·
  took Xh against Yh" (+ "over estimate") · note · "Proof attached · N" (image thumbnails, file links) · reviewer remarks ("Sent
  back: …", "Note: …").
- **Row actions** (pending): "Accept" → "{code} accepted"; "Send back" → "What is wrong?" (≥ 10) → "Send it back" → "{code} sent
  back".
- **Empty**: "Nothing waiting for you to accept." / "Nothing here yet."

### 3.9 Requests (change requests)
- **URL** `?tab=requests`. "Which requests": "To approve" (default), "My requests", "All (log)" (Admins).
- **Row**: code, title, status (Pending / Approved / Rejected / Escalated), "↑ escalated to admin", "Task of {assignee} ·
  created by {creator}", the list of changes, "Reason: …", "{requester} · {date} · reviewed by {name} — "remarks"".
- **Actions** (to approve, pending): "Remarks…", "Approve", "Reject", "Escalate ↑" (non-admins; "Let the admin decide this one") →
  "{code}: approved / rejected / escalated to admin".
- **Empty**: "Nothing waiting for your approval." / "No requests here."

### 3.10 Deleted (bin)
`?tab=deleted`, Admins. "Deleted tasks are never destroyed — they rest here, restorable any time." · rows: code, title, "{assignee}
· deleted {date}" · "Restore" → "{code} restored" · empty "The bin is empty."

### 3.11 Templates
- `?tab=templates`. Everyone can see and "Use"; "New template" and "Delete" need Assigner.
- Grouped by category ("General" when blank): name, priority, repeat, "title — description".
- "Use" → My Tasks with the Add Task form pre-filled. "Delete" → confirm "Delete template "{name}"?".
- **New task template**: "A blueprint your team can turn into a task in one click." · "Template name" (required) · "Category" ("e.g.
  Calls") · "Task title" (required) · "Description" · "Priority" · "Frequency" · "Save template" → "Template saved".
- Empty: "No templates yet" (+ "Create reusable task blueprints for your team." for Assigners).

### 3.12 Template Directory
- `?tab=directory`. Everyone can browse and create tasks for themselves; Assigners can assign to others and copy into their
  templates. **Purpose**: an industry library (industry → category → template → steps).
- "Search all templates…" (searches everything) · "← All industries" · category filter.
- Industry cards: icon, name, description, "N templates · M categories".
- Template: name, category, industry (in search), repeat, priority, description, "N steps · tags"; "Preview"/"Hide" → numbered
  steps (title, "day +N", description); "Assign to" (Assigners; "Assign to me" or a person); "Group" ("No group" or a group);
  "Create N task(s)" → "Created N task(s) from "{name}"."; "Add to my Task Templates" (Assigners) → "Added N template(s) to your
  Task Templates.".
- Empty: "No templates match."

### 3.13 Activities
- `?tab=activities` (filters not in the URL). Activity on tasks I can see.
- "Window": "Today", "7 days" (default), "30 days", "All" · "Whose task — anyone" / "Done by — anyone" (when I see more than one
  person) · "Search activity or task…" · "Clear".
- "Done by" chips with counts (click to filter, again to clear).
- List (latest 100): code, title, text, "{actor or System} · {date} · task of {assignee}"; click opens the task.
- Empty: "No task activity in this window."

### 3.14 Reports
- `?tab=employees`, Managers. Sub-reports: "Employees" (default), "Categories", "My Report", "Delegated", "Daily", "Monthly",
  "OverDue", "Groups". Date range (default This Month; custom). "Export CSV" (`report-{tab}-{range}.csv`).
- Columns: Employee / Category / Month / Group / Date · Total · Score (ring with on-time %; "—" = "Nothing scored yet"; 75%+ good,
  45–74% warning, below 45% bad) · Overdue (% of total) · Pending (%) · In progress (%) · In time (% of completed) · Delayed (%).
- Employees: the name opens the Person Profile; "N self-assigned" ("Created for themselves — not scored"); a 💡 review hint.
  Daily: dates, Total = completed. OverDue: "Overdue since" ("today" / "N days ago" / "N month(s) ago").
- Footer (Employees, My Report): "Formula (open, not a black box): {formula}."
- Empty: "Nothing completed in this range." / "Nobody is overdue right now." / "You have no tasks in this range." / "Nothing in this
  range."

### 3.15 Time Report
`?tab=time`, everyone (the server decides whose rows). "Period": Today, This Week, This Month (default), This Year, All Time.
"Time Earned = the assigner's task time, credited when the task completes. Time Spent = the actual effort the person reported. A
big gap either way is a conversation, not a verdict." · columns: Person (+ "N tasks had no effort value — earned 0"), Done, Time
earned, Time spent, Difference ("+Xh over" / "−Xh under"). Empty "No completed tasks in this period."

### 3.16 Disputes
`?tab=disputes`, Managers. Date range. Where assigner and assignee disagreed, "Sorted by the size of the disagreement; the Actual
column settles the argument." · Task (code, title, "assigned by X"), Assignee, Assigner said, Assignee said (higher = bad, lower =
good), Actually took, Status. Empty "No disputes in this range — everyone agrees."

### 3.17 Person Profile (side panel)
- `?user=<id>` on any tab; opened from All Tasks, Reports, Team performance, My team.
- Header: avatar, name, "Their tasks and how they are doing". "Period": This Month (default), This Week, Today, This Year, All Time.
- Stats: "Total", "Completed", "Pending", "Overdue", "In time", "Delayed", "Time earned", "Score" ("Only tasks assigned by someone
  else are scored"). Self-assigned note. 💡 review hint.
- "Tasks": Status (Open/Done/All), "Overdue only", "Recurring only", "N shown"; rows open the task detail. No row actions.
- Empty "No tasks match this filter."

### 3.18 Shared pieces
- **Date range picker**: Today, Yesterday, This Week, Last Week, This Month, Last Month, This Year, All Time, "Custom range…"
  (From / To); shows the counted range; a custom range runs only with both dates.
- **People multi-select**: "Search name or department…", checkbox per person "(department)", "No one matches "q"", "N selected"
  + "Clear".
- **File picker**: "Add photo or file" ("Uploading…"), max 5, duplicates removed, 10 MB each.
- **Links in text** become clickable (new tab). **Score ring**: 0–100 or "—" ("N% on time" / "Nothing scored yet").

---

## 4. Tasks: general screens and HR (attendance & leave)


Sources: `apps/web/src/features/tasks/general/*`, `apps/web/src/features/tasks/nav.ts`, `apps/web/src/features/hr/*`, `packages/core/src/tasks/extras-*.ts`, `packages/core/src/hr/*`. Server-side rules and error texts come from `services/tasks/backend/hr/{services,views,approvals,serializers}.py`. Visible labels are quoted exactly as they appear in the code. This spec does not describe the current visual design.

---

### 4.0 Global conventions (shared building blocks)

- **Capability gate ("RequireTasks")**: while access or `/me` is loading, a full-page loader shows. If the check fails, the page shows the screen **"You cannot open {what}"** with the text "Ask an admin if you need access."
- **Inline error note** (role=alert): shows the server's error message. **Inline success note** (role=status): a short confirmation.
- **Tile**: label, big value, optional sub-line, optional icon. It can be in an "alert" state (for example overdue > 0). It can also be a link: in-app links navigate in place, and `/classic/...` links do a full page load into the classic app.
- **Segmented control**: a row of toggle buttons where exactly one is on.
- **Delta**: "▲ n" (up), "▼ n" (down), "no change" (|n| < 0.05), or "—" (no earlier period). The tooltip reads "Up/Down n since the previous period".
- **Date formats** (en-IN): day "8 Oct", time "05:30 pm", date+time "8 Oct, 05:30 pm". An empty time shows "—".
- **Hours format**: "7h 30m", or "—" when 0 or missing.
- **Confirm dialog** (shared): title, optional description, optional note field (label, placeholder, required flag), confirm text, optional destructive style, and Cancel.
- **Toasts** are used only on Team Performance (email result).

---

### 4.1 Tasks workspace menu (sidebar)

The menu is the Tasks list (`TASKS_NAV`) followed by the HR list (`HR_NAV`). "Classic" items open the old app with a full page load.

| Label | URL | Group | Show rule | Classic |
|---|---|---|---|---|
| "Home" | `/tasks` (exact match) | — | always | no |
| "Tasks" | `/tasks/tasks` | — | always | no |
| "Team performance" | `/tasks/team` | — | capability `tasks.view_all` | no |
| "Groups" | `/tasks/groups` | — | always | no |
| "Notices" | `/tasks/notices` | — | always | no |
| "Notifications" | `/tasks/notifications` | — | always | no |
| "My team" | `/tasks/users` | — | always | no |
| "Leads" | `/classic/tasks/leads` | "More" | module `leads` AND any `leads.view*` capability | yes |
| "AI inbox" | `/classic/tasks/intake` | "More" | capability `intake.view` | yes |
| "Mistakes" | `/classic/tasks/mistakes` | "More" | module `mistakes` | yes |
| "Links" | `/classic/tasks/links` | "More" | module `links` | yes |
| "Task settings" | `/tasks/settings` | "Settings" | capability `settings.manage` | no |
| "Attendance & leave" | `/tasks/hr` | "People" | always (tabs inside are gated) | no |

Route guards:
- `/tasks/team` has a hard guard (`tasks.view_all`). Otherwise the user sees "You cannot open Team Performance".
- `/tasks/settings` has a hard guard (`settings.manage`). Otherwise the user sees "You cannot open Task settings".
- All other pages load for every signed-in Tasks user and adapt their content to the person's rights.

Every page is loaded on demand, so a loader shows on first open. The HR page also brings the camera and face code with it.

---

### 4.2 TASKS: GENERAL SCREENS

#### 4.2.1 Home (Tasks dashboard)

- **URL**: `/tasks`. There are no query params. Filters are held in page state and reset on reload.
- **Who**: every Tasks user. Sections vary:
  - "Admin" means role `admin` or `super_admin`.
  - The leads half appears only when all of these are true: module `leads` is on, the person has one of `leads.view_all`, `leads.view_department` or `leads.view_own`, and they have `dashboard.view`.
- **Purpose**: personal and team cockpit showing what's waiting, deadlines, score, team health and, optionally, the leads pipeline.

**Header**
- Greeting "Good morning / Good afternoon / Good evening, {first name or username}". The cut-offs are before 12:00, before 17:00, and otherwise.
- Today's long date, for example "Wednesday, 8 October 2026".
- Scope chip: "All departments" (admin) or "{Department} department".

**Filter bar** (applies to the score, mistakes and team panels; uses `/tasks/home/`)
- "Date range" select: "This week", "Last week", "This month" (default), "Last month", "Custom dates".
- Custom: two date inputs, "From" and "to"/"To". No data is requested until both dates are set.
- "Department" select ("All departments" plus each department). It appears only when the person's team spans more than one department.
- Text "Scores for {start} – {end}": the range the server actually used.
- Errors show as an inline error note.

**"Waiting on you" strip** (always shown)
- Items (each is a link with a count; "…" while loading):
  - "Work to accept" → `/tasks/tasks?tab=reviews` (completions waiting for my acceptance).
  - "Requests to decide" → `/tasks/tasks?tab=requests` (change requests).
  - "My open mistakes" → `/classic/tasks/mistakes`. Only shown when module `mistakes` is on.
- An item is highlighted when its count is > 0.
- When everything is loaded and the total is 0, it shows "Nothing — all clear ✓".

**Layout order**
- Without leads: header, then "My work" tiles, then my panels, then "Tasks I've delegated" (non-admins).
- With leads: header, then the "Tasks" tiles band, then my panels, then delegated, then the "Leads" band with leads panels.
- If the leads data fails, the page shows an error note and falls back to the no-leads layout. While leads data loads, a skeleton shows.

**"My work" band** (no-leads layout). Each tile links to a pre-filtered task list:
- "My open tasks" (pending + in progress) → `/tasks/tasks?tab=my&status=open`
- "Overdue" (alert if > 0) → `…&status=open&overdue=1`
- "In progress" → `…&status=in_progress`
- "Completed" → `…&status=done`
- "Finished on time" → `…&status=done&done=on_time`
- "Delayed" (alert if > 0) → `…&status=done&done=late`
- Values show "—" while loading.

**Notices card**
- Hidden when there are no live notices.
- Title "Notices" with a chip "{n} new" (unread). Action "All notices →" (`/tasks/notices`).
- Shows the first 3 notices. Each shows: unread dot, title, priority chip (when not Normal: "Urgent"/"Important"), content cut to 220 characters with links made clickable, and "{author or 'Admin'} · {date}".
- Urgent and important notices are emphasised. Clicking a notice opens `/tasks/notices`.

**"My deadlines" panel**
- Source: my open and in-progress tasks (up to 200).
- Action "All my tasks →" (`/tasks/tasks`).
- Segmented tabs, each with a count badge (the overdue badge is emphasised when > 0):
  - "Overdue": due before now.
  - "Today": due by 23:59 today.
  - "This week": due by the end of Sunday.
- The default tab is the first non-empty one, otherwise "Today". Lists are sorted by due date.
- Shows up to 8 rows. Each row: overdue dot, code, title, status, "· from {creator}", relative due text, and a priority chip when not normal. A row opens `/tasks/tasks/{id}`.
- When there are more than 8: "+{n} more in Tasks".
- Empty states: "Nothing overdue.", "Nothing due today.", "Nothing else due this week."

**"My score" panel**
- Score dial (0–100, or "—" when unscored), with three bands: ≥75 good, ≥45 medium, otherwise poor.
- "▲/▼/• {n} vs previous period" (when a delta exists).
- When unscored: "Nothing scored yet in this range — finish work others gave you to earn a score."
- Rows: "On time" (% or —), "Completed", "Finished late" (emphasised if > 0).
- Skeleton while loading.

**"My tasks given & received"** (non-admins only)
- See 2.2.

**"My open mistakes"**
- Shown only when module `mistakes` is on and the open count is > 0.
- Title chip shows the count. Action "Open register →" (classic mistakes).
- Each row: overdue/normal dot, code, category, description, status, "· reply {relative SLA}" (emphasised if overdue), and a severity chip ("high"/"critical" are danger). All rows link to the classic register.

**"Team" section**
- Shown only when the server returns team data, i.e. the person has a team.
- **"Overdue by person"**:
  - Chip "{n} overdue". Right side: "{pct}% of {open} open tasks".
  - Per person: avatar, name, bar, and "overdue/open". Shows 8 people, with the toggle "Show all {n} people" / "Show fewer".
  - Empty: "Nobody has overdue work."
- **"How late is overdue work?"**:
  - Vertical bars per ageing bucket (labels come from the server), with the count shown above each bar.
  - Note: "Days past the due date, for every open task that is overdue right now."
- **"Top performers"**:
  - Up to 3 people with medals 🥇🥈🥉. Each shows avatar, name, "{x}% on time · {n} done", score, and ▲/▼ delta.
  - Empty: "No scored work in this range yet."
- **"Needs attention"**:
  - Count chip. Action "Team Performance →" (`/tasks/team`; that link is guarded).
  - Up to 8 people, each with avatar, name, "· role", and reason chips. When there are more: "+{n} more on Team Performance".
  - Empty: "Everyone is active and on track."

**"Tasks given & received" (everyone)**
- Admins only. Receives the Home department filter. See 2.2.

**"Tasks I've delegated" (non-admins)**
- Title chip "{n} open". Action "All delegated →" (`/tasks/tasks?tab=delegated`).
- Shows the first 10 open or in-progress tasks I gave to others.
- **Desktop table** columns:
  - "Task": code and title link; description up to 140 characters; "Given {date} · {n}m effort · change requested".
  - "Assigned to": avatar and name.
  - "Status" chip.
  - "Priority" chip.
  - "Due": relative, emphasised if overdue; "—" if none.
  - "Progress": bar and %.
- **Phone**: one card per task with code, status, priority (if not normal), title, description up to 110 characters, assignee, due text ("No due date" if none), and progress.
- Empty: "You haven't handed out any open tasks."

**Leads layout: "Tasks" band**
- "Open tasks" (sub "assigned and not done").
- "Overdue tasks" (sub "{pct}% of open tasks"; alert if > 0).
- These two link to `/tasks/tasks?tab=all|my&status=open(&overdue=1)`. The tab is `all` when the person is admin or has `tasks.view_department`.
- "Pending follow-ups" and "Overdue follow-ups" (alert) link to classic Leads.

**Leads layout: "Leads" band**
- When there are leads, 7 tiles that each link to classic Leads: "Total leads", "New", "Active", "Won", "Lost", "Pipeline value" (₹, compact), "Conversion" (%).
- When there are none: "No leads yet. Pipeline, conversion and sources show up here once leads come in."
- Panels shown only when there are leads:
  - **"Leads created — last 14 days"**: bar chart by day.
  - **"Pipeline by stage"**: horizontal bars per status with counts.
  - **"Lead performance by employee"**: table with columns Employee (avatar, name, role), Leads, Open, Won, Lost, Overdue follow-ups (emphasised if > 0), Open tasks. Shown only when there are rows.
  - **"Lead sources"**: table with columns Source, Leads, Won, Conv.
- Panels always shown in the leads layout:
  - **"WhatsApp / Gmail activity"**: each entry shows channel icon, sender, "→ lead name or status", body and time. Empty: "No inbound messages yet."
  - **"Recent lead activity"**: each entry shows lead name, body, and "actor · time". Empty: "No lead activity yet."

**States**: page loader until `/me` is loaded. Each panel has its own skeleton or error.
**Mobile**: delegated tasks and delegation tables become cards. Everything else stacks.

---

#### 4.2.2 Tasks given & received (Home and Team Performance)

**A. "Tasks given & received" (everyone)**
- **Who**: rendered only when the server says `everyone = true` (admins). For anyone else it renders nothing.
- **Panel actions**:
  - "Day" date picker. Default today, max today. Clearing the field resets it to today.
  - Period segmented control: "Day", "Week", "Month" (default), "Overall".
- **Summary line**: "Showing **{span}** · {n} tasks given to others, {m} self-assigned". The span is the day, "start – end", "Month YYYY", or "all time".
- **"Sort by"** segmented control: "Tasks given" (default) / "Tasks received". Rows sort descending by the selected period, then by name.
- **Desktop table**:
  - "Person": avatar, name, role.
  - "Tasks given" group: Day, Week, Month, Overall.
  - "Tasks received" group: Day, Week, Month, Overall.
  - "Self" (for the selected period).
  - The selected period's column is emphasised and has a mini bar. Zeros are muted.
- **Phone**: one card per person with "Given", "Received" (selected period) and "Overall" (given / received).
- **"Who gives to whom most — this month"**: chips "{from} → {to} {count}". Shown only when pairs exist.
- **Help text**: "Click a person to see who they give tasks to and who gives tasks to them. Counted on the day a task was given. Self-assigned tasks are shown apart; automatic repeats of recurring tasks and form-created tasks are not counted."
- **Row click** opens the Person breakdown dialog.
- **States**: skeleton while loading. On error, the panel shows an error note.

**B. "My tasks given & received" (non-admins, Home)**
- **Actions**: "Who? →" (opens the breakdown for me; shown once data is loaded) and the "Day" date picker.
- **Two rows**:
  - "Given to others": Day (the day's date), Week, Month, Overall.
  - "Received from others": same four counts.

**C. Person breakdown dialog**
- **Title**: "{name}: tasks given & received".
- **Header**: role; period segmented control (starts at the period chosen in the card, or Month); span text.
- **Two lists**, "Gave tasks to" and "Received tasks from":
  - Each list has a total chip and a ranked list (rank, avatar, name, "(inactive)", bar, count).
  - Only people with count > 0 in the selected period are listed.
  - Empty: "Nobody in this period."
- **States**: skeleton while loading; error note on failure.

---

#### 4.2.3 Team Performance

- **URL**: `/tasks/team`. No query params (the range lives in page state).
- **Who**: `tasks.view_all`. Otherwise "You cannot open Team Performance".
- **Purpose**: rank every employee by score over a range, alongside attendance and leave.

**Header actions**
- **"Email weekly update"**
  - Tooltip: "Also goes out automatically every Monday at 10 AM".
  - Confirm: "Email the weekly update now?" / "Everyone gets their overdue tasks (or "pipeline is clear") and their performance now." Button: "Send emails".
  - While sending, the label is "Sending…".
  - Success toast: "Weekly email sent to {n} person(s)." Failure: error toast.
- **"Export CSV"**
  - Shown only when there are rows. Downloads `team-performance-{range}.csv`.
  - Columns: Rank, Name, Role, Department, Score, Change, On-time %, Attendance %, Leave days, Total, Completed, On time, Delayed, Pending, In progress, Overdue, Time assigned, Time earned, Time spent, Sent back, Extensions asked, Mistakes, Open now, Overdue now.
  - Rank is blank for unscored people.

**Range picker**
- "Date range" select: "Today", "Yesterday", "This Week", "Last Week", "This Month" (default), "Last Month", "This Year", "All Time", "Custom range…".
- Custom: "From date" "to" "To date". No data is requested until both are set.
- Applied text: "{01 – 30 Sep 2026} · counted by due date".

**Team tiles**
- "Team score": value or —, with a Delta sub-line. Good when ≥75; alert when <45.
- "On time": %, sub "{in_time} of {completed} completed".
- "Completed": sub "{total} tasks in range".
- "Overdue": alert if > 0, sub "{n} late right now".
- "Time earned": sub "{spent} spent".
- "Need a look": at-risk count, alert if > 0, sub "{scored} of {people} scored".

**"Score by person" chart**
- Shown only when more than one person is scored.
- Bar per person, 0–100, banded (≥75 / ≥45 / below).
- Tooltip: "{done} done · {overdue} overdue · {x}% on time".

**"Every employee" table**
- Header note: "{n} people · open a row for the full breakdown".
- Columns:
  - "#": rank, or — when unscored.
  - "Employee": expand chevron, name; role · department; flag chip with count (tooltip lists the flags).
  - "Score": ring.
  - "vs prev": Delta.
  - "On time", "Attendance", "Leave days".
  - "Done".
  - "Pending": pending + in progress.
  - "Overdue": emphasised if > 0.
  - "Time spent".
  - "Open now": "n (m late)".
- Clicking a row toggles an in-place detail with four blocks:
  - **Tasks**: "Total in range", "Completed", "— on time", "— delayed", "Pending", "In progress", "Overdue".
  - **Time**: "Assigned", "Earned (completed)", "Actually spent", "Effort ratio" (hint "Time earned ÷ time assigned").
  - **Quality**:
    - "On-time rate".
    - "Attendance". Hint: "Present, late or half day, of {n} working days", or "Pick a date range".
    - "Leave days".
    - "Sent back for redo" (hint "Completions an approver rejected").
    - "Rework rate", "Mistakes logged", "Repeat mistakes".
    - "Score penalty" ("−n" or "0").
  - **Pressure & load**: "Deadline extensions asked", "Cancellations asked", "Open right now", "— already overdue", "Pending effort", "Self-assigned (unscored)".
  - Below the blocks: the review line ("💡 …"), each flag on its own line, and the button "Open full profile →" (`/tasks/tasks?tab=employees&user={id}`).

**Footer**
- "Formula (open, not a black box): **{formula}**."
- Then either " Change is measured against {prev start} – {prev end}." or " No earlier period to compare against in this range."

**Bottom**: the "Tasks given & received" card (2.2-A; admins only).

**States**: skeleton while loading; error note on failure.

---

#### 4.2.4 Groups

- **URL**: `/tasks/groups`.
  - `?group={id}` opens one group.
  - `&tab=dashboard|tasks|links|members` picks the section (default dashboard).
  - "Back" removes both params.
  - An unknown or invisible group id shows the list.
- **Who**:
  - Everyone sees the groups they are allowed to see, including archived ones.
  - "New group" requires `tasks.assign`.
  - Edit, Archive and member management require the per-group flag `can_manage`.
- **Purpose**: team workspaces with shared tasks, members and a dashboard.

**List view**
- Header "Groups", description "Team workspaces: shared tasks, members and a dashboard.", action "New group" (when allowed).
- One card per group:
  - Name, "Archived" chip (inactive groups are dimmed), category chip, description.
  - "{n} member(s) · owner {name or —}".
  - Click opens the group.
- Empty: "No groups yet". Sub-text: "Create one to give a team its own workspace." (if the person can create) or "You will see groups here once you are added to one."
- States: full loader while loading; error state with Retry.

**Dialog: New group / "Edit {name}"**
- Description: "You are added automatically as the owner."
- Fields:
  - "Name *": text, required (the submit button is disabled when blank).
  - "Description": text.
  - "Category": text, placeholder "e.g. Sales, HR".
  - "Members": searchable multi-select of team people (name + department), placeholder "— search and pick people —".
- Buttons: "Cancel"; "Create group" / "Save".
- Error: server message.
- On success the dialog closes and the list refreshes.

**Group detail**
- Header: back arrow ("Back to groups"), group name, "Archived" chip, description.
- Actions (`can_manage` only):
  - "Edit": opens the same dialog.
  - "Archive" (active groups only). Confirm: "Archive {name}?" / "It leaves the group pickers; its tasks keep their history." Button "Archive". On success, returns to the list.
- Section switch: "Dashboard", "Tasks", "Links" (module `links` only), "Members".

**Dashboard tab**
- Tiles: "Total tasks", "Pending", "In progress", "Completed", "Overdue" (alert), "Members".
- "Recent activity": task title, text, and "actor · time". Empty: "No task activity in this group yet."

**Tasks tab**
- Help: "Create group tasks from the Tasks page — pick "{group}" in the Group field." ("Tasks page" is a link to `/tasks/tasks`.)
- List of the group's tasks (up to 200):
  - Checkbox "Done: {title}": ticking sets status done, unticking sets it open.
  - Title link to the task (struck through when done).
  - "assignee · due {date}" (emphasised if overdue). Overdue rows are emphasised.
- Empty: "No tasks in this group yet."
- Status-change errors show inline.

**Links tab**
- Info card: "Links scoped to "{group}" are on the Links page (opens the classic screen)."
- Button "Open Links" (classic).

**Members tab**
- Add (`can_manage`): multi-select "People to add" (whole team minus current members), placeholder "— search and pick people to add —". Button "Add {n}" (disabled with 0 selected; "Adding…" while busy).
- Table: "Member" (name plus "owner" chip), "Role" (role label).
- "Remove" per row (`can_manage`; not for the owner). There is no confirmation.

---

#### 4.2.5 Notices

- **URL**: `/tasks/notices`. The Board/Manage mode is page state, not in the URL.
- **Who**:
  - Everyone sees the "Board" (notices targeted at them).
  - `settings.manage` also gets a segmented switch "Board" / "Manage".
- **Purpose**: company notice board and its management, including WhatsApp broadcast.

**Board**
- Filters:
  - Segmented "Show": "All", "Unread", "Read".
  - Search box "Search notices…" (server-side).
- Each notice card (collapsed):
  - Priority icon (urgent / important / normal pin), title, category chip, unread dot.
  - "{author or —} · {publish time or created time}".
  - Unread, urgent and important notices are emphasised.
- Clicking expands it to show the full content (multi-line, links clickable) and an "Attachment" link (new tab) when present.
- Opening an unread notice marks it read.
- Empty: "No notices here". Skeleton while loading; error state with Retry.

**Manage** (`settings.manage`)
- Button "New notice". Errors and success messages show inline.
- Table columns:
  - "Title" (with category).
  - "Audience" (server text).
  - "Status" chip: Draft / Published / Archived, plus " (expired)" when published and expired.
  - "Publish", "Expires".
  - Actions.
- Row actions:
  - "Edit": opens the form.
  - "Publish": when not published. No confirmation.
  - "WhatsApp": when published and not expired. Tooltip "Send this notice to everyone it is for on WhatsApp". Flow:
    1. The app previews the reach.
    2. Confirm "Send "{title}" on WhatsApp?" with the body "It goes to {with_whatsapp} of {audience} people." and, if anyone lacks a number, "No WhatsApp number on file (they will only see it in the app): {names}". Button "Send on WhatsApp".
    3. Result: "Sending "{title}" to {n} people on WhatsApp."
  - "Archive": when published. No confirmation.
  - "Delete" (destructive). Confirm: "Delete the notice "{title}" for good?" / "Everyone stops seeing it. This cannot be undone." Button "Delete".
- Empty: "No notices created yet".

**Dialog: "New notice" / "Edit notice"**
- Fields:
  - "Title *": required, autofocus.
  - "Content": multi-line text, 5 rows.
  - "Category": text, placeholder "e.g. HR, Policy".
  - "Priority": "Normal" (default), "Important", "Urgent".
  - "Audience": "Everyone" (default), "Specific role", "Specific department", "Specific group", "Specific users". Changing it clears the audience value.
  - Conditional audience field:
    - "Role": select of roles, first option "Pick…".
    - "Department": select, "Pick…".
    - "Group": select of groups, "Pick…".
    - "Users": searchable multi-select of team members.
  - "Publish at (blank = on publish)": date-time.
  - "Expires (optional)": date-time.
- Submit: "Save draft" (new; creates a draft) or "Save changes" (edit). Disabled when the title is blank.
- Cancel closes the dialog. Server errors show inline.

---

#### 4.2.6 Notifications

- **URL**: `/notifications` (also `/tasks/notifications`), `?tab=attendance|tasks|assets|approvals|company`.
- **Who**: everyone. Shows their own last 100 notifications per app of the tab (Tasks and Assets), grouped by area like the bell
  (PLAN.md §19.37).
- **Purpose**: inbox of task assignments, reminders, approvals, leave decisions, asset requests and notices.

**Header actions**
- "Download" (Tasks notifications).
- "Mark all read": marks the open tab; shown when it has unread ones.
- On the All tab only: "Clear read": shown when any Tasks notification is read. Confirm: "Delete {n} Tasks notification(s) you have already read?" / "This cannot be undone." Button "Delete".
- On the All tab only: "Clear all" (destructive; label "Clearing…" while busy). Confirm: "Delete all {n} Tasks notification(s)?" with "{u} of them is/are still unread." (when there are unread items) and "This cannot be undone."
- All are disabled while a clear or mark-all action is running.

**Tabs**: All · Attendance · Tasks · Assets · Approvals · Company with unread counts (as in the bell).

**Each notification**
- Bell icon (differs read/unread), title (bold when unread, with a bar in the theme colour on the left), body (multi-line).
- "Area · created time".
- Tasks: channel chips (email "gmail" or WhatsApp) with delivery status: sent / delivered / failed / skipped / queued. The tooltip shows the detail.
- "Mark read" (unread only).
- Tasks: delete (×) with tooltip "Delete this notification". No confirmation.
- Clicking the title/body:
  - Marks it read and opens the item (see the bell).
  - Follows its link if it has one. Tasks links are rewritten (`/tasks/42` becomes `/tasks/tasks/42`); full URLs and classic links do a full page load.
  - Without a link, it only marks it read.

**States**
- Empty: "Nothing yet" / "Task assignments, reminders, approvals and status changes show up here."
- Skeleton while loading; error state with Retry; action errors inline.

---

#### 4.2.7 My team (users)

- **URL**: `/tasks/users`.
- **Who**:
  - People with `users.manage` get the **Manage view**.
  - Everyone else gets the read-only **Directory**.
  - A name links to the person's task profile (`/tasks/tasks?tab=employees&user={id}`) only if they are in my viewable task-people list; otherwise it is plain text.
- **Purpose**: see teammates and their workload. Managers can edit Tasks-side details and activate, deactivate or delete people.

**Directory (read-only)**
- Header "My Team". Description "{Reporting to you | Your department} · {n} member(s)". "Reporting to you" applies when role = `sales_manager`.
- A manager with nobody reporting sees: "No one reports to you yet — ask Admin/HR to set "Reports to" on your team members in People & access."
- Filters:
  - Search "Search team member…": name, username, email, mobile.
  - "Role" select: "All roles" plus each role.
- Table columns:
  - "User": name, email or @username.
  - "Mobile" (—).
  - "Reports to" ("NA").
  - "Department".
  - "Role" chip.
  - Row button "Workload" / "Hide" (tooltip "Open tasks & pending effort").
- **Workload line** (expands under the row):
  - "{name}'s pipeline:" followed by either "no open tasks — free right now 🎉" or "{n} open ({x urgent, y high}) · {n} overdue · {effort} of effort pending (+{n} task(s) with no effort value)".
  - When overloaded: "⚠ Heavy pipeline — you can still assign; this warning never blocks."

**Manage view** (`users.manage`)
- Header "My Team", description "New people, departments and "reports to" are managed in People & access.", action "Add person in People & access" (goes to `/people`).
- Filters:
  - Search (name, username, email, WhatsApp).
  - "Role" select.
  - "Reporting manager…" select: active people with manager roles, shown as "{name} — {role}".
  - Counter "{shown}/{total} members".
- Table columns:
  - "User".
  - "Mobile" (WhatsApp number).
  - "Department".
  - "Reports to" ("NA").
  - "Role" chip.
  - "Status": "Active" or "Deactivated" (deactivated rows are dimmed).
  - Actions.
- Row actions:
  - "Workload" (active people only).
  - "Edit".
  - "Deactivate" / "Activate": not on yourself. No confirmation.
  - "Delete" (destructive): only for deactivated people, not yourself. Opens the purge dialog.
- Empty: "No team members yet". Action errors show inline.

**Dialog: "Edit {username}"**
- Description: "Task and approval mails go to the email below; WhatsApp alerts to the number."
- Fields:
  - "Username": disabled.
  - "Email": email input. Help: "Leave blank if their mailbox does not exist yet — otherwise every mail bounces back."
  - "First name", "Last name".
  - "Role *": select.
  - "WhatsApp / Mobile": placeholder "9876543210". Help: "No number means no WhatsApp alerts."
- Read-only box:
  - "Department" and "Reports to".
  - Note: "Department and "reports to" come from the company's People directory. "Reports to" decides who approves this person's change requests."
  - Button "Edit in People & access" (goes to `/people`).
- "New Tasks password (blank = keep)": password field. Help: "Only for signing in to a standalone Tasks install; Kaampilot sign-in passwords are reset in People & access."
- Buttons: "Cancel", "Save changes". Server errors show inline.

**Dialog: "Delete {name} permanently?"**
- Description: "This removes the person and cannot be undone."
- Impact list (loaded from the server):
  - "{n} tasks assigned to them ({open} open, {overdue} overdue, {done} done) — deleted with their files and comments".
  - "{n} mistake records — deleted" (if any).
  - "Their notifications, requests and history — deleted".
  - Kept: "{n} tasks they gave to others — kept, just without "given by"" (if any).
  - "{n} people report to them — they'll show no reporting manager" (if any).
- Confirmation field: "Type `{username}` to confirm" (case-insensitive match).
- Buttons: "Cancel"; "Delete permanently" (destructive; disabled until the username matches).

---

#### 4.2.8 Task settings

- **URL**: `/tasks/settings`.
- **Who**: `settings.manage`. Otherwise "You cannot open Task settings".
- **Header**: "Task settings", "How tasks are completed, categorised and announced."
- One shared error note at the top collects errors from all sections.

**"Task completion evidence"**
- Description: "Force proof-of-work when someone completes a task — stops the "just keeps ticking it daily" problem."
- Fixed text: "✓ Completion description: always required (company rule, not a switch)".
- Switch "File / photo proof required". Saves immediately and is disabled while saving.

**"Departments"** (read-only)
- Description: "Every department dropdown reads this list. It comes from the company's People directory, so departments are added, renamed and removed in Settings."
- Action "Manage departments in Settings" (goes to `/settings`).
- Chips per department (inactive ones are flagged; tooltip "Code: {code}").

**"Task categories"**
- Description: "The dropdown employees pick from (managers can also add one while creating a task). Deleting hides a category from the dropdown — existing tasks keep their history; adding the name again brings it back."
- **"Requests waiting for you ({n})"**: shown when there are pending requests.
  - Columns: Category, Asked by, Department ("General" if none).
  - "Approve": no confirmation.
  - "Reject": confirm "Why not add "{name}"?" with the optional note "Reason (optional — the requester sees this)". Button "Reject" (destructive).
- **Add form**:
  - "New category name": required.
  - "Department": "General (all departments)" or a department.
  - Button "Add".
- **List**: Category, Department ("General"), Tasks (count), "Delete" (no confirmation).

**"Notifications" (rules matrix)**
- Description: "Everyone always sees notifications in the app. Choose which ones are also sent by email or WhatsApp."
- Table: "When" (event label from the server), "Email" checkbox, "WhatsApp" checkbox.
- Each checkbox saves immediately and is disabled while its own save is running.

**"Lead assignment rules"** (module `leads` only)
- Intro: "When a new lead arrives without an assignee (manual entry, or WhatsApp/Gmail/AI intake), the rule for its department picks the owner."
- One card per department:
  - "{Dept} rule active" switch with the label "Active" / "Off". Shown only once a rule exists.
  - Strategy select: "Round robin" / "Fixed (first member)".
  - Ordered member chips (number, name). Each has "Move {name} up", "Move {name} down" and "Remove {name}".
  - "+ Add member…" select (team members not already in the rule).
  - Empty: "No members — leads stay unassigned."
  - Round robin with members shows "Next in rotation: {name}".
- Any change saves immediately. The first change creates the rule (round robin, active).

---

### 4.3 HR: ATTENDANCE & LEAVE

#### 4.3.1 HR page shell ("Leave & Attendance")

- **URL**: `/tasks/hr?tab=`, with values `today` (default), `history`, `leave`, `holidays`, `team`, `approvals`, `settings`.
  - An unknown, unauthorised or link-only tab value falls back to Today.
  - Switching tabs replaces the URL (no new history entry).
- **Title**: "Leave & Attendance". The tab bar scrolls horizontally on phones.
- **Tabs and visibility**:
  - "Today": everyone.
  - "My Attendance" (`history`): everyone.
  - "My Leave" (`leave`): everyone.
  - "My Salary": module `payroll` on. It is a link with an external-link icon to `/classic/tasks/hr?tab=salary` (full page load).
  - "Holidays": everyone (management needs `settings.manage`).
  - "Team": `hr.approve`.
  - "Approvals": `hr.approve` OR the server's `can_approve` flag. The flag is true under the "manager first" rule when the person has active direct reports.
  - "Payroll": `hr.manage` AND module `payroll`. Link to `/classic/tasks/hr?tab=payroll` (classic).
  - "HR Settings" (`settings`): `hr.manage`.
- **Loading**: page loader until `/me` is loaded.

#### 4.3.2 Today (check in / check out)

- **Who**: every employee. This screen is used mainly on phones.
- **Tiles**:
  - "Check in": time or —.
  - "Check out": time or —.
  - "Worked": "h m" or —.
  - "Status": chip (Present / Late / Half Day / Absent / Leave / Holiday / Week Off / Not checked in) or —. The tile is in alert state when late.
- **Messages**: error note (server or device message); success note "Checked in ✅" / "Checked out ✅".
- **Panel "Mark attendance"**, information lines:
  - "Office hours {work_start}–{work_end}."
  - Location: "Location check is ON — allow GPS access." or "Location check is off."
  - Face (when face is on), one of:
    - Enrolled: "Face verification is ON."
    - Not enrolled, self-enrol on: "Face verification is ON — first time? Your face will be saved on your first check-in, just like setting up a phone face lock."
    - Not enrolled, self-enrol off: "Face verification is ON but you are not enrolled — ask an admin."
  - Photo required: "A photo is taken at every check-in and check-out."
- **Buttons** (large, two side by side): "Check in" and "Check out".
  - The icon is a camera when the camera step applies, otherwise log-in / log-out.
  - "Check in" is disabled unless `can_check_in` (no check-in yet today).
  - "Check out" is disabled unless `can_check_out` (checked in, not out).
  - Both are disabled while locating or sending. "Check in" shows a spinner during a non-camera send.
- **States**: skeleton while loading; error state with Retry when the data fails.
- The full flow is in section 4.

#### 4.3.3 Camera dialog (FaceCapture): check-in/out and admin enrolment

- **Title**:
  - Face on: "Check in with your face" / "Check out with your face".
  - Photo only: "Check in" / "Check out".
  - Admin enrolment: "Enrol employee face".
- **Hint** (dialog description):
  - Self-enrol first time: "First time: this capture becomes your face profile. Look straight at the camera in good light, without a mask."
  - Not enrolled and no self-enrol: "Your face is not enrolled yet — ask an admin to enrol you first."
  - Enrolment: "Ask the employee to look straight at the camera in good light."
- **Live preview**: front camera, mirrored, with an oval face guide. The frame is portrait on phones and landscape on larger screens.
- **Status line** (live): "Starting camera…", then "Loading face engine…" and "Loading face models…" (face on only), then "Look straight at the camera". During capture: "Reading your face…" or "Taking the photo…". After a failure: "Try again".
- **Privacy note**:
  - Photo mode on: "A photo is saved with your attendance. Only you and the people who manage attendance can see it."
  - Otherwise: "Only a numeric face signature is sent — your photo never leaves this device."
- **Buttons**:
  - "Cancel": stops the camera and closes.
  - Primary action: "Check in" / "Check out" / "Save face". It is disabled until the camera (and the face models, if face is on) are ready. While working it shows "Checking…".
- **Errors** (replace the status line):
  - "This device or browser has no camera access. Use a phone or a laptop with a webcam, over HTTPS."
  - "Camera permission was denied. Allow camera access in your browser settings and try again."
  - "No camera found on this device."
  - "Could not start the camera." (or the device's own message)
  - "Face models could not be loaded. Check your connection and try again."
  - "No face detected. Look straight at the camera in good light." (the user can retry in place)
- Closing the dialog in any way stops the camera.

#### 4.3.4 My Attendance (`?tab=history`), also used for a team member's history

- **Controls**:
  - "Previous month" / "Next month" arrows.
  - "Month" select (Jan–Dec).
  - "Year" select (last, current and next year).
  - "· {name}" when viewing a team member.
  - "Total {h} h" for the month.
  - Changing the month clears the selected day.
- **Tiles**: "Present", "Late", "Half Day", "Leave", "Absent" (alert if > 0), "Week Off".
- **Calendar** (Monday first, headings Mon–Sun):
  - Each day shows its number and a tag: ✓ present, L late, ½ half day, ✗ absent, Lv leave, H holiday, "off" week off.
  - Today is emphasised. A marker shows when the day was late or has no checkout.
  - Future days, or days with no status, are not clickable. Clicking a day toggles its detail.
  - Legend: Present, Late, Half Day, Absent, Leave, "Off/Holiday".
- **Day detail panel**:
  - Title: long date (for example "Wednesday, 8 October") plus the status chip (": {holiday name}" for holidays).
  - "Check in" time, with a photo thumbnail when a photo exists.
  - "Check out" time, with a photo thumbnail.
  - "Worked".
  - "Flags": "late", "early out", "no checkout".
  - Thumbnails open a large view titled "[{name} ]Check-in photo" / "Check-out photo". Photos load with the sign-in token, never a public URL. If a photo cannot load, the thumbnail is not shown.
  - Button **"Request a correction for this day"**: own records only, and only for days that are present, late, half day or absent.
- **Dialog "Correction request — {day}"**:
  - "Correct check-in" (time).
  - "Correct check-out" (time).
  - "Reason *": placeholder "e.g. Forgot to check out".
  - Rule: a reason is required, plus at least one time. "Send request" stays disabled otherwise.
  - Buttons: "Cancel", "Send request".
  - Success: the dialog closes and the page shows "Correction for {day} sent for approval."
  - Approvers are notified (see section 5). The server rejects a request with no time: "Provide a corrected check-in or check-out time."
- **States**: skeleton for the calendar; error state with Retry.

#### 4.3.5 My Leave (`?tab=leave`)

- Button **"Apply for leave"**: disabled until leave types are loaded.
- When no leave types exist: "No leave types configured yet — an admin can add them in HR Settings."
- **Balance tiles**, one per active leave type:
  - Label "{name}" plus " (unpaid)" for unpaid types.
  - Value "{balance} / {quota}" for the current year.
  - Sub-line "{n} pending" when there are pending days.
- **Requests table** (my last 100):
  - "Type": name and reason.
  - "Dates": "{from} – {to}".
  - "Days": working days only.
  - "Status" chip: Pending / Approved / Rejected / Cancelled.
  - "Remarks": remarks or —, plus "by {reviewer}".
  - Action "Cancel": for pending or approved requests. No confirmation.
- Server rules on cancel:
  - "Approved leave that has already started cannot be cancelled."
  - "This request cannot be cancelled."
  - Cancelling approved leave removes the leave days from attendance.
- Empty: "No leave requests yet". Cancel errors show inline. Skeleton and error state as usual.
- **Dialog "Apply for leave"**:
  - "Leave type *": select, options "{name} ({quota}/yr)". Defaults to the first type.
  - "From *": date.
  - "To *": date. Its minimum is the From date.
  - "Reason *": text.
  - "Supporting document * ({type})": file input. Shown only when the type requires a document; the request is sent as a multipart upload.
  - Submit "Submit request": disabled until type, both dates and reason are filled. Cancel closes.
  - Server validation messages:
    - "End date cannot be before the start date."
    - "Leave range cannot exceed 90 days."
    - "{type} requires a supporting document."
    - "That range has no working days (holidays/week-offs only)."
    - "You already have a leave request covering these dates."
  - Days are counted excluding week-offs and holidays. On success, approvers are notified.

#### 4.3.6 Holidays (`?tab=holidays`)

- Everyone sees the table: "Holiday" and "Date" (for example "Wed, 8 October 2026").
- `settings.manage` (note: this is not an hr.* capability) also gets:
  - An add form: "Holiday name" and "Date" (both required), button "Add holiday". The form clears on success.
  - A "Delete" button per row. No confirmation.
- Empty: "No holidays configured". Skeleton, error state and error note as usual.

#### 4.3.7 Team (`?tab=team`)

- **Who**: `hr.approve`.
  - `hr.manage` sees all active employees.
  - Others with `hr.approve` see their own department.
- **Tiles**: "Present", "Late" (alert if > 0), "Half Day", "On Leave", "Not checked in" (alert if > 0).
- **Table**:
  - "Employee", "Department", "Status" chip.
  - "In": time plus check-in photo thumbnail.
  - "Out": time plus check-out photo thumbnail.
  - "Worked".
  - Actions.
- **Row actions**:
  - "History": opens that person's month view (3.4, read-only; no correction button) with "Back to team".
  - "Mark present": `hr.manage` only, and only when the status is not present or late.
    - Confirm title "Mark {name} present?".
    - Required note field "Reason", placeholder "e.g. face lock not working".
    - Button "Mark present".
    - Success: "{name} marked present ✅".
    - Server errors include "Cannot mark attendance for a future date." and "Unknown or inactive employee."
- **States**: skeleton, error state, inline error note.

#### 4.3.8 Approvals (`?tab=approvals`)

- **Who**: see section 5. The list shows only people the viewer may review.
- **Two sections**:
  - **"Leave requests ({n})"**: rows "{name} — {type} ({n} day/days)", the reason, and "{from} – {to}".
  - **"Attendance corrections ({n})"**: rows "{name} — {date}", the reason, and "in {time} · out {time}".
  - The count shows "…" while loading.
- **Per row**:
  - "Remarks…" text field (optional; the server stores up to 300 characters).
  - "Approve" and "Reject" buttons. There is no confirmation. All buttons are disabled while any decision is being sent.
  - Each section's empty state: "Nothing pending".
- **Effects**:
  - Approved leave writes Leave into attendance for the working days.
  - The requester gets a "Leave approved/rejected: {type}" notification.
  - An approved correction rewrites the punches, recalculates hours and status, and notes "Corrected by {user}".
- **Server errors shown**:
  - "You cannot review this request."
  - Self-review: "You cannot approve your own request — it must be reviewed by someone else." This is followed by either " Ask one of: {names}." or " No other approver exists yet: add an HR Manager (or another admin) in My Team, and ask them to review it."
  - "This request has already been reviewed."

#### 4.3.9 HR Settings (`?tab=settings`)

- **Who**: `hr.manage` (the server also enforces it: "Only an HR administrator can change HR settings.").
- The tab has four panels.

**A. "Attendance rules"**
- This is one form saved by **"Save rules"** ("Saving…" while busy; "Saved" on success).
- Errors appear under each field; any other error appears as a general note.

| Label | Type | Rules / range | Server default |
|---|---|---|---|
| "Work starts" | time | HH:MM ("Use a time like 09:30") | 09:30 |
| "Work ends" | time | HH:MM | 18:30 |
| "Late after (minutes of grace)" | number | 0–240 | 15 |
| "Half day below (hours)" | number, step 0.5 | 0.5–24 | 4 |
| "Full day (hours)" | number, step 0.5 | 1–24 | 8 |
| "Photo at check-in / check-out" | select: "Off" / "Optional" / "Required at every punch" | — | off (Kaampilot companies are set up with "required") |
| "Leave and corrections are approved by" | select: "Approvers in the person's department" / "The person's manager (reports to) first" | — | department |
| "Remind approvers after (hours; 0 = never)" | number | 0–720 | 24 |
| "Keep photos for (days)" | number | 1–3650 | 90 |
| "Weekly off" | day toggles Mon–Sun (index 0 = Mon) | 0–6 | Sun |
| "Check location at check-in (needs an office below)" | checkbox | — | off |
| "Uniform at punch-in" (own card, "Save uniform check") | choice "Off" (No question) / "Reminder only" (OK, punch in) / "Must confirm" (Yes punches in, No blocks) + "Message" (≤ 200 chars, blank = default) | — | off; "Are you wearing the company shirt / jersey today?" |
| "Face check at check-in and check-out" | checkbox | — | off |
| "First face capture becomes the person's face profile" | checkbox; disabled unless face check is on | — | on |

- Range errors read "Between {lo} and {hi}".
- The server also has `face_threshold` (0.3–0.8, default 0.6), but it is **not editable in this UI**.

**B. "Office locations (geo-fence)"**
- When there are no offices: "No office added. Geo-fencing cannot be enforced until one exists."
- List: name, "{lat}, {lng} · {radius} m", and a remove (×) button "Remove office {name}". No confirmation.
- Add form:
  - "Name".
  - "Radius (m)": default 200.
  - "Latitude", "Longitude".
  - Button "Use my current location": fills latitude and longitude (6 decimals) from the device GPS.
  - Button "Add office": disabled until name and latitude are filled. The form clears on success.

**C. "Face attendance"**
- Status text:
  - On: "Face verification is ON — employees must pass a face check to mark attendance."
  - Off: "Face verification is currently OFF. Enrol faces here, then turn on "Face check at check-in and check-out" in the attendance rules above."
- Privacy text: "Only a numeric signature of the face is stored — never a photo. You can remove an employee's profile at any time."
- Controls:
  - Employee select "Choose an employee…".
  - "Enrol face": opens the camera dialog (3.3) with the action "Save face".
  - "Remove profile": no confirmation.
  - Both buttons are disabled until an employee is picked.
- Results:
  - "{name} enrolled ✅ — they can now mark attendance with their face."
  - "{name}'s face profile removed."
  - Errors show inline.
- Enrolling again replaces the existing profile.

**D. "Leave types"**
- List: name, "{quota}/yr · paid|unpaid · document required", and an "Inactive" chip when applicable.
- Add form:
  - "Name": placeholder "e.g. Casual"; required.
  - "Annual quota": number, default 12.
  - "Paid" checkbox: default on.
  - "Document required" checkbox: default off.
  - Button "Add leave type".
- There is no edit or delete for leave types in this UI.

---

### 4.4 Attendance check-in flow (detail)

1. **Starting state**: "Today" loads the company rules (geofence, face, self-enrol, enrolled, photo mode, work hours) and the `can_check_in` / `can_check_out` flags.
1a. **Uniform check** (check-in only; PLAN.md §19.27, §19.36): the tap first reads today's rules from the server (a rule switched on while the screen was open still applies). With "Reminder only" a dialog shows the company's message ("OK, punch in" / "Cancel"); with "Must confirm" it asks "Yes, I'm wearing it" / "No" / "Cancel". **Yes** continues the check-in (saved as `uniform_ok` = Yes, shown on Daily attendance, My attendance and the daily report). **No** blocks it: "Please wear the company shirt / jersey, then punch in." appears in the dialog with only "Yes, I'm wearing it" and "Close" left; the server refuses `uniform: false` with the same text too. Cancel stops it. The dialog closes before location and the camera (also the phone app's native camera) start. Check-out never asks.
2. **Is a camera step needed?** Yes when face check is ON, or when the photo mode is **optional or required**.
   - In **Optional** mode the camera opens and a photo is always taken; there is no "skip photo" option in this UI. The "A photo is taken…" info line shows only for Required.
   - With no camera step, tapping the button goes straight to step 4.
3. **Camera dialog** (3.3):
   - The front camera starts. The face engine and models (about 6.8 MB) load only when face check is on.
   - On capture:
     - If photo mode is not Off, a JPEG still is taken (at most 640 px wide, quality 0.7).
     - If face check is on, three samples about 150 ms apart are averaged into a 128-number signature, using the largest face in view. The face image itself is never sent.
   - On success the camera stops and the dialog closes.
4. **GPS**:
   - The app always asks the device for its position (high accuracy, 8-second timeout).
   - If location is denied or unavailable, the app sends no coordinates and lets the server decide. There is no separate client-side error.
   - The button is in a busy state while locating.
5. **Send**: check-in or check-out is sent with the latitude/longitude, the face signature and the photo, where present.
6. **Server checks**, in order. Each failure message is shown in the error note on Today:
   - Check-in: "You have already checked in today." / "You are on approved leave today."
   - Check-out: "You have not checked in today." / "You have already checked out today."
   - **Office geofence** (only when location check is ON):
     - "No office location is configured yet — ask an admin to add one."
     - "Location is required for attendance. Please enable GPS and try again."
     - Outside the nearest office radius (PLAN.md §19.36): "You are not at the office location. You are about {d} away from {office}; punch in when you reach the office." ({d} = "350 m" under 1 km, "1.2 km" above; check-out says "punch out"). Shown on Today and on the Home card.
     - Outside, but the phone's GPS accuracy circle reaches the office: "Your location isn't accurate enough yet (±{a}). Move outdoors or near a window and try again."
     - The nearest active office counts. With the check off, coordinates are stored but not enforced.
   - **Face** (only when face check is ON):
     - Not enrolled and self-enrol ON: this capture becomes the profile, the punch succeeds, and every HR manager gets the notification "Face self-enrolled: {name}" ("…reset it in HR Settings → Face attendance").
     - Not enrolled and self-enrol OFF: "Face attendance is on but your face is not enrolled yet. Ask an admin to enrol you."
     - No signature: "Face scan required. Allow camera access and try again."
     - Wrong length: "Face scan could not be read. Please try again."
     - Mismatch: "Face did not match your enrolled profile (score {x}, allowed up to {t}). Attendance not marked. Try better light, or ask HR to reset your face profile / mark you present."
   - **Photo**:
     - Required with none sent: "Take a photo to mark your attendance."
     - Bad data: "The photo could not be read. Please try again."
     - Over 400 KB: "The photo is too large. Please try again."
     - Wrong format: "The photo must be a JPEG, PNG or WebP image."
     - In Optional mode a photo is stored when one is sent.
7. **Status rules**:
   - Check-in after work start + grace makes the day **Late**, otherwise **Present**.
   - Check-out computes the worked minutes. Below the half-day hours the day becomes **Half Day**; otherwise it stays Late or Present.
   - A check-out before work end sets the "early out" flag.
   - A day with no check-out shows the "no checkout" flag.
8. **Success**: "Checked in ✅" / "Checked out ✅". Tiles and buttons refresh.
9. **Fallbacks for staff**:
   - Request a correction (3.4).
   - An HR manager can "Mark present" with a reason (3.7).
10. **Photo privacy and retention**:
    - Photos are visible only to the employee and the people who can see their attendance (`hr.manage`: everyone; `hr.approve`: their department).
    - Photos load with the sign-in token.
    - The scheduled worker deletes punch photos older than "Keep photos for (days)". This also runs on non-working days.

**Mobile notes**
- The camera needs HTTPS and permission, and uses the front camera. The preview is portrait on phones.
- The buttons are large and placed side by side.
- GPS permission is asked on every punch.
- On a slow connection the face model download is the main wait; the status text shows the progress.

---

### 4.5 Approvals rules

- **Setting**: "Leave and corrections are approved by" (HR Settings).
- **Department mode (default)**:
  - Approvers are anyone with `hr.approve` in the requester's department, plus anyone with `hr.manage` (all employees).
  - New-request notifications go to the department's `hr.approve` holders. If there are none, they go to the `hr.manage` holders.
- **"Manager first" mode**:
  - The requester's active reports-to manager can approve even without `hr.approve`. Such a manager sees the "Approvals" tab, but not the "Team" tab.
  - Notifications go to the manager only. Department approvers and HR can still decide (for example when the manager is away).
  - If the person has no manager, the department rule applies.
- **Always**:
  - Nobody can approve their own request, including admins.
  - Only pending requests can be decided.
  - Remarks are optional (up to 300 characters).
- **Notifications**:
  - On submit: "Leave request from {name}" / "Attendance correction from {name}", linking to HR with the label "Review it".
  - On a leave decision, the requester is told "Leave approved/rejected: {type}".
- **Reminders** ("Remind approvers after (hours; 0 = never)", default 24):
  - After N hours pending, the approvers get one reminder: "Waiting for you: {title}".
  - After 2×N hours, it escalates once to every `hr.manage` holder: "Not reviewed for {2N} hours: {title}".
  - Reminders run only on working days. Setting 0 turns them off.

---

## 5. Assets


> Source of truth: `apps/web/src/features/assets/**`, `packages/core/src/assets/*`, `services/assets/packages/shared/src/*` (`@eam/shared`). This spec lists functions, data, rules and states only. It says nothing about how screens should look. Quoted text is the exact label shown in the UI today.

---

### 5.0 Assets overview

#### 5.0.1 Access model (how every screen decides what to show)

Each signed-in person has one **role**. A role is a set of **permissions** (`@eam/shared/permissions.ts`). The UI combines them into three derived rules:

| Rule | Definition | Meaning |
|---|---|---|
| **IT** | has `asset:assign` | IT / asset managers who hand out assets |
| **Employee-only** | does NOT have `employee:view` | Plain employees. They only see their own items, under "My …" names |
| **Staff** | NOT employee-only | HR, managers, leadership, IT |

**Permissions** (label shown in the role editor → key):

- **Assets**
  - "View all assets" `asset:view`
  - "Add assets" `asset:create`
  - "Edit asset details" `asset:edit`
  - "Assign, transfer and return assets" `asset:assign`
  - "Receive, retire, dispose and mark assets lost/found" `asset:lifecycle`
  - "Manage categories, asset types and custom fields" `catalog:manage`
- **People & organisation**
  - "View employees" `employee:view`
  - "Add and edit employees" `employee:manage`
  - "Change employee status (notice period, leave, exit)" `employee:status`
  - "Plan onboarding for new joiners (HR)" `onboarding:manage`
  - "Manage companies, departments, locations and vendors" `org:manage`
- **Employee exit**
  - "View exit cases" `exit:view`
  - "Recover assets from exiting employees" `exit:manage`
  - "Complete an exit with uncleared assets (override)" `exit:override`
- **Service**
  - "Raise asset requests" `request:create`
  - "Approve or reject asset requests" `request:approve`
  - "Fulfil approved requests" `request:fulfil`
  - "Raise tickets" `ticket:create`
  - "Manage all tickets" `ticket:manage`
  - "Manage maintenance" `maintenance:manage`
- **Administration**
  - "View the organisation dashboard" `dashboard:view`
  - "View the leadership overview (CEO)" `insights:leadership`
  - "View the organisation-wide activity log" `history:view`
  - "Manage users and roles" `user:manage`

**Built-in roles:**

| Role | Description | Permissions |
|---|---|---|
| "Admin" | "Full access to everything except the CEO’s leadership page" | Everything except `insights:leadership`. Locked: the role can only be viewed |
| "IT / Asset Manager" | "Full access: assets, people, logins and settings" | Same as Admin |
| "HR" | "Manages employees, notice periods and exits" | `asset:view`, `employee:view`, `employee:manage`, `employee:status`, `onboarding:manage`, `exit:view`, `exit:override`, `request:create`, `ticket:create` |
| "Leadership" | "CEO / directors: leadership overview and a read-only view of everything" | `insights:leadership`, `dashboard:view`, `asset:view`, `employee:view`, `exit:view`, `history:view`, `request:create`, `ticket:create` |
| "Manager" | "Views assets and employees, approves requests" | `dashboard:view`, `asset:view`, `employee:view`, `exit:view`, `request:create`, `request:approve`, `ticket:create` |
| "Employee" | "View only: my assets and my QR, plus requests and tickets" | `request:create`, `ticket:create` |

**Pages are not route-guarded.**
- Any URL can be opened.
- The menu hides items the person can't use.
- If the server refuses data (403 / 404), the page shows its **error state**: "Couldn’t load this" + the server message + "Try again".
- Buttons and row actions are hidden when the permission is missing.

**Modules:** the company can switch modules off. Only `sims` is checked here, and it controls the SIM menu items.

#### 5.0.2 Menu (left nav for the Assets workspace)

Order as defined. "Classic" items do a full page load into the old app.

| # | Label | URL | Show rule | Group | Classic |
|---|---|---|---|---|---|
| 1 | "Dashboard" | `/assets` | Staff AND `dashboard:view` | — | no |
| 2 | "Home" | `/assets` | Employee-only | — | no |
| 3 | "Leadership" | `/assets/leadership` | `insights:leadership` | — | no |
| 4 | "Priority queue" | `/assets/queue` | IT | — | no |
| 5 | "Assets" | `/assets/assets` | Staff AND IT | — | no |
| 6 | "My assets" | `/assets/assets` | Employee-only | — | no |
| 7 | "Employees" | `/assets/employees` | `employee:view` | — | no |
| 8 | "New joiners" | `/assets/onboarding` | `onboarding:manage` AND NOT IT (IT uses Requests → "New joiners") | — | no |
| 9 | "Exits" | `/assets/exits` | `exit:manage` OR `employee:status` | — | no |
| 10 | "Requests" | `/assets/requests` | Staff AND (`request:approve` OR `request:fulfil`) | — | no |
| 11 | "My requests" | `/assets/requests` | Employee-only | — | no |
| 12 | "Tickets" | `/assets/tickets` | Staff AND `ticket:manage` | — | no |
| 13 | "My tickets" | `/assets/tickets` | Employee-only | — | no |
| 14 | "Maintenance" | `/assets/maintenance` | `maintenance:manage` | — | no |
| 15 | "Activity log" | `/assets/activity` | `history:view` | — | no |
| 16 | "Scan" | `/assets/scan` | IT | — | no |
| 17 | "My QR & profile" | `/assets/me` | Employee-only AND linked to an employee record | — | no |
| 18 | "SIM cards" | `/classic/assets/sims` | IT AND module `sims` on | "More" | **yes** |
| 19 | "Reconciliation" | `/classic/assets/reconciliation` | IT AND module `sims` on | "More" | **yes** |
| 20 | "Asset catalogue" | `/assets/settings/catalog` | `catalog:manage` | "Settings" | no |
| 21 | "Departments" | `/assets/settings/departments` | `org:manage` | "Settings" | no |
| 22 | "Vendors" | `/assets/settings/vendors` | `org:manage` | "Settings" | no |
| 23 | "Users" | `/assets/settings/users` | `user:manage` | "Settings" | no |
| 24 | "Roles & permissions" | `/assets/settings/roles` | `user:manage` | "Settings" | no |

Notes:
- HR has `asset:view` but is not IT, so HR does not see the "Assets" menu item. HR can still open `/assets/assets` from links.
- **Home route `/assets`:** shows the Dashboard if the first visible non-classic item is Dashboard or Home. Otherwise it redirects to the first visible item, or to `/assets/employees` if none.
- **`/assets/me`:** redirects to `/assets/employees/<my employee id>`, or to `/assets` if there is no linked employee. Shows a loader while access loads.
- **Other routes (no menu item):** `/assets/assets/:id`, `/assets/labels?ids=`, `/assets/scan/:code`, `/assets/id/:code`, `/assets/id-cards?ids=`, `/assets/employees/:id`, `/assets/exits/:id`, `/assets/onboarding/:id`.
- **Classic fallback:** any other unknown `/assets/...` path opens the classic app. Old links therefore never dead-end.
- **Old links still work:** QR codes, ID cards and notification links keep the old app's paths.

#### 5.0.3 Toolbar (top of every Assets screen; hidden when printing)

1. **Search box** (a button that opens the Search palette).
   - Text: "Search assets, people, tags…" with a "Ctrl K" hint (hint hidden on small screens).
   - Accessible name: "Search assets, people, tags".
2. **Scan** (icon button: "Scan QR or barcode" / title "Scan").
   - Opens `/assets/scan`.
   - Shown if `asset:view` OR `employee:view`.
3. **"+ Add" menu** (button "Add"; the text is hidden on mobile).
   - Shown only if the person may use at least one item.
   - Heading: "Quick add".
   - Items are numbered 1–9. Pressing the number while the menu is open opens that form.
   - Items in order, with their rule:

| Item | Opens | Rule |
|---|---|---|
| "Employee" | Employee form | `employee:manage` |
| "New joiner" | Onboarding form | `onboarding:manage` |
| "Asset" | Asset form | `asset:create` |
| "Asset type" | Asset type form | `catalog:manage` |
| "Category" | Category form | `catalog:manage` |
| "Department" | Org form (department) | `org:manage` |
| "Vendor" | Org form (vendor) | `org:manage` |
| "Request" | Request form | IT OR Employee-only OR `request:approve` |
| "Ticket" | Ticket form | IT OR Employee-only |
| "Maintenance" | Maintenance form | `maintenance:manage` |

4. **USB barcode/QR scanner input.** Works anywhere in Assets.
   - Detection: at least 5 characters typed with under 60 ms between keys, then Enter.
   - Effect: resolves the code and navigates to the asset or person, with toast "Scanned <label>". Error → toast with the message.
   - Ignored when the person has neither `asset:view` nor `employee:view`.
   - Ignored on `/assets/exits/:id`, where scans mark items returned instead.

**Keyboard shortcuts** (dialog "Keyboard shortcuts", opened with `?`):

| Keys | Action |
|---|---|
| "Ctrl / ⌘ + K" | "Search & command palette" (toggle) |
| "/" | "Search" |
| "N" | "Quick add menu" (only if at least one item) |
| "G then D / A / E / X" | "Dashboard / Assets / Employees / Exits" |
| "G then Q / R / T / M / S" | "Priority queue / Requests / Tickets / Maintenance / Scan" |
| "J / K" | "Move down / up in a table" |
| "Enter" | "Open the highlighted row" |
| "X" | "Select the highlighted row" (selectable tables only) |
| "[ / ]" | "Previous / next page" |
| "Ctrl / ⌘ + Enter" | "Save the open form" |
| "Esc" | "Close dialogs and panels" |

#### 5.0.4 Search palette (dialog)

- **Input placeholder:** "Search assets, people, tags, serials… or type a command".
- **Search behaviour:**
  - Searches the server once at least 2 characters are typed (150 ms debounce).
  - While waiting: "Searching…".
  - No results: "No results for “<text>”".
- **Result groups:**
  - **"Exact match"** (asset tag / serial). Shows tag, name and status badge. Pressing Enter while there is an exact match opens that asset directly.
  - **"Assets"** (each opens `/assets/assets/:id`). Shows icon, name, "tag · type · holder" and status badge.
  - **"Employees"** (each opens `/assets/employees/:id`). Shows avatar, name, "code · designation · N assets" and employee status badge.
  - **"Asset types"** (each opens `/assets/assets?assetTypeId=`). Shows name and category.
  - **"Organisation"**:
    - Department → `/assets/assets?holderType=DEPARTMENT&holderId=`
    - Vendor → `/assets/assets?vendorId=`
- **With no query typed:**
  - **"Quick add"** group: "Add <item>" for each allowed + Add item.
  - **"Go to"** group: every visible non-classic menu item.
- **Footer hints:** "↑ ↓ navigate", "Enter open", "Tip: type or scan an asset tag / serial to jump straight to it".
- The text clears whenever the palette closes.

#### 5.0.5 Asset lifecycle (from `lifecycle.ts`, `enums.ts`)

**Statuses** (label): "Purchased", "Received", "In Inventory", "Available", "Assigned", "In Maintenance", "Returned", "Retired", "Disposed", "Lost".

- **Starting statuses for a new asset:** Purchased, Received, In Inventory, Available. In Inventory is not offered for quantity-tracked types.
- **Conditions:** New, Good, Fair, Poor, Damaged.
- **Ownership:** Owned, Leased, Rented, Subscription, Licensed.
- **Tracking modes:**
  - **INDIVIDUAL**: one tag per item.
  - **QUANTITY**: a pooled stock of units.
- **Consumable** (quantity types only): "One-time item — no return".
  - In the UI, "Assign" becomes **"Give"**.
  - Only Employee or Department can receive it.
  - Nothing is returned, and it never appears on exit checklists.

**Lifecycle stepper stages** (shown on asset detail):
1. Purchased
2. Received
3. Inventory
4. Available
5. Assigned
6. Maintenance
7. Returned
8. Retired (also used for Lost; the step is labelled "Lost" when the asset is lost)
9. Disposed

**Actions:**

| Action (label) | Description | From | To | Permission | Pooled? |
|---|---|---|---|---|---|
| "Receive" | Mark the purchased asset as received | Purchased | Received | `asset:lifecycle` | yes |
| "Move to inventory" | Put the asset into a store / warehouse | Received, Available, Returned | In Inventory | `asset:assign` | no |
| "Make available" | Ready for use and can be assigned | Received, In Inventory, Returned | Available | `asset:lifecycle` | yes |
| "Assign" | Give the asset to an employee, department, location, company or vendor | Available, In Inventory | Assigned | `asset:assign` | yes |
| "Transfer" | Move the asset from its current holder to a new one | Assigned, In Inventory | depends | `asset:assign` | yes |
| "Return" | Take the asset back from its holder | Assigned | Returned (or Available, see Return dialog) | `asset:assign` | yes |
| "Send to maintenance" | Repair, service or inspection | Available, Assigned, Returned, In Inventory | In Maintenance | `maintenance:manage` | no |
| "Complete maintenance" | Return the asset to service | In Maintenance | depends | `maintenance:manage` | no (not offered on asset detail; done from Maintenance) |
| "Retire" | Take the asset out of service | Available, Returned, In Inventory, In Maintenance | Retired | `asset:lifecycle` | yes |
| "Reinstate" | Bring a retired asset back into service | Retired | Available | `asset:lifecycle` | yes |
| "Mark lost" | The asset cannot be found | Available, Assigned, In Inventory, Returned | Lost | `asset:lifecycle` | no |
| "Mark found" | A lost asset has been recovered | Lost | Available | `asset:lifecycle` | no |
| "Dispose" | Scrap, sell or write off the asset (final) | Retired, Lost | Disposed | `asset:lifecycle` | yes |

**Action tones** (used for emphasis):
- Primary: receive, make available, assign, complete maintenance, mark found.
- Warning: send to maintenance, retire.
- Danger (shown as destructive): mark lost, dispose.

**Pooled (quantity) rules:**
- **Assign:** only when status is Available or Assigned AND free units > 0.
- **Transfer / Return:** only when there is at least one active allocation.
- **Retire:** only when status is Available or Assigned AND there are no active allocations.
- **Other actions:** follow the "From" column.
- **Not available for pooled assets:** Move to inventory, maintenance, lost/found.

#### 5.0.6 Custody (holders, assign / transfer / return)

- **Holder types the UI can assign to:** Employee, Department, Vendor, "In store" (INVENTORY).
  - Location and Company exist as holder types but can't be chosen here (single-branch company).
- **"In store"** needs no picker: "It goes back to the company store — not with anyone."
- **Employee picker** only lists employees whose status is Active, On Leave or Notice Period. Each option shows "code · designation · department · On notice".
- **Allocation statuses** (Assignments history): Active ("Current"), Returned, Transferred, Released, Lost, Consumed ("Given (no return)").
- **Every assign, transfer, return and fulfilment can carry photos:**
  - Handover photos ("OUT") on assign / transfer / fulfil.
  - Return photos ("IN") on return.
  - Asset photos at creation.
- **Every change is written to an immutable history** ("Activity log").

#### 5.0.7 Joiner flow (onboarding)

Statuses: `DRAFT` → `SUBMITTED` → `APPROVED` → `COMPLETED`, or `CANCELLED`.

| Status | Label | Who acts next |
|---|---|---|
| DRAFT | "Draft (HR)" | HR |
| SUBMITTED | "Waiting for IT approval" | IT |
| APPROVED | "Approved — assigning" | IT |
| COMPLETED | "Joined" | — |
| CANCELLED | "Cancelled" | — |

Steps:
1. **HR creates the joiner** ("New joiner" form). This creates an employee with status **Joining** plus an onboarding case with planned items. A kit and/or the joining kit can be included.
2. **HR adds or removes items, then "Send to IT".** At least one item is required.
3. **IT reviews the list.**
   - "Approve", or
   - "Send back to HR" with a required note. The case returns to Draft and the note is shown to HR.
4. **IT assigns items.**
   - Per item: "Assign" picks an asset; "Skip" takes an optional reason; "Undo skip".
   - Or all at once: "Assign all".
5. **Either side marks the person joined** ("Mark joined"). The employee becomes Active. Unassigned items become approved Requests.
6. **"Not joining — cancel"** (HR) needs a reason. The employee record is marked Exited.

**Item statuses:** PLANNED / PREPARED ("To assign"), ISSUED ("Assigned"), SKIPPED ("Skipped").

**Who can edit the list:**
- HR (`onboarding:manage`) can edit until IT approves.
- IT can edit any time before joining.

#### 5.0.8 Exit flow

1. **HR starts the notice.** HR (`employee:status`) uses "Change status / notice period" → "Notice period / leaving" with a last working day.
   - This creates an **exit case** (status OPEN).
   - The case gets one checklist item per asset the person holds, except consumables.
   - IT/Admin are notified.
2. **IT works the checklist.** Each item is Pending, Returned, Damaged or Missing.
   - **Returned and Damaged count as cleared.**
   - Items can be cleared by scanning (camera, USB or typed) or with the status buttons.
   - Manual items can be added.
   - Assets assigned during the notice period are added automatically ("Added during notice").
3. **"Complete exit"** works only when Pending + Missing = 0.
   - The employee becomes **Exited** and their portal login is disabled.
4. **"Override & complete…"** (`exit:override`) handles uncleared items.
   - A reason of at least 10 characters is required.
   - Uncleared items are written off as lost.
   - The override is recorded permanently with the person's name.
5. **"Withdraw notice"** (`employee:status`) cancels the case.
   - The employee goes back to Active and keeps their assets.
   - The reason is optional.

Exit case statuses: OPEN ("In progress"), COMPLETED, CANCELLED.

#### 5.0.9 Custom field types (`fields.ts`)

| Type key | Label | Input | Validation |
|---|---|---|---|
| text | "Text" | single line | max length: the field's max, otherwise 500; min length if set |
| textarea | "Long text" | multi-line (full width) | max: the field's max, otherwise 5000; min if set |
| number | "Number" | numeric | must be a number; min/max value if set; commas allowed |
| currency | "Currency" | numeric | same as number; displayed with en-IN grouping, 2 decimals |
| date | "Date" | date | must be a valid YYYY-MM-DD |
| boolean | "Yes / No" | switch | yes/no; never "required"-checked |
| select | "Dropdown" | single choice (empty "Select…" if required, otherwise "—") | must be one of the options |
| multiselect | "Multi-select" | toggle chips (full width) | each value must be an option |
| email | "Email" | email | valid email |
| phone | "Phone" | tel | 5–20 of digits, + ( ) - . and space |
| url | "URL" | url | valid URL; rendered as a link on detail |

- **Error messages:** e.g. "<Label> is required", "<Label> must be at least N", "<Label> must be one of: …", "<Label> is too long".
- **Field key:** generated from the label ("Engine No." → `engine_no`). Allowed pattern: `^[a-z][a-z0-9_]{0,49}$`.
- **Inheritance:** fields can belong to a **category** (inherited by all its types) or to an **asset type**.
- **Field flags:** Required, Unique, Show in tables, Filterable. Placeholder and help text are optional. Unique fields show the hint "Must be unique" when no help text is set.
- **Empty values** display as "—".

---

### 5.1 Dashboard (staff) / Home (employee)

#### Dashboard / Home
- **URL:** `/assets`. Data refreshes every 60 s.
- **Who:**
  - The server decides the scope.
  - Organisation view: staff with `dashboard:view`.
  - Personal view: everyone else, including plain employees ("Home").
- **Purpose:** an at-a-glance summary of assets (organisation) or "my stuff" (personal).

**Organisation view — what it shows**
- **Header:** greeting by time of day ("Good morning / afternoon / evening, <first name>") and "Here’s what’s happening with your assets today."
- **Quick actions** (the first is the primary action):
  - "Add asset" (`asset:create`)
  - "Add employee" (`employee:manage`)
  - "Scan" (always)
  - "Request" (`request:create`)
  - "Maintenance" (`maintenance:manage`)
- **Stat cards** (each card is a link):

| Card | Value | Hint | Opens |
|---|---|---|---|
| "Total assets" | count | "In the register" | `/assets/assets` |
| "Assigned" | count | "<n>% in use" (assigned / total) | `?status=ASSIGNED` |
| "Available" | count | "Ready to assign" | `?status=AVAILABLE` |
| "Pending exit recoveries" | pending exit items | "<n> employee(s) on notice" (warning if > 0) | `/assets/exits` |
| "In maintenance" | count | — | `?status=IN_MAINTENANCE` |
| "Open tickets" | count (alert if > 0) | — | `/assets/tickets` |
| "Requests to action" | pending + approved | "<p> pending · <a> to fulfil" | `/assets/requests` |
| "Warranties expiring (30d)" | count (warning if > 0) | "<n> lost asset(s)" when any are lost | `?warranty=expiring` |

- **Priority queue card:** shown if `ticket:manage` OR `request:approve` OR `request:fulfil`. See §3.
- **"Assets by status"**
  - Description: "<n> in the register (excluding disposed)".
  - A proportional bar of all statuses except Disposed.
  - Per-status count list, each linking to `?status=`.
  - "By category" tiles: icon, name, count and % assigned, each linking to `?categoryId=`.
- **"Exits in progress"** ("Assets still to recover").
  - Link "All" → `/assets/exits`.
  - Per case: name, days indicator ("<n>d overdue" / "Last day today" / "<n>d left"; urgent at ≤3 days), progress "done/total".
  - Opens `/assets/exits/:id`.
  - Empty: "No one is leaving" — "Exit checklists appear here when HR moves someone to notice period."
- **"Availability by type"** ("What can be handed out right now").
  - Per type: icon, name, available (flagged when 0), "of <total>".
  - Opens `?assetTypeId=&status=AVAILABLE`.
- **"Who has the assets"** ("By holder"): chips per holder type ("In store" for inventory) with a count, each opening `?holderType=`.
- **"Warranty expiring soon"** ("Next 30 days").
  - Per asset: name, tag, holder, expiry date. Opens the asset.
  - Empty: "Nothing expiring".
- **"Recent activity"** ("Every change is recorded permanently").
  - Link "Activity log" → `/assets/activity`.
  - Timeline with entity links (see §16).

**Personal view — what it shows**
- **Welcome block:**
  - Company short name.
  - Greeting.
  - "You have <n> item(s) from the company." or "No company items are assigned to you."
  - Employee code.
  - **My QR** (QR of the person link; tap opens own employee page; label "My QR"). Shown if the person is linked to an employee and links are ready.
- **Open exit banner** (if any): "Please return your company items by <LWD>." Opens the exit case.
- **Two big actions:**
  - "Request an asset" — "Laptop, SIM, chair — anything". Opens the Request form.
  - "Report a problem" — "Broken, lost or not working". Opens the Ticket form.
- **"My assets"** ("View only — ask IT for any change").
  - Per item: icon, name, ×qty, "<type> · since <date>". Opens the asset.
  - Empty: "Nothing assigned yet" — "Need something for work? Tap “Request an asset”."
- **"My requests"** ("<n> waiting", or "Everything you’ve asked for").
  - Link "All" → `/assets/requests?status=ALL`.
  - Per request: "qty × type", relative time, and a 3-step progress "Requested → Approved → Received". Rejected or Cancelled requests show a status badge instead.
  - Decision note shown as "IT: <note>".
  - Empty: "No requests yet".
- **"My problem reports"** (only if any): ticket title and status badge. Link "All" → `/assets/tickets`.

**States**
- Loading: page skeleton.
- Error: "Couldn’t load this" + "Try again".

**Mobile**
- The personal view is phone-first: large tap targets and a QR suitable for showing to IT.

---

### 5.2 Leadership overview

#### Leadership overview
- **URL:** `/assets/leadership?days=7|30|90|365` (default 30).
- **Who:** `insights:leadership` (CEO / Leadership role). Others get the error state.
- **Purpose:** how the organisation and the IT team did over a period.
- **Period switch:** "7 days", "30 days", "90 days", "1 year". Description: "How the organisation and the IT team did in the last <period>."

**What it shows**
- **Stat cards:**
  - "People": headcount; hint "<j> joined · <l> left · <n> on notice".
  - "Joining soon": upcoming joiners; "Being onboarded".
  - "Assets in use": count; "<n> available".
- **"IT service"** ("Last <period>"), four metrics:
  - **"Tickets"** — "<n> resolved"
    - "<raised> raised · <open> open now"
    - "Typical fix time: <h h | x.x days | —>"
    - Warning: "<n> open for over a week"
  - **"Asset requests"** — "<n> fulfilled"
    - "<raised> raised · <waiting> waiting"
    - "Typical wait: <n days | —>"
  - **"Handovers"** — "<n> assets handed over"
    - "<n> joiners onboarded · <p>% ready on day 1"
  - **"Exits"** — "<n> completed"
    - "<n> assets recovered"
    - Warning: "<n> written off as missing"
- **"IT team"** table ("What each person handled in the last <period>").
  - Columns: Person (name + role), Tickets resolved, Open tickets (flagged when > 5), Typical fix time, Handovers, Returns, Requests fulfilled, Joiner items, Last active (relative, or "Never").
  - Empty: "No IT team members yet" — "People with the IT / Asset Manager role appear here."
- **"Departments"** table ("People and the assets they hold").
  - Columns: Department, People, Assets held, On notice ("—" if 0), To recover (flagged when > 0; "—" if 0).
  - Empty: "No departments yet".

**States:** loading skeleton; error with retry. Read-only page (no actions).

---

### 5.3 Priority queue

#### Priority queue
- **URL:** `/assets/queue?priority=URGENT|HIGH|MEDIUM|LOW&kind=TICKET|REQUEST|ONBOARDING`. Refreshes every 30 s.
- **Who:** menu shown to IT. The data is everything waiting on the IT team.
- **Purpose:** one list of open tickets, requests and joiner cases. Ordered most urgent first, then overdue, then oldest.
- **Description:** "Everything waiting on the IT team — most urgent first, then overdue, then oldest. Refreshes every 30 seconds."

**What it shows**
- **Four priority tiles** ("Urgent", "High", "Medium", "Low") with counts.
  - Clicking a tile filters to that priority; clicking again clears the filter.
- **Kind filter:** "Everything", "Tickets", "Requests", "New joiners".
- **Overdue badge:** "<n> overdue" (when > 0).
- **List grouped by priority** (group header "<Priority> · <count>"). Each row shows:
  - Kind (ticket / request / joiner).
  - Title.
  - Number.
  - Status text:
    - Tickets/requests: "Open", "In progress", "Needs approval", "Ready to fulfil".
    - Joiners: "Approve items", "Assign items".
  - Detail.
  - Assignee name.
  - Priority badge.
  - Due text: "Overdue · needed|joined <date>", or "Needed <date>" / "Joins <date>", or the relative created time.
- **Row action:** opens the item's link (request sheet, ticket sheet or onboarding case).

**States**
- Loading: 5 placeholder rows.
- Error with retry.
- Empty:
  - With nothing waiting: "All clear" — "No open tickets or requests are waiting."
  - With a filter applied: "Nothing matches this filter".

**Dashboard card variant:** see below.

#### Priority queue card (dashboard)
- Title "Priority queue".
- Summary: "<u> urgent · <h> high · <total> waiting in total · <n> overdue".
- Top 5 rows (compact: no assignee).
- "Open queue" → `/assets/queue`.
- Empty: "All clear — nothing waiting." Loading placeholder while data loads.

---

### 5.4 Assets list ("Assets" / "My assets")

#### Assets list
- **URL:** `/assets/assets`
- **Query params:**
  - `status` (one status)
  - `search`
  - `categoryId`
  - `assetTypeId`
  - `holderType` (EMPLOYEE | DEPARTMENT | VENDOR | INVENTORY), `holderId`
  - `employeeId`
  - `vendorId`
  - `locationId`, `companyId` (from org pages; no chip shown)
  - `condition`
  - `ownership`
  - `warranty=expiring|expired`
  - Custom-field filters: `f.<key>=value`, `f.<key>.min`, `f.<key>.max`
  - `page` (1), `pageSize` (25 | 50 | 100), `sort` (default `createdAt`), `dir` (default `desc`)
- **Who:**
  - Everyone can open it.
  - With `asset:view`: title "Assets", all assets.
  - Without: title "My assets", only the person's own assets (server-scoped).
- **Purpose:** browse, filter and act on the asset register.
- **Header description:** "<n> [status] assets". Before data loads: "Everything the company owns, leases, stores or assigns."

**Header actions**
- "Scan" → `/assets/scan`.
- "Add asset" (`asset:create`). Opens the Asset form, pre-selecting the filtered type if one is set.

**Status tabs**
- "All" plus one tab per status, each with a live count.
- Order: Available, Assigned, In Inventory, In Maintenance, Returned, Purchased, Received, Lost, Retired, Disposed.
- Tabs with zero count are hidden, unless that status is currently selected.

**Filter bar**
- Search: "Search name, tag, serial, holder, specs…" (250 ms debounce; clear "×").
- Category select: "All categories". Changing it clears the type.
- Type picker: searchable, "All types"; options show the category; limited to the selected category.
- "Any holder": Employee / Department / Vendor / In store (wide screens only today).
- "Any condition" (wider screens).
- "Any ownership" (wider screens).
- **"Specs"** popover (custom-field filters): appears only when a category or type is chosen; badge shows the active count. See below.
- View toggle: "Table view" / "Card view".
  - Remembered on the device.
  - Default: cards on narrow screens, table otherwise.

**Active filter chips** (each removable)
- "Category: …"
- "Type: …"
- "Held by: … (one)"
- "Employee filter"
- "Vendor filter"
- "Condition: …"
- "Ownership: …"
- "Warranty expiring ≤30d" / "Warranty expired"
- Spec filters: "<Field> ≥ x", "<Field> ≤ y", "<Field>: v"
- "Clear all" removes filters but keeps status and search.

**Table columns**
1. Selection checkbox (also "Select all on this page").
2. **"Asset"** (sortable by name): icon, name, tag, serial.
3. **"Type"** (sortable; hidden on mobile).
4. **"Status"** (sortable): badge. For quantity items also "<n> left" (consumable) or "<free> of <qty> free".
5. **"Assigned to"** (sortable by holder): holder type + name. For quantity items: "<n> units issued" or "—".
6. **Custom columns:** only when exactly one type is filtered — up to 6 of that type's fields marked "Show in tables". Dates are formatted.
7. **"Warranty"** (sortable; hidden on mobile): date. Expired dates are de-emphasised; dates within 30 days are flagged.
8. **"Updated"** (sortable; hidden on mobile): relative time.

**Card view**
- Each card shows: icon, name, tag, type, custom columns (if any), status badge, updated time, and holder or "<free> of <qty> available".
- Selected cards are marked as selected.

**Row / card actions**
- Click opens `/assets/assets/:id`.
- Hover prefetches the detail.

**Keyboard:** J/K, Enter, X, [ ].

**Bulk actions** (bar shows "<n> selected")
- **"Assign"** (`asset:assign`) → Bulk dialog.
- **"Change status"** (`asset:lifecycle`) → Bulk dialog.
- **"Print labels"** → `/assets/labels?ids=…`.
- **"Clear"** clears the selection.

**Pagination:** "<from>–<to> of <total>", "<n> / page" (25 / 50 / 100), "Page x of y", previous/next.

**States**
- Loading: skeleton rows (table) or 8 skeleton cards.
- A thin refetch indicator while re-fetching.
- Error: error state with retry.
- Empty:
  - With filters/search/status: "No assets match these filters" — "Try removing a filter or searching for something else." + "Clear filters".
  - No assets at all, with `asset:view`: "No assets yet" — "Add your first asset — any type, with its own fields." + "Add asset" (if `asset:create`).
  - No assets, employee-only: "No assets assigned to you".

**Mobile:** cards by default; Type/Warranty/Updated columns hidden in the table; secondary filters hidden.

#### Specs (custom-field filter popover)
- **Fields shown:** the filterable fields of the chosen category/type. Duplicates by key across sibling types are merged.
- **Inputs by field type:**
  - Select / multiselect: "Any" + options.
  - Yes/No: "Any / Yes / No".
  - Number / currency / date: "From" – "To" range.
  - Other: "Contains…".
- **Buttons:**
  - "Clear": removes all spec filters.
  - "Apply": writes them to the URL.
- **States:** "Loading…" / "No filterable fields".

#### Bulk dialog
- **Titles:** "Assign assets" / "Change status".
- **Description:** "<n> asset(s) selected. Assets that can’t take this action are skipped and reported."
- **Fields:**
  - Assign: **"Assign to"**: holder picker (Employee / Department / Vendor / In store).
  - Change status: **"Action"**: select of the bulk lifecycle actions the person is allowed. Format: "<Label> — <description>".
    - Options: Receive, Make available, Move to inventory, Retire, Reinstate, Mark lost, Mark found, Dispose.
    - Default: Make available.
  - "Notes" (optional, max 1000).
- **Buttons:** "Cancel", "Apply to <n>".
  - For Assign, "Apply to <n>" is disabled until a holder is picked (or "In store" is chosen).
- **Limit:** 1–200 assets per run.
- **Result:**
  - All succeeded: toast "Done: <n> asset(s)".
  - Some failed: warning "<ok> done, <n> skipped" with up to 3 distinct reasons. The failed assets stay selected.

---

### 5.5 Asset detail

#### Asset detail
- **URL:** `/assets/assets/:id`
- **Who:**
  - Anyone who can see the asset. Employees can see their own; otherwise the server returns 403/404 and the error state shows.
  - Actions are filtered by permission AND by lifecycle validity (§0.5).
- **Purpose:** everything about one asset, and every action on it.

**Header**
- Back link "Assets".
- Icon, name.
- **Asset tag:** click copies it (title "Copy asset tag"; shows a "copied" confirmation briefly).
- Status badge, condition badge, "<type> · <category>".
- Badges: "Tracked by quantity" (pooled), "One-time — no return" (consumable).

**Primary actions** (shown when valid and allowed)
- **"Assign"**: "Give" for consumables; "Assign units" for pooled non-consumables.
- **"Transfer"**, **"Return"**: for pooled assets these are disabled when there is more than one active allocation (use the per-allocation buttons instead).
- **"Edit"** (`asset:edit`) → Asset form in edit mode.

**More menu**
- "Lifecycle" section: every other valid, allowed action.
  - Danger actions (mark lost, dispose) are marked destructive.
  - "Send to maintenance" opens the Maintenance form pre-filled with the asset.
  - Others open the Lifecycle dialog.
- "Print label" → `/assets/labels?ids=<id>`.
- "Raise a ticket" (`ticket:create`) → Ticket form pre-filled with the asset.

**Alerts**
- **Per open exit case:** "<name> is on notice — this asset is on exit checklist <case> (last working day <date>)." Link "Open checklist →".
- **Per open maintenance:** "<number> scheduled for <date> | in progress: <title>". Link "Manage →" (Maintenance page).
- **If Lost:** "This asset is marked lost. Mark it found if it turns up, or dispose of it to write it off."

**Lifecycle stepper:** the 9 stages, with done / current / future state. The current step reads "Lost" when the asset is lost.

**"<Type> specifications"**
- Custom field values for the type and its category.
- Empty: "No custom fields defined for <Type>. Add them in the asset catalog."
- "Archived fields (kept for history)": values of fields since removed.

**"Details"**
- Serial number, Manufacturer, Model, Ownership, Vendor, Purchase date, Invoice.
- "Warranty / expiry" with "(expired)" or "(<n> days left)"; flagged within 30 days.
- Added.
- Notes (if any).

**"Photos (n)" card** (§19.34): the asset's own photos as thumbnails (tap = full-size viewer with caption, previous / next, Download, and Delete + confirmation for `asset:edit`); "Add photo" (`asset:edit`) opens "Add photos of this asset" — Take photo (phone camera; the app's back camera) · Choose from gallery · Cancel, caption for the first photo, "Save n photos"; "n of 6", disabled at 6. The same dialog opens by itself after "Add asset" when no photo was picked in the form (Skip closes it); the edit form shows the gallery too. The assets list shows the first photo instead of the type icon.

**Tabs**
- **"Timeline"**: the asset's history (§16).
- **"Assignments"**
  - Columns: Holder (×qty), From, To ("—" while current), Outcome ("Current", or status + return condition + end notes; Consumed reads "Given (no return)"), Photos.
  - Empty: "Never assigned".
- **"Maintenance"**
  - Columns: Record (title, number, vendor), Type, Status, Cost, Date.
  - Empty: "No maintenance recorded".
- **"Ownership"**
  - Columns: Ownership, Owner company, Vendor / lessor, Period ("<start> – <end|now>").
  - Empty: "No ownership records".

**Custody panel**
- Title: "Custody" / "Stock & allocations" (pooled) / "Stock" (consumable).
- **Individual asset:**
  - Holder: "In store at" or "Assigned to (<holder type>)". Employee holders link to their page.
  - Since (date-time + relative), By, Expected back (if set), Notes, "Handover photos".
  - Not assigned: "Not assigned" — "Ready to hand out." or "Status: <status>", with an "Assign" button if valid.
- **Pooled asset:**
  - Available number, "of <qty> available" / "left of <qty>", progress.
  - List of active allocations: holder, "×qty · since date", photos.
  - Per allocation, with `asset:assign`: "Transfer" and "Return".
  - Empty text: "No units issued." For consumables: "Given items are kept by the person — see Assignments for who got one."

**"Label" panel**
- QR (link `/assets/scan/<qrCode>`), barcode of the tag, the tag.
- "Scan with a phone camera or a USB scanner to open this asset."
- "Print" → labels page.

**States:** page loader; error with retry. Read-only for people without action permissions (only Print label is shown, plus Raise a ticket if allowed).

#### Assign / Transfer / Give dialog
- **Title:** "Assign asset" / "Transfer asset" / "Give <name>".
- **Description:** "<tag> · <name> — currently with <holder>" (the "currently with" part only for transfer).
- **Consumable note:** "One-time item — it’s theirs to keep. Stock goes down; nothing to return."
- **Fields:**
  - **"Assign to" / "Transfer to" / "Give to"** (required): holder picker.
    - Allowed holders: Employee, Department, Vendor, In store. Pooled assets exclude In store. Consumables allow Employee and Department only.
    - Error: "Choose who receives it".
  - **"Quantity"**: pooled assign only. Min 1, max the number available; hint "<n> available"; default 1.
  - **"Expected return"**: date; hint "Optional — for loans and temporary use". Hidden for In store and consumables.
  - **"Notes"**: placeholder "Handover notes, accessories included…" (max 1000).
  - **"Handover photos"**: photo picker (§17).
- **Buttons:** "Cancel", "Assign" / "Transfer" / "Give".
- **Result toasts:** "<tag> assigned" / "<tag> transferred" / "<name> given — no return needed".
  - Photos upload after the save. If the upload fails: "Saved, but the photos did not upload: …".
- **Server errors:** shown as a toast.

#### Return dialog
- **Title:** "Return asset". Description: "<tag> · <name> — from <holder> (<n> units)".
- **Fields:**
  - **"Condition on return"**: one of New / Good / Fair / Poor / Damaged (default Good).
  - **"Ready to reuse"** switch (individual assets only).
    - Default on.
    - On: "Goes straight back to Available." Off: "Stays Returned until inspected."
    - Turns off automatically when Poor or Damaged is chosen; disabled when Damaged.
  - **"Notes"**: placeholder "Missing accessories, scratches…".
  - **"Return photos"**: hint "Optional · capture scratches or damage as proof".
- **Buttons:** "Cancel", "Confirm return".
- **Result:** toast "<tag> returned".

#### Lifecycle action dialog
- **Title:** the action label. Description: "<tag> · <name> — <description>."
- **Holder warning** (mark lost / retire, when someone holds the asset): "Currently held by <holder>. Their assignment will be closed."
- **Field:** "Reason" (danger actions) or "Notes".
  - Dispose placeholder: "Sold / scrapped / e-waste certificate no."
- **Dispose note:** "Disposal is final. The asset and its full history stay on record (<today>)."
- **Buttons:** "Cancel", "<Action label>" (destructive for danger actions).
- **Result:** toast "<Label>: <tag>".

---

### 5.6 Asset form (Add / Edit)

#### Add asset / Edit asset (slide-over form)
- **Opened from:** + Add → "Asset"; "Add asset" buttons; catalog "Add <type>"; employee "Add a new asset"; asset detail "Edit".
- **Who:** `asset:create` (add) / `asset:edit` (edit).
- **Title:** "Add asset" / "Edit <tag>".
- **Description:**
  - Add: "Anything the company owns, leases, stores or uses."
  - Add from an employee: "It will be assigned to <person>."
  - Edit: the asset name.
- **Buttons:**
  - "Cancel".
  - "Add asset" / "Save changes".
  - "Save & add another" (add only, after a type is chosen).
  - Ctrl/⌘+Enter saves.

**Fields**
- **"Asset type"** (required).
  - Searchable list; options show "<category> · <code> · by quantity".
  - Placeholder "Laptop, Car, SIM Card, Helmet…".
  - Hint (add): "Pick what it is — the form adapts to the type."
  - Hint (edit): "The type cannot change after creation." The field is locked.
  - Before a type is chosen: "Choose an asset type to continue. Missing one? Create it under Settings → Asset catalog — no code changes needed." (with `catalog:manage`), or "…Ask an administrator to add it."
- **"Basics"**
  - "Manufacturer / brand" (max 120; placeholder "Dell, Honda, Canon…").
  - "Model" (max 120; "Latitude 7440").
  - **"Name"** (required, max 200).
    - Hint: "Shown everywhere. Filled from brand + model if left alone."
    - Auto-filled from manufacturer + model until edited (add only).
  - "Serial number" (individual types only; max 120).
  - **"Quantity"** (pooled types only; required; 1–1,000,000).
    - Hint (add): "How many units in stock."
    - Hint (edit): "Total units, including assigned ones."
  - "Condition" (default New when adding).
  - **"Starting status"** (add only): Purchased / Received / In Inventory (not for pooled) / Available. Default Available.
    - Locked to Available when "Assign now" is on; hint "Assigned right away."
- **"<Type> details"**: the type's custom fields (§0.9). Description: "Custom fields defined for this type and its category."
- **"Purchase & ownership"**
  - "Ownership" (default Owned).
  - "Vendor / supplier": picker; can add a vendor inline ("Add vendor “<text>”") with `org:manage`.
  - "Invoice number" (max 120).
  - "Purchase date" (default today when adding).
  - "Warranty / expiry": hint "Warranty end, or expiry for licences and subscriptions."
  - "Notes" (max 2000).
  - Hidden: currency (INR), owner company (defaults to the first company).
- **"Photos"** (add only): hint "Optional · up to 6 photos of the asset as it arrives".
- **"Assign now"** (add only, `asset:assign`)
  - Switch; text "Hand it to an employee, department or vendor in the same step."
  - When on: holder picker (Employee / Department / Vendor). Required; error "Choose who receives it".

**Submit results**
- **Add:** toast "<tag> added" with the name and an "Open" action.
  - "Save & add another" keeps the form open and clears Name, Serial, custom fields, holder and photos.
  - Photo upload failure: "Asset added, but the photos did not upload: …".
- **Edit:** "Asset updated".
  - Uses a version number. A concurrent edit returns a server error (toast).
- **Errors:** field errors from the server are shown on the fields, plus a toast.

**States:** skeleton while the type's fields load.

---

### 5.7 Labels (print)

#### Asset labels
- **URL:** `/assets/labels?ids=<id,id,…>`
- **Who:** anyone; data is permission-checked by the server.
- **Purpose:** print QR + barcode stickers.
- **Shows:**
  - Back link "Assets".
  - Title "Asset labels".
  - "<n> label(s) ready to print. Stick them on the assets — scanning opens the asset page."
  - Per label: QR (asset scan link), "Company property · <type>", tag, name, barcode of the tag.
- **Actions:**
  - Size select: "Standard (3 per row)" / "Small (4 per row)".
  - "Print" (browser print; page controls are hidden on paper).
- **Warning** (when QR links point at localhost): "These QR codes point to <base>, which a phone can’t open. …"
- **States:**
  - No ids: "No assets selected" — "Select assets in the list and choose “Print labels”." + "Go to assets".
  - Loader; error with retry.

---

### 5.8 Scan

#### Scan
- **URLs:**
  - `/assets/scan`
  - `/assets/scan/:code` (asset QR link)
  - `/assets/id/:code` (person ID-card link)
- **Who:** the menu shows it to IT. Anyone can open it; results are permission-checked.
- **Purpose:** turn a scanned or typed code into the asset or person page.
- **Description:** "Scan a person’s ID card to see everything they hold, or an asset label to open the asset."

**What it shows / does**
- **Camera scanner:**
  - "Start camera". While starting: spinner. Running: live view with an aiming frame and "Stop camera".
  - The same code read again within 2.5 s is ignored.
  - Errors: "Camera permission was denied." / "No camera available on this device." Button changes to "Try again".
  - On non-HTTPS: the camera is replaced by "Scan with your phone’s camera" — "Point the normal camera app at an ID card or asset label and tap the link — it opens here. (The in-page camera needs HTTPS.)"
- **Manual entry** (divider "or type it"):
  - Input "Employee ID, asset tag or serial" (uppercase, no autocorrect).
  - Button "Find".
- **Hints:** "Person ID card → their assets", "Asset label → the asset".

**How a code is resolved**
1. Tried as an asset (QR token, tag or serial).
2. If not found, tried as a person (employee code). `/id/<code>` links go straight to the person lookup.
3. If neither matches: "Nothing matches "<code>"".

- **Success:** toast "Person: <name (code)>" or "<tag · name>", then navigate. From a QR URL, the history entry is replaced.
- **Error:** inline error text + toast.
- **Opened from a QR URL:** looks the code up automatically.

**Mobile:** camera-first; large input and button; the person's phone camera app works via the QR links.

---

### 5.9 Employees list

#### Employees
- **URL:** `/assets/employees`
- **Query params:**
  - `status` (JOINING | ACTIVE | NOTICE_PERIOD | ON_LEAVE | EXITED; empty = "Current")
  - `view=contacts`
  - `search`
  - `departmentId`
  - `hasAssets=1`
  - `page`, `pageSize`, `sort` (name), `dir`
- **Who:** `employee:view`.
- **Purpose:** the people who can hold company assets.
- **Header description:** "<n> <status|current> employees".
- **Actions:**
  - "Print ID cards" / "Print <n> ID cards": all rows on the page, or the selected ones → `/assets/id-cards?ids=`. Shown when the list has rows.
  - "Add employee" (`employee:manage`).

**Tabs:** "Current", "Joining", "Active", "Notice period", "On leave", "Exited".

**View switch:** "Details" / "Phones & emails".

**Filters**
- Search: "Search name, employee ID, phone, email…".
- "All departments".
- Checkbox "Holding assets".

**Details columns**
- "Employee" (sortable): avatar, name, code, email.
- "Designation" (hidden on mobile).
- "Department" (hidden on mobile).
- "Status" (sortable): badge. On notice: "LWD <date>", flagged at ≤3 days.
- "Assets": count. On notice with assets: "to recover".

**"Phones & emails" columns**
- Employee.
- "Official phone" (tap to call).
- "Company SIM" (list of numbers).
- "Official email" (tap to mail).
- "Personal phone".
- "Personal email".
- Missing values show "—".

**Row action:** open `/assets/employees/:id`. Selectable rows; keyboard support.

**Bulk:** "<n> selected" → "Print ID cards", "Clear".

**Pagination:** 25 / 50 / 100.

**States:** loading / error; empty "No employees found" (+ "Clear filters" when search or department is set).

#### Add / Edit employee (slide-over form)
- **Title:** "Add employee" / "Edit <name>".
- **Who:** `employee:manage`.
- **Buttons:** "Add employee" / "Save changes".

**"Person"**
- **"First name"** (required, max 100).
- "Last name" (max 100).
- **"Employee ID"** (required, max 40, stored uppercase).
  - Hint: "e.g. CT000099 — also their login ID".
  - Placeholder: "CT000099".
- "Designation" (max 120; "Sales Executive").
- "Official phone": hint "Company SIM, if any"; max 40.
- "Personal phone" (max 40).
- "Official email" (valid email).
- "Personal email" (valid email).
- "NA" or "-" in any contact field is treated as empty.

**"Organisation"**
- "Department" (picker; inline add with `org:manage`).
- "Reports to" (employee picker).
- "Joining date".
- "Notes" (max 2000).
- Hidden: company (defaults to the first company), location.

**"Portal access"** (add only, `user:manage`)
- Switch "Give a login now" — "Choose their role and sign-in details. You can also do this later from their page."
- When on:
  - **"Role"** (required; defaults to "Employee"; shows the role description).
  - "Login ID": follows the employee ID (lowercased) until edited.
    - Hint: "Filled from the employee ID · change it if you like (blank = employee ID)".
    - Spaces are stripped; 3–50 characters of letters, numbers, `.`, `_`, `-`.
  - "Email for sign-in": hint "Optional · blank = official email".
  - "Password": show/hide + "Generate"; hint "At least 8 characters · blank = generated".
    - Error: "At least 8 characters".
- Login-related server errors are shown in this section.

**Result**
- Toast "<name> added" with "Open", or "Employee updated".
- If a login was created, the Credentials dialog follows (§10).

#### Change status dialog
- **Title:** "Change status". Description: "<name> is currently <status>."
- **Who:** `employee:status`. Not offered while the employee is Joining (joiners change status through onboarding).
- **Options:**
  - "Active" — "Working normally"
  - "On leave" — "Temporarily away"
  - "Notice period / leaving" — "Starts asset recovery"
- **Default choice:** Notice period if currently Active; Active if Exited; otherwise the current status.
- **When Notice period is chosen:**
  - "Notice given on" (default today).
  - **"Last working day"** (required; default today + 30).
  - Warning text:
    - Holds assets: "All <n> asset(s) they hold go on a recovery checklist, and IT/Admin are notified. The exit can’t be completed until they’re returned or an authorised override is recorded."
    - Holds nothing: "They hold no assets, so the exit can be completed right away."
- **When changing away from Notice period:** "This withdraws the notice and cancels the open exit checklist."
- "Reason / notes" (max 1000; placeholder "Resigned, contract end…" for notice).
- **Buttons:**
  - "Cancel".
  - "Start notice & build checklist" (when newly starting notice) or "Save".
  - Disabled when the status is unchanged (except Notice period).
- **Result:**
  - Notice: toast "<name> is on notice" — "<n> asset(s) added to the recovery checklist. IT/Admin have been notified." Then navigates to the exit case.
  - Otherwise: "Status changed to <status>".

---

### 5.10 Employee detail (also "My QR & profile")

#### Employee detail
- **URL:** `/assets/employees/:id`. Employees reach their own page via `/assets/me`.
- **Who:**
  - `employee:view` for anyone's page.
  - Employee-only users see only their own page (server-enforced).
  - "Self" mode applies when the page is the signed-in person's own.
- **Purpose:** a person, what they hold, and their login.

**Header**
- Back link "Employees" (only with `employee:view`).
- Avatar, name, code, status badge, "designation · department".
- More menu (shown with `employee:manage` or `employee:status`):
  - "Edit details" (`employee:manage`).
  - "Change status / notice period" (`employee:status`; not while Joining).
- IT buttons (`asset:assign`, person not Exited):
  - **"Assign asset"** → Pick asset dialog.
  - **"Mark checked"**: records an in-person verification today. Toast "Marked as checked today".

**Banners**
- Joining: "New joiner — joining <date>. Onboarding <case> →".
- On notice: "On notice — last day <date> (<n days overdue | today | n days left>). Return checklist <case> →".

**"Assets held (n)"** / **"My assets (n)"**
- Verification line: "Last checked <date> (<relative>) by <name>" or "Never checked in person".
- "Open in assets" (`asset:view`) → `/assets/assets?employeeId=`.
- Per item: icon, name ×qty, tag · type, "SN <serial>", status badge. Opens the asset.
- With `asset:assign`: "Since <date>", "Transfer", "Return" (same dialogs as §5).
- Empty: "No assets assigned" / "Nothing is assigned to you".

**Tabs**
- "History": the person's history, with entity links.
- "Exit cases (n)": case number, "Last working day <date>", status. Opens the case. Empty: "No exit cases".
- "Given, no return (n)": consumables received; "Given <date>".
  - Empty: "Nothing given yet" — "One-time items like the joining kit show here — they’re theirs to keep."

**Side panels**
- **ID card panel:** "Person QR" / "My QR".
  - Self: "Show this to IT to check or return your assets." Others: "Scan with any phone camera or the app to open this page."
  - Shows the QR of `/assets/id/<code>`, the code and the name.
  - "ID card" print (`employee:view`) → `/assets/id-cards?ids=<id>`.
  - Localhost warning (not shown in self mode).
- **"Contact":** rows for Official phone, Personal phone, Official email, Personal email (tap to call/mail). Empty: "No phone or email recorded."
- **"Portal login":** shown if (`user:manage` OR a login exists) AND not self.
  - Status line: "Signs in with <login ID> or <employee code> or <email>" / "Login is turned off" / "No login yet".
  - Badge: role name when active, "Off" when disabled.
  - "Last sign-in: <relative | never>".
  - Buttons (`user:manage`, person not Exited):
    - "Give login (view only)" / "Turn login back on" / "Change login / password" → Access dialog.
    - "Turn off" (when active). Confirm: "Turn off <name>’s login?" — "They will be signed out and can’t sign in until you give access again." Button "Turn off". Toast "Login turned off".
  - Note (no login yet): "They’ll only see their own assets and QR. You choose the login ID and password."
- **"Profile":** Department, Reports to, Joined, Notice given, Last working day (flagged at ≤3 days), Exited on, Notes, "Direct reports" (links).

**Order on mobile:** self sees their QR first; IT sees assets first. Contact, login and profile follow.

**States:** loader; error with retry.

#### Pick asset dialog (Assign asset, step 1)
- **Title:** "Assign an asset to <name>".
- **Description:** "Pick one that’s available or in a store — or add a new one that isn’t in the system yet."
- **Asset picker:** searches Available or In Inventory assets ("Search assets by name, tag or serial…").
  - With `asset:create`, the list offers "Add new asset “<text>”".
- **"Add a new asset"** (`asset:create`): "Enter its details and it’s assigned to <name> right away".
  - Opens the Asset form with Assign now pre-set to this employee, and the typed name pre-filled.
- **Buttons:** "Cancel", "Continue" (enabled once an asset is picked). Continue opens the Assign dialog with this employee pre-selected.

#### Access dialog (give / change login)
- **Title:** "Give <name> a login" / "Change login / password".
- **Description:** "They can sign in with the login ID, their employee ID <code>, or the email."
- **Fields:**
  - "Role": hint "What they can see and do"; default Employee.
  - "Login ID": hint "Optional · e.g. amit.kumar — letters, numbers, dot, dash"; placeholder = employee code.
  - "Email for sign-in": hint "Optional · they can type this instead of the login ID".
  - "Password" / "New password": show/hide + "Generate".
    - Hint (new): "At least 8 characters · leave blank to generate one".
    - Hint (change): "Leave blank to generate one · they are signed out everywhere".
    - Error: "At least 8 characters".
- **Buttons:** "Cancel", "Create login" / "Save".
- **Errors:** shown per field; a general error appears under the form.
- **Result:** Credentials dialog.

#### Credentials dialog (shown once)
- **Title:** "Login created" / "New password".
- **Text:** "Share this with <name>. The password is shown only now — it is stored encrypted and can’t be looked up later."
- **Shows:** Login ID, "or employee ID" (if different), "or email", Password.
- **Buttons:**
  - "Share" (native share sheet when available) or "Copy". Copy errors: "Couldn’t copy — select the text instead".
  - "Done".
- **Shared text includes:** company name, app link, login ID / email, password, and "Please change your password after signing in."

---

### 5.11 ID cards (print)

#### ID cards
- **URL:** `/assets/id-cards?ids=…` (max 200).
- **Purpose:** printable cards with one QR per person. Scanning a card shows everything assigned to that person.
- **Shows:**
  - Back link "Employees".
  - Title "ID cards".
  - "<n> card(s). Scanning a card shows everything assigned to that person."
  - Per card: company name (or "Employee ID"), QR, full name, employee code, "designation · department".
- **Actions:** "Print". Localhost QR warning.
- **States:**
  - No ids: "No people selected" — "Select people in the employee list and choose “Print ID cards”." + "Go to employees".
  - Loader; error with retry.

---

### 5.12 New joiners (onboarding)

#### New joiners (HR list)
- **URL:** `/assets/onboarding?status=<csv>&search=&page=&pageSize=`. Default status = `DRAFT,SUBMITTED,APPROVED`.
- **Who:** menu for `onboarding:manage` (not IT).
- **Purpose:** "Tell IT who is joining and what they need. IT approves it, assigns everything, and you mark them as joined on day 1."
- **Action:** "New joiner" (`onboarding:manage`).
- **Tabs:** "Upcoming", "Drafts", "Waiting for IT", "Approved", "Joined", "Cancelled".
- **Search:** "Search name, employee ID, case…".
- **Columns:**
  - "New joiner": avatar, name, code · designation · department.
  - "Joining": date. For open cases also "Joins today / tomorrow / in n days / was due n days ago" (urgent at ≤3 days).
  - "Items" (hidden on mobile): "<issued> of <total−skipped> assigned" + progress, or "Nothing listed yet".
  - "Status".
  - "Case" (hidden on mobile).
- **Row:** opens `/assets/onboarding/:id`.
- **Empty:** "No one joining soon" — "Add a new joiner to get their things ready before day 1." + "New joiner".

**IT variant:** the same table inside Requests → "New joiners" (§14).

#### New joiner form (slide-over)
- **Title:** "New joiner".
- **Description:** "Plan their first day: add them now, list what they should get, and IT prepares it before they join."
- **Submit:** "Create onboarding".

**"Who is joining"**
- **"First name"** (required).
- "Last name".
- **"Employee ID"** (required; "e.g. CT000150").
- **"Joining date"** (required; error "Pick the joining date").
- "Designation" ("Field Sales Executive").
- "Reports to".
- "Department".
- "Official email": hint "If already created".
- "Personal phone".

**"What they should get"**
- "Start from a kit": options "No kit — I’ll add items" or "<kit> (<n> items)".
  - Hint: "Fills the list with that role’s usual items — you can change it next." / "No kits yet — you can save one from any onboarding."
  - Disabled when there are no kits.
- **"Include joining kit"** checkbox (default on).
  - Shown when a consumable joining-kit type exists (code JKT or name matching "joining kit").
  - Text: "One-time welcome kit — theirs to keep, no return · <n> in stock".
  - Not added twice if the chosen kit already includes it.
- "Notes for IT" ("Works from Karol Bagh; needs a laptop with Tally…").

**Result:** toast "<case> created" — "Now add what they should get, then send it to IT." Then navigates to the case.

#### Onboarding case detail
- **URL:** `/assets/onboarding/:id`
- **Who:** HR (`onboarding:manage`) and IT (`asset:assign`), with different powers.
- **Back link:** "New joiner requests" (IT → `/assets/requests?view=joiners`) or "New joiners" (HR).

**Header**
- Avatar, name (links to the employee), status, "Ready for day 1" (approved and ready).
- Code · designation · department.
- "Joining <date>" + joins-in text + case number.

**Header actions** (only while the case is open)
- **"Send to IT"**: Draft, HR. Disabled with no items. Toast "Sent to IT" — "IT has been notified to approve it."
- **"Approve"**: Submitted, IT. Toast "Approved" — "Now assign the items."
- **"Send back to HR"**: Submitted, IT.
  - Confirm "Send back to HR?" — "HR gets your note, changes the list and sends it again."
  - Required note "What should HR change?" (min 3 characters).
  - Toast "Sent back to HR".
- **"Assign all (n)"**: Approved, IT, items left to assign.
- **"Mark joined"**: Approved (HR or IT).
  - Confirm "Mark <name> as joined?".
  - Text: "<n> item(s) has/have not been assigned yet — they will stay in Requests (approved) so IT can still give them." or "Their status becomes Active."
  - Toast "<name> has joined", plus "Still to give, in Requests: <numbers>" if any were left.
- **More menu:**
  - "Change joining date" (HR).
  - "Send back to HR" (Approved, IT, nothing assigned yet).
  - "Save list as a kit" (HR; disabled with no items).
    - Confirm "Save this list as a kit?" — "Next time, pick this kit when adding a joiner for the same role. An existing kit with the same name is updated."
    - Required "Kit name" (min 2).
    - Toast "Kit “x” saved/updated".
  - "Not joining — cancel" (HR; destructive).
    - Confirm "Cancel this onboarding?" — "Use this if <name> is not joining. Their record is marked Exited."
    - Required "Reason" (min 3).
    - Toast "Onboarding cancelled".

**Banners**
- Draft with a return note: "IT sent this back: <note>".
- Submitted, viewed by non-IT: "Waiting for IT to approve. You can still change the list until then."
- Approved: "<issued> of <total−skipped> assigned · approved by <name>" + progress.

**"What <first name> needs"** (item list)
- Per item:
  - "qty × name".
  - Status ("To assign" / "Assigned" / "Skipped").
  - "not in catalog" for free-text items.
  - "no return" for consumables.
  - Notes.
  - When assigned: asset tag link + name + "by <name> on <date>".
  - When skipped: "Skipped: <reason>".
- Item actions (not for assigned items):
  - **"Assign"**: Approved + IT → Issue dialog.
  - **"Skip"**: Approved + IT.
    - Confirm "Skip <item>?" — "It won’t be given and won’t become a request."
    - Optional "Reason".
  - **"Undo skip"**: skipped items, IT.
  - **Remove** (trash icon "Remove <item>"): when the list is editable.
- "Add from a kit…" select (editable list, HR; only when kits exist). Toast "Added <n> items from “<kit>”".
- Empty: "Nothing listed yet. Add what <first name> needs below, or pick a kit."
- **Add item row** (editable list):
  - "Add item": type picker, options show "<category> · <n> available". Free text allowed ("Add “<text>”").
  - "Qty" (min 1, max 1000).
  - "Note for IT" ("i5, 16 GB, Windows").
  - "Add" (disabled until a type or text is entered).

**"Day-1 checklist"** (done / not done marks)
- "Sent to IT <time>".
- "Approved by IT <time>".
- "Everything assigned (<issued>/<total−skipped>)".
- "Portal login": action "Give login" → employee page (`user:manage`).
- "ID card with QR": always neutral; action "Print" → ID cards.
- Case notes.
- "Cancelled: <reason>".
- "Joined — marked by <name> on <time>".

**"History":** case timeline.

#### Issue dialog (assign one item)
- **Title:** "Assign <item>". Description: "Assigns it to <name> now, with optional handover photos."
- **Fields:**
  - **"Asset"** (required): Available or In Inventory assets of the item's type.
  - "Handover photos".
- **Buttons:** "Cancel", "Assign".
- **Result:** toast "<item> assigned to <name>". Photo failure: "Assigned, but the photos did not upload: …".

#### Assign all dialog
- **Title:** "Assign to <name>".
- **Description:** "Pick the asset for each item. Leave any you don’t have yet — they stay on the list."
- **Fields:** one asset picker per remaining item, filtered by type and Available/In Inventory, with the item notes as a hint.
- **Buttons:** "Cancel", "Assign <n>" (disabled until at least one is picked; max 50).
- **Result:**
  - Toast "<n> item(s) assigned to <name>".
  - Failures: "<n> could not be assigned" listing "<item>: <error>". The dialog stays open when there are failures.

#### Change joining date dialog
- Date input.
- "Save" is disabled when empty or unchanged.
- Toast "Joining date updated".

---

### 5.13 Exits

#### Employee exits (list)
- **URL:** `/assets/exits?status=OPEN|COMPLETED|CANCELLED|ALL&search=&page=&pageSize=`. Default OPEN.
- **Who:** menu for `exit:manage` OR `employee:status`. Data also needs `exit:view` (server).
- **Purpose:** "Asset recovery for people on notice. Exits can’t complete until every asset is cleared."

**Stat cards**
- "Exits in progress" (count).
- "Assets still to recover" ("Pending + missing").
- "Leaving within 7 days" (hint "<n> overdue with items outstanding" or "None overdue").

**Tabs:** "In progress", "Completed", "Cancelled", "All".

**Search:** "Search employee or case number…".

**Columns**
- "Employee": avatar, name, code · designation · department.
- "Case" (hidden on mobile).
- "Last working day": date; for open cases "<n> days overdue / Last day today / <n> days left".
- "Recovery": "<cleared>/<total> cleared", "<n> pending", "<n> missing", progress.
- "Status": badge; "Overridden" when an override was used.

**Row:** opens `/assets/exits/:id`.

**Empty:** "No exits in progress" / "No exit cases" — "When HR moves someone to Notice Period, their asset recovery checklist appears here automatically."

#### Exit case detail (clearance)
- **URL:** `/assets/exits/:id`
- **Who:**
  - View: exit/employee access (server).
  - Manage items: `exit:manage` while the case is OPEN.
  - Override: `exit:override`.
  - Withdraw: `employee:status`.

**Header**
- Back link "Exits".
- "Exit clearance · <case>".
- Name (links to the employee).
- Case status, employee status, code · designation · department.
- "Last working day" + days left.

**Closed banners**
- Completed: "Exit completed <time> by <name> — all assets cleared" or "— with authorised override", plus "Reason: …".
- Cancelled: "This exit was cancelled <time> (notice withdrawn)."

**Counters**
- "Recovery progress": "<cleared> of <total> cleared" + %.
- Cards: Returned (hidden on small screens), Damaged, Pending (flagged when > 0), Missing (flagged when > 0).

**Scan bar** (manage)
- Input "Scan or type an asset tag / serial to mark it returned…".
- "Mark returned".
- Camera toggle ("Use camera") opens the camera scanner inline.
- A USB scanner anywhere on this page also marks items returned.
- Results:
  - "Returned: <tag> <name>".
  - Already cleared: "<tag> was already cleared".
  - Error toast; the input text is selected for a retry.

**"Asset recovery checklist"**
- Subtitle: "Built automatically from every asset assigned to <name>."
- "Add item" (manage) → Manual item dialog.
- Per item:
  - Name (links to the asset if tracked).
  - ×qty.
  - "Added during notice" / "Manual".
  - Tag · type · "SN <serial>".
  - Resolution line: "<Status> by <name> · <time> — <notes>".
- Per-item status (manage): four choices Pending / Returned / Damaged / Missing.
  - The current one is disabled.
  - Pending and Missing are locked once the underlying allocation is no longer active (the asset was already returned elsewhere).
  - Toast "<tag>: <status>".
- Read-only viewers see a status badge.
- Empty: "Nothing to recover" — "This employee held no assets."

**"Case history"** tab: timeline.

**"Complete exit" panel** (open cases)
- Blocked: "Blocked: <p> pending and <m> missing. Recover them, or record an authorised override."
- Ready: "All assets are cleared. You can complete the exit."
- **"Complete exit"** (`exit:manage`). The server refuses while items are blocking.
  - Toast "Exit completed — all assets cleared"; errors stay visible for 8 s.
- **"Override & complete…"** (`exit:override`, when items are blocking).
  - Confirm "Complete exit with override".
  - Lists the uncleared items: "These <n> item(s) are not cleared. They will be written off as lost and the override is recorded permanently with your name".
  - Required "Reason for override" (min 10; placeholder "e.g. Laptop cost recovered from full & final settlement").
  - Button "Override & complete exit".
  - Toast "Exit completed with authorised override".
- **"Withdraw notice"** (`employee:status`).
  - Confirm "Withdraw notice?" — "<name> goes back to Active and this checklist is cancelled. Assets stay with them."
  - Optional "Reason" ("Resignation withdrawn…").
  - Toast "Notice withdrawn — exit cancelled".
- Footnote: "Completing marks <name> as Exited and disables their portal login."
- Closed case: "This case is closed."
- Note for people without override (while items are blocking): "Only HR / Admin can override uncleared items."

**"Details":** Notice given, Initiated by · date, Reason, Email.

#### Manual checklist item dialog
- **Title:** "Add checklist item".
- **Description:** "For anything not tracked as an asset (e.g. uniform, petty cash card)."
- **Fields:** **"Item"** (required, max 200), "Notes" (max 1000).
- **Buttons:** "Cancel", "Add".
- **Result:** toast "Item added to checklist".

---

### 5.14 Requests

#### Requests (asset requests / New joiners switch)
- **URL:**
  - `/assets/requests?status=<csv>|ALL&priority=&search=&page=&pageSize=&open=<requestId>`
  - `/assets/requests?view=joiners`
- **Who:**
  - Menu "Requests": staff with `request:approve` or `request:fulfil`. "My requests": employee-only.
  - The list is server-scoped (employees see their own).
- **Switcher** (IT only): "Asset requests" | "New joiners" (badge = joiner cases waiting).

**Joiners view** (IT)
- Title "Requests" — "New joiners from HR: approve what they need, then assign it all before their first day."
- The onboarding table (§12) with tabs "Open" (Submitted + Approved; default), "To approve", "To assign", "Joined".
- Empty: "No new joiners waiting" — "When HR sends a new joiner, it appears here for approval."

**Asset requests view**
- Title "Asset requests" — "Employees ask, managers approve, IT fulfils by assigning an asset."
- Action: "New request" (`request:create`).
- **Tabs:** "Open" (Pending + Approved; default), "Pending approval", "To fulfil", "Fulfilled", "Closed" (Rejected + Cancelled), "All".
- **Filter:** "Any priority" / Low / Medium / High / Urgent.
- **Search:** "Search requests…".
- **Columns:**
  - "Request": "qty × type", number · reason.
  - "For": employee name + department/code.
  - "Priority" (hidden on mobile).
  - "Needed by" (hidden on mobile).
  - "Status": badge; fulfilled asset tag; for open requests "Not in catalog" or "<n> in stock" (flagged when 0).
  - "Raised" (hidden on mobile).
  - Actions.
- **Row actions:**
  - **"Approve"** / **Reject**: Pending, and the person can decide (server `canDecide`, otherwise `request:approve`).
    - Confirm "Approve|Reject <number>?" — "<name> requested <qty> × <type>."
    - "Note to requester" (required for Reject).
    - Toast "<number> approved|rejected".
  - **"Fulfil"**: Approved + `request:fulfil` → Fulfil dialog.
  - **"Cancel"**: own request, Pending or Approved, and the person cannot approve. Toast "Request cancelled".
- **Row click** opens the request sheet (`?open=<id>`).
- **Empty:** "No requests" (+ "New request").

#### Request sheet (side panel)
- **Opened by:** a row click or a notification link `?open=<id>`.
- **Title:** "qty × type". Description: "<number> · raised <relative>".
  - Not found / not allowed: "This request was not found, or you cannot see it."
- **Shows:**
  - Status, priority, stock text.
  - For (name + code), Department, Category, Needed by, Requested by, Reason, Decided by · date, Decision note.
  - Fulfilled with (asset tag link).
- **Footer:** the same actions as the row.

#### Fulfil dialog
- **Title:** "Fulfil <number>".
- **Description:** "Pick an available <type> (or any asset that matches, for free-text requests) for <name>. It will be assigned to them immediately."
- **Fields:**
  - "Asset": Available or In Inventory, of the requested type when known.
  - "Handover photos".
- **Buttons:** "Cancel", "Assign & fulfil".
- **Result:** toast "<number> fulfilled — asset assigned to <name>". Photo failure: "Fulfilled, but the photos did not upload: …".

#### Request form (slide-over)
- **Title:** "Request an asset" — "Ask for anything you need for work — IT will be notified."
- **Submit:** "Submit request".
- **Fields:**
  - **"For employee"** (required): only shown to people with `request:approve` or `request:fulfil`. Defaults to self.
  - **"What do you need?"** (required).
    - Catalog types with "<category> · <n> available", or free text via "Request “<text>”".
    - Hint: "Pick from the list, or type anything and tap “Request …”".
    - Placeholder: "Monitor, headset, SIM card…".
    - Error: "Choose what you need or type it".
  - "Quantity": 1–1000, default 1.
  - "Priority": default Medium.
  - "Needed by": date.
  - **"Reason"** (required, max 2000): "Why is it needed?".
- **Result:** toast "Request <number> submitted" — "Approvers have been notified."

---

### 5.15 Tickets & Maintenance

#### Tickets
- **URL:** `/assets/tickets?status=OPEN,IN_PROGRESS|RESOLVED,CLOSED|ALL&priority=&search=&open=<id>&page=`
- **Who:** menu "Tickets" (staff + `ticket:manage`) / "My tickets" (employee-only). The list is server-scoped.
- **Purpose:** "Issues, damage, loss and repair requests raised against assets."
- **Action:** "Raise ticket" (`ticket:create`).
- **Tabs:** "Open" (default), "Resolved", "All".
- **Filter:** "Any priority".
- **Search:** "Search tickets…".
- **Columns:**
  - "Ticket": title, number · type · asset tag.
  - "Priority".
  - "Status".
  - "Reported by" (hidden on mobile).
  - "Assignee" ("Unassigned"; hidden on mobile).
  - "Raised" (hidden on mobile).
- **Row:** opens the ticket sheet (`?open=`). Keyboard support.
- **Empty:** "No tickets" — "All quiet."

#### Ticket sheet
- **Title:** ticket title. Description: "<number> · raised <relative> by <name>".
- **Shows:**
  - Status, priority, type badges (Issue / Damage / Loss / Repair / Other).
  - Details.
  - Asset (link "<tag> · <name>").
  - Assignee.
  - "Task": "<ref> in Tasks" link, opens the Tasks app.
  - Resolved time.
  - "History" timeline.
- **Edit section** (`ticket:manage`):
  - "Status": Open / In Progress / Resolved / Closed.
  - "Assignee": "Unassigned" or a staff member.
  - "Resolution notes" (max 5000).
  - Footer: "Close", "Save". Toast "Ticket updated".
- **Read-only** for people without `ticket:manage`.
- **Loading:** placeholder.

#### Ticket form (slide-over)
- **Title:** "Raise a ticket" — "Report a problem, damage or loss."
- **Submit:** "Raise ticket".
- **Fields:**
  - **"Title"** (required, max 200; "Laptop won’t charge").
  - "Asset": optional; hint "Optional — which asset is affected?". Pre-filled when raised from an asset.
  - "Type": Issue / Damage / Loss / Repair / Other; default Issue.
  - "Priority": default Medium.
  - "Details" (max 5000): "What happened? Since when?".
- **Result:** toast "Ticket <number> raised" — "The support team has been notified."

#### Maintenance
- **URL:** `/assets/maintenance?status=IN_PROGRESS,SCHEDULED|IN_PROGRESS|SCHEDULED|COMPLETED|ALL&search=&page=`
- **Who:** `maintenance:manage` (menu and actions).
- **Purpose:** "Repairs, servicing and inspections. Assets return to their holder (or to Available) when work completes."
- **Action:** "Log maintenance".
- **Tabs:** "Active" (default), "In progress", "Scheduled", "Completed", "All".
- **Search:** "Search work orders, assets…".
- **Columns:**
  - "Work": title, number · type · vendor.
  - "Asset": name, tag, asset status; links to the asset.
  - "Status".
  - "Date" (completed, otherwise started, otherwise scheduled, otherwise created; hidden on mobile).
  - "Cost" (hidden on mobile).
  - Actions.
- **Row actions:**
  - **"Start"** (Scheduled). Toast "<number> started".
  - **"Complete"** (In progress) → Complete dialog.
  - **Cancel** (Scheduled / In progress).
    - Confirm "Cancel <number>?". When in progress: "The asset goes back to service."
    - Button "Cancel maintenance".
    - Toast "<number> cancelled".
- **Statuses:** Scheduled, In Progress, Completed, Cancelled.
- **Types:** Preventive, Repair, Inspection, Service, Calibration.
- **Empty:** "No maintenance here".

#### Complete maintenance dialog
- **Title:** "Complete <number>" — "<tag> · <name>".
- **Fields:**
  - "What was done?" (max 5000).
  - "Final cost (₹)": min 0; placeholder = the estimate; left blank, the estimate is kept.
- **Result:** toast "<number> completed — asset back in service".

#### Maintenance form (slide-over)
- **Title:** "Log maintenance" — "Repairs, servicing, inspections and calibration."
- **Submit:** "Start maintenance" or "Schedule".
- **Fields:**
  - **"Asset"** (required): Available, Assigned, Returned or In Inventory assets. Pre-filled from the asset page.
  - **"Title"** (required, max 200; "Screen replacement").
  - "Type": default Repair.
  - "Estimated cost (₹)": min 0.
  - "Service vendor": inline add allowed with `org:manage`.
  - **"Start now"** switch (default on): "The asset moves to “In maintenance” immediately."
  - "Scheduled for": shown when Start now is off.
  - "Details" (max 5000).
- **Result:** toast "Maintenance <number> started|scheduled".

---

### 5.16 Activity log & Timeline

#### Activity log
- **URL:** `/assets/activity?search=&entityType=&from=&to=&page=&pageSize=50`
- **Who:** `history:view`.
- **Purpose:** an organisation-wide, append-only history.
- **Description:** "Immutable: the database rejects any edit or deletion of history."
- **Filters:**
  - Search: "Search activity, people, assets…".
  - Entity select: "Everything", Asset, Employee, Exit Case, Onboarding Case, Category, Asset Type, Field, Company, Department, Location, Vendor, Request, Ticket, Maintenance, User, Role.
  - From date – To date.
- **List:** timeline (below) with entity labels and links.
- **Pagination.**
- **Empty:** "No activity matches". Error with retry.

#### Timeline (component used everywhere)
- **Each event shows:**
  - The kind of action (created, assigned, transfer, returned, maintenance, lost, disposed/deleted, retired/cancelled/rejected, inventory/location, completed/approved/found, exit/override, item change, updated, ticket).
  - Optional entity label, linked:
    - Asset → asset page
    - Employee → employee page
    - Exit case → case page
    - Request → `/assets/requests?open=`
    - Ticket → `/assets/tickets?open=`
    - Maintenance → maintenance page
  - The summary text.
  - Up to 8 field changes, shown as "Field: old → new". Ids show as "changed"; enum values are humanised.
  - "<actor> · <relative time>" (exact time on hover).
- **Loading:** 5 placeholder rows. **Empty:** "No history yet" (or the caller's text).

---

### 5.17 Shared components (functions designers must cover)

#### Photo picker / photo strip
- **Picker:**
  - Camera / gallery input. Phones offer "Take photo".
  - Up to **6** photos; previews with "Remove photo".
  - Add tile: "Photo", or "Add" once some are chosen.
  - Images are compressed in the browser to a JPEG with a longest edge of 1600 px (about 300 KB) before upload.
  - Default hint: "Optional · up to 6 photos of the asset's condition".
- **Photo kinds:** Asset, Handover ("OUT"), Return ("IN").
- **Strip:** thumbnails (two sizes). Tap opens a viewer:
  - Title "<Kind> photo".
  - "<date-time> · by <name> · i of n".
  - Previous / next.
  - "Download" (filename `<kind>-photo-<date>-<n>.jpg`).

#### Pickers
- **Combobox:**
  - Searchable single select (type to filter, arrows + Enter).
  - Optional clear ("Clear").
  - "No matches" / "Searching…".
  - Optional "Add …" item for creating a new entry from the typed text.
- **Entity picker:** employee, asset, department, company, vendor, store, location.
  - Employees and assets are searched on the server (200 ms).
  - Assets show "tag · type · holder" or "<n> free".
  - Stores are listed first and marked "Store / warehouse".
  - **Inline creation** (with `org:manage`): "Add company / department / location / store / vendor “<name>”".
    - Typing a name is required first ("Type the new <x>’s name first").
    - Toast "Added <x> “<name>”".
  - **Asset pickers** may offer "Add new asset “<text>”" / "Add a new asset".
- **Holder picker:** holder-type choice (Employee / Department / Vendor / In store, as allowed) + the matching entity picker.
  - Placeholder "Choose <type>…".

#### Dynamic fields
- Renders any type's custom fields from their definitions (§0.9): required mark, help text or "Must be unique", per-field errors.
- Long text and multi-select take full width.

#### Forms / dialogs (general rules)
- **Slide-over forms:**
  - Header, scrolling body, footer with "Cancel" + submit (+ optional secondary action).
  - "Ctrl Enter to save" hint.
  - The first field is focused on open.
  - Server field errors are shown inline, plus an error toast.
- **Confirm dialogs:**
  - Title, description, confirm label, optional destructive style.
  - Optional note field, which can be required with a minimum length ("At least N characters").

#### Tables (general)
- Sortable headers where noted (asc/desc toggle).
- Select-all on the page (checked / partial / none).
- Highlighted row for keyboard navigation.
- Refetch indicator.
- Loading skeleton (8 rows).
- Error state with "Try again".
- Columns marked "hidden on mobile" are hidden below tablet width.

---

### 5.18 Asset catalogue (Settings)

#### Asset catalog
- **URL:** `/assets/settings/catalog?category=<id>&type=<id>`. The first category is auto-selected.
- **Who:** `catalog:manage`.
- **Purpose:** "Define any kind of asset — categories, types and their own fields. No code changes needed."
- **Header actions:** "+ Category", "+ Asset type" (pre-selects the current category).

**Tree (left)**
- "Filter types…".
- Categories: icon, name, type count. Expandable.
- Types under each category: name, a marker for quantity-tracked types, asset count.
- "Add type" per category.
- Clicking a category selects it (and toggles it open). Clicking a type opens its panel.
- Loading placeholders.

**Category panel**
- Icon, name, "<description | No description> · <n> type(s) · <n> asset(s)".
- "Edit" → Category form.
- Delete:
  - Confirm "Delete “<name>”?" — "Remove its asset types first." (if it has types) or "This cannot be undone."
  - Toast "Category deleted".
- **"Shared fields"** — "Every type in <category> gets these (e.g. Registration No. for all vehicles)." Field list (below).
- **"Asset types"** — "Each type can add its own fields on top."
  - "+ Type".
  - Cards: name, "<n> fields · <n> assets". Opens the type.
  - Empty: "No types yet".

**Type panel**
- Icon, name, "<category> · tag prefix <CODE>- · <n> asset(s)".
- Badge "Tracked by quantity" / "Tracked individually".
- "Edit" → Asset type form.
- "Add <type>" → Asset form for this type.
- Delete type:
  - Confirm "Delete “<name>”?" — "<n> asset(s) use it — dispose or delete them first." or "This cannot be undone."
  - Toast "Asset type deleted".
- **"Fields"** — "Drag to reorder. These appear on every <type> form and detail page."
  - Inherited fields: read-only, under "From category “<name>”".
  - Own fields under "<type> fields".
- **"Form preview"** — "What people see when adding this asset. Try it — validation is live."
  - Button "Validate" → "Looks valid!".
  - Empty: "Add fields to see the form."

**Field list** (per category or type)
- Each row: drag handle ("Drag to reorder"; keyboard reorder supported), label, badges "Required" / "Unique" / "In table", key · type · options · min–max.
- "Edit field" → Field dialog.
- "Delete field":
  - Confirm "Remove “<label>”?" — "If assets already have values for it, the field is archived instead so no data is lost."
  - Toast "“<label>” archived — existing values are kept on assets" or "“<label>” removed".
- Reordering saves immediately. On error it reverts and shows a toast.
- Empty: "No fields yet." + "Add the first field". Otherwise "Add field".

#### Field dialog
- **Title:** "Add field" / "Edit field “<label>”".
- **Description:** "Adds a field to every <owner> asset — no code changes." / "Existing values are kept."
- **Fields:**
  - **"Label"** (required, max 80; "Engine No."). Auto-generates the key until the key is edited.
  - "Type": the 11 types. Locked when editing ("Fixed after creation").
  - "Key": lowercase letters, numbers and `_`. Hint "Used in filters and the API". Locked when editing.
  - **"Options"** (Dropdown / Multi-select; required, at least 1, at most 200, each ≤100 characters).
    - Type and press Enter, or "Add". Commas or new lines separate many.
    - Removable chips; "No options yet".
  - "Minimum value" / "Maximum value" (number / currency) or "Min length" / "Max length" (text / long text).
  - "Placeholder" (max 120).
  - "Help text" (max 300).
  - Switches:
    - "Required" — "Must be filled in"
    - "Unique" — "No two assets share a value"
    - "Show in tables" — "Column when this type is filtered"
    - "Filterable" — "Appears in spec filters" (default on)
- **Buttons:** "Cancel", "Add field" / "Save field". Disabled without a label, or an option type with no options.
- **Result:** toast "Field "<label>" added to <owner>" / "Field updated". Errors are shown per field.

#### Category form (slide-over)
- **Title:** "New category" / "Edit category" — "Groups asset types, e.g. IT, Vehicles, Safety."
- **Fields:**
  - **"Name"** (required, max 100; "Vehicles").
  - **"Code"** (required, 2–10 letters/numbers, uppercase).
    - Hint: "Short unique code".
    - Auto-filled from the first 3 characters of the name until edited.
  - "Colour": choice from the palette.
  - "Icon": choice from the icon set.
  - "Description" (max 500; "What belongs in <name>?").
- **Result:** "Category "<name>" created" (then opens it in the catalog) / "Category updated".

#### Asset type form (slide-over)
- **Title:** "New asset type" / "Edit asset type" — "Any kind of asset: define it once, then add its own fields."
- **Fields:**
  - **"Category"** (required; "Select a category…").
  - **"Name"** (required, max 100; "Drone").
  - **"Tag prefix"** (required, 2–10 letters/numbers).
    - Hint: "Asset tags will look like PREFIX-000001".
    - Auto-filled from the name.
  - **"How is it tracked?"**
    - "Individually" — "Each item has its own tag (laptop, car)"
    - "By quantity" — "A stock of units (gloves, licence seats)"
    - Locked once assets exist: "Cannot change once assets exist."
  - **"One-time item — no return"** (quantity types only): "Given away for good (joining kit, stationery). Stock goes down; nothing to return or recover at exit."
  - "Icon".
  - "Description" (max 500).
- **Result:** "<name>" created — now add its fields (opens the type in the catalog) / "Asset type updated".

---

### 5.19 Departments & Vendors (Settings)

#### Departments / Vendors
- **URLs:** `/assets/settings/departments`, `/assets/settings/vendors` (`?search=&page=&sort=name&dir=`).
- **Who:** `org:manage`.
- **Purpose:**
  - Departments: "Teams that can hold shared assets (printers, projectors, tools)."
  - Vendors: "Suppliers, lessors and service partners."
  - (Companies and Locations use the same screen design but have no menu entry.)
- **Action:** "Add department" / "Add vendor".
- **Search:** "Search departments…" / "Search vendors…".
- **Columns:**
  - "Name" (sortable): name + code · "in <parent>".
  - Departments: "Company", "Employees", "Assets" (link → `/assets/assets?holderType=DEPARTMENT&holderId=`).
  - Vendors: "Contact" (person · email · phone), "Holding", "Supplied" (link → `?vendorId=`).
  - Actions: "Edit", "Delete".
    - Delete confirm: "Delete <name>?" — "Only possible when nothing references it."
    - Toast "<Label> deleted".
- **Row click:** edit.
- **Empty:** "No departments yet" / "No vendors yet" + Add.

#### Org form (slide-over)
- **Title:** "Add …" / "Edit …".
- **Department fields:**
  - **"Name"** (required, max 150).
  - "Code": letters, numbers, `-` and `_`, max 20, uppercase.
  - "Company" (picker).
  - "Parent" (department; placeholder "None").
- **Vendor fields:**
  - **"Name"** (required).
  - "Code".
  - "Contact person" (max 150).
  - "Email" (valid).
  - "Phone" (max 40).
  - "Website" (max 300).
  - "Address" (max 500).
  - "Notes" (max 2000).
- **(Location fields, used by pickers):** Name, Code, "Type" (Office / Building / Floor / Room / Warehouse / Site / Other), "Parent" ("e.g. the building this floor is in"), Company, Address, "Store / warehouse" switch ("Assets can be kept here as inventory").
- **(Company fields):** Name, Code, "Legal name", Address.
- **Result:** "<Label> added|updated". Field errors are shown inline.

---

### 5.20 Users & Roles (Settings)

#### Users
- **URL:** `/assets/settings/users?search=&page=`
- **Who:** `user:manage`.
- **Purpose:** "Who can sign in, and with which role."
- **Action:** "Add user".
- **Search:** "Search users…".
- **Columns:**
  - "User": name + login ID · email · employee code.
  - "Role".
  - "Employee" ("name (code)"; hidden on mobile).
  - "Access" ("Active" / "Disabled").
  - "Last sign-in" (relative / "Never"; hidden on mobile).
- **Row:** opens the user sheet.
- **Empty:** "No users".

#### User sheet (slide-over)
- **Title:** "Add user" / "Edit <name>".
- **Fields:**
  - **"Name"** (required, max 150).
  - "Login ID": optional, 3–50 of letters/numbers/`.`/`_`/`-`.
  - "Email": optional; "can also be used to sign in".
  - **"Password"**:
    - New user: required, at least 8 — "you choose it".
    - Edit: label "New password" — "Leave blank to keep the current password".
  - **"Role"** (required). Locked when editing yourself.
  - "Linked employee": hint "Lets them see “My assets” and raise requests".
  - **"Employee ID"**: shown only when adding, with no linked employee, and a role without `insights:leadership`.
    - Hint: "They are added to Employees with this ID. Leave blank to number it automatically (STAFF-001)."
  - "Can sign in" switch (default on). Locked when editing yourself.
- **Rule:** a new user needs a login ID, an email, or a linked employee. Error shown on Login ID: "Enter a login ID or email, or link an employee (they can sign in with their employee ID)".
- **Result:** "User created" / "User updated".

#### Roles & permissions
- **URL:** `/assets/settings/roles`
- **Who:** `user:manage`.
- **Purpose:** "Every API call — and any future AI assistant — is checked against these permissions."
- **Action:** "New role".
- **Role cards:**
  - Name, "Built-in" badge for system roles, description.
  - "<n> permissions · <n> user(s)".
  - First 8 permission keys + "+N".
  - Buttons:
    - "Edit" ("View" for the Admin role).
    - Delete (custom roles only): confirm "Delete role “<name>”?". Toast "Role deleted".

#### Role sheet
- **Title:** "New role" / "Role: <name>".
  - Admin: "The Admin role always has every permission." The whole form is read-only and the button reads "Close".
- **Fields:**
  - **"Name"** (required, max 80). Locked for built-in roles.
  - "Description" (max 300).
  - Permission checkboxes grouped as "Assets", "People & organisation", "Employee exit", "Service", "Administration". Each shows its description + key (§0.1).
  - New roles start with `request:create` and `ticket:create`.
- **Submit:** "Save role".
- **Result:** "Role created" / "Role updated — members get it on their next request".

---

### 5.21 Out of scope / classic
- "SIM cards" and "Reconciliation" open the classic app (full page load) and are not specified here.
- Any other `/assets/...` path not listed above also opens the classic app.

---
