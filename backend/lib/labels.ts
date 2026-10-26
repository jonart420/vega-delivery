import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import sharp from "sharp";
import { brandName, logoFile } from "./branding";
import { customerDisplayName, renderCustomerIndicator, renderEan13 } from "./barcodes";
import { q } from "./db";
import { intlLocale, makeT, type Locale } from "./i18n-core";
import { itemsForOrders } from "./orders";
import { getSetting } from "./settings";
import { getStops, getTour } from "./tours";

/**
 * Printable PDFs: delivery labels (100 × 150 mm, one per order) and the tour loading list (A4).
 * Uses DejaVu Sans (installed in the Docker image) or Arial on macOS – both cover Latin Extended –,
 * otherwise Helvetica (WinAnsi: covers German umlauts and ß, but e.g. not ş/ı).
 */

const MM = 72 / 25.4;
const LABEL_W = 100 * MM;
const LABEL_H = 150 * MM;
const FONT_PATHS = [
  process.env.PDF_FONT_PATH,
  "/usr/share/fonts/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  // macOS (local development): Arial covers Latin Extended (ş, ı, ł …)
  "/System/Library/Fonts/Supplemental/Arial.ttf",
].filter(Boolean) as string[];
const FONT_BOLD_PATHS = [
  process.env.PDF_FONT_BOLD_PATH,
  "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
].filter(Boolean) as string[];

async function fonts(doc: PDFDocument): Promise<{ regular: PDFFont; bold: PDFFont; unicode: boolean }> {
  const reg = FONT_PATHS.find((p) => existsSync(p));
  const bold = FONT_BOLD_PATHS.find((p) => existsSync(p));
  if (reg) {
    doc.registerFontkit(fontkit);
    const regular = await doc.embedFont(await readFile(reg), { subset: true });
    return { regular, bold: bold ? await doc.embedFont(await readFile(bold), { subset: true }) : regular, unicode: true };
  }
  return { regular: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold), unicode: false };
}

/** Text safe for the font: WinAnsi fonts cannot draw characters outside Latin-1 (+ a few). */
function safe(text: string, unicode: boolean): string {
  const s = text.normalize("NFC");
  return unicode ? s : s.replace(/[^\x20-\x7e -ÿ–—‘’“”€]/g, "?");
}

function fit(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(t + "…", size) > maxWidth) t = t.slice(0, -1);
  return t + "…";
}

async function embedPng(doc: PDFDocument, png: Buffer) {
  return doc.embedPng(png);
}

async function logoImage(doc: PDFDocument) {
  const file = logoFile();
  if (!file) return null;
  try {
    const png = await sharp(await readFile(file), { density: 300 }).resize({ height: 160 }).png().toBuffer();
    return await doc.embedPng(png);
  } catch {
    return null;
  }
}

type LabelOrder = {
  id: string;
  order_no: string;
  delivery_date: string;
  delivery_ean13: string;
  notes: string | null;
  customer_no: string;
  company: string | null;
  first_name: string | null;
  last_name: string | null;
  street: string;
  house_no: string | null;
  address_extra: string | null;
  zip: string;
  city: string;
  phone: string | null;
  delivery_notes: string | null;
  tour_title: string | null;
  stop_no: number | null;
};

