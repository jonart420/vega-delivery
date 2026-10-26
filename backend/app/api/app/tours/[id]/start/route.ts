import { NextResponse } from "next/server";
import { appUser } from "@/lib/app-auth";
import { appTourAccess } from "@/lib/app-tours";
import { q } from "@/lib/db";
import { onTourStarted } from "@/lib/notify";
import { getTour, startTour } from "@/lib/tours";

/** Driver starts the tour: day-start notifications go out, tracking for the first stops activates. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await appUser(req);
  if (user instanceof NextResponse) return user;
  const { id } = await params;
  const access = await appTourAccess(id, user.id);
  if (access instanceof NextResponse) return access;
  if (await startTour(id)) {
    await q("insert into delivery_events (tour_id, user_id, device_id, type) values ($1, $2, $3, 'started')", [id, user.id, user.device_id]);
    await onTourStarted(id);
  }
  const tour = await getTour(id);
  return NextResponse.json({ status: tour?.status, started_at: tour?.started_at });
}
