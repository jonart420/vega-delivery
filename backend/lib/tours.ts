import { randomBytes } from "node:crypto";
import { z } from "zod";
import { clean } from "./api";
import { customerDisplayName } from "./barcodes";
import { q, q1, tx } from "./db";
import { itemsForOrders, type OrderItem } from "./orders";
import { getSetting, getSettings } from "./settings";
import { legDurations, planRoute, type Mode, type RouteResult } from "./valhalla";

export type TourStatus = "draft" | "released" | "in_progress" | "done";

export type Tour = {
  id: string;
  date: string;
  title: string;
  driver_id: string | null;
  driver_name: string | null;
  vehicle: string | null;
  mode: Mode;
  start_lat: number | null;
  start_lon: number | null;
  start_label: string | null;
  end_lat: number | null;
  end_lon: number | null;
  end_label: string | null;
  planned_start: string | null;
  status: TourStatus;
  route: RouteResult | null;
  released_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  stop_count: number;
  done_count: number;
  failed_count: number;
};

export type StopStatus = "pending" | "arrived" | "delivered" | "failed" | "skipped";

export type TourStop = {
  id: string;
  tour_id: string;
  customer_id: string;
  sort_index: number | null;
  fixed_position: number | null;
  eta: string | null;
  status: StopStatus;
  outcome_code: string | null;
  completed_at: string | null;
  tracking_token: string;
  tracking_active_from: string | null;
  customer_no: string;
  company: string | null;
  first_name: string | null;
  last_name: string | null;
  name: string;
  street: string;
  house_no: string | null;
  address_extra: string | null;
  zip: string;
  city: string;
  country: string;
  lat: number | null;
  lon: number | null;
  phone: string | null;
  email: string | null;
  whatsapp: string | null;
  notify_email: boolean;
  notify_whatsapp: boolean;
  locale: string | null;
  delivery_notes: string | null;
  time_window_from: string | null;
  time_window_to: string | null;
  dwell_minutes: number | null;
  orders: { id: string; order_no: string; delivery_ean13: string; status: string; notes: string | null; items: OrderItem[] }[];
};

const TOUR_COLS = `t.id, to_char(t.date, 'YYYY-MM-DD') as date, t.title, t.driver_id,
  coalesce(u.display_name, u.username::text) as driver_name, t.vehicle, t.mode,
  t.start_lat, t.start_lon, t.start_label, t.end_lat, t.end_lon, t.end_label,
  to_char(t.planned_start, 'HH24:MI') as planned_start, t.status, t.route, t.released_at, t.started_at, t.finished_at,
  (select count(*)::int from tour_stops s where s.tour_id = t.id) as stop_count,
  (select count(*)::int from tour_stops s where s.tour_id = t.id and s.status = 'delivered') as done_count,
  (select count(*)::int from tour_stops s where s.tour_id = t.id and s.status in ('failed', 'skipped')) as failed_count`;

const TOUR_FROM = "from tours t left join users u on u.id = t.driver_id";

export const tz = () => process.env.TZ || "Europe/Berlin";
export const newTrackingToken = () => randomBytes(16).toString("base64url");

export async function getTour(id: string): Promise<Tour | null> {
  return q1<Tour>(`select ${TOUR_COLS} ${TOUR_FROM} where t.id = $1`, [id]);
}

export async function listTours(opts: { from?: string; to?: string; driverId?: string; statuses?: TourStatus[] } = {}) {
  const params: unknown[] = [];
  const where: string[] = [];
  if (opts.from) {
    params.push(opts.from);
    where.push(`t.date >= $${params.length}`);
  }
  if (opts.to) {
    params.push(opts.to);
    where.push(`t.date <= $${params.length}`);
  }
  if (opts.driverId) {
    params.push(opts.driverId);
    where.push(`t.driver_id = $${params.length}`);
  }
  if (opts.statuses?.length) {
    params.push(opts.statuses);
    where.push(`t.status = any($${params.length}::text[])`);
  }
  return q<Tour>(
    `select ${TOUR_COLS} ${TOUR_FROM} ${where.length ? "where " + where.join(" and ") : ""} order by t.date desc, t.title limit 500`,
    params,
  );
}