export async function labelsPdf(orderIds: string[], locale: Locale): Promise<Uint8Array> {
  const t = makeT(locale);
  const orders = await q<LabelOrder>(
    `select o.id, o.order_no::text, to_char(o.delivery_date, 'YYYY-MM-DD') as delivery_date, o.delivery_ean13, o.notes,
            c.customer_no, c.company, c.first_name, c.last_name, c.street, c.house_no, c.address_extra, c.zip, c.city, c.phone,
            c.delivery_notes, tr.title as tour_title, s.sort_index as stop_no
       from orders o join customers c on c.id = o.customer_id
       left join tour_stop_orders tso on tso.order_id = o.id
       left join tour_stops s on s.id = tso.stop_id
       left join tours tr on tr.id = s.tour_id
      where o.id = any($1::uuid[])
      order by s.sort_index nulls last, o.order_no`,
    [orderIds],
  );
  const items = await itemsForOrders(orders.map((o) => o.id));
  const company = (await getSetting("company")).name || brandName();

  const doc = await PDFDocument.create();
  doc.setTitle(t("labels.title"));
  const { regular, bold, unicode } = await fonts(doc);
  const logo = await logoImage(doc);
  const S = (s: string) => safe(s, unicode);

  for (const o of orders) {
    const page = doc.addPage([LABEL_W, LABEL_H]);
    const m = 8 * MM;
    const w = LABEL_W - 2 * m;
    let y = LABEL_H - m;

    // Header: logo/company + stop number
    if (logo) {
      const h = 9 * MM;
      const scale = h / logo.height;
      page.drawImage(logo, { x: m, y: y - h, width: logo.width * scale, height: h });
    } else {
      page.drawText(fit(S(company), bold, 11, w * 0.7), { x: m, y: y - 11, size: 11, font: bold });
    }
    if (o.stop_no != null) {
      const label = `#${o.stop_no}`;
      const size = 22;
      page.drawText(label, { x: LABEL_W - m - bold.widthOfTextAtSize(label, size), y: y - size + 2, size, font: bold });
    }
    y -= 13 * MM;
    line(page, m, y, w);

    // Recipient
    y -= 6 * MM;
    page.drawText(S(t("labels.recipient")), { x: m, y, size: 7, font: regular, color: rgb(0.4, 0.4, 0.4) });
    const name = customerDisplayName(o);
    y -= 6 * MM;
    page.drawText(fit(S(name), bold, 14, w), { x: m, y, size: 14, font: bold });
    for (const l of [
      [o.street, o.house_no].filter(Boolean).join(" "),
      o.address_extra ?? "",
      `${o.zip} ${o.city}`,
      o.phone ? `${t("labels.phone")}: ${o.phone}` : "",
    ].filter(Boolean)) {
      y -= 5.2 * MM;
      page.drawText(fit(S(l), regular, 11, w), { x: m, y, size: 11, font: regular });
    }
    if (o.delivery_notes) {
      y -= 5.5 * MM;
      page.drawText(fit(S(`${t("labels.notes")}: ${o.delivery_notes}`), bold, 9, w), { x: m, y, size: 9, font: bold });
    }

    // Order meta
    y -= 7 * MM;
    line(page, m, y + 3 * MM, w);
    const date = new Date(`${o.delivery_date}T12:00:00Z`).toLocaleDateString(intlLocale(locale));
    page.drawText(S(`${t("labels.order")} ${o.order_no} · ${date}${o.tour_title ? ` · ${o.tour_title}` : ""}`), {
      x: m, y, size: 8.5, font: regular,
    });
    const its = items.get(o.id) ?? [];
    for (const it of its.slice(0, 5)) {
      y -= 4.2 * MM;
      page.drawText(fit(S(`${Number(it.qty)} × ${it.name_snapshot}`), regular, 8.5, w), { x: m, y, size: 8.5, font: regular });
    }
    if (its.length > 5) {
      y -= 4.2 * MM;
      page.drawText(S(t("labels.more_items", { n: its.length - 5 })), { x: m, y, size: 8.5, font: regular });
    }

    // Barcodes at the bottom: delivery EAN-13 (left), customer EAN-8 composite (right)
    const ean = await embedPng(doc, (await renderEan13(o.delivery_ean13, "png")) as Buffer);
    const ind = await embedPng(doc, (await renderCustomerIndicator(o.customer_no, name, "png")) as Buffer);
    const bh = 30 * MM;
    const eanW = Math.min(w * 0.55, (ean.width / ean.height) * bh);
    page.drawImage(ean, { x: m, y: m + 5 * MM, width: eanW, height: (eanW / ean.width) * ean.height });
    const indW = Math.min(w * 0.4, (ind.width / ind.height) * bh);
    page.drawImage(ind, { x: LABEL_W - m - indW, y: m + 5 * MM, width: indW, height: (indW / ind.width) * ind.height });
    page.drawText(S(t("labels.delivery_code")), { x: m, y: m, size: 6.5, font: regular, color: rgb(0.4, 0.4, 0.4) });
    const custLbl = S(`${t("labels.customer")} ${o.customer_no}`);
    page.drawText(custLbl, { x: LABEL_W - m - regular.widthOfTextAtSize(custLbl, 6.5), y: m, size: 6.5, font: regular, color: rgb(0.4, 0.4, 0.4) });
  }
  if (!orders.length) doc.addPage([LABEL_W, LABEL_H]);
  return doc.save();
}

