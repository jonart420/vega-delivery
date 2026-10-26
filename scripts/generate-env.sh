#!/usr/bin/env bash
# Creates .env from .env.example with strong random secrets (never overwrites an existing .env).
# Usage: scripts/generate-env.sh [public-base-url]
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] && { echo ".env already exists – not overwritten."; exit 1; }
rand() { openssl rand -base64 48 | tr -d '\n/+=' | cut -c1-"$1"; }
URL="${1:-http://localhost:3100}"
sed \
  -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(rand 32)|" \
  -e "s|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=$(rand 20)|" \
  -e "s|^LOGIN_CODE_SECRET=.*|LOGIN_CODE_SECRET=$(rand 56)|" \
  -e "s|^PUBLIC_BASE_URL=.*|PUBLIC_BASE_URL=${URL}|" \
  .env.example > .env
case "$URL" in https://*) ;; *) sed -i.bak -e "s|^COOKIE_SECURE=.*|COOKIE_SECURE=false|" .env && rm -f .env.bak ;; esac
chmod 600 .env
echo "Created .env with random secrets."
echo "First login: admin / $(grep '^ADMIN_PASSWORD=' .env | cut -d= -f2-)"
echo "Store the admin password safely and change it after the first login if you like."
