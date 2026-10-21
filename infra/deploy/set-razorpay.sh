#!/bin/bash
# Switches payments to Razorpay on this server (PLAN.md §21.4, README.md "Switching on Razorpay"):
#   app/infra/deploy/set-razorpay.sh          asks for the Key ID, Key Secret and Webhook Secret, then restarts the Platform
#   app/infra/deploy/set-razorpay.sh --off    back to FakePay (BILLING_GATEWAY=fake; the keys stay in .env)
# The secrets are typed without echo (read -s): they never appear on screen, in shell history or in `ps`. They are
# written only to FF_HOME/.env (mode 600). Only the platform container is recreated; nothing else restarts.
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
  echo "  check: $HERE/ff.sh logs --tail 30 platform   (look for \"Payments: Razorpay (test mode…)\")"
}

umask 077
if [ "${1:-}" = "--off" ]; then
  BILLING_GATEWAY=fake
  set_var BILLING_GATEWAY
  echo "✔ BILLING_GATEWAY=fake (FakePay works only with DEMO_MODE=1)"
  restart_platform
  exit 0
fi

echo "Razorpay Dashboard → Account & Settings → API Keys. Use TEST keys (rzp_test_…) until KYC is done."
read -r -p "Key ID (rzp_test_… or rzp_live_…): " RAZORPAY_KEY_ID
RAZORPAY_KEY_ID="$(printf '%s' "$RAZORPAY_KEY_ID" | tr -d '[:space:]')"
[[ "$RAZORPAY_KEY_ID" =~ ^rzp_(test|live)_[A-Za-z0-9]+$ ]] || { echo "✖ That is not a Razorpay Key ID"; exit 1; }

read -r -s -p "Key Secret (hidden): " RAZORPAY_KEY_SECRET; echo
RAZORPAY_KEY_SECRET="$(printf '%s' "$RAZORPAY_KEY_SECRET" | tr -d '[:space:]')"
[ ${#RAZORPAY_KEY_SECRET} -ge 12 ] || { echo "✖ The Key Secret looks too short"; exit 1; }

echo "Webhook Secret: the secret you type in Razorpay Dashboard → Webhooks for"
echo "  https://<your domain>/api/platform/billing/webhook/razorpay"
echo "Leave it empty to make a random one now (no webhook yet, e.g. on the http demo); later, read it with"
echo "  sudo grep RAZORPAY_WEBHOOK_SECRET $ENV   and paste it into Razorpay when you add the webhook."
read -r -s -p "Webhook Secret (hidden, empty = random): " RAZORPAY_WEBHOOK_SECRET; echo
RAZORPAY_WEBHOOK_SECRET="$(printf '%s' "$RAZORPAY_WEBHOOK_SECRET" | tr -d '[:space:]')"
if [ -z "$RAZORPAY_WEBHOOK_SECRET" ]; then
  RAZORPAY_WEBHOOK_SECRET="$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  echo "  made a random webhook secret (stored in $ENV only)"
fi

BILLING_GATEWAY=razorpay
for v in RAZORPAY_KEY_ID RAZORPAY_KEY_SECRET RAZORPAY_WEBHOOK_SECRET BILLING_GATEWAY; do set_var "$v"; done
chmod 600 "$ENV"
unset RAZORPAY_KEY_SECRET RAZORPAY_WEBHOOK_SECRET
echo "✔ $ENV: BILLING_GATEWAY=razorpay, RAZORPAY_KEY_ID=$RAZORPAY_KEY_ID, secrets saved (not shown)"
if [[ "$RAZORPAY_KEY_ID" == rzp_live_* ]] && grep -q '^DEMO_MODE=1' "$ENV"; then
  echo "⚠ LIVE keys with DEMO_MODE=1: anyone can sign up as any email/phone (codes on screen). Set DEMO_MODE=0 and"
  echo "  COOKIE_SECURE=true (https) before taking real money."
fi
restart_platform
