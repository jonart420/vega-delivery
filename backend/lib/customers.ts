import { z } from "zod";
import { clean } from "./api";
import { customerDisplayName, isValidGtin, nextCustomerNo } from "./barcodes";
import { q, q1 } from "./db";
import { geocodeAddress } from "./geocode";

export type Customer = {
  id: string;
  customer_no: string;
  company: string | null;
  first_name: string | null;
  last_name: string | null;
  street: string;
  house_no: string | null;
  address_extra: string | null;
  zip: string;
  city: string;
  country: string;
  lat: number | null;
  lon: number | null;
  geocode_status: "pending" | "ok" | "manual" | "failed";
  phone: string | null;
  email: string | null;
  whatsapp: string | null;
  notify_email: boolean;
  notify_whatsapp: boolean;
  notify_consent_at: string | null;
  locale: string | null;
  delivery_notes: string | null;
  time_window_from: string | null;
  time_window_to: string | null;
  dwell_minutes: number | null;
  barcode_mode: "per_customer" | "per_delivery" | null;
  fixed_delivery_ean: string | null;
  notes: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export const CUSTOMER_COLS = `c.id, c.customer_no, c.company, c.first_name, c.last_name, c.street, c.house_no,
  c.address_extra, c.zip, c.city, c.country, c.lat, c.lon, c.geocode_status, c.phone, c.email, c.whatsapp,
  c.notify_email, c.notify_whatsapp, c.notify_consent_at, c.locale, c.delivery_notes,
  to_char(c.time_window_from, 'HH24:MI') as time_window_from, to_char(c.time_window_to, 'HH24:MI') as time_window_to,
  c.dwell_minutes, c.barcode_mode, c.fixed_delivery_ean, c.notes, c.active, c.created_at, c.updated_at`;

export const customerName = customerDisplayName;

export function addressLine(c: Pick<Customer, "street" | "house_no" | "zip" | "city">): string {
  return `${[c.street, c.house_no].filter(Boolean).join(" ")}, ${c.zip} ${c.city}`;
}

const opt = (max: number) => z.string().max(max).nullish().transform((v) => clean(v ?? null));
const time = z
  .string()
  .regex(/^\d{2}:\d{2}$/)
  .nullish()
  .or(z.literal("").transform(() => null))
  .transform((v) => v || null);

/** E.164 normalization for WhatsApp/phone numbers (+49…); keeps null for empty. */
export function normalizePhone(v: string | null, defaultCountryCode = process.env.DEFAULT_PHONE_PREFIX || "+49"): string | null {
  if (!v) return null;
  let s = v.replace(/[\s\-/().]/g, "");
  if (s.startsWith("00")) s = "+" + s.slice(2);
  else if (s.startsWith("0")) s = defaultCountryCode + s.slice(1);
  return /^\+[1-9]\d{6,14}$/.test(s) ? s : null;
}

export const CustomerInput = z
  .object({
    company: opt(160),
    first_name: opt(80),
    last_name: opt(80),
    street: z.string().min(1).max(160).transform((v) => v.normalize("NFC").trim()),
    house_no: opt(20),
    address_extra: opt(160),
    zip: z.string().min(1).max(12).transform((v) => v.trim()),
    city: z.string().min(1).max(120).transform((v) => v.normalize("NFC").trim()),
    country: z.string().length(2).default("DE").transform((v) => v.toUpperCase()),
    lat: z.number().min(-90).max(90).nullish(),
    lon: z.number().min(-180).max(180).nullish(),
    phone: opt(40),
    email: z.string().email().max(200).nullish().or(z.literal("").transform(() => null)),
    whatsapp: opt(40),
    notify_email: z.boolean().default(false),
    notify_whatsapp: z.boolean().default(false),
    locale: z.enum(["en", "de"]).nullish(),
    delivery_notes: opt(500),
    time_window_from: time,
    time_window_to: time,
    dwell_minutes: z.number().int().min(0).max(240).nullish(),
    barcode_mode: z.enum(["per_customer", "per_delivery"]).nullish(),
    fixed_delivery_ean: z
      .string()
      .nullish()
      .transform((v) => clean(v ?? null))
      .refine((v) => !v || isValidGtin(v, 13), "invalid EAN-13 (check digit)"),
    notes: opt(2000),
    active: z.boolean().default(true),
  })
  .refine((c) => c.company || c.last_name || c.first_name, { message: "name or company required", path: ["last_name"] })
  .transform((c) => ({ ...c, whatsapp: normalizePhone(c.whatsapp), phone: c.phone }));

export type CustomerInputT = z.infer<typeof CustomerInput>;

export async function getCustomer(id: string): Promise<Customer | null> {
  return q1<Customer>(`select ${CUSTOMER_COLS} from customers c where c.id = $1`, [id]);
}

export async function listCustomers(opts: { search?: string; includeInactive?: boolean; limit?: number; offset?: number }) {
  const params: unknown[] = [];
  const where: string[] = [];
  if (!opts.includeInactive) where.push("c.active");
  if (opts.search?.trim()) {
    params.push(`%${opts.search.normalize("NFC").trim()}%`);
    const p = `$${params.length}`;
    where.push(`(c.customer_no like ${p} or c.company ilike ${p} or c.first_name ilike ${p} or c.last_name ilike ${p}
      or c.street ilike ${p} or c.city ilike ${p} or c.zip like ${p} or c.email ilike ${p} or c.phone like ${p})`);
  }
  params.push(Math.min(opts.limit ?? 200, 1000), opts.offset ?? 0);
  return q<Customer>(
    `select ${CUSTOMER_COLS} from customers c ${where.length ? "where " + where.join(" and ") : ""}
      order by coalesce(c.company, c.last_name, c.first_name) collate "C", c.customer_no
      limit $${params.length - 1} offset $${params.length}`,
    params,
  );
}

/** Coordinates: explicit (manual pin) or geocoded from the address. */
async function resolveCoords(input: CustomerInputT, previous?: Customer | null) {
  if (input.lat != null && input.lon != null) {
    const moved = !previous || previous.lat !== input.lat || previous.lon !== input.lon;
    return { lat: input.lat, lon: input.lon, status: moved || previous?.geocode_status === "manual" ? "manual" : previous!.geocode_status };
  }
  const addressChanged =
    !previous ||
    previous.street !== input.street ||
    previous.house_no !== input.house_no ||
    previous.zip !== input.zip ||
    previous.city !== input.city;
  if (!addressChanged && previous?.lat != null) return { lat: previous.lat, lon: previous.lon, status: previous.geocode_status };
  try {
    const hit = await geocodeAddress(input);
    return hit ? { ...hit, status: "ok" } : { lat: null, lon: null, status: "failed" };
  } catch {
    return { lat: null, lon: null, status: "pending" };
  }
}

export async function createCustomer(input: CustomerInputT): Promise<Customer> {
  const coords = await resolveCoords(input);
  const no = await nextCustomerNo();
  const consent = input.notify_email || input.notify_whatsapp;
  const row = await q1<{ id: string }>(
    `insert into customers (customer_no, company, first_name, last_name, street, house_no, address_extra, zip, city, country,
       lat, lon, geocode_status, phone, email, whatsapp, notify_email, notify_whatsapp, notify_consent_at, locale,
       delivery_notes, time_window_from, time_window_to, dwell_minutes, barcode_mode, fixed_delivery_ean, notes, active)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18, case when $19 then now() end,$20,$21,$22,$23,$24,$25,$26,$27,$28)
     returning id`,
    [
      no, input.company, input.first_name, input.last_name, input.street, input.house_no, input.address_extra, input.zip,
      input.city, input.country, coords.lat, coords.lon, coords.status, input.phone, input.email, input.whatsapp,
      input.notify_email, input.notify_whatsapp, consent, input.locale ?? null, input.delivery_notes,
      input.time_window_from, input.time_window_to, input.dwell_minutes ?? null, input.barcode_mode ?? null,
      input.fixed_delivery_ean, input.notes, input.active,
    ],
  );
  return (await getCustomer(row!.id))!;
}

export async function updateCustomer(id: string, input: CustomerInputT): Promise<Customer | null> {
  const prev = await getCustomer(id);
  if (!prev) return null;
  const coords = await resolveCoords(input, prev);
  const consentNow = (input.notify_email && !prev.notify_email) || (input.notify_whatsapp && !prev.notify_whatsapp);
  await q(
    `update customers set company=$2, first_name=$3, last_name=$4, street=$5, house_no=$6, address_extra=$7, zip=$8, city=$9,
       country=$10, lat=$11, lon=$12, geocode_status=$13, phone=$14, email=$15, whatsapp=$16, notify_email=$17,
       notify_whatsapp=$18, notify_consent_at = case when $19 then now() else notify_consent_at end, locale=$20,
       delivery_notes=$21, time_window_from=$22, time_window_to=$23, dwell_minutes=$24, barcode_mode=$25,
       fixed_delivery_ean=$26, notes=$27, active=$28, updated_at=now()
     where id = $1`,
    [
      id, input.company, input.first_name, input.last_name, input.street, input.house_no, input.address_extra, input.zip,
      input.city, input.country, coords.lat, coords.lon, coords.status, input.phone, input.email, input.whatsapp,
      input.notify_email, input.notify_whatsapp, consentNow, input.locale ?? null, input.delivery_notes,
      input.time_window_from, input.time_window_to, input.dwell_minutes ?? null, input.barcode_mode ?? null,
      input.fixed_delivery_ean, input.notes, input.active,
    ],
  );
  return getCustomer(id);
}

// ── CSV ───────────────────────────────────────────────────────────────────

export const CSV_COLUMNS = [
  "customer_no", "company", "first_name", "last_name", "street", "house_no", "address_extra", "zip", "city", "country",
  "phone", "email", "whatsapp", "notify_email", "notify_whatsapp", "locale", "delivery_notes", "time_window_from",
  "time_window_to", "lat", "lon",
] as const;

const csvCell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Semicolon-separated UTF-8 CSV with BOM (opens correctly in Excel incl. umlauts). */
export function customersToCsv(rows: Customer[]): string {
  const lines = [CSV_COLUMNS.join(";")];
  for (const r of rows) lines.push(CSV_COLUMNS.map((c) => csvCell((r as Record<string, unknown>)[c])).join(";"));
  return "﻿" + lines.join("\r\n") + "\r\n";
}

/** Minimal CSV parser (separator auto-detected: ; or ,), quoted fields supported. */
export function parseCsv(text: string): Record<string, string>[] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const sep = (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const [header, ...data] = rows.filter((r) => r.some((c) => c.trim()));
  if (!header) return [];
  const keys = header.map((h) => h.trim().toLowerCase());
  return data.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").normalize("NFC").trim()])));
}

const truthy = (v: string | undefined) => !!v && ["1", "true", "yes", "ja", "x"].includes(v.toLowerCase());

export function csvRowToInput(r: Record<string, string>): unknown {
  const num = (v: string | undefined) => (v ? Number(v.replace(",", ".")) : null);
  return {
    company: r.company,
    first_name: r.first_name,
    last_name: r.last_name,
    street: r.street,
    house_no: r.house_no,
    address_extra: r.address_extra,
    zip: r.zip,
    city: r.city,
    country: r.country || "DE",
    phone: r.phone,
    email: r.email || null,
    whatsapp: r.whatsapp,
    notify_email: truthy(r.notify_email),
    notify_whatsapp: truthy(r.notify_whatsapp),
    locale: r.locale === "de" || r.locale === "en" ? r.locale : null,
    delivery_notes: r.delivery_notes,
    time_window_from: r.time_window_from || null,
    time_window_to: r.time_window_to || null,
    lat: num(r.lat),
    lon: num(r.lon),
  };
}
