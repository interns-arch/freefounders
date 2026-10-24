# Deploying Kaampilot on a shared Docker host

The whole suite in one Docker Compose project (`freefounders`) that publishes **one port** (`FF_PORT`, default 7395)
and touches nothing else on the machine. First used on the CarTrends EC2 box (2026-10-21) as an **open demo** over
plain http: `http://<server>:7395`.

```
gateway  (caddy:2-alpine)   :7395 on the host → routes by path, serves apps/web/dist     64 MB  0.15 CPU
platform (NestJS)           Platform API, migrations on start                           320 MB  0.3
tasks    (Django/gunicorn)  Tasks API, 2 workers × 4 threads, migrate_companies on start 400 MB  0.3
tasks-worker                manage.py run_worker (reminders/digests for every company)   250 MB  0.15
assets   (NestJS)           Assets API, migrate.js (every company schema) on start      320 MB  0.3
postgres (17-alpine)        ff_platform, ff_tasks, ff_assets (one role each)            512 MB  0.3
```
Every container has `mem_limit` = `memswap_limit` (it cannot push the host into swap) and `restart: unless-stopped`.
Postgres and the APIs are on an `internal` Docker network: no host ports, no internet. Multi-company mode
(`TENANCY=schemas`) and single login (`PLATFORM_JWKS_URL`) are on, as in `npm run dev`.

## Files
| File | What |
|---|---|
| `docker-compose.yml` | the services above; secrets come from `FF_HOME/.env` |
| `platform.Dockerfile`, `assets.Dockerfile` | multi-stage Node 22 slim; runtime stage has prod deps only (argon2 / sharp linux-x64 binaries) |
| `../../services/tasks/Dockerfile` | the Tasks image (reused; compose overrides its entrypoint) |
| `Caddyfile` | the gateway: same routing as `infra/gateway/dev-gateway.mjs`, security headers without HSTS (http) |
| `postgres-init.sh` | first start only: one role + database per service |
| `tasks.env` | non-secret Tasks settings (DEBUG off, WhatsApp/Gmail/AI off, scheduler only in the worker) |
| `gen-env.sh` | writes `FF_HOME/.env` with fresh random secrets (mode 600) |
| `ff.sh` | `docker compose` with the right project / env file / compose file |
| `bootstrap.sh` | once: first company + owner + `/console` staff account, then `company sync` |
| `set-razorpay.sh` | switches payments to Razorpay: asks for the keys without showing them, writes `.env`, recreates the platform only |
| `set-msg91.sh` | switches one-time codes to MSG91: asks for the authkey (hidden) and template IDs, writes `.env`, recreates the platform only |
| `backup.sh` | nightly backup: all databases + uploaded files into `FF_HOME/backups`, 14 days kept (see **Backups**) |

## Server layout (`FF_HOME`, default `/opt/freefounders`)
```
.env            secrets + settings (mode 600, never in git)   ← owner/staff passwords are here (FF_OWNER_PASSWORD, FF_STAFF_PASSWORD)
app/            this repo (git archive of a commit)
web/            apps/web/dist (built on a developer machine)
data/postgres   data/tasks-media   data/assets-uploads
```

## First deploy
On a developer machine (repo root):
```
npm ci && npm run web:build                                # apps/web/dist
git archive --format=tar.gz -o ff-app.tgz HEAD
tar -czf ff-web.tgz -C apps/web/dist .
scp ff-app.tgz ff-web.tgz ubuntu@<server>:/tmp/
```
On the server:
```
sudo mkdir -p /opt/freefounders && sudo chown ubuntu:ubuntu /opt/freefounders
cd /opt/freefounders && mkdir -p app web data/postgres data/tasks-media data/assets-uploads
tar -xzf /tmp/ff-app.tgz -C app && tar -xzf /tmp/ff-web.tgz -C web
PUBLIC_HOST=<server ip or domain> app/infra/deploy/gen-env.sh
# Build one image at a time, low priority (check `free -m` first: keep ≥ 1 GB available)
for s in platform assets tasks; do nice -n 19 app/infra/deploy/ff.sh build $s; done
app/infra/deploy/ff.sh up -d
app/infra/deploy/bootstrap.sh
```
Check: `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:7395/api/platform/health` → 200.

Then open the port in the cloud firewall. **AWS**: EC2 → the instance's security group → Inbound rules → Add rule:
Custom TCP, port 7395, source 0.0.0.0/0 (or your office IP only).