function line(page: PDFPage, x: number, y: number, w: number) {
  page.drawLine({ start: { x, y }, end: { x: x + w, y }, thickness: 0.6, color: rgb(0.75, 0.75, 0.75) });
}

/** A4 loading list for a tour: stops in driving order with orders and items. */
export async function tourSheetPdf(tourId: string, locale: Locale): Promise<Uint8Array | null> {
  const tour = await getTour(tourId);
  if (!tour) return null;
  const t = makeT(locale);
  const stops = await getStops(tourId);
  const doc = await PDFDocument.create();
  doc.setTitle(`${tour.title} – ${tour.date}`);
  const { regular, bold, unicode } = await fonts(doc);
  const S = (s: string) => safe(s, unicode);
  const A4: [number, number] = [595.28, 841.89];
  const m = 40;
  let page = doc.addPage(A4);
  let y = A4[1] - m;
  const newPageIfNeeded = (need: number) => {
    if (y - need < m) {
      page = doc.addPage(A4);
      y = A4[1] - m;
    }
  };

  page.drawText(S(tour.title), { x: m, y: y - 16, size: 16, font: bold });
  y -= 24;
  const date = new Date(`${tour.date}T12:00:00Z`).toLocaleDateString(intlLocale(locale), { dateStyle: "full" });
  const meta = [date, tour.driver_name ? `${t("tours.driver")}: ${tour.driver_name}` : null, tour.vehicle,
    tour.route ? `${tour.route.distance_km.toFixed(1)} km` : null].filter(Boolean).join(" · ");
  page.drawText(S(meta), { x: m, y: y - 10, size: 10, font: regular });
  y -= 24;

  for (const s of stops) {
    const lines = 2 + s.orders.reduce((n, o) => n + 1 + o.items.length, 0) + (s.delivery_notes ? 1 : 0);
    newPageIfNeeded(lines * 12 + 14);
    line(page, m, y, A4[0] - 2 * m);
    y -= 14;
    const eta = s.eta ? new Date(s.eta).toLocaleTimeString(intlLocale(locale), { hour: "2-digit", minute: "2-digit", timeZone: process.env.TZ || "Europe/Berlin" }) : "";
    page.drawText(S(`${s.sort_index ?? "–"}.`), { x: m, y, size: 11, font: bold });
    page.drawText(fit(S(`${s.name} (${s.customer_no})`), bold, 11, 380), { x: m + 26, y, size: 11, font: bold });
    if (eta) page.drawText(S(eta), { x: A4[0] - m - regular.widthOfTextAtSize(eta, 10), y, size: 10, font: regular });
    y -= 12;
    page.drawText(fit(S(`${[s.street, s.house_no].filter(Boolean).join(" ")}, ${s.zip} ${s.city}${s.phone ? ` · ${s.phone}` : ""}`), regular, 9.5, 480), {
      x: m + 26, y, size: 9.5, font: regular,
    });
    if (s.delivery_notes) {
      y -= 12;
      page.drawText(fit(S(`${t("labels.notes")}: ${s.delivery_notes}`), bold, 9, 480), { x: m + 26, y, size: 9, font: bold });
    }
    for (const o of s.orders) {
      y -= 12;
      page.drawText(S(`${t("labels.order")} ${o.order_no} · EAN ${o.delivery_ean13}`), { x: m + 26, y, size: 9, font: regular, color: rgb(0.3, 0.3, 0.3) });
      for (const it of o.items) {
        y -= 12;
        page.drawText(fit(S(`☐ ${Number(it.qty)} ${it.unit} × ${it.name_snapshot}`.replace("☐", unicode ? "☐" : "[ ]")), regular, 9, 460), {
          x: m + 40, y, size: 9, font: regular,
        });
      }
    }
    y -= 6;
  }
  return doc.save();
}

