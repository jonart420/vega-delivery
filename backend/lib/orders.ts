import { z } from "zod";
import { clean } from "./api";
import { deliveryEanFor } from "./barcodes";
import { CUSTOMER_COLS, type Customer } from "./customers";
import { q, q1, tx } from "./db";
import { getSetting } from "./settings";

import type { OrderStatus } from "./order-status";

export { ORDER_STATUSES, type OrderStatus } from "./order-status";

export type OrderItem = {
  id: string;
  product_id: string | null;
  name_snapshot: string;
  qty: string;
  unit: string;
  unit_price_cents: number;
};

export type OrderRow = {
  id: string;
  order_no: string;
  customer_id: string;
  delivery_date: string;
  time_window_from: string | null;
  time_window_to: string | null;
  status: OrderStatus;
  delivery_ean13: string;
  notes: string | null;
  created_at: string;
  item_count: number;
  total_cents: number;
  tour_id: string | null;
  tour_title: string | null;
  customer_no: string;
  company: string | null;
  first_name: string | null;
  last_name: string | null;
  street: string;
  house_no: string | null;
  zip: string;
  city: string;
  lat: number | null;
};

export type OrderDetail = OrderRow & { items: OrderItem[]; customer: Customer };

const time = z
  .string()
  .regex(/^\d{2}:\d{2}$/)
  .nullish()
  .or(z.literal("").transform(() => null))
  .transform((v) => v || null);

export const OrderInput = z.object({
  customer_id: z.string().uuid(),
  delivery_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time_window_from: time,
  time_window_to: time,
  notes: z.string().max(2000).nullish().transform((v) => clean(v ?? null)),
  items: z
    .array(
      z.object({
        product_id: z.string().uuid().nullish(),
        name: z.string().min(1).max(200).transform((v) => v.normalize("NFC").trim()),
        qty: z.number().positive().max(100000),
        unit: z.string().min(1).max(20).default("pcs"),
        unit_price_cents: z.number().int().min(0).max(100_000_000).default(0),
      }),
    )
    .max(200)
    .default([]),
});
export type OrderInputT = z.infer<typeof OrderInput>;

const ROW_SELECT = `
  select o.id, o.order_no::text, o.customer_id, to_char(o.delivery_date, 'YYYY-MM-DD') as delivery_date,
         to_char(o.time_window_from, 'HH24:MI') as time_window_from, to_char(o.time_window_to, 'HH24:MI') as time_window_to,
         o.status, o.delivery_ean13, o.notes, o.created_at,
         (select count(*)::int from order_items i where i.order_id = o.id) as item_count,
         (select coalesce(sum(round(i.qty * i.unit_price_cents)), 0)::int from order_items i where i.order_id = o.id) as total_cents,
         t.id as tour_id, t.title as tour_title,
         c.customer_no, c.company, c.first_name, c.last_name, c.street, c.house_no, c.zip, c.city, c.lat
    from orders o
    join customers c on c.id = o.customer_id
    left join tour_stop_orders tso on tso.order_id = o.id
    left join tour_stops ts on ts.id = tso.stop_id
    left join tours t on t.id = ts.tour_id`;

export async function listOrders(opts: {
  date?: string | null;
  status?: OrderStatus | null;
  customerId?: string | null;
  search?: string | null;
  unplannedOnly?: boolean;
  limit?: number;
}): Promise<OrderRow[]> {
  const params: unknown[] = [];
  const where: string[] = [];
  if (opts.date) {
    params.push(opts.date);
    where.push(`o.delivery_date = $${params.length}`);
  }
  if (opts.status) {
    params.push(opts.status);
    where.push(`o.status = $${params.length}`);
  }
  if (opts.customerId) {
    params.push(opts.customerId);
    where.push(`o.customer_id = $${params.length}`);
  }
  if (opts.unplannedOnly) where.push("tso.order_id is null and o.status = 'open'");
  if (opts.search?.trim()) {
    params.push(`%${opts.search.normalize("NFC").trim()}%`);
    const p = `$${params.length}`;
    where.push(`(o.order_no::text like ${p} or o.delivery_ean13 like ${p} or c.customer_no like ${p} or c.company ilike ${p}
      or c.last_name ilike ${p} or c.first_name ilike ${p} or c.city ilike ${p} or c.zip like ${p})`);
  }
  params.push(Math.min(opts.limit ?? 300, 2000));
  return q<OrderRow>(
    `${ROW_SELECT} ${where.length ? "where " + where.join(" and ") : ""}
      order by o.delivery_date desc, c.zip, o.order_no desc limit $${params.length}`,
    params,
  );
}

