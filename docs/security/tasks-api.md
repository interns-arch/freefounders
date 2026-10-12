# Security review: Tasks API (Django, `services/tasks/backend`)

Review and hardening pass of 2026-10-12. Scope: accounts, crm (tasks, leads), hr (attendance, leave, photos), payroll,
mistakes, webforms (including the public form endpoints), workspace (notices, links, ideas), notifications, intake
(AI inbox, WhatsApp webhook), tenancy. Platform sign-in is covered in a separate review, and so are Assets, web/mobile
and infrastructure (`docs/security/assets-web-mobile-infra.md`).

Every finding was checked by reading the code and then by a test, a request to the running suite, or both.

## What was checked

| Area | Result |
|---|---|
| **Sign-in: Platform token** (`accounts/platform_auth.py`) | Algorithm fixed to EdDSA. Audience `freefounders` is required; issuer, `exp`, `iat`, `sub` are required. The local user must belong to the token's `sub`, and an inactive user is refused. JWKS is cached and an unknown `kid` causes one refetch. OK. |
| **Sign-in: internal endpoints** (`/api/internal/*`) | Need a service token with audience `tasks-internal` and `sub=platform`. In multi-company mode they also need `cid`. An access token is refused there, and a service token is refused on the app API (test). OK. |
| **Sign-in: old app login** | In multi-company mode the middleware already refused a request without a Platform token. **Fixed:** an old SimpleJWT token is now also ignored on `/api/public/*` (`LegacyJWTAuthentication`). |
| **Sign-in: anonymous endpoints** | `/health`, public forms (unguessable token, 16 random bytes) and the WhatsApp webhook. **Fixed:** the webhook refused unsigned posts only when a secret was set; now it refuses them in production too. Throttling added on public forms. |
| **Admin (`/admin/`)** | Not routed by the gateway (dev or Caddy). In multi-company mode it needs a company token, so it cannot be reached. |
| **Who sees what** | All task and lead detail routes go through the scoped querysets (`visible_tasks`, `visible_leads`). Attendance, photos, payslips, salaries and advances are scoped by `managed_users` or `payroll.*`. Notifications are only your own. Exceptions found are in the table below. |
| **Multi-company isolation** | `search_path` is set before any query and reset in a `finally` block, including after a crash (new test). A new connection opens in the current company (`connection_created`). Background threads carry the company. The worker switches company per company with `use()`. Caches (roles, company settings, profile) are keyed by schema (new test). Uploads go under `c/<schema>/`. Schema names must match `co_[a-z0-9_]{1,50}` before any SQL. |
| **Injection** | No `.raw`, `.extra` or formatted `cursor.execute` outside `tenancy/schemas.py`, where names are validated. Links accept http/https only. No template rendering of user input. The only outbound URLs are fixed provider addresses; `AI_BASE_URL` can only be set by the operator's command. |
| **Mass assignment** | Ownership and audit fields are read-only, or set by the server, everywhere except the task fields fixed below. `platform_person_id`, `is_staff` and `is_superuser` cannot be written. |
| **Data leaks** | Per-company secrets are stored encrypted (Fernet, `SETTINGS_KEY`) and no endpoint returns them. Password hashes are never serialized. With DEBUG off, DRF and Django return no stack traces. |
| **Abuse** | Imports have byte and row limits (now also bounded while reading). Report ranges are capped at 366 days. Punch photos are capped at 400 KB. |
| **Scale** | Default pagination is 25, maximum 300. Indexes exist for tasks (assignee+status, due), attendance (user+date, date), leave (user+status) and notifications (user+read). **Fixed:** the task list was N+1. |

## Findings and fixes

Severity: **High** = data of other people or companies is reachable, or the user's session can be taken over.
**Medium** = integrity or abuse within a company. **Low** = hardening.

