import { NextResponse } from "next/server";
import { z } from "zod";
import { badId, fail, isUuid, notFound, readJson, zodFail } from "@/lib/api";
import { apiStaff } from "@/lib/auth";
import { addOrders, getStops, getTour, removeFromTour, TourLockedError } from "@/lib/tours";

type Ctx = { params: Promise<{ id: string }> };

async function respond(id: string) {
  return NextResponse.json({ tour: await getTour(id), stops: await getStops(id) });
}

/** Adds open orders to the tour (grouped into stops per customer). */
export async function POST(req: Request, { params }: Ctx) {
  const user = await apiStaff();
  if (user instanceof NextResponse) return user;
  const { id } = await params;
  if (!isUuid(id)) return badId();
  const parsed = z.object({ order_ids: z.array(z.string().uuid()).min(1).max(1000) }).safeParse(await readJson(req));
  if (!parsed.success) return zodFail(parsed.error);
  try {
    await addOrders(id, parsed.data.order_ids);
  } catch (e) {
    if (e instanceof TourLockedError) return fail("tour_locked", 409);
    throw e;
  }
  return respond(id);
}

/** Removes ?stop=<id> or ?order=<id> from the tour. */
export async function DELETE(req: Request, { params }: Ctx) {
  const user = await apiStaff();
  if (user instanceof NextResponse) return user;
  const { id } = await params;
  if (!isUuid(id)) return badId();
  const sp = new URL(req.url).searchParams;
  const stopId = sp.get("stop");
  const orderId = sp.get("order");
  if (!isUuid(stopId) && !isUuid(orderId)) return badId();
  try {
    const ok = await removeFromTour(id, { stopId: isUuid(stopId) ? stopId : undefined, orderId: isUuid(orderId) ? orderId : undefined });
    if (!ok) return notFound();
  } catch (e) {
    if (e instanceof TourLockedError) return fail("tour_locked", 409);
    throw e;
  }
  return respond(id);
}
