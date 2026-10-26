import { publicBaseUrl } from "./branding";

/**
 * Map provider, selectable via .env – the same for back office, tracking page and driver apps:
 *  - MAP_PROVIDER=osm (default): free OpenStreetMap vector style (OpenFreeMap) or MAP_STYLE_URL.
 *  - MAP_PROVIDER=mapbox: Mapbox style MAPBOX_STYLE (e.g. "mapbox/streets-v12") with the public
 *    token MAPBOX_ACCESS_TOKEN (pk.…).
 * All clients render with MapLibre. For Mapbox the backend serves /api/map/style.json, a copy of
 * the Mapbox style whose mapbox:// URLs are rewritten to plain https URLs with the token.
 */

export type MapProvider = "osm" | "mapbox";

export function mapProvider(): MapProvider {
  return (process.env.MAP_PROVIDER ?? "").toLowerCase() === "mapbox" ? "mapbox" : "osm";
}

export const mapboxStyleId = () => (process.env.MAPBOX_STYLE?.trim() || "mapbox/streets-v12").replace(/^mapbox:\/\/styles\//, "");

/** Style URL for MapLibre. `absolute` for the apps (they need the full server URL). */
export function mapStyleUrl(absolute = false): string {
  if (mapProvider() === "mapbox") return `${absolute ? publicBaseUrl() : ""}/api/map/style.json`;
  return process.env.MAP_STYLE_URL?.trim() || "https://tiles.openfreemap.org/styles/liberty";
}

export function mapAttribution(): string {
  return mapProvider() === "mapbox"
    ? "© Mapbox © OpenStreetMap contributors"
    : process.env.MAP_ATTRIBUTION?.trim() || "© OpenFreeMap © OpenMapTiles © OpenStreetMap contributors";
}

/** Rewrites mapbox:// URLs of a style document into https URLs carrying the access token. */
export function rewriteMapboxStyle(style: Record<string, unknown>, token: string): Record<string, unknown> {
  const t = encodeURIComponent(token);
  const rewrite = (url: string): string => {
    if (!url.startsWith("mapbox://")) return url;
    const rest = url.slice("mapbox://".length);
    if (rest.startsWith("sprites/")) return `https://api.mapbox.com/styles/v1/${rest.slice(8)}/sprite?access_token=${t}`;
    if (rest.startsWith("fonts/")) return `https://api.mapbox.com/fonts/v1/${rest.slice(6)}?access_token=${t}`;
    if (rest.startsWith("styles/")) return `https://api.mapbox.com/styles/v1/${rest.slice(7)}?access_token=${t}`;
    // Tileset ids ("mapbox.mapbox-streets-v8,mapbox.mapbox-terrain-v2") → TileJSON
    return `https://api.mapbox.com/v4/${rest}.json?secure&access_token=${t}`;
  };
  const out: Record<string, unknown> = { ...style };
  if (typeof out.sprite === "string") out.sprite = rewrite(out.sprite);
  if (typeof out.glyphs === "string") out.glyphs = rewrite(out.glyphs);
  const sources = (out.sources ?? {}) as Record<string, Record<string, unknown>>;
  out.sources = Object.fromEntries(
    Object.entries(sources).map(([k, src]) => [
      k,
      {
        ...src,
        ...(typeof src.url === "string" ? { url: rewrite(src.url) } : {}),
        ...(Array.isArray(src.tiles) ? { tiles: (src.tiles as string[]).map(rewrite) } : {}),
      },
    ]),
  );
  return out;
}
