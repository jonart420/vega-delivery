import { NextResponse } from "next/server";
import { badId, isUuid, notFound } from "@/lib/api";
import { apiStaff } from "@/lib/auth";
import { q, q1 } from "@/lib/db";
import { eventsForTour } from "@/lib/deliveries";
import { getStops, getTour } from "@/lib/tours";

export const dynamic = "force-dynamic";

/** Live view of a tour for dispatchers: stops, vehicle position, events, notifications. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiStaff();
  if (user instanceof NextResponse) return user;
  const { id } = await params;
  if (!isUuid(id)) return badId();
  const tour = await getTour(id);
  if (!tour) return notFound();
  const [stops, events, position, notifications] = await Promise.all([
    getStops(id),
    eventsForTour(id),
    q1("select lat, lon, heading, speed, t from live_positions where tour_id = $1", [id]),
    q(
      `select n.id, n.stop_id, n.channel, n.kind, n.recipient, n.status, n.error, n.created_at, n.sent_at
         from notifications n join tour_stops s on s.id = n.stop_id where s.tour_id = $1 order by n.created_at desc limit 300`,
      [id],
    ),
  ]);
  return NextResponse.json({ tour, stops, events, position, notifications });
}