| # | Sev | Issue | Where | Fixed | Regression test (`accounts/tests_security.py` unless noted) |
|---|---|---|---|---|---|
| 1 | High | **Uploaded files were public by URL.** `/media/<path>` was served with no login, through the gateway, for every company. Paths are guessable (`task_files/<task id>/<name>`, `leave_docs/<name>`, `c/co_<code>/…`). Confirmed against the running suite: an unauthenticated GET of a task attachment returned 200. Affected: task attachments and proof, lead documents, leave documents (medical certificates), form uploads, notice attachments. | `config/urls.py` | Yes. Files are served only through signed, expiring links (`config/media.py`, `MEDIA_LINK_SECONDS`, default 1 h, the same as S3 presigned links). The API returns `/media/<path>?s=<signature>` only alongside a record the caller may already see. Any other request gets 404. | `MediaLinkTests` (6 tests); `tenancy/tests_security.py::test_uploads_live_under_the_company_and_need_a_signed_link` |
| 2 | High | **Stored XSS through uploads.** Any file type was stored and served inline on the app's own origin. An `.html` or `.svg` attached to a task, lead, leave or form, once opened by a colleague, could call `/api/platform/auth/refresh` and then any API as that colleague. | `config/urls.py`, `config/images.py` | Yes. Only images and PDF are shown inline. Everything else is sent as `Content-Disposition: attachment` with `Content-Security-Policy: default-src 'none'; sandbox`. Every file gets `nosniff` and `Referrer-Policy: no-referrer`. Checked live: an uploaded `probe.html` came back as an attachment with the sandbox CSP. | `test_html_and_svg_uploads_never_render_as_a_page_of_the_app` |
| 3 | Med | **Any member could rewrite a mistake record.** By PATCH they could lower the severity, zero the loss, or move a mistake onto another person (`employee`), which skipped `mistakes.log`. | `mistakes/views.py` | Yes. Editing now needs a reviewer, `employee` cannot change, and the category must come from the list. | `test_the_employee_cannot_rewrite_or_move_a_logged_mistake`, `test_a_reviewer_still_cannot_move_it_to_someone_else` |
| 4 | Med | **Mistake suggestions leaked other employees' mistakes** (names and descriptions in `similar`) to the employee, and ran paid AI calls for anyone. | `mistakes/views.py` | Yes, now reviewers only (and throttled, #16). | `test_suggestions_naming_other_people_are_for_reviewers_only` |
| 5 | Med | **Company-wide reviewers could review their own mistakes.** | `mistakes/views.py` `can_review` | Yes. | `test_nobody_reviews_their_own_mistake_whatever_their_reach` |
| 6 | Med | **A linked task or lead on a mistake was not scope-checked**, which leaked task codes. | `mistakes/views.py` | Yes. | `test_a_linked_task_must_be_visible` |
| 7 | Med | **Leave could be stretched after applying.** A PATCH of `end_date` kept `days` (so the balance stayed untouched while attendance and payroll paid for every day). Approvers could also edit someone else's pending leave through `?scope=team`. | `hr/views.py` | Yes. Only the owner can edit, only while pending, and days and overlap are recomputed. | `test_stretching_a_pending_leave_recounts_its_days`, `test_an_approver_cannot_edit_someone_elses_leave` |
| 8 | Med | **Attendance corrections could be rewritten after review**, or by the approver, and could be made for future days. | `hr/views.py`, `hr/serializers.py` | Yes. Only your own pending corrections can be edited, and the date cannot be in the future. | `test_a_reviewed_correction_cannot_be_rewritten`, `test_a_correction_cannot_be_for_a_future_day` |
| 9 | Med | **A task could be created already "done"** (`status` was writable). That skips proof and review and counts as on-time work in the assignee's score. | `crm/task_views.py` | Yes. A new task always starts open. | `test_a_task_cannot_be_created_already_done` |
| 10 | Med | **Restore from the bin used a raw id.** A team- or department-scoped person with the `tasks.bin` permission could restore, and read, any deleted task in the company. | `crm/task_views.py` `restore` | Yes. Restore now uses the same scope as the bin list. | `test_restore_only_reaches_tasks_in_the_callers_scope` |
| 11 | Med | **Change requests were not validated before saving.** A naive deadline was stored and later made every inbox list return 500. A non-integer person id or a free-text priority crashed the approval. The request was marked approved before the change was applied, with no transaction. | `crm/serializers.py`, `crm/task_views.py` | Yes. Values are validated and stored with their time zone. Approve and apply happen in one transaction. | `test_change_request_with_a_naive_deadline_keeps_the_inbox_working`, `test_change_request_values_are_checked_before_saving` |
| 12 | Med | **CSV/XLSX formula injection.** Leave reasons, notes, form answers and names that start with `=`, `+`, `-` or `@` became live formulas in the attendance reports, the payroll CSV and the form-submission CSV. | `hr/team.py`, `payroll/views.py`, `webforms/views.py` | Yes. These cells are written as text with a leading `'` (`config/exports.py`). | `FormulaInjectionTests` (3) |
| 13 | Med | **Public form submit had no rate limit.** A script could flood a company with leads, tasks and 10 MB uploads. | `webforms/views.py` | Yes. Per client address: viewing 120/min, submitting 20/min (`THROTTLE_PUBLIC_*`). | `test_public_submit_is_rate_limited_per_client` |
| 14 | Med | **WhatsApp webhook accepted unsigned posts** whenever `WHATSAPP_APP_SECRET` was unset, so anyone could forge messages, leads and delivery states. | `intake/webhook.py` | Yes. Unsigned posts are refused unless DEBUG is on. The comparison is constant-time on bytes (a non-ASCII header used to give a 500). | `WhatsAppWebhookTests` |
| 15 | Med | **HR (`users.manage`) could switch a deactivated Admin or Super Admin back on**, and the role guard only looked at the legacy `User.role`, not the Platform roles. A non-admin with `users.manage` could therefore reset the password of someone whose Platform role is admin-level. | `accounts/views.py` | Yes. Activate uses the same guard as deactivate, and the guard also checks the effective level and permissions. | `UserAdminTests` (2) |
| 16 | Low | **Paid AI calls had no limit** (draft, proofread, voice, summary, mistake suggestions). | `crm/task_views.py`, `mistakes/views.py` | Yes. 30/min per person per company (`THROTTLE_AI`). | `test_paid_ai_calls_are_rate_limited_per_person` |
| 17 | Low | **Image bombs:** a few-KB PNG claiming a 64 MP+ canvas was decoded in full (Pillow warns only above 89 MP; the limit here was 120 MP). There was no size limit for leave documents or notice attachments. | `config/images.py`, `hr/serializers.py`, `workspace/serializers.py` | Yes. Non-JPEG images over 40 MP are not decoded. A punch photo that cannot be read is refused. Leave and notice files are limited to 10 MB. | `test_a_huge_png_canvas_is_never_decoded`, `test_leave_documents_have_a_size_limit` |
| 18 | Low | **The attendance import read the whole sheet before checking the row limit** (a 2 MB XLSX can unpack to millions of rows). | `hr/team.py` | Yes. At most 2×limit lines and 64 columns are read. | `test_attendance_import_reads_a_bounded_number_of_rows` |
| 19 | Low | **A finalised payroll run could still be PATCHed** (year and month). | `payroll/views.py` | Yes. | `test_a_finalised_run_cannot_be_edited` |
| 20 | Low | **Any signed-in user could create leads**, including roles with no lead permission (which triggers auto-assignment and notifications). | `crm/views.py` | Yes. Creating a lead needs `leads.view` or `leads.edit`. | `test_a_role_without_leads_cannot_create_leads` |
| 21 | Low | **The built-in development `SECRET_KEY` could run in production.** It signs app tokens and file links, so anyone knowing it could forge both. | `config/settings.py` | Yes. The server refuses to start with DEBUG off and the placeholder key. | (start-up check) |
| 22 | Low | **Unknown form ids returned 500.** | `webforms/views.py` | Yes, now 404. | `test_unknown_form_ids_are_404_not_500` |
| 23 | Scale | **Task list N+1.** About 5 queries per row (subscribed, pending changes, can-delete, group, parent), so up to about 1,500 queries for a 300-row page. | `crm/task_views.py`, `crm/serializers.py`, `accounts/access.py` | Yes. One prefetch per page; the query count no longer grows with the page. | `test_task_list_queries_do_not_grow_with_the_page` |
| 24 | Scale | **The worker never dropped a broken or expired DB connection**, so one lost connection failed every later pass. | `tenancy/management/commands/run_worker.py` | Yes, it now runs `close_if_unusable_or_obsolete` each pass. | existing worker tests |

