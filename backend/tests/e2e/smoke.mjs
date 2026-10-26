// End-to-end smoke test against a running backend (APP_ENV=development, local Postgres, no Valhalla).
import pg from "pg";
const B = process.env.E2E_BASE_URL ?? "http://localhost:3311";
const db = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL });
let cookie = "";
const ok = (c, m) => { if (!c) { console.error("FAIL:", m); process.exitCode = 1; throw new Error(m); } console.log("✔", m); };
async function call(path, method = "GET", body, headers = {}) {
  const res = await fetch(B + path, {
    method,
    headers: { ...(body && !(body instanceof FormData) ? { "content-type": "application/json" } : {}), cookie, ...headers },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(",").map((c) => c.split(";")[0]).filter((c) => c.includes("vd_")).join("; ");
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json, headers: res.headers, text };
}
for (let i = 0; i < 60; i++) { try { const r = await fetch(B + "/api/health"); if (r.ok) break; } catch {} await new Promise((r) => setTimeout(r, 1000)); }
await db.connect();

let r = await call("/api/health"); ok(r.json.ok && r.json.schema === "002_seed_outcomes.sql", "health + migrations");
r = await call("/api/auth/login", "POST", { username: "admin", password: process.env.ADMIN_PASSWORD }); ok(r.status === 200, "admin login");
r = await call("/api/settings", "PUT", { key: "depot", value: { label: "Depot Hamburg", lat: 53.5511, lon: 9.9937 } }); ok(r.status === 200, "set depot");
r = await call("/api/settings", "PUT", { key: "company", value: { name: "Strandleben Lieferdienst", phone: "+49 40 123", email: "", website: "" } }); ok(r.status === 200, "set company");

// Customers (explicit coordinates → no geocoder dependency)
const mk = (i, extra = {}) => ({ first_name: "Herbert", last_name: `Müller ${i}`, company: "Strandleben GmbH", street: "Großer Burstah", house_no: String(i), zip: "20457", city: "Hamburg", country: "DE", lat: 53.548 + i * 0.002, lon: 9.99 + i * 0.003, email: `kunde${i}@example.com`, notify_email: false, whatsapp: "0171 555000" + i, notify_whatsapp: true, locale: i % 2 ? "de" : "en", ...extra });
const customers = [];
for (let i = 1; i <= 6; i++) { r = await call("/api/customers", "POST", mk(i)); ok(r.status === 201 && /^\d{8}$/.test(r.json.customer.customer_no), `customer ${i} created (${r.json.customer?.customer_no})`); customers.push(r.json.customer); }
ok(customers[0].whatsapp === "+491715550001", "WhatsApp number normalized to E.164");
ok(customers[0].last_name === "Müller 1", "umlauts stored");
r = await call(`/api/customers/${customers[0].id}`, "PUT", { ...mk(1), barcode_mode: "per_customer" }); ok(r.status === 200 && r.json.customer.barcode_mode === "per_customer", "customer barcode override");
r = await call(`/api/customers/${customers[0].id}/indicator?format=svg`); ok(r.status === 200 && r.text.startsWith("<svg"), "EAN-8 composite indicator");
r = await call("/api/customers?q=müller"); ok(r.json.customers.length === 6, "customer search with umlaut");
{
  const raw = Buffer.from(await (await fetch(B + "/api/customers/export", { headers: { cookie } })).arrayBuffer());
  ok(raw.subarray(0, 3).toString("hex") === "efbbbf" && raw.toString("utf8").includes("customer_no;") && raw.toString("utf8").includes("Müller"), "CSV export with BOM");
}
r = await fetch(B + "/api/customers/import", { method: "POST", headers: { cookie }, body: "company;last_name;street;house_no;zip;city;lat;lon\nBäckerei Groß;Schäfer;Mönckebergstraße;7;20095;Hamburg;53.5507;10.0007\n" });
const imp = await r.json(); ok(imp.created === 1, "CSV import");

// Products
r = await call("/api/categories", "POST", { name: "Getränke" }); const cat = r.json.category; ok(r.status === 201, "category");
r = await call("/api/categories", "POST", { name: "Säfte", parent_id: cat.id }); const sub = r.json.category; ok(r.status === 201, "sub-category");
r = await call(`/api/categories/${cat.id}`, "PUT", { name: "Getränke", parent_id: sub.id, sort: 0 }); ok(r.status === 400, "category cycle rejected");
r = await call("/api/products", "POST", { name: "Apfelsaft 1 l", sku: "AS-1", category_id: sub.id, unit: "pcs", price_cents: 249, vat_rate: 7, ean13: "4006381333931" }); ok(r.status === 201, "product");
const productId = r.json.id;
r = await call("/api/products", "POST", { name: "Bad EAN", ean13: "4006381333932" }); ok(r.status === 400, "invalid EAN rejected");

// Orders
const date = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
const orders = [];
for (const c of customers) {
  r = await call("/api/orders", "POST", { customer_id: c.id, delivery_date: date, items: [{ product_id: productId, name: "Apfelsaft 1 l", qty: 2, unit: "pcs", unit_price_cents: 249 }] });
  ok(r.status === 201 && /^\d{13}$/.test(r.json.order.delivery_ean13), `order ${r.json.order?.order_no} (EAN ${r.json.order?.delivery_ean13})`);
  orders.push(r.json.order);
}
// Second order of customer 1 → same stop; per_customer → same EAN
r = await call("/api/orders", "POST", { customer_id: customers[0].id, delivery_date: date, items: [] });
ok(r.json.order.delivery_ean13 === orders[0].delivery_ean13, "per-customer EAN stays constant");
orders.push(r.json.order);
ok(orders[1].delivery_ean13 !== orders[2].delivery_ean13, "per-delivery EAN varies");
r = await call(`/api/orders/labels?ids=${orders.map((o) => o.id).join(",")}`); ok(r.status === 200 && r.headers.get("content-type") === "application/pdf", "labels PDF");

// Team
r = await call("/api/team", "POST", { username: "fahrer1", display_name: "Jürgen Fahrer", role: "driver" }); ok(r.status === 201 && r.json.member.code.status === "valid", "driver with login code");
const driver = r.json.member;
r = await call(`/api/team/${driver.id}/code.png?size=128`); ok(r.status === 200, "login QR PNG");

// Tour
r = await call("/api/tours", "POST", { date, title: "Tour Nord", driver_id: driver.id, order_ids: orders.map((o) => o.id) });
ok(r.status === 201, "tour created with orders"); const tour = r.json.tour;
r = await call(`/api/tours/${tour.id}`); ok(r.json.stops.length === 6, "orders grouped into 6 stops (2 orders of customer 1 share one)");
ok(r.json.tour.start_label === "Depot Hamburg", "depot used as start");
const stops = r.json.stops;
r = await call(`/api/tours/${tour.id}/route`, "POST", {}); ok(r.status === 422 && /Valhalla/.test(r.json.error), "route without Valhalla → clear error");
r = await call(`/api/tours/${tour.id}/release`, "POST"); ok(r.status === 409, "release blocked without route");
// Fake a computed route (Valhalla not running in this test)
const order = stops.map((s) => s.id);
await db.query("update tours set route = $2 where id = $1", [tour.id, JSON.stringify({ order, geometry: [], distance_km: 12.3, duration_s: 1800, legs: order.map(() => ({ distance_km: 2, duration_s: 300 })).concat([{ distance_km: 2, duration_s: 300 }]), computed_at: new Date().toISOString(), mode: "auto", order_mode: "optimized" })]);
for (const [i, id] of order.entries()) await db.query("update tour_stops set sort_index = $2 where id = $1", [id, i + 1]);
r = await call(`/api/tours/${tour.id}/release`, "POST"); ok(r.status === 200 && r.json.tour.status === "released", "tour released");
r = await call(`/api/tours/${tour.id}/sheet`); ok(r.status === 200 && r.headers.get("content-type") === "application/pdf", "loading list PDF");

// App
const qr = (await db.query("select 1")).rows; void qr;
const code = driver.code.code;
r = await call("/api/app/login", "POST", { code: `vegadelivery://login?v=3&s=${encodeURIComponent(B)}&c=${code}`, platform: "ios" }); ok(r.status === 200 && r.json.token.startsWith("vdd_"), "app login with QR v3");
const H = { authorization: `Bearer ${r.json.token}` };
r = await call("/api/app/config", "GET", undefined, H); ok(r.json.outcomes.find((o) => o.code === "refused")?.reasons.length >= 3, "app config with outcomes + reasons");
const refusedReason = r.json.outcomes.find((o) => o.code === "refused").reasons[0];
r = await call("/api/app/tours", "GET", undefined, H); ok(r.json.tours.length === 1, "driver sees tour");
r = await call(`/api/app/tours/${tour.id}`, "GET", undefined, H); ok(r.json.stops.length === 6 && r.json.stops[0].orders[0].items.length >= 0, "tour package");
const appStops = r.json.stops;
r = await call(`/api/app/tours/${tour.id}/events`, "POST", { client_id: "c-000000001", stop_id: appStops[0].id, outcome_code: "delivered", recipient_name: "Herr Müller" }, H);
ok(r.status === 409, "events rejected before tour start");
r = await call(`/api/app/tours/${tour.id}/start`, "POST", {}, H); ok(r.json.status === "in_progress", "tour started");
await new Promise((res) => setTimeout(res, 1500));
let n = await db.query("select s.sort_index, n.kind, n.status, n.channel from notifications n join tour_stops s on s.id = n.stop_id order by s.sort_index");
ok(n.rows.filter((x) => x.kind === "approaching").map((x) => x.sort_index).join(",") === "1,2,3", "approaching for first 3 stops");
ok(n.rows.filter((x) => x.kind === "day_start").map((x) => x.sort_index).join(",") === "4,5,6", "day_start for the other stops");
ok(n.rows.every((x) => x.status === "sent"), "messages sent via WhatsApp log provider");

// Tracking
let t4 = (await db.query("select tracking_token from tour_stops where sort_index = 4 and tour_id = $1", [tour.id])).rows[0].tracking_token;
let t1 = (await db.query("select tracking_token from tour_stops where sort_index = 1 and tour_id = $1", [tour.id])).rows[0].tracking_token;
r = await call(`/api/app/tours/${tour.id}/position`, "POST", { points: [{ t: new Date().toISOString(), lat: 53.55, lon: 9.99, speed: 8, heading: 90, acc: 5 }] }, H); ok(r.json.accepted === 1, "position accepted");
r = await call(`/api/t/${t1}`); ok(r.json.state === "active" && r.json.vehicle?.lat === 53.55, "stop 1 tracking active with vehicle");
r = await call(`/api/t/${t4}`); ok(r.json.state === "waiting" && r.json.vehicle === null, "stop 4 waiting, no vehicle shown");
r = await fetch(`${B}/t/${t1}`); ok(r.status === 200, "public tracking page renders without login");

// Outcomes with validation
r = await call(`/api/app/tours/${tour.id}/events`, "POST", { client_id: "c-000000002", stop_id: appStops[0].id, outcome_code: "delivered" }, H); ok(r.status === 422, "delivered without signature/recipient rejected");
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
let fd = new FormData();
fd.set("meta", JSON.stringify({ client_id: "c-000000003", stop_id: appStops[0].id, outcome_code: "delivered", recipient_name: "Herr Müller", scanned_codes: [orders[0].delivery_ean13] }));
fd.set("signature", new Blob([png], { type: "image/png" }), "sig.png");
r = await call(`/api/app/tours/${tour.id}/events`, "POST", fd, H); ok(r.status === 201 && r.json.stop_status === "delivered", "delivered with signature (multipart)");
r = await call(`/api/app/tours/${tour.id}/events`, "POST", fd, H); ok(r.status === 200 && r.json.duplicate, "resend is idempotent");
r = await call(`/api/app/tours/${tour.id}/events`, "POST", { client_id: "c-000000004", stop_id: appStops[1].id, outcome_code: "refused", recipient_name: "Frau Schröder" }, H); ok(r.status === 422 && /Grund|reason/i.test(r.json.error), "refused without reason rejected");
r = await call(`/api/app/tours/${tour.id}/events`, "POST", { client_id: "c-000000005", stop_id: appStops[1].id, outcome_code: "refused", reason_id: refusedReason.id, reason_text: "Karton nass", recipient_name: "Frau Schröder" }, H); ok(r.status === 201 && r.json.stop_status === "failed", "refused with reason logged");
// Customer barcode sheet as proof of delivery (no per-order label needed)
r = await call(`/api/customers/${customers[0].id}/sheet?format=a6`); ok(r.status === 200 && r.headers.get("content-type") === "application/pdf", "customer barcode sheet PDF");
r = await call(`/api/tours/${tour.id}/customer-sheets`); ok(r.status === 200, "customer sheets for tour");
r = await call("/api/settings", "PUT", { key: "barcodes", value: { mode: "per_delivery", ean13_prefix: "21", scan_accept: "customer" } }); ok(r.status === 200, "scan_accept = customer");
r = await call("/api/outcomes", "POST", { code: "neighbor", label_en: "Left with neighbour", label_de: "Beim Nachbarn abgegeben", kind: "success", requires_scan: true }); ok(r.status === 200, "neighbour requires scan");
{
  const eans = (await db.query("select o.delivery_ean13 from tour_stop_orders x join orders o on o.id = x.order_id where x.stop_id = $1", [appStops[2].id])).rows.map((x) => x.delivery_ean13);
  r = await call(`/api/app/tours/${tour.id}/events`, "POST", { client_id: "c-000000006", stop_id: appStops[2].id, outcome_code: "neighbor", scanned_codes: eans }, H);
  ok(r.status === 422, "order code rejected when only customer barcode counts");
  r = await call(`/api/app/tours/${tour.id}/events`, "POST", { client_id: "c-000000007", stop_id: appStops[2].id, outcome_code: "neighbor", scanned_codes: [`${appStops[2].customer_no}|(91)Herbert_M%C3%BCller`] }, H);
  ok(r.status === 201 && r.json.stop_status === "delivered", "customer EAN-8 composite scan accepted as proof");
}
await new Promise((res) => setTimeout(res, 1000));
n = await db.query("select s.sort_index from notifications n join tour_stops s on s.id = n.stop_id where n.kind = 'approaching' order by 1");
ok(n.rows.map((x) => x.sort_index).join(",") === "1,2,3,4,5,6", "window moved: stops 4–6 now approaching");
r = await call(`/api/t/${t4}`); ok(r.json.state === "active", "stop 4 tracking now active");
r = await call(`/api/t/${t1}`); ok(r.json.state === "delivered", "stop 1 shows delivered");
let o = await db.query(
  `select s.sort_index, array_agg(distinct o.status) as st from tour_stops s join tour_stop_orders x on x.stop_id = s.id
     join orders o on o.id = x.order_id where s.id = any($1::uuid[]) group by s.sort_index order by 1`,
  [[appStops[0].id, appStops[1].id]],
);
ok(o.rows.map((x) => x.st.join("|")).join(",") === "delivered,failed", "order statuses follow outcomes");

// Extensible outcomes / reasons
r = await call("/api/outcomes", "POST", { code: "damaged_on_site", label_en: "Damaged on site", label_de: "Vor Ort beschädigt", kind: "failure", requires_reason: false, requires_photo: true }); ok(r.status === 200, "custom outcome");
r = await call("/api/reasons", "POST", { outcome_code: "aborted", label_en: "Dog in yard", label_de: "Hund im Hof" }); ok(r.status === 201, "custom reason");
r = await call("/api/outcomes/refused", "DELETE"); ok(r.status === 409, "system outcome protected");
r = await call(`/api/tours/${tour.id}/notify`, "POST", { stop_id: appStops[3].id }); ok(r.status === 200 && r.json.queued === 1, "manual notification");
r = await call(`/api/tours/${tour.id}/live`); ok(r.json.events.length >= 3 && r.json.position, "dispatcher live view");
r = await call(`/api/app/tours/${tour.id}/finish`, "POST", {}, H); ok(r.json.status === "done", "tour finished");
o = await db.query("select status, count(*)::int as n from orders where id = any($1::uuid[]) group by status", [orders.map((x) => x.id)]);
{
  const by = Object.fromEntries(o.rows.map((x) => [x.status, x.n]));
  ok(!by.out_for_delivery && by.open === orders.length - (by.delivered ?? 0) - (by.failed ?? 0), "unreached orders open again for re-planning");
}
const failedId = (await db.query("select id from orders where status = 'failed' limit 1")).rows[0].id;
r = await call(`/api/orders/${failedId}`, "PATCH", { action: "reschedule", delivery_date: date }); ok(r.status === 200 && r.json.order.status === "open", "failed order rescheduled");
r = await call("/api/customers", "POST", { last_name: "x" }); ok(r.status === 400, "validation error");
await db.end();
console.log(process.exitCode ? "\nSOME CHECKS FAILED" : "\nALL CHECKS PASSED");
