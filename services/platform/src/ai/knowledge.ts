/**
 * What the AI helper knows about Kaampilot (PLAN.md §24.3): a curated, compact summary of docs/UI-FUNCTIONALITY.md and
 * PLAN.md for people using the app and website visitors. Update it when a screen or a price changes. Facts only: the
 * model is told never to go beyond it. Kept as a TS string so it ships inside dist/ without a copy step.
 */
export const KNOWLEDGE = `# Kaampilot knowledge base (for "Ask Kaampilot")

## 1. What Kaampilot is
Kaampilot (kaampilot.com) is one app for Indian small and medium businesses (about 5 to 500 people). It covers attendance and HR (selfie + GPS punch-in, leave, regularization, payroll), tasks with approvals, company assets (with new joiners and exits), and visitor and gate security. It works on the web and in an Android app, and the app shows the same screens. Made in India. Data stays in India. Support: support@kaampilot.com. Public pages: /contact, /terms, /privacy, /refunds.

What a person sees depends on what their company switched on and on their roles. If a menu item is missing, the company admin can give access (Admin › People & access) or switch the module on (Admin › Settings › Modules).

**Layout**
- Desktop: a left sidebar with Home, then the groups **Attendance**, **Tasks**, **Assets**, **Visitors** and **Admin**. Each group appears only if the person has it.
- Phone: a bottom bar with **Attendance · Home · Tasks · Assets · More**. More holds the full menu, Admin included.
- **Home** shows the attendance card (big **Punch in / Punch out** button, today's times, leave balances), then Tasks and Assets counts. On a phone the app opens on **Attendance › Today**.
- Account menu (top right): light/dark mode, Change password, company switcher, New company, Punch-in reminder (phone app only), and Sign out.

## 2. Signing up, signing in, passwords
- **Sign-in is by email only.** A mobile number can't be used to sign in, sign up, reset a password or get a code. One-time codes are sent **by email** (6 digits, valid 10 minutes).
- **Sign up** (/signup, "Start free"): enter your work email, then the 6-digit code from your email. Next, fill in About you (name, username, password). Then create your company: company name, team size, industry, state and apps. Company names must be unique. You land on Home with a **Getting started** checklist: set your office location, mark your first attendance, invite your team, install the phone app, and see plans.
- **Sign in** (/login): fill in "Email, username or employee ID" and "Password", then tap **Sign in**. You can also tap **Sign in with a code instead**: enter your email, tap **Send code**, then enter the code.
- **Several companies**: after signing in you choose one. You can switch later from the account menu.
- **Forgot password**: on the sign-in page tap **Forgot your password?**, enter your email, then the code, then choose a new password. Your other devices are signed out.
- **Logins your admin made** (username or employee ID): only the admin can reset these. The admin goes to Admin › People & access › ⋯ › **Reset password**, types or generates a password and shares it (Copy or WhatsApp). The new password is shown once, and by default you choose your own at the next sign-in.
- **Change password**: account menu › Change password.
- **Joining a company**: open the invite link your admin shared, then sign in or sign up with your email.
- Passwords are stored hashed only. Nobody, admins included, can see your password. They can only set a new one.

## 3. Pricing and trial
- Prices are **per user per month**, with **GST extra**.
- Pick the modules you need:
  - **Tasks**, **Attendance** and **Assets** are **₹99 each**, or **₹129 each with AI**.
  - Example: Tasks + Attendance = ₹198, or ₹258 with AI.
- **Complete** (all modules, including Visitors, Payroll and everything else) is **₹349**, or **₹449 with AI**.
- AI is chosen for the whole subscription. Either every module you pick has AI, or none does.
- **Free trial**: by default **3 users for 10 days**.
- **Billing**: Admin › Billing (the owner, or someone whose role has "Manage billing"). Here you choose plan and seats, enter your GST details and pay online through Cashfree. GST invoices can be downloaded as PDF.
  - Nothing is charged automatically. When a paid period ends, the banner says to pay for the next period in Billing.
  - If you don't pay: after 7 days past due the company becomes **read-only**. Everyone can still view and download, but nobody can change anything.
  - Cancelling stops the plan at the end of the paid period.

## 4. Modules

### Attendance and HR (sidebar group "Attendance")
Menu items for everyone: **Today**, **My attendance**, **My leave**, **My salary** (only if Payroll is on) and **Holidays**. Managers and HR also see a "Manage" section: **Live attendance**, **Daily attendance**, **Dashboard**, **Reports**, **Approvals**, **Payroll** and **HR settings**. Which items show depends on your permissions.

**Punching in and out**
- Use **Check in / Check out** on Attendance › Today, or **Punch in / Punch out** on the Home card.
- **Selfie**: HR sets photos to Off, Optional (you can Skip photo) or Required at every punch.
- **GPS geofence**: HR adds office locations with a radius. If you are outside it you see, for example, "You are not at the office location. You are about 1.2 km away from …". If your GPS is too rough, you're asked to move outdoors or near a window and try again.
- **Uniform check** (HR settings › Uniform at punch-in):
  - **Off**: no question.
  - **Reminder only**: a pop-up you confirm with "OK, punch in".
  - **Must confirm**: "Yes, I'm wearing it" punches you in. "No" blocks the punch.

**My attendance**
- A month calendar; tap a day to see its times and punch photos.

**Regularization (correcting attendance)**
- How to ask:
  - From My attendance: tap the day, then **Regularize this day**.
  - From Today: **Regularize a day**.
- Pick a reason: Forgot to punch in, Forgot to punch out, Punched late due to work, On duty – client visit, Work from home, Technical issue or Other. Then set the times. You can add a note and a photo or document, and you can cover several days at once.
- Every request needs approval. It goes to your **reporting manager**, or to HR approvers if you have no manager. Nothing changes until it is approved. Once approved, the day is corrected and tagged "Regularized", and payroll uses the corrected day.
- Limits are set by the company: requests per month, week or year (default 3 a month), and how many days back (default 7). HR can give some people a different limit. The form shows how many requests you have left.
- Managers and HR can use **Regularize for someone**. It applies at once and doesn't count toward the person's limit.
- Your record is under My attendance › **My regularization requests**.

**Leave**
- To apply: My leave › **Apply for leave**. Choose the type, From and To dates, and a reason. Some types need a supporting document. Half day counts as 0.5.
- Balances are enforced, and the form shows "N days left" for each type.
- Approved leave shows in your attendance. You can cancel pending leave, or approved leave that hasn't started yet.
- HR or approvers can use **Mark leave** for someone. It is approved at once, and going beyond the balance needs a tick on "Beyond balance".

**Holidays**: the company holiday list. People who manage holidays add and delete them here.

**Approvals**
- Two tabs: **Leave** and **Regularization**. Each row has **Approve** or **Reject** with optional remarks, and there is bulk approve/reject.
- Nobody approves their own request (the Owner is the only exception).

**Live attendance**
- Today's team, with tiles: Present, Late, Not checked in, On leave, Off/holiday, Checked out.
- Shows punch photos and "Reminded N×".
- HR can **Mark** a person present, half day or absent.

**Daily attendance**: any date, with ← and → to move between days.

**Dashboard**: monthly totals per person, Download report, and Import attendance (HR) from an Excel or CSV template.

**Reports**: daily, monthly summary, muster roll, late arrivals, leave and regularization, as Excel or CSV.

**Punch-in reminders (from the company)**
- Anyone not punched in by the start of work gets reminders in the app, and on WhatsApp if the company set WhatsApp up. By default that's 3 reminders, at +30, +60 and +90 minutes.
- No reminders on leave, holidays or week-offs. They stop once you punch in.
- HR sets this in HR settings › Punch-in reminders.

**HR settings**: work hours, late grace, weekly offs, office locations, photo at punch, uniform check, leave types, who approves, regularization and punch-in reminders.

**Payroll (optional module)**
- HR uses Attendance › **Payroll**:
  - **Salaries**: Set a salary with monthly gross, PF % and professional tax.
  - **Advances**: Record an advance. It is recovered from later payroll.
  - **Monthly payroll**: run payroll for a month from attendance, then **Finalise**.
- Payslips come as PDF one by one, or all of them as a ZIP or one PDF.
- Employees see finalised payslips under **My salary** and can download the PDF.
- If Payroll isn't in your menu, your company hasn't switched it on.

### Tasks (sidebar group "Tasks")
Menu items: **Home**, **Tasks**, **Team performance**, **Groups**, **Notices**, **Notifications**, **My team** and **Task settings**. Under "More" there are optional modules: Leads, AI inbox, Mistakes and Links.

**Tasks screen tabs** include Dashboard, My Tasks, All Tasks (managers), Delegated, To accept, Requests, Templates, Reports and Deleted (admins).

**Adding a task**
- Tap **Add task**. Fill in Title, Description, Assign to (one or more people; each gets their own copy), Due, Effort and Category.
- Optional fields: Department, Frequency (One time / Daily / Weekly / Monthly, with optional "Repeat until"), Priority, Group, Loop (followers), Steps and attachments.
- Tap **Create task**.
- **Voice draft** fills in the form from speech, in English or Hindi.
- A Member without the "Assign tasks" permission can give tasks only to themselves.

**Working on a task**
- **Status update** and **Today's log** record progress. **Complete** marks it done (it's blocked while steps or sub-tasks are open).
- Finished work goes to the person who gave it, under **To accept**. They **Accept** it or **Send back** with a reason. Nobody accepts their own work.

**Changes and deleting**
- On a task someone gave you, tap **Request change** to propose a new date, priority, effort, person or title, or to stop the recurrence or cancel the task. The giver approves it under **Requests**.
- Deleting a task you were given needs the giver's approval (**Send delete request**).

**Task chains**
- Open a task and use Sub-tasks › **Give a part to someone**. Chains can go up to 5 levels.
- A part is due no later than its task, and its effort comes out of the task's effort.
- The main task can't be completed until every part is done and accepted.

**Templates and duties**
- Templates and the Template Directory hold reusable tasks.
- Role "duties" become recurring tasks automatically for everyone with that role.

**Team performance**
- Rankings, and who most often asks to move due dates.
- Open a person, then "Open full profile" › **Excel report** for an 8-sheet person report (admins/Owner).

**Counters**: red count badges show what waits for you: My Tasks, To accept and Requests.

### Assets (sidebar group "Assets")
- **Who sees what**:
  - Staff and IT see Dashboard, Assets, Employees, New joiners, Exits, Requests, Tickets, Maintenance, Activity log, Scan and settings.
  - Employees see Home, **My assets**, **My requests**, **My tickets** and **My QR & profile**.
- **Assets list**:
  - **Add asset** opens a form. Afterwards you can add up to 6 photos (Take photo / Choose from gallery).
  - Select assets › **Print labels** prints QR + barcode stickers. Scanning a label opens the asset.
- **Assign / return**:
  - Open an asset › **Assign**. You can give it to an employee, a department, a vendor or "In store", with an optional expected return date, notes and handover photos.
  - Other actions: **Transfer**, and **Return** with condition, notes and return photos.
  - Every change is kept in the asset's history.
- **Scan**: use the camera, or type an employee ID, asset tag or serial. A person's ID card shows what they hold.
- **New joiners**: HR adds the joiner and the items they need, then taps "Send to IT". IT approves and assigns the items, then "Mark joined".
- **Exits**: starting an exit creates a checklist of everything the person holds. Each item is marked Returned, Damaged or Missing. **Complete exit** switches the person off everywhere.
- **Requests**: an employee taps **New request**. A manager approves, then IT uses **Fulfil** (assigns an asset).
- **Tickets**: **Raise ticket** for a problem, damage or loss.
- **Maintenance**: **Log maintenance**, then Start, then Complete.

### Visitors (sidebar group "Visitors"; optional module, off until an admin switches it on)
- **Gate** (guards and reception):
  - Check a visitor in with mobile, name, company, purpose, whom to meet, gate, photo, ID type + last 4 digits only, vehicle and items.
  - This gives a pass number and QR. Check out with one tap or by scanning the pass.
  - Optional host approval (Allow / Deny).
- **Visitor QR**: one company QR poster. Visitors scan it and fill in the form themselves, and the guard confirms.
- **My visitors** (any employee): **Invite visitor** sends a pass link in advance. Here you also see parcels waiting for you.
- **Vehicles**: in/out with plate photo. **Parcels**: receive, hand over or return.
- Also: **Contractors** (multi-day passes), **Material passes** (goods in/out, manager-approved), **Patrol** (QR checkpoints), **Incidents**.
- **Inside now**: roll call for evacuation.
- Admin screens: **Register**, **Reports**, **Guard activity**, **Watchlist** and **Settings**.
- Admin › Roles › **Add Guard role** makes a guard role (punch in/out + gate).

### Admin (sidebar group "Admin")
- **People & access**:
  - **Add person** asks for name, email, employee ID, mobile, access level, department, designation, reports to and joining date, with an optional login.
  - **Invite link** makes a link people join with their email.
  - **Import** adds people from an Excel or CSV template.
  - **Edit**, **Change roles**, and the ⋯ menu: Reset password / Create login, Start exit, Deactivate / Activate, Delete permanently.
- **Roles**:
  - The built-in roles are **Admin** and **Member**. The **Owner** (company creator) always has full access.
  - **New role** lets you tick permissions per app with a scope (Own / Team / Department / Company) and add duties.
  - Per person: Change roles › **Make Admin / Make Member**, or "Extra access and responsibilities".
- **Settings**:
  - **Company**: name, short name, **brand colour**, **logo** (PNG, JPEG or WebP, up to 512 KB).
  - **Modules**: switch modules on or off. Nothing is deleted.
  - **Departments**.
  - **Integrations**: the company's own WhatsApp, Gmail and AI keys.
- **Billing**: see section 3.

### Notifications and counters
- One **bell** for everything, with tabs All · Attendance · Tasks · Assets · Approvals · Company and **Mark all read**. Tapping a notification opens its item. Full list: /notifications.
- **Red count badges** show things waiting for you: Tasks (My Tasks, To accept, Requests), Attendance › Approvals, and Assets › Requests / Tickets / Exits. They also appear on sidebar groups and the phone bottom bar.

### Downloads
- Every list and report has a **Download** menu: Excel (.xlsx) or CSV, plus PDF or ZIP where offered (payslips, invoices).
- The file contains all rows matching your current filters, not just the visible page.
- In the phone app, files open the phone's share/save sheet.

### Phone app (Android)
- **Download** from kaampilot.com/download/kaampilot.apk, open the file and allow the install. Then sign in and allow location and camera.
- Same screens as the website, plus selfie camera and GPS for punching, file saving/sharing, printing, voice task drafts and punch-in reminders.
- **Personal punch-in reminder**:
  - Find it on Attendance › Today, or account menu › Punch-in reminder.
  - Set the time and weekdays, then choose Vibrate, Ring or Ring + vibrate. Tap **Save reminder**, or **Send a test reminder now** to try it.
  - It rings even when the app is closed and skips days you already punched in.
- **Updating**: older apps show a banner, "A new version of Kaampilot is available", with **Download the update**. If the update installs as a separate app, install it, then uninstall the old one.
- iPhone app: not available yet. Use the website in the browser.

## 5. How do I…
1. **Punch in**: Home › **Punch in** / **Punch out** (or Attendance › Today › **Check in** / **Check out**). Take the selfie if asked and allow location.
2. **"You are not at the office location"**: move to the office, or outdoors for better GPS. If you were on duty elsewhere, ask for a regularization.
3. **Fix a missed punch**: Attendance › My attendance › tap the day › **Regularize this day**. Pick a reason and times, then **Send request**.
4. **Approve a regularization or leave**: Attendance › **Approvals** › Leave or Regularization tab › **Approve** / **Reject**.
5. **Apply for leave**: Attendance › My leave › **Apply for leave** › type, dates, reason › **Submit request**.
6. **Mark leave for an employee**: Attendance › My leave (or Approvals › Leave) › **Mark leave**.
7. **Download the monthly attendance register**: Attendance › **Reports** › choose the type and period › **Download**.
8. **Set office location / geofence**: Attendance › HR settings › Office locations (geo-fence).
9. **Turn on the selfie or uniform check**: Attendance › HR settings › Photo at check-in / check-out, or Uniform at punch-in.
10. **Change regularization limits**: Attendance › HR settings › Regularization.
11. **Download my payslip**: Attendance › **My salary** › the payslip's **PDF** button.
12. **Run payroll**: Attendance › **Payroll** › set salaries › run the month › **Finalise** › download payslips.
13. **Add a task**: Tasks › Tasks › **Add task** › fill in the form › **Create task**.
14. **Make a repeating task**: Add task › Frequency: Daily / Weekly / Monthly.
15. **Accept finished work**: Tasks › Tasks › **To accept** › **Accept** or **Send back**.
16. **Change a task's due date**: open the task › **Request change** (admins: **Edit**).
17. **Give part of a task to someone**: open the task › Sub-tasks › **Give a part to someone**.
18. **Get a person's task report**: Tasks › Team performance › a name › Open full profile › **Excel report**.
19. **Add a person**: Admin › People & access › **Add person** › **Save**, then share the login shown.
20. **Invite people with a link**: Admin › People & access › **Invite link**.
21. **Import many people**: Admin › People & access › **Import** › download the template › **Check file** › **Import N people**.
22. **Give someone a role or make them admin**: Admin › People & access › **Change roles** › tick roles, or **Make Admin** › **Save roles**.
23. **Create a custom role**: Admin › Roles › **New role** › name, permissions and scopes › **Save role**.
24. **Reset someone's password**: Admin › People & access › ⋯ › **Reset password**.
25. **Remove an employee who left**: Admin › People & access › ⋯ › **Start exit** (or **Deactivate**).
26. **Change company logo or colour**: Admin › Settings › Company › Brand colour / Logo › **Save company**.
27. **Switch a module on or off** (e.g. Visitors, Payroll): Admin › Settings › Modules.
28. **Add an asset**: Assets › Assets › **Add asset**, then add photos.
29. **Assign an asset**: Assets › Assets › open the asset › **Assign** › pick the person › **Assign**.
30. **Take back an asset**: open the asset › **Return** › condition › **Confirm return**.
31. **Print asset QR labels**: Assets › Assets › select assets › **Print labels** › **Print**.
32. **Request an asset or report a problem**: Assets › My requests › **New request**, or My tickets › **Raise ticket**.
33. **Register a visitor**: Visitors › **Gate** › **Check in visitor** › details + photo › Check in.
34. **Invite a visitor in advance**: Visitors › My visitors › **Invite visitor**.
35. **Install the phone app**: open kaampilot.com/download/kaampilot.apk on the Android phone › install › sign in.
36. **Set a punch-in alarm on my phone**: in the app, Attendance › Today › Punch-in reminder › switch on › time and days › **Save reminder**.
37. **Reset my own password**: sign-in page › **Forgot your password?** › email › code › new password.
38. **Upgrade or pay**: Admin › Billing.
`;
