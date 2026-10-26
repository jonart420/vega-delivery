// Demo data for a fresh installation: depot, products, customers in Hamburg, orders for today,
// a driver and a released tour. Uses the public API, so it runs against any instance.
//
//   node scripts/seed-demo.mjs                      (BASE_URL, ADMIN_USERNAME, ADMIN_PASSWORD from env)
//   node scripts/seed-demo.mjs --fake-route         without Valhalla: straight-line route written to
//                                                   the database (needs DATABASE_URL; testing only)
import pg from "pg";

const B = (process.env.BASE_URL ?? "http://localhost:3100").replace(/\/$/, "");
const fakeRoute = process.argv.includes("--fake-route");
let cookie = "";

async function call(path, method = "GET", body) {
  const res = await fetch(B + path, {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), cookie },
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(",").map((c) => c.split(";")[0]).filter((c) => c.includes("vd_")).join("; ");
  const json = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 422) throw new Error(`${method} ${path}: ${res.status} ${json.error ?? ""}`);
  return { status: res.status, json };
}

await call("/api/auth/login", "POST", { username: process.env.ADMIN_USERNAME ?? "admin", password: process.env.ADMIN_PASSWORD });
await call("/api/settings", "PUT", { key: "company", value: { name: "Demo Lieferdienst", phone: "+49 40 1234567", email: "", website: "" } });
await call("/api/settings", "PUT", { key: "depot", value: { label: "Depot, Großer Burstah 31, 20457 Hamburg", lat: 53.5486, lon: 9.9897 } });

const cat = (await call("/api/categories", "POST", { name: "Getränke" })).json.category;
const juice = (await call("/api/products", "POST", { name: "Apfelsaft 1 l", category_id: cat.id, price_cents: 249, vat_rate: 7 })).json.id;
const water = (await call("/api/products", "POST", { name: "Mineralwasser Kiste", category_id: cat.id, unit: "box", price_cents: 699, vat_rate: 19 })).json.id;

const people = [
  ["Herbert", "Müller", "Strandleben GmbH", "Mönckebergstraße", "7", "20095", 53.5507, 10.0007, "Lieferung an der Warenannahme"],
  ["Jürgen", "Schäfer", null, "Lange Reihe", "41", "20099", 53.5567, 10.0128, "2. OG, bitte klingeln"],
  ["Ayşe", "Yılmaz", "Café Öztürk", "Schulterblatt", "58", "20357", 53.5627, 9.9612, null],
  ["Grete", "Weiß", null, "Elbchaussee", "12", "22765", 53.5459, 9.9338, "Tor-Code 4711"],
];
const today = new Date().toISOString().slice(0, 10);
const orderIds = [];
for (const [first, last, company, street, no, zip, lat, lon, notes] of people) {
  const c = (await call("/api/customers", "POST", {
    first_name: first, last_name: last, company, street, house_no: no, zip, city: "Hamburg", country: "DE", lat, lon,
    delivery_notes: notes, email: `${last.toLowerCase().normalize("NFD").replace(/[^a-z]/g, "")}@example.com`, notify_email: true,
  })).json.customer;
  const o = (await call("/api/orders", "POST", {
    customer_id: c.id, delivery_date: today,
    items: [
      { product_id: juice, name: "Apfelsaft 1 l", qty: 6, unit: "pcs", unit_price_cents: 249 },
      { product_id: water, name: "Mineralwasser Kiste", qty: 1, unit: "box", unit_price_cents: 699 },
    ],
  })).json.order;
  orderIds.push(o.id);
}

const driver = (await call("/api/team", "POST", { username: `driver${Date.now() % 10000}`, display_name: "Demo Fahrer", role: "driver" })).json.member;
const tour = (await call("/api/tours", "POST", { date: today, title: "Demo-Tour Hamburg", driver_id: driver.id, order_ids: orderIds })).json.tour;
const route = await call(`/api/tours/${tour.id}/route`, "POST", {});
if (route.status === 422) {
  if (!fakeRoute) throw new Error(`Route calculation failed: ${route.json.error} (start Valhalla or use --fake-route)`);
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const stops = (await db.query(
    "select s.id, c.lat, c.lon from tour_stops s join customers c on c.id = s.customer_id where s.tour_id = $1 order by c.lon",
    [tour.id],
  )).rows;
  const pts = [[9.9897, 53.5486], ...stops.map((s) => [s.lon, s.lat]), [9.9897, 53.5486]];
  await db.query("update tours set route = $2 where id = $1", [tour.id, JSON.stringify({
    order: stops.map((s) => s.id), geometry: pts, distance_km: 14.2, duration_s: 2400,
    legs: pts.slice(1).map(() => ({ distance_km: 2.8, duration_s: 480 })), computed_at: new Date().toISOString(),
    mode: "auto", order_mode: "optimized",
  })]);
  for (const [i, s] of stops.entries()) await db.query("update tour_stops set sort_index = $2 where id = $1", [s.id, i + 1]);
  await db.end();
}
await call(`/api/tours/${tour.id}/release`, "POST");
console.log(`Tour:        ${B}/tours/${tour.id}`);
console.log(`Driver code: ${driver.code.grouped}`);
console.log(`QR payload:  vegadelivery://login?v=3&s=${encodeURIComponent(B)}&c=${driver.code.code}`);
