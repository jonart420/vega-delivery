import { q1 } from "./db";
import { getSetting } from "./settings";

/**
 * Public tracking data for a customer link (/t/<token>). Reveals no data of other customers:
 * only this stop, the number of stops ahead and – once tracking is active – the vehicle position.
 */

export type PublicTracking = {
  state: "scheduled" | "waiting" | "active" | "arrived" | "delivered" | "failed" | "expired";
  tour_date: string;
  eta: string | null;
  stops_ahead: number | null;
  vehicle: { lat: number; lon: number; heading: number | null; t: string } | null;
  destination: { lat: number; lon: number } | null;
  address: string;
  first_name: string | null;
  outcome: { code: string; label_en: string; label_de: string; kind: string } | null;
  completed_at: string | null;
  locale: string | null;
  lead_stops: number;
};

type Row = {
  stop_id: string;
  status: string;
  eta: Date | null;
  sort_index: number | null;
  tracking_active_from: Date | null;
  tracking_expires_at: Date | null;
  completed_at: Date | null;
  outcome_code: string | null;
  tour_status: string;
  tour_id: string;
  tour_date: string;
  street: string;
  house_no: string | null;
  zip: string;
  city: string;
  lat: number | null;
  lon: number | null;
  first_name: string | null;
  company: string | null;
  locale: string | null;
};

export async function publicTracking(token: string): Promise<PublicTracking | null> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  const r = await q1<Row>(
    `select s.id as stop_id, s.status, s.eta, s.sort_index, s.tracking_active_from, s.tracking_expires_at, s.completed_at,
            s.outcome_code, t.status as tour_status, t.id as tour_id, to_char(t.date, 'YYYY-MM-DD') as tour_date,
            c.street, c.house_no, c.zip, c.city, c.lat, c.lon, c.first_name, c.company, c.locale
       from tour_stops s join tours t on t.id = s.tour_id join customers c on c.id = s.customer_id
      where s.tracking_token = $1`,
    [token],
  );
  if (!r) return null;
  const settings = await getSetting("notifications");
  const base = {
    tour_date: r.tour_date,
    address: `${[r.street, r.house_no].filter(Boolean).join(" ")}, ${r.zip} ${r.city}`,
    first_name: r.first_name ?? r.company,
    locale: r.locale,
    lead_stops: settings.lead_stops,
    destination: r.lat != null && r.lon != null ? { lat: r.lat, lon: r.lon } : null,
  };
  const expired = r.tracking_expires_at && r.tracking_expires_at.getTime() < Date.now();

  if (r.status === "delivered" || r.status === "failed" || r.status === "skipped") {
    const outcome = r.outcome_code
      ? await q1<{ code: string; label_en: string; label_de: string; kind: string }>(
          "select code, label_en, label_de, kind from delivery_outcomes where code = $1",
          [r.outcome_code],
        )
      : null;
    return {
      ...base,
      state: r.status === "delivered" ? "delivered" : "failed",
      eta: null,
      stops_ahead: null,
      vehicle: null,
      outcome,
      completed_at: r.completed_at?.toISOString() ?? null,
    };
  }
  if (expired) {
    return { ...base, state: "expired", eta: null, stops_ahead: null, vehicle: null, outcome: null, completed_at: null };
  }

  const ahead = await q1<{ n: number }>(
    `select count(*)::int as n from tour_stops where tour_id = $1 and status in ('pending', 'arrived') and sort_index < $2`,
    [r.tour_id, r.sort_index ?? 0],
  );
  const running = r.tour_status === "in_progress";
  const active = running && (r.tracking_active_from != null || r.status === "arrived");
  let vehicle: PublicTracking["vehicle"] = null;
  if (active) {
    const p = await q1<{ lat: number; lon: number; heading: number | null; t: Date }>(
      "select lat, lon, heading, t from live_positions where tour_id = $1",
      [r.tour_id],
    );
    // Positions older than 15 minutes are not shown (app offline / paused)
    if (p && Date.now() - p.t.getTime() < 15 * 60_000) vehicle = { lat: p.lat, lon: p.lon, heading: p.heading, t: p.t.toISOString() };
  }
  return {
    ...base,
    state: r.status === "arrived" ? "arrived" : active ? "active" : running ? "waiting" : "scheduled",
    eta: r.eta?.toISOString() ?? null,
    stops_ahead: running ? (ahead?.n ?? 0) : null,
    vehicle,
    outcome: null,
    completed_at: null,
  };
}
