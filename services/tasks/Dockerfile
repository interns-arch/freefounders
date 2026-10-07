# Single-image deploy: the React app is built, then served by WhiteNoise from
# the same Django/gunicorn process that answers /api. One container, one port.
#
# Mirrors what render-build.sh does on Render, so the two stay interchangeable.

# ---------- stage 1: build the React app ----------
FROM node:20-alpine AS frontend

WORKDIR /app/frontend
# Lockfile first so the dependency layer is cached across source-only changes.
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
# `npm run build` = vite build + stamp-sw.mjs (versions sw.js for PWA updates)
RUN npm run build


# ---------- stage 2: the Django runtime ----------
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend/ ./backend/
# settings.py resolves FRONTEND_DIST as BASE_DIR.parent/frontend/dist, so the
# built app has to land at exactly this path for WhiteNoise to serve "/".
COPY --from=frontend /app/frontend/dist ./frontend/dist

WORKDIR /app/backend

# Baked at build time so startup is just migrate + serve. The placeholder
# SECRET_KEY never reaches the running app — compose supplies the real one.
RUN SECRET_KEY=collectstatic-build-only DEBUG=false \
    python manage.py collectstatic --noinput

COPY deploy/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8000
ENTRYPOINT ["/entrypoint.sh"]
