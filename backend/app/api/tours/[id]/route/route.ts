import { NextResponse } from "next/server";
import { z } from "zod";
import { badId, fail, isUuid, readJson, zodFail } from "@/lib/api";
import { apiStaff } from "@/lib/auth";
import { getLocale } from "@/lib/i18n";
import { calculateRoute, getStops, TourLockedError } from "@/lib/tours";

/** Optimizes (or with `order`: applies the manual order) and calculates the route. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiStaff();
  if (user instanceof NextResponse) return user;
  const { id } = await params;
  if (!isUuid(id)) return badId();
  const parsed = z.object({ order: z.array(z.string().uuid()).optional() }).safeParse(await readJson(req));
  if (!parsed.success) return zodFail(parsed.error);
  try {
    const tour = await calculateRoute(id, await getLocale(), parsed.data.order);
    return NextResponse.json({ tour, stops: await getStops(id) });
  } catch (e) {
    if (e instanceof TourLockedError) return fail("tour_locked", 409);
    return NextResponse.json({ error: (e as Error).message }, { status: 422 });
  }
}
