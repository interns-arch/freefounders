# Security review: Platform service and sign-in (2026-10-12)

Scope: `services/platform` (companies, people, roles, single login, cross-app flows), `packages/core/src/{session,http,auth,access}.ts`,
`apps/web/src/app/{session-guard,pages/login}.tsx`. Tasks/Django + tenancy and Assets + web/mobile + gateway were reviewed
separately (reviewers B and C). Design references: PLAN.md §13 (single login), §14 (one schema per company), §15/§19.19 (roles,
Admin permissions), §19.12 (people delete).

## 1. Threat model (short)

| Asset | Who might attack it | How |
|---|---|---|
| Sign-in (passwords, refresh tokens) | Internet attacker; ex-employee; someone on the same network | password guessing / spraying, stolen cookie or phone, replay of an old refresh token, CSRF on cookie endpoints |
| Access tokens (15 min, EdDSA) | Anyone who gets one (XSS in an app, logs, a shared device) | reuse after sign-out, forging (`alg` tricks), using a service token as a user token |
| People, roles, company settings | A signed-in member; an admin of another company | missing permission checks, IDOR with another company's ids, mass assignment (`companyId`, `status`), privilege escalation through roles / app roles |
| Data in other companies | Tenant admin | cross-company reads/writes, enumeration through global unique fields |
| Signing keys | Anyone with a DB dump | private keys are AES-256-GCM encrypted with `PLATFORM_SECRET` |
| Availability / scale | Load; several Platform processes | unbounded tables, in-process state that must be shared, double-handled events |

Trust boundaries: browser ⇄ gateway (one origin, path-routed) ⇄ Platform; Platform ⇄ apps' `/internal/*` (service tokens, 60 s,
audience `<app>-internal`, `cid`); apps verify user tokens with the published JWKS.

## 2. What was checked and found sound (no change)

- **Tokens**: Ed25519 (`EdDSA`) only, `iss`/`aud` checked, `kid` in every token, JWKS publishes public parts only (newest 3, so a
  rotation keeps old tokens valid until they expire), access tokens 15 min, claims `sub`/`cid`/`apps`/`role`/`fam`/`jti` (≈600 bytes).
  Service tokens (`aud=<app>-internal`, 60 s) are refused as user tokens. Private keys sealed with AES-256-GCM (key = sha256 of
  `PLATFORM_SECRET`, ≥32 chars, required in production).
- **Refresh**: 32 random bytes, only sha256 stored, rotated on every use (atomic claim), 60 s grace for two tabs, reuse after the
  grace revokes the whole family. Cookie `ff_refresh`: HttpOnly, SameSite=Lax, Secure in production, Path `/api/platform/auth`,
  host-only (no Domain). Mobile gets it in the body. Logout revokes the family; password change keeps only the current session;
  reset, deactivate, remove login, revoke app and delete revoke all.
- **Passwords**: argon2id (`@node-rs/argon2` defaults: 19 MiB, t=2, p=1 = OWASP minimum); imported Django PBKDF2 accepted once and
  re-hashed; never stored readable. Unknown and wrong logins get the same message and similar time (dummy hash; measured live
  57 ms vs 67 ms).
- **CSRF / CORS**: every POST/PUT/PATCH/DELETE needs `X-Requested-With: XMLHttpRequest`; no CORS is enabled (a cross-site preflight
  gets 404 without `Access-Control-Allow-*`); the only cookie-authenticated routes are `/auth/refresh` and `/auth/logout` (POST).
- **Authorization**: every Admin route has `@Needs(...)`, re-read from the database on every call; the members-act-on-members rule
  holds for create/edit/reset/remove login/exit/delete/grant/revoke; owners cannot be deleted; only owners give Super Admin.
- **Company isolation**: every Platform query on people, roles, role grants, departments, logins and app links is filtered by the
  caller's company or reached through a row that was (verified by a new test over 12 routes and 4 body references).
