import { brandName, publicBaseUrl } from "../branding";
import { customerDisplayName } from "../barcodes";
import { q, q1 } from "../db";
import { defaultLocale, intlLocale, isLocale, makeT, type Locale } from "../i18n-core";
import { getSetting, getSettings } from "../settings";
import { tz } from "../tours";
import { emailEnabled, sendEmail } from "./email";
import { DEFAULT_TEMPLATES, renderTemplate, type NotifyKind } from "./templates";
import { sendWhatsApp, whatsappEnabled, whatsappProvider } from "./whatsapp";

/**
 * Customer notifications.
 *
 * Messages are queued in `notifications` (one per stop/kind/channel for automatic kinds, so they
 * are never sent twice) and delivered by the notify worker with retries.
 *
 * Flow for a tour:
 *  - Driver starts the tour → the first `lead_stops` open stops get their tracking activated and
 *    an "approaching" message; all others get a "day_start" message with the (still waiting) link.
 *  - Each time a stop is completed, the next stops move into the window of `lead_stops` open stops
 *    → tracking activated + "approaching" message.
 *  - Dispatchers and drivers can send a "manual" message at any time.
 */

export const trackingUrl = (token: string) => `${publicBaseUrl()}/t/${token}`;
const MAX_ATTEMPTS = 5;

type StopContext = {
  stop_id: string;
  tracking_token: string;
  eta: Date | null;
  status: string;
  tour_date: string;
  tour_id: string;
  driver_name: string | null;
  customer_id: string;
  company: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  whatsapp: string | null;
  notify_email: boolean;
  notify_whatsapp: boolean;
  locale: string | null;
  order_numbers: string | null;
};

async function stopContext(stopId: string): Promise<StopContext | null> {
  return q1<StopContext>(
    `select s.id as stop_id, s.tracking_token, s.eta, s.status, to_char(t.date, 'YYYY-MM-DD') as tour_date, t.id as tour_id,
            coalesce(u.display_name, u.username::text) as driver_name,
            c.id as customer_id, c.company, c.first_name, c.last_name, c.email, c.whatsapp, c.notify_email, c.notify_whatsapp, c.locale,
            (select string_agg(o.order_no::text, ', ' order by o.order_no) from tour_stop_orders tso join orders o on o.id = tso.order_id where tso.stop_id = s.id) as order_numbers
       from tour_stops s join tours t on t.id = s.tour_id join customers c on c.id = s.customer_id
       left join users u on u.id = t.driver_id
      where s.id = $1`,
    [stopId],
  );
}

/** Channels a customer agreed to and that are configured. */
function channelsFor(c: StopContext): { channel: "email" | "whatsapp"; recipient: string }[] {
  const out: { channel: "email" | "whatsapp"; recipient: string }[] = [];
  if (c.notify_email && c.email && emailEnabled()) out.push({ channel: "email", recipient: c.email });
  if (c.notify_whatsapp && c.whatsapp && whatsappEnabled()) out.push({ channel: "whatsapp", recipient: c.whatsapp });
  return out;
}

/** Queues a message for a stop on all agreed channels. Returns number of queued messages. */
export async function queueForStop(
  stopId: string,
  kind: NotifyKind,
  opts: { createdBy?: string | null; channels?: ("email" | "whatsapp")[] } = {},
): Promise<number> {
  const ctx = await stopContext(stopId);
  if (!ctx) return 0;
  let n = 0;
  for (const ch of channelsFor(ctx)) {
    if (opts.channels && !opts.channels.includes(ch.channel)) continue;
    const row = await q1<{ id: string }>(
      `insert into notifications (stop_id, customer_id, channel, kind, recipient, created_by)
       values ($1, $2, $3, $4, $5, $6) on conflict do nothing returning id`,
      [stopId, ctx.customer_id, ch.channel, kind, ch.recipient, opts.createdBy ?? null],
    );
    if (row) n++;
  }
  return n;
}

function fmtTime(d: Date, locale: Locale) {
  return d.toLocaleTimeString(intlLocale(locale), { hour: "2-digit", minute: "2-digit", timeZone: tz() });
}

function etaWindow(eta: Date | null, minutes: number, locale: Locale): string {
  if (!eta) return "—";
  const half = (minutes / 2) * 60_000;
  const round = (t: number) => new Date(Math.round(t / 300_000) * 300_000);
  return `${fmtTime(round(eta.getTime() - half), locale)}–${fmtTime(round(eta.getTime() + half), locale)}`;
}

