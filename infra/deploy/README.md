# Deploying FreeFounders on a shared Docker host

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
| `PLATFORM_SECRET` | encrypts the Platform's signing keys at rest (≥ 32 chars). Changing it invalidates the keys. |
| `TASKS_SECRET_KEY`, `TASKS_SETTINGS_KEY` | Django secret key; per-company settings encryption key |
| `POSTGRES_PASSWORD`, `*_DB_PASSWORD` | database superuser and per-service roles (read at first Postgres start only) |
| `FF_COMPANY_*`, `FF_OWNER_*`, `FF_STAFF_*` | first company, owner login and staff account (`bootstrap.sh`) |

WhatsApp, Gmail and AI stay off (no keys). To turn them on for a company later: `ff.sh exec tasks python manage.py
company_setting <code> <NAME> <value>` (the containers have no internet until the `internal` network is relaxed).

## Known limits of the http demo
- Browsers allow camera, microphone, geolocation and service workers only on https (or localhost): punch-in with
  GPS/selfie, QR scanning, voice notes and offline caching do not work on `http://<ip>:7395`. Put a domain + https in
  front (Caddy with a real site name) to get them; then set `COOKIE_SECURE=true` and `DEMO_MODE=0` for real use.
- No backups yet: `data/postgres` lives only on this disk. Before real data: a nightly
  `ff.sh exec -T postgres pg_dumpall -U postgres | gzip > …` to S3.
