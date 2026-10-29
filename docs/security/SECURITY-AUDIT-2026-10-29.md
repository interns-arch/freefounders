# Security audit 2026-10-29 (whole suite)

**Scope**: services/platform, services/tasks, services/assets, apps/web, apps/mobile, packages/core, infra/deploy,
infra/gateway, scripts/. Git history (all 140 commits) was searched for keys, tokens, passwords, private keys and secret
files. Read-only checks on the live server were done by the main session (no change made to the server from here).
**Framework**: Netxeo `skill-file-security` (checklists `full-audit`, `pre-deploy`, `docker`; instructions 01–25; scoring
from instruction 26). It was used as a reference only. None of its installer scripts were run. Its own workflow wants a
`memory-security.md` and a `security-report.md` in the project root and an edit to the AI config files (CLAUDE.md and
others). None of that was done; this report lives here instead.
**Earlier reviews**: `platform.md`, `tasks-api.md` and `assets-web-mobile-infra.md` in this folder. The risks they
already accept are not counted again unless they got worse: no sign-in lockout, 6-character passwords, 1-year sliding
sessions, per-process throttles, signed media links, photos stored in Postgres.

## Score

The score is per category (100 minus 20/10/5/2 per Critical/High/Medium/Low finding), weighted as in instruction 26.
Categories 15 (DNS and email) and 20 (serverless) do not apply here or could not be checked from the repo; their weight
is spread over the others. "After" means after these commits are deployed, `FF_BIND=172.17.0.1` and `COOKIE_SECURE=true`
are set on the server, and the Tasks media folder ownership step is done (see Deploy).

| # | Category | Before | After | Open after |
|---|---|---|---|---|
| 01 | Secrets & files | 95 | 95 | Provider keys pasted in chat must be rotated (founder) |
| 02 | Network & CORS | 75 | 100 | – |
| 03 | HTTP headers | 85 | 95 | CSP still Report-Only (founder decision) |
| 04 | Auth & sessions | 68 | 85 | OTP guessing over time, email squatting (founder decision), COOKIE_SECURE (server) |
| 05 | Cryptography | 100 | 100 | – |
| 06 | JWT | 96 | 96 | Accepted: 15 min token life after sign-out; 60 s service-token replay |
| 07 | Database | 100 | 100 | – |
| 08 | Deployment | 96 | 96 | Backups not encrypted / same disk; TLS ends in the shared Caddy |
| 09 | Docker | 89 | 96 | Images pinned by tag, not digest; gateway Caddy runs as root |
| 10 | Protocols (webhooks) | 98 | 98 | Cashfree webhook has no timestamp window (decision) |
| 11 | Advanced (SSRF, IDOR) | 83 | 93 | Tenants inherit server Gmail/WhatsApp credentials (decision); group owner editable |
| 12 | Injections | 100 | 100 | – |
| 13 | Race conditions | 98 | 98 | Seat check outside the invite transaction |
| 14 | File upload | 90 | 100 | – |
| 16 | Supply chain | 63 | 83 | Pillow 12.3.0 (fix only in 13.0.0); mobile build tooling |
| 17 | Mobile | 98 | 98 | Cleartext allowed in every build profile |
| 18 | Compliance (DPDP/GDPR) | 98 | 98 | No self-service data export |
| 19 | Monitoring | 96 | 96 | CSP reports not collected; no auth-anomaly alert |
| 21 | Source code | 100 | 100 | – |
| 22 | AI / LLM | 98 | 100 | – |
| 23 | Bot & DDoS | 85 | 95 | Throttles per process, no edge rate limit (known) |
| 24 | Browser APIs | 98 | 100 | – |
| 25 | Advanced (2FA etc.) | 95 | 95 | No second factor for owners/admins (known) |
| | **Weighted total** | **90.5 / 100** | **95.9 / 100** | |

Counted by finding, before: **1 Critical, 6 High, 16 Medium, about 20 Low**. Fixed in the repo: the Critical, 5 of the
6 High, 8 Medium and 6 Low. The Critical and the HSTS High only take effect once deployed with the server settings below.
(The framework's flat formula, 100 minus points for every finding, bottoms out at 0 for a codebase this size, so the
weighted per-category figure is the useful one.)

