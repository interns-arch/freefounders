# Security review: Assets API, web app, Android shell, gateway/infra (2026-10-12)

Scope: `services/assets/apps/api` (+ `packages/shared`), `apps/web`, `packages/core` (session/HTTP), `apps/mobile`,
`infra/gateway`, `scripts/dev.mjs`, `.github/workflows/ci.yml`, docker/compose files, `.env.example`s, `.gitignore`.
The Platform (sign-in) and the Tasks API have their own reviews (`platform.md`, `tasks-api.md`).
Brief: no data leaks, sound authentication and authorisation, ready to scale.

## What was checked

| Area | Checked | Result |
|---|---|---|
| Assets routes | Every controller: `@Public()` only on health, config, login/platform-session/logout and `/internal/*` (those check the Platform service token, `aud=assets-internal`, `sub=platform`). Routes without `@RequirePermissions` check in the service (`assertCan`, `scope`, `canSee`). | OK |
| Employee-only rules | Assets: holder sees only assets they hold (`scope`), photos via `assertCanView` + `assetId` match; employees: self only without `employee:view`; requests: own + direct reports; tickets: own; exit case: own; notifications: own. | OK |
| Cross-company | Schema per company, connection pinned per request (`search_path`), registry only by qualified name, schema names validated (`co_[a-z0-9_]`), cookie relabelled for another company refused (test), token `cid` vs `apps.assets` user checked. | OK, one bypass fixed (F1) |
| Raw SQL | `sql` templates bind values; identifiers only from `quoteSchema` (validated); `sql.raw` only for a constant. LIKE patterns escaped. | OK |
| Cookie session | HttpOnly, SameSite=Lax, Secure when `NODE_ENV=production`, path `/`; Platform exchange: fixed 15 min, never extended; logout deletes the row. | Sign-out gap fixed (F2); path note (R8) |
| CSRF | All POST/PUT/PATCH/DELETE under `/api` need `X-Requested-With` (custom header ⇒ CORS preflight cross-site); GETs do not change data (only the session's `last_seen`). | OK (e2e check) |
| Uploads | Magic-byte sniffing (JPEG/PNG/WebP only; MIME and extension ignored), 15 MB × 6 per request, `limitInputPixels` 120 MP, file names server-generated, stored in Postgres (`bytea`). | Serving + legacy path + memory hardened (F6, F7) |
| Reconciliation | Spreadsheet parsed in the browser; server takes JSON (≤ 5000 rows, cells ≤ 500 chars, 4 MB body) and keeps only the needed columns (no Aadhaar/PAN/bank). | OK |
| Errors / logs | Errors are `{statusCode, message}`; 500s say "Something went wrong" (stack only in the server log); no tokens or passwords logged (standalone seed prints a one-time admin password once). | OK |
| Headers | helmet (CSP for API answers, nosniff, frameguard, HSTS on https), `x-powered-by` off, JSON limit 4 MB. | OK |
| Web XSS | No `dangerouslySetInnerHTML`/`innerHTML`/`eval`; React 19 escapes text and blocks `javascript:` hrefs; Linkify only http(s)/www. Links built from typed data now pass `safeHref` (F3). Print HTML = the rendered DOM without scripts. | Fixed (F3) |
| Tokens / storage | Access token in memory only; web refresh token is an httpOnly cookie (`/api/platform/auth`). localStorage: theme, lite mode, menu state, list view, recent HR report filters, and the query cache (safe list only, per `sub|cid`, cleared on sign-out / other person, 24 h, per build). | OK (R10) |
| Service worker | Precache = app shell + `/static/*`; navigations network-first; `/api/*`, `/tasks/api/*`, `/assets/api/*`, `/media/*` never answered by the worker; build check `scripts/check-sw.mjs`. | OK |
| Native bridge (web) | Replies matched by request id; downloads/prints only from the app's own calls. | OK; shell side fixed (F4) |
| Android shell | See F4, F5, F11. `allowFileAccess`, file-URL access, mixed content off; debugging only in dev; downloads: file names sanitised (`safeFilename`), base64 checked, 40 MB cap. | Fixed |
| Gateway / infra | Dev gateway CORS (F8), Caddy headers/CSP/body limit (F9), `/media` → Django signed links (Tasks review), no CORS in prod. | Fixed |
| Secrets | Working tree and all 71 commits of history searched for private keys, AWS/Google/GitHub/Slack/OpenAI/Razorpay/WhatsApp tokens, `SECRET_KEY=…`, JWTs, `.env`/`.pem`/`.key`/keystore files ever added. | Nothing found (one false positive: a 1×1 PNG in a test). Only `dev-only-platform-secret-change-me` (documented dev fallback in Platform). |
| CI | Actions pinned to major versions, no `permissions:`, no audits, no secret scan. | Fixed (F12) |

## Fixed (with tests)

| # | Severity | Issue | Where | Fix | Test |
|---|---|---|---|---|---|
| F1 | **High** | In multi-company mode the app's own password login was still reachable: a hand-made cookie `eam_session=<companyId>~x` pins the request to that company, then `POST /api/auth/login` checks the **old Assets password hash** (imported installs keep it). A password changed or reset in the Platform therefore kept opening Assets (7-day sliding session) with the old one, outside the Platform's lockout. | `modules/auth/auth.controller.ts` | With `TENANCY=schemas`, `/auth/login` and `/auth/change-password` answer 401 `no_company` "Sign in through Kaampilot" before any password check. | `tenancy.test.ts` "the app's own password login stays off even when a cookie names the company"; e2e `web-security.spec.ts` (against the running suite) |
| F2 | Medium | Sign-out left the Assets cookie session valid for up to 15 minutes (photos/API by cookie on a shared computer). | `packages/core/src/auth.ts`, `assets/session.ts` | Sign-out first calls Assets `/auth/logout` (deletes the session row, clears the cookie). | e2e `single-login.spec.ts` (Assets `/auth/me` 200 before, 401 after sign-out) |
| F3 | Medium | Assets custom fields of type URL accepted `javascript:`, `data:`, `vbscript:`, `file:` (zod `url()` allows any scheme) and the value is rendered as a link; other screens render saved links/attachment URLs from Tasks data as `href`. | `packages/shared/src/fields.ts`; web: `dynamic-fields`, links, task detail (external link + files), lead documents, notices, form submissions, proof files, ticket → task link | Server: http(s) only. Web: `src/lib/safe-url.ts` `safeHref()` (http(s), mailto, tel, same-site paths; else no link) on all 10 sinks. | `shared.test.ts` "a web address field takes http(s) only"; e2e `web-security.spec.ts` (safeHref table) |
| F4 | Medium | Android shell gave its powers to any page: bridge messages were accepted from whatever was loaded (Android exposes `ReactNativeWebView` to every frame), the injected script ran on any main-frame origin, frames of any origin could load (`isTopFrame === false` ⇒ allowed), top-level `data:` pages counted as "inside". | `apps/mobile/src/shell/shell.tsx`, `lib/protocol.ts`, `lib/injected.ts` | Messages handled only when the page URL is the server origin (`fromServer`); injected script exits on any other origin; `linkTarget` → `block` for `data:`, foreign `blob:` and foreign frames (frames never launch other apps); third-party cookies off; mixed content / file-URL access explicitly off. | `test/protocol.test.ts` (3 new), `test/injected.test.ts` "the app powers go to pages of the server only" |
| F5 | Medium | Server-address field accepted any `http(s)` address: a person could be talked into a look-alike server (it sees the password and can ask for location/camera), and plain `http://` over the internet. | `lib/protocol.ts` `normalizeServerUrl`, `lib/server-url.ts`, `shell/offline-screen.tsx` | `http://` only for office-network hosts (10/8, 172.16/12, 192.168/16, 127/8, 169.254/16, localhost, `.local`, single-label); otherwise https (also the default scheme). Warning text above the field. Store builds: `EXPO_PUBLIC_LOCK_SERVER=1` or `extra.lockServer` ⇒ no field, saved address ignored. | `protocol.test.ts` "plain http only for the office network" |
| F6 | Low–Med | Photo answers had no `Content-Disposition`/sandbox; an older row with a page-like `mime_type` (older install, import) would be served inline as that type; the legacy on-disk path joined `file_name` unchecked. | `modules/assets/assets.module.ts`, `photos.service.ts` | Inline only for JPEG/PNG/WebP (`filename="photo-<id>.<ext>"`), anything else `application/octet-stream` + attachment; `Content-Security-Policy: default-src 'none'; …; sandbox`; `nosniff`; disk reads only for a plain file name. | `integration.test.ts` "photos are served as images only, never as a page; an old file name cannot leave the upload folder" |
| F7 | Low | Any number of photos decoded at once (each up to a few hundred MB while decoded) ⇒ memory exhaustion with parallel uploads. | `photos.service.ts` | At most `PHOTO_CONCURRENCY` (default 2) decodes per server; others wait. | existing photo tests (shrink, upright, metadata) |
| F8 | Medium (dev) | Dev gateway allowed credentialed CORS from **any** IPv4 host on port 8081: a page served by another machine on the office Wi-Fi could call `/api/platform/auth/refresh` with a developer's cookie and read the answer (access token). | `infra/gateway/dev-gateway.mjs` | Only `localhost`, `127.0.0.1` and this computer's own addresses. | `corsAllowed()` checked with node (own/other host, other port, no origin); needs a gateway restart |
| F9 | Medium | Production Caddy draft had no HSTS, CSP, frame, referrer or permissions headers and no body limit. | `infra/gateway/Caddyfile` | Headers below; `request_body max_size 100MB`; `-Server`; `/media` `Cache-Control private, no-store` by default; rate-limit block ready for the plugin. CSP Report-Only first. | Built app served with the CSP **enforced**, signed in, 21 screens incl. asset detail with photos, labels, ID cards, QR scanner, reports, admin: **0 violations** (after F10) |
| F10 | Low | zod's fast path tries `new Function` (one CSP `eval` violation on the reconciliation screen). | `apps/web/src/main.tsx` | `z.config({ jitless: true })`. | same CSP run: 1 → 0 violations |
| F11 | Low | Expired Assets sessions were never deleted (a new row every ~15 min per person with single login). | `auth.service.ts` `platformSession` | Each exchange deletes that person's expired sessions (indexed by user). | `platform.test.ts` "a new exchange clears that person's expired sessions" |
| F12 | Low | Remote Postgres TLS never checks the certificate (`rejectUnauthorized: false`). | `db/db.service.ts` | `PGSSLMODE=verify-full` (+ `PGSSLROOTCERT`) checks it; default unchanged. `services/assets/.env.example` added. | `db/ssl.test.ts` |
| F13 | Low | CI: no `permissions:`, no dependency audit, no secret scan. | `.github/workflows/ci.yml` | `permissions: contents: read`, `concurrency`; `dependency-audit` job (npm audit ×4 + pip-audit) and `secret-scan` job (gitleaks 8.18.4, full history), both report-only first. | YAML parsed |
| F14 | Low | `.gitignore` did not cover app-signing and cloud credential files. | `.gitignore` | `*.keystore *.jks *.p12 *.p8 *.mobileprovision credentials.json google-services.json GoogleService-Info.plist service-account*.json uploads/`. | `git check-ignore` |

## Remaining risks (not changed here)

| # | Severity | Risk | Recommendation |
|---|---|---|---|
| R1 | **High** (dependency) | `sharp 0.34.5` (libvips/libheif/librsvg advisories GHSA-f88m-g3jw-g9cj, GHSA-rgj7-g3m4-5g8c, GHSA-wq5f-xc86-pv6w). Mitigated: only JPEG/PNG/WebP magic bytes ever reach sharp (no SVG/HEIF). | Stop the suite, then `cd services/assets && npm i -w @eam/api sharp@0.35.5 --save-exact && npm test` (Windows locks the native module while the API runs). |
| R2 | **High** (dependency, Tasks) | `Pillow 11.3.0`: 35 advisories, fixed in 12.3.0 (pip-audit). Tasks decodes every uploaded image. | Reviewer B / founder: upgrade to `Pillow==12.3.0`, run the Tasks image tests. |
| R3 | Medium | Mobile: 30 npm advisories (18 high) — all Expo/Metro build tooling and transitive (braces, micromatch, node-forge, metro, uuid, xcode); runtime only `query-string`/`decode-uri-component` via expo-router (DoS on a malformed deep link). Fixes need an Expo SDK upgrade. | Track Expo SDK patch releases; not exploitable from the web app. |
| R4 | Medium (scale/DoS) | Multi-company mode pins one pool connection per request for the whole request, including a slow multipart upload: 20 (`DB_POOL_SIZE`) slow uploads block that node. | Bind the company connection lazily (first query) or after the body is read; PgBouncer (transaction mode needs `SET LOCAL search_path` per transaction); per-IP upload rate limit. |
| R5 | Medium | No rate limiting on Assets (password login is now off in multi-company mode; `platform-session` needs a valid token; Platform has its own login throttle). | Caddy `rate_limit` (plugin; block in the Caddyfile) or a WAF (AWS WAF rate-based rule) in front of `/api/platform/auth/*` and the APIs. |
| R6 | Medium (design) | Photos live in Postgres (`bytea`): large backups, DB I/O for every image, no CDN. | S3 (private bucket, SSE) + short-lived signed URLs (or CloudFront signed cookies), served only after the same `assertCanView`; keep sniff + re-encode on upload. |
| R7 | Low | `/api/config` with a forged company cookie shows that company's name, brand and module switches (needs its UUID). | Accept, or answer `config` only for signed-in requests in multi-company mode. |
| R8 | Low | Assets cookie path `/` ⇒ also sent to Tasks and the Platform. | `path=/assets/api` behind the gateway (configurable), once standalone installs are gone. |
| R9 | Low | Photos are `Cache-Control: private, max-age=86400, immutable` ⇒ stay in a shared computer's browser cache after sign-out. | `no-store` (costs re-downloads) if shared devices are common. |
| R10 | Low | localStorage after closing the browser without signing out: the query cache (24 h: me, attendance, leave balances, counts) and "recent HR reports" (filters, not data). | Accept for phones (personal); offer "Shared computer" at sign-in that turns persistence off. |
| R11 | Low | Any signed-in Assets user can list companies/departments/locations/vendors; a holder sees their asset's purchase cost/invoice. | Founder decision (hide cost fields without `asset:view`). |
| R12 | Low | People & access shares a new person's username **and password** in a `wa.me/?text=` URL (`features/admin/people-dialogs.tsx`). | One-time setup link (expires, single use) instead of the password. |
| R13 | Low | Platform service tokens (60 s) can be replayed within their minute (no `jti`). Internal network only. | `jti` + short replay cache, or mTLS between gateway network services. |
| R14 | Low | `services/tasks/docker-compose.yml` publishes `7001:8000` on all host interfaces (bypasses the gateway/TLS); the image runs as root. | `127.0.0.1:7001:8000`; `USER app` in the Dockerfile (fix volume ownership first). |
| R15 | Info | Android: no certificate pinning, no app attestation. | After the https domain is fixed: Play Integrity on sign-in from the app; pinning only with a key-rotation plan. |

## Production headers and CSP (in `infra/gateway/Caddyfile`)

```
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(self), geolocation=(self), microphone=(self), payment=(), usb=(), serial=(), bluetooth=(), interest-cohort=()
Cross-Origin-Opener-Policy: same-origin
Content-Security-Policy-Report-Only:
  default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:;
  font-src 'self' data:; connect-src 'self'; media-src 'self' blob:; worker-src 'self'; manifest-src 'self';
  frame-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'
```
Why each source: `/theme.js` and the Vite bundles are files (no inline script); `'unsafe-inline'` styles are needed
for React `style` props/Radix positioning; `data:`/`blob:` images = QR codes, barcodes, photo previews; `https:` images
= a company logo address from the Settings Center; `blob:` media = voice notes. Verified with the CSP **enforced** on
the production build (0 violations, list above). Switch to the enforcing header after a quiet week on staging. The
CSP is set with `?` so the stricter policies of the APIs stay (Assets photos: `sandbox`; Tasks `/media`: sandbox).

Android release builds: `expo-build-properties` → `"android": { "usesCleartextTraffic": false }`, an `https://`
`EXPO_PUBLIC_WEB_URL`, and `EXPO_PUBLIC_LOCK_SERVER=1`.

Assets production env: `NODE_ENV=production` (Secure cookies), `TRUST_PROXY=true`, `PGSSLMODE=verify-full`,
`PLATFORM_JWKS_URL`, `TENANCY=schemas` (see `services/assets/.env.example`).

## Scalability notes
- Assets API nodes are stateless (sessions and photos in Postgres, JWKS cached per process, company → schema map
  cached per process): several nodes behind Caddy work today. Blockers: R4 (connections pinned per request) and R6
  (images in the DB). Image work (sharp) is CPU-heavy: limited per node (F7); a separate worker or S3 + Lambda
  resize would take it off the API.
- Connection budget: `DB_POOL_SIZE` × nodes must stay under Postgres `max_connections` (multi-company mode holds one per
  request); use RDS Proxy/PgBouncer when adding nodes.
- Expired Assets sessions are now cleaned per person (F11); a nightly `delete from sessions where expires_at < now()`
  per schema would also catch people who stopped using the app.
