import { z } from "zod";
import { decodeCset82 } from "./barcodes";
import { q, q1, tx } from "./db";
import type { Outcome } from "./outcomes";
import { getSetting } from "./settings";

/** Delivery log: outcome events from the driver apps (and manual corrections in the backend). */

export const EventInput = z.object({
  client_id: z.string().min(8).max(80),
  stop_id: z.string().uuid(),
  type: z.enum(["outcome", "arrived", "note"]).default("outcome"),
  outcome_code: z.string().max(40).nullish(),
  reason_id: z.string().uuid().nullish(),
  reason_text: z.string().max(1000).nullish(),
  recipient_name: z.string().max(160).nullish(),
  neighbor_info: z.string().max(300).nullish(),
  scanned_codes: z.array(z.string().max(400)).max(50).default([]),
  note: z.string().max(2000).nullish(),
  lat: z.number().min(-90).max(90).nullish(),
  lon: z.number().min(-180).max(180).nullish(),
  occurred_at: z.string().datetime({ offset: true }).nullish(),
});
export type EventInputT = z.infer<typeof EventInput>;

export type DeliveryEvent = {
  id: string;
  tour_id: string;
  stop_id: string | null;
  customer_id: string | null;
  type: string;
  outcome_code: string | null;
  outcome_label_en: string | null;
  outcome_label_de: string | null;
  outcome_kind: string | null;
  reason_label_en: string | null;
  reason_label_de: string | null;
  reason_text: string | null;
  recipient_name: string | null;
  neighbor_info: string | null;
  scanned_codes: string[] | null;
  photo_path: string | null;
  signature_path: string | null;
  note: string | null;
  lat: number | null;
  lon: number | null;
  occurred_at: string;
  user_name: string | null;
  customer_no: string | null;
  customer_label: string | null;
  tour_title: string | null;
  tour_date: string | null;
};

export class EventValidationError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

/** Normalizes a scanned value: digits of EAN-8/13 (GS1 composite "|(91)…" part removed). */
export function scannedGtin(raw: string): string {
  const s = raw.replace(/^\][A-Za-z]\d/, "").split("|")[0].trim();
  return s.replace(/\D/g, "");
}

/** Customer name from a scanned composite symbol, if present. */
export function scannedCompositeName(raw: string): string | null {
  const m = raw.match(/\(91\)(.+)$/) ?? raw.match(/\x1d?91(.+)$/);
  return m ? decodeCset82(m[1]) : null;
}

