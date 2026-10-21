#!/bin/sh
# Runs once, when the Postgres data folder is empty: one role and one database per service.
set -eu
for pair in "platform:${PLATFORM_DB_PASSWORD}" "tasks:${TASKS_DB_PASSWORD}" "assets:${ASSETS_DB_PASSWORD}"; do
  name="${pair%%:*}"
  pass="${pair#*:}"
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
    -v role="ff_${name}" -v pass="$pass" -v db="ff_${name}" <<'SQL'
CREATE ROLE :"role" LOGIN PASSWORD :'pass';
CREATE DATABASE :"db" OWNER :"role";
REVOKE ALL ON DATABASE :"db" FROM PUBLIC;
SQL
done