## Findings and what was done

### Critical

**C1. The gateway port was reachable from the internet over plain http** (`infra/deploy/docker-compose.yml`, gateway
`ports: "${FF_PORT:-7395}:7395"`, which binds 0.0.0.0). The live check showed `http://<server-ip>:7395/` and
`/api/platform/app-version` answering 200 from outside. That port bypasses TLS and the shared Caddy: passwords, codes and
refresh cookies travel in clear for anyone who uses it, and anyone on the path can capture them. ufw is off and the
security group allows the port.
*Fixed in the repo*: `"${FF_BIND:-0.0.0.0}:${FF_PORT:-7395}:7395"`. The default is unchanged so other setups keep
working; production uses `FF_BIND=172.17.0.1`, the address the shared Caddy dials. `gen-env.sh` and the README document
it. `kaampilot-caddy-watchdog.sh` now checks `172.17.0.1:7395` first, because `127.0.0.1` stops answering once FF_BIND
is set, and without this the watchdog would never put the route back. **Server step needed** (see Deploy).

### High

**H1. No HSTS** on https://kaampilot.com (`infra/deploy/Caddyfile` said "No HSTS"). Someone on the same network can
downgrade a typed `http://` visit and steal the refresh cookie (see M4).
*Fixed*: `Strict-Transport-Security: max-age=31536000; includeSubDomains`. Browsers ignore it on plain http. Preload is
not set (founder decision).

**H2. Every visitor looked like one IP address to the APIs** (`infra/deploy/Caddyfile` had no `trusted_proxies`).
Traffic goes: shared Caddy → 172.17.0.1:7395 → gateway Caddy → APIs. The gateway did not trust the shared Caddy's
`X-Forwarded-For`, so it replaced it with the bridge address. The APIs trust exactly one hop. The result:
- The per-IP limits became one bucket for the whole site: OTP codes (20 per 15 min), the sign-in bot guard, DRF
  throttles, signed-out AI questions, and visitor sign-ins (10 per hour per IP).
- One script could block sign-up, code sign-in, forgot password and visitor sign-in for every customer.
- Audit and log IP addresses were wrong.

*Fixed*: the global `servers { trusted_proxies static private_ranges; trusted_proxies_strict }`, plus
`header_up X-Forwarded-For {client_ip}` on every upstream, so each API gets exactly one value: the visitor. A direct
public request is not trusted, so it cannot forge the header.

**H3. A company admin could send the server's AI key to any address, and use the server to make SSRF calls**
(`services/tasks/backend/config/llm.py` `_key()` / `_chat_url()`, `tenancy/company_settings.py` `company_env`
falling back to the environment, `tenancy/integrations.py` letting an Admin set `AI_BASE_URL`). The attack: set
`AI_BASE_URL=https://attacker` and leave the key empty; the next AI call posts the server's key to the attacker. Not
exploitable today, because production Tasks has no AI key and its container has no internet. It would become
exploitable the day keys are added.
*Fixed*:
- In multi-company mode, a company with its own `AI_BASE_URL` gets only its own keys, never the environment's.
- `AI_BASE_URL` must be `https://` to a public host. Loopback, private and link-local addresses, single-label Docker
  names, `.local` / `.internal` / `.lan` and `localhost` are refused.
- Tests: `tenancy/tests_integrations.py::AiAddressSecurityTests`.

**H4. OTP codes shown on screen for reset and code sign-in when `DEMO_MODE=1`** (`services/platform/src/accounts/
otp.service.ts` `otpDevEcho`). `gen-env.sh` writes `DEMO_MODE=1`; `set-msg91.sh` and `set-resend.sh` say it may stay on.
With it on, anyone could type a victim's email in Forgot password, read the code off the screen, and set a new
password: a takeover of any account, owners included.
*Fixed*: in production a code is never echoed for `reset` or `login`, and never when a real sender (MSG91 or Resend) is
configured. Only open-demo sign-up with the fake sender still shows it. Dev and tests are unchanged. **Server: confirm
`DEMO_MODE=0`** on kaampilot.com. FakePay also follows DEMO_MODE in production.

**H5. Dependencies with known advisories.**
- *Fixed*: **zod <4.6.6**, High (memory exhaustion on oversized collections). Updated to 4.6.7 (released 2026-10-12)
  in the root, Platform and Assets lockfiles only.
