#!/bin/bash
# Switches email codes to Resend on this server (PLAN.md §21.8, README.md "Switching on Resend email codes"):
#   app/infra/deploy/set-resend.sh         asks for the Resend API key (hidden) and the From address, then recreates
#                                          the Platform
#   app/infra/deploy/set-resend.sh --off   back to the fake sender (OTP_SENDER=fake; the values stay in .env)
# The key is typed without echo (read -s): never on screen, in shell history or in `ps`. Values are written only to
# FF_HOME/.env (mode 600). Only the platform container is recreated. DEMO_MODE is not changed.
set -euo pipefail
FF_HOME="${FF_HOME:-/opt/freefounders}"
ENV="$FF_HOME/.env"
HERE="$(cd "$(dirname "$0")" && pwd)"
[ -f "$ENV" ] || { echo "✖ $ENV not found (run gen-env.sh first)"; exit 1; }

# set_var NAME: sets NAME=<value of the shell variable NAME> in .env; the value goes through the environment only.
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
  echo "  check: $HERE/ff.sh logs --tail 30 platform   (look for \"One-time codes: Resend …\")"
}

umask 077
if [ "${1:-}" = "--off" ]; then
  OTP_SENDER=fake
  set_var OTP_SENDER
  echo "✔ OTP_SENDER=fake (codes go to the platform log; with DEMO_MODE=1 they are also shown on screen)"
  restart_platform
  exit 0
fi

echo "Resend (resend.com): API Keys → Create API key (Sending access). The domain kaampilot.com must be Verified."
read -r -s -p "API key (hidden): " RESEND_API_KEY; echo
RESEND_API_KEY="$(printf '%s' "$RESEND_API_KEY" | tr -d '[:space:]')"
[[ "$RESEND_API_KEY" =~ ^re_[A-Za-z0-9_]{16,}$ ]] || { echo "✖ That does not look like a Resend key (starts with re_). Nothing was changed."; exit 1; }

read -r -p "From (Enter = Kaampilot <otp@kaampilot.com>): " RESEND_FROM
RESEND_FROM="${RESEND_FROM:-Kaampilot <otp@kaampilot.com>}"
[[ "$RESEND_FROM" =~ @[^@[:space:]\>]+\.[^@[:space:]\>]+ ]] || { echo "✖ That From has no email address. Nothing was changed."; exit 1; }

# Check the key before saving it: Resend answers 401/403 for a bad key. GET /domains needs a full-access key, so a
# sending-only key answers 401 "restricted_api_key" there: that one is accepted as valid.
BODY="$(curl -s -w ' HTTP%{http_code}' --max-time 15 -K - <<<"header = \"Authorization: Bearer $RESEND_API_KEY\"
url = \"https://api.resend.com/domains\"" || echo ' HTTP000')"
CHECK="${BODY##* HTTP}"
if [ "$CHECK" = "200" ] || grep -q restricted_api_key <<<"$BODY"; then
  echo "✔ Resend accepted the key"
else
  echo "✖ Resend refused the key (HTTP $CHECK). Nothing was changed."; exit 1
fi

OTP_SENDER=resend
for v in RESEND_API_KEY RESEND_FROM OTP_SENDER; do set_var "$v"; done
chmod 600 "$ENV"
unset RESEND_API_KEY
echo "✔ $ENV: OTP_SENDER=resend, from $RESEND_FROM, key saved (not shown)"
if grep -q '^DEMO_MODE=1' "$ENV"; then
  echo "ℹ DEMO_MODE=1 is unchanged: email codes are sent by Resend AND still shown on screen (test mode)."
fi
restart_platform
