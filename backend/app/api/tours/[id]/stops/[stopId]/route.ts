import { NextResponse } from "next/server";
import { z } from "zod";
import { badId, fail, isUuid, readJson, zodFail } from "@/lib/api";
import { apiStaff } from "@/lib/auth";
import { getStops, getTour, setFixedPosition, TourLockedError } from "@/lib/tours";

/** Pins a stop to a position for the optimization (null = free). */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; stopId: string }> }) {
  const user = await apiStaff();
  if (user instanceof NextResponse) return user;
  const { id, stopId } = await params;
  if (!isUuid(id) || !isUuid(stopId)) return badId();
  const parsed = z.object({ fixed_position: z.number().int().min(1).max(1000).nullable() }).safeParse(await readJson(req));
  if (!parsed.success) return zodFail(parsed.error);
  try {
    await setFixedPosition(id, stopId, parsed.data.fixed_position);
  } catch (e) {
    if (e instanceof TourLockedError) return fail("tour_locked", 409);
    throw e;
  }
  return NextResponse.json({ tour: await getTour(id), stops: await getStops(id) });
}