- *Mitigated, bump later*: the other fixes are less than two weeks old, so per supply-chain practice they are not
  taken yet. Run `npm audit fix` in the root, `services/platform` and `services/assets` after **2026-11-05**, then
  the tests.
  - **body-parser 2.3.0**: DoS through trailing bytes after a compressed request body; fixed in 2.4.0 (2026-10-22).
    The gateway now drops `Content-Encoding` from requests (no client of the app compresses its bodies), so the inflate
    path cannot be reached.
  - **multer 2.4.0**: DoS that needs an async `fileFilter`. Neither service uses one, so it is not exploitable. Fixed in
    2.5.0 (2026-10-22).
  - **qs ≤6.16.0**: only `qs.stringify` with `arrayFormat: 'comma'`, which is not used with user data; fixed in
    6.16.2 / 6.17.x (2026-10-27/28).
  - **fast-uri ≤3.1.8**: root build tooling (ajv) only; fixed in 3.1.9 (2026-10-19).
- *Open*:
  - **Pillow 12.3.0** (Tasks decodes every uploaded image): 39 advisories, fixed only in **13.0.0**, a major release
    published 2026-10-16. → founder decision F1.
  - **apps/mobile**: node-forge, zod and others in the Expo/Metro build tooling. They need an Expo SDK upgrade and are
    not reachable at runtime. Known (R3 of the earlier review).

### Medium

| # | Finding | Where | Status |
|---|---|---|---|
| M1 | **XLSX zip bomb**. Any self-signed-up owner (who has `people.manage`) uploads about 700 KB whose about 14 000 central-directory entries share one deflate stream. Each inflates to 49 MB synchronously, and the Platform runs out of memory. Sign-in and billing go down for every tenant. | `services/platform/src/people/people-import.ts` `unzip` | **Fixed**: at most 1000 entries, at most 40 MB unpacked in total, only the entries the reader uses (sheets, shared strings, workbook + rels), duplicates skipped. Test `people-import.test.ts` "zip bomb". |
| M2 | **A switched-off person could switch themselves back on**, with their old level and roles, through any open invite link of the company: accept linked the admin-made row by email and set `status: 'active'`. | `services/platform/src/invites/invites.service.ts` `accept` | **Fixed**: a matching row that is not active answers 403 "Your access to this company was switched off" (the transaction rolls back, so the link is not used up). An active row is linked exactly as before. Test `signup-billing.test.ts` "switched-off person cannot switch themselves back on". |
| M3 | **Public visitor endpoints read unbounded JSON**, and a small PNG/WebP selfie can claim a 40 MP canvas (about 160 MB decoded) per sign-in. DRF's JSON parser is not bound by `DATA_UPLOAD_MAX_MEMORY_SIZE`; the only cap was Caddy's 100 MB. | `services/tasks/backend/visitors/views.py` public views, `visitors/services.py` `decode_photo` | **Fixed**: `config/body_limit.py` refuses bodies over 2 MB (`PUBLIC_BODY_MAX_BYTES`) on `/api/visitors/public/` and `/api/visitors/pass/` with 413, before parsing. Every gate or visitor photo over 16 MP is refused after reading only its header. Tests `visitors/tests_security.py`. |
| M4 | **Cookies not `Secure`**: `gen-env.sh` writes `COOKIE_SECURE=false` and compose defaults to false. This covers the Platform refresh cookie and the Assets `eam_session`. | `infra/deploy/gen-env.sh`, compose | **Server**: set `COOKIE_SECURE=true` (the site is https only). The template stays false for the plain-http open demo. |
| M5 | **Service-only routes reachable from the internet**: `/tasks/api/internal/*` and `/assets/api/internal/*` (they need the 60 s Platform service token, but that is the only defence). | `infra/deploy/Caddyfile` | **Fixed**: the gateway answers 404. The Platform reaches them directly on the internal network. |
| M6 | **Tasks image runs as root** (gunicorn and the worker, with a bind-mounted media folder). No `no-new-privileges` or `cap_drop` anywhere. Gateway had no healthcheck. | `services/tasks/Dockerfile`, compose | **Fixed**: `USER app` (uid/gid 10001). `security_opt: no-new-privileges` on platform, assets, tasks and tasks-worker. `cap_drop: [ALL]` on platform and assets (non-root, high ports). Gateway healthcheck. **Server step: `chown -R 10001:10001 /opt/freefounders/data/tasks-media` before restarting tasks.** Postgres and the Caddy gateway are left as they are: `cap_drop` breaks Postgres's entrypoint and Caddy's file capability. |
| M7 | **6-digit sign-in / reset code can be guessed over time**. Per account: 5 codes per 15 min × 5 tries = 2400 guesses a day, about 0.24 % a day and about 58 % a year, with rotating IPs. | `accounts/otp.service.ts` | **Founder decision F3** (a daily cap means a victim can be locked out of code sign-in, like the lockout the founder turned down). |
| M8 | **Email squatting**. Single "Add person" and "Edit" do not refuse an email that already has a Kaampilot account or an admin-made login elsewhere (import does). Another company can then stop that person signing up, or make their email sign-in ambiguous. | `people/people.service.ts` `create` / `update` | **Founder decision F4**. |
| M9 | **Tenants inherit the server's Gmail and WhatsApp credentials** in multi-company mode: a company that only switches `GMAIL_ENABLED` / `WHATSAPP_ENABLED` on uses the server's mailbox or number. Not configured in production. | `tenancy/company_settings.py` | **Founder decision F5**. |
| M10 | **CSP is Report-Only** and has no `report-uri`, so nothing is collected. | `infra/deploy/Caddyfile` | **Founder decision F2**. |
| M11 | Provider keys pasted in chat (MSG91, Cashfree, Resend, Gemini). | outside the repo | **Founder action** (rotate). |
| M12 | Throttles per process, no edge rate limit, no 2FA. | known | Unchanged (earlier reviews). |

