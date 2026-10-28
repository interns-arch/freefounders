#!/bin/bash
# Switches on the "Ask Kaampilot" AI helper on this server (PLAN.md §24.3):
#   app/infra/deploy/set-ai.sh         asks for the provider (anthropic | openai | gemini), the API key (hidden) and an optional
#                                      model, checks the key, then recreates the Platform
#   app/infra/deploy/set-ai.sh --off   switches the helper off (AI_API_KEY emptied; the button disappears)
# The key is typed without echo (read -s): never on screen, in shell history or in `ps`. Values are written only to
# FF_HOME/.env (mode 600). Only the platform container is recreated.
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
  echo "  check: $HERE/ff.sh logs --tail 30 platform   (look for \"AI helper: ON …\")"
}

umask 077
if [ "${1:-}" = "--off" ]; then
  AI_API_KEY=""
  set_var AI_API_KEY
  echo "✔ AI_API_KEY emptied: the AI helper is off (its button is hidden)"
  restart_platform
  exit 0
fi

read -r -p "Provider, anthropic, openai or gemini (Enter = anthropic): " AI_PROVIDER
AI_PROVIDER="$(printf '%s' "${AI_PROVIDER:-anthropic}" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
case "$AI_PROVIDER" in
  anthropic) DEFAULT_MODEL="claude-haiku-5-5"; echo "Anthropic Console (platform.claude.com): API keys → Create key." ;;
  openai) DEFAULT_MODEL="gpt-4o-mini"; echo "OpenAI platform: API keys → Create new secret key." ;;
  gemini) DEFAULT_MODEL="gemini-3.8-flash"; echo "Google AI Studio (aistudio.google.com): Get API key → Create API key." ;;
  *) echo "✖ Provider must be anthropic, openai or gemini. Nothing was changed."; exit 1 ;;
esac

read -r -s -p "API key (hidden): " AI_API_KEY; echo
AI_API_KEY="$(printf '%s' "$AI_API_KEY" | tr -d '[:space:]')"
if [ "$AI_PROVIDER" = "gemini" ]; then
  # Google keys usually start with "AIza", newer ones may not: any key is accepted, the API call below decides. Only
  # characters that would break the curl config or .env (quotes, backslash, $, control characters) are refused.
  case "$AI_API_KEY" in
    '' | *[\"\'\\\$]* | *[[:cntrl:]]*) echo "✖ That does not look like an API key. Nothing was changed."; exit 1 ;;
  esac
else
  [[ "$AI_API_KEY" =~ ^[A-Za-z0-9_-]{20,}$ ]] || { echo "✖ That does not look like an API key. Nothing was changed."; exit 1; }
fi

read -r -p "Model (Enter = $DEFAULT_MODEL): " AI_MODEL
AI_MODEL="$(printf '%s' "${AI_MODEL:-}" | tr -d '[:space:]')"
[[ -z "$AI_MODEL" || "$AI_MODEL" =~ ^[A-Za-z0-9._:-]{2,80}$ ]] || { echo "✖ That model name looks wrong. Nothing was changed."; exit 1; }

# Check the key before saving it (lists models; costs nothing). The key goes to curl through stdin (-K -), not argv.
if [ "$AI_PROVIDER" = "anthropic" ]; then
  CFG="header = \"x-api-key: $AI_API_KEY\"
header = \"anthropic-version: 2026-10-21\"
url = \"https://api.anthropic.com/v1/models\""
elif [ "$AI_PROVIDER" = "gemini" ]; then
  # Header only, never ?key= in the URL.
  CFG="header = \"x-goog-api-key: $AI_API_KEY\"
url = \"https://generativelanguage.googleapis.com/v1beta/models\""
else
  CFG="header = \"Authorization: Bearer $AI_API_KEY\"
url = \"https://api.openai.com/v1/models\""
fi
CHECK="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 -K - <<<"$CFG" || echo 000)"
unset CFG
if [ "$CHECK" = "200" ]; then
  echo "✔ $AI_PROVIDER accepted the key"
else
  echo "✖ $AI_PROVIDER refused the key (HTTP $CHECK). Nothing was changed."
  [ "$AI_PROVIDER" = "gemini" ] && echo "  Google answers 400 for a wrong key and 403 when the Generative Language API is not enabled for its project."
  exit 1
fi

for v in AI_PROVIDER AI_API_KEY AI_MODEL; do set_var "$v"; done
chmod 600 "$ENV"
unset AI_API_KEY
echo "✔ $ENV: AI_PROVIDER=$AI_PROVIDER, model ${AI_MODEL:-$DEFAULT_MODEL}, key saved (not shown)"
restart_platform
