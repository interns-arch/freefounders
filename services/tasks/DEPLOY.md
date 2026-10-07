# EC2 deployment

Runs on the shared box at `52.66.83.8` as its own compose project in
`/home/ubuntu/automate-task/`. Roughly 25 unrelated containers share that host,
so everything here is deliberately scoped to this stack alone: own project
name, own network (`automate-task_default`), one published port, and no edits
to any shared file such as the `problem-app` Caddyfile.

`web` serves everything -- gunicorn answers `/api` and `/admin`, and WhiteNoise
serves the built React app at `/`. `db` holds the data and is reachable only
over the private compose network.

| | |
|---|---|
| Host port | `7001` -> container `8000` (only `web` is published) |
| Containers | `automate-task-web`, `automate-task-db` |
| Images | `automate-task:latest`, `postgres:18` |
| Uploads | named volume `automate-task_media` |
| Database | named volume `automate-task_pgdata` |
| Env | `/home/ubuntu/automate-task/.env` (mode 600, never in the image) |

## The database

Data lives in the local `db` container, migrated off Neon on 2026-09-22 from a
dump taken at the moment of cutover. The previous Neon URL is kept commented in
`.env` as `# NEON_DATABASE_URL=` -- that is the rollback path and the only
record of where the old data sits. Neon was left untouched and still holds a
frozen copy as of the cutover.

Three things about this setup are easy to get wrong:

**Postgres must be 18.x.** The data came from Neon's PostgreSQL 18.6, and
pg_restore cannot read an archive produced by a newer major version than
itself. A 17 container fails outright.

**`DB_SSLMODE=disable` is required.** `settings.py` defaults sslmode to
`require`, which was right for Neon but wrong here -- a container Postgres
serves no TLS, so without this the app cannot connect at all. Traffic never
leaves the docker network, so there is nothing to encrypt.

**The volume mounts at `/var/lib/postgresql`**, not `/var/lib/postgresql/data`.
The 18+ images store data in a major-version subdirectory and refuse to start
if the mount lands on the old path.

### Restoring a dump

    sudo docker cp <file>.dump automate-task-db:/tmp/r.dump
    sudo docker compose exec -T db psql -U automatetask -d automatetask \
      -c "drop schema public cascade; create schema public;"
    sudo docker compose exec -T db pg_restore -U automatetask -d automatetask \
      --no-owner --no-acl --no-comments /tmp/r.dump

`--no-owner --no-acl` matters: a Neon dump references roles (`neondb_owner`,
`neon_auth`, `neon_service`) that do not exist here. Restoring a raw Neon dump
rather than one already filtered also needs `--schema=public`, or the
`pg_session_jwt` extension and the `neon_auth`/`pgrst` schemas throw errors.
The Django app uses none of them.

**Always re-sync sequences afterwards.** pg_dump only emits `setval` for
sequences that were actually used, so a table seeded with explicit ids comes
back with its sequence at zero and the next insert collides on the primary key.
One table in this database (`mistakes_mistakesettings`) hits exactly that.
`deploy/fix-sequences.sql` does the correction and is safe to re-run:

    sudo docker compose exec -T db psql -U automatetask -d automatetask \
      -f /dev/stdin < deploy/fix-sequences.sql

### Backups

Nothing is scheduled yet -- worth adding. A manual one:

    sudo docker compose exec -T db pg_dump -U automatetask -Fc automatetask \
      > backup-$(date +%F).dump

## Redeploy

From the project root on the dev machine:

    tar czf app.tgz --exclude='./.git' --exclude='./frontend/node_modules' \
      --exclude='./frontend/dist' --exclude='./backend/.venv' \
      --exclude='./backend/.env' --exclude='./backend/db.sqlite3' \
      --exclude='./backend/staticfiles' --exclude='__pycache__' .
    scp -i <key.pem> app.tgz ubuntu@52.66.83.8:/home/ubuntu/automate-task/

Then on the server:

    cd /home/ubuntu/automate-task
    tar xzf app.tgz && rm app.tgz          # .env is excluded above, so it survives
    sudo docker compose up -d --build web  # `web` only -- leaves the database up

`docker compose` only ever touches this project. Never run `docker system
prune -a` on this host: several tagged-but-stopped images are other stacks'
rollback targets.

## Notes on the runtime

**One gunicorn worker, eight threads.** `notifications/apps.py` starts a
follow-up-reminder ticker inside every serving process, so two workers would
mean every reminder is sent twice to real WhatsApp/Gmail recipients. Threads
provide the concurrency instead. If you ever need more workers, move the ticker
out into its own container first.

**Migrations run at container start**, not at build time, because the build has
no network path to Postgres.

**`/admin` needs HTTPS.** `settings.py` sets `SESSION_COOKIE_SECURE` and
`CSRF_COOKIE_SECURE` whenever `DEBUG=false`, so browsers will not send the
session cookie over plain `http://52.66.83.8:7001` and the admin login will
silently fail to stick. The React app is unaffected -- it authenticates with
JWTs in localStorage, no cookies. To get admin working, front the app with the
existing Caddy on a domain (free Let's Encrypt cert) rather than turning
`DEBUG` back on.

## Access

Port 7001 must be open inbound in security group `launch-wizard-7` for the
elastic IP to serve it. Until then, reach it over an SSH tunnel:

    ssh -i <key.pem> -N -L 7001:127.0.0.1:7001 ubuntu@52.66.83.8
    # then open http://127.0.0.1:7001