### Low / Info

- **Fixed: "Ask Kaampilot" accepted tokens of ended sessions.** It is a public route, so a signed-out session, a
  switched-off person or a suspended company kept the data tools for up to 15 minutes. It now checks `auth.isLive`.
- **Fixed: the signed-out AI limit could be dodged per IPv6 address.** It is now counted per /64, with an overall
  signed-out cap `AI_RATE_SIGNED_OUT_TOTAL` (300 per 10 min, 0 = off) to bound the provider bill. Tests `ai/ai.test.ts`.
- **Fixed: the paid AI ID-card reader had no rate limit** (`visitors/views_v3.py` `id_scan_view`). It now has
  `AIThrottle`.
- **Fixed: the web-to-app bridge accepted a reply from any frame.** It now ignores messages with a foreign source window
  (Cashfree and Calendly frames), and request ids carry 64 random bits (`apps/web/src/lib/native-bridge.ts`).
- **Fixed: the badge print window wrote `passNo` into HTML unescaped** (`apps/web/src/features/visitors/parts.tsx`).
  The number is server-generated today, so this was not exploitable.
- **Open: Cashfree webhook has no timestamp window.** The HMAC and idempotency are sound; a 5-minute window could drop
  a slow Cashfree retry → decision F6.
- **Open: seat race.** Two invites accepted at the same moment can go one over the paid seats. Lock the subscription
  row inside the transaction (small follow-up).
- **Info: the 4-digit check-in code through `GET visitors/visits/find/` and `scan/`** skips the wrong-code counter.
  Only staff with gate rights can call these, and they already see the same visitors in their list, so nothing new is
  exposed. Unchanged.
- **Info: visitor QR form host list.** With "whom to meet" on, it lists up to 1000 active people (name, department) to
  anyone holding the gate QR. Suggest the `departments` default.
- **Info: public sign-in with a known visitor's mobile** updates that visitor's record after the guard approves.
- **Info: `workspace/serializers.py` `GroupSerializer.owner`** is writable on update.
- **Info: Android `usesCleartextTraffic: true`** is in every profile. The server lock and https in eas.json mitigate it.
  Move it to the `lan` profile only.
- **Info: backups** are plain gzip on the same disk. TLS for kaampilot.com ends in another team's Caddy.

## Checked and sound
- **Git history and working tree.** No private keys, AWS/GitHub/Slack tokens, provider keys or `.env` files in any of
  the 140 commits; only test stand-ins. `.data/` and `import-report-*` are ignored. `db.sqlite3` is ignored.