export async function getStops(tourId: string): Promise<TourStop[]> {
  const rows = await q<Omit<TourStop, "orders" | "name">>(
    `select s.id, s.tour_id, s.customer_id, s.sort_index, s.fixed_position, s.eta, s.status, s.outcome_code, s.completed_at,
            s.tracking_token, s.tracking_active_from,
            c.customer_no, c.company, c.first_name, c.last_name, c.street, c.house_no, c.address_extra, c.zip, c.city, c.country,
            c.lat, c.lon, c.phone, c.email, c.whatsapp, c.notify_email, c.notify_whatsapp, c.locale, c.delivery_notes,
            to_char(coalesce(min(o.time_window_from), c.time_window_from), 'HH24:MI') as time_window_from,
            to_char(coalesce(max(o.time_window_to), c.time_window_to), 'HH24:MI') as time_window_to,
            c.dwell_minutes
       from tour_stops s
       join customers c on c.id = s.customer_id
       left join tour_stop_orders tso on tso.stop_id = s.id
       left join orders o on o.id = tso.order_id
      where s.tour_id = $1
      group by s.id, c.id
      order by s.sort_index nulls last, c.zip, c.street`,
    [tourId],
  );
  const links = await q<{ stop_id: string; id: string; order_no: string; delivery_ean13: string; status: string; notes: string | null }>(
    `select tso.stop_id, o.id, o.order_no::text, o.delivery_ean13, o.status, o.notes
       from tour_stop_orders tso join orders o on o.id = tso.order_id
       join tour_stops s on s.id = tso.stop_id where s.tour_id = $1 order by o.order_no`,
    [tourId],
  );
  const items = await itemsForOrders(links.map((l) => l.id));
  return rows.map((r) => ({
    ...r,
    name: customerDisplayName(r),
    orders: links
      .filter((l) => l.stop_id === r.id)
      .map(({ stop_id: _s, ...o }) => ({ ...o, items: items.get(o.id) ?? [] })),
  }));
}

// ── Editing ──────────────────────────────────────────────────────────────

const time = z.string().regex(/^\d{2}:\d{2}$/).nullish().or(z.literal("").transform(() => null));

export const TourInput = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  title: z.string().min(1).max(160).transform((v) => v.normalize("NFC").trim()),
  driver_id: z.string().uuid().nullish(),
  vehicle: z.string().max(80).nullish().transform((v) => clean(v ?? null)),
  mode: z.enum(["auto", "bicycle", "pedestrian"]).optional(),
  planned_start: time,
});

export const TourPatch = TourInput.partial().extend({
  start: z.object({ lat: z.number(), lon: z.number(), label: z.string().max(200).nullish() }).nullish(),
  end: z.object({ lat: z.number(), lon: z.number(), label: z.string().max(200).nullish() }).nullish(),
});

/** Statements that invalidate the route; a released tour falls back to draft. */
const ROUTE_RESET = `route = null, released_at = null, status = case when status = 'released' then 'draft' else status end`;

export class TourLockedError extends Error {}

async function assertEditable(tourId: string) {
  const t = await q1<{ status: TourStatus }>("select status from tours where id = $1", [tourId]);
  if (!t) return false;
  if (t.status === "in_progress" || t.status === "done") throw new TourLockedError("tour already started");
  return true;
}

export async function createTour(input: z.infer<typeof TourInput>, userId: string): Promise<string> {
  const s = await getSettings();
  const depot = s.depot;
  const row = await q1<{ id: string }>(
    `insert into tours (date, title, driver_id, vehicle, mode, planned_start, start_lat, start_lon, start_label,
                        end_lat, end_lon, end_label, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$7,$8,$9,$10) returning id`,
    [
      input.date, input.title, input.driver_id ?? null, input.vehicle, input.mode ?? s.tour_defaults.mode,
      input.planned_start || s.tour_defaults.planned_start, depot.lat, depot.lon, depot.label || null, userId,
    ],
  );
  return row!.id;
}

