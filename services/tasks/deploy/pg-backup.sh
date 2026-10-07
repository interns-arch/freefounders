#!/usr/bin/env bash
# Nightly Postgres backup for the automate-task stack.
#
# Since the cutover off Neon, the container volume automate-task_pgdata is the
# only live copy of this data -- Neon no longer receives writes. Nothing else
# on this box backs it up.
#
# Install (as ubuntu):
#   crontab -e
#   30 20 * * * /home/ubuntu/automate-task/deploy/pg-backup.sh
#
# Touches only the automate-task stack: it runs pg_dump inside this project's
# own db container and writes to this project's own directory.
set -euo pipefail

STACK_DIR="${STACK_DIR:-/home/ubuntu/automate-task}"
BACKUP_DIR="${BACKUP_DIR:-$STACK_DIR/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
LOG="$BACKUP_DIR/backup.log"

mkdir -p "$BACKUP_DIR"

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" >> "$LOG"; }

# A slow dump must never overlap the next night's run.
exec 9>"$BACKUP_DIR/.lock"
if ! flock -n 9; then
  log "SKIP: another backup is still running"
  exit 0
fi

cd "$STACK_DIR"

# Read the credentials from .env rather than hardcoding them, so a password
# rotation does not silently break the backups.
PGUSER="$(grep -oP '(?<=^POSTGRES_USER=).*' .env)"
PGDB="$(grep -oP '(?<=^POSTGRES_DB=).*' .env)"

TS="$(date -u +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/automatetask-${TS}.dump"

if ! sudo docker compose exec -T db pg_dump -U "$PGUSER" -Fc "$PGDB" > "$OUT" 2>>"$LOG"; then
  log "FAIL: pg_dump errored; removing partial $OUT"
  rm -f "$OUT"
  exit 1
fi

# A dump that cannot be listed cannot be restored. Catching that now beats
# discovering it during an actual recovery. This runs in a throwaway container
# with the file mounted, because pg_restore -l needs a real seekable file --
# piping the dump in on stdin fails with "did not find magic string".
VERIFY="sudo docker run --rm -v $BACKUP_DIR:/b:ro postgres:18 pg_restore -l /b/$(basename "$OUT")"
if ! $VERIFY > /dev/null 2>>"$LOG"; then
  log "FAIL: $(basename "$OUT") is unreadable by pg_restore; removing"
  rm -f "$OUT"
  exit 1
fi

TABLES="$($VERIFY 2>/dev/null | grep -c 'TABLE DATA' || true)"
SIZE="$(du -h "$OUT" | cut -f1)"
chmod 600 "$OUT"
log "OK: $(basename "$OUT") ($SIZE, $TABLES tables with data)"

# Prune old dumps. -mtime +N deletes strictly older than N days, so
# RETENTION_DAYS of history is always kept.
PRUNED="$(find "$BACKUP_DIR" -maxdepth 1 -name 'automatetask-*.dump' -mtime "+$RETENTION_DAYS" -print -delete | wc -l)"
[ "$PRUNED" -gt 0 ] && log "pruned $PRUNED dump(s) older than ${RETENTION_DAYS}d"

# Keep the log itself from growing without bound.
tail -n 500 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
exit 0
