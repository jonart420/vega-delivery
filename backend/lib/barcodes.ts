import bwipjs from "bwip-js/node";
import { q1 } from "./db";
import type { Setting } from "./settings";

/**
 * Barcodes.
 *
 * - Delivery code: EAN-13 from the GS1 "restricted circulation" range (prefix 20–29, for internal use).
 *   Mode `per_customer`: the same code on every delivery of a customer (derived from customer_no).
 *   Mode `per_delivery`: a new code per order (sequence). Global setting, overridable per customer.
 * - Customer indicator: EAN-8 composite symbol (ISO/IEC 24723). Linear part = customer number
 *   (7 digits + check digit), 2D part (CC-A/CC-B, chosen automatically by length) = GS1 AI (91) with
 *   the customer name. GS1 character set 82 has no umlauts, so the name is UTF-8 percent-encoded
 *   ("M%C3%BCller"); '%' itself is allowed, decoders turn it back into "Müller".
 */

/** GS1 mod-10 check digit for the given digits (without check digit). */
export function gs1CheckDigit(digits: string): number {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    const d = digits.charCodeAt(digits.length - 1 - i) - 48;
    sum += i % 2 === 0 ? d * 3 : d;
  }
  return (10 - (sum % 10)) % 10;
}

export function isValidGtin(code: string, length: 8 | 13): boolean {
  if (!new RegExp(`^\\d{${length}}$`).test(code)) return false;
  return gs1CheckDigit(code.slice(0, -1)) === Number(code.at(-1));
}

/** Customer number (EAN-8) from 7 digits. */
export function customerNoFrom7(seven: number | string): string {
  const s = String(seven).padStart(7, "0");
  if (!/^\d{7}$/.test(s)) throw new Error("customer number base must have 7 digits");
  return s + gs1CheckDigit(s);
}

export async function nextCustomerNo(): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const row = await q1<{ n: string }>("select nextval('customer_no_seq')::text as n");
    const no = customerNoFrom7(row!.n);
    const taken = await q1("select 1 from customers where customer_no = $1", [no]);
    if (!taken) return no;
  }
  throw new Error("no free customer number");
}

/** EAN-13: prefix (2 digits) + 10 digits payload + check digit. */
export function ean13From(prefix: string, payload: number | string): string {
  const body = prefix + String(payload).padStart(10, "0").slice(-10);
  return body + gs1CheckDigit(body);
}

/** Fixed per-customer delivery code: prefix + "9" + customer_no (incl. its check digit) + padding. */
export function customerDeliveryEan(prefix: string, customerNo: string): string {
  return ean13From(prefix, "9" + customerNo.padStart(8, "0") + "0");
}

/**
 * Delivery EAN-13 for a new order of a customer, respecting the global mode and the per-customer
 * override (`barcode_mode`, `fixed_delivery_ean`).
 */
export async function deliveryEanFor(
  customer: { customer_no: string; barcode_mode: string | null; fixed_delivery_ean: string | null },
  settings: Setting<"barcodes">,
): Promise<string> {
  const mode = customer.barcode_mode ?? settings.mode;
  if (mode === "per_customer") {
    if (customer.fixed_delivery_ean && isValidGtin(customer.fixed_delivery_ean, 13)) return customer.fixed_delivery_ean;
    return customerDeliveryEan(settings.ean13_prefix, customer.customer_no);
  }
  const row = await q1<{ n: string }>("select nextval('delivery_ean_seq')::text as n");
  return ean13From(settings.ean13_prefix, row!.n);
}

// ── Composite 2D payload with umlaut support ─────────────────────────────

/**
 * Characters copied unchanged: GS1 character set 82 minus '%' (escape), '_' (stands for space)
 * and '(' ')' (AI delimiters in bracketed element strings).
 */
const CSET82_SAFE = /[A-Za-z0-9!"&'*+,\-./:;<=>?]/;

/** Space → '_', everything else outside the safe set → UTF-8 percent-encoding. */
export function encodeCset82(text: string): string {
  let out = "";
  for (const ch of text.normalize("NFC")) {
    if (ch === " ") out += "_";
    else if (CSET82_SAFE.test(ch)) out += ch;
    else for (const b of Buffer.from(ch, "utf8")) out += "%" + b.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}

export function decodeCset82(text: string): string {
  const spaced = text.replace(/_/g, " ");
  try {
    return decodeURIComponent(spaced.replace(/%(?![0-9A-Fa-f]{2})/g, "%25"));
  } catch {
    return spaced;
  }
}

/** Display name for barcode/label: "Herbert Müller - Strandleben GmbH". */
export function customerDisplayName(c: { company: string | null; first_name: string | null; last_name: string | null }): string {
  const person = [c.first_name, c.last_name].filter(Boolean).join(" ");
  return [person, c.company].filter(Boolean).join(" - ") || "—";
}

/** GS1 AI (91) holds at most 90 characters. */
const MAX_CC_CHARS = 90;

export function compositeData(name: string): string {
  let enc = encodeCset82(name);
  if (enc.length > MAX_CC_CHARS) {
    // Shorten on character boundaries (never cut an escape sequence in half)
    let cut = name.normalize("NFC");
    while (encodeCset82(cut).length > MAX_CC_CHARS) cut = cut.slice(0, -1);
    enc = encodeCset82(cut);
  }
  return `(91)${enc}`;
}

// ── Rendering ────────────────────────────────────────────────────────────

type Format = "png" | "svg";

async function render(opts: Record<string, unknown>, format: Format): Promise<Buffer | string> {
  if (format === "svg") return bwipjs.toSVG(opts as unknown as Parameters<typeof bwipjs.toSVG>[0]);
  return bwipjs.toBuffer({ scale: 4, ...opts } as unknown as Parameters<typeof bwipjs.toBuffer>[0]);
}

export function renderEan13(code: string, format: Format = "png") {
  if (!isValidGtin(code, 13)) throw new Error("invalid EAN-13");
  return render({ bcid: "ean13", text: code, includetext: true, height: 18, textxalign: "center" }, format);
}

/** EAN-8 composite with the customer name in the CC component. */
export function renderCustomerIndicator(customerNo: string, name: string, format: Format = "png") {
  if (!isValidGtin(customerNo, 8)) throw new Error("invalid EAN-8");
  return render(
    { bcid: "ean8composite", text: `${customerNo}|${compositeData(name)}`, includetext: true, height: 16 },
    format,
  );
}

export function renderQr(text: string, format: Format = "png") {
  return render({ bcid: "qrcode", text, eclevel: "M" }, format);
}