async function render(ctx: StopContext, kind: NotifyKind) {
  const settings = await getSettings();
  const locale: Locale = isLocale(ctx.locale) ? ctx.locale : defaultLocale();
  const tpl = settings.templates[`${kind}.${locale}`] ?? DEFAULT_TEMPLATES[kind][locale];
  const ahead = await q1<{ n: number }>(
    `select count(*)::int as n from tour_stops s, tour_stops me
      where me.id = $1 and s.tour_id = me.tour_id and s.status in ('pending', 'arrived') and s.sort_index < me.sort_index`,
    [ctx.stop_id],
  );
  const link = trackingUrl(ctx.tracking_token);
  const vars = {
    customer_name: customerDisplayName(ctx),
    company: settings.company.name || brandName(),
    eta: ctx.eta ? fmtTime(ctx.eta, locale) : "—",
    eta_window: etaWindow(ctx.eta, settings.notifications.eta_window_minutes, locale),
    date: new Date(`${ctx.tour_date}T12:00:00Z`).toLocaleDateString(intlLocale(locale), { dateStyle: "medium" }),
    tracking_link: link,
    stops_ahead: String(ahead?.n ?? 0),
    order_numbers: ctx.order_numbers ?? "",
    driver_name: ctx.driver_name ?? "",
  };
  return {
    locale,
    link,
    vars,
    subject: renderTemplate(tpl.subject, vars),
    text: renderTemplate(tpl.body, vars),
    linkLabel: makeT(locale)("tracking.open_link"),
  };
}

/** Sends queued messages (called by the worker and right after queueing). */
let processing = false;
export async function processQueue(limit = 50) {
  if (processing) return;
  processing = true;
  try {
    const rows = await q<{ id: string; stop_id: string | null; channel: string; kind: NotifyKind; recipient: string; attempts: number }>(
      `select id, stop_id, channel, kind, recipient, attempts from notifications
        where status = 'queued' and (attempts = 0 or created_at < now() - (attempts * interval '2 minutes'))
        order by created_at limit $1`,
      [limit],
    );
    for (const n of rows) {
      try {
        const ctx = n.stop_id ? await stopContext(n.stop_id) : null;
        if (!ctx) {
          await q("update notifications set status = 'skipped', error = 'stop removed' where id = $1", [n.id]);
          continue;
        }
        const msg = await render(ctx, n.kind);
        let id: string;
        let provider: string;
        if (n.channel === "email") {
          ({ id } = await sendEmail({ to: n.recipient, subject: msg.subject, text: msg.text, link: msg.link, linkLabel: msg.linkLabel }));
          provider = "smtp";
        } else {
          ({ id, provider } = await sendWhatsApp({
            to: n.recipient,
            kind: n.kind,
            locale: msg.locale,
            text: msg.text,
            vars: { customer_name: msg.vars.customer_name, eta: n.kind === "day_start" ? msg.vars.eta_window : msg.vars.eta, tracking_link: msg.link },
          }));
        }
        await q(
          "update notifications set status = 'sent', sent_at = now(), attempts = attempts + 1, provider = $2, provider_msg_id = $3, error = null where id = $1",
          [n.id, provider, id],
        );
      } catch (e) {
        const err = (e as Error).message.slice(0, 500);
        await q(
          `update notifications set attempts = attempts + 1, error = $2,
                  status = case when attempts + 1 >= $3 then 'failed' else 'queued' end where id = $1`,
          [n.id, err, MAX_ATTEMPTS],
        );
        console.warn(`[notify] ${n.channel} to ${n.recipient} failed: ${err}`);
      }
    }
  } finally {
    processing = false;
  }
}

/**
 * Activates tracking for the next `lead_stops` open stops of a running tour and queues their
 * "approaching" message (once per stop). Returns ids of newly activated stops.
 */
export async function activateUpcoming(tourId: string): Promise<string[]> {
  const settings = await getSetting("notifications");
  const rows = await q<{ id: string }>(
    `with open as (
       select s.id, s.tracking_active_from from tour_stops s join tours t on t.id = s.tour_id
        where s.tour_id = $1 and t.status = 'in_progress' and s.status in ('pending', 'arrived')
        order by s.sort_index nulls last limit $2)
     update tour_stops s set tracking_active_from = now()
       from open where s.id = open.id and open.tracking_active_from is null
     returning s.id`,
    [tourId, settings.lead_stops],
  );
  if (settings.approaching) for (const r of rows) await queueForStop(r.id, "approaching");
  return rows.map((r) => r.id);
}

/** Tour start: approaching for the first stops, day_start for all others. */
export async function onTourStarted(tourId: string) {
  const settings = await getSetting("notifications");
  await activateUpcoming(tourId);
  if (settings.day_start) {
    const rest = await q<{ id: string }>(
      "select id from tour_stops where tour_id = $1 and tracking_active_from is null and status = 'pending'",
      [tourId],
    );
    for (const r of rest) await queueForStop(r.id, "day_start");
  }
  void processQueue();
}

/** After an outcome: optional delivered/failed message, then move the window forward. */
export async function onStopCompleted(tourId: string, stopId: string, kind: "success" | "failure" | "neutral" | null) {
  const settings = await getSetting("notifications");
  if (kind === "success" && settings.delivered) await queueForStop(stopId, "delivered");
  if (kind === "failure" && settings.failed) await queueForStop(stopId, "failed");
  await activateUpcoming(tourId);
  void processQueue();
}

export function notifyStatus() {
  return {
    email: emailEnabled(),
    whatsapp: whatsappEnabled(),
    whatsapp_provider: whatsappProvider(),
  };
}
