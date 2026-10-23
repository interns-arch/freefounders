# The Tasks API (Django/gunicorn). The screens are the Kaampilot web app (apps/web), served by the gateway.
# Mirrors what render-build.sh does on Render, so the two stay interchangeable.
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend/ ./backend/

WORKDIR /app/backend

# Baked at build time so startup is just migrate + serve. The placeholder
# SECRET_KEY never reaches the running app — compose supplies the real one.
RUN SECRET_KEY=collectstatic-build-only DEBUG=false \
    python manage.py collectstatic --noinput

COPY deploy/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8000
ENTRYPOINT ["/entrypoint.sh"]
