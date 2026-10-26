import { NextResponse } from "next/server";
import { mapboxStyleId, mapProvider, rewriteMapboxStyle } from "@/lib/map";

export const dynamic = "force-dynamic";

const TTL_MS = 60 * 60 * 1000;
let cache: { at: number; key: string; body: string } | null = null;

/**
 * MapLibre-compatible map style (public: also used by tracking pages and the apps).
 * Only active with MAP_PROVIDER=mapbox; the OSM provider points clients directly to its style URL.
 */
export async function GET() {
  if (mapProvider() !== "mapbox") return NextResponse.json({ error: "MAP_PROVIDER is not mapbox" }, { status: 404 });
  const token = process.env.MAPBOX_ACCESS_TOKEN ?? "";
  if (!token) return NextResponse.json({ error: "MAPBOX_ACCESS_TOKEN missing" }, { status: 500 });
  const key = `${mapboxStyleId()}|${token}`;
  if (!cache || cache.key !== key || Date.now() - cache.at > TTL_MS) {
    const res = await fetch(`https://api.mapbox.com/styles/v1/${mapboxStyleId()}?access_token=${encodeURIComponent(token)}`, {
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    if (!res?.ok) {
      if (cache) return new NextResponse(cache.body, { headers: { "Content-Type": "application/json" } });
      return NextResponse.json({ error: `Mapbox style not available (${res?.status ?? "network"})` }, { status: 502 });
    }
    const style = (await res.json()) as Record<string, unknown>;
    cache = { at: Date.now(), key, body: JSON.stringify(rewriteMapboxStyle(style, token)) };
  }
  return new NextResponse(cache.body, {
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" },
  });
}
