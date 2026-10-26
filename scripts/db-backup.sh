#!/usr/bin/env bash
# Database backup (pg_dump, compressed) into ./backups (or BACKUP_DIR).
# Backups older than BACKUP_KEEP_DAYS (default 30) are removed.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; [ -f .env ] && . ./.env; set +a

KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"
OUT_DIR="${BACKUP_DIR:-./backups}"
mkdir -p "$OUT_DIR"
FILE="$OUT_DIR/vega-$(date +%Y%m%d-%H%M).sql.gz"

echo "Backing up database to $FILE …"
docker compose exec -T db pg_dump -U "${POSTGRES_USER:-vega}" -d "${POSTGRES_DB:-vega}" \
  --no-owner --clean --if-exists | gzip > "$FILE.tmp"
mv "$FILE.tmp" "$FILE"
echo "Done: $(du -h "$FILE" | cut -f1)"
find "$OUT_DIR" -name 'vega-*.sql.gz' -mtime +"$KEEP_DAYS" -print -delete | sed 's/^/Removed (older than '"$KEEP_DAYS"' days): /'