- **JWT.**
  - Platform: EdDSA only, with `iss`, `aud`, `typ` and `maxTokenAge`; service tokens are refused on user routes.
  - Tasks and Assets pin EdDSA plus the JWKS.
  - The refresh cookie is HttpOnly and SameSite=Lax, with its path limited to the auth endpoints.
  - Every mutating request needs an `X-Requested-With` CSRF header; the webhook exemption is a tight regex.
- **OTP.**
  - `randomInt` codes, hashed and bound to the code id, valid 10 minutes, 5 tries claimed atomically, compared in
    constant time, used once.
  - The same answer whether the account exists or not.
- **Cashfree.**
  - HMAC over the raw body, compared in constant time; idempotent event ids.
  - The amount must equal the server-side total, and prices come from the server.
- **Tenancy.**
  - The schema comes from the token `cid`. Public visitor routes accept only `^co_[a-z0-9_]{1,50}$` and only if the
    schema is in the registry.
  - No request reaches another company's schema, and nothing user-supplied reaches `search_path`.
  - No `sql.raw` or `.extra` with user input; LIKE patterns are bound or escaped.
- **IDOR.**
  - Platform `:id` routes use `uuidParam` and filter on `companyId`. Assets uses `ParseUUIDPipe` and `assertCanView`.
  - Tasks visitor and team360 querysets are scope-filtered.
- **Uploads.**
  - Magic-byte sniffing (JPEG, PNG, WebP), size limits and UUID or `get_valid_name` file names.
  - Files are served with `nosniff`, a sandbox CSP, and `attachment` for anything that is not an image or PDF.
  - The sharp advisory (old R1) is fixed (0.35.5).
- **AI tools.** GET only, fixed base URLs, `redirect: 'error'`, the asker's own token, and ids encoded. Answers are
  rendered as React text only.
- **Web.**
  - No `dangerouslySetInnerHTML` or `innerHTML`.
  - The access token lives in memory; `?next=` is checked with `safeNext`.
  - Every `target=_blank` link has a `rel`.
- **Mobile.**
  - Bridge messages are accepted only from the server origin.
  - File access and mixed content are off; secrets are in secure-store.
  - The server address is locked in the release profiles.
- **Server** (live read-only check by the main session):
  - `.env` is mode 600, owned by root.
  - SSH: password login off, root login key-only.
  - 0 pending security updates.
  - The backups folder is mode 700 and holds 20 dumps.
  - X-Frame-Options DENY, nosniff and Referrer-Policy are present.
- **Scripts.**
  - The `set-*.sh` scripts read secrets hidden, pass them through stdin or the environment, and use `umask 077`.
  - No `eval`, and nothing is echoed.

## Needs a founder decision (exact proposed change)
- **F1. Pillow 13.0.0.** Set `Pillow==13.0.0` in `services/tasks/backend/requirements.txt` after 2026-10-30 (two weeks
  after its release). Then run the Tasks suite, plus the image tests in `config/tests_images*` and the visitor photo
  tests, and rebuild the Tasks image. This is a major version, so check for removed APIs first.
- **F2. Enforce the CSP.** First add `report-uri /api/platform/csp-report` (a small endpoint that logs to the console)
  and watch for a week: every screen, the QR scanner, voice notes, printing, Cashfree checkout, the Calendly popup and
  the phone app. Then rename `?Content-Security-Policy-Report-Only` to `?Content-Security-Policy` in
  `infra/deploy/Caddyfile`. Origins already listed: `sdk.cashfree.com`, `*.cashfree.com` (connect, frame, form-action),
  `assets.calendly.com` (script, style), `calendly.com` / `*.calendly.com` (frame). Possible gap:
  `font-src https://assets.calendly.com`.
- **F3. OTP guessing.** In `OtpService.start`, refuse a new `login`/`reset` code for a target that has 10 or more wrong
  tries in 24 hours, with "Too many wrong codes today. Sign in with your password or try tomorrow." Also cap codes at
  10 per target per day. The trade-off: an attacker can block a victim's code sign-in for a day, though not their
  password sign-in. The alternative is 8-digit codes.
