# Routing with Valhalla

VEGA Delivery uses a self-hosted [Valhalla](https://github.com/valhalla/valhalla) instance
(`ghcr.io/valhalla/valhalla-scripted`) for

- the time matrix used to optimize the stop order (`sources_to_targets`),
- the planned route geometry and leg durations (`route`),
- live ETAs from the vehicle position,
- turn-by-turn navigation in the driver apps (proxied through `POST /api/app/valhalla/route`).

Cars use the `auto` costing (fastest route, stops approached on the same side of the road via
`preferred_side: same`). Cargo bikes and walking tours are supported via the tour's vehicle type.

## Choosing the region

`VALHALLA_TILE_URLS` takes one or more OSM extracts (space separated), all built into one tile set:

| Coverage | Example | Disk (PBF + tiles) | RAM for the build | First build (4 threads) |
|---|---|---|---|---|
| City | `…/europe/germany/hamburg-latest.osm.pbf` | ~0.5 GB | 2 GB | minutes |
| German state | `…/europe/germany/niedersachsen-latest.osm.pbf` | ~2 GB | 4 GB | ~10 min |
| Country | `…/europe/germany-latest.osm.pbf` | ~15 GB | 8–16 GB | 1–2 h |
| Continent | `…/europe-latest.osm.pbf` | ~120 GB | 32–64 GB | many hours |
| Planet | `https://planet.openstreetmap.org/pbf/planet-latest.osm.pbf` | ~1 TB | > 64 GB | a day+ |

Extracts: <https://download.geofabrik.de>. The numbers are rough guides; increase
`VALHALLA_THREADS` on bigger machines. While the first build runs, the back office works but
*Optimize route* reports "Valhalla unreachable".

## Changing the region / monthly updates

```bash
# after changing VALHALLA_TILE_URLS in .env, or monthly for fresh map data:
scripts/valhalla-update.sh
```

The script deletes the old extracts in the Valhalla volume and forces a rebuild; routing is
unavailable during the build.

## Limits

Valhalla allows 20 locations per route request and 2500 matrix pairs by default. The backend splits
large tours into several requests automatically (`VALHALLA_MAX_ROUTE_LOCATIONS`,
`VALHALLA_MAX_MATRIX_PAIRS` if your instance is configured differently). Tours with ~200 stops work;
optimization time grows with the number of stops (local search is capped at 4 seconds).