export async function getOrder(id: string): Promise<OrderDetail | null> {
  const row = await q1<OrderRow>(`${ROW_SELECT} where o.id = $1`, [id]);
  if (!row) return null;
  const [items, customer] = await Promise.all([
    q<OrderItem>(
      `select id, product_id, name_snapshot, qty::text, unit, unit_price_cents from order_items where order_id = $1 order by sort`,
      [id],
    ),
    q1<Customer>(`select ${CUSTOMER_COLS} from customers c where c.id = $1`, [row.customer_id]),
  ]);
  return { ...row, items, customer: customer! };
}

export async function createOrder(input: OrderInputT, userId: string | null): Promise<string> {
  const customer = await q1<{ customer_no: string; barcode_mode: string | null; fixed_delivery_ean: string | null }>(
    "select customer_no, barcode_mode, fixed_delivery_ean from customers where id = $1 and active",
    [input.customer_id],
  );
  if (!customer) throw new Error("customer not found");
  const ean = await deliveryEanFor(customer, await getSetting("barcodes"));
  return tx(async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `insert into orders (customer_id, delivery_date, time_window_from, time_window_to, notes, delivery_ean13, created_by)
       values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [input.customer_id, input.delivery_date, input.time_window_from, input.time_window_to, input.notes, ean, userId],
    );
    await insertItems(c, rows[0].id, input.items);
    return rows[0].id;
  });
}

export async function updateOrder(id: string, input: OrderInputT): Promise<boolean> {
  return tx(async (c) => {
    const cur = await c.query<{ status: string; customer_id: string }>("select status, customer_id from orders where id = $1 for update", [id]);
    if (!cur.rows[0]) return false;
    if (cur.rows[0].customer_id !== input.customer_id) {
      // Changing the customer of a planned order would break the stop grouping
      const planned = await c.query("select 1 from tour_stop_orders where order_id = $1", [id]);
      if (planned.rowCount) throw new Error("order is planned in a tour – remove it from the tour first");
    }
    await c.query(
      `update orders set customer_id=$2, delivery_date=$3, time_window_from=$4, time_window_to=$5, notes=$6, updated_at=now() where id=$1`,
      [id, input.customer_id, input.delivery_date, input.time_window_from, input.time_window_to, input.notes],
    );
    await c.query("delete from order_items where order_id = $1", [id]);
    await insertItems(c, id, input.items);
    return true;
  });
}

async function insertItems(
  c: { query: (sql: string, params: unknown[]) => Promise<unknown> },
  orderId: string,
  items: OrderInputT["items"],
) {
  let sort = 0;
  for (const it of items) {
    await c.query(
      `insert into order_items (order_id, product_id, name_snapshot, qty, unit, unit_price_cents, sort) values ($1,$2,$3,$4,$5,$6,$7)`,
      [orderId, it.product_id ?? null, it.name, it.qty, it.unit, it.unit_price_cents, sort++],
    );
  }
}

/** Items of several orders (for tour packages and labels). */
export async function itemsForOrders(orderIds: string[]): Promise<Map<string, OrderItem[]>> {
  if (!orderIds.length) return new Map();
  const rows = await q<OrderItem & { order_id: string }>(
    `select order_id, id, product_id, name_snapshot, qty::text, unit, unit_price_cents
       from order_items where order_id = any($1::uuid[]) order by sort`,
    [orderIds],
  );
  const out = new Map<string, OrderItem[]>();
  for (const r of rows) out.set(r.order_id, [...(out.get(r.order_id) ?? []), r]);
  return out;
}