export async function patchTour(id: string, p: z.infer<typeof TourPatch>): Promise<boolean> {
  const cur = await getTour(id);
  if (!cur) return false;
  const geometryChange = p.start !== undefined || p.end !== undefined || (p.mode && p.mode !== cur.mode);
  if (geometryChange) await assertEditable(id);
  const sets: string[] = [];
  const params: unknown[] = [id];
  const set = (col: string, v: unknown) => {
    params.push(v);
    sets.push(`${col} = $${params.length}`);
  };
  if (p.title !== undefined) set("title", p.title);
  if (p.date !== undefined) set("date", p.date);
  if (p.driver_id !== undefined) set("driver_id", p.driver_id);
  if (p.vehicle !== undefined) set("vehicle", p.vehicle);
  if (p.planned_start !== undefined) set("planned_start", p.planned_start || null);
  if (p.mode !== undefined) set("mode", p.mode);
  if (p.start !== undefined) {
    set("start_lat", p.start?.lat ?? null);
    set("start_lon", p.start?.lon ?? null);
    set("start_label", p.start?.label ?? null);
  }
  if (p.end !== undefined) {
    set("end_lat", p.end?.lat ?? null);
    set("end_lon", p.end?.lon ?? null);
    set("end_label", p.end?.label ?? null);
  }
  if (!sets.length) return true;
  if (geometryChange) sets.push(ROUTE_RESET);
  // Without a driver a released tour cannot stay released
  if (p.driver_id === null) sets.push("status = case when status = 'released' then 'draft' else status end");
  await q(`update tours set ${sets.join(", ")}, updated_at = now() where id = $1`, params);
  if (p.planned_start !== undefined && !geometryChange) await recomputePlannedEtas(id);
  return true;
}

/** Adds orders; orders of the same customer share one stop. Returns number of added orders. */
export async function addOrders(tourId: string, orderIds: string[]): Promise<number> {
  if (!(await assertEditable(tourId))) return 0;
  return tx(async (c) => {
    const { rows } = await c.query<{ id: string; customer_id: string }>(
      `select o.id, o.customer_id from orders o
        where o.id = any($1::uuid[]) and o.status = 'open'
          and not exists (select 1 from tour_stop_orders x where x.order_id = o.id)
        for update of o`,
      [orderIds],
    );
    for (const o of rows) {
      const stop = await c.query<{ id: string }>(
        `insert into tour_stops (tour_id, customer_id, tracking_token) values ($1, $2, $3)
         on conflict (tour_id, customer_id) do update set customer_id = excluded.customer_id returning id`,
        [tourId, o.customer_id, newTrackingToken()],
      );
      await c.query("insert into tour_stop_orders (stop_id, order_id) values ($1, $2)", [stop.rows[0].id, o.id]);
      await c.query("update orders set status = 'planned', updated_at = now() where id = $1", [o.id]);
    }
    if (rows.length) await c.query(`update tours set ${ROUTE_RESET}, updated_at = now() where id = $1`, [tourId]);
    return rows.length;
  });
}

/** Removes a stop (or a single order of it); its orders become open again. */
export async function removeFromTour(tourId: string, opts: { stopId?: string; orderId?: string }): Promise<boolean> {
  if (!(await assertEditable(tourId))) return false;
  return tx(async (c) => {
    let orderIds: string[] = [];
    if (opts.orderId) {
      const r = await c.query<{ stop_id: string }>(
        `delete from tour_stop_orders tso using tour_stops s
          where tso.order_id = $1 and s.id = tso.stop_id and s.tour_id = $2 returning tso.stop_id`,
        [opts.orderId, tourId],
      );
      if (!r.rows[0]) return false;
      orderIds = [opts.orderId];
      // Stop without orders is removed
      await c.query(
        "delete from tour_stops s where s.id = $1 and not exists (select 1 from tour_stop_orders x where x.stop_id = s.id)",
        [r.rows[0].stop_id],
      );
    } else if (opts.stopId) {
      const r = await c.query<{ order_id: string }>(
        `select tso.order_id from tour_stop_orders tso join tour_stops s on s.id = tso.stop_id where s.id = $1 and s.tour_id = $2`,
        [opts.stopId, tourId],
      );
      orderIds = r.rows.map((x) => x.order_id);
      const del = await c.query("delete from tour_stops where id = $1 and tour_id = $2", [opts.stopId, tourId]);
      if (!del.rowCount) return false;
    }
    if (orderIds.length) {
      await c.query("update orders set status = 'open', updated_at = now() where id = any($1::uuid[]) and status = 'planned'", [orderIds]);
    }
    await c.query(`update tours set ${ROUTE_RESET}, updated_at = now() where id = $1`, [tourId]);
    return true;
  });
}

