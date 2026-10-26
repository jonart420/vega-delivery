import { NextResponse } from "next/server";
import { fail, isUuid } from "./api";
import { q1 } from "./db";
import type { TourStatus } from "./tours";

/** App access to a tour: the user is its driver and the tour is released, running or done. */
export async function appTourAccess(tourId: string, userId: string): Promise<{ status: TourStatus } | NextResponse> {
  if (!isUuid(tourId)) return fail("not_found", 404);
  const row = await q1<{ status: TourStatus }>(
    "select status from tours where id = $1 and driver_id = $2 and status in ('released', 'in_progress', 'done')",
    [tourId, userId],
  );
  return row ?? fail("tour_not_assigned", 404);
}
