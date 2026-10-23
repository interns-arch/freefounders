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
| `PLATFORM_SECRET` | encrypts the Platform's signing keys at rest (≥ 32 chars). Changing it invalidates the keys. |
| `TASKS_SECRET_KEY`, `TASKS_SETTINGS_KEY` | Django secret key; per-company settings encryption key |
| `POSTGRES_PASSWORD`, `*_DB_PASSWORD` | database superuser and per-service roles (read at first Postgres start only) |
| `FF_COMPANY_*`, `FF_OWNER_*`, `FF_STAFF_*` | first company, owner login and staff account (`bootstrap.sh`) |

WhatsApp, Gmail and AI stay off (no keys). To turn them on for a company later: `ff.sh exec tasks python manage.py
company_setting <code> <NAME> <value>` (the containers have no internet until the `internal` network is relaxed).

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

## Known limits of the http demo
- Browsers allow camera, microphone, geolocation and service workers only on https (or localhost): punch-in with
  GPS/selfie, QR scanning, voice notes and offline caching do not work on `http://<ip>:7395`. Put a domain + https in
  front (Caddy with a real site name) to get them; then set `COOKIE_SECURE=true` and `DEMO_MODE=0` for real use.
- No backups yet: `data/postgres` lives only on this disk. Before real data: a nightly
  `ff.sh exec -T postgres pg_dumpall -U postgres | gzip > …` to S3.

## kaampilot.com through the shared Caddy (2026-10-22)
https://kaampilot.com is served by the server's shared Caddy container `problem-app-caddy-1` (ports 80/443), which
forwards to this stack's gateway on host port 7395. Another team sometimes reloads that Caddy from its old,
bind-mounted Caddyfile, which drops routes added through its admin API. `kaampilot-caddy-watchdog.sh` (cron, every
minute, installed as `/opt/freefounders/kaampilot-caddy-watchdog.sh`) puts back only the kaampilot route
(`kaampilot-route.json`) when it is missing and Kaampilot is up; log in `/opt/freefounders/kaampilot-caddy-watchdog.log`.
Same pattern as `/home/ubuntu/pulse-caddy-watchdog.sh`. The host Caddyfile (`/home/ubuntu/problem-app/Caddyfile`) also
has the kaampilot block for the day that container is restarted.
