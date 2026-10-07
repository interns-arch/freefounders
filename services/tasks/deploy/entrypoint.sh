#!/usr/bin/env sh
# Migrations run here rather than at build time: the build has no network path
# to the Postgres instance, and the schema must be current before traffic lands.
set -e

echo "--- migrate ---"
python manage.py migrate --noinput

echo "--- serving on :8000 ---"
# One worker on purpose. notifications/apps.py starts a follow-up-reminder
# ticker per gunicorn process, so N workers would send every reminder N times
# to real WhatsApp/Gmail recipients. Threads carry the concurrency instead.
exec gunicorn config.wsgi:application \
    --bind 0.0.0.0:8000 \
    --workers 1 \
    --threads 8 \
    --timeout 120 \
    --access-logfile - \
    --error-logfile -
