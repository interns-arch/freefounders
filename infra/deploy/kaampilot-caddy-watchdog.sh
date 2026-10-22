#!/bin/sh
# Puts kaampilot.com back into the shared Caddy (problem-app-caddy-1) when another team reloads it from its
# old Caddyfile without the kaampilot route (same approach as /home/ubuntu/pulse-caddy-watchdog.sh).
# Only ADDS that one route; never touches any other site. Runs from cron every minute.
DIR=/opt/freefounders
LOG=$DIR/kaampilot-caddy-watchdog.log
C=problem-app-caddy-1
# FreeFounders itself must be up, else there is nothing to route to.
curl -sf -m 5 http://127.0.0.1:7395/api/platform/health >/dev/null || exit 0
docker exec $C wget -qO- http://127.0.0.1:2019/config/apps/http/servers/srv0/routes 2>/dev/null | grep -q kaampilot && exit 0
docker cp $DIR/kaampilot-route.json $C:/tmp/kaampilot-route.json >/dev/null 2>&1
if docker exec $C wget -qO- --header="Content-Type: application/json" --post-file=/tmp/kaampilot-route.json \
     http://127.0.0.1:2019/config/apps/http/servers/srv0/routes >/dev/null 2>&1; then
  echo "$(date -u +%FT%TZ) re-added the kaampilot route" >> $LOG
else
  echo "$(date -u +%FT%TZ) kaampilot route missing and re-adding FAILED" >> $LOG
fi
