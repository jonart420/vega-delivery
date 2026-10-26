import { z } from "zod";
import { q, q1 } from "./db";

/** Typed key/value settings stored in the `settings` table (defaults when missing). */

const time = z.string().regex(/^\d{2}:\d{2}$/);

export const SettingSchemas = {
  company: z.object({
    name: z.string().max(120).default(""),
    phone: z.string().max(60).default(""),
    email: z.string().max(200).default(""),
    website: z.string().max(200).default(""),
  }),
  depot: z.object({
    label: z.string().max(200).default(""),
    lat: z.number().min(-90).max(90).nullable().default(null),
    lon: z.number().min(-180).max(180).nullable().default(null),
  }),
  tour_defaults: z.object({
    dwell_minutes: z.number().int().min(0).max(120).default(4),
    planned_start: time.default("08:00"),
    mode: z.enum(["auto", "bicycle", "pedestrian"]).default("auto"),
  }),
  notifications: z.object({
    lead_stops: z.number().int().min(1).max(20).default(3),
    day_start: z.boolean().default(true),
    approaching: z.boolean().default(true),
    delivered: z.boolean().default(false),
    failed: z.boolean().default(false),
    eta_window_minutes: z.number().int().min(10).max(480).default(60),
  }),
  barcodes: z.object({
    mode: z.enum(["per_customer", "per_delivery"]).default("per_delivery"),
    ean13_prefix: z.string().regex(/^2[0-9]$/, "20–29 (restricted circulation)").default("21"),
    /** Which scanned codes count as proof of delivery: customer indicator (EAN-8+C), order code (EAN-13) or both */
    scan_accept: z.enum(["any", "customer", "delivery"]).default("any"),
  }),
  templates: z
    .record(
      z.string(),
      z.object({ subject: z.string().max(200), body: z.string().max(4000) }),
    )
    .default({}),
} as const;

export type SettingKey = keyof typeof SettingSchemas;
export type Setting<K extends SettingKey> = z.infer<(typeof SettingSchemas)[K]>;

export async function getSetting<K extends SettingKey>(key: K): Promise<Setting<K>> {
  const row = await q1<{ value: unknown }>("select value from settings where key = $1", [key]);
  const parsed = SettingSchemas[key].safeParse(row?.value ?? {});
  return (parsed.success ? parsed.data : SettingSchemas[key].parse({})) as Setting<K>;
}

export async function getSettings(): Promise<{ [K in SettingKey]: Setting<K> }> {
  const rows = await q<{ key: string; value: unknown }>("select key, value from settings");
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(SettingSchemas) as SettingKey[]) {
    const parsed = SettingSchemas[key].safeParse(byKey.get(key) ?? {});
    out[key] = parsed.success ? parsed.data : SettingSchemas[key].parse({});
  }
  return out as { [K in SettingKey]: Setting<K> };
}

export async function setSetting<K extends SettingKey>(key: K, value: unknown): Promise<Setting<K>> {
  const parsed = SettingSchemas[key].parse(value) as Setting<K>;
  await q(
    `insert into settings (key, value, updated_at) values ($1, $2, now())
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [key, JSON.stringify(parsed)],
  );
  return parsed;
}