export async function setFixedPosition(tourId: string, stopId: string, position: number | null) {
  await assertEditable(tourId);
  await q("update tour_stops set fixed_position = $3 where id = $2 and tour_id = $1", [tourId, stopId, position]);
}

export async function deleteTour(id: string): Promise<boolean> {
  if (!(await assertEditable(id))) return false;
  return tx(async (c) => {
    await c.query(
      `update orders set status = 'open', updated_at = now()
        where status = 'planned' and id in (select tso.order_id from tour_stop_orders tso join tour_stops s on s.id = tso.stop_id where s.tour_id = $1)`,
      [id],
    );
    const r = await c.query("delete from tours where id = $1", [id]);
    return (r.rowCount ?? 0) > 0;
  });
}

// ── Route & ETAs ─────────────────────────────────────────────────────────

/** Seconds after the planned tour start for "HH:MM" on the tour date. */
function windowSeconds(hhmm: string | null, start: string): number | null {
  if (!hhmm) return null;
  const toS = (v: string) => Number(v.slice(0, 2)) * 3600 + Number(v.slice(3, 5)) * 60;
  return toS(hhmm) - toS(start);
}

export async function calculateRoute(tourId: string, locale: string, manualOrder?: string[]): Promise<Tour> {
  await assertEditable(tourId);
  const tour = await getTour(tourId);
  if (!tour) throw new Error("tour not found");
  if (tour.start_lat == null || tour.start_lon == null) throw new Error("start missing (set a depot in settings)");
  const stops = await getStops(tourId);
  const missing = stops.filter((s) => s.lat == null || s.lon == null);
  if (missing.length) throw new Error(`no coordinates for: ${missing.map((s) => s.name).join(", ")}`);
  if (!stops.length) throw new Error("tour has no stops");
  const defaults = await getSetting("tour_defaults");
  const start = tour.planned_start ?? defaults.planned_start;

  const route = await planRoute(
    { lat: tour.start_lat, lon: tour.start_lon },
    { lat: tour.end_lat ?? tour.start_lat, lon: tour.end_lon ?? tour.start_lon },
    stops.map((s) => ({
      id: s.id,
      lat: s.lat!,
      lon: s.lon!,
      fixed_position: s.fixed_position,
      dwell_s: (s.dwell_minutes ?? defaults.dwell_minutes) * 60,
      window: { from: windowSeconds(s.time_window_from, start), to: windowSeconds(s.time_window_to, start) },
    })),
    tour.mode,
    locale,
    manualOrder,
  );

  await tx(async (c) => {
    await c.query("update tours set route = $2, updated_at = now() where id = $1", [tourId, JSON.stringify(route)]);
    let i = 1;
    for (const id of route.order) await c.query("update tour_stops set sort_index = $2 where id = $1", [id, i++]);
  });
  await recomputePlannedEtas(tourId);
  return (await getTour(tourId))!;
}

/** Planned ETAs from planned start + legs + dwell (+ waiting for time windows). */
export async function recomputePlannedEtas(tourId: string) {
  const tour = await getTour(tourId);
  if (!tour?.route) return;
  const defaults = await getSetting("tour_defaults");
  const startRow = await q1<{ start: Date }>(
    `select ((date + coalesce(planned_start, $2::time)) at time zone $3) as start from tours where id = $1`,
    [tourId, defaults.planned_start, tz()],
  );
  if (!startRow) return;
  const stops = new Map((await getStops(tourId)).map((s) => [s.id, s]));
  let t = startRow.start.getTime();
  const startHHMM = tour.planned_start ?? defaults.planned_start;
  const updates: [string, Date][] = [];
  tour.route.order.forEach((id, i) => {
    const s = stops.get(id);
    if (!s) return;
    t += (tour.route!.legs[i]?.duration_s ?? 0) * 1000;
    const from = windowSeconds(s.time_window_from, startHHMM);
    if (from != null) t = Math.max(t, startRow.start.getTime() + from * 1000);
    updates.push([id, new Date(t)]);
    t += (s.dwell_minutes ?? defaults.dwell_minutes) * 60_000;
  });
  for (const [id, eta] of updates) await q("update tour_stops set eta = $2 where id = $1", [id, eta]);
}

