import { NextResponse } from "next/server";
import { appUser } from "@/lib/app-auth";
import { q } from "@/lib/db";
import { tz } from "@/lib/tours";

export const dynamic = "force-dynamic";

/** Tours of the signed-in driver: released/running from yesterday on, finished ones of the last 3 days. */
export async function GET(req: Request) {
  const user = await appUser(req);
  if (user instanceof NextResponse) return user;
  const tours = await q(
    `select t.id, to_char(t.date, 'YYYY-MM-DD') as date, t.title, t.vehicle, t.mode, t.status,
            to_char(t.planned_start, 'HH24:MI') as planned_start, t.started_at, t.finished_at,
            (t.route->>'distance_km')::float as distance_km, (t.route->>'duration_s')::float as duration_s,
            t.route->>'computed_at' as route_computed_at,
            (select count(*)::int from tour_stops s where s.tour_id = t.id) as stop_count,
            (select count(*)::int from tour_stops s where s.tour_id = t.id and s.status not in ('pending', 'arrived')) as completed_count
       from tours t
      where t.driver_id = $1
        and ((t.status in ('released', 'in_progress') and t.date >= (now() at time zone $2)::date - 1)
          or (t.status = 'done' and t.date >= (now() at time zone $2)::date - 3))
      order by t.date, t.planned_start nulls last, t.title`,
    [user.id, tz()],
  );
  return NextResponse.json({ tours });
}