Multi-company regressions added in `tenancy/tests_security.py` (Postgres):
`test_search_path_is_reset_even_when_the_view_crashes`, `test_a_request_after_another_companys_request_sees_only_its_own_data`,
`test_uploads_live_under_the_company_and_need_a_signed_link`, `test_role_cache_is_per_company`,
`test_legacy_app_tokens_are_ignored_even_on_public_paths`, `test_access_and_service_tokens_are_not_interchangeable`.

## Remaining risks (not changed; need a decision or infrastructure)

| Sev | Risk | Recommendation |
|---|---|---|
| Med | **"Give tasks to others" (`tasks.assign`) is not enforced on task create or reassign** (`can_assign_to` = any active user, by an earlier "no hierarchy" decision). The role-builder switch therefore does nothing for tasks. `in_loop` also adds any user as a subscriber. | Founder: should a role without it only create tasks for themselves? If yes, it is a two-line check in `perform_create` and `perform_update`. |
| Med | **People can act on themselves**: HR with `hr.mark` or `hr.import` can set their own attendance, and `payroll.salaries` can set their own salary and advances. | Founder: refuse self-edits (except the Owner), or log them for the Owner. |
| Med | **Partial advance recovery is lost** (`payroll/services.py` `finalise_run`). When an advance is bigger than that month's deduction, nothing is recorded, so it is deducted again next month. This is a money bug rather than a security one. | Track a recovered amount per advance. Needs a migration. |
| Med | **Throttles use the per-process memory cache.** With several gunicorn workers each has its own counters. In multi-company mode a Django `DatabaseCache` would not work (the search path holds only the company schema). | Add a shared cache (Redis, or a cache table addressed as `public.…`) when running more than one process. Behind the gateway set `NUM_PROXIES=1` so the visitor's address is used (otherwise the visitor can choose their own throttle key through `X-Forwarded-For`). Edge rate limits are drafted in the Caddyfile. |
| Med | **`DEBUG` defaults to true** when the env var is missing (inherited from the original app). | Production `.env` must set `DEBUG=false`. Flipping the default would change the standalone app's behaviour, so the founder decides. |
| Low | **Connection pooling:** `SET search_path` is session state. It is safe with Django's own persistent connections (set and reset per request), but **not** behind PgBouncer in transaction mode. | Use session pooling, or no pooler, for Tasks. |
| Low | **Signed file links are bearer links** for up to `MEDIA_LINK_SECONDS` (1 h). Anyone the link is forwarded to can open it within that hour. | Fine for now (same as S3). A shorter TTL, or fetch-with-token downloads, would tighten it. |
| Low | **Revoking a role takes up to 30 s in other worker processes** (role cache TTL), plus up to 15 min for an already-issued access token. | Acceptable; document. |
| Low | **"Own" scope is uneven:** `_report_users` and `home` include direct reports for strictly-own roles. `workload` answers for any user. Department-scoped mistake reviewers see every department's score. Category counts are company-wide. | Tidy up together with the `tasks.assign` decision. |
| Low | **Team directory shows department colleagues' email and mobile to every member.** | Founder: is that wanted? |
| Low | Admin task PATCH does not re-check `lead` or `parent` visibility, as create does. Some bad query parameters (`?user=abc`, `?from=x`) return 500. | Small follow-ups. |
| Low | Other N+1s: the users list (capabilities per user), SOP list, payroll-run payslip counts, ideas and links (vote and favourite per row). These are company-sized lists. | Optimise when lists grow. |
| Low | Some older tests write uploads into `backend/media/task_files/` (no temporary `MEDIA_ROOT`). | Test hygiene; the new tests use a temporary folder. |
| Low | Password change in the old app login does not end its other sessions. Leave quota is not enforced. | Old login only (Platform sign-in is used in FreeFounders mode). Quota: product decision. |

