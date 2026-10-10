#!/usr/bin/env bash
# Render build script — prepares Django (API only; the screens are the FreeFounders web app, apps/web).
set -o errexit

echo "--- backend setup ---"
cd backend
pip install -r requirements.txt
python manage.py collectstatic --noinput
python manage.py migrate
