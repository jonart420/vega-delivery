/** Routing via the self-hosted Valhalla service (car by default, voice instructions in the user's language). */

import { solveOrder, type TimeWindow } from "./optimize";

export type LatLon = { lat: number; lon: number };
export type Mode = "auto" | "bicycle" | "pedestrian";

export type RouteLeg = { distance_km: number; duration_s: number };

export type RouteResult = {
  order: string[];               // stop ids in driving order
  geometry: [number, number][];  // [lon, lat] for the map
  distance_km: number;
  duration_s: number;
  legs: RouteLeg[];              // start→1, 1→2, …, n→end
  computed_at: string;
  mode: Mode;
  /** optimized = computed (fixed stops respected), manual = order set by dispatcher */
  order_mode: "optimized" | "manual";
};

export const VALHALLA_URL = (process.env.VALHALLA_URL ?? "http://localhost:8002").replace(/\/$/, "");

/** Valhalla language tag for a UI locale. */
export const valhallaLanguage = (locale: string) => (locale === "de" ? "de-DE" : "en-US");

/** Costing per mode. Cars use the fastest route (no `shortest`). */
export function costing(mode: Mode) {
  switch (mode) {
    case "bicycle":
      return { costing: "bicycle", costing_options: { bicycle: { bicycle_type: "Cross" } } };
    case "pedestrian":
      return { costing: "pedestrian", costing_options: { pedestrian: {} } };
    default:
      return { costing: "auto", costing_options: { auto: { use_highways: 1, use_tolls: 0.5 } } };
  }
}

/** Polyline with precision 6 (Valhalla) → [lon, lat][] */
export function decodePolyline6(str: string): [number, number][] {
  const out: [number, number][] = [];
  let index = 0, lat = 0, lon = 0;
  while (index < str.length) {
    for (const which of [0, 1]) {
      let result = 0, shift = 0, b: number;
      do {
        b = str.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += delta;
      else lon += delta;
    }
    out.push([lon / 1e6, lat / 1e6]);
  }
  return out;
}

type ValhallaTrip = {
  trip: {
    legs: { shape: string; summary: { length: number; time: number } }[];
    summary: { length: number; time: number };
  };
};

async function post<T>(endpoint: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${VALHALLA_URL}/${endpoint}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new Error("Valhalla unreachable");
  }
  const json = (await res.json().catch(() => ({}))) as T & { error?: string; error_code?: number };
  if (!res.ok) throw new Error(`Valhalla: ${json.error ?? res.statusText} (${json.error_code ?? res.status})`);
  return json;
}

/** Valhalla's default limit of source×target pairs per matrix request. */
const MAX_MATRIX_PAIRS = Number(process.env.VALHALLA_MAX_MATRIX_PAIRS) || 2500;

/**
 * Time matrix in seconds (unreachable = very large). Large tours are requested in row blocks so
 * each request stays below Valhalla's pair limit (no server configuration needed).
 */
async function timeMatrix(points: LatLon[], mode: Mode): Promise<number[][]> {
  const locs = points.map((p) => ({ lat: p.lat, lon: p.lon }));
  const rowsPerRequest = Math.max(1, Math.floor(MAX_MATRIX_PAIRS / locs.length));
  if (rowsPerRequest < 1 || locs.length > MAX_MATRIX_PAIRS) throw new Error(`too many stops for one tour (${locs.length})`);
  const out: number[][] = [];
  for (let i = 0; i < locs.length; i += rowsPerRequest) {
    const json = await post<{ sources_to_targets: { time: number | null }[][] }>("sources_to_targets", {
      sources: locs.slice(i, i + rowsPerRequest),
      targets: locs,
      ...costing(mode),
    });
    out.push(...json.sources_to_targets.map((row) => row.map((c) => (c.time == null ? 1e7 : c.time))));
  }
  return out;
}

/** Valhalla's default limit of locations per route request. */
const MAX_ROUTE_LOCATIONS = Number(process.env.VALHALLA_MAX_ROUTE_LOCATIONS) || 20;

