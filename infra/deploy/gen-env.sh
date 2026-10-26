#!/bin/sh
# Writes FF_HOME/.env with fresh random secrets (mode 600). Refuses to overwrite an existing file.
#   PUBLIC_HOST=52.66.83.8 ./gen-env.sh
set -eu
FF_HOME="${FF_HOME:-/opt/freefounders}"
ENV="$FF_HOME/.env"
[ -e "$ENV" ] && { echo "✖ $ENV exists; edit it instead"; exit 1; }
: "${PUBLIC_HOST:?set PUBLIC_HOST (the server address or domain)}"
PORT="${FF_PORT:-7395}"
rnd() { head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'; }
umask 077
cat > "$ENV" <<VARS
# Kaampilot secrets for this server. Mode 600; never commit, never copy into the repo.
FF_HOME=$FF_HOME
FF_PORT=$PORT
PUBLIC_WEB_URL=http://$PUBLIC_HOST:$PORT
TASKS_ALLOWED_HOSTS=$PUBLIC_HOST,localhost,127.0.0.1,tasks
# Plain http: the sign-in cookies cannot be Secure-only. Set true once the site is on https.
COOKIE_SECURE=false
# Open demo: one-time codes on screen + FakePay. Set 0 before any real customer signs up.
DEMO_MODE=1
POSTGRES_PASSWORD=$(rnd 24)
PLATFORM_DB_PASSWORD=$(rnd 24)
TASKS_DB_PASSWORD=$(rnd 24)
ASSETS_DB_PASSWORD=$(rnd 24)
PLATFORM_SECRET=$(rnd 32)
TASKS_SECRET_KEY=$(rnd 40)
TASKS_SETTINGS_KEY=$(rnd 32)
FAKE_GATEWAY_SECRET=$(rnd 24)
# Payments: fake = FakePay (open demo only). Cashfree is switched on with infra/deploy/set-cashfree.sh, which asks for
# the App ID, the Secret Key (hidden) and the environment, and sets PAYMENT_GATEWAY=cashfree
# (README.md "Switching on Cashfree payments").
PAYMENT_GATEWAY=fake
CASHFREE_APP_ID=
CASHFREE_SECRET_KEY=
CASHFREE_ENV=sandbox
# First company (created once by README step 5) and the staff account for /console.
FF_COMPANY_CODE=DEMO
FF_COMPANY_NAME="Kaampilot Demo"
FF_OWNER_LOGIN=owner
FF_OWNER_EMAIL=owner@kaampilot.demo
FF_OWNER_PASSWORD=Ff-$(rnd 9)
FF_STAFF_EMAIL=staff@kaampilot.demo
FF_STAFF_PASSWORD=Ff-$(rnd 12)
VARS
chmod 600 "$ENV"
echo "✔ wrote $ENV"
