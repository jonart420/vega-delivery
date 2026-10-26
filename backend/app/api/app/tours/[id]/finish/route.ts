import { NextResponse } from "next/server";
import { appUser } from "@/lib/app-auth";
import { appTourAccess } from "@/lib/app-tours";
import { q } from "@/lib/db";
import { finishTour, getTour } from "@/lib/tours";

/** Driver finishes the tour; stops without outcome count as skipped (orders become open again). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await appUser(req);
  if (user instanceof NextResponse) return user;
  const { id } = await params;
  const access = await appTourAccess(id, user.id);
  if (access instanceof NextResponse) return access;
  if (access.status === "in_progress") {
    await finishTour(id);
    await q("insert into delivery_events (tour_id, user_id, device_id, type) values ($1, $2, $3, 'finished')", [id, user.id, user.device_id]);
  }
  const tour = await getTour(id);
  return NextResponse.json({ status: tour?.status });
}