/**
 * One-page customer barcode sheet: the EAN-8 composite customer indicator, printed once and left
 * at the customer (door, mailbox, goods entrance). Drivers scan it as proof of delivery, so no
 * new label per order is needed. One page per customer; format "a4" or "a6".
 */
export async function customerSheetsPdf(customerIds: string[], locale: Locale, format: "a4" | "a6" = "a4"): Promise<Uint8Array> {
  const t = makeT(locale);
  const customers = await q<{
    id: string; customer_no: string; company: string | null; first_name: string | null; last_name: string | null;
    street: string; house_no: string | null; zip: string; city: string;
  }>(
    `select id, customer_no, company, first_name, last_name, street, house_no, zip, city
       from customers where id = any($1::uuid[]) order by zip, street, customer_no`,
    [customerIds],
  );
  const company = (await getSetting("company")).name || brandName();
  const doc = await PDFDocument.create();
  doc.setTitle(t("labels.customer_sheet_title"));
  const { regular, bold, unicode } = await fonts(doc);
  const logo = await logoImage(doc);
  const S = (s: string) => safe(s, unicode);
  const size: [number, number] = format === "a6" ? [105 * MM, 148 * MM] : [595.28, 841.89];
  const k = format === "a6" ? 0.5 : 1; // scale factor for typography and spacing

  for (const c of customers) {
    const page = doc.addPage(size);
    const [W, H] = size;
    const m = 18 * MM * k;
    const w = W - 2 * m;
    let y = H - m;
    if (logo) {
      const h = 16 * MM * k;
      const scale = h / logo.height;
      page.drawImage(logo, { x: m, y: y - h, width: logo.width * scale, height: h });
    } else {
      page.drawText(fit(S(company), bold, 20 * k, w), { x: m, y: y - 20 * k, size: 20 * k, font: bold });
    }
    y -= 30 * MM * k;
    const name = customerDisplayName(c);
    const centered = (text: string, font: PDFFont, sz: number, yy: number) => {
      const s = fit(S(text), font, sz, w);
      page.drawText(s, { x: (W - font.widthOfTextAtSize(s, sz)) / 2, y: yy, size: sz, font });
    };
    centered(t("labels.customer_sheet_heading"), bold, 22 * k, y);
    y -= 12 * MM * k;
    centered(name, bold, 18 * k, y);
    y -= 8 * MM * k;
    centered(`${[c.street, c.house_no].filter(Boolean).join(" ")}, ${c.zip} ${c.city}`, regular, 13 * k, y);

    // Large EAN-8 composite in the middle of the page
    const ind = await doc.embedPng((await renderCustomerIndicator(c.customer_no, name, "png")) as Buffer);
    const bw = Math.min(w * 0.7, 120 * MM * k);
    const bh = (bw / ind.width) * ind.height;
    y -= 14 * MM * k + bh;
    page.drawImage(ind, { x: (W - bw) / 2, y, width: bw, height: bh });
    y -= 10 * MM * k;
    centered(`${t("labels.customer")} ${c.customer_no}`, bold, 14 * k, y);

    // Instructions at the bottom
    let iy = m + 30 * MM * k;
    for (const line of [t("labels.customer_sheet_hint_1"), t("labels.customer_sheet_hint_2")]) {
      centered(line, regular, 10 * k, iy);
      iy -= 6 * MM * k;
    }
    page.drawLine({ start: { x: m, y: m + 40 * MM * k }, end: { x: W - m, y: m + 40 * MM * k }, thickness: 0.6, color: rgb(0.8, 0.8, 0.8) });
  }
  if (!customers.length) doc.addPage(size);
  return doc.save();
}