/**
 * Route in exactly the given order. Stops prefer the curb on the same side (no crossing).
 * Long tours are requested in overlapping chunks (last point of a chunk = first of the next).
 */
async function routeInOrder(points: LatLon[], mode: Mode, locale: string): Promise<ValhallaTrip["trip"]> {
  const legs: ValhallaTrip["trip"]["legs"] = [];
  for (let start = 0; start < points.length - 1; start += MAX_ROUTE_LOCATIONS - 1) {
    const chunk = points.slice(start, start + MAX_ROUTE_LOCATIONS);
    const json = await post<ValhallaTrip>("route", {
      locations: chunk.map((p, i) => {
        const global = start + i;
        return {
          lat: p.lat,
          lon: p.lon,
          type: "break",
          ...(mode === "auto" && global > 0 && global < points.length - 1 ? { preferred_side: "same" } : {}),
        };
      }),
      ...costing(mode),
      units: "kilometers",
      directions_options: { language: valhallaLanguage(locale), units: "kilometers" },
    });
    legs.push(...json.trip.legs);
  }
  return {
    legs,
    summary: {
      length: legs.reduce((s, l) => s + l.summary.length, 0),
      time: legs.reduce((s, l) => s + l.summary.time, 0),
    },
  };
}

export type PlanStop = LatLon & {
  id: string;
  fixed_position: number | null;
  /** seconds after tour start; null = no window */
  window?: TimeWindow | null;
  dwell_s: number;
};

/**
 * Plans the route between fixed start and end.
 * - manualOrder: order as set by the dispatcher (no optimization).
 * - otherwise optimized; stops with fixed_position stay in place; time windows are soft constraints.
 */
export async function planRoute(
  start: LatLon,
  end: LatLon,
  stops: PlanStop[],
  mode: Mode,
  locale: string,
  manualOrder?: string[],
): Promise<RouteResult> {
  let ordered: PlanStop[];
  let orderMode: RouteResult["order_mode"];

  if (manualOrder) {
    const byId = new Map(stops.map((s) => [s.id, s]));
    ordered = manualOrder.map((id) => byId.get(id)).filter((s): s is PlanStop => !!s);
    orderMode = "manual";
  } else if (stops.length <= 1) {
    ordered = stops;
    orderMode = "optimized";
  } else {
    const n = stops.length;
    const fixedAt = new Array<number>(n).fill(-1);
    stops.forEach((s, i) => {
      const p = s.fixed_position;
      // Duplicate or out-of-range positions are ignored.
      if (p != null && p >= 1 && p <= n && fixedAt[p - 1] < 0) fixedAt[p - 1] = i + 1;
    });
    const cost = await timeMatrix([start, ...stops, end], mode);
    const order = solveOrder(cost, fixedAt, {
      dwell: [0, ...stops.map((s) => s.dwell_s), 0],
      windows: [null, ...stops.map((s) => s.window ?? null), null],
    });
    ordered = order.map((idx) => stops[idx - 1]);
    orderMode = "optimized";
  }

  const trip = await routeInOrder([start, ...ordered, end], mode, locale);
  return {
    order: ordered.map((s) => s.id),
    geometry: trip.legs.flatMap((leg) => decodePolyline6(leg.shape)),
    distance_km: trip.summary.length,
    duration_s: trip.summary.time,
    legs: trip.legs.map((l) => ({ distance_km: l.summary.length, duration_s: l.summary.time })),
    computed_at: new Date().toISOString(),
    mode,
    order_mode: orderMode,
  };
}

/** Driving time from a position through the given points (for live ETAs). */
export async function legDurations(points: LatLon[], mode: Mode): Promise<number[]> {
  if (points.length < 2) return [];
  const json = await post<ValhallaTrip>("route", {
    locations: points.map((p) => ({ lat: p.lat, lon: p.lon, type: "break" })),
    ...costing(mode),
    directions_type: "none",
  });
  return json.trip.legs.map((l) => l.summary.time);
}
