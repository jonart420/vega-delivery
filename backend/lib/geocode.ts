/**
 * Place search (addresses, streets, places, POIs) via Photon – OSM data like the map.
 * Default is the public komoot instance; GEOCODER_URL points to an own Photon instance.
 * GEOCODER_BBOX ("minLon,minLat,maxLon,maxLat") optionally limits results to a region.
 * Results are cached briefly so typing does not hammer the service.
 */

export type GeocodeResult = {
  id: string;
  label: string;
  sublabel: string;
  kind: string; // house, street, city, poi, …
  lat: number;
  lon: number;
  street: string | null;
  house_no: string | null;
  zip: string | null;
  city: string | null;
  country: string | null; // ISO-2
};

const TTL_MS = 60 * 60 * 1000;
const cache = new Map<string, { at: number; results: GeocodeResult[] }>();
const UA = "vega-delivery/1.0 (+https://github.com/)";

type PhotonFeature = {
  geometry: { coordinates: [number, number] };
  properties: Record<string, string | undefined>;
};

const base = () => (process.env.GEOCODER_URL || "https://photon.komoot.io").replace(/\/$/, "");
const bbox = () => {
  const b = process.env.GEOCODER_BBOX?.trim();
  return b && /^-?[\d.]+,-?[\d.]+,-?[\d.]+,-?[\d.]+$/.test(b) ? b : null;
};

function toResult(f: PhotonFeature): GeocodeResult {
  const p = f.properties;
  const [lon, lat] = f.geometry.coordinates;
  const streetLine = [p.street, p.housenumber].filter(Boolean).join(" ");
  const place = [p.postcode, [p.city, p.district].filter(Boolean).join("-")].filter(Boolean).join(" ");
  const label = p.name || streetLine || p.city || "—";
  const sublabel = [p.name && streetLine ? streetLine : null, place || p.county || p.state].filter(Boolean).join(", ");
  const isPoi = p.name && p.osm_key && !["place", "highway", "boundary", "building"].includes(p.osm_key);
  return {
    id: `${p.osm_type}${p.osm_id}`,
    label,
    sublabel,
    kind: isPoi ? "poi" : (p.type ?? "place"),
    lat,
    lon,
    street: p.street ?? (p.type === "street" ? p.name ?? null : null),
    house_no: p.housenumber ?? null,
    zip: p.postcode ?? null,
    city: p.city ?? p.locality ?? p.district ?? null,
    country: p.countrycode?.toUpperCase() ?? null,
  };
}

export async function geocode(
  query: string,
  opts: { near?: { lat: number; lon: number }; locale?: string; limit?: number } = {},
): Promise<GeocodeResult[]> {
  const q = query.normalize("NFC").trim().slice(0, 200);
  if (q.length < 3) return [];
  const bias = opts.near ? `${opts.near.lat.toFixed(2)},${opts.near.lon.toFixed(2)}` : "";
  const lang = opts.locale === "de" ? "de" : "en";
  const key = `${q.toLowerCase()}|${bias}|${lang}|${opts.limit ?? 8}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.results;

  const url = new URL(`${base()}/api/`);
  url.searchParams.set("q", q);
  url.searchParams.set("lang", lang);
  url.searchParams.set("limit", String(opts.limit ?? 8));
  const b = bbox();
  if (b) url.searchParams.set("bbox", b);
  if (opts.near) {
    url.searchParams.set("lat", opts.near.lat.toFixed(4));
    url.searchParams.set("lon", opts.near.lon.toFixed(4));
  }
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Geocoder unreachable (${res.status})`);
  const json = (await res.json()) as { features?: PhotonFeature[] };
  const seen = new Set<string>();
  const results = (json.features ?? []).map(toResult).filter((r) => {
    const k = `${r.label}|${r.sublabel}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  cache.set(key, { at: Date.now(), results });
  return results;
}

/** Best coordinate for a postal address, or null. */
export async function geocodeAddress(a: {
  street: string;
  house_no?: string | null;
  zip: string;
  city: string;
  country?: string | null;
}): Promise<{ lat: number; lon: number } | null> {
  const query = `${a.street} ${a.house_no ?? ""}, ${a.zip} ${a.city}`.replace(/\s+/g, " ").trim();
  const results = await geocode(query, { limit: 5 });
  const country = a.country?.toUpperCase();
  const hit =
    results.find((r) => r.zip === a.zip && (!country || r.country === country) && r.house_no) ??
    results.find((r) => r.zip === a.zip) ??
    results[0];
  return hit ? { lat: hit.lat, lon: hit.lon } : null;
}