- **Mass assignment**: zod schemas strip unknown keys; `companyId`, `status` (on create), `id` in a body are ignored (new test).
- **Data in answers**: no password hash, refresh token or other company's data in any answer; `/auth/me` returns the person's own
  name/email/employee ID/role, company branding, apps and Admin permissions only. 500 errors answer a generic message.
- **Headers**: helmet (HSTS, `nosniff`, `X-Frame-Options`, CSP, no `X-Powered-By`), JSON body limit 1 MB (logo upload), logo served
  with `nosniff` and `default-src 'none'`, logo type checked by magic bytes (PNG/JPEG/WebP; no SVG).

## 3. Fixed in this review

Tests are in `services/platform/src/integration.test.ts`, describe **"security hardening (docs/security/platform.md)"** unless noted.

| # | Severity | Issue (where) | Fix | Regression test |
|---|---|---|---|---|
| 1 | High | **Lockout bypass by parallel requests** (`auth.service.ts` `login`): the failure counter was read, the password checked, then `failed+1` written, so N parallel guesses were all checked. Verified live: 20 parallel wrong passwords → 20 checked. | One attempt is claimed atomically (`UPDATE … failed_logins+1 WHERE not locked … RETURNING`) before the password is checked; a lock that has run out starts over. Live after the fix: 5 checked, 15 refused. | "LOGIN_MAX_FAILED=3: parallel wrong passwords cannot get past the lockout …" (the lockout is **off by default since 2026-10-19**, see §8) |
| 2 | High | **Privilege escalation through app roles** (`people.service.ts` `grantApp`): a member with only *Manage people* could send `{appRole: "super_admin"}` when giving someone (themselves included) Tasks/Assets; both apps create the user with that role. | Choosing an app role needs *Manage roles* (owners/admins have it); without one the app's default applies. | "a member with Manage people cannot choose an app role; …" |
| 3 | Medium | **Members with *Manage roles* could change an owner's or admin's roles** (`roles.service.ts` `setPersonRoles`), against §19.19 "members act on members only" (e.g. strip an admin's roles → their apps close and they are signed out). | Same rule as People & access: 403 for a non-member target. | "… a member with Manage roles cannot change an admin" |
| 4 | Medium | **No per-IP limit (password spraying)**, and the lockout message told which names exist (only real accounts ever said "Too many failed attempts"). | `auth/throttle.ts`: per-IP bot guard (`LOGIN_IP_LIMIT`, now default **1000** failed sign-ins per IP per 15 min, 0 = off) → 429 "Too many sign-in attempts from this network. Wait a few minutes."; when the lockout is on (`LOGIN_MAX_FAILED` > 0) a name that matches nobody answers "Too many failed attempts" after that many tries, like a real account. Since 2026-10-19 the lockout is off by default (§8). | "too many failed sign-ins from one address are refused …"; "LOGIN_MAX_FAILED=3: a name that matches nobody answers exactly like a real account …"; "by default a name that matches nobody never answers "too many" …" |
| 5 | Medium | **Change password usable to guess the current password** with a stolen access token (no limit). | 5 wrong current passwords per person per 15 min, then 429. | "change password: a stolen access token cannot be used to guess the current password" |
| 6 | Medium | **Ended sessions kept working on the Platform for up to 15 min**: after sign-out, password change/reset, deactivation or delete, the access token still opened `/auth/me`, change-password and (for a re-activated role) Admin routes; person/company status was only checked on Admin routes. | `auth.guard.ts`: every signed-in route checks in one indexed query that the person and company are active and the token's session family (`fam`) is live. (Tasks/Assets still accept the token until it expires — see R6.) | "sign out, "sign out everywhere" and a password reset end Platform access at once …"; updated "deactivating a person ends their sessions and blocks sign-in" (now 401) |
| 7 | Medium | **No "sign out everywhere"**. | `POST /api/platform/auth/logout-all` ends every session of the caller (API only; a button is a founder decision, R8). | same test as #6 |
| 8 | Medium (scale) | **`refresh_sessions` grew forever** (one row per refresh, ≈30/day per active person). | Hourly clean-up (`AuthService.pruneSessions`, batches of 5 000): expired rows, and rotated/revoked rows older than 30 days. Reuse of a copied token older than 30 days is still refused, it just no longer also ends the session. | "old refresh rows are cleaned up; live sessions stay" |
| 9 | Medium (scale) | **Events poller assumed one process** (in-memory flag): two Platform processes would both act on each event (duplicate tasks, double resolves). | Postgres advisory lock (`pg_try_advisory_lock`) around each pass. | "the events poller works in one Platform process at a time" |
| 10 | Low/Medium (scale) | **JWKS cached forever per process**: a key made by another process (rotation, or two first starts) was never picked up, so its tokens were refused. | Keys re-read every 5 min and at once (≤ every 10 s) on an unknown `kid`; verifier cached; verification also pins `typ: JWT` and a maximum token age. | "tokens: EdDSA only, user audience only; a key made by another Platform process is accepted" (also `alg: none`, HS256 and service tokens refused) |
| 11 | Low | API answers (tokens, people) had no `Cache-Control`. | `Cache-Control: no-store` on every Platform answer (the public logo keeps its own). | "answers are never cached" |
| 12 | Low | A failed query's log line contained its values (`params: …`: password hashes, token hashes, emails). | `redact()` in `common/exception.filter.ts` hides `params:` in logged errors. | "logs never carry query values (password hashes, token hashes)" |
| 13 | Low | `node dist/seed.js` (no `--bootstrap`) on a real install would create the demo owner with the public password `Demo@1234`. | Refused when `NODE_ENV=production`. | "the demo company (public password) is never seeded in production" |
| 14 | Low | Cross-app flows put ids from another app's event into internal URLs unchecked (`/tickets/${id}/…` with the service token). | Ids must match `[A-Za-z0-9_-]{1,64}` (`pathId`), else the event is skipped. | "ids from another app never reach a URL unchecked" |
| 15 | Low | Web `?next=` accepted `/\evil.com` (browsers read it as `//evil.com`). | `safeNext` refuses backslashes and control characters (`apps/web/src/app/session-guard.tsx`). | web typecheck + rules; e2e `single-login` "opening an app while signed out … back to that app" |
| 16 | Info | Without `PLATFORM_SECRET` (outside production) keys are sealed with the public dev secret, silently. | Warning logged at start (`keys.service.ts`). | — |

Also: `LOGIN_IP_LIMIT` and `LOGIN_MAX_FAILED` documented in `services/platform/.env.example`.

Behaviour notes: an ended session now gets **401** on the Platform at once (was: 403 on Admin routes, 200 elsewhere until expiry);
the web app treats it as "signed out". Taking away your own last role in an app (which already ended your sessions) now signs you
out of the Platform immediately rather than at the next refresh.

## 4. Remaining risks and recommendations

| # | Severity | Risk | Recommendation (needs the founder or infrastructure) |
|---|---|---|---|
| R1 | ~~Medium~~ **Fixed 2026-10-13** | ~~Manage roles = admin in practice~~. | See §6. |
| R2 | Medium → **Changed 2026-10-19** | ~~Lockout as denial of service~~: there is no lockout any more (founder, §8), so nobody can lock someone out; the trade-off is that online guessing of one account is limited only by the per-network bot guard (1000 / 15 min) and argon2id cost. | 2FA/OTP for owners and admins, or a back-off/CAPTCHA after several failures, if guessing is ever seen in the logs. `LOGIN_MAX_FAILED=5` restores the old lock. |
| R3 | Medium → **Changed 2026-10-13** | **Password policy** is "at least 6 characters" (founder's choice, kept); weak passwords are now **warned about, never refused** (founder). | See §6. Refusing them stays possible later (the checker exists). |
| R4 | Medium | **No second factor** for anyone. | OTP (WhatsApp/SMS/TOTP) for owners/admins first. |
| R5 | Low/Medium | **Global sign-in names**: email, username and employee-ID checks are product-wide, so an admin of one company can learn that an email/username exists in another (409 "Another person already uses this email"). | Accept (sign-in without a company code needs it), or answer a neutral "cannot use this email" message; long-term, company-scoped sign-in. |
| R6 | Low/Medium | **Tasks and Assets accept an access token until it expires** (≤ 15 min after sign-out/deactivation; stateless by design, §13.4). | Accept, or shorten to 5 min, or have the apps check a small revoked-`fam` list. |
| R7 | ~~Low~~ **Removed 2026-10-13** | ~~"Must change password" is enforced by the web app only~~: the founder dropped the forced change. | See §6. |
| R8 | Low | **Stay signed in 1 year (sliding, no absolute limit)** — founder decision, kept. Revocable via reset, deactivate, logout-all. | Add "Sign out everywhere" and "Where you're signed in" (ip, device, client are stored) to the account screen. |
| R9 | Low (scale) | **Throttle counters live in each process** (#4, #5); with N processes the IP/name limits become N×. The account lockout itself is in the database and exact. | Fine for one process. For several: a Postgres `UNLOGGED` table `auth_throttle(key, window_start, count)` with an upsert per failure (no Redis), or rate limiting at the gateway/WAF. |
| R10 | Low | **Key rotation has no command** (`KeysService.rotate()` exists) and changing `PLATFORM_SECRET` makes keys unreadable. | Add `npm run company -- rotate-key`; rotate yearly or on suspicion; document re-sealing keys under a new secret. |
| R11 | Low | `PLATFORM_SECRET` is only enforced when `NODE_ENV=production`. | Deployment checklist: `NODE_ENV=production`, `PLATFORM_SECRET` from a secret store, `TRUST_PROXY=true` only behind the gateway (otherwise `X-Forwarded-For` can be forged to dodge the IP limit; and without it behind a proxy everyone shares one IP and the limit becomes global). |
| R12 | Low | Edge protection (WAF, global rate limits, bot filtering) is not in the repo. | At the load balancer / Caddy when production exists. |
| R13 | Info (scale) | People list stops at 500 rows; `refresh_sessions` clean-up scans the table hourly (fine below a few million rows). | Paginate the People list; add an index on `expires_at` if the table gets very large. |
| R14 | Info | Admins viewing saved passwords: still refused (hashed only, project rule). | Keep. |

## 5. Test results (2026-10-12)

- Platform: `npm run typecheck && npm test` → **77 / 77** (63 earlier tests, 2 of them updated for #6; 14 new).
- Web: `npm run typecheck --workspace @freefounders/web` (incl. web rules) → clean.
- E2E against the running suite: `single-login.spec.ts` + `web-admin.spec.ts` → 14 / 15 on the last run; the one failure is a new
  Assets-cookie assertion added in `single-login.spec.ts` by the Assets/web reviewer (not Platform code). `npm run smoke` → 10 / 10.
- Live checks against http://localhost:8080 with a throwaway person: parallel lockout (5 checked / 15 refused), sign-out and
  sign-out-everywhere end Platform access at once, unknown names answer "Too many failed attempts" on the 6th try, `no-store` header.

## 6. Founder decisions applied (2026-10-13): R1, R3, R7

**R1: Manage roles gives only what you have.** Everyone except the **owner** (company owner, `platformRole = owner`; platform
admins included) is limited, in `RolesService` (`powersOf` / `assertCanBuild` / `assertCanTouch` / `assertCanGive`), with a 403
that names what is not allowed:
- create / edit a role: only permissions they hold (per app, Tasks/Assets/Admin keys of catalogue v2), at no wider scope than
  their own widest; never an Owner-only (`superAdminOnly`) permission; never level 3 (Admin); never above their own level (the
  highest level of their roles, at least 1). Admins hold every Admin permission (access level), and Tasks/Assets ones only
  through roles;
- edit or archive: the role as it is must also be within their powers (no taking a bigger role apart), and not Admin-level;
- duplicate: never Super Admin; the copy goes through the create rule (an Admin-level copy is refused);
- give roles (`PUT /people/:id/roles`, themselves included): each role added must be within their permissions and at most their
  level (removing roles is not limited; Super Admin stays owner-only; members still act on members only, §19.21);
- choosing an app role (`PUT /people/:id/apps/:app` with `appRole`): the same rule through the role builder's copy of that app
  role (`tasks` code / `assets:<name>`); one the role builder does not know: owner only.
`GET /auth/me` now returns `held: { level, grants }`; the web role editor (`roleLimits` in `@freefounders/core/admin`) shows what
they cannot give disabled with "You don't have this yourself" (or "Only the owner can give this"), disables wider scopes and
higher levels, filters "Copy from", opens roles beyond them read-only ("View"), and disables their Duplicate/Archive; the roles
dialog on People disables roles they cannot give. Tests: Platform `Manage roles gives only what you have: permissions, scopes,
level; never Admin-level or Super Admin (R1)` (+ `granting Tasks provisions…` now checks the unknown app role is owner-only);
e2e `web-admin.spec.ts` `Manage roles without being the owner: only what you have yourself can be ticked… (R1)`.
Since PLAN.md §19.28 (2026-10-19): there is no Super Admin role; the owner's powers come from the hidden Owner role
(`kind = owner`, never listed or given) and the owner mark. Admin and Member are built in (not archivable, name and level
fixed; Admin is Admin-level, so only the owner edits it, and only owners/admins can give it). Admins' Admin permissions
come from their roles (the Admin role: all but `billing.manage`). Per-person extra access (`PUT /people/:id/access/personal`)
follows the same rule: only what the caller holds, members on members only, owners only by owners, never for oneself
unless owner. Tests: Platform `extra access and responsibilities for one person…`, `Make Admin / Make Member…`, the R1 test.

**R3: weak passwords are warned about, never blocked.** Minimum stays 6 (server unchanged). `passwordWeakness` /
`weakPasswordWarning` (`packages/core/src/admin/password-strength.ts`, pure, ~4 KB: ~400 common passwords and the words they are
made of, with digits/years/symbols stripped and look-alike letters undone; only digits, repeated characters, sequences, keyboard
walks and two such parts joined; the person's name, username, email local part or the company name, case-insensitive). Shown
under every set-password field (reset password / create login, add person with a login, change own password) as "Weak password:
easy to guess (…). You can still save it." Tests: `npm test --workspace @freefounders/core` (5 tests); Platform `at least 6
characters; weak ones are accepted; never a forced change (R3, R7)`; e2e `web-admin.spec.ts` reset-password test checks the
three warnings and that Save stays enabled.

**R7: no forced password change.** Nothing sets `logins.must_change_password` any more (add person, create/reset login with a
generated or chosen password, `company create`); an old client's `mustChangePassword: true` is ignored; migration
`0007_no_forced_password_change` clears it for existing logins (column kept). The web app no longer sends anyone to the change
screen; "Change password" stays in the account menu; the "Ask them to change it" box and "they will choose their own password"
copy are gone. Tests: Platform `admin adds a person with a login; nobody is forced to change the generated password (R7)`,
`resetting a password signs the person out everywhere`; smoke step "member signs in with the generated password (no forced
change), reaches Tasks but not Assets".

Results (2026-10-13): Platform `npm run typecheck && npm test` → **78 / 78**; core tests 5 / 5; `npm run web:build` clean;
`npm run smoke` → 10 / 10; e2e `web-admin.spec.ts` + `single-login.spec.ts` → 16 / 16.

## 7. Sign-up, accounts, invites and billing (PLAN.md §21, 2026-10-14)

New Platform endpoints (all under `/api/platform`) and how each is protected. Tests: `services/platform/src/signup-billing.test.ts`.

| Endpoint | Who | Protection |
|---|---|---|
| `POST signup/start`, `POST auth/forgot` | public | identifier validated (email, or Indian mobile → `+91…`); 6-digit code, only `sha256(otpId:code)` stored, 10 min; per identifier ≤ 5 codes / 15 min and ≥ 30 s apart, per IP ≤ `OTP_IP_LIMIT` (20) / 15 min, all in Postgres (exact across processes). `forgot` answers the same shape for unknown identifiers (no enumeration). `devCode` only with `OTP_DEV_ECHO=1` and never when `NODE_ENV=production`. Delivery: `OTP_SENDER=fake` (Platform log) or `msg91` (MSG91 SendOTP / Email API with our code; authkey only in the server's `.env`, sent only as the `authkey` header over https; logs carry MSG91's request id and a masked number, never the code, the authkey or the request URL; a send MSG91 refuses or cannot take is marked `failed_at`, never usable, not counted per identifier but still per IP). Production with `DEMO_MODE=0` never returns the code. |
| `POST auth/login/code/start`, `POST auth/login/code/verify` (sign in with a code, PLAN.md §21.8) | public | start = the same code rules as above, purpose `login`, the same answer for unknown identifiers (a real code is sent, like forgot), usernames / employee IDs refused (no email / mobile to send to). verify = the per-IP sign-in guard first (`LOGIN_IP_LIMIT`), one try claimed atomically, a wrong code counts per IP like a wrong password; only after the code proved the email / mobile does the answer say "no account" or "admin-made login, use your password". Same result as a password sign-in (tokens or choose-company ticket; suspended companies owners only). A code proves possession of the inbox / SIM, so whoever holds the person's phone or mailbox can sign in: the same trust forgot password already gives. |
| `POST signup/verify`, `POST auth/reset` | public | one try claimed atomically before comparing (≤ 5 per code, parallel guesses included), constant-time compare, used once. `verify` gives a 32-byte sign-up token (sha256 stored, 30 min, used once). An email that already signs in with an admin-made login cannot become an account (409, only after the code proved the email): no take-over of a company login. `reset` ends every session of the account. |
| `POST signup/complete`, `POST companies` | public with sign-up token / signed-in account | an existing account must give its password (same rules as sign-in, checked outside the transaction so failures count); new passwords ≥ 8 characters, argon2id only; ≤ 5 new companies per account per day; company code generated (`CODE_RE`); provisioning = `company -- create` steps (`CompanySetupService`). |
| `POST auth/login` (account), `{ticket, companyId}` | public | same rules as admin-made logins: no lockout by default (§8), per-IP bot guard, same messages; with `LOGIN_MAX_FAILED` > 0 the old lock (that many tries / 15 min, atomic claim). Several companies: a 32-byte choose-company ticket (sha256 stored, 5 min, used once, bound to the account). Suspended companies: owners only. |
| `GET auth/username-available?u=` | public (+ optional Bearer: the caller's own name counts as free) | **Reveals whether a username exists** (accepted for usernames, PLAN.md §21.5; emails and mobiles are never revealed this way). Limited to 60 checks per minute per IP (`USERNAME_CHECK_IP_LIMIT`, in memory per process) → 429 with `retryAfterSeconds`. Answers only `{available, reason, message}`, never who holds the name. |
| `PUT auth/username` | signed-in account | same checks as sign-up (shape, reserved words, free across `accounts.username`, `logins.username` and employee IDs, case-insensitive) under a Postgres advisory lock per name inside the transaction + the unique index `accounts_username_uq` on `lower(username)`; 409 when taken. Admin-made logins get 403 (their admin sets their username). Sign-in by username follows the account path: same 401 text and argon2 work as an unknown name. |
| `GET auth/companies`, `POST auth/switch` | signed in | only the caller's own account's active memberships; the old session family is revoked on switch / new company. |
| `POST/GET/DELETE invites` | `people.manage` | roles must pass R1 (`assertCanGiveRoles`: only what the caller holds, Super Admin owner-only), apps ⊆ the company's apps; token 32 random bytes, sha256 stored; expiry 1–90 days, max uses, revocable. |
| `GET invites/:token`, `POST invites/:token/accept` | public (+ optional Bearer, re-checked as a live session) | 404 unknown, 410 expired/revoked/used up; invite row locked while a use is counted; seat check (402); read-only company (402); an account already in the company just signs in; a person the admin made with the same email (no account) is linked, one linked to another account → 409. |
| `billing/*` | owner or `billing.manage` (new Admin permission) | company taken from the token only; checkout/invoice ids must belong to the caller's company (404). Allowed while read-only/suspended so the owner can pay. |
| `POST billing/webhook/:gateway` | public, no CSRF header | HMAC-SHA256 over the raw body (`FAKE_GATEWAY_SECRET`; Razorpay: its webhook secret), constant-time compare; stored once per (gateway, event id) — a repeated delivery is ignored; amount must match the checkout; only an `open` checkout is settled. |
| `billing/dev/*` | owner + `BILLING_DEV_TOOLS=1` | 404 otherwise, and always off when `NODE_ENV=production`. |
| `console/*` | `accounts.is_staff` | 403 for everyone else (checked in the database on every call). Staff are marked with `npm run company -- staff --email <e>`. |

Read-only (`read_only`, `suspended`): the Platform guard refuses every write with **402** except billing, `auth/logout(-all)`,
`auth/switch`, `auth/change-password`, `POST companies` (`@ReadOnlyOk`); access tokens carry `ro: true` and Tasks
(`accounts/platform_auth.py`) and Assets (guard; the claim is stored on the exchanged cookie session, `sessions.read_only`) refuse
non-GET/HEAD/OPTIONS with 402 — only when Platform sign-in is on. Suspended: non-owners get 402 at sign-in and 401 on refresh /
any Platform route. The billing clock (`BillingService.runAll`) runs under a Postgres advisory lock (one process at a time).
Remaining: OTP and invite emails/SMS are not sent (fake sender); per-IP limits on OTP are per database (fine); CAPTCHA after
suspicious attempts and a disposable-email block (§20.5) are not built.

## 8. No sign-in lockout (founder decision, 2026-10-19)

Founder: "I don't want 'too many failed attempts, try again'; anyone can try any number of times."

| Control | Before | Now (default) | To change |
|---|---|---|---|
| Lock a login (`logins`) or account (`accounts`) after wrong passwords | 5 wrong → locked 15 min ("Too many failed attempts") | **Off**: never locked; `failed_logins` still counted for information, reset on success | `LOGIN_MAX_FAILED=5` (any positive number) restores the old lock (atomic claim, 15 min) |
| Per sign-in name that matches nobody | "Too many failed attempts" after 5 tries (so the lock could not reveal names) | **Off** (follows `LOGIN_MAX_FAILED`); unknown names always get the same "Wrong …" answer as a real account | as above |
| Change password, per person | 5 wrong current passwords → 429 for 15 min | **Off** (follows `LOGIN_MAX_FAILED`) | as above |
| Bot guard per IP address | 50 failed sign-ins / 15 min | **1000** / 15 min → 429 "Too many sign-in attempts from this network. Wait a few minutes." (an office on one Wi-Fi never reaches it) | `LOGIN_IP_LIMIT` (0 = off) |
| OTP codes (5 tries per code), sign-up / forgot rate limits | unchanged | unchanged | — |

Unknown user and wrong password still get the same answer after the same argon2 work (no enumeration). Platform migration
0011 cleared every existing `locked_until` and `failed_logins`. Tests: "no lockout (founder, 2026-10-19): 10 wrong passwords,
then the right one signs in" (logins and accounts) and the `LOGIN_MAX_FAILED=3` tests for the old lock.
