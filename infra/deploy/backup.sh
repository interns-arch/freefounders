#!/bin/sh
# Nightly backup of Kaampilot on the shared Docker host (PLAN.md §19.40; restore steps in README.md "Backups").
#   db-<stamp>.sql.gz     pg_dumpall of the stack's Postgres container: ff_platform, ff_tasks (every company schema),
#                         ff_assets, and the roles
#   media-<stamp>.tar.gz  the uploaded files: data/tasks-media and data/assets-uploads
# into FF_HOME/backups (mode 700); files older than KEEP_DAYS (14) are deleted. Exits non-zero if the dump fails.
# Cron (README.md):  30 2 * * * FF_HOME=/opt/freefounders /opt/freefounders/backup.sh >> /opt/freefounders/backups/backup.log 2>&1
set -eu

FF_HOME="${FF_HOME:-/opt/freefounders}"
KEEP_DAYS="${KEEP_DAYS:-14}"
DEST="${BACKUP_DIR:-$FF_HOME/backups}"
FF="$FF_HOME/app/infra/deploy/ff.sh"
STAMP="$(date +%Y-%m-%d-%H%M)"
umask 077
mkdir -p "$DEST"
chmod 700 "$DEST"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*"; }

# 1. Databases: one consistent dump per database, plus roles. Written to a .part file first, so a failed run never
#    leaves a file that looks complete.
DB="$DEST/db-$STAMP.sql.gz"
log "dump databases -> $DB"
STATUS="$DEST/.dump-status"
# (plain sh has no pipefail: pg_dumpall's own exit code goes through a file)
{ FF_HOME="$FF_HOME" sh "$FF" exec -T postgres pg_dumpall -U postgres --clean --if-exists; echo $? > "$STATUS"; } | gzip -6 > "$DB.part"
if [ "$(cat "$STATUS" 2>/dev/null)" != "0" ] || ! gzip -t "$DB.part" || ! gzip -dc "$DB.part" | tail -n 5 | grep -q 'cluster dump complete'; then
  rm -f "$DB.part" "$STATUS"
  log "ERROR: pg_dumpall failed or the dump is incomplete"
  exit 1
fi
rm -f "$STATUS"
mv "$DB.part" "$DB"

# 2. Uploaded files (bind mounts under FF_HOME/data), as paths relative to FF_HOME so a restore is one tar -x there.
MEDIA="$DEST/media-$STAMP.tar.gz"
DIRS=""
for d in data/tasks-media data/assets-uploads; do
  [ -d "$FF_HOME/$d" ] && DIRS="$DIRS $d"
done
if [ -n "$DIRS" ]; then
  log "archive uploaded files ($DIRS ) -> $MEDIA"
  # shellcheck disable=SC2086 # the list is split on purpose
  tar -czf "$MEDIA.part" -C "$FF_HOME" $DIRS
  gzip -t "$MEDIA.part"
  mv "$MEDIA.part" "$MEDIA"
else
  log "no uploaded-file folders found under $FF_HOME/data (skipped)"
fi

# 3. Rotation: keep KEEP_DAYS days.
find "$DEST" -maxdepth 1 -type f \( -name 'db-*.sql.gz' -o -name 'media-*.tar.gz' -o -name '*.part' \) -mtime +"$((KEEP_DAYS - 1))" -print -delete \
  | sed 's/^/removed old backup: /'

log "done: $(du -h "$DB" | cut -f1) database$( [ -f "$MEDIA" ] && echo ", $(du -h "$MEDIA" | cut -f1) files" )"
