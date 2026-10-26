import { NextResponse } from "next/server";
import { z } from "zod";
import { badId, fail, isUuid, notFound, readJson, zodFail } from "@/lib/api";
import { apiStaff } from "@/lib/auth";
import { q1, tx } from "@/lib/db";
import { getOrder, OrderInput, updateOrder } from "@/lib/orders";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const user = await apiStaff();
  if (user instanceof NextResponse) return user;
  const { id } = await params;
  if (!isUuid(id)) return badId();
  const order = await getOrder(id);
  return order ? NextResponse.json({ order }) : notFound();
}

export async function PUT(req: Request, { params }: Ctx) {
  const user = await apiStaff();
  if (user instanceof NextResponse) return user;
  const { id } = await params;
  if (!isUuid(id)) return badId();
  const parsed = OrderInput.safeParse(await readJson(req));
  if (!parsed.success) return zodFail(parsed.error);
  try {
    const ok = await updateOrder(id, parsed.data);
    return ok ? NextResponse.json({ order: await getOrder(id) }) : notFound();
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 409 });
  }
}

const Action = z.object({
  action: z.enum(["cancel", "reopen", "reschedule"]),
  delivery_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/**
 * Status actions: cancel (not while out for delivery), reopen (cancelled/failed → open),
 * reschedule (failed/open → open on a new date; detached from its finished tour).
 */
export async function PATCH(req: Request, { params }: Ctx) {
  const user = await apiStaff();
  if (user instanceof NextResponse) return user;
  const { id } = await params;
  if (!isUuid(id)) return badId();
  const parsed = Action.safeParse(await readJson(req));
  if (!parsed.success) return zodFail(parsed.error);
  const { action, delivery_date } = parsed.data;
  const result = await tx(async (c) => {
    const cur = await c.query<{ status: string; tour_status: string | null }>(
      `select o.status, t.status as tour_status from orders o
         left join tour_stop_orders tso on tso.order_id = o.id left join tour_stops s on s.id = tso.stop_id
         left join tours t on t.id = s.tour_id where o.id = $1 for update of o`,
      [id],
    );
    const row = cur.rows[0];
    if (!row) return "not_found";
    if (row.tour_status === "in_progress") return "tour_running";
    const detach = () => c.query("delete from tour_stop_orders where order_id = $1", [id]);
    if (action === "cancel") {
      if (row.status === "delivered") return "invalid_status";
      await detach();
      await c.query("update orders set status = 'cancelled', updated_at = now() where id = $1", [id]);
    } else if (action === "reopen" || action === "reschedule") {
      if (!["cancelled", "failed", "open"].includes(row.status)) return "invalid_status";
      if (action === "reschedule" && !delivery_date) return "date_required";
      await detach();
      await c.query(
        "update orders set status = 'open', delivery_date = coalesce($2::date, delivery_date), updated_at = now() where id = $1",
        [id, delivery_date ?? null],
      );
    }
    return "ok";
  });
  if (result === "not_found") return notFound();
  if (result !== "ok") return fail(result, 409);
  return NextResponse.json({ order: await getOrder(id) });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const user = await apiStaff();
  if (user instanceof NextResponse) return user;
  const { id } = await params;
  if (!isUuid(id)) return badId();
  const r = await q1(
    `delete from orders o where o.id = $1 and o.status in ('open', 'cancelled')
       and not exists (select 1 from tour_stop_orders x where x.order_id = o.id) returning id`,
    [id],
  );
  if (r) return NextResponse.json({ ok: true });
  return (await q1("select 1 from orders where id = $1", [id])) ? fail("order_not_deletable", 409) : notFound();
}
