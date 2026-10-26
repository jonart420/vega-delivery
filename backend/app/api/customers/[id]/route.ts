import { NextResponse } from "next/server";
import { badId, isUuid, notFound, readJson, zodFail } from "@/lib/api";
import { apiStaff } from "@/lib/auth";
import { CustomerInput, getCustomer, updateCustomer } from "@/lib/customers";
import { q, q1 } from "@/lib/db";
import { eventsForCustomer } from "@/lib/deliveries";
import { listOrders } from "@/lib/orders";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const user = await apiStaff();
  if (user instanceof NextResponse) return user;
  const { id } = await params;
  if (!isUuid(id)) return badId();
  const customer = await getCustomer(id);
  if (!customer) return notFound();
  const [orders, events] = await Promise.all([listOrders({ customerId: id, limit: 100 }), eventsForCustomer(id)]);
  return NextResponse.json({ customer, orders, events });
}

export async function PUT(req: Request, { params }: Ctx) {
  const user = await apiStaff();
  if (user instanceof NextResponse) return user;
  const { id } = await params;
  if (!isUuid(id)) return badId();
  const parsed = CustomerInput.safeParse(await readJson(req));
  if (!parsed.success) return zodFail(parsed.error);
  const customer = await updateCustomer(id, parsed.data);
  return customer ? NextResponse.json({ customer }) : notFound();
}

/** Deletes a customer without orders; customers with history are deactivated instead. */
export async function DELETE(_req: Request, { params }: Ctx) {
  const user = await apiStaff();
  if (user instanceof NextResponse) return user;
  const { id } = await params;
  if (!isUuid(id)) return badId();
  const used = await q1("select 1 from orders where customer_id = $1 limit 1", [id]);
  if (used) {
    await q("update customers set active = false, updated_at = now() where id = $1", [id]);
    return NextResponse.json({ ok: true, deactivated: true });
  }
  const r = await q1("delete from customers where id = $1 returning id", [id]);
  return r ? NextResponse.json({ ok: true, deleted: true }) : notFound();
}
