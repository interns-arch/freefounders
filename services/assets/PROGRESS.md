# Build progress

Tracks the build milestones so work can resume after any interruption.

- [x] 1. Project setup: npm workspaces, embedded PostgreSQL, NestJS API, auth + sessions, roles & permissions, append-only history
- [x] 2. Companies, departments, locations, vendors, employees
- [x] 3. Categories, asset types, custom fields + pre-loaded catalog (9 categories, 55 types)
- [x] 4. Assets: CRUD, lifecycle, assign/transfer/return, history, filters, search, bulk, QR labels and scanning
- [x] 5. Exit workflow: checklist, notifications, scan-to-return, blocking, override
- [x] 6. Requests, tickets, maintenance, dashboard, global search
- [x] 7. Web app (React): shell, pages, forms, keyboard shortcuts, responsive + dark mode
- [x] 8. Automated tests (22 passing at the time; 28 now), end-to-end browser check of the exit flow, production build, README

- [x] 9. One QR per person (QR = employee ID), unified Scan, phone-first person page, ID cards,
       view-only employee logins by employee ID, IT full access, "Mark checked" (2026-09-24)

- [x] 10. Person QR = link with the employee ID (opens from any phone camera); "Add new" in
       dropdowns (assets, companies, departments, locations, vendors); requests for anything
       not in the catalog; Cartrend Autoparts branding and demo data; friendlier employee home (2026-09-24)

- [x] 11. Priority queue (tickets + requests, Urgent first, overdue flagged); handover / return
       photos saved with each assignment, including request fulfilment (2026-09-25)

- [x] 12. SIM register in the billing-portal format; Employees "Phones & emails" view with
       company SIMs; dark-mode native controls (2026-09-25)

- [x] 13. Reconciliation of Airtel and Salary Box dumps with notifications; single-company
       setup (Companies page removed, company filled in automatically) (2026-09-25)

- [x] 14. Login ID, email and password chosen by IT; sign in with login ID, employee ID or
       email in any case (2026-09-25)

- [x] 15. Role + login when adding an employee; Leadership overview + Leadership role;
       onboarding for new joiners (plan, kits, prepare, hand over, mark joined) (2026-09-26)

- [x] 16. New joiners approved by IT in Requests + assign all; sidebar by designation; company and
       location fields removed for a single-branch company (2026-09-26)

- [x] 17. Joining kit and one-time (no return) items (2026-09-26)

## Possible next steps
- AI assistant on top of the permission-checked API (the design already allows it)
- Email notifications (SMTP) in addition to in-app notifications
- Warranty / licence / insurance expiry reminders as scheduled jobs
- CSV import and export of assets
- Single sign-on (Microsoft Entra ID / Google)