## Update
```
# developer machine: build web, git archive HEAD, scp as above
cd /opt/freefounders
rm -rf app.new && mkdir app.new && tar -xzf /tmp/ff-app.tgz -C app.new && rm -rf app && mv app.new app
rm -rf web/* && tar -xzf /tmp/ff-web.tgz -C web
for s in platform assets tasks; do nice -n 19 app/infra/deploy/ff.sh build $s; done
app/infra/deploy/ff.sh up -d                       # migrations run on start
app/infra/deploy/ff.sh exec -T platform node dist/companies.js sync
```

## Stop / start / logs
```
app/infra/deploy/ff.sh stop            # everything stops; data stays
app/infra/deploy/ff.sh up -d
app/infra/deploy/ff.sh ps
app/infra/deploy/ff.sh logs -f --tail 100 platform
docker stats --no-stream $(docker ps -q --filter label=com.docker.compose.project=freefounders)
```
Remove completely: `ff.sh down` (containers + networks; images and `data/` stay).

## Settings (`FF_HOME/.env`)
| Variable | Meaning |
|---|---|
| `FF_PORT` | host port of the gateway (7395) |
| `PUBLIC_WEB_URL` | the address people open (invite links, Assets QR codes, Tasks CSRF origin) |
| `TASKS_ALLOWED_HOSTS` | Django host names: the public host, localhost, 127.0.0.1, `tasks` (internal calls) |
| `COOKIE_SECURE` | `false` on plain http (Platform refresh cookie and Assets session cookie); `true` on https |
| `DEMO_MODE` | `1` = **open demo**: sign-up one-time codes are shown on screen (no email/SMS needed) and FakePay checkout works in this production build. **Unsafe for real customers** (anyone can sign up as any email/phone, and payments are fake). Default `0`. `BILLING_DEV_TOOLS` is always off here. |
| `FAKE_GATEWAY_SECRET` | FakePay signing secret (used only with `DEMO_MODE=1`) |
| `BILLING_GATEWAY` | `fake` (FakePay, open demo only) or `razorpay`. Without `DEMO_MODE=1` only `razorpay` works; anything missing → checkout answers 503 "Payments are not set up yet" and the reason is in the platform log (never a key) |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | Razorpay API keys and webhook secret. Set them only with `set-razorpay.sh` (below) |
| `OTP_SENDER` | `fake` (default: codes only in the platform log, and on screen with `DEMO_MODE=1`) or `msg91`. With `msg91` and a value missing, asking for a code answers 503 "Codes can't be sent right now" and the reason is in the platform log (never a key) |
| `MSG91_AUTHKEY`, `MSG91_SMS_TEMPLATE_ID`, `MSG91_EMAIL_TEMPLATE_ID`, `MSG91_EMAIL_FROM`, `MSG91_EMAIL_DOMAIN` | MSG91 authkey, DLT-approved OTP template, optional email template + From address + sending domain. Set them only with `set-msg91.sh` (below) |
| `PLATFORM_SECRET` | encrypts the Platform's signing keys at rest (≥ 32 chars). Changing it invalidates the keys. |
| `TASKS_SECRET_KEY`, `TASKS_SETTINGS_KEY` | Django secret key; per-company settings encryption key |
| `POSTGRES_PASSWORD`, `*_DB_PASSWORD` | database superuser and per-service roles (read at first Postgres start only) |
| `FF_COMPANY_*`, `FF_OWNER_*`, `FF_STAFF_*` | first company, owner login and staff account (`bootstrap.sh`) |
| `MOBILE_MIN_VERSION` | phone app update banner (PLAN.md §19.40). Empty (default) = off. Set it to the newest APK's version (e.g. `1.2.2`) after putting that APK at `FF_HOME/web/download/kaampilot.apk`: every installed app older than it shows a non-blocking banner "A new version of Kaampilot is available" with a link that downloads https://kaampilot.com/download/kaampilot.apk in the phone's browser. Then `ff.sh up -d platform`. |
| `MOBILE_APK_URL` | where that link goes: a path on this site (default `/download/kaampilot.apk`) or a full https:// address |
| `LOG_SINK_TOKEN` | optional: the shared token Tasks / Assets must send to the Platform's log sink (`/internal/logs`, PLAN.md §21.9). Empty (default) = internal network only |
| `LOG_RETENTION_DAYS`, `LOG_RATE_PER_MINUTE` | production log: days kept (30) and entries per minute per service (300); set in docker-compose if ever needed |

