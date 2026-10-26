import { NextResponse } from "next/server";
import { readJson, zodFail } from "@/lib/api";
import { apiStaff } from "@/lib/auth";
import { createOrder, getOrder, listOrders, ORDER_STATUSES, OrderInput, type OrderStatus } from "@/lib/orders";

export async function GET(req: Request) {
  const user = await apiStaff();
  if (user instanceof NextResponse) return user;
  const sp = new URL(req.url).searchParams;
  const status = sp.get("status");
  const orders = await listOrders({
    date: sp.get("date"),
    status: ORDER_STATUSES.includes(status as OrderStatus) ? (status as OrderStatus) : null,
    customerId: sp.get("customer"),
    search: sp.get("q"),
    unplannedOnly: sp.get("unplanned") === "1",
  });
  return NextResponse.json({ orders });
}

export async function POST(req: Request) {
  const user = await apiStaff();
  if (user instanceof NextResponse) return user;
  const parsed = OrderInput.safeParse(await readJson(req));
  if (!parsed.success) return zodFail(parsed.error);
  try {
    const id = await createOrder(parsed.data, user.id);
    return NextResponse.json({ order: await getOrder(id) }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