export async function recordEvent(
  tourId: string,
  input: EventInputT,
  actor: { userId: string | null; deviceId: string | null },
  files: { photo_path?: string | null; signature_path?: string | null } = {},
): Promise<{ event_id: string; duplicate: boolean; stop_status: string; outcome_kind: string | null }> {
  const existing = await q1<{ id: string; status: string; kind: string | null }>(
    `select e.id, s.status, o.kind from delivery_events e
       left join tour_stops s on s.id = e.stop_id left join delivery_outcomes o on o.code = e.outcome_code
      where e.client_id = $1`,
    [input.client_id],
  );
  if (existing) return { event_id: existing.id, duplicate: true, stop_status: existing.status, outcome_kind: existing.kind };

  const stop = await q1<{ id: string; customer_id: string; status: string; customer_no: string }>(
    `select s.id, s.customer_id, s.status, c.customer_no from tour_stops s join customers c on c.id = s.customer_id
      where s.id = $1 and s.tour_id = $2`,
    [input.stop_id, tourId],
  );
  if (!stop) throw new EventValidationError("stop_not_found");

  let outcome: Outcome | null = null;
  if (input.type === "outcome") {
    outcome = await q1<Outcome>("select * from delivery_outcomes where code = $1 and active", [input.outcome_code ?? ""]);
    if (!outcome) throw new EventValidationError("outcome_unknown");
    if (outcome.requires_reason && !input.reason_id && !input.reason_text?.trim()) throw new EventValidationError("reason_required");
    if (input.reason_id) {
      const r = await q1("select 1 from delivery_reasons where id = $1 and outcome_code = $2", [input.reason_id, outcome.code]);
      if (!r) throw new EventValidationError("reason_unknown");
    }
    if (outcome.requires_photo && !files.photo_path) throw new EventValidationError("photo_required");
    if (outcome.requires_signature && !files.signature_path) throw new EventValidationError("signature_required");
    if (outcome.requires_recipient && !input.recipient_name?.trim()) throw new EventValidationError("recipient_required");
    if (outcome.requires_scan) {
      const eans = await q<{ delivery_ean13: string }>(
        `select o.delivery_ean13 from tour_stop_orders tso join orders o on o.id = tso.order_id where tso.stop_id = $1`,
        [stop.id],
      );
      // The customer indicator sheet (EAN-8 composite) stays at the customer, so scanning it
      // proves presence without printing a new label per order; see Settings → Barcodes.
      const accept = (await getSetting("barcodes")).scan_accept;
      const valid = new Set([
        ...(accept !== "customer" ? eans.map((e) => e.delivery_ean13) : []),
        ...(accept !== "delivery" ? [stop.customer_no] : []),
      ]);
      if (!input.scanned_codes.some((c) => valid.has(scannedGtin(c)))) throw new EventValidationError("scan_required");
    }
  }

  return tx(async (c) => {
    const ins = await c.query<{ id: string }>(
      `insert into delivery_events (client_id, tour_id, stop_id, customer_id, user_id, device_id, type, outcome_code, reason_id,
         reason_text, recipient_name, neighbor_info, scanned_codes, photo_path, signature_path, note, lat, lon, occurred_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18, coalesce($19::timestamptz, now()))
       on conflict (client_id) do nothing returning id`,
      [
        input.client_id, tourId, stop.id, stop.customer_id, actor.userId, actor.deviceId, input.type, outcome?.code ?? null,
        input.reason_id ?? null, input.reason_text?.normalize("NFC").trim() || null,
        input.recipient_name?.normalize("NFC").trim() || null, input.neighbor_info?.normalize("NFC").trim() || null,
        input.scanned_codes.length ? input.scanned_codes : null, files.photo_path ?? null, files.signature_path ?? null,
        input.note?.normalize("NFC").trim() || null, input.lat ?? null, input.lon ?? null, input.occurred_at ?? null,
      ],
    );
    if (!ins.rows[0]) {
      const again = await c.query<{ id: string }>("select id from delivery_events where client_id = $1", [input.client_id]);
      return { event_id: again.rows[0].id, duplicate: true, stop_status: stop.status, outcome_kind: outcome?.kind ?? null };
    }
    let stopStatus = stop.status;
    if (input.type === "arrived" && stop.status === "pending") {
      stopStatus = "arrived";
      await c.query("update tour_stops set status = 'arrived' where id = $1", [stop.id]);
    } else if (outcome?.final && outcome.kind !== "neutral") {
      stopStatus = outcome.kind === "success" ? "delivered" : "failed";
      await c.query(
        "update tour_stops set status = $2, outcome_code = $3, completed_at = coalesce($4::timestamptz, now()) where id = $1",
        [stop.id, stopStatus, outcome.code, input.occurred_at ?? null],
      );
      await c.query(
        `update orders set status = $2, updated_at = now() where id in (select order_id from tour_stop_orders where stop_id = $1)`,
        [stop.id, stopStatus === "delivered" ? "delivered" : "failed"],
      );
    }
    return { event_id: ins.rows[0].id, duplicate: false, stop_status: stopStatus, outcome_kind: outcome?.kind ?? null };
  });
}

const EVENT_SELECT = `
  select e.id, e.tour_id, e.stop_id, e.customer_id, e.type, e.outcome_code,
         o.label_en as outcome_label_en, o.label_de as outcome_label_de, o.kind as outcome_kind,
         r.label_en as reason_label_en, r.label_de as reason_label_de, e.reason_text, e.recipient_name, e.neighbor_info,
         e.scanned_codes, e.photo_path, e.signature_path, e.note, e.lat, e.lon, e.occurred_at,
         coalesce(u.display_name, u.username::text) as user_name,
         c.customer_no, concat_ws(' - ', nullif(concat_ws(' ', c.first_name, c.last_name), ''), c.company) as customer_label,
         t.title as tour_title, to_char(t.date, 'YYYY-MM-DD') as tour_date
    from delivery_events e
    left join delivery_outcomes o on o.code = e.outcome_code
    left join delivery_reasons r on r.id = e.reason_id
    left join users u on u.id = e.user_id
    left join customers c on c.id = e.customer_id
    left join tours t on t.id = e.tour_id`;

export async function eventsForTour(tourId: string): Promise<DeliveryEvent[]> {
  return q<DeliveryEvent>(`${EVENT_SELECT} where e.tour_id = $1 order by e.occurred_at desc`, [tourId]);
}

export async function eventsForCustomer(customerId: string, limit = 100): Promise<DeliveryEvent[]> {
  return q<DeliveryEvent>(`${EVENT_SELECT} where e.customer_id = $1 order by e.occurred_at desc limit $2`, [customerId, limit]);
}

export async function getEvent(id: string): Promise<DeliveryEvent | null> {
  return q1<DeliveryEvent>(`${EVENT_SELECT} where e.id = $1`, [id]);
}
