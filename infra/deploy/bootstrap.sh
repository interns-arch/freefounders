#!/bin/sh
# Once, after the first `./ff.sh up -d`: creates the first company + owner login and the /console staff account from
# FF_* in FF_HOME/.env (values are passed by name, never printed), then sets the company up in Tasks and Assets.
# Safe to repeat: the seed does nothing when a company exists; sync is idempotent.
set -eu
FF_HOME="${FF_HOME:-/opt/freefounders}"
HERE="$(cd "$(dirname "$0")" && pwd)"
set -a
. "$FF_HOME/.env"
set +a
COMPANY_CODE="$FF_COMPANY_CODE" COMPANY_NAME="$FF_COMPANY_NAME" OWNER_NAME="${FF_OWNER_NAME:-Owner}" \
OWNER_EMAIL="$FF_OWNER_EMAIL" OWNER_LOGIN="$FF_OWNER_LOGIN" OWNER_PASSWORD="$FF_OWNER_PASSWORD" \
STAFF_EMAIL="$FF_STAFF_EMAIL" STAFF_PASSWORD="$FF_STAFF_PASSWORD" \
  "$HERE/ff.sh" exec -T -e COMPANY_CODE -e COMPANY_NAME -e OWNER_NAME -e OWNER_EMAIL -e OWNER_LOGIN -e OWNER_PASSWORD \
  -e STAFF_EMAIL -e STAFF_PASSWORD platform node dist/seed.js --bootstrap
"$HERE/ff.sh" exec -T -e FF_CLI=true platform node dist/companies.js sync
