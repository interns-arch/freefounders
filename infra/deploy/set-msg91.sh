#!/bin/bash
# Switches one-time codes to MSG91 on this server (PLAN.md §21.8, README.md "Switching on MSG91 codes"):
#   app/infra/deploy/set-msg91.sh          asks for the authkey, the SMS (OTP) template ID (optional: Enter = skip SMS)
#                                          and the email template + From (optional too; at least one of SMS / email is
#                                          needed), then recreates the Platform. Email only is the setup while SMS waits
#                                          for DLT approval (founder 2026-10-24).
#   app/infra/deploy/set-msg91.sh --off    back to the fake sender (OTP_SENDER=fake; the values stay in .env)
# The authkey is typed without echo (read -s): never on screen, in shell history or in `ps`. Values are written only to
# FF_HOME/.env (mode 600). Only the platform container is recreated; nothing else restarts. DEMO_MODE is not changed.
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
  echo "  check: $HERE/ff.sh logs --tail 30 platform   (look for \"One-time codes: MSG91 …\")"
}

umask 077
if [ "${1:-}" = "--off" ]; then
  OTP_SENDER=fake
  set_var OTP_SENDER
  echo "✔ OTP_SENDER=fake (codes go to the platform log; with DEMO_MODE=1 they are also shown on screen)"
  restart_platform
  exit 0
fi

echo "MSG91 panel (control.msg91.com): the authkey is under your name → Authkey (or API → Authkey)."
read -r -s -p "Authkey (hidden): " MSG91_AUTHKEY; echo
MSG91_AUTHKEY="$(printf '%s' "$MSG91_AUTHKEY" | tr -d '[:space:]')"
[ ${#MSG91_AUTHKEY} -ge 16 ] || { echo "✖ The authkey looks too short"; exit 1; }

echo "SMS (optional; Enter = skip SMS): the template ID of your OTP template (MSG91 → OTP → Templates). Its text must"
echo "contain ##OTP## and be DLT-approved, e.g.: Your Kaampilot code is ##OTP##. It is valid for 10 minutes. Do not share it."
echo "Without SMS, codes for a mobile number answer \"Codes by SMS aren't set up yet. Use your email address instead.\""
read -r -p "OTP template ID (Enter = skip SMS): " MSG91_SMS_TEMPLATE_ID
MSG91_SMS_TEMPLATE_ID="$(printf '%s' "$MSG91_SMS_TEMPLATE_ID" | tr -d '[:space:]')"
if [ -n "$MSG91_SMS_TEMPLATE_ID" ]; then
  [[ "$MSG91_SMS_TEMPLATE_ID" =~ ^[A-Za-z0-9_-]{6,64}$ ]] || { echo "✖ That does not look like a template ID"; exit 1; }
fi

echo "Email: the template ID of an MSG91 email template using {{otp}} and {{minutes}} (also {{app}}, {{purpose}}), and"
echo "a From address on a domain verified in MSG91 → Email → Domains (mail.kaampilot.com)."
read -r -p "Email template ID (Enter = skip email): " MSG91_EMAIL_TEMPLATE_ID
MSG91_EMAIL_TEMPLATE_ID="$(printf '%s' "$MSG91_EMAIL_TEMPLATE_ID" | tr -d '[:space:]')"
MSG91_EMAIL_FROM=""
MSG91_EMAIL_DOMAIN=""
if [ -z "$MSG91_SMS_TEMPLATE_ID" ] && [ -z "$MSG91_EMAIL_TEMPLATE_ID" ]; then
  echo "✖ Nothing to send with: enter the SMS template ID, the email template ID, or both. Nothing was changed."
  exit 1
fi
if [ -n "$MSG91_EMAIL_TEMPLATE_ID" ]; then
  read -r -p "From address (Enter = no-reply@mail.kaampilot.com): " MSG91_EMAIL_FROM
  MSG91_EMAIL_FROM="$(printf '%s' "${MSG91_EMAIL_FROM:-no-reply@mail.kaampilot.com}" | tr -d '[:space:]')"
  [[ "$MSG91_EMAIL_FROM" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]] || { echo "✖ That is not an email address"; exit 1; }
  read -r -p "Sending domain (Enter = ${MSG91_EMAIL_FROM#*@}): " MSG91_EMAIL_DOMAIN
  MSG91_EMAIL_DOMAIN="$(printf '%s' "${MSG91_EMAIL_DOMAIN:-${MSG91_EMAIL_FROM#*@}}" | tr -d '[:space:]')"
fi

OTP_SENDER=msg91
for v in MSG91_AUTHKEY MSG91_SMS_TEMPLATE_ID MSG91_EMAIL_TEMPLATE_ID MSG91_EMAIL_FROM MSG91_EMAIL_DOMAIN OTP_SENDER; do set_var "$v"; done
chmod 600 "$ENV"
unset MSG91_AUTHKEY
EMAIL_STATE="off"
[ -n "$MSG91_EMAIL_TEMPLATE_ID" ] && EMAIL_STATE="on (template $MSG91_EMAIL_TEMPLATE_ID, from $MSG91_EMAIL_FROM)"
SMS_STATE="off"
[ -n "$MSG91_SMS_TEMPLATE_ID" ] && SMS_STATE="on (template $MSG91_SMS_TEMPLATE_ID)"
echo "✔ $ENV: OTP_SENDER=msg91, SMS $SMS_STATE, email $EMAIL_STATE, authkey saved (not shown)"
if grep -q '^DEMO_MODE=1' "$ENV"; then
  echo "ℹ DEMO_MODE=1 is unchanged: codes are sent by MSG91 AND still shown on screen (test mode). Set DEMO_MODE=0 in"
  echo "  $ENV (then ff.sh up -d --no-deps platform) to stop showing them; a channel that is off then answers"
  echo "  \"Codes by SMS/email aren't set up yet\" (with DEMO_MODE=1 it stays on the fake sender, code on screen)."
fi
echo "ℹ If IP whitelisting is on in MSG91, this server's public IP must be on the list (52.66.83.8)."
restart_platform
