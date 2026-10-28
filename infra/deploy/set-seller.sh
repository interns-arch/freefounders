#!/bin/bash
# Sets who sells on the GST invoices (PLAN.md §24.5, README.md "Seller GST details for invoices"):
#   app/infra/deploy/set-seller.sh    asks for the legal name, GSTIN, state and address, checks them, writes them to
#                                     FF_HOME/.env (SELLER_NAME, SELLER_GSTIN, SELLER_STATE, SELLER_ADDRESS) and
#                                     recreates the Platform only.
# These values are printed on every invoice (they are not secret), so they are read normally. Until they are set, a
# production server still makes invoices (with the test seller) but does NOT email them and logs
# "Seller GST details not set". Invoices already made keep the seller they were made with.
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

# State name → GST state code (services/platform/src/billing/gst.ts INDIAN_STATES; codes as in packages/core billing).
declare -A CODES=(
  ["Andaman and Nicobar Islands"]=35 ["Andhra Pradesh"]=37 ["Arunachal Pradesh"]=12 ["Assam"]=18 ["Bihar"]=10
  ["Chandigarh"]=04 ["Chhattisgarh"]=22 ["Dadra and Nagar Haveli and Daman and Diu"]=26 ["Delhi"]=07 ["Goa"]=30
  ["Gujarat"]=24 ["Haryana"]=06 ["Himachal Pradesh"]=02 ["Jammu and Kashmir"]=01 ["Jharkhand"]=20 ["Karnataka"]=29
  ["Kerala"]=32 ["Ladakh"]=38 ["Lakshadweep"]=31 ["Madhya Pradesh"]=23 ["Maharashtra"]=27 ["Manipur"]=14
  ["Meghalaya"]=17 ["Mizoram"]=15 ["Nagaland"]=13 ["Odisha"]=21 ["Puducherry"]=34 ["Punjab"]=03 ["Rajasthan"]=08
  ["Sikkim"]=11 ["Tamil Nadu"]=33 ["Telangana"]=36 ["Tripura"]=16 ["Uttar Pradesh"]=09 ["Uttarakhand"]=05
  ["West Bengal"]=19
)
GSTIN_RE='^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'
TEST_GSTIN='27AAAAA0000A1Z5'
trim() { local s="$1"; s="${s#"${s%%[![:space:]]*}"}"; printf '%s' "${s%"${s##*[![:space:]]}"}"; }
# .env values are written in single quotes (docker compose reads them literally: no $ interpolation, no # comments).
plain() { [[ "$1" != *"'"* && "$1" != *'\'* ]] || { echo "✖ Please leave out ' and \\ characters. Nothing was changed."; exit 1; }; }

echo "Seller details for Kaampilot's GST invoices (exactly as on the GST registration certificate)."
read -r -p "Legal name: " SELLER_NAME
SELLER_NAME="$(trim "$SELLER_NAME")"
[ "${#SELLER_NAME}" -ge 3 ] || { echo "✖ Enter the legal name. Nothing was changed."; exit 1; }
plain "$SELLER_NAME"

read -r -p "GSTIN (15 characters): " SELLER_GSTIN
SELLER_GSTIN="$(trim "$SELLER_GSTIN" | tr '[:lower:]' '[:upper:]')"
[[ "$SELLER_GSTIN" =~ $GSTIN_RE ]] || { echo "✖ That is not a valid GSTIN (like 27AAPFU0939F1ZV). Nothing was changed."; exit 1; }
[ "$SELLER_GSTIN" != "$TEST_GSTIN" ] || { echo "✖ That is the test GSTIN. Enter the real one. Nothing was changed."; exit 1; }

read -r -p "State (e.g. Maharashtra): " STATE_IN
STATE_IN="$(trim "$STATE_IN")"
SELLER_STATE=""
for s in "${!CODES[@]}"; do
  if [ "${s,,}" = "${STATE_IN,,}" ]; then SELLER_STATE="$s"; fi
done
[ -n "$SELLER_STATE" ] || { echo "✖ \"$STATE_IN\" is not an Indian state or union territory (write it in full, e.g. Tamil Nadu). Nothing was changed."; exit 1; }
[ "${SELLER_GSTIN:0:2}" = "${CODES[$SELLER_STATE]}" ] || { echo "✖ A GSTIN of $SELLER_STATE starts with ${CODES[$SELLER_STATE]}, this one with ${SELLER_GSTIN:0:2}. Nothing was changed."; exit 1; }

read -r -p "Address (one line, with PIN code): " SELLER_ADDRESS
SELLER_ADDRESS="$(trim "$SELLER_ADDRESS")"
[ "${#SELLER_ADDRESS}" -ge 10 ] || { echo "✖ Enter the full address. Nothing was changed."; exit 1; }
plain "$SELLER_ADDRESS"

echo
echo "  Name:    $SELLER_NAME"
echo "  GSTIN:   $SELLER_GSTIN"
echo "  State:   $SELLER_STATE"
echo "  Address: $SELLER_ADDRESS"
read -r -p "Save these for new invoices? [y/N] " OK
[[ "$OK" =~ ^[Yy] ]] || { echo "Nothing was changed."; exit 0; }

umask 077
for v in SELLER_NAME SELLER_GSTIN SELLER_STATE SELLER_ADDRESS; do
  printf -v "$v" "'%s'" "${!v}"
  set_var "$v"
done
chmod 600 "$ENV"
echo "✔ $ENV: seller saved"
echo "… recreating the platform container with the new settings"
"$HERE/ff.sh" up -d --no-deps platform
echo "  check: $HERE/ff.sh logs --tail 30 platform   (\"Seller GST details not set\" must not appear)"