/** Live ETAs from the current vehicle position through the remaining open stops (throttled). */
const lastLiveEta = new Map<string, number>();
export async function recomputeLiveEtas(tourId: string, pos: { lat: number; lon: number }, force = false) {
  const now = Date.now();
  if (!force && now - (lastLiveEta.get(tourId) ?? 0) < 60_000) return;
  lastLiveEta.set(tourId, now);
  const tour = await getTour(tourId);
  if (!tour || tour.status !== "in_progress") return;
  const defaults = await getSetting("tour_defaults");
  const open = (await getStops(tourId)).filter((s) => (s.status === "pending" || s.status === "arrived") && s.lat != null);
  if (!open.length) return;
  // Valhalla limits locations per request (default 20); ETAs beyond that keep their planned offset
  const slice = open.slice(0, 19);
  try {
    const legs = await legDurations([pos, ...slice.map((s) => ({ lat: s.lat!, lon: s.lon! }))], tour.mode);
    let t = now;
    for (let i = 0; i < slice.length; i++) {
      if (slice[i].status === "arrived") {
        t += (slice[i].dwell_minutes ?? defaults.dwell_minutes) * 60_000;
        continue;
      }
      t += (legs[i] ?? 0) * 1000;
      await q("update tour_stops set eta = $2 where id = $1", [slice[i].id, new Date(t)]);
      t += (slice[i].dwell_minutes ?? defaults.dwell_minutes) * 60_000;
    }
  } catch (e) {
    console.warn("[eta] live ETA failed:", (e as Error).message);
  }
}

// ── Lifecycle ────────────────────────────────────────────────────────────

export async function releaseTour(id: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const tour = await getTour(id);
  if (!tour) return { ok: false, reason: "not_found" };
  if (tour.status !== "draft") return { ok: false, reason: "not_draft" };
  if (!tour.route) return { ok: false, reason: "route_missing" };
  if (!tour.driver_id) return { ok: false, reason: "driver_missing" };
  await q("update tours set status = 'released', released_at = now(), updated_at = now() where id = $1", [id]);
  return { ok: true };
}

export async function unreleaseTour(id: string) {
  await q("update tours set status = 'draft', released_at = null, updated_at = now() where id = $1 and status = 'released'", [id]);
}

/** Driver starts the tour in the app. Idempotent. Returns true when it was started now. */
export async function startTour(id: string): Promise<boolean> {
  return tx(async (c) => {
    const r = await c.query(
      `update tours set status = 'in_progress', started_at = now(), updated_at = now() where id = $1 and status = 'released'`,
      [id],
    );
    if (!r.rowCount) return false;
    await c.query(
      `update orders set status = 'out_for_delivery', updated_at = now()
        where id in (select tso.order_id from tour_stop_orders tso join tour_stops s on s.id = tso.stop_id where s.tour_id = $1)
          and status = 'planned'`,
      [id],
    );
    // Tracking links expire at the end of the tour day (+6 h buffer for late tours)
    await c.query(
      `update tour_stops s set tracking_expires_at = ((t.date + 1) at time zone $2) + interval '6 hours'
         from tours t where t.id = s.tour_id and s.tour_id = $1`,
      [id, tz()],
    );
    return true;
  });
}

export async function finishTour(id: string) {
  await tx(async (c) => {
    await c.query(
      `update tours set status = 'done', finished_at = now(), updated_at = now() where id = $1 and status = 'in_progress'`,
      [id],
    );
    // Stops never reached count as skipped; their orders go back to open for re-planning
    const skipped = await c.query<{ id: string }>(
      `update tour_stops set status = 'skipped', completed_at = now() where tour_id = $1 and status in ('pending', 'arrived') returning id`,
      [id],
    );
    if (skipped.rowCount) {
      await c.query(
        `update orders set status = 'open', updated_at = now()
          where id in (select order_id from tour_stop_orders where stop_id = any($1::uuid[])) and status = 'out_for_delivery'`,
        [skipped.rows.map((r) => r.id)],
      );
      await c.query(
        `delete from tour_stop_orders where stop_id = any($1::uuid[])`,
        [skipped.rows.map((r) => r.id)],
      );
    }
  });
}

/** Open stops (pending/arrived) in driving order. */
export async function openStops(tourId: string) {
  return q<{ id: string; status: StopStatus; sort_index: number | null; tracking_active_from: string | null }>(
    `select id, status, sort_index, tracking_active_from from tour_stops
      where tour_id = $1 and status in ('pending', 'arrived') order by sort_index nulls last`,
    [tourId],
  );
}
