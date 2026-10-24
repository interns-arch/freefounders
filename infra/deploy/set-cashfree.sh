#!/bin/bash
# Switches payments to Cashfree on this server (PLAN.md §21.10, README.md "Switching on Cashfree payments"):
#   app/infra/deploy/set-cashfree.sh          asks for the App ID, the Secret Key (hidden) and the environment
#                                             (production / sandbox), then recreates the Platform
#   app/infra/deploy/set-cashfree.sh --off    back to FakePay (PAYMENT_GATEWAY=fake; the keys stay in .env). FakePay
#                                             takes payments only on the open demo (DEMO_MODE=1); otherwise checkout
#                                             answers "Payments are not set up yet".
# Cashfree Merchant Dashboard → Payment Gateway → Developers → API Keys (merchant.cashfree.com/merchants/pg/developers/api-keys).
# The Secret Key is typed without echo (read -s): never on screen, in shell history or in `ps`. Values are written only
# to FF_HOME/.env (mode 600). Only the platform container is recreated; nothing else restarts. DEMO_MODE is not changed.
set -euo pipefail
FF_HOME="${FF_HOME:-/opt/freefounders}"
ENV="$FF_HOME/.env"
HERE="$(cd "$(dirname "$0")" && pwd)"
[ -f "$ENV" ] || { echo "✖ $ENV not found (run gen-env.sh first)"; exit 1; }

# set_var NAME: sets NAME=<value of the shell variable NAME> in .env (replaces the line or appends it). The value goes
# through the environment, never through a command line.
set_var() {
  local tmp
  tmp="$(mktemp "$FF_HOME/.env.XXXXXX")"
  chmod 600 "$tmp"
  KEY="$1" VAL="${!1}" awk 'BEGIN { k = ENVIRON["KEY"]; v = ENVIRON["VAL"]; done = 0 }
    $0 ~ "^" k "=" { print k "=" v; done = 1; next }
    { print }
    END { if (!done) print k "=" v }' "$ENV" > "$tmp"
  mv "$tmp" "$ENV"
}

restart_platform() {
  echo "… recreating the platform container with the new settings"
  "$HERE/ff.sh" up -d --no-deps platform
  echo "  check: $HERE/ff.sh logs --tail 30 platform   (look for \"Payments: Cashfree …\")"
}

umask 077
# The older name of the switch (BILLING_GATEWAY, maybe still "razorpay") must not win over PAYMENT_GATEWAY: it is
# only read when PAYMENT_GATEWAY is empty, so PAYMENT_GATEWAY is always written below.
if [ "${1:-}" = "--off" ]; then
  PAYMENT_GATEWAY=fake
  set_var PAYMENT_GATEWAY
  echo "✔ PAYMENT_GATEWAY=fake (FakePay; real checkouts answer 503 unless DEMO_MODE=1)"
  restart_platform
  exit 0
fi

echo "Cashfree Merchant Dashboard → Payment Gateway → Developers → API Keys"
echo "(merchant.cashfree.com/merchants/pg/developers/api-keys). Use the keys of the environment you choose below."
read -r -p "App ID (x-client-id): " CASHFREE_APP_ID
CASHFREE_APP_ID="$(printf '%s' "$CASHFREE_APP_ID" | tr -d '[:space:]')"
[[ "$CASHFREE_APP_ID" =~ ^[A-Za-z0-9_-]{4,100}$ ]] || { echo "✖ That does not look like a Cashfree App ID. Nothing was changed."; exit 1; }
read -r -s -p "Secret Key (hidden): " CASHFREE_SECRET_KEY; echo
CASHFREE_SECRET_KEY="$(printf '%s' "$CASHFREE_SECRET_KEY" | tr -d '[:space:]')"
[ ${#CASHFREE_SECRET_KEY} -ge 16 ] || { echo "✖ The Secret Key looks too short. Nothing was changed."; exit 1; }
read -r -p "Environment, production or sandbox (Enter = production): " CASHFREE_ENV
CASHFREE_ENV="$(printf '%s' "${CASHFREE_ENV:-production}" | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')"
case "$CASHFREE_ENV" in
  production|prod|live) CASHFREE_ENV=production ;;
  sandbox|test) CASHFREE_ENV=sandbox ;;
  *) echo "✖ Type production or sandbox. Nothing was changed."; exit 1 ;;
esac

PAYMENT_GATEWAY=cashfree
for v in CASHFREE_APP_ID CASHFREE_SECRET_KEY CASHFREE_ENV PAYMENT_GATEWAY; do set_var "$v"; done
chmod 600 "$ENV"
unset CASHFREE_SECRET_KEY
echo "✔ PAYMENT_GATEWAY=cashfree ($CASHFREE_ENV), App ID ${CASHFREE_APP_ID:0:6}…, Secret Key saved in $ENV (mode 600)"
echo "  Cashfree dashboard → Developers → Webhooks: add https://kaampilot.com/api/platform/billing/webhooks/cashfree"
echo "  (Payment success + failed events). Developers → Whitelisting: kaampilot.com must be approved for production."
restart_platform
