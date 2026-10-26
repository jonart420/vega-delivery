#!/usr/bin/env bash
# Restores a backup. WARNING: overwrites the current database.
# Usage: scripts/db-restore.sh backups/vega-YYYYMMDD-HHMM.sql.gz
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; [ -f .env ] && . ./.env; set +a

FILE="${1:?backup file required}"
[ -f "$FILE" ] || { echo "File not found: $FILE"; exit 1; }
read -r -p "Overwrite the current database with $FILE? (yes/no) " ok
[ "$ok" = "yes" ] || { echo "Aborted."; exit 1; }

docker compose stop backend
# Empty the schema first; missing migrations are applied by the backend on start.
{ echo "drop schema if exists public cascade; create schema public;"; gunzip -c "$FILE"; } \
  | docker compose exec -T db psql -q -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:-vega}" -d "${POSTGRES_DB:-vega}"
docker compose start backend
echo "Restored from $FILE."