## New settings (all optional)

| Env | Default | Meaning |
|---|---|---|
| `MEDIA_LINK_SECONDS` | `AWS_LINK_EXPIRY_SECONDS` or 3600 | How long a file link works |
| `THROTTLE_PUBLIC_FORM` / `THROTTLE_PUBLIC_SUBMIT` | `120/min` / `20/min` | Public form view and submit, per client address |
| `THROTTLE_AI` | `30/min` | Paid AI calls, per person |
| `NUM_PROXIES` | unset | Set to `1` behind the gateway (Caddy adds `X-Forwarded-For`) |

`SECRET_KEY` must be set whenever `DEBUG=false` (the server now refuses to start otherwise).

## Tests

- Tasks suite (SQLite): **855 tests pass, 22 skipped** (Postgres-only). That is 813 before, plus 36 new in `accounts/tests_security.py` and 6 new in `tenancy/tests_security.py` (which skip on SQLite).
- Multi-company (Postgres, `manage.py test tenancy`): **34 tests pass** (28 before, plus 6 new).
- Browser tests against the running suite: `web-hr`, `web-tasks`, `web-mistakes-forms`, `web-leads`, `web-attendance-team`. **All 17 pass.** The Live-team test needed a rerun: the first time, the page was still loading a lazy chunk.
