#!/usr/bin/env bash
# Re-downloads the OSM extracts (VALHALLA_TILE_URLS) and rebuilds the Valhalla routing tiles.
# Routing is unavailable while the tiles are being built (minutes for a city, hours for a country).
# Run monthly, e.g. via cron:  0 3 1 * *  cd /srv/vega-delivery && scripts/valhalla-update.sh
set -euo pipefail
cd "$(dirname "$0")/.."
echo "Removing old extracts from the Valhalla volume …"
docker compose run --rm --no-deps --entrypoint sh valhalla -c 'rm -f /custom_files/*.pbf'
echo "Rebuilding tiles (follow progress: docker compose logs -f valhalla) …"
VALHALLA_FORCE_REBUILD=True docker compose up -d --force-recreate valhalla