WhatsApp, Gmail and AI stay off (no keys). An Owner or Admin turns them on for their company in **Admin → Settings →
Integrations** (keys are write-only and stored encrypted with `TASKS_SETTINGS_KEY`); the command `ff.sh exec tasks
python manage.py company_setting <code> <NAME> <value>` still works. The containers have no internet until the
`internal` network is relaxed.

## Switching on Razorpay
Everything is built (PLAN.md §21.4); adding the keys is the only step. Start with **test keys**: they take no real money.

1. **Razorpay Dashboard** (dashboard.razorpay.com), Test mode switched on (top bar):
   - *Account & Settings → API Keys → Generate Test Key*: you get a **Key ID** (`rzp_test_…`) and a **Key Secret**
     (shown once; download it). Live keys (`rzp_live_…`) come after KYC (company PAN, GST, bank, website with
     Terms / Privacy / Refund pages).
   - *Subscriptions* must be enabled on the account (Test mode has it; for Live, ask Razorpay support to enable
     Subscriptions + UPI AutoPay).
   - *Account & Settings → Webhooks → Add New Webhook* (only once the site has a domain with https, see below):
     - URL: `https://<domain>/api/platform/billing/webhook/razorpay`
     - Secret: any long random text; the same text goes into `RAZORPAY_WEBHOOK_SECRET`
     - Active events: `subscription.authenticated`, `subscription.activated`, `subscription.charged`,
       `subscription.pending`, `subscription.halted`, `subscription.cancelled`, `subscription.completed`,
       `payment.captured`, `payment.failed`, `invoice.paid`
   - Leave Razorpay's own invoices/receipts as payment records only: **our GST invoice (Billing → Invoices) is the tax
     invoice**. The amounts sent to Razorpay already include 18 % GST, worked out by the Platform.
2. **On the server** (as the user that owns `/opt/freefounders`):
   ```
   bash /opt/freefounders/app/infra/deploy/set-razorpay.sh
   ```
   It asks for the Key ID, then the Key Secret and the Webhook Secret **without showing them** (`read -s`: not on screen,
   not in shell history, not in `ps`), writes them to `/opt/freefounders/.env` (mode 600), sets
   `BILLING_GATEWAY=razorpay` and recreates **only the platform container**. Leave the webhook secret empty while there
   is no https domain: a random one is stored; paste it into Razorpay later (`sudo grep RAZORPAY_WEBHOOK_SECRET
   /opt/freefounders/.env`). Back to FakePay: `bash …/set-razorpay.sh --off`.
3. Check: `app/infra/deploy/ff.sh logs --tail 30 platform` shows `Payments: Razorpay (test mode, key rzp_test_…)`. If a
   value is missing it shows `Payments are OFF (checkout answers 503): …` instead, and the rest of the app keeps working.
4. Try it: Billing → choose a plan → *Continue to payment* → *Pay* opens Razorpay Checkout. Use Razorpay's test cards
   / test UPI IDs (razorpay.com/docs/payments/payments/test-card-details; for subscriptions pick a card marked as
   supporting recurring payments). The plan is active at once and the GST invoice is in Billing → Invoices.