- **F4. Email squatting.** Apply the import checks to `PeopleService.create`/`update`: refuse an email that belongs to
  a Kaampilot account, or to an admin-made login in another company ("This email already signs in to Kaampilot: invite
  them with a link instead").
- **F5. Server credentials in multi-company mode.** Never fall back to the environment for `SECRET_KEYS` (Gmail,
  WhatsApp, AI) unless the company is on an allow-list `PLATFORM_SHARED_KEYS_COMPANIES`. Today no keys are set on the
  server, so nothing changes now.
- **F6. Cashfree webhook timestamp.** Refuse timestamps more than 15 minutes from now. Only do this once Cashfree
  confirms that retries are re-signed with a fresh timestamp.
- **F7. HSTS preload.** Add `; preload` and submit to hstspreload.org only when every subdomain (including
  `mail.kaampilot.com`) is https-only forever.

## Founder / server actions (not done from the repo)
1. **Rotate every key that was pasted in chat**:
   - **MSG91**: authkey → `set-msg91.sh`.
   - **Cashfree**: Secret Key → `set-cashfree.sh`; also regenerate the webhook secret if it is separate.
   - **Resend**: delete the old API key, create one with Sending access for kaampilot.com only → `set-resend.sh`.
   - **Gemini / AI**: delete the old key in Google AI Studio → `set-ai.sh`.
   - After each, check the platform log line.
2. On `/opt/freefounders/.env`: set `FF_BIND=172.17.0.1`, `COOKIE_SECURE=true` and `DEMO_MODE=0` (confirm it), then
   recreate the stack (see Deploy).
3. In the AWS security group, remove the inbound rule for TCP 7395. Turn on ufw with 22, 80 and 443 only, after
   checking that the other teams' services on the box don't need more.
4. Change the demo passwords (`Demo@1234`, the `FF_OWNER_PASSWORD` / `FF_STAFF_PASSWORD` from `.env`) on any live
   account that still uses them.
5. Copy backups off the box, encrypted (`age` or `gpg` before upload, then S3 with SSE and versioning).
6. GitHub: push these commits (not done from here).

## Deploy (services touched)
- **Platform** (OTP echo, invite, AI limits, zip bomb, zod bump): rebuild `platform`.
- **Tasks + tasks-worker** (non-root image, AI address, body limit, photo pixels, ID-scan throttle). **Before**
  `ff.sh up -d tasks tasks-worker`, run `sudo chown -R 10001:10001 /opt/freefounders/data/tasks-media`.
- **Assets** (zod bump, `cap_drop`): rebuild `assets`.
- **Gateway** (Caddyfile, FF_BIND, healthcheck) and the **website** (`native-bridge.ts`, badge title):
  - Copy the new `web/`.
  - Set FF_BIND in `.env`, then `ff.sh up -d gateway`. Compose recreates it with the new port binding.
  - Check `curl -s http://172.17.0.1:7395/api/platform/health` → 200, and https://kaampilot.com loads.
  - From outside, `http://<server-ip>:7395` must time out.
  - Check that the response has `Strict-Transport-Security`.
  - Check that a sign-in from two networks is throttled separately (Platform log IPs differ).
- **Watchdog**: copy `infra/deploy/kaampilot-caddy-watchdog.sh` to `/opt/freefounders/` (it now checks
  172.17.0.1:7395).
- No database migrations. No new APK.

## Tests
- Platform: `npm test`, including new tests in `people-import.test.ts`, `signup-billing.test.ts` and `ai/ai.test.ts`.
- Tasks: `manage.py test`, including `visitors/tests_security.py` and `tenancy/tests_integrations.py::AiAddressSecurityTests`.
- Assets: `npm test`.
- Web: `npm run web:build`.
- Results 2026-10-29:
  - `npm run quick-check -- --tests platform,tasks,assets`: all 9 checks passed.
  - Platform: 228 / 228.
  - Tasks: 1191 tests OK, 26 skipped. One parallel run hit a "cannot pickle traceback" runner error that did not
    repeat, either serially or in the next parallel run.
  - Assets: green.
  - `npm run web:build`: OK.
- The Caddyfile could not be validated locally (no caddy or docker here). After deploying, check
  `ff.sh logs gateway` for adapt errors.
