#!/bin/sh
# docker compose for FreeFounders with the right project, env file and compose file. Examples:
#   ./ff.sh ps        ./ff.sh logs -f platform        ./ff.sh stop        ./ff.sh up -d
# FF_HOME (default /opt/freefounders) holds .env, app/ (this repo), web/ (apps/web/dist) and data/.
set -eu
FF_HOME="${FF_HOME:-/opt/freefounders}"
export FF_HOME
exec docker compose -p freefounders --env-file "$FF_HOME/.env" -f "$FF_HOME/app/infra/deploy/docker-compose.yml" "$@"