**What works on the http demo (`http://<ip>:7395`) and what needs a domain + https**
| | http demo (now) | domain + https |
|---|---|---|
| Checkout in a browser (modal), plan active at once, GST invoice | yes (the browser's success handler is verified on the server) | yes |
| Renewals, failed renewals (past due), cancellations made in Razorpay | the billing clock asks Razorpay after each period end (every 5 min until seen; past due 2 days after a missed charge) | yes, at once, by webhook (Razorpay sends webhooks only to public https URLs on port 443) |
| Phone app checkout (Razorpay redirect mode, UPI apps) | not reliable: Razorpay posts the result from https to an http address | yes |
The platform container reaches `api.razorpay.com` through its own `egress` network (docker-compose.yml); the databases
and the other APIs stay without internet.

**Live keys**: only with `DEMO_MODE=0` (no codes on screen, no FakePay), `COOKIE_SECURE=true` and https. Then run
`set-razorpay.sh` again with the `rzp_live_…` keys and add the webhook again in Live mode (Razorpay keeps separate
webhooks for Test and Live).

## Switching on MSG91 codes
Sign-up, forgot password and "Sign in with a code" (PLAN.md §21.8) send a 6-digit code. Our server makes and checks the
code (10 minutes, 5 tries, 30 s between codes, limits per number and per network); MSG91 only delivers it. Until it is
switched on, codes go to the platform log (and on screen while `DEMO_MODE=1`).

1. **What to get from MSG91** (control.msg91.com):
   - **Authkey**: under your name → *Authkey* (one key for SMS and email). Keep it secret.
   - **SMS (India needs DLT)**: register on a DLT portal (Jio / Vodafone Idea / Airtel / BSNL…) as the principal entity,
     get a **sender ID** (header, 6 letters, e.g. `KMPLOT`) and a **content template** of category *Service Implicit* /
     OTP approved there, with the code as the variable. Suggested text:
     `Your Kaampilot code is {#var#}. It is valid for 10 minutes. Do not share it with anyone.`
     (on the DLT portal the variable is `{#var#}`). Then in MSG91 → *OTP* → *Create template*: the same text with
     `##OTP##` in place of `{#var#}` (`Your Kaampilot code is ##OTP##. It is valid for 10 minutes. Do not share it with
     anyone.`), the sender ID and the **DLT template ID**. MSG91 gives an **OTP template ID**: that is
     `MSG91_SMS_TEMPLATE_ID`. The text must match the DLT template exactly, or operators drop the SMS.
   - **Email (optional)**: MSG91 → *Email* → *Domains*: add a sending domain (e.g. `mail.kaampilot.com`) and its DNS
     records (SPF, DKIM, the MSG91 return-path) until it shows verified. Then *Email* → *Templates* → a template using
     `{{otp}}`, `{{minutes}}`, `{{app}}` (Kaampilot) and `{{purpose}}` (sign in / finish signing up / reset your
     password), e.g. subject `Your {{app}} code: {{otp}}`, body `Use {{otp}} to {{purpose}}. It is valid for {{minutes}}
     minutes. If you did not ask for it, ignore this email.` Its ID is `MSG91_EMAIL_TEMPLATE_ID`; the From address
     (`no-reply@mail.kaampilot.com`) is `MSG91_EMAIL_FROM`. Without email, codes to an email address answer "Codes by
     email aren't set up yet" once `DEMO_MODE=0` (with `DEMO_MODE=1` they stay on screen as now).
   - **IP whitelisting**: if it is switched on for the authkey (MSG91 → Authkey → *IP security*), add the server's public
     IP **52.66.83.8**; otherwise MSG91 answers 401 and the platform log says "check MSG91_AUTHKEY and the IP whitelist".
   - Credits: SMS and email are prepaid in MSG91; a send without balance fails and the person sees "We couldn't send the
     code".
2. **On the server**:
   ```
   bash /opt/freefounders/app/infra/deploy/set-msg91.sh
   ```
   It asks for the authkey **without showing it** (`read -s`), then the OTP template ID and (optional) the email template,
   From address and domain, writes them to `/opt/freefounders/.env` (mode 600), sets `OTP_SENDER=msg91` and recreates
   **only the platform container**. Back to the fake sender: `bash …/set-msg91.sh --off`.
3. Check: `app/infra/deploy/ff.sh logs --tail 30 platform` shows `One-time codes: MSG91 (SMS: SendOTP template; email: …)`.
   A missing value shows `One-time codes are OFF (sending answers 503): …` instead; the rest of the app keeps working.
   Each send logs MSG91's request id and a masked number (`******3210`), never the code or the authkey.
4. **`DEMO_MODE` stays `1`** until the founder decides: codes are then sent by MSG91 **and** still shown on screen (test
   mode note). Setting `DEMO_MODE=0` (then `ff.sh up -d --no-deps platform`) hides on-screen codes for good: people
   need the real SMS / email, so do it only once SMS works (and email, or tell people to use their mobile number).

## Kaampilot console (staff) and the production log

The console (PLAN.md §21.9) is at **https://kaampilot.com/console** (or `http://<server>:7395/console`): every company,
every user, billing and the production log of all services. Only **Kaampilot staff accounts** open it (company owners
and admins get 403 and are sent Home). There is no staff account in the code for a server; it is made on the server:

1. **The bootstrap staff account** (made once by `bootstrap.sh` from `FF_STAFF_EMAIL` / `FF_STAFF_PASSWORD` in
   `FF_HOME/.env`). Sign in at `/login` with that email and password (read it on the server:
   `sudo grep FF_STAFF_ /opt/freefounders/.env`; never send it around), then account menu → **Kaampilot console**.
2. **Your own account as staff** (recommended for the founder): sign up at `/signup` with your own email or mobile
   (this makes an account and a company), then on the server:
   ```
   app/infra/deploy/ff.sh exec -T platform node dist/companies.js staff --email you@example.com
   ```
   (`--off` takes it away again). Sign out and in again; the console appears in the account menu. Staff status is
   checked in the database on every console call, so taking it away counts at once.

Every console view of a company or a person is written to the staff audit log (Companies tab → Recent actions).

**Production log**: Tasks, the Tasks worker and Assets send their errors to the Platform at
`http://platform:4000/internal/logs` on the internal Docker network (`PLATFORM_LOG_URL` in `tasks.env` and
`docker-compose.yml`); this path is outside `/api/platform`, so the gateway never forwards it. Optional extra lock: add
`LOG_SINK_TOKEN=<random>` to `FF_HOME/.env` (e.g. `head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n'`) and
`ff.sh up -d` (all three services read it). Entries are redacted (no secrets, tokens, codes or request bodies) and kept
30 days (`LOG_RETENTION_DAYS`). The **Health** strip shows each service's version: `ff.sh` passes the deployed commit as
`APP_VERSION` (containers pick it up on `ff.sh up -d`).

## Known limits of the http demo
- Browsers allow camera, microphone, geolocation and service workers only on https (or localhost): punch-in with
  GPS/selfie, QR scanning, voice notes and offline caching do not work on `http://<ip>:7395`. Put a domain + https in
  front (Caddy with a real site name) to get them; then set `COOKIE_SECURE=true` and `DEMO_MODE=0` for real use.
- Backups stay on this disk (see **Backups** below): copy `FF_HOME/backups` off the server (S3) before real data.

## Backups
`backup.sh` (nightly, from cron) writes into `FF_HOME/backups` (default `/opt/freefounders/backups`, mode 700):
- `db-<YYYY-MM-DD-HHMM>.sql.gz`: `pg_dumpall` of the stack's Postgres container: every database (`ff_platform`,
  `ff_tasks` with every company schema `co_*`, `ff_assets` with its company schemas) and the roles;
- `media-<YYYY-MM-DD-HHMM>.tar.gz`: the uploaded files, `data/tasks-media` and `data/assets-uploads`.

Files older than 14 days are deleted (`KEEP_DAYS=14`). It checks each file (`gzip -t`) and logs to
`FF_HOME/backups/backup.log`; it exits non-zero when the dump fails (an empty dump is removed, never kept).

Install (once, on the server):
```
cp /opt/freefounders/app/infra/deploy/backup.sh /opt/freefounders/backup.sh && chmod 700 /opt/freefounders/backup.sh
/opt/freefounders/backup.sh                         # a first run by hand; check backups/ and backups/backup.log
crontab -e                                          # add the line below (02:30 every night, server time)
30 2 * * * FF_HOME=/opt/freefounders /opt/freefounders/backup.sh >> /opt/freefounders/backups/backup.log 2>&1
```

Restore (everything, onto this stack; stops the apps first):
```
cd /opt/freefounders
app/infra/deploy/ff.sh stop platform tasks tasks-worker assets gateway
# 1. databases: drop the three app databases, then load the dump (it recreates them, with roles and schemas)
for db in ff_platform ff_tasks ff_assets; do
  app/infra/deploy/ff.sh exec -T postgres psql -U postgres -c "drop database if exists $db with (force)"
done
gunzip -c backups/db-<stamp>.sql.gz | app/infra/deploy/ff.sh exec -T postgres psql -U postgres -v ON_ERROR_STOP=0 -q postgres
# 2. uploaded files
tar -xzf backups/media-<stamp>.tar.gz -C /opt/freefounders      # restores data/tasks-media and data/assets-uploads
app/infra/deploy/ff.sh up -d
```
The "role … already exists" lines during step 1 are expected (the roles are kept). One company only: restore the dump
into a scratch Postgres and copy that company's schema (`co_<code>`) across with `pg_dump -n co_<code>`.

## kaampilot.com through the shared Caddy (2026-10-22)
https://kaampilot.com is served by the server's shared Caddy container `problem-app-caddy-1` (ports 80/443), which
forwards to this stack's gateway on host port 7395. Another team sometimes reloads that Caddy from its old,
bind-mounted Caddyfile, which drops routes added through its admin API. `kaampilot-caddy-watchdog.sh` (cron, every
minute, installed as `/opt/freefounders/kaampilot-caddy-watchdog.sh`) puts back only the kaampilot route
(`kaampilot-route.json`) when it is missing and Kaampilot is up; log in `/opt/freefounders/kaampilot-caddy-watchdog.log`.
Same pattern as `/home/ubuntu/pulse-caddy-watchdog.sh`. The host Caddyfile (`/home/ubuntu/problem-app/Caddyfile`) also
has the kaampilot block for the day that container is restarted.
